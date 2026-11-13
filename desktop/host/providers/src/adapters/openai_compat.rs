// بروتوكول OpenAI-compatible: قائمة `/v1/models` واستدعاء `/v1/chat/completions`.
//
// يخدم الخادم المحلي العام وخدمة OpenAI نفسها، ويُعاد استعماله داخل محوّلات
// أخرى (LM Studio وOpenRouter). البث بأحداث SSE، ويُجمَع هنا إلى ناتج واحد.

use serde_json::{json, Map, Value};

use crate::adapters::common::{self, clean_model_id, clean_text, MAX_MODELS, MAX_STREAM_BYTES, MAX_STREAM_LINE};
use crate::adapters::{CallContext, ProviderAdapter};
use crate::domain::messages::{
    is_protocol_tool_name, safe_request_id, ChatMessage, EffortWire, MaxTokensField, ProposedToolCall, ReasoningEffort, Role, WireProfile, MAX_OUTPUT_CHARS, MAX_TOOL_ARGUMENT_CHARS,
    MAX_TOOL_CALLS,
};
use crate::domain::{
    CapabilityClaim, DiscoveredModel, Fact, FinishReason, HealthProbe, InvocationOutput, InvocationSpec,
    ModelCapability, ResponseFormat, Usage,
};
use crate::error::{ProviderError, ProviderErrorCode};
use crate::net::lines::LineReader;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    /// خادم محلي عام: لا نفترض دعم خيارات إضافية.
    LocalGeneric,
    /// خدمة OpenAI المستضافة.
    HostedOpenAi,
    /// LM Studio: محلي بواجهة متوافقة.
    LocalStudio,
    /// OpenRouter: مسار بادئ `/api`.
    Router,
    /// مزوّد مستضاف من الفهرس (ADR-037): العنوان الأساسي يحمل نسخته (`…/v1` أو `…/v4`)، فالمسارات بلا بادئة،
    /// والمفتاح مطلوب. لا نفترض دعم خيار إضافي: الرفض الذي يسمّي حقلًا اختياريًا يُعاد بدونه مرة.
    HostedGeneric,
    /// مزوّد أضافه المستخدم: مثل المستضاف، والمفتاح اختياري.
    Custom,
}

pub struct OpenAiCompatible {
    pub flavor: Flavor,
}

impl OpenAiCompatible {
    pub fn local_generic() -> Self {
        Self { flavor: Flavor::LocalGeneric }
    }

    pub fn hosted_openai() -> Self {
        Self { flavor: Flavor::HostedOpenAi }
    }

    pub fn with_flavor(flavor: Flavor) -> Self {
        Self { flavor }
    }

    /// العنوان الأساسي للمستضاف والمخصّص يحمل نسخته؛ للبقية تُضاف `/v1`.
    fn versioned(&self, path: &str) -> String {
        if matches!(self.flavor, Flavor::HostedGeneric | Flavor::Custom) {
            path.to_string()
        } else {
            format!("/v1{path}")
        }
    }

    pub fn models_path(&self) -> String {
        self.versioned("/models")
    }

    pub fn chat_path(&self) -> String {
        self.versioned("/chat/completions")
    }

    fn requires_auth(&self) -> bool {
        matches!(self.flavor, Flavor::HostedOpenAi | Flavor::Router | Flavor::HostedGeneric)
    }

    fn auth_guard(&self, ctx: &CallContext<'_>, for_listing: bool) -> Result<(), ProviderError> {
        let needed = self.requires_auth() && !(for_listing && self.flavor == Flavor::Router);
        if needed && ctx.credential.is_none() {
            return Err(ProviderError::new(ProviderErrorCode::AuthRequired, "no credential configured"));
        }
        Ok(())
    }

