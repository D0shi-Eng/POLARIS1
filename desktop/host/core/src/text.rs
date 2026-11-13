// توحيد النصّ العربي للمقارنة: يُستعمل في استرجاع الذاكرة والبحث في المحادثات (مصدر واحد للقاعدة).
//
// الهمزات على الألف ألفٌ، والتاء المربوطة هاء، والألف المقصورة ياء، وبلا تشكيل ولا تطويل، وبحروف صغيرة. لا يُغيَّر
// شيء آخر: النصّ المخزَّن لا يمسّه التوحيد، والبصمات (`content_digest`) تُحسب بقاعدتها هي.

/// محرف بصيغته الموحّدة، أو لا شيء إن كان تشكيلًا أو تطويلًا يُسقط.
pub fn fold_char(c: char) -> Option<char> {
    match c {
        '\u{064B}'..='\u{0652}' | '\u{0640}' => None,
        '\u{0623}' | '\u{0625}' | '\u{0622}' => Some('\u{0627}'),
        '\u{0629}' => Some('\u{0647}'),
        '\u{0649}' => Some('\u{064A}'),
        other => Some(other.to_lowercase().next().unwrap_or(other)),
    }
}

/// نصّ موحّد، ومعه موضع كل محرف منه في النصّ الأصلي (بعدد المحارف): به يُقتطف المقطع الأصلي حول المطابقة.
pub fn fold_with_positions(text: &str) -> (Vec<char>, Vec<usize>) {
    let mut folded = Vec::new();
    let mut positions = Vec::new();
    for (i, c) in text.chars().enumerate() {
        if let Some(f) = fold_char(c) {
            folded.push(f);
            positions.push(i);
        }
    }
    (folded, positions)
}

pub fn fold(text: &str) -> String {
    text.chars().filter_map(fold_char).collect()
}

/// موضع أول مطابقة لـ`needle` (موحَّدًا) في `haystack`، بعدد محارف النصّ الأصلي. بحث بسيط بلا فهرس: النصوص هنا
/// محدودة (رسائل وأجوبة محادثات جهاز واحد).
pub fn find_folded(haystack: &str, needle: &str) -> Option<usize> {
    let needle: Vec<char> = needle.chars().filter_map(fold_char).collect();
    if needle.is_empty() {
        return None;
    }
    let (folded, positions) = fold_with_positions(haystack);
    folded.windows(needle.len()).position(|w| w == needle.as_slice()).map(|i| positions[i])
}

/// مقطع من النصّ الأصلي حول موضع، بحدود محارف، على سطر واحد، بعلامة حذف حيث قُصّ.
pub fn snippet_around(text: &str, at: usize, width: usize) -> String {
    let chars: Vec<char> = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let start = at.saturating_sub(width / 3);
    let end = (start + width).min(chars.len());
    let mut out: String = chars[start..end].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spelling_variants_meet_and_the_snippet_comes_from_the_original_text() {
        // «مدينة» بتاء مربوطة وتشكيل، والبحث بـ«مدينه».
        let text = "\u{0647}\u{0630}\u{0647} \u{0645}\u{064E}\u{062F}\u{0650}\u{064A}\u{0646}\u{0629} \u{0627}\u{0644}\u{0631}\u{064A}\u{0627}\u{0636}";
        let at = find_folded(text, "\u{0645}\u{062F}\u{064A}\u{0646}\u{0647}").expect("no match");
        assert_eq!(at, 4);
        assert!(snippet_around(text, at, 40).contains("\u{0645}\u{064E}\u{062F}"), "the snippet lost the original spelling");
        assert_eq!(find_folded("Tokyo is the capital", "CAPITAL"), Some(13));
        assert_eq!(find_folded("abc", ""), None);
        assert!(snippet_around(&"x".repeat(300), 150, 40).starts_with('…'));
    }
}
