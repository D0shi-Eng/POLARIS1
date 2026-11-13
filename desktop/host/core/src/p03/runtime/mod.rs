// زمن تشغيل المهمّة: المُنسِّق الذي يربط القطع دون أن يملك منطقها.
//
// لا خدمة ضخمة هنا (البند 37): الجدولة في `graph`، والميزانية في `budget`، وكشف
// الحلقات في `loopguard`، والتحقق في `verification`، والإثبات في `completion`.
// هذا الملف يرتّب النداءات ويحفظ الحالة. كل مخرجات النموذج تدخل مُلوَّثة وتُتحقَّق
// قبل أي استعمال، ولا يصير نصّ مخرجات أمرًا مهما قال.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;

use polaris_host_providers::net::CancelToken;

use super::agent::{AgentInstance, AgentRegistry, AgentRole, AgentState};
use super::cancel::RunGate;
use super::contract::MissionExecutionContract;
use super::fulfilment::{self, RequirementCheck};
use super::handoff::TaskReport;
use super::recovery;
use super::repository::MissionSnapshot;
use super::specialist::{Specialist, SpecialistCatalog, SHORTLIST};
use super::retry::{wait_unless_cancelled, TransientLedger, TransientPolicy};
use super::budget::{BudgetDenied, BudgetLedger};
use super::delegation::{DelegationController, DelegationDecision, DelegationRequest};
use super::message::{AgentMessage, MessageBus, MessageType, Recipient};
use super::claim::{Claim, ClaimStatus, ClaimType};
use super::clock::RuntimeClock;
use super::completion::{Blocker, CompletionProof};
use super::conflict::find_conflicts;
use super::evidence::{EvidenceItem, EvidenceType, MeasurementKind, Provenance};
use super::graph::{uniform_priority, GraphError, GraphMutation, ProposedEdge, TaskGraph};
use super::loopguard::{LoopGuard, Progress};
use super::mission::{CompletionProofStatus, Mission, MissionState, RequirementStatus};
use super::port::{
    ContractProbe, NarrationKind, NarrationNote, ReplyInput, ReviewInput, TaskContextSections, TaskExecution, ToolTurn,
    AgentModel, CallFacts, EvidenceStance, MissionObserver, ModelError, ReviewVerdict, TaskOutcomeNote, ToolBroker, ToolDecision, ToolRequest,
    TrustedEvidenceSource,
};
use super::task::{DependencyKind, TaskNode, TaskState, TaskType};
use super::trust::{AuthorityClass, Taint, TaintFlag};
use super::verification::{verify, VerificationRule};

/// أقصى مرّات انتظار تحديد المعدّل في مهمّة واحدة.
const MAX_RATE_WAITS: u32 = 40;

/// مهلة الانتظار لإخفاق بتحديد معدّل: ما قاله المزوّد بين ثانية و90 ثانية، وإلا 15 ثانية؛ وثانيتان بعد 413. لا شيء لغيرهما.
fn rate_limit_wait(code: &str) -> Option<std::time::Duration> {
    // طلب أكبر مما يقبله المزوّد الآن (413): نُصِّف سقف مخرجاته قبل الإعادة، فتكفي مهلة قصيرة.
    if code == "REQUEST_TOO_LARGE" {
        return Some(std::time::Duration::from_millis(2_000));
    }
    let rest = code.strip_prefix(crate::p03::model_adapter::RATE_LIMITED)?;
    let ms = rest.strip_prefix(':').and_then(|v| v.parse::<u64>().ok()).unwrap_or(15_000);
    Some(std::time::Duration::from_millis(ms.clamp(1_000, 90_000)))
}

/// المهلة التي طلبها المزوّد بالمللي ثانية قبل أي قصّ، إن قالها (`RATE_LIMITED:<ms>`).
fn rate_limit_requested_ms(code: &str) -> Option<u64> {
    code.strip_prefix(crate::p03::model_adapter::RATE_LIMITED)?.strip_prefix(':')?.parse::<u64>().ok()
}

/// G2 (2026-10-14): اختيار وكيل بمعرّفه في تفويض: القائمة التي عُرضت على المنسّق، والمعرّف الذي طلبه، وهل قبله المضيف.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentSelection {
    pub offered: Vec<String>,
    pub chosen: Option<String>,
    pub accepted: bool,
}

/// محاولة نداء أولى جرت خارج النداء المحروس (G4: في خيط فرع تفويض)، بمقعد محجوز قبلها.
pub(super) struct FirstAttempt<T> {
    pub(super) outcome: Result<T, ModelError>,
    pub(super) started_at: String,
    pub(super) latency_ms: u64,
}

/// عقدة بدأت ولم تُتمّ (E4).
struct Begun {
    task_id: String,
    node: TaskNode,
    role: AgentRole,
    agent_id: String,
}

mod agentic;
mod agents;
mod delegation;
mod finish;
mod layers;
mod review;
mod step;
mod support;
mod tools;

pub use agentic::MAX_PARALLEL_DELEGATIONS;
pub use agents::CANDIDATE_AGENTS;

use support::*;

/// لماذا توقّف التنفيذ قبل نهايته الطبيعية. مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "code", content = "detail")]
pub enum StopReason {
    NoProgress,
    BudgetExhausted(BudgetDenied),
    ModelOutputInvalid(String),
    NoModelRouted(String),
    GraphInvalid(String),
    Cancelled,
    DeadlineExceeded,
    /// المزوّد لم يُكمل النداء بعد الإعادات المحدودة (Phase-08). ليس عيب مخرجات.
    ProviderUnavailable(String),
    /// رصيد حساب المزوّد لا يكفي (402، 2026-11-13). التفصيل `<المطلوب>:<المتاح>` بالرموز. لا إعادة: الإعادة لا تزيد الرصيد.
    ProviderCreditExhausted(String),
    /// انتهى التنفيذ ومخرجات مطلوبة في عقد المهمّة غائبة بعد الاستكمال المحدود (Phase-08).
    DeliverablesIncomplete(String),
    /// انتهى التنفيذ وعقدة أو أكثر محجوبة (مراجعة لم تُقبل، أو جولات مراجعة نفدت). المهمّة لا تُعلَن
    /// مكتملة وعملها لم يُقبل (قِيس 2026-10-05). التفصيل عناوين العقد المحجوبة.
    TasksBlocked(String),
    /// انتهى التنفيذ وعقدة أو أكثر فاشلة. التفصيل عناوينها وسبب كلٍّ المقيس إن عُرف.
    TasksFailed(String),
    /// رُفض النمط نفسه ثلاث مرات في المهمّة (خطة 2026-10-07، ADR-041؛ OpenAI Auto-review): المسار يقف ويطلب المستخدم.
    RepeatedDenials(String),
    /// ملف محميّ (ما أرفقه المستخدم، أو اختبار مرجعي) تغيّر في المساحة (ADR-041 §3.4): النتيجة مرفوضة مهما قال الوكيل.
    TamperDetected(String),
    /// تعذّرت كتابة ما تحتاجه الاستعادة (سجلّ الجلسة أو نقطة الاستئناف) (R-06، 2026-10-12). المسار يقف قبل أي أثر جانبي تالٍ:
    /// أثرٌ لا يُستعاد سجلّه يتكرّر أو يضيع عند الاستئناف. التفصيل ما قاله المخزن، بلا محتوى المهمّة.
    StorageFailure(String),
}

/// حكم مراجعة واحد كما صدر: يُحفظ في جدول المراجعات، فيُرى بعد التشغيل لا في الذاكرة وحدها
/// (قِيس 2026-10-05: الجدول بلا صفّ واحد رغم مراجعات REVISE حدثت فعلًا).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReviewRecord {
    pub review_id: String,
    pub task_id: String,
    pub reviewer_agent: String,
    /// ACCEPT أو REVISE أو REJECT أو BLOCKED.
    pub verdict: &'static str,
    pub independence: &'static str,
    pub round: u32,
    pub notes: String,
    pub created_at: String,
}

/// هل كانت المراجعة بنموذج مستقل؟ لا تُسمّى مستقلّة إن كان النموذج نفسه (البند 150).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewIndependence {
    NotReviewed,
    SameModelReview,
    IndependentModelReview,
}

/// أقصى جولات أدوات لمهمّة فرعية واحدة (Phase-08). حدّ ثابت فوق ميزانية النداءات: لا حلقة بلا نهاية.
pub const MAX_TOOL_ROUNDS: usize = 12;

/// أقصى جولات أدوات لزميل مفوَّض (Phase-08): مهمّته محدودة بطبيعتها، وجولاته من ميزانية المهمّة نفسها.
pub const MAX_DELEGATE_ROUNDS: usize = 4;


/// خلاصة تشغيل واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RunReport {
    pub mission_state: MissionState,
    pub completion_proof: CompletionProof,
    pub tasks_succeeded: usize,
    pub tasks_failed: usize,
    pub tasks_blocked: usize,
    pub model_calls: u64,
    pub total_tokens: u64,
    pub claims: usize,
    pub verified_claims: usize,
    pub review_independence: ReviewIndependence,
    /// أدوات اقترحها الوكلاء، وما عبر منها البوابة فعلًا، وما مُنع.
    pub tool_proposals: u32,
    pub tool_calls_executed: u32,
    pub tool_calls_denied: u32,
    pub tool_calls_awaiting_approval: u32,
    /// تفويضات طُلبت وتفويضات نُفِّذت فعلًا بوكيل ثانٍ.
    pub delegations_requested: u32,
    pub delegations_executed: u32,
    pub agent_messages: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<StopReason>,
}

