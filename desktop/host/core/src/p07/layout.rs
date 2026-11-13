// تخطيط مجلد البيانات كما يعرفه Phase-07: أسماء ثابتة، ومسارات لا تخرج منه.
//
// كل مسار يبنيه الاسترداد أو النسخ الاحتياطي يُشتق من هنا، ولا يُقبل مسار من
// ملف بيان أو من وسيط إلا بعد مطابقته لنمط اسم مغلق. هكذا لا يصير بيان نسخة
// احتياطية طريقًا للكتابة خارج المجلد.

use std::path::{Path, PathBuf};

use crate::storage::db::DATABASE_FILE;

pub const BACKUPS_DIR: &str = "backups";
pub const QUARANTINE_DIR: &str = "quarantine";
pub const RECOVERY_DIR: &str = "recovery";
pub const DIAGNOSTICS_DIR: &str = "diagnostics";
pub const DOWNLOADS_DIR: &str = "p05-downloads";
pub const BACKUP_DB_FILE: &str = "polaris.db";
pub const BACKUP_MANIFEST_FILE: &str = "manifest.json";
pub const LAST_RECOVERY_FILE: &str = "last-recovery.json";

/// ملفات القاعدة الثلاثة: الملف وسجلّ الكتابة المسبقة والذاكرة المشتركة.
pub fn store_files(data_dir: &Path) -> [PathBuf; 3] {
    [
        data_dir.join(DATABASE_FILE),
        data_dir.join(format!("{DATABASE_FILE}-wal")),
        data_dir.join(format!("{DATABASE_FILE}-shm")),
    ]
}

pub fn store_file(data_dir: &Path) -> PathBuf {
    data_dir.join(DATABASE_FILE)
}

/// اسم مجلد نسخة احتياطية: `polaris-backup-<14 رقمًا>Z-<8 خانات ست عشرية>`.
pub fn is_backup_id(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("polaris-backup-") else { return false };
    let bytes = rest.as_bytes();
    bytes.len() == 24
        && bytes[..14].iter().all(u8::is_ascii_digit)
        && bytes[14] == b'Z'
        && bytes[15] == b'-'
        && bytes[16..].iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}

/// يبني معرّف نسخة من ختم زمني ومعرّف عشوائي.
pub fn new_backup_id(now_rfc3339: &str) -> String {
    let digits: String = now_rfc3339.chars().filter(char::is_ascii_digit).take(14).collect();
    let random: String = crate::ids::new_uuid_v4().chars().filter(char::is_ascii_hexdigit).take(8).collect();
    format!("polaris-backup-{digits:0<14}Z-{random}")
}

/// مسار مجلد نسخة داخل مجلد البيانات، بعد التحقق من الاسم.
pub fn backup_dir(data_dir: &Path, backup_id: &str) -> Option<PathBuf> {
    is_backup_id(backup_id).then(|| data_dir.join(BACKUPS_DIR).join(backup_id))
}

/// هل المسار رابط رمزي أو نقطة وصل؟ مسار كهذا لا يُتبع في الاسترداد.
pub fn is_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

/// هل يقع المسار فعلًا تحت الجذر بعد حلّ كل رابط؟
pub fn resolves_inside(root: &Path, path: &Path) -> bool {
    match (std::fs::canonicalize(root), std::fs::canonicalize(path)) {
        (Ok(root), Ok(path)) => path.starts_with(root),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_backup_id_is_a_closed_name_that_cannot_climb_out() {
        let id = new_backup_id("2026-09-24T18:50:00Z");
        assert!(is_backup_id(&id), "{id}");
        for bad in [
            "",
            "polaris-backup-",
            "../polaris-backup-20260924185000Z-abcdef01",
            "polaris-backup-20260924185000Z-abcdef0/",
            "polaris-backup-20260924185000Z-ABCDEF01",
            "polaris-backup-2026092418500xZ-abcdef01",
            "polaris-backup-20260924185000Z-abcdef012",
        ] {
            assert!(!is_backup_id(bad), "{bad}");
            assert!(backup_dir(Path::new("d"), bad).is_none());
        }
    }
}
