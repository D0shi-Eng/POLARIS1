// اختبارات تكليف الإصلاح 2026-10-12 (سجلّ الإصلاح: docs/remediation/REMEDIATION-REGISTER.md).
//
// كُتبت هذه الاختبارات قبل الإصلاح على الشجرة عند `4f3723a` مع تغييراتها المحلية، وشُغّلت أولًا لحفظ فشلها (الدليل الأحمر) في
// evidence/remediation-2026-10-12/runs/red/. كل اختبار يقيس نتيجة خارجية (ما يُحفظ في المخزن، أو ما تعيده IPC، أو ما يُحسم في
// المهمّة)، ولا يعيد منطق التنفيذ نفسه. التجهيزات (نموذج مُبرمَج، خادم نموذج على الحلقة المحلية) TEST FIXTURE لا نموذج حقيقي.

mod p08_support;
mod s2_support;

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use p08_support::build;
use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::agent::{AgentInstance, AgentRegistry, AgentRole};
use polaris_host_core::p03::claim::{Claim, ClaimStatus, ClaimType};
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::evidence::{EvidenceItem, EvidenceType, MeasurementKind, Provenance};
use polaris_host_core::p03::graph::TaskGraph;
use polaris_host_core::p03::message::{AgentMessage, MessageType, Recipient};
use polaris_host_core::p03::mission::{CompletionProofStatus, MissionRequirement, MissionState, RequirementStatus};
use polaris_host_core::p03::model_fixture::{FixtureModel, FixtureScenario, FixtureTrustedEvidence};
use polaris_host_core::p03::runtime::{MissionRuntime, ReviewRecord};
use polaris_host_core::p03::task::{TaskNode, TaskState, TaskType};
use polaris_host_core::p03::trust::{AuthorityClass, Taint};
use polaris_host_core::p03::watch::session::{rebuild, ChainCheck, SessionDraft, SessionEvent, SessionKind, SessionLog, SqliteSessionLog};
use polaris_host_core::storage::Database;
use s2_support::{calls, ok, text, LoopModel, World};

// ——— تجهيزات مشتركة

/// خادم نموذج بصيغة LM Studio يجيب كل طلب بنصّ قصير بلا أدوات — TEST FIXTURE.
fn text_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/v1/chat/completions" => Reply::Stream {
            content_type: "text/event-stream",
            parts: vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": "تمّ." } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 40, "completion_tokens": 3 } })),
                "data: [DONE]\n\n".to_string(),
            ],
            gap: Duration::ZERO,
        },
        _ => Reply::Json(404, "{}".into()),
    }))
}

/// معرّف خطوة بصيغة UUID (عقد العرض يشترطها) مشتقّ حتميًّا من المهمّة ورقم الخطوة.
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

fn measured(id: &str, mission_id: &str, summary: &str) -> EvidenceItem {
    EvidenceItem {
        evidence_id: id.into(),
        mission_id: mission_id.into(),
        evidence_type: EvidenceType::ToolResult,
        created_at: "2026-10-12T00:00:00Z".into(),
        digest: "d".into(),
        provenance: Provenance {
            producer: "polaris.tool/polaris.workspace.write".into(),
            authority: AuthorityClass::TrustedRuntimeFact,
            source_ref: format!("tool:{id}"),
            lineage: vec![format!("tool:{id}")],
            measurement_kind: MeasurementKind::Measured,
        },
        taint: Taint::clean(),
        summary: summary.into(),
    }
}

// ——— R-01: الاستئناف لا يمحو سجلّات الإثبات السابقة

