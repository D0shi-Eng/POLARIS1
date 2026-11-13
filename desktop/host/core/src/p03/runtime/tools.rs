// اقتراحات الأدوات عند البوابة (E1: نُقلت من runtime.rs بلا تغيير سلوك): تمريرها وتسجيل قراراتها ونسبتها إلى خطواتها.

use super::support::*;
use super::*;

impl MissionRuntime {
    /// يمرّر اقتراحات الأدوات إلى الوسيط ويسجّل قراراته.
    ///
    /// ثلاثة أشياء لا تحدث هنا مهما قال النموذج: لا تنفيذ مباشر، ولا ترقية أثر،
    /// ولا تحويل قرار الرفض إلى نجاح. وحين لا وسيط، يُسجَّل الرفض صراحةً بدل أن
    /// يُبتلع الاقتراح صامتًا.
    pub(super) fn run_tool_requests(&mut self, task_id: &str, agent_id: &str, requests: &[ToolRequest]) {
        for request in requests {
            self.tool_proposals += 1;
            if self.is_cancelled() {
                self.cancelled = true;
                return;
            }
            let Some(broker) = self.tools.clone() else {
                self.decision_owners.push(agent_id.to_string());
                self.decision_tasks.push(task_id.to_string());
                self.tool_decisions.push(ToolDecision {
                    invocation_id: self.clock.id(),
                    tool_id: request.tool_id.clone(),
                    skill_id: request.skill_id.clone(),
                    status: "DENIED".into(),
                    denial_reason: Some("UNKNOWN_TOOL".into()),
                    summary: "this host has no tool layer, so no tool exists to call".into(),
                    evidence_recorded: false,
                    pending_approval_id: None,
                    observation: None,
                });
                continue;
            };
            // PHASE-11: ملف الطُعم في أي حقل وبأي كتابة، والطلب لا يذكره: يُرفض هنا لكل المسارات (حلقة الوكيل، والتفويض، ومسار
            // الرسم الذي تعمل به الأتمتة)، فلا يبلغ البوابة ولا يصل محتواه أحدًا.
            if crate::p03::security::arguments_name_honeytoken(&request.arguments) && !crate::p03::security::request_names_honeytoken(&self.mission.objective) {
                self.security("HONEYTOKEN_READ", Some(task_id), format!("{} named {}, which the request does not name: refused", request.tool_id, crate::p03::security::HONEYTOKEN_PATH));
                *self.denial_counts.entry(format!("{}:SECRET_REQUESTED", request.tool_id)).or_insert(0) += 1;
                self.decision_owners.push(agent_id.to_string());
                self.decision_tasks.push(task_id.to_string());
                self.tool_decisions.push(ToolDecision {
                    invocation_id: self.clock.id(),
                    tool_id: request.tool_id.clone(),
                    skill_id: request.skill_id.clone(),
                    status: "DENIED".into(),
                    denial_reason: Some("SECRET_REQUESTED".into()),
                    summary: "that file holds credentials the request did not ask for; it is not read".into(),
                    evidence_recorded: false,
                    pending_approval_id: None,
                    observation: None,
                });
                continue;
            }
            // المهارة الغائبة تُملأ من السجل لا تُخترع: اسم مهارة من النموذج يبقى
            // اقتراحًا يُتحقَّق منه عند البوابة.
            let mut request = request.clone();
            if request.skill_id.trim().is_empty() {
                if let Some(default) = broker.default_skill() {
                    request.skill_id = default;
                }
            }
            let started_at = self.clock.now();
            let started = std::time::Instant::now();
            let mut decision = broker.invoke(task_id, agent_id, &request);
            // PHASE-11 (احتواء): قيمة الكناري لا تبلغ النموذج من أي ناتج، ولو قُرئت بطريق لا يسمّي الملف (كود يمرّ على المجلّد).
            let redacted = decision.observation.as_deref().and_then(crate::p03::security::redact_canary);
            let redacted_summary = crate::p03::security::redact_canary(&decision.summary);
            if redacted.is_some() || redacted_summary.is_some() {
                self.security("CANARY_IN_OUTPUT", Some(task_id), format!("{} returned the decoy credential value; it was redacted before the model saw it", request.tool_id));
                if let Some(text) = redacted {
                    decision.observation = Some(text);
                }
                if let Some(text) = redacted_summary {
                    decision.summary = text;
                }
            }
            // امتداد `execute_tool` بقرار البوابة وزمنه (ADR-041).
            self.record_tool_span(agent_id, task_id, &decision, &started_at, started.elapsed().as_millis() as u64);
            if decision.status == "AWAITING_APPROVAL" && !self.awaiting_approval.iter().any(|id| id == task_id) {
                self.awaiting_approval.push(task_id.to_string());
            }
            // سطر الفعل: معرّف الأداة وحججها المختصرة، والحالة كما قرّرتها البوابة (مقيسة).
            let status = match &decision.denial_reason {
                Some(reason) => format!("{} {reason}", decision.status),
                None => decision.status.clone(),
            };
            self.narrate(NarrationKind::Action, &format!("{} {}", request.tool_id, action_preview(&request.arguments)), Some(status));
            self.decision_owners.push(agent_id.to_string());
            self.decision_tasks.push(task_id.to_string());
            self.tool_decisions.push(decision);
        }
    }

    /// قرارات الأدوات في هذه الخطوة عبر كل محاولاتها ووكلائها (ومنهم الزميل المفوَّض)، بترتيبها.
    pub(super) fn node_decisions(&self, task_id: &str) -> Vec<ToolDecision> {
        let owners: std::collections::HashSet<&str> = self.agents.iter().filter(|a| a.current_task_id.as_deref() == Some(task_id)).map(|a| a.agent_id.as_str()).collect();
        self.tool_decisions.iter().zip(&self.decision_owners).filter(|(_, owner)| owners.contains(owner.as_str())).map(|(d, _)| d.clone()).collect()
    }

    /// قرارات الأدوات التي طلبها هذا الوكيل منذ الموضع `from`.
    pub(super) fn decisions_of(&self, agent_id: &str, from: usize) -> Vec<ToolDecision> {
        self.tool_decisions[from..].iter().zip(&self.decision_owners[from..]).filter(|(_, owner)| owner.as_str() == agent_id).map(|(d, _)| d.clone()).collect()
    }
}
