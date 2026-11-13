// وسيط الأدوات لمهمّة واحدة: الجسر بين زمن تشغيل Phase-03 وبوابة Phase-04.
//
// لماذا يوجد هذا الجسر أصلًا: Phase-03 يعرّف المنفذ (`ToolBroker`) ولا يعرف
// بوابةً بعينها، وPhase-04 ينفّذه. الاتجاه مقصود — الطبقة الأقدم لا تستورد الأحدث،
// والأحدث هو من يملأ منفذها. ولا يضيف هذا الملف قرارًا: البوابة تقرّر، وهو يرتّب
// الجلسة ويحفظ الأثر.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use polaris_host_providers::net::CancelToken;

use crate::p03::port::{ToolBroker, ToolBrokerFactory, ToolDecision, ToolRequest, ToolTraits};

use super::budget::{ToolBudget, ToolBudgetLedger};
use super::gateway::{MissionToolSession, ToolInvocationRequest};
use super::service::Phase04;

/// وسيط مهمّة واحدة. يملك جلستها، ولا يعرف مهمّة غيرها.
pub struct MissionToolBroker {
    phase04: Arc<Phase04>,
    session: Mutex<MissionToolSession>,
    executed: AtomicU32,
}

impl MissionToolBroker {
    pub fn new(phase04: Arc<Phase04>, mission_id: &str, project_id: Option<String>, budget: ToolBudget, cancel: CancelToken) -> Self {
        let session = MissionToolSession::new(mission_id, project_id, ToolBudgetLedger::new(budget), cancel);
        Self { phase04, session: Mutex::new(session), executed: AtomicU32::new(0) }
    }
}

impl ToolBroker for MissionToolBroker {
    fn default_skill(&self) -> Option<String> {
        self.phase04.default_skill()
    }

    fn tools_for(&self, skill_id: &str) -> Vec<String> {
        self.phase04.tools_for_skill(skill_id)
    }

    fn invoke(&self, task_id: &str, agent_id: &str, request: &ToolRequest) -> ToolDecision {
        let Ok(mut session) = self.session.lock() else {
            // قفل مسموم لا يُترجم إلى تنفيذ: الفشل هنا رفض، لا «نفّذ على أي حال».
            return ToolDecision {
                invocation_id: String::new(),
                tool_id: request.tool_id.clone(),
                skill_id: request.skill_id.clone(),
                status: "DENIED".into(),
                denial_reason: Some("UNKNOWN_TOOL".into()),
                summary: "the tool session could not be read".into(),
                evidence_recorded: false,
                pending_approval_id: None,
                observation: None,
            };
        };
        let mission_id = session.mission_id.clone();
        let outcome = self.phase04.gateway.invoke(
            &mut session,
            ToolInvocationRequest {
                mission_id,
                task_id: task_id.to_string(),
                agent_id: agent_id.to_string(),
                skill_id: request.skill_id.clone(),
                tool_id: request.tool_id.clone(),
                arguments: request.arguments.clone(),
                reason: request.reason.clone(), require_human: request.require_human,
            },
        );
        drop(session);

        // الأثر يُحفظ دائمًا، ناجحًا كان أو مرفوضًا: سجلٌّ لا يحمل إلا النجاحات
        // يجعل «لم يحدث شيء» و«مُنع شيء» متطابقين.
        self.phase04.persist_invocation(&outcome.record);
        if let Some(pending) = &outcome.pending_approval {
            self.phase04.persist_pending_approval(&pending.approval_id);
        }
        if outcome.record.status.executed() {
            self.executed.fetch_add(1, Ordering::SeqCst);
        }
        // CP-06-7 (PHASE-06، قِيس على خادم MCP حقيقي): ناتج أداة مصدرها غير موثوق (MCP، موصل) كان يصل الوكيل في سطر الملخّص، والملخّص
        // يُعرض على النموذج بلا سياج (`render_result`). لما نُفِّذ منها: الملخّص سطر من المضيف، وكل ما قالته الأداة في الناتج المسيَّج.
        // سجلّ النشاط والدليل كما كانا. الرفض قبل التنفيذ نصّ مضيف، فيبقى ملخّصًا.
        let untrusted = self.phase04.tool_traits(&outcome.record.tool_id).is_some_and(|t| t.untrusted_source);
        let (summary, observation) = if untrusted && outcome.record.status.executed() {
            // الناتج الكامل إن أعطته الأداة، وإلا ملخّصها.
            let said = outcome.observation.clone().unwrap_or_else(|| outcome.record.summary.clone());
            (format!("{} {}: its output is below, as data from an untrusted source.", outcome.record.tool_id, outcome.record.status.as_str()), Some(said))
        } else {
            (outcome.record.summary.clone(), outcome.observation)
        };
        ToolDecision {
            invocation_id: outcome.record.invocation_id.clone(),
            tool_id: outcome.record.tool_id.clone(),
            skill_id: outcome.record.skill_id.clone(),
            status: outcome.record.status.as_str().to_string(),
            denial_reason: outcome.record.denial_reason.clone(),
            summary,
            evidence_recorded: outcome.record.evidence_id.is_some(),
            pending_approval_id: outcome.pending_approval.map(|a| a.approval_id),
            observation,
        }
    }