/// زمن تشغيل مهمّة واحدة. مالك واحد لكل مهمّة (البند 142).
pub struct MissionRuntime {
    mission: Mission,
    graph: TaskGraph,
    agents: Vec<AgentInstance>,
    claims: Vec<Claim>,
    evidence: Vec<EvidenceItem>,
    budget: BudgetLedger,
    guard: LoopGuard,
    clock: RuntimeClock,
    registry: AgentRegistry,
    /// منفذ الأدلّة المقيسة. غيابه يعني صدقًا: لا قياس في هذه المهمّة.
    trusted_evidence: Option<Arc<dyn TrustedEvidenceSource>>,
    policy_violations: Vec<String>,
    stop_reason: Option<StopReason>,
    review_independence: ReviewIndependence,
    cancelled: bool,
    /// رمز إلغاء مشترك مع بوابة الأدوات ومسار الاستدعاء. غيابه يعني اختبارًا
    /// لا إلغاء فيه، لا إلغاءً معطّلًا.
    cancel: Option<CancelToken>,
    /// وسيط الأدوات. غيابه يعني أن لا أداة في هذا المضيف، فكل اقتراح يُرفض صراحةً.
    tools: Option<Arc<dyn ToolBroker>>,
    tool_decisions: Vec<ToolDecision>,
    /// الوكيل الذي طلب كل قرار في `tool_decisions` (بالموضع نفسه). جولات الوكيل ترى نتائج أدواته هو، لا
    /// أدوات زميل فوّضه: نتيجة الزميل تصله ملخّصًا مرة واحدة.
    decision_owners: Vec<String>,
    tool_proposals: u32,
    /// ناقل رسائل الوكلاء لهذه المهمّة. مسار التفويض يمرّ به فعلًا.
    bus: MessageBus,
    delegations_requested: u32,
    delegations_executed: u32,
    /// العُقد التي توقّفت لأن أداةً تحتاج قرارًا بشريًّا. تبقى منتظرة، ولا تُعلَن
    /// ناجحة: عقدة «نجحت» بعد أن مُنعت أداتها تُقرأ إنجازًا وهي ليست كذلك.
    awaiting_approval: Vec<String>,
    /// مراقب دورة الحياة (Phase-05). يقرأ ما انتهى، ولا يغيّر شيئًا في المهمّة.
    observer: Option<Arc<dyn MissionObserver>>,
    /// طابور رسائل المستخدم أثناء العمل (ADR-042). غيابه: لا رسائل تُسلَّم.
    notes: Option<Arc<dyn crate::p03::port::ConversationPolicy>>,
    /// نقطة الاستئناف (خطة 2026-10-05، E2): تُحفظ لقطة المهمّة بعد التخطيط وبعد كل خطوة.
    checkpoint: Option<Arc<dyn RunCheckpoint>>,
    /// ملخّص مخرجات كل مهمّة نُفّذت في هذا التشغيل، لتُسلَّم إلى المهامّ المعتمدة عليها (Phase-08).
    task_outputs: std::collections::HashMap<String, String>,
    /// سبب فشل كل عقدة كما قاسه وقت التشغيل (كتابة رُفضت مثلًا)، ليُقال في سبب إخفاق المهمّة.
    task_failures: std::collections::BTreeMap<String, String>,
    reviews: Vec<ReviewRecord>,
    /// بوّابة الحسم المشتركة مع مسار الإلغاء (Phase-08).
    gate: Option<RunGate>,
    step_slot: Option<Arc<std::sync::Mutex<Option<String>>>>,
    /// سياسة الإخفاقات العابرة وعدّادها (Phase-08).
    transient_policy: TransientPolicy,
    transient: TransientLedger,
    /// منفذ قياس العقد. غيابه (أو منفذ نموذج بلا ضوابط) يُبقي السلوك المغلق.
    probe: Option<Arc<dyn ContractProbe>>,
    recovery: bool,
    contract: MissionExecutionContract,
    contract_checks: Vec<RequirementCheck>,
    task_reports: std::collections::HashMap<String, TaskReport>,
    continuations: u32,
    plan_repairs: u32,
    reminders: std::collections::HashMap<String, u32>,
    /// للمهمّة محادثة (Phase-08): تنتهي بردّ موجَّه إلى المستخدم بلغته بدل آخر تقرير خطوة.
    reply_enabled: bool,
    /// كتالوج المتخصّصين، ومتخصّص ثبّته المستخدم للمهمّة إن وُجد. بلا كتالوج تعمل العُقد بتعليمة
    /// الدور وحدها كما كانت.
    specialists: Option<&'static SpecialistCatalog>,
    pinned_specialist: Option<String>,
    /// ما كتبه المستخدم عن نفسه في «تخصيص»، يدخل تعليمة النظام لحلقة الوكيل.
    user_profile: Option<String>,
    /// معرّفات القائمة القصيرة التي عُرضت على المخطّط. اقتراحه يُقبل منها وحدها.
    offered_specialists: Vec<String>,
    /// الدور الذي اقترحه المخطّط لكل عقدة (Phase-08). يُقبل إن كان مفعّلًا ويجيز نوع العقدة، وإلا فدور النوع.
    /// قِيس 2026-10-01 أن الاقتراح كان يُقرأ ثم يُهمَل.
    planned_roles: std::collections::HashMap<String, AgentRole>,
    /// عُقد وصلتها نتيجة زميل فوّضته ولم ترها بعد (Phase-08): تُمنح جولة متابعة تقرأ فيها النتيجة.
    delegated_results: std::collections::HashSet<String>,
    /// تُشغَّل المهمّة بحلقة الوكيل (ADR-039) بدل مسار الرسم، حين يدعمها المنفذ.
    agent_loop: bool,
    /// W-1: استدعاء عمل قبل قرار التوجيه يُنفَّذ ويُعدّ «أعمل بنفسي» بدل رفضه.
    implicit_route: bool,
    /// RW-A: نتيجة التفويض تحمل حقائق الملفات التي كتبها المفوَّض كما قاسها المضيف.
    deliverable_facts: bool,
    /// RW-B: نتيجة الكتابة تحمل ملاحظة حين لا تغيّر الملف أو حين يتكرّر المسار نفسه.
    rewrite_note: bool,
    /// كتابات المهمّة لكل مسار ووكيل، لـRW-A وRW-B.
    write_ledger: crate::p03::output_facts::WriteLedger,
    /// W-2: قراءات المهمّة الكاملة، لحقيقة إعادة القراءة.
    read_ledger: crate::p03::output_facts::ReadLedger,
    /// W-2: أكبر نسبة رموز حقيقية إلى تقدير التوجيه في المهمّة، بالألف (1000 = مطابق). تقسم النافذة قبل حدّ الضغط.
    token_ratio: u32,
    /// W-2: سقف ناتج الأداة للحلقة التي تنفّذ الاستدعاء الآن (يُضبط قبل كل استدعاء من حدّ نافذتها).
    result_cap: crate::p03::agent_loop::ResultCap,
    /// عُقد خطة الوكيل بترتيبها تحت الجذر.
    loop_plan: Vec<String>,
    /// سمّت الخطة الطلب، فلا نداء عنوان.
    loop_titled: bool,
    /// مرّات انتظار تحديد المعدّل في هذه المهمّة (2026-10-06). تُعدّ وحدها، بحدّ، ولا تأكل إعادات الأعطال العابرة.
    rate_waits: u32,
    /// الخطوة التي نُسب إليها كل قرار في `tool_decisions` (بالموضع نفسه): خطوة لا تصير SUCCEEDED بلا أداة نجحت لها.
    decision_tasks: Vec<String>,
    /// PHASE-09: كم جولة تفويض جرت فروعها معًا فعلًا. ادّعاء «بالتوازي» في الردّ يُقاس بها.
    parallel_rounds: usize,
    /// سجلّ الجلسة ومعرّفها (خطة 2026-10-07، ADR-041 §3.2): مصدر المحادثة والاستئناف.
    session: Option<(Arc<dyn crate::p03::watch::session::SessionLog>, String)>,
    /// الامتدادات، وامتداد كل وكيل بمعرّفه.
    spans: Option<Arc<dyn crate::p03::watch::spans::SpanSink>>,
    agent_spans: std::collections::HashMap<String, crate::p03::watch::spans::SpanRecord>,
    /// المراقب الأعمى، إن اختار المستخدم له نموذجًا.
    monitor: Option<Arc<dyn crate::p03::watch::monitor::ActionMonitor>>,
    security_events: Vec<crate::p03::security::SecurityEvent>,
    /// رفضات كل نمط (الأداة وسبب الرفض) في هذه المهمّة.
    denial_counts: std::collections::HashMap<String, u32>,
    rule_of_two: crate::p03::trust::rule_of_two::RuleOfTwo,
    /// الوكيل الذي يعمل الآن، لينسب إليه زمن التشغيل امتدادات النداءات.
    active_agent: Option<String>,
    /// امتدادات `chat` لمحاولات جرت ولم تُكتب بعد: تنتظر حقائق مسار الاستدعاء.
    pending_chat: Vec<crate::p03::watch::spans::SpanRecord>,
    /// دورات الحلقة الرئيسة تراكميًّا عبر التشغيلات (تنبيه «دورات فوق المتوقّع»).
    loop_turns: u32,
    /// أول عطل كتابة لما تحتاجه الاستعادة (R-06). يُفحص قبل كل نداء نموذج وكل أداة، فيقف المسار بسبب صريح.
    storage_fault: std::sync::Mutex<Option<String>>,
    /// كتابات امتدادات فشلت: سياسة التتبّع أنه لا يوقف المهمّة، لكنه يُعدّ ويُحفظ ويُبلَّغ مرّة.
    telemetry_failures: std::sync::atomic::AtomicU32,
    /// التشغيلات التي جرت لهذه المهمّة قبل هذا التشغيل، والإثبات المحسوم عند آخر إنهاء.
    prior_runs: u32,
    settled_proof: Option<CompletionProof>,
    /// دليل الوكلاء الـ300 وذاكرتهم (القسم 6). بلا دليل تعمل الحلقة بلا وكلاء معرَّفين كما كانت.
    agent_directory: Option<&'static crate::p03::agents::AgentDirectory>,
    agent_memory: Option<Arc<dyn crate::p03::agents::memory::AgentMemoryPort>>,
    /// تعريف كل مثيل يعمل بتعريف، ونداءات أدواته، وأحكام مصحِّح العقد.
    instance_definitions: std::collections::HashMap<String, &'static crate::p03::agents::AgentDefinition>,
    agent_tool_calls: std::collections::HashMap<String, u32>,
    agent_grades: Vec<crate::p03::agents::grader::AgentGrade>,
    /// G2: الوكلاء المرشحون الذين عُرضوا على المنسّق لهذا الطلب، بترتيبهم. التفويض بمعرّف خارجها يُرفض.
    offered_agents: Vec<String>,
    /// G2: كل اختيار وكيل بمعرّفه في هذا التشغيل: ما عُرض، وما اختير، وهل قُبل.
    agent_selections: Vec<AgentSelection>,
}