/// مهمّة تنتظر موافقة وفي مخزنها وكيل وادّعاء محقَّق ودليل ومراجعة ورسالة. استئنافها عبر IPC (`mission.start`) يجب ألا يمحو أيًّا
/// منها: الإصلاح يستعيد اللقطة كاملة بدل الرسم وحده.
#[test]
fn r01_resume_through_ipc_keeps_prior_proof_records() {
    let h = build(Some(text_model()));
    let id = h.ok("mission.create", json!({ "title": "r01", "objective": "hello", "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let p03 = h.host().phase03().unwrap();
    let mut s = p03.repository.load(&id).unwrap();
    s.graph = graph_of(&id, &[TaskState::Waiting]);
    s.mission.root_task_id = Some(task_id(&id, 0));
    s.mission.state = MissionState::WaitingForApproval;
    s.agents.push(AgentInstance::new("agent-prior", &id, AgentRole::Builder, "2026-10-12T00:00:00Z"));
    s.evidence.push(measured("ev-prior", &id, "SUCCEEDED — wrote outputs/a.md (3 bytes) [TRUSTED_RUNTIME]"));
    let mut claim = Claim::from_agent("claim-prior", &id, "agent-prior", "outputs/a.md exists", ClaimType::Result, Taint::clean(), "2026-10-12T00:00:00Z");
    claim.status = ClaimStatus::Verified;
    claim.evidence_refs = vec!["ev-prior".into()];
    s.claims.push(claim);
    s.reviews.push(ReviewRecord {
        review_id: "review-prior".into(),
        task_id: task_id(&id, 0),
        reviewer_agent: "agent-prior".into(),
        verdict: "ACCEPT",
        independence: "SAME_MODEL_REVIEW",
        round: 1,
        notes: "ok".into(),
        created_at: "2026-10-12T00:00:00Z".into(),
    });
    s.messages.push(AgentMessage {
        message_id: "msg-prior".into(),
        mission_id: id.clone(),
        sender_agent_id: "agent-prior".into(),
        recipient: Recipient::Coordinator,
        message_type: MessageType::CompletionNotice,
        created_at: "2026-10-12T00:00:00Z".into(),
        causation_id: None,
        correlation_id: None,
        payload: "done".into(),
        taint: Taint::clean(),
        authority: AuthorityClass::AgentMessage,
    });
    p03.repository.save(&s).unwrap();

    let _ = h.call("mission.start", json!({ "mission_id": id }));

    let after = p03.repository.load(&id).unwrap();
    assert!(after.claims.iter().any(|c| c.claim_id == "claim-prior"), "resume erased a prior claim: {:?}", after.claims.iter().map(|c| &c.claim_id).collect::<Vec<_>>());
    assert!(after.evidence.iter().any(|e| e.evidence_id == "ev-prior"), "resume erased prior evidence");
    assert!(after.agents.iter().any(|a| a.agent_id == "agent-prior"), "resume erased a prior agent identity");
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let count = |sql: &str| -> i64 { db.query_row(sql, rusqlite::params![id], |r| r.get(0)).unwrap() };
    assert_eq!(count("SELECT count(*) FROM reviews WHERE mission_id = ?1 AND review_id = 'review-prior'"), 1, "resume erased a prior review");
    assert_eq!(count("SELECT count(*) FROM agent_messages WHERE mission_id = ?1 AND message_id = 'msg-prior'"), 1, "resume erased a prior agent message");
}

// ——— R-02: ادّعاء محقَّق واحد لا يُشبع متطلَّبات لا تخصّه

/// ادّعاءات محقَّقة عن حالة خطوات (موضوعها نوع الخطوة) لا تقول شيئًا عن متطلَّب «الإجماليات صحيحة». قبل الإصلاح يُربط كل متطلَّب
/// بلا `claim_ref` بأول ادّعاء محقَّق، فتصير المهمّة PROVEN.
#[test]
fn r02_a_verified_claim_does_not_satisfy_unrelated_requirements() {
    let mut mission = s2_support::mission("produce a report with correct totals");
    mission.requirements = vec![
        MissionRequirement::new("req-file", "outputs/report.csv exists", "p03.rule.fact", true),
        MissionRequirement::new("req-totals", "the totals in outputs/report.csv are correct", "p03.rule.fact", true),
    ];
    let mut rt = MissionRuntime::new(mission, RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_trusted_evidence(Arc::new(FixtureTrustedEvidence::runtime_measurement()));
    let report = rt.run(&FixtureModel::new(FixtureScenario::MultiAgentVerified));
    assert!(rt.claims().iter().any(|c| c.status == ClaimStatus::Verified), "precondition: the fixture produced no verified claim");
    let totals = rt.mission().requirements.iter().find(|r| r.requirement_id == "req-totals").unwrap();
    assert_ne!(totals.status, RequirementStatus::Satisfied, "an unrelated verified claim satisfied the totals requirement (claim_ref {:?})", totals.claim_ref);
    assert_ne!(report.completion_proof.status, CompletionProofStatus::Proven, "a mission was PROVEN by claims about other subjects");
}

/// ملف صحيح البنية بإجمالي خاطئ: العقد يقيس وجود الملف وصيغته فقط. المطلوب ألا تصبح المهمّة PROVEN ما دام المحتوى المطلوب
/// (الإجمالي) لم يتحقّق منه مصحِّح.
#[test]
fn r02_a_valid_file_with_wrong_content_is_not_proven() {
    let world = World::new().with_file("inputs/sales.csv", "amount\n10\n20\n30\n");
    let mut rt = world.runtime("Read inputs/sales.csv and write outputs/total.csv containing the total of the amount column.", ok);
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/total.csv", "content": "total\n999\n" }))])))
        .then(|_| Ok(text("Wrote outputs/total.csv with the total.")));
    let report = rt.run(&model);
    assert_ne!(report.completion_proof.status, CompletionProofStatus::Proven, "a structurally valid file with a wrong total was PROVEN: {:?}", report.completion_proof);
}

// ——— R-03: الإثبات المقروء يطابق المحفوظ

/// مهمّة أُلغيت ومتطلَّبها مستوفى: المحفوظ NOT_PROVEN (الإلغاء لا يُثبت). القراءة عبر IPC يجب أن تعيد الحكم نفسه، لا أن تعيد
/// اشتقاقه بلا حواجز فتعرض PROVEN.
#[test]
fn r03_read_proof_matches_the_saved_proof_for_a_cancelled_mission() {
    let h = build(None);
    let id = h.ok("mission.create", json!({ "title": "r03", "objective": "hello" }))["mission_id"].as_str().unwrap().to_string();
    let p03 = h.host().phase03().unwrap();
    let mut s = p03.repository.load(&id).unwrap();
    s.graph = graph_of(&id, &[TaskState::Cancelled]);
    s.mission.root_task_id = Some(task_id(&id, 0));
    s.mission.state = MissionState::Cancelled;
    s.mission.completion_proof_status = CompletionProofStatus::NotProven;
    s.evidence.push(measured("e0000000-0000-4000-8000-000000000003", &id, "SUCCEEDED — wrote outputs/a.md [TRUSTED_RUNTIME]"));
    let mut claim = Claim::from_agent("c0000000-0000-4000-8000-000000000003", &id, "polaris.runtime", "outputs/a.md exists", ClaimType::RequirementSatisfaction, Taint::clean(), "2026-10-12T00:00:00Z");
    claim.status = ClaimStatus::Verified;
    claim.evidence_refs = vec!["e0000000-0000-4000-8000-000000000003".into()];
    s.claims.push(claim);
    let mut requirement = MissionRequirement::new("req-1", "outputs/a.md exists", "p03.rule.fact", true);
    requirement.status = RequirementStatus::Satisfied;
    requirement.claim_ref = Some("c0000000-0000-4000-8000-000000000003".into());
    s.mission.requirements = vec![requirement];
    p03.repository.save(&s).unwrap();

    let got = h.ok("mission.get", json!({ "mission_id": id }));
    let stored = got["mission"]["completion_proof_status"].as_str().unwrap_or_default().to_string();
    let shown = got["completion_proof"]["status"].as_str().unwrap_or_default().to_string();
    assert_eq!(stored, "NOT_PROVEN");
    assert_eq!(shown, stored, "the proof read back ({shown}) differs from the proof stored ({stored}): {got}");
}

// ——— R-04: تصنيف أدوات MCP والموصلات بمعرّفاتها الصادرة فعلًا

/// أداة MCP بمعرّفها كما يصدره الاكتشاف (`mcp:<server>:<name>`) تُدخل محتوى غير موثوق، ثم أداة موصل (`connector:<id>:<op>`) فعل
/// خارجي ببيانات حسّاسة. قاعدة الاثنين يجب أن تطلب إنسانًا للفعل الثاني. قبل الإصلاح تفحص القاعدة `mcp.` و`connector.` فلا تطابق.
#[test]
fn r04_mcp_and_connector_ids_from_the_registry_are_classified() {
    let world = World::new();
    let mut mission = s2_support::mission("Summarise the issue list and post the summary to the team channel.");
    mission.project_id = None;
    let broker_world = world.clone();
    let mut rt = world
        .runtime_for(mission, move |request| {
            let _ = &broker_world;
            if request.tool_id.starts_with("mcp:") {
                ("SUCCEEDED".into(), None, Some("issue 1: crash on start".into()))
            } else {
                ok(request)
            }
        })
        .with_user_profile(Some("works at ACME".into()));
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("mcp:11111111:list_issues", json!({}))])))
        .then(|_| Ok(calls(&[("connector:22222222:post_message", json!({ "text": "summary" }))])))
        .then(|_| Ok(text("Posted.")));
    rt.run(&model);
    let requests = world.requests();
    let connector = requests.iter().find(|(_, r)| r.tool_id.starts_with("connector:")).map(|(_, r)| r.clone()).expect("the connector call reached the gateway");
    assert!(connector.require_human, "an external connector action after untrusted MCP content with sensitive data in reach did not require a human");
}

