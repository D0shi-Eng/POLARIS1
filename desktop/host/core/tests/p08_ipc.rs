// P08-IPC — عمليات Phase-08 عبر البوابة الحقيقية: الظرف 1.7، ومخطط الحمولة، ومخطط النتيجة.
//
// كل نداء هنا يمرّ بالبوابة كما يمرّ نداء العارض: تحقّق الإصدار والهوية والحمولة، ثم المالك،
// ثم التحقّق من النتيجة بمخطّطها. نتيجة لا تطابق مخطّطها تعود خطأً داخليًّا، فنجاح `ok` هنا
// قياسٌ للعقد لا افتراض له.

mod p08_support;

use base64::Engine;
use p08_support::{build, leaks_path, uuid};
use serde_json::{json, Value};

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// رفض بالعقد: المخطط (رسالة مشوّهة) أو تحقّق المالك. ليس خطأً داخليًّا.
fn refused_by_contract(error: &Value) -> bool {
    matches!(error["code"].as_str(), Some("MALFORMED_MESSAGE" | "VALIDATION_ERROR"))
}

fn document(h: &p08_support::Harness, mission: &str, title: &str) -> Value {
    let spec = serde_json::from_value(json!({ "title": title, "blocks": [ { "type": "heading", "text": title }, { "type": "paragraph", "text": "POLARIS P08 fixture paragraph." } ] })).unwrap();
    let produced = h.host().phase08().unwrap().artifacts.document(mission, "docx", None, &spec, None, None).unwrap();
    serde_json::to_value(&produced.descriptor).unwrap()
}

#[test]
fn p08_ipc_attachments_stage_bind_list_and_refuse_executables_and_traversal() {
    let h = build(None);
    let staged = h.ok("attachment.stage", json!({ "file_name": "notes.txt", "content_base64": b64("alpha\nbeta".as_bytes()) }));
    let id = staged["attachment"]["attachment_id"].as_str().unwrap().to_string();
    assert_eq!(staged["attachment"]["classification"], "USER_PROVIDED_UNTRUSTED");
    assert!(staged["attachment"]["mission_id"].is_null());
    // الملفات التنفيذية تُرفض، باسمها أو بتوقيعها.
    let exe = h.err("attachment.stage", json!({ "file_name": "tool.exe", "content_base64": b64(b"MZ\x90\x00") }));
    assert_ne!(exe["code"], "INTERNAL_ERROR");
    let disguised = h.err("attachment.stage", json!({ "file_name": "report.txt", "content_base64": b64(b"MZ\x90\x00rest") }));
    assert_ne!(disguised["code"], "INTERNAL_ERROR");
    // الاسم مسارٌ: المخطط نفسه يرفض الفواصل.
    let traversal = h.err("attachment.stage", json!({ "file_name": "../../evil.txt", "content_base64": b64(b"x") }));
    assert!(refused_by_contract(&traversal), "{traversal}");
    let mission = uuid();
    let bound = h.ok("attachment.bind", json!({ "mission_id": mission, "attachment_ids": [id] }));
    assert_eq!(bound["attachments"][0]["workspace_ref"], "inputs/notes.txt");
    let listed = h.ok("attachment.list", json!({ "mission_id": mission }));
    assert_eq!(listed["attachments"].as_array().unwrap().len(), 1);
    let again = h.err("attachment.bind", json!({ "mission_id": uuid(), "attachment_ids": [id] }));
    assert_ne!(again["code"], "INTERNAL_ERROR");
    // المساحة تُظهر الملف، والمعاينة نصّه، ولا مسار مطلق يعبر.
    let ws = h.ok("workspace.list", json!({ "mission_id": mission }));
    assert!(ws["entries"].as_array().unwrap().iter().any(|e| e["path"] == "inputs/notes.txt"));
    let preview = h.ok("workspace.preview", json!({ "mission_id": mission, "path": "inputs/notes.txt" }));
    assert_eq!(preview["kind"], "TEXT");
    assert!(preview["text"].as_str().unwrap().contains("beta"));
    for v in [&staged, &bound, &listed, &ws, &preview] {
        assert!(!leaks_path(v, &h.data_dir), "an absolute path crossed the boundary: {v}");
    }
    let escape = h.err("workspace.preview", json!({ "mission_id": mission, "path": "../secrets.txt" }));
    assert_ne!(escape["code"], "INTERNAL_ERROR");
    let absolute = h.err("workspace.preview", json!({ "mission_id": mission, "path": "C:/Windows/win.ini" }));
    assert!(refused_by_contract(&absolute), "{absolute}");
}

