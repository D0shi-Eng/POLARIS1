// محرّك التحقق: حتمي فوق (ادّعاء، مجموعة أدلّة، قاعدة).
//
// النموذج قد يساعد في التفسير، لكن تفسيره يصير ادّعاءً مشتقًّا آخر لا إثباتًا
// نهائيًّا (البند 55). القاعدة بيانات مهيكلة لا لغة برمجة صغيرة (البند 51).
// الحقائق الحرجة: إجماع الوكلاء دون دليل لا يحقّق (البند 45/103)، والقياس الذي
// يناقض ادّعاءً يدحضه أو يعارضه، والنموذج القائل «نجحت الاختبارات» دون أثر اختبار
// يبقى UNVERIFIED.

use serde::{Deserialize, Serialize};

use super::claim::{Claim, ClaimStatus};
use super::evidence::{independent_source_count, EvidenceItem, EvidenceType};

/// سياسة التعارض حين يجتمع دليل مؤيّد ودليل مضادّ.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConflictPolicy {
    /// القياس يغلب: إن كان الدليل المضادّ مقيسًا والمؤيّد ليس كذلك، يُدحض.
    PreferMeasured,
    /// أي تعارض يجعل الحالة CONFLICTED حتى يُحسم يدويًّا.
    AlwaysConflicted,
}

/// قاعدة تحقق مهيكلة. لا DSL (البند 51).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationRule {
    pub rule_id: String,
    pub required_evidence_types: Vec<EvidenceType>,
    pub minimum_independent_sources: u32,
    pub requires_runtime_measurement: bool,
    pub requires_user_confirmation: bool,
    pub requires_test_result: bool,
    /// هل يجوز أن يكون الدليل مخرجات وكيل؟ افتراضيًّا لا للحقائق (البند 49).
    pub allows_agent_output: bool,
    pub conflict_policy: ConflictPolicy,
}

impl VerificationRule {
    /// قاعدة صارمة لادّعاء حقيقة/إنجاز: مصدر مستقل واحد على الأقل، لا يكفيه مخرج وكيل.
    pub fn strict_fact(rule_id: impl Into<String>) -> Self {
        Self {
            rule_id: rule_id.into(),
            required_evidence_types: Vec::new(),
            minimum_independent_sources: 1,
            requires_runtime_measurement: false,
            requires_user_confirmation: false,
            requires_test_result: false,
            allows_agent_output: false,
            conflict_policy: ConflictPolicy::PreferMeasured,
        }
    }

    /// قاعدة إنجاز مدعومة باختبار: تتطلّب أثر اختبار حقيقيًّا.
    pub fn requires_tests(rule_id: impl Into<String>) -> Self {
        Self {
            rule_id: rule_id.into(),
            required_evidence_types: vec![EvidenceType::TestResult],
            minimum_independent_sources: 1,
            requires_runtime_measurement: false,
            requires_user_confirmation: false,
            requires_test_result: true,
            allows_agent_output: false,
            conflict_policy: ConflictPolicy::PreferMeasured,
        }
    }
}

/// نتيجة تحقق: الحالة المشتقّة وسبب مقروء.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VerificationOutcome {
    pub status: ClaimStatus,
    pub reason: VerificationReason,
    pub independent_sources: u32,
}

/// سبب النتيجة. مغلق.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VerificationReason {
    NoAdmissibleEvidence,
    AgentOutputOnly,
    MissingRequiredEvidenceType,
    InsufficientIndependentSources,
    RulePassed,
    RefutedByCounterevidence,
    ConflictUnresolved,
    /// ادّعاء دلالي («المحتوى يغطي X») دليله بنيوي فقط (ملف موجود، حجم، قراءة). لا يرقّيه إلا مصحِّح (ADR-041 §3.3).
    StructuralEvidenceForSemanticClaim,
    /// ادّعاء بنيوي (عدد الفقرات مثلًا) لا يُظهر أيّ قياس قيمته نفسها.
    ValueNotMeasured,
}

