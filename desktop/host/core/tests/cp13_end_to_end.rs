// PHASE-13 — الوكلاء والأدوات والمهارات معًا، عبر المضيف الحقيقي (تكليف المالك 2026-10-20): هدف المستخدم ← السياق والذاكرة ← المنسّق
// ← حلّ القدرة ← اختيار الوكيل ← تفويض الأداة ← التنفيذ ← الملاحظة ← التحقّق ← تسليم المخرَج ← تحديث الذاكرة.
//
// TEST FIXTURE: النموذج مُبرمَج (خادم على الحلقة المحلية يجيب بنداءات أصيلة بحسب ما في المحادثة)، وخادم بحث SearXNG تجهيزة. كل ما
// عداهما حقيقي: بوابة الأدوات، والأدوات، ومولّد PDF ومحقّقه، وصندوق التنفيذ التجهيزة (يشغّل Python فعلًا بلا عزل)، والأدلة،
// والذاكرة. ما لا يُثبَت هنا: أن نموذجًا حقيقيًا يختار هذه الخطوات (ذلك PHASE-15).

mod p08_support;

use std::time::Duration;

use serde_json::{json, Value};

use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::agents::AgentDirectory;

const SEARCH_RESULT: &str = "The Riyadh metro opened its first lines in December 2024.";

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

fn offered(body: &str, tool: &str) -> bool {
    body.contains(&format!("\"name\":\"{tool}\""))
}

/// كم نتيجة أداة في المحادثة حتى الآن: موضع الخطوة في السيناريو.
fn step(body: &str) -> usize {
    body.matches("\"role\":\"tool\"").count()
}

fn helper(body: &str) -> bool {
    body.contains("[AGENT_REQUEST to") || body.contains("[DELEGATED_TASK")
}

/// المرشّحون كما رآهم المنسّق في تعليمة النظام.
fn candidates(body: &str) -> Vec<String> {
    let Some(start) = body.find("<candidate_agents>") else { return Vec::new() };
    let end = body[start..].find("</candidate_agents>").map(|e| start + e).unwrap_or(body.len());
    body[start..end]
        .split("\\n")
        .filter_map(|l| l.trim().strip_prefix("- "))
        .filter_map(|l| l.split_whitespace().next())
        .filter(|id| id.starts_with("agent."))
        .map(str::to_string)
        .collect()
}

fn models(r: &Recorded) -> Option<Reply> {
    match r.path.as_str() {
        "/api/v0/models" => Some(Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "arch": "fixture", "state": "loaded", "max_context_length": 32768 } ] }).to_string())),
        "/v1/models" => Some(Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string())),
        _ => None,
    }
}

/// «ابحث عن موضوع وأنشئ تقرير PDF»: المنسّق يتولّاه بنفسه، يبحث، ثم ينشئ PDF من النتيجة، ثم يردّ مقتبسًا ما جلبه.
fn report_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        let route = offered(b, "handle_directly");
        let at = step(b) - usize::from(route && step(b) > 0);
        if route && step(b) == 0 {
            return call("handle_directly", json!({}));
        }
        match at {
            0 => call("web_search", json!({ "query": "Riyadh metro opening date" })),
            1 => call(
                "create_document",
                json!({ "format": "pdf", "path": "outputs/metro-report.pdf", "spec": { "title": "Riyadh Metro", "language": "en", "blocks": [ { "type": "heading", "text": "Riyadh Metro", "level": 1 }, { "type": "paragraph", "text": SEARCH_RESULT } ] } }),
            ),
            _ => say(&format!("I searched the web and wrote the report to outputs/metro-report.pdf. The source says \u{ab}{SEARCH_RESULT}\u{bb}")),
        }
    }))
}

fn search_server() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if r.path.starts_with("/search") {
            Reply::Json(200, json!({ "results": [ { "title": "Riyadh metro opens", "url": "https://example.org/metro", "content": SEARCH_RESULT } ] }).to_string())
        } else {
            Reply::Json(404, "{}".into())
        }
    }))
}

