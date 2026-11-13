// الرسالة المحايدة تجاه المزوّد، وطلب الاستدعاء، وناتجه.
//
// لا أداة ولا وسائط في Phase-02: كتل نصّية فقط. كل محوّل يترجم هذا الشكل إلى
// بروتوكوله، فلا تتسرّب شروط مزوّد إلى الطبقات العليا.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: Role,
    pub text: String,
    /// استدعاءات الأدوات التي طلبها النموذج في ردّ سابق (رسالة مساعد في سجلّ محادثة، خطة 2026-10-06، C2).
    /// فارغة في كل رسالة أخرى. محوّل لا ينقل الأدوات أصيلًا يرفض رسالة تحملها بدل إسقاطها.
    pub tool_calls: Vec<ProposedToolCall>,
    /// معرّف الاستدعاء الذي تجيب عنه رسالة نتيجة أداة (`Role::Tool`). غيابه في غيرها.
    pub tool_call_id: Option<String>,
    /// استدلال النموذج الظاهر كما بثّه مع ردّ سابق (رسالة مساعد). لا يُحفظ ولا يُعرض: يُعاد إلى المزوّد نفسه وحده حين
    /// توثّق صفحته أن إسقاطه مع الأدوات يُرفض أو يقطع سلسلة استدلاله (ديب سيك وKimi وMiniMax؛ انظر `WireProfile`).
    pub reasoning: Option<String>,
    /// صور ترافق رسالة مستخدم (تكليف مكافأة Manus، 2026-10-19). لا تُرسل إلا حين يعلن النموذج الموجَّه إليه قدرة الرؤية؛
    /// القرار عند المضيف قبل بناء الطلب. محوّل لا ينقل الصور يرفض رسالة تحملها بدل إسقاطها صامتًا.
    pub images: Vec<ImagePart>,
}

/// صورة واحدة بصيغة يقبلها كل بروتوكول رؤية معروف: نوعها وبايتاتها base64. لا عنوان بعيد: المحتوى من مساحة المهمّة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImagePart {
    /// `image/png` أو `image/jpeg` أو `image/gif` أو `image/webp`.
    pub media_type: String,
    pub data_base64: String,
}

impl ChatMessage {
    /// رسالة نصّية عادية بلا استدعاءات.
    pub fn text(role: Role, text: impl Into<String>) -> Self {
        Self { role, text: text.into(), tool_calls: Vec::new(), tool_call_id: None, reasoning: None, images: Vec::new() }
    }

    /// هل تحمل الرسالة شيئًا من بروتوكول الأدوات الأصيل (استدعاءات أو نتيجة استدعاء)؟
    pub fn carries_tool_protocol(&self) -> bool {
        !self.tool_calls.is_empty() || self.tool_call_id.is_some() || self.role == Role::Tool
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResponseFormat {
    Text,
    Json,
}

/// جهد الاستدلال المخفي المطلوب من نموذج يستدلّ قبل أن يجيب (Phase-08). حقل بروتوكول قياسي
/// (`reasoning_effort` في الواجهة المتوافقة، `think` في Ollama)، لا اسم عائلة نموذج. الخادم الذي
/// لا يعرفه يتجاهله أو لا يُرسَل إليه؛ لا يغيّر سلطة ولا سياسة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasoningEffort {
    /// بلا استدلال مخفي.
    None,
    Low,
    /// الدرجات التالية يختارها المستخدم من مربع الجهد (2026-11-12)؛ الوكيل نفسه لا يطلب إلا `Low` أو `None`.
    Medium,
    High,
    /// أعلى ما يقبله المزوّد. الواجهة المتوافقة لا تعرف إلا حتى `high`، فتُرسل إليها `high`.
    Max,
}

impl ReasoningEffort {
    /// القيمة في حقل `reasoning_effort` للواجهة المتوافقة مع OpenAI (none|low|medium|high).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High | Self::Max => "high",
        }
    }

    /// القيمة لأداتي Codex CLI وClaude CLI (قِيس 2026-11-12: كلتاهما تقبل low|medium|high|xhigh|max).
    /// `None` لا مقابل له عندهما، فيُطلب أدنى جهد.
    pub fn cli_level(self) -> &'static str {
        match self {
            Self::None | Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Max => "max",
        }
    }

    /// يقرأ قيمة التفضيل المخزّنة (LOW|MEDIUM|HIGH|MAX). غير ذلك = لا تفضيل.
    pub fn from_preference(value: &str) -> Option<Self> {
        match value {
            "LOW" => Some(Self::Low),
            "MEDIUM" => Some(Self::Medium),
            "HIGH" => Some(Self::High),
            "MAX" => Some(Self::Max),
            _ => None,
        }
    }
}

