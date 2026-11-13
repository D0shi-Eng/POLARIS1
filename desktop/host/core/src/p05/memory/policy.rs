// سياسة كتابة الذاكرة: ما يُحفظ، وبأي صنف، وفي أي نطاق.
//
// الترتيب (البند 6): التحقق، ثم فحص المنشأ، ثم السياسة. التكرار والتعارض يقعان في
// المخزن داخل المعاملة نفسها التي تكتب، لأنهما يحتاجان ما هو محفوظ الآن لا ما كان.
//
// ما لا يُحفظ مهما طُلب (البند 11): تفكير خام، ونصّ يشبه سرًّا، وصفحة كاملة، ومخرجات
// أداة ضخمة. وما لا يستطيعه مرشّح وكيل: أن يرفع صنف ثقته، أو أن يُعلن نفسه مربوطًا
// بدليل، أو أن يكتب في نطاق النظام.

use crate::p03::trust::{Taint, TaintFlag};

use super::model::{
    normalise, CandidateSource, ConfidenceSource, MemoryCandidateV1, MemoryScope, MemoryTrustClass, MemoryType,
    MemoryVerification, RejectReason, SourceKind, MAX_CONTENT_CHARS, MAX_SOURCE_REFS, MAX_SUBJECT_CHARS,
};

/// علامات تفكير خام. الذاكرة تحفظ نتائج، لا سلسلة تفكير (البند 11، ولا حفظ لـCoT).
const REASONING_MARKERS: &[&str] = &[
    "<think>",
    "</think>",
    "chain of thought",
    "chain-of-thought",
    "let me think",
    "step by step reasoning",
    "my reasoning:",
    "internal monologue",
    "scratchpad:",
];

/// مرشّح اجتاز التحقق، بصنفه وتحقّقه كما قرّرهما زمن التشغيل.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedCandidate {
    pub candidate: MemoryCandidateV1,
    pub subject: String,
    pub content: String,
    pub trust_class: MemoryTrustClass,
    pub verification: MemoryVerification,
    pub taint: Taint,
    pub confidence_source: ConfidenceSource,
}

/// هل يتّسق النوع مع النطاق؟ ذاكرة عمل للمهمّة وحدها، والتفضيل للمستخدم وحده،
/// وذاكرة المشروع للمشروع وحده.
pub fn type_fits_scope(memory_type: MemoryType, scope: MemoryScope) -> bool {
    match memory_type {
        MemoryType::Working => scope == MemoryScope::Mission,
        MemoryType::Preference => scope == MemoryScope::User,
        MemoryType::Project => scope == MemoryScope::Project,
        MemoryType::Episodic => matches!(scope, MemoryScope::Mission | MemoryScope::Project),
        MemoryType::Semantic => true,
    }
}

/// هل يجوز لهذا المصدر أن يكتب في هذا النطاق؟
///
/// الوكيل يكتب في مهمّته ومشروعها، وفي نطاق المستخدم تفضيلًا وحده — وكل ذلك بعد
/// موافقة بشرية، لأن أداة اقتراح الذاكرة تكتب في القاعدة. نطاق النظام لا يكتبه وكيل.
pub fn source_may_write(source: CandidateSource, scope: MemoryScope, memory_type: MemoryType) -> bool {
    match source {
        CandidateSource::Runtime => matches!(scope, MemoryScope::Mission | MemoryScope::Project),
        CandidateSource::Agent => match scope {
            MemoryScope::Mission | MemoryScope::Project => true,
            MemoryScope::User => memory_type == MemoryType::Preference,
            MemoryScope::System => false,
        },
        // المستخدم يكتب عن نفسه (تفضيلًا أو حقيقة) أو عن مشروعه. لا ذاكرة عمل لمهمّة، ولا نطاق نظام.
        CandidateSource::User => match scope {
            MemoryScope::User => matches!(memory_type, MemoryType::Preference | MemoryType::Semantic),
            MemoryScope::Project => matches!(memory_type, MemoryType::Project | MemoryType::Semantic),
            MemoryScope::Mission | MemoryScope::System => false,
        },
    }
}

fn subject_is_valid(subject: &str) -> bool {
    let count = subject.chars().count();
    (1..=MAX_SUBJECT_CHARS).contains(&count) && !subject.chars().any(char::is_control)
}

