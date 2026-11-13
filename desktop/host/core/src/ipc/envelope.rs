// بناء الظرف الصادر والتحقق من الوارد.
//
// لا يوجد ظرف ثانٍ ولا نوع رسالة غير معلن. ما يخرج من هنا يُتحقَّق منه مقابل
// `IPCEnvelopeV1` قبل أن يُسلَّم، لأن المضيف يتحقق من ردّه كما يتحقق من طلب العارض:
// «الواجهة تثق بالخلفية» ليست قاعدة أمنية.

use serde_json::{json, Map, Value};

use crate::contracts::schemas::SchemaSet;
use crate::ipc::errors::{BoundaryError, HostError};
use crate::time::now_rfc3339_utc;
use crate::{CONTRACT_VERSION, IPC_PROTOCOL_VERSION};

pub const REQUEST_SCHEMA: &str = "ipc-envelope.v1.schema.json#/$defs/RequestEnvelope";
pub const RESPONSE_SCHEMA: &str = "ipc-envelope.v1.schema.json#/$defs/ResponseEnvelope";

/// الحقول التي تُنسَخ من الطلب إلى الرد لتبقى السلسلة السببية متصلة.
fn carry_over(request: &Value, response: &mut Map<String, Value>) {
    for field in ["correlation_id", "session_id"] {
        if let Some(value) = request.get(field) {
            response.insert(field.to_string(), value.clone());
        }
    }
}

/// يقرأ إصدار البروتوكول المعلن ويقسّمه. غياب أو شكل غير صالح يُعاد كخطأ لا كصفر.
pub fn parse_protocol_version(envelope: &Value) -> Result<(u32, u32), HostError> {
    let raw = envelope
        .get("protocol_version")
        .and_then(Value::as_str)
        .ok_or_else(|| HostError::invalid_message("protocol_version is absent").at("/protocol_version"))?;
    let (major, minor) = raw
        .split_once('.')
        .ok_or_else(|| HostError::invalid_message("protocol_version is not MAJOR.MINOR").at("/protocol_version"))?;
    let major = major
        .parse::<u32>()
        .map_err(|_| HostError::invalid_message("protocol_version MAJOR is not a number").at("/protocol_version"))?;
    let minor = minor
        .parse::<u32>()
        .map_err(|_| HostError::invalid_message("protocol_version MINOR is not a number").at("/protocol_version"))?;
    Ok((major, minor))
}

/// إصدار هذا المضيف مقسّمًا.
pub fn host_protocol_version() -> (u32, u32) {
    let (major, minor) = IPC_PROTOCOL_VERSION.split_once('.').expect("host protocol version is MAJOR.MINOR");
    (major.parse().expect("MAJOR"), minor.parse().expect("MINOR"))
}

/// يتحقق من ظرف الطلب الوارد بنيويًا.
pub fn validate_request_envelope(schemas: &SchemaSet, envelope: &Value) -> Result<(), HostError> {
    schemas.validate(REQUEST_SCHEMA, envelope).map_err(|errors| {
        let first = errors.first();
        let detail = errors
            .iter()
            .take(6)
            .map(|e| format!("{} {}", e.pointer, e.detail))
            .collect::<Vec<_>>()
            .join("; ");
        let mut error = HostError::invalid_message(detail);
        if let Some(first) = first {
            error = error.at(first.pointer.clone());
        }
        error
    })
}

/// يبني ردًّا ناجحًا ويتحقق منه قبل تسليمه.
pub fn build_success(
    schemas: &SchemaSet,
    request: &Value,
    message_id: String,
    caller_identity: Value,
    result: Value,
) -> Result<Value, HostError> {
    let mut response = Map::new();
    response.insert("contract_version".into(), json!(CONTRACT_VERSION));
    response.insert("protocol_version".into(), json!(IPC_PROTOCOL_VERSION));
    response.insert("message_type".into(), json!("RESPONSE"));
    response.insert("message_id".into(), json!(message_id));
    if let Some(request_id) = request.get("message_id") {
        response.insert("request_id".into(), request_id.clone());
        response.insert("causation_id".into(), request_id.clone());
    }
    carry_over(request, &mut response);
    response.insert("caller_identity".into(), caller_identity);
    response.insert("timestamp".into(), json!(now_rfc3339_utc()));
    response.insert("result".into(), result);

    let value = Value::Object(response);
    schemas
        .validate(RESPONSE_SCHEMA, &value)
        .map_err(|errors| {
            HostError::internal(format!(
                "the host produced a response that violates its own envelope: {}",
                errors.iter().take(4).map(|e| format!("{} {}", e.pointer, e.detail)).collect::<Vec<_>>().join("; ")
            ))
        })?;
    Ok(value)
}

