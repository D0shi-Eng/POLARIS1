// تطبيع أخطاء المزوّدين إلى مفردات مغلقة.
//
// كل محوّل يترجم فشله إلى رمز واحد من إحدى عشرة قيمة. الجسم الخام للخطأ لا يُحمل
// هنا إلا بعد التنقيح، ولا يُسلسَل أبدًا: `ProviderError` لا ينفّذ Serialize،
// والذي يعبر الحدّ هو الرمز وحده.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::redact::redact;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderErrorCode {
    ProviderUnreachable,
    ProviderTimeout,
    AuthRequired,
    AuthFailed,
    ModelNotFound,
    ModelUnavailable,
    RateLimited,
    InvalidRequest,
    UnsupportedCapability,
    ProviderResponseInvalid,
    ProviderInternalError,
    /// ليس من مفردات المزوّد: الإلغاء قرار المضيف، ويُسجَّل بقيمته الخاصة.
    Cancelled,
}

impl ProviderErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProviderUnreachable => "PROVIDER_UNREACHABLE",
            Self::ProviderTimeout => "PROVIDER_TIMEOUT",
            Self::AuthRequired => "AUTH_REQUIRED",
            Self::AuthFailed => "AUTH_FAILED",
            Self::ModelNotFound => "MODEL_NOT_FOUND",
            Self::ModelUnavailable => "MODEL_UNAVAILABLE",
            Self::RateLimited => "RATE_LIMITED",
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::UnsupportedCapability => "UNSUPPORTED_CAPABILITY",
            Self::ProviderResponseInvalid => "PROVIDER_RESPONSE_INVALID",
            Self::ProviderInternalError => "PROVIDER_INTERNAL_ERROR",
            Self::Cancelled => "CANCELLED",
        }
    }

    /// هل يُعرض على المستخدم زرّ إعادة؟
    pub fn retryable(self) -> bool {
        matches!(
            self,
            Self::ProviderUnreachable | Self::ProviderTimeout | Self::RateLimited | Self::ProviderInternalError
        )
    }
}

#[derive(Clone)]
pub struct ProviderError {
    pub code: ProviderErrorCode,
    pub http_status: Option<u16>,
    /// تشخيص مُنقّح، للمضيف وحده.
    diagnostic: String,
    /// كم ينتظر المضيف قبل الإعادة، كما قاله المزوّد في `retry-after` (2026-10-06). غيابه: لم يقل.
    pub retry_after_ms: Option<u64>,
}

impl ProviderError {
    pub fn new(code: ProviderErrorCode, diagnostic: impl AsRef<str>) -> Self {
        Self { code, http_status: None, diagnostic: redact(diagnostic.as_ref()), retry_after_ms: None }
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.http_status = Some(status);
        self
    }

    /// مهلة `retry-after` بالثواني (الصيغة العددية وحدها؛ صيغة التاريخ تُترك مجهولة)، بسقف ساعة.
    pub fn with_retry_after(mut self, header: Option<&str>) -> Self {
        self.retry_after_ms = header.and_then(|h| h.trim().parse::<f64>().ok()).filter(|s| s.is_finite() && *s >= 0.0).map(|s| (s.min(3_600.0) * 1000.0) as u64);
        self
    }

    pub fn diagnostic(&self) -> &str {
        &self.diagnostic
    }

    /// يطبّع حالة HTTP غير ناجحة. الجسم يُنقّح ولا يُعاد.
    pub fn from_http_status(status: u16, body: &[u8]) -> Self {
        let code = match status {
            400 | 413 | 415 | 422 => ProviderErrorCode::InvalidRequest,
            401 => ProviderErrorCode::AuthFailed,
            403 => ProviderErrorCode::AuthFailed,
            404 => ProviderErrorCode::ModelNotFound,
            408 => ProviderErrorCode::ProviderTimeout,
            409 | 423 => ProviderErrorCode::ModelUnavailable,
            429 => ProviderErrorCode::RateLimited,
            300..=399 => ProviderErrorCode::ProviderResponseInvalid,
            500..=599 => ProviderErrorCode::ProviderInternalError,
            _ => ProviderErrorCode::ProviderResponseInvalid,
        };
        let snippet: String = String::from_utf8_lossy(&body[..body.len().min(2048)]).into_owned();
        Self::new(code, format!("http {status}: {snippet}")).with_status(status)
    }
}

impl fmt::Debug for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ProviderError({} {:?} {})", self.code.as_str(), self.http_status, self.diagnostic)
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping_is_total_and_closed() {
        assert_eq!(ProviderError::from_http_status(401, b"").code, ProviderErrorCode::AuthFailed);
        assert_eq!(ProviderError::from_http_status(429, b"").code, ProviderErrorCode::RateLimited);
        assert_eq!(ProviderError::from_http_status(404, b"").code, ProviderErrorCode::ModelNotFound);
        assert_eq!(ProviderError::from_http_status(302, b"").code, ProviderErrorCode::ProviderResponseInvalid);
        assert_eq!(ProviderError::from_http_status(503, b"").code, ProviderErrorCode::ProviderInternalError);
        assert_eq!(ProviderError::from_http_status(400, b"").code, ProviderErrorCode::InvalidRequest);
    }

    #[test]
    fn the_raw_auth_body_is_redacted() {
        let error = ProviderError::from_http_status(401, br#"{"error":"Incorrect API key provided: sk-proj-abcdefghijklmnop1234567890"}"#);
        assert!(!error.diagnostic().contains("sk-proj-abcdef"), "{}", error.diagnostic());
        assert_eq!(error.to_string(), "AUTH_FAILED");
    }
}
