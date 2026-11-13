// طبقة الثقة والتلوّث لـPhase-03.
//
// المبدأ الموروث من Phase-00: لا سلطة تُمنح لأن «وكيلًا آخر قال ذلك». مخرجات
// النموذج ورسائل الوكلاء واقتراحاتهم كلها بيانات مُلوَّثة افتراضيًا. رتبة الدور
// (PLANNER، BUILDER…) اسمٌ سلوكي لا مصدر إذن. الدمج اتحاد فقط: لا تُطرح راية
// تلوّث تلقائيًا، ولا يُرفع تصنيف إلا عبر مسار إزالة تصنيف مُعتمَد (D1/D2).

use serde::{Deserialize, Serialize};

pub mod probe;
pub mod rule_of_two;

/// صنف السلطة: من أين جاءت التعليمة أو الحقيقة، ومن ثَمَّ ماذا يُسمح لها أن تفعل.
/// مرتّبة تنازليًا من الأوثق إلى الأقل، لكن الترتيب توثيقي: لا يُشتق منه إذن ضمني.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthorityClass {
    /// سياسة النظام: ثابتة في الكود، لا يكتبها العارض ولا النموذج.
    SystemPolicy,
    /// تعليمة صدرت فعلًا من المستخدم عبر واجهة الدردشة.
    DirectUserInstruction,
    /// حقيقة أنتجها مسار تشغيل موثوق (قياس، قرار سياسة، نتيجة اختبار محقّقة).
    TrustedRuntimeFact,
    /// رسالة من وكيل إلى وكيل. لا تحمل سلطة مستخدم أبدًا.
    AgentMessage,
    /// نصّ ولّده نموذج. مُلوَّث افتراضيًا.
    ModelGenerated,
    /// محتوى غير موثوق (ملف مشروع، مستند مُقدَّم). أدنى صنف.
    UntrustedContent,
}

impl AuthorityClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SystemPolicy => "SYSTEM_POLICY",
            Self::DirectUserInstruction => "DIRECT_USER_INSTRUCTION",
            Self::TrustedRuntimeFact => "TRUSTED_RUNTIME_FACT",
            Self::AgentMessage => "AGENT_MESSAGE",
            Self::ModelGenerated => "MODEL_GENERATED",
            Self::UntrustedContent => "UNTRUSTED_CONTENT",
        }
    }

    /// هل يجوز لهذا الصنف أن يغيّر السياسة أو التوجيه أو يكشف سرًّا؟ فقط سياسة
    /// النظام وتعليمة المستخدم المباشرة. كل ما دونهما يُعامَل معاملة البيانات.
    pub fn may_command(self) -> bool {
        matches!(self, Self::SystemPolicy | Self::DirectUserInstruction)
    }

    /// هل يمكن لهذا الصنف أن يحقّق حقيقة عن العالم بمفرده؟ لا مخرجات نموذج ولا
    /// رسالة وكيل ولا محتوى غير موثوق. القياس الموثوق وتأكيد المستخدم وحدهما.
    pub fn can_verify_fact(self) -> bool {
        matches!(self, Self::TrustedRuntimeFact | Self::DirectUserInstruction | Self::SystemPolicy)
    }
}

/// راية تلوّث واحدة: من أين اكتسب الأثرُ تلوّثه.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaintFlag {
    /// مرّ عبر محتوى غير موثوق (ملف، مستند).
    UntrustedContent,
    /// أنتجه نموذج.
    ModelGenerated,
    /// مرّ عبر رسالة بين وكيلين.
    AgentRelayed,
    /// اشتُقّ من ادّعاء لم يُحقَّق بعد.
    UnverifiedClaim,
}

impl TaintFlag {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UntrustedContent => "UNTRUSTED_CONTENT",
            Self::ModelGenerated => "MODEL_GENERATED",
            Self::AgentRelayed => "AGENT_RELAYED",
            Self::UnverifiedClaim => "UNVERIFIED_CLAIM",
        }
    }
}

/// مجموعة رايات التلوّث. الدمج اتحاد فقط؛ لا طرح تلقائي.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Taint {
    flags: Vec<TaintFlag>,
}