impl MissionRuntime {
    pub fn new(mission: Mission, clock: RuntimeClock, registry: AgentRegistry) -> Self {
        let started = clock.now_millis();
        let budget = BudgetLedger::new(mission.budget.clone(), started);
        let graph = TaskGraph::new(mission.mission_id.clone());
        let bus = MessageBus::new(mission.mission_id.clone());
        Self {
            mission,
            graph,
            agents: Vec::new(),
            claims: Vec::new(),
            evidence: Vec::new(),
            budget,
            guard: LoopGuard::conservative(),
            clock,
            registry,
            trusted_evidence: None,
            policy_violations: Vec::new(),
            stop_reason: None,
            review_independence: ReviewIndependence::NotReviewed,
            cancelled: false,
            cancel: None,
            tools: None,
            tool_decisions: Vec::new(),
            decision_owners: Vec::new(),
            tool_proposals: 0,
            bus,
            delegations_requested: 0,
            delegations_executed: 0,
            awaiting_approval: Vec::new(),
            observer: None,
            notes: None,
            checkpoint: None,
            task_outputs: std::collections::HashMap::new(),
            task_failures: std::collections::BTreeMap::new(),
            reviews: Vec::new(),
            gate: None,
            step_slot: None,
            transient_policy: TransientPolicy::product(),
            transient: TransientLedger::default(),
            probe: None,
            recovery: false,
            contract: MissionExecutionContract::default(),
            contract_checks: Vec::new(),
            task_reports: std::collections::HashMap::new(),
            continuations: 0,
            plan_repairs: 0,
            reminders: std::collections::HashMap::new(),
            reply_enabled: false,
            specialists: None,
            pinned_specialist: None,
            user_profile: None,
            offered_specialists: Vec::new(),
            planned_roles: std::collections::HashMap::new(),
            delegated_results: std::collections::HashSet::new(),
            agent_loop: false,
            implicit_route: false,
            deliverable_facts: false,
            rewrite_note: false,
            write_ledger: crate::p03::output_facts::WriteLedger::default(),
            read_ledger: crate::p03::output_facts::ReadLedger::default(),
            token_ratio: 1_000,
            result_cap: crate::p03::agent_loop::ResultCap::Chars(crate::p03::agent_loop::RESULT_CHARS),
            loop_plan: Vec::new(),
            loop_titled: false,
            rate_waits: 0,
            decision_tasks: Vec::new(),
            parallel_rounds: 0,
            session: None,
            spans: None,
            agent_spans: std::collections::HashMap::new(),
            monitor: None,
            security_events: Vec::new(),
            denial_counts: std::collections::HashMap::new(),
            rule_of_two: Default::default(),
            active_agent: None,
            pending_chat: Vec::new(),
            loop_turns: 0,
            storage_fault: std::sync::Mutex::new(None),
            telemetry_failures: std::sync::atomic::AtomicU32::new(0),
            prior_runs: 0,
            settled_proof: None,
            agent_directory: None,
            agent_memory: None,
            instance_definitions: std::collections::HashMap::new(),
            agent_tool_calls: std::collections::HashMap::new(),
            agent_grades: Vec::new(),
            offered_agents: Vec::new(),
            agent_selections: Vec::new(),
        }
    }

    /// يربط دليل الوكلاء الـ300: المتخصّص المثبَّت يعمل بتعريفه، والمنسّق يستطيع التفويض إلى وكيل بمعرّفه.
    pub fn with_agents(mut self, directory: &'static crate::p03::agents::AgentDirectory) -> Self {
        self.agent_directory = Some(directory);
        self
    }

    /// يربط ذاكرة الوكلاء بنطاق هوياتهم.
    pub fn with_agent_memory(mut self, memory: Arc<dyn crate::p03::agents::memory::AgentMemoryPort>) -> Self {
        self.agent_memory = Some(memory);
        self
    }

    /// سجلّ الجلسة مصدرًا للمحادثة (ADR-041 §3.2). بلا سجلّ تعمل الحلقة كما كانت: محادثة في الذاكرة وحدها.
    pub fn with_session_log(mut self, log: Arc<dyn crate::p03::watch::session::SessionLog>, session_id: impl Into<String>) -> Self {
        self.session = Some((log, session_id.into()));
        self
    }

    /// امتدادات التتبّع (ADR-041 §3.2).
    pub fn with_spans(mut self, sink: Arc<dyn crate::p03::watch::spans::SpanSink>) -> Self {
        self.spans = Some(sink);
        self
    }

    /// المراقب الأعمى للطبقة 3 (ADR-041 §3.2).
    pub fn with_monitor(mut self, monitor: Arc<dyn crate::p03::watch::monitor::ActionMonitor>) -> Self {
        self.monitor = Some(monitor);
        self
    }

    /// أحداث الأمن التي سجّلها هذا التشغيل.
    pub fn security_events(&self) -> &[crate::p03::security::SecurityEvent] {
        &self.security_events
    }

    /// تشغيل المهمّة بحلقة الوكيل (ADR-039) حين يدعمها المنفذ. بلا هذا يبقى مسار الرسم كما أُغلق.
    pub fn with_agent_loop(mut self, enabled: bool) -> Self {
        self.agent_loop = enabled;
        self
    }

    pub fn with_implicit_route(mut self, enabled: bool) -> Self {
        self.implicit_route = enabled;
        self
    }

    pub fn with_deliverable_facts(mut self, enabled: bool) -> Self {
        self.deliverable_facts = enabled;
        self
    }

    pub fn with_rewrite_note(mut self, enabled: bool) -> Self {
        self.rewrite_note = enabled;
        self
    }

    /// خبرة المجال للعُقد: يُعرض على المخطّط ما يناسب الطلب من الكتالوج، ويختار زمن التشغيل لكل
    /// عقدة متخصّصًا يتحقّق منه. `pinned` متخصّص اختاره المستخدم للمهمّة كلها.
    pub fn with_specialists(mut self, catalog: &'static SpecialistCatalog, pinned: Option<String>) -> Self {
        self.specialists = Some(catalog);
        self.pinned_specialist = pinned.filter(|id| catalog.get(id).is_some());
        self
    }

    /// الملف الشخصي من «تخصيص» (مانوس: «يستخدم هذه المعلومات لتخصيص الردود عبر جميع المهام»).
    pub fn with_user_profile(mut self, profile: Option<String>) -> Self {
        self.user_profile = profile.filter(|p| !p.trim().is_empty());
        self
    }

