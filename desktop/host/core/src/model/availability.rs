// نموذج الإتاحة الوحيد: حالة، وسبب مصنَّف كلما لم تكن الحالة AVAILABLE.
//
// القاعدتان مقترنتان في المخطط، ومُمثَّلتان هنا بنوع لا يسمح بغير ذلك: البنّاء
// الوحيد للحالة المتاحة لا يأخذ سببًا، وبنّاء كل حالة أخرى يوجبه. «غير متاح» بلا
// سبب هو شاشة فارغة بلغة أخرى، ولا يجوز أن يكون قابلًا للتمثيل أصلًا.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AvailabilityState {
    Available,
    ReadOnly,
    Unavailable,
    Blocked,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AvailabilityReason {
    PhaseNotImplemented,
    ProviderNotConfigured,
    PlatformUnsupported,
    PolicyDisabled,
    RuntimeUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Availability {
    pub state: AvailabilityState,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<AvailabilityReason>,
}

impl Availability {
    /// متاح الآن. لا يقبل سببًا: سبب على المتاح زخرفة، والزخرفة تُغري الشاشة بعرضها.
    pub fn available() -> Self {
        Self { state: AvailabilityState::Available, reason: None }
    }

    /// أي حالة غير AVAILABLE، وسببها إلزامي بحكم التوقيع.
    pub fn with_reason(state: AvailabilityState, reason: AvailabilityReason) -> Self {
        debug_assert!(
            state != AvailabilityState::Available,
            "AVAILABLE must be built with Availability::available()"
        );
        Self { state, reason: Some(reason) }
    }

    /// المختصر الأكثر استعمالًا في Phase-01: ميزة لم تُبنَ بعد.
    pub fn phase_not_implemented() -> Self {
        Self::with_reason(
            AvailabilityState::Unavailable,
            AvailabilityReason::PhaseNotImplemented,
        )
    }

    pub fn is_available(&self) -> bool {
        self.state == AvailabilityState::Available
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityAvailability {
    pub capability_id: String,
    pub availability: Availability,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn available_serialises_without_a_reason() {
        let json = serde_json::to_value(Availability::available()).unwrap();
        assert_eq!(json, serde_json::json!({ "state": "AVAILABLE" }));
    }

    #[test]
    fn unavailable_carries_its_reason() {
        let json = serde_json::to_value(Availability::phase_not_implemented()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "state": "UNAVAILABLE", "reason": "PHASE_NOT_IMPLEMENTED" })
        );
    }
}
