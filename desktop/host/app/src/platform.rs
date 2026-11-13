// منافذ Phase-02 كما تقدّمها هذه المنصّة: مجلد البيانات، ومخزن الاعتماد،
// ونافذة الإدخال، والبيئة.
//
// على Windows: Credential Manager ونافذة النظام. خارج Windows: لا مخزن، فيُعلن
// غير متاح بدل كتابة السرّ في ملف.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use polaris_host_core::p02::ports::{credential_scope_for, CredentialPrompt, CredentialStore, ProcessEnvironment, ScopedCredentialStore};
use polaris_host_core::p02::Phase02Config;

/// متغيّر يستبدل مجلد البيانات. للاختبار الأصلي كي لا يلمس بيانات المستخدم.
pub const DATA_DIR_ENV: &str = "POLARIS_DATA_DIR";

/// متغيّر WebView2 الموثّق لمجلد ملف المتصفّح (CreateCoreWebView2EnvironmentWithOptions).
pub const WEBVIEW_DATA_ENV: &str = "WEBVIEW2_USER_DATA_FOLDER";

/// مجلد البيانات المستبدَل وحده، إن طُلب.
pub fn data_dir_override() -> Option<PathBuf> {
    std::env::var(DATA_DIR_ENV).ok().filter(|v| !v.trim().is_empty()).map(PathBuf::from)
}

/// ملف WebView2 لمجلد مستبدَل: تحته دائمًا، لا في `EBWebView` الخاص بالمستخدم (D-1).
/// بلا استبدال لا يتغيّر شيء: الإطار يضع الملف في مجلد التطبيق كما كان.
pub fn isolated_webview_folder(data_dir_override: Option<&Path>) -> Option<PathBuf> {
    data_dir_override.map(|dir| dir.join("webview"))
}

/// مجلد التصدير لمجلد بيانات مستبدَل: تحته دائمًا، لا في «المستندات» الحقيقية (CP-03-4، 2026-10-20). قِيس في تشغيل معزول
/// بـ Bonsai: `export_file` كتب في `Documents\POLARIS Exports` للمالك لأن مجلد التصدير لا يتبع المجلد المستبدَل. بلا استبدال لا يتغيّر شيء.
pub fn isolated_export_root(data_dir_override: Option<&Path>) -> Option<PathBuf> {
    data_dir_override.map(|dir| dir.join("exports"))
}

/// يُستدعى قبل بناء الإطار، أي قبل إنشاء بيئة WebView2. مع مجلد مستبدَل يُفرض الملف
/// تحته حتى لو ضُبط المتغيّر على مسار آخر، فلا يختلط تشغيل اختبار بملف المستخدم.
pub fn isolate_webview_profile() {
    if let Some(folder) = isolated_webview_folder(data_dir_override().as_deref()) {
        std::env::set_var(WEBVIEW_DATA_ENV, folder);
    }
}

/// نطاق Credential Manager لمجلد مستبدَل (D-2). بلا استبدال: نطاق الإنتاج، أي لا نطاق.
pub fn credential_scope(data_dir_override: Option<&Path>) -> Option<String> {
    data_dir_override.map(credential_scope_for)
}

/// تجهيزة اختبار تقف مكان المزوّدين البعيدين. تُقرأ في بناء القياس `e2e` وحده.
#[cfg(feature = "e2e")]
pub const REMOTE_FIXTURE_ENV: &str = "POLARIS_E2E_REMOTE_FIXTURE";

fn credential_ports(scope: Option<String>) -> (Arc<dyn CredentialStore>, Arc<dyn CredentialPrompt>) {
    #[cfg(windows)]
    let (store, prompt): (Arc<dyn CredentialStore>, Arc<dyn CredentialPrompt>) =
        (Arc::new(crate::credentials::WindowsCredentialStore), Arc::new(crate::credentials::WindowsCredentialPrompt));
    #[cfg(not(windows))]
    let (store, prompt): (Arc<dyn CredentialStore>, Arc<dyn CredentialPrompt>) = {
        use polaris_host_core::p02::ports::{NoPrompt, UnavailableCredentialStore};
        (Arc::new(UnavailableCredentialStore), Arc::new(NoPrompt))
    };
    match scope {
        Some(scope) => (Arc::new(ScopedCredentialStore::new(store, scope)), prompt),
        None => (store, prompt),
    }
}

fn remote_fixture() -> Option<String> {
    #[cfg(feature = "e2e")]
    {
        std::env::var(REMOTE_FIXTURE_ENV).ok().filter(|v| !v.trim().is_empty())
    }
    #[cfg(not(feature = "e2e"))]
    {
        None
    }
}

/// مسار السياسة المُدارة في بناء القياس وحده: اختبار السياسة الأصلي لا يكتب في
/// مجلد الجهاز العام. ثنائي المنتج لا يقرأ هذا المتغيّر.
#[cfg(feature = "e2e")]
pub const POLICY_PATH_ENV: &str = "POLARIS_E2E_POLICY_PATH";