    /// متخصّص العقدة: المثبَّت إن وُجد، وإلا اقتراح المخطّط إن صحّ، وإلا أفضل مطابقة لهدف العقدة ثم
    /// لطلب المستخدم نفسه.
    fn specialist_for(&self, node: &TaskNode, model: &dyn AgentModel) -> Option<&'static Specialist> {
        let catalog = self.specialists?;
        if let Some(pinned) = &self.pinned_specialist {
            return catalog.get(pinned);
        }
        // اقتراح المخطّط يُقبل فقط إن كان من القائمة التي عُرضت عليه. قِيس 2026-10-01: لـ«هلا» لم يُعرض أحد،
        // فسمّى النموذج «كاتب المراسلات المهنية» من عنده وقُبل لأنه يخدم نوع الخطوة.
        let hint = model.specialist_hint(&node.objective).filter(|h| self.offered_specialists.iter().any(|o| o == h.trim()));
        let text = format!("{} {}", node.title, node.objective);
        catalog.choose(hint.as_deref(), &text, node.task_type).or_else(|| catalog.choose(None, &self.mission.objective, node.task_type))
    }

    /// المهمّة جزء من محادثة: تنتهي بخطوة ردّ على المستخدم (Phase-08).
    pub fn with_reply(mut self) -> Self {
        self.reply_enabled = true;
        self
    }

    /// يبلّغ المراقب سطر سرد. نصّ فارغ لا يُبلَّغ.
    fn narrate(&self, kind: NarrationKind, text: &str, detail: Option<String>) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        if let Some(observer) = &self.observer {
            observer.narrate(&NarrationNote { mission_id: self.mission.mission_id.clone(), kind, text: bounded_preview(text, 1_500), detail });
        }
    }

    /// ما كتبه الوكيل للمستخدم في ردّه الأخير لهذا الهدف، إن وُجد.
    fn narrate_from(&self, model: &dyn AgentModel, key: &str, kind: NarrationKind) {
        if let Some(text) = model.take_narration(key) {
            self.narrate(kind, &text, None);
        }
    }

    /// يربط بوّابة الحسم التي يشترك فيها مع مسار الإلغاء.
    pub fn with_gate(mut self, gate: RunGate) -> Self {
        self.gate = Some(gate);
        self
    }

    /// يربط خانة الخطوة الجارية في مقبض التشغيل (A2): تُملأ عند بدء كل خطوة وتُفرغ بعدها.
    pub fn with_step_slot(mut self, slot: Arc<std::sync::Mutex<Option<String>>>) -> Self {
        self.step_slot = Some(slot);
        self
    }

    fn set_step(&self, task_id: Option<&str>) {
        if let Some(slot) = &self.step_slot {
            if let Ok(mut current) = slot.lock() {
                *current = task_id.map(str::to_string);
            }
        }
    }

    /// سياسة الإخفاقات العابرة (الاختبار يمرّر سياسة بلا انتظار).
    pub fn with_transient_policy(mut self, policy: TransientPolicy) -> Self {
        self.transient_policy = policy;
        self
    }

    /// يربط منفذ قياس العقد (Phase-08).
    pub fn with_contract_probe(mut self, probe: Arc<dyn ContractProbe>) -> Self {
        self.probe = Some(probe);
        self
    }

    /// العقد المشتقّ وآخر قياس له.
    pub fn contract_checks(&self) -> &[RequirementCheck] {
        &self.contract_checks
    }

    pub fn contract(&self) -> &MissionExecutionContract {
        &self.contract
    }

    pub fn transient_retries(&self) -> &TransientLedger {
        &self.transient
    }

    /// يستأنف مهمّة من لقطتها المحفوظة كاملة، بدل إعادة تخطيطها أو استئناف رسمها وحده.
    ///
    /// الرسم يُستأنف كما هو لأن معرّفات العُقد يصدرها وقت التشغيل مرّة واحدة والموافقة مربوطة بعقدة بعينها؛ إعادة التخطيط تُصدر
    /// معرّفات جديدة فتصير موافقة المستخدم على عقدة لا وجود لها.
    ///
    /// R-01 (2026-10-12): كان الاستئناف يعيد الرسم وحده ويبدأ الوكلاء والادّعاءات والأدلّة والمراجعات والرسائل بقوائم فارغة، ثم
    /// تمسح أول نقطة حفظ صفوفها القديمة. الآن تُستعاد كلها بمعرّفاتها. R-07: والاستهلاك التراكمي والزمن المستهلك وعدّادات الرفض
    /// وأعلام قاعدة الاثنين تُستعاد، فلا يمنح الاستئناف ميزانية جديدة ولا يعيد فتح مسار أوقفه رفض متكرّر. الحجوزات اللحظية
    /// (وكيل نشط، نداء متزامن) تبدأ صفرًا لأن العملية التي حجزتها انتهت.
    pub fn resume_from(mut self, snapshot: &MissionSnapshot) -> Self {
        self.graph = snapshot.graph.clone();
        self.agents = snapshot.agents.clone();
        self.claims = snapshot.claims.clone();
        self.evidence = snapshot.evidence.clone();
        self.reviews = snapshot.reviews.clone();
        self.bus.restore(snapshot.messages.clone());
        let state = &snapshot.runtime;
        let now = self.clock.now_millis();
        self.budget = BudgetLedger::new(self.mission.budget.clone(), now.saturating_sub(state.elapsed_ms));
        self.budget.restore_usage(&state.usage);
        self.denial_counts = state.denial_counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
        self.rule_of_two.untrusted_input = state.untrusted_input;
        self.rule_of_two.sensitive_data = state.sensitive_data;
        self.loop_turns = state.loop_turns;
        self.rate_waits = state.rate_waits;
        self.prior_runs = state.runs;
        self.telemetry_failures.store(state.telemetry_failures, std::sync::atomic::Ordering::SeqCst);
        self
    }

    /// يسجّل أول عطل كتابة لما تحتاجه الاستعادة (R-06). ما بعده يقرؤه `storage_stop`.
    pub(super) fn note_storage_fault(&self, what: &str, detail: &str) {
        if let Ok(mut fault) = self.storage_fault.lock() {
            if fault.is_none() {
                *fault = Some(format!("{what}: {}", detail.chars().take(160).collect::<String>()));
            }
        }
    }

    /// سبب التوقّف إن تعذّرت كتابة ما تحتاجه الاستعادة.
    pub(super) fn storage_stop(&self) -> Option<StopReason> {
        self.storage_fault.lock().ok().and_then(|f| f.clone()).map(StopReason::StorageFailure)
    }

    /// يعدّ كتابة امتداد فشلت. الأولى تُبلَّغ حدثَ أمن، وما بعدها يُعدّ فقط.
    pub(super) fn note_telemetry_failure(&mut self, detail: &str) {
        let before = self.telemetry_failures.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if before == 0 {
            self.security("TELEMETRY_WRITE_FAILED", None, detail.chars().take(160).collect());
        }
    }

    /// يربط رمز إلغاء المهمّة. يُفحص قبل كل خطوة، ويُمرَّر إلى بوابة الأدوات.
    pub fn with_cancel(mut self, token: CancelToken) -> Self {
        self.cancel = Some(token);
        self
    }

    /// يربط وسيط الأدوات. الوسيط يقرّر، وهذا المُنسِّق يرتّب فقط.
    /// يربط مراقب دورة الحياة. يُبلَّغ عن كل عقدة تنتهي، ولا يملك مسار كتابة إليها.
    /// يربط حافظ نقطة الاستئناف. التشغيل يبقى الكاتب الوحيد للقطة: الحافظ يُستدعى منه وحده.
    pub fn with_checkpoint(mut self, checkpoint: Arc<dyn RunCheckpoint>) -> Self {
        self.checkpoint = Some(checkpoint);
        self
    }

    /// لقطة المهمّة كما هي الآن: ما يُحفظ في نقطة الاستئناف وفي نهاية التشغيل، ومعها حالة التشغيل التراكمية.
    pub fn snapshot(&self) -> MissionSnapshot {
        MissionSnapshot {
            mission: self.mission.clone(),
            graph: self.graph.clone(),
            agents: self.agents.clone(),
            claims: self.claims.clone(),
            evidence: self.evidence.clone(),
            messages: self.bus.messages().to_vec(),
            reviews: self.reviews.clone(),
            runtime: self.runtime_state(),
        }
    }

    /// حالة التشغيل التراكمية كما تُحفظ (R-07). الإثبات يُحفظ بعد حسمه وحده؛ أثناء التشغيل لا إثبات محسوم.
    pub fn runtime_state(&self) -> crate::p03::runtime_state::RuntimeState {
        crate::p03::runtime_state::RuntimeState {
            format: crate::p03::runtime_state::RUNTIME_STATE_FORMAT,
            usage: self.budget.usage(),
            elapsed_ms: self.budget.elapsed_ms(self.clock.now_millis()),
            denial_counts: self.denial_counts.iter().map(|(k, v)| (k.clone(), *v)).collect(),
            untrusted_input: self.rule_of_two.untrusted_input,
            sensitive_data: self.rule_of_two.sensitive_data,
            loop_turns: self.loop_turns,
            rate_waits: self.rate_waits,
            runs: self.prior_runs + 1,
            telemetry_failures: self.telemetry_failures.load(std::sync::atomic::Ordering::SeqCst),
            proof: self.settled_proof.clone(),
        }
    }

    /// يحفظ نقطة استئناف إن رُبط حافظ. فشل الحفظ لا يُبتلع (R-06): يُسجَّل عطلًا يوقف المسار قبل الأثر التالي.
    fn save_checkpoint(&self) {
        if let Some(checkpoint) = &self.checkpoint {
            if let Err(detail) = checkpoint.save(&self.snapshot()) {
                self.note_storage_fault("CHECKPOINT_WRITE_FAILED", &detail);
            }
        }
    }

    pub fn with_observer(mut self, observer: Arc<dyn MissionObserver>) -> Self {
        self.observer = Some(observer);
        self
    }

    /// يربط طابور رسائل المستخدم أثناء العمل (ADR-042). يقرؤه وكيل الحلقة الرئيس وحده عند حدّ آمن بين دورين.
    pub fn with_notes(mut self, notes: Arc<dyn crate::p03::port::ConversationPolicy>) -> Self {
        self.notes = Some(notes);
        self
    }

    pub fn with_tools(mut self, broker: Arc<dyn ToolBroker>) -> Self {
        self.tools = Some(broker);
        self
    }

    /// قرارات الأدوات كما عادت من البوابة. تُقرأ بعد التشغيل.
    pub fn tool_decisions(&self) -> &[ToolDecision] {
        &self.tool_decisions
    }

    /// رسائل الوكلاء التي جرت فعلًا في هذه المهمّة.
    pub fn messages(&self) -> &[AgentMessage] {
        self.bus.messages()
    }

    /// أحكام المراجعة بترتيب صدورها.
    pub fn reviews(&self) -> &[ReviewRecord] {
        &self.reviews
    }

    /// هل أُلغيت المهمّة؟ الرمز المشترك والعلم الداخلي معًا.
    fn is_cancelled(&self) -> bool {
        self.cancelled || self.cancel.as_ref().is_some_and(CancelToken::is_cancelled)
    }

    /// يربط منفذ الأدلّة المقيسة. يُستدعى من كود موثوق وحده.
    pub fn with_trusted_evidence(mut self, source: Arc<dyn TrustedEvidenceSource>) -> Self {
        self.trusted_evidence = Some(source);
        self
    }

    pub fn mission(&self) -> &Mission {
        &self.mission
    }

    pub fn graph(&self) -> &TaskGraph {
        &self.graph
    }

    pub fn claims(&self) -> &[Claim] {
        &self.claims
    }

    pub fn evidence(&self) -> &[EvidenceItem] {
        &self.evidence
    }

    pub fn agents(&self) -> &[AgentInstance] {
        &self.agents
    }

    /// إلغاء المهمّة. ينتشر إلى الأسفل: لا جدولة جديدة بعد هذه النقطة (البند 69).
    pub fn cancel(&mut self) {
        self.cancelled = true;
    }

    /// المسار الكامل: تخطيط، ثم تنفيذ، ثم تحقّق، ثم إثبات.
    pub fn run(&mut self, model: &dyn AgentModel) -> RunReport {
        if self.agent_loop && model.loop_mode().is_some() {
            return self.agent_run(model);
        }
        // ضوابط Phase-08 تعمل حين يدعمها المنفذ ويوجد ما تُقاس به؛ وإلا فالسلوك المغلق.
        self.recovery = model.recovery_enabled() && self.probe.is_some();
        if self.recovery {
            self.contract = MissionExecutionContract::derive(&self.mission.objective);
        }
        let prepared = if self.graph.nodes().next().is_none() { self.plan_phase(model) } else { self.resume_phase() };
        if prepared.is_ok() {
            self.save_checkpoint();
        }
        if let Err(stop) = prepared {
            // إلغاء قُبل يسود ما يليه: لا يُحوَّل إلى فشل أبدًا (قِيس في P08-E2E-07: إلغاء أثناء
            // التخطيط كان يُحفظ FAILED). وتعذّر المزوّد حجبٌ لا فشل.
            if self.is_cancelled() || matches!(stop, StopReason::Cancelled | StopReason::ProviderUnavailable(_)) {
                self.halt_with(stop);
                self.finalize();
            } else {
                self.fail_with(stop);
            }
            return self.report();
        }
        let mut first = true;
        loop {
            if let Err(stop) = self.execution_loop(model, first) {
                self.halt_with(stop);
                break;
            }
            first = false;
            if !self.recovery || self.is_cancelled() || !self.awaiting_approval.is_empty() || self.graph.nodes().any(|n| n.state == TaskState::Failed) {
                break;
            }
            if !self.add_continuation() {
                break;
            }
        }
        self.detect_conflicts();
        self.settle_requirements();
        self.settle_contract();
        self.reply_step(model);
        self.finalize();
        self.report()
    }

    /// خطوة الردّ (Phase-08): نداء واحد يكتب للمستخدم بلغته ما انتهت إليه المهمّة، ويُحفظ جوابًا لها.
    /// قِيس على جهاز المالك: «هلا» انتهت بتقرير خطوة بالإنجليزية («I asked the user…») بدل ردّ عليه.
    /// لا ردّ لمهمّة أُلغيت أو توقّفت أو تنتظر قرارًا؛ وفشل هذه الخطوة لا يغيّر حالة المهمّة، فيبقى
    /// الجواب آخر تقرير خطوة كما كان.
    fn reply_step(&mut self, model: &dyn AgentModel) {
        if !self.reply_enabled || !model.can_reply() || self.is_cancelled() || self.stop_reason.is_some() || !self.awaiting_approval.is_empty() {
            return;
        }
        let reports: Vec<(String, String)> = self
            .graph
            .nodes()
            .filter_map(|n| self.task_outputs.get(&n.task_id).map(|o| (n.title.clone(), o.clone())))
            .collect();
        let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
        let outcome = if self.graph.nodes().any(|n| n.state == TaskState::Failed) { "FAILED" } else { "COMPLETED" };
        let input = ReplyInput { reports, files, outcome };
        if let Ok((text, input_tokens, output_tokens)) = self.guarded_call(None, || model.reply(&input)) {
            let _ = self.budget.settle_model_call(input_tokens, output_tokens);
            if let Some(answer) = bounded_answer(&text) {
                self.mission.result_summary = Some(answer);
            }
            let suggestions = model.take_suggestions();
            if let (false, Some(observer)) = (suggestions.is_empty(), &self.observer) {
                observer.suggest(&self.mission.mission_id, &suggestions);
            }
        }
    }

    /// نداء نموذج محروس: فحص الإلغاء، وحجز الميزانية، وإعادة محدودة بعد إخفاق عابر، وإصلاح
    /// واحد لمخرجات مشوّهة إن طُلب. كل محاولة نداءٌ محجوز من الميزانية نفسها.
    fn guarded_call<T>(&mut self, repair: Option<(&dyn AgentModel, &str)>, call: impl FnMut() -> Result<T, ModelError>) -> Result<T, StopReason> {
        self.guarded_call_after(None, repair, call)
    }

    /// كالنداء المحروس، وقد تكون محاولته الأولى جرت سلفًا (G4: نداء فرع تفويض في خيطه، ومقعده محجوز هنا قبله). تلك المحاولة
    /// تُعامل كأيّ محاولة: امتدادها، وإعادة مقعدها إن فشلت، وسياسة الإعادة والإلغاء نفسها لما بعدها.
    fn guarded_call_after<T>(
        &mut self,
        mut first: Option<FirstAttempt<T>>,
        repair: Option<(&dyn AgentModel, &str)>,
        mut call: impl FnMut() -> Result<T, ModelError>,
    ) -> Result<T, StopReason> {
        let mut transient_attempts = 0u32;
        let mut repaired = false;
        loop {
            let (outcome, started_at, latency_ms) = match first.take() {
                Some(attempt) => (attempt.outcome, attempt.started_at, attempt.latency_ms),
                None => {
                    if self.is_cancelled() {
                        self.cancelled = true;
                        return Err(StopReason::Cancelled);
                    }
                    // R-06: لا نداء نموذج بعد تعذّر كتابة ما تحتاجه الاستعادة.
                    if let Some(stop) = self.storage_stop() {
                        return Err(stop);
                    }
                    self.budget.reserve_model_call().map_err(StopReason::BudgetExhausted)?;
                    if let Some(observer) = &self.observer {
                        observer.thinking(&self.mission.mission_id, true);
                    }
                    let attempt_started = std::time::Instant::now();
                    let started_at = self.clock.now();
                    let outcome = call();
                    if let Some(observer) = &self.observer {
                        observer.thinking(&self.mission.mission_id, false);
                    }
                    (outcome, started_at, attempt_started.elapsed().as_millis() as u64)
                }
            };
            // امتداد `chat` لكل محاولة (ADR-041): من حقائق مسار الاستدعاء إن قاسها، وإلا بما يعرفه زمن التشغيل.
            let failure = match &outcome {
                Ok(_) => None,
                Err(e) => Some(model_error_code(e)),
            };
            self.record_chat_spans(&started_at, latency_ms, failure);
            if outcome.is_err() {
                // محاولة بلا ردّ: يُعاد مقعد التزامن، ويبقى النداء محسوبًا.
                self.budget.abandon_model_call();
            }
            match outcome {
                Ok(value) => return Ok(value),
                Err(ModelError::Cancelled) => return Err(StopReason::Cancelled),
                Err(ModelError::NoModel(detail)) => return Err(StopReason::NoModelRouted(detail)),
                Err(ModelError::Transient(code)) if code.starts_with(crate::p03::model_adapter::CREDIT_EXHAUSTED) => {
                    let detail = code.trim_start_matches(crate::p03::model_adapter::CREDIT_EXHAUSTED).trim_start_matches(':').to_string();
                    return Err(StopReason::ProviderCreditExhausted(detail));
                }
                Err(ModelError::Transient(code)) => {
                    if self.is_cancelled() {
                        self.cancelled = true;
                        return Err(StopReason::Cancelled);
                    }
                    // تحديد المعدّل (2026-10-06): قِيس على Groq أن حدود الطبقة المجانية تردّ 429 مرارًا في مهمّة واحدة، وأن ست
                    // إعادات بجدول 20/60 ثانية تستنفدها فتُحجب المهمّة. الانتظار بمهلة المزوّد (`retry-after`)، بعدّاد مستقلّ محدود،
                    // وتحت ميزانية الوقت نفسها.
                    if let Some(wait) = rate_limit_wait(&code) {
                        // سياسة الاختبار بلا انتظار حقيقي تسري هنا أيضًا.
                        let wait = if self.transient_policy.delay_for(0).is_zero() { std::time::Duration::ZERO } else { wait };
                        if self.rate_waits >= MAX_RATE_WAITS {
                            return Err(StopReason::ProviderUnavailable(code));
                        }
                        // مهلة يطلبها المزوّد أطول من عشر دقائق حدٌّ يومي لا ينتهي داخل المهمّة: تتوقّف بسببه الآن، لا بعد ساعة صامتة.
                        if rate_limit_requested_ms(&code).is_some_and(|ms| ms > 600_000) {
                            return Err(StopReason::ProviderUnavailable(code));
                        }
                        self.rate_waits += 1;
                        // الانتظار ظاهر في المحادثة (قِيس 2026-10-06: Groq ردّ 429 والشاشة بقيت على «يعمل» دقيقتين بلا سطر واحد).
                        self.narrate(NarrationKind::Action, &format!("polaris.provider.rate_limited {}", serde_json::json!({ "seconds": wait.as_secs().max(1) })), Some("RATE_LIMITED".into()));
                        if wait_unless_cancelled(wait, self.cancel.as_ref()).is_err() {
                            self.cancelled = true;
                            return Err(StopReason::Cancelled);
                        }
                        self.budget.check_deadline(self.clock.now_millis()).map_err(StopReason::BudgetExhausted)?;
                        continue;
                    }
                    if !self.transient.allows(&self.transient_policy, transient_attempts) {
                        return Err(StopReason::ProviderUnavailable(code));
                    }
                    self.transient.record(&code);
                    let delay = self.transient_policy.delay_for(transient_attempts);
                    transient_attempts += 1;
                    if wait_unless_cancelled(delay, self.cancel.as_ref()).is_err() {
                        self.cancelled = true;
                        return Err(StopReason::Cancelled);
                    }
                    self.budget.check_deadline(self.clock.now_millis()).map_err(StopReason::BudgetExhausted)?;
                }
                Err(ModelError::InvalidOutput(detail)) => {
                    if let Some((model, objective)) = repair {
                        if !repaired && model.note_invalid_output(objective, &detail) {
                            repaired = true;
                            continue;
                        }
                    }
                    return Err(StopReason::ModelOutputInvalid(detail));
                }
            }
        }
    }

    /// يضيف مهمّة استكمال واحدة لما بقي غائبًا من عقد المهمّة. يعيد «صحيح» إن أضاف.
    /// محدود بعدد ثابت، ولا يلاحق ما رفضه إنسان، ويُحجز من ميزانية المهامّ والرسم.
    fn add_continuation(&mut self) -> bool {
        let Some(probe) = self.probe.clone() else { return false };
        if self.continuations >= recovery::MAX_CONTINUATIONS || self.contract.is_empty() {
            return false;
        }
        let checks = fulfilment::evaluate(&self.contract, &self.mission.mission_id, probe.as_ref());
        let unmet = fulfilment::unmet(&checks);
        let history = probe.tool_history(&self.mission.mission_id);
        if unmet.is_empty() || fulfilment::human_denied(&history) || fulfilment::boundary_denied(&history) {
            self.contract_checks = checks.clone();
            return false;
        }
        if self.budget.reserve_task().is_err() || self.budget.reserve_graph_revision().is_err() {
            return false;
        }
        let files = probe.workspace_files(&self.mission.mission_id);
        let objective = recovery::continuation_objective(&unmet, &files);
        self.continuations += 1;
        let task_id = self.clock.id();
        let mut node = TaskNode::new(task_id.clone(), &self.mission.mission_id, format!("Complete the remaining deliverables ({})", self.continuations), &objective, TaskType::Build);
        node.max_attempts = 1;
        let edges: Vec<ProposedEdge> = self
            .graph
            .nodes()
            .map(|n| ProposedEdge { dependent: task_id.clone(), dependency: n.task_id.clone(), kind: DependencyKind::RequiresCompletion })
            .collect();
        let mutation = GraphMutation {
            proposal_id: self.clock.id(),
            agent_id: "polaris.runtime".into(),
            mission_id: self.mission.mission_id.clone(),
            base_revision: self.graph.revision,
            added_tasks: vec![node],
            added_dependencies: edges,
            reason: "DELIVERABLE_GAP".into(),
        };
        self.graph.apply_mutation(&mutation, self.mission.budget.max_tasks).is_ok()
    }

    /// القياس الأخير للعقد، وحجب الإنجاز إن بقي مطلوب غائب.
    fn settle_contract(&mut self) {
        let Some(probe) = self.probe.clone() else { return };
        if !self.recovery || self.contract.is_empty() {
            return;
        }
        self.contract_checks = fulfilment::evaluate(&self.contract, &self.mission.mission_id, probe.as_ref());
        let unmet: Vec<String> = fulfilment::unmet(&self.contract_checks).iter().map(|c| c.id.clone()).collect();
        let settled = self.stop_reason.is_none() && !self.is_cancelled() && self.awaiting_approval.is_empty() && !self.graph.nodes().any(|n| n.state == TaskState::Failed);
        if settled && !unmet.is_empty() {
            self.stop_reason = Some(StopReason::DeliverablesIncomplete(unmet.join(",")));
        }
    }

    /// المتطلّبات غير المستوفاة الآن (قياس حيّ).
    fn unmet_now(&self) -> Vec<RequirementCheck> {
        let Some(probe) = self.probe.clone() else { return Vec::new() };
        if !self.recovery || self.contract.is_empty() {
            return Vec::new();
        }
        fulfilment::evaluate(&self.contract, &self.mission.mission_id, probe.as_ref()).into_iter().filter(|c| !c.satisfied).collect()
    }

    /// أقسام سياق مهمّة فرعية: المتبقّي من العقد، وتقارير سابقاتها، والملفات الموجودة.
    fn task_context(&self, node: &TaskNode, unmet: &[RequirementCheck]) -> TaskContextSections {
        let mut previous: Vec<String> = node
            .dependencies
            .iter()
            .filter_map(|d| self.task_reports.get(&d.task_id))
            .map(TaskReport::render)
            .collect();
        previous.truncate(8);
        let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
        // الخطة كلها بحالاتها وموضع هذه المهمّة منها (حتى 12 عقدة): العامل يعرف ما تولّته عقدة أخرى.
        let plan_outline = self
            .graph
            .nodes()
            .take(12)
            .enumerate()
            .map(|(i, n)| {
                let mark = if n.task_id == node.task_id { "  <- THIS TASK" } else { "" };
                format!("{}. [{}] {}{mark}", i + 1, n.state.as_str(), n.title)
            })
            .collect();
        TaskContextSections {
            remaining_requirements: unmet.iter().map(|c| format!("{} ({})", c.description, c.detail)).collect(),
            previous_results: previous,
            available_files: files.into_iter().take(60).collect(),
            plan_outline,
            done_actions: self.done_actions(),
        }
    }

    /// ما أُنجز فعلًا في المهمّة بقياس البوابة (خطة 2026-10-06، C4): أدوات ذات أثر نجحت، الأقدم أولًا، حتى 20. من سجلّ
    /// البوابة إن رُبط منفذ القياس (يشمل التشغيلات السابقة للمهمّة)، وإلا من قرارات هذا التشغيل. الملخّص من المحوّل
    /// الموثوق، لا من الوكيل.
    fn done_actions(&self) -> Vec<String> {
        let step = |task_id: &str| self.graph.get(task_id).map(|n| bounded_preview(&n.title, 80)).unwrap_or_else(|| "an earlier run".into());
        let mut done: Vec<String> = match &self.probe {
            Some(probe) => probe
                .tool_history(&self.mission.mission_id)
                .into_iter()
                .filter(|r| r.status == "SUCCEEDED" && is_effectful(&r.tool_id))
                .map(|r| format!("step «{}»: {} SUCCEEDED — {}", step(&r.task_id), r.tool_id, bounded_preview(&r.summary, 200)))
                .collect(),
            None => self
                .tool_decisions
                .iter()
                .zip(&self.decision_owners)
                .filter(|(d, _)| d.status == "SUCCEEDED" && is_effectful(&d.tool_id))
                .map(|(d, owner)| {
                    let task = self.agents.iter().find(|a| &a.agent_id == owner).and_then(|a| a.current_task_id.clone()).unwrap_or_default();
                    format!("step «{}»: {} SUCCEEDED — {}", step(&task), d.tool_id, bounded_preview(&d.summary, 200))
                })
                .collect(),
        };
        let excess = done.len().saturating_sub(MAX_DONE_ACTIONS);
        done.drain(..excess);
        done
    }

    /// هل آخر مهمّة قابلة للتشغيل هي هذه؟ التذكير بخطوة لم تُقترح لا يُوجَّه إلى مهمّة أولى
    /// ستتبعها مهامّ أخرى قد تتولّاها.
    fn is_last_open_task(&self, task_id: &str) -> bool {
        !self.graph.nodes().any(|n| n.task_id != task_id && !n.state.is_terminal() && n.state != TaskState::Blocked)
    }

    /// تذكير محدود بمتطلّب «فعل» لم يُحاوَل. يعيد «صحيح» إن سُجِّل تذكير.
    fn maybe_remind(&mut self, task_id: &str, objective: &str, model: &dyn AgentModel) -> bool {
        if !self.recovery || !self.is_last_open_task(task_id) {
            return false;
        }
        let used = self.reminders.get(task_id).copied().unwrap_or(0);
        if used >= recovery::MAX_REMINDERS_PER_TASK {
            return false;
        }
        // لا تذكير بعد رفض عند حدّ أمان أو سياسة: التذكير يدعو إلى طلب ما رُفض.
        if self.probe.as_ref().is_some_and(|p| fulfilment::boundary_denied(&p.tool_history(&self.mission.mission_id))) {
            return false;
        }
        let unmet = self.unmet_now();
        let refs: Vec<&RequirementCheck> = unmet.iter().collect();
        let untried = recovery::untried_action_requirements(&refs);
        if untried.is_empty() {
            return false;
        }
        self.reminders.insert(task_id.to_string(), used + 1);
        model.note_reminder(objective, &recovery::reminder(&untried));
        true
    }

    /// طور التخطيط: يستدعي المخطّط، ويتحقّق من مخرجاته، ويبني الرسم.
    fn plan_phase(&mut self, model: &dyn AgentModel) -> Result<(), StopReason> {
        let now = self.clock.now();
        self.mission
            .transition_to(MissionState::Planning, &now)
            .map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;

        let objective = self.mission.objective.clone();
        // مخرجات تخطيط مشوّهة (أو استدلال استنفد سقفه) تُصلَح مرة واحدة كتنفيذ المهامّ (Phase-08).
        if let (Some(catalog), None) = (self.specialists, &self.pinned_specialist) {
            let shortlist: Vec<(String, String)> = catalog.shortlist(&objective, SHORTLIST).into_iter().map(|s| (s.specialist_id.clone(), s.summary_en.clone())).collect();
            if !shortlist.is_empty() {
                model.offer_specialists(&shortlist);
            }
            self.offered_specialists = shortlist.into_iter().map(|(id, _)| id).collect();
        }
        let mut proposal = self.guarded_call(Some((model, objective.as_str())), || model.plan(&objective))?;
        // D-8: ما أبلغه المزوّد، أو صفر معلن حين لا يبلّغ. كان 200+200 ثابتًا لكل خطة، فصار الدفتر رقمًا مختلقًا.
        let (plan_in, plan_out) = model.take_plan_usage().unwrap_or((0, 0));
        self.budget.settle_model_call(plan_in, plan_out).map_err(StopReason::BudgetExhausted)?;

        // اكتمال الخطة (Phase-08): خطة لا تتناول متطلَّبًا من العقد تُصلَح مرة واحدة بملاحظة
        // تسمّي الفجوة وحدها. إصلاح فاشل أو أسوأ لا يحلّ محلّ الأصل.
        if self.recovery && !self.contract.is_empty() {
            let gap = recovery::uncovered_by_plan(&self.contract, &proposal);
            if !gap.is_empty() && self.plan_repairs < recovery::MAX_PLAN_REPAIRS {
                self.plan_repairs += 1;
                model.note_plan_feedback(&recovery::plan_repair_note(&gap));
                let before = gap.len();
                if let Ok(repaired) = self.guarded_call(None, || model.plan(&objective)) {
                    let (plan_in, plan_out) = model.take_plan_usage().unwrap_or((0, 0));
                    let _ = self.budget.settle_model_call(plan_in, plan_out);
                    if !repaired.tasks.is_empty() && recovery::uncovered_by_plan(&self.contract, &repaired).len() < before {
                        proposal = repaired;
                    }
                } else if self.is_cancelled() {
                    return Err(StopReason::Cancelled);
                }
            }
        }

        // اقتراح الخطة مخرجات نموذج: يُتحقَّق ثم يُبنى منه، ولا يُطبَّق كما هو (البند 22).
        if proposal.tasks.is_empty() {
            return Err(StopReason::ModelOutputInvalid("plan proposed no tasks".into()));
        }
        // المعرّفات يصدرها وقت التشغيل لا النموذج (البند 111).
        let mut keys: BTreeMap<String, String> = BTreeMap::new();
        for planned in &proposal.tasks {
            self.budget.reserve_task().map_err(StopReason::BudgetExhausted)?;
            keys.insert(planned.local_key.clone(), self.clock.id());
        }
        let mut nodes: Vec<TaskNode> = Vec::new();
        for planned in &proposal.tasks {
            let task_id = keys.get(&planned.local_key).expect("key was reserved above").clone();
            if self.recovery {
                self.planned_roles.insert(task_id.clone(), planned.recommended_role);
            }
            let mut node = TaskNode::new(task_id, &self.mission.mission_id, &planned.title, &planned.objective, planned.task_type);
            node.max_attempts = 2;
            for dep_key in &planned.depends_on {
                let Some(dep_id) = keys.get(dep_key) else {
                    return Err(StopReason::ModelOutputInvalid(format!("plan references an unknown task key {dep_key}")));
                };
                node = node.with_dependency(dep_id.clone(), planned.dependency_kind);
            }
            nodes.push(node);
        }
        // كل عقدة بهدف فريد (خطة 2026-10-05، C1): حالة الوكيل لكل خطوة (الإصلاح، والسياق، والمتابعة، وجولات السجلّ) مفتاحها
        // نصّ الهدف عبر المنفذ، فهدفان متطابقان كانا يتقاسمان حالة واحدة. الثاني يُميَّز بموضعه وعنوانه؛ الأول لا يتغيّر.
        distinguish_objectives(&mut nodes);
        // ما بقي بلا مهمّة بعد الإصلاح يتولّاه زمن التشغيل بمهمّة أخيرة تسمّيه، لا يُترك للصدفة.
        if self.recovery && !self.contract.is_empty() {
            let still: Vec<String> = recovery::uncovered_by_plan(&self.contract, &proposal).iter().map(|r| r.description.clone()).collect();
            if !still.is_empty() && !nodes.is_empty() && self.budget.reserve_task().is_ok() {
                let task_id = self.clock.id();
                let objective = format!("Produce and verify these required results that no earlier task covers, using registered tools, without redoing earlier work:\n- {}", still.join("\n- "));
                let mut node = TaskNode::new(task_id, &self.mission.mission_id, "Cover the remaining required results", &objective, TaskType::Build);
                node.max_attempts = 1;
                for dep in nodes.iter().map(|n| n.task_id.clone()).collect::<Vec<_>>() {
                    node = node.with_dependency(dep, DependencyKind::RequiresCompletion);
                }
                nodes.push(node);
            }
        }
        let max_tasks = self.mission.budget.max_tasks;
        self.graph = TaskGraph::build(self.mission.mission_id.clone(), nodes, max_tasks)
            .map_err(|e: GraphError| StopReason::GraphInvalid(format!("{e:?}")))?;
        if let Some(first) = self.graph.nodes().next() {
            self.mission.root_task_id = Some(first.task_id.clone());
        }
        self.narrate_from(model, &objective, NarrationKind::Plan);
        // المحادثة: عنوان قصير يقترحه المخطّط يحلّ محلّ نصّ الرسالة الخام في الشريط الجانبي.
        if self.reply_enabled {
            if let Some(title) = model.take_title(&objective) {
                self.mission.title = title.clone();
                if let Some(observer) = &self.observer {
                    observer.retitle(&self.mission.mission_id, &title);
                }
            }
        }

        let now = self.clock.now();
        self.mission
            .transition_to(MissionState::Ready, &now)
            .map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;
        Ok(())
    }

    /// طور الاستئناف: رسم قائم، وعُقد كانت تنتظر قرارًا تعود إلى الجدولة.
    ///
    /// ما لا يُعاد: عقدة انتهت بنجاح أو بفشل. الاستئناف يواصل ما لم يكتمل، ولا
    /// يكرّر أثرًا وقع (البند 141).
    fn resume_phase(&mut self) -> Result<(), StopReason> {
        // E2: خطوة قطعها توقّف التطبيق (INTERRUPTED بعد الاستعادة، أو RUNNING/ASSIGNED في لقطة لم تُستعد) تعود إلى
        // الانتظار مع ما ينتظر قرارًا. ما انتهى لا يُعاد، وقائمة «ما أُنجز» من سجلّ البوابة تُري المحاولة ما وقع قبل التوقّف.
        let waiting: Vec<String> = self
            .graph
            .nodes()
            .filter(|node| matches!(node.state, TaskState::Waiting | TaskState::Interrupted | TaskState::Running | TaskState::Assigned))
            .map(|node| node.task_id.clone())
            .collect();
        for task_id in waiting {
            let _ = self.graph.set_state(&task_id, TaskState::Pending);
        }
        // المطلوب بلوغ حالةٍ يجوز منها RUNNING، وحلقة التنفيذ هي التي تنتقل
        // إليها. مهمّة تنتظر قرارًا تنتقل إلى RUNNING مباشرةً، ولا تعود إلى
        // PLANNING: آلة الحالة المُعلنة لا تسمح بذلك، والمرور بها كان يوقف كل
        // استئناف بعد موافقة — وهو عيب لم يظهر إلا في التشغيل الحقيقي.
        if !self.mission.state.can_transition_to(MissionState::Running) {
            // مهمّة لم تبدأ بعد يمرّ مسارها المُعلن بـPLANNING. ولا تخطيط يقع
            // هنا: الرسم قائم، والمرور حالة لا عمل.
            if self.mission.state.can_transition_to(MissionState::Planning) {
                let now = self.clock.now();
                self.mission
                    .transition_to(MissionState::Planning, &now)
                    .map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;
            }
            let now = self.clock.now();
            self.mission
                .transition_to(MissionState::Ready, &now)
                .map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;
        }
        Ok(())
    }

    /// حلقة التنفيذ: مجموعة جاهزة حتمية، بحدّ وكلاء نشطين، مع حارس عدم التقدّم.
    fn execution_loop(&mut self, model: &dyn AgentModel, first: bool) -> Result<(), StopReason> {
        if first || self.mission.state != MissionState::Running {
            let now = self.clock.now();
            self.mission
                .transition_to(MissionState::Running, &now)
                .map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;
        }

        loop {
            if self.is_cancelled() {
                self.cancelled = true;
                return Err(StopReason::Cancelled);
            }
            self.budget.check_deadline(self.clock.now_millis()).map_err(StopReason::BudgetExhausted)?;

            // حارس عدم التقدّم يقرأ بصمة حالة ذات معنى، لا حكمًا دلاليًّا (البند 64).
            if let Progress::NoProgress = self.guard.observe_state(&self.state_digest()) {
                return Err(StopReason::NoProgress);
            }

            let priority = uniform_priority(&self.graph, self.mission.priority);
            let ready = self.graph.ready_set(&priority);
            if ready.is_empty() {
                break;
            }
            let slot = self.mission.budget.max_active_agents as usize;
            let batch: Vec<String> = ready.into_iter().take(slot.max(1)).collect();
            let width = model.parallel_first_calls().min(3).min(slot.max(1));
            if width > 1 && batch.len() > 1 {
                self.run_batch(&batch, width, model)?;
                continue;
            }
            for task_id in batch {
                self.set_step(Some(&task_id));
                let outcome = self.run_one_task(&task_id, model);
                self.set_step(None);
                // E2: نقطة استئناف بعد كل خطوة، نجحت أو فشلت أو توقّفت.
                self.save_checkpoint();
                outcome?;
            }
        }
        Ok(())
    }

    /// خطوات مستقلّة جاهزة على نموذج بعيد (خطة 2026-10-05، E4): يبدأ كلٌّ منها كما يبدأ وحده (وكيله، وسياقه)، ثم يجري
    /// نداء تنفيذه الأول معًا بحدّ `width` (ثلاث على الأكثر)، ثم يُتمّ كلٌّ منها بالترتيب الحتمي نفسه: أدواته عبر البوابة،
    /// وتسجيله، وتحقّقه، ونقطة استئنافه. ما يتوازى هو انتظار النموذج وحده؛ كل أثر وكل قرار يبقى متسلسلًا كما كان.
    ///
    /// **الحدّ المعلن:** خطوة لا ترى ما تكتبه أختها الموازية قبل نداءها الأول (لا تبعية بينهما أصلًا، وإلا لما كانتا
    /// جاهزتين معًا). المراجعة لا تتوازى: تجري في دورها كما كانت.
    fn run_batch(&mut self, batch: &[String], width: usize, model: &dyn AgentModel) -> Result<(), StopReason> {
        let mut begun: Vec<Begun> = Vec::new();
        let mut rest: Vec<String> = Vec::new();
        for task_id in batch {
            let is_review = self.graph.get(task_id).is_some_and(|n| matches!(n.task_type, TaskType::Review));
            if begun.len() < width && !is_review {
                self.set_step(Some(task_id));
                let started = self.begin_task(task_id, model);
                self.set_step(None);
                match started? {
                    Some(b) => begun.push(b),
                    None => self.save_checkpoint(),
                }
            } else {
                rest.push(task_id.clone());
            }
        }

        // النداءات الأولى معًا. كل نداء يُحجز من الميزانية قبله كما في النداء المنفرد، وما فشل منها يُعاد مقعده ويُعاد
        // في دور خطوته بالمسار المنفرد كاملًا (الإصلاح والإعادة العابرة)، فلا يضيع ولا يُحتسب نجاحًا.
        let mut reserved = Vec::with_capacity(begun.len());
        for _ in &begun {
            reserved.push(self.budget.reserve_model_call().is_ok());
        }
        if let Some(observer) = &self.observer {
            observer.thinking(&self.mission.mission_id, true);
        }
        let results: Vec<Option<Result<TaskExecution, ModelError>>> = std::thread::scope(|scope| {
            let handles: Vec<_> = begun
                .iter()
                .zip(&reserved)
                .map(|(b, ok)| {
                    let (task_id, role, task_type, objective, ok) = (b.task_id.clone(), b.role, b.node.task_type, b.node.objective.clone(), *ok);
                    scope.spawn(move || ok.then(|| crate::p03::cancel::with_thread_step(&task_id, || model.execute(role, task_type, &objective))))
                })
                .collect();
            handles.into_iter().map(|h| h.join().ok().flatten()).collect()
        });
        if let Some(observer) = &self.observer {
            observer.thinking(&self.mission.mission_id, false);
        }

        for (b, first) in begun.into_iter().zip(results) {
            let first = match first {
                Some(Ok(execution)) => Some(execution),
                Some(Err(ModelError::Cancelled)) => {
                    self.budget.abandon_model_call();
                    self.cancelled = true;
                    return Err(StopReason::Cancelled);
                }
                Some(Err(_)) => {
                    self.budget.abandon_model_call();
                    None
                }
                None => None,
            };
            let task_id = b.task_id.clone();
            self.set_step(Some(&task_id));
            let outcome = self.complete_task(b, model, first);
            self.set_step(None);
            self.save_checkpoint();
            outcome?;
        }
        for task_id in rest {
            self.set_step(Some(&task_id));
            let outcome = self.run_one_task(&task_id, model);
            self.set_step(None);
            self.save_checkpoint();
            outcome?;
        }
        Ok(())
    }

    /// ينفّذ عقدة واحدة: تخصيص وكيل، حجز نداء، تنفيذ، تسجيل، تحقّق.
    fn run_one_task(&mut self, task_id: &str, model: &dyn AgentModel) -> Result<(), StopReason> {
        match self.begin_task(task_id, model)? {
            Some(begun) => self.complete_task(begun, model, None),
            None => Ok(()),
        }
    }

    /// بدء العقدة (E4: فُصل عن إتمامها بلا تغيير ترتيب): الوكيل، والمتخصّص، والسرد، وسياق الخطوة. `None` حين حُجبت.
    fn begin_task(&mut self, task_id: &str, model: &dyn AgentModel) -> Result<Option<Begun>, StopReason> {
        if self.is_cancelled() {
            self.cancelled = true;
            return Err(StopReason::Cancelled);
        }
        let Some(node) = self.graph.get(task_id).cloned() else {
            return Ok(None);
        };
        // تبعية نجاح فاشلة تحجب العقدة بدل تشغيلها.
        if self.graph.has_failed_success_dependency(&node) {
            let _ = self.graph.set_state(task_id, TaskState::Blocked);
            return Ok(None);
        }
        let Some(role) = self.planned_role(task_id, node.task_type).or_else(|| self.role_for(node.task_type)) else {
            let _ = self.graph.set_state(task_id, TaskState::Blocked);
            return Ok(None);
        };

        // الوكيل: هويته يصدرها وقت التشغيل، ودوره لا يمنحه سلطة.
        self.budget.reserve_agent().map_err(StopReason::BudgetExhausted)?;
        self.budget.acquire_active_agent().map_err(StopReason::BudgetExhausted)?;
        let agent_id = self.clock.id();
        let now = self.clock.now();
        let mut agent = AgentInstance::new(&agent_id, &self.mission.mission_id, role, now);
        agent.current_task_id = Some(task_id.to_string());
        agent.state = AgentState::Working;
        self.agents.push(agent);
        let _ = self.graph.assign(task_id, &agent_id);
        let _ = self.graph.set_state(task_id, TaskState::Running);
        // خبرة المجال: تعليمات المتخصّص تدخل موجّه هذه العقدة، ومعرّفه يُسرد مع الخطوة ليراه المستخدم.
        let specialist = self.specialist_for(&node, model);
        if let Some(s) = specialist {
            model.brief(&node.objective, &s.brief());
        }
        self.narrate(NarrationKind::Step, &node.title, specialist.map(|s| s.specialist_id.clone()));

        if !matches!(node.task_type, TaskType::Review) {
            // ما أبلغت عنه المهامّ السابقة يصل إلى هذه المهمّة، وإلا بنت على فراغ.
            if self.recovery {
                // تسليم منظَّم محدود: التقارير، والمتبقّي من العقد، والملفات الموجودة (Phase-08).
                let unmet = self.unmet_now();
                let sections = self.task_context(&node, &unmet);
                model.note_task_context(&node.objective, &sections);
            } else {
                let upstream: Vec<(String, String)> = node
                    .dependencies
                    .iter()
                    .filter_map(|d| {
                        let summary = self.task_outputs.get(&d.task_id)?;
                        let title = self.graph.get(&d.task_id).map(|t| t.title.clone()).unwrap_or_default();
                        Some((title, summary.clone()))
                    })
                    .collect();
                if !upstream.is_empty() {
                    model.note_upstream(&node.objective, &upstream);
                }
            }
        }
        Ok(Some(Begun { task_id: task_id.to_string(), node, role, agent_id }))
    }

    /// إتمام عقدة بدأت: المراجعة أو التنفيذ (بنداء أول جرى سلفًا إن وُجد)، ثم تحرير الوكيل.
    fn complete_task(&mut self, begun: Begun, model: &dyn AgentModel, first: Option<TaskExecution>) -> Result<(), StopReason> {
        let Begun { task_id, node, role, agent_id } = begun;
        let task_id = task_id.as_str();
        let outcome = if matches!(node.task_type, TaskType::Review) {
            self.run_review(task_id, &node, role, model)
        } else {
            self.run_execution_from(task_id, &agent_id, role, node.task_type, &node.objective, model, first)
        };

        self.budget.release_active_agent();
        if let Some(a) = self.agents.iter_mut().find(|a| a.agent_id == agent_id) {
            a.state = AgentState::Completed;
            a.last_active_at = self.clock.now();
        }
        outcome
    }

    /// بصمة الحالة ذات المعنى: حالات العُقد ومحاولاتها وعدد الادّعاءات وتحوّر الرسم.
    fn state_digest(&self) -> String {
        let mut parts: Vec<String> = self
            .graph
            .nodes()
            .map(|n| format!("{}:{}:{}", n.task_id, n.state.as_str(), n.attempt))
            .collect();
        parts.sort();
        format!("rev={};claims={};{}", self.graph.revision, self.claims.len(), parts.join("|"))
    }

    /// الدور المسؤول عن نوع مهمّة، بترتيب السجل الثابت.
    /// دور المخطّط للعقدة إن كان مفعّلًا ويجيز نوعها (المخطّط يقترح، والسجل يقرّر).
    fn planned_role(&self, task_id: &str, task_type: TaskType) -> Option<AgentRole> {
        let role = *self.planned_roles.get(task_id)?;
        self.registry.descriptor(role).filter(|d| d.enabled && d.allows(task_type)).map(|d| d.agent_type)
    }

    fn role_for(&self, task_type: TaskType) -> Option<AgentRole> {
        self.registry
            .descriptors()
            .iter()
            .find(|d| d.enabled && d.allows(task_type))
            .map(|d| d.agent_type)
    }

    fn report(&self) -> RunReport {
        RunReport {
            mission_state: self.mission.state,
            // الإثبات المحسوم إن حُسم، وإلا ما يُشتقّ الآن بالتعريف نفسه (R-03).
            completion_proof: self.settled_proof.clone().unwrap_or_else(|| self.current_proof()),
            tasks_succeeded: self.graph.nodes().filter(|n| n.state == TaskState::Succeeded).count(),
            tasks_failed: self.graph.nodes().filter(|n| n.state == TaskState::Failed).count(),
            tasks_blocked: self.graph.nodes().filter(|n| n.state == TaskState::Blocked).count(),
            model_calls: self.budget.model_calls_used(),
            total_tokens: self.budget.total_tokens_used(),
            claims: self.claims.len(),
            verified_claims: self.claims.iter().filter(|c| c.status == ClaimStatus::Verified).count(),
            review_independence: self.review_independence,
            tool_proposals: self.tool_proposals,
            tool_calls_executed: self.tool_decisions.iter().filter(|d| d.status == "SUCCEEDED").count() as u32,
            tool_calls_denied: self.tool_decisions.iter().filter(|d| d.status == "DENIED").count() as u32,
            tool_calls_awaiting_approval: self.tool_decisions.iter().filter(|d| d.status == "AWAITING_APPROVAL").count() as u32,
            delegations_requested: self.delegations_requested,
            delegations_executed: self.delegations_executed,
            agent_messages: self.bus.messages().len() as u32,
            stop_reason: self.stop_reason.clone(),
        }
    }
}

