// اشتقاق إثبات الإنجاز.
//
// حالة المهمّة قد تكون COMPLETED؛ لكن الإثبات مسألة أخرى (البند 14/56). لا يُقال
// «ناجح تمامًا» لمهمّة COMPLETED + NOT_PROVEN. الإنجاز مُثبَت فقط حين تُستوفى كل
// المتطلَّبات الإلزامية وتنجح قواعد تحقّقها ولا يبقى تعارض إلزامي ولا انتهاك سياسة
// حرج (البند 58).

use serde::{Deserialize, Serialize};

use super::claim::{Claim, ClaimStatus};
use super::mission::{CompletionProofStatus, MissionRequirement, MissionState, RequirementStatus};

/// حاجز متبقٍّ يمنع الإثبات، للعرض والتشخيص.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "detail")]
pub enum Blocker {
    UnsatisfiedRequirement(String),
    UnverifiedRequirement(String),
    ConflictedClaim(String),
    CriticalPolicyViolation(String),
    /// لا متطلَّب إلزامي مُعلن أصلًا. «لا شيء لِيُثبَت» ليست «أُثبت كل شيء»:
    /// الصدق الفارغ ممنوع، وإلا صارت مهمّة بلا متطلَّبات مُثبَتة مجانًا.
    NoMandatoryRequirement,
    /// لم يكتمل التنفيذ (توقّف، أو استُنفدت ميزانية، أو أُلغي). لا إثبات فوق تنفيذ ناقص.
    ExecutionIncomplete(String),
}

/// خلاصة إثبات الإنجاز.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionProof {
    pub status: CompletionProofStatus,
    pub proof_summary: String,
    pub verified_requirements: Vec<String>,
    pub unverified_requirements: Vec<String>,
    pub conflicted_claims: Vec<String>,
    pub remaining_blockers: Vec<Blocker>,
}

/// يشتق إثبات الإنجاز من المتطلَّبات والادّعاءات. دالّة نقية.
/// `extra_blockers` يحمل ما يعرفه المُنسِّق ولا تعرفه المتطلَّبات: تنفيذ ناقص،
/// أو انتهاك سياسة حرج.
pub fn derive(
    requirements: &[MissionRequirement],
    claims: &[&Claim],
    extra_blockers: &[Blocker],
) -> CompletionProof {
    let mut verified = Vec::new();
    let mut unverified = Vec::new();
    let mut blockers = Vec::new();

    for req in requirements {
        match req.status {
            RequirementStatus::Satisfied => verified.push(req.requirement_id.clone()),
            _ if req.mandatory => {
                match req.status {
                    RequirementStatus::Unsatisfied => blockers.push(Blocker::UnsatisfiedRequirement(req.requirement_id.clone())),
                    _ => blockers.push(Blocker::UnverifiedRequirement(req.requirement_id.clone())),
                }
                unverified.push(req.requirement_id.clone());
            }
            _ => unverified.push(req.requirement_id.clone()),
        }
    }

    // تعارض إلزامي غير محسوم: أي ادّعاء بحالة CONFLICTED يمنع الإثبات.
    let mut conflicted: Vec<String> = claims
        .iter()
        .filter(|c| c.status == ClaimStatus::Conflicted)
        .map(|c| c.claim_id.clone())
        .collect();
    conflicted.sort();
    for id in &conflicted {
        blockers.push(Blocker::ConflictedClaim(id.clone()));
    }

    let mandatory_total = requirements.iter().filter(|r| r.mandatory).count();
    let mandatory_satisfied = requirements
        .iter()
        .filter(|r| r.mandatory && r.status == RequirementStatus::Satisfied)
        .count();

    // لا شيء مُعلن لِيُثبَت ⇒ لا إثبات. الصدق الفارغ ليس إثباتًا (البند 58/174).
    if mandatory_total == 0 {
        blockers.push(Blocker::NoMandatoryRequirement);
    }
    blockers.extend(extra_blockers.iter().cloned());

    let nothing_to_evaluate = requirements.is_empty() && claims.is_empty() && extra_blockers.is_empty();
    let status = if nothing_to_evaluate {
        CompletionProofStatus::NotEvaluated
    } else if blockers.is_empty() && mandatory_total > 0 && mandatory_satisfied == mandatory_total {
        CompletionProofStatus::Proven
    } else {
        CompletionProofStatus::NotProven
    };

    let proof_summary = match status {
        CompletionProofStatus::Proven => format!("{mandatory_satisfied}/{mandatory_total} mandatory requirements satisfied and verified"),
        CompletionProofStatus::NotProven => format!(
            "{mandatory_satisfied}/{mandatory_total} mandatory requirements satisfied; {} blocker(s) remain",
            blockers.len()
        ),
        CompletionProofStatus::NotEvaluated => "no requirements or claims to evaluate".to_string(),
    };

    CompletionProof {
        status,
        proof_summary,
        verified_requirements: verified,
        unverified_requirements: unverified,
        conflicted_claims: conflicted,
        remaining_blockers: blockers,
    }
}

