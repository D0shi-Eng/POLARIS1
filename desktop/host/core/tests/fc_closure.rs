// اختبارات تكليف الإغلاق الوظيفي 2026-10-19 (docs/remediation/POLARIS-FUNCTIONAL-CLOSURE-2026-10-19/).
//
// كل اختبار يقيس نتيجة خارجية: ما يُحفظ في المخزن، أو ما تعيده IPC بعد إقلاع ثانٍ على القاعدة نفسها. كُتبت قبل الإصلاح وشُغّلت
// على الشجرة عند `4c58d5a` لحفظ فشلها (الدليل الأحمر خارج Git في `_local/fc-20261019/`). خادم النموذج TEST FIXTURE على الحلقة
// المحلية، لا نموذج حقيقي.

mod p08_support;

use std::time::Duration;

use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use p08_support::{build, build_in, uuid};
use polaris_host_core::p03::graph::TaskGraph;
use polaris_host_core::p03::mission::{CompletionProofStatus, MissionState};
use polaris_host_core::p03::task::{TaskNode, TaskState, TaskType};

/// معرّف خطوة بصيغة UUID مشتقّ حتميًّا من المهمّة ورقم الخطوة.
fn task_id(mission_id: &str, i: usize) -> String {
    format!("{}{:012x}", &mission_id[..24], i + 1)
}

fn graph_of(mission_id: &str, states: &[TaskState]) -> TaskGraph {
    let mut nodes = Vec::new();
    for (i, state) in states.iter().enumerate() {
        let mut node = TaskNode::new(task_id(mission_id, i), mission_id, format!("step {i}"), format!("objective {i}"), TaskType::Build);
        node.state = *state;
        if i > 0 {
            node.parent_task_id = Some(task_id(mission_id, 0));
        }
        nodes.push(node);
    }
    TaskGraph::build(mission_id.to_string(), nodes, 20).unwrap()
}