/// طلب جاهز للمحوّل. التوجيه والسياق والسياسة حُسمت قبل بنائه.
#[derive(Debug, Clone)]
pub struct InvocationSpec {
    pub provider_model_id: String,
    pub system: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub response_format: ResponseFormat,
    /// Phase-08: جهد الاستدلال المطلوب. `None` في الحقل تعني عدم الطلب (سلوك Phase-02).
    pub reasoning_effort: Option<ReasoningEffort>,
    /// الجهد الذي اختاره المستخدم صراحةً من مربع الجهد (2026-11-12). `None` = «افتراضي»: يبقى سلوك المزوّد.
    /// أداتا سطر الأوامر تقرآنه وحده، لأن `reasoning_effort` أعلاه قد يكون جهد الوكيل الداخلي لا اختيار المستخدم.
    pub user_effort: Option<ReasoningEffort>,
    /// أدوات تُعرض بصيغة الاستدعاء الأصيل (خطة 2026-10-05، B2). فارغة = لا عرض، وهو سلوك ما قبلها.
    pub tools: Vec<ToolOffer>,
    /// نافذة سياق النموذج كما أبلغ بها خادمه أو فهرسه، إن عُرفت. يحتاجها خادم تُضبط نافذته لكل طلب (Ollama `num_ctx`)، كي
    /// لا يقطع الموجّه بصمت؛ والبقية تتجاهلها (الجلسة 1، 2026-10-07).
    pub context_window: Option<u64>,
    /// صياغة الحقول الاختيارية كما يوثّقها المزوّد (2026-10-06). المحوّل المحلي يتجاهلها ويبقى على سلوكه.
    pub wire: WireProfile,
    /// هل يُعلن الفهرس أن النموذج يستدلّ؟ جهد الاستدلال لا يُرسل إلى مستضاف إلا لنموذج يعلنه (قِيس 2026-10-06 على Groq:
    /// نموذج لا يستدلّ رفض الحقل برمز 400).
    pub model_reasons: bool,
}

/// أين يكتب المزوّد سقف المخرجات.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaxTokensField {
    MaxTokens,
    MaxCompletionTokens,
}

/// كيف يُطلب جهد الاستدلال من مزوّد مستضاف.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffortWire {
    /// لا يُرسل شيء: يبقى افتراض المزوّد.
    Omit,
    /// `reasoning_effort` في أعلى الجسم (OpenAI وGroq وxAI وديب سيك).
    ReasoningEffort,
    /// `enable_thinking` في أعلى الجسم (Alibaba Model Studio)، يُرسل لإطفاء الاستدلال وحده.
    EnableThinking,
    /// `thinking: {"type": "disabled"}` (Z.AI)، يُرسل لإطفاء الاستدلال وحده.
    ThinkingType,
}

/// صياغة الطلب لمزوّد بعينه. كل قيمة هنا من صفحة المزوّد الرسمية أو من قياس، والمصادر في
/// `docs/providers/PROVIDERS-2026-10-06.md`. لا اسم نموذج هنا: الفروق بين نماذج المزوّد الواحد تُحسم من الفهرس
/// (`model_reasons`) ومن رفض 400 يسمّي حقلًا اختياريًا فيُعاد النداء بدونه مرة.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WireProfile {
    /// هل تُرسل درجة الحرارة؟ لا للمستضاف افتراضًا: Anthropic (نماذج ما بعد Opus 4.6) وKimi وOpenAI (نماذج الاستدلال)
    /// ترفض كل قيمة غير قيمتها الثابتة، وديب سيك يتجاهلها في وضع الاستدلال.
    pub send_temperature: bool,
    pub max_tokens: MaxTokensField,
    pub effort: EffortWire,
    /// يُعاد `reasoning_content` في رسائل المساعد السابقة. ديب سيك: «يجب» مع الأدوات وإلا 400؛ Kimi: «احفظه دائمًا»؛
    /// MiniMax: «يجب أن يُلحق الردّ كاملًا».
    pub echo_reasoning: bool,
    /// `reasoning_split: true` (MiniMax): الاستدلال في حقله لا داخل `<think>` في النصّ.
    pub reasoning_split: bool,
}