    /// يحلّل `{ "data": [ { "id": … } ] }` إلى نماذج، بلا تخمين لأي قدرة.
    pub fn parse_models(&self, value: &Value) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let data = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "models response has no data array"))?;
        let mut seen = std::collections::BTreeSet::new();
        let mut models = Vec::new();
        for entry in data.iter().take(MAX_MODELS) {
            let Some(id) = clean_model_id(entry.get("id")) else { continue };
            // التكرار يُسقط بصمت محسوب: المعرّف هو هوية النموذج، ونسختان منه لا معنى لهما.
            if !seen.insert(id.clone()) {
                continue;
            }
            let mut model = DiscoveredModel::bare(id);
            model.vendor = Fact::reported_opt(clean_text(entry.get("owned_by"), 64));
            // نافذة السياق وسقف المخرجات حين يبلّغ بهما المزوّد في قائمته (Groq: `context_window` و`max_completion_tokens`،
            // OpenRouter وغيره: `context_length`). قيمة صفرية أو غائبة تبقى مجهولة.
            let positive = |key: &str| entry.get(key).and_then(Value::as_u64).filter(|v| *v > 0 && *v <= 100_000_000);
            // llama-server (قِيس 2026-10-19 على Bonsai 2 27B): نافذة السياق المحمّلة في `meta.n_ctx`.
            let loaded_ctx = entry.pointer("/meta/n_ctx").and_then(Value::as_u64).filter(|v| *v > 0 && *v <= 100_000_000);
            model.context_window = Fact::reported_opt(positive("context_window").or_else(|| positive("context_length")).or(loaded_ctx));
            model.max_output_tokens = Fact::reported_opt(positive("max_completion_tokens"));
            // llama-server يعيد بجانب `data` قائمة `models` بقدرات كل نموذج؛ `multimodal` تعني أن مُسقِط الرؤية محمّل (`--mmproj`).
            // غيابها لا يُقرأ «لا يرى»: يبقى مجهولًا، والمضيف لا يرسل صورة إلى المجهول.
            let multimodal = value.get("models").and_then(Value::as_array).is_some_and(|list| {
                list.iter().any(|m| {
                    let same = [m.get("model"), m.get("name")].into_iter().flatten().any(|v| v.as_str() == Some(model.provider_model_id.as_str()));
                    same && m.get("capabilities").and_then(Value::as_array).is_some_and(|caps| caps.iter().any(|c| c.as_str() == Some("multimodal")))
                })
            });
            if multimodal {
                model.set_claim(ModelCapability::VisionInput, CapabilityClaim::reported(true));
            }
            models.push(model);
        }
        Ok(models)
    }

    /// صياغة هذا الطلب: المستضاف العامّ والمخصّص يأخذان صياغة مزوّدهما من الفهرس، وخدمة OpenAI صياغتها الموثّقة، والمحلي
    /// والموجّه سلوكهما السابق كما هو.
    fn wire(&self, spec: &InvocationSpec) -> WireProfile {
        match self.flavor {
            Flavor::HostedGeneric | Flavor::Custom => spec.wire,
            // OpenAI: `max_completion_tokens`، ونماذج الاستدلال ترفض درجة حرارة غير 1 (developers.openai.com، 2026-10-06).
            Flavor::HostedOpenAi => WireProfile { max_tokens: MaxTokensField::MaxCompletionTokens, ..WireProfile::HOSTED },
            // OpenRouter يمرّر الطلب إلى مزوّد النموذج، ومنهم من يرفض درجة الحرارة: لا تُرسل. جهده بفرعه أدناه كما كان.
            Flavor::Router => WireProfile { send_temperature: false, ..WireProfile::LOCAL },
            Flavor::LocalGeneric | Flavor::LocalStudio => WireProfile::LOCAL,
        }
    }

    pub fn chat_body(&self, spec: &InvocationSpec, stream: bool) -> Result<Value, ProviderError> {
        let wire = self.wire(spec);
        let mut messages = Vec::new();
        if let Some(system) = &spec.system {
            messages.push(json!({ "role": "system", "content": system }));
        }
        for message in &spec.messages {
            messages.push(message_json(message, wire.echo_reasoning)?);
        }
        let mut body = Map::new();
        body.insert("model".into(), json!(spec.provider_model_id));
        body.insert("messages".into(), Value::Array(messages));
        body.insert("stream".into(), json!(stream));
        // الاستهلاك يُطلب في البثّ من كل نكهة (قِيس 2026-10-05: بدونه أعاد الخادم المحلي ردوده بلا رموز في 69
        // من 69 نداءً، فلم تعمل حدود الرموز محليًّا). خادم محلي يرفض الحقل يُعاد إليه النداء مرة بدونه.
        if stream {
            body.insert("stream_options".into(), json!({ "include_usage": true }));
        }
        if let (Some(t), true) = (spec.temperature, wire.send_temperature) {
            body.insert("temperature".into(), json!(t));
        }
        if let Some(max) = spec.max_output_tokens {
            let key = match wire.max_tokens {
                MaxTokensField::MaxTokens => "max_tokens",
                MaxTokensField::MaxCompletionTokens => "max_completion_tokens",
            };
            body.insert(key.into(), json!(max));
        }
        if wire.reasoning_split {
            body.insert("reasoning_split".into(), json!(true));
        }
        // جهد الاستدلال (Phase-08): حقل الواجهة المتوافقة القياسي، يُرسل إلى الخادم المحلي والموجّه فقط؛
        // الخدمة المستضافة ترفضه لنماذج لا تستدلّ، فلا يُرسل إليها.
        if let Some(effort) = spec.reasoning_effort {
            if matches!(self.flavor, Flavor::LocalStudio | Flavor::Router) {
                body.insert("reasoning_effort".into(), json!(effort.as_str()));
            }
            // الخادم المحلي العامّ (خادم Bonsai) لا يُرسل إليه الحقل أعلاه، فكان الجهد المطلوب لا يصله أصلًا (قُرئ
            // 2026-10-06: Bonsai يعمل بجهد «medium» وميزانية تفكير 2048 من سطر تشغيله). يصله عبر متغيّرات القالب، وهي
            // الآلية التي يقرأ بها قالب النموذج الجهدَ والتفكير. خادم يرفض الحقل يُعاد إليه النداء مرة بدونه.
            if self.flavor == Flavor::LocalGeneric {
                let kwargs = match effort {
                    ReasoningEffort::None => json!({ "enable_thinking": false }),
                    other => json!({ "reasoning_effort": other.as_str() }),
                };
                body.insert("chat_template_kwargs".into(), kwargs);
            }
            // المستضاف (2026-10-06): بالصياغة التي توثّقها صفحة المزوّد، ولنموذج يعلن الفهرس أنه يستدلّ وحده.
            if matches!(self.flavor, Flavor::HostedGeneric | Flavor::Custom | Flavor::HostedOpenAi) && spec.model_reasons {
                match (wire.effort, effort) {
                    (EffortWire::ReasoningEffort, _) => {
                        body.insert("reasoning_effort".into(), json!(effort.as_str()));
                    }
                    (EffortWire::EnableThinking, ReasoningEffort::None) => {
                        body.insert("enable_thinking".into(), json!(false));
                    }
                    (EffortWire::ThinkingType, ReasoningEffort::None) => {
                        body.insert("thinking".into(), json!({ "type": "disabled" }));
                    }
                    _ => {}
                }
            }
        }
        if !spec.tools.is_empty() {
            let mut tools = Vec::with_capacity(spec.tools.len());
            for tool in &spec.tools {
                if !is_protocol_tool_name(&tool.name) {
                    return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "a tool name is not a protocol-safe function name"));
                }
                tools.push(json!({ "type": "function", "function": { "name": tool.name, "description": tool.description, "parameters": tool.parameters } }));
            }
            body.insert("tools".into(), Value::Array(tools));
            body.insert("tool_choice".into(), json!("auto"));
        }
        // مع أدوات أصيلة لا يُطلب إخراج مقيَّد بمخطط من خادم محلي: قيد القواعد على المحتوى يمنع الاستدعاء نفسه.
        // العقد يبقى في المُوجِّه ويُفكَّك بصرامة عندنا كما في الوضع النصّي.
        // المستضاف العامّ والمخصّص مثله: لا نعرف كيف يجمع خادمهما القيدين.
        let local_with_tools = !spec.tools.is_empty() && matches!(self.flavor, Flavor::LocalGeneric | Flavor::LocalStudio | Flavor::HostedGeneric | Flavor::Custom);
        if spec.response_format == ResponseFormat::Json && !local_with_tools {
            match self.flavor {
                Flavor::HostedOpenAi | Flavor::HostedGeneric | Flavor::Custom => {
                    body.insert("response_format".into(), json!({ "type": "json_object" }));
                }
                // الخادم المحلي يعرف المخرجات المهيكلة بمخطط JSON فقط (Phase-08): مخطط «كائن» عامّ يضمن
                // صحّة البناء بفكّ مقيَّد، والعقد الكامل يبقى في المُوجِّه ويُتحقَّق منه عند المستهلك.
                Flavor::LocalStudio => {
                    body.insert(
                        "response_format".into(),
                        json!({ "type": "json_schema", "json_schema": { "name": "reply", "schema": { "type": "object" } } }),
                    );
                }
                _ => return Err(ProviderError::new(ProviderErrorCode::UnsupportedCapability, "JSON mode is not declared for this provider")),
            }
        }
        Ok(Value::Object(body))
    }

    /// هل رفض خادم محلي طلبَ الاستهلاك نفسه؟ رفض 400 يذكر الحقل وحده يُعاد بدونه؛ أيّ رفض آخر يبقى رفضًا.
    #[cfg(test)]
    fn refused_usage_option(&self, error: &ProviderError) -> bool {
        self.refused_optional_fields(error).contains(&"stream_options")
    }

    /// الحقول الاختيارية التي يرسلها هذا المحوّل إلى خادم محلي ويسمّيها رفضُ 400: تُحذف ويُعاد النداء مرة. الحقل الذي
    /// لا يسمّيه الرفض لا يُحذف، وأيّ رفض آخر يبقى رفضًا كما هو.
    fn refused_optional_fields(&self, error: &ProviderError) -> Vec<&'static str> {
        let fields: &[&'static str] = match self.flavor {
            Flavor::LocalGeneric | Flavor::LocalStudio => LOCAL_OPTIONAL_FIELDS,
            Flavor::HostedGeneric | Flavor::Custom => HOSTED_OPTIONAL_FIELDS,
            Flavor::HostedOpenAi => &["reasoning_effort"],
            Flavor::Router => &[],
        };
        if error.code != ProviderErrorCode::InvalidRequest {
            return Vec::new();
        }
        let diagnostic = error.diagnostic();
        fields.iter().copied().filter(|field| diagnostic.contains(field)).collect()
    }

    pub fn invoke_at(&self, spec: &InvocationSpec, ctx: &CallContext<'_>, path: String) -> Result<InvocationOutput, ProviderError> {
        self.auth_guard(ctx, false)?;
        let body = self.chat_body(spec, true)?;
        let mut response = match common::send(ctx, "POST", path.clone(), common::bearer(ctx), Some(body.clone())) {
            Err(error) if !self.refused_optional_fields(&error).is_empty() => {
                let mut plain = body;
                if let Some(map) = plain.as_object_mut() {
                    for field in self.refused_optional_fields(&error) {
                        map.remove(field);
                    }
                }
                common::send(ctx, "POST", path, common::bearer(ctx), Some(plain)).map_err(model_output_error)?
            }
            Err(error) => return Err(model_output_error(error)),
            Ok(response) => response,
        };
        let first_byte_ms = Some(response.first_byte_ms);
        let is_stream = response
            .header("content-type")
            .map(|v| v.to_ascii_lowercase().contains("text/event-stream"))
            .unwrap_or(false);
        if !is_stream {
            // خادم تجاهل طلب البث وأعاد جسمًا واحدًا: يُقبل كما هو، ويُسجَّل أنه لم يُبث.
            let bytes = response.body.read_all(common::MAX_JSON_BYTES).map_err(common::transport_error)?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|e| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("invalid JSON: {e}")))?;
            return parse_completion(&value, first_byte_ms);
        }
        let mut reader = LineReader::new(&mut response.body, MAX_STREAM_LINE, MAX_STREAM_BYTES);
        let mut text = String::new();
        let mut reasoning = String::new();
        let mut finish = FinishReason::Unknown;
        let mut usage = Usage::default();
        let mut request_id = None;
        let mut completed = false;
        let mut calls = ToolCallAssembler::default();
        loop {
            let event = match reader.next_event() {
                Ok(Some(event)) => event,
                Ok(None) => break,
                Err(error) => return Err(common::transport_error(error)),
            };
            if event.trim() == "[DONE]" {
                completed = true;
                break;
            }
            let chunk: Value = serde_json::from_str(&event)
                .map_err(|e| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("invalid stream chunk: {e}")))?;
            if let Some(error) = chunk.get("error") {
                return Err(stream_error(error));
            }
            if request_id.is_none() {
                request_id = chunk.get("id").and_then(Value::as_str).and_then(safe_request_id);
            }
            if let Some(choice) = chunk.get("choices").and_then(Value::as_array).and_then(|c| c.first()) {
                if let Some(delta) = choice.pointer("/delta/content").and_then(Value::as_str) {
                    if text.len() + delta.len() > MAX_OUTPUT_CHARS {
                        return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "output exceeds the limit"));
                    }
                    text.push_str(delta);
                }
                // الاستدلال الظاهر: `reasoning_content` (ديب سيك وKimi وMiniMax وZ.AI وAlibaba) أو `reasoning` (Groq، قِيس
                // 2026-10-06). يُجمع ليُعاد إلى مزوّد يشترطه؛ ما زاد على السقف يُترك (لا يُقدَّم ناقصًا على أنه كامل).
                for key in ["/delta/reasoning_content", "/delta/reasoning"] {
                    if let Some(part) = choice.pointer(key).and_then(Value::as_str) {
                        if reasoning.len() + part.len() <= MAX_OUTPUT_CHARS {
                            reasoning.push_str(part);
                        }
                    }
                }
                if let Some(deltas) = choice.pointer("/delta/tool_calls").and_then(Value::as_array) {
                    for delta in deltas {
                        calls.absorb(delta)?;
                    }
                }
                if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                    finish = finish_reason(reason);
                }
            }
            if let Some(u) = chunk.get("usage").filter(|u| u.is_object()) {
                usage = parse_usage(u);
            } else if usage.input_tokens.is_none() {
                // خادم Bonsai المحلي يبلّغ بالعدّ في `timings` حتى حين لا يعيد `usage`: عدّ الخادم نفسه، لا تقدير.
                if let Some(t) = chunk.get("timings").and_then(usage_of_timings) {
                    usage = t;
                }
            }
        }
        if !completed && finish == FinishReason::Unknown {
            // انقطع البث قبل علامة النهاية ودون سبب إنهاء: ناتج ناقص لا يُقدَّم كاملًا.
            return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "stream ended without completion"));
        }
        let tool_calls = calls.finish();
        let reasoning = (!reasoning.is_empty()).then_some(reasoning);
        Ok(InvocationOutput { text, finish_reason: finish, usage, provider_request_id: request_id, first_byte_ms, streamed: true, tool_calls, reasoning })
    }
}

