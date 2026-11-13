// بيئات التشغيل التي يعرفها الصندوق: PowerShell المدمج في ويندوز، ونسخة Python يملكها POLARIS.
//
// لماذا نسخة Python مملوكة وليست Python المستخدم مباشرةً: الصندوق يحتاج أن يمنح
// هوية العزل قراءة مجلد البيئة. منح ذلك على مجلد يملكه المستخدم تغيير في أذونات
// ملفاته؛ منحه على نسخة داخل مجلد بيانات POLARIS لا يمسّ شيئًا للمستخدم. والنسخة
// تُعدّ مرة واحدة بطلب صريح، وتُعلن مصدرها وإصدارها وحجمها. والتثبيت داخل مهمّة يذهب
// إلى `.polaris/site-packages` في مساحتها، فلا تتغيّر النسخة ولا Python النظام أبدًا.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// سقف نسخ البيئة: أي مصدر أكبر من هذا ليس «Python عاديًّا» ويُرفض.
pub const MAX_RUNTIME_BYTES: u64 = 3 * 1024 * 1024 * 1024;
pub const MAX_RUNTIME_FILES: usize = 150_000;

/// مجلدات تُتخطّى عند النسخ: وثائق وأدوات واختبارات المكتبة القياسية وواجهات رسومية.
const SKIPPED: [&str; 7] = ["Doc", "Tools", "tcl", "__pycache__", "test", "idlelib", "turtledemo"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PythonRuntime {
    pub home: PathBuf,
    pub executable: PathBuf,
    pub version: String,
}

/// ما تقدّمه المنصّة: مسار PowerShell، ومصدر Python المرشّح للنسخ.
#[derive(Debug, Clone, Default)]
pub struct RuntimeCatalog {
    pub powershell: Option<PathBuf>,
    /// مجلد Python الأساسي على الجهاز (المصدر). لا يُشغَّل منه شيء.
    pub python_source: Option<PathBuf>,
    /// المجلد الذي تُنسخ إليه البيئة داخل بيانات POLARIS.
    pub runtimes_root: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProvisionReport {
    pub source_label: String,
    pub files: usize,
    pub bytes: u64,
    pub version: String,
    pub reused: bool,
}

/// إصدار Python من اسم مكتبته (`python312.dll`) أو من ملف `pyvenv.cfg`/اسم المجلد.
fn detect_version(dir: &Path) -> Option<String> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if let Some(rest) = name.strip_prefix("python").and_then(|r| r.strip_suffix(".dll")) {
            if rest.len() >= 2 && rest.chars().all(|c| c.is_ascii_digit()) {
                return Some(format!("{}.{}", &rest[..1], &rest[1..]));
            }
        }
    }
    None
}

fn python_exe(dir: &Path) -> PathBuf {
    if dir.join("python.exe").is_file() {
        dir.join("python.exe")
    } else {
        dir.join("bin").join("python3")
    }
}

impl RuntimeCatalog {
    /// نسخة Python الجاهزة إن أُعدّت. لا يُنشئ شيئًا.
    pub fn python(&self) -> Option<PythonRuntime> {
        let root = self.runtimes_root.as_ref()?.join("python");
        let marker = root.join("POLARIS-RUNTIME.json");
        if !marker.is_file() {
            return None;
        }
        let exe = python_exe(&root);
        exe.is_file().then(|| PythonRuntime { version: detect_version(&root).unwrap_or_else(|| "unknown".into()), executable: exe, home: root })
    }

    /// هل يمكن أن تتوفّر Python الآن؟ جاهزة، أو موجودة على الجهاز فتُعدّ عند أول استعمال (DEF-35).
    pub fn python_preparable(&self) -> bool {
        self.python().is_some() || (self.runtimes_root.is_some() && self.python_source.as_deref().is_some_and(|s| python_exe(s).is_file()))
    }

    /// النسخة الجاهزة، أو إعدادها الآن من Python الجهاز (نسخ محلي داخل مجلد بيانات POLARIS، بلا شبكة) كما يفعل زر الإعدادات.
    /// يعيد النسخة وهل أُعدّت في هذا النداء. إعداد واحد في وقت واحد: نداءان متزامنان لا ينسخان مرتين.
    pub fn ensure_python(&self) -> Result<(PythonRuntime, bool), String> {
        static PREPARING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        if let Some(ready) = self.python() {
            return Ok((ready, false));
        }
        if self.python_source.is_none() {
            return Err("Python is not installed on this computer: the user can install Python 3 for Windows, then prepare it in Settings > Execution environment".into());
        }
        let _guard = PREPARING.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(ready) = self.python() {
            return Ok((ready, false));
        }
        self.provision_python()?;
        self.python().map(|ready| (ready, true)).ok_or_else(|| "Python was copied but its interpreter was not found".into())
    }

