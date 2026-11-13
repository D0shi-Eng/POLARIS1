// التحقّق والإنهاء (E1: نُقلا من runtime.rs بلا تغيير سلوك): الأدلّة المقيسة، والتحقّق، والتعارض، والمتطلَّبات، والحالة
// النهائية وإثباتها.

use super::support::*;
use super::*;

impl MissionRuntime {
    /// يقرأ الأدلّة المقيسة الخاصّة بهذه العقدة من المنفذ الموثوق، إن وُجد.
    /// نوع غير مقيس عائد من هذا المنفذ يُرفض: المنفذ للقياس لا لإعادة تسمية الاستنتاج.
    pub(super) fn collect_trusted_evidence(&mut self, task_id: &str, task_type: TaskType) -> TrustedSplit {
        let Some(source) = self.trusted_evidence.clone() else {
            return TrustedSplit::default();
        };
        let mut split = TrustedSplit::default();
        for trusted in source.evidence_for(&self.mission.mission_id, task_id, task_type) {
            if !trusted.evidence_type.is_measured() {
                continue;
            }
            let evidence_id = self.clock.id();
            self.evidence.push(EvidenceItem {
                evidence_id: evidence_id.clone(),
                mission_id: self.mission.mission_id.clone(),
                evidence_type: trusted.evidence_type,
                created_at: self.clock.now(),
                // البصمة كما قاسها المُنتِج، لا بصمة ملخّصنا عنه.
                digest: trusted.digest.clone(),
                provenance: Provenance {
                    producer: trusted.producer.clone(),
                    authority: AuthorityClass::TrustedRuntimeFact,
                    source_ref: trusted.source_ref.clone(),
                    lineage: trusted.lineage.clone(),
                    measurement_kind: MeasurementKind::Measured,
                },
                // القياس لا يمرّ بالنموذج، فلا راية تلوّث عليه.
                taint: Taint::clean(),
                summary: trusted.summary.clone(),
            });
            match trusted.stance {
                EvidenceStance::Supports => split.supports.push(evidence_id),
                EvidenceStance::Counters => split.counters.push(evidence_id),
                // الفعل سُجِّل دليلًا في المهمّة، ولا يُربط بادّعاء.
                EvidenceStance::Neutral => {}
                EvidenceStance::Observed(text) => split.observed.push((evidence_id, text)),
            }
        }
        split
    }

    /// يتحقّق من كل ادّعاء لم يُحسم بعد، بقاعدة نوعه.
    pub(super) fn verify_new_claims(&mut self) {
        let evidence = self.evidence.clone();
        for claim in self.claims.iter_mut().filter(|c| c.status == ClaimStatus::Unverified) {
            if !claim.verification_required {
                continue;
            }
            let supporting: Vec<&EvidenceItem> = claim
                .evidence_refs
                .iter()
                .filter_map(|id| evidence.iter().find(|e| &e.evidence_id == id))
                .collect();
            let counter: Vec<&EvidenceItem> = claim
                .counterevidence_refs
                .iter()
                .filter_map(|id| evidence.iter().find(|e| &e.evidence_id == id))
                .collect();
            let rule = rule_for(claim.claim_type);
            claim.status = verify(claim, &supporting, &counter, &rule).status;
        }
    }

    /// تعارض بين ادّعاءين مهيكلين يجعل كليهما CONFLICTED (البند 54).
    pub(super) fn detect_conflicts(&mut self) {
        let snapshot: Vec<Claim> = self.claims.clone();
        let refs: Vec<&Claim> = snapshot.iter().collect();
        let mut conflicted: Vec<String> = Vec::new();
        for (a, b) in find_conflicts(&refs) {
            conflicted.push(a.claim_id.clone());
            conflicted.push(b.claim_id.clone());
        }
        for claim in self.claims.iter_mut() {
            if conflicted.contains(&claim.claim_id) {
                claim.status = ClaimStatus::Conflicted;
            }
        }
    }

    /// يحسم المتطلَّبات من حالات الادّعاءات. لا يُرقّى متطلَّب بغير ادّعاء محقَّق يخصّه.
    ///
    /// R-02 (2026-10-12): المتطلَّب بلا `claim_ref` كان يُستوفى بأول ادّعاء محقَّق في المهمّة أيًّا كان موضوعه، فيُشبع ادّعاءٌ
    /// عن وجود ملف متطلّبًا عن صحّة محتواه. الآن يُربط المتطلَّب بادّعاء يخصّه وحده: موضوعه المهيكل يسمّي المتطلَّب بمعرّفه،
    /// وقاعدة تحقّقه هي قاعدة المتطلَّب. ادّعاء مدحوض يخصّه يجعله UNSATISFIED؛ ولا ادّعاء يخصّه يتركه UNVERIFIED.
    pub(super) fn settle_requirements(&mut self) {
        for requirement in self.mission.requirements.iter_mut() {
            let bound: Option<&Claim> = match &requirement.claim_ref {
                Some(id) => self.claims.iter().find(|c| &c.claim_id == id),
                None => {
                    let candidates: Vec<&Claim> = self.claims.iter().filter(|c| claim_binds_requirement(c, requirement)).collect();
                    // ادّعاء محقَّق يخصّه أولًا، ثم مدحوض، ثم أيّ ادّعاء يخصّه بحالته.
                    candidates
                        .iter()
                        .find(|c| c.status == ClaimStatus::Verified)
                        .or_else(|| candidates.iter().find(|c| c.status == ClaimStatus::Refuted))
                        .or_else(|| candidates.first())
                        .copied()
                }
            };
            requirement.status = match bound.map(|c| c.status) {
                Some(ClaimStatus::Verified) => RequirementStatus::Satisfied,
                Some(ClaimStatus::Refuted) => RequirementStatus::Unsatisfied,
                _ => RequirementStatus::Unverified,
            };
            if requirement.claim_ref.is_none() {
                requirement.claim_ref = bound.filter(|c| c.status == ClaimStatus::Verified || c.status == ClaimStatus::Refuted).map(|c| c.claim_id.clone());
            }
        }
    }

