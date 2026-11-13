// خدمة الذاكرة: المسار الوحيد إلى مخزنها.
//
// المسار (البند 6): مخرج الوكيل ← مرشّح ← تحقّق ← فحص منشأ ← سياسة ← تكرار/تعارض ←
// موافقة المستخدم حسب النوع ← المخزن. الوكيل لا يملك مرجعًا إلى هذه الخدمة: يصلها
// عبر أداة اقتراح الذاكرة وحدها، والأداة تكتب في القاعدة فتمرّ بموافقة البوابة.
// وزمن التشغيل الموثوق يقدّم مرشّحات من حالته هو — نتيجة المهمّة، وعُقدها، وما
// حقّقته قاعدة التحقق — ولا يحفظ كل مخرج وكيل.

use std::sync::Arc;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::p03::port::{MissionOutcomeNote, TaskOutcomeNote};
use crate::p03::trust::{Taint, TaintFlag};
use crate::storage::{Database, StorageError};

use super::context::{build, MemoryContextBlock, MemoryContextBudget};
use super::model::{
    CandidateSource, ConfidenceSource, MemoryCandidateV1, MemoryDecision, MemoryEntry, MemoryScope, MemoryTrustClass, MemoryType,
    SourceKind, SourceRef, MAX_CONTENT_CHARS, MAX_SOURCE_REFS,
};
use super::policy::validate;
use super::embedding::{cosine, EmbedPurpose, EmbeddingPort};
use super::retriever::{rank_with, MemoryQuery, Retrieval, SemanticScores};
use super::store::{AccessPurpose, DecisionRecord, MemoryConflict, MemoryListFilter, MemoryStore};

/// قياس زمن الكتابة والاسترجاع، يُقرأ في مسار القياس الأصلي.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MemoryTimings {
    pub writes: u64,
    pub write_micros_total: u64,
    pub retrievals: u64,
    pub retrieval_micros_total: u64,
    pub context_blocks: u64,
    pub context_tokens_total: u64,
    /// زمن بناء كتلة السياق كاملة: الاسترجاع والترتيب والوسم والميزانية.
    pub context_micros_total: u64,
    /// PHASE-08: استرجاعات رُتّبت هجينًا، وأخرى سقطت إلى المعجمي لأن التضمين فشل، وزمن التضمين كله.
    pub semantic_retrievals: u64,
    pub semantic_failures: u64,
    pub embed_micros_total: u64,
}

/// PHASE-08: نموذج التضمين الذي يرتّب به الاسترجاع، وحدّ التشابه الأدنى للصلة (يختلف بين النماذج، فيأتي من الإعداد معه).
#[derive(Clone)]
pub struct SemanticSetup {
    pub port: Arc<dyn EmbeddingPort>,
    pub min_similarity: f32,
}

pub struct MemoryService {
    store: MemoryStore,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    timings: std::sync::Mutex<MemoryTimings>,
    semantic: std::sync::RwLock<Option<SemanticSetup>>,
}

