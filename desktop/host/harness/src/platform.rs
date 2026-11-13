// بناء المضيف الحقيقي للقياس: المنصّة نفسها التي يبنيها الربط (صندوق AppContainer، وEdge في كائن
// مهمّة، وPowerShell وPython المكتشفان، وخط PDF)، فوق مجلد بيانات تملكه العُدّة، ومجلد تصدير
// تملكه كذلك (لا مجلد مستندات المستخدم). والنداءات تمرّ بالبوابة الحقيقية بظرف 1.7، فتُفحص
// الحمولة والنتيجة بمخطّطيهما كما في المنتج.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use polaris_host_core::contracts::registry::RegistrySet;
use polaris_host_core::ipc::gateway::Gateway;
use polaris_host_core::ipc::identity::TransportIdentity;
use polaris_host_core::p02::ports::{FixedPrompt, MapEnvironment, MemoryCredentialStore};
use polaris_host_core::p02::Phase02Config;
use polaris_host_core::p05::browser::url_policy::NavigationPolicy;
use polaris_host_core::p05::computer::port::UnavailableDesktop;
use polaris_host_core::p08::browser::{BrowserProcessPort, UnavailableBrowser};
use polaris_host_core::p08::execution::{RuntimeCatalog, SandboxPort, UnavailableSandbox};
use polaris_host_core::p08::Phase08Platform;
use polaris_host_core::services::host::{DesktopHost, Phase05Platform};
use polaris_host_core::services::platform_info::PlatformInfoService;
use polaris_host_win::discovery;
use serde_json::{json, Value};

pub const SESSION: &str = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
const PRINCIPAL: &str = "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60";
static COUNTER: AtomicUsize = AtomicUsize::new(1);

pub struct Harness {
    pub gateway: Arc<Gateway>,
    pub data_dir: PathBuf,
    pub export_dir: PathBuf,
    pub isolation: &'static str,
    pub engine: &'static str,
}

fn sandbox_and_browser(data_dir: &Path) -> (Arc<dyn SandboxPort>, Arc<dyn BrowserProcessPort>) {
    #[cfg(windows)]
    {
        let _ = data_dir;
        let sandbox: Arc<dyn SandboxPort> = Arc::new(polaris_host_win::Win32Sandbox::new());
        let browser: Arc<dyn BrowserProcessPort> = match polaris_host_win::find_edge() {
            Some(edge) => Arc::new(polaris_host_win::EdgeBrowser::new(edge)),
            None => Arc::new(UnavailableBrowser("Microsoft Edge was not found on this computer")),
        };
        (sandbox, browser)
    }
    #[cfg(not(windows))]
    {
        crate::dev::prepare_dev_python(&data_dir.join("runtimes"));
        let sandbox: Arc<dyn SandboxPort> = match crate::dev::dev_python() {
            Some(p) => Arc::new(crate::dev::UnconfinedDevSandbox { python: Some(p) }),
            None => Arc::new(UnavailableSandbox("no development sandbox")),
        };
        let browser: Arc<dyn BrowserProcessPort> = match crate::dev::dev_chromium() {
            Some(p) => Arc::new(crate::dev::DevChromium(p)),
            None => Arc::new(UnavailableBrowser("no Chromium for development")),
        };
        (sandbox, browser)
    }
}

pub fn build(data_dir: &Path, web_port: Option<u16>) -> Harness {
    let export_dir = data_dir.join("exports");
    let _ = std::fs::create_dir_all(&export_dir);
    let (sandbox, browser) = sandbox_and_browser(data_dir);
    let isolation = sandbox.isolation();
    let engine = browser.engine();
    let _ = UnavailableSandbox("unused");
    let navigation = match web_port {
        Some(port) => NavigationPolicy::with_fixture_origins(&[(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port)]),
        None => NavigationPolicy::product(),
    };
    let config = Phase02Config {
        data_dir: Some(data_dir.to_path_buf()),
        // القياس على مزوّد بعيد حقيقي يقرأ المفتاح الذي حفظه المالك (قراءة فقط)؛ وإلا فلا مفتاح.
        credential_store: if std::env::var("POLARIS_P08_REAL_KEYS").is_ok_and(|v| v == "1") {
            Arc::new(crate::credentials::ReadOnlyWindowsStore)
        } else {
            Arc::new(MemoryCredentialStore::default())
        },
        credential_prompt: Arc::new(FixedPrompt(None)),
        environment: Arc::new(MapEnvironment(HashMap::new())),
        is_windows: cfg!(windows),
        remote_fixture: None,
    };
    let p05 = Phase05Platform { desktop: Arc::new(UnavailableDesktop("the harness does not drive the desktop")), navigation: navigation.clone() };
    let catalog = RuntimeCatalog {
        powershell: discovery::powershell_path(),
        python_source: discovery::find_python_source(),
        runtimes_root: None,
    };
    let p08 = Phase08Platform {
        sandbox,
        catalog,
        pdf_font: discovery::pdf_font().or_else(|| ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].iter().map(PathBuf::from).find(|p| p.is_file())),
        export_root: Some(export_dir.clone()),
        url_opener: None,
        browser,
        navigation,
        remote_fixture: None,
    };
    let host = DesktopHost::with_platforms(PlatformInfoService::default(), config, p05, p08);
    let gateway = Arc::new(Gateway::new(host, TransportIdentity { principal_id: PRINCIPAL.into(), session_id: SESSION.into() }, Box::new(polaris_host_core::ids::new_uuid_v4)));
    Harness { gateway, data_dir: data_dir.to_path_buf(), export_dir, isolation, engine }
}

impl Harness {
    /// نداء عبر البوابة الحقيقية. يعيد النتيجة أو الخطأ كما عبر الحدّ.
    pub fn call(&self, operation: &str, payload: Value) -> Result<Value, Value> {
        let record = RegistrySet::record(operation);
        let version = record.map(|r| r.envelope_version.clone()).unwrap_or_else(|| "1.7".into());
        let version = if version.as_str() < "1.7" { "1.7".to_string() } else { version };
        let mut doc = json!({
            "contract_version": version, "protocol_version": version, "message_type": "REQUEST",
            "message_id": polaris_host_core::ids::new_uuid_v4(), "correlation_id": polaris_host_core::ids::new_uuid_v4(),
            "session_id": SESSION,
            "caller_identity": { "caller_type": "CORE_UI", "principal_id": PRINCIPAL, "trust_tier": "TIER_2_UNTRUSTED", "session_id": SESSION },
            "timestamp": crate::report::now(), "operation": operation, "payload": payload,
        });
        if record.is_some_and(|r| r.idempotency == "REQUIRED") {
            doc["idempotency_key"] = json!(format!("p08-native-{:012}", COUNTER.fetch_add(1, Ordering::SeqCst)));
        }
        let response = self.gateway.handle(&doc).response;
        match response.get("error") {
            Some(e) => Err(e.clone()),
            None => Ok(response.get("result").cloned().unwrap_or(Value::Null)),
        }
    }

    /// مقبض يحمل البوابة وحدها، لخيط مراقبة يلغي أو يبدأ مهمّة.
    pub fn detached(gateway: Arc<Gateway>) -> Harness {
        Harness { gateway, data_dir: PathBuf::new(), export_dir: PathBuf::new(), isolation: "", engine: "" }
    }

    pub fn host(&self) -> &DesktopHost {
        self.gateway.host()
    }
}
