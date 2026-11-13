// المراجعة (E1: نُقلت من runtime.rs بلا تغيير سلوك): حكم مهيكل، وجولة تعديل محدودة تحمل ملاحظات المراجِع.

use super::*;

impl MissionRuntime {
    /// مراجعة: حكم مهيكل لا نثر حرّ. التعديل محدود بجولات المراجعة (البند 59/60).
    pub(super) fn run_review(&mut self, task_id: &str, node: &TaskNode, role: AgentRole, model: &dyn AgentModel) -> Result<(), StopReason> {
        // المراجِع يرى ما يراجعه (Phase-08): هدف عقدته، وتقرير كل مهمّة تعتمد عليها (ملخّص وكيلها غير
        // المحقَّق، وحقائق أدواتها المقيسة)، والملفات الموجودة. بلا ذلك يحكم على معرّف لا على عمل.
        if self.recovery {
            let work: Vec<String> = node.dependencies.iter().filter_map(|d| self.task_reports.get(&d.task_id)).map(TaskReport::render).take(8).collect();
            let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
            model.note_review_input(task_id, &ReviewInput { objective: node.objective.clone(), work, files: files.into_iter().take(60).collect() });
        }
        // ردّ مراجعة مشوّه يُصلَح مرة واحدة كردّ التنفيذ (Phase-08). قِيس 2026-10-02 بالنموذج الحقيقي: المراجِع
        // فكّر نحو خمس دقائق ثم أعاد نصًّا بلا JSON، فحُجبت مهمّة كان مستندها قد كُتب وتُحقّق منه.
        let repair = if self.recovery { Some((model, task_id)) } else { None };
        let result = self.guarded_call(repair, || model.review(role, task_id))?;
        self.budget
            .settle_model_call(result.input_tokens, result.output_tokens)
            .map_err(StopReason::BudgetExhausted)?;
        // نموذج واحد يراجع نفسه ليس مراجعة مستقلّة، ويُسجَّل كما هو (البند 150). مراجِع على نموذج آخر (E6) يُسجَّل مستقلًّا.
        let independent = model.reviews_independently();
        self.review_independence = if independent { ReviewIndependence::IndependentModelReview } else { ReviewIndependence::SameModelReview };
        let round = self.reviews.iter().filter(|r| r.task_id == task_id).count() as u32 + 1;
        self.reviews.push(ReviewRecord {
            review_id: self.clock.id(),
            task_id: task_id.to_string(),
            reviewer_agent: self.graph.get(task_id).and_then(|n| n.assigned_agent_id.clone()).unwrap_or_else(|| role.as_str().to_string()),
            verdict: match result.verdict {
                ReviewVerdict::Accept => "ACCEPT",
                ReviewVerdict::Revise => "REVISE",
                ReviewVerdict::Reject => "REJECT",
                ReviewVerdict::Blocked => "BLOCKED",
            },
            independence: if independent { "INDEPENDENT_MODEL_REVIEW" } else { "SAME_MODEL_REVIEW" },
            round,
            notes: result.notes.chars().take(4000).collect(),
            created_at: self.clock.now(),
        });

        match result.verdict {
            ReviewVerdict::Accept => {
                let _ = self.graph.set_state(task_id, TaskState::Succeeded);
            }
            ReviewVerdict::Revise => {
                // جولة مراجعة تُحجز أولًا؛ استنفادها يحجب بدل أن يستمر بصمت.
                if self.budget.reserve_review_round().is_err() {
                    let _ = self.graph.set_state(task_id, TaskState::Blocked);
                    return Ok(());
                }
                let producers: Vec<String> = node
                    .dependencies
                    .iter()
                    .filter(|d| d.kind == DependencyKind::RequiresSuccess)
                    .map(|d| d.task_id.clone())
                    .collect();
                let mut revised = false;
                for producer in producers {
                    let attempts = self.graph.get(&producer).map(|t| (t.attempt, t.max_attempts));
                    if let Some((attempt, max)) = attempts {
                        if attempt + 1 < max {
                            let _ = self.graph.bump_attempt(&producer);
                            let _ = self.graph.set_state(&producer, TaskState::Pending);
                            revised = true;
                            // حلقة المقيِّم والمحسِّن (Phase-08): ملاحظات المراجِع تصل محاولة المنتِج التالية، رسالةً
                            // على الناقل ورسالةَ وكيل في موجّهه. قبلها كانت المحاولة تُعاد بلا سبب تعرفه فتكرّر نفسها.
                            if self.recovery && !result.notes.trim().is_empty() {
                                if let Some(target) = self.graph.get(&producer).cloned() {
                                    model.note_review_feedback(&target.objective, &result.notes);
                                    let reviewer = self.graph.get(task_id).and_then(|n| n.assigned_agent_id.clone()).unwrap_or_default();
                                    if let Some(recipient) = target.assigned_agent_id.clone() {
                                        let known: Vec<String> = self.agents.iter().map(|a| a.agent_id.clone()).collect();
                                        let message = self.agent_message(&reviewer, Recipient::Agent(recipient), MessageType::ReviewResult, &result.notes);
                                        let _ = self.bus.publish(message, &known);
                                    }
                                }
                            }
                        }
                    }
                }
                let next = if revised { TaskState::Pending } else { TaskState::Blocked };
                let _ = self.graph.set_state(task_id, next);
            }
            ReviewVerdict::Reject => {
                let _ = self.graph.set_state(task_id, TaskState::Failed);
            }
            ReviewVerdict::Blocked => {
                let _ = self.graph.set_state(task_id, TaskState::Blocked);
            }
        }
        Ok(())
    }
}