    /// الحواجز التي يعرفها المُنسِّق وحده: تنفيذ ناقص، وانتهاك سياسة حرج.
    /// تنفيذ لم يكتمل لا يُثبِت شيئًا مهما بدت المتطلَّبات مستوفاة.
    pub(super) fn extra_blockers(&self) -> Vec<Blocker> {
        let mut blockers: Vec<Blocker> = self
            .policy_violations
            .iter()
            .cloned()
            .map(Blocker::CriticalPolicyViolation)
            .collect();
        if let Some(stop) = &self.stop_reason {
            blockers.push(Blocker::ExecutionIncomplete(stop_code(stop).to_string()));
        }
        // مهمّة تنتظر قرارًا لم تكتمل، فلا تُثبِت شيئًا مهما بدت المتطلَّبات مستوفاة.
        if !self.awaiting_approval.is_empty() {
            blockers.push(Blocker::ExecutionIncomplete("AWAITING_TOOL_APPROVAL".to_string()));
        }
        blockers
    }

    /// يضبط الحالة النهائية ثم يحسم الإثبات عليها بتعريف واحد (R-03). الحالة والإثبات لا يُدمجان.
    pub(super) fn finalize(&mut self) {
        let any_failed = self.graph.nodes().any(|n| n.state == TaskState::Failed);
        let any_waiting = self.graph.nodes().any(|n| n.state == TaskState::Waiting);
        let blocked: Vec<String> = self.graph.nodes().filter(|n| n.state == TaskState::Blocked).map(|n| n.objective.clone()).collect();
        let ordinary = if self.stop_reason.as_ref().is_some_and(|s| !matches!(s, StopReason::Cancelled)) {
            MissionState::Blocked
        } else if any_failed {
            // سبب الإخفاق يُقال: العقد الفاشلة وسببها المقيس إن عُرف (كان الحقل يبقى فارغًا).
            let failed: Vec<String> = self
                .graph
                .nodes()
                .filter(|n| n.state == TaskState::Failed)
                .map(|n| self.task_failures.get(&n.task_id).cloned().unwrap_or_else(|| n.objective.clone()))
                .collect();
            self.stop_reason = Some(StopReason::TasksFailed(failed.join(" · ")));
            MissionState::Failed
        } else if any_waiting {
            // ليست مكتملة وليست محجوبة: تنتظر قرارًا، وهي حالة مُعلنة في آلة الحالة.
            MissionState::WaitingForApproval
        } else if !blocked.is_empty() {
            // عقدة محجوبة تعني عملًا لم يُقبل: المهمّة محجوبة بسببها، لا «مكتملة».
            self.stop_reason = Some(StopReason::TasksBlocked(blocked.join(" · ")));
            MissionState::Blocked
        } else {
            MissionState::Completed
        };
        let target = self.decide_terminal(ordinary);
        // الجواب الذي يراه المستخدم: آخر ما قاله الوكيل في آخر مهمّة لها مخرَج (بترتيب الخطة). كان هذا
        // الحقل لا يُكتب أبدًا، فتكتمل المهمّة بلا ردّ (قيس في بيانات المالك 2026-09-30). المهمّة الملغاة
        // لا جواب لها. النصّ مخرَج وكيل غير موثوق يُعرض بيانات، ومحدود بحدّ العمود (4000 محرف).
        if target != MissionState::Cancelled && self.mission.result_summary.is_none() {
            self.mission.result_summary = self.final_answer();
        }
        self.apply_terminal(target);
        self.settle_proof();
    }

    /// الإثبات كما يُشتقّ الآن من المتطلَّبات والادّعاءات وحواجز المُنسِّق وحالة المهمّة.
    pub(super) fn current_proof(&self) -> CompletionProof {
        let claim_refs: Vec<&Claim> = self.claims.iter().collect();
        crate::p03::completion::derive_settled(&self.mission.requirements, &claim_refs, self.mission.state, &self.extra_blockers())
    }