impl MemoryService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { store: MemoryStore::new(db), audit, clock, timings: std::sync::Mutex::new(MemoryTimings::default()), semantic: std::sync::RwLock::new(None) }
    }

    /// يضع نموذج التضمين أو يزيله. بلا نموذج: الاسترجاع معجمي.
    pub fn set_semantic(&self, setup: Option<SemanticSetup>) {
        if let Ok(mut s) = self.semantic.write() {
            *s = setup;
        }
    }

    pub fn semantic_model(&self) -> Option<String> {
        self.semantic.read().ok().and_then(|s| s.as_ref().map(|x| x.port.model_id()))
    }

    /// تشابه الطلب مع كل مدخل مرئي. ما لا متجه له، أو تغيّر محتواه، يُحسب الآن ويُحفظ. أيّ فشل يعيد «لا شيء» فيبقى الترتيب
    /// معجميًا، ويُعدّ الفشل؛ ولا يُختلق تشابه.
    fn semantic_scores(&self, visible: &[MemoryEntry], query: &MemoryQuery) -> Option<SemanticScores> {
        let text = query.text.as_deref().map(str::trim).filter(|t| !t.is_empty())?;
        let setup = self.semantic.read().ok()?.clone()?;
        let began = std::time::Instant::now();
        let result = (|| -> Result<SemanticScores, String> {
            let model = setup.port.model_id();
            let ids: Vec<String> = visible.iter().map(|e| e.memory_id.clone()).collect();
            let mut stored = self.store.vectors(&ids, &model).map_err(|e| e.to_string())?;
            let stale: Vec<&MemoryEntry> = visible.iter().filter(|e| stored.get(&e.memory_id).is_none_or(|(d, _)| d != &e.content_digest)).collect();
            if !stale.is_empty() {
                let docs: Vec<String> = stale.iter().map(|e| format!("{}: {}", e.subject, e.content)).collect();
                let vectors = setup.port.embed(EmbedPurpose::Document, &docs).map_err(|e| e.to_string())?;
                let rows: Vec<(String, String, Vec<f32>)> = stale.iter().zip(vectors).map(|(e, v)| (e.memory_id.clone(), e.content_digest.clone(), v)).collect();
                self.store.put_vectors(&rows, &model, &self.clock.now()).map_err(|e| e.to_string())?;
                for (id, digest, v) in rows {
                    stored.insert(id, (digest, v));
                }
            }
            let q = setup.port.embed(EmbedPurpose::Query, &[text.to_string()]).map_err(|e| e.to_string())?.pop().ok_or("no query vector")?;
            let similarity = stored.into_iter().map(|(id, (_, v))| (id, cosine(&q, &v))).collect();
            Ok(SemanticScores { similarity, min_similarity: setup.min_similarity })
        })();
        if let Ok(mut t) = self.timings.lock() {
            t.embed_micros_total += began.elapsed().as_micros() as u64;
            match result {
                Ok(_) => t.semantic_retrievals += 1,
                Err(_) => t.semantic_failures += 1,
            }
        }
        result.ok()
    }

    pub fn store(&self) -> &MemoryStore {
        &self.store
    }

    pub fn timings(&self) -> MemoryTimings {
        self.timings.lock().map(|t| *t).unwrap_or_default()
    }

    fn audit(&self, event: AuditEventType, subject: &str, outcome: AuditOutcome, detail: serde_json::Value) {
        let _ = self.audit.append(&AuditRecord::new(event, "memory", subject, outcome, detail));
    }

    /// يقدّم مرشّحًا للمسار الكامل. القرار يُسجَّل دائمًا، والمحتوى لا يُسجَّل إلا إن رُقّي.
    pub fn submit(&self, candidate: MemoryCandidateV1) -> Result<MemoryDecision, StorageError> {
        let began = std::time::Instant::now();
        let now = self.clock.now();
        let decision = match validate(candidate.clone()) {
            Err(reason) => self.store.record_rejection(&candidate, reason, &now)?,
            Ok(validated) => {
                let memory_id = self.clock.id();
                let clock = self.clock.clone();
                let mut conflict_ids = move || clock.id();
                self.store.promote(&validated, &memory_id, &mut conflict_ids, &now, None)?
            }
        };
        if let Ok(mut t) = self.timings.lock() {
            t.writes += 1;
            t.write_micros_total += began.elapsed().as_micros() as u64;
        }
        let (event, outcome) = match &decision {
            MemoryDecision::Rejected { .. } => (AuditEventType::MemoryRejected, AuditOutcome::Denied),
            _ => (AuditEventType::MemoryPromoted, AuditOutcome::Success),
        };
        self.audit(
            event,
            decision.memory_id().unwrap_or(&candidate.candidate_id),
            outcome,
            serde_json::json!({
                "candidate_id": candidate.candidate_id,
                "source": candidate.source.as_str(),
                "type": candidate.proposed_type.as_str(),
                "scope": candidate.proposed_scope.as_str(),
                "decision": decision.code(),
                "reason": decision.reason_code(),
            }),
        );
        Ok(decision)
    }

    /// يسترجع لمهمّة ويسجّل الوصول. النطاق يُفرض في الاستعلام ثم في الترتيب.
    pub fn retrieve(&self, query: &MemoryQuery) -> Result<Retrieval, StorageError> {
        let began = std::time::Instant::now();
        let now = self.clock.now();
        self.store.expire_due(self.clock.now_millis(), &now)?;
        let visible =
            self.store.visible_to(&query.mission_id, query.project_id.as_deref(), query.include_user, query.include_system)?;
        let ids: Vec<String> = visible.iter().map(|e| e.memory_id.clone()).collect();
        let recorded: Vec<MemoryConflict> = self.store.conflicts_touching(&ids)?;
        // الفحص الثاني في الترتيب يعرف المحادثة نفسها، فيقبل ذاكرة رسائلها السابقة ولا يقبل غيرها.
        let mut scoped = query.clone();
        scoped.thread_missions = self.store.thread_missions(&query.mission_id)?;
        let semantic = self.semantic_scores(&visible, &scoped);
        let retrieval = rank_with(visible, &scoped, &recorded, semantic.as_ref());
        let used: Vec<String> = retrieval.items.iter().map(|r| r.entry.memory_id.clone()).collect();
        self.store.record_access(&used, Some(&query.mission_id), AccessPurpose::AgentContext, &now)?;
        if let Ok(mut t) = self.timings.lock() {
            t.retrievals += 1;
            t.retrieval_micros_total += began.elapsed().as_micros() as u64;
        }
        Ok(retrieval)
    }

    /// كتلة الذاكرة لاستدعاء وكيل واحد.
    pub fn context_block(&self, query: &MemoryQuery, budget: MemoryContextBudget) -> MemoryContextBlock {
        let began = std::time::Instant::now();
        let block = match self.retrieve(query) {
            Ok(retrieval) => build(&retrieval, budget),
            // تعذّر القراءة لا يصير سياقًا مختلَقًا: لا كتلة.
            Err(_) => MemoryContextBlock::default(),
        };
        if let Ok(mut t) = self.timings.lock() {
            t.context_blocks += 1;
            t.context_tokens_total += block.estimated_tokens as u64;
            t.context_micros_total += began.elapsed().as_micros() as u64;
        }
        block
    }

    pub fn list(&self, filter: &MemoryListFilter) -> Result<Vec<MemoryEntry>, StorageError> {
        self.store.list(filter)
    }

    pub fn get(&self, memory_id: &str) -> Result<Option<MemoryEntry>, StorageError> {
        let entry = self.store.get(memory_id)?;
        if let Some(found) = &entry {
            self.store.record_access(std::slice::from_ref(&found.memory_id), None, AccessPurpose::UserView, &self.clock.now())?;
        }
        Ok(entry)
    }

    pub fn conflicts_for(&self, memory_id: &str) -> Result<Vec<MemoryConflict>, StorageError> {
        self.store.conflicts_touching(&[memory_id.to_string()])
    }

    /// حذف حقيقي من المخزن، يُسجَّل في التدقيق بمعرّفه وحده.
    pub fn delete(&self, memory_id: &str) -> Result<bool, StorageError> {
        let deleted = self.store.delete(memory_id, &self.clock.now())?;
        if deleted {
            self.audit(AuditEventType::MemoryDeleted, memory_id, AuditOutcome::Success, serde_json::json!({}));
        }
        Ok(deleted)
    }

    /// «تذكّر هذا» (ADR-032): نصّ كتبه المستخدم بنفسه، عنه (USER) أو عن مشروع (PROJECT). يمرّ بالتحقّق نفسه
    /// (حدود، سرّ، نوع ونطاق، تكرار)، ويُحفظ USER_DERIVED غير محقَّق: قول المستخدم لا يصير دليلًا، ويصل الوكيل
    /// بيانات موسومة كأي ذاكرة، لا تعليمات. `mission_id` مرجع المحادثة التي قيل فيها، إن وُجدت.
    /// `topic` (D2): الموضوع كما سمّاه المستخدم («مدينة الإقامة»). بسمّيه يحدّث قولًا سابقًا عن الموضوع نفسه بدل أن
    /// يُسجَّل تعارضًا. بلا موضوع: أول ثماني كلمات، كما كان.
    pub fn remember(&self, text: &str, topic: Option<&str>, scope: MemoryScope, project_id: Option<&str>, mission_id: Option<&str>) -> Result<MemoryDecision, StorageError> {
        let content = text.trim().to_string();
        let memory_type = if scope == MemoryScope::Project { MemoryType::Project } else { MemoryType::Preference };
        let subject = match topic.map(str::trim).filter(|t| !t.is_empty()) {
            Some(named) => crate::p04::adapter::bounded(named, 80),
            None => crate::p04::adapter::bounded(&content.split_whitespace().take(8).collect::<Vec<_>>().join(" "), 80),
        };
        let mut refs = vec![SourceRef::new(SourceKind::User, "owner")];
        if let Some(m) = mission_id {
            refs.push(SourceRef::new(SourceKind::Mission, m));
        }
        self.submit(MemoryCandidateV1 {
            candidate_id: self.clock.id(),
            source: CandidateSource::User,
            proposed_type: memory_type,
            proposed_scope: scope,
            mission_id: mission_id.map(str::to_string),
            project_id: project_id.map(str::to_string),
            subject,
            content,
            reason: "written by the user (remember this)".into(),
            source_refs: refs,
            taint: Taint::clean(),
            confidence_source: ConfidenceSource::UserApprovedWrite,
            producer: "user".into(),
            content_origin: MemoryTrustClass::UserDerived,
            importance: 4,
            task_id: None,
        })
    }

    pub fn decisions(&self, mission_id: Option<&str>) -> Result<Vec<DecisionRecord>, StorageError> {
        self.store.decisions(mission_id)
    }

    #[allow(clippy::too_many_arguments)]
    fn runtime_candidate(
        &self,
        mission_id: &str,
        project_id: Option<&str>,
        memory_type: MemoryType,
        scope: MemoryScope,
        subject: String,
        content: String,
        source_refs: Vec<SourceRef>,
        confidence_source: ConfidenceSource,
        content_origin: MemoryTrustClass,
        importance: u8,
        task_id: Option<String>,
    ) -> MemoryCandidateV1 {
        let mut taint = Taint::clean();
        if content_origin == MemoryTrustClass::ModelGenerated {
            taint.add(TaintFlag::ModelGenerated);
        }
        MemoryCandidateV1 {
            candidate_id: self.clock.id(),
            source: CandidateSource::Runtime,
            proposed_type: memory_type,
            proposed_scope: scope,
            mission_id: Some(mission_id.to_string()),
            project_id: project_id.map(str::to_string),
            subject,
            content,
            reason: "recorded by the mission runtime from its own state".into(),
            source_refs,
            taint,
            confidence_source,
            producer: "polaris.runtime/memory".into(),
            content_origin,
            importance,
            task_id,
        }
    }

    /// ذاكرة العمل: ما انتهت إليه كل عقدة، لمهمّتها وحدها، وتنتهي بانتهائها.
    pub fn task_finished(&self, note: &TaskOutcomeNote) {
        let candidate = self.runtime_candidate(
            &note.mission_id,
            note.project_id.as_deref(),
            MemoryType::Working,
            MemoryScope::Mission,
            format!("task {}", crate::p04::adapter::bounded(&note.title, 80)),
            format!(
                "The {} task \"{}\" ended {} after {} tool call(s).",
                note.task_type.as_str(),
                crate::p04::adapter::bounded(&note.title, 120),
                note.state,
                note.tool_calls
            ),
            vec![SourceRef::new(SourceKind::Mission, &note.mission_id), SourceRef::new(SourceKind::Task, &note.task_id)],
            ConfidenceSource::RuntimeObservation,
            MemoryTrustClass::SystemGenerated,
            2,
            Some(note.task_id.clone()),
        );
        let _ = self.submit(candidate);
    }

    /// نهاية تشغيل: ذاكرة حلقة للمهمّة، وحقائق حقّقتها قاعدة التحقق لمشروعها.
    ///
    /// ما لا يُحفظ هنا: ادّعاء لم يُحقَّق. نصّ نموذج بلا دليل لا يصير ذاكرة تلقائيًّا؛
    /// من أراد حفظه اقترحه عبر الأداة، فمرّ بموافقة المستخدم وبقي UNVERIFIED.
    pub fn mission_finished(&self, note: &MissionOutcomeNote) -> Vec<MemoryDecision> {
        let mut decisions = Vec::new();
        let verified: Vec<_> = note.claims.iter().filter(|c| c.status == "VERIFIED").collect();
        let mut refs = vec![SourceRef::new(SourceKind::Mission, &note.mission_id)];
        for claim in &verified {
            refs.push(SourceRef::new(SourceKind::Claim, &claim.claim_id));
        }
        let episodic = self.runtime_candidate(
            &note.mission_id,
            note.project_id.as_deref(),
            MemoryType::Episodic,
            MemoryScope::Mission,
            format!("mission outcome {}", crate::p04::adapter::bounded(&note.title, 80)),
            format!(
                "Mission \"{}\" ran to {} with completion proof {}: {} task(s) succeeded, {} failed, {} blocked; {} tool call(s) \
                 executed; {} of {} claim(s) verified by measured evidence.",
                crate::p04::adapter::bounded(&note.title, 120),
                note.state,
                note.proof_status,
                note.tasks_succeeded,
                note.tasks_failed,
                note.tasks_blocked,
                note.tool_calls_executed,
                verified.len(),
                note.claims.len()
            ),
            refs,
            ConfidenceSource::RuntimeObservation,
            MemoryTrustClass::SystemGenerated,
            3,
            None,
        );
        if let Ok(decision) = self.submit(episodic) {
            decisions.push(decision);
        }

        // ذاكرة الدرس (خطة 2026-10-05، D3): ما نجح وما فشل ولماذا وبأي أداة، من سجلّ البوابة وحده. تُرقّى إلى مشروع
        // المهمّة إن كان لها مشروع، فتصل مهامّه التالية؛ وإلا تبقى للمهمّة (السياسة لا تسمح لزمن التشغيل بنطاق المستخدم).
        if let Some(lesson) = tool_lesson(&note.tool_history) {
            let scope = if note.project_id.is_some() { MemoryScope::Project } else { MemoryScope::Mission };
            let mut refs = vec![SourceRef::new(SourceKind::Mission, &note.mission_id)];
            refs.extend(note.tool_history.iter().filter(|r| r.status != "SUCCEEDED").take(MAX_SOURCE_REFS - 2).map(|r| SourceRef::new(SourceKind::ToolInvocation, &r.invocation_id)));
            let candidate = self.runtime_candidate(
                &note.mission_id,
                note.project_id.as_deref(),
                MemoryType::Episodic,
                scope,
                lesson.0,
                lesson.1,
                refs,
                ConfidenceSource::RuntimeObservation,
                MemoryTrustClass::SystemGenerated,
                3,
                None,
            );
            if let Ok(decision) = self.submit(candidate) {
                decisions.push(decision);
            }
        }

        for claim in verified {
            let measured: Vec<SourceRef> = claim
                .supporting
                .iter()
                .filter(|e| e.measured)
                .map(|e| SourceRef::new(SourceKind::Evidence, &e.evidence_id))
                .collect();
            if measured.is_empty() {
                continue;
            }
            let (subject, content) = match &claim.subject {
                Some(s) => (
                    format!("{} {}", s.subject, s.property),
                    format!("{} {} is {} (\"{}\").", s.subject, s.property, s.value, crate::p04::adapter::bounded(&claim.statement, 300)),
                ),
                None => (crate::p04::adapter::bounded(&claim.statement, 100), claim.statement.clone()),
            };
            // حقيقة حقّقها دليل مقيس تُرقّى إلى مشروع المهمّة. نصّها نصّ نموذج،
            // وتحقّقها ربطٌ بدليل لا يُعاد فحصه عند الاسترجاع.
            let scope = if note.project_id.is_some() { MemoryScope::Project } else { MemoryScope::Mission };
            let mut source_refs = measured;
            source_refs.push(SourceRef::new(SourceKind::Claim, &claim.claim_id));
            source_refs.push(SourceRef::new(SourceKind::Mission, &note.mission_id));
            let candidate = self.runtime_candidate(
                &note.mission_id,
                note.project_id.as_deref(),
                MemoryType::Semantic,
                scope,
                subject,
                content,
                source_refs,
                ConfidenceSource::RuntimeEvidence,
                MemoryTrustClass::ModelGenerated,
                4,
                claim.task_id.clone(),
            );
            if let Ok(decision) = self.submit(candidate) {
                decisions.push(decision);
            }
        }
        if note.terminal {
            let _ = self.store.expire_working(&note.mission_id, &self.clock.now());
        }
        decisions
    }
}

