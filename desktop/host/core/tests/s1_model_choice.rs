// الجلسة 1 (خطة 2026-10-07، ADR-040): حرية اختيار النموذج بلا خيار «محلي/بعيد».
//
// كُتبت هذه الاختبارات قبل الإصلاح، وفشلها على `0803b99` محفوظ في evidence/plan-2026-10-07/S1/red/. كل اختبار يمرّ
// بالبوابة الحقيقية (الظرف والمخطط ونتيجة العقد) أو بمسار فتح القاعدة الذي يسلكه المنتج، فيقيس السلوك لا توقيع دالّة.
//
// ما يُقاس:
// - سياق مشروع يصل نموذج API اختاره المستخدم (كان يُرفض PROJECT_CONTEXT_POLICY).
// - لا حقل «محلي/بعيد» في تفضيلات النماذج ولا في المشروع، والعقد يرفض إرساله.
// - نموذج مراجعة محلي مقبول (كان يُرفض «المراجِع يجب أن يكون بعيدًا»).
// - لا مفتاح خصوصية «محلي فقط» ولا «اسمح بالنماذج البعيدة».
// - قاعدة v15 تُرقّى فتُحذف منها القيم المخزّنة للخيار، ونموذج المراجعة المخزّن الذي لا تُظهره الواجهة.

mod p06_support;

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use p06_support::support::{handler, MockServer, Recorded, Reply};
use polaris_host_core::ipc::gateway::Gateway;
use polaris_host_core::ipc::identity::TransportIdentity;
use polaris_host_core::p02::ports::{FixedPrompt, MapEnvironment, MemoryCredentialStore};
use polaris_host_core::p02::Phase02Config;
use polaris_host_core::services::host::DesktopHost;
use polaris_host_core::services::platform_info::PlatformInfoService;
use polaris_host_core::storage::{migrations, Database};
use rusqlite::Connection;
use serde_json::{json, Value};

const SESSION: &str = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
const FIXTURE_KEY: &str = "sk-fixture-000000000000000000000000";
static COUNTER: AtomicUsize = AtomicUsize::new(1);

fn uuid() -> String {
    polaris_host_core::ids::new_uuid_v4()
}

struct Harness {
    gateway: Arc<Gateway>,
}

fn build(remote_fixture: Option<String>) -> Harness {
    let config = Phase02Config {
        data_dir: None,
        credential_store: Arc::new(MemoryCredentialStore::default()),
        credential_prompt: Arc::new(FixedPrompt(Some(FIXTURE_KEY.to_string()))),
        environment: Arc::new(MapEnvironment(HashMap::new())),
        is_windows: false,
        remote_fixture,
    };
    let host = DesktopHost::with_phase02(PlatformInfoService::default(), config);
    assert!(host.phase02_failure().is_none());
    let gateway = Gateway::new(
        host,
        TransportIdentity { principal_id: "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60".into(), session_id: SESSION.into() },
        Box::new(uuid),
    );
    Harness { gateway: Arc::new(gateway) }
}

const SIDE_EFFECTING: &[&str] = &[
    "provider.configure", "provider.credential.set", "provider.refresh", "model.configure", "model.preferences.set", "model.invoke",
    "project.create", "project.update", "context.add",
];

impl Harness {
    fn call(&self, operation: &str, payload: Value) -> Value {
        let mut doc = json!({
            "contract_version": "1.2", "protocol_version": "1.2", "message_type": "REQUEST", "message_id": uuid(), "correlation_id": uuid(),
            "session_id": SESSION,
            "caller_identity": { "caller_type": "CORE_UI", "principal_id": "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60", "trust_tier": "TIER_2_UNTRUSTED", "session_id": SESSION },
            "timestamp": "2026-10-07T00:00:00Z", "operation": operation, "payload": payload,
        });
        if SIDE_EFFECTING.contains(&operation) {
            doc["idempotency_key"] = json!(format!("s1-idem-{:012}", COUNTER.fetch_add(1, Ordering::SeqCst)));
        }
        self.gateway.handle(&doc).response
    }

