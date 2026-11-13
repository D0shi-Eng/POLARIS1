// W-3 (تكليف المالك 2026-10-27): `polaris.workspace.edit` عبر المضيف الحقيقي — تُعرض في الأساس، وتمرّ بالبوابة بلا موافقة،
// وترفض نصًّا غير موجود بسبب صياغة يقول ما يُفعل، وتعدّل موضعًا واحدًا ويبقى الباقي.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية. البوابة والأدوات ومساحة العمل حقيقية.

mod p08_support;

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

const PAGE: &str = "<html>\n<h1>Old title</h1>\n<p>keep this paragraph</p>\n</html>\n";

/// يكتب الصفحة، ثم يحاول تعديل نصّ غير موجود، ثم يعدّل العنوان، ثم يردّ.
fn edit_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        let results = b.matches("\"role\":\"tool\"").count();
        let route = b.contains("\"name\":\"handle_directly\"");
        if route && results == 0 {
            return call("handle_directly", json!({}));
        }
        match results - usize::from(route) {
            0 => call("write_file", json!({ "path": "outputs/index.html", "content": PAGE })),
            1 => call("edit_file", json!({ "path": "outputs/index.html", "old_text": "<h1>Missing</h1>", "new_text": "<h1>New title</h1>" })),
            2 => call("edit_file", json!({ "path": "outputs/index.html", "old_text": "<h1>Old title</h1>", "new_text": "<h1>New title</h1>" })),
            _ => say("I changed the title in outputs/index.html."),
        }
    }))
}

#[test]
fn w3_edit_file_changes_one_place_through_the_gateway_without_approval() {
    let h = p08_support::build(Some(edit_model()));
    let m = h.ok("mission.create", json!({ "title": "w3", "objective": "Write a small page at outputs/index.html titled Old title, then change its title to New title" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    let calls = h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default();
    let edits: Vec<&Value> = calls.iter().filter(|i| i["tool_id"] == "polaris.workspace.edit").collect();
    println!("W3: state {state}, edits {edits:?}");
    // المعروض: الأداة في القائمة الأساسية من أول نداء.
    let first = h.model.as_ref().unwrap().recorded().into_iter().find(|r| r.path.ends_with("/chat/completions")).expect("no model call");
    assert!(first.body.contains("\"name\":\"edit_file\""), "edit_file was not offered with the core tools");
    // نصّ غير موجود: رفض صياغة لا يكتب شيئًا، ثم تعديل ناجح.
    // ترتيب `tool.activity.list` غير مضمون لنداءين في الثانية نفسها: يُفحص الرفض والنجاح لا موضعهما.
    assert_eq!(edits.len(), 2, "{calls:?}");
    assert!(edits.iter().any(|e| e["status"] == "DENIED" && e["denial_reason"] == "ARGUMENTS_INVALID"), "{edits:?}");
    assert!(edits.iter().any(|e| e["status"] == "SUCCEEDED"), "{edits:?}");
    // لا موافقة لكتابة داخل المساحة.
    let approvals = h.ok("approval.list", json!({ "mission_id": m }))["approvals"].as_array().cloned().unwrap_or_default();
    assert!(approvals.is_empty(), "an approval was asked for a workspace edit: {approvals:?}");
    // الملف: العنوان وحده تغيّر.
    let preview = h.ok("workspace.preview", json!({ "mission_id": m, "path": "outputs/index.html" })).to_string();
    assert!(preview.contains("New title") && !preview.contains("Old title") && preview.contains("keep this paragraph"), "{preview}");
    assert_eq!(state, "COMPLETED", "{state}");
}
