// منفّذ الخطوة (خطة 2026-10-05، E1: نُقل من runtime.rs بلا تغيير سلوك): تنفيذ عقدة واحدة، وإعادتها بسببها، وجولات
// أدواتها، وتسجيل أدلّة وكيلها.

use super::support::*;
use super::*;

impl MissionRuntime {
    /// تنفيذ عادي: نتيجة مهيكلة، ثم ادّعاءات وأدلّة مُلوَّثة، ثم تحقّق. يبدأ بنداء أول جرى سلفًا إن وُجد (E4: نداءات أولى متوازية لخطوات مستقلّة). نداء أول فشل يُعاد هنا بالمسار
    /// المنفرد كاملًا، فلا فرق في الإصلاح ولا في الإعادة العابرة.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn run_execution_from(
        &mut self,
        task_id: &str,
        agent_id: &str,
        role: AgentRole,
        task_type: TaskType,
        objective: &str,
        model: &dyn AgentModel,
        first: Option<TaskExecution>,
    ) -> Result<(), StopReason> {
        let decisions_before = self.tool_decisions.len();
        // ردّ مشوّه يُصلَح مرة واحدة: المنفذ يرى الخطأ، ونداء جديد يُحجز من الميزانية نفسها.
        let mut execution = match first {
            Some(done) => done,
            None => match self.guarded_call(Some((model, objective)), || model.execute(role, task_type, objective)) {
                Ok(e) => e,
                Err(StopReason::ModelOutputInvalid(detail)) => return self.malformed_task(task_id, detail, model),
                Err(stop) => return Err(stop),
            },
        };
        self.budget
            .settle_model_call(execution.input_tokens, execution.output_tokens)
            .map_err(StopReason::BudgetExhausted)?;
        self.narrate_from(model, objective, NarrationKind::Note);

        // الأدلّة أولًا حتى تُشير إليها الادّعاءات.
        //
        // الحدّ الحاسم هنا: ما يعيده النموذج هو مخرجات وكيل، مهما سمّاه هو. وكيل
        // يعيد `evidence_type: TEST_RESULT` لا يصنع أثر اختبار؛ لو صُدِّق تصنيفه
        // لحقّق ادّعاءاته بنفسه، وهذا بالضبط ما تمنعه طبقة الحقيقة (البند 42/49).
        let mut evidence_ids: Vec<String> = self.record_agent_evidence(agent_id, &execution.evidence);

        // الأدوات تُنفَّذ قبل جمع الأدلّة المقيسة: دليل الأداة يدخل من المصدر الموثوق
        // نفسه، فلا بدّ أن يكون قد سُجِّل قبل أن يُسأل عنه.
        self.run_tool_requests(task_id, agent_id, &execution.tool_requests);

        // التفويض: الوكيل يطلب، والمُنسِّق يقرّر ثم ينفّذ بوكيل ثانٍ.
        if let Some(draft) = execution.delegation.clone() {
            self.run_delegation(task_id, agent_id, task_type, objective, &draft, model)?;
        }

        // Phase-08: جولات الأدوات. الوكيل يرى نتائج ما اقترحه ويتابع، حتى يُنهي بقائمة أدوات
        // فارغة أو تنتهي الجولات أو الميزانية أو ينتظر موافقة. منفذ لا يعلن المتابعة لا يدخلها.
        self.continue_with_tools(task_id, agent_id, role, task_type, objective, model, &mut execution, &mut evidence_ids, decisions_before)?;
        if self.graph.get(task_id).is_some_and(|n| n.state == TaskState::Pending) {
            // ردّ مشوّه أعاد العقدة إلى محاولة جديدة: لا تُسجَّل نتيجة لهذه المحاولة.
            return Ok(());
        }

        // الأدلّة المقيسة تدخل من منفذها الموثوق وحده، لا من مخرجات النموذج.
        let trusted = self.collect_trusted_evidence(task_id, task_type);
        evidence_ids.extend(trusted.supports.iter().cloned());

        for proposal in &execution.claims {
            let claim_id = self.clock.id();
            let mut taint = Taint::with(TaintFlag::ModelGenerated);
            taint.add(TaintFlag::UnverifiedClaim);
            let mut claim = Claim::from_agent(
                claim_id,
                &self.mission.mission_id,
                agent_id,
                &proposal.statement,
                proposal.claim_type,
                taint,
                self.clock.now(),
            );
            claim.task_id = Some(task_id.to_string());
            claim.subject = proposal.subject.clone();
            claim.evidence_refs = evidence_ids.clone();
            // الملاحظة تؤيّد الادّعاء المهيكل الذي تظهر قيمته فيها وحده. ادّعاء بلا
            // قيمة مهيكلة لا يُربط بملاحظة: لا شيء يُقارَن.
            if let Some(subject) = claim.subject.clone() {
                for (evidence_id, text) in &trusted.observed {
                    if observation_shows(text, &subject.value) {
                        claim.evidence_refs.push(evidence_id.clone());
                        // ظهور القيمة حرفيًّا في ملاحظة مقيسة فحصُ كود (خطة 2026-10-07، ADR-041 §3.3): يُسجَّل حكم مصحِّح يخصّ هذا
                        // الادّعاء وحده، فيتحقّق به الادّعاء الدلالي المهيكل. ادّعاء لم تظهر قيمته لا يناله شيء.
                        let grade = self.observed_value_grade(evidence_id, &subject.value);
                        claim.evidence_refs.push(grade);
                    }
                }
            }
            // الدليل المقيس المضادّ يُربط مناقضًا، فيدحض أو يعارض بدل أن يُحسب تأييدًا.
            claim.counterevidence_refs = trusted.counters.clone();
            self.record_claim(claim);
        }

        self.verify_new_claims();

        // عقدة تنتظر قرارًا بشريًّا لا تُعلَن ناجحة: الانتظار حالة ثالثة، ووسمها
        // نجاحًا يجعل أثرًا لم يقع يبدو واقعًا.
        if !execution.output_summary.trim().is_empty() {
            self.task_outputs.insert(task_id.to_string(), execution.output_summary.clone());
        }
        let state = if self.is_cancelled() {
            // بعد إلغاء مقبول لا تُسجَّل نتيجة عادية لاحقة فشلًا ولا نجاحًا.
            TaskState::Cancelled
        } else if execution.failed {
            // E3: فشل أعلنه الوكيل يُعاد مرة بسببه المقيس إن سمحت المحاولات والميزانية؛ وإلا فشلٌ كما كان.
            let reason = attempt_failure_reason("the agent reported that the step failed", &execution.output_summary, &self.tool_decisions[decisions_before..]);
            if self.retry_failed_task(task_id, &reason, model) {
                return Ok(());
            }
            TaskState::Failed
        } else if self.awaiting_approval.iter().any(|id| id == task_id) {
            TaskState::Waiting
        } else if let Some(note) = if self.recovery { refused_write(&self.node_decisions(task_id)) } else { None } {
            // آخر كتابة في الخطوة عبر كل محاولاتها (E3): محاولة ثانية لا تكتب شيئًا لا تمحو رفض كتابة الأولى.
            // ادّعاء الوكيل «كتبتُ» لا يغلب قرار البوابة: آخر كتابة في العقدة رُفضت أو فشلت، فالعقدة فاشلة
            // بسببها المقيس (قِيس 2026-10-05: MISSION-A أُعلنت كتابته ناجحة والبوابة رفضتها).
            let reason = attempt_failure_reason(&format!("the last write of the step did not succeed ({note})"), &execution.output_summary, &self.tool_decisions[decisions_before..]);
            if self.retry_failed_task(task_id, &reason, model) {
                return Ok(());
            }
            let title = self.graph.get(task_id).map(|n| n.objective.clone()).unwrap_or_default();
            self.task_failures.insert(task_id.to_string(), format!("{title} — {note}"));
            TaskState::Failed
        } else {
            TaskState::Succeeded
        };
        let _ = self.graph.set_state(task_id, state);
        let title = self.graph.get(task_id).map(|n| n.title.clone()).unwrap_or_default();
        let report = TaskReport::of(task_id, &title, state.as_str(), &execution.output_summary, &self.tool_decisions[decisions_before..]);
        self.task_reports.insert(task_id.to_string(), report);
        if let Some(observer) = &self.observer {
            let title = self.graph.get(task_id).map(|n| n.title.clone()).unwrap_or_default();
            observer.task_finished(&TaskOutcomeNote {
                mission_id: self.mission.mission_id.clone(),
                project_id: self.mission.project_id.clone(),
                task_id: task_id.to_string(),
                title,
                task_type,
                state: state.as_str(),
                tool_calls: (self.tool_decisions.len() - decisions_before) as u32,
            });
        }
        Ok(())
    }

    /// إعادة خطوة فشلت بسبب مقيس (خطة 2026-10-05، E3): مرة واحدة ضمن `max_attempts` وميزانية الإعادات، ومعها السبب، فتسلك
    /// المحاولة طريقًا آخر بدل أن تتوقّف المهمّة صامتة. لا إعادة بعد رفض إنسان أو رفض عند حدّ أمان أو سياسة: الإعادة تدعو
    /// إلى طلب ما رُفض. يعيد «صحيح» إن عادت الخطوة إلى الانتظار.
    pub(super) fn retry_failed_task(&mut self, task_id: &str, reason: &str, model: &dyn AgentModel) -> bool {
        if !self.recovery || self.is_cancelled() {
            return false;
        }
        let Some(node) = self.graph.get(task_id).cloned() else { return false };
        if node.attempt + 1 >= node.max_attempts {
            return false;
        }
        if let Some(probe) = &self.probe {
            let history = probe.tool_history(&self.mission.mission_id);
            if fulfilment::human_denied(&history) || fulfilment::boundary_denied(&history) {
                return false;
            }
        }
        if self.budget.reserve_retry().is_err() {
            return false;
        }
        self.graph.note_failure(task_id, reason);
        let _ = self.graph.bump_attempt(task_id);
        let _ = self.graph.set_state(task_id, TaskState::Pending);
        model.note_attempt_failed(&node.objective, reason);
        self.narrate(NarrationKind::Note, &format!("{} — {}", node.title, bounded_preview(reason, 160)), Some("RETRY".into()));
        true
    }

    /// ردّ مشوّه بعد إصلاحه الواحد. في السلوك المغلق: فشل العقدة وتوقّف التشغيل. مع ضوابط Phase-08:
    /// محاولة جديدة واحدة للعقدة ضمن `max_attempts` (قِيس: ردّ JSON مشوّه واحد كان يحجب المهمّة كلها)،
    /// ثم الفشل كما كان.
    pub(super) fn malformed_task(&mut self, task_id: &str, detail: String, model: &dyn AgentModel) -> Result<(), StopReason> {
        self.graph.note_failure(task_id, &detail);
        let retry = self.recovery && self.graph.get(task_id).is_some_and(|n| n.attempt + 1 < n.max_attempts) && self.budget.reserve_retry().is_ok();
        if retry {
            let _ = self.graph.bump_attempt(task_id);
            let _ = self.graph.set_state(task_id, TaskState::Pending);
            if let Some(objective) = self.graph.get(task_id).map(|n| n.objective.clone()) {
                model.note_retry(&objective);
            }
            return Ok(());
        }
        let _ = self.graph.set_state(task_id, TaskState::Failed);
        Err(StopReason::ModelOutputInvalid(detail))
    }

    /// يسجّل أدلّة يقترحها الوكيل مخرجاتِ وكيل دائمًا، ويعيد معرّفاتها.
    pub(super) fn record_agent_evidence(&mut self, agent_id: &str, proposals: &[crate::p03::port::EvidenceProposal]) -> Vec<String> {
        let mut ids = Vec::new();
        for proposal in proposals {
            let evidence_id = self.clock.id();
            let claimed = proposal.evidence_type;
            let summary = if claimed.is_agent_output() {
                proposal.summary.clone()
            } else {
                format!("{} [claimed {} by the agent; recorded as agent output]", proposal.summary, claimed.as_str())
            };
            let item = EvidenceItem {
                evidence_id: evidence_id.clone(),
                mission_id: self.mission.mission_id.clone(),
                // دائمًا مخرجات وكيل. لا استثناء ولا ترقية.
                evidence_type: EvidenceType::AgentOutput,
                created_at: self.clock.now(),
                digest: crate::digest::sha256_hex(summary.as_bytes()),
                provenance: Provenance {
                    producer: agent_id.to_string(),
                    authority: AuthorityClass::ModelGenerated,
                    source_ref: proposal.source_ref.clone(),
                    lineage: proposal.lineage.clone(),
                    measurement_kind: MeasurementKind::Inferred,
                },
                taint: Taint::with(TaintFlag::ModelGenerated),
                summary,
            };
            ids.push(evidence_id);
            self.evidence.push(item);
        }
        ids
    }

    /// جولات الأدوات لمهمّة فرعية واحدة (Phase-08). محدودة بعدد جولات ثابت وبميزانية نداءات
    /// النموذج؛ تتوقّف عند الإلغاء أو انتظار موافقة أو إنهاء الوكيل بلا أدوات.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn continue_with_tools(
        &mut self,
        task_id: &str,
        agent_id: &str,
        role: AgentRole,
        task_type: TaskType,
        objective: &str,
        model: &dyn AgentModel,
        execution: &mut TaskExecution,
        evidence_ids: &mut Vec<String>,
        first_round_start: usize,
    ) -> Result<(), StopReason> {
        let mut turns: Vec<ToolTurn> = Vec::new();
        let mut round_start = first_round_start;
        let mut requests = execution.tool_requests.clone();
        for _ in 0..MAX_TOOL_ROUNDS {
            if self.is_cancelled() || self.awaiting_approval.iter().any(|id| id == task_id) {
                break;
            }
            let fresh = self.decisions_of(agent_id, round_start);
            // المتابعة: طلبها الوكيل، أو (Phase-08) نتيجة ملاحظة وما زالت في العقد متطلّبات غائبة —
            // نتيجة قراءة أو تشغيل لا تُنهي المهمّة قبل أن يراها الوكيل.
            // نتيجة رفضتها البوابة عند حدّ أمان أو سياسة ليست ملاحظة: لا تستدعي متابعة (قِيس في انحدار
            // Phase-05: الطلب المرفوض نفسه أُعيد حتى نفدت الميزانية). رفض صياغة يبقى ملاحظة يصحّحها الوكيل.
            let observed = fresh.iter().any(|d| {
                is_observational(&d.tool_id) && !d.denial_reason.as_deref().is_some_and(|r| fulfilment::BOUNDARY_DENIALS.contains(&r))
            });
            // نتيجة زميل فوّضه الوكيل ولم يرها بعد تستدعي جولة يقرؤها فيها، ولو لم تُطلب أداة.
            let delegated = self.delegated_results.remove(task_id);
            // رفض صياغة (ARGUMENTS_INVALID) يُريه الوكيلَ بسببه في جولة إصلاح، أيًّا كانت الأداة (قِيس 2026-10-05:
            // كتابات رُفضت ولم يرَ الوكيل رفضها لأن الكتابة ليست أداة ملاحظة). الجولات محدودة بـ MAX_TOOL_ROUNDS.
            // أفعال الشاشة والمتصفّح مستثناة: البوابة تصنّف الملاحظة القديمة (STALE) رفضَ صياغة أيضًا، وجولة تلقائية
            // بعدها قد تنقر على تخطيط تغيّر (قِيس في p05_computer_a_stale_observation_is_rejected).
            let repairable = self.recovery
                && fresh.iter().any(|d| {
                    d.denial_reason.as_deref() == Some("ARGUMENTS_INVALID") && !d.tool_id.starts_with("polaris.desktop.") && !d.tool_id.starts_with("polaris.browser.")
                });
            let follow = delegated || (!fresh.is_empty() && (model.wants_tool_results(objective) || repairable || (self.recovery && observed && !self.unmet_now().is_empty())));
            let remind = !follow && self.maybe_remind(task_id, objective, model);
            if !follow && !remind {
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
                Err(StopReason::ModelOutputInvalid(detail)) => return self.malformed_task(task_id, detail, model),
                Err(stop) => return Err(stop),
            };
            self.budget.settle_model_call(next.input_tokens, next.output_tokens).map_err(StopReason::BudgetExhausted)?;
            self.narrate_from(model, objective, NarrationKind::Note);
            let ids = self.record_agent_evidence(agent_id, &next.evidence);
            evidence_ids.extend(ids);
            execution.claims.extend(next.claims.iter().cloned());
            // ردّ وسيط بلا ملخّص لا يمحو ملخّصًا سابقًا.
            // ردّ لاحق لا يمحو ملخّصًا سابقًا (Phase-08: «انتهيت» كان يمحو الأرقام التي تحتاجها المهمّة التالية).
            let later = next.output_summary.trim();
            if !later.is_empty() && !execution.output_summary.contains(later) {
                execution.output_summary = if execution.output_summary.trim().is_empty() {
                    later.to_string()
                } else {
                    let joined = format!("{}\n{}", execution.output_summary.trim(), later);
                    let n = joined.chars().count();
                    joined.chars().skip(n.saturating_sub(6_000)).collect()
                };
            }
            execution.failed = next.failed;
            // Phase-08: الوكيل يطلب زميلًا في أي جولة، لا في الأولى وحدها؛ القرار للمنسّق بحدّ العمق والميزانية.
            if self.recovery {
                if let Some(draft) = next.delegation.clone() {
                    self.run_delegation(task_id, agent_id, task_type, objective, &draft, model)?;
                }
            }
            execution.input_tokens += next.input_tokens;
            execution.output_tokens += next.output_tokens;
            round_start = self.tool_decisions.len();
            // لا تقدّم: الطلبات نفسها بحججها نفسها بعد رؤية نتائجها. تُنهى الجولات بدل تكرارها.
            if !next.tool_requests.is_empty() && next.tool_requests == requests {
                break;
            }
            requests = next.tool_requests.clone();
            if next.tool_requests.is_empty() {
                // لا أدوات جديدة: الجولة التالية لا ترى شيئًا جديدًا، فتنتهي ما لم يُسجَّل تذكير.
                continue;
            }
            self.run_tool_requests(task_id, agent_id, &next.tool_requests);
        }
        Ok(())
    }
}