/// خطأ يصل داخل البثّ (`event: error`). قِيس على Groq في 2026-10-06: استدعاء أداة باسم خاطئ يصل هكذا برمز
/// `tool_use_failed` وحالة 400 بعد 200. هذا عيب في مخرجات النموذج، لا عطل في المزوّد ولا رفض للأدوات: يُصنَّف ردًّا غير صالح
/// فيُصلَح بملاحظة، ولا يُعاد كأنه عابر، ولا يُطفئ الأدوات الأصيلة للمهمّة.
/// OpenRouter يرسل الرمز رقمًا يساوي حالة HTTP، ونوعه في `metadata.error_type` (توثيق «Errors»): يُقرأ الرقم حالةً حين تغيب
/// `status_code`، و`rate_limit_exceeded` تقييد مهما كان الرقم.
fn stream_error(error: &Value) -> ProviderError {
    let code = match error.get("code") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    let status = error.get("status_code").and_then(Value::as_u64).or_else(|| error.get("code").and_then(Value::as_u64));
    let error_type = error.pointer("/metadata/error_type").and_then(Value::as_str).unwrap_or_default();
    let message = error.get("message").and_then(Value::as_str).unwrap_or_default();
    let class = if is_tool_use_failure(&code, message) {
        ProviderErrorCode::ProviderResponseInvalid
    } else if error_type == "rate_limit_exceeded" {
        ProviderErrorCode::RateLimited
    } else {
        match status {
            Some(400 | 413 | 422) => ProviderErrorCode::InvalidRequest,
            Some(429) => ProviderErrorCode::RateLimited,
            _ => ProviderErrorCode::ProviderInternalError,
        }
    };
    let kind = if error_type.is_empty() { String::new() } else { format!(" ({error_type})") };
    ProviderError::new(class, format!("stream error {code}{kind}: {}", message.chars().take(600).collect::<String>()))
}

