// شكل نتيجة الاستدعاء (`ModelInvokeResultV1` في العقد).

use serde::Serialize;

use polaris_host_providers::domain::facts::Fact;
use polaris_host_providers::domain::FinishReason;
use polaris_host_providers::error::ProviderErrorCode;

use crate::p02::context::assembler::TokenEstimate;
use crate::p02::egress::EgressDecision;
use crate::p02::providers::health::MeasuredMs;
use crate::p02::routing::RoutingDecision;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InvokeStatus {
    Completed,
    Failed,
    Cancelled,
    Denied,
    TimedOut,
}

/// رموز النتيجة: مفردات المزوّد، وما يقرّره المضيف قبل الوصول إليه.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutcomeCode {
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
    Cancelled,
    EgressDenied,
    CredentialStoreUnavailable,
    EndpointNotConfigured,
    ProviderDisabled,
}

impl OutcomeCode {
    pub fn from_provider(code: ProviderErrorCode) -> Self {
        match code {
            ProviderErrorCode::ProviderUnreachable => Self::ProviderUnreachable,
            ProviderErrorCode::ProviderTimeout => Self::ProviderTimeout,
            ProviderErrorCode::AuthRequired => Self::AuthRequired,
            ProviderErrorCode::AuthFailed => Self::AuthFailed,
            ProviderErrorCode::ModelNotFound => Self::ModelNotFound,
            ProviderErrorCode::ModelUnavailable => Self::ModelUnavailable,
            ProviderErrorCode::RateLimited => Self::RateLimited,
            ProviderErrorCode::InvalidRequest => Self::InvalidRequest,
            ProviderErrorCode::UnsupportedCapability => Self::UnsupportedCapability,
            ProviderErrorCode::ProviderResponseInvalid => Self::ProviderResponseInvalid,
            ProviderErrorCode::ProviderInternalError => Self::ProviderInternalError,
            ProviderErrorCode::Cancelled => Self::Cancelled,
        }
    }

    pub fn retryable(self) -> bool {
        matches!(self, Self::ProviderUnreachable | Self::ProviderTimeout | Self::RateLimited | Self::ProviderInternalError)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct OutcomeView {
    pub code: OutcomeCode,
    pub retryable: bool,
}

impl OutcomeView {
    pub fn of(code: OutcomeCode) -> Self {
        Self { code, retryable: code.retryable() }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct OutputView {
    pub text: String,
    /// ناتج النموذج بيانات ملوّثة بلا سلطة.
    pub trust_class: &'static str,
    pub authority: &'static str,
}

impl OutputView {
    pub fn tainted(text: String) -> Self {
        Self { text, trust_class: "MODEL_GENERATED", authority: "NONE" }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageView {
    pub input_tokens: Fact<u64>,
    pub output_tokens: Fact<u64>,
    /// رموز المدخلات المعادة من ذاكرة البادئة كما أبلغ بها المزوّد. للسجلّ الداخلي فقط: لا يدخل العقد المنشور v1.
    #[serde(skip)]
    pub cached_input_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimingView {
    pub total: MeasuredMs,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_byte: Option<MeasuredMs>,
    pub streamed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContextSummary {
    pub items: u64,
    pub omitted: u64,
    pub estimated_tokens: TokenEstimate,
    pub truncated: bool,
    pub bundle_digest: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvokeResult {
    pub invocation_id: String,
    pub status: InvokeStatus,
    pub routing: RoutingDecision,
    pub egress: EgressDecision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<OutputView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<FinishReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageView>,
    pub timing: TimingView,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<ContextSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<OutcomeView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
    /// استدعاءات الأدوات الأصيلة كما أعادها النموذج (خطة 2026-10-05، B2). اقتراحات غير موثوقة، داخلية:
    /// لا تدخل العقد المنشور v1، وتعبر إلى المُنسِّق حيث تمرّ ببوابة الأدوات كأيّ اقتراح.
    #[serde(skip)]
    pub tool_calls: Vec<polaris_host_providers::domain::ProposedToolCall>,
    /// هل عُرضت الأدوات على المزوّد بصيغتها الأصيلة في هذا النداء؟
    #[serde(skip)]
    pub native_tools_offered: bool,
    /// الاستدلال الظاهر الذي بثّه النموذج (2026-10-06). داخلي: لا يدخل العقد ولا يُحفظ، ويُعاد إلى المزوّد الذي يشترطه وحده.
    #[serde(skip)]
    pub reasoning: Option<String>,
    /// تشخيص المزوّد المنقّح لنداء فشل (2026-10-06). داخلي: لا يعبر IPC.
    #[serde(skip)]
    pub diagnostic: Option<String>,
    /// حالة HTTP لنداء فشل، ومهلة `retry-after` إن قالها المزوّد. داخليان.
    #[serde(skip)]
    pub http_status: Option<u16>,
    #[serde(skip)]
    pub retry_after_ms: Option<u64>,
}
