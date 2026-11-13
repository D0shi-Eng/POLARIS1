// ربط Phase-06 بزمن التشغيل عبر المنافذ القائمة وحدها — لا فرع جديد في Phase-03/04/05.
//
//   PolicyOverlay         — منفذ السياسة المركَّبة في بوابة الأدوات: إعدادات الخصوصية
//                           والأمان تمنع أداة كاملة، ولا توسّع شيئًا.
//   ConfiguredBrokers     — منفذ مصنع الوسطاء: ميزانية أدوات كل مهمّة من الإعدادات الفعلية
//                           لنطاقها، مقصوصةً بحدّ الأمان.
//   Phase06Observer       — منفذ مراقب المهمّة: يركّب مراقب Phase-05 ويقيّده بالخصوصية،
//                           ويُنهي الموافقات مع الإلغاء، ويمحو ما لا يُحفظ.
//   Phase06Context        — منفذ سياق الوكيل: ذاكرة Phase-05 بميزانية الإعدادات، وآخر نتيجة
//                           موصل موسومةً CONNECTOR_UNTRUSTED.
//   ToolUsage             — منفذ مراقب نشاط الأدوات: الاستعمال والمقاييس بعد القرار.

use std::sync::Arc;

use polaris_host_providers::net::CancelToken;

use crate::p03::port::{
    AgentContextBlock, AgentContextKind, AgentContextProvider, AgentContextRequest, MissionObserver, MissionOutcomeNote, TaskOutcomeNote, ToolBroker, ToolBrokerFactory,
};
use crate::p04::activity::{InvocationStatus, ToolInvocationRecord};
use crate::p04::adapter::ToolAssessContext;
use crate::p04::broker::MissionToolBroker;
use crate::p04::budget::ToolBudget;
use crate::p04::gateway::ToolPolicyOverlay;
use crate::p04::service::{Phase04, ToolActivityObserver};
use crate::p04::tool::{RiskClass, ToolDescriptor, ToolProvider};
use crate::p05::memory::context::MemoryContextBudget;
use crate::p05::memory::retriever::MemoryQuery;
use crate::p05::Phase05;
use crate::storage::Database;

use super::config::{ConfigScope, ConfigService};
use super::connector::ConnectorGateway;
use super::cost::model::{Cost, Provenance, UsageCategory, UsageRecord};
use super::cost::CostBooks;
use super::observe::event::{Category, Component, EventDraft, Severity};
use super::observe::metrics::Counter;
use super::observe::ObservabilityService;

fn mission_scope(mission_id: &str, project_id: Option<&str>) -> ConfigScope {
    ConfigScope::mission(mission_id, project_id.map(str::to_string))
}

// ——— السياسة المركَّبة.

pub struct PolicyOverlay {
    pub config: Arc<ConfigService>,
}

impl PolicyOverlay {
    /// الحكم نفسه، مفصولًا للاختبار.
    pub fn verdict(&self, descriptor: &ToolDescriptor, scope: &ConfigScope) -> Option<String> {
        let id = descriptor.tool_id.as_str();
        let c = &self.config;
        if id.starts_with("polaris.web.") && !c.bool("privacy.allow_browser_internet", scope) {
            return Some("PRIVACY_BROWSER_INTERNET_OFF".into());
        }
        if id.starts_with("polaris.desktop.") && !c.bool("computer.use_enabled", scope) {
            return Some("COMPUTER_USE_DISABLED".into());
        }
        if id == crate::p05::memory::tool::TOOL_MEMORY_PROPOSE && !c.bool("privacy.persist_memory", scope) {
            return Some("PRIVACY_PERSIST_MEMORY_OFF".into());
        }
        if descriptor.provider == ToolProvider::Mcp && !c.bool("mcp.tools_enabled", scope) {
            return Some("MCP_TOOLS_DISABLED".into());
        }
        if descriptor.risk >= RiskClass::High && !c.bool("skills.allow_high_risk_tools", scope) {
            return Some("HIGH_RISK_TOOLS_DISABLED".into());
        }
        None
    }
}

impl ToolPolicyOverlay for PolicyOverlay {
    fn check(&self, descriptor: &ToolDescriptor, context: &ToolAssessContext<'_>) -> Option<String> {
        self.verdict(descriptor, &mission_scope(context.mission_id, context.project_id))
    }
}

// ——— ميزانية الأدوات من الإعدادات.

/// حدّ نداءات الأدوات للمهمّة الفرعية الواحدة، مشتقًّا من حدّ المهمّة كلها.
pub fn per_task_tool_calls(mission_calls: u32, floor: u32) -> u32 {
    // DEF-39: نصف حدّ المهمّة (كان الربع بسقف 32). حدّ المهمّة كلها يبقى السقف الفعلي فوقه.
    (mission_calls / 2).clamp(floor, 64)
}



