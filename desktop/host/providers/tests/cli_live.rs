// اختبار حيّ لمحوّل أدوات سطر الأوامر: يشغّل Claude CLI وCodex CLI المثبّتين فعلًا. يُشغَّل بـ`--ignored` فقط، ويحتاج الأداتين
// مسجّلتَي الدخول على هذا الجهاز. الطلب نصّ ثابت بلا بيانات مستخدم.

use std::time::{Duration, Instant};

use polaris_host_providers::adapters::{adapter_for, CallContext};
use polaris_host_providers::domain::messages::{ChatMessage, InvocationSpec, ResponseFormat, Role, WireProfile};
use polaris_host_providers::domain::{HealthState, ProviderKind};
use polaris_host_providers::net::{endpoint, CancelToken, HttpClient};

fn spec(model: &str) -> InvocationSpec {
    InvocationSpec {
        provider_model_id: model.to_string(),
        system: Some("You answer with a single word and nothing else.".into()),
        messages: vec![ChatMessage::text(Role::User, "What is the capital of France?")],
        temperature: None,
        max_output_tokens: None,
        response_format: ResponseFormat::Text,
        reasoning_effort: None,
        user_effort: None,
        tools: Vec::new(),
        context_window: None,
        wire: WireProfile::default(),
        model_reasons: false,
    }
}

fn exercise(kind: ProviderKind, pick: impl Fn(&[String]) -> String) {
    let http = HttpClient::new();
    let cancel = CancelToken::new();
    // المحوّل لا يستعمل العنوان: الأداة هي التي تتصل. يُعطى عنوان حلقة محلية لإكمال السياق فقط.
    let endpoint = endpoint::loopback("http://127.0.0.1:9").unwrap();
    let ctx = |seconds: u64| CallContext { http: &http, endpoint: &endpoint, credential: None, cancel: &cancel, deadline: Instant::now() + Duration::from_secs(seconds), idle: None };
    let adapter = adapter_for(kind);

    let probe = adapter.health_check(&ctx(30));
    assert_eq!(probe.state, HealthState::Healthy, "{probe:?}");

    let models = adapter.discover_models(&ctx(60)).expect("model discovery");
    let ids: Vec<String> = models.iter().map(|m| m.provider_model_id.clone()).collect();
    assert!(!ids.is_empty(), "no models discovered");
    println!("CLI_LIVE {kind:?} health_ms={:?} models={ids:?}", probe.latency_ms);

    let model = pick(&ids);
    let began = Instant::now();
    let reply = adapter.invoke(&spec(&model), &ctx(180)).expect("invocation");
    println!("CLI_LIVE {kind:?} model={model} ms={} text={:?} usage={:?}", began.elapsed().as_millis(), reply.text, reply.usage);
    assert!(reply.text.to_lowercase().contains("paris"), "{:?}", reply.text);
    assert!(reply.tool_calls.is_empty());
    assert!(reply.usage.output_tokens.is_some_and(|t| t > 0), "{:?}", reply.usage);
}

#[test]
#[ignore]
fn claude_cli_answers_through_the_adapter() {
    exercise(ProviderKind::ClaudeCli, |ids| ids.iter().find(|id| id.as_str() == "haiku").cloned().unwrap_or_else(|| ids[0].clone()));
}

#[test]
#[ignore]
fn codex_cli_answers_through_the_adapter() {
    exercise(ProviderKind::CodexCli, |ids| ids[0].clone());
}
