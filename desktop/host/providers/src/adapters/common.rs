// أدوات مشتركة بين المحوّلات: طلبات JSON، وترجمة أخطاء النقل، وفحص الصحة،
// وتنظيف ما يبلغ به المزوّد قبل أن يصير بيانات.

use std::time::Instant;

use serde_json::Value;

use crate::adapters::CallContext;
use crate::domain::{HealthProbe, HealthReason, HealthState, RuntimeState};
use crate::error::{ProviderError, ProviderErrorCode};
use crate::net::http::{HttpRequest, HttpResponse, TransportError, TransportErrorKind};
use crate::net::NetworkClass;

/// أقصى جسم JSON غير متدفّق.
pub const MAX_JSON_BYTES: usize = 8 * 1024 * 1024;
/// أقصى بث.
pub const MAX_STREAM_BYTES: usize = 16 * 1024 * 1024;
/// أقصى سطر في بث.
pub const MAX_STREAM_LINE: usize = 1024 * 1024;
/// أقصى عدد نماذج يُقبل من قائمة واحدة.
pub const MAX_MODELS: usize = 2000;

pub fn transport_error(error: TransportError) -> ProviderError {
    let code = match error.kind {
        TransportErrorKind::ConnectionRefused
        | TransportErrorKind::NetworkUnreachable
        | TransportErrorKind::NameResolution
        | TransportErrorKind::Tls
        | TransportErrorKind::Io
        | TransportErrorKind::PolicyDenied => ProviderErrorCode::ProviderUnreachable,
        // مهلة الاتصال ومهلة القراءة تصلان المستدعي بالرمز نفسه: كلاهما «انتهت المهلة»
        // من منظور النداء. الفصل بينهما يخصّ *الصحّة* لا رمز خطأ النداء.
        TransportErrorKind::ConnectTimeout | TransportErrorKind::Timeout => ProviderErrorCode::ProviderTimeout,
        TransportErrorKind::Cancelled => ProviderErrorCode::Cancelled,
        TransportErrorKind::ResponseTooLarge | TransportErrorKind::MalformedResponse => ProviderErrorCode::ProviderResponseInvalid,
    };
    ProviderError::new(code, format!("{:?}: {}", error.kind, error.detail))
}

/// يصنّف فشل النقل إلى (حالة صحّة، سبب، حالة تشغيل).
///
/// المحور الحاسم هو الفصل بين فشل *إنشاء* الاتصال ومهلة *القراءة* بعد نجاحه:
///   - إنشاء فاشل (رفض، مهلة اتصال، شبكة غير قابلة للوصول): قياسٌ حقيقي لتعذّر
///     الوصول الآن → UNREACHABLE، ومحليًا NOT_RUNNING لأن العملية المحلية لم تقبل
///     اتصالًا. لا يُخترع NOT_INSTALLED: التثبيت بُعدٌ منفصل يقيسه مسبار آخر.
///   - مهلة قراءة بعد الاتصال: الخادم قبِل ثم صمت، فحالة التشغيل تبقى مجهولة.
///
/// البعيد يحتفظ بدلالته: مهلة الاتصال إليه تبقى UNKNOWN لأنها قد تكون عبورًا
/// عابرًا لا غيابَ خدمة، بينما الرفض الصريح يبقى UNREACHABLE كما كان.
pub fn classify_failure(kind: TransportErrorKind, local: bool) -> (HealthState, HealthReason, RuntimeState) {
    // حين يتعذّر إنشاء الاتصال: محليًا «لا يعمل»، وبعيدًا «لا ينطبق» (لا ندير عمليته).
    let unreached = if local { RuntimeState::NotRunning } else { RuntimeState::NotApplicable };
    match kind {
        TransportErrorKind::ConnectionRefused => (HealthState::Unreachable, HealthReason::ConnectionRefused, unreached),
        TransportErrorKind::ConnectTimeout if local => (HealthState::Unreachable, HealthReason::ProviderTimeout, RuntimeState::NotRunning),
        TransportErrorKind::ConnectTimeout => (HealthState::Unknown, HealthReason::ProviderTimeout, RuntimeState::Unknown),
        TransportErrorKind::Timeout => (HealthState::Unknown, HealthReason::ProviderTimeout, RuntimeState::Unknown),
        TransportErrorKind::NameResolution => (HealthState::Unreachable, HealthReason::NameResolutionFailed, RuntimeState::NotApplicable),
        TransportErrorKind::Tls => (HealthState::Unreachable, HealthReason::TlsFailure, RuntimeState::NotApplicable),
        TransportErrorKind::PolicyDenied => (HealthState::Misconfigured, HealthReason::EndpointRejected, RuntimeState::Unknown),
        TransportErrorKind::Cancelled => (HealthState::Unknown, HealthReason::NotChecked, RuntimeState::Unknown),
        TransportErrorKind::MalformedResponse | TransportErrorKind::ResponseTooLarge => {
            (HealthState::Misconfigured, HealthReason::ProtocolMismatch, RuntimeState::Unknown)
        }
        // فشل إنشاء على مستوى المقبس بلا تصنيف أدقّ (يشمل NotConnected): محليًا لا يعمل.
        TransportErrorKind::NetworkUnreachable => (HealthState::Unreachable, HealthReason::NetworkUnreachable, unreached),
        // خطأ إدخال/إخراج بعد الاتصال (كسر في منتصف القراءة): مقيسٌ لكن التشغيل مجهول.
        TransportErrorKind::Io => (HealthState::Unreachable, HealthReason::NetworkUnreachable, RuntimeState::Unknown),
    }
}