    fn executed_calls(&self) -> u32 {
        self.executed.load(Ordering::SeqCst)
    }

    fn tool_guide(&self, skill_id: &str) -> Vec<(String, String)> {
        self.phase04.tools_for_skill(skill_id).into_iter().filter_map(|id| self.phase04.tool_guide_entry(&id).map(|d| (id, d))).collect()
    }

    fn tool_schemas(&self, skill_id: &str) -> Vec<(String, serde_json::Value)> {
        self.phase04.tools_for_skill(skill_id).into_iter().filter_map(|id| self.phase04.tool_input_schema(&id).map(|s| (id, s))).collect()
    }

    fn tool_traits(&self, tool_id: &str) -> Option<ToolTraits> {
        self.phase04.tool_traits(tool_id)
    }

    /// ADR-043: المهارات المدمجة التي تُعرض كل أدواتها تحت المهارة الافتراضية. مهارة أداتُها غير معروضة لا تُذكر.
    fn playbooks(&self) -> Vec<crate::p03::port::Playbook> {
        let offered = self.phase04.default_skill().map(|s| self.phase04.tools_for_skill(&s)).unwrap_or_default();
        crate::p04::instruction_skill::builtin()
            .iter()
            .filter(|s| s.available_with(&offered))
            .map(|s| crate::p03::port::Playbook {
                skill_id: s.skill_id.clone(),
                description: s.description.clone(),
                body: s.body.clone(),
                trusted: s.source == crate::p04::skill::SkillSource::BuiltIn,
                required_tools: s.required_tools.clone(),
            })
            .collect()
    }
}

/// مصنع الوسطاء. يُحقن في Phase-03 بوصفه منفذًا، فلا يعرف Phase-03 اسم البوابة.
pub struct Phase04BrokerFactory {
    phase04: Arc<Phase04>,
    budget: ToolBudget,
}

impl Phase04BrokerFactory {
    pub fn new(phase04: Arc<Phase04>) -> Self {
        Self { phase04, budget: ToolBudget::conservative() }
    }

    /// يثبّت ميزانية أدوات صريحة لكل مهمّة يبنيها هذا المصنع.
    pub fn with_budget(mut self, budget: ToolBudget) -> Self {
        self.budget = budget;
        self
    }
}

