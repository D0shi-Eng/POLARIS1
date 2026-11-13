// تحليل النصّ إلى مصطلحات للاسترجاع المعجمي: تطبيع، ثم طيّ العربية، ثم حذف الكلمات الوظيفية، ثم التجذيع.
//
// التجذيع العربي خفيف (قصّ سوابق ولواحق شائعة على منهج Light10، لا استخراج جذر): مكتوب هنا لأن agentmemory لا يجذّع العربية. يُطبَّق
// على الطلب والمدخل معًا، فالمهمّ اتّساقه لا صحّته اللغوية. الإنجليزي من `stem_en` (منقول من agentmemory).

use std::collections::BTreeSet;

use super::model::normalise;
use super::stem_en;

/// CP-08-1: كلمات وظيفية لا تدلّ على صلة. قِيس (مجموعة PHASE-08) أن «what» و«the» و«who» كانت تُدخل كل مدخل يحويها،
/// فبلغت دقّة الاسترجاع 0.171. تُقارن بعد الطيّ نفسه الذي تمرّ به كلمات الطلب.
const STOPWORDS: [&str; 58] = [
    "the", "and", "what", "who", "whom", "which", "where", "when", "why", "how", "are", "was", "were", "for", "with", "this", "that",
    "these", "those", "our", "you", "your", "does", "did", "have", "has", "had", "can", "could", "from", "into", "about", "there",
    "their", "they", "them", "any", "all", "much", "many", "some", "will", "would", "should", "not",
    "ماذا", "متى", "أين", "كيف", "هذا", "هذه", "ذلك", "التي", "الذي", "كان", "على", "إلى", "لماذا",
];

/// كلمة عربية بصيغة واحدة للمقارنة (`crate::text`)، وبلا «ال» التعريف. قِيس 2026-10-01 أن «الرياض» و«رياض» لم
/// تتطابقا في الاسترجاع.
pub fn fold(word: &str) -> String {
    let folded = crate::text::fold(word);
    let stripped = folded.strip_prefix("\u{0627}\u{0644}").filter(|rest| rest.chars().count() >= 2);
    stripped.map(str::to_string).unwrap_or(folded)
}

fn stopword(token: &str) -> bool {
    static FOLDED: std::sync::LazyLock<BTreeSet<String>> = std::sync::LazyLock::new(|| STOPWORDS.iter().map(|w| fold(w)).collect());
    FOLDED.contains(token)
}

fn arabic(word: &str) -> bool {
    word.chars().any(|c| ('\u{0621}'..='\u{064A}').contains(&c))
}

/// سوابق التعريف مع حرف ملتصق (بعد الطيّ): «وال» و«بال» و«كال» و«فال» و«لل». «ال» وحدها قصّها `fold`.
const ARABIC_ARTICLE_PREFIXES: [&str; 5] = ["\u{0648}\u{0627}\u{0644}", "\u{0628}\u{0627}\u{0644}", "\u{0643}\u{0627}\u{0644}", "\u{0641}\u{0627}\u{0644}", "\u{0644}\u{0644}"];

/// لواحق تُقصّ بالترتيب مرّة لكلٍّ منها (بعد الطيّ، فالتاء المربوطة هاء): «ها» «ان» «ات» «ون» «ين» «يه» «ه» «ي».
const ARABIC_SUFFIXES: [&str; 8] = [
    "\u{0647}\u{0627}",
    "\u{0627}\u{0646}",
    "\u{0627}\u{062A}",
    "\u{0648}\u{0646}",
    "\u{064A}\u{0646}",
    "\u{064A}\u{0647}",
    "\u{0647}",
    "\u{064A}",
];

