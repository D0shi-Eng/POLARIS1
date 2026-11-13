// W-2 (تكليف المالك 2026-10-28): معايرة تقدير الرموز بما يبلّغه الخادم. قِيس على Bonsai 16k: طلبات المساعد بلغت 15,192–16,275
// رمزًا حقيقيًّا والتقدير (بايتات ÷ 4) يراها متّسعة، فرفض الخادم الطلب التالي (InvalidRequest). الإصلاح: نسبة الحقيقي إلى
// التقدير من كل دور، وأكبرها تقسم النافذة قبل حساب حدّ الضغط.
//
// TEST FIXTURE: الخادم المُبرمَج يحسب الرموز الحقيقية 1.3 من تقدير البايتات (ما قيس على Bonsai) ويرفض ما يتجاوز النافذة كما
// يرفض llama-server. البوابة والأدوات والمرفقات والتوجيه وسجلّ الجلسة حقيقية.

mod p08_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::watch::measure::{self, MEASURE_KEY};

const WINDOW: u64 = 12_000;
const FILES: usize = 6;
static READ: AtomicUsize = AtomicUsize::new(0);

/// الرموز الحقيقية كما يعدّها هذا الخادم: 1.3 من بايتات الطلب ÷ 4.
fn real_tokens(body: &str) -> u64 {
    body.len() as u64 * 13 / 40
}

fn stream(parts: Vec<Value>) -> Reply {
    Reply::Stream { content_type: "text/event-stream", parts: parts.into_iter().map(|p| format!("data: {p}\n\n")).chain(std::iter::once("data: [DONE]\n\n".to_string())).collect(), gap: Duration::ZERO }
}

fn say(content: &str, prompt: u64) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "content": content } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": prompt, "completion_tokens": 20 } }),
    ])
}

fn call(name: &str, args: Value, prompt: u64) -> Reply {
    stream(vec![
        json!({ "id": "c", "choices": [ { "delta": { "tool_calls": [ { "index": 0, "id": format!("call-{name}-{}", READ.load(Ordering::SeqCst)), "type": "function", "function": { "name": name, "arguments": args.to_string() } } ] } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "tool_calls" } ], "usage": { "prompt_tokens": prompt, "completion_tokens": 20 } }),
    ])
}

/// المنسّق يعمل بنفسه ويقرأ جزءًا في كل دور، ثم يردّ. الخادم يرفض طلبًا رموزه الحقيقية أكبر من النافذة.
fn strict_server() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        match r.path.as_str() {
            "/api/v0/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": WINDOW } ] }).to_string()),
            "/v1/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
            _ => {}
        }
        let b = r.body.as_str();
        let prompt = real_tokens(b);
        if prompt > WINDOW {
            return Reply::Json(400, json!({ "error": { "code": 400, "message": format!("the request ({prompt} tokens) exceeds the available context size ({WINDOW} tokens)"), "type": "exceed_context_size_error" } }).to_string());
        }
        if b.contains("Summarise the transcript below") {
            return say("Summary: the user asked to read the parts of inputs/; the agent has read the parts listed so far; each lists confirmed quarterly figures.", prompt);
        }
        if b.contains("\"name\":\"handle_directly\"") && !b.contains("call-handle_directly") {
            return call("handle_directly", json!({}), prompt);
        }
        let read = READ.fetch_add(1, Ordering::SeqCst);
        if read < FILES {
            call("read_file", json!({ "path": format!("inputs/part{read}.txt") }), prompt)
        } else {
            say("I read all the parts.", prompt)
        }
    }))
}

fn part(i: usize) -> String {
    (0..60).map(|l| format!("Part {i} line {l}: the quarterly figures for region {l} were reviewed and confirmed.\n")).collect()
}

#[test]
fn w2_compaction_is_calibrated_by_the_real_token_counts_the_server_reports() {
    let h = p08_support::build(Some(strict_server()));
    let m = h.ok("mission.create", json!({ "title": "w2t", "objective": "Read the six attached parts in inputs/ yourself one after another and tell me when they are read" }))["mission_id"].as_str().unwrap().to_string();
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
    let refused = h.model.as_ref().unwrap().recorded().iter().filter(|r| r.path.ends_with("/chat/completions") && real_tokens(&r.body) > WINDOW).count();
    let calibrations: Vec<&Value> = rows.iter().filter(|p| p.get(MEASURE_KEY).and_then(Value::as_str) == Some(measure::TOKEN_CALIBRATION)).collect();
    println!("W2 calibration: state {state}, refused by the server {refused}, calibrations {calibrations:?}, {s:?}");
    assert_eq!(refused, 0, "the server refused requests that the estimate judged fitting");
    assert_eq!(s.failed_turns, 0, "{s:?}");
    assert!(calibrations.iter().any(|p| p["ratio_permille"].as_u64().unwrap_or(0) > 1_000), "no calibration was recorded: {calibrations:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}
