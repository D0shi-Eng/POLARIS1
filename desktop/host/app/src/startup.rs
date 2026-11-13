// قياس الإقلاع، وكتابة تقرير القياس.
//
// القياس يقع على جانب المضيف لأنه الطرف الذي يعرف لحظة بدء العملية. الكتابة
// مشروطة بمتغيّر بيئة: بلا المتغيّر لا يُفتح ملف ولا يُكتب شيء، فالمنتج لا يترك
// أثرًا على قرص المستخدم من أجل قياس لا يطلبه أحد.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Value};

/// أصل الصفحة كما يُسجَّل في التقرير.
///
/// `http://tauri.localhost` على Windows أصلٌ عادي. أما `tauri://localhost` (مخطط
/// غير خاص) فأصله معتم ويُسلسَل "null"، فيضيع الفرق بين الواجهة المحزومة وأي
/// صفحة أخرى. في هذه الحالة يُسجَّل المخطط والمضيف كما هما، بلا مسار ولا استعلام.
pub fn page_origin(url: &tauri::Url) -> String {
    let origin = url.origin();
    if origin.is_tuple() {
        return origin.ascii_serialization();
    }
    format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""))
}

/// اسم متغيّر البيئة الذي يفعّل التقرير ويحدد مساره.
pub const REPORT_PATH_ENV: &str = "POLARIS_STARTUP_REPORT";

#[derive(Default)]
struct Observations {
    /// أول طلب وصل من العارض: هذا هو «العارض صار جاهزًا» مقيسًا لا مقدَّرًا.
    first_request_ms: Option<u128>,
    bootstrap_request_ms: Option<u128>,
    bootstrap_handle_ms: Option<u128>,
    operations: Vec<(String, u128, u128)>,
    /// أصل أول صفحة حمّلها WebView. يثبت من داخل التطبيق من أين جاءت الواجهة:
    /// الملفات المحزومة أو خادم تطوير. لا لقطة شاشة ولا مطابقة صور.
    renderer_origin: Option<String>,
}

pub struct StartupReport {
    path: Option<PathBuf>,
    observations: Mutex<Observations>,
}

impl StartupReport {
    pub fn from_environment() -> Self {
        let path = std::env::var(REPORT_PATH_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);
        Self { path, observations: Mutex::new(Observations::default()) }
    }

    pub fn enabled(&self) -> bool {
        self.path.is_some()
    }

    /// يسجّل عملية وصلت، ويكتب التقرير بعد الإقلاع مباشرة.
    pub fn observe(&self, operation: &str, since_start_ms: u128, handle_ms: u128) {
        let should_write = {
            let Ok(mut observations) = self.observations.lock() else { return };
            if observations.first_request_ms.is_none() {
                observations.first_request_ms = Some(since_start_ms);
            }
            observations.operations.push((operation.to_string(), since_start_ms, handle_ms));
            if operation == "desktop.bootstrap" && observations.bootstrap_request_ms.is_none() {
                observations.bootstrap_request_ms = Some(since_start_ms);
                observations.bootstrap_handle_ms = Some(handle_ms);
                true
            } else {
                false
            }
        };
        if should_write {
            self.write_startup();
        }
    }

    /// يسجّل أصل أول تحميل صفحة. لا يكتب ملفًا: الكتابة تبقى مربوطة بطلب
    /// الإقلاع، فوجود التقرير يظل دليلًا على أن الواجهة وصلت فعلًا إلى المضيف.
    pub fn observe_navigation(&self, origin: String) {
        let Ok(mut observations) = self.observations.lock() else { return };
        if observations.renderer_origin.is_none() {
            observations.renderer_origin = Some(origin);
        }
    }

    fn document(&self) -> Value {
        let observations = self.observations.lock();
        let (first, bootstrap, handle, count, origin) = match observations {
            Ok(ref o) => (
                o.first_request_ms,
                o.bootstrap_request_ms,
                o.bootstrap_handle_ms,
                o.operations.len(),
                o.renderer_origin.clone(),
            ),
            Err(_) => (None, None, None, 0, None),
        };
        json!({
            "kind": "POLARIS_DESKTOP_STARTUP",
            "measurement_source": "HOST_PROCESS",
            "renderer_first_request_ms": first,
            "bootstrap_request_ms": bootstrap,
            "bootstrap_handle_ms": handle,
            "observed_operations": count,
            "renderer_origin": origin,
        })
    }

    fn write_startup(&self) {
        let Some(path) = self.path.as_ref() else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let body = format!("{}\n", serde_json::to_string_pretty(&self.document()).unwrap_or_default());
        let _ = fs::write(path, body);
    }

    /// يكتب تقرير E2E بجوار تقرير الإقلاع. يُستدعى من أمر مُترجَم مع الميزة `e2e` وحدها.
    #[cfg_attr(not(feature = "e2e"), allow(dead_code))]
    pub fn write_e2e(&self, report: &Value) -> bool {
        let Some(path) = self.path.as_ref() else { return false };
        let target = path.with_file_name(format!(
            "{}-e2e.json",
            path.file_stem().and_then(|s| s.to_str()).unwrap_or("polaris")
        ));
        let merged = json!({
            "kind": "POLARIS_DESKTOP_E2E",
            "startup": self.document(),
            "renderer": report,
        });
        let body = format!("{}\n", serde_json::to_string_pretty(&merged).unwrap_or_default());
        fs::write(target, body).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::page_origin;

    fn origin(text: &str) -> String {
        page_origin(&tauri::Url::parse(text).expect("a valid test URL"))
    }

    #[test]
    fn the_windows_packaged_origin_is_recorded_as_is() {
        assert_eq!(origin("http://tauri.localhost/index.html"), "http://tauri.localhost");
        assert_eq!(origin("https://tauri.localhost/"), "https://tauri.localhost");
    }

    #[test]
    fn a_development_server_keeps_its_port() {
        assert_eq!(origin("http://localhost:5173/"), "http://localhost:5173");
    }

    #[test]
    fn an_opaque_custom_scheme_origin_is_not_recorded_as_null() {
        assert_eq!(origin("tauri://localhost/index.html?x=1#y"), "tauri://localhost");
    }
}