#[test]
fn p08_ipc_artifacts_list_get_export_and_publish_only_after_a_decision() {
    let h = build(None);
    let mission = uuid();
    let artifact = document(&h, &mission, "Quarterly summary");
    let id = artifact["artifact_id"].as_str().unwrap();
    let listed = h.ok("artifact.list", json!({ "mission_id": mission }));
    assert_eq!(listed["artifacts"][0]["verification"]["status"], "VERIFIED");
    let got = h.ok("artifact.get", json!({ "artifact_id": id }));
    assert_eq!(got["artifact"]["type"], "DOCX");
    assert!(got["artifact"]["preview"]["excerpt"].as_str().unwrap().contains("Quarterly summary"));
    // التصدير: نسخة باسم الملف في مجلد التصدير، لا مسار مطلق في النتيجة، ولا استبدال.
    let file_ref = got["artifact"]["file_ref"].as_str().unwrap().to_string();
    let first = h.ok("workspace.export", json!({ "mission_id": mission, "path": file_ref }));
    let second = h.ok("workspace.export", json!({ "mission_id": mission, "path": file_ref }));
    assert_ne!(first["file_label"], second["file_label"], "an existing export was overwritten");
    assert!(h.export_dir.join(first["file_label"].as_str().unwrap()).is_file());
    assert!(!leaks_path(&first, &h.export_dir));
    // النشر: اقتراح ينتظر، والرفض لا ينشر، والموافقة تنشر مرة واحدة.
    let publishers = h.ok("publish.list", json!({}));
    assert_eq!(publishers["publishers"][0]["publisher_id"], "local-folder");
    assert_eq!(publishers["publishers"][0]["leaves_device"], false);
    let proposal = h.ok("publish.propose", json!({ "artifact_id": id, "publisher_id": "local-folder" }));
    assert_eq!(proposal["publication"]["status"], "AWAITING_APPROVAL");
    let pid = proposal["publication"]["publication_id"].as_str().unwrap();
    let denied = h.ok("publish.decide", json!({ "publication_id": pid, "decision": "DENY" }));
    assert_eq!(denied["publication"]["status"], "DENIED");
    let twice = h.err("publish.decide", json!({ "publication_id": pid, "decision": "GRANT" }));
    assert_ne!(twice["code"], "INTERNAL_ERROR");
    let p2 = h.ok("publish.propose", json!({ "artifact_id": id, "publisher_id": "local-folder" }))["publication"]["publication_id"].as_str().unwrap().to_string();
    let granted = h.ok("publish.decide", json!({ "publication_id": p2, "decision": "GRANT" }));
    assert_eq!(granted["publication"]["status"], "PUBLISHED");
    let unknown = h.err("publish.propose", json!({ "artifact_id": id, "publisher_id": "public-web" }));
    assert_eq!(unknown["code"], "POLICY_DENIED");
    // المشاركة: دور لعضو، ثم إزالته.
    let shared = h.ok("share.set", json!({ "object_type": "ARTIFACT", "object_id": id, "member": "sara@example.test", "role": "VIEWER" }));
    assert_eq!(shared["grants"][0]["role"], "VIEWER");
    let removed = h.ok("share.set", json!({ "object_type": "ARTIFACT", "object_id": id, "member": "sara@example.test", "role": null }));
    assert!(removed["grants"].as_array().unwrap().is_empty());
}