    /// يعدّ نسخة Python من المصدر. إعادة الإعداد مع نسخة قائمة لا تنسخ من جديد.
    pub fn provision_python(&self) -> Result<ProvisionReport, String> {
        let runtimes = self.runtimes_root.as_ref().ok_or("the runtimes folder is not configured")?;
        // نسخة أُعدّت سابقًا تبقى صالحة ولو غاب مصدرها بعد ذلك: لا نسخ من جديد. طبقة التوافق تُضاف إن نقصت (R-36).
        if let Some(existing) = self.python() {
            install_sandbox_compat(&existing.home)?;
            return Ok(ProvisionReport { source_label: self.python_source.as_deref().map(label).unwrap_or_else(|| "python".into()), files: 0, bytes: 0, version: existing.version, reused: true });
        }
        let source = self.python_source.as_ref().ok_or("a Python installation was not found on this computer")?;
        if !python_exe(source).is_file() {
            return Err("the Python source folder holds no interpreter".into());
        }
        let target = runtimes.join("python");
        let staging = runtimes.join(format!(".python-staging-{}", crate::ids::new_uuid_v4()));
        fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let mut files = 0usize;
        let mut bytes = 0u64;
        let copied = copy_tree(source, &staging, &mut files, &mut bytes);
        if let Err(e) = copied {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
        install_sandbox_compat(&staging)?;
        let version = detect_version(&staging).unwrap_or_else(|| "unknown".into());
        let manifest = serde_json::json!({ "source": label(source), "files": files, "bytes": bytes, "version": version });
        fs::write(staging.join("POLARIS-RUNTIME.json"), manifest.to_string()).map_err(|e| e.to_string())?;
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
        }
        fs::rename(&staging, &target).map_err(|e| e.to_string())?;
        Ok(ProvisionReport { source_label: label(source), files, bytes, version, reused: false })
    }
}

/// R-36 (قِيس 2026-10-14 على الصندوق الحقيقي بنموذج حقيقي، python-developer): `tempfile.mkdtemp` في Python 3.13 على ويندوز ينشئ
/// المجلد بـ`os.mkdir(..., 0o700)`، وهذا يضع عليه قائمة صلاحيات لا تمنح إلا المستخدم والمديرين والنظام (gh-118486). هوية
/// AppContainer ليست منهم، فيعجز الصندوق عن فتح المجلد الذي أنشأه للتو (`PermissionError: [WinError 5]`)، وتفشل كل شيفرة تستعمل
/// `tempfile`. الإصلاح في نسخة Python التي يملكها POLARIS: ملف `.pth` يحمّل وحدة صغيرة عند بدء كل عملية Python (ومنها العمليات
/// الفرعية)، وهي داخل صندوق POLARIS على ويندوز وحده تُسقط وضع 0o700 فيرث المجلد صلاحيات المساحة كما يرثها كل ملف آخر فيها.
/// خارج الصندوق (بلا `POLARIS_EXECUTION=1`) أو على غير ويندوز لا تغيّر شيئًا.
pub const SANDBOX_COMPAT_MODULE: &str = "polaris_sandbox_compat";
const SANDBOX_COMPAT_SOURCE: &str = r#"# POLARIS: sandbox compatibility, loaded by polaris_sandbox_compat.pth (R-36).
import os

if os.name == "nt" and os.environ.get("POLARIS_EXECUTION") == "1":
    _polaris_mkdir = os.mkdir

    def _mkdir(path, mode=0o777, *, dir_fd=None):
        # 0o700 on Windows sets an owner-only ACL that excludes the AppContainer identity; inherit the workspace ACL instead.
        if dir_fd is None:
            return _polaris_mkdir(path, 0o777)
        return _polaris_mkdir(path, 0o777, dir_fd=dir_fd)

    os.mkdir = _mkdir
"#;