/// درس الأدوات من سجلّ البوابة: لكل أداة عدد نداءاتها وما لم ينجح منها بسببه المقيس وملخّص المحوّل. `None` إن لم يفشل
/// شيء (لا درس في نجاح كامل يكرّر ذاكرة الحلقة). النصّ من المضيف وحده؛ ملخّصات المحوّلات قد تحمل مسارات اختارها الوكيل.
fn tool_lesson(history: &[crate::p03::port::ToolRecordNote]) -> Option<(String, String)> {
    let failed: Vec<&crate::p03::port::ToolRecordNote> = history.iter().filter(|r| r.status != "SUCCEEDED" && r.status != "AWAITING_APPROVAL").collect();
    if failed.is_empty() {
        return None;
    }
    let mut tools: Vec<&str> = history.iter().map(|r| r.tool_id.as_str()).collect();
    tools.sort_unstable();
    tools.dedup();
    let mut lines = Vec::new();
    for tool in &tools {
        let calls = history.iter().filter(|r| r.tool_id == *tool).count();
        let bad: Vec<&&crate::p03::port::ToolRecordNote> = failed.iter().filter(|r| r.tool_id == *tool).collect();
        if bad.is_empty() {
            lines.push(format!("{tool}: {calls} call(s), all succeeded."));
            continue;
        }
        let last = bad[bad.len() - 1];
        lines.push(format!(
            "{tool}: {calls} call(s), {} did not succeed; the last was {}{}: {}",
            bad.len(),
            last.status,
            last.denial_reason.as_deref().map(|r| format!(" {r}")).unwrap_or_default(),
            crate::p04::adapter::bounded(&last.summary, 220)
        ));
    }
    let content = crate::p04::adapter::bounded(&format!("Tool lesson measured by the gateway:\n{}", lines.into_iter().take(12).collect::<Vec<_>>().join("\n")), MAX_CONTENT_CHARS);
    let subject = crate::p04::adapter::bounded(&format!("tool lesson {}", failed.iter().map(|r| r.tool_id.as_str()).collect::<std::collections::BTreeSet<_>>().into_iter().collect::<Vec<_>>().join(", ")), 110);
    Some((subject, content))
}

