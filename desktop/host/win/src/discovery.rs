// اكتشاف ما على الجهاز لبيئة التنفيذ: PowerShell، وPython أساسي قابل للنسخ، وخط PDF، ومجلد
// التصدير. قراءة للقرص فقط: لا يُطلق برنامج لمعرفة إصدار أو مسار. يعمل على كل منصّة، ويعيد
// «لا شيء» حيث لا ينطبق.

use std::path::{Path, PathBuf};

/// مجلد Python أساسي صالح للنسخ: فيه python.exe ومكتبة pythonXY.dll، وليس بيئة افتراضية.
pub fn is_base_python(dir: &Path) -> bool {
    if !dir.join("python.exe").is_file() || dir.join("pyvenv.cfg").is_file() {
        return false;
    }
    std::fs::read_dir(dir)
        .map(|entries| {
            entries.flatten().any(|e| {
                let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                n.starts_with("python3") && n.ends_with(".dll") && n.len() > "python3.dll".len()
            })
        })
        .unwrap_or(false)
}

/// إصدار من اسم المجلد (Python312 ← 312) للترتيب؛ الأحدث أولًا.
pub fn version_key(dir: &Path) -> u32 {
    dir.file_name().map(|n| n.to_string_lossy().chars().filter(|c| c.is_ascii_digit()).collect::<String>()).and_then(|d| d.parse().ok()).unwrap_or(0)
}

/// يبحث عن Python أساسي في المواقع المعتادة لمثبّت python.org، ثم في PATH (مع تجاوز
/// اختصارات متجر ويندوز، فهي ليست مجلد Python قابلًا للنسخ).
pub fn find_python_source() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut scan = |root: PathBuf| {
        if let Ok(entries) = std::fs::read_dir(&root) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_ascii_lowercase();
                if name.starts_with("python3") {
                    candidates.push(e.path());
                }
            }
        }
    };
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        scan(PathBuf::from(local).join("Programs").join("Python"));
    }
    for var in ["ProgramFiles", "ProgramW6432"] {
        if let Some(pf) = std::env::var_os(var) {
            scan(PathBuf::from(pf));
        }
    }
    candidates.retain(|d| is_base_python(d));
    candidates.sort_by_key(|d| std::cmp::Reverse(version_key(d)));
    if let Some(best) = candidates.into_iter().next() {
        return Some(best);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find(|d| !d.to_string_lossy().contains("WindowsApps") && is_base_python(d))
}

pub fn windows_dir() -> Option<PathBuf> {
    std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir")).map(PathBuf::from)
}

pub fn powershell_path() -> Option<PathBuf> {
    let p = windows_dir()?.join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    p.is_file().then_some(p)
}

/// خط يغطّي العربية واللاتينية لكتابة PDF. يُضمَّن جزئيًّا في الملف؛ خطّ يمنع مالكُه
/// التضمين يرفضه القارئ نفسه.
pub fn pdf_font() -> Option<PathBuf> {
    let fonts = windows_dir()?.join("Fonts");
    ["arial.ttf", "segoeui.ttf", "tahoma.ttf"].iter().map(|n| fonts.join(n)).find(|p| p.is_file())
}

/// مجلد التصدير: `Documents\POLARIS Exports` للمستخدم. يُنشأ عند أول تصدير لا عند الإقلاع.
pub fn export_root() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    Some(profile.join("Documents").join("POLARIS Exports"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_virtual_environment_or_a_store_alias_is_not_a_python_source() {
        let dir = std::env::temp_dir().join(format!("polaris-py-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("python.exe"), b"").unwrap();
        assert!(!is_base_python(&dir), "a folder without pythonXY.dll was accepted");
        std::fs::write(dir.join("python312.dll"), b"").unwrap();
        assert!(is_base_python(&dir));
        std::fs::write(dir.join("pyvenv.cfg"), b"home = x").unwrap();
        assert!(!is_base_python(&dir), "a virtual environment was accepted");
        let _ = std::fs::remove_dir_all(dir);
    }
}
