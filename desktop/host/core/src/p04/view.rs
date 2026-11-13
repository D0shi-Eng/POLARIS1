// عروض Phase-04: ما يعبر الحدّ إلى العارض، بالضبط وبلا زيادة.
//
// القاعدة: لا حجج أداة كاملة، ولا جسم نتيجة خام، ولا سرّ، ولا مسار داخلي. تعبر
// المعرّفات والبصمات والتصنيفات والملخّصات المحدودة، لأنها ما يحتاجه العرض وما
// يمكن إثباته. والحقول تطابق مخطط النتيجة حرفًا بحرف.

use serde::Serialize;

use super::activity::ToolInvocationRecord;
use super::approval::ApprovalRecord;
use super::budget::{ToolBudget, ToolBudgetUsage};
use super::effect::ToolEffect;
use super::mcp::model::McpServer;
use super::skill::SkillDescriptor;
use super::tool::ToolDescriptor;

fn codes(effects: &[ToolEffect]) -> Vec<&'static str> {
    effects.iter().map(|e| e.as_str()).collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillView {
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub enabled: bool,
    pub required_capabilities: Vec<String>,
    pub allowed_tools: Vec<String>,
    pub input_schema_ref: String,
    pub output_schema_ref: String,
    pub risk_class: &'static str,
    pub source: &'static str,
    pub created_at: String,
    pub updated_at: String,
}