fn request(method: &'static str, ctx: &CallContext<'_>, path: String, headers: Vec<(&'static str, String)>, body: Option<Vec<u8>>) -> HttpRequest<'static> {
    HttpRequest { method, path, headers, body, deadline: ctx.deadline, idle: ctx.idle }
}

/// يرسل ويعيد الاستجابة إن كانت 2xx، وإلا خطأ مطبّعًا بجسم منقّح.
pub fn send(
    ctx: &CallContext<'_>,
    method: &'static str,
    path: String,
    headers: Vec<(&'static str, String)>,
    body: Option<Value>,
) -> Result<HttpResponse, ProviderError> {
    let mut headers = headers;
    let bytes = match body {
        Some(value) => {
            headers.push(("Content-Type", "application/json".to_string()));
            Some(serde_json::to_vec(&value).map_err(|e| ProviderError::new(ProviderErrorCode::InvalidRequest, e.to_string()))?)
        }
        None => None,
    };
    if ctx.cancel.is_cancelled() {
        return Err(ProviderError::new(ProviderErrorCode::Cancelled, "cancelled before send"));
    }
    let mut response = ctx
        .http
        .send(ctx.endpoint, request(method, ctx, path, headers, bytes), ctx.cancel)
        .map_err(transport_error)?;
    if (200..300).contains(&response.status) {
        return Ok(response);
    }
    let retry_after = response.header("retry-after").map(str::to_string);
    let body = response.body.read_all(64 * 1024).unwrap_or_default();
    Err(ProviderError::from_http_status(response.status, &body).with_retry_after(retry_after.as_deref()))
}

pub fn get_json(ctx: &CallContext<'_>, path: String, headers: Vec<(&'static str, String)>) -> Result<(Value, u64), ProviderError> {
    let mut response = send(ctx, "GET", path, headers, None)?;
    let first = response.first_byte_ms;
    let bytes = response.body.read_all(MAX_JSON_BYTES).map_err(transport_error)?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|e| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("invalid JSON: {e}")))?;
    Ok((value, first))
}

pub fn post_json(ctx: &CallContext<'_>, path: String, headers: Vec<(&'static str, String)>, body: Value) -> Result<(Value, u64), ProviderError> {
    let mut response = send(ctx, "POST", path, headers, Some(body))?;
    let first = response.first_byte_ms;
    let bytes = response.body.read_all(MAX_JSON_BYTES).map_err(transport_error)?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|e| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, format!("invalid JSON: {e}")))?;
    Ok((value, first))
}