/// رفض 400 قبل البثّ لاستدعاء أداة صاغه النموذج خطأً هو كذلك عيب مخرجات.
fn model_output_error(error: ProviderError) -> ProviderError {
    if error.code == ProviderErrorCode::InvalidRequest && is_tool_use_failure("", error.diagnostic()) {
        return ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("tool_use_failed: {}", error.diagnostic().chars().take(600).collect::<String>()));
    }
    error
}

fn is_tool_use_failure(code: &str, message: &str) -> bool {
    code == "tool_use_failed" || message.contains("tool_use_failed") || message.contains("Tool call validation failed")
}

/// حقول اختيارية يرسلها المحوّل إلى خادم محلي، ويُعاد النداء بدون ما يسمّيه رفضُ 400 منها.
const LOCAL_OPTIONAL_FIELDS: &[&str] = &["stream_options", "chat_template_kwargs"];

/// حقول اختيارية يرسلها المحوّل إلى مستضاف عامّ أو مخصّص. بعضهم يرفض `stream_options` (Cohere يقول ذلك في وثائقه)،
/// وبعضهم لا يعرف وضع JSON؛ العقد يبقى في المُوجِّه ويُتحقَّق منه عند المستهلك كما في الوضع النصّي.
/// ومنذ 2026-10-06 حقول الاستدلال كذلك: قِيس على Groq أن نموذجًا لا يستدلّ يرفض `reasoning_effort` برمز 400 يسمّيه.
const HOSTED_OPTIONAL_FIELDS: &[&str] = &["stream_options", "response_format", "reasoning_effort", "enable_thinking", "thinking", "reasoning_split", "temperature"];

/// رسالة سجلّ المحادثة بصيغة البروتوكول المتوافق. رسالة المساعد تحمل استدعاءاتها بمعرّفاتها، ورسالة النتيجة تحمل معرّف
/// الاستدعاء الذي تجيب عنه؛ اسم دالّة غير آمن أو نتيجة بلا معرّف تُرفض قبل الإرسال بدل أن يُصلحها الخادم بتخمين.
fn message_json(message: &ChatMessage, echo_reasoning: bool) -> Result<Value, ProviderError> {
    let role = common::role_name(message.role);
    if message.role == Role::Tool {
        let Some(id) = message.tool_call_id.as_deref().filter(|id| !id.is_empty()) else {
            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "a tool result message carries no call id"));
        };
        return Ok(json!({ "role": role, "tool_call_id": id, "content": message.text }));
    }
    // الاستدلال يُعاد في رسالة المساعد لمزوّد يشترطه وحده، وبحقله الموثّق.
    let echo = |mut value: Value| {
        if let (true, Role::Assistant, Some(reasoning)) = (echo_reasoning, message.role, message.reasoning.as_deref().filter(|r| !r.is_empty())) {
            if let Some(map) = value.as_object_mut() {
                map.insert("reasoning_content".into(), json!(reasoning));
            }
        }
        value
    };
    if !message.images.is_empty() {
        if message.role != Role::User {
            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "only a user message carries images"));
        }
        let mut parts = vec![json!({ "type": "text", "text": message.text })];
        for image in &message.images {
            parts.push(json!({ "type": "image_url", "image_url": { "url": format!("data:{};base64,{}", image.media_type, image.data_base64) } }));
        }
        return Ok(json!({ "role": role, "content": parts }));
    }
    if message.tool_calls.is_empty() {
        return Ok(echo(json!({ "role": role, "content": message.text })));
    }
    if message.role != Role::Assistant {
        return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "only an assistant message carries tool calls"));
    }
    let mut calls = Vec::with_capacity(message.tool_calls.len());
    for call in &message.tool_calls {
        let Some(id) = call.id.as_deref().filter(|id| !id.is_empty()) else {
            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "an earlier tool call carries no id"));
        };
        if !is_protocol_tool_name(&call.name) {
            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "an earlier tool call is not a protocol-safe function name"));
        }
        calls.push(json!({ "id": id, "type": "function", "function": { "name": call.name, "arguments": call.arguments } }));
    }
    let content = if message.text.is_empty() { Value::Null } else { json!(message.text) };
    Ok(echo(json!({ "role": role, "content": content, "tool_calls": calls })))
}