impl ToolBrokerFactory for Phase04BrokerFactory {
    fn broker_for(&self, mission_id: &str, project_id: Option<String>, cancel: CancelToken) -> Arc<dyn ToolBroker> {
        Arc::new(MissionToolBroker::new(self.phase04.clone(), mission_id, project_id, self.budget, cancel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::AuditLedger;
    use crate::p02::context::SourceService;
    use crate::p02::projects::ProjectService;
    use crate::p03::clock::RuntimeClock;
    use crate::p04::evidence::ToolEvidenceSource;
    use crate::p04::service::Phase04Config;
    use crate::storage::Database;
    use polaris_host_providers::net::HttpClient;

    fn phase04() -> Arc<Phase04> {
        let db = Arc::new(Database::in_memory().expect("an in-memory database"));
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let projects = Arc::new(ProjectService::new(db.clone(), audit.clone()));
        let sources = Arc::new(SourceService::new(db.clone(), projects, audit.clone()));
        Arc::new(
            Phase04::build(Phase04Config {
                db,
                audit,
                clock: RuntimeClock::deterministic(),
                http: Arc::new(HttpClient::new()),
                sources,
                evidence: Arc::new(ToolEvidenceSource::new()),
            })
            .expect("phase-04 builds"),
        )
    }

    fn request(skill: &str, tool: &str) -> ToolRequest {
        ToolRequest {
            skill_id: skill.into(),
            tool_id: tool.into(),
            arguments: serde_json::json!({}),
            reason: "the agent asked".into(),
            expected_effect: vec!["DATABASE_READ".into()],
            expected_output: "a verdict".into(), require_human: false,
        }
    }

    #[test]
    fn a_broker_runs_a_registered_tool_through_the_gateway_and_records_evidence() {
        let phase04 = phase04();
        let broker = MissionToolBroker::new(phase04.clone(), "m1", None, ToolBudget::conservative(), CancelToken::new());
        let decision = broker.invoke("t1", "a1", &request("polaris.skill.evidence-gathering", "polaris.tool.audit.chain.verify"));
        assert_eq!(decision.status, "SUCCEEDED", "{}", decision.summary);
        assert!(decision.evidence_recorded, "a successful tool call recorded no evidence");
        assert_eq!(broker.executed_calls(), 1);
    }

    #[test]
    fn an_agent_cannot_invent_a_tool() {
        let phase04 = phase04();
        let broker = MissionToolBroker::new(phase04, "m1", None, ToolBudget::conservative(), CancelToken::new());
        let decision = broker.invoke("t1", "a1", &request("polaris.skill.evidence-gathering", "polaris.tool.anything.i.want"));
        assert_eq!(decision.status, "DENIED");
        assert_eq!(decision.denial_reason.as_deref(), Some("UNKNOWN_TOOL"));
        assert_eq!(broker.executed_calls(), 0);
    }

    #[test]
    fn a_skill_that_does_not_name_a_tool_cannot_reach_it() {
        let phase04 = phase04();
        let broker = MissionToolBroker::new(phase04, "m1", None, ToolBudget::conservative(), CancelToken::new());
        // الأداة مسجَّلة ومفعّلة، والمهارة مفعّلة، لكنها لا تسمّيها.
        let decision = broker.invoke("t1", "a1", &request("polaris.skill.local-analysis", "polaris.tool.audit.chain.verify"));
        assert_eq!(decision.status, "DENIED");
        assert_eq!(decision.denial_reason.as_deref(), Some("SKILL_DOES_NOT_ALLOW_TOOL"));
    }

    #[test]
    fn a_cancelled_mission_denies_the_next_tool_before_it_runs() {
        let phase04 = phase04();
        let cancel = CancelToken::new();
        let broker = MissionToolBroker::new(phase04, "m1", None, ToolBudget::conservative(), cancel.clone());
        cancel.cancel();
        let decision = broker.invoke("t1", "a1", &request("polaris.skill.evidence-gathering", "polaris.tool.audit.chain.verify"));
        assert_eq!(decision.status, "CANCELLED");
        assert_eq!(broker.executed_calls(), 0);
    }

    #[test]
    fn a_tool_that_changes_state_waits_for_a_human_decision() {
        let phase04 = phase04();
        let broker = MissionToolBroker::new(phase04, "m1", Some("p1".into()), ToolBudget::conservative(), CancelToken::new());
        let mut write = request("polaris.skill.project-note", "polaris.tool.project.note.append");
        write.arguments = serde_json::json!({ "title": "a note", "text": "some text" });
        let decision = broker.invoke("t1", "a1", &write);
        assert_eq!(decision.status, "AWAITING_APPROVAL");
        assert_eq!(decision.denial_reason.as_deref(), Some("APPROVAL_REQUIRED"));
        assert!(decision.pending_approval_id.is_some(), "no approval was raised for a write tool");
        assert!(!decision.evidence_recorded, "a call that never ran recorded evidence");
    }

    #[test]
    fn the_tool_budget_stops_the_run_rather_than_overspending() {
        let phase04 = phase04();
        let budget = ToolBudget { max_tool_calls: 1, ..ToolBudget::conservative() };
        let broker = MissionToolBroker::new(phase04, "m1", None, budget, CancelToken::new());
        let call = request("polaris.skill.evidence-gathering", "polaris.tool.audit.chain.verify");
        assert_eq!(broker.invoke("t1", "a1", &call).status, "SUCCEEDED");
        let second = broker.invoke("t2", "a1", &call);
        assert_eq!(second.status, "DENIED");
        assert_eq!(second.denial_reason.as_deref(), Some("BUDGET_EXHAUSTED"));
    }

    #[test]
    fn a_request_naming_another_mission_is_refused() {
        let phase04 = phase04();
        let broker = MissionToolBroker::new(phase04.clone(), "m1", None, ToolBudget::conservative(), CancelToken::new());
        // الوسيط يملأ معرّف المهمّة من جلسته، فلا يستطيع الطلب أن يسمّي غيرها؛
        // والبوابة تفحص ذلك مرّة أخرى، وهو ما يقيسه هذا الاختبار مباشرةً.
        let mut session =
            MissionToolSession::new("m1", None, ToolBudgetLedger::new(ToolBudget::conservative()), CancelToken::new());
        let outcome = phase04.gateway.invoke(
            &mut session,
            ToolInvocationRequest {
                mission_id: "m2".into(),
                task_id: "t1".into(),
                agent_id: "a1".into(),
                skill_id: "polaris.skill.evidence-gathering".into(),
                tool_id: "polaris.tool.audit.chain.verify".into(),
                arguments: serde_json::json!({}),
                reason: "cross".into(), require_human: false,
            },
        );
        assert_eq!(outcome.record.denial_reason.as_deref(), Some("CROSS_MISSION_DENIED"));
        assert_eq!(broker.executed_calls(), 0);
    }
}