/// يتحقق من مرشّح ويقرّر صنفه وتحقّقه. الرفض هنا يسبق أي كتابة.
pub fn validate(candidate: MemoryCandidateV1) -> Result<ValidatedCandidate, RejectReason> {
    let subject = candidate.subject.split_whitespace().collect::<Vec<_>>().join(" ");
    let content = candidate.content.trim().to_string();
    if !subject_is_valid(&subject) {
        return Err(RejectReason::SubjectInvalid);
    }
    if content.is_empty() {
        return Err(RejectReason::ContentEmpty);
    }
    if content.chars().count() > MAX_CONTENT_CHARS {
        return Err(RejectReason::ContentTooLarge);
    }
    if !(1..=5).contains(&candidate.importance) {
        return Err(RejectReason::ImportanceInvalid);
    }
    // السرّ يُفحص في الموضوع والمحتوى والسبب معًا: سبب المرشّح يُعرض كذلك.
    for text in [&subject, &content, &candidate.reason] {
        if crate::p05::secret::find(text).is_some() {
            return Err(RejectReason::SecretLike);
        }
    }
    let lowered = normalise(&content);
    if REASONING_MARKERS.iter().any(|m| lowered.contains(m)) {
        return Err(RejectReason::RawReasoning);
    }
    if lowered.contains("<html") || lowered.contains("<!doctype") || lowered.contains("<body") || content.lines().count() > 40 {
        return Err(RejectReason::PageDump);
    }
    if !type_fits_scope(candidate.proposed_type, candidate.proposed_scope) {
        return Err(RejectReason::TypeScopeMismatch);
    }
    if !source_may_write(candidate.source, candidate.proposed_scope, candidate.proposed_type) {
        return Err(RejectReason::ScopeNotPermitted);
    }
    match candidate.proposed_scope {
        MemoryScope::Mission if candidate.mission_id.as_deref().is_none_or(str::is_empty) => {
            return Err(RejectReason::BindingMissing)
        }
        MemoryScope::Project if candidate.project_id.as_deref().is_none_or(str::is_empty) => {
            return Err(RejectReason::BindingMissing)
        }
        _ => {}
    }

    // المنشأ: نصّ الوكيل نصّ نموذج دائمًا، وتحقّقه UNVERIFIED دائمًا. ما يقوله
    // المرشّح عن مصدر ثقته يُسجَّل كما هو، ولا يرفع شيئًا.
    let (trust_class, verification, confidence_source) = match candidate.source {
        CandidateSource::Agent => (MemoryTrustClass::ModelGenerated, MemoryVerification::Unverified, ConfidenceSource::UserApprovedWrite),
        // نصّ المستخدم: مشتقّ منه، غير محقَّق (قوله لا يثبت بدليل)، وكتابته هي موافقته.
        CandidateSource::User => (MemoryTrustClass::UserDerived, MemoryVerification::Unverified, ConfidenceSource::UserApprovedWrite),
        CandidateSource::Runtime => {
            // الربط بالدليل يحتاج مرجع دليل فعليًّا، ومصدر ثقة هو الدليل المقيس.
            let evidence_backed = candidate.confidence_source == ConfidenceSource::RuntimeEvidence
                && candidate.source_refs.iter().any(|r| r.kind == SourceKind::Evidence);
            let verification = if evidence_backed { MemoryVerification::EvidenceLinked } else { MemoryVerification::Unverified };
            let confidence = if evidence_backed || candidate.confidence_source != ConfidenceSource::RuntimeEvidence {
                candidate.confidence_source
            } else {
                ConfidenceSource::None
            };
            (candidate.content_origin, verification, confidence)
        }
    };

    // التلوّث اتحاد لا طرح: ما جاء مع المرشّح يبقى، ويُضاف ما يقتضيه المنشأ.
    let mut taint = candidate.taint.clone();
    if trust_class == MemoryTrustClass::ModelGenerated {
        taint.add(TaintFlag::ModelGenerated);
    }
    if verification == MemoryVerification::Unverified && trust_class != MemoryTrustClass::SystemGenerated {
        taint.add(TaintFlag::UnverifiedClaim);
    }

    let mut candidate = candidate;
    candidate.source_refs.sort();
    candidate.source_refs.dedup();
    candidate.source_refs.truncate(MAX_SOURCE_REFS);
    Ok(ValidatedCandidate { candidate, subject, content, trust_class, verification, taint, confidence_source })
}

#[cfg(test)]
mod tests {
    use super::super::model::SourceRef;
    use super::*;