#[cfg(test)]
mod tests {
    use super::super::model::*;
    use super::*;
    use crate::p03::claim::{ClaimSubject, ClaimType};
    use crate::p03::evidence::EvidenceType;
    use crate::p03::port::{ClaimNote, EvidenceNote};
    use crate::p03::task::TaskType;

    pub(crate) fn service() -> MemoryService {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        MemoryService::new(db, audit, RuntimeClock::deterministic())
    }

    fn agent_candidate(id: &str, mission: &str, subject: &str, content: &str) -> MemoryCandidateV1 {
        MemoryCandidateV1 {
            candidate_id: id.into(),
            source: CandidateSource::Agent,
            proposed_type: MemoryType::Semantic,
            proposed_scope: MemoryScope::Mission,
            mission_id: Some(mission.into()),
            project_id: Some("p1".into()),
            subject: subject.into(),
            content: content.into(),
            reason: "worth keeping".into(),
            source_refs: vec![SourceRef::new(SourceKind::Agent, "a1")],
            taint: Taint::clean(),
            confidence_source: ConfidenceSource::ModelSelfReport,
            producer: "agent:a1".into(),
            content_origin: MemoryTrustClass::ModelGenerated,
            importance: 3,
            task_id: None,
        }
    }

    fn outcome(mission: &str, project: Option<&str>, verified_value: &str, evidence: &str) -> MissionOutcomeNote {
        MissionOutcomeNote {
            mission_id: mission.into(),
            project_id: project.map(str::to_string),
            title: "read the fixture".into(),
            state: "COMPLETED",
            terminal: true,
            proof_status: "PROVEN",
            tasks_succeeded: 1,
            tasks_failed: 0,
            tasks_blocked: 0,
            tool_calls_executed: 2,
            claims: vec![ClaimNote {
                claim_id: format!("claim-{mission}"),
                task_id: Some("t1".into()),
                statement: format!("the fixture title is {verified_value}"),
                claim_type: ClaimType::Fact,
                status: "VERIFIED",
                subject: Some(ClaimSubject { subject: "fixture page".into(), property: "title".into(), value: verified_value.into() }),
                supporting: vec![EvidenceNote {
                    evidence_id: evidence.into(),
                    evidence_type: EvidenceType::ToolResult,
                    source_ref: "tool:polaris.web.read_page#i1".into(),
                    measured: true,
                }],
            }],
            tool_history: Vec::new(),
        }
    }

