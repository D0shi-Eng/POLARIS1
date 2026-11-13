// W-4 (تكليف المالك 2026-10-27/28): عدّ الرفض بالوسائط للأسباب التي يصحّحها تغيير الوسائط وحدها.
//
// كان كل رفض يُعدّ بمفتاح (أداة، سبب) وحدّه 3: ثلاث محاولات مختلفة تقترب من الصواب توقف المهمّة، ومحاولتان متطابقتان لا توقفها.
// الآن، لسببي `ARGUMENTS_INVALID` و`RESULT_TOO_LARGE` فقط: مفتاح النمط بحدّ 5، ومفتاح النمط مع بصمة الوسائط المطبَّعة بحدّ 2.
// كل سبب آخر (سياسة، وموافقة، وأسرار، ومهمّة أخرى، وميزانية، وأدوات الوكيل…) يبقى بمفتاح النمط وحدّ 3 كما كان حرفيًّا: تغيير
// الوسائط لا يصحّحه، وتخفيف حدّه إضعاف للبوابة.

use sha2::{Digest, Sha256};
use serde_json::Value;

/// حدّ كل سبب لا يصحّحه تغيير الوسائط (السلوك السابق حرفيًّا).
pub const PATTERN_LIMIT: u32 = 3;
/// حدّ سبب يصحّحه تغيير الوسائط، بوسائط مختلفة.
pub const CORRECTABLE_LIMIT: u32 = 5;
/// حدّ التكرار المتطابق: الوسائط نفسها رُفضت للسبب نفسه.
pub const IDENTICAL_LIMIT: u32 = 2;
/// الأسباب التي يصحّحها تغيير الوسائط وحدها.
pub const CORRECTABLE: [&str; 2] = ["ARGUMENTS_INVALID", "RESULT_TOO_LARGE"];

const DIGEST_MARK: char = '#';

/// مفاتيح العدّ لرفض واحد.
pub fn keys(tool_id: &str, reason: &str, arguments: &str) -> Vec<String> {
    let pattern = format!("{tool_id}:{reason}");
    if CORRECTABLE.contains(&reason) {
        let identical = format!("{pattern}{DIGEST_MARK}{}", digest(arguments));
        vec![pattern, identical]
    } else {
        vec![pattern]
    }
}

/// حدّ المفتاح. المفاتيح المحفوظة قبل W-4 (نمط بلا بصمة) تُقرأ بالقاعدة نفسها.
pub fn limit(key: &str) -> u32 {
    if key.contains(DIGEST_MARK) {
        IDENTICAL_LIMIT
    } else if key.rsplit_once(':').is_some_and(|(_, reason)| CORRECTABLE.contains(&reason)) {
        CORRECTABLE_LIMIT
    } else {
        PATTERN_LIMIT
    }
}

/// بصمة الوسائط بعد التطبيع: ترتيب المفاتيح لا يغيّرها، ونصّ غير JSON يُبصم كما هو بعد قصّ الأطراف.
fn digest(arguments: &str) -> String {
    let normalised = serde_json::from_str::<Value>(arguments).map(|v| canonical(&v).to_string()).unwrap_or_else(|_| arguments.trim().to_string());
    Sha256::digest(normalised.as_bytes()).iter().take(6).map(|b| format!("{b:02x}")).collect()
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            Value::Object(keys.into_iter().map(|k| (k.clone(), canonical(&map[k]))).collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_argument_correctable_reasons_get_argument_keys() {
        let args = r#"{"path":"a","old_text":"x"}"#;
        assert_eq!(keys("polaris.workspace.edit", "ARGUMENTS_INVALID", args).len(), 2);
        for strict in ["SECRET_REQUESTED", "APPROVAL_DENIED", "CROSS_MISSION_DENIED", "BUDGET_EXHAUSTED", "NETWORK_POLICY_DENIED", "AGENT_TOOL_NOT_ALLOWED", "POLICY_DENIED"] {
            let k = keys("polaris.execution.command", strict, args);
            assert_eq!(k, vec![format!("polaris.execution.command:{strict}")], "{strict}");
            assert_eq!(limit(&k[0]), PATTERN_LIMIT, "{strict} limit changed");
        }
    }

    #[test]
    fn limits_follow_the_key_and_old_keys_read_the_same_way() {
        let k = keys("polaris.workspace.edit", "ARGUMENTS_INVALID", r#"{"a":1}"#);
        assert_eq!(limit(&k[0]), CORRECTABLE_LIMIT);
        assert_eq!(limit(&k[1]), IDENTICAL_LIMIT);
        assert_eq!(limit("polaris.execution.command:POLICY_DENIED"), PATTERN_LIMIT, "a checkpoint key from before W-4");
    }

    #[test]
    fn the_digest_ignores_key_order_and_whitespace_but_not_values() {
        let a = keys("t", "ARGUMENTS_INVALID", r#"{"path":"a","old_text":"x"}"#);
        let b = keys("t", "ARGUMENTS_INVALID", r#"{ "old_text": "x",  "path": "a" }"#);
        let c = keys("t", "ARGUMENTS_INVALID", r#"{"path":"a","old_text":"y"}"#);
        assert_eq!(a[1], b[1]);
        assert_ne!(a[1], c[1]);
        assert_eq!(keys("t", "ARGUMENTS_INVALID", " not json ")[1], keys("t", "ARGUMENTS_INVALID", "not json")[1]);
    }
}
