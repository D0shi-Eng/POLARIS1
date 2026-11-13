// Codex CLI بوضع `exec` غير التفاعلي: وسائطه، وقراءة أحداثه، وفهرس نماذجه.
//
// قِيس 2026-11-12 على الإصدار 0.165.0: مع تعطيل `shell_tool` وصندوق القراءة فقط وتجاهل إعداد المستخدم لم تستطع الأداة قراءة
// ملف طُلب منها صراحةً. تسجيل الدخول ملك الأداة؛ المضيف لا يرى مفتاحًا.

use serde_json::Value;

use super::claude::classify;
use crate::domain::facts::{CapabilityClaim, Fact};
use crate::domain::messages::{FinishReason, ReasoningEffort, InvocationOutput, Usage, MAX_OUTPUT_CHARS};
use crate::domain::model::{DiscoveredModel, ModelCapability, ModelKind};
use crate::error::{ProviderError, ProviderErrorCode};

/// قدرات الأداة نفسها التي تُعطَّل: المضيف وحده ينفّذ الأدوات، عبر بوابته.
const DISABLED_FEATURES: [&str; 7] = ["shell_tool", "plugins", "apps", "memories", "hooks", "browser_use", "computer_use"];

/// أحداث تعني أن الأداة فعلت شيئًا بنفسها. ردّ يحملها يُرفض ولا يُعاد.
const OWN_ACTIONS: [&str; 3] = ["command_execution", "file_change", "web_search"];

/// وسائط نداء واحد. المُوجِّه نفسه يدخل على الإدخال المعياري (`-`).
/// `effort`: اختيار المستخدم من مربع الجهد إن وُجد؛ غيابه = الجهد الافتراضي أدناه.
pub fn invoke_args(model: &str, workdir: &str, effort: Option<ReasoningEffort>) -> Vec<String> {
    let mut args: Vec<String> = ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"].iter().map(|s| s.to_string()).collect();
    for feature in DISABLED_FEATURES {
        args.push("--disable".into());
        args.push(feature.into());
    }
    // جهد الاستدلال يُضبط صراحةً: `--ignore-user-config` يُسقط إعداد المستخدم، وقرار المالك (2026-11-12) جهد متوسط افتراضًا.
    let level = effort.map_or(REASONING_EFFORT, ReasoningEffort::cli_level);
    args.extend(["-c".to_string(), format!("model_reasoning_effort=\"{level}\"")]);
    args.extend(["-m".to_string(), model.to_string(), "-C".to_string(), workdir.to_string(), "-".to_string()]);
    args
}

/// جهد الاستدلال الافتراضي لكل نداء عبر Codex CLI حين لا يختار المستخدم جهدًا.
pub const REASONING_EFFORT: &str = "medium";

/// وسائط قراءة فهرس النماذج.
pub fn models_args() -> Vec<String> {
    vec!["debug".into(), "models".into()]
}

/// يقرأ أحداث JSONL التي تطبعها الأداة بـ`--json`.
pub fn parse(stdout: &[u8]) -> Result<InvocationOutput, ProviderError> {
    let mut reply: Option<String> = None;
    let mut usage = Usage { input_tokens: None, output_tokens: None, cached_input_tokens: None };
    let mut failure: Option<String> = None;
    let mut thread: Option<String> = None;
    for line in String::from_utf8_lossy(stdout).lines() {
        let Ok(event) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let item_type = event.pointer("/item/type").and_then(Value::as_str).unwrap_or("");
        if OWN_ACTIONS.contains(&item_type) {
            return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("the CLI used its own tool ({item_type}); the reply is discarded")));
        }
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "thread.started" => thread = event.get("thread_id").and_then(Value::as_str).map(str::to_string),
            "item.completed" if item_type == "agent_message" => {
                if let Some(text) = event.pointer("/item/text").and_then(Value::as_str) {
                    reply = Some(text.to_string());
                }
            }
            "turn.completed" => {
                let u = event.get("usage").cloned().unwrap_or(Value::Null);
                usage = Usage {
                    input_tokens: u.get("input_tokens").and_then(Value::as_u64),
                    output_tokens: u.get("output_tokens").and_then(Value::as_u64),
                    cached_input_tokens: u.get("cached_input_tokens").and_then(Value::as_u64),
                };
            }
            "turn.failed" => failure = Some(event.pointer("/error/message").and_then(Value::as_str).unwrap_or("turn failed").to_string()),
            "error" => failure = Some(event.get("message").and_then(Value::as_str).unwrap_or("error").to_string()),
            _ => {}
        }
    }
    if let Some(message) = failure {
        return Err(ProviderError::new(classify(&message), format!("the CLI reported an error: {message}")));
    }
    let text = reply.filter(|t| !t.is_empty()).ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "the CLI printed no agent message"))?;
    Ok(InvocationOutput {
        text: text.chars().take(MAX_OUTPUT_CHARS).collect(),
        finish_reason: FinishReason::Stop,
        usage,
        provider_request_id: thread.as_deref().and_then(crate::domain::messages::safe_request_id),
        first_byte_ms: None,
        streamed: false,
        tool_calls: Vec::new(),
        reasoning: None,
    })
}

