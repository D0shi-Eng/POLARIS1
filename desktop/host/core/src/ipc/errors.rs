// تصنيف الأخطاء عند الحدّ، وما يُسمح له بالعبور.
//
// `detail_may_cross_boundary` هو `false` لكل التصنيفات التسعة في Phase-01، ولذلك
// لا تُبنى رسالة الخروج بإخفاء اختياري بل بنوعٍ منفصل لا يحمل التفصيل أصلًا:
// `HostError` يعيش داخل المضيف ويحمل التفصيل، و`BoundaryError` هو ما يُسلسَل، ولا
// يملك حقل `internal_detail` ولا `stack`. النسيان هنا ليس ممكنًا، لأن الحقل غير موجود.

use serde::Serialize;

use crate::contracts::registry::ErrorMapping;

/// تصنيفات الأخطاء التسعة المعلنة في خريطة الأخطاء.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopErrorCategory {
    IpcUnavailable,
    IpcTimeout,
    UnsupportedOperation,
    InvalidResponse,
    NativeServiceUnavailable,
    ConfigUnavailable,
    PermissionDenied,
    FeatureNotAvailable,
    InternalError,
}

impl DesktopErrorCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::IpcUnavailable => "IPC_UNAVAILABLE",
            Self::IpcTimeout => "IPC_TIMEOUT",
            Self::UnsupportedOperation => "UNSUPPORTED_OPERATION",
            Self::InvalidResponse => "INVALID_RESPONSE",
            Self::NativeServiceUnavailable => "NATIVE_SERVICE_UNAVAILABLE",
            Self::ConfigUnavailable => "CONFIG_UNAVAILABLE",
            Self::PermissionDenied => "PERMISSION_DENIED",
            Self::FeatureNotAvailable => "FEATURE_NOT_AVAILABLE",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }

    pub const ALL: [DesktopErrorCategory; 9] = [
        Self::IpcUnavailable,
        Self::IpcTimeout,
        Self::UnsupportedOperation,
        Self::InvalidResponse,
        Self::NativeServiceUnavailable,
        Self::ConfigUnavailable,
        Self::PermissionDenied,
        Self::FeatureNotAvailable,
        Self::InternalError,
    ];
}

/// مفردات رموز الأخطاء المغلقة كما يعلنها العقد.
///
/// العيب الذي أغلقته هذه القائمة: كتب Phase-03 رموزًا وصفية خاصّة به
/// (`MISSION_NOT_FOUND`، `MISSION_STATE_CONFLICT`، `NO_MODEL_ROUTED`). كلٌّ منها
/// يجعل ظرف الرد مخالفًا لمخطّطه، فيرفضه العارض كرسالةٍ مشوّهة ويضيع الخطأ
/// الحقيقي خلف خطأ نقل. الرمز الذي يعبر الحدّ من هذه التسعة وحدها؛ والسبب
/// الخاصّ يعيش في التفصيل الداخلي الذي لا يعبر.
pub const CANONICAL_ERROR_CODES: [&str; 9] = [
    "VALIDATION_ERROR",
    "UNSUPPORTED_VERSION",
    "POLICY_DENIED",
    "MALFORMED_MESSAGE",
    "CONTRACT_VIOLATION",
    "DEPENDENCY_UNAVAILABLE",
    "TIMEOUT",
    "CONFLICT",
    "INTERNAL_ERROR",
];

/// خطأ داخل المضيف: يحمل التفصيل، ولا يُسلسَل أبدًا كما هو.
#[derive(Debug, Clone)]
pub struct HostError {
    pub category: DesktopErrorCategory,
    /// الرمز القانوني من مفردات الأخطاء المجمّدة.
    pub canonical_code: &'static str,
    /// مؤشر RFC 6901 داخل الحمولة المخالفة، إن وُجد. لا يحمل قيمة، بل موضعًا.
    pub pointer: Option<String>,
    /// تفصيل داخلي للتشخيص على جانب المضيف. لا يعبر الحدّ.
    pub internal_detail: String,
}

impl HostError {
    pub fn new(
        category: DesktopErrorCategory,
        canonical_code: &'static str,
        internal_detail: impl Into<String>,
    ) -> Self {
        Self { category, canonical_code, pointer: None, internal_detail: internal_detail.into() }
    }

    pub fn at(mut self, pointer: impl Into<String>) -> Self {
        self.pointer = Some(pointer.into());
        self
    }