#[test]
fn p08_ipc_execution_status_is_measured_and_the_renderer_has_no_execution_operation() {
    let h = build(None);
    let status = h.ok("execution.status", json!({}));
    assert_eq!(status["isolation"], "TEST_FIXTURE_UNCONFINED");
    assert_eq!(status["python"]["available"], true);
    assert_eq!(status["powershell"]["available"], false);
    assert!(!leaks_path(&status, &h.data_dir));
    let runs = h.ok("execution.runs", json!({ "mission_id": uuid() }));
    assert!(runs["runs"].as_array().unwrap().is_empty());
    for forbidden in ["execution.command", "execution.python", "workspace.write", "browser.execute", "oauth.token.get", "email.send"] {
        let error = h.err(forbidden, json!({}));
        assert!(["CONTRACT_VIOLATION", "MALFORMED_MESSAGE", "VALIDATION_ERROR"].contains(&error["code"].as_str().unwrap()), "{forbidden}: {error}");
    }
    // اختيار نموذج مهمّة يُحفظ، ومعرّف فيه مسافة يرفضه المخطط.
    let m = uuid();
    assert_eq!(h.ok("mission.model.set", json!({ "mission_id": m, "model_id": "ollama:qwen2.5:7b" }))["model_id"], "ollama:qwen2.5:7b");
    assert!(refused_by_contract(&h.err("mission.model.set", json!({ "mission_id": m, "model_id": "bad id" }))));
}