    /// خطة 2026-10-05، D3: بعد مهمّة فشلت فيها أداة، يبقى درس يذكر الأداة وسبب رفضها المقيس، في مشروعها.
    #[test]
    fn a_failed_tool_leaves_a_measured_lesson_in_the_project() {
        let memory = service();
        let mut note = outcome("m-lesson", Some("p1"), "Polaris", "e-lesson");
        let record = |id: &str, status: &str, reason: Option<&str>, summary: &str| crate::p03::port::ToolRecordNote {
            invocation_id: id.into(),
            task_id: "t1".into(),
            tool_id: "polaris.artifact.document".into(),
            status: status.into(),
            denial_reason: reason.map(str::to_string),
            effects: Vec::new(),
            summary: summary.into(),
        };
        note.tool_history = vec![record("i1", "DENIED", Some("ARGUMENTS_INVALID"), "a document needs 1..400 blocks"), record("i2", "SUCCEEDED", None, "wrote outputs/r.docx")];
        memory.mission_finished(&note);
        let lessons: Vec<MemoryEntry> = memory
            .list(&MemoryListFilter { project_id: Some("p1".into()), ..Default::default() })
            .unwrap()
            .into_iter()
            .filter(|e| e.subject.starts_with("tool lesson"))
            .collect();
        assert_eq!(lessons.len(), 1, "no lesson was kept");
        let lesson = &lessons[0];
        assert_eq!(lesson.scope, MemoryScope::Project);
        assert!(lesson.content.contains("polaris.artifact.document: 2 call(s), 1 did not succeed"), "{}", lesson.content);
        assert!(lesson.content.contains("DENIED ARGUMENTS_INVALID") && lesson.content.contains("1..400 blocks"), "{}", lesson.content);
        assert!(lesson.source_refs.iter().any(|r| r.kind == SourceKind::ToolInvocation && r.reference == "i1"));
        // نجاح كامل لا يترك درسًا.
        let mut clean = outcome("m-clean", Some("p1"), "Polaris", "e-clean");
        clean.tool_history = vec![record("i3", "SUCCEEDED", None, "ok")];
        assert!(super::tool_lesson(&clean.tool_history).is_none());
    }

