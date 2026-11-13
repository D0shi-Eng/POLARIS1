// P06 — مسار الوكيل الحقيقي إلى الموصل: مهمّة ← وكيل ← اقتراح أداة موصل ← بوابة الأدوات
// ← موافقة ← بوابة الموصلات ← خدمة TEST FIXTURE ← دليل ← تحقّق.
//
// نموذج التجهيزة يقرأ المُوجِّه كما يقرؤه نموذج حقيقي ويقترح أداته؛ لا شيء يُحقن في
// زمن التشغيل من الاختبار. والإعدادات تُكتب عبر البوابة نفسها، ويُقاس أثرها على مهمّة حيّة.

mod p06_support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use p06_support::support::{handler, MockServer, Recorded, Reply};
use p06_support::{build_with, connector_fixture, Harness};
use serde_json::{json, Value};

const CONN: &str = "polaris.skill.connector-operator";
const MARKER: &str = "P06-INJECTION-MARKER";

fn tag(body: &str, name: &str) -> String {
    let open = format!("[[{name}:");
    body.find(&open)
        .and_then(|at| body[at + open.len()..].find("]]").map(|end| body[at + open.len()..at + open.len() + end].to_string()))
        .unwrap_or_default()
}

fn task(key: &str, deps: &[&str]) -> Value {
    json!({ "local_key": key, "title": format!("step {key}"), "objective": format!("carry out the step named {key}"), "task_type": "RESEARCH",
        "depends_on": deps, "dependency_kind": "REQUIRES_SUCCESS", "recommended_role": "RESEARCHER" })
}

fn tool(skill: &str, tool: &str, arguments: Value) -> Value {
    json!({ "skill_id": skill, "tool_id": tool, "arguments": arguments, "reason": "the step needs it", "expected_effect": [], "expected_output": "a measurement" })
}

fn claim(statement: &str, subject: &str, property: &str, value: &str) -> Value {
    json!({ "statement": statement, "claim_type": "FACT", "subject": subject, "property": property, "value": value })
}

fn execution_for(scenario: &str, body: &str) -> Value {
    let c = tag(body, "CONN");
    let t = |op: &str| format!("connector:{c}:{op}");
    let follow = body.contains("step named follow");
    let (tools, claims): (Vec<Value>, Vec<Value>) = match (scenario, follow) {
        ("CREAD", false) => (
            vec![tool(CONN, &t("items.get"), json!({ "item_id": "item-1" }))],
            vec![claim("the fixture item is named blue fixture item", "fixture item", "name", "blue fixture item")],
        ),
        ("CINJECT", false) => (vec![tool(CONN, &t("items.get"), json!({ "item_id": "inject" }))], vec![]),
        // الوكيل «أطاع» النصّ المحقون: يقترح أداة لا وجود لها ويطلب عنوانًا حرًّا. البوابة تقرّر.
        ("CINJECT", true) => (
            vec![tool(CONN, &t("admin.delete"), json!({})), tool(CONN, &t("items.get"), json!({ "item_id": "item-1", "url": "http://169.254.169.254/" }))],
            vec![],
        ),
        ("CWRITE", _) => (
            vec![tool(CONN, &t("items.create"), json!({ "name": "alpha" }))],
            vec![
                claim("the service created the item as item-101", "fixture item", "id", "item-101"),
                claim("the item was published", "fixture item", "status", "PUBLISHED"),
            ],
        ),
        ("CREPLAY", _) => (vec![tool(CONN, &t("items.create"), json!({ "name": "replay" })), tool(CONN, &t("items.create"), json!({ "name": "replay" }))], vec![]),
        ("CSLOW", _) => (vec![tool(CONN, &t("slow.get"), json!({}))], vec![]),
        ("CLIST", _) => (vec![tool(CONN, &t("items.list"), json!({}))], vec![]),
        ("CWEB", _) => (vec![tool("polaris.skill.web-browse", "polaris.web.navigate", json!({ "url": "http://127.0.0.1:9/x" }))], vec![]),
        ("CDESK", _) => (vec![tool("polaris.skill.desktop-operator", "polaris.desktop.observe", json!({}))], vec![]),
        _ => (vec![], vec![]),
    };
    json!({ "output_summary": "the step is done", "claims": claims, "evidence": [], "tools": tools, "failed": false })
}

