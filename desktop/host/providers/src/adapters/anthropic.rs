// Anthropic Messages API عبر مفتاح API الرسمي.
//
// المصادقة بترويسة `x-api-key` مع `anthropic-version`. الاكتشاف من `/v1/models`
// بصفحات محدودة. الاستدعاء غير متدفق في Phase-02، ويُلغى بإغلاق المقبس.
//
// منذ 2026-10-06: الأدوات الأصيلة (`tools` و`tool_use` و`tool_result`) بصيغة الوثائق الرسمية
// (platform.claude.com/docs/en/api/messages)، ولا درجة حرارة: تقول الوثائق إن النماذج الصادرة بعد Claude Opus 4.6 لا تدعم
// ضبطها وتُرفض كل قيمة غير 1.0.

use serde_json::{json, Map, Value};

use crate::adapters::common::{self, clean_model_id, clean_text, positive_u64, MAX_MODELS};
use crate::adapters::{CallContext, ProviderAdapter};
use crate::domain::messages::{is_protocol_tool_name, safe_request_id, ProposedToolCall, MAX_OUTPUT_CHARS, MAX_TOOL_CALLS};
use crate::domain::{
    DiscoveredModel, Fact, FinishReason, HealthProbe, HealthReason, HealthState, InvocationOutput, InvocationSpec,
    ResponseFormat, Role, Usage,
};
use crate::error::{ProviderError, ProviderErrorCode};

const API_VERSION: &str = "2023-06-01";
/// حدّ الإخراج الذي يطلبه الاستدعاء حين لا يحدّده المستخدم. البروتوكول يوجبه.
pub const DEFAULT_MAX_TOKENS: u32 = 1024;
const MAX_PAGES: usize = 5;

/// حقل جهد الاستدلال في Messages API (`output_config: {effort}`).
const EFFORT_FIELD: &str = "output_config";

pub struct AnthropicMessages;

impl Default for AnthropicMessages {
    fn default() -> Self {
        Self::new()
    }
}

impl AnthropicMessages {
    pub fn new() -> Self {
        Self
    }

