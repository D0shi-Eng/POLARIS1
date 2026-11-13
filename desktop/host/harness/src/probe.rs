// سائق الفحوص المباشرة: العُدّة تؤدّي دور زمن التشغيل الموثوق (لا دور النموذج) فتقدّم طلب أداة
// إلى بوابة الأدوات الحقيقية نفسها التي يمرّ بها الوكيل: المخطط، ونقطة قرار السياسة، والقدرة،
// والميزانية، والموافقة المربوطة بالحجج، ثم المحوّل فالخدمة فالصندوق. الموافقة لا تمنحها العُدّة
// لنفسها داخل البوابة: تُحفظ معلّقة، ويُجاب عنها عبر عملية IPC البشرية `tool.approval.respond`.

use polaris_host_core::p04::activity::InvocationStatus;
use polaris_host_core::p04::budget::{ToolBudget, ToolBudgetLedger};
use polaris_host_core::p04::{MissionToolSession, ToolInvocationRequest};
use polaris_host_providers::net::cancel::CancelToken;
use serde_json::{json, Value};

use crate::platform::Harness;

pub const SKILL: &str = "polaris.skill.agentic-work";
// معرّف وكيل بصيغة UUID كما يحمله الوكيل الحقيقي؛ العقود تشترطها.
const AGENT: &str = "5f0c2b9e-8d41-4c7a-9e2f-3b6a1d0c8e71";

/// ما عاد من البوابة لنداء واحد، بصيغة يُحكم عليها.
#[derive(Debug, Clone)]
pub struct Call {
    pub status: &'static str,
    pub denial: Option<String>,
    pub summary: String,
    pub observation: String,
    pub approval_id: Option<String>,
}

impl Call {
    pub fn ok(&self) -> bool {
        self.status == "SUCCEEDED"
    }
    pub fn view(&self) -> Value {
        json!({ "status": self.status, "denial": self.denial, "summary": self.summary, "observation_excerpt": self.observation.chars().take(600).collect::<String>() })
    }
}

pub struct Probe<'a> {
    pub harness: &'a Harness,
    pub mission_id: String,
    session: MissionToolSession,
    task: usize,
}

fn wide_budget() -> ToolBudget {
    ToolBudget { max_tool_calls: 400, max_tool_calls_per_task: 400, max_external_side_effects: 64, max_network_tool_calls: 200, max_tool_runtime_ms: 3_600_000 }
}

impl<'a> Probe<'a> {
    /// مهمّة حقيقية تُنشأ عبر IPC، وجلسة أدوات لها بإلغاء خاصّ.
    pub fn new(harness: &'a Harness, title: &str) -> Self {
        let mission_id = harness
            .call("mission.create", json!({ "title": title, "objective": format!("Phase-08 native probe: {title}") }))
            .ok()
            .and_then(|v| v["mission_id"].as_str().map(String::from))
            .unwrap_or_default();
        let session = MissionToolSession::new(mission_id.clone(), None, ToolBudgetLedger::new(wide_budget()), CancelToken::new());
        Self { harness, mission_id, session, task: 0 }
    }


    fn phase04(&self) -> &std::sync::Arc<polaris_host_core::p04::Phase04> {
        self.harness.host().phase04().expect("Phase-04 is part of every host build")
    }

    /// نداء واحد عبر البوابة.
    pub fn invoke(&mut self, tool_id: &str, arguments: Value) -> Call {
        self.task += 1;
        let request = ToolInvocationRequest {
            mission_id: self.mission_id.clone(),
            // معرّف المهمّة الفرعية UUID ثابت لكل رقم، كما يحمله زمن التشغيل.
            task_id: format!("00000000-0000-4000-8000-{:012}", self.task),
            agent_id: AGENT.into(),
            skill_id: SKILL.into(),
            tool_id: tool_id.into(),
            arguments,
            reason: "native measurement".into(), require_human: false,
        };
        let p04 = self.phase04().clone();
        let outcome = p04.gateway.invoke(&mut self.session, request);
        p04.persist_invocation(&outcome.record);
        if let Some(pending) = &outcome.pending_approval {
            p04.persist_pending_approval(&pending.approval_id);
        }
        let record = &outcome.record;
        Call {
            status: record.status.as_str(),
            denial: record.denial_reason.clone(),
            summary: record.summary.clone(),
            observation: outcome.observation.clone().unwrap_or_default(),
            approval_id: outcome.pending_approval.as_ref().map(|p| p.approval_id.clone()),
        }
    }

    /// نداء يحتاج موافقة: أول مرّة يعلّق، ثم يُجاب عنه عبر IPC البشري، ثم يُعاد النداء نفسه
    /// بالحجج نفسها (الموافقة مربوطة بخلاصتها). يعيد النداءين.
    pub fn invoke_with_decision(&mut self, tool_id: &str, arguments: Value, grant: bool) -> (Call, Option<Call>) {
        let first = self.invoke_same_task(tool_id, arguments.clone(), None);
        let Some(approval_id) = first.approval_id.clone() else { return (first, None) };
        let decision = if grant { "GRANT" } else { "DENY" };
        let _ = self.harness.call("tool.approval.respond", json!({ "approval_id": approval_id, "decision": decision }));
        let second = self.invoke_same_task(tool_id, arguments, Some(self.task));
        (first, Some(second))
    }

    fn invoke_same_task(&mut self, tool_id: &str, arguments: Value, task: Option<usize>) -> Call {
        // الموافقة مربوطة بالمهمّة الفرعية كذلك: الإعادة تحمل معرّف المهمّة الفرعية نفسه.
        if let Some(t) = task {
            self.task = t - 1;
        }
        self.invoke(tool_id, arguments)
    }

    pub fn awaiting(&self, call: &Call) -> bool {
        call.status == InvocationStatus::AwaitingApproval.as_str()
    }

    /// إنهاء المهمّة: إلغاؤها عبر IPC يحرّر هوية العزل ويغلق المتصفّح.
    pub fn finish(&self) {
        let _ = self.harness.call("mission.cancel", json!({ "mission_id": self.mission_id }));
        if let Some(p08) = self.harness.host().phase08() {
            p08.execution.release(&self.mission_id);
            p08.browser.close_mission(&self.mission_id, "CLOSED", "PROBE_FINISHED");
        }
    }
}
