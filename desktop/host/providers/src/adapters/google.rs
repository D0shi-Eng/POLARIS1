// Google Generative Language API عبر مفتاح API الرسمي.
//
// المفتاح يُرسل في ترويسة `x-goog-api-key`، لا في عنوان الطلب: العنوان قد يُسجَّل.
// الاكتشاف من `/v1beta/models`، والقدرات من `supportedGenerationMethods`.

use serde_json::{json, Map, Value};

use crate::adapters::common::{self, clean_text, positive_u64, MAX_MODELS};
use crate::adapters::{CallContext, ProviderAdapter};
use crate::domain::messages::{safe_request_id, MAX_OUTPUT_CHARS};
use crate::domain::{
    CapabilityClaim, DiscoveredModel, Fact, FinishReason, HealthProbe, HealthReason, HealthState, InvocationOutput,
    InvocationSpec, ModelCapability, ModelKind, ResponseFormat, Role, Usage,
};
use crate::error::{ProviderError, ProviderErrorCode};

const MAX_PAGES: usize = 5;

/// درجة التفكير في Gemini: low|medium|high. `None` لا مقابل له فيُطلب أدناه، و`Max` أعلاه.
fn thinking_level(effort: crate::domain::messages::ReasoningEffort) -> &'static str {
    use crate::domain::messages::ReasoningEffort as E;
    match effort {
        E::None | E::Low => "low",
        E::Medium => "medium",
        E::High | E::Max => "high",
    }
}

/// حقل جهد التفكير في Gemini (`generationConfig.thinkingConfig`).
const THINKING_FIELD: &str = "thinkingConfig";

pub struct GoogleGenerativeLanguage;

impl Default for GoogleGenerativeLanguage {
    fn default() -> Self {
        Self::new()
    }
}