/// تعريف واحد للإثبات المحسوم (R-03، 2026-10-12)، يستعمله الإنهاء في زمن التشغيل والقراءة بعد إعادة التشغيل معًا.
///
/// `runtime_blockers` ما يعرفه المُنسِّق (تنفيذ ناقص، انتظار موافقة، انتهاك سياسة) أو ما حُفظ منه عند الإنهاء. وحالة المهمّة
/// نفسها حاجز: مهمّة ليست COMPLETED (ملغاة، فاشلة، محجوبة، تنتظر، أو ما زالت تعمل) لا تُثبَت مهما بدت متطلّباتها مستوفاة.
/// مهمّة بلا متطلّبات ولا ادّعاءات ولا حاجز مُنسِّق تبقى NOT_EVALUATED كما كانت.
pub fn derive_settled(requirements: &[MissionRequirement], claims: &[&Claim], state: MissionState, runtime_blockers: &[Blocker]) -> CompletionProof {
    if requirements.is_empty() && claims.is_empty() && runtime_blockers.is_empty() {
        return derive(&[], &[], &[]);
    }
    let mut blockers: Vec<Blocker> = runtime_blockers.to_vec();
    if state != MissionState::Completed {
        let incomplete = Blocker::ExecutionIncomplete(format!("MISSION_{}", state.as_str()));
        if !blockers.contains(&incomplete) {
            blockers.push(incomplete);
        }
    }
    derive(requirements, claims, &blockers)
}

