// قياس بنموذج حقيقي لتكليف الإغلاق الوظيفي (ADR-042)، بإذن المالك (2026-10-19): نموذج محلي واحد يشغّله المالك بنفسه.
//
// لا يعمل إلا بـ`--ignored` ومع متغيّرات تسمّي المزوّد والنموذج: `POLARIS_FC_PROVIDER` (ollama أو lm-studio أو local-openai-compatible)،
// و`POLARIS_FC_MODEL` (معرّف POLARIS الكامل «مزوّد:نموذج»)، و`POLARIS_FC_ENDPOINT` اختياري على الحلقة المحلية. البيانات في مجلد اختبار
// معزول، ومخزن الاعتماد في الذاكرة: لا مفتاح للمالك ولا قاعدته. ما يُسجَّل هو ما حدث فعلًا؛ سلوك النموذج نفسه لا يُفرض.

mod p08_support;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use p08_support::{build, Harness};
use polaris_host_core::p08::notify::{Delivery, SystemNotifier};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn configure(h: &Harness) -> String {
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
    model
}

struct Recording(Mutex<Vec<String>>);

impl SystemNotifier for Recording {
    fn notify(&self, _title: &str, body: &str, _sound: bool) -> Delivery {
        self.0.lock().unwrap().push(body.to_string());
        Delivery::Shown
    }
}

fn db(h: &Harness) -> rusqlite::Connection {
    rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

fn conversation(h: &Harness, objective: &str) -> String {
    let id = h.ok("mission.create", json!({ "title": "fc-real", "objective": objective, "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    id
}

/// R1: دور حقيقي قصير. يُسجَّل: الحالة، وقرار التوجيه إن عُرضت قائمة مرشحين، والإشعار، وصحّة المزوّد بعد النداء.
#[test]
#[ignore]
fn fc_real_a_short_turn_completes_routes_and_notifies() {
    let h = build(None);
    let model = configure(&h);
    let recording = Arc::new(Recording(Mutex::new(Vec::new())));
    h.host().phase08().unwrap().notifications.bind(recording.clone());
    let id = conversation(&h, "Reply with one short sentence that says hello.");
    let started = Instant::now();
    let run = h.call("mission.start", json!({ "mission_id": id }));
    let seconds = started.elapsed().as_secs_f64();
    let state = run["result"]["state"].as_str().unwrap_or("ERROR").to_string();
    let conn = db(&h);
    let session: Vec<String> = {
        let mut stmt = conn.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 ORDER BY seq").unwrap();
        stmt.query_map([&id], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap).collect()
    };
    let offered = session.iter().any(|p| p.contains("candidate agents"));
    let routed = session.iter().find(|p| p.contains("\"delegate_task\"") || p.contains("\"handle_directly\"")).map(|p| if p.contains("delegate_task") { "DELEGATE_TASK" } else { "HANDLE_DIRECTLY" });
    let health = h.ok("provider.list", json!({}))["providers"].as_array().unwrap().iter().find(|p| model.starts_with(&format!("{}:", p["provider_id"].as_str().unwrap()))).map(|p| p["health"].clone()).unwrap_or(Value::Null);
    let notified = recording.0.lock().unwrap().clone();
    println!("FC-REAL R1 state={state} seconds={seconds:.1} candidates_offered={offered} routing={routed:?} notified={notified:?} health={health}");
    assert!(matches!(state.as_str(), "COMPLETED" | "BLOCKED" | "FAILED" | "WAITING_FOR_APPROVAL"), "the turn did not end: {run}");
    assert_eq!(notified.len(), 1, "a finished real turn must notify once");
    // دور التوجيه (677ad3f) يمنع أداة العمل قبل القرار، ولا يفرض قرارًا على ردّ نصّي مباشر: قِيس 2026-10-19 على Bonsai أن «Hello!»
    // بلا أداة ردّ مشروع. فالشرط: إن نادى المنسّق أداة عمل فقد سبقها قرار توجيه.
    let worked = session.iter().any(|p| p.contains(r#""tool_calls":[{"#) && !p.contains("delegate_task") && !p.contains("handle_directly"));
    if offered && worked {
        assert!(routed.is_some(), "a work tool ran with no routing decision before it");
    }
}

/// R2: رسالة أثناء التشغيل مع نموذج حقيقي. تُرسل حين يبدأ الدور، ثم يُسجَّل: هل وصلت (DELIVERED بوقتها) أم انتهى الدور قبلها
/// (NOT_DELIVERED)، وهل أثّرت في الملف. لا تبقى QUEUED في أي حال.
#[test]
#[ignore]
fn fc_real_a_note_sent_while_the_turn_runs_is_delivered_or_closed() {
    let h = build(None);
    configure(&h);
    let id = conversation(&h, "Create the file outputs/fruits.md that lists three fruits, one per line. Then reply briefly.");
    let p03 = h.host().phase03().unwrap().clone();
    let conversations = h.host().phase08().unwrap().conversations.clone();
    let note = std::thread::scope(|scope| {
        let runner = scope.spawn(|| h.call("mission.start", json!({ "mission_id": id })));
        // الرسالة حين يصير الدور يعمل فعلًا (وإلا رُفضت كما ينبغي).
        let deadline = Instant::now() + Duration::from_secs(120);
        let mut sent = None;
        while Instant::now() < deadline && sent.is_none() {
            let state = p03.repository.load(&id).map(|s| s.mission.state.as_str()).unwrap_or("?");
            if matches!(state, "PLANNING" | "READY" | "RUNNING") {
                sent = conversations.add_note(&id, "Also add the line DONE as the last line of outputs/fruits.md.").ok();
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        let run = runner.join().unwrap();
        (sent, run)
    });
    let (sent, run) = note;
    let state = run["result"]["state"].as_str().unwrap_or("ERROR").to_string();
    let notes = h.ok("conversation.get", json!({ "mission_id": id }))["conversation"]["turns"][0]["notes"].clone();
    let workspace = h.ok("workspace.preview", json!({ "mission_id": id, "path": "outputs/fruits.md" }));
    let file = workspace["text"].as_str().unwrap_or("").to_string();
    println!("FC-REAL R2 state={state} note_sent={} notes={notes} file={file:?}", sent.is_some());
    assert!(sent.is_some(), "the turn never reached a running state to receive the note");
    let final_state = notes[0]["state"].as_str().unwrap_or("");
    assert!(final_state == "DELIVERED" || final_state == "NOT_DELIVERED", "a note was left {final_state}");
}
