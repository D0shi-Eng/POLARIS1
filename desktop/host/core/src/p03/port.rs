// منفذ نموذج الوكيل: الحدّ الذي يعبره كل استدعاء نموذج.
//
// المُنسِّق يعتمد على هذا المنفذ لا على مزوّد بعينه. في الإنتاج يُربط بمسار
// استدعاء Phase-02 (توجيه + بوابة خروج + محوّل مزوّد)، فلا يختار وكيل نقطة نهاية
// بعيدة عشوائية (البند 39/108). في الاختبار يُربط بتجهيزة حتمية (البند 92/136).
// كل مخرجات هذا المنفذ MODEL_GENERATED ومُلوَّثة، وتُتحقَّق قبل أي استعمال (البند 66/110).

use serde::{Deserialize, Serialize};

use super::agent::AgentRole;
use super::claim::{ClaimSubject, ClaimType};
use super::evidence::EvidenceType;
use super::task::{DependencyKind, TaskType};

/// مهمّة فرعية مُقترَحة في خطة. لا تحمل معرّفًا نهائيًّا؛ وقت التشغيل يصدره (البند 111).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlannedTask {
    pub local_key: String,
    pub title: String,
    pub objective: String,
    pub task_type: TaskType,
    pub depends_on: Vec<String>,
    pub dependency_kind: DependencyKind,
    pub recommended_role: AgentRole,
}

/// اقتراح خطة من المخطّط. مخرجات نموذج، تُتحقَّق ثم تُبنى منها العُقد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanProposal {
    pub tasks: Vec<PlannedTask>,
}

/// اقتراح ادّعاء ضمن نتيجة مهمّة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimProposal {
    pub statement: String,
    pub claim_type: ClaimType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<ClaimSubject>,
}

/// اقتراح دليل ضمن نتيجة مهمّة، بنوعه ومصدره.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceProposal {
    pub evidence_type: EvidenceType,
    pub source_ref: String,
    pub summary: String,
    /// سلالة الاشتقاق: مصادر/أدلّة سابقة بُني عليها. للاستقلال بالسلالة (البند 52).
    pub lineage: Vec<String>,
}

/// طلب استعمال أداة كما اقترحه النموذج. اقتراح لا أمر (البند 22).
///
/// لا يحمل قرارًا ولا موافقة ولا نتيجة: تلك كلها تقع خلف بوابة الأدوات، ويصدرها
/// زمن التشغيل الموثوق. وأثرُه «المتوقَّع» ملاحظة عن النموذج لا عن الأداة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolRequest {
    pub skill_id: String,
    pub tool_id: String,
    pub arguments: serde_json::Value,
    pub reason: String,
    pub expected_effect: Vec<String>,
    pub expected_output: String,
    /// قاعدة الاثنين اجتمعت في جلسة الوكيل (ADR-041 §3.1): الفعل ينتظر إنسانًا ولو أجازته سياسة الأداة. يضعه زمن التشغيل وحده.
    #[serde(default)]
    pub require_human: bool,
}

/// ما تعيده البوابة بعد أن قرّرت. مغلق، ولا يحمل جسمًا خامًا.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolDecision {
    pub invocation_id: String,
    pub tool_id: String,
    pub skill_id: String,
    /// حالة من مفردات مغلقة: SUCCEEDED, FAILED, DENIED, TIMED_OUT, CANCELLED, AWAITING_APPROVAL.
    pub status: String,
    pub denial_reason: Option<String>,
    pub summary: String,
    /// هل سجّلت البوابة دليلًا مقيسًا لهذا النداء؟
    pub evidence_recorded: bool,
    /// معرّف الموافقة المعلّقة، إن كان النداء ينتظر قرار المستخدم.
    pub pending_approval_id: Option<String>,
    /// ما لاحظته الأداة، للجولة التالية من الوكيل (Phase-08). بيانات غير موثوقة، لا تُسلسَل.
    #[serde(skip)]
    pub observation: Option<String>,
}

/// طلب تفويض وكيل آخر، كما اقترحه النموذج. اقتراح كذلك، لا أمر.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelegationRequestDraft {
    pub requested_role: AgentRole,
    pub objective: String,
    pub reason: String,
    pub expected_output: String,
}

/// جولة أداة سابقة داخل المهمّة الفرعية، كما تُعاد إلى النموذج في الجولة التالية (Phase-08).
///
/// الحالة والملخّص من البوابة (موثوقان بما قاسته)، والملاحظة محتوى الأداة (غير موثوق):
/// تُسيَّج في المُوجِّه بوسمها ولا تُقرأ تعليمات.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolTurn {
    pub tool_id: String,
    pub arguments_preview: String,
    pub status: String,
    pub denial_reason: Option<String>,
    pub summary: String,
    pub observation: Option<String>,
}

/// نتيجة تنفيذ مهمّة كما يعيدها النموذج.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskExecution {
    pub output_summary: String,
    pub claims: Vec<ClaimProposal>,
    pub evidence: Vec<EvidenceProposal>,
    /// أدوات يقترح الوكيل استعمالها. تُتحقَّق وتُقرَّر عند البوابة، لا هنا.
    pub tool_requests: Vec<ToolRequest>,
    /// تفويض يقترحه الوكيل. يقرّره المُنسِّق بحدود العمق والميزانية.
    pub delegation: Option<DelegationRequestDraft>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// أشار النموذج إلى فشل داخلي (لا يُعامَل كإثبات؛ يضبط حالة المهمّة فقط).
    pub failed: bool,
}

