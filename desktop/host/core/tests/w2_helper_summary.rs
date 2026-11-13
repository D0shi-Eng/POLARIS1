// W-2 (تكليف المالك 2026-10-27): تلخيص سياق الوكيل المفوَّض. كان ضغط المساعد تقليمًا فقط يحمي أحدث 8 نواتج، فثماني قراءات
// كبيرة تتجاوز النافذة وحدها، ويرفض التوجيه كل دور (Bonsai 16k: 4/4 BLOCKED). المطلوب: نداء تلخيص واحد يطوي الأقدم في
// رسالة المهمّة ويُبقي آخر دور، فتكتمل المهمّة بلا دور يضيع على رفض النافذة.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية ويعلن نافذة صغيرة. البوابة والأدوات والمرفقات والتوجيه والتفويض حقيقية.

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
        json!({ "id": "c", "choices": [ { "delta": { "tool_calls": [ { "index": 0, "id": format!("call-{name}-{}", READ.load(Ordering::SeqCst)), "type": "function", "function": { "name": name, "arguments": args.to_string() } } ] } } ] }),
        json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "tool_calls" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
    ])
}

/// المنسّق يفوّض القراءة؛ المساعد يقرأ الأجزاء واحدًا تلو الآخر ويلخّص حين يُطلب التلخيص؛ ثم يردّ كلٌّ منهما.
fn delegating_reader() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        match r.path.as_str() {
            "/api/v0/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": WINDOW } ] }).to_string()),
            "/v1/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
            _ => {}
        }
        let b = r.body.as_str();
        if b.contains("Summarise the transcript below") {
            return say("Summary: the helper read parts 0 to 3 of inputs/; each part lists quarterly figures per region, all confirmed; parts 4 to 7 remain.");
        }
        if b.contains("[DELEGATED_TASK") {
            let read = READ.fetch_add(1, Ordering::SeqCst);
            return if read < FILES { call("read_file", json!({ "path": format!("inputs/part{read}.txt") })) } else { say("I read all eight parts; each confirms the quarterly figures for its regions.") };
        }
        if b.matches("\"role\":\"tool\"").count() == 0 {
            return call("delegate_task", json!({ "objective": "Read the eight parts in inputs/ (part0.txt to part7.txt) one after another and report one line per part" }));
        }
        say("The helper read all eight parts.")
    }))
}

fn part(i: usize) -> String {
    (0..90).map(|l| format!("Part {i} line {l}: the quarterly figures for region {l} were reviewed and confirmed.\n")).collect()
}

#[test]
fn w2_a_helper_summarises_its_context_before_the_model_window_refuses_the_request() {
    let h = p08_support::build(Some(delegating_reader()));
    let m = h.ok("mission.create", json!({ "title": "w2h", "objective": "Delegate reading the eight attached parts in inputs/ and tell me when they are read" }))["mission_id"].as_str().unwrap().to_string();
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
    let helper_summaries: Vec<&Value> = rows.iter().filter(|p| p.get(MEASURE_KEY).and_then(Value::as_str) == Some(measure::HELPER_SUMMARY)).collect();
    let recorded = h.model.as_ref().unwrap().recorded();
    let after_summary = recorded.iter().any(|r| r.body.contains("[DELEGATED_TASK") && r.body.contains("POLARIS summary of earlier work in this task"));
    let calls = h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default();
    let reads = calls.iter().filter(|i| i["tool_id"] == "polaris.workspace.read" && i["status"] == "SUCCEEDED").count();
    println!("W2 helper: state {state}, helper summaries {helper_summaries:?}, reads {reads}, {s:?}");
    // لا دور يضيع على رفض النافذة، في المنسّق ولا في المساعد.
    assert_eq!(s.failed_turns, 0, "a model turn failed (the window refused the request): {s:?}");
    // المساعد لخّص سياقه، والملخّص وصله في دوره التالي.
    assert!(!helper_summaries.is_empty(), "the helper never summarised its context");
    assert!(helper_summaries.iter().all(|p| p["bytes_after"].as_u64() < p["bytes_before"].as_u64()), "{helper_summaries:?}");
    assert!(after_summary, "the helper's next request did not carry the summary");
    assert_eq!(reads, FILES, "{calls:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}

/// الحالة المقيسة على Bonsai 16k (2026-10-27): المساعد يقرأ الأجزاء الثمانية في ردّ واحد، فيتجاوز آخر دور وحده النافذة.
fn batch_reader() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        match r.path.as_str() {
            "/api/v0/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": WINDOW } ] }).to_string()),
            "/v1/models" => return Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
            _ => {}
        }
        let b = r.body.as_str();
        if b.contains("Summarise the transcript below") {
            return say("Summary: the helper read all eight parts of inputs/ in one step; each lists quarterly figures per region, all confirmed; nothing remains to read.");
        }
        if b.contains("[DELEGATED_TASK") {
            if b.contains("\"role\":\"tool\"") || b.contains("POLARIS summary of earlier work in this task") {
                return say("I read all eight parts; each confirms the quarterly figures for its regions.");
            }
            let calls: Vec<Value> = (0..FILES)
                .map(|i| json!({ "index": i, "id": format!("call-read-{i}"), "type": "function", "function": { "name": "read_file", "arguments": json!({ "path": format!("inputs/part{i}.txt") }).to_string() } }))
                .collect();
            return stream(vec![
                json!({ "id": "c", "choices": [ { "delta": { "tool_calls": calls } } ] }),
                json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "tool_calls" } ], "usage": { "prompt_tokens": 100, "completion_tokens": 20 } }),
            ]);
        }
        if b.matches("\"role\":\"tool\"").count() == 0 {
            return call("delegate_task", json!({ "objective": "Read the eight parts in inputs/ (part0.txt to part7.txt) and report one line per part" }));
        }
        say("The helper read all eight parts.")
    }))
}

