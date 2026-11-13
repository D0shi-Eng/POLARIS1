// P06 — إعدادات الخصوصية فعّالة: كل إعداد يغيّر ما يحدث فعلًا، لا ما يُعرض فقط.
//
// كل اختبار هنا يقيس المسار الحقيقي بمهمّة ووكيل وبوابة: صفحة ويب حقيقية على الحلقة
// المحلية (TEST FIXTURE) يُمحى أثرها من السجلّ حين يُطفأ حفظ السجلّ، ونتيجة موصل لا تصير
// ذاكرة حين يُطفأ ذلك، ووثيقة تشخيص يتغيّر ما فيها بمستوى التفصيل، وملاحظات شاشة تُمحى
// عند نهاية المهمّة.

mod p06_support;

use std::time::Duration;

use p06_support::support::{handler, MockServer, Recorded, Reply};
use p06_support::{build_full, build_with, connector_fixture, Harness};
use polaris_host_core::p05::browser::url_policy::NavigationPolicy;
use serde_json::{json, Value};

fn tag(body: &str, name: &str) -> String {
    let open = format!("[[{name}:");
    body.find(&open)
        .and_then(|at| body[at + open.len()..].find("]]").map(|end| body[at + open.len()..at + open.len() + end].to_string()))
        .unwrap_or_default()
}

fn tool(skill: &str, tool: &str, arguments: Value) -> Value {
    json!({ "skill_id": skill, "tool_id": tool, "arguments": arguments, "reason": "the step needs it", "expected_effect": [], "expected_output": "a measurement" })
}

fn page(status: u16, body: &str) -> Reply {
    let head = format!("HTTP/1.1 {status} X\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let mut bytes = head.into_bytes();
    bytes.extend_from_slice(body.as_bytes());
    Reply::Raw(bytes)
}

fn web_fixture() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/normal" => page(200, "<html><head><title>POLARIS Fixture Normal</title></head><body><h1>Normal fixture</h1><p>This page is a TEST FIXTURE.</p></body></html>"),
        _ => page(404, "<p>missing</p>"),
    }))
}