fn begin(h: &p08_support::Harness, objective: &str) -> String {
    let id = h.ok("mission.create", json!({ "title": "cp13", "objective": objective }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    id
}

/// يبدأ المهمّة، ويوافق على كل ما تنتظره كما يوافق المستخدم، حتى تنتهي. يعيد الحالة وعدد الموافقات المطلوبة.
fn run_to_end(h: &p08_support::Harness, mission: &str) -> (String, usize) {
    let mut approvals = 0;
    for _ in 0..6 {
        let state = h.ok("mission.start", json!({ "mission_id": mission }))["state"].as_str().unwrap_or("").to_string();
        if state != "WAITING_FOR_APPROVAL" {
            return (state, approvals);
        }
        for a in h.ok("approval.list", json!({ "mission_id": mission }))["approvals"].as_array().cloned().unwrap_or_default() {
            if a["status"] == "PENDING" {
                approvals += 1;
                h.ok("tool.approval.respond", json!({ "approval_id": a["approval_id"], "decision": "GRANT" }));
            }
        }
    }
    ("STILL_WAITING".into(), approvals)
}

fn invocations(h: &p08_support::Harness, mission: &str) -> Vec<Value> {
    h.ok("tool.activity.list", json!({ "mission_id": mission }))["invocations"].as_array().cloned().unwrap_or_default()
}

#[test]
fn cp13_search_a_topic_and_deliver_a_verified_pdf_report_through_the_real_host() {
    let search = search_server();
    let h = p08_support::build(Some(report_model()));
    h.ok("integration.settings.set", json!({ "key": "web.search_provider", "value": "SEARXNG" }));
    h.ok("integration.settings.set", json!({ "key": "web.search_endpoint", "value": search.url() }));
    let m = begin(&h, "Search the web for when the Riyadh metro opened and write a short PDF report at outputs/metro-report.pdf");
    let (state, approvals) = run_to_end(&h, &m);
    println!("CP13 report: state {state}, approvals asked {approvals}");
    let calls = invocations(&h, &m);
    let tool = |id: &str| calls.iter().find(|i| i["tool_id"] == id).cloned();
    // 2 و5: أداة البحث المناسبة، وبحث فعلي بلغ الخادم.
    assert_eq!(tool("polaris.web.search").map(|i| i["status"].clone()), Some(json!("SUCCEEDED")), "{calls:?}");
    assert!(search.recorded().iter().any(|r| r.path.contains("q=Riyadh")), "the search never reached the search server");
    // 7 و8: PDF صالح، أُعيد فتحه وتُحقّق منه.
    assert_eq!(tool("polaris.artifact.document").map(|i| i["status"].clone()), Some(json!("SUCCEEDED")), "{calls:?}");
    let artifacts = h.ok("artifact.list", json!({ "mission_id": m }))["artifacts"].as_array().cloned().unwrap_or_default();
    let pdf = artifacts.iter().find(|a| a["file_ref"] == "outputs/metro-report.pdf").cloned().expect("the PDF is not among the mission's artifacts");
    assert_eq!(pdf["verification"]["status"], "VERIFIED", "{pdf}");
    // 6: النتيجة عولجت ووصلت المخرَج.
    assert!(pdf["preview"]["excerpt"].as_str().unwrap_or("").contains("December 2024"), "the search result did not reach the PDF: {pdf}");
    // 10: الأدلة: كل نداء ناجح سجّل دليله، والاقتباس في الردّ مؤصَّل فيما جُلب، والفعل المدّعى مسنود.
    assert!(calls.iter().filter(|i| i["status"] == "SUCCEEDED").all(|i| i["evidence_id"].is_string() || i["evidence_recorded"] == true || i.get("evidence_id").is_some()), "{calls:?}");
    let reqs = h.ok("mission.get", json!({ "mission_id": m }))["mission"]["requirements"].as_array().cloned().unwrap_or_default();
    let status_of = |prefix: &str| reqs.iter().find(|r| r["requirement_id"].as_str().is_some_and(|id| id.starts_with(prefix) && !id.starts_with("AGENT-"))).map(|r| r["status"].clone());
    println!("CP13 report requirements: {}", reqs.iter().map(|r| format!("{}={}", r["requirement_id"], r["status"])).collect::<Vec<_>>().join(" "));
    assert_eq!(status_of("Q"), Some(json!("SATISFIED")), "the quotation was not grounded in the fetched page");
    assert_eq!(status_of("A"), Some(json!("SATISFIED")), "the reported search was not backed");
    // 11: الذاكرة حُدّثت ضمن السياسة: حلقة المهمّة محفوظة، وغير محقَّقة.
    let memories = h.ok("memory.list", json!({ "mission_id": m }))["memories"].as_array().cloned().unwrap_or_default();
    assert!(!memories.is_empty(), "the finished mission left no memory");
    assert!(memories.iter().all(|e| e["verification"] != "EVIDENCE_LINKED" || e["confidence_source"] == "RUNTIME_EVIDENCE"), "memory raised its own trust: {memories:?}");
    assert_eq!(state, "COMPLETED", "{state}");
}

/// «راجع مشروعًا برمجيًا وأصلح الأخطاء»: المنسّق يفوّض إلى وكيل برمجيات من المرشّحين، والوكيل يقرأ ويصلح ويشغّل الاختبارات في
/// الصندوق ويكتب تقرير عقده، والمنسّق يردّ بما قيس.
fn code_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| {
        if let Some(reply) = models(r) {
            return reply;
        }
        let b = r.body.as_str();
        if helper(b) {
            // الوكيل المفوَّض إليه كما يسمّيه مسار تقرير عقده في الطلب.
            let directory = AgentDirectory::builtin();
            let id = directory.definitions().iter().find(|d| b.contains(d.output.report_path.as_str())).map(|d| d.agent_id.clone()).unwrap_or_default();
            return match step(b) {
                0 => call("read_file", json!({ "path": "inputs/calc.py" })),
                1 => call("write_file", json!({ "path": "work/project/calc.py", "content": "def add(a, b):\n    return a + b\n" })),
                2 => call(
                    "run_python",
                    json!({ "code": "import shutil, sys, unittest\nshutil.copy('inputs/test_calc.py', 'work/project/test_calc.py')\nsys.path.insert(0, 'work/project')\nsuite = unittest.defaultTestLoader.discover('work/project')\nresult = unittest.TextTestRunner(verbosity=2).run(suite)\nsys.exit(0 if result.wasSuccessful() else 1)\n", "timeout_seconds": 60 }),
                ),
                3 => match directory.get(&id) {
                    Some(d) => call("write_file", json!({ "path": d.output.report_path, "content": polaris_host_core::p03::agents::grader::conforming_report(d, "add() returned a - b; it now returns a + b, and the two tests pass.") })),
                    None => say("unknown agent"),
                },
                _ => say("Fixed add() in work/project/calc.py; the tests pass."),
            };
        }
        if step(b) == 0 {
            let directory = AgentDirectory::builtin();
            let shown = candidates(b);
            let fit = shown.iter().find(|id| directory.get(id).is_some_and(|d| d.allows("polaris.execution.python") && d.allows("polaris.workspace.write") && d.allows("polaris.workspace.read")));
            return match fit {
                Some(id) => call("delegate_task", json!({ "objective": "Review the project in inputs (calc.py and test_calc.py), fix the bug so the tests pass, work in work/project, and run the tests.", "agent_id": id })),
                None => say(&format!("NO_FITTING_AGENT among {shown:?}")),
            };
        }
        say("The helper fixed add() in work/project/calc.py and ran the tests; all tests passed.")
    }))
}

