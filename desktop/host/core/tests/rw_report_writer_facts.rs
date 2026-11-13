// RW-A وRW-B (تكليف المالك 2026-10-27): حقائق يقيسها المضيف عن الملفات المكتوبة، كلٌّ خلف مفتاح مطفأ افتراضيًّا.
// RW-A: نتيجة التفويض تذكر حجم كل ملف كتبه المفوَّض وكلماته وعناوينه، وأن المصحِّح فحص تقرير العقد وحده.
// RW-B: الكتابة المطابقة بايتًا لآخر كتابة للمسار تُذكر، وكذلك عدد كتابات المسار من الثالثة.
//
// TEST FIXTURE: النموذج مُبرمَج على الحلقة المحلية. البوابة والأدوات والمساحة وسجلّ الجلسة والمصحِّح حقيقية.

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

/// 6 كلمات مفصولة بالمسافات، وعنوانان.
const REPORT: &str = "## Summary\nok\n## Risks\nfew\n";

/// مسار تقرير العقد كما يظهر في تعليمة المساعد.
fn contract_path(body: &str) -> Option<String> {
    let at = body.find("outputs/agents/")?;
    let rest = &body[at..];
    let end = rest.find("report.md")? + "report.md".len();
    Some(rest[..end].to_string())
}

/// المنسّق يفوّض إلى كاتب التقارير؛ المساعد يكتب التقرير ثم تقرير عقده ثم يردّ؛ ثم يردّ المنسّق.
fn delegating_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        let helper = b.contains("[DELEGATED_TASK") || b.contains("[AGENT_REQUEST to");
        let results = b.matches("\"role\":\"tool\"").count();
        if helper {
            return match (results, contract_path(b)) {
                (0, _) => call("write_file", json!({ "path": "outputs/report.md", "content": REPORT })),
                (1, Some(path)) => call("write_file", json!({ "path": path, "content": "## Summary\nThe report at outputs/report.md was written for this request.\n" })),
                _ => say("Wrote outputs/report.md."),
            };
        }
        if results == 0 {
            let agent = if b.contains("agent.writing.report-writer") { "agent.writing.report-writer".to_string() } else { b.split("- agent.").nth(1).and_then(|rest| rest.split_whitespace().next()).map(|id| format!("agent.{id}")).unwrap_or_default() };
            return call("delegate_task", json!({ "agent_id": agent, "objective": "Write a short executive report at outputs/report.md" }));
        }
        say("The report is at outputs/report.md.")
    }))
}

/// يكتب المحتوى نفسه مرتين ثم محتوى ثالثًا للمسار نفسه، ثم يردّ.
fn rewriting_model() -> MockServer {
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
            0 | 1 => call("write_file", json!({ "path": "outputs/notes.md", "content": "first" })),
            2 => call("write_file", json!({ "path": "outputs/notes.md", "content": "second" })),
            _ => say("Wrote outputs/notes.md."),
        }
    }))
}

fn run(h: &p08_support::Harness, objective: &str) -> (String, String) {
    let m = h.ok("mission.create", json!({ "title": "rw", "objective": objective }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": m }));
    let state = h.ok("mission.start", json!({ "mission_id": m }))["state"].as_str().unwrap_or("").to_string();
    (m, state)
}

/// نصوص نتائج أداة باسمها من سجلّ الجلسة، بترتيبها.
fn tool_results(h: &p08_support::Harness, mission: &str, name: &str) -> Vec<String> {
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 AND kind = 'TOOL_RESULT' ORDER BY rowid").unwrap();
    let rows: Vec<String> = stmt.query_map([mission], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    rows.iter().filter_map(|p| serde_json::from_str::<Value>(p).ok()).filter(|p| p["name"] == name).map(|p| p["text"].as_str().unwrap_or("").to_string()).collect()
}

const REPORT_REQUEST: &str = "Write a short executive report about remote work for small businesses at outputs/report.md with the headings Summary and Risks";

#[test]
fn rw_a_with_the_flag_on_the_delegation_result_carries_measured_file_facts_and_the_grader_scope() {
    let h = p08_support::build(Some(delegating_model()));
    h.host().phase03().unwrap().set_deliverable_facts(true);
    let (m, state) = run(&h, REPORT_REQUEST);
    let delegated = tool_results(&h, &m, "delegate_task");
    println!("RW-A on: {state} {delegated:?}");
    let result = delegated.first().expect("no delegation result");
    assert!(result.contains("[POLARIS_MEASURED]"), "{result}");
    assert!(result.contains(&format!("outputs/report.md: {} bytes, 6 words", REPORT.len())), "{result}");
    assert!(result.contains("headings in order: Summary | Risks"), "{result}");
    assert!(result.contains("The contract grader checked only outputs/agents/"), "{result}");
    // تقرير العقد يفحصه المصحِّح؛ لا يُكرَّر في الحقائق.
    assert!(!result.contains("outputs/agents/writing/report-writer/report.md: "), "{result}");
    assert!(!result.to_lowercase().contains("no need"), "{result}");
}

#[test]
fn rw_a_is_off_by_default() {
    let h = p08_support::build(Some(delegating_model()));
    let (m, _) = run(&h, REPORT_REQUEST);
    let delegated = tool_results(&h, &m, "delegate_task");
    assert!(!delegated.is_empty(), "no delegation happened");
    assert!(delegated.iter().all(|t| !t.contains("[POLARIS_MEASURED]")), "{delegated:?}");
}

#[test]
fn rw_b_with_the_flag_on_an_identical_write_and_the_third_write_are_noted_and_still_made() {
    let h = p08_support::build(Some(rewriting_model()));
    h.host().phase03().unwrap().set_rewrite_note(true);
    let (m, state) = run(&h, "Write a short note at outputs/notes.md");
    let writes = tool_results(&h, &m, "write_file");
    println!("RW-B on: {state} {writes:?}");
    assert_eq!(writes.len(), 3, "{writes:?}");
    assert!(writes.iter().all(|t| t.starts_with("status: SUCCEEDED")), "a write was blocked: {writes:?}");
    assert!(!writes[0].contains("host note:"), "{}", writes[0]);
    assert!(writes[1].contains("did not change outputs/notes.md") && !writes[1].contains("times in this task"), "{}", writes[1]);
    assert!(writes[2].contains("outputs/notes.md 3 times in this task") && !writes[2].contains("did not change"), "{}", writes[2]);
    let preview = h.ok("workspace.preview", json!({ "mission_id": m, "path": "outputs/notes.md" })).to_string();
    assert!(preview.contains("second"), "the third write was not made: {preview}");
    assert_eq!(state, "COMPLETED", "{state}");
}

#[test]
fn rw_b_is_off_by_default() {
    let h = p08_support::build(Some(rewriting_model()));
    let (m, _) = run(&h, "Write a short note at outputs/notes.md");
    let writes = tool_results(&h, &m, "write_file");
    assert_eq!(writes.len(), 3, "{writes:?}");
    assert!(writes.iter().all(|t| !t.contains("did not change") && !t.contains("times in this task")), "{writes:?}");
}
