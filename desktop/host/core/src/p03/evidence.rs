// نطاق الأدلّة.
//
// كل دليل يحمل مصدره (البند 50): من أنتجه، ومن أين، ومتى، وهل قِيس أم استُنتج،
// وبصمته، وصنف ثقته. مخرجات الوكيل وحدها لا تحقّق حقيقة عن العالم أبدًا (البند 49).
// الاستقلال يُقاس بسلالة المصدر لا بعدد الوكلاء (البند 52): إن قرأ الوكيل B نتيجةَ
// الوكيل A فتلك سلالة واحدة لا دليلان.

use serde::{Deserialize, Serialize};

use super::trust::{AuthorityClass, Taint};

/// نوع الدليل. مجموعة مغلقة (البند 49).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceType {
    UserConfirmation,
    RuntimeMeasurement,
    TestResult,
    Artifact,
    SourceDocument,
    ProjectContext,
    ProviderResponse,
    PolicyDecision,
    AuditEvent,
    CompletionProof,
    /// نتيجة أداة نفّذتها بوابة الأدوات فعلًا (Phase-04). مقيسة، ولا تفي بقاعدة
    /// تطلب أثر اختبار: أداةٌ عملت ليست اختبارًا جرى.
    ToolResult,
    /// مخرجات وكيل. لا تحقّق حقيقة بمفردها (البند 49).
    AgentOutput,
    /// حكم مصحِّح كود على محتوى مخرَج (خطة 2026-10-07، ADR-041): نصّ مطلوب حرفيًّا وُجد، أو اقتباس طابق صفحة جُلبت. مقيس.
    GraderResult,
    /// حكم نموذج مستقلّ على معنى مخرَج. يبقى صنفه ظاهرًا: حكم، لا قياس.
    ModelJudgment,
}

impl EvidenceType {
    /// كل عضو في المفردة، بالترتيب. تُستعمل حيث يجب ألّا يُنسى نوع جديد.
    pub const ALL: [EvidenceType; 14] = [
        Self::UserConfirmation,
        Self::RuntimeMeasurement,
        Self::TestResult,
        Self::Artifact,
        Self::SourceDocument,
        Self::ProjectContext,
        Self::ProviderResponse,
        Self::PolicyDecision,
        Self::AuditEvent,
        Self::CompletionProof,
        Self::ToolResult,
        Self::AgentOutput,
        Self::GraderResult,
        Self::ModelJudgment,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::UserConfirmation => "USER_CONFIRMATION",
            Self::RuntimeMeasurement => "RUNTIME_MEASUREMENT",
            Self::TestResult => "TEST_RESULT",
            Self::Artifact => "ARTIFACT",
            Self::SourceDocument => "SOURCE_DOCUMENT",
            Self::ProjectContext => "PROJECT_CONTEXT",
            Self::ProviderResponse => "PROVIDER_RESPONSE",
            Self::PolicyDecision => "POLICY_DECISION",
            Self::AuditEvent => "AUDIT_EVENT",
            Self::CompletionProof => "COMPLETION_PROOF",
            Self::ToolResult => "TOOL_RESULT",
            Self::AgentOutput => "AGENT_OUTPUT",
            Self::GraderResult => "GRADER_RESULT",
            Self::ModelJudgment => "MODEL_JUDGMENT",
        }
    }

    /// هل قِيس هذا الدليل (لا استُنتج)؟ القياس وحده ما يحقّق حقيقة عن العالم.
    pub fn is_measured(self) -> bool {
        matches!(
            self,
            Self::RuntimeMeasurement
                | Self::TestResult
                | Self::ToolResult
                | Self::UserConfirmation
                | Self::PolicyDecision
                | Self::AuditEvent
                | Self::GraderResult
        )
    }

    /// هل يحكم هذا الدليل على معنى المحتوى؟ وحده يجوز أن يرقّي ادّعاءً دلاليًّا (ADR-041 §3.3).
    pub fn grades_content(self) -> bool {
        matches!(self, Self::GraderResult | Self::ModelJudgment | Self::UserConfirmation | Self::TestResult)
    }

    /// هل هذا الدليل مخرجات وكيل/نموذج، فلا يحقّق حقيقة بمفرده؟
    pub fn is_agent_output(self) -> bool {
        self == Self::AgentOutput
    }
}

/// كيف نشأ الدليل: قياس أم استنتاج.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MeasurementKind {
    Measured,
    Inferred,
}

