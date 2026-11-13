// خدمات Phase-04: التركيب، وعمليات المهارات والأدوات وخوادم MCP والموافقات.
//
// `Phase04` تركيب فقط؛ لا منطق إنفاذ هنا. الإنفاذ في `gateway`، والتحقق في
// `tool` و`mcp::discovery`، والحدود في `budget` و`approval`. وما تفعله هذه الطبقة
// هو ترتيب النداءات وحفظ ما يجب أن يبقى.
//
// ولا توجد في هذا الملف دالّة تنفّذ أداة استجابةً لعملية IPC. تنفيذ الأداة يبدأ
// من زمن تشغيل المهمّة وحده، عبر `session` و`ToolGateway`.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

use polaris_host_providers::net::{CancelToken, HttpClient};

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::ipc::errors::{DesktopErrorCategory, HostError};
use crate::p02::context::SourceService;
use crate::p03::clock::RuntimeClock;
use crate::storage::{Database, StorageError};

use super::activity::ToolInvocationRecord;
use super::approval::{ApprovalDecision, ApprovalRefusal};
use super::budget::{ToolBudget, ToolBudgetLedger};
use super::builtin::builtin_adapters;
use super::effect::{self, ToolEffect};
use super::evidence::ToolEvidenceSource;
use super::gateway::{GatewayState, MissionToolSession, ToolGateway};
use super::mcp::adapter::McpToolAdapter;
use super::mcp::model::{self, McpServer, McpServerState};
use super::mcp::{discovery, McpClient};
use super::repository::{Phase04Repository, StoredMcpTool};
use super::skill::{SkillRegistry, SKILL_EXTERNAL_TOOLING};
use super::tool::{ToolProvider, ToolRegistry};
use super::view::{
    ApprovalView, McpServerView, MissionToolSummary, SkillView, ToolBudgetUsageView, ToolBudgetView, ToolInvocationView, ToolView,
};

/// ما يحتاجه Phase-04 من محيطه.
pub struct Phase04Config {
    pub db: Arc<Database>,
    pub audit: Arc<AuditLedger>,
    pub clock: RuntimeClock,
    pub http: Arc<HttpClient>,
    pub sources: Arc<SourceService>,
    /// مصدر أدلّة الأدوات المشترك مع Phase-03.
    pub evidence: Arc<ToolEvidenceSource>,
}

pub struct Phase04 {
    pub repository: Arc<Phase04Repository>,
    pub gateway: Arc<ToolGateway>,
    mcp: Arc<McpClient>,
    clock: RuntimeClock,
    audit: Arc<AuditLedger>,
    /// مراقب اختياري للاستدعاءات والموافقات (Phase-06: الاستعمال والمقاييس). يقرأ ولا يقرّر.
    observer: std::sync::OnceLock<Arc<dyn ToolActivityObserver>>,
    /// المهارة المعروضة على الوكيل افتراضيًّا (Phase-08: مهارة العمل الوكيلي التي تضمّ أدوات
    /// المراحل السابقة كلها). تُثبَّت مرة واحدة من التركيب، ولا يغيّرها وكيل ولا عارض.
    preferred_skill: std::sync::OnceLock<String>,
}

/// مراقب نشاط الأدوات. يُنادى بعد أن تقرّر البوابة، فلا يستطيع أن يغيّر قرارًا.
pub trait ToolActivityObserver: Send + Sync {
    fn invocation(&self, record: &ToolInvocationRecord);
    fn approval_requested(&self, _approval_id: &str) {}
    fn approval_decided(&self, _approval_id: &str, _granted: bool) {}
}

// ——— نتائج العمليات، بالشكل الذي يصفه مخطط النتيجة.

