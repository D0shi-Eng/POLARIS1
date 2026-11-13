// تنقيح النصوص قبل أن تصل إلى أي سجل.
//
// جسم خطأ المزوّد قد يحمل المفتاح نفسه (بعض الخوادم تعيده في رسالة الخطأ)، أو
// ترويسة مصادقة. لا يُحفظ نصّ خام من مزوّد إلا بعد هذا التنقيح، ولا يعبر الحدّ أبدًا.

/// الكلمات التي يُحذف ما بعدها من قيمة.
const KEY_MARKERS: &[&str] = &[
    "api_key",
    "api-key",
    "apikey",
    "x-api-key",
    "x-goog-api-key",
    "authorization",
    "bearer",
    "token",
    "secret",
    "password",
    "key=",
];

/// أطول نصّ تشخيصي يُحتفظ به.
pub const MAX_DIAGNOSTIC_CHARS: usize = 512;

/// هل يبدو هذا المقطع قيمة سرية؟ مقاطع طويلة بلا مسافات بحروف وأرقام مختلطة.
fn looks_like_secret(token: &str) -> bool {
    let body = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    if body.len() < 20 {
        return false;
    }
    let has_digit = body.chars().any(|c| c.is_ascii_digit());
    let has_alpha = body.chars().any(|c| c.is_ascii_alphabetic());
    let charset_ok = body.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    has_digit && has_alpha && charset_ok
}

/// ينقّح نصًّا: يحذف القيم التالية لعلامات المصادقة، وكل مقطع يشبه مفتاحًا،
/// ويقصّ الطول. الناتج صالح للتشخيص على جانب المضيف فقط.
pub fn redact(text: &str) -> String {
    let mut out = Vec::new();
    let mut hide_next = false;
    for token in text.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        if hide_next {
            out.push("[REDACTED]".to_string());
            hide_next = false;
            continue;
        }
        if let Some(marker) = KEY_MARKERS.iter().find(|m| lower.contains(*m)) {
            // «key=VALUE» أو «"api_key":"VALUE"» في مقطع واحد: يُحذف المقطع كله.
            if lower.len() > marker.len() + 2 && (lower.contains('=') || lower.contains(':')) {
                out.push("[REDACTED]".to_string());
            } else {
                out.push(token.to_string());
                hide_next = true;
            }
            continue;
        }
        if looks_like_secret(token) {
            out.push("[REDACTED]".to_string());
            continue;
        }
        out.push(token.chars().filter(|c| !c.is_control()).collect());
    }
    let joined = out.join(" ");
    joined.chars().take(MAX_DIAGNOSTIC_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_values_are_removed() {
        let text = redact("Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456");
        assert!(!text.contains("sk-abc"), "{text}");
    }

    #[test]
    fn key_like_tokens_are_removed() {
        let text = redact("invalid key AIzaSyA1234567890abcdefghijklmnop supplied");
        assert!(!text.contains("AIzaSy"), "{text}");
        assert!(text.contains("invalid"));
    }

    #[test]
    fn inline_assignments_are_removed() {
        let text = redact(r#"{"api_key":"abc123secretvalue"} password=hunter2hunter2"#);
        assert!(!text.contains("abc123secret"), "{text}");
        assert!(!text.contains("hunter2"), "{text}");
    }

    #[test]
    fn output_is_bounded_and_control_free() {
        let text = redact(&format!("a\u{7}b {}", "word ".repeat(400)));
        assert!(text.chars().count() <= MAX_DIAGNOSTIC_CHARS);
        assert!(!text.contains('\u{7}'));
    }
}
