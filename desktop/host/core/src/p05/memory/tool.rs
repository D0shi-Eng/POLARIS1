// أداة اقتراح الذاكرة: المسار الوحيد الذي يصل منه وكيل إلى المخزن.
//
// الأداة تكتب في القاعدة، فأثرها DATABASE_WRITE، فتمرّ بموافقة بشرية في كل نداء
// (ختم Phase-04). والتقييم يسبق الموافقة: مرشّح سيُرفض (سرّ، تفكير خام، نطاق النظام)
// يُرفض قبل أن يُسأل المستخدم، فلا يُطلب منه إقرار ما لن يُحفظ. وما يُحفظ يبقى
// MODEL_GENERATED / UNVERIFIED مهما قال الوكيل عنه.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::p03::trust::Taint;
use crate::p04::adapter::{
    bounded, EvidenceNoteStance, ToolAdapter, ToolAssessContext, ToolAssessment, ToolCallContext, ToolEvidenceNote, ToolFailure,
    ToolOutcome,
};
use crate::p04::approval::ApprovalContext;
use crate::p04::effect::ToolEffect;
use crate::p04::tool::{RiskClass, ToolDescriptor};
use crate::p05::tooling::{check_args, descriptor, int_arg, text_arg, ArgKind, ArgSpec};

use super::model::{CandidateSource, ConfidenceSource, MemoryCandidateV1, MemoryDecision, MemoryScope, MemoryTrustClass, MemoryType, SourceKind, SourceRef};
use super::policy::validate;
use super::service::MemoryService;

pub const TOOL_MEMORY_PROPOSE: &str = "polaris.memory.propose";

fn spec() -> Vec<ArgSpec> {
    vec![
        ArgSpec { name: "memory_type", required: true, kind: ArgKind::Text { max: 12 } },
        ArgSpec { name: "scope", required: true, kind: ArgKind::Text { max: 10 } },
        ArgSpec { name: "subject", required: true, kind: ArgKind::Text { max: 120 } },
        ArgSpec { name: "content", required: true, kind: ArgKind::Text { max: 2000 } },
        ArgSpec { name: "reason", required: false, kind: ArgKind::Text { max: 400 } },
        ArgSpec { name: "importance", required: false, kind: ArgKind::Integer { min: 1, max: 5 } },
    ]
}

pub struct MemoryProposeTool {
    memory: Arc<MemoryService>,
    /// مصدر معرّفات المرشّحين. يصدرها زمن التشغيل لا النموذج.
    ids: crate::p03::clock::RuntimeClock,
}

impl MemoryProposeTool {
    pub fn new(memory: Arc<MemoryService>, ids: crate::p03::clock::RuntimeClock) -> Self {
        Self { memory, ids }
    }

    fn candidate(&self, arguments: &Value, mission_id: &str, task_id: &str, agent_id: &str, project_id: Option<&str>) -> Result<MemoryCandidateV1, ToolFailure> {
        let memory_type = MemoryType::parse(&text_arg(arguments, "memory_type"))
            .ok_or_else(|| ToolFailure::ArgumentsInvalid("memory_type is not one of the declared types".into()))?;
        let scope = MemoryScope::parse(&text_arg(arguments, "scope")).ok_or_else(|| ToolFailure::ArgumentsInvalid("scope is not one of the declared scopes".into()))?;
        Ok(MemoryCandidateV1 {
            candidate_id: self.ids.id(),
            source: CandidateSource::Agent,
            proposed_type: memory_type,
            proposed_scope: scope,
            mission_id: Some(mission_id.to_string()),
            project_id: project_id.map(str::to_string),
            subject: text_arg(arguments, "subject"),
            content: text_arg(arguments, "content"),
            reason: text_arg(arguments, "reason"),
            source_refs: vec![
                SourceRef::new(SourceKind::Mission, mission_id),
                SourceRef::new(SourceKind::Task, task_id),
                SourceRef::new(SourceKind::Agent, agent_id),
            ],
            taint: Taint::clean(),
            confidence_source: ConfidenceSource::ModelSelfReport,
            producer: format!("agent:{agent_id}"),
            content_origin: MemoryTrustClass::ModelGenerated,
            importance: int_arg(arguments, "importance").unwrap_or(3).clamp(1, 5) as u8,
            task_id: Some(task_id.to_string()),
        })
    }
}

