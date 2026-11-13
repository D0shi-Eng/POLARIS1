// قراءة حقول الحمولة بعد التحقق.

use serde_json::Value;

use crate::ipc::errors::HostError;

pub fn string(payload: &Value, field: &'static str) -> Result<String, HostError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| HostError::validation(format!("{field} is absent")).at(format!("/payload/{field}")))
}

pub fn opt_string(payload: &Value, field: &str) -> Option<String> {
    payload.get(field).and_then(Value::as_str).map(str::to_string)
}

pub fn opt_bool(payload: &Value, field: &str) -> Option<bool> {
    payload.get(field).and_then(Value::as_bool)
}

pub fn opt_u64(payload: &Value, field: &str) -> Option<u64> {
    payload.get(field).and_then(Value::as_u64)
}

pub fn integer(payload: &Value, field: &'static str) -> Result<i64, HostError> {
    payload
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| HostError::validation(format!("{field} is absent")).at(format!("/payload/{field}")))
}

/// حقل ثلاثي: غائب (لا تغيير)، أو null (امسح)، أو قيمة.
pub fn tri_string(payload: &Value, field: &str) -> Option<Option<String>> {
    match payload.get(field) {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        Some(_) => None,
    }
}

pub fn strings(payload: &Value, field: &str) -> Vec<String> {
    payload
        .get(field)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

/// قيمة رمزية مغلقة عبر serde.
pub fn code<T: for<'de> serde::Deserialize<'de>>(payload: &Value, field: &'static str) -> Result<Option<T>, HostError> {
    match payload.get(field) {
        None => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|_| HostError::validation(format!("{field} is not a known value")).at(format!("/payload/{field}"))),
    }
}