/// حواجز المُنسِّق من إثبات محفوظ: ما ليس حكمًا على متطلَّب أو ادّعاء (تلك تُشتقّ من جديد من الصفوف نفسها).
pub fn runtime_blockers_of(proof: &CompletionProof) -> Vec<Blocker> {
    proof
        .remaining_blockers
        .iter()
        .filter(|b| matches!(b, Blocker::CriticalPolicyViolation(_) | Blocker::ExecutionIncomplete(_)))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::claim::{ClaimStatus, ClaimType};
    use super::super::trust::Taint;

    fn req(id: &str, status: RequirementStatus, mandatory: bool) -> MissionRequirement {
        let mut r = MissionRequirement::new(id, "text", "rule-1", mandatory);
        r.status = status;
        r
    }

    #[test]
    fn a_model_saying_done_with_no_verified_requirement_is_not_proven() {
        let requirements = vec![req("r1", RequirementStatus::Unverified, true)];
        let done = Claim::from_agent("c1", "m1", "ag1", "all done", ClaimType::Completion, Taint::clean(), "t");
        let proof = derive(&requirements, &[&done], &[]);
        assert_eq!(proof.status, CompletionProofStatus::NotProven);
        assert!(proof.remaining_blockers.iter().any(|b| matches!(b, Blocker::UnverifiedRequirement(_))));
    }

    #[test]
    fn all_tasks_succeed_but_a_mandatory_requirement_unverified_is_not_proven() {
        let requirements = vec![
            req("r1", RequirementStatus::Satisfied, true),
            req("r2", RequirementStatus::Unverified, true),
        ];
        let proof = derive(&requirements, &[], &[]);
        assert_eq!(proof.status, CompletionProofStatus::NotProven);
        assert_eq!(proof.verified_requirements, vec!["r1"]);
        assert_eq!(proof.unverified_requirements, vec!["r2"]);
    }

    #[test]
    fn all_mandatory_satisfied_with_no_conflict_is_proven() {
        let requirements = vec![
            req("r1", RequirementStatus::Satisfied, true),
            req("r2", RequirementStatus::Satisfied, true),
            req("r3", RequirementStatus::Unverified, false), // اختياري لا يمنع.
        ];
        let proof = derive(&requirements, &[], &[]);
        assert_eq!(proof.status, CompletionProofStatus::Proven);
    }

    #[test]
    fn a_conflicted_claim_blocks_proof() {
        let requirements = vec![req("r1", RequirementStatus::Satisfied, true)];
        let mut conflicted = Claim::from_agent("c1", "m1", "ag1", "x", ClaimType::Fact, Taint::clean(), "t");
        conflicted.status = ClaimStatus::Conflicted;
        let proof = derive(&requirements, &[&conflicted], &[]);
        assert_eq!(proof.status, CompletionProofStatus::NotProven);
        assert_eq!(proof.conflicted_claims, vec!["c1"]);
    }

    #[test]
    fn a_critical_policy_violation_blocks_proof() {
        let requirements = vec![req("r1", RequirementStatus::Satisfied, true)];
        let proof = derive(&requirements, &[], &[Blocker::CriticalPolicyViolation("egress_policy".into())]);
        assert_eq!(proof.status, CompletionProofStatus::NotProven);
    }

    #[test]
    fn a_mission_with_no_mandatory_requirement_is_never_proven() {
        // الصدق الفارغ ممنوع: «لا متطلَّب» لا تعني «كل المتطلَّبات مستوفاة».
        let requirements = vec![req("r1", RequirementStatus::Satisfied, false)];
        let proof = derive(&requirements, &[], &[]);
        assert_eq!(proof.status, CompletionProofStatus::NotProven);
        assert!(proof.remaining_blockers.contains(&Blocker::NoMandatoryRequirement));
    }

    #[test]
    fn an_incomplete_execution_is_never_proven() {
        let requirements = vec![req("r1", RequirementStatus::Satisfied, true)];
        let proof = derive(&requirements, &[], &[Blocker::ExecutionIncomplete("BUDGET_EXHAUSTED".into())]);
        assert_eq!(proof.status, CompletionProofStatus::NotProven);
    }

    #[test]
    fn a_settled_proof_needs_a_completed_mission() {
        let requirements = vec![req("r1", RequirementStatus::Satisfied, true)];
        assert_eq!(derive_settled(&requirements, &[], MissionState::Completed, &[]).status, CompletionProofStatus::Proven);
        for state in [MissionState::Cancelled, MissionState::Failed, MissionState::Blocked, MissionState::WaitingForApproval, MissionState::Running] {
            assert_eq!(derive_settled(&requirements, &[], state, &[]).status, CompletionProofStatus::NotProven, "{state:?} was proven");
        }
        assert_eq!(derive_settled(&[], &[], MissionState::Created, &[]).status, CompletionProofStatus::NotEvaluated);
    }

    #[test]
    fn nothing_at_all_is_not_evaluated_rather_than_proven() {
        let proof = derive(&[], &[], &[]);
        assert_eq!(proof.status, CompletionProofStatus::NotEvaluated);
    }
}