#[test]
fn w2_a_helper_whose_last_turn_alone_outgrows_the_window_folds_that_turn_too() {
    let h = p08_support::build(Some(batch_reader()));
    let m = h.ok("mission.create", json!({ "title": "w2b", "objective": "Delegate reading the eight attached parts in inputs/ and tell me when they are read" }))["mission_id"].as_str().unwrap().to_string();
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
    let helper_summaries: Vec<&Value> = rows.iter().filter(|p| p.get(MEASURE_KEY).and_then(Value::as_str) == Some(measure::HELPER_SUMMARY)).collect();
    let calls = h.ok("tool.activity.list", json!({ "mission_id": m }))["invocations"].as_array().cloned().unwrap_or_default();
    let reads = calls.iter().filter(|i| i["tool_id"] == "polaris.workspace.read" && i["status"] == "SUCCEEDED").count();
    println!("W2 helper batch: state {state}, helper summaries {helper_summaries:?}, reads {reads}, {s:?}");
    assert_eq!(s.failed_turns, 0, "a model turn failed (the window refused the request): {s:?}");
    assert!(helper_summaries.iter().any(|p| p["ok"] == true && p["bytes_after"].as_u64() < p["bytes_before"].as_u64()), "{helper_summaries:?}");
    assert_eq!(reads, FILES, "the helper read again what it had read: {calls:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}

/// الخيار 2 (قرار المالك 2026-10-28): بعد الملخّص سطر حقائق مضيف بالملفات التي قرأها المساعد وأحجامها وهل أُعيدت كاملة.
#[test]
fn w2_after_a_helper_summary_a_host_fact_line_lists_the_files_read_and_their_sizes() {
    let h = p08_support::build(Some(batch_reader()));
    let m = h.ok("mission.create", json!({ "title": "w2f", "objective": "Delegate reading the eight attached parts in inputs/ and tell me when they are read" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let ids: Vec<Value> = (0..FILES)
        .map(|i| h.ok("attachment.stage", json!({ "file_name": format!("part{i}.txt"), "content_base64": base64::engine::general_purpose::STANDARD.encode(part(i)) }))["attachment"]["attachment_id"].clone())
        .collect();
    h.ok("attachment.bind", json!({ "mission_id": m, "attachment_ids": ids }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    let recorded = h.model.as_ref().unwrap().recorded();
    let after = recorded.iter().find(|r| r.body.contains("[DELEGATED_TASK") && r.body.contains("POLARIS summary of earlier work in this task")).expect("no helper request after the summary");
    let body = &after.body;
    println!("W2 facts: state {state}");
    assert!(body.contains("[POLARIS_MEASURED] Files this agent already read in this task"), "no fact line after the summary");
    for i in 0..FILES {
        let fact = format!("inputs/part{i}.txt: {} bytes, returned in full", part(i).len());
        assert!(body.contains(&fact), "missing {fact}");
    }
    assert_eq!(state, "COMPLETED", "{state}");
}

/// الخيار (أ) (قرار المالك 2026-10-28): نصّ التلخيص كامل بلا قصّ للوسط، على دفعات تتّسع كلٌّ منها في النافذة. كان كل ناتج
/// يُقصّ إلى 3,000 حرف، فكتب المساعد على Bonsai «the middle of each file was clipped» وأعاد القراءة.
#[test]
fn w2_a_helper_summary_sees_every_part_whole_in_window_sized_chunks() {
    let h = p08_support::build(Some(batch_reader()));
    let m = h.ok("mission.create", json!({ "title": "w2c", "objective": "Delegate reading the eight attached parts in inputs/ and tell me when they are read" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let ids: Vec<Value> = (0..FILES)
        .map(|i| h.ok("attachment.stage", json!({ "file_name": format!("part{i}.txt"), "content_base64": base64::engine::general_purpose::STANDARD.encode(part(i)) }))["attachment"]["attachment_id"].clone())
        .collect();
    h.ok("attachment.bind", json!({ "mission_id": m, "attachment_ids": ids }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    let summaries: Vec<String> = h.model.as_ref().unwrap().recorded().into_iter().filter(|r| r.body.contains("Summarise the transcript below")).map(|r| r.body).collect();
    println!("W2 chunks: state {state}, summary requests {}, sizes {:?}", summaries.len(), summaries.iter().map(String::len).collect::<Vec<_>>());
    assert!(summaries.iter().all(|b| !b.contains("characters clipped by POLARIS")), "a summary request carried a clipped result");
    for i in 0..FILES {
        // السطر الأوسط من كل جزء يصل نداء تلخيص: لا قصّ للوسط.
        let middle = format!("Part {i} line 45:");
        assert!(summaries.iter().any(|b| b.contains(&middle)), "no summary request saw {middle}");
    }
    // كل دفعة تتّسع في النافذة بتقدير التوجيه (بايتات ÷ 4)، فلا يرفضها.
    assert!(summaries.iter().all(|b| (b.len() as u64) / 4 < WINDOW), "a summary request exceeds the window");
    assert_eq!(state, "COMPLETED", "{state}");
}
