// سجل الصحة: ما قيس آخر مرة، أو ما يُعرف دون قياس.
//
// الحالة المحسوبة (معطّل، بلا نقطة نهاية، بلا مفتاح) لا تحمل لحظة قياس لأنها لم
// تُقس. والحالة المقيسة تحمل لحظتها وزمنها كما قيست.

use serde::Serialize;

use polaris_host_providers::domain::{HealthProbe, HealthReason, HealthState, InstallationState, RuntimeState};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MeasuredMs {
    pub value: u64,
    pub provenance: &'static str,
}

impl MeasuredMs {
    pub fn new(value: u64) -> Self {
        Self { value: value.min(3_600_000), provenance: "LOCALLY_MEASURED" }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HealthView {
    pub state: HealthState,
    pub reason_code: HealthReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency: Option<MeasuredMs>,
    pub installation: InstallationState,
    pub runtime: RuntimeState,
}

impl HealthView {
    /// حالة لم تُقس.
    pub fn computed(state: HealthState, reason: HealthReason, installation: InstallationState) -> Self {
        Self { state, reason_code: reason, checked_at: None, latency: None, installation, runtime: RuntimeState::Unknown }
    }

    /// حالة قيست الآن.
    pub fn measured(probe: HealthProbe, checked_at: String, installation: InstallationState) -> Self {
        let unmeasured = matches!(
            probe.reason,
            HealthReason::NotChecked
                | HealthReason::ProviderDisabled
                | HealthReason::EndpointNotConfigured
                | HealthReason::CredentialMissing
                | HealthReason::CredentialStoreUnavailable
        );
        Self {
            state: probe.state,
            reason_code: probe.reason,
            checked_at: if unmeasured { None } else { Some(checked_at) },
            latency: if unmeasured { None } else { probe.latency_ms.map(MeasuredMs::new) },
            installation,
            runtime: probe.runtime,
        }
    }
}

pub fn state_code(state: HealthState) -> &'static str {
    match state {
        HealthState::Healthy => "HEALTHY",
        HealthState::Degraded => "DEGRADED",
        HealthState::Unreachable => "UNREACHABLE",
        HealthState::AuthRequired => "AUTH_REQUIRED",
        HealthState::AuthFailed => "AUTH_FAILED",
        HealthState::RateLimited => "RATE_LIMITED",
        HealthState::Misconfigured => "MISCONFIGURED",
        HealthState::Unknown => "UNKNOWN",
    }
}

/// يحوّل رمزًا مخزّنًا إلى قيمة مغلقة، أو «مجهول» إن لم يُعرف.
pub fn parse_state(code: &str) -> HealthState {
    serde_json::from_value(serde_json::Value::String(code.to_string())).unwrap_or(HealthState::Unknown)
}

pub fn parse_reason(code: &str) -> HealthReason {
    serde_json::from_value(serde_json::Value::String(code.to_string())).unwrap_or(HealthReason::NotChecked)
}

pub fn parse_installation(code: &str) -> InstallationState {
    serde_json::from_value(serde_json::Value::String(code.to_string())).unwrap_or(InstallationState::Unknown)
}

pub fn parse_runtime(code: &str) -> RuntimeState {
    serde_json::from_value(serde_json::Value::String(code.to_string())).unwrap_or(RuntimeState::Unknown)
}

pub fn code_of<T: Serialize>(value: T) -> String {
    serde_json::to_value(value).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}
