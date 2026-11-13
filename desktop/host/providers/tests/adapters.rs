// اختبارات المحوّلات مقابل خادم HTTP حقيقي على الحلقة المحلية.
//
// كل حالة هنا حالة فشل حقيقية يقابلها المنتج: JSON مشوّه، مهلة، رفض مصادقة، حدّ
// معدّل، قائمة فارغة، معرّفات مكررة، حقول غير متوقعة، انقطاع في منتصف البث،
// إلغاء أثناء الطلب، إعادة توجيه، وجسم أكبر من الحدّ.

mod support;

use std::time::{Duration, Instant};

use polaris_host_providers::adapters::{adapter_for, CallContext};
use polaris_host_providers::domain::{ChatMessage, FinishReason, HealthReason, HealthState, InvocationSpec, ProviderKind, ResponseFormat, Role, RuntimeState};
use polaris_host_providers::error::ProviderErrorCode;
use polaris_host_providers::net::endpoint::{loopback, remote_fixture};
use polaris_host_providers::net::{CancelToken, HttpClient, NetworkClass};
use polaris_host_providers::SecretValue;
use support::{handler, MockServer, Reply};

fn spec(model: &str) -> InvocationSpec {
    InvocationSpec {
        provider_model_id: model.to_string(),
        system: None,
        messages: vec![ChatMessage::text(Role::User, "say ok")],
        temperature: None,
        max_output_tokens: Some(16),
        response_format: ResponseFormat::Text,
        reasoning_effort: None,
        user_effort: None,
        tools: Vec::new(),
        wire: polaris_host_providers::domain::WireProfile::LOCAL,
        context_window: None,
        model_reasons: false,
    }
}

fn sse(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|p| format!("data: {p}\n\n")).collect()
}

struct Env {
    http: HttpClient,
    cancel: CancelToken,
}

impl Env {
    fn new() -> Self {
        Self { http: HttpClient::new(), cancel: CancelToken::new() }
    }
}

fn ctx<'a>(env: &'a Env, endpoint: &'a polaris_host_providers::net::ResolvedEndpoint, secret: Option<&'a SecretValue>, ms: u64) -> CallContext<'a> {
    CallContext { http: &env.http, endpoint, credential: secret, cancel: &env.cancel, deadline: Instant::now() + Duration::from_millis(ms), idle: None }
}

