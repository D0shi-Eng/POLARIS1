// عقد تنفيذ المهمّة (Phase-08): ما يجب أن يوجد فعلًا قبل أن تُعلَن المهمّة مكتملة.
//
// العيب الذي يغلقه: كانت المهمّة «تكتمل» حين يعيد النموذج قائمة أدوات فارغة، فيكفي أن يقول
// «انتهيت». العقد يُشتقّ من هدف المستخدم نفسه (نصّه المكتوب، لا نثر النموذج)، بقواعد حتمية
// مغلقة: مسارات المخرجات بامتداداتها، وتشغيل Python، والمخطط، والاختبارات، والشبكة، والمتصفّح.
// يعرفه زمن التشغيل مستقلًّا عن النموذج، ويُقاس الوفاء به بما قاسه المضيف: ملف موجود أعيد
// فتحه، وأداة نُفّذت، ونتيجة اختبار مقيسة.
//
// العقد لا يمنح سلطة: لا ينفّذ شيئًا ولا يوافق على شيء. كل ما يترتّب عليه اقتراحات تعبر
// البوابة نفسها.

use serde::Serialize;

/// صيغة ملف مطلوب، من امتداده.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeliverableFormat {
    Xlsx,
    Pdf,
    Docx,
    Pptx,
    Zip,
    Html,
    Css,
    Js,
    Csv,
    Markdown,
    Text,
    Json,
    Python,
    Other,
}

impl DeliverableFormat {
    pub fn from_path(path: &str) -> Self {
        let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        match ext.as_str() {
            "xlsx" => Self::Xlsx,
            "pdf" => Self::Pdf,
            "docx" => Self::Docx,
            "pptx" => Self::Pptx,
            "zip" => Self::Zip,
            "html" | "htm" => Self::Html,
            "css" => Self::Css,
            "js" => Self::Js,
            "csv" => Self::Csv,
            "md" | "markdown" => Self::Markdown,
            "txt" => Self::Text,
            "json" => Self::Json,
            "py" => Self::Python,
            _ => Self::Other,
        }
    }

    /// صيغة ثنائية لا يُعقل أن يكتبها النموذج يدويًّا: لها أداة مخرجات حتمية.
    pub fn is_binary_document(self) -> bool {
        matches!(self, Self::Xlsx | Self::Pdf | Self::Docx | Self::Pptx | Self::Zip)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Xlsx => "XLSX",
            Self::Pdf => "PDF",
            Self::Docx => "DOCX",
            Self::Pptx => "PPTX",
            Self::Zip => "ZIP",
            Self::Html => "HTML",
            Self::Css => "CSS",
            Self::Js => "JS",
            Self::Csv => "CSV",
            Self::Markdown => "MARKDOWN",
            Self::Text => "TEXT",
            Self::Json => "JSON",
            Self::Python => "PYTHON",
            Self::Other => "OTHER",
        }
    }
}

/// نوع متطلَّب في العقد. مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum RequirementKind {
    /// ملف في مساحة المهمّة، يوجد ويُعاد فتحه بنجاح لصيغته.
    Artifact { path: String, format: DeliverableFormat },
    /// مخطط داخل مصنّف بعينه.
    ChartIn { path: String },
    /// تشغيل شيفرة فعلًا في الصندوق بأداة بعينها.
    ExecutedCode { tool_id: String },
    /// تشغيل اختبارات انتهى بنجاحها (نتيجة مقيسة، لا قول النموذج).
    TestsPassing,
    /// اقتراح خطوة شبكة بلغ البوابة (نُفّذ بموافقة، أو انتظر قرارًا، أو رُفض بقرار بشري).
    NetworkProposal,
    /// فتح صفحة في المتصفّح الحقيقي.
    BrowserVisit { url: String },
}

/// متطلَّب واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContractRequirement {
    pub id: String,
    pub kind: RequirementKind,
    /// وصف قصير يُعرض على النموذج في مهمّة استكمال، وعلى المستخدم.
    pub description: String,
}