/// حكم المراجعة (البند 26).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewVerdict {
    Accept,
    Revise,
    Reject,
    Blocked,
}

/// نتيجة مراجعة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewResult {
    pub verdict: ReviewVerdict,
    pub notes: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// دليل موثوق: ما قاسه وقت التشغيل فعلًا، لا ما ادّعاه نموذج.
///
/// هذا هو المسار الوحيد الذي يدخل منه دليل مقيس. نموذج يعيد `evidence_type` بقيمة
/// `TEST_RESULT` لا يصنع أثر اختبار؛ يبقى ما يعيده مخرجات وكيل مهما سمّاه (البند 49).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrustedEvidence {
    pub evidence_type: EvidenceType,
    /// ما أنتجه: مُشغّل اختبارات، أو نقطة فرض سياسة، أو تأكيد مستخدم. ليس وكيلًا.
    pub producer: String,
    pub source_ref: String,
    pub summary: String,
    pub lineage: Vec<String>,
    /// بصمة بايتات النتيجة الأصلية كما قاسها مُنتِجها. تُحفظ كما هي ولا تُعاد
    /// حوسبتها من ملخّص، وإلا ضاعت هوية ما قِيس فعلًا (البند 152).
    pub digest: String,
    /// هل يؤيّد هذا الدليل الادّعاء أم يناقضه؟ اختبار فاشل دليل مقيس، لكنه دليل
    /// ضدّ الادّعاء الإيجابي لا معه؛ إغفال ذلك يجعل الفشل يُثبت النجاح.
    pub stance: EvidenceStance,
}

/// موقف الدليل من الادّعاء.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvidenceStance {
    Supports,
    Counters,
    /// قياسٌ لفعلٍ وقع، لا لنتيجته (Phase-05): «نُقر زرّ الإرسال» ليس «قُبل الطلب».
    /// يُسجَّل دليلًا في المهمّة، ولا يُربط بادّعاء مؤيّدًا ولا مناقضًا.
    Neutral,
    /// ما لوحظ فعلًا بعد القياس، نصًّا محدودًا غير موثوق المحتوى (Phase-05). يؤيّد
    /// ادّعاءً مهيكلًا واحدًا فقط حين تظهر قيمته في هذا النصّ؛ ولا يؤيّد غيره.
    Observed(String),
}

/// منفذ الأدلّة الموثوقة. يربطه وقت التشغيل بمصادر قياس حقيقية.
///
/// غيابه يعني ألّا دليل مقيس في هذه المهمّة، وبالتالي لا ادّعاء يُحقَّق بقاعدة
/// تتطلّب قياسًا — وهو الجواب الصادق، لا نقصًا يُسدّ بمخرجات النموذج.
pub trait TrustedEvidenceSource: Send + Sync {
    fn evidence_for(&self, mission_id: &str, task_id: &str, task_type: TaskType) -> Vec<TrustedEvidence>;
}

/// خطأ منفذ النموذج. مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "code", content = "detail")]
pub enum ModelError {
    /// مخرجات لا تجتاز التحقق البنيوي (البند 66/110).
    InvalidOutput(String),
    /// أُلغي الاستدعاء.
    Cancelled,
    /// لم يُوجَّه نموذج (توجيه Phase-02 رفض).
    NoModel(String),
    /// المزوّد لم يُكمل النداء لسبب عابر (انتهاء مهلة، خطأ داخلي، تعذّر وصول، تحديد معدّل).
    /// ليس عيب مخرجات: لا رسالة إصلاح JSON، بل إعادة محدودة بعد انتظار (Phase-08).
    Transient(String),
}

/// وسيط الأدوات لمهمّة واحدة.
///
/// زمن تشغيل المهمّة يعتمد على هذا المنفذ لا على بوابة بعينها، تمامًا كما يعتمد
/// على `AgentModel` لا على مزوّد بعينه. غيابه يعني أن لا أداة في هذا المضيف،
/// فيُرفض كل اقتراح صراحةً — وهو الجواب الصادق، لا تنفيذ بلا بوابة.
pub trait ToolBroker: Send + Sync {
    /// المهارة التي تُستعمل حين لا يسمّي الاقتراح مهارة. اسمٌ من السجل لا تخمين.
    fn default_skill(&self) -> Option<String>;

    /// أسماء الأدوات المسجَّلة تحت مهارة. تُعرض على النموذج، فلا يخترع اسمًا.
    fn tools_for(&self, skill_id: &str) -> Vec<String>;

    /// يمرّر اقتراحًا إلى البوابة ويعيد قرارها.
    fn invoke(&self, task_id: &str, agent_id: &str, request: &ToolRequest) -> ToolDecision;

    /// عدد النداءات التي عبرت فعلًا. مقيس، لا مُقدَّر.
    fn executed_calls(&self) -> u32;

