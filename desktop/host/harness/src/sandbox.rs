// فحوص بيئة التنفيذ على الجهاز الحقيقي: PowerShell وPython داخل صندوق AppContainer وكائن مهمّة.
//
// نوعان من الفحص، ولا يُخلط بينهما:
//   • عبر البوابة (probe): ما يراه الوكيل — السياسة، والموافقة، والمحوّل، والصندوق.
//   • عبر الخدمة مباشرة (direct): الصندوق نفسه دون مصنّف السياسة، ليُقاس أن النواة تمنع
//     الشبكة والكتابة خارج المساحة حتى لو أفلت أمرٌ من المصنّف.

use std::path::Path;

use polaris_host_core::p08::execution::service::RunSpec;
use polaris_host_core::p08::execution::{ExecutionLimits, Runtime};
use polaris_host_providers::net::cancel::CancelToken;
use serde_json::{json, Value};

use crate::platform::Harness;
use crate::probe::Probe;
use crate::report::{Section, Status};

pub const CANARY_NAME: &str = "POLARIS_P08_SECRET_CANARY";
pub const CANARY_VALUE: &str = "p08-canary-7f3a9c";

fn ps_quote(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

fn py_quote(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\").replace('\'', "\\'")
}

/// تشغيل مباشر في صندوق المهمّة بحدود صريحة.
fn direct(h: &Harness, mission: &str, runtime: Runtime, source: &str, limits: ExecutionLimits, cancel: &CancelToken) -> Option<polaris_host_core::p08::execution::ExecutionResult> {
    let p08 = h.host().phase08()?;
    p08.execution
        .run(RunSpec { mission_id: mission, task_id: "direct", tool_id: "polaris.p08.native.direct", runtime, source, script_path: None, arguments: Vec::new(), working_directory: None, limits, network: false, cancel })
        .ok()
}

pub(crate) fn python_ready(h: &Harness) -> (bool, Value) {
    match h.call("execution.runtime.prepare", json!({ "runtime": "PYTHON" })) {
        Ok(v) => (v["available"] == true, v),
        Err(e) => (false, e),
    }
}

pub fn run(h: &Harness, fixture_port: u16, fixture_hits: &dyn Fn() -> usize) -> (Section, bool) {
    let mut s = Section::default();
    let status = h.call("execution.status", json!({})).unwrap_or(Value::Null);
    let isolation = status["isolation"].as_str().unwrap_or("").to_string();
    let confined = isolation.contains("APPCONTAINER");
    s.record("P08-SBX-ISOLATION", Status::of(confined), format!("isolation reported by the host: {isolation}"), json!({ "isolation": isolation, "status": status }));

    let outside = h.data_dir.join("outside-workspace");
    let _ = std::fs::create_dir_all(&outside);
    let secret = outside.join("secret.txt");
    let _ = std::fs::write(&secret, "P08-OUTSIDE-SECRET-MARKER");
    let written = outside.join("written-by-sandbox.txt");
    let _ = std::fs::remove_file(&written);

    let mut p = Probe::new(h, "sandbox probes");
    let ps_available = status["powershell"]["available"] == true;
    if ps_available {
        let c = p.invoke("polaris.execution.command", json!({ "command": "Write-Output ('POLARIS-PS-' + (2*21))", "timeout_seconds": 60 }));
        s.record("P08-SBX-PS-ECHO", Status::of(c.ok() && c.observation.contains("POLARIS-PS-42")), &c.summary, c.view());
        let c = p.invoke("polaris.execution.command", json!({ "command": "New-Item -ItemType Directory -Force outputs | Out-Null; Set-Content -Encoding UTF8 -Path outputs\\ps-probe.txt -Value 'written inside'; Get-Content outputs\\ps-probe.txt" }));
        let listed = h.call("workspace.list", json!({ "mission_id": p.mission_id })).map(|v| v.to_string().contains("outputs/ps-probe.txt")).unwrap_or(false);
        s.record("P08-SBX-PS-WRITE-INSIDE", Status::of(c.ok() && listed), "a file written inside the workspace is listed by the host", c.view());
        let c = p.invoke("polaris.execution.command", json!({ "command": format!("Get-Content -LiteralPath '{}'", ps_quote(&secret)) }));
        let leaked = c.observation.contains("P08-OUTSIDE-SECRET-MARKER");
        s.record("P08-SBX-PS-READ-OUTSIDE-DENIED", Status::of(!leaked && c.status != "DENIED"), if leaked { "the sandbox read a file outside its workspace" } else { "the file outside the workspace was not readable" }, c.view());
        let c = p.invoke("polaris.execution.command", json!({ "command": format!("Set-Content -LiteralPath '{}' -Value 'escaped'", ps_quote(&written)) }));
        s.record("P08-SBX-PS-WRITE-OUTSIDE-DENIED", Status::of(!written.exists()), if written.exists() { "a file was written outside the workspace" } else { "no file appeared outside the workspace" }, c.view());
        let profile = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
        let c = p.invoke("polaris.execution.command", json!({ "command": format!("Get-ChildItem -LiteralPath '{}' -Name | Select-Object -First 5", profile.replace('\'', "''")) }));
        let listed_profile = c.ok() && c.observation.contains("--- stdout ---");
        s.record("P08-SBX-PS-PROFILE-DENIED", Status::of(!listed_profile), "listing the user's profile from the sandbox", c.view());
        let (first, second) = p.invoke_with_decision("polaris.execution.command", json!({ "command": "pip install requests" }), false);
        let waited = p.awaiting(&first);
        let not_run = second.as_ref().is_none_or(|c| !c.ok());
        s.record("P08-SBX-INSTALL-NEEDS-APPROVAL", Status::of(waited && not_run), "a package install waits for a human and does not run when denied", json!({ "first": first.view(), "after_deny": second.map(|c| c.view()) }));
    } else {
        for id in ["P08-SBX-PS-ECHO", "P08-SBX-PS-WRITE-INSIDE", "P08-SBX-PS-READ-OUTSIDE-DENIED", "P08-SBX-PS-WRITE-OUTSIDE-DENIED", "P08-SBX-PS-PROFILE-DENIED", "P08-SBX-INSTALL-NEEDS-APPROVAL"] {
            s.record(id, Status::Blocked, format!("PowerShell is not available to the sandbox: {}", status["powershell"]["detail"]), Value::Null);
        }
    }

    let (py, prepared) = python_ready(h);
    s.record("P08-SBX-PY-PREPARE", Status::of(py), "the private Python runtime was prepared from the machine's base interpreter", prepared.clone());
    if py {
        let c = p.invoke("polaris.execution.python", json!({ "code": "import sys, platform\nprint('PY', platform.python_version(), sum(range(10)))\n", "timeout_seconds": 60 }));
        s.record("P08-SBX-PY-RUN", Status::of(c.ok() && c.observation.contains(" 45")), &c.summary, c.view());
        let code = format!("import os\nnames = sorted(os.environ)\nprint('ENV', len(names))\nprint('CANARY', '{CANARY_NAME}' in os.environ, any('{CANARY_VALUE}' in v for v in os.environ.values()))\nprint('SUSPECT_NAMES', [n for n in names if any(w in n.upper() for w in ('TOKEN','SECRET','PASSWORD','API_KEY'))])\n");
        let c = p.invoke("polaris.execution.python", json!({ "code": code }));
        let clean = c.ok() && c.observation.contains("CANARY False False") && c.observation.contains("SUSPECT_NAMES []");
        let planted = std::env::var(CANARY_NAME).is_ok_and(|v| v == CANARY_VALUE);
        let status = match (clean, planted) {
            (false, _) => Status::Fail,
            (true, true) => Status::Pass,
            (true, false) => Status::Partial,
        };
        s.record("P08-SBX-ENV-SECRETS-ABSENT", status, if planted { "a secret planted in the host's environment does not reach the sandbox" } else { "no secret-looking names reached the sandbox, but the runner did not plant the canary" }, c.view());
        let code = format!("import socket\ns = socket.socket()\ns.settimeout(3)\ntry:\n    s.connect(('127.0.0.1', {fixture_port}))\n    print('NET-CONNECTED')\nexcept Exception as e:\n    print('NET-BLOCKED', type(e).__name__)\n");
        let before = fixture_hits();
        let c = p.invoke("polaris.execution.python", json!({ "code": code }));
        let after = fixture_hits();
        let blocked = !c.observation.contains("NET-CONNECTED") && before == after;
        s.record("P08-SBX-NET-DENIED-GATEWAY", Status::of(blocked), "a socket opened without the network approval does not reach a listener", json!({ "call": c.view(), "listener_hits_before": before, "listener_hits_after": after }));
        let obfuscated = format!("m = __import__('so' + 'cket')\ns = m.socket()\ns.settimeout(3)\ntry:\n    s.connect(('127.0.0.1', {fixture_port}))\n    print('NET-CONNECTED')\nexcept Exception as e:\n    print('NET-BLOCKED', type(e).__name__)\n");
        let cancel = CancelToken::new();
        let before = fixture_hits();
        let r = direct(h, &p.mission_id, Runtime::Python, &obfuscated, ExecutionLimits::DEFAULT, &cancel);
        let after = fixture_hits();
        let out = r.as_ref().map(|r| r.stdout.clone()).unwrap_or_default();
        s.record("P08-SBX-NET-DENIED-KERNEL", Status::of(r.is_some() && !out.contains("NET-CONNECTED") && before == after), "the sandbox itself blocks a socket the policy classifier could not see", json!({ "stdout": out, "hits_before": before, "hits_after": after, "status": r.as_ref().map(|r| r.status) }));
        let code = format!("try:\n    open(r'{}', 'w').write('escaped')\n    print('WROTE')\nexcept Exception as e:\n    print('DENIED', type(e).__name__)\n", py_quote(&written));
        let r = direct(h, &p.mission_id, Runtime::Python, &code, ExecutionLimits::DEFAULT, &cancel);
        s.record("P08-SBX-PY-WRITE-OUTSIDE-DENIED", Status::of(r.is_some() && !written.exists()), "a direct Python write outside the workspace", json!({ "stdout": r.as_ref().map(|r| r.stdout.clone()), "exists_after": written.exists() }));
        let code = "import subprocess, sys\nfor i in range(3):\n    subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])\nprint('SPAWNED 3')\n";
        let r = direct(h, &p.mission_id, Runtime::Python, code, ExecutionLimits { wall_time_ms: 60_000, ..ExecutionLimits::DEFAULT }, &cancel);
        let ok = r.as_ref().is_some_and(|r| r.stdout.contains("SPAWNED 3") && r.survivors == 0 && r.processes_total >= 2);
        s.record("P08-SBX-CHILDREN-KILLED", Status::of(ok), "background children are killed with the job; survivors must be 0", json!({ "status": r.as_ref().map(|r| r.status), "processes_total": r.as_ref().map(|r| r.processes_total), "survivors": r.as_ref().map(|r| r.survivors) }));
        let code = "data = bytearray(1536 * 1024 * 1024)\nprint('ALLOCATED', len(data))\n";
        let r = direct(h, &p.mission_id, Runtime::Python, code, ExecutionLimits { memory_bytes: 256 * 1024 * 1024, ..ExecutionLimits::DEFAULT }, &cancel);
        let ok = r.as_ref().is_some_and(|r| !r.stdout.contains("ALLOCATED") && !r.succeeded());
        s.record("P08-SBX-MEMORY-LIMIT", Status::of(ok), "a 1.5 GiB allocation under a 256 MiB job limit fails", json!({ "status": r.as_ref().map(|r| r.status), "limit": r.as_ref().and_then(|r| r.limit.clone()), "stderr": r.as_ref().map(|r| r.stderr.chars().take(300).collect::<String>()) }));
        let code = "import subprocess, sys\nprocs = []\ntry:\n    for i in range(40):\n        procs.append(subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)']))\n    print('STARTED', len(procs))\nexcept Exception as e:\n    print('REFUSED-AT', len(procs), type(e).__name__)\n";
        let r = direct(h, &p.mission_id, Runtime::Python, code, ExecutionLimits { max_processes: 8, wall_time_ms: 60_000, ..ExecutionLimits::DEFAULT }, &cancel);
        let ok = r.as_ref().is_some_and(|r| !r.stdout.contains("STARTED 40") && r.survivors == 0);
        s.record("P08-SBX-PROCESS-LIMIT", Status::of(ok), "forty children under an eight-process job limit", json!({ "stdout": r.as_ref().map(|r| r.stdout.clone()), "processes_total": r.as_ref().map(|r| r.processes_total), "survivors": r.as_ref().map(|r| r.survivors) }));
        let c = p.invoke("polaris.execution.python", json!({ "code": "import time\ntime.sleep(60)\nprint('WOKE')\n", "timeout_seconds": 3 }));
        s.record("P08-SBX-TIMEOUT", Status::of(!c.observation.contains("WOKE") && (c.summary.contains("TIMED_OUT") || c.status == "TIMED_OUT")), &c.summary, c.view());
        let cancel = CancelToken::new();
        let trigger = cancel.clone();
        let started = std::time::Instant::now();
        let waker = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            trigger.cancel();
        });
        let r = direct(h, &p.mission_id, Runtime::Python, "import time\ntime.sleep(120)\nprint('WOKE')\n", ExecutionLimits::DEFAULT, &cancel);
        let _ = waker.join();
        let elapsed = started.elapsed().as_millis() as u64;
        let ok = r.as_ref().is_some_and(|r| r.status == "CANCELLED" && r.survivors == 0) && elapsed < 20_000;
        s.record("P08-SBX-CANCEL", Status::of(ok), format!("cancelled after 2 s; returned after {elapsed} ms"), json!({ "status": r.as_ref().map(|r| r.status), "elapsed_ms": elapsed }));
    } else {
        for id in ["P08-SBX-PY-RUN", "P08-SBX-ENV-SECRETS-ABSENT", "P08-SBX-NET-DENIED-GATEWAY", "P08-SBX-NET-DENIED-KERNEL", "P08-SBX-PY-WRITE-OUTSIDE-DENIED", "P08-SBX-CHILDREN-KILLED", "P08-SBX-MEMORY-LIMIT", "P08-SBX-PROCESS-LIMIT", "P08-SBX-TIMEOUT", "P08-SBX-CANCEL"] {
            s.record(id, Status::Blocked, "the Python runtime could not be prepared", prepared.clone());
        }
    }
    let (first, second) = p.invoke_with_decision("polaris.execution.python", json!({ "code": "import urllib.request\nprint(urllib.request.urlopen('https://example.org').status)\n", "network": true }), false);
    s.record("P08-SBX-NETWORK-NEEDS-APPROVAL", Status::of(p.awaiting(&first) && second.as_ref().is_none_or(|c| !c.ok())), "a network run waits for a human, and a denial runs nothing", json!({ "first": first.view(), "after_deny": second.map(|c| c.view()) }));
    let runs = h.call("execution.runs", json!({ "mission_id": p.mission_id })).unwrap_or(Value::Null);
    let survivors: u64 = runs["runs"].as_array().map(|a| a.iter().filter_map(|r| r["survivors"].as_u64()).sum()).unwrap_or(0);
    s.record("P08-SBX-ZERO-SURVIVORS", Status::of(survivors == 0), format!("survivors across all recorded runs: {survivors}"), json!({ "runs": runs["runs"].as_array().map(|a| a.len()) }));
    p.finish();
    let _ = std::fs::remove_file(&secret);
    (s, confined)
}
