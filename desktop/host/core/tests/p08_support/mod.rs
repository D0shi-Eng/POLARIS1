// أدوات اختبار Phase-08: مضيف حقيقي فوق مجلد بيانات مؤقت، وبوابة IPC حقيقية بظرف 1.7،
// ونموذج تجهيزة على الحلقة المحلية، وصندوق تنفيذ تجهيزة — TEST FIXTURE — غير معزول.
//
// صندوق التجهيزة يشغّل العملية فعلًا بلا عزل، ليثبت مسار الوكيل ← البوابة ← خدمة التنفيذ ←
// المنفذ ← النتيجة ← الدليل على أي منصّة. لا يُربط في تركيب المنتج أبدًا (يحرس ذلك اختبار
// في المضيف)، ولا يُدّعى به عزل: العزل الحقيقي (AppContainer + Job) يُقاس أصليًّا على ويندوز.

#![allow(dead_code)]

#[path = "../../../providers/tests/support/mod.rs"]
pub mod support;

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use polaris_host_core::ipc::gateway::Gateway;
use polaris_host_core::ipc::identity::TransportIdentity;
use polaris_host_core::p02::ports::{FixedPrompt, MapEnvironment, MemoryCredentialStore};
use polaris_host_core::p02::Phase02Config;
use polaris_host_core::p05::browser::url_policy::NavigationPolicy;
use polaris_host_core::p05::computer::fixture::FixtureDesktop;
use polaris_host_core::p08::browser::{chromium_arguments, read_devtools_active_port, BrowserProcess, BrowserProcessPort, UnavailableBrowser};
use polaris_host_core::p08::execution::{RuntimeCatalog, SandboxEnd, SandboxError, SandboxOutcome, SandboxPort, SandboxRequest};
use polaris_host_core::p08::Phase08Platform;
use polaris_host_core::services::host::{DesktopHost, Phase05Platform};
use polaris_host_core::services::platform_info::PlatformInfoService;
use serde_json::{json, Value};
use support::MockServer;

pub const SESSION: &str = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
pub const ENVELOPE: &str = "1.7";
static COUNTER: AtomicUsize = AtomicUsize::new(1);

pub fn uuid() -> String {
    polaris_host_core::ids::new_uuid_v4()
}

pub fn temp_dir(name: &str) -> PathBuf {
    let dir = polaris_host_core::test_scratch::root().join(format!("p08-{name}-{}", uuid()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// مفسّر Python على جهاز الاختبار، إن وُجد. يُستعمل بدل الملف الوهمي في نسخة البيئة.
pub fn host_python() -> Option<PathBuf> {
    let candidates: &[&str] = if cfg!(windows) { &["python.exe", "py.exe"] } else { &["python3", "python"] };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in candidates {
            let p = dir.join(name);
            if p.is_file() && !p.to_string_lossy().contains("WindowsApps") {
                return Some(p);
            }
        }
    }
    None
}

/// TEST FIXTURE: صندوق غير معزول. يشغّل البرنامج ببيئته الصريحة ومجلده وحدّ زمنه ومخرجاته.
pub struct UnconfinedTestSandbox {
    pub python: Option<PathBuf>,
    pub requests: Mutex<Vec<SandboxRequest>>,
    pub released: Mutex<Vec<String>>,
}

impl UnconfinedTestSandbox {
    pub fn new() -> Self {
        Self { python: host_python(), requests: Mutex::new(Vec::new()), released: Mutex::new(Vec::new()) }
    }
}

impl SandboxPort for UnconfinedTestSandbox {
    fn isolation(&self) -> &'static str {
        "TEST_FIXTURE_UNCONFINED"
    }

    fn run(&self, request: &SandboxRequest) -> Result<SandboxOutcome, SandboxError> {
        self.requests.lock().unwrap().push(request.clone());
        let name = request.program.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let program = if name.starts_with("python") { self.python.clone().ok_or_else(|| SandboxError::Unavailable("no python on the test machine".into()))? } else { request.program.clone() };
        let mut cmd = Command::new(&program);
        cmd.args(&request.arguments).current_dir(&request.working_directory).env_clear().stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for (k, v) in &request.environment {
            cmd.env(k, v);
        }
        if let Some(root) = std::env::var_os("SystemRoot") {
            cmd.env("SystemRoot", root);
        }
        let started = Instant::now();
        let mut child = cmd.spawn().map_err(|e| SandboxError::Launch(e.to_string()))?;
        let mut out = child.stdout.take().unwrap();
        let mut err = child.stderr.take().unwrap();
        let t_out = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = out.read_to_end(&mut b);
            b
        });
        let t_err = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = err.read_to_end(&mut b);
            b
        });
        let deadline = started + Duration::from_millis(request.limits.wall_time_ms);
        let mut end = SandboxEnd::Exited;
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|e| SandboxError::Launch(e.to_string()))? {
                break Some(s);
            }
            if request.cancel.is_cancelled() {
                end = SandboxEnd::Cancelled;
                let _ = child.kill();
                break child.wait().ok();
            }
            if Instant::now() > deadline {
                end = SandboxEnd::TimedOut;
                let _ = child.kill();
                break child.wait().ok();
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        let mut stdout = t_out.join().unwrap_or_default();
        let stderr = t_err.join().unwrap_or_default();
        let truncated = stdout.len() as u64 > request.limits.max_output_bytes;
        stdout.truncate(request.limits.max_output_bytes as usize);
        Ok(SandboxOutcome {
            end,
            exit_code: if end == SandboxEnd::Exited { status.and_then(|s| s.code()).map(i64::from) } else { None },
            stdout,
            stderr,
            output_truncated: truncated,
            duration_ms: started.elapsed().as_millis() as u64,
            processes_total: 1,
            survivors: 0,
            limit: None,
            isolation: "TEST_FIXTURE_UNCONFINED".into(),
        })
    }

    fn release(&self, mission_id: &str, _root: &Path) -> Result<(), SandboxError> {
        self.released.lock().unwrap().push(mission_id.to_string());
        Ok(())
    }
}

