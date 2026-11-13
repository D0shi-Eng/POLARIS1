// سلطة المسار للسياق.
//
// مرجع المصدر نسبيّ إلى جذر المشروع، ويُحلّ هنا وحده: لا مطلق، ولا `..`، ولا اسم
// تيار (`:`)، ولا اسم جهاز محجوز، ولا مكوّن ينتهي بنقطة أو مسافة. كل مكوّن يُفحص
// أنه ليس نقطة إعادة توجيه، ثم يُقارن المسار القانوني بالجذر القانوني. الخروج عن
// الجذر بأي طريق يُرفض.

use std::path::{Component, Path, PathBuf};

use crate::p02::projects::workspace::is_reparse_point;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathDenial {
    NoWorkspace,
    InvalidReference,
    OutOfScope,
    ReparsePoint,
    Missing,
    NotReadable,
}

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3",
    "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "conin$", "conout$",
];

/// يفحص المرجع النصّي قبل أي لمس للقرص.
pub fn check_reference(reference: &str) -> Result<Vec<String>, PathDenial> {
    if reference.is_empty() || reference.len() > 512 {
        return Err(PathDenial::InvalidReference);
    }
    if reference.chars().any(|c| c.is_control() || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*')) {
        return Err(PathDenial::InvalidReference);
    }
    if reference.starts_with('/') || reference.starts_with('\\') {
        return Err(PathDenial::InvalidReference);
    }
    let mut parts = Vec::new();
    for part in reference.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.ends_with('.') || part.ends_with(' ') {
            return Err(PathDenial::InvalidReference);
        }
        let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
        if RESERVED.contains(&stem.as_str()) {
            return Err(PathDenial::InvalidReference);
        }
        parts.push(part.to_string());
    }
    Ok(parts)
}

/// يحلّ مرجعًا إلى مسار داخل الجذر، أو يرفضه بسبب محدّد.
pub fn resolve(root: &str, reference: &str) -> Result<PathBuf, PathDenial> {
    let parts = check_reference(reference)?;
    let root_path = Path::new(root);
    let root_meta = std::fs::symlink_metadata(root_path).map_err(|_| PathDenial::NoWorkspace)?;
    if is_reparse_point(&root_meta) || !root_meta.is_dir() {
        return Err(PathDenial::NoWorkspace);
    }
    let canonical_root = std::fs::canonicalize(root_path).map_err(|_| PathDenial::NoWorkspace)?;

    let mut current = root_path.to_path_buf();
    for part in &parts {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if is_reparse_point(&meta) => return Err(PathDenial::ReparsePoint),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(PathDenial::Missing),
            Err(_) => return Err(PathDenial::NotReadable),
        }
    }
    let canonical = std::fs::canonicalize(&current).map_err(|_| PathDenial::NotReadable)?;
    if !canonical.starts_with(&canonical_root) {
        return Err(PathDenial::OutOfScope);
    }
    // تأكيد إضافي: لا مكوّن أب في الناتج.
    if canonical.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(PathDenial::OutOfScope);
    }
    Ok(canonical)
}

/// المرجع النسبي المعروض لمسار داخل الجذر، بفواصل أمامية.
pub fn relative_display(root: &Path, path: &Path) -> Option<String> {
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let rel = path.strip_prefix(&canonical_root).ok()?;
    let text: Vec<String> = rel.components().filter_map(|c| match c {
        Component::Normal(s) => Some(s.to_string_lossy().to_string()),
        _ => None,
    }).collect();
    Some(if text.is_empty() { ".".to_string() } else { text.join("/") })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> PathBuf {
        let dir = crate::test_scratch::root().join(format!("paths-{}", crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::write(dir.join("docs").join("a.md"), b"hello").unwrap();
        dir
    }

    #[test]
    fn a_file_inside_the_root_resolves() {
        let root = workspace();
        let path = resolve(root.to_str().unwrap(), "docs/a.md").unwrap();
        assert!(path.ends_with("a.md"));
        assert_eq!(relative_display(&root, &path).as_deref(), Some("docs/a.md"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn traversal_absolute_streams_and_devices_are_refused_before_the_disk() {
        for bad in ["../x", "docs/../../x", "/etc/passwd", "\\\\server\\x", "C:\\x", "a.md:stream", "docs/NUL", "con.txt", "docs/x.", "docs/x ", "a\u{0}b"] {
            assert_eq!(check_reference(bad), Err(PathDenial::InvalidReference), "{bad:?}");
        }
    }

    #[test]
    fn a_missing_file_is_missing_not_an_error_of_scope() {
        let root = workspace();
        assert_eq!(resolve(root.to_str().unwrap(), "docs/none.md"), Err(PathDenial::Missing));
        assert_eq!(resolve("/definitely/not/a/root", "a.md"), Err(PathDenial::NoWorkspace));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// هجوم Windows الحقيقي (تدقيق 2026-11-13): وصلة دليل (junction) داخل المشروع تشير خارجه. لا تحتاج صلاحية مدير،
    /// فيستطيع أيّ برنامج أو أرشيف مفكوك زرعها. يجب أن تُرفض قبل قراءة أي شيء خلفها.
    #[cfg(windows)]
    #[test]
    fn a_junction_escaping_the_root_is_refused_on_windows() {
        let root = workspace();
        let outside = crate::test_scratch::root().join(format!("outside-{}", crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), b"secret").unwrap();
        let link = root.join("docs").join("escape");
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).output().unwrap();
        assert!(made.status.success(), "mklink /J failed: {}", String::from_utf8_lossy(&made.stderr));
        assert_eq!(resolve(root.to_str().unwrap(), "docs/escape/secret.txt"), Err(PathDenial::ReparsePoint));
        assert_eq!(resolve(root.to_str().unwrap(), "docs/escape"), Err(PathDenial::ReparsePoint));
        let _ = std::fs::remove_dir(&link);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_escaping_the_root_is_refused() {
        let root = workspace();
        let outside = crate::test_scratch::root().join(format!("outside-{}", crate::ids::new_uuid_v4()));
        std::fs::write(&outside, b"secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("docs").join("link.md")).unwrap();
        assert_eq!(resolve(root.to_str().unwrap(), "docs/link.md"), Err(PathDenial::ReparsePoint));
        std::os::unix::fs::symlink(std::env::temp_dir(), root.join("tmp-link")).unwrap();
        assert_eq!(resolve(root.to_str().unwrap(), "tmp-link/x"), Err(PathDenial::ReparsePoint));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
    }
}