pub struct ConfiguredBrokers {
    pub phase04: Arc<Phase04>,
    pub config: Arc<ConfigService>,
}

impl ConfiguredBrokers {
    pub fn budget_for(&self, mission_id: &str, project_id: Option<&str>) -> ToolBudget {
        let scope = mission_scope(mission_id, project_id);
        let base = ToolBudget::conservative();
        let calls = self.config.uint("agents.max_tool_calls_per_mission", &scope).min(200) as u32;
        // Phase-08: جولات الأدوات داخل المهمّة الفرعية الواحدة تحتاج أكثر من أربعة نداءات؛ الحدّ
        // لكل مهمّة فرعية نصف حدّ المهمّة (بحدّ أدنى الحدّ المحافظ وأعلى 64).
        let per_task = per_task_tool_calls(calls, base.max_tool_calls_per_task);
        ToolBudget {
            max_tool_calls: calls,
            // الحدّ لكل مهمّة فرعية لا يتجاوز حدّ المهمّة كلها.
            max_tool_calls_per_task: per_task.min(calls).max(u32::from(calls > 0)),
            max_external_side_effects: self.config.uint("agents.max_external_side_effects_per_mission", &scope).min(6) as u32,
            max_network_tool_calls: self.config.uint("tools.max_network_calls_per_mission", &scope).min(96) as u32,
            max_tool_runtime_ms: self.config.uint("tools.max_runtime_per_mission", &scope).min(3_600_000),
        }
    }
}

impl ToolBrokerFactory for ConfiguredBrokers {
    fn broker_for(&self, mission_id: &str, project_id: Option<String>, cancel: CancelToken) -> Arc<dyn ToolBroker> {
        let budget = self.budget_for(mission_id, project_id.as_deref());
        Arc::new(MissionToolBroker::new(self.phase04.clone(), mission_id, project_id, budget, cancel))
    }
}

// ——— مراقب المهمّة.

pub struct Phase06Observer {
    pub phase05: Option<Arc<Phase05>>,
    pub phase04: Option<Arc<Phase04>>,
    pub connectors: Option<Arc<ConnectorGateway>>,
    pub config: Arc<ConfigService>,
    pub observe: Arc<ObservabilityService>,
    pub db: Arc<Database>,
}

impl Phase06Observer {
    /// يمحو من مخزن المتصفّح عناوين المهمّة وعناوين صفحاتها. الأحداث نفسها تبقى
    /// (كم فعلًا، وبأي نتيجة) لأنها سجل مساءلة لا سجل تصفّح.
    pub fn erase_browser_history(&self, mission_id: &str) -> usize {
        self.db
            .with(|conn| {
                let a = conn.execute("UPDATE browser_actions SET url = NULL, target = 'HISTORY_NOT_KEPT' WHERE mission_id = ?1", [mission_id])?;
                let s = conn.execute("UPDATE browser_sessions SET current_url = NULL, current_title = NULL, current_origin = NULL WHERE mission_id = ?1", [mission_id])?;
                let d = conn.execute("UPDATE browser_downloads SET source_url = 'HISTORY_NOT_KEPT' WHERE mission_id = ?1", [mission_id])?;
                Ok(a + s + d)
            })
            .unwrap_or(0)
    }

    /// يمحو صفوف ملاحظات الشاشة للمهمّة. البصمات وحدها كانت محفوظة، وتُمحى أيضًا.
    pub fn erase_computer_observations(&self, mission_id: &str) -> usize {
        self.db.with(|conn| Ok(conn.execute("DELETE FROM computer_observations WHERE mission_id = ?1", [mission_id])?)).unwrap_or(0)
    }
}

impl MissionObserver for Phase06Observer {
    fn task_finished(&self, note: &TaskOutcomeNote) {
        let scope = mission_scope(&note.mission_id, note.project_id.as_deref());
        if let Some(p05) = &self.phase05 {
            if self.config.bool("privacy.persist_memory", &scope) {
                p05.memory.task_finished(note);
                self.observe.metrics.increment(Counter::MemoryWrites);
            }
        }
    }

