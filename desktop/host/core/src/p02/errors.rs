// أخطاء Phase-02 وتحويلها إلى أخطاء الحدّ.
//
// الخطأ هنا يحمل تفصيلًا للمضيف، ويُحوَّل إلى `HostError` بتصنيف من التسعة
// المعلنة. لا تصنيف جديد، ولا نصّ يعبر.

use crate::ipc::errors::{DesktopErrorCategory, HostError};
use crate::storage::StorageError;

#[derive(Debug, Clone)]
pub enum P02Error {
    /// الطلب يسمّي شيئًا غير موجود أو غير صالح دلاليًا.
    Invalid { pointer: &'static str, detail: String },
    /// تعارض إصدار أو تكرار.
    Conflict(String),
    /// المسار أو المورد خارج النطاق المأذون.
    Denied { pointer: &'static str, detail: String },
    /// الميزة غير متاحة في هذه الحالة (مخزن غير متاح، مزوّد غير قابل للضبط…).
    Unavailable(String),
    Storage(StorageError),
}

impl From<StorageError> for P02Error {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::Conflict => Self::Conflict("version conflict".into()),
            other => Self::Storage(other),
        }
    }
}

impl P02Error {
    pub fn invalid(pointer: &'static str, detail: impl Into<String>) -> Self {
        Self::Invalid { pointer, detail: detail.into() }
    }

    pub fn denied(pointer: &'static str, detail: impl Into<String>) -> Self {
        Self::Denied { pointer, detail: detail.into() }
    }

    pub fn into_host(self) -> HostError {
        match self {
            Self::Invalid { pointer, detail } => HostError::validation(detail).at(format!("/payload{pointer}")),
            Self::Conflict(detail) => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", detail),
            Self::Denied { pointer, detail } => HostError::permission_denied(detail).at(format!("/payload{pointer}")),
            Self::Unavailable(detail) => HostError::new(DesktopErrorCategory::FeatureNotAvailable, "DEPENDENCY_UNAVAILABLE", detail),
            Self::Storage(error) => HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", error.to_string()),
        }
    }
}

impl From<P02Error> for HostError {
    fn from(error: P02Error) -> Self {
        error.into_host()
    }
}

impl From<StorageError> for HostError {
    fn from(error: StorageError) -> Self {
        P02Error::from(error).into_host()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_maps_to_a_declared_category() {
        let cases = [
            P02Error::invalid("/project_id", "x"),
            P02Error::Conflict("x".into()),
            P02Error::denied("/reference", "x"),
            P02Error::Unavailable("x".into()),
            P02Error::Storage(StorageError::Query("x".into())),
        ];
        for case in cases {
            let boundary = case.into_host().to_boundary();
            assert!(boundary.display_message.starts_with("desktop.error."));
        }
    }

    #[test]
    fn a_conflict_is_retryable_and_says_conflict() {
        let boundary = P02Error::Conflict("stale".into()).into_host().to_boundary();
        assert_eq!(boundary.code, "CONFLICT");
        assert!(boundary.retryable);
    }
}
