// خدمات Phase-03: التركيب، وعمليات المهمّة.
//
// `Phase03` تركيب فقط؛ لا منطق عمل هنا. المنطق في `runtime` و`graph` و`verification`.
// منفذ النموذج يُحقن: في الإنتاج محوّل يمرّ بتوجيه Phase-02 وبوابة خروجه، وفي
// الاختبار تجهيزة حتمية. غيابه ليس ذريعة لاستعمال وكيل زائف (البند 92): بدء مهمّة
// بلا منفذ نموذج يُرفض صراحةً.

use std::sync::{Arc, OnceLock};

use serde::Serialize;

use crate::audit::{AuditEventType, AuditOutcome, AuditRecord, AuditLedger};
use crate::ipc::errors::{DesktopErrorCategory, HostError};
use crate::storage::{Database, StorageError};

use super::agent::AgentRegistry;
use super::cancel::{CancelArbitration, MissionCancellation};
use super::clock::RuntimeClock;
use super::completion::CompletionProof;
use super::watch::session::{ChainCheck, SessionLog};
use super::mission::{
    CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionRequirement, MissionState,
};
use super::model_adapter::{MissionModelBinding, Phase02AgentModel};
use super::port::{
    AgentContextProvider, ClaimNote, EvidenceNote, MissionModelPreference, MissionObserver, MissionOutcomeNote, ToolBrokerFactory,
    TrustedEvidenceSource,
};
use crate::p02::context::SourceService;
use crate::p02::invocation::service::InvocationService;
use super::repository::{MissionRepository, MissionSnapshot, MissionSummary, RecoveryReport};
use super::runtime::{MissionRuntime, RunReport};
use super::trust::AuthorityClass;
use super::view::{AgentRoleView, AgentView, ClaimView, CompletionProofView, EvidenceView, MissionDetailView, TaskView};

/// ما يحتاجه Phase-03 من محيطه.
pub struct Phase03Config {
    pub db: Arc<Database>,
    pub audit: Arc<AuditLedger>,
    pub clock: RuntimeClock,
    /// مسار استدعاء Phase-02. `None` يعني أن لا نموذج يمكن توجيهه: القراءة تعمل،
    /// والبدء يُرفض صراحةً. لا تجهيزة اختبار تحلّ محلّه (البند 92).
    pub invocations: Option<Arc<InvocationService>>,
    /// مصدر الأدلّة المقيسة. غيابه يعني أن لا قياس في هذا المضيف بعد، فتبقى
    /// ادّعاءات الوكلاء غير محقَّقة — وهو الجواب الصادق.
    pub trusted_evidence: Option<Arc<dyn TrustedEvidenceSource>>,
    /// مصنع وسطاء الأدوات. غيابه يعني أن لا أداة في هذا المضيف، فكل اقتراح
    /// يُرفض صراحةً — لا تنفيذ بلا بوابة.
    pub tools: Option<Arc<dyn ToolBrokerFactory>>,
    /// مصادر سياق المشروع. بها يُربط سياق المشروع باستدعاء الوكيل فعلًا.
    pub sources: Option<Arc<SourceService>>,
    /// سياق إضافي لاستدعاء الوكيل (ذاكرة وملاحظات، Phase-05). بيانات غير موثوقة.
    pub context: Option<Arc<dyn AgentContextProvider>>,
    /// مراقب دورة حياة المهمّة (Phase-05). يقرأ ما انتهى ولا يكتب في المهمّة.
    pub observer: Option<Arc<dyn MissionObserver>>,
}

pub struct Phase03 {
    pub repository: Arc<MissionRepository>,
    pub registry: Arc<AgentRegistry>,
    pub audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    invocations: Option<Arc<InvocationService>>,
    trusted_evidence: Option<Arc<dyn TrustedEvidenceSource>>,
    tools: Option<Arc<dyn ToolBrokerFactory>>,
    sources: Option<Arc<SourceService>>,
    context: Option<Arc<dyn AgentContextProvider>>,
    observer: Option<Arc<dyn MissionObserver>>,
    /// التشغيلات القائمة. بها يوقف الإلغاء ما هو جارٍ، لا ما لم يبدأ فقط.
    pub cancellation: Arc<MissionCancellation>,
    /// اختيار النموذج لكل مهمّة (Phase-08)، يُربط بعد التركيب.
    model_preferences: OnceLock<Arc<dyn MissionModelPreference>>,
    /// منفذ قياس عقد المهمّة (Phase-08). غيابه يُبقي السلوك المغلق.
    contract_probe: OnceLock<Arc<dyn super::port::ContractProbe>>,
    /// صور المرفقات لنموذج يرى (مكافأة Manus 2026-10-19)، يربطها المضيف من Phase-08.
    image_source: OnceLock<Arc<dyn super::port::MissionImageSource>>,
    /// أيّ المهامّ جزء من محادثة فتنتهي بردّ على المستخدم (Phase-08). غيابه يُبقي السلوك المغلق.
    conversations: OnceLock<Arc<dyn super::port::ConversationPolicy>>,
    /// عرض الأدوات بالاستدعاء الأصيل للمهامّ التالية (خطة 2026-10-05، B3). مفعَّل افتراضيًّا؛ إيقافه يُبقي
    /// العقد النصّي وحده، ويُستعمل للقياس المقارن على المهمّة نفسها.
    native_tool_calls: std::sync::atomic::AtomicBool,
    /// سجلّ محادثة واحد للمهمّة (خطة 2026-10-06، C2). مطفأ حتى يُقاس.
    mission_thread: std::sync::atomic::AtomicBool,
    /// حلقة الوكيل لمهامّ المحادثة (ADR-039). تعمل افتراضًا؛ إطفاؤها يعيد مسار الرسم للقياس المقارن على المهامّ نفسها.
    agent_loop: std::sync::atomic::AtomicBool,
    /// W-1 (2026-10-27): التوجيه الضمني. مشغَّل افتراضيًّا منذ DEF-18 (2026-11-12)؛ يطفئه `POLARIS_IMPLICIT_ROUTE=0` عند الإنشاء أو `set_implicit_route(false)`.
    implicit_route: std::sync::atomic::AtomicBool,
    /// RW-A (2026-10-27): حقائق الملفات التي كتبها المفوَّض في نتيجة التفويض. مطفأ افتراضيًّا؛ `POLARIS_DELIVERABLE_FACTS=1`.
    deliverable_facts: std::sync::atomic::AtomicBool,
    /// RW-B (2026-10-27): ملاحظة مضيف على الكتابة المطابقة وعلى تكرار كتابة المسار نفسه. مطفأ افتراضيًّا؛ `POLARIS_REWRITE_NOTE=1`.
    rewrite_note: std::sync::atomic::AtomicBool,
    /// سجلّ الجلسة والامتدادات على المخزن نفسه (خطة 2026-10-07، ADR-041 §3.2).
    pub session_log: Arc<super::watch::session::SqliteSessionLog>,
    pub spans: Arc<super::watch::spans::SqliteSpans>,
    /// ذاكرة الوكلاء الـ300 بنطاق هوياتهم (القسم 6، جدولا v18).
    pub agent_memory: Arc<super::agents::memory::SqliteAgentMemory>,
}