impl Taint {
    /// أثر نظيف: لا راية. يُنشأ فقط من مصدر موثوق مُعلن.
    pub fn clean() -> Self {
        Self { flags: Vec::new() }
    }

    pub fn with(flag: TaintFlag) -> Self {
        Self { flags: vec![flag] }
    }

    /// التلوّث المصاحب لصنف سلطة معيّن، بحسب مصدره.
    pub fn from_authority(authority: AuthorityClass) -> Self {
        match authority {
            AuthorityClass::SystemPolicy
            | AuthorityClass::DirectUserInstruction
            | AuthorityClass::TrustedRuntimeFact => Self::clean(),
            AuthorityClass::AgentMessage => Self::with(TaintFlag::AgentRelayed),
            AuthorityClass::ModelGenerated => Self::with(TaintFlag::ModelGenerated),
            AuthorityClass::UntrustedContent => Self::with(TaintFlag::UntrustedContent),
        }
    }

    /// يضيف راية دون طرح شيء. الترتيب مُثبَّت حتى تكون المقارنة حتمية.
    pub fn add(&mut self, flag: TaintFlag) {
        if !self.flags.contains(&flag) {
            self.flags.push(flag);
            self.flags.sort_unstable();
        }
    }

    /// اتحاد: كل راية في أيٍّ من الطرفين تبقى. لا يُنقص شيء.
    pub fn merge(&self, other: &Taint) -> Taint {
        let mut merged = self.clone();
        for flag in &other.flags {
            merged.add(*flag);
        }
        merged
    }

    pub fn contains(&self, flag: TaintFlag) -> bool {
        self.flags.contains(&flag)
    }

    pub fn is_clean(&self) -> bool {
        self.flags.is_empty()
    }

    pub fn flags(&self) -> &[TaintFlag] {
        &self.flags
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_system_and_user_may_command() {
        assert!(AuthorityClass::SystemPolicy.may_command());
        assert!(AuthorityClass::DirectUserInstruction.may_command());
        assert!(!AuthorityClass::AgentMessage.may_command());
        assert!(!AuthorityClass::ModelGenerated.may_command());
        assert!(!AuthorityClass::UntrustedContent.may_command());
        assert!(!AuthorityClass::TrustedRuntimeFact.may_command());
    }

    #[test]
    fn model_and_agent_output_cannot_verify_a_fact() {
        assert!(!AuthorityClass::ModelGenerated.can_verify_fact());
        assert!(!AuthorityClass::AgentMessage.can_verify_fact());
        assert!(!AuthorityClass::UntrustedContent.can_verify_fact());
        assert!(AuthorityClass::TrustedRuntimeFact.can_verify_fact());
    }

    #[test]
    fn taint_merge_is_union_and_never_subtracts() {
        let a = Taint::with(TaintFlag::ModelGenerated);
        let b = Taint::with(TaintFlag::UntrustedContent);
        let merged = a.merge(&b);
        assert!(merged.contains(TaintFlag::ModelGenerated));
        assert!(merged.contains(TaintFlag::UntrustedContent));
        // الدمج مع النظيف لا يزيل شيئًا.
        let still = merged.merge(&Taint::clean());
        assert_eq!(still, merged);
    }

    #[test]
    fn model_generated_authority_is_tainted_by_default() {
        let taint = Taint::from_authority(AuthorityClass::ModelGenerated);
        assert!(!taint.is_clean());
        assert!(taint.contains(TaintFlag::ModelGenerated));
        assert!(Taint::from_authority(AuthorityClass::TrustedRuntimeFact).is_clean());
    }

    #[test]
    fn merge_order_is_deterministic() {
        let mut a = Taint::clean();
        a.add(TaintFlag::UnverifiedClaim);
        a.add(TaintFlag::ModelGenerated);
        let mut b = Taint::clean();
        b.add(TaintFlag::ModelGenerated);
        b.add(TaintFlag::UnverifiedClaim);
        assert_eq!(a, b, "flag ordering must be canonical regardless of insertion order");
    }
}