pub fn finish_reason(raw: &str) -> FinishReason {
    match raw {
        "stop" | "end_turn" => FinishReason::Stop,
        "length" | "max_tokens" => FinishReason::Length,
        "content_filter" => FinishReason::ContentFilter,
        "tool_calls" | "function_call" => FinishReason::ToolCall,
        _ => FinishReason::Unknown,
    }
}

pub fn parse_usage(value: &Value) -> Usage {
    Usage {
        input_tokens: value.get("prompt_tokens").and_then(Value::as_u64),
        output_tokens: value.get("completion_tokens").and_then(Value::as_u64),
        cached_input_tokens: value.pointer("/prompt_tokens_details/cached_tokens").and_then(Value::as_u64),
    }
}

/// عدّ الخادم المحلي في `timings`: `prompt_n` رموز المدخلات المعالَجة الآن، و`cache_n` ما أُعيد من ذاكرة البادئة،
/// فالمدخلات مجموعهما. يُقبل فقط إن حضر الحقلان الأساسيان معًا.
pub fn usage_of_timings(value: &Value) -> Option<Usage> {
    let prompt = value.get("prompt_n").and_then(Value::as_u64)?;
    let predicted = value.get("predicted_n").and_then(Value::as_u64)?;
    let cached = value.get("cache_n").and_then(Value::as_u64);
    Some(Usage { input_tokens: Some(prompt + cached.unwrap_or(0)), output_tokens: Some(predicted), cached_input_tokens: cached })
}

/// استجابة غير متدفقة.
pub fn parse_completion(value: &Value, first_byte_ms: Option<u64>) -> Result<InvocationOutput, ProviderError> {
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "completion has no choices"))?;
    let tool_calls = match choice.pointer("/message/tool_calls").and_then(Value::as_array) {
        Some(list) => {
            let mut calls = ToolCallAssembler::default();
            for (index, call) in list.iter().enumerate() {
                let mut delta = call.clone();
                if let Some(map) = delta.as_object_mut() {
                    map.insert("index".into(), json!(index));
                }
                calls.absorb(&delta)?;
            }
            calls.finish()
        }
        None => Vec::new(),
    };
    // ردّ يطلب أدوات قد يأتي بلا نصّ: يُقبل حينها نصًّا فارغًا. ردّ بلا نصّ ولا أدوات ما زال غير صالح.
    let text = match choice.pointer("/message/content").and_then(Value::as_str) {
        Some(text) => text,
        None if !tool_calls.is_empty() => "",
        None => return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "completion has no text")),
    };
    if text.len() > MAX_OUTPUT_CHARS {
        return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "output exceeds the limit"));
    }
    Ok(InvocationOutput {
        text: text.to_string(),
        finish_reason: choice.get("finish_reason").and_then(Value::as_str).map(finish_reason).unwrap_or(FinishReason::Unknown),
        usage: value
            .get("usage")
            .map(parse_usage)
            .or_else(|| value.get("timings").and_then(usage_of_timings))
            .unwrap_or_default(),
        provider_request_id: value.get("id").and_then(Value::as_str).and_then(safe_request_id),
        first_byte_ms,
        streamed: false,
        tool_calls,
        reasoning: ["/message/reasoning_content", "/message/reasoning"]
            .iter()
            .find_map(|k| choice.pointer(k).and_then(Value::as_str))
            .filter(|r| !r.is_empty() && r.len() <= MAX_OUTPUT_CHARS)
            .map(str::to_string),
    })
}

/// يجمع استدعاءات الأدوات من أجزاء البثّ بمفتاح `index`: الاسم يأتي عادةً كاملًا في أول جزء، والوسائط مقطّعة.
/// حدود صريحة على العدد والطول؛ تجاوزها ردّ غير صالح لا قصّ صامت.
#[derive(Default)]
struct ToolCallAssembler {
    calls: Vec<(u64, Option<String>, String, String)>,
}

impl ToolCallAssembler {
    fn absorb(&mut self, delta: &Value) -> Result<(), ProviderError> {
        let index = delta.get("index").and_then(Value::as_u64).unwrap_or(0);
        let position = match self.calls.iter().position(|c| c.0 == index) {
            Some(position) => position,
            None => {
                if self.calls.len() >= MAX_TOOL_CALLS {
                    return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "too many tool calls in one reply"));
                }
                self.calls.push((index, None, String::new(), String::new()));
                self.calls.len() - 1
            }
        };
        let entry = &mut self.calls[position];
        if let Some(id) = delta.get("id").and_then(Value::as_str).and_then(safe_request_id) {
            entry.1 = Some(id);
        }
        if let Some(name) = delta.pointer("/function/name").and_then(Value::as_str) {
            entry.2.push_str(name);
            if entry.2.len() > 128 {
                return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "a tool name exceeds the limit"));
            }
        }
        match delta.pointer("/function/arguments") {
            Some(Value::String(part)) => entry.3.push_str(part),
            // بعض الخوادم ترسل الوسائط كائنًا لا نصًّا: يُحفظ نصّه كما هو.
            Some(value @ Value::Object(_)) => entry.3.push_str(&value.to_string()),
            _ => {}
        }
        if entry.3.len() > MAX_TOOL_ARGUMENT_CHARS {
            return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "tool call arguments exceed the limit"));
        }
        Ok(())
    }

    fn finish(self) -> Vec<ProposedToolCall> {
        let mut calls = self.calls;
        calls.sort_by_key(|c| c.0);
        calls
            .into_iter()
            .filter(|c| !c.2.is_empty())
            .map(|(_, id, name, arguments)| ProposedToolCall { id, name, arguments })
            .collect()
    }
}

