// الجلسة 1 (خطة 2026-10-07، ADR-040): Ollama ينقل الأدوات الأصيلة كما توثّقها صفحته الرسمية
// (docs.ollama.com/capabilities/tool-calling، قُرئت 2026-10-07):
// - الطلب: `tools: [{type: "function", function: {name, description, parameters}}]` في `/api/chat`.
// - الردّ: `message.tool_calls: [{type: "function", function: {index, name, arguments}}]`، والوسائط كائن لا نصّ.
// - النتيجة تعود برسالة `{role: "tool", tool_name, content}`.
// - مع البثّ، تجمع الأجزاء كلها: التفكير والمحتوى والاستدعاءات.
//
// كُتب هذا قبل الإصلاح. على `0803b99` كان المحوّل يرفض كل عرض أدوات (UnsupportedCapability)، فيعمل الوكيل على
// Ollama بصيغة JSON نصّية أضعف من بقية المزوّدين.

mod support;

use std::time::{Duration, Instant};

use polaris_host_providers::adapters::{adapter_for, CallContext};
use polaris_host_providers::domain::{ChatMessage, FinishReason, InvocationSpec, ProposedToolCall, ProviderKind, ResponseFormat, Role, ToolOffer};
use polaris_host_providers::net::endpoint::loopback;
use polaris_host_providers::net::{CancelToken, HttpClient};
use serde_json::{json, Value};
use support::{handler, MockServer, Reply};

fn spec(messages: Vec<ChatMessage>) -> InvocationSpec {
    InvocationSpec {
        provider_model_id: "qwen3:4b".into(),
        system: Some("You are a test agent.".into()),
        messages,
        temperature: None,
        max_output_tokens: Some(64),
        response_format: ResponseFormat::Text,
        reasoning_effort: None,
        user_effort: None,
        tools: vec![ToolOffer {
            name: "write_file".into(),
            description: "Write a file in the workspace".into(),
            parameters: json!({ "type": "object", "required": ["path", "content"], "properties": { "path": { "type": "string" }, "content": { "type": "string" } } }),
        }],
        wire: polaris_host_providers::domain::WireProfile::LOCAL,
        context_window: None,
        model_reasons: false,
    }
}

fn ndjson(lines: &[Value]) -> Vec<String> {
    lines.iter().map(|l| format!("{l}\n")).collect()
}

fn call(server: &MockServer, request: &InvocationSpec) -> Result<polaris_host_providers::domain::InvocationOutput, polaris_host_providers::error::ProviderError> {
    let http = HttpClient::new();
    let cancel = CancelToken::new();
    let endpoint = loopback(&server.url()).unwrap();
    let ctx = CallContext { http: &http, endpoint: &endpoint, credential: None, cancel: &cancel, deadline: Instant::now() + Duration::from_secs(5), idle: None };
    adapter_for(ProviderKind::Ollama).invoke(request, &ctx)
}

#[test]
fn s1_ollama_offers_tools_and_returns_the_streamed_tool_call() {
    let server = MockServer::start(handler(|_| Reply::Stream {
        content_type: "application/x-ndjson",
        parts: ndjson(&[
            json!({ "model": "qwen3:4b", "message": { "role": "assistant", "content": "", "thinking": "I should write the file." }, "done": false }),
            json!({ "model": "qwen3:4b", "message": { "role": "assistant", "content": "", "tool_calls": [
                { "type": "function", "function": { "index": 0, "name": "write_file", "arguments": { "path": "a.txt", "content": "hi" } } }
            ] }, "done": false }),
            json!({ "model": "qwen3:4b", "message": { "role": "assistant", "content": "" }, "done": true, "done_reason": "stop", "prompt_eval_count": 300, "eval_count": 20 }),
        ]),
        gap: Duration::from_millis(2),
    }));
    assert!(adapter_for(ProviderKind::Ollama).supports_native_tools(), "the Ollama adapter does not carry native tools");
    let out = call(&server, &spec(vec![ChatMessage::text(Role::User, "write hi to a.txt")])).expect("a tool offer to Ollama was refused");
    assert_eq!(out.finish_reason, FinishReason::ToolCall);
    assert_eq!(out.tool_calls.len(), 1);
    assert_eq!(out.tool_calls[0].name, "write_file");
    let arguments: Value = serde_json::from_str(&out.tool_calls[0].arguments).unwrap();
    assert_eq!(arguments, json!({ "path": "a.txt", "content": "hi" }));
    assert!(out.tool_calls[0].id.as_deref().is_some_and(|id| !id.is_empty()), "the call carries no id the loop can answer");
    assert_eq!(out.usage.input_tokens, Some(300));
    assert_eq!(out.usage.output_tokens, Some(20));
    let body: Value = serde_json::from_str(&server.recorded()[0].body).unwrap();
    assert_eq!(body["tools"][0]["type"], "function");
    assert_eq!(body["tools"][0]["function"]["name"], "write_file");
    assert_eq!(body["tools"][0]["function"]["parameters"]["required"], json!(["path", "content"]));
}