    fn ok(&self, operation: &str, payload: Value) -> Value {
        let response = self.call(operation, payload);
        assert!(response.get("error").is_none(), "{operation} failed: {}", response["error"]);
        response["result"].clone()
    }
}

/// خادم يتكلّم واجهة LM Studio (محلي) وواجهة OpenRouter (API) معًا، بنماذج تجهيزة.
fn fixture_server() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat", "type": "llm", "state": "loaded", "max_context_length": 32768 } ] }).to_string()),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" } ] }).to_string()),
        "/api/v1/models" => Reply::Json(200, json!({ "data": [ {
            "id": "fixture/remote-chat", "context_length": 100000,
            "architecture": { "input_modalities": ["text"], "output_modalities": ["text"] }
        } ]}).to_string()),
        "/v1/chat/completions" | "/api/v1/chat/completions" => Reply::Stream {
            content_type: "text/event-stream",
            parts: vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": "ok" } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 7, "completion_tokens": 1 } })),
                "data: [DONE]\n\n".to_string(),
            ],
            gap: Duration::ZERO,
        },
        _ => Reply::Json(404, "{}".into()),
    }))
}

fn chat_requests(server: &MockServer) -> Vec<Recorded> {
    server.recorded().into_iter().filter(|r| r.path.ends_with("/chat/completions")).collect()
}

fn api_model(h: &Harness) -> String {
    h.ok("provider.configure", json!({ "provider_id": "openrouter", "enabled": true }));
    let refresh = h.ok("provider.refresh", json!({ "provider_ids": ["openrouter"] }));
    assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "{refresh}");
    let id = "openrouter:fixture/remote-chat".to_string();
    h.ok("model.configure", json!({ "model_id": id, "enabled": true }));
    assert_eq!(h.ok("provider.credential.set", json!({ "provider_id": "openrouter" }))["outcome"], "STORED");
    id
}

fn local_model(h: &Harness, server: &MockServer) -> String {
    h.ok("provider.configure", json!({ "provider_id": "lm-studio", "endpoint": server.url() }));
    let refresh = h.ok("provider.refresh", json!({ "provider_ids": ["lm-studio"] }));
    assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "{refresh}");
    let id = "lm-studio:fixture-chat".to_string();
    h.ok("model.configure", json!({ "model_id": id, "enabled": true }));
    id
}