    /// يحسم الإثبات ويحفظه مع اللقطة: القراءة بعد إعادة التشغيل تعيد هذا الحكم بحواجزه، والواجهة تعرضه هو.
    pub(super) fn settle_proof(&mut self) {
        let proof = self.current_proof();
        self.mission.completion_proof_status = proof.status;
        self.settled_proof = Some(proof);
    }

    pub(super) fn final_answer(&self) -> Option<String> {
        let last = self.graph.nodes().filter_map(|n| self.task_outputs.get(&n.task_id)).filter(|o| !o.trim().is_empty()).last()?;
        bounded_answer(last)
    }

    /// يحسم الحالة النهائية عند بوّابة الإلغاء: إلغاء قُبل قبل هذه اللحظة يسود أي نتيجة عادية
    /// (فشل مهمّة، أو خطأ نموذج أو أداة وصل بعده، أو حجب). وبعد الحسم لا يُقبل إلغاء فيُعلَن
    /// كاذبًا. الحالة `Completed` نفسها تُحسم هنا، فإلغاء وصل قبلها يسودها أيضًا.
    pub(super) fn decide_terminal(&mut self, ordinary: MissionState) -> MissionState {
        let internal = self.cancelled || matches!(self.stop_reason, Some(StopReason::Cancelled));
        let decided = match (&self.gate, &self.cancel) {
            (Some(gate), Some(token)) => {
                let name = gate.decide(token, |accepted| if accepted || internal { MissionState::Cancelled.as_str() } else { ordinary.as_str() });
                if name == MissionState::Cancelled.as_str() { MissionState::Cancelled } else { ordinary }
            }
            _ if internal || self.is_cancelled() => MissionState::Cancelled,
            _ => ordinary,
        };
        if decided == MissionState::Cancelled {
            self.cancelled = true;
            // سبب التوقّف يُقال كما هو: إلغاء، لا خطأ نموذج جاء بعده.
            self.stop_reason = Some(StopReason::Cancelled);
            // عُقد كانت جارية أو فشلت بعد الإلغاء تُسجَّل ملغاة، لا فاشلة.
            let open: Vec<String> = self.graph.nodes().filter(|n| matches!(n.state, TaskState::Running | TaskState::Assigned | TaskState::Failed | TaskState::Pending | TaskState::Ready)).map(|n| n.task_id.clone()).collect();
            for id in open {
                let _ = self.graph.set_state(&id, TaskState::Cancelled);
            }
        }
        decided
    }

    pub(super) fn apply_terminal(&mut self, target: MissionState) {
        let now = self.clock.now();
        if target == MissionState::Cancelled {
            self.mission.completion_proof_status = CompletionProofStatus::NotProven;
        }
        if matches!(target, MissionState::Blocked | MissionState::Failed) {
            self.mission.failure_reason = self.stop_reason.as_ref().map(failure_text);
        }
        // انتقال غير مشروع يُترك كما هو بدل القفز الصامت.
        let _ = self.mission.transition_to(target, &now);
    }

    pub(super) fn fail_with(&mut self, stop: StopReason) {
        self.stop_reason = Some(stop);
        let target = self.decide_terminal(MissionState::Failed);
        self.apply_terminal(target);
        self.settle_proof();
        // فشل لا يُثبت شيئًا: حاجز التوقّف وحالة المهمّة يمنعان الإثبات أصلًا، والسطر يحرس ذلك صراحةً.
        self.mission.completion_proof_status = CompletionProofStatus::NotProven;
        if let Some(proof) = self.settled_proof.as_mut() {
            proof.status = CompletionProofStatus::NotProven;
        }
    }

    pub(super) fn halt_with(&mut self, stop: StopReason) {
        if matches!(stop, StopReason::Cancelled) {
            self.cancelled = true;
        }
        self.stop_reason = Some(stop);
    }
}

/// هل يخصّ الادّعاء المتطلَّب؟ (R-02)
/// - قاعدة نوع الادّعاء هي قاعدة المتطلَّب، دائمًا.
/// - قاعدة الحقيقة: موضوع الادّعاء المهيكل يسمّي المتطلَّب بمعرّفه. النصّ الحرّ لا يربط: مطابقة كلمات استنتاج لا ربط.
/// - قاعدة الإنجاز (`p03.rule.completion`): القاعدة نفسها هي المتطلَّب، إذ لا يتحقّق ادّعاء إنجاز إلا بنتيجة اختبار مقيسة
///   نجحت؛ فيربط ادّعاء إنجاز بلا موضوع بمتطلَّب بهذه القاعدة. وموضوع يسمّي متطلَّبًا آخر لا يربط.
fn claim_binds_requirement(claim: &Claim, requirement: &crate::p03::mission::MissionRequirement) -> bool {
    let rule = rule_for(claim.claim_type).rule_id;
    if rule != requirement.verification_rule_id {
        return false;
    }
    match &claim.subject {
        Some(subject) => subject.subject == requirement.requirement_id,
        None => rule == "p03.rule.completion",
    }
}