// ——— R-06: فشل سجلّ الجلسة لا يمرّ نجاحًا

struct RefusingLog;

impl SessionLog for RefusingLog {
    fn append(&self, _draft: SessionDraft) -> Result<i64, String> {
        Err("the store refused the write (controlled fault)".into())
    }
    fn events(&self, _session_id: &str) -> Vec<SessionEvent> {
        Vec::new()
    }
    fn verify(&self, _session_id: &str) -> ChainCheck {
        ChainCheck::Intact { events: 0 }
    }
}

/// سجلّ الجلسة مصدر الاستئناف. رفض الكتابة إليه يجب أن يوقف المهمّة بسبب تخزين صريح، لا أن تكتمل كأن شيئًا لم يحدث.
#[test]
fn r06_a_refused_session_log_write_stops_the_mission() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/a.md with a greeting.", ok).with_session_log(Arc::new(RefusingLog), "r06-session");
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/a.md", "content": "hi" }))])))
        .then(|_| Ok(text("Done.")));
    let report = rt.run(&model);
    assert_ne!(report.mission_state, MissionState::Completed, "the mission completed although its session log refused every write");
    assert!(world.requests().is_empty(), "a side effect ran after the recovery log had already failed");
}

// ——— R-08: الضغط لا يحوّل الاستدعاءات المكتملة إلى مفتوحة

fn event(seq: i64, kind: SessionKind, payload: Value) -> SessionEvent {
    SessionEvent { session_id: "s".into(), seq, mission_id: "m".into(), kind, authority: "MODEL_GENERATED".into(), parent_seq: None, payload, created_at: "t".into() }
}

