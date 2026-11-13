// نقل agentmemory (2026-10-24): مهمّتان قصيرتان بنموذج حقيقي محلي واحد على ذاكرة مشروع في مخزن اختبار معزول. ذاكرة المستخدم من
// «تذكّر هذا» تُحفظ تفضيلًا يدخل كل طلب (G-08-3)، فلا تختبر الترتيب؛ ذاكرة المشروع تُرتَّب. السؤال يصل إلى
// المدخل الصحيح بالتجذيع وحده (لا كلمة مشتركة بصيغتها)، فيُسجَّل: هل دخل المدخل سياق المهمّة (جدول `memory_access`)، وهل
// ذكر الردّ الحقيقة، وحالة المهمّة وزمنها. سلوك النموذج لا يُفرض؛ الشرط الوحيد أن تنتهي المهمّة.
//
// `--ignored` مع متغيّرات `fc_real_model.rs` نفسها: `POLARIS_FC_PROVIDER` و`POLARIS_FC_MODEL` و`POLARIS_FC_ENDPOINT` اختياريًّا.
// `MEMBENCH_REPORT=<dir>` يكتب السجلّ JSON (تحت `_local`).

mod p08_support;

use std::time::Instant;

use serde_json::{json, Value};

use p08_support::{build, Harness};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn configure(h: &Harness) {
    let provider = env("POLARIS_FC_PROVIDER").expect("POLARIS_FC_PROVIDER");
    let model = env("POLARIS_FC_MODEL").expect("POLARIS_FC_MODEL");
    match env("POLARIS_FC_ENDPOINT") {
        Some(endpoint) => h.ok("provider.configure", json!({ "provider_id": provider, "endpoint": endpoint })),
        None => h.ok("provider.configure", json!({ "provider_id": provider, "enabled": true })),
    };
    let refresh = h.ok("provider.refresh", json!({ "provider_ids": [provider] }));
    assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "the named provider is not reachable: {}", refresh["results"][0]["health"]);
    h.ok("model.configure", json!({ "model_id": model, "enabled": true }));
    h.ok("model.preferences.set", json!({ "default_model_id": model }));
}

struct Task {
    label: &'static str,
    question: &'static str,
    /// ما يدلّ في الردّ على أنه استعمل الحقيقة المحفوظة (أيّ واحد منها يكفي).
    evidence: &'static [&'static str],
}

const TASKS: [Task; 2] = [
    Task { label: "en_stem", question: "How long before appointments is the reminder sent? Answer in one short sentence.", evidence: &["day", "24"] },
    Task {
        label: "ar_affix",
        question: "\u{0645}\u{0627} \u{0627}\u{0644}\u{0630}\u{064A} \u{0642}\u{0631}\u{0631}\u{0646}\u{0627}\u{0647} \u{0628}\u{0634}\u{0623}\u{0646} \u{0627}\u{0644}\u{062A}\u{0642}\u{0633}\u{064A}\u{0637}\u{061F} \u{0623}\u{062C}\u{0628} \u{0628}\u{062C}\u{0645}\u{0644}\u{0629} \u{0648}\u{0627}\u{062D}\u{062F}\u{0629}.",
        evidence: &["\u{062A}\u{0623}\u{062C}\u{064A}\u{0644}", "\u{0628}\u{0639}\u{062F} \u{0627}\u{0644}\u{0625}\u{0637}\u{0644}\u{0627}\u{0642}", "postpone"],
    },
];

#[test]
#[ignore = "needs one local model: POLARIS_FC_PROVIDER and POLARIS_FC_MODEL"]
fn mt01_real_model_answers_from_a_memory_reached_only_by_stemming() {
    let h = build(None);
    configure(&h);
    let project = h.ok("project.create", json!({ "name": "Noor" }))["project"]["project_id"].as_str().unwrap().to_string();
    let remember = |text: &str, topic: &str| {
        h.ok("memory.remember", json!({ "text": text, "topic": topic, "scope": "PROJECT", "project_id": project }))["memory_id"].as_str().unwrap().to_string()
    };
    let reminders = remember("The Noor clinic app sends appointment reminders by SMS a day ahead", "noor reminders");
    let decision = remember("\u{0642}\u{0631}\u{0631}\u{0646}\u{0627} \u{062A}\u{0623}\u{062C}\u{064A}\u{0644} \u{0645}\u{064A}\u{0632}\u{0629} \u{0627}\u{0644}\u{062F}\u{0641}\u{0639} \u{0628}\u{0627}\u{0644}\u{062A}\u{0642}\u{0633}\u{064A}\u{0637} \u{0625}\u{0644}\u{0649} \u{0645}\u{0627} \u{0628}\u{0639}\u{062F} \u{0627}\u{0644}\u{0625}\u{0637}\u{0644}\u{0627}\u{0642}", "decision");
    remember("I drive a 2019 Toyota Camry", "car");
    remember("My blood type is O negative", "blood type");
    remember("Sahm operates delivery trucks in Dammam", "fleet");
    let targets = [reminders, decision];

    let conn = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut rows: Vec<Value> = Vec::new();
    for (task, target) in TASKS.iter().zip(&targets) {
        let id = h.ok("mission.create", json!({ "title": task.label, "objective": task.question, "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
        h.ok("conversation.begin", json!({ "mission_id": id }));
        h.ok("conversation.update", json!({ "thread_id": id, "project_id": project }));
        let started = Instant::now();
        let run = h.call("mission.start", json!({ "mission_id": id }));
        let seconds = started.elapsed().as_secs_f64();
        let state = run["result"]["state"].as_str().unwrap_or("ERROR").to_string();
        let in_context: i64 = conn
            .query_row("SELECT count(*) FROM memory_access WHERE mission_id = ?1 AND memory_id = ?2 AND purpose = 'AGENT_CONTEXT'", [&id, target], |r| r.get(0))
            .unwrap();
        let view = h.ok("conversation.get", json!({ "mission_id": id }));
        let turn = view["conversation"]["turns"][0].clone();
        let text = turn.to_string();
        let answered = task.evidence.iter().any(|e| text.contains(e));
        println!("MT01-REAL {} state={state} seconds={seconds:.1} memory_in_context={} answer_uses_memory={answered}", task.label, in_context > 0);
        rows.push(json!({ "task": task.label, "state": state, "seconds": seconds, "memory_in_context": in_context > 0, "answer_uses_memory": answered, "turn": turn }));
        assert!(matches!(state.as_str(), "COMPLETED" | "BLOCKED" | "FAILED" | "WAITING_FOR_APPROVAL"), "the turn did not end: {run}");
    }
    if let Some(dir) = env("MEMBENCH_REPORT") {
        std::fs::write(std::path::Path::new(&dir).join("mt01-real.json"), serde_json::to_string_pretty(&rows).unwrap()).unwrap();
    }
}