    pub fn unsupported_operation(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::UnsupportedOperation, "CONTRACT_VIOLATION", detail)
            .at("/operation")
    }

    pub fn unsupported_version(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::UnsupportedOperation, "UNSUPPORTED_VERSION", detail)
            .at("/protocol_version")
    }

    pub fn invalid_message(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::InvalidResponse, "MALFORMED_MESSAGE", detail)
    }

    pub fn validation(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::InvalidResponse, "VALIDATION_ERROR", detail)
    }

    pub fn permission_denied(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::PermissionDenied, "POLICY_DENIED", detail)
    }

    pub fn feature_not_available(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::FeatureNotAvailable, "POLICY_DENIED", detail)
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new(DesktopErrorCategory::InternalError, "INTERNAL_ERROR", detail)
    }

    /// يحوّل الخطأ إلى الشكل الذي يعبر الحدّ. التفصيل يسقط هنا، ولا طريق آخر للخروج.
    pub fn to_boundary(&self) -> BoundaryError {
        let mapping = ErrorMapping::shared();
        let entry = mapping.entry(self.category.as_str());
        // رمز خارج المفردات عيبٌ برمجي، ويُغلق فاشلًا إلى INTERNAL_ERROR: خطأ
        // صادق أفضل من ظرفٍ لا يطابق عقده فيرفضه المستقبِل كلّه. ولا ذعر هنا:
        // إسقاط المضيف على عيب تصنيف أسوأ من الإبلاغ عنه. الحارس الثاني فحصٌ
        // ساكن في مشغّل المطابقة يمنع الرمز غير المُعلَن من الدخول أصلًا.
        BoundaryError {
            code: canonical_or_internal(self.canonical_code).to_string(),
            // مفتاح ترجمة لا نصّ مُوطَّن: النصّ المعروض تبنيه الواجهة من المفتاح،
            // فلا تدخل لغةٌ واحدة في العقد ولا تظهر إنجليزية في واجهة عربية (P01-DEC-07).
            display_message: entry
                .map(|e| e.display_key.clone())
                .unwrap_or_else(|| "desktop.error.internal_error".to_string()),
            pointer: self.pointer.clone(),
            retryable: entry.map(|e| e.retryable).unwrap_or(false),
        }
    }

    /// سطر سجل على جانب المضيف. لا يغادر العملية.
    pub fn diagnostic_line(&self) -> String {
        format!(
            "{} {} {}{}",
            self.category.as_str(),
            self.canonical_code,
            self.pointer.as_deref().unwrap_or("-"),
            format_args!(" {}", self.internal_detail)
        )
    }
}

/// الرمز إن كان مُعلنًا، وإلا `INTERNAL_ERROR`. دالّة نقية تُختبر وحدها.
pub fn canonical_or_internal(code: &str) -> &str {
    if CANONICAL_ERROR_CODES.contains(&code) {
        code
    } else {
        "INTERNAL_ERROR"
    }
}

/// الشكل المُسلسَل للخطأ. لا `internal_detail` ولا `stack` — الحقول غير موجودة.
#[derive(Debug, Clone, Serialize)]
pub struct BoundaryError {
    pub code: String,
    pub display_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointer: Option<String>,
    pub retryable: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_category_has_a_mapping_entry() {
        let mapping = ErrorMapping::shared();
        for category in DesktopErrorCategory::ALL {
            assert!(
                mapping.entry(category.as_str()).is_some(),
                "{} has no entry",
                category.as_str()
            );
        }
    }

    #[test]
    fn a_code_outside_the_contract_vocabulary_fails_closed_rather_than_crossing() {
        // لا `debug_assert` في بناء الإصدار؛ هذا الاختبار يحرس ما يخرج فعلًا.
        assert_eq!(canonical_or_internal("MISSION_STATE_CONFLICT"), "INTERNAL_ERROR");
        assert_eq!(canonical_or_internal("MISSION_NOT_FOUND"), "INTERNAL_ERROR");
        let error = HostError { category: DesktopErrorCategory::ConfigUnavailable, canonical_code: "MISSION_STATE_CONFLICT", pointer: None, internal_detail: "d".into() };
        assert_eq!(error.to_boundary().code, "INTERNAL_ERROR");
        // والرمز القانوني يعبر كما هو.
        let ok = HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "d");
        assert_eq!(ok.to_boundary().code, "CONFLICT");
    }

    #[test]
    fn every_constructor_uses_a_code_the_contract_declares() {
        for error in [
            HostError::unsupported_operation("d"),
            HostError::unsupported_version("d"),
            HostError::invalid_message("d"),
            HostError::validation("d"),
            HostError::permission_denied("d"),
            HostError::feature_not_available("d"),
            HostError::internal("d"),
        ] {
            assert!(CANONICAL_ERROR_CODES.contains(&error.canonical_code), "{} is not declared", error.canonical_code);
        }
    }

    #[test]
    fn the_boundary_shape_has_no_internal_detail_field() {
        let error = HostError::internal("stack: at gateway.rs:1 secret path D:\\POLARIS");
        let json = serde_json::to_value(error.to_boundary()).unwrap();
        let object = json.as_object().unwrap();
        assert!(!object.contains_key("internal_detail"));
        assert!(!object.contains_key("stack"));
        assert!(!json.to_string().contains("POLARIS"));
    }

    #[test]
    fn the_display_message_is_a_key_not_prose() {
        let boundary = HostError::unsupported_operation("x").to_boundary();
        assert_eq!(boundary.display_message, "desktop.error.unsupported_operation");
        assert!(!boundary.display_message.contains(' '));
    }

    #[test]
    fn retryability_comes_from_the_declared_mapping() {
        assert!(HostError::new(DesktopErrorCategory::IpcTimeout, "TIMEOUT", "x").to_boundary().retryable);
        assert!(!HostError::unsupported_operation("x").to_boundary().retryable);
    }
}
