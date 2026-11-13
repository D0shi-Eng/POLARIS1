// صحة المزوّد كما قيست.
//
// ثماني حالات، وسبب مصنَّف لكل واحدة. المهلة نوعان لا نوع واحد:
//   - مهلة *قراءة* بعد نجاح الاتصال: الخادم قبِل ثم صمت، فالجواب لم يصل لكن حضوره
//     ثابت. تُسجَّل UNKNOWN بسبب PROVIDER_TIMEOUT.
//   - مهلة *اتصال* (لم يُقبل اتصال أصلًا) على الحلقة المحلية: قياسٌ حقيقي لتعذّر
//     الوصول، كالرفض الصريح. تُسجَّل UNREACHABLE بسبب PROVIDER_TIMEOUT وتشغيلٍ
//     NOT_RUNNING. (ويندوز لا يرفض منفذًا محليًا مغلقًا فورًا بل يستنفد المهلة،
//     فلا يُميَّز غيابُ الخادم بشكل خطأ واحد.)
// والاتصال المرفوض على الحلقة المحلية قياسٌ حقيقي لغياب الخادم. التصنيف الكامل
// في `adapters::common::classify_failure`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthState {
    Healthy,
    Degraded,
    Unreachable,
    AuthRequired,
    AuthFailed,
    RateLimited,
    Misconfigured,
    Unknown,
}

impl HealthState {
    /// هل يجوز توجيه طلب إلى مزوّد بهذه الحالة؟
    pub fn is_routable(self) -> bool {
        matches!(self, Self::Healthy | Self::Degraded | Self::RateLimited)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthReason {
    Ok,
    NotChecked,
    ProviderDisabled,
    EndpointNotConfigured,
    EndpointRejected,
    CredentialMissing,
    CredentialRejected,
    CredentialStoreUnavailable,
    ConnectionRefused,
    NetworkUnreachable,
    NameResolutionFailed,
    TlsFailure,
    ProviderTimeout,
    RateLimited,
    ServerError,
    ProtocolMismatch,
    ResponseInvalid,
    EgressDenied,
}

/// هل البرنامج المحلي مثبّت؟ يُقاس بالمواضع الافتراضية المعروفة فقط، فلا يُقال
/// «غير مثبّت» بل «غير مكتشف».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstallationState {
    Detected,
    NotDetected,
    NotApplicable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuntimeState {
    Running,
    NotRunning,
    NotApplicable,
    Unknown,
}

/// نتيجة فحص واحد. الوقت يضيفه المضيف؛ هنا ما قيس فقط.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealthProbe {
    pub state: HealthState,
    pub reason: HealthReason,
    pub latency_ms: Option<u64>,
    pub runtime: RuntimeState,
}

impl HealthProbe {
    pub fn not_measured(state: HealthState, reason: HealthReason) -> Self {
        Self { state, reason, latency_ms: None, runtime: RuntimeState::Unknown }
    }
}
