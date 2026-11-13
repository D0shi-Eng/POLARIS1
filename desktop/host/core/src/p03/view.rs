// عروض Phase-03: الشكل الذي يعبر إلى العارض، ولا شيء غيره.
//
// كل بنية هنا تطابق تعريفها في `desktop-p03-result.v1.schema.json`. ما لا يظهر هنا
// لا يعبر: لا سرّ، ولا جسد مزوّد خام، ولا سلسلة تفكير مخفية (البند 86). الحالة
// وإثباتها يسافران معًا دائمًا، فلا تُقرأ إحداهما دون الأخرى.

use serde::Serialize;

use super::agent::{AgentDescriptor, AgentInstance};
use super::claim::Claim;
use super::completion::{Blocker, CompletionProof};
use super::evidence::EvidenceItem;
use super::graph::TaskGraph;
use super::mission::{Mission, MissionRequirement};
use super::task::TaskNode;

#[derive(Debug, Clone, Serialize)]
pub struct RequirementView {
    pub requirement_id: String,
    pub text: String,
    pub verification_rule_id: String,
    pub mandatory: bool,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim_ref: Option<String>,
}

impl RequirementView {
    pub fn of(r: &MissionRequirement) -> Self {
        Self {
            requirement_id: r.requirement_id.clone(),
            text: r.text.clone(),
            verification_rule_id: r.verification_rule_id.clone(),
            mandatory: r.mandatory,
            status: match r.status {
                super::mission::RequirementStatus::Pending => "PENDING",
                super::mission::RequirementStatus::Satisfied => "SATISFIED",
                super::mission::RequirementStatus::Unsatisfied => "UNSATISFIED",
                super::mission::RequirementStatus::Unverified => "UNVERIFIED",
                super::mission::RequirementStatus::Blocked => "BLOCKED",
            },
            claim_ref: r.claim_ref.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionDetailView {
    pub mission_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub title: String,
    pub title_authority: &'static str,
    pub objective: String,
    pub origin: &'static str,
    pub execution_mode: &'static str,
    pub priority: &'static str,
    pub state: &'static str,
    pub completion_proof_status: &'static str,
    pub current_revision: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_task_id: Option<String>,
    pub budget: super::mission::MissionBudget,
    pub requirements: Vec<RequirementView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub version: u32,
}

impl MissionDetailView {
    pub fn of(m: &Mission) -> Self {
        use super::mission::{ExecutionMode, MissionOrigin, MissionPriority};
        Self {
            mission_id: m.mission_id.clone(),
            project_id: m.project_id.clone(),
            title: m.title.clone(),
            title_authority: m.title_authority.as_str(),
            objective: m.objective.clone(),
            origin: match m.origin {
                MissionOrigin::User => "USER",
                MissionOrigin::System => "SYSTEM",
            },
            execution_mode: match m.execution_mode {
                ExecutionMode::SingleAgent => "SINGLE_AGENT",
                ExecutionMode::CoordinatedMultiAgent => "COORDINATED_MULTI_AGENT",
            },
            priority: match m.priority {
                MissionPriority::Low => "LOW",
                MissionPriority::Normal => "NORMAL",
                MissionPriority::High => "HIGH",
            },
            state: m.state.as_str(),
            completion_proof_status: m.completion_proof_status.as_str(),
            current_revision: m.current_revision,
            root_task_id: m.root_task_id.clone(),
            budget: m.budget.clone(),
            requirements: m.requirements.iter().map(RequirementView::of).collect(),
            result_summary: m.result_summary.clone(),
            // يُقصّ عند حدّ العقد: سجلّ قديم أطول لا يُسقط العرض كله.
            failure_reason: m.failure_reason.as_ref().map(|r| r.chars().take(super::runtime::FAILURE_REASON_MAX_CHARS).collect()),
            created_at: m.created_at.clone(),
            started_at: m.started_at.clone(),
            completed_at: m.completed_at.clone(),
            version: m.version,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockerView {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl BlockerView {
    pub fn of(b: &Blocker) -> Self {
        match b {
            Blocker::UnsatisfiedRequirement(d) => Self { kind: "UNSATISFIED_REQUIREMENT", detail: Some(bounded_detail(d)) },
            Blocker::UnverifiedRequirement(d) => Self { kind: "UNVERIFIED_REQUIREMENT", detail: Some(bounded_detail(d)) },
            Blocker::ConflictedClaim(d) => Self { kind: "CONFLICTED_CLAIM", detail: Some(bounded_detail(d)) },
            Blocker::CriticalPolicyViolation(d) => Self { kind: "CRITICAL_POLICY_VIOLATION", detail: Some(bounded_detail(d)) },
            Blocker::NoMandatoryRequirement => Self { kind: "NO_MANDATORY_REQUIREMENT", detail: None },
            Blocker::ExecutionIncomplete(d) => Self { kind: "EXECUTION_INCOMPLETE", detail: Some(bounded_detail(d)) },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CompletionProofView {
    pub status: &'static str,
    pub proof_summary: String,
    pub verified_requirements: Vec<String>,
    pub unverified_requirements: Vec<String>,
    pub conflicted_claims: Vec<String>,
    pub remaining_blockers: Vec<BlockerView>,
}

impl CompletionProofView {
    pub fn of(p: &CompletionProof) -> Self {
        Self {
            status: p.status.as_str(),
            proof_summary: p.proof_summary.clone(),
            verified_requirements: p.verified_requirements.clone(),
            unverified_requirements: p.unverified_requirements.clone(),
            conflicted_claims: p.conflicted_claims.clone(),
            remaining_blockers: p.remaining_blockers.iter().map(BlockerView::of).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskDependencyView {
    pub depends_on: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskView {
    pub task_id: String,
    pub mission_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    pub task_type: &'static str,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_agent_id: Option<String>,
    /// الخطوة التي تنتمي إليها هذه: خطوة من خطة الوكيل، أو خطوة وكيل مساعد مفوَّض (ADR-039).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    pub dependencies: Vec<TaskDependencyView>,
    pub attempt: u32,
    pub max_attempts: u32,
}

impl TaskView {
    pub fn of(n: &TaskNode) -> Self {
        use super::task::DependencyKind;
        Self {
            task_id: n.task_id.clone(),
            mission_id: n.mission_id.clone(),
            title: n.title.clone(),
            objective: if n.objective.is_empty() { None } else { Some(n.objective.clone()) },
            task_type: n.task_type.as_str(),
            state: n.state.as_str(),
            assigned_agent_id: n.assigned_agent_id.clone(),
            parent_task_id: n.parent_task_id.clone(),
            dependencies: n
                .dependencies
                .iter()
                .map(|d| TaskDependencyView {
                    depends_on: d.task_id.clone(),
                    kind: match d.kind {
                        DependencyKind::RequiresSuccess => "REQUIRES_SUCCESS",
                        DependencyKind::RequiresCompletion => "REQUIRES_COMPLETION",
                    },
                })
                .collect(),
            attempt: n.attempt,
            max_attempts: n.max_attempts,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentRoleView {
    pub agent_type: &'static str,
    pub display_name_key: String,
    pub purpose_key: String,
    pub allowed_task_types: Vec<&'static str>,
    pub max_delegation_depth: u32,
    pub review_eligible: bool,
    pub security_class: &'static str,
    pub enabled: bool,
}

impl AgentRoleView {
    pub fn of(d: &AgentDescriptor) -> Self {
        use super::agent::SecurityClass;
        Self {
            agent_type: d.agent_type.as_str(),
            display_name_key: d.display_name_key.clone(),
            purpose_key: d.purpose_key.clone(),
            allowed_task_types: d.allowed_task_types.iter().map(|t| t.as_str()).collect(),
            max_delegation_depth: d.max_delegation_depth,
            review_eligible: d.review_eligible,
            security_class: match d.security_class {
                SecurityClass::Standard => "STANDARD",
                SecurityClass::SecuritySensitive => "SECURITY_SENSITIVE",
            },
            enabled: d.enabled,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentView {
    pub agent_id: String,
    pub mission_id: String,
    pub role: &'static str,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub delegation_depth: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task_id: Option<String>,
    pub created_at: String,
    pub last_active_at: String,
}

impl AgentView {
    pub fn of(a: &AgentInstance) -> Self {
        Self {
            agent_id: a.agent_id.clone(),
            mission_id: a.mission_id.clone(),
            role: a.role.as_str(),
            state: a.state.as_str(),
            model_id: a.model_id.clone(),
            delegation_depth: a.delegation_depth,
            parent_agent_id: a.parent_agent_id.clone(),
            current_task_id: a.current_task_id.clone(),
            created_at: a.created_at.clone(),
            last_active_at: a.last_active_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaimView {
    pub claim_id: String,
    pub mission_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub agent_id: String,
    pub statement: String,
    pub claim_type: &'static str,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub property: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub evidence_count: u32,
    pub counterevidence_count: u32,
    pub taint: Vec<&'static str>,
    pub verification_required: bool,
    pub created_at: String,
}

impl ClaimView {
    pub fn of(c: &Claim) -> Self {
        Self {
            claim_id: c.claim_id.clone(),
            mission_id: c.mission_id.clone(),
            task_id: c.task_id.clone(),
            agent_id: c.agent_id.clone(),
            statement: c.statement.clone(),
            claim_type: c.claim_type.as_str(),
            status: c.status.as_str(),
            subject: c.subject.as_ref().map(|s| s.subject.clone()),
            property: c.subject.as_ref().map(|s| s.property.clone()),
            value: c.subject.as_ref().map(|s| s.value.clone()),
            evidence_count: c.evidence_refs.len() as u32,
            counterevidence_count: c.counterevidence_refs.len() as u32,
            taint: c.taint.flags().iter().map(|f| f.as_str()).collect(),
            verification_required: c.verification_required,
            created_at: c.created_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceView {
    pub evidence_id: String,
    pub mission_id: String,
    pub evidence_type: &'static str,
    pub digest: String,
    pub producer: String,
    pub authority: &'static str,
    pub source_ref: String,
    pub lineage: Vec<String>,
    pub measurement_kind: &'static str,
    pub taint: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub created_at: String,
}

impl EvidenceView {
    pub fn of(e: &EvidenceItem) -> Self {
        use super::evidence::MeasurementKind;
        Self {
            evidence_id: e.evidence_id.clone(),
            mission_id: e.mission_id.clone(),
            evidence_type: e.evidence_type.as_str(),
            digest: e.digest.clone(),
            producer: e.provenance.producer.clone(),
            authority: e.provenance.authority.as_str(),
            source_ref: e.provenance.source_ref.clone(),
            lineage: e.provenance.lineage.clone(),
            measurement_kind: match e.provenance.measurement_kind {
                MeasurementKind::Measured => "MEASURED",
                MeasurementKind::Inferred => "INFERRED",
            },
            taint: e.taint.flags().iter().map(|f| f.as_str()).collect(),
            summary: if e.summary.is_empty() { None } else { Some(e.summary.clone()) },
            created_at: e.created_at.clone(),
        }
    }
}

/// المجموعة الجاهزة كما يراها العارض، بترتيب الجدولة الحتمي.
pub fn ready_ids(graph: &TaskGraph, priority: super::mission::MissionPriority) -> Vec<String> {
    let map = super::graph::uniform_priority(graph, priority);
    graph.ready_set(&map)
}

/// حدّ عقد العرض لتفصيل العائق (BlockerViewV1.detail ≤ 512).
fn bounded_detail(d: &str) -> String {
    d.chars().take(512).collect()
}
