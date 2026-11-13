// دورة الحياة والتكاملات على الجهاز: المجدول (بلا تجاوز للموافقة)، والإلغاء أثناء التشغيل،
// والذاكرة، والموصل، وOAuth (PKCE دون أن يعبر رمز)، والنشر المحلي بموافقة، والمشاركة، وحزمة
// المهارة غير الموثوقة، ونقل المساحة بين الأجهزة، والصوت. وإعادة التشغيل تُقاس في main.

use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};

use crate::platform::Harness;
use crate::probe::Probe;
use crate::report::{Section, Status};

fn wait_for(mut f: impl FnMut() -> bool, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

fn has_finished_run(runs: &Value) -> bool {
    runs["runs"].as_array().is_some_and(|a| !a.is_empty())
}

/// تشغيل جارٍ يُرى من أثره لا من سجل التشغيلات: المضيف يكتب p08_execution_runs بعد انتهاء التشغيل فقط
/// (execution/service.rs record)، فالسجل وحده لا يكشف تشغيلًا حيًّا. الحلقة تكتب outputs/ticks.txt وتفرّغه
/// كل ثانية؛ سطر فيه مع غياب تشغيل منتهٍ دليلٌ على تشغيل حيّ لحظة الإلغاء.
fn run_in_flight(runs: &Value, ticks: Option<&str>) -> bool {
    !has_finished_run(runs) && ticks.is_some_and(|t| t.lines().any(|l| !l.trim().is_empty()))
}

pub fn run(h: &Harness, model_id: Option<&str>) -> Section {
    let mut s = Section::default();
    schedules(h, model_id, &mut s);
    cancel(h, model_id, &mut s);
    integrations(h, &mut s);
    s
}

fn schedules(h: &Harness, model_id: Option<&str>, s: &mut Section) {
    let at = crate::report::in_minutes(60);
    let saved = h.call(
        "schedule.save",
        json!({ "name": "Native network probe", "mission_template": { "title": "Scheduled network probe", "objective": "Download https://example.org with Python and save its title to outputs/title.txt.", "model_id": model_id }, "timezone": "UTC", "schedule": { "kind": "ONCE", "at": at }, "enabled": true, "budget": {}, "approval_policy": "WAIT_FOR_APPROVAL" }),
    );
    let id = saved.as_ref().ok().and_then(|v| v["schedule"]["schedule_id"].as_str().map(String::from)).unwrap_or_default();
    s.record("P08-LCY-SCHEDULE-SAVE", Status::of(!id.is_empty()), "a ONCE schedule is saved with WAIT_FOR_APPROVAL", saved.clone().unwrap_or_else(|e| e));
    let Some(p08) = h.host().phase08().cloned() else { return };
    let due = p08.scheduler.make_due_for_test(&id);
    let fired = p08.scheduler.tick();
    let run_seen = wait_for(|| h.call("schedule.list", json!({})).map(|v| v.to_string().contains("\"trigger_kind\"")).unwrap_or(false), Duration::from_secs(20));
    let listed = h.call("schedule.list", json!({})).unwrap_or(Value::Null);
    let schedule = listed["schedules"].as_array().and_then(|a| a.iter().find(|x| x["schedule_id"] == id.as_str()).cloned()).unwrap_or(Value::Null);
    let mission = schedule["recent_runs"][0]["mission_id"].as_str().map(String::from);
    s.record("P08-LCY-SCHEDULE-FIRES", Status::of(due.is_ok() && fired >= 1 && run_seen && mission.is_some()), "a due schedule starts a real mission from the scheduler tick", json!({ "fired": fired, "run": schedule["recent_runs"][0] }));
    match (model_id, mission) {
        (Some(_), Some(m)) => {
            let settled = wait_for(|| h.call("mission.get", json!({ "mission_id": m })).map(|v| matches!(v["mission"]["state"].as_str(), Some("WAITING_FOR_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED" | "STOPPED" | "BLOCKED"))).unwrap_or(false), Duration::from_secs(900));
            let state = h.call("mission.get", json!({ "mission_id": m })).map(|v| v["mission"]["state"].clone()).unwrap_or(Value::Null);
            let invocations = h.call("tool.activity.list", json!({ "mission_id": m })).unwrap_or(Value::Null);
            let networked = invocations["invocations"].as_array().is_some_and(|a| a.iter().any(|i| i["status"] == "SUCCEEDED" && i["effects"].as_array().is_some_and(|e| e.iter().any(|x| x == "NETWORK_EGRESS"))));
            s.record("P08-LCY-SCHEDULE-NO-BYPASS", Status::of(settled && !networked), format!("the scheduled mission ended {state} without any network run"), json!({ "state": state }));
            let _ = h.call("mission.cancel", json!({ "mission_id": m }));
        }
        _ => s.record("P08-LCY-SCHEDULE-NO-BYPASS", Status::Blocked, "BLOCKED_ENVIRONMENT: no working local model to drive the scheduled mission", Value::Null),
    }
    let disabled = h.call("schedule.enable", json!({ "schedule_id": id, "enabled": false })).map(|v| v["schedule"]["enabled"] == false).unwrap_or(false);
    let deleted = h.call("schedule.delete", json!({ "schedule_id": id })).map(|v| v["deleted"] == true).unwrap_or(false);
    s.record("P08-LCY-SCHEDULE-EDIT", Status::of(disabled && deleted), "disable and delete", Value::Null);
}

fn cancel(h: &Harness, model_id: Option<&str>, s: &mut Section) {
    let Some(model) = model_id else {
        s.record("P08-LCY-CANCEL-RUNNING", Status::Blocked, "BLOCKED_ENVIRONMENT: no working local model", Value::Null);
        return;
    };
    // Python الخاص يُهيَّأ صراحةً كما يفعل المستخدم من الإعدادات؛ القسم يعمل وحده ولا يعتمد على أن قسم
    // sandbox سبقه (قيس 2026-09-30: وحده انتهت المهمة FAILED بـ «the Python runtime has not been prepared»).
    let _ = crate::sandbox::python_ready(h);
    let mission = h
        .call("mission.create", json!({ "title": "Cancel probe", "objective": "Use Python in the sandbox to run a loop that prints a number every second for 10 minutes (time.sleep(1) in a loop of 600). Write each number to outputs/ticks.txt.", "execution_mode": "SINGLE_AGENT", "budget_preset": "EXTENDED" }))
        .ok()
        .and_then(|v| v["mission_id"].as_str().map(String::from))
        .unwrap_or_default();
    let _ = h.call("mission.model.set", json!({ "mission_id": mission, "model_id": model }));
    let _ = h.call("config.set", json!({ "layer": "MISSION", "scope_id": mission, "key": "tools.max_runtime_per_mission", "value": 1_200_000 }));
    let gateway = h.gateway.clone();
    let m = mission.clone();
    let runner = std::thread::spawn(move || Harness::detached(gateway).call("mission.start", json!({ "mission_id": m })).map(|v| v["state"].clone()));
    // يُنتظر أثر التشغيل الحيّ (سطر في outputs/ticks.txt) أو تشغيل منتهٍ، أيّهما أولًا؛ لا مهلة كاملة بلا سبب.
    let mut running = false;
    wait_for(
        || {
            let runs = h.call("execution.runs", json!({ "mission_id": mission })).unwrap_or(Value::Null);
            let ticks = h.call("workspace.preview", json!({ "mission_id": mission, "path": "outputs/ticks.txt", "max_chars": 200 })).ok().and_then(|v| v["text"].as_str().map(String::from));
            running = run_in_flight(&runs, ticks.as_deref());
            running || has_finished_run(&runs)
        },
        Duration::from_secs(600),
    );
    let started = Instant::now();
    let cancelled = h.call("mission.cancel", json!({ "mission_id": mission }));
    let ended = runner.join().ok();
    let elapsed = started.elapsed().as_millis() as u64;
    let state = h.call("mission.get", json!({ "mission_id": mission })).map(|v| v["mission"]["state"].clone()).unwrap_or(Value::Null);
    let runs = h.call("execution.runs", json!({ "mission_id": mission })).unwrap_or(Value::Null);
    let survivors: u64 = runs["runs"].as_array().map(|a| a.iter().filter_map(|r| r["survivors"].as_u64()).sum()).unwrap_or(0);
    let ok = cancelled.is_ok() && state == "CANCELLED" && survivors == 0 && elapsed < 60_000;
    s.record("P08-LCY-CANCEL-RUNNING", if running { Status::of(ok) } else { Status::Partial }, format!("cancel returned in {elapsed} ms; state {state}; survivors {survivors}; a run was in flight: {running}"), json!({ "start_result": ended.map(|r| r.unwrap_or_else(|e| e)), "runs": runs["runs"] }));
}

fn integrations(h: &Harness, s: &mut Section) {
    let memory = h.call("memory.list", json!({}));
    s.record("P08-LCY-MEMORY", Status::of(memory.is_ok()), "the memory store answers; memory stays context, never authority", json!({ "count": memory.as_ref().ok().and_then(|v| v["memories"].as_array().map(|a| a.len())) }));

    let project = h.call("project.create", json!({ "name": "Native connector probe" })).ok().and_then(|v| v["project"]["project_id"].as_str().map(String::from));
    let connector = project.as_ref().and_then(|p| h.call("connector.register", json!({ "provider": "polaris.workspace", "category": "FILES", "display_name": "Probe project files", "workspace": { "project_id": p } })).ok());
    let cid = connector.as_ref().and_then(|c| c["connector"]["descriptor"]["connector_id"].as_str().map(String::from)).unwrap_or_default();
    let _ = h.call("connector.configure", json!({ "connector_id": cid, "enabled": true }));
    let tested = h.call("connector.test", json!({ "connector_id": cid }));
    s.record("P08-LCY-CONNECTOR", Status::of(tested.as_ref().is_ok_and(|v| v["health"]["state"] == "HEALTHY")), "a local connector is registered disabled, enabled by the user, and probed through the connector gateway", tested.unwrap_or_else(|e| e));

    let oauth = h.call("oauth.connect", json!({ "provider_id": "google", "client_id": "polaris-native-probe.apps.example", "scopes": ["openid"] }));
    let url = oauth.as_ref().ok().and_then(|v| v["consent_url"].as_str().map(String::from)).unwrap_or_default();
    let pkce = url.contains("code_challenge=") && url.contains("code_challenge_method=S256") && url.contains("state=") && url.contains("redirect_uri=http%3A%2F%2F127.0.0.1");
    let leaked = oauth.as_ref().map(|v| v.to_string()).unwrap_or_default().contains("access_token");
    s.record("P08-LCY-OAUTH-PKCE", Status::of(pkce && !leaked), "the consent URL carries an S256 PKCE challenge, a state and a loopback redirect; no token crosses IPC", json!({ "consent_host": url.split('/').nth(2), "opened_in_browser": oauth.as_ref().ok().map(|v| v["opened_in_browser"].clone()) }));
    if let Some(id) = oauth.as_ref().ok().and_then(|v| v["connection_id"].as_str()) {
        let _ = h.call("oauth.disconnect", json!({ "connection_id": id }));
    }

    let mut p = Probe::new(h, "integration probes");
    let _ = p.invoke("polaris.artifact.document", json!({ "format": "docx", "path": "outputs/publish-me.docx", "spec": { "title": "Publish probe", "blocks": [{ "type": "paragraph", "text": "to be published locally" }] } }));
    let artifact = h.call("artifact.list", json!({ "mission_id": p.mission_id })).ok().and_then(|v| v["artifacts"][0]["artifact_id"].as_str().map(String::from)).unwrap_or_default();
    let proposed = h.call("publish.propose", json!({ "artifact_id": artifact, "publisher_id": "local-folder" }));
    let pid = proposed.as_ref().ok().and_then(|v| v["publication"]["publication_id"].as_str().map(String::from)).unwrap_or_default();
    let pending = proposed.as_ref().is_ok_and(|v| v["publication"]["status"] == "AWAITING_APPROVAL");
    let decided = h.call("publish.decide", json!({ "publication_id": pid, "decision": "GRANT" }));
    s.record("P08-LCY-PUBLISH-LOCAL", Status::of(pending && decided.as_ref().is_ok_and(|v| v["publication"]["status"] == "PUBLISHED")), "publishing waits for a decision, then the local publisher writes the file", json!({ "proposed": proposed.unwrap_or_else(|e| e), "decided": decided.unwrap_or_else(|e| e) }));
    let share = h.call("share.set", json!({ "object_type": "MISSION", "object_id": p.mission_id, "member": "reviewer@example.invalid", "role": "VIEWER" }));
    let listed = h.call("share.list", json!({ "object_type": "MISSION", "object_id": p.mission_id }));
    s.record("P08-LCY-SHARE-ROLES", Status::of(share.is_ok() && listed.as_ref().is_ok_and(|v| v.to_string().contains("VIEWER"))), "an OWNER/EDITOR/VIEWER grant is recorded (local foundation; nothing leaves the device)", listed.unwrap_or_else(|e| e));
    let manifest = json!({ "package_id": "probe.untrusted-pack", "name": "Probe pack", "version": "1.0.0", "author": "native probe", "permissions": ["LOCAL_COMPUTE"], "capabilities": ["local_compute"], "tools": ["polaris.execution.python"], "source": "native-probe" });
    let imported = h.call("skill.package.import", json!({ "manifest_json": manifest.to_string() }));
    let untrusted = imported.as_ref().is_ok_and(|v| v["package"]["grants_authority"] == false && v["package"]["trust_state"] != "TRUSTED");
    s.record("P08-LCY-SKILL-PACKAGE-UNTRUSTED", Status::of(untrusted), "an imported package is validated structurally but stays untrusted: it grants no authority", imported.unwrap_or_else(|e| e));
    let exported = h.call("device.export", json!({ "mission_id": p.mission_id }));
    let label = exported.as_ref().ok().and_then(|v| v["file_label"].as_str().map(String::from)).unwrap_or_default();
    let bundle = std::fs::read(h.export_dir.join(&label)).unwrap_or_default();
    let imported = h.call("device.import", json!({ "bundle_base64": base64::engine::general_purpose::STANDARD.encode(&bundle) }));
    s.record("P08-LCY-DEVICE-TRANSFER", Status::of(!bundle.is_empty() && imported.is_ok()), "a workspace bundle exports and re-imports into an isolated folder", json!({ "bytes": bundle.len(), "import": imported.unwrap_or_else(|e| e) }));
    let voice = h.call("voice.transcribe", json!({ "audio_base64": base64::engine::general_purpose::STANDARD.encode(crate::report::silent_wav()) }));
    let not_configured = voice.as_ref().err().is_some_and(|e| e.to_string().contains("feature_not_available"));
    s.record("P08-LCY-VOICE", if voice.is_ok() { Status::Pass } else if not_configured { Status::NotTested } else { Status::Fail }, if not_configured { "NOT_TESTED: no local transcription server is configured on this machine; the host refuses cleanly" } else { "transcription" }, voice.unwrap_or_else(|e| e));
    p.finish();
}

#[cfg(test)]
mod tests {
    use super::run_in_flight;
    use serde_json::json;

    #[test]
    fn a_run_is_in_flight_from_its_flushed_output_while_no_finished_run_is_recorded() {
        // الخطأ المقيس (2026-09-30): السجل لا يحمل التشغيل الجاري، فانتظر الفحص 600 ث ثم حكم PARTIAL
        let none = json!({ "runs": [] });
        assert!(run_in_flight(&none, Some("1
2
")));
        assert!(!run_in_flight(&none, None), "no output yet is not a live run");
        assert!(!run_in_flight(&none, Some("
")), "an empty file is not a live run");
        assert!(!run_in_flight(&json!({ "runs": [{ "status": "SUCCEEDED" }] }), Some("1
")), "a finished run is no longer in flight");
    }
}