/// يبني ردَّ خطأ. يمرّ بالتحقق نفسه: ردُّ خطأ غير صالح عيبٌ كامل لا نصف نجاح.
pub fn build_failure(
    schemas: &SchemaSet,
    request: &Value,
    message_id: String,
    caller_identity: Value,
    error: &BoundaryError,
) -> Value {
    let mut response = Map::new();
    response.insert("contract_version".into(), json!(CONTRACT_VERSION));
    response.insert("protocol_version".into(), json!(IPC_PROTOCOL_VERSION));
    response.insert("message_type".into(), json!("RESPONSE"));
    response.insert("message_id".into(), json!(message_id));
    if let Some(request_id) = request.get("message_id").filter(|v| v.is_string()) {
        response.insert("request_id".into(), request_id.clone());
        response.insert("causation_id".into(), request_id.clone());
    }
    carry_over(request, &mut response);
    response.insert("caller_identity".into(), caller_identity);
    response.insert("timestamp".into(), json!(now_rfc3339_utc()));
    response.insert(
        "error".into(),
        serde_json::to_value(error).unwrap_or_else(|_| json!({ "code": "INTERNAL_ERROR", "display_message": "desktop.error.internal_error" })),
    );

    let value = Value::Object(response);
    // ردّ خطأ لا يجتاز مخططه يعني أن الطلب كان مشوّهًا إلى حدّ يمنع حتى بناء ردّ
    // مرتبط به. عندئذٍ يُبنى ردّ مستقل صالح بدل تسليم مستند مكسور.
    if schemas.validate(RESPONSE_SCHEMA, &value).is_err() {
        return detached_failure(message_id_fallback(&value), caller_identity_fallback(&value), error);
    }
    value
}

fn message_id_fallback(value: &Value) -> String {
    value.get("message_id").and_then(Value::as_str).unwrap_or("").to_string()
}

fn caller_identity_fallback(value: &Value) -> Value {
    value.get("caller_identity").cloned().unwrap_or(Value::Null)
}

/// ردّ خطأ غير مرتبط بطلب: كل الحقول الإلزامية من عند المضيف.
fn detached_failure(message_id: String, caller_identity: Value, error: &BoundaryError) -> Value {
    json!({
        "contract_version": CONTRACT_VERSION,
        "protocol_version": IPC_PROTOCOL_VERSION,
        "message_type": "RESPONSE",
        "message_id": message_id,
        "request_id": message_id,
        "correlation_id": message_id,
        "session_id": caller_identity.get("session_id").cloned().unwrap_or(Value::Null),
        "caller_identity": caller_identity,
        "timestamp": now_rfc3339_utc(),
        "error": serde_json::to_value(error).unwrap_or(Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_protocol_version_is_a_minor_upgrade_not_a_new_major() {
        // 1.1 في Phase-01، ثم 1.2 بعمليات Phase-02، ثم 1.3 بPhase-03، ثم 1.4
        // بPhase-04. الادعاء المقيس هو أن الترقية MINOR دائمًا وأن الإصدار
        // المُعلن هو نفسه إصدار العقد — لا رقم بعينه: تثبيت الرقم يجعل كل مرحلة
        // تالية تكسر اختبار مرحلة مغلقة دون أن يتغيّر ادعاؤها.
        let (major, minor) = host_protocol_version();
        assert_eq!(major, 1, "a new MAJOR would break every existing document");
        assert!(minor >= 3, "the build must still understand the Phase-03 minor");
        assert_eq!(format!("{major}.{minor}"), crate::IPC_PROTOCOL_VERSION);
        assert_eq!(crate::IPC_PROTOCOL_VERSION, crate::CONTRACT_VERSION);
    }

    #[test]
    fn a_missing_protocol_version_is_an_error_not_a_default() {
        let error = parse_protocol_version(&json!({})).unwrap_err();
        assert_eq!(error.pointer.as_deref(), Some("/protocol_version"));
    }
}
