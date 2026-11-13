// W-4 (تكليف المالك 2026-10-27/28): عدّ الرفض بالوسائط. كان المفتاح (أداة، سبب) والحدّ 3، فثلاث محاولات مختلفة الوسائط تقترب
// من الصواب توقف المهمّة، ومحاولتان متطابقتان لا توقفها. الآن، للأسباب التي يصحّحها تغيير الوسائط فقط (ARGUMENTS_INVALID،
// RESULT_TOO_LARGE): التوقف عند التكرار المتطابق الثاني، أو عند الخامس بوسائط مختلفة. سائر الأسباب كما كانت حرفيًّا.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية. البوابة والأدوات ومساحة العمل حقيقية.

mod p08_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};

fn stream(parts: Vec<Value>) -> Reply {
    Reply::Stream { content_type: "text/event-stream", parts: parts.into_iter().map(|p| format!("data: {p}\n\n")).chain(std::iter::once("data: [DONE]\n\n".to_string())).collect(), gap: Duration::ZERO }
}

fn say(content: &str) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "content": content } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

fn call(step: usize, name: &str, args: Value) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "tool_calls": [ { "index": 0, "id": format!("call-{name}-{step}"), "type": "function", "function": { "name": name, "arguments": args.to_string() } } ] } } ] }),
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

const PAGE: &str = "<html>\n<h1>Old title</h1>\n<p>keep this paragraph</p>\n</html>\n";

/// نموذج يكتب الصفحة ثم يعدّلها بقائمة محاولات `edits` بالترتيب، ثم يردّ.
fn editing_model(counter: &'static AtomicUsize, edits: &'static [&'static str]) -> MockServer {
    MockServer::start(handler(move |r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        if b.contains("\"name\":\"handle_directly\"") && !b.contains("call-handle_directly") {
            return call(0, "handle_directly", json!({}));
        }
        let step = counter.fetch_add(1, Ordering::SeqCst);
        if step == 0 {
            return call(step, "write_file", json!({ "path": "outputs/index.html", "content": PAGE }));
        }
        match edits.get(step - 1) {
            Some(old) => call(step, "edit_file", json!({ "path": "outputs/index.html", "old_text": old, "new_text": "<h1>New title</h1>" })),
            None => say("I changed the title in outputs/index.html."),
        }
    }))
}

fn run(model: MockServer) -> (String, Vec<Value>, String) {
    let h = p08_support::build(Some(model));
    let m = h.ok("mission.create", json!({ "title": "w4", "objective": "Write a small page at outputs/index.html titled Old title, then change its title to New title" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    let calls = h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default();
    let edits: Vec<Value> = calls.into_iter().filter(|i| i["tool_id"] == "polaris.workspace.edit").collect();
    let preview = h.ok("workspace.preview", json!({ "mission_id": m, "path": "outputs/index.html" })).to_string();
    (state, edits, preview)
}

static GRADUAL: AtomicUsize = AtomicUsize::new(0);
/// ثلاث محاولات مختلفة تقترب من النصّ الصحيح، ثم الصحيحة.
const CLOSER: &[&str] = &["<h1>Old</h1>", "<h1>Old titl</h1>", "<h1> Old title</h1>", "<h1>Old title</h1>"];

#[test]
fn w4_a_model_correcting_its_arguments_step_by_step_succeeds_on_the_fourth_try() {
    let (state, edits, preview) = run(editing_model(&GRADUAL, CLOSER));
    let denied = edits.iter().filter(|e| e["status"] == "DENIED" && e["denial_reason"] == "ARGUMENTS_INVALID").count();
    let succeeded = edits.iter().filter(|e| e["status"] == "SUCCEEDED").count();
    println!("W4 gradual: {state}, denied {denied}, succeeded {succeeded}");
    assert_eq!(denied, 3, "{edits:?}");
    assert_eq!(succeeded, 1, "the fourth, correct edit never ran: {edits:?}");
    assert!(preview.contains("New title") && preview.contains("keep this paragraph"), "{preview}");
    assert_eq!(state, "COMPLETED", "{state}");
}

static SAME: AtomicUsize = AtomicUsize::new(0);
/// المحاولة الخاطئة نفسها مرارًا.
const REPEATED: &[&str] = &["<h1>Missing</h1>", "<h1>Missing</h1>", "<h1>Missing</h1>", "<h1>Missing</h1>", "<h1>Old title</h1>"];

#[test]
fn w4_the_same_denied_arguments_stop_on_the_second_identical_denial() {
    let (state, edits, _) = run(editing_model(&SAME, REPEATED));
    let denied = edits.iter().filter(|e| e["status"] == "DENIED").count();
    println!("W4 identical: {state}, denied {denied}, {edits:?}");
    assert_eq!(denied, 2, "an identical denied call ran {denied} times");
    assert!(edits.iter().all(|e| e["status"] != "SUCCEEDED"), "{edits:?}");
    assert_ne!(state, "COMPLETED", "{state}");
}

static WIDE: AtomicUsize = AtomicUsize::new(0);
/// خمس محاولات مختلفة كلها خاطئة: التوقف عند الخامسة، والسادسة الصحيحة لا تعمل.
const NEVER: &[&str] = &["<h1>a</h1>", "<h1>b</h1>", "<h1>c</h1>", "<h1>d</h1>", "<h1>e</h1>", "<h1>Old title</h1>"];

#[test]
fn w4_five_different_denied_arguments_still_stop_the_task() {
    let (state, edits, _) = run(editing_model(&WIDE, NEVER));
    let denied = edits.iter().filter(|e| e["status"] == "DENIED").count();
    println!("W4 five: {state}, denied {denied}");
    assert_eq!(denied, 5, "{edits:?}");
    assert!(edits.iter().all(|e| e["status"] != "SUCCEEDED"), "{edits:?}");
    assert_ne!(state, "COMPLETED", "{state}");
}