    /// دليل الأدوات للنموذج: المعرّف والوصف لكل أداة تحت مهارة (Phase-08). بيانات عرض
    /// من السجل، لا إذن. الافتراض: لا دليل، فيبقى المُوجِّه كما أُغلق في Phase-04.
    fn tool_guide(&self, _skill_id: &str) -> Vec<(String, String)> {
        Vec::new()
    }

    /// مخطط وسائط كل أداة تحت مهارة يُعلن محوّلها مخططًا (خطة 2026-10-05، B1). عرضٌ لا إذن.
    /// الافتراض: لا مخططات، فيُعرض كائن عامّ لكل أداة إن عُرضت أصيلًا.
    fn tool_schemas(&self, _skill_id: &str) -> Vec<(String, serde_json::Value)> {
        Vec::new()
    }

    /// صفات أداة من واصفها المسجَّل (R-04). `None`: الأداة غير مسجَّلة عند هذا الوسيط، فتُعامل قاعدة الاثنين ما ليس مدمجًا
    /// بأسوأ الاحتمالات (مصدر غير موثوق، وحسّاسة، وفعل خارجي).
    fn tool_traits(&self, _tool_id: &str) -> Option<ToolTraits> {
        None
    }

    /// المهارات التعليمية المتاحة لهذه المهمّة (ADR-043): فهرس لا إذن. الافتراض: لا مهارات، فلا تُعرض `use_skill`.
    fn playbooks(&self) -> Vec<Playbook> {
        Vec::new()
    }
}

/// مهارة تعليمية كما يراها زمن التشغيل (ADR-043). متنها إرشاد لا سلطة؛ `trusted` لمدمجة كُتبت في الشيفرة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Playbook {
    pub skill_id: String,
    pub description: String,
    pub body: String,
    pub trusted: bool,
    pub required_tools: Vec<String>,
}

/// صفات أداة كما يشتقّها المضيف من واصفها في السجل (R-04، 2026-10-12)، لقاعدة الاثنين. لا يقرّرها اسم الأداة ولا بادئته.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ToolTraits {
    /// ناتجها محتوى من خارج POLARIS (خادم MCP، أو خدمة موصل، أو الشبكة).
    pub untrusted_source: bool,
    /// تصل إلى بيانات حسّاسة بذاتها (اعتمادات موصل، أو سرّ، أو إدخال سطح مكتب).
    pub sensitive: bool,
    /// فعلها يغيّر حالة خارج مساحة المهمّة أو يتواصل خارجيًّا.
    pub external: bool,
}

/// ما يبني وسيط أدوات لمهمّة. يُحقن من التركيب، فلا يعرف Phase-03 بوابةً بعينها.
pub trait ToolBrokerFactory: Send + Sync {
    fn broker_for(
        &self,
        mission_id: &str,
        project_id: Option<String>,
        cancel: polaris_host_providers::net::CancelToken,
    ) -> std::sync::Arc<dyn ToolBroker>;
}

/// نوع كتلة سياق تضيفها طبقة لاحقة إلى استدعاء الوكيل.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentContextKind {
    /// ذاكرة مسترجَعة: غير موثوقة وغير ذات سلطة (Phase-05).
    Memory,
    /// ملاحظة متصفّح أو شاشة: محتوى ويب أو شاشة، بيانات لا تعليمات (Phase-05).
    Observation,
}

/// كتلة سياق واحدة. نصّها بيانات غير موثوقة دائمًا، ويُسيَّج في المُوجِّه بوسمه.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentContextBlock {
    pub kind: AgentContextKind,
    pub text: String,
}

/// ما يُسأل به مزوّد السياق: المهمّة ومشروعها ونصّ المهمّة الفرعية.
pub struct AgentContextRequest<'a> {
    pub mission_id: &'a str,
    pub project_id: Option<&'a str>,
    pub task_objective: &'a str,
}

/// صورة أرفقها المستخدم بمهمّة (مكافأة Manus، 2026-10-19)، كما قرأها المضيف من `inputs/` بعد فحص توقيعها.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissionImage {
    /// المسار النسبي في مساحة المهمّة (`inputs/…`).
    pub path: String,
    /// `image/png` أو `image/jpeg` أو `image/gif` أو `image/webp`.
    pub media_type: String,
    pub bytes: Vec<u8>,
}

/// مصدر صور المهمّة لنموذج يرى. يملؤه Phase-08 من المرفقات؛ Phase-03 لا يعرف المساحة ولا القاعدة.
pub trait MissionImageSource: Send + Sync {
    /// صور المهمّة الصالحة إدخالًا لنموذج رؤية (`IMAGE_INPUT`)، مرتّبة كما أُرفقت، بحدّ عدد وحجم.
    fn images_for(&self, mission_id: &str) -> Vec<MissionImage>;
}

/// مزوّد سياق إضافي لاستدعاء الوكيل. يملؤه Phase-05 بالذاكرة والملاحظات، ولا يعرف
/// Phase-03 أيًّا منهما: الاتجاه نفسه الذي يملأ به Phase-04 منفذ الأدوات.
pub trait AgentContextProvider: Send + Sync {
    fn blocks_for(&self, request: &AgentContextRequest<'_>) -> Vec<AgentContextBlock>;
}

/// دليل مقيس يدعم ادّعاءً، كما يُعرض على مراقب المهمّة. معرّف ونوع ومرجع، لا محتوى.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceNote {
    pub evidence_id: String,
    pub evidence_type: EvidenceType,
    pub source_ref: String,
    pub measured: bool,
}