/// ينشئ نسخة بيئة Python «معدّة» داخل مجلد البيانات: الملف الموسوم وملف تنفيذي وهمي. الصندوق
/// التجريبي يستبدل به مفسّر الجهاز؛ لا يُنسخ شيء من النظام في الاختبار.
pub fn prepare_fake_python_runtime(data_dir: &Path) {
    let root = data_dir.join("runtimes").join("python");
    std::fs::create_dir_all(root.join("bin")).unwrap();
    std::fs::write(root.join("POLARIS-RUNTIME.json"), b"{\"source\":\"TEST FIXTURE\"}").unwrap();
    std::fs::write(root.join("python.exe"), b"").unwrap();
    std::fs::write(root.join("bin").join("python3"), b"").unwrap();
    std::fs::write(root.join("python312.dll"), b"").unwrap();
}

/// متصفّح Chromium على جهاز الاختبار: متغيّر `POLARIS_TEST_CHROMIUM`، أو Chromium الذي يثبّته
/// Playwright، أو Edge على ويندوز. لا يُنزَّل شيء.
pub fn test_chromium() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("POLARIS_TEST_CHROMIUM").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    for p in ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"] {
        if Path::new(p).is_file() {
            return Some(PathBuf::from(p));
        }
    }
    polaris_host_core::p08::browser::port::edge_candidates().into_iter().find(|p| p.is_file())
}

/// TEST FIXTURE: عملية Chromium يشغّلها الاختبار ويقتلها. على ويندوز يشغّل المنتجُ Edge في كائن
/// مهمّة (app/src/browser_win32.rs)؛ هنا يكفي قتل العملية وانتظارها.
pub struct TestBrowserProcess {
    child: std::process::Child,
    port: u16,
    path: String,
}

impl BrowserProcess for TestBrowserProcess {
    fn devtools(&self) -> (u16, String) {
        (self.port, self.path.clone())
    }
    fn alive(&self) -> bool {
        true
    }
    fn kill(&mut self) -> u32 {
        let _ = self.child.kill();
        let _ = self.child.wait();
        0
    }
}

pub struct TestChromiumPort(pub PathBuf);