impl SkillView {
    pub fn of(skill: &SkillDescriptor) -> Self {
        Self {
            skill_id: skill.skill_id.clone(),
            name: skill.name.clone(),
            description: skill.description.clone(),
            version: skill.version.clone(),
            enabled: skill.enabled,
            required_capabilities: skill.required_capabilities.clone(),
            allowed_tools: skill.allowed_tools.clone(),
            input_schema_ref: skill.input_schema_ref.clone(),
            output_schema_ref: skill.output_schema_ref.clone(),
            risk_class: skill.risk_class.as_str(),
            source: skill.source.as_str(),
            created_at: skill.created_at.clone(),
            updated_at: skill.updated_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolProvenanceView {
    pub origin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    pub declared_effects: Vec<&'static str>,
    pub schema_digest: String,
    pub registered_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolView {
    pub tool_id: String,
    pub provider: &'static str,
    pub name: String,
    pub description: String,
    pub effects: Vec<&'static str>,
    pub required_capabilities: Vec<String>,
    pub risk: &'static str,
    pub requires_approval: bool,
    pub network_policy: &'static str,
    pub enabled: bool,
    pub trust_class: &'static str,
    pub input_schema_ref: String,
    pub output_schema_ref: String,
    pub provenance: ToolProvenanceView,
}

impl ToolView {
    pub fn of(tool: &ToolDescriptor) -> Self {
        Self {
            tool_id: tool.tool_id.clone(),
            provider: tool.provider.as_str(),
            name: tool.name.clone(),
            description: tool.description.clone(),
            effects: codes(&tool.effects),
            required_capabilities: tool.required_capabilities.clone(),
            risk: tool.risk.as_str(),
            requires_approval: tool.requires_approval,
            network_policy: tool.network_policy.as_str(),
            enabled: tool.enabled,
            trust_class: tool.trust_class.as_str(),
            input_schema_ref: tool.input_schema_ref.clone(),
            output_schema_ref: tool.output_schema_ref.clone(),
            provenance: ToolProvenanceView {
                origin: tool.provenance.origin.clone(),
                server_id: tool.provenance.server_id.clone(),
                server_name: tool.provenance.server_name.clone(),
                declared_effects: codes(&tool.provenance.declared_effects),
                schema_digest: tool.provenance.schema_digest.clone(),
                registered_at: tool.provenance.registered_at.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerView {
    pub server_id: String,
    pub name: String,
    pub endpoint: String,
    pub transport: &'static str,
    pub state: &'static str,
    pub granted_effects: Vec<&'static str>,
    pub tool_count: u32,
    pub rejected_tool_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_refresh_at: Option<String>,
    pub registered_at: String,
}

impl McpServerView {
    pub fn of(server: &McpServer) -> Self {
        Self {
            server_id: server.server_id.clone(),
            name: server.name.clone(),
            endpoint: server.endpoint.clone(),
            transport: server.transport.as_str(),
            state: server.state.as_str(),
            granted_effects: codes(&server.granted_effects),
            tool_count: server.tool_count,
            rejected_tool_count: server.rejected_tool_count,
            last_error: server.last_error.clone(),
            last_refresh_at: server.last_refresh_at.clone(),
            registered_at: server.registered_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolInvocationView {
    pub invocation_id: String,
    pub mission_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub skill_id: String,
    pub tool_id: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub denial_reason: Option<String>,
    pub effects: Vec<&'static str>,
    pub arguments_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    pub summary: String,
    pub started_at: String,
    pub duration_ms: u64,
}

impl ToolInvocationView {
    pub fn of(record: &ToolInvocationRecord) -> Self {
        Self {
            invocation_id: record.invocation_id.clone(),
            mission_id: record.mission_id.clone(),
            task_id: record.task_id.clone(),
            agent_id: record.agent_id.clone(),
            skill_id: record.skill_id.clone(),
            tool_id: record.tool_id.clone(),
            status: record.status.as_str(),
            denial_reason: record.denial_reason.clone(),
            effects: codes(&record.effects),
            arguments_digest: record.arguments_digest.clone(),
            result_digest: record.result_digest.clone(),
            evidence_id: record.evidence_id.clone(),
            approval_id: record.approval_id.clone(),
            summary: record.summary.clone(),
            started_at: record.started_at.clone(),
            duration_ms: record.duration_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalView {
    pub approval_id: String,
    pub mission_id: String,
    pub task_id: String,
    pub tool_id: String,
    pub skill_id: String,
    pub effects: Vec<&'static str>,
    pub arguments_digest: String,
    pub arguments_preview: String,
    pub reason: String,
    pub status: &'static str,
    pub requested_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_at: Option<String>,
    pub expires_at: String,
    /// الملخّص الموثوق (Phase-05): الوكيل، والفعل، والهدف، والأثر المتوقّع، والخطر.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<ApprovalContextView>,
}

/// الملخّص الموثوق كما يعبر الحدّ. نصوص محدودة كتبها زمن التشغيل.
#[derive(Debug, Clone, Serialize)]
pub struct ApprovalContextView {
    pub agent_id: String,
    pub action: String,
    pub target: String,
    pub expected_effect: String,
    pub risk: &'static str,
    pub arguments_summary: String,
}

impl ApprovalView {
    pub fn of(record: &ApprovalRecord) -> Self {
        Self {
            approval_id: record.approval_id.clone(),
            mission_id: record.binding.mission_id.clone(),
            task_id: record.binding.task_id.clone(),
            tool_id: record.binding.tool_id.clone(),
            skill_id: record.skill_id.clone(),
            effects: codes(&record.binding.effects),
            arguments_digest: record.binding.arguments_digest.clone(),
            arguments_preview: record.arguments_preview.clone(),
            reason: record.reason.clone(),
            status: record.status.as_str(),
            requested_at: record.requested_at.clone(),
            decided_at: record.decided_at.clone(),
            expires_at: record.expires_at.clone(),
            context: record.context.as_ref().map(|c| ApprovalContextView {
                agent_id: c.agent_id.clone(),
                action: c.action.clone(),
                target: super::adapter::bounded(&c.target, 300),
                expected_effect: super::adapter::bounded(&c.expected_effect, 400),
                risk: c.risk.as_str(),
                arguments_summary: super::adapter::bounded(&c.arguments_summary, 400),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolBudgetView {
    pub max_tool_calls: u32,
    pub max_tool_calls_per_task: u32,
    pub max_external_side_effects: u32,
    pub max_network_tool_calls: u32,
    pub max_tool_runtime_ms: u64,
}

impl ToolBudgetView {
    pub fn of(budget: &ToolBudget) -> Self {
        Self {
            max_tool_calls: budget.max_tool_calls,
            max_tool_calls_per_task: budget.max_tool_calls_per_task,
            max_external_side_effects: budget.max_external_side_effects,
            max_network_tool_calls: budget.max_network_tool_calls,
            max_tool_runtime_ms: budget.max_tool_runtime_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolBudgetUsageView {
    pub tool_calls: u32,
    pub external_side_effects: u32,
    pub network_tool_calls: u32,
    pub tool_runtime_ms: u64,
}

impl ToolBudgetUsageView {
    pub fn of(usage: &ToolBudgetUsage) -> Self {
        Self {
            tool_calls: usage.tool_calls,
            external_side_effects: usage.external_side_effects,
            network_tool_calls: usage.network_tool_calls,
            tool_runtime_ms: usage.tool_runtime_ms,
        }
    }
}

/// خلاصة أدوات مهمّة واحدة، كما تظهر داخل تفاصيل المهمّة.
#[derive(Debug, Clone, Serialize)]
pub struct MissionToolSummary {
    pub mission_id: String,
    pub invocations: Vec<ToolInvocationView>,
    pub skills_used: Vec<String>,
    pub tools_used: Vec<String>,
    pub budget: ToolBudgetView,
    pub usage: ToolBudgetUsageView,
    pub pending_approvals: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p04::activity::InvocationStatus;

    #[test]
    fn an_invocation_view_carries_digests_and_never_a_raw_body() {
        let record = ToolInvocationRecord {
            invocation_id: "i1".into(),
            mission_id: "m1".into(),
            task_id: "t1".into(),
            agent_id: "a1".into(),
            skill_id: "s".into(),
            tool_id: "polaris.tool.audit.chain.verify".into(),
            status: InvocationStatus::Succeeded,
            denial_reason: None,
            effects: vec![ToolEffect::DatabaseRead],
            arguments_digest: "d".into(),
            result_digest: Some("r".into()),
            evidence_id: Some("e".into()),
            approval_id: None,
            summary: "the audit chain verified over 3 records".into(),
            started_at: "2026-09-22T00:00:00Z".into(),
            duration_ms: 3,
        };
        let text = serde_json::to_string(&ToolInvocationView::of(&record)).unwrap();
        // الحقول تُفحص بأسمائها كاملة: `"arguments"` حقلٌ محرَّم، و`arguments_digest`
        // مطلوب. فحصٌ بمقطع جزئي يخلط بينهما فيُبلغ عن عيب غير موجود.
        for forbidden in ["\"arguments\"", "\"raw\"", "\"raw_result\"", "\"stdout\"", "\"reasoning\"", "\"api_key\""] {
            assert!(!text.contains(forbidden), "{forbidden} crossed the boundary");
        }
        assert!(text.contains("\"arguments_digest\""));
        assert!(text.contains("DATABASE_READ"));
    }

    #[test]
    fn a_denied_invocation_view_states_its_reason() {
        let record = ToolInvocationRecord {
            invocation_id: "i1".into(),
            mission_id: "m1".into(),
            task_id: "t1".into(),
            agent_id: "a1".into(),
            skill_id: "s".into(),
            tool_id: "x".into(),
            status: InvocationStatus::Denied,
            denial_reason: Some("UNKNOWN_TOOL".into()),
            effects: Vec::new(),
            arguments_digest: "d".into(),
            result_digest: None,
            evidence_id: None,
            approval_id: None,
            summary: "no tool is registered under this identifier".into(),
            started_at: "2026-09-22T00:00:00Z".into(),
            duration_ms: 0,
        };
        let view = ToolInvocationView::of(&record);
        assert_eq!(view.status, "DENIED");
        assert_eq!(view.denial_reason.as_deref(), Some("UNKNOWN_TOOL"));
        assert!(view.result_digest.is_none(), "a denied call reported a result digest");
    }
}