fn task_states(db: &rusqlite::Connection, mission_id: &str) -> Vec<(String, Option<String>)> {
    let mut stmt = db.prepare("SELECT state, failure_reason FROM tasks WHERE mission_id = ?1 ORDER BY ordinal").unwrap();
    stmt.query_map([mission_id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
}

fn read_db(dir: &std::path::Path) -> rusqlite::Connection {
    rusqlite::Connection::open_with_flags(dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

/// خادم نموذج بصيغة LM Studio؛ ردّ المحادثة يختاره الاختبار — TEST FIXTURE.
fn model_server(chat_status: u16) -> MockServer {
    MockServer::start(handler(move |r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/v1/chat/completions" if chat_status == 200 => Reply::Stream {
            content_type: "text/event-stream",
            parts: vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": "ok" } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 12, "completion_tokens": 1 } })),
                "data: [DONE]\n\n".to_string(),
            ],
            gap: Duration::ZERO,
        },
        "/v1/chat/completions" => Reply::Json(chat_status, json!({ "error": { "message": "fixture failure" } }).to_string()),
        _ => Reply::Json(404, "{}".into()),
    }))
}

fn studio_health(h: &p08_support::Harness) -> Value {
    let list = h.ok("provider.list", json!({}));
    list["providers"].as_array().unwrap().iter().find(|p| p["provider_id"] == "lm-studio").unwrap()["health"].clone()
}

// ——— E-2: «مكتملة» بخطوة محجوبة

/// لقطة تقول COMPLETED وفيها خطوة BLOCKED (كما وُجد في قاعدة المالك، 2026-10-01). الحفظ يجب أن يحفظ الحالة التي تقولها الخطوات:
/// BLOCKED بسبب مكتوب، وإثباتها NOT_PROVEN.
#[test]
fn fc_e2_a_completed_snapshot_with_a_blocked_step_is_saved_blocked() {
    let h = build(None);
    let id = h.ok("mission.create", json!({ "title": "e2", "objective": "hello" }))["mission_id"].as_str().unwrap().to_string();
    let p03 = h.host().phase03().unwrap();
    let mut s = p03.repository.load(&id).unwrap();
    s.graph = graph_of(&id, &[TaskState::Succeeded, TaskState::Blocked]);
    s.mission.root_task_id = Some(task_id(&id, 0));
    s.mission.state = MissionState::Completed;
    s.mission.completion_proof_status = CompletionProofStatus::NotEvaluated;
    p03.repository.save(&s).unwrap();

    let after = p03.repository.load(&id).unwrap();
    assert_eq!(after.mission.state, MissionState::Blocked, "a mission with a blocked step was stored COMPLETED");
    assert_eq!(after.mission.completion_proof_status, CompletionProofStatus::NotProven);
    assert!(after.mission.failure_reason.as_deref().is_some_and(|r| r.starts_with("TASKS_BLOCKED")), "{:?}", after.mission.failure_reason);
    let got = h.ok("mission.get", json!({ "mission_id": id }));
    assert_eq!(got["mission"]["state"], "BLOCKED", "{got}");
}

/// صفّ تاريخي كُتب قبل الحاجز (COMPLETED بخطوة BLOCKED، الإثبات NOT_EVALUATED). الإقلاع لا يعيد كتابة حالته، لكنه لا يتركه
/// قابلًا للإثبات: الإثبات NOT_PROVEN، وحدث تدقيق يقول لماذا. وإقلاع ثالث لا يكرّر الإصلاح.
#[test]
fn fc_e2_boot_marks_a_historic_completed_mission_with_a_blocked_step_not_proven() {
    let data = {
        let h = build(None);
        let id = h.ok("mission.create", json!({ "title": "e2-history", "objective": "hello" }))["mission_id"].as_str().unwrap().to_string();
        let p03 = h.host().phase03().unwrap();
        let mut s = p03.repository.load(&id).unwrap();
        s.graph = graph_of(&id, &[TaskState::Succeeded, TaskState::Succeeded]);
        s.mission.root_task_id = Some(task_id(&id, 0));
        s.mission.state = MissionState::Completed;
        p03.repository.save(&s).unwrap();
        // الكتابة التاريخية تتجاوز الحفظ عمدًا: هكذا كُتب الصفّ قبل الحاجز.
        let db = rusqlite::Connection::open(h.data_dir.join("polaris.db")).unwrap();
        db.execute("UPDATE tasks SET state = 'BLOCKED' WHERE task_id = ?1", [task_id(&id, 1)]).unwrap();
        db.execute("UPDATE missions SET completion_proof_status = 'NOT_EVALUATED' WHERE mission_id = ?1", [&id]).unwrap();
        (h.data_dir.clone(), id)
    };
    let (dir, id) = data;
    {
        let _second = build_in(dir.clone());
        let db = read_db(&dir);
        let (state, proof): (String, String) = db.query_row("SELECT state, completion_proof_status FROM missions WHERE mission_id = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(state, "COMPLETED", "history was rewritten");
        assert_eq!(proof, "NOT_PROVEN", "a completed mission with a blocked step stayed provable");
        let audits: i64 = db.query_row("SELECT count(*) FROM audit_events WHERE subject_id = ?1 AND detail_json LIKE '%BOOT_PROOF%'", [&id], |r| r.get(0)).unwrap();
        assert_eq!(audits, 1, "the repair left no audit event");
    }
    let _third = build_in(dir.clone());
    let audits: i64 = read_db(&dir).query_row("SELECT count(*) FROM audit_events WHERE subject_id = ?1 AND detail_json LIKE '%BOOT_PROOF%'", [&id], |r| r.get(0)).unwrap();
    assert_eq!(audits, 1, "the repair is not idempotent");
}

// ——— E-3: خطوات يتيمة تحت دور محجوب تجاوزته المحادثة

/// دور محجوب بخطوة منقطعة وأخرى معلّقة، ثم رسالة متابعة. المتابعة تنشئ دورًا جديدًا ولا مسار في المنتج يستأنف السابق، فخطواته
/// يجب أن تُغلق CANCELLED بسبب مكتوب، والدور يبقى BLOCKED. الدور الأخير المحجوب (غير المُتجاوَز) لا يُمسّ.
#[test]
fn fc_e3_continuing_past_a_blocked_turn_closes_its_open_steps() {
    let h = build(None);
    let first = h.ok("mission.create", json!({ "title": "e3", "objective": "first" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": first }));
    let p03 = h.host().phase03().unwrap();
    let mut s = p03.repository.load(&first).unwrap();
    s.graph = graph_of(&first, &[TaskState::Interrupted, TaskState::Pending, TaskState::Succeeded]);
    s.mission.root_task_id = Some(task_id(&first, 0));
    s.mission.state = MissionState::Blocked;
    p03.repository.save(&s).unwrap();

    let next = h.ok("conversation.continue", json!({ "mission_id": first, "message": "try again" }));
    let second = next["mission_id"].as_str().unwrap().to_string();
    assert_ne!(second, first);

    let db = read_db(&h.data_dir);
    let steps = task_states(&db, &first);
    assert_eq!(steps.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(), vec!["CANCELLED", "CANCELLED", "SUCCEEDED"], "{steps:?}");
    assert!(steps[0].1.as_deref().is_some_and(|r| r.contains("conversation continued")), "{steps:?}");
    let state: String = db.query_row("SELECT state FROM missions WHERE mission_id = ?1", [&first], |r| r.get(0)).unwrap();
    assert_eq!(state, "BLOCKED", "the superseded turn must keep the state it ended in");
    let audits: i64 = db.query_row("SELECT count(*) FROM audit_events WHERE subject_id = ?1 AND detail_json LIKE '%SUPERSEDED_TURN%'", [&first], |r| r.get(0)).unwrap();
    assert_eq!(audits, 1);
}

/// المحادثة تجاوزت دورًا محجوبًا قبل هذا الإصلاح (كما في قاعدة المالك: 4 PENDING و2 INTERRUPTED). الإقلاع يغلقها مرة، ولا يمسّ
/// الدور الأخير ولو كان محجوبًا (قد يُستأنف بموافقة)، ولا يكرّر الإصلاح في إقلاع لاحق.
#[test]
fn fc_e3_boot_closes_steps_left_open_under_superseded_blocked_turns() {
    let (dir, first, second) = {
        let h = build(None);
        let first = h.ok("mission.create", json!({ "title": "e3-boot", "objective": "first" }))["mission_id"].as_str().unwrap().to_string();
        h.ok("conversation.begin", json!({ "mission_id": first }));
        let second = h.ok("conversation.continue", json!({ "mission_id": first, "message": "again" }))["mission_id"].as_str().unwrap().to_string();
        let p03 = h.host().phase03().unwrap();
        for (id, states) in [(&first, vec![TaskState::Interrupted, TaskState::Pending]), (&second, vec![TaskState::Interrupted, TaskState::Pending])] {
            let mut s = p03.repository.load(id).unwrap();
            s.graph = graph_of(id, &states);
            s.mission.root_task_id = Some(task_id(id, 0));
            s.mission.state = MissionState::Blocked;
            p03.repository.save(&s).unwrap();
        }
        (h.data_dir.clone(), first, second)
    };
    {
        let _again = build_in(dir.clone());
        let db = read_db(&dir);
        assert!(task_states(&db, &first).iter().all(|(s, _)| s == "CANCELLED"), "{:?}", task_states(&db, &first));
        assert_eq!(task_states(&db, &second).iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(), vec!["INTERRUPTED", "PENDING"], "the last turn was touched");
    }
    let _third = build_in(dir.clone());
    let audits: i64 = read_db(&dir).query_row("SELECT count(*) FROM audit_events WHERE subject_id = ?1 AND detail_json LIKE '%SUPERSEDED_TURN%'", [&first], |r| r.get(0)).unwrap();
    assert_eq!(audits, 1, "the boot repair is not idempotent");
}

// ——— E-4: صحّة المزوّد من آخر قياس

/// نداء فشل بخطأ خادم بعد تحديثٍ قال HEALTHY: الصحّة المعروضة يجب أن تكون آخر قياس (DEGRADED بخطأ الخادم، بوقت النداء)، لا
/// ذكرى التحديث. ثم نداء ناجح يعيدها HEALTHY.
#[test]
fn fc_e4_provider_health_follows_the_latest_call() {
    let h = build(Some(model_server(500)));
    let before = studio_health(&h);
    assert_eq!(before["state"], "HEALTHY", "{before}");
    let result = h.ok("model.invoke", json!({ "invocation_id": uuid(), "routing_mode": "DEFAULT_MODEL", "messages": [ { "role": "USER", "text": "hi" } ] }));
    assert_eq!(result["status"], "FAILED", "{result}");
    let after = studio_health(&h);
    assert_eq!(after["state"], "DEGRADED", "a failed call left the old health in place: {after}");
    assert_eq!(after["reason_code"], "SERVER_ERROR");
    assert!(after["checked_at"].as_str().unwrap_or_default() >= before["checked_at"].as_str().unwrap_or_default());
}

/// صحّة UNREACHABLE قديمة (من نداء قبل ساعة) والخادم عاد للعمل: النداء الجديد يعيد فحص المزوّد مرة ويُوجَّه، بدل أن يُرفض حتى
/// «تحديث» يدوي. والصحّة بعده HEALTHY.
#[test]
fn fc_e4_a_stale_unreachable_health_is_rechecked_once_before_refusing() {
    let h = build(Some(model_server(200)));
    {
        let db = rusqlite::Connection::open(h.data_dir.join("polaris.db")).unwrap();
        db.execute("UPDATE provider_health SET state = 'UNREACHABLE', reason_code = 'NETWORK_UNREACHABLE', checked_at = '2026-01-01T00:00:00Z' WHERE provider_id = 'lm-studio'", []).unwrap();
    }
    assert_eq!(studio_health(&h)["state"], "UNREACHABLE");
    let result = h.ok("model.invoke", json!({ "invocation_id": uuid(), "routing_mode": "DEFAULT_MODEL", "messages": [ { "role": "USER", "text": "hi" } ] }));
    assert_eq!(result["status"], "COMPLETED", "a recovered provider stayed refused: {result}");
    assert_eq!(studio_health(&h)["state"], "HEALTHY");
}

/// صحّة UNREACHABLE حديثة (قيست الآن) لا يُعاد فحصها عند كل نداء: الرفض فوري ولا طلب إلى المزوّد.
#[test]
fn fc_e4_a_fresh_unreachable_health_refuses_without_probing() {
    let server = model_server(200);
    let h = build(Some(server));
    let now = polaris_host_core::time::now_rfc3339_utc();
    {
        let db = rusqlite::Connection::open(h.data_dir.join("polaris.db")).unwrap();
        db.execute("UPDATE provider_health SET state = 'UNREACHABLE', reason_code = 'NETWORK_UNREACHABLE', checked_at = ?1 WHERE provider_id = 'lm-studio'", [&now]).unwrap();
    }
    let probes_before = h.model.as_ref().unwrap().recorded().len();
    let result = h.ok("model.invoke", json!({ "invocation_id": uuid(), "routing_mode": "DEFAULT_MODEL", "messages": [ { "role": "USER", "text": "hi" } ] }));
    assert_eq!(result["status"], "DENIED", "{result}");
    assert_eq!(h.model.as_ref().unwrap().recorded().len(), probes_before, "a fresh measurement was re-probed");
}

// ——— T-8: الميزانية حين لا يبلّغ المزوّد الاستعمال

/// خادم يبثّ ردًّا بلا `usage` — TEST FIXTURE.
fn silent_usage_server() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/v1/chat/completions" => Reply::Stream {
            content_type: "text/event-stream",
            parts: vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": "ok" } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ] })),
                "data: [DONE]\n\n".to_string(),
            ],
            gap: Duration::ZERO,
        },
        _ => Reply::Json(404, "{}".into()),
    }))
}