/// استدعاء اكتمل بنتيجة SUCCEEDED ثم غطّاه ملخّص: يجب ألا يُعاد بوصفه مفتوحًا (فيُعطى INTERRUPTED بعد الاستئناف). واستدعاء ينتظر
/// موافقة واستدعاء بلا نتيجة يبقيان مفتوحين بعد الملخّص.
#[test]
fn r08_a_summary_does_not_reopen_completed_calls() {
    let mut summary = event(7, SessionKind::Summary, json!({ "text": "earlier work summarised" }));
    summary.parent_seq = Some(6);
    let events = vec![
        event(1, SessionKind::UserMessage, json!({ "text": "go" })),
        event(2, SessionKind::AssistantMessage, json!({ "text": "", "tool_calls": [{ "id": "done-1", "name": "write_file", "arguments": "{}" }] })),
        event(3, SessionKind::ToolResult, json!({ "call_id": "done-1", "status": "SUCCEEDED", "text": "ok" })),
        event(4, SessionKind::AssistantMessage, json!({ "text": "", "tool_calls": [{ "id": "wait-1", "name": "run_command", "arguments": "{}" }] })),
        event(5, SessionKind::ToolResult, json!({ "call_id": "wait-1", "status": "AWAITING_APPROVAL", "text": "status: AWAITING_APPROVAL" })),
        event(6, SessionKind::AssistantMessage, json!({ "text": "", "tool_calls": [{ "id": "lost-1", "name": "read_file", "arguments": "{}" }] })),
        summary,
    ];
    let rebuilt = rebuild(&events);
    let open: Vec<&str> = rebuilt.open_calls.iter().map(|c| c.call_id.as_str()).collect();
    assert!(!open.contains(&"done-1"), "a call that completed before the summary was treated as open: {open:?}");
    assert!(open.contains(&"wait-1"), "the call awaiting approval was lost by the summary: {open:?}");
    assert!(open.contains(&"lost-1"), "the call without any result was lost by the summary: {open:?}");
}

// ——— R-09: الحدث الكبير يحتفظ ببنيته

/// حدث ردّ وكيل يحمل استدعاءين ونصًّا عربيًّا أكبر من حدّ الحمولة. بعد القصّ يجب أن تبقى الاستدعاءات بمعرّفاتها وأسمائها، وأن
/// يُذكر القصّ مع بصمة الأصل.
#[test]
fn r09_a_large_event_keeps_its_structure_when_clipped() {
    let db = Arc::new(Database::in_memory().unwrap());
    let log = SqliteSessionLog::new(db);
    let big = "نصّ عربي طويل ".repeat(30_000);
    let payload = json!({
        "text": big,
        "tool_calls": [
            { "id": "call-a", "name": "write_file", "arguments": json!({ "path": "outputs/a.md", "content": "x".repeat(200_000) }).to_string(), "task_id": "t1", "tool_id": "polaris.workspace.write" },
            { "id": "call-b", "name": "read_file", "arguments": "{\"path\":\"inputs/b.md\"}", "task_id": "t1", "tool_id": "polaris.workspace.read" }
        ]
    });
    log.append(SessionDraft { session_id: "r09".into(), mission_id: "m".into(), kind: SessionKind::AssistantMessage, authority: AuthorityClass::ModelGenerated, payload, parent_seq: None }).unwrap();
    let events = log.events("r09");
    let stored = &events[0].payload;
    let calls = stored.get("tool_calls").and_then(Value::as_array).cloned().unwrap_or_default();
    assert_eq!(calls.len(), 2, "clipping dropped the tool calls: {}", stored.to_string().chars().take(300).collect::<String>());
    assert_eq!(calls[0]["id"], "call-a");
    assert_eq!(calls[1]["id"], "call-b");
    assert_eq!(calls[1]["tool_id"], "polaris.workspace.read");
    assert!(matches!(log.verify("r09"), ChainCheck::Intact { .. }));
    let rebuilt = rebuild(&events);
    assert_eq!(rebuilt.open_calls.len(), 2, "the clipped calls are not recognised as calls any more");
}

// ——— الدفعة الثانية: اختبارات كُتبت مع الإصلاح (لا دليل أحمر قبله: الواجهات التي تقيسها لم تكن موجودة، والسلوك القديم مثبت
// ساكنًا في سجلّ الإصلاح بموضعه).

use std::sync::Mutex;

use polaris_host_core::p03::mission::MissionBudget;
use polaris_host_core::p03::port::{CallFacts, ToolRequest};
use polaris_host_core::p03::repository::{MissionRepository, MissionSnapshot};
use polaris_host_core::p03::runtime::RunCheckpoint;
use polaris_host_core::p03::watch::monitor::{ActionMonitor, MonitorInput, MonitorVerdict};
use polaris_host_core::p03::watch::spans::{MemorySpans, SpanRecord, SpanSink};
use polaris_host_providers::net::CancelToken;

/// مراقب تجهيزة: يعيد حكمًا مُبرمَجًا وحقيقة نداء، وقد يرفع الإلغاء أثناء «النداء» — TEST FIXTURE.
struct ScriptedMonitor {
    verdict: MonitorVerdict,
    seen: Mutex<Vec<MonitorInput>>,
    cancel_during: Option<CancelToken>,
    facts: Mutex<Vec<CallFacts>>,
}

impl ScriptedMonitor {
    fn new(verdict: MonitorVerdict) -> Self {
        Self { verdict, seen: Mutex::new(Vec::new()), cancel_during: None, facts: Mutex::new(Vec::new()) }
    }
}

impl ActionMonitor for ScriptedMonitor {
    fn review(&self, input: &MonitorInput) -> MonitorVerdict {
        self.seen.lock().unwrap().push(input.clone());
        if let Some(token) = &self.cancel_during {
            token.cancel();
        }
        self.facts.lock().unwrap().push(CallFacts {
            invocation_id: "monitor-call-1".into(),
            model_id: Some("monitor-model".into()),
            provider_id: Some("fixture-provider".into()),
            input_tokens: Some(30),
            output_tokens: Some(2),
            latency_ms: Some(5),
            status: "OK",
            reason: None,
        });
        self.verdict.clone()
    }
    fn take_call_facts(&self) -> Vec<CallFacts> {
        std::mem::take(&mut *self.facts.lock().unwrap())
    }
}