    fn headers(ctx: &CallContext<'_>) -> Result<Vec<(&'static str, String)>, ProviderError> {
        let secret = ctx
            .credential
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::AuthRequired, "no credential configured"))?;
        Ok(vec![("x-api-key", secret.expose().to_string()), ("anthropic-version", API_VERSION.to_string())])
    }

    pub fn parse_page(value: &Value, into: &mut Vec<DiscoveredModel>) -> Result<Option<String>, ProviderError> {
        let data = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "models response has no data array"))?;
        for entry in data {
            if into.len() >= MAX_MODELS {
                break;
            }
            let Some(id) = clean_model_id(entry.get("id")) else { continue };
            if into.iter().any(|m| m.provider_model_id == id) {
                continue;
            }
            let mut model = DiscoveredModel::bare(id);
            model.display_name = Fact::reported_opt(clean_text(entry.get("display_name"), 128));
            model.context_window = Fact::reported_opt(positive_u64(entry.get("max_input_tokens")));
            model.max_output_tokens = Fact::reported_opt(positive_u64(entry.get("max_tokens")));
            into.push(model);
        }
        let more = value.get("has_more").and_then(Value::as_bool).unwrap_or(false);
        // المؤشر يدخل عنوان الطلب، فلا يُقبل إلا بحروف آمنة.
        let cursor = clean_model_id(value.get("last_id"))
            .filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')));
        Ok(if more { cursor } else { None })
    }

    pub fn body(spec: &InvocationSpec) -> Result<Value, ProviderError> {
        if spec.response_format == ResponseFormat::Json {
            return Err(ProviderError::new(ProviderErrorCode::UnsupportedCapability, "JSON mode is not declared for this provider"));
        }
        // البروتوكول يتناوب بين المستخدم والمساعد: نتائج الأدوات كتل `tool_result` في رسالة مستخدم، وما تتابع من دور واحد
        // يُدمج في رسالة واحدة بكتله.
        let mut messages: Vec<(Role, Vec<Value>)> = Vec::new();
        for m in &spec.messages {
            let (role, blocks) = match m.role {
                Role::System => continue,
                Role::User => {
                    let mut blocks: Vec<Value> = m
                        .images
                        .iter()
                        .map(|i| json!({ "type": "image", "source": { "type": "base64", "media_type": i.media_type, "data": i.data_base64 } }))
                        .collect();
                    blocks.push(json!({ "type": "text", "text": m.text }));
                    (Role::User, blocks)
                }
                Role::Tool => {
                    let Some(id) = m.tool_call_id.as_deref().filter(|id| !id.is_empty()) else {
                        return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "a tool result message carries no call id"));
                    };
                    (Role::User, vec![json!({ "type": "tool_result", "tool_use_id": id, "content": m.text })])
                }
                Role::Assistant => {
                    let mut blocks = Vec::new();
                    if !m.text.trim().is_empty() {
                        blocks.push(json!({ "type": "text", "text": m.text }));
                    }
                    for call in &m.tool_calls {
                        let Some(id) = call.id.as_deref().filter(|id| !id.is_empty()) else {
                            return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "an earlier tool call carries no id"));
                        };
                        let input: Value = serde_json::from_str(&call.arguments).ok().filter(Value::is_object).unwrap_or_else(|| json!({}));
                        blocks.push(json!({ "type": "tool_use", "id": id, "name": call.name, "input": input }));
                    }
                    if blocks.is_empty() {
                        continue;
                    }
                    (Role::Assistant, blocks)
                }
            };
            match messages.last_mut() {
                Some((last, existing)) if *last == role => existing.extend(blocks),
                _ => messages.push((role, blocks)),
            }
        }
        let messages: Vec<Value> = messages.into_iter().map(|(role, content)| json!({ "role": common::role_name(role), "content": content })).collect();
        let mut body = Map::new();
        body.insert("model".into(), json!(spec.provider_model_id));
        body.insert("max_tokens".into(), json!(spec.max_output_tokens.unwrap_or(DEFAULT_MAX_TOKENS)));
        body.insert("messages".into(), Value::Array(messages));
        if let Some(system) = &spec.system {
            body.insert("system".into(), json!(system));
        }
        if !spec.tools.is_empty() {
            let mut tools = Vec::with_capacity(spec.tools.len());
            for tool in &spec.tools {
                if !is_protocol_tool_name(&tool.name) {
                    return Err(ProviderError::new(ProviderErrorCode::InvalidRequest, "a tool name is not a protocol-safe function name"));
                }
                tools.push(json!({ "name": tool.name, "description": tool.description, "input_schema": tool.parameters }));
            }
            body.insert("tools".into(), Value::Array(tools));
            body.insert("tool_choice".into(), json!({ "type": "auto" }));
        }
        // جهد الاستدلال الذي اختاره المستخدم (2026-11-13): `output_config.effort` في Messages API. لا يُرسل بلا اختيار، فيبقى
        // افتراض كل نموذج. نموذج قديم يرفضه (Sonnet 4.5 وHaiku 4.5) يُعاد إليه النداء مرة بدونه في `invoke`.
        if let Some(effort) = spec.user_effort {
            body.insert(EFFORT_FIELD.into(), json!({ "effort": effort.cli_level() }));
        }
        Ok(Value::Object(body))
    }

    pub fn parse_message(value: &Value, first_byte_ms: Option<u64>) -> Result<InvocationOutput, ProviderError> {
        let blocks = value
            .get("content")
            .and_then(Value::as_array)
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "message has no content"))?;
        let text: String = blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect();
        if text.len() > MAX_OUTPUT_CHARS {
            return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "output exceeds the limit"));
        }
        let mut tool_calls = Vec::new();
        for block in blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use")) {
            if tool_calls.len() >= MAX_TOOL_CALLS {
                return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "too many tool calls in one reply"));
            }
            let name = block.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            if name.is_empty() {
                continue;
            }
            tool_calls.push(ProposedToolCall {
                id: block.get("id").and_then(Value::as_str).and_then(safe_request_id),
                name,
                arguments: block.get("input").map(Value::to_string).unwrap_or_else(|| "{}".into()),
            });
        }
        let finish = match value.get("stop_reason").and_then(Value::as_str) {
            Some("end_turn") | Some("stop_sequence") => FinishReason::Stop,
            Some("max_tokens") => FinishReason::Length,
            Some("refusal") => FinishReason::ContentFilter,
            Some("tool_use") => FinishReason::ToolCall,
            _ => FinishReason::Unknown,
        };
        Ok(InvocationOutput {
            tool_calls,
            reasoning: None,
            text,
            finish_reason: finish,
            usage: Usage {
                input_tokens: value.pointer("/usage/input_tokens").and_then(Value::as_u64),
                output_tokens: value.pointer("/usage/output_tokens").and_then(Value::as_u64),
                cached_input_tokens: value.pointer("/usage/cache_read_input_tokens").and_then(Value::as_u64),
            },
            provider_request_id: value.get("id").and_then(Value::as_str).and_then(safe_request_id),
            first_byte_ms,
            streamed: false,
        })
    }
}