#[derive(Debug, Clone, Serialize)]
pub struct SkillListResult {
    pub skills: Vec<SkillView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillGetResult {
    pub skill: SkillView,
    pub tools: Vec<ToolView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillConfigureResult {
    pub skill: SkillView,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolListResult {
    pub tools: Vec<ToolView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolGetResult {
    pub tool: ToolView,
    pub allowed_by_skills: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolActivityListResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    pub invocations: Vec<ToolInvocationView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<MissionToolSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpListResult {
    pub servers: Vec<McpServerView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerResult {
    pub server: McpServerView,
}

#[derive(Debug, Clone, Serialize)]
pub struct RejectedToolView {
    pub declared_name: String,
    pub reason: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpRefreshResult {
    pub server: McpServerView,
    pub accepted: Vec<ToolView>,
    pub rejected: Vec<RejectedToolView>,
    /// أدوات أُعيد تعريفها ولم يقبل المستخدم تعريفها الجديد بعد (R-11، 2026-10-12): معطّلة حتى القبول، والواجهة تعرضها له.
    pub pending_redefinitions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalListResult {
    pub approvals: Vec<ApprovalView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApprovalRespondResult {
    pub approval: ApprovalView,
}

/// مدخلات تسجيل خادم، بعد أن تحقّقت البوابة من الحمولة.
pub struct RegisterServerInput {
    pub name: String,
    pub endpoint: String,
    pub granted_effects: Option<Vec<ToolEffect>>,
}

impl Phase04 {
    /// يبني الطبقة ويستعيد ما حُفظ: حالة المهارات، والخوادم، وأدواتها.
    pub fn build(config: Phase04Config) -> Result<Self, StorageError> {
        let repository = Arc::new(Phase04Repository::new(config.db.clone()));
        let mcp = Arc::new(McpClient::new(config.http.clone()));

        let mut state = GatewayState {
            skills: SkillRegistry::builtin(),
            tools: ToolRegistry::new(),
            servers: repository.servers()?,
            approvals: super::approval::ApprovalStore::new(),
            activity: super::activity::ActivityLog::new(),
            adapters: Vec::new(),
            redefined: repository.redefinitions()?,
            mission_grants: Default::default(),
        };

        // الأدوات المدمجة: واصفها ومحوّلها معًا. أداة بلا محوّل لا تدخل السجل.
        for adapter in builtin_adapters(config.audit.clone(), config.sources.clone()) {
            let descriptor = adapter.descriptor();
            if state.tools.register(descriptor.clone()).is_ok() {
                state.set_adapter(&descriptor.tool_id, adapter);
            }
        }

        // حالة المهارات المحفوظة تُطبَّق فوق التعريف المدمج. التعريف لا يأتي من القرص.
        let now = config.clock.now();
        for (skill_id, enabled, updated_at) in repository.skill_states()? {
            state.skills.set_enabled(&skill_id, enabled, &updated_at);
        }

        // أدوات الخوادم المحفوظة تُعاد إلى السجل بعد أن تمرّ بتحققه من جديد.
        let mut mcp_tool_ids: Vec<String> = Vec::new();
        for stored in repository.tools()? {
            let server_known = state.servers.iter().any(|s| Some(&s.server_id) == stored.descriptor.provenance.server_id.as_ref());
            if !server_known {
                continue;
            }
            if state.tools.register(stored.descriptor.clone()).is_ok() {
                mcp_tool_ids.push(stored.descriptor.tool_id.clone());
                state.set_adapter(
                    &stored.descriptor.tool_id,
                    Arc::new(McpToolAdapter {
                        descriptor: stored.descriptor.clone(),
                        declared_name: stored.declared_name.clone(),
                        endpoint: state
                            .servers
                            .iter()
                            .find(|s| Some(&s.server_id) == stored.descriptor.provenance.server_id.as_ref())
                            .map(|s| s.endpoint.clone())
                            .unwrap_or_default(),
                        input_schema: stored.input_schema.clone(),
                        client: mcp.clone(),
                    }),
                );
            }
        }
        state.skills.bind_mcp_tools(mcp_tool_ids, &now);

        // إقلاع جديد ينهي كل موافقة كانت معلّقة أو ممنوحة: لا سياق ينتظرها.
        let _ = repository.expire_pending_after_restart(&now);
        for record in repository.approvals(None)? {
            state.approvals.insert(record);
        }
        for record in repository.invocations(None, 200)? {
            state.activity.push(record);
        }

        let gateway = Arc::new(ToolGateway::new(state, config.audit.clone(), config.clock.clone(), config.evidence));
        Ok(Self { repository, gateway, mcp, clock: config.clock, audit: config.audit, observer: std::sync::OnceLock::new(), preferred_skill: std::sync::OnceLock::new() })
    }

    /// يركّب مراقب النشاط مرّة واحدة.
    pub fn install_observer(&self, observer: Arc<dyn ToolActivityObserver>) -> bool {
        self.observer.set(observer).is_ok()
    }

    /// يزامن أدوات طبقة لاحقة تتغيّر بعد الإقلاع (موصلات Phase-06): يُزيل كل ما يبدأ
    /// بالبادئة، ثم يسجّل المحوّلات من جديد تحت الختم والتحقق نفسيهما، ثم يربط المهارة
    /// بما سُجّل فعلًا. ما رُفض يُعاد باسمه وسببه ولا يُبتلع.
    pub fn sync_dynamic_tools(
        &self,
        prefix: &str,
        skill: super::skill::SkillDescriptor,
        adapters: Vec<Arc<dyn super::adapter::ToolAdapter>>,
    ) -> Result<Vec<(String, &'static str)>, StorageError> {
        let persisted = self.repository.skill_states()?;
        let now = self.clock.now();
        let Ok(mut state) = self.gateway.state.lock() else {
            return Err(StorageError::Invalid("the gateway state is unavailable".into()));
        };
        let removed = state.tools.remove_prefixed(prefix);
        state.adapters.retain(|(id, _)| !removed.contains(id));
        let mut refused = Vec::new();
        let mut registered = Vec::new();
        for adapter in adapters {
            let descriptor = adapter.descriptor();
            if !descriptor.tool_id.starts_with(prefix) {
                refused.push((descriptor.tool_id.clone(), "ARGUMENTS_INVALID"));
                continue;
            }
            match state.tools.register(descriptor.clone()) {
                Ok(()) => {
                    state.set_adapter(&descriptor.tool_id, adapter);
                    registered.push(descriptor.tool_id.clone());
                }
                Err(reason) => refused.push((descriptor.tool_id.clone(), reason.as_str())),
            }
        }
        let skill_id = skill.skill_id.clone();
        match state.skills.ensure_dynamic(skill) {
            Ok(true) => {
                if let Some((_, enabled, updated_at)) = persisted.iter().find(|(id, _, _)| *id == skill_id) {
                    state.skills.set_enabled(&skill_id, *enabled, updated_at);
                }
            }
            Ok(false) => {}
            Err(reason) => refused.push((skill_id.clone(), reason)),
        }
        state.skills.bind_tools(&skill_id, registered, &now);
        Ok(refused)
    }

    /// يجيب طلب موافقة، و«لهذه المهمّة» حين يطلبه المستخدم (ADR-042). الأهلية تُفحص قبل القرار: فعل لا يقبل منحة مهمّة يُرفض
    /// طلبه كلّه ولا يُمنح ولو مرّة، فيعود القرار إلى المستخدم كاملًا. المنحة بعد قرار مُنح فعلًا، ومربوطة بما رآه المستخدم:
    /// الأداة والمورد المشتقّ من حجج هذا الطلب نفسه والآثار، في هذه المهمّة، لساعة.
    pub fn respond_approval_scoped(&self, approval_id: &str, decision: ApprovalDecision, mission_scope: bool, session: &str) -> Result<ApprovalRespondResult, HostError> {
        let wants_grant = mission_scope && decision == ApprovalDecision::Grant;
        let pending = if wants_grant {
            let state = self.locked()?;
            let record = state.approvals.get(approval_id).cloned().ok_or_else(|| HostError::validation("no such approval").at("/approval_id"))?;
            if !crate::p04::mission_grant::eligible(&record.binding.effects, record.context.as_ref()) {
                return Err(HostError::permission_denied("MISSION_SCOPE_NOT_ALLOWED: this action can only be allowed once; it has effects outside the mission's workspace or that cannot be undone").at("/scope"));
            }
            Some(record)
        } else {
            None
        };
        let result = self.respond_approval_as(approval_id, decision, Some(session))?;
        if let (Some(record), true) = (pending, result.approval.status == crate::p04::approval::ApprovalStatus::Granted.as_str()) {
            let arguments: Value = serde_json::from_str(&record.arguments_preview).unwrap_or(Value::Null);
            let resource = crate::p04::mission_grant::resource_of(&record.binding.tool_id, &arguments, &record.binding.arguments_digest, record.context.as_ref());
            let now_ms = self.clock.now_millis();
            let expires_ms = now_ms + crate::p04::mission_grant::MISSION_GRANT_TTL_MS;
            let grant = crate::p04::mission_grant::MissionGrant {
                grant_id: self.clock.id(),
                mission_id: record.binding.mission_id.clone(),
                tool_id: record.binding.tool_id.clone(),
                resource,
                effects: record.binding.effects.clone(),
                created_at: self.clock.now(),
                expires_at: self.clock.at_millis(expires_ms),
                expires_at_ms: expires_ms,
            };
            self.locked_mut()?.mission_grants.add(grant.clone());
            self.record_audit(
                AuditEventType::ToolApprovalDecided,
                &grant.grant_id,
                AuditOutcome::Success,
                serde_json::json!({ "scope": "MISSION", "approval_id": approval_id, "mission_id": grant.mission_id, "tool_id": grant.tool_id, "resource": grant.resource, "expires_at": grant.expires_at }),
            );
        }
        Ok(result)
    }

    /// منح المهمّة القائمة الآن.
    pub fn mission_grants(&self, mission_id: &str) -> Result<Vec<crate::p04::mission_grant::MissionGrant>, HostError> {
        Ok(self.locked()?.mission_grants.active(mission_id, self.clock.now_millis()))
    }

    /// يسحب منحة واحدة أو كل منح المهمّة، بحدث تدقيق. يعيد عدد ما سُحب.
    pub fn revoke_mission_grants(&self, mission_id: &str, grant_id: Option<&str>) -> Result<usize, HostError> {
        let revoked = self.locked_mut()?.mission_grants.revoke(mission_id, grant_id);
        if revoked > 0 {
            self.record_audit(AuditEventType::ToolApprovalDecided, mission_id, AuditOutcome::Cancelled, serde_json::json!({ "scope": "MISSION", "mission_id": mission_id, "grants_revoked": revoked }));
        }
        Ok(revoked)
    }

    /// يُنهي موافقات مهمّة أُلغيت ويحفظ ذلك، ويسحب منحها. يُعاد عدد ما أُنهي.
    pub fn expire_mission_approvals(&self, mission_id: &str) -> usize {
        let now = self.clock.now();
        let expired = match self.gateway.state.lock() {
            Ok(mut state) => {
                state.mission_grants.revoke(mission_id, None);
                state.approvals.expire_for_mission(mission_id, &now)
            }
            Err(_) => return 0,
        };
        for record in &expired {
            let _ = self.repository.save_approval(record);
            self.record_audit(
                AuditEventType::ToolApprovalDecided,
                &record.approval_id,
                AuditOutcome::Cancelled,
                serde_json::json!({ "mission_id": mission_id, "tool_id": record.binding.tool_id, "status": record.status.as_str(), "reason": "MISSION_CANCELLED" }),
            );
        }
        expired.len()
    }

    fn record_audit(&self, event: AuditEventType, subject: &str, outcome: AuditOutcome, detail: Value) {
        let _ = self.audit.append(&AuditRecord::new(event, "tool", subject, outcome, detail));
    }

    /// يسجّل أدوات طبقة لاحقة ومهاراتها في السجل نفسه، تحت الختم والتحقق نفسيهما.
    ///
    /// لا طريق جانبي: الأداة تمرّ بـ`ToolRegistry::register` كأي أداة مدمجة، والمهارة
    /// لا تسمّي إلا أداة سُجّلت فعلًا. حالة التفعيل المحفوظة تُطبَّق كما تُطبَّق على
    /// المهارات المدمجة. ويعيد ما رُفض بسببه بدل أن يبتلعه.
    pub fn register_extension(
        &self,
        adapters: Vec<Arc<dyn super::adapter::ToolAdapter>>,
        skills: Vec<super::skill::SkillDescriptor>,
    ) -> Result<Vec<(String, &'static str)>, StorageError> {
        let persisted = self.repository.skill_states()?;
        let mut refused: Vec<(String, &'static str)> = Vec::new();
        let Ok(mut state) = self.gateway.state.lock() else {
            return Err(StorageError::Invalid("the gateway state is unavailable".into()));
        };
        for adapter in adapters {
            let descriptor = adapter.descriptor();
            match state.tools.register(descriptor.clone()) {
                Ok(()) => state.set_adapter(&descriptor.tool_id, adapter),
                Err(reason) => refused.push((descriptor.tool_id.clone(), reason.as_str())),
            }
        }
        for skill in skills {
            if let Some(unknown) = skill.allowed_tools.iter().find(|id| state.tools.get(id).is_none()) {
                refused.push((format!("{}:{unknown}", skill.skill_id), "UNKNOWN_TOOL"));
                continue;
            }
            let skill_id = skill.skill_id.clone();
            if let Err(reason) = state.skills.add(skill) {
                refused.push((skill_id, reason));
                continue;
            }
            if let Some((_, enabled, updated_at)) = persisted.iter().find(|(id, _, _)| *id == skill_id) {
                state.skills.set_enabled(&skill_id, *enabled, updated_at);
            }
        }
        Ok(refused)
    }

    /// يسجّل أدوات طبقة لاحقة ومهارة مركّبة مدمجة واحدة (Phase-08). الأدوات تمرّ بالتسجيل نفسه؛
    /// والمهارة لا تسمّي إلا أداة مسجّلة، وسقفها `COMPOSITE_SKILL_MAX_TOOLS`، ومصدرها مدمج.
    pub fn register_composite(
        &self,
        adapters: Vec<Arc<dyn super::adapter::ToolAdapter>>,
        skill: super::skill::SkillDescriptor,
    ) -> Result<Vec<(String, &'static str)>, StorageError> {
        let mut refused = self.register_extension(adapters, Vec::new())?;
        let persisted = self.repository.skill_states()?;
        let Ok(mut state) = self.gateway.state.lock() else {
            return Err(StorageError::Invalid("the gateway state is unavailable".into()));
        };
        if let Some(unknown) = skill.allowed_tools.iter().find(|id| state.tools.get(id).is_none()) {
            refused.push((format!("{}:{unknown}", skill.skill_id), "UNKNOWN_TOOL"));
            return Ok(refused);
        }
        let skill_id = skill.skill_id.clone();
        if let Err(reason) = state.skills.add_composite(skill) {
            refused.push((skill_id, reason));
            return Ok(refused);
        }
        if let Some((_, enabled, updated_at)) = persisted.iter().find(|(id, _, _)| *id == skill_id) {
            state.skills.set_enabled(&skill_id, *enabled, updated_at);
        }
        Ok(refused)
    }

    /// جلسة أدوات لمهمّة. المدخل الوحيد الذي يفتح مسار التنفيذ، ويُستدعى من
    /// زمن تشغيل المهمّة الموثوق لا من طبقة IPC.
    pub fn session(&self, mission_id: &str, project_id: Option<String>, budget: ToolBudget, cancel: CancelToken) -> MissionToolSession {
        MissionToolSession::new(mission_id, project_id, ToolBudgetLedger::new(budget), cancel)
    }

    /// يحفظ سجل استدعاء أنتجته البوابة. يُستدعى بعد كل محاولة، ناجحة أو مرفوضة.
    pub fn persist_invocation(&self, record: &ToolInvocationRecord) {
        let _ = self.repository.save_invocation(record);
        if let Some(observer) = self.observer.get() {
            observer.invocation(record);
        }
    }

    /// يحفظ موافقة معلّقة أنشأتها البوابة.
    pub fn persist_pending_approval(&self, approval_id: &str) {
        let record = self.gateway.state.lock().ok().and_then(|s| s.approvals.get(approval_id).cloned());
        if let Some(record) = record {
            let _ = self.repository.save_approval(&record);
            if let Some(observer) = self.observer.get() {
                observer.approval_requested(approval_id);
            }
        }
    }

    // ——— المهارات.

    pub fn list_skills(&self) -> Result<SkillListResult, HostError> {
        let state = self.locked()?;
        Ok(SkillListResult { skills: state.skills.skills().iter().map(SkillView::of).collect() })
    }

    pub fn get_skill(&self, skill_id: &str) -> Result<SkillGetResult, HostError> {
        let state = self.locked()?;
        let skill = state
            .skills
            .get(skill_id)
            .ok_or_else(|| HostError::validation("no such skill").at("/skill_id"))?;
        let tools = skill.allowed_tools.iter().filter_map(|id| state.tools.get(id)).map(ToolView::of).collect();
        Ok(SkillGetResult { skill: SkillView::of(skill), tools })
    }

    pub fn configure_skill(&self, skill_id: &str, enabled: bool) -> Result<SkillConfigureResult, HostError> {
        let now = self.clock.now();
        let view = {
            let mut state = self.locked_mut()?;
            if !state.skills.set_enabled(skill_id, enabled, &now) {
                return Err(HostError::validation("no such skill").at("/skill_id"));
            }
            SkillView::of(state.skills.get(skill_id).expect("the skill was just updated"))
        };
        self.repository.set_skill_enabled(skill_id, enabled, &now).map_err(storage_error)?;
        self.record_audit(
            AuditEventType::SkillConfigured,
            skill_id,
            if enabled { AuditOutcome::Success } else { AuditOutcome::Denied },
            serde_json::json!({ "enabled": enabled }),
        );
        Ok(SkillConfigureResult { skill: view })
    }

    // ——— الأدوات.

    pub fn list_tools(&self, provider: Option<&str>, skill_id: Option<&str>) -> Result<ToolListResult, HostError> {
        let state = self.locked()?;
        let allowed: Option<Vec<String>> = match skill_id {
            Some(id) => Some(
                state
                    .skills
                    .get(id)
                    .ok_or_else(|| HostError::validation("no such skill").at("/skill_id"))?
                    .allowed_tools
                    .clone(),
            ),
            None => None,
        };
        let tools = state
            .tools
            .tools()
            .iter()
            .filter(|tool| provider.is_none_or(|p| tool.provider.as_str() == p))
            .filter(|tool| allowed.as_ref().is_none_or(|ids| ids.contains(&tool.tool_id)))
            .map(ToolView::of)
            .collect();
        Ok(ToolListResult { tools })
    }

    pub fn get_tool(&self, tool_id: &str) -> Result<ToolGetResult, HostError> {
        let state = self.locked()?;
        let tool = state
            .tools
            .get(tool_id)
            .ok_or_else(|| HostError::validation("no such tool").at("/tool_id"))?;
        let allowed_by_skills = state.skills.skills_allowing(tool_id).iter().map(|s| s.skill_id.clone()).collect();
        Ok(ToolGetResult { tool: ToolView::of(tool), allowed_by_skills })
    }

    // ——— النشاط.

    pub fn list_activity(&self, mission_id: Option<&str>, limit: Option<usize>) -> Result<ToolActivityListResult, HostError> {
        let records = self.repository.invocations(mission_id, limit.unwrap_or(100)).map_err(storage_error)?;
        let invocations: Vec<ToolInvocationView> = records.iter().map(ToolInvocationView::of).collect();
        let summary = match mission_id {
            Some(id) => {
                let state = self.locked()?;
                let pending = state
                    .approvals
                    .for_mission(id)
                    .iter()
                    .filter(|r| r.status == super::approval::ApprovalStatus::Pending)
                    .count() as u32;
                let mut skills_used: Vec<String> =
                    records.iter().filter(|r| r.status.executed()).map(|r| r.skill_id.clone()).collect();
                skills_used.sort();
                skills_used.dedup();
                let mut tools_used: Vec<String> =
                    records.iter().filter(|r| r.status.executed()).map(|r| r.tool_id.clone()).collect();
                tools_used.sort();
                tools_used.dedup();
                let usage = super::budget::ToolBudgetUsage {
                    tool_calls: records.iter().filter(|r| r.status.executed()).count() as u32,
                    external_side_effects: 0,
                    network_tool_calls: records
                        .iter()
                        .filter(|r| r.status.executed() && r.effects.contains(&ToolEffect::NetworkEgress))
                        .count() as u32,
                    tool_runtime_ms: records.iter().map(|r| r.duration_ms).sum(),
                };
                Some(MissionToolSummary {
                    mission_id: id.to_string(),
                    invocations: invocations.clone(),
                    skills_used,
                    tools_used,
                    budget: ToolBudgetView::of(&ToolBudget::conservative()),
                    usage: ToolBudgetUsageView::of(&usage),
                    pending_approvals: pending,
                })
            }
            None => None,
        };
        Ok(ToolActivityListResult { mission_id: mission_id.map(str::to_string), invocations, summary })
    }

    // ——— خوادم MCP.

    pub fn list_servers(&self) -> Result<McpListResult, HostError> {
        let state = self.locked()?;
        Ok(McpListResult { servers: state.servers.iter().map(McpServerView::of).collect() })
    }

    /// يسجّل خادمًا. التسجيل لا يكتشف شيئًا ولا يمنح شيئًا فوق السقف.
    pub fn register_server(&self, input: RegisterServerInput) -> Result<McpServerResult, HostError> {
        // الحلّ يقع هنا أيضًا، لا عند العقد وحده: نمط الحمولة حارس أول، وهذا الحارس
        // هو الذي يفحص المضيف فعلًا ويرفض إعادة الربط إلى عنوان آخر.
        // PHASE-06: الحلقة المحلية، أو HTTPS إلى عنوان عامّ (يُفحص من جديد عند كل اتصال).
        let (resolved, transport) = super::mcp::client::resolve_registered(&input.endpoint)
            .map_err(|_| HostError::validation("the endpoint is neither a loopback address nor a public https address this host will contact").at("/endpoint"))?;
        let granted = model::grant_for(&input.granted_effects.unwrap_or_else(model::default_grant), transport);
        let server = McpServer {
            server_id: self.clock.id(),
            name: super::mcp::sanitize::clean_text(&input.name, 200),
            endpoint: resolved.display(),
            transport,
            state: McpServerState::Enabled,
            granted_effects: granted.clone(),
            tool_count: 0,
            rejected_tool_count: 0,
            last_error: None,
            last_refresh_at: None,
            registered_at: self.clock.now(),
        };
        if server.name.is_empty() {
            return Err(HostError::validation("the server name is empty").at("/name"));
        }
        self.repository.save_server(&server).map_err(storage_error)?;
        {
            let mut state = self.locked_mut()?;
            state.servers.push(server.clone());
        }
        self.record_audit(
            AuditEventType::McpServerRegistered,
            &server.server_id,
            AuditOutcome::Success,
            serde_json::json!({
                "endpoint": server.endpoint,
                "transport": server.transport.as_str(),
                "granted_effects": granted.iter().map(|e| e.as_str()).collect::<Vec<_>>(),
            }),
        );
        Ok(McpServerResult { server: McpServerView::of(&server) })
    }

    pub fn configure_server(&self, server_id: &str, enabled: bool) -> Result<McpServerResult, HostError> {
        let server = {
            let mut state = self.locked_mut()?;
            let server = state
                .servers
                .iter_mut()
                .find(|s| s.server_id == server_id)
                .ok_or_else(|| HostError::validation("no such server").at("/server_id"))?;
            server.state = if enabled { McpServerState::Enabled } else { McpServerState::Disabled };
            server.clone()
        };
        self.repository.save_server(&server).map_err(storage_error)?;
        self.record_audit(
            AuditEventType::McpServerConfigured,
            server_id,
            if enabled { AuditOutcome::Success } else { AuditOutcome::Denied },
            serde_json::json!({ "state": server.state.as_str() }),
        );
        Ok(McpServerResult { server: McpServerView::of(&server) })
    }

    /// يعيد اكتشاف أدوات خادم. كل أداة تمرّ بالتحقق من جديد.
    pub fn refresh_server(&self, server_id: &str) -> Result<McpRefreshResult, HostError> {
        let mut server = {
            let state = self.locked()?;
            state
                .server(server_id)
                .cloned()
                .ok_or_else(|| HostError::validation("no such server").at("/server_id"))?
        };
        if server.state == McpServerState::Disabled {
            return Err(HostError::new(
                DesktopErrorCategory::ConfigUnavailable,
                "CONFLICT",
                "the server is disabled; enable it before discovering its tools",
            ));
        }
        // CP-06-5 (وجده التحقّق الحقيقي، 2026-10-21): الاكتشاف كان يحلّ الحلقة المحلية وحدها، فرُفض كل خادم بعيد عند التحديث.
        // النقل المحلول يجب أن يطابق النقل المسجَّل: عنوان تغيّر صنفه لا يُكتشف.
        let endpoint = match super::mcp::client::resolve_registered(&server.endpoint) {
            Ok((endpoint, transport)) if transport == server.transport => endpoint,
            _ => return Err(HostError::validation("the stored endpoint no longer resolves to the transport it was registered with").at("/server_id")),
        };
        let cancel = CancelToken::new();
        let now = self.clock.now();
        // التهيئة أولًا: خادم لا يتكلّم البروتوكول لا يُسأل عن أدواته.
        if let Err(error) = self.mcp.initialize(&endpoint, 5_000, &cancel) {
            server.state = McpServerState::Unreachable;
            server.last_error = Some(error.as_code().to_string());
            server.last_refresh_at = Some(now.clone());
            self.save_and_replace(&server)?;
            return Ok(McpRefreshResult { server: McpServerView::of(&server), accepted: Vec::new(), rejected: Vec::new(), pending_redefinitions: self.pending_redefinitions() });
        }
        let raw = match self.mcp.list_tools(&endpoint, 10_000, &cancel) {
            Ok(tools) => tools,
            Err(error) => {
                server.state = McpServerState::Unreachable;
                server.last_error = Some(error.as_code().to_string());
                server.last_refresh_at = Some(now.clone());
                self.save_and_replace(&server)?;
                return Ok(McpRefreshResult { server: McpServerView::of(&server), accepted: Vec::new(), rejected: Vec::new(), pending_redefinitions: self.pending_redefinitions() });
            }
        };

        let previous: Vec<super::tool::ToolDescriptor> = {
            let state = self.locked()?;
            state.tools.server_tools(server_id).into_iter().cloned().collect()
        };
        let (found, schemas) = discovery::discover(&server, &raw, &previous, &now);

        // السجل يُستبدل ذرّيًّا: أدوات الخادم القديمة تُزال، ثم تدخل المقبولة وحدها.
        let mut stored: Vec<StoredMcpTool> = Vec::new();
        {
            let mut state = self.locked_mut()?;
            // تعريف تغيّر بعد الاكتشاف: يُسجَّل معلّقًا حتى يقبله المستخدم (ASI04)، ويُحفظ فلا يضيع بإعادة التشغيل.
            for tool_id in &found.redefined {
                if !state.redefined.contains(tool_id) {
                    state.redefined.push(tool_id.clone());
                    let _ = self.repository.note_redefinition(tool_id, server_id, &now);
                }
            }
            state.remove_server_adapters(server_id);
            state.tools.remove_server_tools(server_id);
            for descriptor in &found.accepted {
                let schema = schemas
                    .iter()
                    .find(|(id, _)| id == &descriptor.tool_id)
                    .map(|(_, s)| s.clone())
                    .unwrap_or_else(|| "{\"type\":\"object\"}".into());
                if state.tools.register(descriptor.clone()).is_ok() {
                    let declared_name = descriptor.tool_id.rsplit(':').next().unwrap_or_default().to_string();
                    state.set_adapter(
                        &descriptor.tool_id,
                        Arc::new(McpToolAdapter {
                            descriptor: descriptor.clone(),
                            declared_name: declared_name.clone(),
                            endpoint: server.endpoint.clone(),
                            input_schema: schema.clone(),
                            client: self.mcp.clone(),
                        }),
                    );
                    stored.push(StoredMcpTool { descriptor: descriptor.clone(), declared_name, input_schema: schema });
                }
            }
            // المهارة المدعومة بـMCP تسمّي ما اكتُشف عبر كل الخوادم، لا هذا الخادم وحده.
            let ids: Vec<String> = state
                .tools
                .tools()
                .iter()
                .filter(|t| t.provider == ToolProvider::Mcp)
                .map(|t| t.tool_id.clone())
                .collect();
            state.skills.bind_mcp_tools(ids, &now);
        }
        self.repository.replace_server_tools(server_id, &stored, &now).map_err(storage_error)?;

        server.state = McpServerState::Enabled;
        server.tool_count = found.accepted.len() as u32;
        server.rejected_tool_count = found.rejected.len() as u32;
        server.last_error = None;
        server.last_refresh_at = Some(now.clone());
        self.save_and_replace(&server)?;
        self.record_audit(
            AuditEventType::McpToolsDiscovered,
            server_id,
            AuditOutcome::Success,
            serde_json::json!({
                "accepted": found.accepted.len(),
                "rejected": found.rejected.len(),
                "redefined": found.redefined,
            }),
        );
        Ok(McpRefreshResult {
            server: McpServerView::of(&server),
            accepted: found.accepted.iter().map(ToolView::of).collect(),
            rejected: found
                .rejected
                .iter()
                .map(|r| RejectedToolView { declared_name: r.declared_name.clone(), reason: r.reason.to_string(), detail: r.detail.clone() })
                .collect(),
            pending_redefinitions: self.pending_redefinitions(),
        })
    }

    /// يقبل المستخدم التعريف الجديد لأداة MCP أعاد خادمها تعريفها (ASI04). هذا المسار الوحيد الذي يعيدها إلى التنفيذ.
    pub fn accept_redefinition(&self, tool_id: &str) -> Result<bool, HostError> {
        let removed = {
            let mut state = self.locked_mut()?;
            let before = state.redefined.len();
            state.redefined.retain(|t| t != tool_id);
            before != state.redefined.len()
        };
        if removed {
            self.repository.clear_redefinition(tool_id).map_err(storage_error)?;
            self.record_audit(AuditEventType::McpToolsDiscovered, tool_id, AuditOutcome::Success, serde_json::json!({ "redefinition": "ACCEPTED_BY_USER" }));
        }
        Ok(removed)
    }

    /// أدوات MCP المعلّقة لأن خادمها أعاد تعريفها.
    pub fn pending_redefinitions(&self) -> Vec<String> {
        self.locked().map(|s| s.redefined.clone()).unwrap_or_default()
    }

    // ——— الموافقات.

    pub fn list_approvals(&self, mission_id: Option<&str>) -> Result<ApprovalListResult, HostError> {
        let now_ms = self.clock.now_millis();
        let mut state = self.locked_mut()?;
        state.approvals.expire_due(now_ms);
        let records = match mission_id {
            Some(id) => state.approvals.for_mission(id).into_iter().cloned().collect::<Vec<_>>(),
            None => state.approvals.records().to_vec(),
        };
        Ok(ApprovalListResult { approvals: records.iter().map(ApprovalView::of).collect() })
    }

    /// جواب المستخدم على موافقة. هذا هو المسار الوحيد الذي يمنح أو يمنع.
    pub fn respond_approval(&self, approval_id: &str, decision: ApprovalDecision) -> Result<ApprovalRespondResult, HostError> {
        self.respond_approval_as(approval_id, decision, None)
    }

    /// CP-03-5 (2026-10-20): قِيس في تشغيل Bonsai أن قرار موافقة سُجّل بلا صاحب، فلم يُعرف من منحها. الجلسة التي قرّرت تُسجَّل
    /// ببصمتها (`decided_by_session`)، لا بمعرّفها: يكفي لربط القرار بنافذة أو بالمُطلِق، ولا يُحفظ معرّف جلسة يقبله المضيف.
    fn respond_approval_as(&self, approval_id: &str, decision: ApprovalDecision, session: Option<&str>) -> Result<ApprovalRespondResult, HostError> {
        let now_ms = self.clock.now_millis();
        let now = self.clock.now();
        let record = {
            let mut state = self.locked_mut()?;
            state.approvals.decide(approval_id, decision, now_ms, &now).map_err(approval_error)?
        };
        self.repository.save_approval(&record).map_err(storage_error)?;
        self.record_audit(
            AuditEventType::ToolApprovalDecided,
            approval_id,
            match decision {
                ApprovalDecision::Grant => AuditOutcome::Success,
                ApprovalDecision::Deny => AuditOutcome::Denied,
            },
            serde_json::json!({
                "mission_id": record.binding.mission_id,
                "tool_id": record.binding.tool_id,
                "binding_digest": record.binding.digest(),
                "status": record.status.as_str(),
                "decided_by_session": session.map(|s| crate::digest::sha256_hex(s.as_bytes())[..16].to_string()),
            }),
        );
        if let Some(observer) = self.observer.get() {
            observer.approval_decided(approval_id, decision == ApprovalDecision::Grant);
        }
        Ok(ApprovalRespondResult { approval: ApprovalView::of(&record) })
    }

    // ——— أدوات داخلية.

    fn save_and_replace(&self, server: &McpServer) -> Result<(), HostError> {
        self.repository.save_server(server).map_err(storage_error)?;
        let mut state = self.locked_mut()?;
        if let Some(slot) = state.servers.iter_mut().find(|s| s.server_id == server.server_id) {
            *slot = server.clone();
        }
        Ok(())
    }

    fn locked(&self) -> Result<std::sync::MutexGuard<'_, GatewayState>, HostError> {
        self.gateway.state.lock().map_err(|_| HostError::internal("the tool registry lock is poisoned"))
    }

    fn locked_mut(&self) -> Result<std::sync::MutexGuard<'_, GatewayState>, HostError> {
        self.locked()
    }

    /// القدرات التي يملكها زمن التشغيل، للعرض وللتشخيص. ثابتة في الشيفرة.
    pub fn runtime_capabilities() -> &'static [&'static str] {
        effect::RUNTIME_CAPABILITY_GRANT
    }

    /// الأداة التي تحمل هذا المعرّف، إن كانت مسجَّلة. للاختبار وللمسار الأصلي.
    pub fn tool_exists(&self, tool_id: &str) -> bool {
        self.locked().map(|s| s.tools.get(tool_id).is_some()).unwrap_or(false)
    }

    /// المهارة الافتراضية لمهمّة لم تسمِّ مهارة. تُقرأ من السجل لا تُفترض.
    pub fn default_skill(&self) -> Option<String> {
        self.locked().ok().and_then(|s| {
            let preferred = self.preferred_skill.get().and_then(|id| s.skills.get(id)).filter(|skill| skill.enabled);
            preferred.or_else(|| s.skills.skills().iter().find(|skill| skill.enabled)).map(|skill| skill.skill_id.clone())
        })
    }

    /// يثبّت المهارة الافتراضية. مرة واحدة: المحاولة الثانية تُرفض.
    pub fn prefer_skill(&self, skill_id: &str) -> bool {
        self.preferred_skill.set(skill_id.to_string()).is_ok()
    }

    /// وصف أداة مسجَّلة (الاسم والوصف)، لتعريف الوكيل بما يستطيع اقتراحه. للعرض لا للتنفيذ.
    pub fn tool_description(&self, tool_id: &str) -> Option<String> {
        self.locked().ok().and_then(|s| s.tools.get(tool_id).map(|t| t.description.clone()))
    }

    /// مدخل دليل الأدوات للنموذج (Phase-08): الوصف، ثم الآثار المُعلنة، وهل تنتظر قرارًا بشريًّا.
    /// محايد للنموذج والمزوّد: من السجل وحده، ولا يمنح شيئًا.
    pub fn tool_guide_entry(&self, tool_id: &str) -> Option<String> {
        self.locked().ok().and_then(|s| {
            s.tools.get(tool_id).map(|t| {
                let reads_only = t.effects.iter().all(|e| matches!(e, crate::p04::effect::ToolEffect::ReadLocal | crate::p04::effect::ToolEffect::WorkspaceRead | crate::p04::effect::ToolEffect::DatabaseRead | crate::p04::effect::ToolEffect::LocalCompute));
                let class = if t.effects.iter().any(|e| matches!(e, crate::p04::effect::ToolEffect::NetworkEgress)) {
                    "uses the network"
                } else if reads_only {
                    "reads only"
                } else {
                    "writes"
                };
                // مختصر عمدًا: دليل الأدوات يسافر في كل نداء، ونافذة النموذج المحلي محدودة (قِيس 8192).
                let approval = if t.requires_approval { "; waits for a human decision" } else { "" };
                format!("{} [{class}{approval}]", t.description)
            })
        })
    }

    /// مخطط وسائط أداة من محوّلها (خطة 2026-10-05، B1)، أو لا شيء إن لم يُعلن مخططًا دقيقًا.
    /// صفات أداة لقاعدة الاثنين من واصفها المسجَّل (R-04): المزوّد وصنف الثقة والمنشأ والآثار، لا الاسم.
    /// أداة MCP مصدرها غير موثوق وأثرها خارجي (ما يفعله خادم لا يُعرف من وصفه). أداة موصل تحمل اعتمادات المستخدم فهي حسّاسة،
    /// وناتجها من خدمة خارجية. أثر خارجي أو خروج شبكة فعلٌ خارجي. سرّ أو إدخال سطح مكتب حسّاس.
    pub fn tool_traits(&self, tool_id: &str) -> Option<crate::p03::port::ToolTraits> {
        self.locked().ok().and_then(|s| s.tools.get(tool_id).map(super::tool::ToolDescriptor::rule_of_two_traits))
    }

    pub fn tool_input_schema(&self, tool_id: &str) -> Option<serde_json::Value> {
        self.locked().ok().and_then(|s| s.adapter(tool_id)).and_then(|a| a.input_schema())
    }

    /// أسماء الأدوات المسجَّلة تحت مهارة. أداة مُسمّاة في المهارة وغير مسجَّلة لا
    /// تظهر هنا: المعروض هو ما يمكن تنفيذه فعلًا، لا ما نوت المهارة السماح به.
    pub fn tools_for_skill(&self, skill_id: &str) -> Vec<String> {
        self.locked()
            .ok()
            .and_then(|state| {
                state.skills.get(skill_id).map(|skill| {
                    skill
                        .allowed_tools
                        .iter()
                        .filter(|id| state.tools.get(id).is_some_and(|tool| tool.enabled))
                        .filter(|id| state.adapter(id).is_none_or(|adapter| adapter.offered()))
                        .cloned()
                        .collect::<Vec<String>>()
                })
            })
            .unwrap_or_default()
    }

    /// المهارة المدعومة بـMCP وأدواتها الحالية. للعرض وللاختبار.
    pub fn external_tooling_tools(&self) -> Vec<String> {
        self.locked()
            .ok()
            .and_then(|s| s.skills.get(SKILL_EXTERNAL_TOOLING).map(|skill| skill.allowed_tools.clone()))
            .unwrap_or_default()
    }
}

fn approval_error(refusal: ApprovalRefusal) -> HostError {
    match refusal {
        ApprovalRefusal::Missing => HostError::validation("no such approval").at("/approval_id"),
        ApprovalRefusal::Expired => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the approval expired"),
        ApprovalRefusal::AlreadyUsed => {
            HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the approval was already decided")
        }
        ApprovalRefusal::Denied => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the approval was denied"),
        ApprovalRefusal::Mismatch => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the approval does not match"),
        ApprovalRefusal::StillPending => {
            HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the approval is still pending")
        }
    }
}

fn storage_error(error: StorageError) -> HostError {
    match error {
        StorageError::NotFound => HostError::validation("not found").at("/"),
        StorageError::Conflict => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "version conflict"),
        StorageError::SchemaTooNew { .. } => HostError::new(
            DesktopErrorCategory::ConfigUnavailable,
            "DEPENDENCY_UNAVAILABLE",
            "the local database is newer than this build supports",
        ),
        other => HostError::internal(format!("phase-04 storage: {other}")),
    }
}