/// ادّعاء كما انتهى في المهمّة، مع أدلّته المقيسة المؤيّدة وحدها.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimNote {
    pub claim_id: String,
    pub task_id: Option<String>,
    pub statement: String,
    pub claim_type: ClaimType,
    pub status: &'static str,
    pub subject: Option<ClaimSubject>,
    pub supporting: Vec<EvidenceNote>,
}

/// عقدة انتهت، كما يراها مراقب المهمّة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskOutcomeNote {
    pub mission_id: String,
    pub project_id: Option<String>,
    pub task_id: String,
    pub title: String,
    pub task_type: TaskType,
    pub state: &'static str,
    pub tool_calls: u32,
}

/// مهمّة انتهى تشغيلها (أو توقّف منتظرًا قرارًا)، كما يراها مراقب المهمّة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissionOutcomeNote {
    pub mission_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub state: &'static str,
    pub terminal: bool,
    pub proof_status: &'static str,
    pub tasks_succeeded: u32,
    pub tasks_failed: u32,
    pub tasks_blocked: u32,
    pub tool_calls_executed: u32,
    pub claims: Vec<ClaimNote>,
    /// نداءات الأدوات كما سجّلتها البوابة لهذه المهمّة (خطة 2026-10-05، D3): منها تُشتقّ ذاكرة الدرس، لا من قول النموذج.
    pub tool_history: Vec<ToolRecordNote>,
}

/// مراقب دورة حياة المهمّة. يملؤه Phase-05 (ذاكرة الحلقات، وإغلاق الجلسات). لا
/// يستطيع أن يغيّر شيئًا في المهمّة: يقرأ ما انتهى ويبني عليه في طبقته.
pub trait MissionObserver: Send + Sync {
    fn task_finished(&self, _note: &TaskOutcomeNote) {}
    fn mission_finished(&self, _note: &MissionOutcomeNote) {}
    fn mission_cancelled(&self, _mission_id: &str) {}
    /// سطر من سرد المهمّة الحيّ (خطة، خطوة، أداة، ملاحظة وكيل). بيانات للعرض، لا تعليمة.
    fn narrate(&self, _note: &NarrationNote) {}
    /// نداء نموذج بدأ (`true`) أو انتهى (`false`) لهذه المهمّة: ما تعرضه الواجهة «يفكّر».
    fn thinking(&self, _mission_id: &str, _active: bool) {}
    /// عنوان المهمّة صار أوضح (اقترحه المخطّط لمحادثة): يُحفظ فورًا ليقرأه الشريط الجانبي.
    fn retitle(&self, _mission_id: &str, _title: &str) {}
    /// أسئلة متابعة اقترحها ردّ المهمّة على المستخدم (Phase-08). بيانات للعرض، لا تُنفَّذ إلا إن نقرها المستخدم.
    fn suggest(&self, _mission_id: &str, _suggestions: &[String]) {}
    /// حدث أمن سجّله زمن التشغيل (خطة 2026-10-07، ADR-041): حقن مكتشف، أو طُعم قُرئ، أو تلاعب، أو منع المراقب. المضيف يكتبه
    /// حدث مراقبة وتنبيهًا.
    fn security_event(&self, _mission_id: &str, _event: &crate::p03::security::SecurityEvent) {}
}

/// حقائق نداء نموذج واحد كما قاسها مسار الاستدعاء (خطة 2026-10-07، ADR-041 §3.2): تصنع امتداد `chat` لكل نداء، فيطابق
/// عدد الامتدادات عدد سجلّات الاستهلاك.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallFacts {
    pub invocation_id: String,
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub latency_ms: Option<u64>,
    /// OK أو ERROR أو CANCELLED أو DENIED.
    pub status: &'static str,
    /// رمز الإخفاق إن فشل.
    pub reason: Option<String>,
}

/// صنف سطر السرد. مجموعة مغلقة تطابق قيد الجدول الذي يحفظه.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NarrationKind {
    /// ما كتبه الوكيل للمستخدم عن خطّته (من ردّ التخطيط).
    Plan,
    /// خطوة بدأت: عنوانها كما في الخطة.
    Step,
    /// أداة قرّرتها البوابة: معرّفها وحالتها المقيسة.
    Action,
    /// ما كتبه الوكيل للمستخدم بعد خطوة.
    Note,
}

impl NarrationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "PLAN",
            Self::Step => "STEP",
            Self::Action => "ACTION",
            Self::Note => "NOTE",
        }
    }
}

/// سطر سرد واحد. النصّ مخرَج نموذج أو عنوان من خطته: غير موثوق، يُعرض ولا يُنفَّذ.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NarrationNote {
    pub mission_id: String,
    pub kind: NarrationKind,
    pub text: String,
    /// تفصيل مقيس اختياري (معرّف الأداة وحالتها).
    pub detail: Option<String>,
}