impl MissionRuntime {
    /// يسجّل ادّعاء وكيل. محاولة لاحقة للخطوة نفسها (بعد موافقة أو استئناف) تقول الادّعاء نفسه من جديد: يصير مراجعةً للادّعاء
    /// السابق بمعرّفه نفسه ورقم مراجعة أعلى، بدل نسخة ثانية تجاور الأولى (R-01، 2026-10-12: بعد أن صار الاستئناف يحفظ ادّعاءات
    /// المحاولة الأولى). ادّعاء تحقّق سابقًا يبقى كما هو؛ والأدلّة السابقة باقية في المهمّة وإن لم يعد الادّعاء يشير إليها.
    pub(super) fn record_claim(&mut self, mut claim: Claim) {
        // ادّعاء وكيل مفوَّض (منقول) وادّعاء الوكيل الطالب لا يندمجان ولو تطابق نصّهما: لكلٍّ قائله وتلوّثه.
        let relayed = claim.taint.contains(TaintFlag::AgentRelayed);
        if let Some(existing) = self
            .claims
            .iter_mut()
            .find(|c| c.task_id == claim.task_id && c.statement == claim.statement && c.claim_type == claim.claim_type && c.taint.contains(TaintFlag::AgentRelayed) == relayed)
        {
            if existing.status == ClaimStatus::Verified {
                return;
            }
            claim.claim_id = existing.claim_id.clone();
            claim.revision = existing.revision + 1;
            claim.created_at = existing.created_at.clone();
            *existing = claim;
            return;
        }
        self.claims.push(claim);
    }
}