    // قِيس 2026-10-05: كل رسالة في المحادثة مهمّة، وذاكرة نطاق المهمّة لم تكن تعبر إلى الرسالة التالية.
    #[test]
    fn mission_memory_is_shared_across_one_conversation_and_nowhere_else() {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let svc = MemoryService::new(db.clone(), audit, RuntimeClock::deterministic());
        let first = "11111111-1111-4111-8111-111111111111";
        let second = "22222222-2222-4222-8222-222222222222";
        let stranger = "33333333-3333-4333-8333-333333333333";
        db.with(|conn| {
            conn.execute("INSERT INTO p08_conversation_turns VALUES (?1, ?1, 0, 'first', 't')", rusqlite::params![first])?;
            conn.execute("INSERT INTO p08_conversation_turns VALUES (?1, ?2, 1, 'second', 't')", rusqlite::params![second, first])?;
            Ok(())
        })
        .unwrap();
        svc.submit(agent_candidate("c1", first, "favourite city", "Abha")).unwrap();
        let next = svc.retrieve(&MemoryQuery::for_mission(second, None)).unwrap();
        assert!(next.items.iter().any(|r| r.entry.content.contains("Abha")), "the next message did not see the first one's memory");
        let other = svc.retrieve(&MemoryQuery::for_mission(stranger, None)).unwrap();
        assert!(!other.items.iter().any(|r| r.entry.content.contains("Abha")), "another conversation saw it");
    }

    #[test]
    fn a_duplicate_is_not_stored_twice() {
        let svc = service();
        let first = svc.submit(agent_candidate("c1", "m1", "release day", "Monday")).unwrap();
        let second = svc.submit(agent_candidate("c2", "m1", "release  DAY", "monday")).unwrap();
        assert!(matches!(first, MemoryDecision::Promoted { .. }));
        assert_eq!(second, MemoryDecision::Duplicate { memory_id: first.memory_id().unwrap().to_string() });
        assert_eq!(svc.list(&MemoryListFilter::default()).unwrap().len(), 1);
    }

    #[test]
    fn a_conflict_keeps_both_sides_visible_and_picks_neither() {
        let svc = service();
        svc.submit(agent_candidate("c1", "m1", "release day", "Monday")).unwrap();
        let second = svc.submit(agent_candidate("c2", "m1", "release day", "Friday")).unwrap();
        assert_eq!(second.reason_code(), "CONFLICT");
        let retrieval = svc.retrieve(&MemoryQuery::for_mission("m1", Some("p1".into()))).unwrap();
        assert_eq!(retrieval.items.len(), 2, "one side of the conflict was hidden");
        assert!(retrieval.items.iter().all(|r| r.entry.verification == MemoryVerification::Conflicted));
        assert!(!retrieval.conflicts.is_empty(), "the agent would not see the conflict");
    }

