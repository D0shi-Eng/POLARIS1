// الواجهة الأصلية للخادم المحلي ذي المنفذ 11434.
//
// الاكتشاف: `/api/tags` للقائمة، و`/api/ps` لما هو محمّل الآن، و`/api/show` لكل
// نموذج لقراءة القدرات وطول السياق كما يبلغ بها الخادم. فشل `show` لنموذج لا
// يسقطه، بل يترك قدراته مجهولة. الاستدعاء عبر `/api/chat` بأسطر NDJSON.
//
// الأدوات الأصيلة (الجلسة 1، خطة 2026-10-07، ADR-040) كما توثّقها docs.ollama.com/capabilities/tool-calling (قُرئت
// 2026-10-07): `tools` بصيغة الدوال، والاستدعاءات في `message.tool_calls` بوسائط **كائن** لا نصّ وبلا معرّف، والنتيجة
// تعود برسالة `role: tool` تحمل `tool_name`. مع البثّ تُجمع الأجزاء كلها: التفكير والمحتوى والاستدعاءات. الخادم لا يعطي
// معرّفًا للاستدعاء، فيعطيه المحوّل معرّفًا محليًّا بترتيبه، وبه تجد نتيجة الأداة اسم أداتها عند العودة.
// لا سحب نموذج ولا تحميل ولا حذف: القراءة والاستدعاء فقط.

use std::collections::BTreeSet;

use serde_json::{json, Map, Value};

use crate::adapters::common::{self, clean_model_id, clean_text, positive_u64, MAX_STREAM_BYTES, MAX_STREAM_LINE};
use crate::adapters::{CallContext, ProviderAdapter};
use crate::domain::messages::{is_protocol_tool_name, ProposedToolCall, MAX_OUTPUT_CHARS, MAX_TOOL_ARGUMENT_CHARS, MAX_TOOL_CALLS};
use crate::domain::{
    CapabilityClaim, ChatMessage, DiscoveredModel, Fact, FinishReason, HealthProbe, InvocationOutput, InvocationSpec, LoadedState,
    ModelCapability, ModelKind, Provenance, ResponseFormat, Role, Usage,
};
use crate::error::{ProviderError, ProviderErrorCode};
use crate::net::lines::LineReader;

/// أقصى عدد نماذج يُسأل عنها بـ`show` في تحديث واحد.
const MAX_SHOW_QUERIES: usize = 64;

/// درجات `num_ctx`. قِيس 2026-10-07 في التطبيق: كل نداء إلى نموذج 4B صغير قُرئ منه 2050 رمز إدخال بالضبط، والموجّه بأدواته
/// أكثر من 8000: الخادم قطعه إلى نافذته الافتراضية بصمت، فلم يرَ النموذج أدواته وردّ باستدعاء مكتوب نصًّا. صفحة Ollama
/// (docs.ollama.com/context-length، قُرئت 2026-10-07): الافتراضي 4k لأقل من 24 GiB من ذاكرة الرسوم، و«الوكلاء وأدوات البرمجة
/// تحتاج 64000 على الأقل». تغيير النافذة يعيد تحميل النموذج، فالقيمة درجات ثابتة لا تتغيّر مع كل دورة.
const NUM_CTX_STEPS: [u64; 5] = [16_384, 32_768, 65_536, 131_072, 262_144];
/// مخرجات تُحجز حين لا يُطلب سقف.
const DEFAULT_OUTPUT_RESERVE: u64 = 4_096;

pub struct OllamaNative;

impl Default for OllamaNative {
    fn default() -> Self {
        Self::new()
    }
}

impl OllamaNative {
    pub fn new() -> Self {
        Self
    }

