// الوكلاء الـ300 عبر المسار الذي يستعمله المستخدم فعلًا (القسم 6، البند 3): IPC ← خدمة المهمّة ← زمن التشغيل ← المخزن، بخادم نموذج
// تجهيزة على الحلقة المحلية (TEST FIXTURE). لكل وكيل: يُثبَّت بعملية `mission.specialist.set` كما تفعل الواجهة، وتبدأ المهمّة،
// ثم يُقاس من خارج زمن التشغيل:
// - في المخزن: مثيل وكيل يحمل معرّف التعريف وإصداره (الهوية التنفيذية محفوظة).
// - في طلب المزوّد الفعلي: تعليمة النظام تحمل عقد الوكيل، والأدوات المعروضة كلها من قائمة الوكيل.
//
// الحزم تُشغَّل بمدى: POLARIS_AGENTS_RANGE="0-50" (حدّ زمن غلاف التشغيل). بلا مدى: كل الـ300.

mod p08_support;

use std::time::Duration;

use serde_json::{json, Value};

use p08_support::build;
use p08_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::p03::agents::AgentDirectory;

fn text_model() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/v1/chat/completions" => Reply::Stream {
            content_type: "text/event-stream",
            parts: vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": "Done." } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 40, "completion_tokens": 2 } })),
                "data: [DONE]\n\n".to_string(),
            ],
            gap: Duration::ZERO,
        },
        _ => Reply::Json(404, "{}".into()),
    }))
}

/// أسماء الأدوات المعروضة في طلب المزوّد (الصيغة الأصيلة: tools[].function.name).
fn offered_tools(body: &str) -> Vec<String> {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    value.get("tools").and_then(Value::as_array).map(|t| t.iter().filter_map(|x| x.pointer("/function/name").and_then(Value::as_str).map(str::to_string)).collect()).unwrap_or_default()
}

/// PHASE-07: أسماء الأدوات المؤجَّلة التي يذكرها وصف `load_tools` في الطلب (`<group> (<summary>): a, b; ...`).
fn deferred_tools(body: &str) -> Vec<String> {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let Some(description) = value.get("tools").and_then(Value::as_array).and_then(|t| {
        t.iter().find(|x| x.pointer("/function/name").and_then(Value::as_str) == Some(polaris_host_core::p03::tool_selection::LOAD_TOOLS)).and_then(|x| x.pointer("/function/description").and_then(Value::as_str))
    }) else {
        return Vec::new();
    };
    description.split("; ").filter_map(|g| g.split_once("): ").map(|(_, names)| names)).flat_map(|names| names.split(", ").map(str::to_string)).collect()
}

#[test]
fn each_agent_is_reachable_through_ipc_with_its_identity_contract_and_tools() {
    let directory = AgentDirectory::builtin();
    let (from, to) = std::env::var("POLARIS_AGENTS_RANGE")
        .ok()
        .and_then(|r| r.split_once('-').and_then(|(a, b)| Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?))))
        .unwrap_or((0, directory.definitions().len()));
    let h = build(Some(text_model()));
    let mut failures = Vec::new();
    let mut with_deferred = 0usize;
    for d in &directory.definitions()[from..to.min(directory.definitions().len())] {
        let before = h.model.as_ref().unwrap().recorded().len();
        let id = h.ok("mission.create", json!({ "title": "agent", "objective": "Prepare a short note for Nakheel Labs.", "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
        h.ok("conversation.begin", json!({ "mission_id": id }));
        h.ok("mission.specialist.set", json!({ "mission_id": id, "specialist_id": d.specialist_id }));
        let started = h.call("mission.start", json!({ "mission_id": id }));
        let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let identity: Option<(String, String)> = db
            .query_row("SELECT definition_id, definition_version FROM agent_instances WHERE mission_id = ?1 AND definition_id IS NOT NULL", rusqlite::params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok();
        if identity != Some((d.agent_id.clone(), d.version.clone())) {
            failures.push(format!("{}: stored identity {identity:?}; start {started}", d.agent_id));
            continue;
        }
        let requests: Vec<Recorded> = h.model.as_ref().unwrap().recorded().into_iter().skip(before).filter(|r| r.path.ends_with("/chat/completions")).collect();
        let Some(first) = requests.first() else {
            failures.push(format!("{}: no provider request was made", d.agent_id));
            continue;
        };
        if !first.body.contains(&format!("[AGENT {} v{}", d.agent_id, d.version)) {
            failures.push(format!("{}: the system prompt does not carry the agent contract", d.agent_id));
        }
        let allowed: Vec<String> = d.tools.iter().map(|t| polaris_host_core::p03::agent_loop::loop_tool_name(t)).collect();
        let offered = offered_tools(&first.body);
        if !offered.iter().any(|t| t == "write_file") {
            failures.push(format!("{}: the provider request offered no workspace write (offered {offered:?})", d.agent_id));
        }
        // PHASE-07: `load_tools` أداة تشغيل كـ`plan`؛ ما يحمّله يجب أن يكون من القائمة المسموحة أيضًا.
        let mut named = offered.clone();
        let loadable = deferred_tools(&first.body);
        with_deferred += usize::from(!loadable.is_empty());
        named.extend(loadable);
        let stray: Vec<String> = named
            .into_iter()
            .filter(|t| t != polaris_host_core::p03::agent_loop::PLAN_TOOL && t != polaris_host_core::p03::tool_selection::LOAD_TOOLS && !allowed.contains(t))
            .collect();
        if !stray.is_empty() {
            failures.push(format!("{}: tools outside the allowlist were offered: {stray:?}", d.agent_id));
        }
    }
    println!("PHASE-07 agents whose first request named deferred tools: {with_deferred}");
    assert!(failures.is_empty(), "{} agents failed:\n{}", failures.len(), failures.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
}