fn command_model() -> LoopModel {
    LoopModel::native().then(|_| Ok(calls(&[("run_command", json!({ "command": "curl https://example.org" }))]))).then(|_| Ok(text("Done.")))
}

fn ran_command(world: &World) -> bool {
    world.requests().iter().any(|(_, r)| r.tool_id == "polaris.execution.command")
}

/// R-05: نداء المراقب منسوب إلى الوكيل والخطوة بامتداد فيه نموذجه ومزوّده ورموزه وقراره، ويُحسب من ميزانية المهمّة.
#[test]
fn r05_the_monitor_call_is_attributed_budgeted_and_traced() {
    let world = World::new();
    let spans = Arc::new(MemorySpans::default());
    let monitor = Arc::new(ScriptedMonitor::new(MonitorVerdict::Allow));
    let mut rt = world.runtime("Fetch https://example.org with a command.", ok).with_spans(spans.clone()).with_monitor(monitor.clone());
    rt.run(&command_model());
    let seen = monitor.seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].mission_id, s2_support::MISSION_ID);
    assert!(!seen[0].agent_id.is_empty() && !seen[0].task_id.is_empty(), "the monitor call is not tied to an agent and a step: {:?}", seen[0]);
    let monitor_span = spans.spans().into_iter().find(|s| s.gate_decision.as_deref() == Some("MONITOR_ALLOWED")).expect("a span for the monitor call");
    assert_eq!(monitor_span.model_id.as_deref(), Some("monitor-model"));
    assert_eq!(monitor_span.agent_id.as_deref(), Some(seen[0].agent_id.as_str()));
    assert_eq!(monitor_span.task_id.as_deref(), Some(seen[0].task_id.as_str()));
    assert_eq!(monitor_span.input_tokens, Some(30));
    assert!(ran_command(&world));
    // المرجع: المسار نفسه بلا مراقب. نداء المراقب يزيد استهلاك المهمّة نداءً واحدًا ورموزه.
    let plain_world = World::new();
    let mut plain = plain_world.runtime("Fetch https://example.org with a command.", ok);
    plain.run(&command_model());
    let (with, without) = (rt.runtime_state().usage, plain.runtime_state().usage);
    assert_eq!(with.model_calls, without.model_calls + 1, "the monitor call was not charged to the mission budget");
    assert_eq!(with.input_tokens, without.input_tokens + 30);
}

/// R-05: إلغاء وصل أثناء نداء المراقب يسود حكمه ولو كان سماحًا: الفعل لا ينفَّذ.
#[test]
fn r05_cancel_during_the_monitor_call_runs_nothing() {
    let world = World::new();
    let token = CancelToken::new();
    let mut monitor = ScriptedMonitor::new(MonitorVerdict::Allow);
    monitor.cancel_during = Some(token.clone());
    let mut rt = world.runtime("Fetch https://example.org with a command.", ok).with_cancel(token).with_monitor(Arc::new(monitor));
    let report = rt.run(&command_model());
    assert!(!ran_command(&world), "a call ran after a cancel that arrived during its monitor review");
    assert_eq!(report.mission_state, MissionState::Cancelled);
}

/// R-05: ميزانية النداءات نفدت قبل المراقب: لا يُنادى، والفعل يُمنع بسبب «لا حكم» صريح.
#[test]
fn r05_an_exhausted_budget_never_calls_the_monitor_and_never_runs_the_action() {
    let world = World::new();
    let monitor = Arc::new(ScriptedMonitor::new(MonitorVerdict::Allow));
    let mut mission = s2_support::mission("Fetch https://example.org with a command.");
    mission.budget = MissionBudget { max_model_calls: 1, ..MissionBudget::extended() };
    let mut rt = world.runtime_for(mission, ok).with_monitor(monitor.clone());
    rt.run(&command_model());
    assert!(monitor.seen.lock().unwrap().is_empty(), "the monitor was called with no budget left");
    assert!(!ran_command(&world), "the action ran without a monitor decision");
    assert!(rt.security_events().iter().any(|e| e.kind == "MONITOR_UNAVAILABLE" && e.detail.contains("BUDGET_EXHAUSTED")), "{:?}", rt.security_events());
}

/// R-05: ردّ ملتبس، وتعذّر المزوّد، ونموذج غير مختار: كلٌّ يمنع الفعل بسببه الدقيق.
#[test]
fn r05_unclear_and_unavailable_verdicts_block_with_their_own_reason() {
    for (verdict, code) in [
        (MonitorVerdict::Unclear("the monitor gave no clear verdict".into()), "MONITOR_UNCLEAR"),
        (MonitorVerdict::Unavailable("PROVIDER_UNAVAILABLE".into()), "MONITOR_UNAVAILABLE"),
        (MonitorVerdict::Unavailable("MODEL_DENIED: MODEL_NOT_SELECTED".into()), "MONITOR_UNAVAILABLE"),
        (MonitorVerdict::Block("not requested".into()), "MONITOR_BLOCKED"),
    ] {
        let world = World::new();
        let mut rt = world.runtime("Fetch https://example.org with a command.", ok).with_monitor(Arc::new(ScriptedMonitor::new(verdict.clone())));
        rt.run(&command_model());
        assert!(!ran_command(&world), "{verdict:?} let the action run");
        assert!(rt.security_events().iter().any(|e| e.kind == code), "{verdict:?}: {:?}", rt.security_events());
    }
}