    pub fn parse_tags(value: &Value) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let list = value
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "tags response has no models array"))?;
        let mut seen = BTreeSet::new();
        let mut models = Vec::new();
        for entry in list.iter().take(common::MAX_MODELS) {
            let Some(id) = clean_model_id(entry.get("name").or_else(|| entry.get("model"))) else { continue };
            if !seen.insert(id.clone()) {
                continue;
            }
            let mut model = DiscoveredModel::bare(id);
            let details = entry.get("details");
            model.family = Fact::reported_opt(clean_text(details.and_then(|d| d.get("family")), 64));
            model.parameter_count = Fact::reported_opt(clean_text(details.and_then(|d| d.get("parameter_size")), 32));
            model.quantization = Fact::reported_opt(clean_text(details.and_then(|d| d.get("quantization_level")), 32));
            models.push(model);
        }
        Ok(models)
    }

    pub fn loaded_names(value: &Value) -> Option<BTreeSet<String>> {
        let list = value.get("models")?.as_array()?;
        Some(
            list.iter()
                .filter_map(|e| clean_model_id(e.get("name").or_else(|| e.get("model"))))
                .collect(),
        )
    }

    /// يطبّق ردّ `show` على نموذج: القدرات وطول السياق والمعمارية.
    pub fn apply_show(model: &mut DiscoveredModel, value: &Value) {
        if let Some(caps) = value.get("capabilities").and_then(Value::as_array) {
            let has = |name: &str| caps.iter().any(|c| c.as_str() == Some(name));
            let completion = has("completion");
            let embedding = has("embedding");
            model.kind = if completion {
                ModelKind::Chat
            } else if embedding {
                ModelKind::Embedding
            } else {
                ModelKind::Unknown
            };
            // القائمة كاملة كما أبلغ بها الخادم، فغياب قدرة منها نفيٌ مُبلَغ لا جهل.
            model.set_claim(ModelCapability::TextInput, CapabilityClaim::reported(completion || embedding));
            model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(completion));
            model.set_claim(ModelCapability::VisionInput, CapabilityClaim::reported(has("vision")));
            model.set_claim(ModelCapability::Tools, CapabilityClaim::reported(has("tools")));
            model.set_claim(ModelCapability::Reasoning, CapabilityClaim::reported(has("thinking")));
            model.set_claim(ModelCapability::Embeddings, CapabilityClaim::reported(embedding));
            if completion {
                model.set_claim(ModelCapability::Streaming, CapabilityClaim::documented(true));
                model.set_claim(ModelCapability::Json, CapabilityClaim::documented(true));
                model.set_claim(ModelCapability::JsonSchema, CapabilityClaim::documented(true));
            }
        }
        if let Some(info) = value.get("model_info").and_then(Value::as_object) {
            let arch = clean_text(info.get("general.architecture"), 64);
            if let Some(arch) = &arch {
                let key = format!("{arch}.context_length");
                model.context_window = Fact::reported_opt(positive_u64(info.get(&key)));
            }
            model.architecture = Fact::reported_opt(arch);
        }
    }

    pub fn chat_body(spec: &InvocationSpec) -> Result<Value, ProviderError> {
        let mut messages = Vec::new();
        if let Some(system) = &spec.system {
            messages.push(json!({ "role": "system", "content": system }));
        }
        for (index, message) in spec.messages.iter().enumerate() {
            messages.push(Self::wire_message(message, &spec.messages[..index])?);
        }
        let mut options = Map::new();
        if let Some(t) = spec.temperature {
            options.insert("temperature".into(), json!(t));
        }
        if let Some(max) = spec.max_output_tokens {
            options.insert("num_predict".into(), json!(max));
        }
        options.insert("num_ctx".into(), json!(Self::num_ctx(spec)));
        let mut body = Map::new();
        body.insert("model".into(), json!(spec.provider_model_id));
        body.insert("messages".into(), Value::Array(messages));
        body.insert("stream".into(), json!(true));
        if !options.is_empty() {
            body.insert("options".into(), Value::Object(options));
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
        }
        // قيد الصيغة على المحتوى يمنع الاستدعاء نفسه مع الأدوات، كما في الخادم المتوافق المحلي: العقد يبقى في المُوجِّه.
        if spec.response_format == ResponseFormat::Json && spec.tools.is_empty() {
            body.insert("format".into(), json!("json"));
        }
        // Phase-08: حقل Ollama القياسي لإيقاف الاستدلال المخفي حين يُطلب «بلا استدلال».
        if spec.reasoning_effort == Some(crate::domain::messages::ReasoningEffort::None) {
            body.insert("think".into(), json!(false));
        }
        Ok(Value::Object(body))
    }

    /// نافذة الطلب: تقدير متحفّظ لطول الموجّه (حرفان لكل رمز، والعربية أكثف من الإنجليزية) مع المخرجات وهامش، مرفوعًا إلى
    /// أول درجة تتّسع له، ولا يتجاوز نافذة النموذج المبلَّغ عنها. تقدير لا قياس؛ القياس هو `prompt_eval_count` في الردّ.
    pub fn num_ctx(spec: &InvocationSpec) -> u64 {
        let mut chars = spec.system.as_ref().map_or(0, |s| s.chars().count());
        for message in &spec.messages {
            chars += message.text.chars().count();
            chars += message.tool_calls.iter().map(|c| c.name.len() + c.arguments.chars().count()).sum::<usize>();
        }
        chars += spec.tools.iter().map(|t| t.name.len() + t.description.chars().count() + t.parameters.to_string().len()).sum::<usize>();
        let needed = (chars as u64).div_ceil(2) + spec.max_output_tokens.map_or(DEFAULT_OUTPUT_RESERVE, u64::from) + 1_024;
        let step = NUM_CTX_STEPS.iter().copied().find(|s| *s >= needed).unwrap_or(NUM_CTX_STEPS[NUM_CTX_STEPS.len() - 1]);
        match spec.context_window {
            Some(window) if window > 0 => step.min(window),
            _ => step,
        }
    }

    /// رسالة واحدة بصيغة Ollama. المساعد يحمل استدعاءاته بوسائط كائن، ونتيجة الأداة تحمل اسم أداتها من الاستدعاء
    /// الذي تجيب عنه في الرسائل السابقة.
    fn wire_message(message: &ChatMessage, earlier: &[ChatMessage]) -> Result<Value, ProviderError> {
        let role = common::role_name(message.role);
        if message.role == Role::Tool {
            let id = message.tool_call_id.as_deref().filter(|id| !id.is_empty());
            let name = id
                .and_then(|id| earlier.iter().rev().flat_map(|m| m.tool_calls.iter()).find(|c| c.id.as_deref() == Some(id)))
                .map(|c| c.name.clone())
                .ok_or_else(|| ProviderError::new(ProviderErrorCode::InvalidRequest, "a tool result answers no earlier tool call"))?;
            return Ok(json!({ "role": role, "tool_name": name, "content": message.text }));
        }
        let mut wire = json!({ "role": role, "content": message.text });
        if !message.images.is_empty() {
            if message.role != Role::User {
                return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "only a user message carries images"));
            }
            wire["images"] = Value::Array(message.images.iter().map(|i| json!(i.data_base64)).collect());
        }
        if message.tool_calls.is_empty() {
            return Ok(wire);
        }
        if message.role != Role::Assistant {
            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "only an assistant message carries tool calls"));
        }
        let mut calls = Vec::with_capacity(message.tool_calls.len());
        for call in &message.tool_calls {
            if !is_protocol_tool_name(&call.name) {
                return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "an earlier tool call is not a protocol-safe function name"));
            }
            // الوسائط كما بثّها النموذج نصًّا؛ Ollama يريدها كائنًا. نصّ لا يُحلَّل كائنًا يُرسل كما هو بدل أن يُصلَح صامتًا.
            let arguments = serde_json::from_str::<Value>(&call.arguments).ok().filter(Value::is_object).unwrap_or_else(|| json!(call.arguments));
            calls.push(json!({ "type": "function", "function": { "name": call.name, "arguments": arguments } }));
        }
        wire["tool_calls"] = Value::Array(calls);
        if let Some(thinking) = message.reasoning.as_deref().filter(|t| !t.is_empty()) {
            wire["thinking"] = json!(thinking);
        }
        Ok(wire)
    }

    /// استدعاءات جزء واحد من البثّ. الوسائط كائن في الصيغة الموثّقة، وتُحفظ نصًّا كما تفعل بقية المحوّلات.
    fn stream_calls(chunk: &Value, calls: &mut Vec<ProposedToolCall>) -> Result<(), ProviderError> {
        let Some(list) = chunk.pointer("/message/tool_calls").and_then(Value::as_array) else { return Ok(()) };
        for entry in list {
            if calls.len() >= MAX_TOOL_CALLS {
                return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "too many tool calls in one reply"));
            }
            let function = entry.get("function").unwrap_or(entry);
            let name = function.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            let arguments = match function.get("arguments") {
                Some(Value::String(text)) => text.clone(),
                Some(value) => value.to_string(),
                None => "{}".to_string(),
            };
            if arguments.chars().count() > MAX_TOOL_ARGUMENT_CHARS {
                return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "tool call arguments exceed the limit"));
            }
            calls.push(ProposedToolCall { id: Some(format!("ollama-call-{}", calls.len())), name, arguments });
        }
        Ok(())
    }
}

