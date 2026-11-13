// نطاق الادّعاءات.
//
// الادّعاء ما يقوله وكيل؛ حالته لا تُشتق من ثقة النموذج بل من الأدلّة وقواعد
// التحقق. لا تُحوَّل ثقة النموذج إلى VERIFIED أبدًا (البند 47). الإجماع دليل على
// الاتفاق لا على الواقع (البند 45).

use serde::{Deserialize, Serialize};

use super::trust::Taint;

/// نوع الادّعاء. مفردات مغلقة (البند 46).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClaimType {
    Fact,
    Result,
    Completion,
    RequirementSatisfaction,
    Assumption,
    Risk,
    Observation,
}

impl ClaimType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fact => "FACT",
            Self::Result => "RESULT",
            Self::Completion => "COMPLETION",
            Self::RequirementSatisfaction => "REQUIREMENT_SATISFACTION",
            Self::Assumption => "ASSUMPTION",
            Self::Risk => "RISK",
            Self::Observation => "OBSERVATION",
        }
    }
}

/// حالة الادّعاء. تُستعمل بحذر (البند 47).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ClaimStatus {
    /// لا دليل بعد.
    Unverified,
    /// يوجد دليل لكنه لا يفي بقاعدة التحقق الأصرم.
    Supported,
    /// نجحت قاعدة التحقق المُهيّأة.
    Verified,
    /// دليل مضادّ يفي بقاعدة الدحض.
    Refuted,
    /// تعارض غير محسوم.
    Conflicted,
    /// الدليل غير كافٍ أو غير متاح.
    Unknown,
}

impl ClaimStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unverified => "UNVERIFIED",
            Self::Supported => "SUPPORTED",
            Self::Verified => "VERIFIED",
            Self::Refuted => "REFUTED",
            Self::Conflicted => "CONFLICTED",
            Self::Unknown => "UNKNOWN",
        }
    }
}

/// موضوع الادّعاء المهيكل، لكشف التعارض (البند 53): موضوع وخاصية وقيمة.
/// حين يُتاح تهيكل، نستعمله؛ وإلا يبقى الادّعاء نصيًّا لا يُقارَن آليًّا.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimSubject {
    pub subject: String,
    pub property: String,
    pub value: String,
}

/// ادّعاء واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Claim {
    pub claim_id: String,
    pub mission_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub agent_id: String,
    pub statement: String,
    pub claim_type: ClaimType,
    pub status: ClaimStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<ClaimSubject>,
    pub evidence_refs: Vec<String>,
    pub counterevidence_refs: Vec<String>,
    pub taint: Taint,
    pub verification_required: bool,
    pub revision: u32,
    pub created_at: String,
}

impl Claim {
    /// ادّعاء جديد من وكيل: مُلوَّث افتراضيًا وغير محقَّق (البند 47).
    pub fn from_agent(
        claim_id: impl Into<String>,
        mission_id: impl Into<String>,
        agent_id: impl Into<String>,
        statement: impl Into<String>,
        claim_type: ClaimType,
        taint: Taint,
        created_at: impl Into<String>,
    ) -> Self {
        Self {
            claim_id: claim_id.into(),
            mission_id: mission_id.into(),
            task_id: None,
            agent_id: agent_id.into(),
            statement: statement.into(),
            claim_type,
            status: ClaimStatus::Unverified,
            subject: None,
            evidence_refs: Vec::new(),
            counterevidence_refs: Vec::new(),
            taint,
            // ادّعاءات الحقيقة والإنجاز واستيفاء المتطلَّب تتطلّب تحقّقًا.
            verification_required: matches!(
                claim_type,
                ClaimType::Fact | ClaimType::Result | ClaimType::Completion | ClaimType::RequirementSatisfaction
            ),
            revision: 1,
            created_at: created_at.into(),
        }
    }

    pub fn with_subject(mut self, subject: ClaimSubject) -> Self {
        self.subject = Some(subject);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::trust::TaintFlag;

    #[test]
    fn a_fresh_agent_claim_is_unverified_and_tainted() {
        let claim = Claim::from_agent(
            "c1",
            "m1",
            "ag1",
            "the build succeeds",
            ClaimType::Completion,
            Taint::with(TaintFlag::ModelGenerated),
            "t",
        );
        assert_eq!(claim.status, ClaimStatus::Unverified);
        assert!(claim.verification_required);
        assert!(!claim.taint.is_clean());
    }

    #[test]
    fn an_observation_does_not_require_verification_by_default() {
        let claim = Claim::from_agent("c2", "m1", "ag1", "note", ClaimType::Observation, Taint::clean(), "t");
        assert!(!claim.verification_required);
    }
}
