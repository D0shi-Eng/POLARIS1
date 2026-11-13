// بدائل تطوير خارج ويندوز فقط: عملية بلا عزل وChromium يثبّته Playwright، كي تُطوَّر العُدّة
// وتُفحص على لينكس. لا تُترجَم على ويندوز إطلاقًا، فلا يمكن أن تحلّ محلّ الصندوق أو Edge هناك،
// وكل دليل يُكتب بها يحمل عزلها الحقيقي: TEST_FIXTURE_UNCONFINED.

#![cfg(not(windows))]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use polaris_host_core::p08::browser::{chromium_arguments, read_devtools_active_port, BrowserProcess, BrowserProcessPort};
use polaris_host_core::p08::execution::{SandboxEnd, SandboxError, SandboxOutcome, SandboxPort, SandboxRequest};

pub struct UnconfinedDevSandbox {
    pub python: Option<PathBuf>,
}

impl SandboxPort for UnconfinedDevSandbox {
    fn isolation(&self) -> &'static str {
        "TEST_FIXTURE_UNCONFINED"
    }

    fn run(&self, request: &SandboxRequest) -> Result<SandboxOutcome, SandboxError> {
        let name = request.program.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let program = if name.starts_with("python") { self.python.clone().ok_or_else(|| SandboxError::Unavailable("no python".into()))? } else { request.program.clone() };
        let mut cmd = Command::new(program);
        cmd.args(&request.arguments).current_dir(&request.working_directory).env_clear().stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, v) in &request.environment {
            cmd.env(k, v);
        }
        cmd.env("PATH", "/usr/bin:/bin");
        let started = Instant::now();
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        let mut child = cmd.spawn().map_err(|e| SandboxError::Launch(e.to_string()))?;
        let group = child.id();
        let mut out = child.stdout.take().unwrap();
        let mut err = child.stderr.take().unwrap();
        let t1 = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = out.read_to_end(&mut b);
            b
        });
        let t2 = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = err.read_to_end(&mut b);
            b
        });
        let deadline = started + Duration::from_millis(request.limits.wall_time_ms);
        let mut end = SandboxEnd::Exited;
        let status = loop {
            if let Ok(Some(s)) = child.try_wait() {
                break Some(s);
            }
            if request.cancel.is_cancelled() || Instant::now() > deadline {
                end = if request.cancel.is_cancelled() { SandboxEnd::Cancelled } else { SandboxEnd::TimedOut };
                let _ = child.kill();
                break child.wait().ok();
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        // المجموعة كلها تُقتل عند النهاية، كما يفعل كائن المهمّة: لا ناجٍ يمسك الأنابيب.
        let _ = Command::new("kill").args(["-s", "KILL", "--", &format!("-{group}")]).stderr(Stdio::null()).status();
        let stdout = t1.join().unwrap_or_default();
        let stderr = t2.join().unwrap_or_default();
        Ok(SandboxOutcome {
            end,
            exit_code: if end == SandboxEnd::Exited { status.and_then(|s| s.code()).map(i64::from) } else { None },
            stdout,
            stderr,
            output_truncated: false,
            duration_ms: started.elapsed().as_millis() as u64,
            processes_total: 1,
            survivors: 0,
            limit: None,
            isolation: "TEST_FIXTURE_UNCONFINED".into(),
        })
    }
}

pub struct DevChromium(pub PathBuf);

struct DevProcess {
    child: std::process::Child,
    port: u16,
    path: String,
}

impl BrowserProcess for DevProcess {
    fn devtools(&self) -> (u16, String) {
        (self.port, self.path.clone())
    }
    fn alive(&self) -> bool {
        true
    }
    fn kill(&mut self) -> u32 {
        let _ = Command::new("kill").args(["-s", "KILL", "--", &format!("-{}", self.child.id())]).status();
        let _ = self.child.kill();
        let _ = self.child.wait();
        0
    }
}

impl BrowserProcessPort for DevChromium {
    fn engine(&self) -> &'static str {
        "TEST_FIXTURE_CHROMIUM"
    }
    fn launch(&self, profile: &Path) -> Result<Box<dyn BrowserProcess>, String> {
        use std::os::unix::process::CommandExt;
        let mut args = chromium_arguments(profile);
        args.insert(0, "--no-sandbox".into());
        let mut command = Command::new(&self.0);
        command.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).process_group(0);
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        match read_devtools_active_port(profile, Duration::from_secs(20)) {
            Ok((port, path)) => Ok(Box::new(DevProcess { child, port, path })),
            Err(e) => {
                let _ = child.kill();
                Err(e)
            }
        }
    }
}

pub fn dev_python() -> Option<PathBuf> {
    ["/usr/bin/python3", "/usr/local/bin/python3"].iter().map(PathBuf::from).find(|p| p.is_file())
}

pub fn dev_chromium() -> Option<PathBuf> {
    ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].iter().map(PathBuf::from).find(|p| p.is_file())
}

/// نسخة Python «معدّة» وهمية: ملف الوسم وملف تنفيذي فارغ؛ البديل يشغّل Python الجهاز.
pub fn prepare_dev_python(runtimes: &Path) {
    let root = runtimes.join("python");
    let _ = std::fs::create_dir_all(root.join("bin"));
    let _ = std::fs::write(root.join("POLARIS-RUNTIME.json"), b"{\"source\":\"DEV STAND-IN\"}");
    let _ = std::fs::write(root.join("bin").join("python3"), b"");
    let _ = std::fs::write(root.join("python312.dll"), b"");
}
