// Claude CLI بوضع الطباعة غير التفاعلي: وسائطه، وقراءة ردّه.
//
// قِيس 2026-11-12 على الإصدار 2.1.316: `--tools ""` مع `--safe-mode` يجعل الأداة نموذجًا نصّيًّا فقط (سؤال «اقرأ ملفًا» أجيب
// بلا أي محاولة ولا رفض إذن). تسجيل الدخول ملك الأداة؛ المضيف لا يرى مفتاحًا.

use serde_json::Value;

use super::prompt::HOST_NOTE;
use crate::domain::messages::{safe_request_id, ReasoningEffort, FinishReason, InvocationOutput, Usage, MAX_OUTPUT_CHARS};
use crate::error::{ProviderError, ProviderErrorCode};

/// وسائط نداء واحد. المُوجِّه نفسه يدخل على الإدخال المعياري. `effort`: اختيار المستخدم إن وُجد؛ غيابه = افتراضي الأداة.
pub fn invoke_args(model: &str, effort: Option<ReasoningEffort>) -> Vec<String> {
    let mut args: Vec<String> = ["-p", "--output-format", "json", "--model", model, "--tools", "", "--safe-mode", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", HOST_NOTE]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Some(level) = effort {
        args.extend(["--effort".to_string(), level.cli_level().to_string()]);
    }
    args
}

/// يصنّف نصّ خطأ أبلغت به الأداة.
pub fn classify(message: &str) -> ProviderErrorCode {
    let m = message.to_ascii_lowercase();
    if m.contains("login") || m.contains("log in") || m.contains("authenticat") || m.contains("api key") || m.contains("unauthorized") {
        ProviderErrorCode::AuthRequired
    } else if m.contains("usage limit") || m.contains("quota") || m.contains("credits") {
        // حصّة الاشتراك نفدت حتى موعد بالساعات (قِيس 2026-11-12: «try again at 8:48 PM»): ليست عابرة، فلا إعادة كل 15 ثانية.
        ProviderErrorCode::ModelUnavailable
    } else if m.contains("rate limit") || m.contains("overloaded") {
        ProviderErrorCode::RateLimited
    } else if m.contains("model") && (m.contains("not found") || m.contains("not exist") || m.contains("invalid") || m.contains("unknown")) {
        ProviderErrorCode::ModelNotFound
    } else {
        ProviderErrorCode::ProviderInternalError
    }
}

fn count(usage: &Value, key: &str) -> Option<u64> {
    usage.get(key).and_then(Value::as_u64)
}

/// يقرأ كائن JSON الذي تطبعه الأداة بـ`--output-format json`.
pub fn parse(stdout: &[u8]) -> Result<InvocationOutput, ProviderError> {
    let text = String::from_utf8_lossy(stdout);
    let body: Value = serde_json::from_str(text.trim()).map_err(|_| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "the CLI did not print a JSON result"))?;
    let result = body.get("result").and_then(Value::as_str).unwrap_or("");
    if body.get("is_error").and_then(Value::as_bool).unwrap_or(false) {
        return Err(ProviderError::new(classify(result), format!("the CLI reported an error: {result}")));
    }
    if result.is_empty() {
        return Err(ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "the CLI result carries no text"));
    }
    let usage = body.get("usage").cloned().unwrap_or(Value::Null);
    let cached = count(&usage, "cache_read_input_tokens");
    // رموز الإدخال كما يحاسب عليها المزوّد: الجديدة، والمكتوبة في المخبأ، والمقروءة منه.
    let input = count(&usage, "input_tokens").map(|fresh| fresh + count(&usage, "cache_creation_input_tokens").unwrap_or(0) + cached.unwrap_or(0));
    Ok(InvocationOutput {
        text: result.chars().take(MAX_OUTPUT_CHARS).collect(),
        finish_reason: if body.get("stop_reason").and_then(Value::as_str) == Some("max_tokens") { FinishReason::Length } else { FinishReason::Stop },
        usage: Usage { input_tokens: input, output_tokens: count(&usage, "output_tokens"), cached_input_tokens: cached },
        provider_request_id: body.get("session_id").and_then(Value::as_str).and_then(safe_request_id),
        first_byte_ms: None,
        streamed: false,
        tool_calls: Vec::new(),
        reasoning: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arguments_disable_tools_and_carry_no_prompt() {
        assert!(!invoke_args("m", None).iter().any(|a| a == "--effort"), "no effort flag without a choice");
        let high = invoke_args("m", Some(ReasoningEffort::Max));
        assert_eq!(high[high.iter().position(|a| a == "--effort").unwrap() + 1], "max");
        let args = invoke_args("some-model", None);
        let at = |flag: &str| args.iter().position(|a| a == flag).unwrap_or_else(|| panic!("{flag} missing"));
        assert_eq!(args[at("--tools") + 1], "");
        assert_eq!(args[at("--model") + 1], "some-model");
        for flag in ["-p", "--safe-mode", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"] {
            at(flag);
        }
        assert!(!args.iter().any(|a| a.contains("dangerously") || a.contains("bypass")), "{args:?}");
    }

    #[test]
    fn a_result_is_read_with_its_usage() {
        let out = parse(br#"{"result":"OK","is_error":false,"stop_reason":"end_turn","session_id":"c52f61c6-9027-4714-a892-5b47b0b13695","usage":{"input_tokens":2,"cache_creation_input_tokens":4075,"cache_read_input_tokens":10,"output_tokens":71}}"#).unwrap();
        assert_eq!(out.text, "OK");
        assert_eq!(out.finish_reason, FinishReason::Stop);
        assert_eq!((out.usage.input_tokens, out.usage.output_tokens, out.usage.cached_input_tokens), (Some(4087), Some(71), Some(10)));
        assert!(out.tool_calls.is_empty());
    }

    #[test]
    fn an_error_result_is_classified_and_never_returned_as_text() {
        let err = parse(br#"{"result":"Please run /login to authenticate","is_error":true}"#).unwrap_err();
        assert_eq!(err.code, ProviderErrorCode::AuthRequired);
        let err = parse(br#"{"result":"You have hit your usage limit","is_error":true}"#).unwrap_err();
        assert_eq!(err.code, ProviderErrorCode::ModelUnavailable);
        assert!(!err.code.retryable(), "an exhausted quota must not be retried in a loop");
        let err = parse(br#"{"result":"Rate limit exceeded, slow down","is_error":true}"#).unwrap_err();
        assert_eq!(err.code, ProviderErrorCode::RateLimited);
        assert_eq!(parse(b"not json").unwrap_err().code, ProviderErrorCode::ProviderResponseInvalid);
        assert_eq!(parse(br#"{"result":"","is_error":false}"#).unwrap_err().code, ProviderErrorCode::ProviderResponseInvalid);
    }
}