fn base64_of(text: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

#[test]
fn cp13_review_a_code_project_and_fix_it_with_a_chosen_agent_and_measured_tests() {
    let h = p08_support::build(Some(code_model()));
    if h.sandbox.python.is_none() {
        println!("P08-NOT-TESTED: no Python interpreter on this machine; the code scenario is measured natively");
        return;
    }
    let m = begin(&h, "Review the code project I attached (calc.py with its tests) and fix the bug so the tests pass");
    let files = [("calc.py", "def add(a, b):\n    return a - b\n"), ("test_calc.py", "import unittest\nfrom calc import add\n\n\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n\n    def test_zero(self):\n        self.assertEqual(add(0, 0), 0)\n")];
    let ids: Vec<Value> = files.iter().map(|(name, text)| h.ok("attachment.stage", json!({ "file_name": name, "content_base64": base64_of(text) }))["attachment"]["attachment_id"].clone()).collect();
    h.ok("attachment.bind", json!({ "mission_id": m, "attachment_ids": ids }));
    let (state, approvals) = run_to_end(&h, &m);
    // الوكيل المعرَّف كما سجّله المضيف (عرض الوكيل في العقد لا يحمل معرّف التعريف).
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let chosen: Option<String> = db.query_row("SELECT definition_id FROM agent_instances WHERE mission_id = ?1 AND definition_id IS NOT NULL", [&m], |r| r.get(0)).ok();
    println!("CP13 code: state {state}, approvals asked {approvals}, agent {chosen:?}");
    // اختيار الوكيل المناسب: وكيل من الدليل يحمل القراءة والكتابة والتشغيل.
    let chosen = chosen.expect("no catalog agent was chosen");
    let definition = AgentDirectory::builtin().get(&chosen).expect("the chosen agent exists");
    assert!(definition.allows("polaris.execution.python"), "{chosen} cannot run code");
    // لا صلاحية خارج نطاق المهمّة: ما عُرض على المساعد من قائمته المسموحة وحدها.
    let helper_calls: Vec<Recorded> = h.model.as_ref().unwrap().recorded().into_iter().filter(|r| r.path.ends_with("/chat/completions") && helper(&r.body)).collect();
    let first: Value = serde_json::from_str(&helper_calls.first().expect("the helper was never called").body).unwrap();
    let names: Vec<String> = first["tools"].as_array().cloned().unwrap_or_default().iter().filter_map(|t| t["function"]["name"].as_str().map(str::to_string)).collect();
    let allowed: Vec<String> = definition.tools.iter().map(|t| polaris_host_core::p03::agent_loop::loop_tool_name(t)).collect();
    let stray: Vec<&String> = names.iter().filter(|n| !allowed.contains(n) && n.as_str() != polaris_host_core::p03::tool_selection::LOAD_TOOLS).collect();
    assert!(stray.is_empty(), "the helper was offered tools outside {chosen}'s allowlist: {stray:?}");
    // التنفيذ: قراءة، وكتابة الإصلاح، وتشغيل الاختبارات في الصندوق.
    let calls = invocations(&h, &m);
    for id in ["polaris.workspace.read", "polaris.workspace.write", "polaris.execution.python"] {
        assert!(calls.iter().any(|i| i["tool_id"] == id && i["status"] == "SUCCEEDED"), "{id} did not succeed: {calls:?}");
    }
    // حفظ التعديلات وإثبات نجاح الاختبارات بالقياس.
    let fixed = h.ok("workspace.preview", json!({ "mission_id": m, "path": "work/project/calc.py" }));
    assert!(fixed.to_string().contains("return a + b"), "{fixed}");
    let runs = h.ok("execution.runs", json!({ "mission_id": m }))["runs"].as_array().cloned().unwrap_or_default();
    let run = runs.first().cloned().expect("no execution run was recorded");
    assert_eq!(run["exit_code"], 0, "{run}");
    let python = calls.iter().find(|i| i["tool_id"] == "polaris.execution.python").unwrap();
    assert!(python["summary"].as_str().unwrap_or("").contains("TESTS_PASSED"), "the trusted adapter did not mark the run as passing tests: {python}");
    // تقرير حقيقي: عقد الوكيل اجتاز المصحِّح، وقول «الاختبارات نجحت» مسنود بتشغيل موسوم.
    let reqs = h.ok("mission.get", json!({ "mission_id": m }))["mission"]["requirements"].as_array().cloned().unwrap_or_default();
    println!("CP13 code requirements: {}", reqs.iter().map(|r| format!("{}={}", r["requirement_id"], r["status"])).collect::<Vec<_>>().join(" "));
    assert!(reqs.iter().any(|r| r["requirement_id"] == "AGENT-1" && r["status"] == "SATISFIED"), "the agent's report did not pass its contract");
    // CP-13-1: «حتى تنجح الاختبارات» دخلت عقد الطلب متطلَّبًا يقيسه تشغيل موسوم، لا تقرير الوكيل وحده.
    assert!(reqs.iter().any(|r| r["requirement_id"].as_str().is_some_and(|id| id.starts_with('R')) && r["status"] == "SATISFIED"), "the request's passing tests are not a measured requirement");
    let action = reqs.iter().find(|r| r["requirement_id"].as_str().is_some_and(|id| id.starts_with('A') && !id.starts_with("AGENT-"))).cloned();
    assert_eq!(action.map(|r| r["status"].clone()), Some(json!("SATISFIED")), "the reported passing tests were not backed by a measured run");
    assert_eq!(state, "COMPLETED", "{state}");
}
