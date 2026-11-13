// الوكلاء المتخصّصون: خبرة مجال فوق الدور.
//
// الدور (agent.rs) يصف موقع الوكيل في سير العمل — مخطّط، بانٍ، مراجع — ولا يحمل خبرة. المتخصّص
// يصف كيف يعمل خبير مجال بعينه: منهجه، وما يتحقّق منه قبل أن يسلّم. هو نصّ تعليمات وحدود أنواع
// عُقد، لا سلطة: لا يمنح أداة ولا إذنًا ولا يغيّر الدور (البند 19). والنموذج لا يختار هويته؛ يقترح
// معرّفًا من قائمة قدّمها له زمن التشغيل، وزمن التشغيل يتحقّق منه أو يختار هو.
//
// ما لا يدّعيه هذا الملف: ذكاء الوكيل من النموذج الذي يشغّله المستخدم. التعليمات المتخصّصة توجّه
// المنهج وتضع معايير تحقّق، ولا ترفع قدرة النموذج.
//
// الكتالوج بيانات مضمَّنة في الثنائي (`specialists/*.json`، ملف لكل مجال)، يُتحقَّق منها كلها عند
// التحميل وفي الاختبارات: معرّفات فريدة، ولغتان كاملتان، وحدود أطوال، وأنواع عُقد صالحة.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use super::task::TaskType;

/// ملفات المجالات بالترتيب الذي تُعرض به.
const SOURCES: &[&str] = &[
    include_str!("specialists/software.json"),
    include_str!("specialists/web-mobile.json"),
    include_str!("specialists/data-ai.json"),
    include_str!("specialists/security.json"),
    include_str!("specialists/infrastructure.json"),
    include_str!("specialists/finance.json"),
    include_str!("specialists/business.json"),
    include_str!("specialists/marketing-sales.json"),
    include_str!("specialists/legal.json"),
    include_str!("specialists/health.json"),
    include_str!("specialists/education.json"),
    include_str!("specialists/writing.json"),
    include_str!("specialists/design-media.json"),
    include_str!("specialists/research.json"),
    include_str!("specialists/engineering.json"),
    include_str!("specialists/science-math.json"),
    include_str!("specialists/people-operations.json"),
    include_str!("specialists/product-project.json"),
    include_str!("specialists/languages.json"),
    include_str!("specialists/everyday.json"),
    // مكتبة المهارات (مكافئات مهارات Manus، 2026-11-13): مصدر واحد تقرؤه الواجهة والمضيف معًا.
    include_str!("../../../../renderer/src/p04/skill-library.json"),
];

/// مجال مكتبة المهارات. متخصّصوه مهارات تُعرض في معرض المهارات ويمكن تعطيلها.
pub const SKILLS_DOMAIN: &str = "skills";

/// مهارات المكتبة التي عطّلها المستخدم: لا يختارها التوجيه ولا تُعرض على المخطّط.
fn disabled_skills() -> &'static std::sync::RwLock<BTreeSet<String>> {
    static DISABLED: OnceLock<std::sync::RwLock<BTreeSet<String>>> = OnceLock::new();
    DISABLED.get_or_init(|| std::sync::RwLock::new(BTreeSet::new()))
}

/// يضبط تفعيل مهارة مكتبة بمعرّف متخصّصها (`skills.<slug>`). معرّف من مجال آخر يُتجاهل.
pub fn set_library_skill_enabled(specialist_id: &str, enabled: bool) {
    if !specialist_id.starts_with("skills.") {
        return;
    }
    if let Ok(mut set) = disabled_skills().write() {
        if enabled {
            set.remove(specialist_id);
        } else {
            set.insert(specialist_id.to_string());
        }
    }
}

fn is_disabled(specialist_id: &str) -> bool {
    disabled_skills().read().map(|set| set.contains(specialist_id)).unwrap_or(false)
}