/// يكتب طبقة التوافق في `Lib/site-packages` من نسخة Python (أو مجلد `site-packages` الذي يجده)، إن لم تكن مطابقة.
fn install_sandbox_compat(home: &Path) -> Result<(), String> {
    let site = [home.join("Lib").join("site-packages"), home.join("lib").join("site-packages")].into_iter().find(|p| p.is_dir()).unwrap_or_else(|| home.join("Lib").join("site-packages"));
    fs::create_dir_all(&site).map_err(|e| e.to_string())?;
    let module = site.join(format!("{SANDBOX_COMPAT_MODULE}.py"));
    if fs::read_to_string(&module).ok().as_deref() != Some(SANDBOX_COMPAT_SOURCE) {
        fs::write(&module, SANDBOX_COMPAT_SOURCE).map_err(|e| e.to_string())?;
    }
    let pth = site.join(format!("{SANDBOX_COMPAT_MODULE}.pth"));
    let line = format!("import {SANDBOX_COMPAT_MODULE}
");
    if fs::read_to_string(&pth).ok().as_deref() != Some(line.as_str()) {
        fs::write(&pth, line).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// وصف المصدر بلا مسار المستخدم الكامل: اسم المجلد الأخير وحده.
fn label(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "python".into())
}

fn copy_tree(from: &Path, to: &Path, files: &mut usize, bytes: &mut u64) -> Result<(), String> {
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if SKIPPED.iter().any(|s| name_str.eq_ignore_ascii_case(s)) || name_str.ends_with(".pyc") {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        // الروابط لا تُتبع: نسخة البيئة لا تمتدّ إلى ما خارج مجلد المصدر.
        if meta.file_type().is_symlink() {
            continue;
        }
        let dest = to.join(&name);
        if meta.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &dest, files, bytes)?;
        } else if meta.is_file() {
            *files += 1;
            *bytes += meta.len();
            if *files > MAX_RUNTIME_FILES || *bytes > MAX_RUNTIME_BYTES {
                return Err("the Python source is larger than a runtime this build copies".into());
            }
            fs::copy(entry.path(), &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_runtime_is_copied_once_skipping_caches_and_links() {
        let base = crate::test_scratch::root().join(format!("rt-{}", crate::ids::new_uuid_v4()));
        let source = base.join("Python312");
        fs::create_dir_all(source.join("Lib").join("__pycache__")).unwrap();
        fs::write(source.join("python.exe"), b"exe").unwrap();
        fs::write(source.join("python312.dll"), b"dll").unwrap();
        fs::write(source.join("Lib").join("os.py"), b"x").unwrap();
        fs::write(source.join("Lib").join("__pycache__").join("os.cpython-312.pyc"), b"x").unwrap();
        let catalog = RuntimeCatalog { powershell: None, python_source: Some(source.clone()), runtimes_root: Some(base.join("runtimes")) };
        assert!(catalog.python().is_none());
        let report = catalog.provision_python().unwrap();
        assert!(!report.reused);
        assert_eq!(report.version, "3.12");
        assert_eq!(report.files, 3);
        let rt = catalog.python().unwrap();
        assert!(rt.home.join("Lib").join("os.py").is_file());
        assert!(!rt.home.join("Lib").join("__pycache__").exists());
        assert!(catalog.provision_python().unwrap().reused);
        let _ = fs::remove_dir_all(base);
    }

    /// DEF-35 (تدقيق 2026-10-29): Python لم يكن يُعدّ إلا بزر في الإعدادات، فلم تُعرض أداته ولم يعرف الوكيل لماذا (M03 وM10
    /// فشلا أصليًّا). Python موجود على الجهاز يكفي لعرض الأداة، ويُعدّ عند أول استعمال.
    #[test]
    fn a_python_found_on_the_computer_is_prepared_on_first_use() {
        let base = crate::test_scratch::root().join(format!("rt-{}", crate::ids::new_uuid_v4()));
        let source = base.join("Python313");
        fs::create_dir_all(source.join("Lib")).unwrap();
        fs::write(source.join("python.exe"), b"exe").unwrap();
        fs::write(source.join("python313.dll"), b"dll").unwrap();
        let catalog = RuntimeCatalog { powershell: None, python_source: Some(source), runtimes_root: Some(base.join("runtimes")) };
        assert!(catalog.python().is_none());
        assert!(catalog.python_preparable());
        let (runtime, prepared_now) = catalog.ensure_python().unwrap();
        assert!(prepared_now && runtime.version == "3.13" && catalog.python().is_some());
        assert!(!catalog.ensure_python().unwrap().1, "a ready runtime was prepared again");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn without_python_on_the_computer_the_reason_says_what_the_user_can_do() {
        let base = crate::test_scratch::root().join(format!("rt-{}", crate::ids::new_uuid_v4()));
        let catalog = RuntimeCatalog { powershell: None, python_source: None, runtimes_root: Some(base.join("runtimes")) };
        assert!(!catalog.python_preparable());
        let reason = catalog.ensure_python().unwrap_err();
        assert!(reason.contains("install Python") && reason.contains("Settings"), "{reason}");
    }

    /// R-36: كل نسخة Python يعدّها POLARIS تحمل طبقة توافق الصندوق، والنسخة القائمة تستعيدها إن نقصت.
    #[test]
    fn every_prepared_runtime_carries_the_sandbox_compatibility_layer() {
        let base = crate::test_scratch::root().join(format!("rt-{}", crate::ids::new_uuid_v4()));
        let source = base.join("Python313");
        fs::create_dir_all(source.join("Lib").join("site-packages")).unwrap();
        fs::write(source.join("python.exe"), b"exe").unwrap();
        fs::write(source.join("python313.dll"), b"dll").unwrap();
        let catalog = RuntimeCatalog { powershell: None, python_source: Some(source), runtimes_root: Some(base.join("runtimes")) };
        catalog.provision_python().unwrap();
        let site = catalog.python().unwrap().home.join("Lib").join("site-packages");
        let pth = site.join(format!("{SANDBOX_COMPAT_MODULE}.pth"));
        assert_eq!(fs::read_to_string(&pth).unwrap(), format!("import {SANDBOX_COMPAT_MODULE}
"));
        let module = fs::read_to_string(site.join(format!("{SANDBOX_COMPAT_MODULE}.py"))).unwrap();
        assert!(module.contains("POLARIS_EXECUTION") && module.contains("    os.mkdir = _mkdir"), "{module}");
        fs::remove_file(&pth).unwrap();
        assert!(catalog.provision_python().unwrap().reused);
        assert!(pth.is_file(), "a reused runtime did not get the layer back");
        let _ = fs::remove_dir_all(base);
    }
}