    fn mission_finished(&self, note: &MissionOutcomeNote) {
        let scope = mission_scope(&note.mission_id, note.project_id.as_deref());
        if let Some(p05) = &self.phase05 {
            if self.config.bool("privacy.persist_memory", &scope) {
                p05.memory.mission_finished(note);
            }
            let failed = note.state == "FAILED";
            p05.browser.mission_finished(&note.mission_id, note.terminal, failed);
            p05.computer.mission_finished(&note.mission_id, note.terminal, failed);
        }
        if note.terminal {
            if !self.config.bool("privacy.persist_browser_history", &scope) {
                let erased = self.erase_browser_history(&note.mission_id);
                self.observe.emit(
                    EventDraft::new(Component::Browser, Category::Lifecycle, Severity::Info, "privacy.erase_browser_history", "ERASED")
                        .mission(Some(&note.mission_id), None, None)
                        .reason(if erased > 0 { "ROWS_ERASED" } else { "NOTHING_TO_ERASE" }),
                );
            }
            if !self.config.bool("privacy.persist_computer_observations", &scope) {
                self.erase_computer_observations(&note.mission_id);
            }
            self.observe.metrics.increment(Counter::MissionCount);
            match note.state {
                "COMPLETED" => self.observe.metrics.increment(Counter::MissionSuccessCount),
                "FAILED" => self.observe.metrics.increment(Counter::MissionFailedCount),
                _ => {}
            }
            if let Some(connectors) = &self.connectors {
                connectors.forget_mission(&note.mission_id);
            }
            self.observe.emit(EventDraft::new(Component::Mission, Category::Lifecycle, Severity::Info, "mission.finish", note.state).mission(Some(&note.mission_id), None, None));
        }
    }

    /// حدث أمن أو مراقبة من زمن التشغيل (خطة 2026-10-07، ADR-041): حدث مهيكل بلا نصّ حرّ، وتنبيه لما يستحقّه.
    fn security_event(&self, mission_id: &str, event: &crate::p03::security::SecurityEvent) {
        use crate::p06::observe::alerts::{AlertKind, AlertSeverity};
        let (alert, severity) = match event.kind {
            "INJECTION_FLAGGED" => (Some(AlertKind::InjectionDetected), Severity::Warning),
            "HONEYTOKEN_READ" => (Some(AlertKind::HoneytokenRead), Severity::Warning),
            // PHASE-11: قيمة الطُعم في وسائط فعلٍ خارجي (مُنع) أو في ناتج أداة (حُجب) تنبيهُ الطُعم نفسه، وسببه نوع الحدث.
            "CANARY_EXFILTRATION" => (Some(AlertKind::HoneytokenRead), Severity::Error),
            "CANARY_IN_OUTPUT" => (Some(AlertKind::HoneytokenRead), Severity::Warning),
            "TAMPER_DETECTED" => (Some(AlertKind::TamperDetected), Severity::Error),
            "NO_PROGRESS_LOOP" => (Some(AlertKind::NoProgressLoop), Severity::Warning),
            "TURNS_ABOVE_EXPECTED" => (Some(AlertKind::TurnsAboveExpected), Severity::Info),
            "MISSION_OVERTIME" => (Some(AlertKind::MissionOvertime), Severity::Warning),
            _ => (None, Severity::Info),
        };
        self.observe.emit(
            EventDraft::new(Component::Mission, Category::Security, severity, "mission.watch", event.kind)
                .mission(Some(mission_id), event.task_id.as_deref(), None)
                .reason(event.kind),
        );
        if let Some(kind) = alert {
            let level = if severity == Severity::Error { AlertSeverity::Error } else { AlertSeverity::Warning };
            self.observe.raise(kind, level, &format!("mission:{mission_id}"), event.kind);
        }
    }

    fn mission_cancelled(&self, mission_id: &str) {
        if let Some(p05) = &self.phase05 {
            p05.browser.mission_cancelled(mission_id);
            p05.computer.mission_cancelled(mission_id);
        }
        // الموافقات المعلّقة لمهمّة أُلغيت لا تنتظر أحدًا (البند 54).
        let expired = self.phase04.as_ref().map(|p| p.expire_mission_approvals(mission_id)).unwrap_or(0);
        self.observe.emit(
            EventDraft::new(Component::Mission, Category::Lifecycle, Severity::Info, "mission.cancel", "CANCELLED")
                .mission(Some(mission_id), None, None)
                .reason(if expired > 0 { "PENDING_APPROVALS_EXPIRED" } else { "NO_PENDING_APPROVAL" }),
        );
    }
}

// ——— سياق الوكيل.

pub struct Phase06Context {
    pub phase05: Option<Arc<Phase05>>,
    pub connectors: Option<Arc<ConnectorGateway>>,
    pub config: Arc<ConfigService>,
}