impl WireProfile {
    /// خادم محلي أو صياغة لم تُوثَّق بعد: درجة الحرارة تُرسل كما كانت، ولا حقل استدلال إضافي.
    pub const LOCAL: Self = Self { send_temperature: true, max_tokens: MaxTokensField::MaxTokens, effort: EffortWire::Omit, echo_reasoning: false, reasoning_split: false };
    /// مستضاف متوافق لم يُوثَّق له شيء خاصّ: بلا درجة حرارة، و`reasoning_effort` لنموذج يعلن الاستدلال.
    pub const HOSTED: Self = Self { send_temperature: false, max_tokens: MaxTokensField::MaxTokens, effort: EffortWire::ReasoningEffort, echo_reasoning: false, reasoning_split: false };
}

impl Default for WireProfile {
    fn default() -> Self {
        Self::LOCAL
    }
}

/// أداة معروضة على النموذج بصيغة الاستدعاء الأصيل. عرضٌ لا إذن: القرار عند بوابة المضيف.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOffer {
    /// اسم آمن للبروتوكول (`[A-Za-z0-9_-]`، حتى 64)، يعيّنه المضيف ويملك خريطته العكسية.
    pub name: String,
    pub description: String,
    /// مخطط JSON لوسائط الأداة.
    pub parameters: serde_json::Value,
}

/// استدعاء أداة كما أعاده النموذج. اقتراح غير موثوق: الاسم والوسائط يُتحقَّق منهما عند المستهلك.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedToolCall {
    pub id: Option<String>,
    pub name: String,
    /// نصّ الوسائط كما بثّه النموذج (JSON يُفترض)، بلا تحليل هنا.
    pub arguments: String,
}

/// أقصى عدد استدعاءات أصيلة تُقبل في ردّ واحد، وأقصى طول لوسائط كلٍّ منها.
pub const MAX_TOOL_CALLS: usize = 16;
pub const MAX_TOOL_ARGUMENT_CHARS: usize = 64_000;

/// هل الاسم صالح لاسم دالّة في البروتوكول المتوافق؟
pub fn is_protocol_tool_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FinishReason {
    Stop,
    Length,
    ContentFilter,
    ToolCall,
    Cancelled,
    Unknown,
}

/// الاستهلاك كما أبلغ به المزوّد. غيابه مجهول، ولا يُقدَّر هنا.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    /// رموز المدخلات التي أعاد المزوّد استعمالها من ذاكرة البادئة (جزء من `input_tokens`). غيابه مجهول.
    pub cached_input_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct InvocationOutput {
    pub text: String,
    pub finish_reason: FinishReason,
    pub usage: Usage,
    pub provider_request_id: Option<String>,
    /// زمن أول بايت من جسم الاستجابة، مقيس على المضيف.
    pub first_byte_ms: Option<u64>,
    pub streamed: bool,
    /// استدعاءات الأدوات الأصيلة، إن عُرضت أدوات وطلبها النموذج.
    pub tool_calls: Vec<ProposedToolCall>,
    /// الاستدلال الظاهر الذي بثّه النموذج (`reasoning_content` أو `reasoning`). يعبر إلى سجلّ المحادثة ليُعاد إلى
    /// مزوّد يشترطه، ولا يُحفظ ولا يُعرض.
    pub reasoning: Option<String>,
}

/// أقصى طول لنصّ ناتج يُقبل من مزوّد.
pub const MAX_OUTPUT_CHARS: usize = 256_000;

/// معرّف طلب المزوّد يُقبل فقط إن كان قصيرًا وبحروف آمنة.
pub fn safe_request_id(raw: &str) -> Option<String> {
    let ok = !raw.is_empty()
        && raw.len() <= 128
        && raw.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
    ok.then(|| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_are_filtered() {
        assert_eq!(safe_request_id("req_01ABC-9"), Some("req_01ABC-9".into()));
        assert_eq!(safe_request_id("<script>"), None);
        assert_eq!(safe_request_id(&"a".repeat(200)), None);
    }
}
