// أنواع المزوّد: النوع، والموقع، ونمط المصادقة، ونوع نقطة النهاية، والقدرات.

use serde::{Deserialize, Serialize};

use super::facts::CapabilityClaim;

/// أصناف المزوّدات. مغلقة، وتُوسَّع بتسجيل صريح في الفهرس لا بنصّ حرّ.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderKind {
    LocalOpenaiCompatible,
    Ollama,
    LmStudio,
    Openai,
    Anthropic,
    Google,
    Openrouter,
    /// مزوّد مستضاف من الفهرس الموثّق (ADR-037): بروتوكول OpenAI-compatible على عنوان https ثابت في الفهرس.
    OpenaiCompatibleApi,
    /// مزوّد أضافه المستخدم بعنوان أساسي يختاره (ADR-037): https عامّ أو الحلقة المحلية.
    CustomOpenaiCompatible,
    /// Claude CLI المثبّت على الجهاز، نقلًا لنموذج بعيد (2026-11-12). لا مفتاح عند المضيف: الدخول ملك الأداة.
    ClaudeCli,
    /// Codex CLI المثبّت على الجهاز، نقلًا لنموذج بعيد (2026-11-12).
    CodexCli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Locality {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthMode {
    /// خادم محلي على الحلقة المحلية بلا مصادقة.
    NoAuthLocal,
    /// مفتاح API رسمي: من مخزن بيانات الاعتماد أو من متغيّر البيئة الرسمي.
    ApiKey,
    /// مفتاح اختياري (المزوّد المخصّص): يُرسل إن وُجد، وغيابه لا يمنع الفحص ولا الاستدعاء.
    OptionalApiKey,
    /// أداة سطر أوامر تحمل تسجيل دخولها بنفسها. المضيف لا يقرأ بيانات اعتماد ولا يخزّنها.
    CliLogin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EndpointType {
    OpenaiCompatible,
    OllamaNative,
    AnthropicMessages,
    GoogleGenerativeLanguage,
    /// عملية محلية لأداة سطر أوامر؛ الأداة هي التي تتصل بمزوّدها.
    LocalCli,
}

/// قدرات المزوّد على مستوى البروتوكول. قدرة النموذج الواحد تُقرأ من النموذج.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_streaming: CapabilityClaim,
    pub supports_model_listing: CapabilityClaim,
    pub supports_health_check: CapabilityClaim,
    pub supports_chat: CapabilityClaim,
    pub supports_embeddings: CapabilityClaim,
    pub supports_vision: CapabilityClaim,
    pub supports_audio_input: CapabilityClaim,
    pub supports_audio_output: CapabilityClaim,
    pub supports_tools: CapabilityClaim,
    pub supports_json_schema: CapabilityClaim,
    pub supports_system_prompt: CapabilityClaim,
    pub supports_reasoning_control: CapabilityClaim,
}