/// ما وجده فحص الإقلاع (ADR-041): الاستعادة، وثوابت الحالة، وسلامة السلسلتين.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BootCheck {
    pub tasks_interrupted: u32,
    pub missions_blocked: u32,
    /// المهامّ النهائية التي أُغلقت خطواتها المفتوحة، وعددها.
    pub invariant_repairs: Vec<(String, u32)>,
    /// كسر في سلسلة التدقيق: موضعه وسببه.
    pub audit_chain_broken: Option<(i64, String)>,
    /// كسور سلاسل الجلسات: الجلسة وموضعها.
    pub session_chains_broken: Vec<(String, i64)>,
    pub sessions_checked: u32,
}

/// مدخلات إنشاء مهمّة، بعد أن تحقّقت البوابة من الحمولة.
pub struct CreateMissionInput {
    pub title: String,
    pub objective: String,
    pub project_id: Option<String>,
    pub execution_mode: ExecutionMode,
    pub priority: MissionPriority,
    pub budget: MissionBudget,
    pub requirements: Vec<MissionRequirement>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionListResult {
    pub missions: Vec<MissionSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionGetResult {
    pub mission: MissionDetailView,
    pub completion_proof: CompletionProofView,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionCreateResult {
    pub mission_id: String,
    pub state: &'static str,
    pub completion_proof_status: &'static str,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionStartResult {
    pub mission_id: String,
    pub state: &'static str,
    pub completion_proof: CompletionProofView,
    pub report: RunReportView,
}

/// تقرير تشغيل كما يعبر إلى العارض: أعداد مقيسة، وسبب توقّف برمز لا تفصيل داخلي.
#[derive(Debug, Clone, Serialize)]
pub struct RunReportView {
    pub mission_state: &'static str,
    pub tasks_succeeded: u32,
    pub tasks_failed: u32,
    pub tasks_blocked: u32,
    pub model_calls: u64,
    pub total_tokens: u64,
    pub claims: u32,
    pub verified_claims: u32,
    pub review_independence: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<&'static str>,
    // أعداد Phase-04. تُحسب في زمن التشغيل، وتعبر الحدّ لأن ما لا يعبر لا يُقاس
    // من الخارج: تفويضٌ وقع فعلًا كان يُقرأ صفرًا عند العارض قبل نقلها.
    pub tool_proposals: u32,
    pub tool_calls_executed: u32,
    pub tool_calls_denied: u32,
    pub tool_calls_awaiting_approval: u32,
    pub delegations_requested: u32,
    pub delegations_executed: u32,
    pub agent_messages: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionCancelResult {
    pub mission_id: String,
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct MissionResumeResult {
    pub mission_id: String,
    pub state: &'static str,
    pub tasks_interrupted: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskListResult {
    pub mission_id: String,
    pub graph_revision: u32,
    pub tasks: Vec<TaskView>,
    pub ready: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentListResult {
    pub roles: Vec<AgentRoleView>,
    pub instances: Vec<AgentView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaimListResult {
    pub mission_id: String,
    pub claims: Vec<ClaimView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvidenceListResult {
    pub mission_id: String,
    pub evidence: Vec<EvidenceView>,
}

impl Phase03 {
    pub fn build(config: Phase03Config) -> Self {
        Self {
            repository: Arc::new(MissionRepository::new(config.db.clone())),
            registry: Arc::new(AgentRegistry::builtin()),
            audit: config.audit,
            clock: config.clock,
            invocations: config.invocations,
            trusted_evidence: config.trusted_evidence,
            tools: config.tools,
            sources: config.sources,
            context: config.context,
            observer: config.observer,
            cancellation: Arc::new(MissionCancellation::new()),
            model_preferences: OnceLock::new(),
            contract_probe: OnceLock::new(),
            image_source: OnceLock::new(),
            conversations: OnceLock::new(),
            native_tool_calls: std::sync::atomic::AtomicBool::new(true),
            mission_thread: std::sync::atomic::AtomicBool::new(false),
            agent_loop: std::sync::atomic::AtomicBool::new(true),
            // DEF-18 (2026-11-12): الافتراضي مشغَّل. `POLARIS_IMPLICIT_ROUTE=0` يعيد الرفض قبل القرار.
            implicit_route: std::sync::atomic::AtomicBool::new(std::env::var("POLARIS_IMPLICIT_ROUTE").map_or(true, |v| v != "0")),
            deliverable_facts: std::sync::atomic::AtomicBool::new(std::env::var("POLARIS_DELIVERABLE_FACTS").is_ok_and(|v| v == "1")),
            rewrite_note: std::sync::atomic::AtomicBool::new(std::env::var("POLARIS_REWRITE_NOTE").is_ok_and(|v| v == "1")),
            session_log: Arc::new(super::watch::session::SqliteSessionLog::new(config.db.clone())),
            spans: Arc::new(super::watch::spans::SqliteSpans::new(config.db.clone())),
            agent_memory: Arc::new(super::agents::memory::SqliteAgentMemory::new(config.db.clone())),
        }
    }

    /// فحص الإقلاع (ADR-041 §3.3–3.4): لا مهمّة تبقى RUNNING ولا عملية لها، ولا مهمّة نهائية بخطوة مفتوحة، وسلسلتا التدقيق
    /// والجلسات سليمتان. كل إصلاح وكل كسر حدث تدقيق. يُستدعى مرة عند بناء المضيف، قبل أن يبدأ أيّ تشغيل.
    pub fn boot_check(&self) -> BootCheck {

        let mut check = BootCheck::default();
        if let Ok((recovery, repaired)) = self.repository.boot_invariants() {
            check.tasks_interrupted = recovery.tasks_interrupted;
            check.missions_blocked = recovery.missions_blocked;
            for (mission_id, state, count) in repaired {
                self.record_audit(AuditEventType::StateInvariantRepaired, &mission_id, AuditOutcome::Success, serde_json::json!({ "stage": "BOOT", "mission_state": state, "steps_closed": count }));
                check.invariant_repairs.push((mission_id, count));
            }
            if recovery.missions_blocked > 0 || recovery.tasks_interrupted > 0 {
                self.record_audit(
                    AuditEventType::StateInvariantRepaired,
                    "boot",
                    AuditOutcome::Success,
                    serde_json::json!({ "stage": "BOOT_RECOVERY", "missions_blocked": recovery.missions_blocked, "tasks_interrupted": recovery.tasks_interrupted }),
                );
            }
        }
        if let Ok(unproven) = self.repository.boot_proof_invariant() {
            for mission_id in unproven {
                self.record_audit(AuditEventType::StateInvariantRepaired, &mission_id, AuditOutcome::Success, serde_json::json!({ "stage": "BOOT_PROOF", "completion_proof_status": "NOT_PROVEN", "reason": "COMPLETED_WITH_UNFINISHED_STEP" }));
            }
        }
        if let Ok(crate::audit::ledger::ChainVerification::Broken { at_seq, reason }) = self.audit.verify() {
            check.audit_chain_broken = Some((at_seq, reason));
        }
        for session in self.session_log.sessions() {
            check.sessions_checked += 1;
            if let ChainCheck::Broken { at_seq, .. } = self.session_log.verify(&session) {
                check.session_chains_broken.push((session, at_seq));
            }
        }
        // الكسر يُكتب بعد الفحص: سجلٌّ مكسور يُلحق به ما يقول إنه مكسور، ولا يُصلح.
        if let Some((at_seq, _)) = &check.audit_chain_broken {
            self.record_audit(AuditEventType::TamperDetected, "audit_events", AuditOutcome::Failure, serde_json::json!({ "chain": "AUDIT_EVENTS", "at_seq": at_seq }));
        }
        for (session, at_seq) in &check.session_chains_broken {
            self.record_audit(AuditEventType::TamperDetected, session, AuditOutcome::Failure, serde_json::json!({ "chain": "SESSION_EVENTS", "at_seq": at_seq }));
        }
        check
    }

    /// جلسة السجلّ لمهمّة: محادثتها إن كانت دورًا فيها، وإلا المهمّة نفسها. محادثة قديمة بلا أحداث تُبذر من أدوارها السابقة
    /// وأجوبتها مرة واحدة (رسالة المستخدم كما كتبها، وجواب المهمّة كما حُفظ).
    fn session_for(&self, mission_id: &str) -> String {
        use super::watch::session::{SessionDraft, SessionKind, SessionLog};
        let Some(policy) = self.conversations.get() else { return mission_id.to_string() };
        let Some(thread) = policy.thread_of_mission(mission_id) else { return mission_id.to_string() };
        if self.session_log.events(&thread).is_empty() {
            for (turn_id, message) in policy.earlier_turns(mission_id) {
                let _ = self.session_log.append(SessionDraft {
                    session_id: thread.clone(),
                    mission_id: turn_id.clone(),
                    kind: SessionKind::UserMessage,
                    authority: AuthorityClass::DirectUserInstruction,
                    payload: serde_json::json!({ "text": format!("[USER_REQUEST]\n{}", message.trim()), "request": message, "seeded": true }),
                    parent_seq: None,
                });
                let answer = self.repository.load(&turn_id).ok().and_then(|s| s.mission.result_summary.or(s.mission.failure_reason));
                if let Some(answer) = answer {
                    let _ = self.session_log.append(SessionDraft {
                        session_id: thread.clone(),
                        mission_id: turn_id,
                        kind: SessionKind::AssistantMessage,
                        authority: AuthorityClass::ModelGenerated,
                        payload: serde_json::json!({ "text": answer, "tool_calls": [], "seeded": true }),
                        parent_seq: None,
                    });
                }
            }
        }
        thread
    }

    /// يفعّل عرض الأدوات بالاستدعاء الأصيل أو يوقفه للمهامّ التي تبدأ بعده. لا يغيّر مهمّة جارية.
    pub fn set_native_tool_calls(&self, enabled: bool) {
        self.native_tool_calls.store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// يفعّل سجلّ المحادثة الواحد للمهامّ التي تبدأ بعده، أو يوقفه. لا يغيّر مهمّة جارية.
    pub fn set_agent_loop(&self, enabled: bool) {
        self.agent_loop.store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// W-1: يشغّل التوجيه الضمني للمهامّ التي تبدأ بعده أو يطفئه. لا يغيّر مهمّة جارية.
    pub fn set_implicit_route(&self, enabled: bool) {
        self.implicit_route.store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// RW-A: يشغّل حقائق الملفات في نتيجة التفويض للمهامّ التي تبدأ بعده أو يطفئه.
    pub fn set_deliverable_facts(&self, enabled: bool) {
        self.deliverable_facts.store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// RW-B: يشغّل ملاحظة الكتابة المكرّرة للمهامّ التي تبدأ بعده أو يطفئه.
    pub fn set_rewrite_note(&self, enabled: bool) {
        self.rewrite_note.store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn set_mission_thread(&self, enabled: bool) {
        self.mission_thread.store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// يربط منفذ اختيار النموذج لكل مهمّة (Phase-08). مرة واحدة؛ الربط الثاني يُهمل.
    pub fn bind_model_preferences(&self, preferences: Arc<dyn MissionModelPreference>) {
        let _ = self.model_preferences.set(preferences);
    }

    /// يربط منفذ قياس عقد المهمّة (Phase-08). مرة واحدة؛ الربط الثاني يُهمل.
    pub fn bind_image_source(&self, source: Arc<dyn super::port::MissionImageSource>) {
        let _ = self.image_source.set(source);
    }

    pub fn bind_contract_probe(&self, probe: Arc<dyn super::port::ContractProbe>) {
        let _ = self.contract_probe.set(probe);
    }

    /// يربط منفذ سياسة المحادثة (Phase-08). مرة واحدة؛ الربط الثاني يُهمل.
    pub fn bind_conversations(&self, policy: Arc<dyn super::port::ConversationPolicy>) {
        let _ = self.conversations.set(policy);
    }

    /// مصادر السياق النشطة لمشروع المهمّة.
    ///
    /// هذا ما يغلق ثغرة Phase-03: كان الربط يُبنى بقائمة مصادر فارغة دائمًا، فلا
    /// يصل سياق المشروع إلى أي استدعاء وكيل. المصادر تُقرأ هنا من مشروع المهمّة
    /// وحده، وتمرّ إلى مُجمِّع Phase-02 بميزانيته وتصنيفه وسلالته — فيبقى المحتوى
    /// `UNTRUSTED_CONTENT` ولا يرتفع صنفه بمروره في مسار الوكيل.
    fn context_sources_for(&self, project_id: Option<&str>) -> Vec<String> {
        let (Some(project_id), Some(sources)) = (project_id, self.sources.as_ref()) else {
            return Vec::new();
        };
        match sources.list(project_id) {
            // حدّ أعلى صريح: مشروع ضخم لا يحوّل نداء وكيل واحد إلى قراءة غير محدودة.
            // ما يُسقطه هذا الحدّ يظهر في ملخّص السياق الذي يعيده Phase-02.
            Ok(found) => found.into_iter().take(16).map(|source| source.source_id).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn list(&self) -> Result<MissionListResult, HostError> {
        Ok(MissionListResult { missions: self.repository.list().map_err(storage_error)? })
    }

    pub fn get(&self, mission_id: &str) -> Result<MissionGetResult, HostError> {
        let snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        Ok(MissionGetResult {
            mission: MissionDetailView::of(&snapshot.mission),
            completion_proof: CompletionProofView::of(&proof_of(&snapshot)),
        })
    }

    /// ينشئ مهمّة في حالة CREATED. الإنشاء لا يشغّل شيئًا.
    pub fn create(&self, input: CreateMissionInput) -> Result<MissionCreateResult, HostError> {
        let mission_id = self.clock.id();
        let created_at = self.clock.now();
        let mission = Mission {
            mission_id: mission_id.clone(),
            project_id: input.project_id,
            title: input.title,
            // العنوان جاء من المستخدم عبر الواجهة. عنوان يولّده نموذج يُوسَم
            // MODEL_GENERATED ولا يصير تعليمة (البند 154).
            title_authority: AuthorityClass::DirectUserInstruction,
            objective: input.objective,
            origin: MissionOrigin::User,
            execution_mode: input.execution_mode,
            priority: input.priority,
            state: MissionState::Created,
            completion_proof_status: CompletionProofStatus::NotEvaluated,
            current_revision: 1,
            root_task_id: None,
            budget: input.budget,
            requirements: input.requirements,
            created_at: created_at.clone(),
            started_at: None,
            completed_at: None,
            result_summary: None,
            failure_reason: None,
            version: 1,
        };
        let snapshot = MissionSnapshot {
            mission,
            graph: super::graph::TaskGraph::new(mission_id.clone()),
            agents: Vec::new(),
            claims: Vec::new(),
            evidence: Vec::new(),
            messages: Vec::new(),
            reviews: Vec::new(),
            runtime: super::runtime_state::RuntimeState::default(),
        };
        self.repository.save(&snapshot).map_err(storage_error)?;
        self.record_audit(AuditEventType::MissionCreated, &mission_id, AuditOutcome::Success, serde_json::json!({}));
        Ok(MissionCreateResult {
            mission_id,
            state: MissionState::Created.as_str(),
            completion_proof_status: CompletionProofStatus::NotEvaluated.as_str(),
            created_at,
        })
    }

    /// يشغّل مهمّة. بلا مسار استدعاء لا تشغيل: لا وكيل زائف في مسار الإنتاج.
    pub fn start(&self, mission_id: &str, session: &str) -> Result<MissionStartResult, HostError> {
        let Some(invocations) = self.invocations.clone() else {
            self.record_audit(AuditEventType::MissionBlocked, mission_id, AuditOutcome::Denied, serde_json::json!({ "reason": "NO_MODEL_ROUTED" }));
            // الرمز من المفردات المغلقة التسع؛ السبب الخاصّ يبقى في التفصيل
            // الداخلي ولا يعبر الحدّ. رمز خارج المفردات يجعل الظرف غير مطابق
            // لعقده، فيرفضه العارضُ كرسالة مشوّهة ويضيع الخطأ الحقيقي.
            return Err(HostError::feature_not_available(
                "no model invocation path is configured for this host; a mission cannot start without one",
            ));
        };
        let snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        if snapshot.mission.state.is_terminal() {
            return Err(HostError::new(
                DesktopErrorCategory::ConfigUnavailable,
                "CONFLICT",
                format!("mission is {} and cannot be started again", snapshot.mission.state.as_str()),
            ));
        }
        // سياسة التلاعب (تكليف 2026-10-12): جلسة سجلّها مكسور لا تُستأنف منه. الاستئناف يعيد بناء المحادثة من السجلّ، وسجلّ
        // عُدّل أو قُصّ قد يُعيد أفعالًا أو يُسقط موافقة. المهمّة تبقى كما هي، والكسر ظاهر في التنبيهات منذ الإقلاع.
        let session_id = self.session_for(mission_id);
        if let ChainCheck::Broken { at_seq, .. } = self.session_log.verify(&session_id) {
            self.record_audit(AuditEventType::TamperDetected, mission_id, AuditOutcome::Denied, serde_json::json!({ "stage": "START", "chain": "SESSION_EVENTS", "at_seq": at_seq }));
            return Err(HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the session log of this mission failed its integrity check; it cannot be resumed from it"));
        }
        self.record_audit(AuditEventType::MissionStarted, mission_id, AuditOutcome::Started, serde_json::json!({}));
        // الحالة الحيّة تُرى أثناء العمل، لا بعده فقط (العارض والشريط الجانبي يقرآن القاعدة).
        let _ = self.repository.mark_started(mission_id, &self.clock.now());

        // التشغيل يُسجَّل قبل أن يبدأ: بلا تسجيل لا يستطيع الإلغاء أن يبلغ ما هو جارٍ.
        let run = self.cancellation.begin(mission_id, session);
        let project_id = snapshot.mission.project_id.clone();

        // الربط يُبنى من المهمّة نفسها: مشروعها وسياستها ومصادرها. لا نقطة نهاية
        // ولا سرّ يعبران هنا؛ التوجيه وبوابة الخروج يبقيان عند Phase-02.
        let mut binding = MissionModelBinding::default_model();
        binding.project_id = project_id.clone();
        binding.context_source_ids = self.context_sources_for(project_id.as_deref());
        binding.native_tools = self.native_tool_calls.load(std::sync::atomic::Ordering::SeqCst);
        binding.mission_thread = self.mission_thread.load(std::sync::atomic::Ordering::SeqCst);
        if let Some(model_id) = self.model_preferences.get().and_then(|p| p.model_for(mission_id)) {
            binding.routing_mode = crate::p02::routing::RoutingMode::Manual;
            binding.model_id = Some(model_id);
        }
        // التوازي (E4): ثلاث خطوات مستقلّة معًا حين يكون نموذج التنفيذ بعيدًا؛ المحلي واحدة في وقت واحد (حماية العتاد).
        binding.parallel_steps = if self.model_preferences.get().and_then(|p| p.executor_is_remote(mission_id)) == Some(true) { 3 } else { 1 };
        // المراجِع المستقلّ (E6): نموذج بعيد اختاره المستخدم، ما لم يكن هو نموذج التنفيذ نفسه.
        binding.review_model_id = self
            .model_preferences
            .get()
            .and_then(|p| p.review_model())
            .filter(|reviewer| binding.model_id.as_deref() != Some(reviewer.as_str()));
        let objective = snapshot.mission.objective.clone();

        // وسيط الأدوات لهذه المهمّة، برمز الإلغاء نفسه الذي يحمله زمن التشغيل.
        let broker = self
            .tools
            .as_ref()
            .map(|factory| factory.broker_for(mission_id, project_id.clone(), run.token.clone()));
        let (offered_skill, offered_tools) = self.offering(broker.as_ref(), &objective);
        let (guide, schemas) = match (&broker, &offered_skill) {
            (Some(b), Some(skill)) => (b.tool_guide(skill), b.tool_schemas(skill)),
            _ => (Vec::new(), Vec::new()),
        };

        let mut model = Phase02AgentModel::new(invocations.clone(), self.clock.clone(), session, binding, objective)
            .with_run(run.clone())
            .offering(offered_skill, offered_tools)
            .with_tool_guide(guide)
            .with_tool_schemas(schemas);
        if let Some(provider) = self.context.clone() {
            model = model.with_context(provider, mission_id, project_id.clone());
        }
        if let Some(source) = self.image_source.get().cloned() {
            model = model.with_images(source, mission_id);
        }

        // اللقطة كلها تُستأنف (R-01): الرسم بمعرّفات عُقده التي تُربط بها الموافقات، والوكلاء والادّعاءات والأدلّة والمراجعات
        // والرسائل وحالة التشغيل التراكمية.
        let existing = snapshot.clone();
        let mut mission = snapshot.mission;
        // وقت البدء وقتُ بدء التشغيل (ما يعدّه «عمل لمدة …»)، لا وقت انتهاء التخطيط: قِيس 2026-10-01 أن
        // «هلا» عملت 79 ثانية وعُرضت 30 لأن الختم كان عند أوّل دخول RUNNING.
        if mission.state == MissionState::Created && mission.started_at.is_none() {
            mission.started_at = Some(self.clock.now());
        }
        let mut runtime = MissionRuntime::new(mission, self.clock.clone(), AgentRegistry::builtin())
            .with_cancel(run.token.clone())
            .with_gate(run.gate.clone());
        if let Some(probe) = self.contract_probe.get().cloned() {
            runtime = runtime.with_contract_probe(probe);
        }
        runtime = runtime.resume_from(&existing);
        // المحادثة (مسار المنتج): ردّ على المستخدم، وخبرة المتخصّصين للعُقد. مسارات Phase-03..07 المغلقة
        // لا تتغيّر موجّهاتها.
        if self.conversations.get().is_some_and(|c| c.is_conversation(mission_id)) {
            let pinned = self.model_preferences.get().and_then(|p| p.specialist_for(mission_id));
            let profile = self.model_preferences.get().and_then(|p| p.user_profile());
            if let Some(policy) = self.conversations.get() {
                runtime = runtime.with_notes(policy.clone());
            }
            runtime = runtime
                .with_user_profile(profile)
                .with_reply()
                .with_specialists(crate::p03::specialist::SpecialistCatalog::builtin(), pinned)
                // المتخصّص المثبَّت يعمل وكيلًا بتعريفه، والمنسّق يفوّض إلى وكيل بمعرّفه (القسم 6).
                .with_agents(crate::p03::agents::AgentDirectory::builtin())
                .with_agent_memory(self.agent_memory.clone())
                .with_agent_loop(self.agent_loop.load(std::sync::atomic::Ordering::SeqCst))
                .with_implicit_route(self.implicit_route.load(std::sync::atomic::Ordering::SeqCst))
                .with_deliverable_facts(self.deliverable_facts.load(std::sync::atomic::Ordering::SeqCst))
                .with_rewrite_note(self.rewrite_note.load(std::sync::atomic::Ordering::SeqCst));
        }
        if let Some(source) = self.trusted_evidence.clone() {
            runtime = runtime.with_trusted_evidence(source);
        }
        // سجلّ الجلسة مصدر المحادثة، والامتدادات لكل وكيل ونداء وأداة (ADR-041 §3.2). المراقب الأعمى بنموذج اختاره المستخدم.
        runtime = runtime.with_session_log(self.session_log.clone(), session_id).with_spans(self.spans.clone());
        if let Some(monitor_model) = self.model_preferences.get().and_then(|p| p.monitor_model()) {
            runtime = runtime.with_monitor(Arc::new(super::model_adapter::InvocationMonitor::new(invocations.clone(), session, monitor_model, self.clock.clone()).with_run(run.clone())));
        }
        if let Some(broker) = broker {
            runtime = runtime.with_tools(broker);
        }
        if let Some(observer) = self.observer.clone() {
            runtime = runtime.with_observer(observer);
        }
        runtime = runtime.with_checkpoint(Arc::new(RepositoryCheckpoint(self.repository.clone()))).with_step_slot(run.step.clone());
        let report = runtime.run(&model);
        // الحالة حُسمت داخل التشغيل عند بوّابة الإلغاء؛ التسجيل يبقى حتى يُحفظ ما حُسم، فلا
        // يكتب مسار «لا تشغيل» حالةً ثانية بجوار هذا الحفظ.
        let executed = runtime.snapshot();
        let saved = self.repository.save(&executed);
        self.cancellation.end(mission_id);
        // فشل الحفظ صنف مستقل (عطل تخزين)، لا يتنكّر في حالة FAILED عادية.
        saved.map_err(storage_error)?;
        // المراقب يُبلَّغ بعد الحفظ: ما يبنيه (ذاكرة حلقة، إغلاق جلسة) يقوم على ما حُفظ فعلًا.
        if let Some(observer) = &self.observer {
            let history = self.contract_probe.get().map(|p| p.tool_history(mission_id)).unwrap_or_default();
            observer.mission_finished(&outcome_note(&executed, &report, history));
        }
        let outcome = match executed.mission.state {
            MissionState::Completed => AuditOutcome::Success,
            MissionState::Cancelled => AuditOutcome::Cancelled,
            MissionState::Failed => AuditOutcome::Failure,
            _ => AuditOutcome::Denied,
        };
        // التدقيق يحمل الحالة والإثبات معًا: إحداهما دون الأخرى تُقرأ خطأً.
        self.record_audit(
            AuditEventType::MissionCompleted,
            mission_id,
            outcome,
            serde_json::json!({
                "state": executed.mission.state.as_str(),
                "completion_proof_status": executed.mission.completion_proof_status.as_str(),
                "model_calls": report.model_calls,
            }),
        );
        Ok(MissionStartResult {
            mission_id: mission_id.to_string(),
            state: executed.mission.state.as_str(),
            completion_proof: CompletionProofView::of(&report.completion_proof),
            report: run_report_view(&report),
        })
    }

    /// يُلغي مهمّة.
    ///
    /// الإلغاء الآن يبلغ ما هو جارٍ: يرفع رمز المهمّة — فتراه بوابة الأدوات وزمن
    /// التشغيل قبل كل خطوة تالية — ثم يُلغي كل استدعاء نموذج قائم عبر مسار Phase-02
    /// نفسه. وحين يكون التشغيل جاريًا لا تُكتب الحالة من هنا: مالك اللقطة هو
    /// التشغيل، وكتابة ثانية بجواره تُنتج سباقًا بين كاتبين.
    pub fn cancel(&self, mission_id: &str) -> Result<MissionCancelResult, HostError> {
        let arbitration = self.cancellation.arbitrate(mission_id, self.clock.now_millis());
        if let CancelArbitration::AlreadyDecided(state) = arbitration {
            // الحالة النهائية حُسمت قبل وصول الإلغاء: تُعاد كما هي، لا «أُلغيت» لم يقع.
            self.record_audit(AuditEventType::MissionCancelled, mission_id, AuditOutcome::Denied, serde_json::json!({ "stage": "AFTER_DECISION", "state": state }));
            return Ok(MissionCancelResult { mission_id: mission_id.to_string(), state });
        }
        if let CancelArbitration::Accepted(run) = arbitration {
            let live = run.live_invocations();
            if let Some(invocations) = &self.invocations {
                for invocation_id in &live {
                    let _ = invocations.cancel(invocation_id, &run.session);
                }
            }
            self.record_audit(
                AuditEventType::MissionCancelled,
                mission_id,
                AuditOutcome::Cancelled,
                serde_json::json!({ "stage": "IN_FLIGHT", "model_calls_cancelled": live.len(), "accepted_at_ms": run.gate.cancel_accepted_at_ms() }),
            );
            // الجلسات القائمة (متصفّح، سطح مكتب) تُغلق الآن، لا حين يلاحظ التشغيل الرمز.
            if let Some(observer) = &self.observer {
                observer.mission_cancelled(mission_id);
            }
            return Ok(MissionCancelResult { mission_id: mission_id.to_string(), state: MissionState::Cancelled.as_str() });
        }
        let mut snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        if snapshot.mission.state.is_terminal() {
            return Ok(MissionCancelResult { mission_id: mission_id.to_string(), state: snapshot.mission.state.as_str() });
        }
        let now = self.clock.now();
        snapshot
            .mission
            .transition_to(MissionState::Cancelled, &now)
            .map_err(|e| HostError::new(
                DesktopErrorCategory::ConfigUnavailable,
                "CONFLICT",
                format!("cannot cancel from {}", e.from.as_str()),
            ))?;
        // الإلغاء لا يُرقّي الإثبات أبدًا، ويُحفظ الحكم بالتعريف نفسه الذي تقرؤه الواجهة (R-03).
        let claims: Vec<&super::claim::Claim> = snapshot.claims.iter().collect();
        let mut proof = super::completion::derive_settled(&snapshot.mission.requirements, &claims, snapshot.mission.state, &[]);
        proof.status = CompletionProofStatus::NotProven;
        snapshot.mission.completion_proof_status = CompletionProofStatus::NotProven;
        snapshot.runtime.proof = Some(proof);
        self.repository.save(&snapshot).map_err(storage_error)?;
        self.record_audit(AuditEventType::MissionCancelled, mission_id, AuditOutcome::Cancelled, serde_json::json!({}));
        if let Some(observer) = &self.observer {
            observer.mission_cancelled(mission_id);
        }
        Ok(MissionCancelResult { mission_id: mission_id.to_string(), state: snapshot.mission.state.as_str() })
    }

    /// دور محجوب تجاوزته المحادثة برسالة جديدة: خطواته المفتوحة والمنقطعة تُغلق بسبب مكتوب وحدث تدقيق (E-3). لا يشغّل شيئًا.
    pub fn close_superseded(&self, mission_id: &str) -> u32 {
        let closed = self.repository.close_superseded_steps(mission_id).unwrap_or(0);
        if closed > 0 {
            self.record_audit(AuditEventType::StateInvariantRepaired, mission_id, AuditOutcome::Success, serde_json::json!({ "stage": "SUPERSEDED_TURN", "mission_state": "BLOCKED", "steps_closed": closed }));
        }
        closed
    }

    /// يستأنف مهمّة تركها إقلاعٌ محجوبة. لا يُعيد تشغيل أثر جانبي مكتمل.
    pub fn resume(&self, mission_id: &str) -> Result<MissionResumeResult, HostError> {
        let recovery: RecoveryReport = self.repository.recover_after_restart().map_err(storage_error)?;
        let snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        Ok(MissionResumeResult {
            mission_id: mission_id.to_string(),
            state: snapshot.mission.state.as_str(),
            tasks_interrupted: recovery.tasks_interrupted,
        })
    }

    pub fn tasks(&self, mission_id: &str) -> Result<TaskListResult, HostError> {
        let snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        Ok(TaskListResult {
            mission_id: mission_id.to_string(),
            graph_revision: snapshot.graph.revision,
            tasks: snapshot.graph.nodes().map(TaskView::of).collect(),
            ready: super::view::ready_ids(&snapshot.graph, snapshot.mission.priority),
        })
    }

    /// أوصاف الأدوار دائمًا، وأمثلة الوكلاء لمهمّة مُسمّاة فقط: لا تسرّب عبر المهام.
    pub fn agents(&self, mission_id: Option<&str>) -> Result<AgentListResult, HostError> {
        let roles = self.registry.descriptors().iter().map(AgentRoleView::of).collect();
        let instances = match mission_id {
            Some(id) => self.repository.load(id).map_err(storage_error)?.agents.iter().map(AgentView::of).collect(),
            None => Vec::new(),
        };
        Ok(AgentListResult { roles, instances })
    }

    pub fn claims(&self, mission_id: &str) -> Result<ClaimListResult, HostError> {
        let snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        Ok(ClaimListResult { mission_id: mission_id.to_string(), claims: snapshot.claims.iter().map(ClaimView::of).collect() })
    }

    pub fn evidence(&self, mission_id: &str) -> Result<EvidenceListResult, HostError> {
        let snapshot = self.repository.load(mission_id).map_err(storage_error)?;
        Ok(EvidenceListResult { mission_id: mission_id.to_string(), evidence: snapshot.evidence.iter().map(EvidenceView::of).collect() })
    }

    /// المهارة المعروضة وأدواتها. تُقرأ من الوسيط، فلا يعرف Phase-03 سجلًّا بعينه.
    /// G-02-1 (2026-10-20): في مسار الرسم بلا `load_tools`، فتُعرض الأدوات الأساسية وما يدلّ عليه الطلب (`tool_selection`). حلقة
    /// الوكيل تبني قائمتها بنفسها من الوسيط ولا تقرأ هذه.
    fn offering(&self, broker: Option<&Arc<dyn super::port::ToolBroker>>, objective: &str) -> (Option<String>, Vec<String>) {
        let Some(broker) = broker else {
            return (None, Vec::new());
        };
        match broker.default_skill() {
            Some(skill) => {
                let tools = super::tool_selection::offered_ids(broker.tools_for(&skill), objective);
                (Some(skill), tools)
            }
            None => (None, Vec::new()),
        }
    }

    fn record_audit(&self, event: AuditEventType, mission_id: &str, outcome: AuditOutcome, detail: serde_json::Value) {
        // فشل التدقيق لا يُسقط العملية، لكنه لا يُبتلع صامتًا: المصدر يبقى في القاعدة.
        let _ = self.audit.append(&AuditRecord::new(event, "mission", mission_id, outcome, detail));
    }
}

/// نقطة الاستئناف بالمخزن (E2): الحفظ نفسه الذي يكتب نهاية التشغيل، في معاملة واحدة. فشله يعود إلى زمن التشغيل فيقف المسار
/// قبل الأثر التالي (R-06، 2026-10-12)، بدل أن يستمرّ التنفيذ بلا نقطة يُستأنف منها.
struct RepositoryCheckpoint(Arc<MissionRepository>);

impl crate::p03::runtime::RunCheckpoint for RepositoryCheckpoint {
    fn save(&self, snapshot: &MissionSnapshot) -> Result<(), String> {
        self.0.save(snapshot).map_err(|e| e.to_string())
    }
}

fn run_report_view(report: &RunReport) -> RunReportView {
    use super::runtime::{ReviewIndependence, StopReason};
    RunReportView {
        mission_state: report.mission_state.as_str(),
        tasks_succeeded: report.tasks_succeeded as u32,
        tasks_failed: report.tasks_failed as u32,
        tasks_blocked: report.tasks_blocked as u32,
        model_calls: report.model_calls,
        total_tokens: report.total_tokens,
        claims: report.claims as u32,
        verified_claims: report.verified_claims as u32,
        tool_proposals: report.tool_proposals,
        tool_calls_executed: report.tool_calls_executed,
        tool_calls_denied: report.tool_calls_denied,
        tool_calls_awaiting_approval: report.tool_calls_awaiting_approval,
        delegations_requested: report.delegations_requested,
        delegations_executed: report.delegations_executed,
        agent_messages: report.agent_messages,
        review_independence: match report.review_independence {
            ReviewIndependence::NotReviewed => "NOT_REVIEWED",
            ReviewIndependence::SameModelReview => "SAME_MODEL_REVIEW",
            ReviewIndependence::IndependentModelReview => "INDEPENDENT_MODEL_REVIEW",
        },
        stop_reason: report.stop_reason.as_ref().map(|s| match s {
            StopReason::NoProgress => "NO_PROGRESS",
            StopReason::BudgetExhausted(_) => "BUDGET_EXHAUSTED",
            StopReason::ModelOutputInvalid(_) => "MODEL_OUTPUT_INVALID",
            StopReason::NoModelRouted(_) => "NO_MODEL_ROUTED",
            StopReason::GraphInvalid(_) => "TASK_GRAPH_INVALID",
            StopReason::Cancelled => "MISSION_CANCELLED",
            StopReason::DeadlineExceeded => "DEADLINE_EXCEEDED",
            StopReason::ProviderUnavailable(_) => "PROVIDER_UNAVAILABLE",
            StopReason::ProviderCreditExhausted(_) => "PROVIDER_CREDIT_EXHAUSTED",
            StopReason::DeliverablesIncomplete(_) => "DELIVERABLES_INCOMPLETE",
            StopReason::TasksBlocked(_) => "TASKS_BLOCKED",
            StopReason::TasksFailed(_) => "TASKS_FAILED",
            StopReason::RepeatedDenials(_) => "REPEATED_DENIALS",
            StopReason::TamperDetected(_) => "TAMPER_DETECTED",
            StopReason::StorageFailure(_) => "STORAGE_FAILURE",
        }),
    }
}

/// ملاحظة نهاية التشغيل لمراقب المهمّة: حالات وأعداد ومعرّفات، ونصوص الادّعاءات كما
/// هي (نصّ نموذج). الأدلّة المؤيّدة تُذكر بنوعها ومرجعها لا بمحتواها.
fn outcome_note(snapshot: &MissionSnapshot, report: &RunReport, tool_history: Vec<super::port::ToolRecordNote>) -> MissionOutcomeNote {
    let claims = snapshot
        .claims
        .iter()
        .map(|claim| ClaimNote {
            claim_id: claim.claim_id.clone(),
            task_id: claim.task_id.clone(),
            statement: claim.statement.clone(),
            claim_type: claim.claim_type,
            status: claim.status.as_str(),
            subject: claim.subject.clone(),
            supporting: claim
                .evidence_refs
                .iter()
                .filter_map(|id| snapshot.evidence.iter().find(|e| &e.evidence_id == id))
                .map(|e| EvidenceNote {
                    evidence_id: e.evidence_id.clone(),
                    evidence_type: e.evidence_type,
                    source_ref: e.provenance.source_ref.clone(),
                    measured: e.evidence_type.is_measured(),
                })
                .collect(),
        })
        .collect();
    MissionOutcomeNote {
        mission_id: snapshot.mission.mission_id.clone(),
        project_id: snapshot.mission.project_id.clone(),
        title: snapshot.mission.title.clone(),
        state: snapshot.mission.state.as_str(),
        terminal: snapshot.mission.state.is_terminal(),
        proof_status: report.completion_proof.status.as_str(),
        tasks_succeeded: report.tasks_succeeded as u32,
        tasks_failed: report.tasks_failed as u32,
        tasks_blocked: report.tasks_blocked as u32,
        tool_calls_executed: report.tool_calls_executed,
        claims,
        tool_history,
    }
}

/// الإثبات كما يُقرأ بعد إعادة التشغيل (R-03، 2026-10-12): التعريف نفسه الذي حسم به الإنهاء (`derive_settled`)، بحواجز المُنسِّق
/// التي حُفظت معه وحالة المهمّة. وصفّ مهمّة حُسم غير مُثبَت لا يُعرض مُثبَتًا أبدًا، ولو اشتُقّ من صفوف أقدم بلا حالة تشغيل
/// محفوظة: الحاجز يقول ذلك صراحةً.
fn proof_of(snapshot: &MissionSnapshot) -> CompletionProof {
    let claims: Vec<&super::claim::Claim> = snapshot.claims.iter().collect();
    let mut blockers = snapshot.runtime.proof.as_ref().map(super::completion::runtime_blockers_of).unwrap_or_default();
    let stored = snapshot.mission.completion_proof_status;
    if stored == CompletionProofStatus::NotProven && !blockers.iter().any(|b| matches!(b, super::completion::Blocker::ExecutionIncomplete(_) | super::completion::Blocker::CriticalPolicyViolation(_))) {
        blockers.push(super::completion::Blocker::ExecutionIncomplete("NOT_PROVEN_AT_SETTLEMENT".into()));
    }
    super::completion::derive_settled(&snapshot.mission.requirements, &claims, snapshot.mission.state, &blockers)
}

/// يحوّل خطأ المخزن إلى خطأ حدّ بلا تفصيل داخلي.
fn storage_error(error: StorageError) -> HostError {
    match error {
        // المهمّة المسمّاة غير موجودة: الطلب سمّى ما لا وجود له، والمؤشّر يقول أين.
        StorageError::NotFound => HostError::validation("mission not found").at("/mission_id"),
        StorageError::Conflict => HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "version conflict"),
        StorageError::SchemaTooNew { .. } => HostError::new(
            DesktopErrorCategory::ConfigUnavailable,
            "DEPENDENCY_UNAVAILABLE",
            "the local database is newer than this build supports",
        ),
        other => HostError::internal(format!("phase-03 storage: {other}")),
    }
}