fn done_reason(raw: Option<&str>) -> FinishReason {
    match raw {
        Some("stop") => FinishReason::Stop,
        Some("length") => FinishReason::Length,
        Some(_) => FinishReason::Unknown,
        None => FinishReason::Stop,
    }
}

impl ProviderAdapter for OllamaNative {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let (tags, _) = common::get_json(ctx, ctx.endpoint.path("/api/tags"), Vec::new())?;
        let mut models = Self::parse_tags(&tags)?;

        // ما هو محمّل الآن. الفشل هنا يترك الحالة مجهولة ولا يُسقط القائمة.
        let loaded = common::get_json(ctx, ctx.endpoint.path("/api/ps"), Vec::new())
            .ok()
            .and_then(|(v, _)| Self::loaded_names(&v));
        for model in &mut models {
            if let Some(names) = &loaded {
                model.loaded_state = if names.contains(&model.provider_model_id) { LoadedState::Loaded } else { LoadedState::NotLoaded };
                model.loaded_state_provenance = Provenance::ProviderReported;
            }
        }

        for model in models.iter_mut().take(MAX_SHOW_QUERIES) {
            if ctx.cancel.is_cancelled() {
                return Err(ProviderError::new(ProviderErrorCode::Cancelled, "cancelled during discovery"));
            }
            let body = json!({ "model": model.provider_model_id });
            if let Ok((value, _)) = common::post_json(ctx, ctx.endpoint.path("/api/show"), Vec::new(), body) {
                Self::apply_show(model, &value);
            }
        }
        Ok(models)
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        common::probe(ctx, ctx.endpoint.path("/api/version"), Vec::new())
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        let body = Self::chat_body(spec)?;
        let mut response = common::send(ctx, "POST", ctx.endpoint.path("/api/chat"), Vec::new(), Some(body))?;
        let first_byte_ms = Some(response.first_byte_ms);
        let mut reader = LineReader::new(&mut response.body, MAX_STREAM_LINE, MAX_STREAM_BYTES);
        let mut text = String::new();
        let mut thinking = String::new();
        let mut tool_calls = Vec::new();
        let mut finish = None;
        let mut usage = Usage::default();
        while let Some(line) = reader.next_line().map_err(common::transport_error)? {
            if line.trim().is_empty() {
                continue;
            }
            let chunk: Value = serde_json::from_str(&line)
                .map_err(|e| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("invalid stream line: {e}")))?;
            if let Some(error) = chunk.get("error") {
                return Err(ProviderError::new(ProviderErrorCode::ProviderInternalError, error.to_string()));
            }
            if let Some(delta) = chunk.pointer("/message/content").and_then(Value::as_str) {
                if text.len() + delta.len() > MAX_OUTPUT_CHARS {
                    return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "output exceeds the limit"));
                }
                text.push_str(delta);
            }
            if let Some(delta) = chunk.pointer("/message/thinking").and_then(Value::as_str) {
                if thinking.len() + delta.len() <= MAX_OUTPUT_CHARS {
                    thinking.push_str(delta);
                }
            }
            Self::stream_calls(&chunk, &mut tool_calls)?;
            if chunk.get("done").and_then(Value::as_bool) == Some(true) {
                finish = Some(done_reason(chunk.get("done_reason").and_then(Value::as_str)));
                usage = Usage {
                    input_tokens: chunk.get("prompt_eval_count").and_then(Value::as_u64),
                    output_tokens: chunk.get("eval_count").and_then(Value::as_u64),
                    cached_input_tokens: None,
                };
                break;
            }
        }
        let mut finish_reason = finish
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "stream ended without done"))?;
        // Ollama ينهي ردّ الاستدعاء بـ`stop`؛ الاستدعاء نفسه هو ما يحدّد السبب.
        if !tool_calls.is_empty() && finish_reason == FinishReason::Stop {
            finish_reason = FinishReason::ToolCall;
        }
        let reasoning = (!thinking.is_empty()).then_some(thinking);
        Ok(InvocationOutput { text, finish_reason, usage, provider_request_id: None, first_byte_ms, streamed: true, tool_calls, reasoning })
    }

    /// الصور في حقل `images` من رسالة `/api/chat` (موثّق في Ollama). النموذج نفسه يجب أن يعلن الرؤية.
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

    #[test]
    fn tags_are_parsed_with_reported_details_only() {
        let value = json!({ "models": [
            { "name": "fixture-a:latest", "details": { "family": "fam", "parameter_size": "7.6B", "quantization_level": "Q4_K_M" } },
            { "name": "fixture-a:latest" },
            { "name": "fixture-b" }
        ]});
        let models = OllamaNative::parse_tags(&value).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].parameter_count.value.as_deref(), Some("7.6B"));
        assert_eq!(models[0].quantization.value.as_deref(), Some("Q4_K_M"));
        assert!(!models[1].family.is_known());
    }

    #[test]
    fn show_reports_capabilities_and_context_length() {
        let mut model = DiscoveredModel::bare("fixture-a".into());
        let show = json!({
            "capabilities": ["completion", "vision"],
            "model_info": { "general.architecture": "archx", "archx.context_length": 131072 }
        });
        OllamaNative::apply_show(&mut model, &show);
        assert_eq!(model.kind, ModelKind::Chat);
        assert!(model.claim(ModelCapability::VisionInput).is_proven());
        assert_eq!(model.claim(ModelCapability::Tools).support, Support::Unsupported);
        assert_eq!(model.context_window.value, Some(131072));
    }

    #[test]
    fn without_show_the_capabilities_stay_unknown() {
        let mut model = DiscoveredModel::bare("fixture-a".into());
        OllamaNative::apply_show(&mut model, &json!({}));
        assert_eq!(model.claim(ModelCapability::Tools).support, Support::Unknown);
        assert!(!model.context_window.is_known());
    }

    #[test]
    fn chat_body_maps_limits_to_options() {
        let spec = InvocationSpec {
            tools: Vec::new(),
            provider_model_id: "fixture-a".into(),
            system: None,
            messages: vec![ChatMessage::text(Role::User, "hi")],
            temperature: Some(0.1),
            max_output_tokens: Some(32),
            response_format: ResponseFormat::Json,
            reasoning_effort: None,
            user_effort: None,
            wire: crate::domain::WireProfile::LOCAL,
            context_window: None,
            model_reasons: false,
        };
        let body = OllamaNative::chat_body(&spec).unwrap();
        assert_eq!(body["options"]["num_predict"], 32);
        assert_eq!(body["format"], "json");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn the_context_window_is_a_fixed_step_that_fits_the_prompt_and_never_exceeds_the_model() {
        let base = || InvocationSpec {
            provider_model_id: "m".into(),
            system: None,
            messages: vec![ChatMessage::text(Role::User, "hi")],
            temperature: None,
            max_output_tokens: None,
            response_format: ResponseFormat::Text,
            reasoning_effort: None,
            user_effort: None,
            tools: Vec::new(),
            context_window: None,
            wire: crate::domain::WireProfile::LOCAL,
            model_reasons: false,
        };
        // موجّه قصير: الدرجة الأولى، لا أقل.
        assert_eq!(OllamaNative::num_ctx(&base()), 16_384);
        // موجّه وكيل (~40 ألف حرف): درجة تتّسع له.
        let mut agent = base();
        agent.system = Some("x".repeat(40_000));
        assert_eq!(OllamaNative::num_ctx(&agent), 32_768);
        // نموذج نافذته أصغر من الدرجة: نافذته هو.
        agent.context_window = Some(8_192);
        assert_eq!(OllamaNative::num_ctx(&agent), 8_192);
        // الدرجة لا تتغيّر لزيادة صغيرة في المحادثة (تغيير النافذة يعيد تحميل النموذج).
        let mut longer = base();
        longer.system = Some("x".repeat(41_000));
        assert_eq!(OllamaNative::num_ctx(&longer), 32_768);
    }

    #[test]
    fn a_user_image_travels_in_the_images_field() {
        let mut user = ChatMessage::text(Role::User, "describe");
        user.images.push(crate::domain::ImagePart { media_type: "image/png".into(), data_base64: "iVBORw0K".into() });
        let wire = OllamaNative::wire_message(&user, &[]).unwrap();
        assert_eq!(wire["images"], json!(["iVBORw0K"]));
        assert_eq!(wire["content"], "describe");
    }
}