/// رمز قصير لإخفاق نداء نموذج، لقرار الامتداد. بلا تفصيل خام.
fn model_error_code(error: &ModelError) -> String {
    match error {
        ModelError::Cancelled => "CANCELLED".into(),
        ModelError::NoModel(_) => "NO_MODEL".into(),
        ModelError::Transient(code) => code.split(':').next().unwrap_or("TRANSIENT").chars().take(60).collect(),
        ModelError::InvalidOutput(_) => "INVALID_OUTPUT".into(),
    }
}

/// حافظ نقطة الاستئناف (E2). ينفّذه المضيف بالمخزن نفسه الذي يحفظ نهاية التشغيل.
pub trait RunCheckpoint: Send + Sync {
    /// يحفظ اللقطة. الخطأ يعود إلى زمن التشغيل ليقف المسار (R-06)، لا ليُبتلع.
    fn save(&self, snapshot: &MissionSnapshot) -> Result<(), String>;
}

/// أقصى طول لسبب إخفاق المهمّة، مطابقًا لعقد العرض.
pub const FAILURE_REASON_MAX_CHARS: usize = 256;

#[cfg(test)]
mod tests {
    #[test]
    fn a_failure_text_never_exceeds_the_view_contract_bound() {
        let long = "x".repeat(2_000);
        for stop in [super::StopReason::ModelOutputInvalid(long.clone()), super::StopReason::ProviderUnavailable(long.clone()), super::StopReason::DeliverablesIncomplete(long)] {
            assert!(super::failure_text(&stop).chars().count() <= super::FAILURE_REASON_MAX_CHARS);
        }
    }

