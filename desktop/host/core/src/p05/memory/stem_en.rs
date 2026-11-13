// مجذّع إنجليزي خفيف على طريقة Porter، منقول بسلوكه من agentmemory (`src/state/stemmer.ts`، الإيداع
// 70517d2bdf302a0aed11ca470151ee854e74c678، Copyright rohitg00 ومساهمو agentmemory، رخصة Apache-2.0؛ انظر THIRD_PARTY_NOTICES.md).
// أُعيدت كتابته بلغة Rust وخطواته وترتيب جداوله كما في الأصل، فيعطي الجذر نفسه للكلمة نفسها. يُستدعى لكلمة بحروف لاتينية صغيرة فقط.

const STEP2: [(&str, &str); 22] = [
    ("ational", "ate"),
    ("tional", "tion"),
    ("enci", "ence"),
    ("anci", "ance"),
    ("izer", "ize"),
    ("iser", "ise"),
    ("abli", "able"),
    ("alli", "al"),
    ("entli", "ent"),
    ("eli", "e"),
    ("ousli", "ous"),
    ("ization", "ize"),
    ("isation", "ise"),
    ("ation", "ate"),
    ("ator", "ate"),
    ("alism", "al"),
    ("iveness", "ive"),
    ("fulness", "ful"),
    ("ousness", "ous"),
    ("aliti", "al"),
    ("iviti", "ive"),
    ("biliti", "ble"),
];

const STEP3: [(&str, &str); 8] = [("icate", "ic"), ("ative", ""), ("alize", "al"), ("alise", "al"), ("iciti", "ic"), ("ical", "ic"), ("ful", ""), ("ness", "")];

/// لواحق الخطوة الرابعة بترتيب المطابقة في الأصل: الأطول أولًا حيث يتداخل بعضها في بعض.
const STEP4: [&str; 20] = ["ement", "ment", "tion", "sion", "ance", "ence", "able", "ible", "ism", "ate", "iti", "ous", "ive", "ize", "ise", "ant", "ent", "al", "er", "ic"];

fn vowel(c: u8) -> bool {
    matches!(c, b'a' | b'e' | b'i' | b'o' | b'u')
}

fn has_vowel(s: &[u8]) -> bool {
    s.iter().any(|c| vowel(*c))
}

/// عدد تتابعات «حرف علّة ثم ساكن»، و`y` تُعدّ حرف علّة هنا كما في الأصل.
fn measure(s: &[u8]) -> usize {
    let mut count = 0;
    let mut previous_vowel = false;
    for c in s {
        let v = vowel(*c) || *c == b'y';
        if previous_vowel && !v {
            count += 1;
        }
        previous_vowel = v;
    }
    count
}

fn ends_double_consonant(s: &[u8]) -> bool {
    s.len() >= 2 && s[s.len() - 1] == s[s.len() - 2] && !vowel(s[s.len() - 1])
}

fn ends_cvc(s: &[u8]) -> bool {
    if s.len() < 3 {
        return false;
    }
    let (c1, v, c2) = (s[s.len() - 3], s[s.len() - 2], s[s.len() - 1]);
    !vowel(c1) && vowel(v) && !matches!(c2, b'a' | b'e' | b'i' | b'o' | b'u' | b'w' | b'x' | b'y')
}

/// بعد قصّ `ed` أو `ing`: يُعيد `e` أو يُسقط الحرف المضاعف كما في الأصل.
fn repair_after_ed_ing(mut w: Vec<u8>) -> Vec<u8> {
    if w.ends_with(b"at") || w.ends_with(b"bl") || w.ends_with(b"iz") {
        w.push(b'e');
    } else if ends_double_consonant(&w) && !matches!(w[w.len() - 1], b'l' | b's' | b'z') {
        w.pop();
    } else if measure(&w) == 1 && ends_cvc(&w) {
        w.push(b'e');
    }
    w
}

fn replace_first(w: &mut Vec<u8>, table: &[(&str, &str)]) {
    if let Some((suffix, replacement)) = table.iter().find(|(s, _)| w.ends_with(s.as_bytes())) {
        let base = w.len() - suffix.len();
        if measure(&w[..base]) > 0 {
            w.truncate(base);
            w.extend_from_slice(replacement.as_bytes());
        }
    }
}

/// جذر الكلمة. كلمة بغير حروف لاتينية صغيرة تعود كما هي.
pub fn stem(word: &str) -> String {
    if word.len() <= 2 || !word.bytes().all(|c| c.is_ascii_lowercase()) {
        return word.to_string();
    }
    let mut w = word.as_bytes().to_vec();

    if w.ends_with(b"sses") || w.ends_with(b"ies") {
        w.truncate(w.len() - 2);
    } else if !w.ends_with(b"ss") && w.ends_with(b"s") {
        w.pop();
    }

    if w.ends_with(b"eed") {
        if measure(&w[..w.len() - 3]) > 0 {
            w.pop();
        }
    } else if w.ends_with(b"ed") && has_vowel(&w[..w.len() - 2]) {
        w.truncate(w.len() - 2);
        w = repair_after_ed_ing(w);
    } else if w.ends_with(b"ing") && has_vowel(&w[..w.len() - 3]) {
        w.truncate(w.len() - 3);
        w = repair_after_ed_ing(w);
    }

    if w.ends_with(b"y") && has_vowel(&w[..w.len() - 1]) {
        let last = w.len() - 1;
        w[last] = b'i';
    }

    replace_first(&mut w, &STEP2);
    replace_first(&mut w, &STEP3);

    if let Some(suffix) = STEP4.iter().find(|s| w.ends_with(s.as_bytes())) {
        let base = w.len() - suffix.len();
        if measure(&w[..base]) > 1 {
            w.truncate(base);
        }
    } else if w.ends_with(b"ou") && measure(&w[..w.len() - 2]) > 1 {
        w.truncate(w.len() - 2);
    }

    if w.ends_with(b"e") {
        let base = &w[..w.len() - 1];
        if measure(base) > 1 || (measure(base) == 1 && !ends_cvc(base)) {
            w.pop();
        }
    }

    if ends_double_consonant(&w) && w.ends_with(b"l") && measure(&w[..w.len() - 1]) > 1 {
        w.pop();
    }

    String::from_utf8(w).unwrap_or_else(|_| word.to_string())
}

#[cfg(test)]
mod tests {
    use super::stem;

    #[test]
    fn inflections_share_a_stem() {
        for (a, b) in [("payments", "payment"), ("appointments", "appointment"), ("reminders", "reminder"), ("optimization", "optimisation"), ("companies", "company")] {
            assert_eq!(stem(a), stem(b), "{a} / {b}");
        }
    }

    #[test]
    fn short_and_non_latin_words_are_left_alone() {
        assert_eq!(stem("is"), "is");
        assert_eq!(stem("8812"), "8812");
        assert_eq!(stem("\u{0646}\u{0648}\u{0631}"), "\u{0646}\u{0648}\u{0631}");
    }
}
