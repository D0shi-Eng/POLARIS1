// القيمة السرية: تُحمَل في الذاكرة فقط، ولا تُسلسَل، ولا تُطبع.
//
// النوع لا ينفّذ `Serialize` ولا `Display`، و`Debug` يطبع علامة ثابتة. بذلك لا
// يستطيع خطأ برمجي عابر أن يضع المفتاح في سجل أو ردّ IPC: المترجم يرفض ذلك قبل
// أن يصل إلى التشغيل. والذاكرة تُصفَّر عند الإسقاط (أفضل جهد، عبر `zeroize`).

use std::fmt;

use zeroize::Zeroize;

pub struct SecretValue {
    bytes: Vec<u8>,
}

impl SecretValue {
    /// يبني قيمة سرية من نصّ. القيمة الفارغة ليست سرًّا صالحًا.
    pub fn new(text: String) -> Option<Self> {
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.len() > 4096 {
            let mut discard = text;
            discard.zeroize();
            return None;
        }
        let bytes = trimmed.as_bytes().to_vec();
        let mut discard = text;
        discard.zeroize();
        Some(Self { bytes })
    }

    /// يكشف القيمة لبناء ترويسة طلب فقط. لا يُخزَّن الناتج.
    pub fn expose(&self) -> &str {
        std::str::from_utf8(&self.bytes).unwrap_or("")
    }

    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }
}

impl Drop for SecretValue {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

impl fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretValue(<redacted>)")
    }
}

/// مرجع سرّ: ما يراه أي طرف غير موثوق بدل القيمة.
pub fn secret_reference(provider_id: &str) -> String {
    format!("secret://providers/{provider_id}/default")
}

/// اسم الهدف في مخزن بيانات الاعتماد.
pub fn credential_target(provider_id: &str) -> String {
    format!("POLARIS/provider/{provider_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_prints_the_value() {
        let secret = SecretValue::new("sk-test-value-123".to_string()).unwrap();
        assert_eq!(format!("{secret:?}"), "SecretValue(<redacted>)");
        assert_eq!(secret.expose(), "sk-test-value-123");
    }

    #[test]
    fn blank_values_are_refused() {
        assert!(SecretValue::new("   ".to_string()).is_none());
        assert!(SecretValue::new("x".repeat(5000)).is_none());
    }

    #[test]
    fn references_carry_no_value() {
        assert_eq!(secret_reference("p"), "secret://providers/p/default");
        assert_eq!(credential_target("p"), "POLARIS/provider/p");
    }
}