/// ما يحتاجه الردّ النهائي على المستخدم: تقارير الخطوات بترتيب الخطة، والملفات في مساحة المهمّة.
#[derive(Debug, Clone, Default)]
pub struct ReplyInput {
    pub reports: Vec<(String, String)>,
    pub files: Vec<String>,
    pub outcome: &'static str,
}

/// هل للمهمّة محادثة يُردّ فيها على المستخدم (Phase-08)؟ غياب المنفذ يعني السلوك المغلق.
pub trait ConversationPolicy: Send + Sync {
    fn is_conversation(&self, mission_id: &str) -> bool;
    /// معرّف المحادثة التي ينتمي إليها هذا الدور: جلسة سجلّه (خطة 2026-10-07، ADR-041). مهمّة ليست محادثة: لا شيء.
    fn thread_of_mission(&self, _mission_id: &str) -> Option<String> {
        None
    }
    /// أدوار المحادثة قبل هذا الدور بترتيبها: معرّف كل دور ورسالة المستخدم كما كتبها. لبذر سجلّ محادثة قديمة.
    fn earlier_turns(&self, _mission_id: &str) -> Vec<(String, String)> {
        Vec::new()
    }
    /// رسائل كتبها المستخدم والمهمّة تعمل (ADR-042): تُسلَّم مرّة واحدة بترتيبها عند حدّ آمن بين خطوتين، ثم تُعلَّم مسلَّمة.
    /// الافتراض: لا رسائل.
    fn take_pending_notes(&self, _mission_id: &str) -> Vec<String> {
        Vec::new()
    }
}

/// اختيار المستخدم للنموذج لمهمّة بعينها (Phase-08). يُقرأ عند البدء فقط؛ غيابه يعني
/// النموذج الافتراضي كما أُغلق في Phase-03. الاختيار يمرّ بتوجيه Phase-02 وبوابة خروجه
/// نفسيهما (توجيه يدوي)، فلا يتجاوز نموذج معطَّل ولا مزوّد بعيد بلا موافقة سياسته.
pub trait MissionModelPreference: Send + Sync {
    fn model_for(&self, mission_id: &str) -> Option<String>;
    /// نموذج المراقب الأعمى الذي اختاره المستخدم (خطة 2026-10-07، ADR-041 §3.2). الافتراض: لا مراقب، والموافقة البشرية كما هي.
    fn monitor_model(&self) -> Option<String> {
        None
    }
    /// متخصّص ثبّته المستخدم للمهمّة، إن وُجد.
    fn specialist_for(&self, _mission_id: &str) -> Option<String> {
        None
    }
    /// نموذج المراجِع البعيد الذي اختاره المستخدم (E6)، إن وُجد. يمرّ بالتوجيه وبوابة الخروج نفسيهما.
    fn review_model(&self) -> Option<String> {
        None
    }
    /// ما كتبه المستخدم عن نفسه في «تخصيص» (اللقب والمهنة ونبذة وتعليمات مخصّصة)، نصًّا جاهزًا، إن وُجد.
    fn user_profile(&self) -> Option<String> {
        None
    }
    /// هل نموذج التنفيذ لهذه المهمّة على مزوّد بعيد (E4)؟ `None` حين لا يُعرف: يُعامل كمحلي.
    fn executor_is_remote(&self, _mission_id: &str) -> Option<bool> {
        None
    }
}

/// نداء أداة كما سُجِّل عند البوابة، بلا جسم خام: ما يُقاس به الوفاء بعقد المهمّة (Phase-08).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRecordNote {
    pub invocation_id: String,
    pub task_id: String,
    pub tool_id: String,
    pub status: String,
    pub denial_reason: Option<String>,
    pub effects: Vec<String>,
    /// ملخّص قاسه المحوّل الموثوق (ليس محتوى الأداة).
    pub summary: String,
}

/// ما قاسه المضيف عن ملف مطلوب في مساحة المهمّة.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FileInspection {
    pub exists: bool,
    /// أُعيد فتحه ونجح تحقّق صيغته (أو نصّ UTF-8 غير فارغ لما لا تحقّق له).
    pub verified: bool,
    /// مصنّف يحمل مخططًا.
    pub has_chart: bool,
    pub detail: String,
}

/// منفذ قياس العقد: الملفات من مساحة المهمّة، والأدوات من سجلّ البوابة. قراءة فقط.
pub trait ContractProbe: Send + Sync {
    fn inspect_file(&self, mission_id: &str, path: &str) -> FileInspection;
    /// نداءات الأدوات المسجّلة لهذه المهمّة، الأقدم أولًا، عبر كل تشغيلاتها.
    fn tool_history(&self, mission_id: &str) -> Vec<ToolRecordNote>;
    /// ملفات مساحة العمل الحالية (مسارات نسبية، محدودة العدد)، لسياق «المخرجات المتاحة».
    fn workspace_files(&self, mission_id: &str) -> Vec<String>;
    /// بصمة SHA-256 لملف في المساحة الآن (خطة 2026-10-07، ADR-041 §3.4). لا شيء إن غاب. منفذ لا يقيس البصمة يعيد لا شيء.
    fn file_digest(&self, _mission_id: &str, _path: &str) -> Option<String> {
        None
    }
    /// بصمات الملفات المحميّة (inputs/) كما أُخذت عند أول طلب لهذه المهمّة، محفوظة خارج المساحة. الطلب الأول يأخذها.
    fn protected_files(&self, _mission_id: &str) -> Vec<(String, String)> {
        Vec::new()
    }
    /// النصّ المستخرج من مخرَج في المساحة (DOCX/PDF/PPTX/XLSX/نصّ)، لمصحِّح النصّ المطلوب. لا شيء إن تعذّر.
    fn file_text(&self, _mission_id: &str, _path: &str) -> Option<String> {
        None
    }
}

