// منفذ المتصفّح على ويندوز: Microsoft Edge (Chromium) بلا واجهة داخل كائن مهمّة.
//
// كائن المهمّة يقتل الشجرة كلها عند الإغلاق (KILL_ON_JOB_CLOSE)، فلا تبقى عملية عارض أو GPU أو
// أداة أعطال بعد الجلسة، ويحدّ الذاكرة وعدد العمليات. المتصفّح لا يرث بيئة POLARIS: يأخذ قائمة
// مغلقة من متغيّرات النظام، فلا يصل إليه مفتاح مزوّد في البيئة. ملف تعريفه مجلد جديد تحت بيانات
// POLARIS لكل مهمّة، فلا جلسات المستخدم ولا كلمات مروره ولا ملحقاته.
//
// ليس AppContainer: Chromium يحتاج وصولًا لا يمنحه صندوقنا (رسوميات، خطوط، ذاكرة مشتركة)، وعزل
// شبكته ليس من الصندوق بل من المعترِض والوكيل الميّت (انظر p08/browser). هذا حدّ مُعلن.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;
use std::time::Duration;

use polaris_host_core::p08::browser::port::edge_candidates;
use polaris_host_core::p08::browser::{chromium_arguments, read_devtools_active_port, BrowserProcess, BrowserProcessPort};

use crate::process::{create_job, job_process_counts, read_pipe, spawn_in_job, terminate_job, JobLimits, Launch, OwnedHandle};

/// متغيّرات النظام التي يحتاجها المتصفّح. لا شيء غيرها يعبر.
const INHERITED: [&str; 22] = [
    "SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
    "CommonProgramFiles", "CommonProgramFiles(x86)", "PATH", "PATHEXT", "COMPUTERNAME", "USERNAME", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
];

pub fn find_edge() -> Option<PathBuf> {
    edge_candidates().into_iter().find(|p| p.is_file())
}

struct EdgeProcess {
    job: OwnedHandle,
    _process: OwnedHandle,
    port: u16,
    path: String,
}

impl BrowserProcess for EdgeProcess {
    fn devtools(&self) -> (u16, String) {
        (self.port, self.path.clone())
    }

    fn alive(&self) -> bool {
        job_process_counts(&self.job).1 > 0
    }

    fn kill(&mut self) -> u32 {
        terminate_job(&self.job, Duration::from_secs(5))
    }
}

pub struct EdgeBrowser {
    executable: PathBuf,
}

impl EdgeBrowser {
    pub fn new(executable: PathBuf) -> Self {
        Self { executable }
    }
}

impl BrowserProcessPort for EdgeBrowser {
    fn engine(&self) -> &'static str {
        "EDGE_CHROMIUM+JOB"
    }

    fn launch(&self, profile_dir: &Path) -> Result<Box<dyn BrowserProcess>, String> {
        let job = create_job(JobLimits { memory_bytes: 3 * 1024 * 1024 * 1024, max_processes: 64, cpu_percent: 100, ui_restricted: false })?;
        let environment: Vec<(String, String)> = INHERITED.iter().filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v))).collect();
        let arguments = chromium_arguments(profile_dir);
        let program = self.executable.to_string_lossy().into_owned();
        let cwd = profile_dir.to_string_lossy().into_owned();
        let spawned = spawn_in_job(&job, &Launch { program: &program, arguments: &arguments, working_directory: &cwd, environment: &environment, security_capabilities: None })?;
        // مخرجات المتصفّح تُقرأ وتُهمل كي لا يتوقّف على أنبوب ممتلئ.
        let budget = Arc::new(AtomicU64::new(0));
        let flag = Arc::new(AtomicBool::new(false));
        let _ = read_pipe(spawned.stdout, budget.clone(), flag.clone());
        let _ = read_pipe(spawned.stderr, budget, flag);
        match read_devtools_active_port(profile_dir, Duration::from_secs(30)) {
            Ok((port, path)) => Ok(Box::new(EdgeProcess { job, _process: spawned.process, port, path })),
            Err(e) => {
                terminate_job(&job, Duration::from_secs(3));
                Err(e)
            }
        }
    }
}