impl BrowserProcessPort for TestChromiumPort {
    fn engine(&self) -> &'static str {
        "TEST_FIXTURE_CHROMIUM"
    }
    fn launch(&self, profile: &Path) -> Result<Box<dyn BrowserProcess>, String> {
        let mut args = chromium_arguments(profile);
        if cfg!(unix) {
            // الحاوية تعمل بصلاحية الجذر؛ Chromium يرفض العمل كذلك بلا هذا. اختبار فقط.
            args.insert(0, "--no-sandbox".into());
        }
        let child = Command::new(&self.0).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        let mut child = child;
        match read_devtools_active_port(profile, Duration::from_secs(20)) {
            Ok((port, path)) => Ok(Box::new(TestBrowserProcess { child, port, path })),
            Err(e) => {
                let _ = child.kill();
                Err(e)
            }
        }
    }
}

pub struct Harness {
    pub gateway: Arc<Gateway>,
    pub model: Option<MockServer>,
    pub data_dir: PathBuf,
    pub export_dir: PathBuf,
    pub sandbox: Arc<UnconfinedTestSandbox>,
}

pub fn side_effecting(operation: &str) -> bool {
    // من السجل نفسه، لا قائمة ثانية تنجرف عنه.
    polaris_host_core::contracts::registry::RegistrySet::record(operation).is_some_and(|r| r.idempotency == "REQUIRED")
}

impl Harness {
    pub fn envelope(&self, operation: &str, payload: Value) -> Value {
        let mut doc = json!({
            "contract_version": ENVELOPE, "protocol_version": ENVELOPE, "message_type": "REQUEST", "message_id": uuid(), "correlation_id": uuid(),
            "session_id": SESSION,
            "caller_identity": { "caller_type": "CORE_UI", "principal_id": "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60", "trust_tier": "TIER_2_UNTRUSTED", "session_id": SESSION },
            "timestamp": "2026-09-25T00:00:00Z", "operation": operation, "payload": payload,
        });
        if side_effecting(operation) {
            doc["idempotency_key"] = json!(format!("p08-key-{:012}", COUNTER.fetch_add(1, Ordering::SeqCst)));
        }
        doc
    }

    pub fn call(&self, operation: &str, payload: Value) -> Value {
        self.gateway.handle(&self.envelope(operation, payload)).response
    }

    pub fn ok(&self, operation: &str, payload: Value) -> Value {
        let response = self.call(operation, payload);
        assert!(response.get("error").is_none(), "{operation} failed: {} / {:?}", response["error"], self.gateway.diagnostics().snapshot().last());
        response["result"].clone()
    }

    pub fn err(&self, operation: &str, payload: Value) -> Value {
        let response = self.call(operation, payload);
        assert!(response.get("error").is_some(), "{operation} unexpectedly succeeded: {}", response["result"]);
        response["error"].clone()
    }

    pub fn host(&self) -> &DesktopHost {
        self.gateway.host()
    }
}

fn fake_powershell(data_dir: &std::path::Path) -> PathBuf {
    let path = data_dir.join("fake-bin").join("powershell.exe");
    let _ = std::fs::create_dir_all(path.parent().unwrap());
    let _ = std::fs::write(&path, b"");
    path
}

pub fn build(model: Option<MockServer>) -> Harness {
    build_with_web(model, None)
}

/// كالسابق، مع أصل تجهيزة ويب على الحلقة المحلية ومتصفّح Chromium حقيقي إن وُجد على الجهاز.
pub fn build_with_web(model: Option<MockServer>, web_fixture_port: Option<u16>) -> Harness {
    build_full(model, web_fixture_port, false)
}

/// مضيف بملف PowerShell وهمي: يكفي ليُبنى طلب التشغيل ويُفحص نصّه؛ التشغيل الحقيقي يُقاس أصليًا.
pub fn build_with_powershell() -> Harness {
    build_full(None, None, true)
}

/// كالسابق، وكل مزوّد بعيد يُحلّ إلى تجهيزة على الحلقة المحلية (`remote_fixture`): ليُقاس مسار المزوّد البعيد بلا شبكة.
pub fn build_with_remote(model: MockServer, remote_base: String) -> Harness {
    build_inner(Some(model), None, false, Some(remote_base))
}

fn build_full(model: Option<MockServer>, web_fixture_port: Option<u16>, with_powershell: bool) -> Harness {
    build_inner(model, web_fixture_port, with_powershell, None)
}

/// مضيف فوق مجلد بيانات قائم: إقلاع ثانٍ على القاعدة نفسها، كما يُفتح التطبيق بعد إغلاقه (الجلسة 2، B5).
pub fn build_in(data_dir: PathBuf) -> Harness {
    build_at(None, None, false, None, data_dir, None)
}