    #[test]
    fn a_verified_fact_supersedes_an_unverified_one_visibly() {
        let svc = service();
        let mut unverified = agent_candidate("c1", "m1", "fixture page title", "Old title");
        unverified.proposed_scope = MemoryScope::Project;
        svc.submit(unverified).unwrap();
        let decisions = svc.mission_finished(&outcome("m2", Some("p1"), "POLARIS Fixture Normal", "e1"));
        let fact = decisions.iter().find(|d| d.reason_code() == "SUPERSEDED_BY_VERIFIED_SOURCE");
        assert!(fact.is_some(), "the verified fact did not supersede: {decisions:?}");
        let superseded = svc.list(&MemoryListFilter { status: Some(MemoryStatus::Superseded), ..Default::default() }).unwrap();
        assert_eq!(superseded.len(), 1);
        let linked = svc.list(&MemoryListFilter { scope: Some(MemoryScope::Project), status: Some(MemoryStatus::Active), ..Default::default() }).unwrap();
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].verification, MemoryVerification::EvidenceLinked);
        assert_eq!(linked[0].trust_class, MemoryTrustClass::ModelGenerated, "the verified text lost its model origin");
        assert!(linked[0].source_refs.iter().any(|r| r.kind == SourceKind::Evidence && r.reference == "e1"));
    }

    #[test]
    fn the_same_fact_from_the_same_lineage_is_coalesced_not_duplicated() {
        let svc = service();
        svc.mission_finished(&outcome("m1", Some("p1"), "POLARIS Fixture Normal", "e1"));
        let mut again = outcome("m1", Some("p1"), "POLARIS Fixture Normal", "e1");
        again.claims[0].statement = "the page's title reads POLARIS Fixture Normal".into();
        svc.mission_finished(&again);
        let facts = svc.list(&MemoryListFilter { memory_type: Some(MemoryType::Semantic), ..Default::default() }).unwrap();
        assert_eq!(facts.len(), 1, "one fact from one lineage was stored twice");
    }

    #[test]
    fn a_deleted_memory_is_gone_from_the_store_and_from_retrieval() {
        let svc = service();
        let decision = svc.submit(agent_candidate("c1", "m1", "unique deletable subject", "UNIQUE-DELETABLE-CONTENT")).unwrap();
        let id = decision.memory_id().unwrap().to_string();
        assert!(svc.delete(&id).unwrap());
        assert_eq!(svc.store().rows_containing("UNIQUE-DELETABLE-CONTENT").unwrap(), 0, "the content survived deletion");
        assert!(svc.retrieve(&MemoryQuery::for_mission("m1", Some("p1".into()))).unwrap().items.is_empty());
        assert!(svc.list(&MemoryListFilter::default()).unwrap().is_empty(), "a deleted entry is still listed");
        let tombstone = svc.get(&id).unwrap().unwrap();
        assert_eq!(tombstone.status, MemoryStatus::Deleted);
        assert!(tombstone.content.is_empty() && tombstone.subject.is_empty());
        // الشاهد يبقى صالحًا للعقد: المصدر لا يكون فارغًا ولو مُحيت أصوله.
        let view = crate::p05::view::MemoryDetailView::of(&tombstone);
        assert!(!view.entry.source.is_empty(), "a deleted entry's view carries an empty source");
        assert!(view.lineage.iter().all(|l| !l.is_empty()) && view.source_refs.is_empty());
        assert!(!svc.delete(&id).unwrap(), "a second delete claimed to delete something");
    }

    #[test]
    fn working_memory_expires_with_its_mission() {
        let svc = service();
        svc.task_finished(&TaskOutcomeNote {
            mission_id: "m1".into(),
            project_id: None,
            task_id: "t1".into(),
            title: "navigate".into(),
            task_type: TaskType::Research,
            state: "SUCCEEDED",
            tool_calls: 1,
        });
        assert_eq!(svc.retrieve(&MemoryQuery::for_mission("m1", None)).unwrap().items.len(), 1);
        svc.mission_finished(&outcome("m1", None, "x-value", "e9"));
        let working = svc.list(&MemoryListFilter { memory_type: Some(MemoryType::Working), ..Default::default() }).unwrap();
        assert!(working.iter().all(|e| e.status == MemoryStatus::Expired));
    }

    #[test]
    fn a_rejected_candidate_leaves_a_decision_but_no_content() {
        let svc = service();
        let decision = svc.submit(agent_candidate("c1", "m1", "login", "the password is hunter2")).unwrap();
        assert_eq!(decision, MemoryDecision::Rejected { reason: RejectReason::SecretLike });
        assert_eq!(svc.store().rows_containing("hunter2").unwrap(), 0);
        let decisions = svc.decisions(Some("m1")).unwrap();
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].reason_code, "SECRET_LIKE_CONTENT");
    }

    // D2 (ADR-038): المستخدم يحدّث ما قاله هو عن موضوع سمّاه؛ الأقدم يبقى مرئيًّا «مستبدَلًا». قولا وكيلين لا يختار أحدهما.
    #[test]
    fn a_users_newer_statement_on_a_named_topic_replaces_their_older_one_and_agents_still_conflict() {
        let svc = service();
        let first = svc.remember("أسكن في الرياض", Some("مدينة الإقامة"), MemoryScope::User, None, None).unwrap();
        let second = svc.remember("انتقلت إلى جدة", Some("مدينة الإقامة"), MemoryScope::User, None, None).unwrap();
        assert_eq!(second.reason_code(), "SUPERSEDED_BY_USER");
        let active = svc.list(&MemoryListFilter { scope: Some(MemoryScope::User), status: Some(MemoryStatus::Active), ..Default::default() }).unwrap();
        assert!(active.iter().any(|e| e.content.contains("جدة")));
        assert!(!active.iter().any(|e| e.content.contains("الرياض")), "the older statement is still active");
        let replaced = svc.list(&MemoryListFilter { status: Some(MemoryStatus::Superseded), ..Default::default() }).unwrap();
        assert!(replaced.iter().any(|e| Some(e.memory_id.as_str()) == first.memory_id()), "the older statement is not kept as superseded");

        // بلا موضوع مسمّى: أول الكلمات موضوعًا، فلا يحلّ قول محلّ آخر يختلف لفظه.
        let a = svc.remember("أفضّل الردود المختصرة", None, MemoryScope::User, None, None).unwrap();
        let b = svc.remember("أحبّ الجداول في الإجابات", None, MemoryScope::User, None, None).unwrap();
        assert_eq!(a.reason_code(), "NO_CONFLICT");
        assert_eq!(b.reason_code(), "NO_CONFLICT");

        // وكيلان بالموضوع نفسه وقيمتين: تعارض مسجَّل، لا اختيار للأحدث.
        let x = svc.submit(agent_candidate("c-x", "m1", "shared agent subject", "VALUE-ONE")).unwrap();
        let y = svc.submit(agent_candidate("c-y", "m1", "shared agent subject", "VALUE-TWO")).unwrap();
        assert_eq!(x.reason_code(), "NO_CONFLICT");
        assert_eq!(y.reason_code(), "CONFLICT");
    }

    /// PHASE-08 TEST FIXTURE: تضمين حتمي بمفاهيم ثلاثة (قاعدة بيانات، تصميم، غيرهما). يعدّ نداءات المستندات، ويفشل إن طُلب.
    struct ConceptEmbedder {
        documents: std::sync::atomic::AtomicUsize,
        fail: bool,
    }

    impl ConceptEmbedder {
        fn new(fail: bool) -> Arc<Self> {
            Arc::new(Self { documents: std::sync::atomic::AtomicUsize::new(0), fail })
        }
    }

    impl EmbeddingPort for ConceptEmbedder {
        fn model_id(&self) -> String {
            "fixture-concepts".into()
        }
        fn embed(&self, purpose: EmbedPurpose, texts: &[String]) -> Result<Vec<Vec<f32>>, super::super::embedding::EmbeddingError> {
            if self.fail {
                return Err(super::super::embedding::EmbeddingError::Unreachable("fixture".into()));
            }
            if purpose == EmbedPurpose::Document {
                self.documents.fetch_add(texts.len(), std::sync::atomic::Ordering::SeqCst);
            }
            Ok(texts
                .iter()
                .map(|t| {
                    let t = t.to_lowercase();
                    let db = ["postgres", "sql", "database", "engine"].iter().any(|w| t.contains(w));
                    let design = ["design", "screen", "interface"].iter().any(|w| t.contains(w));
                    vec![f32::from(u8::from(db)), f32::from(u8::from(design)), f32::from(u8::from(!db && !design))]
                })
                .collect())
        }
    }

    fn project_query(project: &str, text: &str) -> MemoryQuery {
        MemoryQuery { text: Some(text.into()), ..MemoryQuery::for_mission("m-sem", Some(project.into())) }
    }

    #[test]
    fn cp08_semantic_ranking_finds_a_paraphrase_inside_the_scope_and_keeps_its_vector_cached() {
        let svc = service();
        let backend = svc.remember("The backend runs on PostgreSQL 16", Some("backend"), MemoryScope::Project, Some("p1"), None).unwrap().memory_id().unwrap().to_string();
        svc.remember("Sara leads the design", Some("design lead"), MemoryScope::Project, Some("p1"), None).unwrap();
        svc.remember("Oasis keeps its records in MySQL", Some("oasis db"), MemoryScope::Project, Some("p2"), None).unwrap();
        let ask = project_query("p1", "which SQL engine stores our data");
        let lexical: Vec<String> = svc.retrieve(&ask).unwrap().items.into_iter().map(|r| r.entry.memory_id).collect();
        assert!(!lexical.contains(&backend), "the lexical ranking was expected to miss this paraphrase: {lexical:?}");

        let port = ConceptEmbedder::new(false);
        svc.set_semantic(Some(SemanticSetup { port: port.clone(), min_similarity: 0.5 }));
        let hybrid = svc.retrieve(&ask).unwrap();
        assert_eq!(hybrid.items.first().map(|r| r.entry.memory_id.clone()), Some(backend.clone()), "the paraphrase did not rank first");
        assert!(hybrid.items.iter().all(|r| r.entry.project_id.as_deref() != Some("p2")), "similarity carried another project's memory across");
        assert_eq!(svc.store().vector_count(&backend).unwrap(), 1);
        let embedded = port.documents.load(std::sync::atomic::Ordering::SeqCst);
        svc.retrieve(&ask).unwrap();
        assert_eq!(port.documents.load(std::sync::atomic::Ordering::SeqCst), embedded, "unchanged memories were embedded again");
        assert_eq!(svc.timings().semantic_retrievals, 2);
    }

    #[test]
    fn cp08_forgetting_a_memory_removes_its_vector() {
        let svc = service();
        svc.set_semantic(Some(SemanticSetup { port: ConceptEmbedder::new(false), min_similarity: 0.5 }));
        let id = svc.remember("The backend runs on PostgreSQL 16", Some("backend"), MemoryScope::Project, Some("p1"), None).unwrap().memory_id().unwrap().to_string();
        svc.retrieve(&project_query("p1", "database engine")).unwrap();
        assert_eq!(svc.store().vector_count(&id).unwrap(), 1);
        assert!(svc.delete(&id).unwrap());
        assert_eq!(svc.store().vector_count(&id).unwrap(), 0, "the vector of a forgotten memory stayed in the database");
    }

    #[test]
    fn cp08_a_failing_embedding_model_leaves_retrieval_lexical_and_is_counted() {
        let svc = service();
        let id = svc.remember("The backend runs on PostgreSQL 16", Some("backend"), MemoryScope::Project, Some("p1"), None).unwrap().memory_id().unwrap().to_string();
        svc.set_semantic(Some(SemanticSetup { port: ConceptEmbedder::new(true), min_similarity: 0.5 }));
        let out = svc.retrieve(&project_query("p1", "PostgreSQL backend")).unwrap();
        assert_eq!(out.items.first().map(|r| r.entry.memory_id.clone()), Some(id), "the lexical match was lost when embedding failed");
        let t = svc.timings();
        assert_eq!((t.semantic_retrievals, t.semantic_failures), (0, 1));
    }
}