/// حدود المحتوى: تُفحص عند التحميل، فلا يدخل الموجّه نصّ أطول مما صُمّم له.
const MAX_NAME: usize = 60;
const MAX_SUMMARY: usize = 220;
const MIN_EXPERTISE: usize = 160;
const MAX_EXPERTISE: usize = 1_400;
const MAX_CHECK: usize = 200;
/// أقصى عدد يُعرض على المخطّط ليختار منه: قائمة أطول تُضيّع نموذجًا محليًّا.
pub const SHORTLIST: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Domain {
    pub domain_id: String,
    pub name_ar: String,
    pub name_en: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Specialist {
    /// `<domain>.<slug>`، يصدره الكتالوج لا النموذج.
    pub specialist_id: String,
    pub domain_id: String,
    pub name_ar: String,
    pub name_en: String,
    pub summary_ar: String,
    pub summary_en: String,
    /// منهج العمل بالإنجليزية، للنموذج.
    #[serde(skip_serializing)]
    pub expertise: String,
    /// ما يتحقّق منه قبل أن يسلّم، بالإنجليزية للنموذج.
    #[serde(skip_serializing)]
    pub checks: Vec<String>,
    /// كلمات يُعرف بها الطلب، بالعربية والإنجليزية.
    #[serde(skip_serializing)]
    pub keywords: Vec<String>,
    pub task_types: Vec<TaskType>,
}

impl Specialist {
    /// تعليمات المتخصّص كما تدخل الموجّه، بعد تعليمة الدور.
    pub fn brief(&self) -> String {
        let mut out = format!("You are working as the {} specialist: {}\nHow this specialist works: {}\n", self.name_en, self.summary_en, self.expertise);
        out.push_str("Before you report, make sure that:\n");
        for check in &self.checks {
            out.push_str("- ");
            out.push_str(check);
            out.push('\n');
        }
        out
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DomainFile {
    domain: String,
    name_ar: String,
    name_en: String,
    specialists: Vec<SpecialistEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SpecialistEntry {
    slug: String,
    name_ar: String,
    name_en: String,
    summary_ar: String,
    summary_en: String,
    expertise: String,
    checks: Vec<String>,
    keywords: Vec<String>,
    task_types: Vec<TaskType>,
    /// فئة العرض في معرض المهارات (مكتبة المهارات وحدها). لا أثر لها في التوجيه.
    #[serde(default)]
    #[allow(dead_code)]
    category: Option<String>,
    /// عنوان الغلاف المعروض على البطاقة.
    #[serde(default)]
    #[allow(dead_code)]
    cover: Option<String>,
}

pub struct SpecialistCatalog {
    domains: Vec<Domain>,
    specialists: Vec<Specialist>,
    /// كلمات كل متخصّص بعد التطبيع: كل كلمة مفتاحية قائمة رموز يجب أن تحضر كلها.
    index: Vec<Vec<Vec<String>>>,
}

fn is_slug(text: &str) -> bool {
    !text.is_empty() && text.len() <= 48 && text.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !text.starts_with('-') && !text.ends_with('-')
}

fn bounded(label: &str, id: &str, text: &str, min: usize, max: usize) -> Result<(), String> {
    let n = text.chars().count();
    if text.trim() != text || n < min || n > max || text.chars().any(|c| c.is_control() && c != '\n') {
        return Err(format!("{id}: {label} must be trimmed text of {min}..={max} characters (has {n})"));
    }
    Ok(())
}

fn has_arabic(text: &str) -> bool {
    text.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c))
}

impl SpecialistCatalog {
    /// الكتالوج المضمَّن. خطأ في بياناته عيب بناء تكشفه الاختبارات؛ وقت التشغيل لا ينهار بسببه،
    /// بل يعمل بلا متخصّصين كما كان قبلهم.
    pub fn builtin() -> &'static SpecialistCatalog {
        static CATALOG: OnceLock<SpecialistCatalog> = OnceLock::new();
        CATALOG.get_or_init(|| Self::parse(SOURCES).unwrap_or_else(|_| Self { domains: Vec::new(), specialists: Vec::new(), index: Vec::new() }))
    }

    /// يحلّل ملفات المجالات ويتحقّق من كل سجل. أول مخالفة تُرفض باسمها.
    pub fn parse(sources: &[&str]) -> Result<Self, String> {
        let mut domains = Vec::new();
        let mut specialists = Vec::new();
        let mut ids = BTreeSet::new();
        for source in sources {
            let file: DomainFile = serde_json::from_str(source).map_err(|e| format!("a specialist file does not parse: {e}"))?;
            if !is_slug(&file.domain) || domains.iter().any(|d: &Domain| d.domain_id == file.domain) {
                return Err(format!("domain id {} is not a unique slug", file.domain));
            }
            bounded("name_ar", &file.domain, &file.name_ar, 2, MAX_NAME)?;
            bounded("name_en", &file.domain, &file.name_en, 2, MAX_NAME)?;
            if file.specialists.is_empty() {
                return Err(format!("domain {} has no specialist", file.domain));
            }
            for entry in file.specialists {
                let id = format!("{}.{}", file.domain, entry.slug);
                if !is_slug(&entry.slug) || !ids.insert(id.clone()) {
                    return Err(format!("{id} is not a unique slug"));
                }
                bounded("name_ar", &id, &entry.name_ar, 2, MAX_NAME)?;
                bounded("name_en", &id, &entry.name_en, 2, MAX_NAME)?;
                bounded("summary_ar", &id, &entry.summary_ar, 20, MAX_SUMMARY)?;
                bounded("summary_en", &id, &entry.summary_en, 20, MAX_SUMMARY)?;
                bounded("expertise", &id, &entry.expertise, MIN_EXPERTISE, MAX_EXPERTISE)?;
                if !has_arabic(&entry.name_ar) || !has_arabic(&entry.summary_ar) {
                    return Err(format!("{id}: the Arabic name and summary must be Arabic"));
                }
                if !(3..=6).contains(&entry.checks.len()) {
                    return Err(format!("{id}: needs 3..=6 checks"));
                }
                for check in &entry.checks {
                    bounded("check", &id, check, 12, MAX_CHECK)?;
                }
                if entry.keywords.len() < 4 || !entry.keywords.iter().any(|k| has_arabic(k)) || !entry.keywords.iter().any(|k| k.is_ascii()) {
                    return Err(format!("{id}: needs at least 4 keywords in both Arabic and English"));
                }
                if entry.task_types.is_empty() {
                    return Err(format!("{id}: names no task type"));
                }
                specialists.push(Specialist {
                    specialist_id: id,
                    domain_id: file.domain.clone(),
                    name_ar: entry.name_ar,
                    name_en: entry.name_en,
                    summary_ar: entry.summary_ar,
                    summary_en: entry.summary_en,
                    expertise: entry.expertise,
                    checks: entry.checks,
                    keywords: entry.keywords,
                    task_types: entry.task_types,
                });
            }
            domains.push(Domain { domain_id: file.domain, name_ar: file.name_ar, name_en: file.name_en });
        }
        let index = specialists.iter().map(|s| s.keywords.iter().map(|k| tokens(k)).filter(|t| !t.is_empty()).collect()).collect();
        Ok(Self { domains, specialists, index })
    }

    pub fn domains(&self) -> &[Domain] {
        &self.domains
    }

    pub fn specialists(&self) -> &[Specialist] {
        &self.specialists
    }

    pub fn get(&self, id: &str) -> Option<&Specialist> {
        self.specialists.iter().find(|s| s.specialist_id == id)
    }

    /// درجة تطابق نصّ مع متخصّص: كل كلمة مفتاحية حضرت رموزها كلها تُحتسب بعدد رموزها
    /// (العبارة أدلّ من الكلمة المفردة). حتمية، بلا نموذج.
    fn score(&self, position: usize, text: &BTreeSet<String>) -> usize {
        self.index[position].iter().filter(|keyword| keyword.iter().all(|t| text.contains(t))).map(Vec::len).sum()
    }

    fn ranked(&self, text: &str) -> Vec<(usize, &Specialist)> {
        let text = text_tokens(text);
        let mut ranked: Vec<(usize, &Specialist)> = self.specialists.iter().enumerate().map(|(i, s)| (self.score(i, &text), s)).filter(|(score, s)| *score > 0 && !is_disabled(&s.specialist_id)).collect();
        // الترتيب: الدرجة تنازليًّا، ثم ترتيب الكتالوج (ثابت بين التشغيلات).
        ranked.sort_by_key(|b| std::cmp::Reverse(b.0));
        ranked
    }

    /// القائمة القصيرة التي تُعرض على المخطّط لطلب ما.
    pub fn shortlist(&self, text: &str, limit: usize) -> Vec<&Specialist> {
        self.ranked(text).into_iter().take(limit).map(|(_, s)| s).collect()
    }

    /// G2 (2026-10-14): المرشحون لطلب عادي، حتى `limit`. أوّلًا ترتيب الكلمات المفتاحية القائم (`shortlist`)، ثم يُكمَل بتداخل
    /// كلمات الطلب مع اسم المتخصّص ووصفه وكلماته باللغتين (كلمات دالّة فقط: أربعة أحرف فأكثر للإنجليزية وثلاثة للعربية، بلا
    /// الكلمات الشائعة). حتمي بلا نموذج. الطريقة ثُبّتت قبل كتابة مجموعة الاختيار في `agents-300-eval/2` ولا تُضبط عليها.
    pub fn candidates(&self, text: &str, limit: usize) -> Vec<&Specialist> {
        let mut out: Vec<&Specialist> = self.shortlist(text, limit);
        if out.len() >= limit {
            return out;
        }
        let wanted: BTreeSet<String> = text_tokens(text).into_iter().filter(|t| meaningful(t)).collect();
        if wanted.is_empty() {
            return out;
        }
        let mut overlap: Vec<(usize, &Specialist)> = self
            .specialists
            .iter()
            .filter(|s| !is_disabled(&s.specialist_id) && !out.iter().any(|o| o.specialist_id == s.specialist_id))
            .map(|s| {
                let own: BTreeSet<String> = [s.name_en.as_str(), s.name_ar.as_str(), s.summary_en.as_str(), s.summary_ar.as_str()]
                    .into_iter()
                    .chain(s.keywords.iter().map(String::as_str))
                    .flat_map(tokens)
                    .collect();
                (wanted.iter().filter(|t| own.contains(*t)).count(), s)
            })
            .filter(|(n, _)| *n > 0)
            .collect();
        overlap.sort_by_key(|(n, _)| std::cmp::Reverse(*n));
        out.extend(overlap.into_iter().map(|(_, s)| s).take(limit - out.len()));
        out
    }

    /// متخصّص العقدة: اقتراح المخطّط إن كان معرّفًا معروفًا يقبل نوع العقدة، وإلا أفضل مطابقة
    /// لهدف العقدة تقبل نوعها، وإلا لا أحد (تعمل العقدة بتعليمة الدور وحدها كما كانت).
    pub fn choose(&self, hint: Option<&str>, objective: &str, task_type: TaskType) -> Option<&Specialist> {
        if let Some(chosen) = hint.and_then(|h| self.get(h.trim())).filter(|s| s.task_types.contains(&task_type) && !is_disabled(&s.specialist_id)) {
            return Some(chosen);
        }
        self.ranked(objective).into_iter().find(|(_, s)| s.task_types.contains(&task_type)).map(|(_, s)| s)
    }
}

/// كلمات شائعة لا تدلّ على مجال (G2، تداخل الكلمات في قائمة المرشحين).
const COMMON_WORDS: &[&str] = &[
    "the", "and", "for", "with", "from", "that", "this", "your", "into", "about", "have", "what", "when", "which", "they", "will", "need", "please", "make", "help", "want", "write",
    "create", "prepare", "short", "some", "more", "than", "them", "their", "there", "also", "only", "other", "each", "such", "then", "these", "those", "would", "could", "should",
    "company", "team", "work", "using", "based", "like", "just", "over", "under", "after", "before", "very", "much", "many", "good", "best", "file", "files", "list", "give",
    "أريد", "أبغى", "أبي", "هذا", "هذه", "التي", "الذي", "على", "إلى", "مع", "كيف", "ماذا", "اكتب", "اعمل", "سوي", "ساعدني", "عندي", "لدي", "شركة", "لنا", "أعطني", "نريد",
    "حتى", "كل", "بعد", "قبل", "عن", "أنا", "نحن", "عمل", "ملف", "لكي", "حول", "أو", "ثم", "لدينا", "عندنا",
];

/// هل الرمز دالّ؟ أربعة أحرف فأكثر للإنجليزية، وثلاثة للعربية، وليس من الكلمات الشائعة.
fn meaningful(token: &str) -> bool {
    let n = token.chars().count();
    let long = if has_arabic(token) { n >= 3 } else { n >= 4 };
    // الكلمة الشائعة تُطبَّع كما تُطبَّع كلمات الطلب، فتُقارن بالصيغة نفسها.
    long && !COMMON_WORDS.iter().any(|w| tokens(w).first().is_some_and(|t| t == token))
}

/// رموز نصّ الطلب: رموزه، ومعها صيغة كل كلمة بلا واو العطف في أوّلها. الواو لا تُنزع من الرمز نفسه
/// لأنها قد تكون أصلية (وزارة، واجب)؛ الصيغتان تحضران معًا، فتطابق الكلمةُ المفتاحية أيّهما.
fn text_tokens(text: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for token in tokens(text) {
        if token.chars().count() > 3 && token.starts_with('و') {
            let rest: String = token.chars().skip(1).collect();
            out.extend(tokens(&rest));
        }
        // ألف تنوين النصب: «عرضًا تقديميًا» تطابق «عرض تقديمي».
        if token.chars().count() > 3 && token.ends_with('ا') && has_arabic(&token) {
            let mut stem = token.clone();
            stem.pop();
            out.insert(stem);
        }
        out.insert(token);
    }
    out
}

/// تطبيع نصّ إلى رموز للمطابقة: حروف صغيرة، وتوحيد الألف والياء والتاء المربوطة، وحذف التشكيل
/// والتطويل، ونزع «ال» التعريف من أوّل الكلمة العربية، ونزع جمع الإنجليزية البسيط.
pub fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut Vec<String>| {
        if word.is_empty() {
            return;
        }
        let mut w = std::mem::take(word);
        if has_arabic(&w) {
            if w.chars().count() > 4 && w.starts_with("ال") {
                w = w.chars().skip(2).collect();
            }
        } else if w.len() > 4 && w.ends_with('s') && !w.ends_with("ss") {
            w.pop();
        }
        out.push(w);
    };
    for c in text.chars() {
        let c = match c {
            'أ' | 'إ' | 'آ' | 'ٱ' => 'ا',
            'ى' => 'ي',
            'ة' => 'ه',
            '\u{064B}'..='\u{0652}' | '\u{0640}' => continue,
            _ => c,
        };
        if c.is_alphanumeric() {
            word.extend(c.to_lowercase());
        } else {
            flush(&mut word, &mut out);
        }
    }
    flush(&mut word, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_builtin_catalog_parses_with_three_hundred_unique_specialists_in_twenty_domains() {
        let catalog = SpecialistCatalog::parse(SOURCES).expect("the built-in catalog is invalid");
        // عشرون مجالًا للمتخصّصين ومجال مكتبة المهارات.
        assert_eq!(catalog.domains().len(), 21);
        let library = catalog.specialists().iter().filter(|s| s.domain_id == SKILLS_DOMAIN).count();
        assert_eq!(library, 87, "the skills library holds {library} skills");
        assert_eq!(catalog.specialists().len(), 300 + library);
        for domain in catalog.domains().iter().filter(|d| d.domain_id != SKILLS_DOMAIN) {
            let n = catalog.specialists().iter().filter(|s| s.domain_id == domain.domain_id).count();
            assert_eq!(n, 15, "{} holds {n} specialists", domain.domain_id);
        }
        // لا اسمان متطابقان في لغة واحدة: الاسم ما يراه المستخدم.
        let ar: BTreeSet<&str> = catalog.specialists().iter().map(|s| s.name_ar.as_str()).collect();
        let en: BTreeSet<&str> = catalog.specialists().iter().map(|s| s.name_en.as_str()).collect();
        assert_eq!(ar.len(), 300 + library, "two specialists share an Arabic name");
        assert_eq!(en.len(), 300 + library, "two specialists share an English name");
    }

    #[test]
    fn a_library_skill_is_routed_when_enabled_and_never_when_disabled() {
        let catalog = SpecialistCatalog::builtin();
        let text = "اعمل تحليل فجوة المحتوى لموقعنا مقارنة بالمنافسين";
        let id = |c: Option<&Specialist>| c.map(|s| s.specialist_id.clone());
        assert_eq!(id(catalog.choose(None, text, TaskType::Research)).as_deref(), Some("skills.content-gap-analysis"));
        set_library_skill_enabled("skills.content-gap-analysis", false);
        assert_ne!(id(catalog.choose(None, text, TaskType::Research)).as_deref(), Some("skills.content-gap-analysis"));
        assert!(catalog.choose(Some("skills.content-gap-analysis"), text, TaskType::Research).map(|s| s.specialist_id != "skills.content-gap-analysis").unwrap_or(true));
        set_library_skill_enabled("skills.content-gap-analysis", true);
        assert_eq!(id(catalog.choose(None, text, TaskType::Research)).as_deref(), Some("skills.content-gap-analysis"));
    }

    #[test]
    fn arabic_and_english_text_normalise_to_the_same_matching_tokens() {
        assert_eq!(tokens("التقارير المالية"), vec!["تقارير", "ماليه"]);
        // الواو في أوّل الكلمة: الصيغتان معًا في نصّ الطلب، والأصلية لا تُفقد.
        assert!(text_tokens("وأَسعار").contains("اسعار") && text_tokens("وأَسعار").contains("واسعار"));
        assert!(text_tokens("والقوائم").contains("قوائم"));
        assert!(text_tokens("وزارة").contains("وزاره"));
        assert!(text_tokens("عرضًا تقديميًا").contains("تقديمي"));
        assert_eq!(tokens("Financial Statements, budgets"), vec!["financial", "statement", "budget"]);
    }

    #[test]
    fn a_request_reaches_the_specialist_of_its_field_and_unrelated_text_reaches_none() {
        let catalog = SpecialistCatalog::builtin();
        let pick = |text: &str, t: TaskType| catalog.choose(None, text, t).map(|s| s.domain_id.clone());
        assert_eq!(pick("حلّل القوائم المالية للشركة واحسب نسب الربحية", TaskType::Research).as_deref(), Some("finance"));
        assert_eq!(pick("Write a REST API in Rust with authentication", TaskType::Build).as_deref().map(|d| d == "software" || d == "web-mobile" || d == "security"), Some(true));
        assert_eq!(pick("ترجم هذه الفقرة إلى الإنجليزية", TaskType::Synthesize).as_deref(), Some("languages"));
        assert_eq!(pick("هلا", TaskType::Research), None, "a greeting was given a specialist");
    }

    #[test]
    fn a_planner_hint_is_honoured_only_when_it_names_a_known_specialist_for_that_kind_of_task() {
        let catalog = SpecialistCatalog::builtin();
        let any = &catalog.specialists()[0];
        let allowed = any.task_types[0];
        assert_eq!(catalog.choose(Some(&any.specialist_id), "unrelated words", allowed).map(|s| &s.specialist_id), Some(&any.specialist_id));
        // معرّف مخترع لا يُقبل، والنصّ وحده يحسم.
        assert_eq!(catalog.choose(Some("made.up"), "unrelated words", allowed), None);
        // نوع عقدة لا يقبله المتخصّص: لا يُفرض عليها.
        let refused = [TaskType::Plan, TaskType::Design, TaskType::Build, TaskType::Debug, TaskType::Review, TaskType::SecurityReview, TaskType::Test, TaskType::Research, TaskType::Synthesize]
            .into_iter()
            .find(|t| !any.task_types.contains(t));
        if let Some(t) = refused {
            assert_ne!(catalog.choose(Some(&any.specialist_id), "unrelated words", t).map(|s| &s.specialist_id), Some(&any.specialist_id));
        }
    }

    #[test]
    fn the_brief_carries_method_and_checks_and_the_catalog_rejects_bad_records() {
        let catalog = SpecialistCatalog::builtin();
        let brief = catalog.specialists()[0].brief();
        assert!(brief.contains("How this specialist works:") && brief.contains("Before you report, make sure that:\n- "));
        let bad = r#"{"domain":"x","name_ar":"س","name_en":"X","specialists":[]}"#;
        assert!(SpecialistCatalog::parse(&[bad]).is_err());
        let english_only = r#"{"domain":"x","name_ar":"مجال","name_en":"Domain","specialists":[{"slug":"a","name_ar":"Analyst","name_en":"Analyst","summary_ar":"An English summary that is long enough","summary_en":"An English summary that is long enough","expertise":"x","checks":[],"keywords":[],"task_types":["RESEARCH"]}]}"#;
        assert!(SpecialistCatalog::parse(&[english_only]).is_err());
    }
}

#[cfg(test)]
mod routing {
    use super::*;

    /// عيّنة طلبات حقيقية الشكل وما يجب أن تبلغه. كتبها مطوّر الكتالوج نفسه، فهي اختبار انحدار لا
    /// مقياس دقّة مستقلًّا: تحرس ألا يكسر تعديلٌ في الكلمات أو التطبيع توجيهًا كان صحيحًا.
    #[test]
    fn representative_requests_reach_the_expected_specialist_and_small_talk_reaches_none() {
        let c = SpecialistCatalog::builtin();
        let cases: &[(&str, TaskType, Option<&str>)] = &[
            ("اكتب تقريرا عن فوائد شرب الماء واحفظه في ملف", TaskType::Build, Some("writing.report-writer")),
            ("حلل ملف المبيعات csv وارسم مخططا بيانيا", TaskType::Research, Some("data-ai.data-analyst")),
            ("أريد خطة تسويقية لمتجر عطور على انستقرام", TaskType::Plan, Some("marketing-sales.marketing-strategist")),
            ("صمم لي موقع صفحة هبوط لمطعم", TaskType::Build, Some("web-mobile.landing-page-builder")),
            ("راجع هذا العقد وبيّن المخاطر", TaskType::Review, Some("legal.contract-reviewer")),
            ("ما هي أعراض نقص فيتامين د", TaskType::Research, Some("health.medical-information")),
            ("ترجم هذه الفقرة إلى الإنجليزية", TaskType::Synthesize, Some("languages.arabic-english-translator")),
            ("اكتب قصيدة عن الوطن على بحر الكامل", TaskType::Build, Some("writing.poet")),
            ("خطة سفر إلى إسطنبول لمدة خمسة أيام", TaskType::Plan, Some("everyday.travel-planner")),
            ("اكتب سكربت بايثون يعيد تسمية الملفات", TaskType::Build, Some("software.python-developer")),
            ("صمم عرضا تقديميا عن الذكاء الاصطناعي", TaskType::Build, Some("design-media.presentation-designer")),
            ("كيف أحسب مكافأة نهاية الخدمة", TaskType::Research, Some("finance.payroll-specialist")),
            ("ما الفرق بين الآيفون والسامسونج أيهما أفضل", TaskType::Research, Some("research.comparison-analyst")),
            ("لخص هذا المستند", TaskType::Synthesize, Some("writing.summarizer")),
            ("اكتب سيرة ذاتية لمهندس برمجيات", TaskType::Build, Some("writing.resume-writer")),
            ("أصلح الخطأ في هذا الكود: TypeError", TaskType::Debug, Some("software.debugging-specialist")),
            ("وصفة كبسة دجاج", TaskType::Build, Some("everyday.chef")),
            ("Write unit tests for the payment module", TaskType::Test, Some("software.test-engineer")),
            ("Create a docker compose file for postgres and redis", TaskType::Build, Some("infrastructure.container-specialist")),
            ("حساب الزكاة على الأسهم", TaskType::Research, Some("finance.tax-information")),
            ("أعرب: ذهب الطالبُ إلى المدرسة", TaskType::Synthesize, Some("languages.arabic-grammarian")),
            ("هلا", TaskType::Research, None),
            ("شكرا", TaskType::Synthesize, None),
            ("كيف حالك؟", TaskType::Research, None),
            // قِيس 2026-10-01 في النسخة المبنية: خطوة «الرد على التحية» لـ«هلا» أخذت «كاتب المراسلات المهنية».
            ("الرد على التحية", TaskType::Synthesize, None),
            ("الرد على التحية", TaskType::Build, None),
            ("Reply to the user's greeting", TaskType::Synthesize, None),
        ];
        let mut wrong = Vec::new();
        for (text, task_type, expected) in cases {
            let got = c.choose(None, text, *task_type).map(|s| s.specialist_id.as_str());
            if got != *expected {
                wrong.push(format!("{text} -> {got:?}, expected {expected:?}"));
            }
        }
        assert!(wrong.is_empty(), "{}", wrong.join("
"));
    }
}
