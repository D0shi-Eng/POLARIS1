// أخطاء الصيانة والاسترداد والتحديث والسياسة: رموز مغلقة، وتفصيل للسجل.
//
// الرمز هو ما يُحكم عليه ويُكتب في الدليل. التفصيل للإنسان ولا يُقارن به شيء،
// ولا يحمل محتوى ملف ولا سرًّا: مسار أو رقم أو اسم خطوة فقط.

use std::fmt;

/// مفردات الرموز كاملة. رمز خارجها خلل في البناء، ويُمسك باختبار.
pub const MAINTENANCE_CODES: &[&str] = &[
    "DATA_DIR_MISSING",
    "DATA_DIR_IN_USE",
    "STORE_MISSING",
    "STORE_NOT_A_DATABASE",
    "STORE_CORRUPT",
    "STORE_SCHEMA_TOO_NEW",
    "STORE_SCHEMA_UNKNOWN",
    "STORE_IO",
    "BACKUP_FAILED",
    "BACKUP_NOT_FOUND",
    "BACKUP_MANIFEST_INVALID",
    "BACKUP_DIGEST_MISMATCH",
    "BACKUP_SCHEMA_MISMATCH",
    "BACKUP_PATH_REFUSED",
    "RESTORE_FAILED",
    "RETENTION_INVALID",
    "POLICY_UNREADABLE",
    "POLICY_TOO_LARGE",
    "POLICY_INVALID",
    "UPDATE_MANIFEST_INVALID",
    "UPDATE_MANIFEST_TOO_LARGE",
    "UPDATE_SIGNATURE_INVALID",
    "UPDATE_KEY_UNTRUSTED",
    "UPDATE_DOWNGRADE_REFUSED",
    "UPDATE_ARTIFACT_MISMATCH",
    "UPDATE_ARTIFACT_UNLISTED",
    "USAGE",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaintenanceError {
    pub code: &'static str,
    pub detail: String,
}

impl MaintenanceError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        debug_assert!(MAINTENANCE_CODES.contains(&code), "undeclared maintenance code {code}");
        Self { code, detail: detail.into() }
    }
}

impl fmt::Display for MaintenanceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for MaintenanceError {}

pub type MaintenanceResult<T> = Result<T, MaintenanceError>;