#[test]
fn p08_ipc_schedules_are_saved_enabled_run_and_deleted_and_a_bad_schedule_is_refused() {
    let h = build(None);
    let payload = json!({ "name": "Morning digest", "mission_template": { "title": "Digest", "objective": "summarise the inputs" }, "timezone": "UTC+03:00",
        "schedule": { "kind": "DAILY", "time": "07:30" }, "enabled": true, "budget": {}, "approval_policy": "WAIT_FOR_APPROVAL" });
    let saved = h.ok("schedule.save", payload.clone());
    let id = saved["schedule"]["schedule_id"].as_str().unwrap().to_string();
    assert!(saved["schedule"]["next_run"].is_string());
    let disabled = h.ok("schedule.enable", json!({ "schedule_id": id, "enabled": false }));
    assert!(disabled["schedule"]["next_run"].is_null());
    let mut too_often = payload.clone();
    too_often["schedule"] = json!({ "kind": "INTERVAL", "minutes": 5 });
    assert!(refused_by_contract(&h.err("schedule.save", too_often)));
    let mut dst = payload.clone();
    dst["timezone"] = json!("Asia/Riyadh");
    assert!(refused_by_contract(&h.err("schedule.save", dst)));
    // «شغّل الآن» يبدأ في الخلفية؛ بلا نموذج مُعدّ يُسجَّل التشغيل فاشلًا بصدق، لا ناجحًا.
    assert_eq!(h.ok("schedule.run_now", json!({ "schedule_id": id }))["started"], true);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let run = loop {
        let list = h.ok("schedule.list", json!({}));
        if let Some(run) = list["schedules"][0]["recent_runs"].as_array().and_then(|r| r.first().cloned()) {
            break run;
        }
        assert!(std::time::Instant::now() < deadline, "the run never recorded");
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    assert_eq!(run["trigger_kind"], "RUN_NOW");
    assert_ne!(run["status"], "COMPLETED", "a mission with no model reported completion");
    assert_eq!(h.ok("schedule.delete", json!({ "schedule_id": id }))["deleted"], true);
}

/// ينتظر حتى يُسجَّل للجدول `count` تشغيلًا على الأقل، ويعيدها (الأحدث أولًا).
fn runs_of(h: &p08_support::Harness, count: usize) -> Vec<Value> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let list = h.ok("schedule.list", json!({}));
        let runs = list["schedules"][0]["recent_runs"].as_array().cloned().unwrap_or_default();
        if runs.len() >= count {
            return runs;
        }
        assert!(std::time::Instant::now() < deadline, "the run never recorded");
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

#[test]
fn p08_ipc_auto_a_monthly_same_task_schedule_continues_the_previous_runs_conversation() {
    let h = build(None);
    let payload = json!({ "name": "Monthly digest", "mission_template": { "title": "Digest", "objective": "summarise the inputs" }, "timezone": "UTC+03:00",
        "schedule": { "kind": "MONTHLY", "days": [1, 15], "time": "09:00" }, "enabled": true, "budget": {}, "approval_policy": "WAIT_FOR_APPROVAL", "run_target": "SAME_TASK" });
    let saved = h.ok("schedule.save", payload);
    assert_eq!(saved["schedule"]["run_target"], "SAME_TASK");
    assert!(saved["schedule"]["end_at"].is_null());
    let id = saved["schedule"]["schedule_id"].as_str().unwrap().to_string();
    // بلا نموذج مُعدّ يفشل كل تشغيل بصدق؛ لكن التشغيل الثاني دور في محادثة الأول لا مهمّة منفصلة.
    h.ok("schedule.run_now", json!({ "schedule_id": id }));
    let first = runs_of(&h, 1)[0]["mission_id"].as_str().unwrap().to_string();
    h.ok("schedule.run_now", json!({ "schedule_id": id }));
    let second = runs_of(&h, 2)[0]["mission_id"].as_str().unwrap().to_string();
    assert_ne!(first, second);
    let view = h.ok("conversation.get", json!({ "mission_id": second }));
    let turns = view["conversation"]["turns"].as_array().unwrap();
    assert_eq!(turns.len(), 2, "the second run is not a turn in the first run's task: {view}");
    assert_eq!(turns[1]["message"], "summarise the inputs");
    // الدور الثاني موسوم بجدوله: «من الأتمتة».
    let p08 = h.host().phase08().unwrap();
    assert_eq!(p08.preferences.get(&second).map(|p| (p.1, p.2)), Some(("SCHEDULE".to_string(), Some(id.clone()))));
    // تاريخ انتهاء مضى: لا يُفعَّل الجدول حتى يُنقل.
    let mut ended = h.ok("schedule.list", json!({}))["schedules"][0].clone();
    let past = h.err("schedule.save", json!({ "schedule_id": id, "name": "Monthly digest", "mission_template": ended["mission_template"].take(), "timezone": "UTC+03:00",
        "schedule": { "kind": "MONTHLY", "days": [1], "time": "09:00" }, "enabled": true, "budget": {}, "approval_policy": "WAIT_FOR_APPROVAL", "end_at": "2020-01-01T00:00:00Z" }));
    assert_ne!(past["code"], "INTERNAL_ERROR", "{past}");
}

#[test]
fn p08_ipc_oauth_returns_no_token_and_integrations_settings_refuse_a_remote_transcriber() {
    let h = build(None);
    let listed = h.ok("oauth.list", json!({}));
    assert!(listed["providers"].as_array().unwrap().iter().any(|p| p["provider_id"] == "google"));
    let begun = h.ok("oauth.connect", json!({ "provider_id": "google", "client_id": "user-registered-client.apps.example" }));
    let url = begun["consent_url"].as_str().unwrap();
    assert!(url.contains("code_challenge_method=S256") && url.contains("state="));
    assert!(begun["redirect_uri"].as_str().unwrap().starts_with("http://127.0.0.1:"));
    let connections = h.ok("oauth.list", json!({}))["connections"].clone();
    assert_eq!(connections[0]["status"], "PENDING");
    assert_eq!(connections[0]["stored_in_vault"], false);
    let text = connections.to_string();
    assert!(!text.contains("secret://") && !text.contains("token"), "a token reference crossed: {text}");
    assert_eq!(h.ok("oauth.disconnect", json!({ "connection_id": begun["connection_id"] }))["revoked"], true);
    // الصوت: بلا خادم محلي مُعدّ غير متاح صراحةً، وعنوان بعيد يُرفض عند الضبط.
    let wav = { let mut w = b"RIFF".to_vec(); w.extend(36u32.to_le_bytes()); w.extend(b"WAVEfmt "); w.extend(16u32.to_le_bytes()); w.extend(1u16.to_le_bytes()); w.extend(1u16.to_le_bytes()); w.extend(16_000u32.to_le_bytes()); w.extend(32_000u32.to_le_bytes()); w.extend(2u16.to_le_bytes()); w.extend(16u16.to_le_bytes()); w.extend(b"data"); w.extend(0u32.to_le_bytes()); w };
    assert_eq!(h.err("voice.transcribe", json!({ "audio_base64": b64(&wav) }))["code"], "POLICY_DENIED");
    assert_eq!(h.err("integration.settings.set", json!({ "key": "voice.transcription_endpoint", "value": "https://api.example.com" }))["code"], "POLICY_DENIED");
    let set = h.ok("integration.settings.set", json!({ "key": "voice.transcription_endpoint", "value": "http://127.0.0.1:8178" }));
    assert_eq!(set["settings"]["voice.transcription_endpoint"], "http://127.0.0.1:8178");
    // خادم البحث (خطة 2026-10-05، B5): على الجهاز وحده كخادم التفريغ.
    assert_eq!(h.err("integration.settings.set", json!({ "key": "web.search_endpoint", "value": "https://search.example.com" }))["code"], "POLICY_DENIED");
    let search = h.ok("integration.settings.set", json!({ "key": "web.search_endpoint", "value": "http://127.0.0.1:8888" }));
    assert_eq!(search["settings"]["web.search_endpoint"], "http://127.0.0.1:8888");
}

#[test]
fn p08_ipc_skill_packages_grant_no_authority_and_device_bundles_round_trip() {
    let h = build(None);
    let manifest = json!({ "package_id": "com.example.summary", "name": "Summary", "version": "1.0.0", "author": "Example", "description": "Summarises files",
        "source": "local-file", "permissions": ["WORKSPACE_READ"], "capabilities": ["polaris.capability.tool.workspace_read"], "tools": ["polaris.workspace.read"] });
    let imported = h.call("skill.package.import", json!({ "manifest_json": manifest.to_string() }));
    if let Some(result) = imported.get("result") {
        assert_eq!(result["package"]["grants_authority"], false);
        assert_ne!(result["package"]["trust_state"], "TRUSTED");
    }
    let listed = h.ok("skill.package.list", json!({}));
    assert!(listed["packages"].as_array().unwrap().iter().all(|p| p["grants_authority"] == false));
    let evil = json!({ "package_id": "com.example.evil", "name": "Evil", "version": "1.0.0", "author": "x", "description": "x", "source": "x",
        "permissions": ["PROCESS_EXECUTION"], "capabilities": [], "tools": [] });
    let refused = h.call("skill.package.import", json!({ "manifest_json": evil.to_string() }));
    let accepted_as_trusted = refused.get("result").is_some_and(|r| r["package"]["trust_state"] == "TRUSTED");
    assert!(!accepted_as_trusted, "a package asking for PROCESS_EXECUTION was trusted");
    let mission = uuid();
    document(&h, &mission, "Bundle me");
    let exported = h.ok("device.export", json!({ "mission_id": mission }));
    let bytes = std::fs::read(h.export_dir.join(exported["file_label"].as_str().unwrap())).unwrap();
    let imported = h.ok("device.import", json!({ "bundle_base64": b64(&bytes) }));
    assert!(imported["files"].as_u64().unwrap() >= 1);
    assert_eq!(imported["source_mission_id"], json!(mission));
    let mut tampered = bytes.clone();
    let n = tampered.len();
    tampered[n / 2] ^= 0xff;
    let bad = h.err("device.import", json!({ "bundle_base64": b64(&tampered) }));
    assert_ne!(bad["code"], "INTERNAL_ERROR");
}

#[test]
fn p08_powershell_scripts_set_their_location_to_the_working_directory_before_the_command() {
    // قِيس على ويندوز 11 داخل AppContainer: بلا ضبط صريح حُلّ المسار النسبي إلى C:\ فرُفضت الكتابة.
    let h = p08_support::build_with_powershell();
    let p08 = h.host().phase08().unwrap().clone();
    let mission = h.ok("mission.create", serde_json::json!({ "title": "ps location", "objective": "ps location" }))["mission_id"].as_str().unwrap().to_string();
    let cancel = polaris_host_providers::net::cancel::CancelToken::new();
    let _ = p08.execution.run(polaris_host_core::p08::execution::service::RunSpec {
        mission_id: &mission,
        task_id: "t",
        tool_id: "polaris.execution.command",
        runtime: polaris_host_core::p08::execution::Runtime::Powershell,
        source: "New-Item -ItemType Directory -Force outputs | Out-Null",
        script_path: None,
        arguments: Vec::new(),
        working_directory: Some(std::path::PathBuf::from("work")),
        limits: polaris_host_core::p08::execution::ExecutionLimits::DEFAULT,
        network: false,
        cancel: &cancel,
    });
    let request = h.sandbox.requests.lock().unwrap().last().cloned().expect("no PowerShell request reached the sandbox");
    let script = request.arguments.iter().find(|a| a.ends_with(".ps1")).expect("no script argument");
    let text = String::from_utf8_lossy(&std::fs::read(script).unwrap()).into_owned();
    let location = format!("$W = '{}'", request.working_directory.to_string_lossy());
    let at = text.find(&location).expect("the script does not name its working directory");
    let drive = text.find("New-PSDrive -Name POLARIS").expect("the script does not root a drive at the working directory");
    let command = text.find("New-Item -ItemType Directory -Force outputs").unwrap();
    assert!(at < drive && drive < command, "the location is set after the command");
    assert!(request.working_directory.ends_with("work"));
}

#[test]
fn p08_powershell_scripts_propagate_failure_and_see_the_polaris_python_when_prepared() {
    // قِيس في MISSION-E: «python» غير معروف داخل الصندوق، وخرج الخطأ برمز 0 فقُرئ نجاحًا.
    let h = p08_support::build_with_powershell();
    let p08 = h.host().phase08().unwrap().clone();
    let mission = h.ok("mission.create", serde_json::json!({ "title": "ps exit", "objective": "ps exit" }))["mission_id"].as_str().unwrap().to_string();
    let cancel = polaris_host_providers::net::cancel::CancelToken::new();
    let _ = p08.execution.run(polaris_host_core::p08::execution::service::RunSpec {
        mission_id: &mission,
        task_id: "t",
        tool_id: "polaris.execution.command",
        runtime: polaris_host_core::p08::execution::Runtime::Powershell,
        source: "python -m unittest -v",
        script_path: None,
        arguments: Vec::new(),
        working_directory: None,
        limits: polaris_host_core::p08::execution::ExecutionLimits::DEFAULT,
        network: false,
        cancel: &cancel,
    });
    let request = h.sandbox.requests.lock().unwrap().last().cloned().expect("no PowerShell request reached the sandbox");
    let script = request.arguments.iter().find(|a| a.ends_with(".ps1")).expect("no script argument");
    let text = String::from_utf8_lossy(&std::fs::read(script).unwrap()).into_owned();
    let command = text.find("python -m unittest -v").unwrap();
    let exit = text.find("if (-not $__polarisOk) { exit 1 }").expect("a failed last statement does not end the script non-zero");
    let native = text.find("exit $global:LASTEXITCODE").expect("a native command's exit code is not propagated");
    assert!(command < exit && command < native, "the exit handling runs before the command");
    let python = p08.execution.catalog().python();
    if let Some(py) = python {
        assert!(text.contains("$env:PATH = '"), "the prepared Python is not on PATH");
        assert!(request.read_only_roots.contains(&py.home), "the Python runtime is not readable by the sandbox identity");
    } else {
        assert!(!text.contains("$env:PATH = '"), "a PATH entry was written with no prepared runtime");
    }
}