// ——— R-06: نقطة الاستئناف والامتدادات

struct RefusingCheckpoint;

impl RunCheckpoint for RefusingCheckpoint {
    fn save(&self, _snapshot: &MissionSnapshot) -> Result<(), String> {
        Err("database is locked (controlled fault)".into())
    }
}

/// نقطة الاستئناف لا تُكتب: المسار يقف بسبب تخزين قبل أي أداة.
#[test]
fn r06_a_refused_checkpoint_stops_before_any_side_effect() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/a.md with a greeting.", ok).with_checkpoint(Arc::new(RefusingCheckpoint));
    let model = LoopModel::native().then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/a.md", "content": "hi" }))]))).then(|_| Ok(text("Done.")));
    let report = rt.run(&model);
    assert!(world.requests().is_empty(), "a tool ran after the checkpoint could not be written");
    assert!(format!("{:?}", report.stop_reason).contains("StorageFailure"), "{:?}", report.stop_reason);
    assert_ne!(report.mission_state, MissionState::Completed);
}

struct RefusingSpans;

impl SpanSink for RefusingSpans {
    fn record(&self, _span: &SpanRecord) -> Result<(), String> {
        Err("disk I/O error (controlled fault)".into())
    }
}

/// سياسة التتبّع: فشل كتابة الامتدادات لا يوقف المهمّة، لكنه يُعدّ ويُحفظ ويُبلَّغ مرّة.
#[test]
fn r06_span_write_failures_are_counted_and_reported_but_do_not_stop_the_mission() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/a.md with a greeting.", ok).with_spans(Arc::new(RefusingSpans));
    let model = LoopModel::native().then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/a.md", "content": "hi" }))]))).then(|_| Ok(text("Done.")));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert!(rt.runtime_state().telemetry_failures >= 3, "{}", rt.runtime_state().telemetry_failures);
    assert_eq!(rt.security_events().iter().filter(|e| e.kind == "TELEMETRY_WRITE_FAILED").count(), 1);
}

/// عطل مخزن حقيقي ومضبوط (مشغّل SQLite يرفض الإلحاق بسجلّ الجلسة) عبر IPC: المهمّة لا تكتمل، وسبب التوقّف STORAGE_FAILURE
/// يعبر عقد العرض.
#[test]
fn r06_a_real_sqlite_write_fault_in_the_session_log_surfaces_as_a_storage_failure() {
    let h = build(Some(text_model()));
    let id = h.ok("mission.create", json!({ "title": "r06", "objective": "hello", "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    {
        let db = rusqlite::Connection::open(h.data_dir.join("polaris.db")).unwrap();
        db.execute_batch("CREATE TRIGGER r06_refuse BEFORE INSERT ON session_events WHEN NEW.kind <> 'HOST_NOTE' BEGIN SELECT RAISE(ABORT, 'r06 controlled fault'); END;").unwrap();
    }
    let started = h.call("mission.start", json!({ "mission_id": id }));
    let got = h.ok("mission.get", json!({ "mission_id": id }));
    assert_ne!(got["mission"]["state"], "COMPLETED", "{got}");
    let reason = got["mission"]["failure_reason"].as_str().unwrap_or_default().to_string();
    assert!(reason.starts_with("STORAGE_FAILURE"), "failure reason: {reason}; start: {started}");
}

// ——— R-07: الاستئناف لا يمنح ميزانية جديدة ولا يعيد فتح مسار أوقفه رفض متكرّر؛ والهوية تبقى

/// تشغيل أول: رفضان للنمط نفسه ثم أداة تنتظر موافقة. حفظ واسترجاع من مخزن حقيقي، ثم استئناف: الرفض الثالث للنمط يوقف المسار،
/// والاستهلاك تراكمي، ووكيل الجذر بمعرّفه نفسه.
#[test]
fn r07_resume_keeps_cumulative_budget_denials_flags_and_identity() {
    let world = World::new();
    let decide = |request: &ToolRequest| -> (String, Option<String>, Option<String>) {
        match request.tool_id.as_str() {
            "polaris.execution.command" => ("DENIED".into(), Some("POLICY_DENIED".into()), None),
            "polaris.execution.python" => ("AWAITING_APPROVAL".into(), None, None),
            _ => ("SUCCEEDED".into(), None, Some("ok".into())),
        }
    };
    let mut first = world.runtime("Fetch the page, then sum numbers with Python.", decide).with_user_profile(Some("confidential".into()));
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("run_command", json!({ "command": "curl a" }))])))
        .then(|_| Ok(calls(&[("run_command", json!({ "command": "curl b" }))])))
        .then(|_| Ok(calls(&[("run_python", json!({ "code": "print(1)" }))])));
    let report = first.run(&model);
    assert_eq!(report.mission_state, MissionState::WaitingForApproval, "{:?}", report.stop_reason);
    let calls_before = first.runtime_state().usage.model_calls;
    let root_agent = first.agents().first().map(|a| a.agent_id.clone()).unwrap();

    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db);
    repo.save(&first.snapshot()).unwrap();
    let loaded = repo.load(s2_support::MISSION_ID).unwrap();
    assert_eq!(loaded.runtime.usage.model_calls, calls_before);
    assert!(loaded.runtime.sensitive_data);

    let mut resumed = world.runtime_for(loaded.mission.clone(), decide).resume_from(&loaded);
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("run_command", json!({ "command": "curl c" }))])))
        .then(|_| Ok(calls(&[("run_command", json!({ "command": "curl d" }))])))
        .then(|_| Ok(text("Gave up.")));
    let report = resumed.run(&model);
    assert!(format!("{:?}", report.stop_reason).contains("RepeatedDenials"), "the third denial of the same pattern after a resume did not stop the loop: {:?}", report.stop_reason);
    let commands = world.requests().iter().filter(|(_, r)| r.tool_id == "polaris.execution.command").count();
    assert_eq!(commands, 3, "the resume reopened a path the earlier denials had counted");
    assert!(resumed.runtime_state().usage.model_calls > calls_before, "the call count restarted from zero");
    assert_eq!(resumed.agents().iter().filter(|a| a.current_task_id == first.agents()[0].current_task_id).count(), 1, "a resume created a second root agent: {:?}", resumed.agents());
    assert!(resumed.agents().iter().any(|a| a.agent_id == root_agent), "the root agent identity changed across the resume");
    assert_eq!(resumed.runtime_state().runs, 2);
}