#[test]
fn openai_compatible_discovery_handles_duplicates_and_unexpected_fields() {
    let server = MockServer::start(handler(|_| {
        Reply::Json(200, r#"{"object":"list","data":[{"id":"fixture-a","extra":{"x":[1,2]}},{"id":"fixture-a"},{"id":"fixture-b","owned_by":"lab"}],"unexpected":true}"#.into())
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let adapter = adapter_for(ProviderKind::LocalOpenaiCompatible);
    let models = adapter.discover_models(&ctx(&env, &endpoint, None, 3000)).unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(server.recorded()[0].path, "/v1/models");
    assert!(server.recorded()[0].header("authorization").is_none());
}

#[test]
fn an_empty_model_list_is_an_empty_result_not_an_error() {
    let server = MockServer::start(handler(|_| Reply::Json(200, r#"{"data":[]}"#.into())));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let models = adapter_for(ProviderKind::LocalOpenaiCompatible).discover_models(&ctx(&env, &endpoint, None, 3000)).unwrap();
    assert!(models.is_empty());
}

#[test]
fn malformed_json_is_a_provider_response_error() {
    let server = MockServer::start(handler(|_| Reply::Json(200, "{not json".into())));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).discover_models(&ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
}

#[test]
fn a_silent_server_times_out_and_health_does_not_call_it_offline() {
    let server = MockServer::start(handler(|_| Reply::Hang(Duration::from_secs(3))));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let adapter = adapter_for(ProviderKind::LocalOpenaiCompatible);
    let started = Instant::now();
    let error = adapter.discover_models(&ctx(&env, &endpoint, None, 400)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderTimeout);
    assert!(started.elapsed() < Duration::from_millis(2000));
    let probe = adapter.health_check(&ctx(&env, &endpoint, None, 400));
    assert_eq!(probe.state, HealthState::Unknown);
    assert_eq!(probe.reason, HealthReason::ProviderTimeout);
}

// P02-PROVIDER-HEALTH-001/002: مزوّد محلي على منفذ حلقة محلية بلا مستمع يُقاس
// «غير قابل للوصول / لا يعمل» بصرف النظر عن شكل خطأ النقل. نُثبت الحقيقة على مستوى
// المجال لا على errno بعينه: لينكس يعيد رفضًا فوريًا (CONNECTION_REFUSED)، وويندوز
// يستنفد مهلة الاتصال (PROVIDER_TIMEOUT) — وكلاهما تعذّرُ وصول محلي حقيقي. لا يصير
// أبدًا HEALTHY، ولا يبقى UNKNOWN بعد قياس فاشل.
#[test]
fn a_failed_local_connection_is_measured_as_unreachable_and_not_running() {
    let env = Env::new();
    let mut last = None;
    // نحجز منفذًا عابرًا ثم نُسقط مستمعه فيصير مغلقًا. بين الإسقاط والاتصال نافذةُ
    // سباق نظرية قد تلتقط فيها عملية أخرى المنفذ؛ فبدل الافتراض نتحقّق أن الاتصال
    // فشل فعلًا ونصنّف ما قِيس، ونعيد بمنفذ جديد إن التُقط (Section 11).
    for _ in 0..5 {
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let endpoint = loopback(&format!("http://127.0.0.1:{port}")).unwrap();
        let probe = adapter_for(ProviderKind::Ollama).health_check(&ctx(&env, &endpoint, None, 2000));
        assert_ne!(probe.state, HealthState::Healthy, "a closed port must never read as healthy");
        if probe.state == HealthState::Unreachable {
            assert_eq!(probe.runtime, RuntimeState::NotRunning);
            assert!(
                matches!(probe.reason, HealthReason::ConnectionRefused | HealthReason::ProviderTimeout),
                "reason should reflect the real transport outcome, got {:?}",
                probe.reason
            );
            return;
        }
        // حالة غير حاسمة (مثلًا التُقط المنفذ فصمت الخادم): أعد المحاولة بمنفذ جديد.
        last = Some(probe);
    }
    panic!("no unbound loopback port produced a reach failure; last probe = {last:?}");
}

// P02-PROVIDER-HEALTH-007: ردٌّ حقيقي 200 بجسم صالح على الحلقة المحلية يُقاس HEALTHY
// وRUNNING، لا UNKNOWN.
#[test]
fn a_real_local_response_is_measured_as_healthy_and_running() {
    let server = MockServer::start(handler(|_| Reply::Json(200, r#"{"version":"0.0.0-fixture"}"#.into())));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let probe = adapter_for(ProviderKind::Ollama).health_check(&ctx(&env, &endpoint, None, 3000));
    assert_eq!(probe.state, HealthState::Healthy);
    assert_eq!(probe.reason, HealthReason::Ok);
    assert_eq!(probe.runtime, RuntimeState::Running);
    assert!(probe.latency_ms.is_some(), "a real measurement records its latency");
}

#[test]
fn auth_failure_and_rate_limit_are_normalised_and_redacted() {
    let server = MockServer::start(handler(|r| {
        if r.path.contains("models") {
            Reply::Json(401, r#"{"error":{"message":"Incorrect API key provided: sk-live-abcdefghijklmnopqrstu12345"}}"#.into())
        } else {
            Reply::Json(429, r#"{"error":"slow down"}"#.into())
        }
    }));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    assert_eq!(endpoint.class, NetworkClass::RemoteEgress);
    let secret = SecretValue::new("sk-test-fixture-key-000000000000".into()).unwrap();
    let adapter = adapter_for(ProviderKind::Openai);
    let error = adapter.discover_models(&ctx(&env, &endpoint, Some(&secret), 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::AuthFailed);
    assert!(!error.diagnostic().contains("sk-live"), "{}", error.diagnostic());
    assert!(!format!("{error:?}").contains("sk-test-fixture"));
    assert_eq!(server.recorded()[0].header("authorization"), Some("Bearer sk-test-fixture-key-000000000000"));

    let error = adapter.invoke(&spec("m"), &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::RateLimited);

    let probe = adapter.health_check(&ctx(&env, &endpoint, Some(&secret), 3000));
    assert_eq!(probe.state, HealthState::AuthFailed);
}

#[test]
fn a_remote_provider_without_a_credential_never_sends() {
    let server = MockServer::start(handler(|_| Reply::Json(200, "{}".into())));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    for kind in [ProviderKind::Openai, ProviderKind::Anthropic, ProviderKind::Google] {
        let adapter = adapter_for(kind);
        assert_eq!(adapter.discover_models(&ctx(&env, &endpoint, None, 1000)).unwrap_err().code, ProviderErrorCode::AuthRequired);
        assert_eq!(adapter.invoke(&spec("m"), &ctx(&env, &endpoint, None, 1000)).unwrap_err().code, ProviderErrorCode::AuthRequired);
        assert_eq!(adapter.health_check(&ctx(&env, &endpoint, None, 1000)).state, HealthState::AuthRequired);
    }
    let error = adapter_for(ProviderKind::Openrouter).invoke(&spec("v/m"), &ctx(&env, &endpoint, None, 1000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::AuthRequired);
    assert!(server.recorded().is_empty(), "a request left without a credential");
}

#[test]
fn a_streamed_completion_is_assembled_with_usage() {
    let server = MockServer::start(handler(|_| Reply::Stream {
        content_type: "text/event-stream",
        parts: sse(&[
            r#"{"id":"chatcmpl-1","choices":[{"delta":{"content":"he"}}]}"#,
            r#"{"id":"chatcmpl-1","choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}"#,
            r#"{"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}"#,
            "[DONE]",
        ]),
        gap: Duration::from_millis(5),
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let out = adapter_for(ProviderKind::LmStudio).invoke(&spec("fixture-a"), &ctx(&env, &endpoint, None, 3000)).unwrap();
    assert_eq!(out.text, "hello");
    assert_eq!(out.finish_reason, FinishReason::Stop);
    assert_eq!(out.usage.input_tokens, Some(5));
    assert_eq!(out.provider_request_id.as_deref(), Some("chatcmpl-1"));
    assert!(out.streamed);
    assert!(out.first_byte_ms.is_some());
    let body: serde_json::Value = serde_json::from_str(&server.recorded()[0].body).unwrap();
    assert_eq!(body["stream"], true);
}

#[test]
fn a_local_server_reports_usage_when_asked_and_one_refusing_the_option_is_asked_again_without_it() {
    // خادم يرفض الحقل غير المعروف (نمط بعض الخوادم المتوافقة)، ثم يجيب حين يغيب، بعدّ في `timings` فقط.
    let server = MockServer::start(handler(|request| {
        if request.body.contains("stream_options") {
            return Reply::Json(400, r#"{"error":"unrecognized field: stream_options"}"#.into());
        }
        Reply::Stream {
            content_type: "text/event-stream",
            parts: sse(&[
                r#"{"id":"c1","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"timings":{"cache_n":3,"prompt_n":9,"predicted_n":2}}"#,
                "[DONE]",
            ]),
            gap: Duration::from_millis(2),
        }
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let out = adapter_for(ProviderKind::LocalOpenaiCompatible).invoke(&spec("m"), &ctx(&env, &endpoint, None, 3000)).unwrap();
    assert_eq!(out.text, "ok");
    assert_eq!((out.usage.input_tokens, out.usage.output_tokens, out.usage.cached_input_tokens), (Some(12), Some(2), Some(3)));
    let recorded = server.recorded();
    assert_eq!(recorded.len(), 2, "the refused option was not retried exactly once");
    assert!(recorded[0].body.contains("include_usage") && !recorded[1].body.contains("stream_options"));
}

#[test]
fn a_streamed_native_tool_call_is_assembled_from_its_fragments() {
    let server = MockServer::start(handler(|_| Reply::Stream {
        content_type: "text/event-stream",
        parts: sse(&[
            r#"{"id":"c2","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call1","type":"function","function":{"name":"polaris_workspace_write","arguments":""}}]}}]}"#,
            r#"{"id":"c2","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":\"a.txt\","}}]}}]}"#,
            r#"{"id":"c2","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"content\":\"hi\"}"}}]},"finish_reason":"tool_calls"}]}"#,
            r#"{"id":"c2","choices":[],"usage":{"prompt_tokens":300,"completion_tokens":20}}"#,
            "[DONE]",
        ]),
        gap: Duration::from_millis(2),
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let mut request = spec("m");
    request.tools = vec![polaris_host_providers::domain::ToolOffer {
        name: "polaris_workspace_write".into(),
        description: "Write a file".into(),
        parameters: serde_json::json!({ "type": "object" }),
    }];
    let adapter = adapter_for(ProviderKind::LocalOpenaiCompatible);
    assert!(adapter.supports_native_tools());
    let out = adapter.invoke(&request, &ctx(&env, &endpoint, None, 3000)).unwrap();
    assert_eq!(out.finish_reason, FinishReason::ToolCall);
    assert_eq!(out.text, "");
    assert_eq!(out.tool_calls.len(), 1);
    assert_eq!(out.tool_calls[0].arguments, r#"{"path":"a.txt","content":"hi"}"#);
    assert_eq!(out.usage.output_tokens, Some(20));
    let body: serde_json::Value = serde_json::from_str(&server.recorded()[0].body).unwrap();
    assert_eq!(body["tools"][0]["function"]["name"], "polaris_workspace_write");
}

#[test]
fn an_adapter_that_does_not_carry_native_tools_refuses_an_offer_before_sending() {
    let server = MockServer::start(handler(|_| Reply::Json(200, "{}".into())));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let mut request = spec("m");
    request.tools = vec![polaris_host_providers::domain::ToolOffer { name: "t".into(), description: String::new(), parameters: serde_json::json!({}) }];
    // Ollama صار ينقلها (ADR-040)؛ محوّل Google ما زال لا ينقلها، فهو مثال الرفض قبل أيّ بايت.
    let adapter = adapter_for(ProviderKind::Google);
    assert!(!adapter.supports_native_tools());
    let error = adapter.invoke(&request, &ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::UnsupportedCapability);
    assert!(server.recorded().is_empty(), "a refused offer still reached the server");
}

#[test]
fn a_local_refusal_for_another_reason_is_not_retried() {
    let server = MockServer::start(handler(|_| Reply::Json(400, r#"{"error":"model not loaded"}"#.into())));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).invoke(&spec("m"), &ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::InvalidRequest);
    assert_eq!(server.recorded().len(), 1);
}

#[test]
fn a_stream_cut_mid_way_is_not_presented_as_complete() {
    let server = MockServer::start(handler(|_| {
        let mut bytes = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        let part = "data: {\"choices\":[{\"delta\":{\"content\":\"par\"}}]}\n\n";
        bytes.extend_from_slice(format!("{:x}\r\n{}\r\n", part.len(), part).as_bytes());
        Reply::Raw(bytes)
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).invoke(&spec("m"), &ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
}

#[test]
fn cancelling_during_a_stream_aborts_the_request_at_the_server() {
    let parts: Vec<String> = (0..60).map(|i| format!("{{\"message\":{{\"content\":\"t{i} \"}},\"done\":false}}\n")).collect();
    let server = MockServer::start(handler(move |_| Reply::Stream { content_type: "application/x-ndjson", parts: parts.clone(), gap: Duration::from_millis(80) }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let canceller = env.cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        canceller.cancel();
    });
    let started = Instant::now();
    let error = adapter_for(ProviderKind::Ollama).invoke(&spec("m"), &ctx(&env, &endpoint, None, 20_000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(2), "cancellation was not prompt");
    let waited = Instant::now();
    while server.aborts() == 0 && waited.elapsed() < Duration::from_secs(6) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_eq!(server.aborts(), 1, "the server never saw the client go away");
    assert_eq!(server.completed(), 0);
}

#[test]
fn cancelling_before_the_request_sends_nothing() {
    let server = MockServer::start(handler(|_| Reply::Json(200, "{}".into())));
    let env = Env::new();
    env.cancel.cancel();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).invoke(&spec("m"), &ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::Cancelled);
    std::thread::sleep(Duration::from_millis(100));
    assert!(server.recorded().is_empty());
}

#[test]
fn redirects_are_never_followed() {
    let server = MockServer::start(handler(|_| {
        Reply::Raw(b"HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/steal\r\nContent-Length: 0\r\n\r\n".to_vec())
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).discover_models(&ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
    assert_eq!(server.recorded().len(), 1);
}

#[test]
fn an_oversized_body_is_refused() {
    let server = MockServer::start(handler(|_| {
        let body = format!("{{\"data\":[{{\"id\":\"{}\"}}]}}", "x".repeat(9 * 1024 * 1024));
        Reply::Json(200, body)
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).discover_models(&ctx(&env, &endpoint, None, 10_000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
}

#[test]
fn a_disconnect_before_any_response_is_an_invalid_response_not_success() {
    let server = MockServer::start(handler(|_| Reply::Close));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let error = adapter_for(ProviderKind::LocalOpenaiCompatible).discover_models(&ctx(&env, &endpoint, None, 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid);
}

#[test]
fn ollama_discovery_combines_tags_ps_and_show() {
    let server = MockServer::start(handler(|r| match r.path.as_str() {
        "/api/tags" => Reply::Json(200, r#"{"models":[{"name":"fixture-a:latest","details":{"parameter_size":"7B"}},{"name":"fixture-b:latest"}]}"#.into()),
        "/api/ps" => Reply::Json(200, r#"{"models":[{"name":"fixture-a:latest"}]}"#.into()),
        "/api/show" if r.body.contains("fixture-a") => {
            Reply::Json(200, r#"{"capabilities":["completion","tools"],"model_info":{"general.architecture":"ax","ax.context_length":8192}}"#.into())
        }
        "/api/show" => Reply::Json(500, r#"{"error":"boom"}"#.into()),
        _ => Reply::Json(404, "{}".into()),
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let models = adapter_for(ProviderKind::Ollama).discover_models(&ctx(&env, &endpoint, None, 5000)).unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].context_window.value, Some(8192));
    assert_eq!(format!("{:?}", models[0].loaded_state), "Loaded");
    assert_eq!(format!("{:?}", models[1].loaded_state), "NotLoaded");
    assert!(!models[1].context_window.is_known());
    // لا طلب يغيّر حالة الخادم: لا pull ولا delete ولا generate.
    for request in server.recorded() {
        assert!(["/api/tags", "/api/ps", "/api/show"].contains(&request.path.as_str()), "{}", request.path);
    }
}

#[test]
fn lm_studio_falls_back_to_the_compatible_listing() {
    let server = MockServer::start(handler(|r| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(404, r#"{"error":"not found"}"#.into()),
        "/v1/models" => Reply::Json(200, r#"{"data":[{"id":"fixture-a"}]}"#.into()),
        _ => Reply::Json(404, "{}".into()),
    }));
    let env = Env::new();
    let endpoint = loopback(&server.url()).unwrap();
    let models = adapter_for(ProviderKind::LmStudio).discover_models(&ctx(&env, &endpoint, None, 3000)).unwrap();
    assert_eq!(models.len(), 1);
    assert!(!models[0].context_window.is_known());
}

#[test]
fn anthropic_and_google_send_their_official_headers_only() {
    let server = MockServer::start(handler(|r| {
        if r.path.starts_with("/v1/messages") {
            Reply::Json(200, r#"{"id":"msg_1","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}"#.into())
        } else if r.path.contains(":generateContent") {
            Reply::Json(200, r#"{"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}"#.into())
        } else {
            Reply::Json(404, "{}".into())
        }
    }));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    let secret = SecretValue::new("fixture-secret-value-0000000000".into()).unwrap();
    let out = adapter_for(ProviderKind::Anthropic).invoke(&spec("fixture-one"), &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap();
    assert_eq!(out.text, "ok");
    let out = adapter_for(ProviderKind::Google).invoke(&spec("fixture-chat"), &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap();
    assert_eq!(out.text, "ok");
    let recorded = server.recorded();
    assert_eq!(recorded[0].header("x-api-key"), Some("fixture-secret-value-0000000000"));
    assert!(recorded[0].header("authorization").is_none());
    assert_eq!(recorded[1].header("x-goog-api-key"), Some("fixture-secret-value-0000000000"));
    assert!(!recorded[1].path.contains("key="), "the key travelled in the URL");
}

/// صياغة المزوّد المستضاف كما توثّقها صفحته (2026-10-06): لا درجة حرارة، وحقل السقف الموثّق، وجهد الاستدلال لنموذج يعلنه،
/// وفصل الاستدلال، وإعادة `reasoning_content` في رسالة المساعد السابقة. والاستدلال المبثوث يعود في الناتج ليُعاد لاحقًا.
#[test]
fn a_hosted_request_follows_the_documented_wire_and_its_streamed_reasoning_returns() {
    use polaris_host_providers::domain::{EffortWire, MaxTokensField, ProposedToolCall, WireProfile};
    let server = MockServer::start(handler(|_| Reply::Stream {
        content_type: "text/event-stream",
        parts: sse(&[
            r#"{"id":"r1","choices":[{"delta":{"reasoning_content":"think "}}]}"#,
            r#"{"id":"r1","choices":[{"delta":{"reasoning_content":"more"}}]}"#,
            r#"{"id":"r1","choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}"#,
            "[DONE]",
        ]),
        gap: Duration::from_millis(2),
    }));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    let secret = SecretValue::new("sk-test-fixture-key-000000000000".into()).unwrap();
    let mut request = spec("m");
    request.temperature = Some(0.3);
    request.reasoning_effort = Some(polaris_host_providers::domain::messages::ReasoningEffort::Low);
    request.model_reasons = true;
    request.wire = WireProfile { send_temperature: false, max_tokens: MaxTokensField::MaxCompletionTokens, effort: EffortWire::ReasoningEffort, echo_reasoning: true, reasoning_split: true };
    let mut earlier = ChatMessage::text(Role::Assistant, "");
    earlier.tool_calls = vec![ProposedToolCall { id: Some("c1".into()), name: "read_file".into(), arguments: "{}".into() }];
    earlier.reasoning = Some("earlier thought".into());
    let mut result = ChatMessage::text(Role::Tool, "status: SUCCEEDED");
    result.tool_call_id = Some("c1".into());
    request.messages.push(earlier);
    request.messages.push(result);
    let out = adapter_for(ProviderKind::OpenaiCompatibleApi).invoke(&request, &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap();
    assert_eq!(out.text, "done");
    assert_eq!(out.reasoning.as_deref(), Some("think more"));
    let body: serde_json::Value = serde_json::from_str(&server.recorded()[0].body).unwrap();
    assert!(body.get("temperature").is_none(), "a temperature reached a hosted provider");
    assert_eq!(body["max_completion_tokens"], 16);
    assert!(body.get("max_tokens").is_none());
    assert_eq!(body["reasoning_effort"], "low");
    assert_eq!(body["reasoning_split"], true);
    assert_eq!(body["messages"][1]["reasoning_content"], "earlier thought");
    assert!(body["messages"][2].get("reasoning_content").is_none(), "reasoning was attached to a tool result");
}

/// نموذج لا يستدلّ عند مزوّد يقبل الحقل لغيره: الرفض الذي يسمّي الحقل يُعاد بدونه مرة (قِيس على Groq 2026-10-06)، ونموذج
/// لا يعلن الفهرس أنه يستدلّ لا يُرسل إليه الحقل أصلًا.
#[test]
fn a_reasoning_effort_refused_by_the_model_is_dropped_once_and_never_sent_to_a_model_that_does_not_reason() {
    let server = MockServer::start(handler(|request| {
        if request.body.contains("reasoning_effort") {
            return Reply::Json(400, r#"{"error":{"message":"`reasoning_effort` is not supported with this model","type":"invalid_request_error"}}"#.into());
        }
        Reply::Stream { content_type: "text/event-stream", parts: sse(&[r#"{"id":"a","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}"#, "[DONE]"]), gap: Duration::from_millis(2) }
    }));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    let secret = SecretValue::new("sk-test-fixture-key-000000000000".into()).unwrap();
    let mut request = spec("m");
    request.wire = polaris_host_providers::domain::WireProfile::HOSTED;
    request.reasoning_effort = Some(polaris_host_providers::domain::messages::ReasoningEffort::Low);
    request.model_reasons = true;
    let adapter = adapter_for(ProviderKind::OpenaiCompatibleApi);
    assert_eq!(adapter.invoke(&request, &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap().text, "ok");
    assert_eq!(server.recorded().len(), 2, "the refused field was not dropped exactly once");
    request.model_reasons = false;
    adapter.invoke(&request, &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap();
    assert!(!server.recorded()[2].body.contains("reasoning_effort"), "the field reached a model the catalogue does not mark as reasoning");
}

/// خطأ داخل البثّ لاستدعاء أداة باسم خاطئ (قِيس على Groq 2026-10-06) عيبُ مخرجات لا عطل مزوّد، ورفض 429 يحمل مهلة
/// `retry-after` كما قالها المزوّد.
#[test]
fn an_in_stream_tool_failure_is_an_output_error_and_a_rate_limit_keeps_its_retry_after() {
    let server = MockServer::start(handler(|request| {
        if request.body.contains("rate") {
            return Reply::Raw(b"HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nretry-after: 7\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".to_vec());
        }
        Reply::Raw(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"id\":\"x\",\"choices\":[{\"delta\":{\"reasoning\":\"hm\"}}]}\n\nevent: error\ndata: {\"error\":{\"message\":\"Tool call validation failed: attempted to call tool 'polatis_write' which was not in request.tools\",\"type\":\"invalid_request_error\",\"code\":\"tool_use_failed\",\"status_code\":400}}\n\n"
                .to_vec(),
        )
    }));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    let secret = SecretValue::new("sk-test-fixture-key-000000000000".into()).unwrap();
    let adapter = adapter_for(ProviderKind::OpenaiCompatibleApi);
    let error = adapter.invoke(&spec("m"), &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::ProviderResponseInvalid, "{error:?}");
    assert!(error.diagnostic().contains("tool_use_failed") && error.diagnostic().contains("polatis_write"));
    let mut limited = spec("m");
    limited.messages = vec![ChatMessage::text(Role::User, "rate")];
    let error = adapter.invoke(&limited, &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap_err();
    assert_eq!(error.code, ProviderErrorCode::RateLimited);
    assert_eq!(error.retry_after_ms, Some(7_000));
}

/// مربع الجهد (2026-11-13): اختيار المستخدم يصل Anthropic بـ`output_config.effort` وGemini بـ`thinkingConfig.thinkingLevel`،
/// ولا يُرسل شيء بلا اختيار. نموذج يرفض الحقل باسمه يُعاد إليه النداء مرة بدونه، ولا أكثر.
#[test]
fn the_users_effort_reaches_anthropic_and_gemini_and_a_refusal_naming_it_is_retried_once_without_it() {
    use polaris_host_providers::domain::messages::ReasoningEffort;
    let server = MockServer::start(handler(|r| {
        let refuse = r.body.contains("\"refuse-me\"");
        if r.path.starts_with("/v1/messages") {
            if refuse && r.body.contains("output_config") {
                return Reply::Json(400, r#"{"type":"error","error":{"type":"invalid_request_error","message":"effort: this model does not support the effort parameter"}}"#.into());
            }
            Reply::Json(200, r#"{"id":"msg_1","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}"#.into())
        } else if r.path.contains(":generateContent") {
            if r.path.contains("refuse-me") && r.body.contains("thinkingConfig") {
                return Reply::Json(400, r#"{"error":{"code":400,"message":"Thinking level is not supported for this model.","status":"INVALID_ARGUMENT"}}"#.into());
            }
            Reply::Json(200, r#"{"candidates":[{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1}}"#.into())
        } else {
            Reply::Json(404, "{}".into())
        }
    }));
    let env = Env::new();
    let endpoint = remote_fixture(&server.url()).unwrap();
    let secret = SecretValue::new("fixture-secret-value-0000000000".into()).unwrap();
    let call = |kind: ProviderKind, model: &str, effort: Option<ReasoningEffort>| {
        let mut request = spec(model);
        request.user_effort = effort;
        adapter_for(kind).invoke(&request, &ctx(&env, &endpoint, Some(&secret), 3000)).unwrap().text
    };
    let body = |i: usize| -> serde_json::Value { serde_json::from_str(&server.recorded()[i].body).unwrap() };

    assert_eq!(call(ProviderKind::Anthropic, "m", Some(ReasoningEffort::Max)), "ok");
    assert_eq!(body(0)["output_config"]["effort"], "max");
    assert_eq!(call(ProviderKind::Anthropic, "m", None), "ok");
    assert!(body(1).get("output_config").is_none(), "an effort was sent without a choice");
    assert_eq!(call(ProviderKind::Anthropic, "refuse-me", Some(ReasoningEffort::High)), "ok");
    assert_eq!(server.recorded().len(), 4, "the refused effort was not dropped exactly once");
    assert!(body(3).get("output_config").is_none());

    assert_eq!(call(ProviderKind::Google, "g", Some(ReasoningEffort::Max)), "ok");
    assert_eq!(body(4)["generationConfig"]["thinkingConfig"]["thinkingLevel"], "high");
    assert_eq!(call(ProviderKind::Google, "g", Some(ReasoningEffort::Medium)), "ok");
    assert_eq!(body(5)["generationConfig"]["thinkingConfig"]["thinkingLevel"], "medium");
    assert_eq!(call(ProviderKind::Google, "g", None), "ok");
    assert!(body(6).pointer("/generationConfig/thinkingConfig").is_none(), "a thinking level was sent without a choice");
    assert_eq!(call(ProviderKind::Google, "refuse-me", Some(ReasoningEffort::Low)), "ok");
    assert_eq!(server.recorded().len(), 9, "the refused thinking level was not dropped exactly once");
    assert!(body(8).pointer("/generationConfig/thinkingConfig").is_none());
}
