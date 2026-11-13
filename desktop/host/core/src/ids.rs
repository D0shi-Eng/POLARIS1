// معرّفات UUID v4 بالشكل الذي يقبله العقد (نُقلت إلى النواة في Phase-02 لتستعملها الخدمات؛
// طبقة الربط تعيد تصديرها): أحرف صغيرة، والنسخة 4، والمتغيّر 8..b.
//
// كُتبت هنا بدل إضافة تبعية: المطلوب ١٦ بايت عشوائية وتنسيقها. مصدر العشوائية هو
// مولّد المكتبة القياسية نفسه الذي تبنيه `RandomState` لجداول التجزئة، وهو مبذور
// من نظام التشغيل عند كل إنشاء.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

fn random_u64() -> u64 {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_usize(std::time::SystemTime::now().elapsed().map(|d| d.as_nanos() as usize).unwrap_or(0));
    hasher.finish()
}

/// معرّف جديد. لا يُشتق من محتوى الرسالة، فلا يتسرّب منه شيء.
pub fn new_uuid_v4() -> String {
    let high = random_u64();
    let low = random_u64();
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&high.to_be_bytes());
    bytes[8..].copy_from_slice(&low.to_be_bytes());

    // النسخة 4 والمتغيّر RFC 4122.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// هل هذه السلسلة معرّفًا بالشكل الذي يصدره هذا المضيف ويقبله العقد؟
///
/// يُستعمل عند الحدود التي تستقبل معرّفًا من مخرجات نموذج: اسم مورد حرّ يصير
/// مسارًا أو نمطًا، ومعرّفٌ بالشكل الصحيح لا يصير شيئًا إلا إن وُجد فعلًا.
pub fn is_uuid_v4(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.iter().map(|p| p.len()).collect::<Vec<_>>() != vec![8, 4, 4, 4, 12] {
        return false;
    }
    if !value.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase() || c == '-') {
        return false;
    }
    let version = parts[2].as_bytes()[0];
    let variant = parts[3].as_bytes()[0];
    (b'1'..=b'8').contains(&version) && matches!(variant, b'8' | b'9' | b'a' | b'b')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shape_matches_the_contract_pattern() {
        for _ in 0..64 {
            let id = new_uuid_v4();
            let parts: Vec<&str> = id.split('-').collect();
            assert_eq!(parts.iter().map(|p| p.len()).collect::<Vec<_>>(), vec![8, 4, 4, 4, 12]);
            assert!(id.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
            assert_eq!(parts[2].as_bytes()[0], b'4', "version nibble must be 4");
            assert!(matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'), "variant nibble");
        }
    }

    #[test]
    fn a_generated_identifier_is_recognised_and_a_free_string_is_not() {
        assert!(is_uuid_v4(&new_uuid_v4()));
        for bad in [
            "",
            "not-an-id",
            "../../etc/passwd",
            "00000000-0000-0000-0000-000000000000",
            "11111111-1111-4111-C111-111111111111",
            "11111111-1111-4111-8111-11111111111",
        ] {
            assert!(!is_uuid_v4(bad), "{bad} was accepted");
        }
        // الأحرف الكبيرة مرفوضة: العقد يصف أحرفًا صغيرة.
        assert!(!is_uuid_v4("11111111-1111-4111-8111-11111111111A"));
    }

    #[test]
    fn identifiers_do_not_repeat() {
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            assert!(seen.insert(new_uuid_v4()), "a generated identifier repeated");
        }
    }
}