/// معرّف نموذج صالح لمسار URL.
fn path_safe(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

impl GoogleGenerativeLanguage {
    pub fn new() -> Self {
        Self
    }

    fn headers(ctx: &CallContext<'_>) -> Result<Vec<(&'static str, String)>, ProviderError> {
        let secret = ctx
            .credential
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::AuthRequired, "no credential configured"))?;
        Ok(vec![("x-goog-api-key", secret.expose().to_string())])
    }

    pub fn parse_page(value: &Value, into: &mut Vec<DiscoveredModel>) -> Result<Option<String>, ProviderError> {
        let list = value
            .get("models")
            .and_then(Value::as_array)
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "models response has no models array"))?;
        for entry in list {
            if into.len() >= MAX_MODELS {
                break;
            }
            let Some(name) = entry.get("name").and_then(Value::as_str) else { continue };
            let id = name.strip_prefix("models/").unwrap_or(name);
            if !path_safe(id) || into.iter().any(|m| m.provider_model_id == id) {
                continue;
            }
            let mut model = DiscoveredModel::bare(id.to_string());
            model.display_name = Fact::reported_opt(clean_text(entry.get("displayName"), 128));
            model.context_window = Fact::reported_opt(positive_u64(entry.get("inputTokenLimit")));
            model.max_output_tokens = Fact::reported_opt(positive_u64(entry.get("outputTokenLimit")));
            model.vendor = Fact::reported("google".to_string());
            if let Some(methods) = entry.get("supportedGenerationMethods").and_then(Value::as_array) {
                let has = |m: &str| methods.iter().any(|x| x.as_str() == Some(m));
                let generate = has("generateContent");
                let embed = has("embedContent");
                model.kind = if generate { ModelKind::Chat } else if embed { ModelKind::Embedding } else { ModelKind::Unknown };
                model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(generate));
                model.set_claim(ModelCapability::Embeddings, CapabilityClaim::reported(embed));
                if generate {
                    model.set_claim(ModelCapability::TextInput, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::Json, CapabilityClaim::documented(true));
                }
                model.set_claim(ModelCapability::Streaming, CapabilityClaim::reported(has("streamGenerateContent")));
            }
            if let Some(thinking) = entry.get("thinking").and_then(Value::as_bool) {
                model.set_claim(ModelCapability::Reasoning, CapabilityClaim::reported(thinking));
            }
            into.push(model);
        }
        let token = value.get("nextPageToken").and_then(Value::as_str).filter(|t| {
            !t.is_empty() && t.len() <= 256 && t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '='))
        });
        Ok(token.map(str::to_string))
    }

    pub fn body(spec: &InvocationSpec) -> Value {
        let contents: Vec<Value> = spec
            .messages
            .iter()
            .filter(|m| matches!(m.role, Role::User | Role::Assistant))
            .map(|m| {
                let role = if m.role == Role::Assistant { "model" } else { "user" };
                // الصور أجزاء `inline_data` قبل النصّ (وثائق Gemini للإدخال متعدّد الوسائط).
                let mut parts: Vec<Value> = m.images.iter().map(|i| json!({ "inline_data": { "mime_type": i.media_type, "data": i.data_base64 } })).collect();
                parts.push(json!({ "text": m.text }));
                json!({ "role": role, "parts": parts })
            })
            .collect();
        let mut config = Map::new();
        // لا درجة حرارة (2026-10-06): وثائق Google لنماذجها الأحدث توصي بإبقائها على افتراضها 1.0، وتقول إن تغييرها قد يسبّب حلقات أو تدهورًا.
        if let Some(max) = spec.max_output_tokens {
            config.insert("maxOutputTokens".into(), json!(max));
        }
        if spec.response_format == ResponseFormat::Json {
            config.insert("responseMimeType".into(), json!("application/json"));
        }
        // جهد الاستدلال الذي اختاره المستخدم (2026-11-13): `thinkingConfig.thinkingLevel` لنماذج Gemini التي تفكّر. لا يُرسل
        // بلا اختيار. «أقصى» يصبح `high` لأنه أعلى ما يعرفه الحقل؛ نموذج يرفضه يُعاد إليه النداء مرة بدونه في `invoke`.
        if let Some(effort) = spec.user_effort {
            config.insert(THINKING_FIELD.into(), json!({ "thinkingLevel": thinking_level(effort) }));
        }
        let mut body = Map::new();
        body.insert("contents".into(), Value::Array(contents));
        if let Some(system) = &spec.system {
            body.insert("systemInstruction".into(), json!({ "parts": [ { "text": system } ] }));
        }
        if !config.is_empty() {
            body.insert("generationConfig".into(), Value::Object(config));
        }
        Value::Object(body)
    }

    pub fn parse_response(value: &Value, first_byte_ms: Option<u64>) -> Result<InvocationOutput, ProviderError> {
        let candidate = value
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "response has no candidates"))?;
        let text: String = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
            .map(|parts| parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        if text.len() > MAX_OUTPUT_CHARS {
            return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "output exceeds the limit"));
        }
        let finish = match candidate.get("finishReason").and_then(Value::as_str) {
            Some("STOP") => FinishReason::Stop,
            Some("MAX_TOKENS") => FinishReason::Length,
            Some("SAFETY") | Some("RECITATION") | Some("BLOCKLIST") | Some("PROHIBITED_CONTENT") => FinishReason::ContentFilter,
            _ => FinishReason::Unknown,
        };
        Ok(InvocationOutput {
            tool_calls: Vec::new(),
            reasoning: None,
            text,
            finish_reason: finish,
            usage: Usage {
                input_tokens: value.pointer("/usageMetadata/promptTokenCount").and_then(Value::as_u64),
                output_tokens: value.pointer("/usageMetadata/candidatesTokenCount").and_then(Value::as_u64),
                cached_input_tokens: value.pointer("/usageMetadata/cachedContentTokenCount").and_then(Value::as_u64),
            },
            provider_request_id: value.get("responseId").and_then(Value::as_str).and_then(safe_request_id),
            first_byte_ms,
            streamed: false,
        })
    }
}

