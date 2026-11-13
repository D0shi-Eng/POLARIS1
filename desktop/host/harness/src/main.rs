// polaris-p08-native — عُدّة القياس الأصلية لـPhase-08. تُشغَّل من مشغّل المطابقة، وتكتب أدلّة خامًا
// (*.local.json) لا تُرفع إلى أي مستودع. لا تمنح نفسها موافقة داخل البوابة، ولا تتجاوز الصندوق.
//
// الاستعمال:
//   polaris-p08-native --out <dir> [--data <dir>] [--sections a,b] [--tasks A,B] [--task-minutes N]
// الأقسام: sandbox, browser, artifacts, model, missions, lifecycle, restart (الافتراض: كلها).

mod artifacts;
mod browser;
mod credentials;
#[cfg(not(windows))]
mod dev;
mod fixture;
mod lifecycle;
mod metrics;
mod missions;
mod model;
mod platform;
mod probe;
mod report;
mod sandbox;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use report::{Section, Status};

struct Args {
    out: PathBuf,
    data: PathBuf,
    sections: Vec<String>,
    tasks: Option<Vec<String>>,
    task_minutes: u64,
}

fn args() -> Result<Args, String> {
    let mut out = None;
    let mut data = None;
    let mut sections = Vec::new();
    let mut tasks = None;
    let mut task_minutes = 20;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{a} needs a value"));
        match a.as_str() {
            "--out" => out = Some(PathBuf::from(value()?)),
            "--data" => data = Some(PathBuf::from(value()?)),
            "--sections" => sections = value()?.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            "--tasks" => tasks = Some(value()?.split(',').map(|s| s.trim().to_string()).collect()),
            "--task-minutes" => task_minutes = value()?.parse().map_err(|_| "--task-minutes must be a number")?,
            other => return Err(format!("unknown argument {other}")),
        }
    }
    let out = out.ok_or("--out is required")?;
    let data = data.unwrap_or_else(|| out.join("data"));
    Ok(Args { out, data, sections, tasks, task_minutes })
}

fn wanted(a: &Args, name: &str) -> bool {
    a.sections.is_empty() || a.sections.iter().any(|s| s == name)
}

fn restart(a: &Args, before_missions: usize, web_port: u16) -> Section {
    let mut s = Section::default();
    let h = platform::build(&a.data, Some(web_port));
    let missions = h.call("mission.list", json!({})).map(|v| v["missions"].as_array().map(|x| x.len()).unwrap_or(0)).unwrap_or(0);
    let artifacts = h.call("artifact.list", json!({})).map(|v| v["artifacts"].as_array().map(|x| x.len()).unwrap_or(0)).unwrap_or(0);
    s.record("P08-LCY-RESTART-PERSISTS", Status::of(missions >= before_missions && missions > 0), format!("after a restart the host lists {missions} missions (before: {before_missions}) and {artifacts} artifacts"), json!({ "missions": missions, "artifacts": artifacts }));
    let live = h.host().phase08().map(|p| p.browser.live_count()).unwrap_or(0);
    s.record("P08-LCY-RESTART-NO-ORPHANS", Status::of(live == 0), "no browser session is live after a restart", json!({ "live": live }));
    s
}

