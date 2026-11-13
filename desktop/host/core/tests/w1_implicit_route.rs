// W-1 (تكليف المالك 2026-10-27): التوجيه الضمني تجربةً خلف مفتاح. المفتاح مطفأ افتراضيًّا فتبقى سياسة القرار الصريح كما هي؛
// وحين يُشغَّل يُنفَّذ استدعاء العمل الأول قبل القرار ويُسجَّل «أعمل بنفسي» ضمنًا بدل رفضه. التفويض والمرشّحون وتعليمة النظام كما هي.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية. البوابة والأدوات وسجلّ الجلسة حقيقية.

mod p08_support;

use std::time::Duration;

use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::watch::measure::{self, MEASURE_KEY};

fn stream(parts: Vec<Value>) -> Reply {
    Reply::Stream { content_type: "text/event-stream", parts: parts.into_iter().map(|p| format!("data: {p}\n\n")).chain(std::iter::once("data: [DONE]\n\n".to_string())).collect(), gap: Duration::ZERO }
}

fn say(content: &str) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "content": content } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

fn call(name: &str, args: Value) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "tool_calls": [ { "index": 0, "id": format!("call-{name}"), "type": "function", "function": { "name": name, "arguments": args.to_string() } } ] } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "tool_calls" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

fn models(r: &Recorded) -> Option<Reply> {
    match r.path.as_str() {
        "/api/v0/models" => Some(Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": 32768 } ] }).to_string())),
        "/v1/models" => Some(Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string())),
        _ => None,
    }
}

/// المنسّق يبدأ بالكتابة مباشرة (بلا قرار)، ثم يردّ بعد أول نتيجة.
fn eager_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        if r.body.matches("\"role\":\"tool\"").count() == 0 {
            call("write_file", json!({ "path": "outputs/index.html", "content": "<h1>Welcome</h1>" }))
        } else {
            say("I wrote outputs/index.html.")
        }
    }))
}

/// المنسّق يفوّض أولًا إلى أول مرشّح، والمساعد يكتب ثم يردّ، ثم يردّ المنسّق.
fn delegating_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        let helper = b.contains("[AGENT_REQUEST to") || b.contains("[DELEGATED_TASK");
        let results = b.matches("\"role\":\"tool\"").count();
        if helper {
            return if results == 0 { call("write_file", json!({ "path": "outputs/index.html", "content": "<h1>Welcome</h1>" })) } else { say("Wrote outputs/index.html.") };
        }
        if results == 0 {
            let agent = b.split("- agent.").nth(1).and_then(|rest| rest.split_whitespace().next()).map(|id| format!("agent.{id}")).unwrap_or_default();
            return call("delegate_task", json!({ "agent_id": agent, "objective": "Build the landing page at outputs/index.html" }));
        }
        say("The agent wrote outputs/index.html.")
    }))
}

fn payloads(h: &p08_support::Harness, mission: &str) -> Vec<Value> {
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 ORDER BY rowid").unwrap();
    let rows: Vec<String> = stmt.query_map([mission], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    rows.iter().filter_map(|p| serde_json::from_str::<Value>(p).ok()).filter(|p| p.get(MEASURE_KEY).is_some()).collect()
}

fn run(h: &p08_support::Harness) -> (String, String) {
    let m = h.ok("mission.create", json!({ "title": "w1", "objective": "Build a landing page website in HTML at outputs/index.html" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    (m, state)
}

#[test]
fn w1_with_the_flag_on_the_first_work_call_runs_and_counts_as_a_direct_route() {
    let h = p08_support::build(Some(eager_model()));
    h.host().phase03().unwrap().set_implicit_route(true);
    let (m, state) = run(&h);
    let s = measure::summarize(payloads(&h, &m).iter());
    println!("W1 on: {state} {s:?}");
    assert!(s.route_required, "the shortlist did not appear: {s:?}");
    assert_eq!(s.route_refusals, 0, "{s:?}");
    assert_eq!(s.route, Some(("implicit".to_string(), 0)), "{s:?}");
    assert_eq!(s.model_turns, 2, "{s:?}");
    let calls = h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default();
    assert!(calls.iter().any(|i| i["tool_id"] == "polaris.workspace.write" && i["status"] == "SUCCEEDED"), "{calls:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}

// DEF-18 (2026-11-12): التوجيه الضمني صار الافتراضي. نموذج يبدأ العمل مباشرة لا يضيع دورًا على رفض `ROUTE_FIRST`.
#[test]
fn def18_by_default_the_first_work_call_runs_as_an_implicit_route() {
    let h = p08_support::build(Some(eager_model()));
    let (m, state) = run(&h);
    let s = measure::summarize(payloads(&h, &m).iter());
    println!("DEF-18 default: {state} {s:?}");
    assert_eq!(s.route_refusals, 0, "{s:?}");
    assert_eq!(s.route, Some(("implicit".to_string(), 0)), "{s:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}

#[test]
fn w1_with_the_flag_off_the_first_work_call_is_refused_as_before() {
    let h = p08_support::build(Some(eager_model()));
    h.host().phase03().unwrap().set_implicit_route(false);
    let (m, _) = run(&h);
    let s = measure::summarize(payloads(&h, &m).iter());
    println!("W1 off: {s:?}");
    assert_eq!(s.route_refusals, 1, "{s:?}");
    assert_ne!(s.route.as_ref().map(|r| r.0.as_str()), Some("implicit"), "{s:?}");
}

#[test]
fn w1_with_the_flag_on_delegation_still_works() {
    let h = p08_support::build(Some(delegating_model()));
    h.host().phase03().unwrap().set_implicit_route(true);
    let (m, state) = run(&h);
    let s = measure::summarize(payloads(&h, &m).iter());
    println!("W1 delegate: {state} {s:?}");
    assert_eq!(s.route.as_ref().map(|r| r.0.as_str()), Some("delegate"), "{s:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}
