// حارس الإقلاع: فحص القاعدة قبل فتحها، واسترداد ما تلف منها.
//
// القرار يتبع حالة الملف:
//   سليم أو غائب أو فارغ ← لا شيء يُفعل.
//   مخطط أحدث            ← يُترك كما هو؛ فتح القاعدة يرفضه ويُعلن ذلك (سلوك قائم).
//   تالف أو ليس قاعدة     ← بقفل حصري: عزل الملفات، ثم استعادة أحدث نسخة تجتاز
//                           التحقق. بلا نسخة: يبقى الملف في مكانه ويُغلق المخزن
//                           (FAIL_CLOSED) — لا تبدأ قاعدة فارغة بصمت فوق بيانات تالفة.
//   تالف ومثيل آخر يعمل  ← لا لمس (FAIL_CLOSED)؛ من يملك الملف الآن ليس هذا المثيل.
//
// كل قرار غير «لا شيء» يُكتب تقريرًا في مجلد الاسترداد، فالمستخدم والأداة يريانه.

use std::path::Path;

use serde::Serialize;

use crate::storage::lock::{InstanceLock, LockError};

use super::backup::latest_verified;
use super::error::MaintenanceError;
use super::integrity::{check_file, CheckDepth, IntegrityReport, IntegrityState};
use super::layout;
use super::restore::{quarantine_store, QuarantineRecord};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryAction {
    None,
    RestoredFromBackup,
    FailedClosed,
}

impl RecoveryAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::RestoredFromBackup => "RESTORED_FROM_BACKUP",
            Self::FailedClosed => "FAILED_CLOSED",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RecoveryReport {
    pub kind: &'static str,
    pub checked_at: String,
    pub action: RecoveryAction,
    pub reason_code: String,
    pub integrity: IntegrityReport,
    pub restored_backup: Option<String>,
    pub quarantined: Option<QuarantineRecord>,
    /// هل كان هذا المثيل وحده على المجلد حين قرّر؟
    pub exclusive: bool,
}

/// نتيجة الحارس: القفل المشترك الذي سيحمله التطبيق، والتقرير.
pub struct Guarded {
    pub lock: InstanceLock,
    pub report: RecoveryReport,
}

fn base(integrity: IntegrityReport, now: &str, exclusive: bool) -> RecoveryReport {
    RecoveryReport {
        kind: "POLARIS_STORE_RECOVERY",
        checked_at: now.to_string(),
        action: RecoveryAction::None,
        reason_code: String::new(),
        integrity,
        restored_backup: None,
        quarantined: None,
        exclusive,
    }
}

fn write_report(data_dir: &Path, report: &RecoveryReport) {
    let dir = data_dir.join(layout::RECOVERY_DIR);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    if let Ok(text) = serde_json::to_string_pretty(report) {
        let _ = std::fs::write(dir.join(layout::LAST_RECOVERY_FILE), format!("{text}\n"));
    }
}

fn to_storage_error(error: LockError) -> MaintenanceError {
    match error {
        LockError::Busy => MaintenanceError::new("DATA_DIR_IN_USE", "maintenance holds the data folder"),
        LockError::Io(e) => MaintenanceError::new("STORE_IO", e),
    }
}

/// يفحص القاعدة ويسترد ما يلزم، ثم يعيد قفلًا مشتركًا يُسلَّم لفتح القاعدة.
pub fn guard(data_dir: &Path, now: &str) -> Result<Guarded, MaintenanceError> {
    std::fs::create_dir_all(data_dir).map_err(|e| MaintenanceError::new("STORE_IO", e.to_string()))?;
    let store = layout::store_file(data_dir);
    match InstanceLock::exclusive(data_dir) {
        Ok(exclusive) => {
            let integrity = check_file(&store, CheckDepth::Quick);
            let mut report = base(integrity.clone(), now, true);
            if integrity.state.damaged() {
                repair(data_dir, now, &mut report);
                write_report(data_dir, &report);
            }
            // لا ترقية من حصري إلى مشترك في المكتبة القياسية: يُحرَّر ثم يؤخذ المشترك.
            // الصيانة إن سبقت في هذه اللحظة رُفض المشترك، وظهر المخزن غير متاح.
            drop(exclusive);
            let lock = InstanceLock::shared(data_dir).map_err(to_storage_error)?;
            Ok(Guarded { lock, report })
        }
        Err(LockError::Busy) => {
            let lock = InstanceLock::shared(data_dir).map_err(to_storage_error)?;
            let integrity = check_file(&store, CheckDepth::Quick);
            let mut report = base(integrity.clone(), now, false);
            if integrity.state.damaged() {
                report.action = RecoveryAction::FailedClosed;
                report.reason_code = "STORE_DAMAGED_WHILE_IN_USE".into();
            }
            Ok(Guarded { lock, report })
        }
        Err(other) => Err(to_storage_error(other)),
    }
}

fn repair(data_dir: &Path, now: &str, report: &mut RecoveryReport) {
    let candidate = match latest_verified(data_dir) {
        Ok(found) => found,
        Err(error) => {
            report.action = RecoveryAction::FailedClosed;
            report.reason_code = error.code.to_string();
            return;
        }
    };
    let Some(backup) = candidate else {
        report.action = RecoveryAction::FailedClosed;
        report.reason_code = format!("STORE_{}_NO_VERIFIED_BACKUP", report.integrity.state.as_str());
        return;
    };
    let quarantined = match quarantine_store(data_dir, "damaged", now) {
        Ok(record) => record,
        Err(error) => {
            report.action = RecoveryAction::FailedClosed;
            report.reason_code = error.code.to_string();
            return;
        }
    };
    report.quarantined = quarantined;
    let staging = data_dir.join("polaris.db.restoring");
    let placed = std::fs::copy(&backup.database, &staging)
        .and_then(|_| std::fs::rename(&staging, layout::store_file(data_dir)));
    let _ = std::fs::remove_file(&staging);
    let after = check_file(&layout::store_file(data_dir), CheckDepth::Full);
    if placed.is_err() || after.state != IntegrityState::Healthy {
        report.action = RecoveryAction::FailedClosed;
        report.reason_code = "RESTORE_FAILED".into();
        return;
    }
    report.action = RecoveryAction::RestoredFromBackup;
    report.reason_code = format!("STORE_{}_RESTORED", report.integrity.state.as_str());
    report.restored_backup = Some(backup.manifest.backup_id);
}