fn main() {
    let a = match args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("polaris-p08-native: {e}");
            std::process::exit(2);
        }
    };
    let started = Instant::now();
    let _ = std::fs::create_dir_all(&a.data);
    let web = fixture::serve();
    let h = platform::build(&a.data, Some(web.port));
    println!("POLARIS P08 native: isolation={} engine={} data={}", h.isolation, h.engine, a.data.display());
    let mut summary = serde_json::Map::new();
    let mut total: Vec<Value> = Vec::new();
    let mut emit = |name: &str, section: &Section, extra: Value, summary: &mut serde_json::Map<String, Value>| {
        let doc = section.document(name, extra);
        report::write(&a.out, &format!("{name}.local.json"), &doc);
        summary.insert(name.into(), doc["counts"].clone());
        total.extend(section.checks.iter().cloned());
    };

    let mut chosen: Option<model::Chosen> = None;
    if wanted(&a, "model") || wanted(&a, "missions") || wanted(&a, "lifecycle") {
        println!("[model]");
        let (s, c) = model::run(&h);
        emit("model", &s, json!({ "model_id": c.as_ref().map(|c| c.model_id.clone()), "display": c.as_ref().map(|c| c.display.clone()) }), &mut summary);
        chosen = c;
    }
    if wanted(&a, "sandbox") {
        println!("[sandbox]");
        let hits = web.hits.clone();
        let (s, _) = sandbox::run(&h, web.port, &move || hits.load(std::sync::atomic::Ordering::SeqCst));
        emit("sandbox", &s, json!({ "isolation": h.isolation }), &mut summary);
    }
    if wanted(&a, "browser") {
        println!("[browser]");
        let s = browser::run(&h, &web);
        emit("browser", &s, json!({ "engine": h.engine }), &mut summary);
    }
    if wanted(&a, "artifacts") {
        println!("[artifacts]");
        let s = artifacts::run(&h);
        emit("artifacts", &s, Value::Null, &mut summary);
    }
    let model_id = chosen.as_ref().map(|c| c.model_id.as_str());
    if wanted(&a, "missions") {
        println!("[missions] model={}", model_id.unwrap_or("NONE"));
        let only: Option<Vec<&str>> = a.tasks.as_ref().map(|t| t.iter().map(String::as_str).collect());
        let (s, rows) = missions::run(&h, &web.base(), model_id, only.as_deref(), Duration::from_secs(a.task_minutes * 60));
        // A3: ملخّص المجموعة من مقاييس كل مهمّة، ومعه الوضعان المُشغَّلان، ليُقارَن تشغيلان على المهامّ نفسها.
        let modes = json!({
            "native_tool_calls": std::env::var("POLARIS_P08_NATIVE_TOOLS").map(|v| v != "0").unwrap_or(true),
            "mission_thread": std::env::var("POLARIS_P08_THREAD").map(|v| v == "1").unwrap_or(false),
        });
        let suite = metrics::suite_summary(&rows);
        println!("[missions] suite {suite}");
        emit("missions", &s, json!({ "model_id": model_id, "modes": modes, "suite": suite, "tasks": rows }), &mut summary);
    }
    if wanted(&a, "lifecycle") {
        println!("[lifecycle]");
        let s = lifecycle::run(&h, model_id);
        emit("lifecycle", &s, Value::Null, &mut summary);
    }
    let before = h.call("mission.list", json!({})).map(|v| v["missions"].as_array().map(|x| x.len()).unwrap_or(0)).unwrap_or(0);
    let live_before_drop = h.host().phase08().map(|p| p.browser.live_count()).unwrap_or(0);
    let isolation = h.isolation;
    let engine = h.engine;
    drop(h);
    if wanted(&a, "restart") {
        println!("[restart]");
        let s = restart(&a, before, web.port);
        emit("restart", &s, json!({ "live_sessions_before_shutdown": live_before_drop }), &mut summary);
    }
    let failed = total.iter().filter(|c| c["status"] == "FAIL").count();
    let doc = json!({
        "schema_version": "1.0.0", "tool": "polaris.p08.native", "measured_at": report::now(), "duration_ms": started.elapsed().as_millis() as u64,
        "platform": std::env::consts::OS, "arch": std::env::consts::ARCH, "isolation": isolation, "engine": engine,
        "model_id": model_id, "sections": summary, "checks_total": total.len(), "checks_failed": failed,
    });
    report::write(&a.out, "summary.local.json", &doc);
    println!("POLARIS P08 native: {} checks, {failed} FAIL — {}", total.len(), a.out.display());
}