/// مدخل المراجعة (Phase-08). كل نصّ فيه مخرجات وكلاء غير محقَّقة أو قوائم مقيسة؛ لا تعليمة فيه.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReviewInput {
    /// هدف عقدة المراجعة كما خطّطه المخطّط.
    pub objective: String,
    /// تقرير كل مهمّة تراجعها: العنوان والحالة وملخّص الوكيل وحقائق الأدوات المقيسة.
    pub work: Vec<String>,
    /// ملفات موجودة فعلًا في المساحة.
    pub files: Vec<String>,
}

/// أقسام سياق المهمّة الفرعية، محدودة ومرتّبة بالأولوية (Phase-08): المتطلّبات المتبقّية قبل
/// نثر المهامّ السابقة. كل نصّ فيها بيانات بوسمها؛ لا شيء منها تعليمة نظام.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskContextSections {
    /// ما لم يُستوفَ بعد من عقد المهمّة، بقياس المضيف.
    pub remaining_requirements: Vec<String>,
    /// تسليم منظَّم من المهامّ السابقة: مخرجات وكلاء غير محقَّقة، وحقائق أدوات مقيسة.
    pub previous_results: Vec<String>,
    /// ملفات موجودة فعلًا في المساحة.
    pub available_files: Vec<String>,
    /// الخطة كلها كما يعرفها زمن التشغيل: كل عقدة بحالتها، وموضع هذه المهمّة منها. عناوينها من المخطّط
    /// (مخرجات وكيل)، فتُعرض رسالةَ وكيل لا سلطة لها. العامل الذي يرى موضعه لا يعيد ما تولّته عقدة أخرى.
    pub plan_outline: Vec<String>,    /// ما أُنجز فعلًا في هذه المهمّة بقياس البوابة (خطة 2026-10-06، C4): كل أداة ذات أثر نجحت، بخطوتها وملخّصها الموثوق.
    /// يُعرض آخر السياق ليرى الوكيل ما لا يجوز أن يعيده. قِيس 2026-10-05: العقدة الثانية في MISSION-A أعادت قراءة
    /// المدخلات وكتابة المستند مرّتين بعد أن أنجزته الأولى.
    pub done_actions: Vec<String>,
}

/// ردّ واحد في حلقة الوكيل (ADR-039): نصّه، واستدعاءاته المقترحة، واستدلاله الظاهر، ورموزه كما أبلغ بها المزوّد.
/// كل ما فيه مخرجات نموذج غير موثوقة: الاستدعاءات اقتراحات تمرّ بالبوابة، والاستدلال لا يُحفظ ولا يُعرض.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LoopTurn {
    pub text: String,
    pub tool_calls: Vec<polaris_host_providers::domain::ProposedToolCall>,
    pub reasoning: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// R-37: انتهى الردّ عند سقف رموز المخرجات (`finish_reason = length`). استدعاء في ردّ كهذا قد تكون وسائطه مبتورة.
    pub cut_at_limit: bool,
}

/// المنفذ. تنفيذ واحد لكل بيئة: إنتاج (Phase-02) أو تجهيزة اختبار.
pub trait AgentModel: Send + Sync {
    /// يخطّط لمهمّة: يعيد اقتراح خطة أو خطأ.
    fn plan(&self, mission_objective: &str) -> Result<PlanProposal, ModelError>;

    /// رموز آخر نداء `plan` كما أبلغها المزوّد، تُقرأ مرة (D-8). `None`: لا تقرير، فيُحاسب صفرًا معلنًا لا رقمًا مقدَّرًا.
    fn take_plan_usage(&self) -> Option<(u64, u64)> {
        None
    }

    /// ينفّذ مهمّة فرعية بدور معيّن.
    fn execute(&self, role: AgentRole, task_type: TaskType, objective: &str) -> Result<TaskExecution, ModelError>;

    /// يراجع مخرجات مهمّة.
    fn review(&self, role: AgentRole, target_task: &str) -> Result<ReviewResult, ModelError>;

    /// هل طلب الوكيل في آخر ردّ له على هذه المهمّة أن يرى نتائج أدواته قبل أن يُنهي
    /// (Phase-08)؟ الطلب صريح في مخرجاته (`"continue": true`)، والافتراض: لا، فتبقى
    /// التجهيزات الحتمية لـPhase-03..07 وردودها المسجّلة بسلوكها المغلق (استدعاء واحد).
    fn wants_tool_results(&self, _objective: &str) -> bool {
        false
    }

