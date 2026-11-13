// الاستعادة من نسخة مُتحقَّق منها، والعزل.
//
// ثلاث قواعد:
//   ١ — لا استعادة بلا قفل حصري: التطبيق يعمل يعني أن الملف مفتوح، ولا يُستبدل تحته.
//   ٢ — لا حذف: القاعدة الحالية تُنقل إلى مجلد العزل بملفاتها الثلاثة، وتُسبق —
//       إن كانت سليمة — بنسخة احتياطية سببها PRE_RESTORE، فالاستعادة قابلة للتراجع.
//   ٣ — الملف المستعاد يُنسخ إلى اسم مؤقت، وتُطابَق خلاصته، ثم يُعاد تسميته دفعة
//       واحدة. فشل بعد العزل يعيد الملفات المعزولة إلى مكانها.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

use crate::storage::lock::InstanceLock;

use super::backup::{create_backup, sha256_file, verify_backup, BackupReason};
use super::error::{MaintenanceError, MaintenanceResult};
use super::integrity::{check_file, CheckDepth, IntegrityState};
use super::layout;

#[derive(Debug, Clone, Serialize)]
pub struct QuarantineRecord {
    pub folder: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreOutcome {
    pub backup_id: String,
    pub schema_version: i64,
    pub pre_restore_backup: Option<String>,
    pub quarantined: Option<QuarantineRecord>,
    pub duration_ms: u128,
}

fn io(code: &'static str, e: impl std::fmt::Display) -> MaintenanceError {
    MaintenanceError::new(code, e.to_string())
}

/// ينقل ملفات القاعدة الموجودة إلى مجلد عزل جديد. لا يحذف شيئًا.
pub fn quarantine_store(data_dir: &Path, label: &str, now: &str) -> MaintenanceResult<Option<QuarantineRecord>> {
    let present: Vec<PathBuf> = layout::store_files(data_dir).into_iter().filter(|p| p.exists()).collect();
    if present.is_empty() {
        return Ok(None);
    }
    let stamp: String = now.chars().filter(char::is_ascii_digit).take(14).collect();
    let suffix: String = crate::ids::new_uuid_v4().chars().filter(char::is_ascii_hexdigit).take(8).collect();
    let folder = format!("{stamp}Z-{label}-{suffix}");
    let target = data_dir.join(layout::QUARANTINE_DIR).join(&folder);
    std::fs::create_dir_all(&target).map_err(|e| io("RESTORE_FAILED", e))?;
    let mut moved = Vec::new();
    for path in present {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if let Err(error) = std::fs::rename(&path, target.join(&name)) {
            // تراجع: ما نُقل يعود، فلا تبقى القاعدة نصفين.
            for back in &moved {
                let _ = std::fs::rename(target.join(back), data_dir.join(back));
            }
            return Err(io("RESTORE_FAILED", error));
        }
        moved.push(name);
    }
    Ok(Some(QuarantineRecord { folder, files: moved }))
}

fn unquarantine(data_dir: &Path, record: &QuarantineRecord) {
    let source = data_dir.join(layout::QUARANTINE_DIR).join(&record.folder);
    for name in &record.files {
        let _ = std::fs::rename(source.join(name), data_dir.join(name));
    }
}

/// ينسخ ملف النسخة إلى القاعدة الحيّة: اسم مؤقت، مطابقة خلاصة، ثم إعادة تسمية.
fn place_copy(source: &Path, data_dir: &Path, expected_sha256: &str) -> MaintenanceResult<()> {
    let staging = data_dir.join("polaris.db.restoring");
    let _ = std::fs::remove_file(&staging);
    std::fs::copy(source, &staging).map_err(|e| io("RESTORE_FAILED", e))?;
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&staging) {
        let _ = file.sync_all();
    }
    let (digest, _) = sha256_file(&staging).map_err(|e| MaintenanceError::new("RESTORE_FAILED", e.detail))?;
    if digest != expected_sha256 {
        let _ = std::fs::remove_file(&staging);
        return Err(MaintenanceError::new("BACKUP_DIGEST_MISMATCH", "the placed copy differs from the verified backup"));
    }
    std::fs::rename(&staging, layout::store_file(data_dir)).map_err(|e| {
        let _ = std::fs::remove_file(&staging);
        io("RESTORE_FAILED", e)
    })
}

/// يستعيد نسخة بعينها. القفل الحصري برهانٌ يقدّمه المستدعي أنه وحده على المجلد.
pub fn restore_backup(data_dir: &Path, backup_id: &str, lock: &InstanceLock, now: &str) -> MaintenanceResult<RestoreOutcome> {
    if !lock.is_exclusive() {
        return Err(MaintenanceError::new("DATA_DIR_IN_USE", "restore needs the exclusive maintenance lock"));
    }
    let started = Instant::now();
    let verified = verify_backup(data_dir, backup_id)?;
    // القاعدة الحالية السليمة تُنسخ أولًا: الاستعادة لا تمحو ما كُتب بعد النسخة.
    let current = check_file(&layout::store_file(data_dir), CheckDepth::Quick);
    let pre_restore_backup = if current.state == IntegrityState::Healthy {
        // بلا تقليم هنا: التقليم قد يحذف النسخة التي نستعيد منها نفسها.
        Some(create_backup(data_dir, BackupReason::PreRestore, now, usize::MAX)?.manifest.backup_id)
    } else {
        None
    };
    let quarantined = quarantine_store(data_dir, "pre-restore", now)?;
    if let Err(error) = place_copy(&verified.database, data_dir, &verified.manifest.sha256) {
        if let Some(record) = &quarantined {
            unquarantine(data_dir, record);
        }
        return Err(error);
    }
    let after = check_file(&layout::store_file(data_dir), CheckDepth::Full);
    if after.state != IntegrityState::Healthy {
        let _ = std::fs::remove_file(layout::store_file(data_dir));
        if let Some(record) = &quarantined {
            unquarantine(data_dir, record);
        }
        return Err(MaintenanceError::new("RESTORE_FAILED", format!("the restored store is {}", after.state.as_str())));
    }
    Ok(RestoreOutcome {
        backup_id: backup_id.to_string(),
        schema_version: verified.manifest.schema_version,
        pre_restore_backup,
        quarantined,
        duration_ms: started.elapsed().as_millis(),
    })
}

/// يعزل القاعدة الحالية ليبدأ التطبيق بقاعدة جديدة. للحالة التي لا نسخة فيها لقاعدة تالفة.
/// لا يحذف: الملفات المعزولة تبقى لمن يريد استخراج شيء منها.
pub fn reset_store(data_dir: &Path, lock: &InstanceLock, now: &str) -> MaintenanceResult<Option<QuarantineRecord>> {
    if !lock.is_exclusive() {
        return Err(MaintenanceError::new("DATA_DIR_IN_USE", "reset needs the exclusive maintenance lock"));
    }
    quarantine_store(data_dir, "reset", now)
}
