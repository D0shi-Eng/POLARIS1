// مرجع مساحة العمل.
//
// الجذر المخزّن مرجع نطاق للسياق، لا إذن ملفات شامل. يُقبل فقط إن كان مجلدًا
// محليًا مطلقًا موجودًا، وليس نقطة إعادة توجيه، وليس مسار شبكة أو جهاز. ويُخزَّن
// بصيغته القانونية حتى لا يتغيّر معناه بين قراءتين.

use std::path::{Component, Path, PathBuf, Prefix};

use crate::p02::errors::P02Error;

/// هل هذا الكائن نقطة إعادة توجيه (رابط رمزي أو وصلة)؟
pub fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// يزيل بادئة المسار الحرفي `\\?\` من مسار قرص محلي، ويرفض ما سواه.
fn display_form(canonical: &Path) -> Result<String, P02Error> {
    let mut components = canonical.components();
    if let Some(Component::Prefix(prefix)) = components.next() {
        match prefix.kind() {
            Prefix::VerbatimDisk(letter) | Prefix::Disk(letter) => {
                let rest: PathBuf = components.collect();
                let rest = rest.to_string_lossy().trim_start_matches(['\\', '/']).to_string();
                return Ok(format!("{}:\\{}", letter as char, rest));
            }
            _ => return Err(P02Error::denied("/workspace_root", "network, device and verbatim UNC paths are not workspace roots")),
        }
    }
    Ok(canonical.to_string_lossy().to_string())
}

/// يتحقق من جذر مساحة العمل ويعيد صيغته القانونية المعروضة.
pub fn validate_root(raw: &str) -> Result<String, P02Error> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(P02Error::invalid("/workspace_root", "the workspace root must be absolute"));
    }
    let lowered = raw.to_ascii_lowercase();
    if raw.starts_with("\\\\") || raw.starts_with("//") || lowered.starts_with("\\\\?\\") {
        return Err(P02Error::denied("/workspace_root", "network and device paths are not workspace roots"));
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| P02Error::invalid("/workspace_root", "the workspace root does not exist"))?;
    if is_reparse_point(&metadata) {
        return Err(P02Error::denied("/workspace_root", "the workspace root is a reparse point"));
    }
    if !metadata.is_dir() {
        return Err(P02Error::invalid("/workspace_root", "the workspace root is not a directory"));
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| P02Error::invalid("/workspace_root", "the workspace root cannot be resolved"))?;
    let shown = display_form(&canonical)?;
    if shown.len() > 512 || shown.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*')) {
        return Err(P02Error::invalid("/workspace_root", "the workspace root has characters the contract cannot carry"));
    }
    // جذر النظام كله ليس مساحة عمل.
    if canonical.parent().is_none() {
        return Err(P02Error::denied("/workspace_root", "a filesystem root is not a workspace"));
    }
    Ok(shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_real_directory_is_accepted_in_canonical_form() {
        let dir = crate::test_scratch::root().join(format!("ws-{}", crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let shown = validate_root(dir.join("sub").join("..").to_str().unwrap()).unwrap();
        assert!(!shown.contains(".."), "{shown}");
        assert!(Path::new(&shown).is_absolute());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn relative_missing_file_and_root_paths_are_refused() {
        assert!(validate_root("relative/dir").is_err());
        assert!(validate_root("/definitely/not/here/polaris").is_err());
        let file = crate::test_scratch::root().join(format!("ws-file-{}", crate::ids::new_uuid_v4()));
        std::fs::write(&file, b"x").unwrap();
        assert!(validate_root(file.to_str().unwrap()).is_err());
        let _ = std::fs::remove_file(&file);
        assert!(validate_root(if cfg!(windows) { "C:\\" } else { "/" }).is_err());
        assert!(validate_root("\\\\server\\share\\x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_is_refused() {
        let dir = crate::test_scratch::root().join(format!("ws-link-{}", crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let link = dir.with_extension("link");
        std::os::unix::fs::symlink(&dir, &link).unwrap();
        assert!(matches!(validate_root(link.to_str().unwrap()), Err(P02Error::Denied { .. })));
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
