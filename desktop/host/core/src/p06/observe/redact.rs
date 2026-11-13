// التنقيح الإلزامي قبل أن يخرج أيّ مستند تشخيصي من العملية (البند 29/33).
//
// طبقتان، وكلتاهما تفشل إلى الإخفاء: مفتاح يسمّي سرًّا تُخفى قيمته أيًّا كانت، ونصّ
// يشبه سرًّا يُخفى أيًّا كان مفتاحه. العدد يُعاد، فيُعرف أن التنقيح عمل لا أنه افتُرض.

use serde_json::Value;

pub const REDACTED: &str = "[REDACTED]";

/// أسماء مفاتيح لا تُعرض قيمتها أبدًا. مقارنة بلا حساسية للحالة.
const SECRET_KEYS: &[&str] = &["authorization", "password", "passwd", "secret", "token", "api_key", "apikey", "cookie", "credential", "private_key"];

fn secret_key(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // «secret_ref» و«credential_configured» ليسا قيمة سرّ: مرجع وحالة.
    if lower.ends_with("_ref") || lower.ends_with("_configured") || lower.ends_with("_source") || lower.ends_with("_updated_at") || lower == "auth_mode" {
        return false;
    }
    // عدّ الرموز («input_tokens») قياس استعمال لا رمز اعتماد.
    if lower.ends_with("tokens") || lower.contains("tokens_") || lower.contains("tokens_provenance") {
        return false;
    }
    SECRET_KEYS.iter().any(|k| lower.contains(k))
}

/// يُسقط من نصّ ما هو معرّف بشكل UUID قبل فحص شبه السرّ: المعرّف يمزج حروفًا وأرقامًا
/// فيبدو رمزًا، وهو ليس سرًّا. ما عداه يُفحص كما هو.
fn without_identifiers(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if i + 36 <= bytes.len() && text.is_char_boundary(i + 36) && is_uuid(&text[i..i + 36]) {
            out.push('U');
            i += 36;
            continue;
        }
        let ch = text[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_uuid(candidate: &str) -> bool {
    candidate.len() == 36
        && candidate.char_indices().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// ينقّح شجرة JSON في مكانها ويعيد عدد القيم التي أُخفيت.
pub fn redact_value(value: &mut Value) -> u32 {
    match value {
        Value::Object(map) => {
            let mut count = 0;
            for (key, child) in map.iter_mut() {
                if secret_key(key) && !matches!(child, Value::Null | Value::Bool(_) | Value::Number(_)) {
                    *child = Value::String(REDACTED.into());
                    count += 1;
                } else {
                    count += redact_value(child);
                }
            }
            count
        }
        Value::Array(items) => items.iter_mut().map(redact_value).sum(),
        Value::String(text) if crate::p05::secret::find(&without_identifiers(text)).is_some() => {
            *text = REDACTED.into();
            1
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_key_and_a_secret_shaped_value_are_both_hidden() {
        let mut doc = serde_json::json!({
            "headers": { "Authorization": "Bearer abc", "accept": "application/json" },
            "note": "token sk-live-0123456789abcdefghij",
            "nested": [{ "password": "hunter2" }, { "ok": "plain words" }],
            "secret_ref": "polaris.connector.c1",
            "credential_configured": true,
        });
        let hidden = redact_value(&mut doc);
        assert_eq!(hidden, 3);
        let text = doc.to_string();
        for leaked in ["Bearer abc", "sk-live", "hunter2"] {
            assert!(!text.contains(leaked), "{leaked} survived redaction");
        }
        assert!(text.contains("plain words"));
        assert!(text.contains("polaris.connector.c1"), "a reference is not a secret and must stay readable");
    }

    #[test]
    fn an_identifier_is_not_mistaken_for_a_secret_but_a_token_beside_it_still_is() {
        let id = "11111111-1111-4111-8111-111111111111";
        let mut doc = serde_json::json!({ "connector_id": id, "reference": format!("secret://connectors/{id}/default"), "note": format!("{id} sk-live-0123456789abcdefghij") });
        assert_eq!(redact_value(&mut doc), 1);
        assert_eq!(doc["connector_id"], id);
        assert_eq!(doc["note"], REDACTED);
    }
}
