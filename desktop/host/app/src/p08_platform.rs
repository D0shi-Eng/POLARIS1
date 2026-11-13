// منافذ Phase-08 كما تقدّمها هذه المنصّة: الصندوق، وبيئات التشغيل، والخط، ومجلد التصدير،
// وفتح عنوان التفويض في متصفّح النظام.
//
// كل اكتشاف هنا قراءة لما على القرص، لا تشغيل: لا يُطلق برنامج عند الإقلاع لمعرفة إصدار
// أو مسار. وما لا يوجد يُعلن غائبًا فتظهر حالته في «بيئة التنفيذ» بدل تشغيل بديل.

use std::sync::Arc;

use polaris_host_core::p08::browser::{BrowserProcessPort, UnavailableBrowser};
use polaris_host_core::p08::execution::{RuntimeCatalog, SandboxPort};
use polaris_host_core::p08::oauth::UrlOpener;
use polaris_host_core::p08::Phase08Platform;
use polaris_host_win::discovery;

#[cfg(windows)]
struct ShellUrlOpener;

#[cfg(windows)]
impl UrlOpener for ShellUrlOpener {
    /// يفتح عنوان https وحده في المتصفّح الافتراضي (الاستدعاء في ملف FFI المسمّى).
    fn open(&self, url: &str) -> bool {
        polaris_host_win::open_https_url(url)
    }
}

pub fn phase08_platform() -> Phase08Platform {
    #[cfg(windows)]
    let sandbox: Arc<dyn SandboxPort> = Arc::new(polaris_host_win::Win32Sandbox::new());
    #[cfg(not(windows))]
    let sandbox: Arc<dyn SandboxPort> = Arc::new(polaris_host_core::p08::execution::UnavailableSandbox("the execution sandbox is implemented on Windows only"));
    #[cfg(windows)]
    let url_opener: Option<Arc<dyn UrlOpener>> = Some(Arc::new(ShellUrlOpener));
    #[cfg(not(windows))]
    let url_opener: Option<Arc<dyn UrlOpener>> = None;
    #[cfg(windows)]
    let browser: Arc<dyn BrowserProcessPort> = match polaris_host_win::find_edge() {
        Some(edge) => Arc::new(polaris_host_win::EdgeBrowser::new(edge)),
        None => Arc::new(UnavailableBrowser("Microsoft Edge was not found on this computer")),
    };
    #[cfg(not(windows))]
    let browser: Arc<dyn BrowserProcessPort> = Arc::new(UnavailableBrowser("the real browser engine is implemented on Windows only"));
    Phase08Platform {
        sandbox,
        catalog: RuntimeCatalog { powershell: discovery::powershell_path(), python_source: discovery::find_python_source(), runtimes_root: None },
        pdf_font: discovery::pdf_font(),
        // CP-03-4: تشغيل بمجلد بيانات مستبدَل يصدّر تحته، لا في مستندات المستخدم.
        export_root: crate::platform::isolated_export_root(crate::platform::data_dir_override().as_deref()).or_else(discovery::export_root),
        url_opener,
        browser,
        // السياسة نفسها التي يطبّقها Phase-05؛ المضيف يستبدلها بسياسته عند التركيب.
        navigation: polaris_host_core::p05::browser::url_policy::NavigationPolicy::product(),
        // المنتج يتّصل بالمضيفين الحقيقيين وحدهم؛ التجهيزة للاختبار فقط.
        remote_fixture: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_platform_names_no_sandbox_it_cannot_provide() {
        let p = phase08_platform();
        if cfg!(windows) {
            assert_eq!(p.sandbox.isolation(), "APPCONTAINER+JOB");
        } else {
            assert_eq!(p.sandbox.isolation(), "NONE");
        }
    }
}