/// مصدر الدليل. لا دليل مجهول المصدر (البند 50).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Provenance {
    /// ما الذي أنتج الدليل: معرّف وكيل، أو خدمة تشغيل، أو المستخدم.
    pub producer: String,
    pub authority: AuthorityClass,
    /// من أين جاء المحتوى: مرجع مصدر، أو معرّف دليل سابق اشتُقّ منه.
    pub source_ref: String,
    /// سلالة الاشتقاق: معرّفات الأدلّة/المصادر التي بُني عليها هذا الدليل.
    /// دليلان يتشاركان السلالة ليسا مستقلّين.
    pub lineage: Vec<String>,
    pub measurement_kind: MeasurementKind,
}

/// عنصر دليل واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceItem {
    pub evidence_id: String,
    pub mission_id: String,
    pub evidence_type: EvidenceType,
    pub created_at: String,
    /// بصمة المحتوى، تثبت هوية البايتات لا صحّتها (البند 152).
    pub digest: String,
    pub provenance: Provenance,
    pub taint: Taint,
    /// ملخّص محدود الطول؛ المحتوى الحسّاس قد يبقى خارج العارض.
    pub summary: String,
}

impl EvidenceItem {
    /// السلالة المُعرِّفة لهذا الدليل: مصدره الجذري إن وُجد، وإلا معرّفه نفسه.
    /// دليلان لهما السلالة نفسها لا يُحسبان مصدرين مستقلّين.
    pub fn lineage_root(&self) -> &str {
        self.provenance.lineage.first().map(String::as_str).unwrap_or(&self.provenance.source_ref)
    }
}

/// يحسب عدد المصادر المستقلّة في مجموعة أدلّة، بالسلالة لا بالعدد الخام (البند 52).
pub fn independent_source_count(evidence: &[&EvidenceItem]) -> usize {
    let mut roots: Vec<&str> = evidence.iter().map(|e| e.lineage_root()).collect();
    roots.sort_unstable();
    roots.dedup();
    roots.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, ty: EvidenceType, root: &str, lineage: Vec<&str>) -> EvidenceItem {
        EvidenceItem {
            evidence_id: id.into(),
            mission_id: "m1".into(),
            evidence_type: ty,
            created_at: "t".into(),
            digest: "d".into(),
            provenance: Provenance {
                producer: "svc".into(),
                authority: AuthorityClass::TrustedRuntimeFact,
                source_ref: root.into(),
                lineage: lineage.into_iter().map(String::from).collect(),
                measurement_kind: MeasurementKind::Measured,
            },
            taint: Taint::clean(),
            summary: "s".into(),
        }
    }

    #[test]
    fn agent_output_is_flagged_as_non_verifying() {
        assert!(EvidenceType::AgentOutput.is_agent_output());
        assert!(!EvidenceType::AgentOutput.is_measured());
        assert!(EvidenceType::RuntimeMeasurement.is_measured());
        assert!(EvidenceType::TestResult.is_measured());
    }

    #[test]
    fn a_tool_result_is_measured_but_is_not_a_test_artefact() {
        // الفارق مقصود: قاعدة الإنجاز تطلب `TEST_RESULT` بعينه، فلا تُستوفى بأداة
        // نفّذت شيئًا. وهذا يمنع «شغّلتُ أداةً» من أن تصير «نجحت الاختبارات».
        assert!(EvidenceType::ToolResult.is_measured());
        assert!(!EvidenceType::ToolResult.is_agent_output());
        assert_ne!(EvidenceType::ToolResult, EvidenceType::TestResult);
        assert_eq!(EvidenceType::ToolResult.as_str(), "TOOL_RESULT");
    }

    #[test]
    fn two_items_sharing_a_lineage_count_as_one_source() {
        // A نتيجة قياس بجذر "file:x". B اشتُقّ من A، فسلالته جذرها "file:x" أيضًا.
        let a = ev("A", EvidenceType::RuntimeMeasurement, "file:x", vec!["file:x"]);
        let b = ev("B", EvidenceType::AgentOutput, "A", vec!["file:x", "A"]);
        assert_eq!(independent_source_count(&[&a, &b]), 1, "shared lineage double-counted");
    }

    #[test]
    fn distinct_roots_count_as_independent() {
        let a = ev("A", EvidenceType::RuntimeMeasurement, "file:x", vec!["file:x"]);
        let c = ev("C", EvidenceType::TestResult, "test:run-42", vec!["test:run-42"]);
        assert_eq!(independent_source_count(&[&a, &c]), 2);
    }
}