/// تجهيزة نموذج: مهمّة من خطوة واحدة تقترح أداة واحدة بحسب السيناريو.
fn model_fixture() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/v1/chat/completions" => {
            let scenario = tag(&r.body, "FX");
            let content = if r.body.contains("local_key") {
                json!({ "tasks": [ { "local_key": "only", "title": "step only", "objective": "carry out the step named only", "task_type": "RESEARCH", "depends_on": [], "dependency_kind": "REQUIRES_SUCCESS", "recommended_role": "RESEARCHER" } ] }).to_string()
            } else if r.body.contains("output_summary") {
                let tools = match scenario.as_str() {
                    "PWEB" => vec![tool("polaris.skill.web-browse", "polaris.web.navigate", json!({ "url": format!("{}/normal", tag(&r.body, "WEB")) }))],
                    "PREAD" => vec![tool("polaris.skill.connector-operator", &format!("connector:{}:items.get", tag(&r.body, "CONN")), json!({ "item_id": "item-1" }))],
                    _ => vec![],
                };
                json!({ "output_summary": "the step is done", "claims": [], "evidence": [], "tools": tools, "failed": false }).to_string()
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

fn mission(h: &Harness, scenario: &str, extra: &str) -> String {
    h.ok("mission.create", json!({ "title": format!("p06 privacy {scenario}"), "objective": format!("[[FX:{scenario}]] {extra} carry out the fixture scenario") }))["mission_id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn start(h: &Harness, m: &str) -> String {
    h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap().to_string()
}

fn count(h: &Harness, sql: &str, mission: &str) -> i64 {
    h.host().phase02().unwrap().db.with(|c| Ok(c.query_row(sql, [mission], |r| r.get(0))?)).unwrap()
}

#[test]
fn p06_privacy_browser_history_is_erased_at_the_end_of_a_mission_when_it_is_not_kept() {
    let web = web_fixture();
    let navigation = NavigationPolicy::with_fixture_origins(&[("127.0.0.1".parse().unwrap(), web.port)]);
    let h = build_full(None, Some(model_fixture()), connector_fixture(), navigation);
    let extra = format!("[[WEB:{}]]", web.url());

    // المسار الافتراضي يحفظ السجلّ: العنوان الذي زاره المتصفّح يبقى.
    let kept = mission(&h, "PWEB", &extra);
    assert_eq!(start(&h, &kept), "COMPLETED");
    assert!(web.recorded().iter().any(|r| r.path == "/normal"), "the page was never visited, so erasure is not measured");
    assert!(count(&h, "SELECT COUNT(*) FROM browser_actions WHERE mission_id = ?1 AND url IS NOT NULL", &kept) >= 1);

    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.persist_browser_history", "value": false }));
    let erased = mission(&h, "PWEB", &extra);
    assert_eq!(start(&h, &erased), "COMPLETED");
    assert!(count(&h, "SELECT COUNT(*) FROM browser_actions WHERE mission_id = ?1", &erased) >= 1, "no browser action was recorded at all");
    assert_eq!(count(&h, "SELECT COUNT(*) FROM browser_actions WHERE mission_id = ?1 AND url IS NOT NULL", &erased), 0, "a visited address survived with history off");
    assert_eq!(count(&h, "SELECT COUNT(*) FROM browser_sessions WHERE mission_id = ?1 AND current_url IS NOT NULL", &erased), 0);
    // والمهمّة السابقة لم تُمسّ: الإعداد يسري على ما بعده.
    assert!(count(&h, "SELECT COUNT(*) FROM browser_actions WHERE mission_id = ?1 AND url IS NOT NULL", &kept) >= 1);
    let events = h.ok("observability.events", json!({ "component": "BROWSER" }))["events"].as_array().cloned().unwrap();
    assert!(events.iter().any(|e| e["operation"] == "privacy.erase_browser_history" && e["mission_id"] == json!(erased) && e["reason_code"] == "ROWS_ERASED"));
}

#[test]
fn p06_privacy_a_connector_result_does_not_become_memory_when_that_is_turned_off() {
    let h = build_with(None, Some(model_fixture()), connector_fixture());
    let c = h.register_fixture();
    let extra = format!("[[CONN:{c}]]");
    let remembered = mission(&h, "PREAD", &extra);
    assert_eq!(start(&h, &remembered), "COMPLETED");
    let subjects = |m: &str| -> Vec<String> {
        h.ok("memory.list", json!({ "mission_id": m }))["memories"].as_array().unwrap().iter().map(|e| e["subject"].as_str().unwrap_or("").to_string()).collect()
    };
    assert!(subjects(&remembered).iter().any(|s| s.starts_with("CONNECTOR_UNTRUSTED")), "the default did not remember the read, so the switch is not measured");
    h.ok("config.set", json!({ "layer": "USER", "key": "memory.connector_results_to_memory", "value": false }));
    let forgotten = mission(&h, "PREAD", &extra);
    assert_eq!(start(&h, &forgotten), "COMPLETED");
    assert!(!subjects(&forgotten).iter().any(|s| s.starts_with("CONNECTOR_UNTRUSTED")), "a connector result became memory with the setting off");
}

#[test]
fn p06_privacy_the_diagnostics_detail_level_changes_what_the_document_carries() {
    let h = build_with(None, None, connector_fixture());
    h.register_fixture();
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.diagnostics_level", "value": "MINIMAL" }));
    let minimal = h.ok("diagnostics.export", json!({}));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.diagnostics_level", "value": "DETAILED" }));
    let detailed = h.ok("diagnostics.export", json!({}));
    assert_eq!(minimal["level"], "MINIMAL");
    assert_eq!(detailed["level"], "DETAILED");
    let sections = |v: &Value| v["sections"].as_array().unwrap().len();
    assert!(sections(&minimal) < sections(&detailed), "the detail level did not change the document: {} vs {}", sections(&minimal), sections(&detailed));
    assert!(minimal["document"].get("connectors").is_none(), "a minimal document listed connectors");
    assert!(detailed["document"]["connectors"].as_array().is_some_and(|c| !c.is_empty()));
}

#[test]
fn p06_privacy_screen_observations_are_erased_at_the_end_of_a_mission_when_they_are_not_kept() {
    let h = build_with(None, Some(model_fixture()), connector_fixture());
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.persist_computer_observations", "value": false }));
    let m = mission(&h, "NONE", "");
    // ملاحظة شاشة مسجّلة للمهمّة قبل تشغيلها: ما يُقاس هنا هو مسار المحو عند النهاية،
    // لا الالتقاط نفسه (الالتقاط يُقاس في Phase-05 على نافذة التجهيزة الحقيقية).
    h.host()
        .phase02()
        .unwrap()
        .db
        .with(|c| {
            c.execute(
                "INSERT INTO computer_sessions (session_id, mission_id, agent_id, state, target_json, created_at, last_action_at, action_count, click_count, keyboard_count, capture_count, closed_reason)
                 VALUES ('p06-privacy-session', ?1, 'agent', 'ACTIVE', NULL, 't', NULL, 0, 0, 0, 1, NULL)",
                [&m],
            )?;
            c.execute(
                "INSERT INTO computer_observations (observation_id, session_id, mission_id, window_json, width, height, frame_digest, layout_digest, element_count, capture_scope, trust, observed_at)
                 VALUES ('p06-privacy-observation', 'p06-privacy-session', ?1, '{}', 10, 10, 'a', 'b', 0, 'WINDOW', 'UNTRUSTED_CONTENT', 't')",
                [&m],
            )?;
            Ok(())
        })
        .unwrap();
    start(&h, &m);
    assert_eq!(count(&h, "SELECT COUNT(*) FROM computer_observations WHERE mission_id = ?1", &m), 0, "a screen observation survived with persistence off");
}