/// فحص صحة عام: طلب GET واحد إلى مسار خفيف، وتصنيف الناتج.
pub fn probe(ctx: &CallContext<'_>, path: String, headers: Vec<(&'static str, String)>) -> HealthProbe {
    let started = Instant::now();
    let local = ctx.endpoint.class == NetworkClass::LoopbackProviderAccess;
    let outcome = ctx
        .http
        .send(ctx.endpoint, request("GET", ctx, path, headers, None), ctx.cancel);
    let latency = started.elapsed().as_millis() as u64;
    match outcome {
        Ok(mut response) => {
            let status = response.status;
            let body = response.body.read_all(MAX_JSON_BYTES);
            let running = if local { RuntimeState::Running } else { RuntimeState::NotApplicable };
            let (state, reason) = match status {
                200..=299 => match body.as_deref().map(serde_json::from_slice::<Value>) {
                    Ok(Ok(_)) => (HealthState::Healthy, HealthReason::Ok),
                    _ => (HealthState::Misconfigured, HealthReason::ProtocolMismatch),
                },
                401 | 403 => (HealthState::AuthFailed, HealthReason::CredentialRejected),
                404 | 405 => (HealthState::Misconfigured, HealthReason::ProtocolMismatch),
                429 => (HealthState::RateLimited, HealthReason::RateLimited),
                500..=599 => (HealthState::Degraded, HealthReason::ServerError),
                _ => (HealthState::Misconfigured, HealthReason::ResponseInvalid),
            };
            HealthProbe { state, reason, latency_ms: Some(latency), runtime: running }
        }
        Err(error) => {
            let (state, reason, runtime) = classify_failure(error.kind, local);
            // زمنٌ يُسجَّل حين قِسنا محاولة وصول فاشلة فعلًا (انتهت بـ UNREACHABLE):
            // رفضٌ سريع أو مهلة اتصال مستنفَدة، كلاهما قياس. غير المقيس (UNKNOWN/
            // MISCONFIGURED) لا يحمل زمنًا.
            let latency_ms = matches!(state, HealthState::Unreachable).then_some(latency);
            HealthProbe { state, reason, latency_ms, runtime }
        }
    }
}

/// نصّ من المزوّد صالح للعرض: محدود الطول، بلا محارف تحكّم.
pub fn clean_text(value: Option<&Value>, max_chars: usize) -> Option<String> {
    let text = value?.as_str()?;
    let cleaned: String = text.chars().filter(|c| !c.is_control()).take(max_chars).collect();
    let trimmed = cleaned.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// معرّف نموذج كما أبلغ به المزوّد. يُقبل فقط إن كان محدودًا وبلا محارف خطرة.
pub fn clean_model_id(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    is_clean_model_id(text).then(|| text.to_string())
}

/// قاعدة `ProviderModelId` في العقد نفسها: 1–200 محرف ASCII مرئي بلا علامات اقتباس ولا
/// أقواس زاوية ولا شرطة مائلة عكسية ولا «`». مصدرها واحد لكل طريق يُدخل معرّفًا.
pub fn is_clean_model_id(text: &str) -> bool {
    !text.is_empty() && text.len() <= 200 && text.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '"' | '\'' | '<' | '>' | '\\' | '`'))
}

/// عدد موجب من المزوّد، بحدّ أعلى معقول.
pub fn positive_u64(value: Option<&Value>) -> Option<u64> {
    let number = value?.as_u64()?;
    (number > 0 && number <= 100_000_000).then_some(number)
}

/// ترويسة Bearer.
pub fn bearer(ctx: &CallContext<'_>) -> Vec<(&'static str, String)> {
    match ctx.credential {
        Some(secret) => vec![("Authorization", format!("Bearer {}", secret.expose()))],
        None => Vec::new(),
    }
}

/// الرسائل على شكل OpenAI: دور ونصّ.
pub fn role_name(role: crate::domain::Role) -> &'static str {
    match role {
        crate::domain::Role::System => "system",
        crate::domain::Role::User => "user",
        crate::domain::Role::Assistant => "assistant",
        crate::domain::Role::Tool => "tool",
    }
}