    pub(crate) fn candidate(source: CandidateSource, scope: MemoryScope, memory_type: MemoryType) -> MemoryCandidateV1 {
        MemoryCandidateV1 {
            candidate_id: "c1".into(),
            source,
            proposed_type: memory_type,
            proposed_scope: scope,
            mission_id: Some("m1".into()),
            project_id: Some("p1".into()),
            subject: "fixture page title".into(),
            content: "The fixture page title is POLARIS Fixture Normal.".into(),
            reason: "reusable fact".into(),
            source_refs: vec![SourceRef::new(SourceKind::Mission, "m1")],
            taint: Taint::clean(),
            confidence_source: ConfidenceSource::ModelSelfReport,
            producer: "agent:a1".into(),
            content_origin: MemoryTrustClass::SystemGenerated,
            importance: 3,
            task_id: None,
        }
    }

    #[test]
    fn a_model_cannot_persist_trusted_memory_whatever_it_claims() {
        let mut c = candidate(CandidateSource::Agent, MemoryScope::Mission, MemoryType::Semantic);
        // يدّعي أنه نصّ نظام ومربوط بدليل: لا أثر لذلك.
        c.content_origin = MemoryTrustClass::SystemGenerated;
        c.confidence_source = ConfidenceSource::RuntimeEvidence;
        c.source_refs.push(SourceRef::new(SourceKind::Evidence, "e-invented"));
        let v = validate(c).unwrap();
        assert_eq!(v.trust_class, MemoryTrustClass::ModelGenerated);
        assert_eq!(v.verification, MemoryVerification::Unverified);
        assert!(v.taint.contains(TaintFlag::ModelGenerated));
        assert!(v.taint.contains(TaintFlag::UnverifiedClaim));
    }

    #[test]
    fn runtime_evidence_links_only_with_an_evidence_reference() {
        let mut c = candidate(CandidateSource::Runtime, MemoryScope::Project, MemoryType::Semantic);
        c.content_origin = MemoryTrustClass::ModelGenerated;
        c.confidence_source = ConfidenceSource::RuntimeEvidence;
        assert_eq!(validate(c.clone()).unwrap().verification, MemoryVerification::Unverified, "no evidence reference, yet linked");
        c.source_refs.push(SourceRef::new(SourceKind::Evidence, "e1"));
        let v = validate(c).unwrap();
        assert_eq!(v.verification, MemoryVerification::EvidenceLinked);
        // المحتوى نصّ نموذج حتى لو حقّقه دليل: المنشأ لا يُمحى بالتحقق.
        assert_eq!(v.trust_class, MemoryTrustClass::ModelGenerated);
    }

    #[test]
    fn secrets_reasoning_pages_and_huge_outputs_are_refused() {
        let base = candidate(CandidateSource::Agent, MemoryScope::Mission, MemoryType::Semantic);
        let mut secret = base.clone();
        secret.content = "the admin password is hunter2".into();
        assert_eq!(validate(secret), Err(RejectReason::SecretLike));
        let mut reasoning = base.clone();
        reasoning.content = "<think>first I will</think> the answer".into();
        assert_eq!(validate(reasoning), Err(RejectReason::RawReasoning));
        let mut page = base.clone();
        page.content = "<!DOCTYPE html><html><body>whole page</body></html>".into();
        assert_eq!(validate(page), Err(RejectReason::PageDump));
        let mut huge = base.clone();
        huge.content = "x".repeat(MAX_CONTENT_CHARS + 1);
        assert_eq!(validate(huge), Err(RejectReason::ContentTooLarge));
        let mut empty = base;
        empty.content = "   ".into();
        assert_eq!(validate(empty), Err(RejectReason::ContentEmpty));
    }

    #[test]
    fn scope_rules_hold_for_every_source() {
        assert_eq!(
            validate(candidate(CandidateSource::Agent, MemoryScope::System, MemoryType::Semantic)),
            Err(RejectReason::ScopeNotPermitted)
        );
        // نطاق المستخدم للتفضيل وحده حين يكتبه وكيل.
        assert_eq!(
            validate(candidate(CandidateSource::Agent, MemoryScope::User, MemoryType::Semantic)),
            Err(RejectReason::ScopeNotPermitted)
        );
        assert!(validate(candidate(CandidateSource::Agent, MemoryScope::User, MemoryType::Preference)).is_ok());
        assert_eq!(
            validate(candidate(CandidateSource::Agent, MemoryScope::Mission, MemoryType::Preference)),
            Err(RejectReason::TypeScopeMismatch)
        );
        assert_eq!(
            validate(candidate(CandidateSource::Runtime, MemoryScope::User, MemoryType::Semantic)),
            Err(RejectReason::ScopeNotPermitted)
        );
        let mut unbound = candidate(CandidateSource::Agent, MemoryScope::Project, MemoryType::Project);
        unbound.project_id = None;
        assert_eq!(validate(unbound), Err(RejectReason::BindingMissing));
    }
}
