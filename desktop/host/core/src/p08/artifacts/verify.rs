// التحقق من المخرجات بإعادة فتحها: الملف لا يُعدّ مخرَجًا لأنه وُجد على القرص.
//
// كل نوع يُعاد فتحه بقارئ مستقلّ عن كاتبه ما أمكن (حاوية ZIP تُقرأ من جديد مع CRC،
// وكل جزء XML يُفحص، والنصّ المتوقَّع يُبحث عنه في المستخرَج). ويُفحص غياب ما لا
// نُنتجه أبدًا: ماكرو، ووصلة خارجية، وكائن مضمَّن، ومحتوى PDF نشط. النتيجة سجلّ فحوص
// مسمّاة، كلٌّ بنتيجته وتفصيله، لا حكم واحد بلا أسباب.

use serde::Serialize;

use super::extract::{extract, pdf_logical_text, FileKind};
use super::pdf::read_pdf;
use super::text::parse_csv;
use super::web::check_site;
use super::xml::{check_well_formed, count_elements};
use super::zip::{read_zip, ZipEntry};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Check {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Verification {
    /// VERIFIED حين تنجح كل الفحوص، وإلا FAILED. لا حالة وسطى تُخفي فحصًا فاشلًا.
    pub status: &'static str,
    pub checks: Vec<Check>,
    /// حقائق مقيسة: عدد الصفحات أو الشرائح أو الأوراق والصيغ والمخططات والجداول.
    pub facts: Vec<(String, u64)>,
}

impl Verification {
    fn from(checks: Vec<Check>, facts: Vec<(String, u64)>) -> Self {
        let status = if !checks.is_empty() && checks.iter().all(|c| c.passed) { "VERIFIED" } else { "FAILED" };
        Self { status, checks, facts }
    }

    /// من قائمة فحوص مسمّاة (للمخرجات التي تُتحقَّق بنيويًّا خارج هذا الملف).
    pub fn from_checks(checks: Vec<(&str, bool, String)>, facts: Vec<(String, u64)>) -> Self {
        Self::from(checks.into_iter().map(|(n, p, d)| check(n, p, d)).collect(), facts)
    }

    pub fn verified(&self) -> bool {
        self.status == "VERIFIED"
    }

    pub fn fact(&self, name: &str) -> Option<u64> {
        self.facts.iter().find(|(n, _)| n == name).map(|(_, v)| *v)
    }
}

fn check(name: &str, passed: bool, detail: impl Into<String>) -> Check {
    Check { name: name.into(), passed, detail: detail.into() }
}

/// يطبّع النصّ للمقارنة: مسافات موحّدة وأحرف صغيرة.
fn norm(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn expected_present(extracted: &str, expected: &[String]) -> Check {
    let hay = norm(extracted);
    let missing: Vec<&String> = expected.iter().filter(|e| !e.trim().is_empty() && !hay.contains(&norm(e))).collect();
    check(
        "expected_text_present",
        missing.is_empty(),
        if missing.is_empty() { format!("{} expected strings found", expected.len()) } else { format!("missing: {}", missing.iter().take(3).map(|s| s.chars().take(60).collect::<String>()).collect::<Vec<_>>().join(" | ")) },
    )
}

/// فحوص الحزمة المشتركة لـDOCX/XLSX/PPTX.
fn ooxml_package_checks(entries: &[ZipEntry], main_part: &str, checks: &mut Vec<Check>) {
    let types = entries.iter().find(|e| e.name == "[Content_Types].xml").map(|e| String::from_utf8_lossy(&e.data).into_owned());
    checks.push(check("content_types_present", types.is_some(), "[Content_Types].xml"));
    checks.push(check("main_part_present", entries.iter().any(|e| e.name == main_part), main_part));
    let macro_part = entries.iter().any(|e| e.name.to_ascii_lowercase().ends_with("vbaproject.bin"));
    let macro_type = types.as_deref().is_some_and(|t| t.contains("macroEnabled") || t.contains("vbaProject"));
    checks.push(check("no_macros", !macro_part && !macro_type, "no vbaProject part and no macro-enabled content type"));
    let external = entries.iter().any(|e| e.name.ends_with(".rels") && String::from_utf8_lossy(&e.data).contains("TargetMode=\"External\""));
    let embedded = entries.iter().any(|e| {
        let n = e.name.to_ascii_lowercase();
        n.contains("/embeddings/") || n.contains("activex") || n.contains("externallink") || n.ends_with("connections.xml")
    });
    checks.push(check("no_external_or_embedded_objects", !external && !embedded, "no external relationship, embedding, ActiveX or data connection"));
    let mut malformed = Vec::new();
    for e in entries.iter().filter(|e| e.name.ends_with(".xml") || e.name.ends_with(".rels")) {
        match std::str::from_utf8(&e.data) {
            Ok(text) => {
                if let Err(err) = check_well_formed(text) {
                    malformed.push(format!("{}: {err}", e.name));
                }
            }
            Err(_) => malformed.push(format!("{}: not UTF-8", e.name)),
        }
    }
    checks.push(check("xml_parts_well_formed", malformed.is_empty(), if malformed.is_empty() { format!("{} parts", entries.len()) } else { malformed.join("; ") }));
}

fn count_parts(entries: &[ZipEntry], prefix: &str) -> u64 {
    entries.iter().filter(|e| e.name.starts_with(prefix) && e.name.ends_with(".xml") && !e.name.contains("/_rels/")).count() as u64
}

fn verify_ooxml(name: &str, bytes: &[u8], kind: FileKind, expected: &[String]) -> Verification {
    let mut checks = Vec::new();
    let mut facts = Vec::new();
    let entries = match read_zip(bytes) {
        Ok(e) => {
            checks.push(check("zip_container_readable", true, format!("{} entries, CRC verified", e.len())));
            e
        }
        Err(err) => {
            checks.push(check("zip_container_readable", false, err.to_string()));
            return Verification::from(checks, facts);
        }
    };
    let main = match kind {
        FileKind::Docx => "word/document.xml",
        FileKind::Xlsx => "xl/workbook.xml",
        _ => "ppt/presentation.xml",
    };
    ooxml_package_checks(&entries, main, &mut checks);
    let all_xml = |prefix: &str| entries.iter().filter(|e| e.name.starts_with(prefix) && e.name.ends_with(".xml")).map(|e| String::from_utf8_lossy(&e.data).into_owned()).collect::<Vec<_>>();
    match kind {
        FileKind::Docx => {
            let doc = all_xml("word/document.xml").concat();
            facts.push(("paragraphs".into(), count_elements(&doc, "w:p") as u64));
            facts.push(("tables".into(), count_elements(&doc, "w:tbl") as u64));
            facts.push(("charts".into(), count_parts(&entries, "word/charts/")));
        }
        FileKind::Xlsx => {
            let sheets = count_parts(&entries, "xl/worksheets/sheet");
            checks.push(check("has_sheets", sheets > 0, format!("{sheets} sheets")));
            let xml = all_xml("xl/worksheets/").concat();
            facts.push(("sheets".into(), sheets));
            facts.push(("formulas".into(), count_elements(&xml, "f") as u64));
            facts.push(("tables".into(), count_parts(&entries, "xl/tables/")));
            facts.push(("charts".into(), count_parts(&entries, "xl/charts/")));
        }
        _ => {
            let slides = count_parts(&entries, "ppt/slides/slide");
            checks.push(check("has_slides", slides > 0, format!("{slides} slides")));
            let xml = all_xml("ppt/slides/").concat();
            facts.push(("slides".into(), slides));
            facts.push(("tables".into(), count_elements(&xml, "a:tbl") as u64));
            facts.push(("charts".into(), count_parts(&entries, "ppt/charts/")));
            facts.push(("notes".into(), count_parts(&entries, "ppt/notesSlides/")));
        }
    }
    match extract(name, bytes) {
        Ok(text) => {
            checks.push(check("text_extractable", true, format!("{} characters", text.text.chars().count())));
            checks.push(expected_present(&text.text, expected));
        }
        Err(e) => checks.push(check("text_extractable", false, e)),
    }
    Verification::from(checks, facts)
}

fn verify_pdf(bytes: &[u8], expected: &[String], unsupported_glyphs: Option<usize>) -> Verification {
    let mut checks = Vec::new();
    let mut facts = Vec::new();
    match read_pdf(bytes) {
        Ok(info) => {
            checks.push(check("pdf_readable", true, format!("{} pages", info.pages)));
            facts.push(("pages".into(), info.pages as u64));
            checks.push(check("no_active_content", !info.active_content, "no JavaScript, launch action or embedded file"));
            checks.push(check("not_encrypted", !info.encrypted, "no /Encrypt dictionary"));
            let logical = pdf_logical_text(&info.text);
            // الكلمات تُطابق كلمة كلمة: الأسطر العربية تُستخرج بترتيب بصري للكلمات.
            let words: std::collections::BTreeSet<String> = logical.split_whitespace().map(str::to_lowercase).collect();
            let missing: Vec<String> = expected
                .iter()
                .flat_map(|e| e.split_whitespace().map(str::to_lowercase).collect::<Vec<_>>())
                .filter(|w| w.chars().count() > 1 && w.chars().all(char::is_alphanumeric) && !words.contains(w))
                .take(5)
                .collect();
            checks.push(check("expected_words_present", missing.is_empty(), if missing.is_empty() { "all expected words found".into() } else { format!("missing: {}", missing.join(" ")) }));
        }
        Err(e) => checks.push(check("pdf_readable", false, e)),
    }
    if let Some(n) = unsupported_glyphs {
        facts.push(("unsupported_glyphs".into(), n as u64));
        checks.push(check("all_glyphs_rendered", n == 0, format!("{n} characters had no glyph in the font")));
    }
    Verification::from(checks, facts)
}

/// يتحقّق من ملف واحد. `expected` نصوص يجب أن تظهر فيه (العنوان مثلًا).
pub fn verify_file(name: &str, bytes: &[u8], expected: &[String], unsupported_glyphs: Option<usize>) -> Verification {
    let kind = FileKind::from_name(name);
    match kind {
        FileKind::Docx | FileKind::Xlsx | FileKind::Pptx => verify_ooxml(name, bytes, kind, expected),
        FileKind::Pdf => verify_pdf(bytes, expected, unsupported_glyphs),
        FileKind::Csv => {
            let mut checks = Vec::new();
            let mut facts = Vec::new();
            match std::str::from_utf8(bytes).map_err(|_| "not UTF-8".to_string()).and_then(parse_csv) {
                Ok(rows) => {
                    let width = rows.first().map(Vec::len).unwrap_or(0);
                    checks.push(check("csv_parses", !rows.is_empty(), format!("{} rows", rows.len())));
                    checks.push(check("rectangular", rows.iter().all(|r| r.len() == width), format!("{width} columns")));
                    facts.push(("rows".into(), rows.len() as u64));
                    facts.push(("columns".into(), width as u64));
                    checks.push(expected_present(&rows.iter().map(|r| r.join(" ")).collect::<Vec<_>>().join("\n"), expected));
                }
                Err(e) => checks.push(check("csv_parses", false, e)),
            }
            Verification::from(checks, facts)
        }
        FileKind::Html => {
            let site = check_site(&[(name.rsplit('/').next().unwrap_or(name).to_string(), bytes.to_vec())]);
            let checks = vec![
                check("doctype_and_title", site.has_doctype && site.has_title, "a DOCTYPE and a non-empty title"),
                check("local_references_resolve", site.missing_local_refs.is_empty(), site.missing_local_refs.join(", ")),
                check("no_javascript_urls", site.javascript_urls == 0, format!("{}", site.javascript_urls)),
                expected_present(&String::from_utf8_lossy(bytes), expected),
            ];
            Verification::from(checks, vec![("remote_references".into(), site.remote_refs.len() as u64)])
        }
        FileKind::Text | FileKind::Markdown | FileKind::Json => {
            let text = std::str::from_utf8(bytes);
            let mut checks = vec![check("utf8_text", text.is_ok(), format!("{} bytes", bytes.len())), check("not_empty", !bytes.is_empty(), "")];
            if kind == FileKind::Json {
                let parsed = text.ok().and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok());
                checks.push(check("json_parses", parsed.is_some(), ""));
            }
            if let Ok(t) = text {
                checks.push(expected_present(t, expected));
            }
            Verification::from(checks, vec![("bytes".into(), bytes.len() as u64)])
        }
        FileKind::Unsupported => Verification::from(vec![check("supported_type", false, format!("{name} has no verifier"))], Vec::new()),
    }
}
