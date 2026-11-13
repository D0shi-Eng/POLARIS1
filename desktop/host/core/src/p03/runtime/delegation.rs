// التفويض (E1: نُقل من runtime.rs بلا تغيير سلوك): الوكيل يطلب، والمنسّق يقرّر بحدود العمق والميزانية، والزميل يعود بخلاصته.

use super::support::*;
use super::*;

impl MissionRuntime {
    /// مسار التفويض الكامل داخل المهمّة.
    ///
    /// الوكيل A يطلب، والمُنسِّق يقرّر بحدّ العمق والميزانية، ثم ينشئ الوكيل B
    /// بهويّة يصدرها وقت التشغيل ووالدٍ مُعلن، وينفّذ، ثم تعود النتيجة رسالةً على
    /// الناقل الحقيقي. ولا يمنح التفويض سلطةً: الوكيل B بلا صلاحية إضافية.
    pub(super) fn run_delegation(
        &mut self,
        task_id: &str,
        requesting_agent_id: &str,
        task_type: TaskType,
        requester_objective: &str,
        draft: &crate::p03::port::DelegationRequestDraft,
        model: &dyn AgentModel,
    ) -> Result<(), StopReason> {
        self.delegations_requested += 1;
        if self.is_cancelled() {
            self.cancelled = true;
            return Ok(());
        }
        if self.budget.reserve_delegation().is_err() {
            self.policy_violations.push("DELEGATION_BUDGET_EXHAUSTED".into());
            return Ok(());
        }
        let depth = self
            .agents
            .iter()
            .find(|a| a.agent_id == requesting_agent_id)
            .map(|a| a.delegation_depth)
            .unwrap_or(0);
        let mut controller = DelegationController::new(self.mission.budget.max_delegation_depth);
        let request = DelegationRequest {
            request_id: self.clock.id(),
            mission_id: self.mission.mission_id.clone(),
            requesting_agent_id: requesting_agent_id.to_string(),
            requesting_agent_depth: depth,
            requested_role: draft.requested_role,
            objective: draft.objective.clone(),
            reason: draft.reason.clone(),
            required_capabilities: Vec::new(),
            expected_output: draft.expected_output.clone(),
        };
        let decision = controller.evaluate(&request, &self.registry);
        if !matches!(decision, DelegationDecision::Approved { .. }) {
            self.policy_violations.push(format!("DELEGATION_REFUSED_{}", delegation_code(&decision)));
            return Ok(());
        }

        // الوكيل B: هويّة جديدة، ووالد مُعلن، وعمق أكبر بواحد.
        if self.budget.reserve_agent().is_err() || self.budget.acquire_active_agent().is_err() {
            self.policy_violations.push("DELEGATION_AGENT_BUDGET_EXHAUSTED".into());
            return Ok(());
        }
        let delegate_id = self.clock.id();
        let now = self.clock.now();
        let mut delegate = AgentInstance::new(&delegate_id, &self.mission.mission_id, draft.requested_role, now);
        delegate.parent_agent_id = Some(requesting_agent_id.to_string());
        delegate.delegation_depth = depth + 1;
        delegate.current_task_id = Some(task_id.to_string());
        delegate.state = AgentState::Working;
        self.agents.push(delegate);

        let known: Vec<String> = self.agents.iter().map(|a| a.agent_id.clone()).collect();
        let outbound = self.agent_message(
            requesting_agent_id,
            Recipient::Coordinator,
            MessageType::DelegationRequest,
            &draft.objective,
        );
        let _ = self.bus.publish(outbound, &known);

        // النداء الفعلي للوكيل الثاني. ميزانيته هي ميزانية المهمّة نفسها.
        let result = if self.recovery {
            // Phase-08: زميل حقيقي — سياقه الخاص (هدفه، وما يعمل عليه طالبه، والمتبقّي، والملفات)، ونداء محروس،
            // وجولات أدوات محدودة يرى فيها نتائج ما طلب، ثم تعود نتيجته إلى طالبه.
            let sections = TaskContextSections {
                remaining_requirements: self.unmet_now().iter().map(|c| format!("{} ({})", c.description, c.detail)).collect(),
                previous_results: vec![format!("You were asked for help by the agent working on: {}\nWhat it needs back: {}\n", requester_objective, draft.expected_output)],
                available_files: self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default().into_iter().take(60).collect(),
                plan_outline: Vec::new(),
                done_actions: self.done_actions(),
            };
            // الزميل يعمل بسياق نظيف خاصّ به ويعود بخلاصة: لا يدخل سجلّ محادثة المهمّة (خطة 2026-10-06).
            model.note_delegate(&draft.objective);
            model.note_task_context(&draft.objective, &sections);
            let delegate_role = draft.requested_role;
            let objective = draft.objective.clone();
            let outcome = self.guarded_call(Some((model, objective.as_str())), || model.execute(delegate_role, task_type, &objective));
            let mut execution = match outcome {
                Ok(execution) => execution,
                Err(StopReason::ModelOutputInvalid(_)) => {
                    self.budget.release_active_agent();
                    self.policy_violations.push("DELEGATION_EXECUTION_FAILED".into());
                    return Ok(());
                }
                Err(stop) => {
                    self.budget.release_active_agent();
                    return Err(stop);
                }
            };
            let _ = self.budget.settle_model_call(execution.input_tokens, execution.output_tokens);
            let start = self.tool_decisions.len();
            // أدوات الوكيل الثاني تمرّ بالبوابة نفسها: التفويض لا يفتح مسارًا ثانيًا.
            self.run_tool_requests(task_id, &delegate_id, &execution.tool_requests);
            let rounds = self.delegate_rounds(task_id, &delegate_id, delegate_role, task_type, &objective, model, &mut execution, start);
            self.budget.release_active_agent();
            rounds?;
            execution
        } else {
            if self.budget.reserve_model_call().is_err() {
                self.budget.release_active_agent();
                self.policy_violations.push("DELEGATION_MODEL_BUDGET_EXHAUSTED".into());
                return Ok(());
            }
            model.note_delegate(&draft.objective);
            let outcome = model.execute(draft.requested_role, task_type, &draft.objective);
            self.budget.release_active_agent();
            let Ok(result) = outcome else {
                self.budget.abandon_model_call();
                self.policy_violations.push("DELEGATION_EXECUTION_FAILED".into());
                return Ok(());
            };
            let _ = self.budget.settle_model_call(result.input_tokens, result.output_tokens);
            // أدوات الوكيل الثاني تمرّ بالبوابة نفسها: التفويض لا يفتح مسارًا ثانيًا.
            self.run_tool_requests(task_id, &delegate_id, &result.tool_requests);
            result
        };

        // النتيجة تعود رسالةً إلى الوكيل الطالب، على الناقل الحقيقي.
        let known: Vec<String> = self.agents.iter().map(|a| a.agent_id.clone()).collect();
        let inbound = self.agent_message(
            &delegate_id,
            Recipient::Agent(requesting_agent_id.to_string()),
            MessageType::DelegationResult,
            &result.output_summary,
        );
        let _ = self.bus.publish(inbound, &known);
        // Phase-08: النتيجة تصل طالبها فعلًا — رسالةَ وكيل في نداءاته التالية، وجولة متابعة يقرؤها فيها.
        if self.recovery {
            let summary = if result.output_summary.trim().is_empty() { "(the colleague returned no summary)".to_string() } else { result.output_summary.clone() };
            model.note_agent_message(
                requester_objective,
                &format!("RESULT FROM THE {} COLLEAGUE YOU ASKED FOR (agent output, unverified; files it names exist only if AVAILABLE FILES lists them)\nIts task: {}\n{}", draft.requested_role.as_str(), draft.objective, summary),
            );
            self.delegated_results.insert(task_id.to_string());
        }

        // ادّعاءات الوكيل الثاني تُسجَّل باسمه، مُلوَّثة وغير محقَّقة كغيرها.
        for proposal in &result.claims {
            let claim_id = self.clock.id();
            let mut taint = Taint::with(TaintFlag::ModelGenerated);
            taint.add(TaintFlag::AgentRelayed);
            taint.add(TaintFlag::UnverifiedClaim);
            let mut claim = Claim::from_agent(
                claim_id,
                &self.mission.mission_id,
                &delegate_id,
                &proposal.statement,
                proposal.claim_type,
                taint,
                self.clock.now(),
            );
            claim.task_id = Some(task_id.to_string());
            claim.subject = proposal.subject.clone();
            self.record_claim(claim);
        }
        let completed_at = self.clock.now();
        if let Some(agent) = self.agents.iter_mut().find(|a| a.agent_id == delegate_id) {
            agent.state = AgentState::Completed;
            agent.last_active_at = completed_at;
        }
        self.delegations_executed += 1;
        Ok(())
    }

