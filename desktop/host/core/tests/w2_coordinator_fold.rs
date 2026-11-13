// W-2 (تكليف المالك 2026-10-28): ضغط المنسّق يطوي ردًّا أخيرًا يتجاوز النافذة وحده. قِيس على Bonsai 16k: فشل المساعد، فقرأ
// المنسّق الأجزاء الثمانية بنفسه في ردّ واحد، فرُفض دوران (74,625 و77,317 حرفًا)؛ الضغط من السجلّ يُبقي آخر 4 رسائل فلا يطويه.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية ويعلن نافذة صغيرة. البوابة والأدوات والمرفقات والتوجيه وسجلّ الجلسة حقيقية.

mod p08_support;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::watch::measure::{self, MEASURE_KEY};

const WINDOW: u64 = 12_000;
const FILES: usize = 8;
static READ: AtomicBool = AtomicBool::new(false);

fn stream(parts: Vec<Value>) -> Reply {
    Reply::Stream { content_type: "text/event-stream", parts: parts.into_iter().map(|p| format!("data: {p}\n\n")).chain(std::iter::once("data: [DONE]\n\n".to_string())).collect(), gap: Duration::ZERO }
}

fn say(content: &str) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "content": content } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

fn calls(list: Vec<(String, Value)>) -> Reply {
    let calls: Vec<Value> = list
        .into_iter()
        .enumerate()
        .map(|(i, (name, args))| json!({ "index": i, "id": format!("call-{name}-{i}"), "type": "function", "function": { "name": name, "arguments": args.to_string() } }))
        .collect();
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "tool_calls": calls } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "tool_calls" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

/// المنسّق يقرّر أن يعمل بنفسه، ثم يقرأ الأجزاء الثمانية في ردّ واحد، ثم يردّ.
fn coordinator_batch_reader() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        match r.path.as_str() {
            "/api/v0/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": WINDOW } ] }).to_string()),
            "/v1/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
            _ => {}
        }
        let b = r.body.as_str();
        if b.contains("Summarise the transcript below") {
            return say("Summary: the user asked to read the eight parts of inputs/; the agent read all eight; each lists quarterly figures per region, all confirmed.");
        }
        if b.contains("\"name\":\"handle_directly\"") && !b.contains("call-handle_directly") {
            return calls(vec![("handle_directly".into(), json!({}))]);
        }
        if !READ.swap(true, Ordering::SeqCst) {
            return calls((0..FILES).map(|i| ("read_file".to_string(), json!({ "path": format!("inputs/part{i}.txt") }))).collect());
        }
        say("I read all eight parts.")
    }))
}

fn part(i: usize) -> String {
    (0..90).map(|l| format!("Part {i} line {l}: the quarterly figures for region {l} were reviewed and confirmed.\n")).collect()
}

#[test]
fn w2_the_coordinator_folds_a_last_turn_that_alone_outgrows_the_window() {
    let h = p08_support::build(Some(coordinator_batch_reader()));
    let m = h.ok("mission.create", json!({ "title": "w2c", "objective": "Read the eight attached parts in inputs/ yourself and tell me when they are read" }))["mission_id"].as_str().unwrap().to_string();
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
    let calls = h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default();
    let reads = calls.iter().filter(|i| i["tool_id"] == "polaris.workspace.read" && i["status"] == "SUCCEEDED").count();
    let requests: Vec<String> = h.model.as_ref().unwrap().recorded().into_iter().filter(|r| r.body.contains("Summarise the transcript below")).map(|r| r.body).collect();
    println!("W2 coordinator: state {state}, summaries {summaries}, summary requests {}, reads {reads}, {s:?}", requests.len());
    assert_eq!(s.failed_turns, 0, "a model turn failed (the window refused the request): {s:?}");
    assert!(summaries >= 1, "the coordinator never summarised");
    assert_eq!(reads, FILES, "{calls:?}");
    // نصّ التلخيص كامل بلا قصّ وسط، على دفعات تتّسع في النافذة.
    assert!(requests.iter().all(|b| !b.contains("characters clipped by POLARIS") && (b.len() as u64) / 4 < WINDOW), "a clipped or oversize summary request");
    assert_eq!(state, "COMPLETED", "{state}");
}