#[test]
fn s1_ollama_sends_the_call_and_its_result_back_in_the_documented_shape() {
    let server = MockServer::start(handler(|_| Reply::Stream {
        content_type: "application/x-ndjson",
        parts: ndjson(&[
            json!({ "model": "qwen3:4b", "message": { "role": "assistant", "content": "Done." }, "done": false }),
            json!({ "model": "qwen3:4b", "message": { "role": "assistant", "content": "" }, "done": true, "done_reason": "stop", "prompt_eval_count": 320, "eval_count": 3 }),
        ]),
        gap: Duration::ZERO,
    }));
    let mut assistant = ChatMessage::text(Role::Assistant, "");
    assistant.tool_calls = vec![ProposedToolCall { id: Some("ollama-call-0".into()), name: "write_file".into(), arguments: r#"{"path":"a.txt","content":"hi"}"#.into() }];
    let mut result = ChatMessage::text(Role::Tool, "SUCCEEDED: wrote a.txt (2 bytes)");
    result.tool_call_id = Some("ollama-call-0".into());
    let out = call(&server, &spec(vec![ChatMessage::text(Role::User, "write hi to a.txt"), assistant, result])).expect("a conversation with a tool result was refused");
    assert_eq!(out.text, "Done.");
    assert_eq!(out.finish_reason, FinishReason::Stop);
    let body: Value = serde_json::from_str(&server.recorded()[0].body).unwrap();
    let messages = body["messages"].as_array().unwrap();
    // النظام، ثم المستخدم، ثم المساعد باستدعائه، ثم نتيجة الأداة.
    assert_eq!(messages[2]["role"], "assistant");
    assert_eq!(messages[2]["tool_calls"][0]["function"]["name"], "write_file");
    assert_eq!(messages[2]["tool_calls"][0]["function"]["arguments"], json!({ "path": "a.txt", "content": "hi" }), "arguments must travel as an object");
    assert_eq!(messages[3]["role"], "tool");
    assert_eq!(messages[3]["tool_name"], "write_file");
    assert_eq!(messages[3]["content"], "SUCCEEDED: wrote a.txt (2 bytes)");
}

/// قِيس 2026-10-07 في التطبيق (C2): كل نداء إلى `qwen3:4b` قُرئ منه 2050 رمز إدخال بالضبط، والموجّه بأدواته أكثر من 8000.
/// الخادم قطع الموجّه إلى نافذته الافتراضية بصمت، فلم يرَ النموذج أدواته. الطلب يجب أن يسمّي نافذة تتّسع له.
#[test]
fn s1_ollama_asks_for_a_context_window_the_prompt_fits_in() {
    let server = MockServer::start(handler(|_| Reply::Stream {
        content_type: "application/x-ndjson",
        parts: ndjson(&[json!({ "model": "qwen3:4b", "message": { "role": "assistant", "content": "ok" }, "done": true, "done_reason": "stop", "prompt_eval_count": 9000, "eval_count": 1 })]),
        gap: Duration::ZERO,
    }));
    let mut request = spec(vec![ChatMessage::text(Role::User, "write hi to a.txt")]);
    // موجّه نظام بطول موجّه الوكيل الحقيقي تقريبًا: ~24 ألف حرف.
    request.system = Some("You are POLARIS. ".repeat(1_400));
    call(&server, &request).expect("the request failed");
    let body: Value = serde_json::from_str(&server.recorded()[0].body).unwrap();
    let num_ctx = body["options"]["num_ctx"].as_u64().expect("the request names no context window, so the server truncates to its default");
    assert!(num_ctx >= 16_384, "a 24k-character prompt asked for only {num_ctx} tokens");
}