/// خصائص الادّعاء البنيوي: ما يقيسه المضيف بنفسه في ملف أو تشغيل. مفردات مغلقة (ADR-041 §3.3).
pub const STRUCTURAL_PROPERTIES: [&str; 16] =
    ["exists", "path", "bytes", "size", "format", "paragraphs", "tables", "charts", "sheets", "slides", "pages", "rows", "exit_code", "tests_passed", "observed", "status"];

/// صنف الادّعاء: بنيوي بخاصيته وقيمته، أو دلالي.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimClass {
    Structural { property: String, value: String },
    Semantic,
}

/// الادّعاء بنيوي حين تكون خاصيته المهيكلة من المفردات المغلقة (أو ملاحظة لقيمة ظهرت). كل ما سواه دلالي، مهما بدا نصّه.
pub fn claim_class(claim: &Claim) -> ClaimClass {
    let Some(subject) = &claim.subject else { return ClaimClass::Semantic };
    let key = subject.property.split(['=', ',', ':']).next().unwrap_or_default().trim().to_ascii_lowercase();
    let observed = claim.claim_type == super::claim::ClaimType::Observation && !subject.value.trim().is_empty();
    if STRUCTURAL_PROPERTIES.contains(&key.as_str()) || observed {
        return ClaimClass::Structural { property: if observed && !STRUCTURAL_PROPERTIES.contains(&key.as_str()) { "observed".into() } else { key }, value: subject.value.trim().to_string() };
    }
    ClaimClass::Semantic
}

/// هل يُظهر ملخّص دليل مقيس القيمة نفسها؟ مقارنة بلا حالة ولا مسافات زائدة؛ قيمة من حرفين أو أقلّ لا تُعدّ ظهورًا.
fn shows(summary: &str, property: &str, value: &str) -> bool {
    let norm = |t: &str| t.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let (summary, value) = (norm(summary), norm(value));
    if value.chars().count() < 3 && !summary.contains(&format!("{property}={value}")) && !summary.contains(&format!("{property}: {value}")) {
        return false;
    }
    summary.contains(&value)
}