/// يقرأ فهرس النماذج كما تطبعه الأداة. النماذج المخفية عند الأداة لا تُعرض.
pub fn parse_models(stdout: &[u8]) -> Result<Vec<DiscoveredModel>, ProviderError> {
    let body: Value = serde_json::from_str(String::from_utf8_lossy(stdout).trim()).map_err(|_| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "the CLI model catalog is not JSON"))?;
    let rows = body.get("models").and_then(Value::as_array).ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "the CLI model catalog has no models list"))?;
    let mut out = Vec::new();
    for row in rows {
        let Some(slug) = row.get("slug").and_then(Value::as_str).filter(|s| !s.is_empty()) else { continue };
        if row.get("visibility").and_then(Value::as_str).is_some_and(|v| v != "list") {
            continue;
        }
        let mut model = DiscoveredModel::bare(slug.to_string());
        model.display_name = Fact::reported_opt(row.get("display_name").and_then(Value::as_str).map(str::to_string));
        model.kind = ModelKind::Chat;
        model.context_window = Fact::reported_opt(row.get("context_window").and_then(Value::as_u64).filter(|w| *w > 0));
        model.set_claim(ModelCapability::TextInput, CapabilityClaim::reported(true));
        model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(true));
        if let Some(levels) = row.get("supported_reasoning_levels").and_then(Value::as_array) {
            model.set_claim(ModelCapability::Reasoning, CapabilityClaim::reported(!levels.is_empty()));
        }
        out.push(model);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arguments_sandbox_the_tool_and_disable_its_own_actions() {
        let args = invoke_args("some-model", "C:\\empty", None);
        let joined = args.join(" ");
        assert!(joined.starts_with("exec --json --sandbox read-only"), "{joined}");
        for feature in DISABLED_FEATURES {
            assert!(joined.contains(&format!("--disable {feature}")), "{joined}");
        }
        assert!(joined.contains("--ignore-user-config") && joined.contains("--ephemeral"), "{joined}");
        assert!(joined.ends_with("-m some-model -C C:\\empty -"), "{joined}");
        assert!(joined.contains("-c model_reasoning_effort=\"medium\""), "{joined}");
        assert!(!joined.contains("danger") && !joined.contains("workspace-write"), "{joined}");
    }

    #[test]
    fn the_users_effort_replaces_the_default() {
        for (effort, level) in [(ReasoningEffort::Max, "max"), (ReasoningEffort::High, "high"), (ReasoningEffort::Low, "low")] {
            let joined = invoke_args("m", "C:\\e", Some(effort)).join(" ");
            assert!(joined.contains(&format!("-c model_reasoning_effort=\"{level}\"")), "{joined}");
        }
    }

    #[test]
    fn the_last_agent_message_and_the_usage_are_read() {
        let events = br#"{"type":"thread.started","thread_id":"01a1cfec-7555-7db1-92e1-38aff1a87b0e"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"config warning"}}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"first"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":20964,"cached_input_tokens":13696,"output_tokens":5}}"#;
        let out = parse(events).unwrap();
        assert_eq!(out.text, "OK");
        assert_eq!((out.usage.input_tokens, out.usage.cached_input_tokens, out.usage.output_tokens), (Some(20964), Some(13696), Some(5)));
    }

    #[test]
    fn a_reply_where_the_tool_acted_on_its_own_is_discarded() {
        let events = br#"{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"type secret.txt"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"the secret is 42"}}"#;
        let err = parse(events).unwrap_err();
        assert_eq!(err.code, ProviderErrorCode::ProviderResponseInvalid);
    }

    #[test]
    fn failures_and_empty_output_are_errors() {
        // النصّ كما أعادته الأداة فعلًا (2026-11-12).
        assert_eq!(parse("{\"type\":\"turn.failed\",\"error\":{\"message\":\"You’ve hit your usage limit. Upgrade to Pro or try again at 8:48 PM.\"}}".as_bytes()).unwrap_err().code, ProviderErrorCode::ModelUnavailable);
        assert_eq!(parse(br#"{"type":"error","message":"Not logged in. Run codex login"}"#).unwrap_err().code, ProviderErrorCode::AuthRequired);
        assert_eq!(parse(b"").unwrap_err().code, ProviderErrorCode::ProviderResponseInvalid);
    }

    #[test]
    fn the_catalog_lists_visible_models_with_reported_facts() {
        let catalog = br#"{"models":[{"slug":"alpha","display_name":"Alpha","context_window":500000,"visibility":"list","supported_reasoning_levels":[{"effort":"low"}]},{"slug":"hidden-one","display_name":"Hidden","context_window":272000,"visibility":"hide"},{"display_name":"no slug"}]}"#;
        let models = parse_models(catalog).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].provider_model_id, "alpha");
        assert_eq!(models[0].context_window.value, Some(500000));
        assert!(models[0].claim(ModelCapability::Reasoning).is_proven());
        assert_eq!(parse_models(b"{}").unwrap_err().code, ProviderErrorCode::ProviderResponseInvalid);
    }
}