/// R-07: حدّ الوقت تراكمي: زمن التشغيلات السابقة يُحسب.
#[test]
fn r07_the_wall_clock_budget_is_cumulative_across_resumes() {
    let world = World::new();
    let mut mission = s2_support::mission("Write outputs/a.md.");
    mission.budget = MissionBudget { max_wall_clock_ms: 1_000, ..MissionBudget::extended() };
    let mut snapshot = world.runtime_for(mission.clone(), ok).snapshot();
    snapshot.runtime.elapsed_ms = 5_000;
    let mut rt = world.runtime_for(mission, ok).resume_from(&snapshot);
    let report = rt.run(&LoopModel::native().then(|_| Ok(text("Done."))));
    assert!(format!("{:?}", report.stop_reason).contains("BudgetExhausted"), "a resume granted a fresh time budget: {:?}", report.stop_reason);
}

// ——— R-03 عبر IPC بعد تشغيل حقيقي للمسار

/// مهمّة تكتمل عبر IPC: الإثبات المعروض يطابق المحفوظ، قبل إعادة فتح المضيف وبعدها.
#[test]
fn r03_the_proof_shown_equals_the_proof_saved_across_a_restart() {
    let data_dir;
    let id;
    let before;
    {
        let h = build(Some(text_model()));
        data_dir = h.data_dir.clone();
        id = h.ok("mission.create", json!({ "title": "r03b", "objective": "hello", "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
        h.ok("conversation.begin", json!({ "mission_id": id }));
        let started = h.ok("mission.start", json!({ "mission_id": id }));
        let got = h.ok("mission.get", json!({ "mission_id": id }));
        assert_eq!(got["completion_proof"]["status"], got["mission"]["completion_proof_status"], "{got}");
        assert_eq!(got["completion_proof"]["status"], started["completion_proof"]["status"], "start returned {} and get shows {}", started["completion_proof"]["status"], got["completion_proof"]["status"]);
        before = got["completion_proof"].clone();
    }
    let h = p08_support::build_in(data_dir);
    let after = h.ok("mission.get", json!({ "mission_id": id }));
    assert_eq!(after["completion_proof"], before, "the proof read after a restart differs");
}

// ——— مرساة نهاية سجلّ الجلسة والترحيل إلى v18

fn append(log: &SqliteSessionLog, session: &str, text: &str) {
    log.append(SessionDraft { session_id: session.into(), mission_id: "m".into(), kind: SessionKind::UserMessage, authority: AuthorityClass::DirectUserInstruction, payload: json!({ "text": text }), parent_seq: None }).unwrap();
}

/// حذف آخر حدث يترك سلسلة سليمة في ظاهرها؛ المرساة تكشفه.
#[test]
fn r_anchor_deleting_the_last_session_events_is_detected() {
    let db = Arc::new(Database::in_memory().unwrap());
    let log = SqliteSessionLog::new(db.clone());
    for t in ["a", "b", "c"] {
        append(&log, "anchor", t);
    }
    assert_eq!(log.verify("anchor"), ChainCheck::Intact { events: 3 });
    db.with(|c| Ok(c.execute("DELETE FROM session_events WHERE session_id = 'anchor' AND seq = 3", [])?)).unwrap();
    assert!(matches!(log.verify("anchor"), ChainCheck::Broken { .. }), "a deleted tail passed the check: {:?}", log.verify("anchor"));
}

/// قاعدة v17 فيها سجلّ جلسة ومهمّة: الترحيل إلى v18 يحفظ كل الصفوف، ويملأ المرساة من الأحداث القائمة فتبقى السلسلة سليمة.
#[test]
fn r_migration_v17_to_v18_keeps_rows_and_anchors_existing_sessions() {
    use polaris_host_core::storage::migrations;
    let dir = p08_support::temp_dir("r-v18");
    let path = dir.join("polaris.db");
    {
        let mut conn = rusqlite::Connection::open(&path).unwrap();
        migrations::apply_up_to(&mut conn, 17).unwrap();
        conn.execute("INSERT INTO session_events (session_id, seq, mission_id, kind, authority, parent_seq, payload_json, created_at, prev_hash, hash) VALUES ('s', 1, 'm', 'USER_MESSAGE', 'DIRECT_USER_INSTRUCTION', NULL, '{}', 't', '0000000000000000000000000000000000000000000000000000000000000000', '1111111111111111111111111111111111111111111111111111111111111111')", []).unwrap();
        conn.execute("INSERT INTO session_events (session_id, seq, mission_id, kind, authority, parent_seq, payload_json, created_at, prev_hash, hash) VALUES ('s', 2, 'm', 'USER_MESSAGE', 'DIRECT_USER_INSTRUCTION', NULL, '{}', 't', '1111111111111111111111111111111111111111111111111111111111111111', '2222222222222222222222222222222222222222222222222222222222222222')", []).unwrap();
        // ترحيل v17 ← v18 بعينه: v19 (ADR-042) بعده يُختبر في `storage::migrations`.
        migrations::apply_up_to(&mut conn, 18).unwrap();
        assert_eq!(migrations::current_version(&conn).unwrap(), 18);
        let (seq, hash): (i64, String) = conn.query_row("SELECT last_seq, last_hash FROM session_heads WHERE session_id = 's'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((seq, hash.as_str()), (2, "2222222222222222222222222222222222222222222222222222222222222222"));
        let events: i64 = conn.query_row("SELECT count(*) FROM session_events", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 2, "a session event was lost by the migration");
    }
    let _ = std::fs::remove_dir_all(dir);
}

// ——— R-09: حول الحدّ وفوقه

/// حمولة دون الحدّ تبقى كما هي حرفيًّا؛ وفوقه تبقى صالحة UTF-8 بلا محرف بديل، وبمعرّفاتها، ونتائج متعدّدة لا تختلط.
#[test]
fn r09_payloads_around_the_limit_keep_text_integrity_and_identifiers() {
    use polaris_host_core::p03::watch::session::clip_payload;
    let small = json!({ "text": "مرحبا", "call_id": "c1", "status": "SUCCEEDED" });
    assert_eq!(clip_payload(&small, 250_000), small);
    let exact = json!({ "text": "ب".repeat(1_000) });
    let limit = exact.to_string().len();
    assert_eq!(clip_payload(&exact, limit), exact, "a payload exactly at the limit was clipped");
    let over = clip_payload(&exact, limit - 1);
    assert!(over.get("clipped").is_some());
    let text = over["text"].as_str().unwrap();
    assert!(!text.contains('\u{fffd}'), "an Arabic character was broken");
    assert!(over.to_string().len() <= limit + 400, "the clipped payload is far above its limit");
    let results = json!({ "results": [ { "call_id": "r1", "status": "SUCCEEDED", "text": "x".repeat(300_000) }, { "call_id": "r2", "status": "DENIED", "text": "short" } ] });
    let clipped = clip_payload(&results, 250_000);
    assert!(clipped.to_string().len() <= 250_000);
    assert_eq!(clipped["results"][0]["call_id"], "r1");
    assert_eq!(clipped["results"][1]["call_id"], "r2");
    assert_eq!(clipped["results"][1]["status"], "DENIED");
    assert_eq!(clipped["results"][1]["text"], "short");
}

// ——— مصحِّح الاقتباسات مربوط بالردّ الحقيقي

/// صفحة جُلبت فعلًا، وردّ يقتبس منها جملة موجودة وأخرى مختلقة: المهمّة لا تُثبَت، ويُسجَّل حدث أمن. وردّ اقتباسه موجود: متطلَّب
/// الاقتباس مستوفى.
#[test]
fn r_citations_in_the_reply_are_checked_against_pages_actually_fetched() {
    let page = "The Riyadh metro opened its first lines in December 2024 after a long construction period.";
    for (answer, grounded) in [
        ("Per the page, «The Riyadh metro opened its first lines in December 2024» — done.", true),
        ("Per the page, «The Riyadh metro carried ten million riders on its first day» — done.", false),
    ] {
        let world = World::new();
        let mut rt = world.runtime("Read https://example.org/metro and summarise it with a quotation.", |request| {
            if request.tool_id == "polaris.web.read_page" || request.tool_id == "polaris.web.navigate" {
                ("SUCCEEDED".into(), None, Some(page.to_string()))
            } else {
                ok(request)
            }
        });
        let model = LoopModel::native()
            .then(|_| Ok(calls(&[("read_web_page", json!({ "url": "https://example.org/metro" }))])))
            .then(move |_| Ok(text(answer)));
        let report = rt.run(&model);
        assert!(rt.tool_decisions().iter().any(|d| d.tool_id == "polaris.web.read_page" && d.status == "SUCCEEDED"), "the page was not fetched through the gateway");
        let requirement = rt.mission().requirements.iter().find(|r| r.requirement_id.starts_with('Q')).cloned().expect("a fetched page and a quotation produced a citation requirement");
        assert_eq!(requirement.status == RequirementStatus::Satisfied, grounded, "{answer}: {:?}", requirement.status);
        if !grounded {
            assert_ne!(report.completion_proof.status, CompletionProofStatus::Proven);
            assert!(rt.security_events().iter().any(|e| e.kind == "CITATION_UNGROUNDED"));
        }
    }
}