fn workspace() -> std::path::PathBuf {
    let dir = polaris_host_core::test_scratch::root().join(format!("s1-{}", uuid()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("notes.md"), "Project notes for the chosen model.").unwrap();
    dir
}

/// العيب المقيس: سياق مشروع إلى نموذج API اختاره المستخدم كان يُرفض `PROJECT_CONTEXT_POLICY` لأن كل مشروع جديد
/// يُنشأ «محلي فقط». الاختيار للمستخدم: النموذج الذي اختاره يستلم ما طلب إرساله إليه.
#[test]
fn s1_project_context_reaches_the_api_model_the_user_chose() {
    let server = fixture_server();
    let h = build(Some(server.url()));
    let remote = api_model(&h);
    let dir = workspace();
    let project = h.ok("project.create", json!({ "name": "S1", "workspace_root": dir.to_string_lossy() }))["project"].clone();
    let source = h.ok("context.add", json!({ "project_id": project["project_id"], "source_type": "FILE", "reference": "notes.md" }))["source"].clone();
    let result = h.ok("model.invoke", json!({
        "invocation_id": uuid(), "routing_mode": "MANUAL", "model_id": remote, "project_id": project["project_id"],
        "context_source_ids": [source["source_id"]], "messages": [ { "role": "USER", "text": "summarise" } ]
    }));
    assert_eq!(result["status"], "COMPLETED", "{result}");
    let sent = chat_requests(&server);
    assert_eq!(sent.len(), 1, "the chosen model never received the request");
    assert!(sent[0].body.contains("Project notes for the chosen model."), "the project context did not reach the chosen model");
    let _ = std::fs::remove_dir_all(dir);
}

/// لا حقل «محلي/بعيد» يُقرأ: تفضيلات النماذج والمشروع خاليان منه.
#[test]
fn s1_no_locality_field_is_reported_for_models_or_projects() {
    let h = build(None);
    let listed = h.ok("model.list", json!({}));
    let preferences = listed["preferences"].as_object().expect("model.list returns preferences");
    assert!(!preferences.contains_key("locality_preference"), "model preferences still carry a local/remote option: {listed}");
    let dir = workspace();
    let project = h.ok("project.create", json!({ "name": "S1", "workspace_root": dir.to_string_lossy() }))["project"].clone();
    assert!(project.get("context_policy").is_none(), "a project still carries a local/remote context policy: {project}");
    let _ = std::fs::remove_dir_all(dir);
}

/// العقد يرفض إرسال الخيار: لا مسار يكتبه.
#[test]
fn s1_the_contract_refuses_to_set_a_locality_preference() {
    let h = build(None);
    let response = h.call("model.preferences.set", json!({ "locality_preference": "LOCAL_ONLY" }));
    assert!(response.get("error").is_some(), "a local/remote preference was accepted: {response}");
    let dir = workspace();
    let response = h.call("project.create", json!({ "name": "S1", "workspace_root": dir.to_string_lossy(), "context_policy": "LOCAL_ONLY" }));
    assert!(response.get("error").is_some(), "a project local/remote policy was accepted: {response}");
    let _ = std::fs::remove_dir_all(dir);
}

/// نموذج المراجعة يختاره المستخدم من أيّ صنف. كان المحلي يُرفض «the reviewer must be a remote model».
#[test]
fn s1_a_local_review_model_is_accepted() {
    let server = fixture_server();
    let h = build(Some(server.url()));
    let local = local_model(&h, &server);
    let set = h.ok("model.preferences.set", json!({ "review_model_id": local }));
    assert_eq!(set["preferences"]["review_model_id"], local, "{set}");
}

/// لا مفتاح إعدادات يمنع النماذج البعيدة أو يقيّد كل شيء بالجهاز.
#[test]
fn s1_settings_have_no_local_only_or_remote_models_switch() {
    let h = p06_support::build();
    let described = h.ok("config.describe", json!({}));
    let text = described.to_string();
    for key in ["privacy.local_only", "privacy.allow_remote_models"] {
        assert!(!text.contains(&format!("\"{key}\"")), "the setting {key} still exists");
    }
}

/// قاعدة مستخدم v15 فيها قيم الخيار المخزّنة، ونموذج مراجعة مخزّن لا تُظهره الواجهة (قِيس في قاعدة المالك: مهمّة على
/// LM Studio أرسلت نداءً إلى Groq بسببه). الفتح يرقّيها: لا قيمة للخيار، ولا عمود سياسة سياق، ولا مراجِع خفيّ، والصفوف باقية.
#[test]
fn s1_an_upgraded_store_keeps_no_local_remote_value_and_no_hidden_reviewer() {
    let dir = polaris_host_core::test_scratch::root().join(format!("s1-v15-{}", uuid()));
    std::fs::create_dir_all(&dir).unwrap();
    {
        let mut conn = Connection::open(dir.join("polaris.db")).unwrap();
        migrations::apply_up_to(&mut conn, 15).unwrap();
        conn.execute_batch(
            "INSERT INTO preferences (key, value) VALUES ('locality_preference', 'LOCAL_ONLY'), ('review_model_id', 'groq:openai/gpt-oss-120b'), ('default_model_id', 'groq:openai/gpt-oss-120b');
             INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, context_policy, version, created_at, updated_at)
             VALUES ('15151515-1515-4515-8515-151515151515', 'kept', '', 'ACTIVE', 'ar', NULL, NULL, 'LOCAL_ONLY', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
             INSERT INTO config_values (layer, scope_id, setting_key, value_json, updated_at) VALUES ('USER', '', 'privacy.local_only', 'true', 't'), ('USER', '', 'privacy.allow_remote_models', 'false', 't'), ('USER', '', 'language.locale', '\"ar\"', 't');",
        )
        .unwrap();
    }
    let db = Database::open(&dir).unwrap();
    let (keys, columns, projects, config, default_model) = db
        .with(|c| {
            let keys: Vec<String> = c.prepare("SELECT key FROM preferences ORDER BY key")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            let columns: Vec<String> = c.prepare("SELECT name FROM pragma_table_info('projects')")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            let projects: i64 = c.query_row("SELECT count(*) FROM projects WHERE name = 'kept'", [], |r| r.get(0))?;
            let config: Vec<String> = c.prepare("SELECT setting_key FROM config_values ORDER BY setting_key")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            let default_model: Option<String> = c.query_row("SELECT value FROM preferences WHERE key = 'default_model_id'", [], |r| r.get(0)).ok();
            Ok((keys, columns, projects, config, default_model))
        })
        .unwrap();
    assert!(!keys.contains(&"locality_preference".to_string()), "the stored local/remote preference survived: {keys:?}");
    assert!(!keys.contains(&"review_model_id".to_string()), "a hidden stored reviewer survived the upgrade: {keys:?}");
    assert_eq!(default_model.as_deref(), Some("groq:openai/gpt-oss-120b"), "the user's chosen default model was lost");
    assert!(!columns.contains(&"context_policy".to_string()), "projects still carry a context policy column: {columns:?}");
    assert_eq!(projects, 1, "a project row was lost in the upgrade");
    assert_eq!(config, vec!["language.locale".to_string()], "a local/remote setting survived, or another setting was lost: {config:?}");
    drop(db);
    let _ = std::fs::remove_dir_all(dir);
}

/// قبول A4 (يدوي، لا يعمل في المجموعة): يرقّي نسخةً من قاعدة مستخدم حقيقية إلى v16 ويطبع العدد قبل وبعد. المجلد يمرَّر في
/// `S1_STORE_COPY_DIR` ويحوي `polaris.db` منسوخًا، لا الأصل. `cargo test --test s1_model_choice -- --ignored --nocapture`.
#[test]
#[ignore]
fn s1_acceptance_upgrade_a_copy_of_a_real_store() {
    let Ok(dir) = std::env::var("S1_STORE_COPY_DIR") else { panic!("S1_STORE_COPY_DIR is not set") };
    let dir = std::path::PathBuf::from(dir);
    let tables = ["missions", "tasks", "projects", "memories", "models", "usage_records", "audit_events", "p08_conversation_turns"];
    let count = |c: &Connection| -> Vec<(String, i64)> { tables.iter().map(|t| (t.to_string(), c.query_row(&format!("SELECT count(*) FROM {t}"), [], |r| r.get(0)).unwrap())).collect() };
    let (before, version_before, prefs_before) = {
        let c = Connection::open(dir.join("polaris.db")).unwrap();
        let prefs: Vec<(String, String)> = c.prepare("SELECT key, value FROM preferences ORDER BY key").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
        (count(&c), migrations::current_version(&c).unwrap(), prefs)
    };
    let db = Database::open(&dir).unwrap();
    let (after, version_after, prefs_after, columns, config) = db
        .with(|c| {
            let prefs: Vec<(String, String)> = c.prepare("SELECT key, value FROM preferences ORDER BY key")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
            let columns: Vec<String> = c.prepare("SELECT name FROM pragma_table_info('projects')")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            let config: Vec<String> = c.prepare("SELECT setting_key FROM config_values ORDER BY setting_key")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            Ok((count(c), migrations::current_version(c)?, prefs, columns, config))
        })
        .unwrap();
    println!("schema: v{version_before} -> v{version_after}");
    println!("preferences before: {prefs_before:?}");
    println!("preferences after:  {prefs_after:?}");
    println!("projects columns after: {columns:?}");
    println!("config keys after: {config:?}");
    for ((table, b), (_, a)) in before.iter().zip(after.iter()) {
        println!("{table}: {b} -> {a}");
    }
    assert_eq!(version_after, migrations::SUPPORTED_VERSION);
    assert_eq!(before, after, "a row count changed in the upgrade");
    assert!(prefs_after.iter().all(|(k, _)| k != "locality_preference" && k != "review_model_id"));
    assert!(!columns.contains(&"context_policy".to_string()));
}