impl ProviderAdapter for GoogleGenerativeLanguage {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let headers = Self::headers(ctx)?;
        let mut models = Vec::new();
        let mut token: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let path = match &token {
                Some(t) => ctx.endpoint.path(&format!("/v1beta/models?pageSize=1000&pageToken={t}")),
                None => ctx.endpoint.path("/v1beta/models?pageSize=1000"),
            };
            let (value, _) = common::get_json(ctx, path, headers.clone())?;
            token = Self::parse_page(&value, &mut models)?;
            if token.is_none() {
                break;
            }
        }
        Ok(models)
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        match Self::headers(ctx) {
            Ok(headers) => common::probe(ctx, ctx.endpoint.path("/v1beta/models?pageSize=1"), headers),
            Err(_) => HealthProbe::not_measured(HealthState::AuthRequired, HealthReason::CredentialMissing),
        }
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        if !spec.tools.is_empty() || spec.messages.iter().any(|m| m.carries_tool_protocol()) {
            // هذا المحوّل لا ينقل الأدوات الأصيلة بعد: الطلب يُرفض قبل أيّ بايت بدل إسقاط العرض صامتًا.
            return Err(ProviderError::new(ProviderErrorCode::UnsupportedCapability, "native tool calls are not carried by this adapter"));
        }
        let headers = Self::headers(ctx)?;
        if !path_safe(&spec.provider_model_id) {
            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "model id is not path-safe"));
        }
        let path = ctx.endpoint.path(&format!("/v1beta/models/{}:generateContent", spec.provider_model_id));
        let body = Self::body(spec);
        let has_effort = body.pointer(&format!("/generationConfig/{THINKING_FIELD}")).is_some();
        let (value, first) = match common::post_json(ctx, path.clone(), headers.clone(), body.clone()) {
            // رفض يسمّي حقل التفكير: يُحذف ويُعاد النداء مرة. أيّ رفض آخر يبقى كما هو.
            Err(error) if has_effort && common::refuses_field(&error, &["thinking", THINKING_FIELD]) => {
                let mut plain = body;
                if let Some(config) = plain.get_mut("generationConfig").and_then(Value::as_object_mut) {
                    config.remove(THINKING_FIELD);
                    if config.is_empty() {
                        plain.as_object_mut().map(|m| m.remove("generationConfig"));
                    }
                }
                common::post_json(ctx, path, headers, plain)?
            }
            other => other?,
        };
        Self::parse_response(&value, Some(first))
    }

    /// الصور أجزاء `inline_data` في رسالة المستخدم.
    fn supports_image_input(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ChatMessage, Support};

    #[test]
    fn models_are_parsed_from_generation_methods() {
        let mut models = Vec::new();
        let token = GoogleGenerativeLanguage::parse_page(
            &json!({ "models": [
                { "name": "models/fixture-chat", "displayName": "Fixture", "inputTokenLimit": 1000000, "outputTokenLimit": 8192, "supportedGenerationMethods": ["generateContent", "countTokens"] },
                { "name": "models/fixture-embed", "supportedGenerationMethods": ["embedContent"] },
                { "name": "models/bad id" }
            ], "nextPageToken": "abc" }),
            &mut models,
        )
        .unwrap();
        assert_eq!(token.as_deref(), Some("abc"));
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].kind, ModelKind::Chat);
        assert_eq!(models[0].context_window.value, Some(1_000_000));
        assert_eq!(models[1].kind, ModelKind::Embedding);
        assert_eq!(models[0].claim(ModelCapability::VisionInput).support, Support::Unknown);
    }

    #[test]
    fn the_body_maps_roles_and_config() {
        let spec = InvocationSpec {
            tools: Vec::new(),
            provider_model_id: "fixture-chat".into(),
            system: Some("s".into()),
            messages: vec![
                ChatMessage::text(Role::User, "q"),
                ChatMessage::text(Role::Assistant, "a"),
            ],
            temperature: None,
            max_output_tokens: Some(10),
            response_format: ResponseFormat::Json,
            reasoning_effort: None,
            user_effort: None,
            wire: crate::domain::WireProfile::HOSTED,
            context_window: None,
            model_reasons: false,
        };
        let body = GoogleGenerativeLanguage::body(&spec);
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 10);
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "s");
    }

    #[test]
    fn unsafe_model_ids_never_reach_the_path() {
        assert!(!path_safe("../x"));
        assert!(!path_safe("a/b"));
        assert!(path_safe("fixture-chat-1.5"));
    }

    #[test]
    fn a_user_image_travels_as_inline_data() {
        let mut user = ChatMessage::text(Role::User, "describe");
        user.images.push(crate::domain::ImagePart { media_type: "image/png".into(), data_base64: "iVBORw0K".into() });
        let spec = InvocationSpec {
            provider_model_id: "m".into(),
            system: None,
            messages: vec![user],
            temperature: None,
            max_output_tokens: None,
            response_format: ResponseFormat::Text,
            reasoning_effort: None,
            user_effort: None,
            wire: crate::domain::WireProfile::HOSTED,
            context_window: None,
            model_reasons: false,
            tools: Vec::new(),
        };
        let body = GoogleGenerativeLanguage::body(&spec);
        assert_eq!(body["contents"][0]["parts"][0]["inline_data"]["mime_type"], "image/png");
        assert_eq!(body["contents"][0]["parts"][1]["text"], "describe");
    }
}
