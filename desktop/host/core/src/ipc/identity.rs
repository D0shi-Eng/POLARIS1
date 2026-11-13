// هوية المستدعي تُختَم ولا تُدَّعى.
//
// `caller_identity` في ظرفٍ وارد هو ادّعاء من طرفٍ غير موثوق. البوابة تكتبه من
// النقل: هوية العارض يحددها كون الرسالة وصلت عبر قناة النافذة، لا كون الرسالة
// تقول ذلك عن نفسها. السجل يسجّل `caller_identity_authority: NATIVE_TRANSPORT`
// لكل عملية، وهذه هي الشيفرة التي تجعل ذلك السطر صحيحًا.

use serde_json::{json, Value};

/// الهوية كما يقرّرها النقل. لا شيء منها يأتي من الحمولة.
#[derive(Debug, Clone)]
pub struct TransportIdentity {
    /// معرّف مبدأ ثابت لهذه النافذة. يُولَّد في المضيف عند الإقلاع.
    pub principal_id: String,
    /// معرّف الجلسة. يُولَّد في المضيف كذلك.
    pub session_id: String,
}

/// درجة الثقة الوحيدة الممكنة للعارض. ليست خيارًا قابلًا للرفع من الحمولة.
pub const RENDERER_TRUST_TIER: &str = "TIER_2_UNTRUSTED";

/// صنف المستدعي في مفردات العقد لواجهة POLARIS نفسها.
pub const RENDERER_CALLER_TYPE: &str = "CORE_UI";

impl TransportIdentity {
    /// الهوية المختومة، بالشكل الذي يقبله `CallerIdentity` في العقد.
    pub fn stamp(&self) -> Value {
        json!({
            "caller_type": RENDERER_CALLER_TYPE,
            "principal_id": self.principal_id,
            "trust_tier": RENDERER_TRUST_TIER,
            "session_id": self.session_id,
        })
    }

    /// هل يدّعي الظرف الوارد درجة ثقة لا يملكها؟ الادعاء نفسه حدث أمني يُسجَّل،
    /// ولا يُصحَّح بصمت بالكتابة فوقه فحسب.
    pub fn claims_elevated_trust(envelope: &Value) -> bool {
        envelope
            .get("caller_identity")
            .and_then(|identity| identity.get("trust_tier"))
            .and_then(Value::as_str)
            .is_some_and(|tier| tier == "TIER_0_TRUSTED")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stamp_is_always_untrusted_core_ui() {
        let identity = TransportIdentity {
            principal_id: "0ee6a2b9-2a9f-4f7f-9d24-1a6f9d7b3c11".to_string(),
            session_id: "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50".to_string(),
        };
        let stamped = identity.stamp();
        assert_eq!(stamped["trust_tier"], "TIER_2_UNTRUSTED");
        assert_eq!(stamped["caller_type"], "CORE_UI");
    }

    #[test]
    fn an_elevated_claim_is_detected() {
        let envelope = json!({ "caller_identity": { "trust_tier": "TIER_0_TRUSTED" } });
        assert!(TransportIdentity::claims_elevated_trust(&envelope));
        let honest = json!({ "caller_identity": { "trust_tier": "TIER_2_UNTRUSTED" } });
        assert!(!TransportIdentity::claims_elevated_trust(&honest));
    }
}