/// العقد: ما يجب، وما يُمنع.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct MissionExecutionContract {
    pub requirements: Vec<ContractRequirement>,
    /// آثار ممنوعة دائمًا (معلومة للعرض؛ فرضها عند البوابة لا هنا).
    pub forbidden_effects: Vec<String>,
}

/// أداة تشغيل Python كما يعرفها السجل.
pub const TOOL_PYTHON: &str = "polaris.execution.python";

impl MissionExecutionContract {
    pub fn is_empty(&self) -> bool {
        self.requirements.is_empty()
    }

    /// يشتقّ العقد من هدف المستخدم. حتمي: الهدف نفسه يعطي العقد نفسه دائمًا.
    pub fn derive(objective: &str) -> Self {
        let mut contract = Self { requirements: Vec::new(), forbidden_effects: vec!["WRITE_OUTSIDE_WORKSPACE".into(), "NETWORK_WITHOUT_APPROVAL".into()] };
        let lower = objective.to_lowercase();
        let paths = deliverable_paths(objective);
        for path in &paths {
            let format = DeliverableFormat::from_path(path);
            contract.push(RequirementKind::Artifact { path: path.clone(), format }, format!("{path} exists in the workspace and re-opens as a valid {} file", format.as_str()));
        }
        if mentions_word(&lower, "chart") || lower.contains("مخطط") || lower.contains("رسم بياني") {
            for path in paths.iter().filter(|p| DeliverableFormat::from_path(p) == DeliverableFormat::Xlsx) {
                contract.push(RequirementKind::ChartIn { path: path.clone() }, format!("{path} contains a chart"));
            }
        }
        if mentions_word(&lower, "python") || lower.contains("بايثون") {
            contract.push(RequirementKind::ExecutedCode { tool_id: TOOL_PYTHON.into() }, "Python code actually ran in the sandbox".into());
        }
        // CP-13-1: «حتى تنجح الاختبارات» بصيغها الطبيعية تطلب اختبارات ناجحة كما تطلبها «run the tests».
        let passing = ["tests pass", "test pass", "tests to pass", "tests are passing", "tests passing", "تنجح الاختبارات", "الاختبارات تنجح", "نجاح الاختبارات", "تجتاز الاختبارات"];
        let tests = mentions_word(&lower, "unittest") || mentions_word(&lower, "pytest") || lower.contains("run the tests") || lower.contains("rerun the tests") || lower.contains("failing test") || passing.iter().any(|p| lower.contains(p));
        if tests {
            contract.push(RequirementKind::TestsPassing, "the project's tests were run and passed after the change".into());
        }
        let urls = urls_in(objective);
        let remote = urls.iter().any(|u| !is_loopback_url(u));
        if remote && (mentions_word(&lower, "download") || mentions_word(&lower, "network") || mentions_word(&lower, "fetch") || lower.contains("تنزيل")) {
            contract.push(RequirementKind::NetworkProposal, "a network step was proposed so that a human can decide it".into());
        }
        if mentions_word(&lower, "browser") || lower.contains("المتصفح") {
            if let Some(url) = urls.iter().find(|u| is_loopback_url(u)).or(urls.first()) {
                contract.push(RequirementKind::BrowserVisit { url: url.clone() }, format!("{url} was opened in the real browser"));
            }
        }
        contract
    }

    fn push(&mut self, kind: RequirementKind, description: String) {
        if self.requirements.iter().any(|r| r.kind == kind) {
            return;
        }
        let id = format!("R{}", self.requirements.len() + 1);
        self.requirements.push(ContractRequirement { id, kind, description });
    }
}

