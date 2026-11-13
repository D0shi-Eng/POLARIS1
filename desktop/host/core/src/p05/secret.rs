// كشف ما يشبه السرّ في نصّ سيُحفظ أو يُكتب.
//
// القاعدة (البند 11/26): الذاكرة لا تحفظ مفاتيح ولا كلمات مرور ولا رموز جلسة،
// والمتصفّح لا يكتب شيئًا منها في حقل. الكاشف محافظ عمدًا: نصٌّ يشبه سرًّا يُرفض
// ولا يُنقّح ثم يُحفظ، لأن التنقيح يترك ما حوله — والسياق حول السرّ كثيرًا ما يكشفه.

/// علامات تسبق قيمة سرّية عادةً. مطابقة بلا حساسية لحالة الأحرف.
const MARKERS: &[&str] = &[
    "api_key",
    "api-key",
    "apikey",
    "x-api-key",
    "authorization:",
    "bearer ",
    "password",
    "passwd",
    "secret_key",
    "client_secret",
    "access_token",
    "refresh_token",
    "session_token",
    "private key",
    "كلمة المرور",
    "كلمة السر",
];

/// بادئات معروفة لمفاتيح مزوّدين ومنصّات.
const PREFIXES: &[&str] = &["sk-", "sk_live_", "pk_live_", "ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "akia", "aiza", "glpat-"];

/// لماذا عُدّ النصّ شبيهًا بسرّ. مغلق.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretFinding {
    Marker,
    KnownPrefix,
    PrivateKeyBlock,
    HighEntropyToken,
}

impl SecretFinding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Marker => "SECRET_MARKER",
            Self::KnownPrefix => "SECRET_PREFIX",
            Self::PrivateKeyBlock => "PRIVATE_KEY_BLOCK",
            Self::HighEntropyToken => "HIGH_ENTROPY_TOKEN",
        }
    }
}

/// مقطع طويل بلا مسافات يمزج حروفًا وأرقامًا: شكل المفتاح والرمز.
fn looks_like_token(token: &str) -> bool {
    let body = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    if body.len() < 24 {
        return false;
    }
    let digits = body.chars().filter(char::is_ascii_digit).count();
    let letters = body.chars().filter(char::is_ascii_alphabetic).count();
    let charset_ok = body.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | '+' | '='));
    // بصمة SHA-256 سداسية تُكتب في الذاكرة والأدلّة عمدًا، وليست سرًّا: أحرفها
    // a-f وحدها. المفتاح الحقيقي يتجاوز هذه الأبجدية.
    let hex_only = body.chars().all(|c| c.is_ascii_hexdigit());
    charset_ok && digits >= 3 && letters >= 3 && !hex_only
}

/// أول ما يجعل النصّ شبيهًا بسرّ، أو `None`.
pub fn find(text: &str) -> Option<SecretFinding> {
    let lower = text.to_lowercase();
    if lower.contains("-----begin") && lower.contains("key-----") {
        return Some(SecretFinding::PrivateKeyBlock);
    }
    if MARKERS.iter().any(|m| lower.contains(m)) {
        return Some(SecretFinding::Marker);
    }
    for token in lower.split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';' | '(' | ')' | '<' | '>')) {
        let trimmed = token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
        if PREFIXES.iter().any(|p| trimmed.starts_with(p) && trimmed.len() >= p.len() + 12) {
            return Some(SecretFinding::KnownPrefix);
        }
        if looks_like_token(token) {
            return Some(SecretFinding::HighEntropyToken);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_passwords_and_tokens_are_found() {
        let key = ["sk", "-", "proj", "abcdefghijklmnop1234"].concat();
        assert_eq!(find(&format!("the key is {key}")), Some(SecretFinding::KnownPrefix));
        assert_eq!(find("my password is hunter2"), Some(SecretFinding::Marker));
        assert_eq!(find("كلمة المرور هي ١٢٣"), Some(SecretFinding::Marker));
        assert_eq!(find("-----BEGIN RSA PRIVATE KEY----- abc"), Some(SecretFinding::PrivateKeyBlock));
        let token = ["Zx9Qm2Lp", "8Rt4Vw6Y", "b1Nc3Hd5Fg7"].concat();
        assert_eq!(find(&format!("token {token}")), Some(SecretFinding::HighEntropyToken));
    }

    #[test]
    fn ordinary_text_and_digests_are_not_secrets() {
        assert_eq!(find("the fixture page title is POLARIS Fixture Normal"), None);
        assert_eq!(find("عنوان الصفحة هو صفحة الاختبار"), None);
        let digest = crate::digest::sha256_hex(b"x");
        assert_eq!(find(&format!("evidence digest {digest}")), None, "a SHA-256 digest was mistaken for a key");
    }
}