    /// يسلّم المنفذَ ما أبلغت عنه المهامّ التي تعتمد عليها هذه المهمّة (عنوانها وملخّص مخرجاتها)،
    /// قبل تنفيذها. مخرجات وكلاء غير محقَّقة، تُعرض رسائلَ وكلاء لا سلطة لها. الافتراض: تجاهلها،
    /// فتبقى تجهيزات Phase-03..07 على سلوكها المغلق.
    fn note_upstream(&self, _objective: &str, _upstream: &[(String, String)]) {}

    /// ردّ لم يطابق عقده: يُبلَّغ المنفذ بالخطأ ليصلحه في محاولة واحدة تالية (Phase-08). يعيد
    /// «صحيح» إن كان يدعم الإصلاح؛ الافتراض لا، فتبقى تجهيزات Phase-03..07 على سلوكها المغلق.
    fn note_invalid_output(&self, _objective: &str, _detail: &str) -> bool {
        false
    }

    /// يتابع مهمّة فرعية بعد أن رأى نتائج أدواتها. يعيد تنفيذًا جديدًا (قد يقترح أدوات أخرى
    /// أو يُنهي بقائمة أدوات فارغة). لا يُستدعى إلا إن أعلن المنفذ دعم المتابعة.
    fn continue_execution(&self, _role: AgentRole, _task_type: TaskType, _objective: &str, _turns: &[ToolTurn]) -> Result<TaskExecution, ModelError> {
        Err(ModelError::InvalidOutput("this model port does not continue a task".into()))
    }

    /// هل يدعم المنفذ ضوابط Phase-08 الحتمية حول الخطة والتنفيذ (عقد المهمّة، إصلاح الخطة،
    /// الاستكمال، التذكير بالأداة، ومتابعة الملاحظات عند بقاء متطلّبات)؟ الافتراض: لا، فتبقى
    /// تجهيزات Phase-03..07 على سلوكها المغلق.
    fn recovery_enabled(&self) -> bool {
        false
    }

    /// ملاحظة إصلاح خطة واحدة، تُعرض في نداء التخطيط التالي ثم تُمحى.
    fn note_plan_feedback(&self, _feedback: &str) {}

    /// أقسام السياق لمهمّة فرعية قبل تنفيذها (تستبدل ما سبقها لهذا الهدف).
    fn note_task_context(&self, _objective: &str, _sections: &TaskContextSections) {}

    /// تذكير محدود بمتطلّب لم تُقترح له أداة بعد؛ يُعرض في نداء المتابعة التالي مرة واحدة.
    /// ليس سلطة: النموذج يقترح، والبوابة تقرّر.
    fn note_reminder(&self, _objective: &str, _reminder: &str) {}

    /// محاولة جديدة لمهمّة فرعية بعد ردّين مشوّهين: المنفذ يغيّر ما يجعل الردّ نفسه يتكرّر (تنبيه
    /// بالإيجاز، وعيّنة غير حتمية محدودة). لا يمنح شيئًا.
    fn note_retry(&self, _objective: &str) {}

    /// ما كتبه الوكيل للمستخدم في آخر ردّ لهذا الهدف (حقل `narration` الاختياري)، ويُمحى بقراءته.
    fn take_narration(&self, _objective: &str) -> Option<String> {
        None
    }

    /// عنوان قصير للطلب اقترحه المخطّط (حقل `title` الاختياري في الخطة)، ويُمحى بقراءته.
    /// بيانات عرض فقط: لا يغيّر الهدف ولا الخطة.
    fn take_title(&self, _objective: &str) -> Option<String> {
        None
    }

    /// أسئلة المتابعة التي فصلها آخر ردّ عن نصّه (حتى ثلاثة). لا شيء افتراضيًّا.
    fn take_suggestions(&self) -> Vec<String> {
        Vec::new()
    }

    /// قائمة قصيرة من المتخصّصين (معرّف، ووصف بالإنجليزية) يعرضها زمن التشغيل على المخطّط ليقترح
    /// واحدًا لكل عقدة. القائمة من الكتالوج المضمَّن، لا من النموذج.
    fn offer_specialists(&self, _shortlist: &[(String, String)]) {}

    /// ما اقترحه المخطّط متخصّصًا للعقدة ذات هذا الهدف، ويُمحى بقراءته. اقتراح فقط: زمن التشغيل
    /// يتحقّق منه أو يختار هو.
    fn specialist_hint(&self, _objective: &str) -> Option<String> {
        None
    }

    /// تعليمات المتخصّص الذي اختاره زمن التشغيل للعقدة ذات هذا الهدف، تدخل موجّه تنفيذها.
    fn brief(&self, _objective: &str, _brief: &str) {}

    /// ما يراجعه المراجِع (Phase-08): هدف عقدة المراجعة، وتقارير المهامّ التي تراجعها، والملفات الموجودة.
    /// قِيس 2026-10-01 أن المراجِع كان يتلقّى «راجع مخرجات المهمّة <معرّف>» وحده، فيحكم على ما لم يرَه.
    /// الافتراض: تجاهله، فتبقى تجهيزات Phase-03..07 على سلوكها المغلق.
    fn note_review_input(&self, _review_task: &str, _input: &ReviewInput) {}
    /// كم خطوة مستقلّة جاهزة يجوز أن يجري نداء تنفيذها الأول معًا (خطة 2026-10-05، E4). واحد افتراضًا: التوازي
    /// للنموذج البعيد وحده، ولا يتجاوز ثلاثًا؛ النموذج المحلي يبقى نداءً واحدًا في وقت واحد حمايةً للعتاد.
    fn parallel_first_calls(&self) -> usize {
        1
    }