/// كلمة كاملة (لا جزء كلمة): «python» لا تُطابق «pythonic».
pub(crate) fn mentions_word(lower: &str, word: &str) -> bool {
    lower.match_indices(word).any(|(at, _)| {
        let before = lower[..at].chars().next_back();
        let after = lower[at + word.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

/// روابط http/https في النصّ، بلا علامات ترقيم لاحقة.
pub fn urls_in(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in text.split_whitespace() {
        let Some(start) = token.find("http://").or_else(|| token.find("https://")) else { continue };
        let url = token[start..].trim_end_matches(['.', ',', ')', ';', ':', '\'', '"']);
        if url.len() > 8 && !out.iter().any(|u| u == url) {
            out.push(url.to_string());
        }
    }
    out
}

fn is_loopback_url(url: &str) -> bool {
    let rest = url.split("://").nth(1).unwrap_or("");
    let host = rest.split(['/', ':']).next().unwrap_or("").to_ascii_lowercase();
    host == "localhost" || host.starts_with("127.") || host == "[::1]"
}

const DELIVERABLE_ROOTS: [&str; 2] = ["outputs/", "work/"];
const KNOWN_EXTENSIONS: [&str; 16] = ["xlsx", "pdf", "docx", "pptx", "zip", "html", "htm", "css", "js", "csv", "md", "markdown", "txt", "json", "py", "png"];

/// مسارات المخرجات المطلوبة: ما يبدأ بـ outputs/ أو work/ وله امتداد معروف، وأسماء ملفات
/// عارية تلي مجلدًا مذكورًا في الجملة نفسها («in outputs/site/: index.html, about.html»).
/// مدخلات المستخدم (inputs/) ليست مخرجات فلا تدخل العقد.
pub fn deliverable_paths(objective: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for sentence in objective.split(['\n']).flat_map(split_sentences) {
        let mut folder: Option<String> = None;
        // آخر كلمة غير حشو قبل الرمز الحالي: فعل نقل أو حذف قبل المسار مباشرةً يجعله مصدرًا أو محذوفًا، لا مخرجًا (D-MP-12).
        let mut governing: Option<String> = None;
        for raw in sentence.split(|c: char| c.is_whitespace() || matches!(c, ',' | '(' | ')' | '\'' | '"' | '`' | ';')) {
            let token = raw.trim_matches(|c: char| matches!(c, '.' | ':' | '!' | '?'));
            if token.is_empty() {
                continue;
            }
            let normal = token.replace('\\', "/");
            let consumed = governing.as_deref().is_some_and(is_move_or_delete_verb);
            if DELIVERABLE_ROOTS.iter().any(|r| normal.starts_with(r)) {
                governing = Some(normal.to_lowercase());
                if normal.ends_with('/') {
                    folder = Some(normal.clone());
                    continue;
                }
                if has_known_extension(&normal) {
                    if !consumed {
                        push_unique(&mut out, normal.clone());
                    }
                } else {
                    // مجلد مذكور بلا شرطة أخيرة («outputs/site»).
                    folder = Some(format!("{normal}/"));
                }
                continue;
            }
            if let Some(dir) = &folder {
                if !consumed && !normal.contains('/') && has_known_extension(&normal) && normal.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_')) {
                    push_unique(&mut out, format!("{dir}{normal}"));
                }
            }
            let lower = normal.to_lowercase();
            if !FILLER_WORDS.contains(&lower.as_str()) {
                governing = Some(lower);
            }
        }
    }
    out
}

/// كلمات بين الفعل والمسار لا تغيّر من يحكمه («move the file outputs/a.md»، «احذف الملف outputs/a.md»).
const FILLER_WORDS: [&str; 10] = ["the", "file", "folder", "a", "my", "this", "الملف", "المجلد", "ملف", "مجلد"];

/// فعل يجعل المسار الذي يليه مصدر نقل أو تسمية أو هدف حذف، لا مخرجًا يجب أن يوجد بعد الدور.
fn is_move_or_delete_verb(word: &str) -> bool {
    matches!(word, "rename" | "renaming" | "move" | "moving" | "delete" | "deleting" | "remove" | "removing" | "erase")
        || ["تسمية", "سم", "سمِّ", "انقل", "نقل", "احذف", "حذف", "أزل", "امسح"].contains(&word)
}

/// جمل: نقطة تليها مسافة تُنهي الجملة؛ النقطة داخل اسم ملف لا تُنهيها.
fn split_sentences(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    for i in 0..bytes.len() {
        let ends = matches!(bytes[i], b'.' | b'!' | b'?') && bytes.get(i + 1).is_none_or(|b| b.is_ascii_whitespace());
        if ends {
            parts.push(&text[start..=i]);
            start = i + 1;
        }
    }
    if start < text.len() {
        parts.push(&text[start..]);
    }
    parts
}

fn has_known_extension(path: &str) -> bool {
    let Some((stem, ext)) = path.rsplit_once('.') else { return false };
    !stem.is_empty() && !stem.ends_with('/') && KNOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

fn push_unique(out: &mut Vec<String>, path: String) {
    if !out.contains(&path) {
        out.push(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(objective: &str) -> Vec<RequirementKind> {
        MissionExecutionContract::derive(objective).requirements.into_iter().map(|r| r.kind).collect()
    }

    #[test]
    fn mission_b_requires_a_workbook_with_a_chart_a_pdf_and_python() {
        let k = kinds("Analyse inputs/sales.csv with Python in the sandbox: compute the total per region over all months. Then produce outputs/sales-analysis.xlsx with a sheet of the totals and a bar chart, and a PDF report outputs/sales-report.pdf that states each region's total.");
        assert!(k.contains(&RequirementKind::Artifact { path: "outputs/sales-analysis.xlsx".into(), format: DeliverableFormat::Xlsx }));
        assert!(k.contains(&RequirementKind::Artifact { path: "outputs/sales-report.pdf".into(), format: DeliverableFormat::Pdf }));
        assert!(k.contains(&RequirementKind::ChartIn { path: "outputs/sales-analysis.xlsx".into() }));
        assert!(k.contains(&RequirementKind::ExecutedCode { tool_id: TOOL_PYTHON.into() }));
        assert!(!k.iter().any(|r| matches!(r, RequirementKind::Artifact { path, .. } if path.starts_with("inputs/"))), "an input became a deliverable");
    }

    #[test]
    fn mission_d_bare_file_names_join_the_folder_named_before_them_and_the_zip_is_mandatory() {
        let k = kinds("Build a small static website for a fictional bakery called 'Sunrise Bakery' in outputs/site/: index.html (with a heading, a menu list of at least three items and a link to about.html), about.html, and style.css linked from both pages. Then validate with Python that every local link and stylesheet reference resolves to an existing file, and package the site as outputs/site.zip.");
        for p in ["outputs/site/index.html", "outputs/site/about.html", "outputs/site/style.css", "outputs/site.zip"] {
            assert!(k.iter().any(|r| matches!(r, RequirementKind::Artifact { path, .. } if path == p)), "{p} is missing from the contract");
        }
        assert!(k.contains(&RequirementKind::ExecutedCode { tool_id: TOOL_PYTHON.into() }));
    }

    /// CP-13-1: الصيغة الطبيعية «أصلح الخطأ حتى تنجح الاختبارات» تطلب اختبارات ناجحة كما تطلبها «run the tests».
    #[test]
    fn a_request_to_make_the_tests_pass_requires_passing_tests_in_both_languages() {
        for objective in ["Review the code project I attached and fix the bug so the tests pass", "Make the tests pass", "راجع المشروع وأصلح الخطأ حتى تنجح الاختبارات", "أريد نجاح الاختبارات بعد الإصلاح"] {
            assert!(kinds(objective).contains(&RequirementKind::TestsPassing), "{objective}");
        }
        // ذكر الاختبارات بلا طلب نجاحها لا يفرضه.
        assert!(!kinds("Write a short note about unit testing").contains(&RequirementKind::TestsPassing));
    }

    #[test]
    fn mission_e_requires_passing_tests_the_fixed_source_and_a_report() {
        let k = kinds("The attached Python project (inputs/stats.py and inputs/test_stats.py) has a failing test. Copy both files to work/project/, run the tests there with 'python -m unittest -v' in the sandbox, find and fix the bug in work/project/stats.py, rerun the tests until they pass, then write outputs/change-report.md describing the failing test, the root cause, the fix and the final test result.");
        assert!(k.contains(&RequirementKind::TestsPassing));
        assert!(k.iter().any(|r| matches!(r, RequirementKind::Artifact { path, .. } if path == "work/project/stats.py")));
        assert!(k.iter().any(|r| matches!(r, RequirementKind::Artifact { path, .. } if path == "outputs/change-report.md")));
    }

    #[test]
    fn a_remote_download_requires_a_network_proposal_and_a_loopback_page_a_browser_visit() {
        let k = kinds("Use Python with network access to download https://example.org and save its title to outputs/title.txt.");
        assert!(k.contains(&RequirementKind::NetworkProposal));
        let c = kinds("Open http://127.0.0.1:49469/ in the browser. The product table is built by JavaScript. Extract every product with its price and stock, and write them to outputs/products.csv (columns: product,price,stock). Then write a short report outputs/products-report.md naming the most expensive product.");
        assert!(c.contains(&RequirementKind::BrowserVisit { url: "http://127.0.0.1:49469/".into() }));
        assert!(!c.contains(&RequirementKind::NetworkProposal), "a loopback page is not a network step");
        assert!(c.iter().any(|r| matches!(r, RequirementKind::Artifact { path, .. } if path == "outputs/products.csv")));
    }

    #[test]
    fn the_contract_is_deterministic_and_words_match_whole() {
        let a = MissionExecutionContract::derive("Write outputs/a.md with pythonic prose.");
        assert_eq!(a, MissionExecutionContract::derive("Write outputs/a.md with pythonic prose."));
        assert!(!a.requirements.iter().any(|r| matches!(r.kind, RequirementKind::ExecutedCode { .. })));
        assert!(MissionExecutionContract::derive("Summarise the week").is_empty());
    }

    /// D-MP-12 (قِيس أصليًّا 2026-10-20 مع Bonsai 2): «Rename outputs/check.txt to outputs/verified.txt» جعل المسارين مخرجين مطلوبين،
    /// فنقل الوكيل الملف بـmove_file ثم طالبه فحص الاكتمال بـcheck.txt فأعاد كتابته، وبقيت نسختان. مصدر النقل والمحذوف ليسا مخرجين.
    #[test]
    fn the_source_of_a_rename_or_move_and_a_deleted_path_are_not_deliverables() {
        assert_eq!(deliverable_paths("Rename outputs/check.txt to outputs/verified.txt. Do not make a copy."), vec!["outputs/verified.txt".to_string()]);
        assert_eq!(deliverable_paths("Move the file outputs/a.md to outputs/notes/a.md"), vec!["outputs/notes/a.md".to_string()]);
        assert_eq!(deliverable_paths("Delete outputs/old.md and write outputs/new.md"), vec!["outputs/new.md".to_string()]);
        assert_eq!(deliverable_paths("أعد تسمية outputs/check.txt إلى outputs/verified.txt"), vec!["outputs/verified.txt".to_string()]);
        assert_eq!(deliverable_paths("انقل outputs/a.md إلى outputs/notes/a.md"), vec!["outputs/notes/a.md".to_string()]);
        assert!(deliverable_paths("احذف الملف outputs/old.md").is_empty());
        // ما يُكتب يبقى مخرجًا، حتى بجوار فعل آخر.
        assert_eq!(deliverable_paths("Write outputs/check.txt containing the word ok."), vec!["outputs/check.txt".to_string()]);
        assert_eq!(deliverable_paths("Create outputs/report.md, then remove nothing else."), vec!["outputs/report.md".to_string()]);
    }
}