/// تجذيع عربي خفيف لكلمة مطويّة: «و» العطف، ثم أداة تعريف ملتصقة بحرف، ثم اللواحق. لا يبقى أقلّ من حرفين.
pub fn arabic_light_stem(word: &str) -> String {
    let mut w: Vec<char> = word.chars().collect();
    if w.len() >= 4 && w[0] == '\u{0648}' {
        w.remove(0);
    }
    for prefix in ARABIC_ARTICLE_PREFIXES {
        let p: Vec<char> = prefix.chars().collect();
        if w.starts_with(&p) && w.len() - p.len() >= 2 {
            w.drain(..p.len());
            break;
        }
    }
    if w.len() >= 4 && w.starts_with(&['\u{0627}', '\u{0644}']) {
        w.drain(..2);
    }
    for suffix in ARABIC_SUFFIXES {
        let s: Vec<char> = suffix.chars().collect();
        if w.len() >= s.len() + 2 && w.ends_with(&s) {
            w.truncate(w.len() - s.len());
        }
    }
    w.into_iter().collect()
}

fn stem(token: &str) -> String {
    if arabic(token) { arabic_light_stem(token) } else { stem_en::stem(token) }
}

/// مصطلحات النصّ بتكرارها (لحساب تكرار المصطلح في BM25). الكلمة القصيرة (أقلّ من ثلاثة محارف) والوظيفية تُسقطان قبل التجذيع.
pub fn terms(text: &str) -> Vec<String> {
    normalise(text)
        .split(|c: char| !c.is_alphanumeric())
        .map(fold)
        .filter(|t| t.chars().count() >= 3 && !stopword(t))
        .map(|t| stem(&t))
        .collect()
}

/// مصطلحات بلا تكرار، بترتيب ثابت.
pub fn term_set(text: &str) -> BTreeSet<String> {
    terms(text).into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arabic_spellings_and_the_definite_article_meet() {
        // «الرياض» و«رياض»، و«أفضّل» بالهمزة والتشكيل و«افضل» بدونهما، و«مدينة» و«مدينه».
        assert_eq!(fold("\u{0627}\u{0644}\u{0631}\u{064A}\u{0627}\u{0636}"), fold("\u{0631}\u{064A}\u{0627}\u{0636}"));
        assert_eq!(fold("\u{0623}\u{0641}\u{0636}\u{0651}\u{0644}"), fold("\u{0627}\u{0641}\u{0636}\u{0644}"));
        assert_eq!(fold("\u{0645}\u{062F}\u{064A}\u{0646}\u{0629}"), fold("\u{0645}\u{062F}\u{064A}\u{0646}\u{0647}"));
        // كلمة قصيرة تبدأ بـ«ال» لا تُقصّ إلى حرف واحد.
        assert_eq!(fold("\u{0627}\u{0644}\u{0645}"), "\u{0627}\u{0644}\u{0645}");
    }

    #[test]
    fn attached_prefixes_and_suffixes_are_cut_the_same_way_on_both_sides() {
        // «بالتقسيط» = «التقسيط»، و«قررناه» = «قررنا»، و«المسجلين» = «مسجل»، و«والمشروع» = «مشروع».
        let same = |a: &str, b: &str| assert_eq!(term_set(a), term_set(b), "{a} / {b}");
        same("\u{0628}\u{0627}\u{0644}\u{062A}\u{0642}\u{0633}\u{064A}\u{0637}", "\u{0627}\u{0644}\u{062A}\u{0642}\u{0633}\u{064A}\u{0637}");
        same("\u{0642}\u{0631}\u{0631}\u{0646}\u{0627}\u{0647}", "\u{0642}\u{0631}\u{0631}\u{0646}\u{0627}");
        same("\u{0627}\u{0644}\u{0645}\u{0633}\u{062C}\u{0644}\u{064A}\u{0646}", "\u{0645}\u{0633}\u{062C}\u{0644}");
        same("\u{0648}\u{0627}\u{0644}\u{0645}\u{0634}\u{0631}\u{0648}\u{0639}", "\u{0645}\u{0634}\u{0631}\u{0648}\u{0639}");
    }

    #[test]
    fn stopwords_and_short_words_carry_no_term() {
        assert!(terms("what is the").is_empty());
        assert_eq!(terms("Payments payments"), vec!["payment".to_string(), "payment".to_string()]);
    }
}