    /// هل تجري المراجعة على نموذج غير نموذج التنفيذ (E6)؟ «لا» افتراضًا: المراجعة تُسجَّل `SAME_MODEL_REVIEW`.
    fn reviews_independently(&self) -> bool {
        false
    }

    /// ملاحظات مراجِع طلب التعديل، للمهمّة التي تُعاد بهذا الهدف: تصل محاولتها التالية رسالةَ وكيل بلا سلطة.
    fn note_review_feedback(&self, _objective: &str, _notes: &str) {}

    /// محاولة سابقة لهذا الهدف فشلت بسبب مقيس (خطة 2026-10-05، E3)، وستُعاد مرة: يصل السبب محاولتها التالية لتسلك طريقًا
    /// آخر. الافتراض: تجاهله، فتبقى تجهيزات Phase-03..07 على سلوكها المغلق.
    fn note_attempt_failed(&self, _objective: &str, _reason: &str) {}

    /// الهدف التالي ينفّذه زميل مفوَّض (خطة 2026-10-06): سياقه نظيف خاصّ به، ويعود بخلاصة، ولا يدخل سجلّ محادثة المهمّة.
    /// الافتراض: تجاهله.
    fn note_delegate(&self, _objective: &str) {}

    /// رسالة وكيل آخر لصاحب هذا الهدف (نتيجة زميل فوّضه)، تصل نداءاته التالية رسالةَ وكيل بلا سلطة.
    /// قِيس 2026-10-01 أن نتيجة التفويض كانت تُنشر على الناقل ولا يقرؤها أحد.
    fn note_agent_message(&self, _objective: &str, _message: &str) {}

    /// هل يعرف المنفذ خطوة الردّ النهائي؟ التجهيزات الحتمية لا تعرفها، فلا يُحجز لها نداء.
    fn can_reply(&self) -> bool {
        false
    }

    /// الردّ النهائي على المستخدم بلغته: النصّ ورموز الإدخال والإخراج المقيسة.
    fn reply(&self, _input: &ReplyInput) -> Result<(String, u64, u64), ModelError> {
        Err(ModelError::NoModel("this model port has no reply step".into()))
    }

    /// هل يعمل المنفذ بحلقة الوكيل (ADR-039)، وبأي صيغة تنتقل الأدوات؟ `None`: لا، فتبقى التجهيزات الحتمية والمسارات
    /// المغلقة على مسار الرسم القديم. قد تتغيّر الصيغة أثناء المهمّة: خادم رفض الاستدعاء الأصيل يعيدها نصّية.
    fn loop_mode(&self) -> Option<super::agent_loop::LoopMode> {
        None
    }

    /// W-2: كم رمزًا يتّسع للمُوجِّه كله (التعليمة والأدوات والمحادثة) في نافذة النموذج الذي يخدم المهمّة. `None`: غير معروف،
    /// فتبقى عتبة الضغط الثابتة وحدها كما كانت.
    fn input_token_budget(&self) -> Option<u64> {
        None
    }

    /// ردّ واحد في الحلقة: تعليمة النظام، والمحادثة كما هي، والأدوات المعروضة. المنفذ ينقلها أصيلةً أو يقرأ الوضع النصّي.
    fn loop_turn(
        &self,
        _system: &str,
        _messages: &[polaris_host_providers::domain::ChatMessage],
        _tools: &[polaris_host_providers::domain::ToolOffer],
    ) -> Result<LoopTurn, ModelError> {
        Err(ModelError::NoModel("this model port has no agent loop".into()))
    }

    /// كتل السياق المسترجَع للطلب (ذاكرة، ملاحظات) بوسم صنفها، لافتتاحية الحلقة. بيانات غير موثوقة. لا شيء افتراضيًّا.
    fn loop_context(&self, _objective: &str) -> Vec<(String, String)> {
        Vec::new()
    }

    /// عنوان قصير للطلب بلغة المستخدم، بنداء صغير واحد، لطلب لم تسمّه الخطة. لا شيء افتراضيًّا.
    /// حقائق النداءات التي جرت منذ آخر طلب، الأقدم أولًا. منفذ لا يقيسها يعيد قائمة فارغة، فيصنع زمن التشغيل امتدادًا لكل
    /// محاولة بما يعرفه هو.
    fn take_call_facts(&self) -> Vec<CallFacts> {
        Vec::new()
    }

    /// حقائق النداءات التي جرت في هذا الخيط وحده (G4): نداءات فروع متوازية لا تختلط حقائقها. الافتراض لا شيء.
    fn take_thread_call_facts(&self) -> Vec<CallFacts> {
        Vec::new()
    }

    fn loop_title(&self, _objective: &str) -> Option<(String, u64, u64)> {
        None
    }
}
