// قرار الخروج قبل أي بايت.
//
// الحلقة المحلية صنف شبكة مستقل عن الخروج البعيد، ويُسجَّل الصنف وصفًا لما حدث.
//
// لا قيد «محلي/بعيد» هنا (قرار المالك 2026-10-07، ADR-040): المستخدم اختار النموذج، وما يرسله إليه — طلبه وسياق
// مشروعه — يصل إليه. ما بقي من حواجز قبل البايت الأول: التوجيه (نموذج مفعَّل وصالح)، وحدّ السياق، والحارس المركَّب
// (الميزانية وحدّ الإدخال). صنف الشبكة لا يحجب.

use serde::Serialize;

use polaris_host_providers::domain::Locality;
use polaris_host_providers::net::NetworkClass;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EgressVerdict {
    Allowed,
    NotEvaluated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EgressReason {
    Loopback,
    RemoteAllowed,
    RoutingDenied,
}

#[derive(Debug, Clone, Serialize)]
pub struct EgressDecision {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_class: Option<NetworkClass>,
    pub decision: EgressVerdict,
    pub reason: EgressReason,
    pub context_attached: bool,
}

impl EgressDecision {
    pub fn not_evaluated(context_attached: bool) -> Self {
        Self { network_class: None, decision: EgressVerdict::NotEvaluated, reason: EgressReason::RoutingDenied, context_attached }
    }

    pub fn allowed(&self) -> bool {
        self.decision == EgressVerdict::Allowed
    }
}

pub fn decide(locality: Locality, context_attached: bool) -> EgressDecision {
    let (class, reason) = match locality {
        Locality::Local => (NetworkClass::LoopbackProviderAccess, EgressReason::Loopback),
        Locality::Remote => (NetworkClass::RemoteEgress, EgressReason::RemoteAllowed),
    };
    EgressDecision { network_class: Some(class), decision: EgressVerdict::Allowed, reason, context_attached }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_endpoint_is_loopback_and_allowed() {
        let d = decide(Locality::Local, true);
        assert!(d.allowed());
        assert_eq!(d.network_class, Some(NetworkClass::LoopbackProviderAccess));
        assert_eq!(d.reason, EgressReason::Loopback);
    }

    #[test]
    fn the_chosen_remote_model_receives_the_request_and_its_project_context() {
        for context_attached in [false, true] {
            let d = decide(Locality::Remote, context_attached);
            assert!(d.allowed(), "a remote model the user chose was refused (context attached: {context_attached})");
            assert_eq!(d.network_class, Some(NetworkClass::RemoteEgress));
            assert_eq!(d.reason, EgressReason::RemoteAllowed);
            assert_eq!(d.context_attached, context_attached);
        }
    }
}