/// اسم ملف السياسة المُدارة تحت مجلد بيانات البرامج العام للجهاز.
pub const MANAGED_POLICY_RELATIVE: [&str; 3] = ["POLARIS", "policy", "managed-policy.json"];

/// أين يضع مدير الجهاز السياسة المُدارة (Phase-07).
///
/// Windows: `%ProgramData%\POLARIS\policy\managed-policy.json`. السياسة تضيّق ولا
/// توسّع، فمسار يستطيع مستخدم محلّي أن يكتب فيه لا يمنحه شيئًا فوق ما عنده.
/// خارج Windows: لا مسار في هذا البناء (أساس macOS موثّق ولم يُتحقَّق منه أصليًا).
pub fn managed_policy_path() -> Option<PathBuf> {
    #[cfg(feature = "e2e")]
    {
        if let Some(path) = std::env::var(POLICY_PATH_ENV).ok().filter(|v| !v.trim().is_empty()) {
            return Some(PathBuf::from(path));
        }
    }
    if !cfg!(windows) {
        return None;
    }
    let base = std::env::var_os("ProgramData").map(PathBuf::from)?;
    Some(MANAGED_POLICY_RELATIVE.iter().fold(base, |path, part| path.join(part)))
}

/// المجلد المستبدَل، إن طُلب. وإلا مجلد التطبيق المحلي الذي يعطيه الإطار.
pub fn data_dir(app_local_data: Option<PathBuf>) -> Option<PathBuf> {
    std::env::var(DATA_DIR_ENV)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .or(app_local_data)
}

pub fn phase02_config(data_dir: Option<PathBuf>) -> Phase02Config {
    let (credential_store, credential_prompt) = credential_ports(credential_scope(data_dir_override().as_deref()));
    Phase02Config {
        // غياب المجلد يعني قاعدة في الذاكرة: التطبيق يعمل، والبيانات لا تبقى.
        data_dir,
        credential_store,
        credential_prompt,
        environment: Arc::new(ProcessEnvironment),
        is_windows: cfg!(windows),
        remote_fixture: remote_fixture(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_product_build_has_no_remote_fixture() {
        if !cfg!(feature = "e2e") {
            assert!(phase02_config(None).remote_fixture.is_none());
        }
    }

    #[test]
    fn the_managed_policy_lives_under_the_machine_program_data_folder_on_windows() {
        let path = managed_policy_path();
        if cfg!(windows) && std::env::var_os("ProgramData").is_some() && std::env::var_os("POLARIS_E2E_POLICY_PATH").is_none() {
            let path = path.expect("a Windows build named no policy path");
            assert!(path.ends_with(MANAGED_POLICY_RELATIVE.iter().collect::<PathBuf>()), "{}", path.display());
        } else if !cfg!(windows) && std::env::var_os("POLARIS_E2E_POLICY_PATH").is_none() {
            assert!(path.is_none(), "a non-Windows build named a policy path");
        }
    }

    #[test]
    fn the_credential_store_matches_the_platform() {
        assert_eq!(phase02_config(None).credential_store.available(), cfg!(windows));
    }

    #[test]
    fn an_overridden_data_folder_gets_its_own_webview_profile_and_credential_scope() {
        let dir = Path::new(r"D:\POLARIS\_local\qa\data");
        assert_eq!(isolated_webview_folder(Some(dir)), Some(dir.join("webview")));
        assert_eq!(credential_scope(Some(dir)).as_deref(), Some(credential_scope_for(dir).as_str()));
        // بلا استبدال: سلوك المنتج كما هو، لا ملف ولا نطاق جديد.
        assert_eq!(isolated_webview_folder(None), None);
        assert_eq!(credential_scope(None), None);
    }

    #[test]
    fn an_overridden_data_folder_keeps_exports_inside_it() {
        let dir = Path::new(r"D:\POLARIS\_local\qa\data");
        assert_eq!(isolated_export_root(Some(dir)), Some(dir.join("exports")));
        // بلا استبدال: مجلد المنتج (Documents\POLARIS Exports) يبقى من الاكتشاف كما كان.
        assert_eq!(isolated_export_root(None), None);
    }

    #[test]
    fn a_scoped_platform_store_cannot_address_a_production_target() {
        use polaris_host_core::p02::ports::MemoryCredentialStore;
        let shared: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        let owner = polaris_host_providers::SecretValue::new("sk-owner-synthetic".into()).unwrap();
        shared.write("POLARIS/provider/openai", &owner).unwrap();
        let scoped = ScopedCredentialStore::new(shared.clone(), credential_scope(Some(Path::new(r"D:\qa"))).unwrap());
        assert!(scoped.read("POLARIS/provider/openai").unwrap().is_none());
        assert!(!scoped.delete("POLARIS/provider/openai").unwrap());
        assert!(shared.read("POLARIS/provider/openai").unwrap().is_some());
    }
}