    /// جولات أدوات الزميل المفوَّض (Phase-08): يرى نتائج ما طلب ويتابع، حتى يُنهي أو تنفد جولاته. ردّ مشوّه
    /// يُنهي التفويض وحده (يُسجَّل مخالفةً)، ولا يُفشل مهمّة طالبه.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn delegate_rounds(
        &mut self,
        task_id: &str,
        delegate_id: &str,
        role: AgentRole,
        task_type: TaskType,
        objective: &str,
        model: &dyn AgentModel,
        execution: &mut TaskExecution,
        first_round_start: usize,
    ) -> Result<(), StopReason> {
        let mut turns: Vec<ToolTurn> = Vec::new();
        let mut round_start = first_round_start;
        let mut requests = execution.tool_requests.clone();
        for _ in 0..MAX_DELEGATE_ROUNDS {
            if self.is_cancelled() || self.awaiting_approval.iter().any(|id| id == task_id) {
                break;
            }
            let fresh = self.decisions_of(delegate_id, round_start);
            if fresh.is_empty() || !model.wants_tool_results(objective) {
                break;
            }
            for (i, decision) in fresh.iter().enumerate() {
                turns.push(ToolTurn {
                    tool_id: decision.tool_id.clone(),
                    arguments_preview: requests.get(i).map(|r| bounded_preview(&r.arguments.to_string(), 600)).unwrap_or_default(),
                    status: decision.status.clone(),
                    denial_reason: decision.denial_reason.clone(),
                    summary: decision.summary.clone(),
                    observation: decision.observation.clone(),
                });
            }
            let next = match self.guarded_call(Some((model, objective)), || model.continue_execution(role, task_type, objective, &turns)) {
                Ok(next) => next,
                Err(StopReason::ModelOutputInvalid(_)) => {
                    self.policy_violations.push("DELEGATION_OUTPUT_INVALID".into());
                    break;
                }
                Err(stop) => return Err(stop),
            };
            let _ = self.budget.settle_model_call(next.input_tokens, next.output_tokens);
            let later = next.output_summary.trim();
            if !later.is_empty() && !execution.output_summary.contains(later) {
                execution.output_summary = format!("{}\n{}", execution.output_summary.trim(), later).trim().to_string();
            }
            execution.claims.extend(next.claims.iter().cloned());
            round_start = self.tool_decisions.len();
            if next.tool_requests.is_empty() || next.tool_requests == requests {
                break;
            }
            requests = next.tool_requests.clone();
            self.run_tool_requests(task_id, delegate_id, &next.tool_requests);
        }
        Ok(())
    }

    /// رسالة وكيل واحدة. سلطتها `AGENT_MESSAGE` دائمًا، ولا ترتفع.
    pub(super) fn agent_message(&self, sender: &str, recipient: Recipient, message_type: MessageType, payload: &str) -> AgentMessage {
        AgentMessage {
            message_id: self.clock.id(),
            mission_id: self.mission.mission_id.clone(),
            sender_agent_id: sender.to_string(),
            recipient,
            message_type,
            created_at: self.clock.now(),
            causation_id: None,
            correlation_id: None,
            payload: payload.chars().take(2000).collect(),
            taint: Taint::with(TaintFlag::ModelGenerated),
            authority: AuthorityClass::AgentMessage,
        }
    }
}