fn plan_for(scenario: &str) -> Value {
    match scenario {
        "CREAD" | "CINJECT" => json!({ "tasks": [task("open", &[]), task("follow", &["open"])] }),
        _ => json!({ "tasks": [task("only", &[])] }),
    }
}

fn model_fixture() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/v1/chat/completions" => {
            let scenario = tag(&r.body, "FX");
            let content = if r.body.contains("local_key") {
                plan_for(&scenario).to_string()
            } else if r.body.contains("output_summary") {
                execution_for(&scenario, &r.body).to_string()
            } else {
                json!({ "verdict": "ACCEPT", "notes": "fine" }).to_string()
            };
            let parts = vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": content } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 50, "completion_tokens": 20 } })),
                "data: [DONE]\n\n".to_string(),
            ];
            Reply::Stream { content_type: "text/event-stream", parts, gap: Duration::ZERO }
        }
        _ => Reply::Json(404, "{}".into()),
    }))
}

fn harness() -> (Harness, String) {
    let h = build_with(None, Some(model_fixture()), connector_fixture());
    let id = h.register_fixture();
    (h, id)
}

fn mission(h: &Harness, scenario: &str, connector: &str) -> String {
    h.ok("mission.create", json!({ "title": format!("p06 {scenario}"), "objective": format!("[[FX:{scenario}]] [[CONN:{connector}]] carry out the fixture scenario") }))["mission_id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn start(h: &Harness, m: &str) -> String {
    h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap().to_string()
}

fn invocations(h: &Harness, m: &str) -> Vec<Value> {
    h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default()
}

fn claim_status(h: &Harness, m: &str, statement: &str) -> String {
    h.ok("claim.list", json!({ "mission_id": m }))["claims"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["statement"] == json!(statement))
        .map(|c| c["status"].as_str().unwrap().to_string())
        .unwrap_or_else(|| "ABSENT".into())
}

fn pending(h: &Harness, m: &str) -> Vec<Value> {
    h.ok("approval.list", json!({ "mission_id": m }))["approvals"].as_array().unwrap().iter().filter(|a| a["status"] == "PENDING").cloned().collect()
}

fn grant(h: &Harness, approval: &Value) {
    h.ok("tool.approval.respond", json!({ "approval_id": approval["approval_id"], "decision": "GRANT" }));
}

fn completions_for(h: &Harness, scenario: &str) -> Vec<Recorded> {
    h.model.as_ref().unwrap().recorded().into_iter().filter(|r| r.path.ends_with("/chat/completions") && r.body.contains(&format!("[[FX:{scenario}]]"))).collect()
}

#[test]
fn p06_agent_integration_a_read_goes_through_the_real_agent_path_and_its_observed_value_verifies_a_claim() {
    let (h, c) = harness();
    let m = mission(&h, "CREAD", &c);
    assert_eq!(start(&h, &m), "COMPLETED");
    let calls = invocations(&h, &m);
    let read = calls.iter().find(|i| i["tool_id"] == json!(format!("connector:{c}:items.get"))).expect("the connector was not called");
    assert_eq!(read["status"], "SUCCEEDED");
    assert!(read["evidence_id"].is_string(), "the read recorded no evidence");
    assert_eq!(claim_status(&h, &m, "the fixture item is named blue fixture item"), "VERIFIED");
    // المهمّة الفرعية التالية رأت النتيجة موسومةً غير موثوقة.
    let follow = completions_for(&h, "CREAD").into_iter().find(|r| r.body.contains("step named follow") && r.body.contains("output_summary")).unwrap();
    assert!(follow.body.contains("[CONNECTOR_UNTRUSTED]"), "the connector result reached the agent without its label");
    // ودخلت الذاكرة موسومة بمصدرها، غير محقّقة.
    let memories = h.ok("memory.list", json!({ "mission_id": m }))["memories"].as_array().cloned().unwrap();
    let from_connector = memories.iter().find(|e| e["subject"].as_str().unwrap_or("").starts_with("CONNECTOR_UNTRUSTED")).expect("no connector memory");
    assert_eq!(from_connector["verification"], "UNVERIFIED");
    assert!(from_connector["taint"].as_array().unwrap().contains(&json!("UNTRUSTED_CONTENT")));
    // والاستعمال سُجّل: نموذج برموز أبلغها المزوّد وكلفة مجهولة بلا سعر، وموصل بطلب واحد.
    let summary = h.ok("usage.summary", json!({ "mission_id": m }));
    let mission_usage = &summary["mission"];
    assert!(mission_usage["input_tokens_reported"].as_u64().unwrap() >= 50);
    assert!(mission_usage["calls_with_unknown_cost"].as_u64().unwrap() >= 1);
    assert!(mission_usage["external_requests"].as_u64().unwrap() >= 1);
}

#[test]
fn p06_agent_integration_injected_connector_content_stays_fenced_and_what_the_agent_obeyed_is_refused() {
    let (h, c) = harness();
    let m = mission(&h, "CINJECT", &c);
    start(&h, &m);
    let follow = completions_for(&h, "CINJECT").into_iter().find(|r| r.body.contains("step named follow") && r.body.contains("output_summary")).unwrap();
    let at = follow.body.find(MARKER).expect("the injected text never reached the agent, so fencing was not measured");
    let open = follow.body[..at].rfind("<<<UNTRUSTED");
    let close = follow.body[..at].rfind("UNTRUSTED>>>");
    assert!(open.is_some() && close.is_none_or(|c| c < open.unwrap()), "the injected text was outside its untrusted fence");
    let calls = invocations(&h, &m);
    let invented = calls.iter().find(|i| i["tool_id"].as_str().unwrap().ends_with(":admin.delete")).unwrap();
    assert_eq!(invented["denial_reason"], "UNKNOWN_TOOL");
    let url = calls.iter().filter(|i| i["tool_id"].as_str().unwrap().ends_with(":items.get")).find(|i| i["status"] == "DENIED").unwrap();
    assert_eq!(url["denial_reason"], "ARGUMENTS_INVALID");
    assert!(!h.connector.recorded().iter().any(|r| r.path.contains("admin") || r.path.contains("169.254")));
}

#[test]
fn p06_agent_integration_a_write_waits_for_a_bound_approval_with_a_host_written_summary_and_executes_exactly_once() {
    let (h, c) = harness();
    let m = mission(&h, "CWRITE", &c);
    assert_eq!(start(&h, &m), "WAITING_FOR_APPROVAL");
    assert_eq!(h.state.lock().unwrap().created.len(), 0, "the write ran before approval");
    let waiting = pending(&h, &m);
    assert_eq!(waiting.len(), 1);
    let context = &waiting[0]["context"];
    assert_eq!(context["action"], "CONNECTOR_CREATE_EXTERNAL_RESOURCE");
    assert!(context["target"].as_str().unwrap().contains("TEST FIXTURE items"));
    assert!(context["target"].as_str().unwrap().contains("POST"));
    assert_eq!(context["risk"], "HIGH");
    assert!(waiting[0]["effects"].as_array().unwrap().contains(&json!("EXTERNAL_SIDE_EFFECT")));
    grant(&h, &waiting[0]);
    assert_eq!(start(&h, &m), "COMPLETED");
    assert_eq!(h.state.lock().unwrap().created, vec!["item-101".to_string()]);
    // التأكيد جاء من معرّف المورد، والادّعاء الذي لم تُظهره الخدمة يبقى غير محقّق.
    assert_eq!(claim_status(&h, &m, "the service created the item as item-101"), "VERIFIED");
    assert_ne!(claim_status(&h, &m, "the item was published"), "VERIFIED");
    let approvals = h.ok("approval.list", json!({ "mission_id": m }))["approvals"].as_array().cloned().unwrap();
    assert!(approvals.iter().any(|a| a["status"] == "CONSUMED"), "the approval was not consumed by exactly one action");
}

#[test]
fn p06_agent_integration_an_identical_second_write_is_a_replay_and_never_a_second_external_effect() {
    let (h, c) = harness();
    let m = mission(&h, "CREPLAY", &c);
    assert_eq!(start(&h, &m), "WAITING_FOR_APPROVAL");
    grant(&h, &pending(&h, &m)[0]);
    assert_eq!(start(&h, &m), "WAITING_FOR_APPROVAL", "the second identical write did not need its own approval");
    assert_eq!(h.state.lock().unwrap().created.len(), 1);
    grant(&h, &pending(&h, &m)[0]);
    start(&h, &m);
    assert_eq!(h.state.lock().unwrap().created.len(), 1, "an identical write reached the service twice");
    let rows = h.ok("connector.get", json!({ "connector_id": c }))["invocations"].as_array().cloned().unwrap();
    assert!(rows.iter().any(|r| r["status"] == "REPLAYED"), "{rows:?}");
}

#[test]
fn p06_agent_integration_cancelling_the_mission_stops_an_in_flight_connector_call() {
    let (h, c) = harness();
    let h = Arc::new(h);
    let m = mission(&h, "CSLOW", &c);
    let runner = {
        let h = h.clone();
        let m = m.clone();
        std::thread::spawn(move || h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap().to_string())
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    while !h.connector.recorded().iter().any(|r| r.path == "/api/slow") {
        assert!(Instant::now() < deadline, "the slow call never started");
        std::thread::sleep(Duration::from_millis(50));
    }
    let cancelled_at = Instant::now();
    h.ok("mission.cancel", json!({ "mission_id": m }));
    let state = runner.join().unwrap();
    assert_eq!(state, "CANCELLED");
    assert!(cancelled_at.elapsed() < Duration::from_secs(5), "the connector call outlived the cancel");
    let rows = h.ok("connector.get", json!({ "connector_id": c }))["invocations"].as_array().cloned().unwrap();
    assert!(rows.iter().any(|r| r["operation_id"] == "slow.get" && r["status"] == "CANCELLED"), "{rows:?}");
}

#[test]
fn p06_budgets_a_hard_model_token_budget_blocks_the_mission_before_any_model_call() {
    let (h, c) = harness();
    let m = mission(&h, "CLIST", &c);
    h.ok("budget.set", json!({ "scope": "MISSION", "scope_key": m, "dimension": "MODEL_TOKENS", "limit": 10, "mode": "HARD" }));
    let state = start(&h, &m);
    assert_ne!(state, "COMPLETED");
    assert!(completions_for(&h, "CLIST").is_empty(), "a model call ran under an exhausted hard budget");
    let events = h.ok("observability.events", json!({ "component": "MODEL" }))["events"].as_array().cloned().unwrap();
    assert!(events.iter().any(|e| e["reason_code"] == "BUDGET_EXHAUSTED"));
}

#[test]
fn p06_cost_a_user_price_makes_model_cost_estimated_with_its_source_and_no_price_leaves_it_unknown() {
    let (h, c) = harness();
    let m1 = mission(&h, "CLIST", &c);
    start(&h, &m1);
    let unknown = h.ok("usage.summary", json!({ "mission_id": m1 }));
    assert!(unknown["mission"]["costs"].as_array().unwrap().iter().all(|b| b["provenance"] != "ESTIMATED"));
    for unit in ["PER_MILLION_INPUT_TOKENS", "PER_MILLION_OUTPUT_TOKENS"] {
        h.ok("pricing.set", json!({ "target_kind": "MODEL", "target_id": "lm-studio:fixture-chat", "unit": unit, "amount": "2", "currency": "USD", "source_note": "TEST FIXTURE price" }));
    }
    let m2 = mission(&h, "CLIST", &c);
    start(&h, &m2);
    let priced = h.ok("usage.summary", json!({ "mission_id": m2 }));
    let bucket = priced["mission"]["costs"].as_array().unwrap().iter().find(|b| b["provenance"] == "ESTIMATED").cloned().expect("no estimated bucket");
    assert_eq!(bucket["currency"], "USD");
    let records = h.ok("usage.list", json!({ "mission_id": m2, "category": "MODEL" }))["records"].as_array().cloned().unwrap();
    assert!(records.iter().all(|r| r["cost"]["pricing_source"].as_str().unwrap_or("").contains("TEST FIXTURE price")));
    h.ok("config.set", json!({ "layer": "USER", "key": "cost.show_estimated", "value": false }));
    let hidden = h.ok("usage.summary", json!({ "mission_id": m2 }));
    assert!(hidden["mission"]["costs"].as_array().unwrap().iter().all(|b| b["provenance"] != "ESTIMATED"));
}

#[test]
fn p06_settings_a_mission_override_takes_effect_and_cannot_widen_the_security_clamp() {
    let (h, c) = harness();
    let m = mission(&h, "CLIST", &c);
    h.ok("config.set", json!({ "layer": "MISSION", "scope_id": m, "key": "agents.max_tool_calls_per_mission", "value": 0 }));
    // أوسع من الافتراض (64 منذ ADR-039) ومن القيمة الموروثة: طبقة المهمّة لا توسّع.
    let widened = h.call("config.set", json!({ "layer": "MISSION", "scope_id": m, "key": "agents.max_tool_calls_per_mission", "value": 100 }));
    assert!(widened.get("error").is_some(), "a mission override widened the tool budget");
    start(&h, &m);
    let calls = invocations(&h, &m);
    assert!(!calls.is_empty());
    assert!(calls.iter().all(|i| i["denial_reason"] == "BUDGET_EXHAUSTED"), "the mission tool budget setting had no effect: {calls:?}");
    assert!(!h.connector.recorded().iter().any(|r| r.path == "/api/items"));
}

#[test]
fn p06_privacy_turning_off_browser_internet_computer_use_and_memory_persistence_is_effective() {
    let (h, c) = harness();
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_browser_internet", "value": false }));
    h.ok("config.set", json!({ "layer": "USER", "key": "computer.use_enabled", "value": false }));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.persist_memory", "value": false }));
    let web = mission(&h, "CWEB", &c);
    start(&h, &web);
    let call = invocations(&h, &web).into_iter().find(|i| i["tool_id"] == "polaris.web.navigate").unwrap();
    assert_eq!(call["denial_reason"], "EFFECT_NOT_PERMITTED");
    assert!(call["summary"].as_str().unwrap().contains("PRIVACY_BROWSER_INTERNET_OFF"));
    let desk = mission(&h, "CDESK", &c);
    start(&h, &desk);
    let call = invocations(&h, &desk).into_iter().find(|i| i["tool_id"] == "polaris.desktop.observe").unwrap();
    assert_eq!(call["denial_reason"], "EFFECT_NOT_PERMITTED");
    assert!(h.ok("memory.list", json!({ "mission_id": web }))["memories"].as_array().unwrap().is_empty(), "memory was written with persistence off");
}

/// 2026-11-13: المهمّة فوق الحدّ تنتظر مكانها ولا تُرفض (كانت تُرفض فيسقط العارض الرفض وتبقى «يبدأ…» للأبد).
#[test]
fn p06_settings_the_concurrent_mission_clamp_queues_a_start_beyond_it_until_a_slot_frees() {
    let (h, c) = harness();
    h.ok("config.set", json!({ "layer": "SECURITY", "key": "agents.max_concurrent_missions", "value": 1 }));
    let h = Arc::new(h);
    let slow = mission(&h, "CSLOW", &c);
    let runner = {
        let h = h.clone();
        let slow = slow.clone();
        std::thread::spawn(move || h.call("mission.start", json!({ "mission_id": slow })))
    };
    let deadline = Instant::now() + Duration::from_secs(20);
    while !h.connector.recorded().iter().any(|r| r.path == "/api/slow") {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(50));
    }
    let second = mission(&h, "CLIST", &c);
    let waiter = {
        let h = h.clone();
        let second = second.clone();
        std::thread::spawn(move || h.call("mission.start", json!({ "mission_id": second })))
    };
    std::thread::sleep(Duration::from_millis(1_500));
    let state = h.ok("mission.get", json!({ "mission_id": second }))["mission"]["state"].clone();
    assert!(state == "CREATED" || state == "PLANNED" || state == "QUEUED" || state == "DRAFT", "a second mission started beyond the clamp: {state}");
    h.ok("mission.cancel", json!({ "mission_id": slow }));
    let _ = runner.join();
    let started = waiter.join().expect("the waiting start panicked");
    assert!(started.get("error").is_none(), "the queued mission was refused after the slot freed: {started}");
}