/// هل رفضُ الخادم طلبٌ غير صالح (400) يسمّي أحد هذه الحقول؟ يُستعمل لحذف حقل اختياري وإعادة النداء مرة واحدة فقط.
pub fn refuses_field(error: &ProviderError, names: &[&str]) -> bool {
    if error.code != ProviderErrorCode::InvalidRequest {
        return false;
    }
    let diagnostic = error.diagnostic().to_ascii_lowercase();
    names.iter().any(|n| diagnostic.contains(&n.to_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_ids_are_filtered() {
        assert_eq!(clean_model_id(Some(&json!("vendor/model-7b:q4"))), Some("vendor/model-7b:q4".into()));
        assert_eq!(clean_model_id(Some(&json!("a b"))), None);
        assert_eq!(clean_model_id(Some(&json!("<img>"))), None);
        assert_eq!(clean_model_id(Some(&json!(7))), None);
        assert_eq!(clean_model_id(Some(&json!("x".repeat(300)))), None);
    }

    #[test]
    fn provider_text_is_bounded_and_control_free() {
        assert_eq!(clean_text(Some(&json!("  A\u{0}B  ")), 10), Some("AB".into()));
        assert_eq!(clean_text(Some(&json!("")), 10), None);
        assert_eq!(clean_text(Some(&json!("abcdef")), 3), Some("abc".into()));
    }

    #[test]
    fn numbers_must_be_positive_and_bounded() {
        assert_eq!(positive_u64(Some(&json!(4096))), Some(4096));
        assert_eq!(positive_u64(Some(&json!(0))), None);
        assert_eq!(positive_u64(Some(&json!(-1))), None);
        assert_eq!(positive_u64(Some(&json!("4096"))), None);
    }

    // مصفوفة تصنيف فشل النقل → صحّة. تختبر المجال لا شكل خطأ نظام تشغيل بعينه،
    // فتبقى حتمية على كل منصّة (Section 9/10).

    // P02-PROVIDER-HEALTH-001: رفضٌ صريح → UNREACHABLE / CONNECTION_REFUSED / NOT_RUNNING.
    #[test]
    fn connection_refused_is_unreachable_and_not_running_locally() {
        assert_eq!(
            classify_failure(TransportErrorKind::ConnectionRefused, true),
            (HealthState::Unreachable, HealthReason::ConnectionRefused, RuntimeState::NotRunning)
        );
    }

    // P02-PROVIDER-HEALTH-002: مهلة *اتصال* على الحلقة المحلية → UNREACHABLE /
    // PROVIDER_TIMEOUT / NOT_RUNNING. هذا جوهر إصلاح ويندوز: لم يُقبل اتصال، فالقياس
    // تعذّرُ وصول لا خادمٌ صامت.
    #[test]
    fn a_local_connect_timeout_is_unreachable_not_unknown() {
        let (state, reason, runtime) = classify_failure(TransportErrorKind::ConnectTimeout, true);
        assert_eq!(state, HealthState::Unreachable);
        assert_eq!(reason, HealthReason::ProviderTimeout);
        assert_eq!(runtime, RuntimeState::NotRunning);
    }

    // مهلة *قراءة* بعد نجاح الاتصال تبقى UNKNOWN: الخادم قبِل ثم صمت، فلا يُقال غائب.
    #[test]
    fn a_read_timeout_stays_unknown_after_a_successful_connect() {
        assert_eq!(
            classify_failure(TransportErrorKind::Timeout, true),
            (HealthState::Unknown, HealthReason::ProviderTimeout, RuntimeState::Unknown)
        );
    }

    // البعيد يحتفظ بدلالته: مهلة الاتصال إليه لا تُترجم تلقائيًا إلى UNREACHABLE
    // (Section 6) — تبقى UNKNOWN، بينما الرفض الصريح يبقى UNREACHABLE.
    #[test]
    fn remote_timeout_semantics_are_preserved() {
        assert_eq!(classify_failure(TransportErrorKind::ConnectTimeout, false).0, HealthState::Unknown);
        assert_eq!(classify_failure(TransportErrorKind::Timeout, false).0, HealthState::Unknown);
        let (state, _, runtime) = classify_failure(TransportErrorKind::ConnectionRefused, false);
        assert_eq!(state, HealthState::Unreachable);
        assert_eq!(runtime, RuntimeState::NotApplicable, "we do not manage the remote process");
    }

    // P02-PROVIDER-HEALTH-004: رفضٌ على مستوى السياسة (نقطة نهاية مرفوضة) →
    // MISCONFIGURED لا UNREACHABLE.
    #[test]
    fn a_rejected_endpoint_is_misconfigured_not_unreachable() {
        let (state, reason, _) = classify_failure(TransportErrorKind::PolicyDenied, true);
        assert_eq!(state, HealthState::Misconfigured);
        assert_eq!(reason, HealthReason::EndpointRejected);
    }

    // P02-PROVIDER-HEALTH-008: لا فشل نقل يخترع حالة تثبيت. التصنيف يعيد حالة *تشغيل*
    // فقط (RUNNING/NOT_RUNNING/UNKNOWN)، والتثبيت بُعدٌ منفصل لا يمسّه أيّ خطأ نقل.
    #[test]
    fn a_transport_failure_never_touches_installation() {
        for kind in [
            TransportErrorKind::ConnectionRefused,
            TransportErrorKind::ConnectTimeout,
            TransportErrorKind::Timeout,
            TransportErrorKind::NetworkUnreachable,
            TransportErrorKind::Io,
            TransportErrorKind::Tls,
            TransportErrorKind::NameResolution,
        ] {
            let (_, _, runtime) = classify_failure(kind, true);
            assert!(
                matches!(runtime, RuntimeState::NotRunning | RuntimeState::Unknown | RuntimeState::NotApplicable),
                "{kind:?} produced an installation-shaped runtime"
            );
        }
    }
}