impl ProviderAdapter for OpenAiCompatible {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        self.auth_guard(ctx, true)?;
        let path = ctx.endpoint.path(&self.models_path());
        let (value, _) = common::get_json(ctx, path, common::bearer(ctx))?;
        let mut models = self.parse_models(&value)?;
        for model in &mut models {
            // البروتوكول يبثّ: هذه حقيقة عن نقطة الاستدعاء، موثّقة، لا عن النموذج.
            model.set_claim(ModelCapability::Streaming, CapabilityClaim::documented(true));
        }
        Ok(models)
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        if self.auth_guard(ctx, true).is_err() {
            return HealthProbe::not_measured(crate::domain::HealthState::AuthRequired, crate::domain::HealthReason::CredentialMissing);
        }
        common::probe(ctx, ctx.endpoint.path(&self.models_path()), common::bearer(ctx))
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        self.invoke_at(spec, ctx, ctx.endpoint.path(&self.chat_path()))
    }

    /// الصور أجزاءَ `image_url` في رسالة المستخدم (الصيغة الموثّقة لواجهة chat/completions، ويقبلها llama.cpp وLM Studio
    /// وOpenRouter). أن ينقلها البروتوكول لا يعني أن النموذج يرى: ذلك قدرة النموذج المعلنة، يفحصها المضيف.
    fn supports_image_input(&self) -> bool {
        true
    }

    fn supports_native_tools(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ChatMessage, Role, Support};

    fn spec(format: ResponseFormat) -> InvocationSpec {
        InvocationSpec {
            provider_model_id: "fixture-model".into(),
            system: Some("sys".into()),
            messages: vec![ChatMessage::text(Role::User, "hi")],
            temperature: Some(0.2),
            max_output_tokens: Some(64),
            response_format: format,
            reasoning_effort: None,
            user_effort: None,
            tools: Vec::new(),
            wire: crate::domain::WireProfile::LOCAL,
            context_window: None,
            model_reasons: false,
        }
    }

    #[test]
    fn listing_deduplicates_and_skips_unsafe_ids() {
        let adapter = OpenAiCompatible::local_generic();
        let value = serde_json::json!({ "data": [ { "id": "a" }, { "id": "a" }, { "id": "b c" }, { "id": 3 }, { "id": "z", "owned_by": "org" } ] });
        let models = adapter.parse_models(&value).unwrap();
        assert_eq!(models.iter().map(|m| m.provider_model_id.as_str()).collect::<Vec<_>>(), vec!["a", "z"]);
        assert_eq!(models[1].vendor.value.as_deref(), Some("org"));
        assert_eq!(models[0].claim(ModelCapability::VisionInput).support, Support::Unknown);
    }

    /// OpenRouter (توثيق «Errors»، 2026-10-15): الخطأ داخل البثّ رمزه رقم يساوي حالة HTTP، ونوعه في `metadata.error_type`. قبل الإصلاح
    /// صُنّف 429 عطلًا داخليًا لأن الرمز قُرئ نصًّا فقط (قِيس في eval/2.2 على nemotron-3-ultra:free).
    #[test]
    fn openrouter_numeric_stream_error_codes_keep_their_class() {
        let limited = stream_error(&serde_json::json!({ "code": 429, "message": "Rate limit exceeded", "metadata": { "error_type": "rate_limit_exceeded" } }));
        assert_eq!(limited.code, ProviderErrorCode::RateLimited);
        let typed = stream_error(&serde_json::json!({ "code": 0, "message": "slow down", "metadata": { "error_type": "rate_limit_exceeded" } }));
        assert_eq!(typed.code, ProviderErrorCode::RateLimited);
        let invalid = stream_error(&serde_json::json!({ "code": 400, "message": "bad request" }));
        assert_eq!(invalid.code, ProviderErrorCode::InvalidRequest);
        let overloaded = stream_error(&serde_json::json!({ "code": 503, "message": "provider overloaded", "metadata": { "error_type": "provider_overloaded" } }));
        assert_eq!(overloaded.code, ProviderErrorCode::ProviderInternalError);
        assert!(overloaded.diagnostic().contains("503") && overloaded.diagnostic().contains("provider_overloaded"), "{}", overloaded.diagnostic());
    }

    #[test]
    fn a_listing_without_data_is_invalid() {
        let adapter = OpenAiCompatible::local_generic();
        let error = adapter.parse_models(&serde_json::json!({ "models": [] })).unwrap_err();
        assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
    }

    #[test]
    fn the_hosted_body_uses_the_newer_limit_field() {
        let body = OpenAiCompatible::hosted_openai().chat_body(&spec(ResponseFormat::Json), true).unwrap();
        assert_eq!(body["max_completion_tokens"], 64);
        assert_eq!(body["response_format"]["type"], "json_object");
        assert_eq!(body["messages"][0]["role"], "system");
        let local = OpenAiCompatible::local_generic().chat_body(&spec(ResponseFormat::Text), true).unwrap();
        assert_eq!(local["max_tokens"], 64);
    }

    #[test]
    fn every_flavor_asks_for_usage_in_a_stream_and_never_outside_one() {
        for flavor in [Flavor::LocalGeneric, Flavor::LocalStudio, Flavor::HostedOpenAi, Flavor::Router] {
            let streamed = OpenAiCompatible::with_flavor(flavor).chat_body(&spec(ResponseFormat::Text), true).unwrap();
            assert_eq!(streamed["stream_options"]["include_usage"], true);
            let whole = OpenAiCompatible::with_flavor(flavor).chat_body(&spec(ResponseFormat::Text), false).unwrap();
            assert!(whole.get("stream_options").is_none(), "a non-streamed request carried stream options");
        }
    }

    #[test]
    fn only_a_local_refusal_naming_the_usage_option_is_retried_without_it() {
        let named = ProviderError::from_http_status(400, br#"{"error":"unknown field stream_options"}"#);
        let other = ProviderError::from_http_status(400, br#"{"error":"bad model"}"#);
        assert!(OpenAiCompatible::local_generic().refused_usage_option(&named));
        assert!(!OpenAiCompatible::local_generic().refused_usage_option(&other));
        assert!(!OpenAiCompatible::hosted_openai().refused_usage_option(&named));
    }

    #[test]
    fn a_refused_template_option_is_named_and_dropped_alone() {
        let named = ProviderError::from_http_status(400, br#"{"error":"unknown field chat_template_kwargs"}"#);
        assert_eq!(OpenAiCompatible::local_generic().refused_optional_fields(&named), vec!["chat_template_kwargs"]);
        assert!(!OpenAiCompatible::local_generic().refused_usage_option(&named), "the usage option was dropped for a refusal that did not name it");
        assert!(OpenAiCompatible::hosted_openai().refused_optional_fields(&named).is_empty());
    }

    #[test]
    fn the_requested_reasoning_effort_reaches_a_generic_local_server_through_template_options() {
        let mut low = spec(ResponseFormat::Text);
        low.reasoning_effort = Some(ReasoningEffort::Low);
        let body = OpenAiCompatible::local_generic().chat_body(&low, true).unwrap();
        assert_eq!(body["chat_template_kwargs"], serde_json::json!({ "reasoning_effort": "low" }));
        assert!(body.get("reasoning_effort").is_none());
        let mut none = spec(ResponseFormat::Text);
        none.reasoning_effort = Some(ReasoningEffort::None);
        let body = OpenAiCompatible::local_generic().chat_body(&none, true).unwrap();
        assert_eq!(body["chat_template_kwargs"], serde_json::json!({ "enable_thinking": false }));
        // بلا طلب جهد لا يُرسل شيء، والخادم المستضاف لا يتلقّى متغيّرات القالب أبدًا.
        assert!(OpenAiCompatible::local_generic().chat_body(&spec(ResponseFormat::Text), true).unwrap().get("chat_template_kwargs").is_none());
        assert!(OpenAiCompatible::hosted_openai().chat_body(&low, true).unwrap().get("chat_template_kwargs").is_none());
    }

    #[test]
    fn earlier_tool_calls_and_their_results_travel_with_their_ids() {
        let mut thread = spec(ResponseFormat::Text);
        thread.messages.push(ChatMessage {
            role: Role::Assistant,
            text: String::new(),
            tool_calls: vec![ProposedToolCall { id: Some("call-1".into()), name: "polaris_workspace_read".into(), arguments: "{\"path\":\"a.txt\"}".into() }],
            tool_call_id: None,
            reasoning: None,
            images: Vec::new(),
        });
        thread.messages.push(ChatMessage { images: Vec::new(), role: Role::Tool, text: "status: SUCCEEDED".into(), tool_calls: Vec::new(), tool_call_id: Some("call-1".into()), reasoning: None });
        let body = OpenAiCompatible::local_generic().chat_body(&thread, true).unwrap();
        let assistant = &body["messages"][2];
        assert_eq!(assistant["role"], "assistant");
        assert!(assistant["content"].is_null());
        assert_eq!(assistant["tool_calls"][0]["id"], "call-1");
        assert_eq!(assistant["tool_calls"][0]["function"]["name"], "polaris_workspace_read");
        assert_eq!(body["messages"][3], serde_json::json!({ "role": "tool", "tool_call_id": "call-1", "content": "status: SUCCEEDED" }));
        // نتيجة بلا معرّف، أو استدعاء سابق بلا معرّف، يُرفضان قبل الإرسال.
        let mut orphan = spec(ResponseFormat::Text);
        orphan.messages.push(ChatMessage { images: Vec::new(), role: Role::Tool, text: "x".into(), tool_calls: Vec::new(), tool_call_id: None, reasoning: None });
        assert_eq!(OpenAiCompatible::local_generic().chat_body(&orphan, true).unwrap_err().code, ProviderErrorCode::InvalidRequest);
        let mut anonymous = spec(ResponseFormat::Text);
        anonymous.messages.push(ChatMessage { images: Vec::new(), role: Role::Assistant, text: String::new(), tool_calls: vec![ProposedToolCall { id: None, name: "t".into(), arguments: "{}".into() }], tool_call_id: None, reasoning: None });
        assert_eq!(OpenAiCompatible::local_generic().chat_body(&anonymous, true).unwrap_err().code, ProviderErrorCode::InvalidRequest);
    }

    #[test]
    fn usage_carries_cached_tokens_and_falls_back_to_local_server_timings() {
        // الشكل كما أعاده Bonsai على خادمه المحلي في قياس 2026-10-05.
        let usage = parse_usage(&serde_json::json!({ "completion_tokens": 37, "prompt_tokens": 44, "prompt_tokens_details": { "cached_tokens": 12 } }));
        assert_eq!((usage.input_tokens, usage.output_tokens, usage.cached_input_tokens), (Some(44), Some(37), Some(12)));
        let timed = usage_of_timings(&serde_json::json!({ "cache_n": 10, "prompt_n": 34, "predicted_n": 37 })).unwrap();
        assert_eq!((timed.input_tokens, timed.output_tokens, timed.cached_input_tokens), (Some(44), Some(37), Some(10)));
        assert!(usage_of_timings(&serde_json::json!({ "prompt_n": 34 })).is_none(), "a partial count was accepted");
        let whole = parse_completion(&serde_json::json!({ "choices": [ { "message": { "content": "ok" }, "finish_reason": "stop" } ], "timings": { "prompt_n": 5, "predicted_n": 2 } }), None).unwrap();
        assert_eq!((whole.usage.input_tokens, whole.usage.output_tokens), (Some(5), Some(2)));
    }

    #[test]
    fn the_local_studio_receives_json_mode_as_a_generic_object_schema() {
        let body = OpenAiCompatible::with_flavor(Flavor::LocalStudio).chat_body(&spec(ResponseFormat::Json), true).unwrap();
        assert_eq!(body["response_format"]["type"], "json_schema");
        assert_eq!(body["response_format"]["json_schema"]["schema"]["type"], "object");
        let text = OpenAiCompatible::with_flavor(Flavor::LocalStudio).chat_body(&spec(ResponseFormat::Text), true).unwrap();
        assert!(text.get("response_format").is_none(), "a text request carried a response format");
    }

    fn offer() -> crate::domain::ToolOffer {
        crate::domain::ToolOffer {
            name: "polaris_workspace_write".into(),
            description: "Write a file".into(),
            parameters: json!({ "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] }),
        }
    }

    #[test]
    fn offered_tools_are_sent_as_functions_and_a_local_server_gets_no_competing_schema() {
        let mut request = spec(ResponseFormat::Json);
        request.tools = vec![offer()];
        let body = OpenAiCompatible::with_flavor(Flavor::LocalStudio).chat_body(&request, true).unwrap();
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "polaris_workspace_write");
        assert_eq!(body["tools"][0]["function"]["parameters"]["required"][0], "path");
        assert_eq!(body["tool_choice"], "auto");
        assert!(body.get("response_format").is_none(), "a local server received a grammar that would block tool calls");
        let hosted = OpenAiCompatible::hosted_openai().chat_body(&request, true).unwrap();
        assert_eq!(hosted["response_format"]["type"], "json_object");
        let plain = OpenAiCompatible::local_generic().chat_body(&spec(ResponseFormat::Text), true).unwrap();
        assert!(plain.get("tools").is_none() && plain.get("tool_choice").is_none());
    }

    #[test]
    fn an_unsafe_tool_name_is_refused_before_sending() {
        let mut request = spec(ResponseFormat::Text);
        let mut bad = offer();
        bad.name = "polaris.workspace.write".into();
        request.tools = vec![bad];
        let error = OpenAiCompatible::local_generic().chat_body(&request, true).unwrap_err();
        assert_eq!(error.code, ProviderErrorCode::InvalidRequest);
    }

    #[test]
    fn a_completion_with_tool_calls_and_no_text_is_accepted_with_its_calls() {
        // الشكل كما أعاده Bonsai على خادمه المحلي في قياس 2026-10-05.
        let value = json!({ "choices": [ { "finish_reason": "tool_calls", "message": { "role": "assistant", "content": null, "tool_calls": [
            { "type": "function", "function": { "name": "workspace_write", "arguments": "{\"path\":\"notes.txt\",\"content\":\"hello\"}" }, "id": "SBPqfCYGNs4dxtxehPfQUj2bLSDUrAvn" } ] } } ] });
        let out = parse_completion(&value, None).unwrap();
        assert_eq!(out.text, "");
        assert_eq!(out.finish_reason, FinishReason::ToolCall);
        assert_eq!(out.tool_calls.len(), 1);
        assert_eq!(out.tool_calls[0].name, "workspace_write");
        assert_eq!(out.tool_calls[0].arguments, r#"{"path":"notes.txt","content":"hello"}"#);
        assert_eq!(out.tool_calls[0].id.as_deref(), Some("SBPqfCYGNs4dxtxehPfQUj2bLSDUrAvn"));
    }

    #[test]
    fn streamed_tool_call_fragments_are_joined_by_index_and_bounded() {
        let mut calls = ToolCallAssembler::default();
        calls.absorb(&json!({ "index": 1, "id": "b", "function": { "name": "second", "arguments": "{}" } })).unwrap();
        calls.absorb(&json!({ "index": 0, "id": "a", "function": { "name": "first", "arguments": "{\"pa" } })).unwrap();
        calls.absorb(&json!({ "index": 0, "function": { "arguments": "th\":\"x\"}" } })).unwrap();
        let joined = calls.finish();
        assert_eq!(joined.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["first", "second"]);
        assert_eq!(joined[0].arguments, r#"{"path":"x"}"#);
        let mut many = ToolCallAssembler::default();
        for i in 0..MAX_TOOL_CALLS as u64 {
            many.absorb(&json!({ "index": i, "function": { "name": "t" } })).unwrap();
        }
        assert!(many.absorb(&json!({ "index": 999, "function": { "name": "t" } })).is_err());
    }

    #[test]
    fn json_mode_is_refused_where_not_declared() {
        let error = OpenAiCompatible::local_generic().chat_body(&spec(ResponseFormat::Json), true).unwrap_err();
        assert_eq!(error.code, ProviderErrorCode::UnsupportedCapability);
    }

    #[test]
    fn a_completion_without_text_is_invalid() {
        let error = parse_completion(&serde_json::json!({ "choices": [ { "message": {} } ] }), None).unwrap_err();
        assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
    }

    #[test]
    fn reasoning_effort_is_sent_to_the_local_studio_and_the_router_only() {
        let mut request = spec(ResponseFormat::Text);
        request.reasoning_effort = Some(crate::domain::messages::ReasoningEffort::Low);
        let studio = OpenAiCompatible::with_flavor(Flavor::LocalStudio).chat_body(&request, true).unwrap();
        assert_eq!(studio["reasoning_effort"], "low");
        let hosted = OpenAiCompatible::with_flavor(Flavor::HostedOpenAi).chat_body(&request, true).unwrap();
        assert!(hosted.get("reasoning_effort").is_none(), "a hosted service received a field its non-reasoning models refuse");
        let plain = OpenAiCompatible::with_flavor(Flavor::LocalStudio).chat_body(&spec(ResponseFormat::Text), true).unwrap();
        assert!(plain.get("reasoning_effort").is_none(), "an unrequested effort was sent");
    }

    // مكافأة Manus (2026-10-19): صورة المستخدم جزء `image_url` بعنوان data، ورسالة غير المستخدم لا تحمل صورة.
    #[test]
    fn a_user_image_travels_as_an_image_url_part_and_other_roles_refuse_images() {
        let mut user = ChatMessage::text(Role::User, "what is in this image?");
        user.images.push(crate::domain::ImagePart { media_type: "image/png".into(), data_base64: "iVBORw0K".into() });
        let wire = message_json(&user, false).unwrap();
        assert_eq!(wire["content"][0], serde_json::json!({ "type": "text", "text": "what is in this image?" }));
        assert_eq!(wire["content"][1]["image_url"]["url"], "data:image/png;base64,iVBORw0K");
        let mut assistant = ChatMessage::text(Role::Assistant, "x");
        assistant.images.push(crate::domain::ImagePart { media_type: "image/png".into(), data_base64: "iVBORw0K".into() });
        assert!(message_json(&assistant, false).is_err(), "an assistant message carried an image");
    }

    // قِيس 2026-10-19 على llama-server (Bonsai 2 27B مع `--mmproj`): `data` بلا قدرات، و`models` بجانبها تقول `multimodal`، و`meta.n_ctx`
    // نافذة السياق المحمّلة. قبل الإصلاح بقيت الرؤية مجهولة فلا تصل الصورة إلى نموذج يراها.
    #[test]
    fn llama_server_multimodal_capability_and_loaded_context_are_read_from_the_measured_payload() {
        let value = json!({
            "models": [ { "name": "bonsai-2-27b", "model": "bonsai-2-27b", "type": "model", "capabilities": ["completion", "multimodal"] } ],
            "object": "list",
            "data": [
                { "id": "bonsai-2-27b", "aliases": ["bonsai-2-27b"], "object": "model", "owned_by": "llamacpp", "meta": { "n_ctx": 262144, "n_ctx_train": 262144 } },
                { "id": "text-only", "object": "model", "owned_by": "llamacpp", "meta": { "n_ctx": 8192 } }
            ]
        });
        let models = OpenAiCompatible::local_generic().parse_models(&value).unwrap();
        assert!(models[0].claim(ModelCapability::VisionInput).is_proven(), "a multimodal llama-server model was not seen as vision");
        assert_eq!(models[0].context_window.value, Some(262144));
        assert!(!models[1].claim(ModelCapability::VisionInput).is_proven(), "vision was guessed for a model with no capability list");
        assert_eq!(models[1].context_window.value, Some(8192));
    }
}