impl AgentContextProvider for Phase06Context {
    fn blocks_for(&self, request: &AgentContextRequest<'_>) -> Vec<AgentContextBlock> {
        let mut blocks = Vec::new();
        let scope = mission_scope(request.mission_id, request.project_id);
        if let Some(p05) = &self.phase05 {
            let max_tokens = self.config.uint("memory.context_max_tokens", &scope).min(2_000) as usize;
            if max_tokens > 0 {
                let mut query = MemoryQuery::for_mission(request.mission_id, request.project_id.map(str::to_string));
                query.text = Some(request.task_objective.to_string());
                let budget = MemoryContextBudget { max_tokens, ..MemoryContextBudget::default() };
                let memory = p05.memory.context_block(&query, budget);
                if !memory.text.is_empty() {
                    blocks.push(AgentContextBlock { kind: AgentContextKind::Memory, text: memory.text });
                }
            }
            if let Some(observation) = p05.browser.latest_observation(request.mission_id) {
                blocks.push(AgentContextBlock { kind: AgentContextKind::Observation, text: observation.context_text() });
            }
            if let Some(observation) = p05.computer.latest_observation(request.mission_id) {
                blocks.push(AgentContextBlock { kind: AgentContextKind::Observation, text: observation.context_text() });
            }
        }
        if let Some(text) = self.connectors.as_ref().and_then(|c| c.latest_observation(request.mission_id)) {
            blocks.push(AgentContextBlock { kind: AgentContextKind::Observation, text });
        }
        blocks
    }
}

// ——— استعمال الأدوات.

pub struct ToolUsage {
    pub books: Arc<CostBooks>,
    pub observe: Arc<ObservabilityService>,
}

impl ToolActivityObserver for ToolUsage {
    fn invocation(&self, record: &ToolInvocationRecord) {
        let category = UsageCategory::of_tool(&record.tool_id);
        let component = match category {
            UsageCategory::Browser => Component::Browser,
            UsageCategory::Computer => Component::Computer,
            UsageCategory::Connector => Component::Connector,
            _ => Component::Tool,
        };
        self.observe.metrics.increment(Counter::ToolCalls);
        if record.status.executed() {
            match category {
                UsageCategory::Browser => self.observe.metrics.increment(Counter::BrowserActions),
                UsageCategory::Computer => self.observe.metrics.increment(Counter::ComputerActions),
                _ => {}
            }
            self.observe.metrics.latency(component, record.duration_ms);
            // الموصل يسجّل استعماله بنفسه ومعه عدد طلباته؛ لا يُحسب مرّتين.
            if category != UsageCategory::Connector {
                let usage = UsageRecord {
                    record_id: self.observe.clock().id(),
                    recorded_at: record.started_at.clone(),
                    category,
                    subject_id: record.invocation_id.clone(),
                    mission_id: Some(record.mission_id.clone()),
                    project_id: None,
                    provider_id: None,
                    model_id: None,
                    connector_id: None,
                    tool_id: Some(record.tool_id.clone()),
                    input_tokens: None,
                    output_tokens: None,
                    cached_tokens: None,
                    tokens_provenance: Provenance::Unknown,
                    wall_ms: record.duration_ms,
                    external_requests: 0,
                    // زمن الأداة قياس محلي، لا مال: لا سعر يحوّله (البند 21).
                    cost: Cost::unknown(),
                };
                let _ = self.books.ledger.record(&usage);
            }
        }
        let severity = match record.status {
            InvocationStatus::Succeeded | InvocationStatus::AwaitingApproval => Severity::Info,
            InvocationStatus::Cancelled | InvocationStatus::Denied => Severity::Warning,
            _ => Severity::Error,
        };
        self.observe.emit(
            EventDraft::new(component, Category::Invocation, severity, "tool.invoke", record.status.as_str())
                .mission(Some(&record.mission_id), Some(&record.task_id), Some(&record.agent_id))
                .duration(record.duration_ms)
                .reason(record.denial_reason.as_deref().unwrap_or("NONE")),
        );
    }

    fn approval_requested(&self, _approval_id: &str) {
        self.observe.metrics.increment(Counter::ApprovalRequests);
    }

    fn approval_decided(&self, _approval_id: &str, granted: bool) {
        if !granted {
            self.observe.metrics.increment(Counter::ApprovalDenials);
        }
    }
}

#[cfg(test)]
mod per_task_budget_tests {
    use super::per_task_tool_calls;

    // DEF-39 (قِيس 2026-10-29): بالافتراض 64 كان نصيب المهمّة الفرعية 16 نداءً، فنفدت في تعديل العرض والتعافي.
    #[test]
    fn default_mission_budget_leaves_room_for_edit_and_recovery() {
        assert_eq!(per_task_tool_calls(64, 4), 32);
    }

    #[test]
    fn stays_within_floor_and_ceiling() {
        assert_eq!(per_task_tool_calls(0, 4), 4);
        assert_eq!(per_task_tool_calls(4, 4), 4);
        assert_eq!(per_task_tool_calls(200, 4), 64);
    }
}