impl ProviderAdapter for AnthropicMessages {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let headers = Self::headers(ctx)?;
        let mut models = Vec::new();
        let mut after: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let path = match &after {
                Some(id) => ctx.endpoint.path(&format!("/v1/models?limit=1000&after_id={id}")),
                None => ctx.endpoint.path("/v1/models?limit=1000"),
            };
            let (value, _) = common::get_json(ctx, path, headers.clone())?;
            after = Self::parse_page(&value, &mut models)?;
            if after.is_none() {
                break;
            }
        }
        Ok(models)
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        match Self::headers(ctx) {
            Ok(headers) => common::probe(ctx, ctx.endpoint.path("/v1/models?limit=1"), headers),
            Err(_) => HealthProbe::not_measured(HealthState::AuthRequired, HealthReason::CredentialMissing),
        }
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        let headers = Self::headers(ctx)?;
        let body = Self::body(spec)?;
        let (value, first) = match common::post_json(ctx, ctx.endpoint.path("/v1/messages"), headers.clone(), body.clone()) {
            // رفض يسمّي حقل الجهد: يُحذف ويُعاد النداء مرة. أيّ رفض آخر يبقى كما هو.
            Err(error) if body.get(EFFORT_FIELD).is_some() && common::refuses_field(&error, &["effort", EFFORT_FIELD]) => {
                let mut plain = body;
                if let Some(map) = plain.as_object_mut() {
                    map.remove(EFFORT_FIELD);
                }
                common::post_json(ctx, ctx.endpoint.path("/v1/messages"), headers, plain)?
            }
            other => other?,
        };
        Self::parse_message(&value, Some(first))
    }

    /// كتل `image` بمصدر base64 قبل النصّ، كما توصي وثائق Messages API.
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
    use crate::domain::ChatMessage;

    #[test]
    fn pages_are_parsed_and_the_cursor_followed() {
        let mut models = Vec::new();
        let cursor = AnthropicMessages::parse_page(
            &json!({ "data": [ { "id": "fixture-one", "display_name": "Fixture One" } ], "has_more": true, "last_id": "fixture-one" }),
            &mut models,
        )
        .unwrap();
        assert_eq!(cursor.as_deref(), Some("fixture-one"));
        assert_eq!(models[0].display_name.value.as_deref(), Some("Fixture One"));
        assert!(!models[0].context_window.is_known());
    }

    #[test]
    fn the_body_requires_a_limit_and_keeps_the_system_prompt_separate() {
        let spec = InvocationSpec {
            tools: Vec::new(),
            provider_model_id: "fixture-one".into(),
            system: Some("be brief".into()),
            messages: vec![
                ChatMessage::text(Role::System, "ignored here"),
                ChatMessage::text(Role::User, "hi"),
            ],
            temperature: None,
            max_output_tokens: None,
            response_format: ResponseFormat::Text,
            reasoning_effort: None,
            user_effort: None,
            wire: crate::domain::WireProfile::HOSTED,
            context_window: None,
            model_reasons: false,
        };
        let body = AnthropicMessages::body(&spec).unwrap();
        assert_eq!(body["max_tokens"], DEFAULT_MAX_TOKENS);
        assert_eq!(body["system"], "be brief");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_message_is_parsed_into_text_and_usage() {
        let out = AnthropicMessages::parse_message(
            &json!({ "id": "msg_1", "content": [ { "type": "text", "text": "hello" } ], "stop_reason": "end_turn", "usage": { "input_tokens": 3, "output_tokens": 1 } }),
            Some(5),
        )
        .unwrap();
        assert_eq!(out.text, "hello");
        assert_eq!(out.finish_reason, FinishReason::Stop);
        assert_eq!(out.usage.output_tokens, Some(1));
    }

    #[test]
    fn tool_calls_and_results_travel_as_blocks_and_no_temperature_is_sent() {
        let mut assistant = ChatMessage::text(Role::Assistant, "reading");
        assistant.tool_calls = vec![ProposedToolCall { id: Some("toolu_1".into()), name: "read_file".into(), arguments: "{\"path\":\"a.txt\"}".into() }];
        let mut result = ChatMessage::text(Role::Tool, "content of a");
        result.tool_call_id = Some("toolu_1".into());
        let spec = InvocationSpec {
            tools: vec![crate::domain::ToolOffer { name: "read_file".into(), description: "Read a file".into(), parameters: json!({ "type": "object" }) }],
            provider_model_id: "fixture-one".into(),
            system: None,
            messages: vec![ChatMessage::text(Role::User, "go"), assistant, result, ChatMessage::text(Role::User, "and then?")],
            temperature: Some(0.0),
            max_output_tokens: Some(100),
            response_format: ResponseFormat::Text,
            reasoning_effort: None,
            user_effort: None,
            wire: crate::domain::WireProfile::HOSTED,
            context_window: None,
            model_reasons: false,
        };
        let body = AnthropicMessages::body(&spec).unwrap();
        assert!(body.get("temperature").is_none(), "a temperature reached a provider whose current models reject it");
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3, "the tool result and the next user text were not merged into one user turn");
        assert_eq!(messages[1]["content"][1]["type"], "tool_use");
        assert_eq!(messages[1]["content"][1]["input"]["path"], "a.txt");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "toolu_1");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        let out = AnthropicMessages::parse_message(
            &json!({ "id": "msg_2", "content": [ { "type": "text", "text": "ok" }, { "type": "tool_use", "id": "toolu_2", "name": "write_file", "input": { "path": "b" } } ], "stop_reason": "tool_use", "usage": { "input_tokens": 1, "output_tokens": 1 } }),
            None,
        )
        .unwrap();
        assert_eq!(out.finish_reason, FinishReason::ToolCall);
        assert_eq!(out.tool_calls[0].id.as_deref(), Some("toolu_2"));
        assert_eq!(out.tool_calls[0].arguments, "{\"path\":\"b\"}");
    }

    #[test]
    fn a_user_image_travels_as_a_base64_image_block_before_the_text() {
        let mut user = ChatMessage::text(Role::User, "describe");
        user.images.push(crate::domain::ImagePart { media_type: "image/png".into(), data_base64: "iVBORw0K".into() });
        let mut spec = InvocationSpec {
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
        spec.tools.clear();
        let body = AnthropicMessages::body(&spec).unwrap();
        assert_eq!(body["messages"][0]["content"][0]["type"], "image");
        assert_eq!(body["messages"][0]["content"][0]["source"]["data"], "iVBORw0K");
        assert_eq!(body["messages"][0]["content"][1]["text"], "describe");
    }
}