impl ToolAdapter for MemoryProposeTool {
    fn tool_id(&self) -> &str {
        TOOL_MEMORY_PROPOSE
    }

    fn descriptor(&self) -> ToolDescriptor {
        let schema = json!({ "tool": TOOL_MEMORY_PROPOSE, "fields": spec().iter().map(|s| s.name).collect::<Vec<_>>() });
        descriptor(
            TOOL_MEMORY_PROPOSE,
            "Propose a memory",
            "Proposes one bounded note for memory. Every proposal waits for the user's approval, is stored as MODEL_GENERATED and UNVERIFIED, and never becomes truth or policy.",
            vec![ToolEffect::DatabaseWrite],
            false,
            &schema,
        )
    }

    // CP-03-1 (2026-10-20): بلا مخطط عُرضت الأداة كائنًا فارغًا، ووصفها لا يسمّي حقولها، فلا يعرف النموذج `memory_type` ولا `scope`.
    // المخطط هو مواصفة `validate` نفسها، والقيم المقبولة من المفردات المغلقة.
    fn input_schema(&self) -> Option<Value> {
        let mut schema = crate::p05::tooling::schema_of(&spec());
        schema["properties"]["memory_type"]["enum"] = json!(MemoryType::ALL.iter().map(|t| t.as_str()).collect::<Vec<_>>());
        schema["properties"]["scope"]["enum"] = json!(MemoryScope::ALL.iter().map(|s| s.as_str()).collect::<Vec<_>>());
        Some(schema)
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        check_args(arguments, &spec())
    }

    fn assess(&self, arguments: &Value, context: &ToolAssessContext<'_>) -> Result<ToolAssessment, ToolFailure> {
        let candidate = self.candidate(arguments, context.mission_id, context.task_id, context.agent_id, context.project_id)?;
        // ما سترفضه السياسة يُرفض الآن: لا يُسأل المستخدم عن إقرار ما لن يُحفظ.
        let validated = validate(candidate.clone()).map_err(|reason| ToolFailure::NotPermitted(format!("the memory policy refuses this candidate: {}", reason.as_str())))?;
        Ok(ToolAssessment {
            extra_effects: Vec::new(),
            approval_context: Some(ApprovalContext {
                agent_id: String::new(),
                action: "MEMORY_PROPOSE".into(),
                target: format!("{} / {} — \"{}\"", candidate.proposed_scope.as_str(), candidate.proposed_type.as_str(), bounded(&validated.subject, 100)),
                expected_effect: format!(
                    "Stores this note as {} / {} memory in scope {}. Stored memory is data for later agents, never truth, policy or permission: \"{}\"",
                    validated.trust_class.as_str(),
                    validated.verification.as_str(),
                    candidate.proposed_scope.as_str(),
                    bounded(&validated.content, 200)
                ),
                risk: RiskClass::Moderate,
                arguments_summary: bounded(&crate::p04::gateway::canonical_arguments(arguments), 300),
            }),
        })
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let candidate = self.candidate(arguments, context.mission_id, context.task_id, context.agent_id, context.project_id)?;
        let decision = self.memory.submit(candidate).map_err(|e| ToolFailure::Unavailable(format!("the memory store could not be written: {e}")))?;
        let summary = match &decision {
            MemoryDecision::Rejected { reason } => format!("the memory policy rejected the proposal: {}", reason.as_str()),
            other => format!("memory {} {} ({})", other.memory_id().unwrap_or("-"), other.code(), other.reason_code()),
        };
        if let MemoryDecision::Rejected { reason } = decision {
            return Err(ToolFailure::NotPermitted(format!("the memory policy rejected the proposal: {}", reason.as_str())));
        }
        Ok(ToolOutcome {
            summary: summary.clone(),
            measured_bytes: summary.clone().into_bytes(),
            supports: true,
            detail: summary,
            // كتابة ذاكرة ليست دليلًا على مضمونها: موقف محايد.
            evidence: Some(ToolEvidenceNote { kind: "MEMORY_WRITE", stance: EvidenceNoteStance::Neutral }),
            observation: None,
        })
    }
}
