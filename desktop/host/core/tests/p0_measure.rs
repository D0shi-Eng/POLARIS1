// P0 (تكليف المالك 2026-10-27): قياس الحلقة عبر المضيف الحقيقي — ما عُرض من أدوات، وكيف حُسم قرار التوجيه، وكل نداء نموذج —
// دون نص المستخدم ولا وسائط الاستدعاءات.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية. البوابة والأدوات وسجلّ الجلسة حقيقية.

mod p08_support;

use std::time::Duration;

use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::watch::measure::{self, MEASURE_KEY};

const OBJECTIVE_MARK: &str = "ZEBRA-7731";
const CONTENT_MARK: &str = "PRIVATE-CONTENT-991";

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

fn write_args() -> Value {
    json!({ "path": "outputs/index.html", "content": format!("<html><body>{CONTENT_MARK}</body></html>") })
}

/// المنسّق يكتب قبل قرار التوجيه (يُرفض)، ثم يقرّر العمل بنفسه، ثم يكتب، ثم يردّ.
fn route_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        let results = b.matches("\"role\":\"tool\"").count();
        let routing = b.contains("\"name\":\"handle_directly\"");
        match (routing, results) {
            (true, 0) => call("write_file", write_args()),
            (true, 1) => call("handle_directly", json!({})),
            (_, n) if n < 3 => call("write_file", write_args()),
            _ => say("I wrote the page to outputs/index.html."),
        }
    }))
}

fn measure_payloads(h: &p08_support::Harness, mission: &str) -> Vec<Value> {
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 ORDER BY rowid").unwrap();
    let rows: Vec<String> = stmt.query_map([mission], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    rows.iter().filter_map(|p| serde_json::from_str::<Value>(p).ok()).filter(|p| p.get(MEASURE_KEY).is_some()).collect()
}

#[test]
fn p0_the_loop_records_selection_routing_and_every_model_turn_without_user_content() {
    let h = p08_support::build(Some(route_model()));
    // هذا الاختبار يقيس تسجيل الرفض قبل القرار؛ منذ DEF-18 التوجيه الضمني افتراضي، فيُطفأ هنا صراحةً.
    h.host().phase03().unwrap().set_implicit_route(false);
    let m = h.ok("mission.create", json!({ "title": "p0", "objective": format!("Build a landing page website in HTML at outputs/index.html for {OBJECTIVE_MARK}") }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    let payloads = measure_payloads(&h, &m);
    let s = measure::summarize(payloads.iter());
    println!("P0 measure: state {state}, {s:?}");

    // ما عُرض: قائمة المنسّق بأسمائها وحجمها، وقرار التوجيه مطلوب لأن المرشحين ظهروا.
    assert!(s.route_required, "the shortlist did not appear for this request: {payloads:?}");
    assert!(s.initial_offered > 0 && s.initial_tool_schema_chars > 0 && s.initial_system_chars > 0, "{s:?}");
    // التوجيه: كتابة قبل القرار رُفضت مرة، ثم «أعمل بنفسي» في الدور الثاني (رقم 1).
    assert_eq!(s.route_refusals, 1, "{payloads:?}");
    assert_eq!(s.route, Some(("direct".to_string(), 1)), "{payloads:?}");
    // كل نداء للحلقة سجّل دوره: أربعة أدوار، ورموزها كما بلّغها الخادم.
    assert_eq!(s.model_turns, 4, "{payloads:?}");
    assert_eq!((s.input_tokens, s.output_tokens, s.failed_turns), (400, 80, 0), "{s:?}");
    // الخصوصية: لا نص الطلب ولا محتوى الملف في أي سجلّ قياس.
    for p in &payloads {
        let text = p.to_string();
        assert!(!text.contains(OBJECTIVE_MARK) && !text.contains(CONTENT_MARK), "a measure record carried user content: {text}");
    }
    // سجلّات القياس لا تعود إلى المحادثة.
    let bodies: Vec<String> = h.model.as_ref().unwrap().recorded().into_iter().filter(|r| r.path.ends_with("/chat/completions")).map(|r| r.body).collect();
    assert!(bodies.iter().all(|b| !b.contains("[POLARIS] measure")), "a measure record was replayed to the model");
    assert_eq!(state, "COMPLETED", "{state}");
}

/// أداة قياس للتشغيل الحقيقي (لا تعمل في المجموعة): `P0_STORE=<data dir فيه polaris.db>` يطبع خلاصة كل مهمّة فيه سطر JSON.
#[test]
#[ignore]
fn p0_summarize_store() {
    let dir = std::env::var("P0_STORE").expect("set P0_STORE to the data folder that holds polaris.db");
    let db = rusqlite::Connection::open_with_flags(std::path::Path::new(&dir).join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut missions = db.prepare("SELECT DISTINCT mission_id FROM session_events ORDER BY rowid").unwrap();
    let ids: Vec<String> = missions.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    for id in ids {
        let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 ORDER BY rowid").unwrap();
        let rows: Vec<String> = stmt.query_map([&id], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        let payloads: Vec<Value> = rows.iter().filter_map(|p| serde_json::from_str::<Value>(p).ok()).filter(|p| p.get(MEASURE_KEY).is_some()).collect();
        let s = measure::summarize(payloads.iter());
        println!(
            "{}",
            json!({ "mission_id": id, "model_turns": s.model_turns, "failed_turns": s.failed_turns, "input_tokens": s.input_tokens, "output_tokens": s.output_tokens, "tool_calls": s.tool_calls,
                "initial_offered": s.initial_offered, "initial_tool_schema_chars": s.initial_tool_schema_chars, "initial_system_chars": s.initial_system_chars,
                "max_system_chars": s.max_system_chars, "max_conversation_chars": s.max_conversation_chars, "loads": s.loads, "route_required": s.route_required,
                "route_refusals": s.route_refusals, "route": s.route.map(|(d, t)| json!({ "decision": d, "turn": t })) })
        );
    }
}