    #[test]
    fn two_steps_with_one_objective_get_distinct_keys_and_the_first_keeps_its_text() {
        use super::super::task::{TaskNode, TaskType};
        let mut nodes = vec![
            TaskNode::new("t1", "m", "write", "write the note", TaskType::Build),
            TaskNode::new("t2", "m", "write again", "write the note", TaskType::Build),
            TaskNode::new("t3", "m", "check", "check the note", TaskType::Build),
        ];
        super::distinguish_objectives(&mut nodes);
        assert_eq!(nodes[0].objective, "write the note");
        assert_eq!(nodes[1].objective, "write the note (step 2 of the plan: write again)");
        assert_eq!(nodes[2].objective, "check the note");
        assert!(super::is_effectful("polaris.workspace.write") && !super::is_effectful("polaris.workspace.read"));
    }

    use super::observation_shows;

    #[test]
    fn an_observed_value_matches_only_what_was_actually_shown() {
        // ما ظهر فعلًا يطابق مع اختلاف المسافات والحالة.
        assert!(observation_shows("Request received —\n pending review", "request   RECEIVED"));
        // ما لم يظهر لا يطابق، مهما قال الادّعاء عن نفسه.
        assert!(!observation_shows("Request received — pending review", "ACCEPTED"));
        // قيمة قصيرة جدًّا لا تُعدّ ظهورًا: تطابق أي نصّ تقريبًا.
        assert!(!observation_shows("count: 1", "1"));
        assert!(!observation_shows("ok", "ok"));
        assert!(observation_shows("status: count: 1", "count: 1"));
    }
}