/// المحرّك: دالّة نقية فوق مدخلاتها. لا زمن، لا عشوائية.
pub fn verify(
    claim: &Claim,
    supporting: &[&EvidenceItem],
    counter: &[&EvidenceItem],
    rule: &VerificationRule,
) -> VerificationOutcome {
    // ١ — الدليل المضادّ أولًا: قياس مضادّ يدحض أو يعارض.
    let measured_counter = counter.iter().any(|e| e.evidence_type.is_measured());
    // الدليل المؤيّد المقبول: يُستبعد مخرج الوكيل ما لم تسمح القاعدة.
    let admissible: Vec<&EvidenceItem> = supporting
        .iter()
        .copied()
        .filter(|e| rule.allows_agent_output || !e.evidence_type.is_agent_output())
        .collect();

    if measured_counter {
        // إن وُجد دليل مقيس مؤيّد أيضًا فهو تعارض؛ وإلا دحض.
        let measured_support = admissible.iter().any(|e| e.evidence_type.is_measured());
        return match (measured_support, rule.conflict_policy) {
            (true, _) => VerificationOutcome { status: ClaimStatus::Conflicted, reason: VerificationReason::ConflictUnresolved, independent_sources: 0 },
            (false, ConflictPolicy::PreferMeasured) => VerificationOutcome { status: ClaimStatus::Refuted, reason: VerificationReason::RefutedByCounterevidence, independent_sources: 0 },
            (false, ConflictPolicy::AlwaysConflicted) => VerificationOutcome { status: ClaimStatus::Conflicted, reason: VerificationReason::ConflictUnresolved, independent_sources: 0 },
        };
    }

    // ٢ — لا دليل مقبول إطلاقًا.
    if admissible.is_empty() {
        // إن كان كل الدليل مخرجات وكيل، السبب أدقّ.
        let reason = if !supporting.is_empty() && supporting.iter().all(|e| e.evidence_type.is_agent_output()) {
            VerificationReason::AgentOutputOnly
        } else {
            VerificationReason::NoAdmissibleEvidence
        };
        // الإجماع دون دليل مقبول لا يحقّق أبدًا.
        return VerificationOutcome { status: ClaimStatus::Unverified, reason, independent_sources: 0 };
    }

    // ٣ — أنواع الدليل المطلوبة.
    for required in &rule.required_evidence_types {
        if !admissible.iter().any(|e| e.evidence_type == *required) {
            return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::MissingRequiredEvidenceType, independent_sources: independent_source_count(&admissible) as u32 };
        }
    }
    if rule.requires_runtime_measurement && !admissible.iter().any(|e| e.evidence_type == EvidenceType::RuntimeMeasurement) {
        return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::MissingRequiredEvidenceType, independent_sources: independent_source_count(&admissible) as u32 };
    }
    if rule.requires_test_result && !admissible.iter().any(|e| e.evidence_type == EvidenceType::TestResult) {
        return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::MissingRequiredEvidenceType, independent_sources: independent_source_count(&admissible) as u32 };
    }
    if rule.requires_user_confirmation && !admissible.iter().any(|e| e.evidence_type == EvidenceType::UserConfirmation) {
        return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::MissingRequiredEvidenceType, independent_sources: independent_source_count(&admissible) as u32 };
    }

    // ٤ — عدد المصادر المستقلّة بالسلالة.
    let independent = independent_source_count(&admissible) as u32;
    if independent < rule.minimum_independent_sources {
        return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::InsufficientIndependentSources, independent_sources: independent };
    }

    // ٥ — الصنف (خطة 2026-10-07، ADR-041 §3.3). قِيس في قاعدة المالك: «المستند يغطي فوائد شرب الماء» صار VERIFIED بدليل
    // «قرأ 4056 بايت»، و«المراجِع يطلب…» بدليل «0 entries». الحالة تُشتق من الأدلّة والقاعدة، والصنف من مهيكل الادّعاء لا نصّه.
    match claim_class(claim) {
        ClaimClass::Semantic if !admissible.iter().any(|e| e.evidence_type.grades_content()) => {
            return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::StructuralEvidenceForSemanticClaim, independent_sources: independent };
        }
        ClaimClass::Structural { property, value } if !admissible.iter().any(|e| e.evidence_type.is_measured() && shows(&e.summary, &property, &value)) => {
            return VerificationOutcome { status: ClaimStatus::Supported, reason: VerificationReason::ValueNotMeasured, independent_sources: independent };
        }
        _ => {}
    }
    VerificationOutcome { status: ClaimStatus::Verified, reason: VerificationReason::RulePassed, independent_sources: independent }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::claim::ClaimType;
    use super::super::evidence::{MeasurementKind, Provenance};
    use super::super::trust::{AuthorityClass, Taint};

    fn claim() -> Claim {
        Claim::from_agent("c1", "m1", "ag1", "tests pass", ClaimType::Completion, Taint::clean(), "t")
    }

    fn evidence(id: &str, ty: EvidenceType, root: &str, producer: &str) -> EvidenceItem {
        EvidenceItem {
            evidence_id: id.into(),
            mission_id: "m1".into(),
            evidence_type: ty,
            created_at: "t".into(),
            digest: "d".into(),
            provenance: Provenance {
                producer: producer.into(),
                authority: if ty.is_agent_output() { AuthorityClass::ModelGenerated } else { AuthorityClass::TrustedRuntimeFact },
                source_ref: root.into(),
                lineage: vec![root.into()],
                measurement_kind: if ty.is_measured() { MeasurementKind::Measured } else { MeasurementKind::Inferred },
            },
            taint: Taint::clean(),
            summary: "s".into(),
        }
    }

    #[test]
    fn three_agents_agreeing_without_evidence_do_not_verify() {
        // ثلاثة أدلّة مخرجات وكلاء تتفق، لا دليل مقيس.
        let a = evidence("a", EvidenceType::AgentOutput, "ag-a", "ag-a");
        let b = evidence("b", EvidenceType::AgentOutput, "ag-b", "ag-b");
        let c = evidence("c", EvidenceType::AgentOutput, "ag-c", "ag-c");
        let rule = VerificationRule::strict_fact("r");
        let out = verify(&claim(), &[&a, &b, &c], &[], &rule);
        assert_eq!(out.status, ClaimStatus::Unverified);
        assert_eq!(out.reason, VerificationReason::AgentOutputOnly);
    }

    #[test]
    fn a_model_saying_tests_pass_without_a_test_artifact_is_unverified() {
        let a = evidence("a", EvidenceType::AgentOutput, "ag-a", "ag-a");
        let rule = VerificationRule::requires_tests("r");
        let out = verify(&claim(), &[&a], &[], &rule);
        // مخرج الوكيل غير مقبول أصلًا لهذه القاعدة.
        assert_eq!(out.status, ClaimStatus::Unverified);
    }

    #[test]
    fn a_real_test_result_verifies_under_the_rule() {
        let t = evidence("t", EvidenceType::TestResult, "test:run-1", "runner");
        let rule = VerificationRule::requires_tests("r");
        let out = verify(&claim(), &[&t], &[], &rule);
        assert_eq!(out.status, ClaimStatus::Verified);
        assert_eq!(out.reason, VerificationReason::RulePassed);
    }

    #[test]
    fn a_measured_counterexample_refutes_an_unmeasured_claim() {
        let support = evidence("a", EvidenceType::AgentOutput, "ag-a", "ag-a");
        let counter = evidence("t", EvidenceType::TestResult, "test:run-1", "runner");
        let rule = VerificationRule::strict_fact("r");
        let out = verify(&claim(), &[&support], &[&counter], &rule);
        assert_eq!(out.status, ClaimStatus::Refuted);
    }

    #[test]
    fn measured_support_and_measured_counter_conflict() {
        let support = evidence("m1", EvidenceType::RuntimeMeasurement, "probe:a", "svc");
        let counter = evidence("m2", EvidenceType::TestResult, "test:b", "runner");
        let rule = VerificationRule::strict_fact("r");
        let out = verify(&claim(), &[&support], &[&counter], &rule);
        assert_eq!(out.status, ClaimStatus::Conflicted);
    }

    #[test]
    fn two_items_of_the_same_lineage_do_not_meet_a_two_source_rule() {
        let a = evidence("a", EvidenceType::RuntimeMeasurement, "file:x", "svc");
        let mut b = evidence("b", EvidenceType::RuntimeMeasurement, "file:x", "svc");
        b.provenance.lineage = vec!["file:x".into(), "a".into()];
        let mut rule = VerificationRule::strict_fact("r");
        rule.minimum_independent_sources = 2;
        let out = verify(&claim(), &[&a, &b], &[], &rule);
        assert_eq!(out.status, ClaimStatus::Supported);
        assert_eq!(out.reason, VerificationReason::InsufficientIndependentSources);
        assert_eq!(out.independent_sources, 1);
    }

    #[test]
    fn a_single_measured_source_verifies_a_strict_structural_fact_that_it_shows() {
        let mut a = evidence("a", EvidenceType::RuntimeMeasurement, "probe:a", "svc");
        a.summary = "outputs/r.xlsx re-opened; sheets=2".into();
        let mut fact = Claim::from_agent("c1", "m1", "ag1", "the workbook has two sheets", ClaimType::Fact, Taint::clean(), "t");
        fact.subject = Some(super::super::claim::ClaimSubject { subject: "outputs/r.xlsx".into(), property: "sheets".into(), value: "2".into() });
        let rule = VerificationRule::strict_fact("r");
        assert_eq!(verify(&fact, &[&a], &[], &rule).status, ClaimStatus::Verified);
        // والقياس نفسه لا يرقّي ادّعاءً نصّيًّا حرًّا بلا مصحِّح (قِيس في قاعدة المالك 2026-10-07).
        let free = Claim::from_agent("c2", "m1", "ag1", "the workbook explains the sales trend", ClaimType::Fact, Taint::clean(), "t");
        assert_eq!(verify(&free, &[&a], &[], &rule).reason, VerificationReason::StructuralEvidenceForSemanticClaim);
    }
}