fn build_inner(model: Option<MockServer>, web_fixture_port: Option<u16>, with_powershell: bool, remote_fixture: Option<String>) -> Harness {
    build_at(model, web_fixture_port, with_powershell, remote_fixture, temp_dir("data"), None)
}

/// G5 (تكليف 2026-10-14): مضيف بمنفذ صندوق وكتالوج بيئات يمرّرهما المستدعي — على ويندوز صندوق AppContainer الحقيقي وPython
/// المكتشف على الجهاز، أي مسار المنتج نفسه لا التجهيزة. لا ملف Python وهمي في هذه النسخة.
pub fn build_with_platform(model: Option<MockServer>, sandbox: Arc<dyn SandboxPort>, catalog: RuntimeCatalog) -> Harness {
    build_at(model, None, false, None, temp_dir("data"), Some((sandbox, catalog)))
}

fn build_at(model: Option<MockServer>, web_fixture_port: Option<u16>, with_powershell: bool, remote_fixture: Option<String>, data_dir: PathBuf, platform: Option<(Arc<dyn SandboxPort>, RuntimeCatalog)>) -> Harness {
    let export_dir = temp_dir("exports");
    if platform.is_none() {
        prepare_fake_python_runtime(&data_dir);
    }
    let sandbox = Arc::new(UnconfinedTestSandbox::new());
    let config = Phase02Config {
        data_dir: Some(data_dir.clone()),
        credential_store: Arc::new(MemoryCredentialStore::default()),
        credential_prompt: Arc::new(FixedPrompt(None)),
        environment: Arc::new(MapEnvironment(HashMap::new())),
        is_windows: false,
        remote_fixture: remote_fixture.clone(),
    };
    let navigation = match web_fixture_port {
        Some(port) => NavigationPolicy::with_fixture_origins(&[(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port)]),
        None => NavigationPolicy::product(),
    };
    let p05 = Phase05Platform { desktop: Arc::new(FixtureDesktop::new()), navigation: navigation.clone() };
    let browser: Arc<dyn BrowserProcessPort> = match test_chromium() {
        Some(path) => Arc::new(TestChromiumPort(path)),
        None => Arc::new(UnavailableBrowser("no Chromium on the test machine")),
    };
    let (sandbox_port, catalog): (Arc<dyn SandboxPort>, RuntimeCatalog) = match platform {
        Some((port, catalog)) => (port, catalog),
        None => (sandbox.clone(), RuntimeCatalog { powershell: if with_powershell { Some(fake_powershell(&data_dir)) } else { None }, python_source: None, runtimes_root: Some(data_dir.join("runtimes")) }),
    };
    let p08 = Phase08Platform {
        sandbox: sandbox_port,
        catalog,
        pdf_font: std::env::var_os("POLARIS_P08_PDF_FONT").map(PathBuf::from),
        export_root: Some(export_dir.clone()),
        url_opener: None,
        browser,
        navigation,
        remote_fixture: remote_fixture.clone(),
    };
    let host = DesktopHost::with_platforms(PlatformInfoService::default(), config, p05, p08);
    assert!(host.phase08().is_some(), "phase-08 did not build");
    let gateway = Arc::new(Gateway::new(host, TransportIdentity { principal_id: "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60".into(), session_id: SESSION.into() }, Box::new(uuid)));
    let h = Harness { gateway, model, data_dir, export_dir, sandbox };
    if let Some(model) = &h.model {
        h.ok("provider.configure", json!({ "provider_id": "lm-studio", "endpoint": model.url() }));
        let refresh = h.ok("provider.refresh", json!({ "provider_ids": ["lm-studio"] }));
        assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "{refresh}");
        h.ok("model.configure", json!({ "model_id": "lm-studio:fixture-chat", "enabled": true }));
        h.ok("model.preferences.set", json!({ "default_model_id": "lm-studio:fixture-chat" }));
    }
    h
}

/// نصّ JSON لكل النتائج: للبحث عن مسار مطلق أو شكل سرّ عبر الحدّ.
pub fn leaks_path(value: &Value, dir: &Path) -> bool {
    let text = value.to_string();
    let d = dir.to_string_lossy();
    text.contains(d.as_ref()) || text.contains(&d.replace('\\', "\\\\"))
}