fn invoke(h: &p08_support::Harness, max_output: u64) -> Value {
    h.ok("model.invoke", json!({ "invocation_id": uuid(), "routing_mode": "DEFAULT_MODEL", "max_output_tokens": max_output, "messages": [ { "role": "USER", "text": "hello there" } ] }))
}

/// نداء بلغ المزوّد ولم يبلّغ الاستعمال: سجلّ الاستعمال يحمل حدًّا أعلى مُقدَّرًا موسومًا ESTIMATED (تقدير المدخلات المحلي وسقف
/// المخرجات المحجوز)، لا صفرًا ولا رقمًا يُعرض مقيسًا. وملخّص اليوم لا يعدّه رموزًا مُبلَّغًا عنها.
#[test]
fn fc_t8_an_unreported_call_is_recorded_as_an_estimated_upper_bound() {
    let h = build(Some(silent_usage_server()));
    let result = invoke(&h, 100);
    assert_eq!(result["status"], "COMPLETED", "{result}");
    let db = read_db(&h.data_dir);
    let (provenance, input, output): (String, Option<i64>, Option<i64>) = db
        .query_row("SELECT token_provenance, input_tokens, output_tokens FROM usage_records WHERE category = 'MODEL' ORDER BY recorded_at DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!(provenance, "ESTIMATED", "an unreported call left no bound on the ledger");
    assert!(input.unwrap_or(0) > 0, "{input:?}");
    assert_eq!(output, Some(100), "the reserved output ceiling is the upper bound");
    let summary = h.ok("usage.summary", json!({}));
    assert_eq!(summary["today"]["input_tokens_reported"], 0, "an estimate was shown as reported: {summary}");
    assert_eq!(summary["today"]["calls_without_reported_tokens"], 1, "{summary}");
}

/// ميزانية رموز صلبة لمزوّد لا يبلّغ الاستعمال: قبل الإصلاح لا يُحسب شيء فلا تُلزم أبدًا. بعده يُحسب الحدّ الأعلى المقدَّر، فيُرفض
/// النداء الذي يتجاوزه.
#[test]
fn fc_t8_a_hard_token_budget_binds_when_the_provider_reports_no_usage() {
    let h = build(Some(silent_usage_server()));
    h.ok("budget.set", json!({ "scope": "PROVIDER", "scope_key": "lm-studio", "dimension": "MODEL_TOKENS", "limit": 250, "mode": "HARD" }));
    assert_eq!(invoke(&h, 100)["status"], "COMPLETED");
    let second = h.call("model.invoke", json!({ "invocation_id": uuid(), "routing_mode": "DEFAULT_MODEL", "max_output_tokens": 100, "messages": [ { "role": "USER", "text": "hello there" } ] }));
    let third = h.call("model.invoke", json!({ "invocation_id": uuid(), "routing_mode": "DEFAULT_MODEL", "max_output_tokens": 100, "messages": [ { "role": "USER", "text": "hello there" } ] }));
    // سبب الرفض لا يعبر الحدّ (رمز السياسة وحده)، فيُقرأ من التدقيق: حدث تجاوز الميزانية لنداء نموذج.
    let denied = [&second, &third].iter().any(|r| r.get("error").is_some_and(|e| e["code"] == "POLICY_DENIED" && e["pointer"] == "/payload/invocation"));
    assert!(denied, "the hard token budget never bound on unreported calls: {second} / {third}");
    let exceeded: i64 = read_db(&h.data_dir).query_row("SELECT count(*) FROM audit_events WHERE event_type = 'BUDGET_EXCEEDED' AND detail_json LIKE '%MODEL_CALL%'", [], |r| r.get(0)).unwrap();
    assert!(exceeded >= 1, "the refusal was not recorded as a budget refusal");
}
