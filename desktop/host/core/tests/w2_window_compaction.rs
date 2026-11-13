// W-2 (تكليف المالك 2026-10-27): ضغط المحادثة بحسب نافذة النموذج الفعلية. كانت العتبة ثابتة (180,000 حرف) لا تعرف النافذة،
// فيرفض التوجيه الطلب بـ CONTEXT_TOO_LARGE قبل أن يُضغط شيء. المطلوب: ضغط استباقي قبل الرفض، فلا يضيع دور نموذج.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية ويعلن نافذة صغيرة. البوابة والأدوات والمرفقات والتوجيه حقيقية.

mod p08_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::watch::measure::{self, MEASURE_KEY};

const WINDOW: u64 = 12_000;
const FILES: usize = 8;
static READ: AtomicUsize = AtomicUsize::new(0);

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

/// يقرأ الملفات الثمانية واحدًا تلو الآخر، ويلخّص حين يُطلب التلخيص، ثم يردّ.
fn reader_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        match r.path.as_str() {
            "/api/v0/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": WINDOW } ] }).to_string()),
            "/v1/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
            _ => {}
        }
        let b = r.body.as_str();
        if b.contains("Summarise the transcript below") {
            return say("Summary: the agent has read the first files of inputs/ one by one; nothing failed; the remaining files are still to read.");
        }
        if b.contains("\"name\":\"handle_directly\"") && !b.contains("call-handle_directly") {
            return call("handle_directly", json!({}));
        }
        // عدّاد بين الطلبات: كل نداء غير التلخيص يقرأ الجزء التالي.
        let read = READ.fetch_add(1, Ordering::SeqCst);
        if read < FILES {
            call("read_file", json!({ "path": format!("inputs/part{read}.txt") }))
        } else {
            say("I read all eight parts.")
        }
    }))
}

fn part(i: usize) -> String {
    (0..90).map(|l| format!("Part {i} line {l}: the quarterly figures for region {l} were reviewed and confirmed.\n")).collect()
}

#[test]
fn w2_the_loop_compacts_before_the_model_window_refuses_the_request() {
    let h = p08_support::build(Some(reader_model()));
    let m = h.ok("mission.create", json!({ "title": "w2", "objective": "Read the eight attached parts in inputs/ one after another and tell me when you are done" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let ids: Vec<Value> = (0..FILES)
        .map(|i| h.ok("attachment.stage", json!({ "file_name": format!("part{i}.txt"), "content_base64": base64::engine::general_purpose::STANDARD.encode(part(i)) }))["attachment"]["attachment_id"].clone())
        .collect();
    h.ok("attachment.bind", json!({ "mission_id": m, "attachment_ids": ids }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();

    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 ORDER BY rowid").unwrap();
    let rows: Vec<Value> = stmt.query_map([&m], |r| r.get::<_, String>(0)).unwrap().filter_map(|r| r.ok()).filter_map(|p| serde_json::from_str(&p).ok()).collect();
    let s = measure::summarize(rows.iter().filter(|p| p.get(MEASURE_KEY).is_some()));
    let summaries = rows.iter().filter(|p| p.get("covers_from").is_some()).count();
    let refused = h.model.as_ref().unwrap().recorded().len();
    println!("W2: state {state}, summaries {summaries}, model requests {refused}, {s:?}");
    // لا دور يضيع على رفض النافذة: كل دور نموذج في الحلقة نجح.
    assert_eq!(s.failed_turns, 0, "a model turn failed (the window refused the request before compaction): {s:?}");
    // الضغط حدث قبل أن تتجاوز المحادثة النافذة.
    assert!(summaries >= 1, "the conversation was never compacted although it outgrew the model window");
    assert_eq!(state, "COMPLETED", "{state}");
}
