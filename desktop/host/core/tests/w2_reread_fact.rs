// W-2 (تكليف المالك 2026-10-28): حقيقة «أُعيد هذا المحتوى نفسه كاملًا من قبل» على إعادة القراءة. قِيس على Bonsai 16k: المساعد
// يعيد قراءة ملفات قرأها كاملة «ليتحقق»، حتى تنفد الميزانية. الحقيقة لا تمنع القراءة؛ تقول ما قاسه المضيف فقط.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية. البوابة والأدوات والمرفقات وسجلّ الجلسة حقيقية.

mod p08_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};

static STEP: AtomicUsize = AtomicUsize::new(0);

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
        json!({ "id": "c", "choices": [ { "delta": { "tool_calls": [ { "index": 0, "id": format!("call-{name}-{}", STEP.load(Ordering::SeqCst)), "type": "function", "function": { "name": name, "arguments": args.to_string() } } ] } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "tool_calls" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

/// يقرأ الملف، ثم يقرؤه ثانية بالوسائط نفسها، ثم بسقف أصغر (محتوى مختلف)، ثم يردّ.
fn rereader() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        match r.path.as_str() {
            "/api/v0/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
            "/v1/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
            _ => {}
        }
        let b = r.body.as_str();
        if b.contains("\"name\":\"handle_directly\"") && !b.contains("call-handle_directly") {
            return call("handle_directly", json!({}));
        }
        match STEP.fetch_add(1, Ordering::SeqCst) {
            0 | 1 => call("read_file", json!({ "path": "inputs/notes.txt" })),
            2 => call("read_file", json!({ "path": "inputs/notes.txt", "max_chars": 200 })),
            _ => say("I read inputs/notes.txt."),
        }
    }))
}

#[test]
fn w2_a_re_read_of_the_same_full_content_carries_a_host_fact_and_still_runs() {
    let h = p08_support::build(Some(rereader()));
    let m = h.ok("mission.create", json!({ "title": "w2r", "objective": "Read the attached notes.txt in inputs/ and tell me when it is read" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let text: String = (0..60).map(|l| format!("Note line {l}: the figures were reviewed.\n")).collect();
    let id = h.ok("attachment.stage", json!({ "file_name": "notes.txt", "content_base64": base64::engine::general_purpose::STANDARD.encode(&text) }))["attachment"]["attachment_id"].clone();
    h.ok("attachment.bind", json!({ "mission_id": m, "attachment_ids": [id] }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();

    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 AND kind = 'TOOL_RESULT' ORDER BY rowid").unwrap();
    let reads: Vec<String> = stmt
        .query_map([&m], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .filter_map(|p| serde_json::from_str::<Value>(&p).ok())
        .filter(|p| p["name"] == "read_file")
        .map(|p| p["text"].as_str().unwrap_or("").to_string())
        .collect();
    println!("W2 reread: state {state}, {} reads", reads.len());
    assert_eq!(reads.len(), 3, "{reads:?}");
    assert!(reads.iter().all(|t| t.starts_with("status: SUCCEEDED")), "a read was blocked: {reads:?}");
    assert!(!reads[0].contains("already returned"), "{}", reads[0]);
    assert!(reads[1].contains("POLARIS already returned this exact content of inputs/notes.txt to you in full earlier in this task"), "{}", reads[1]);
    // سقف أصغر = محتوى مختلف: لا حقيقة «نفسه».
    assert!(!reads[2].contains("already returned"), "{}", reads[2]);
    assert_eq!(state, "COMPLETED", "{state}");
}
