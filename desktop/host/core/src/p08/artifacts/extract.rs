// استخراج النصّ من ملفات Office وPDF والنصوص، للتحليل والتحقق.
//
// كل مخرجات هذا الملف بيانات غير موثوقة: نصّ من ملف مستخدم أو من ملف ولّده وكيل.
// لا يُنفَّذ منه شيء، ولا يُقرأ منه مسار ولا رابط يُتَّبع. الحجم محدود بسقف، والملف
// الذي لا يُفهم يُعلن غير مدعوم بدل تخمين محتواه.

use super::pdf::arabic::unshape;
use super::pdf::read_pdf;
use super::xml::{check_well_formed, texts_of, unescape};
use super::zip::{find, read_zip, ZipEntry};

pub const MAX_EXTRACT_CHARS: usize = 200_000;

/// نوع الملف كما يُستدلّ من امتداده. الامتداد وحده لا يُثق به للأمان، لكنه كافٍ لاختيار القارئ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Docx,
    Xlsx,
    Pptx,
    Pdf,
    Csv,
    Text,
    Markdown,
    Json,
    Html,
    Unsupported,
}

impl FileKind {
    pub fn from_name(name: &str) -> Self {
        let lower = name.to_ascii_lowercase();
        let ext = lower.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
        match ext {
            "docx" => Self::Docx,
            "xlsx" => Self::Xlsx,
            "pptx" => Self::Pptx,
            "pdf" => Self::Pdf,
            "csv" | "tsv" => Self::Csv,
            "txt" | "log" | "py" | "rs" | "ts" | "js" | "css" | "toml" | "yaml" | "yml" | "xml" | "ps1" | "java" | "c" | "h" | "cpp" | "go" => Self::Text,
            "md" | "markdown" => Self::Markdown,
            "json" => Self::Json,
            "html" | "htm" => Self::Html,
            _ => Self::Unsupported,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docx => "DOCX",
            Self::Xlsx => "XLSX",
            Self::Pptx => "PPTX",
            Self::Pdf => "PDF",
            Self::Csv => "CSV",
            Self::Text => "TEXT",
            Self::Markdown => "MARKDOWN",
            Self::Json => "JSON",
            Self::Html => "HTML",
            Self::Unsupported => "UNSUPPORTED",
        }
    }
}

fn bound(mut text: String) -> (String, bool) {
    if text.chars().count() <= MAX_EXTRACT_CHARS {
        return (text, false);
    }
    text = text.chars().take(MAX_EXTRACT_CHARS).collect();
    (text, true)
}

fn xml_part(entries: &[ZipEntry], name: &str) -> Result<String, String> {
    let entry = find(entries, name).ok_or_else(|| format!("the part {name} is missing"))?;
    let text = String::from_utf8(entry.data.clone()).map_err(|_| format!("the part {name} is not UTF-8"))?;
    check_well_formed(&text).map_err(|e| format!("the part {name} is not well-formed: {e}"))?;
    Ok(text)
}

fn docx_text(entries: &[ZipEntry]) -> Result<String, String> {
    let doc = xml_part(entries, "word/document.xml")?;
    let mut out = String::new();
    for paragraph in doc.split("</w:p>") {
        let line: String = texts_of(paragraph, "w:t").concat();
        if !line.is_empty() {
            out.push_str(&line);
            out.push('\n');
        }
    }
    Ok(out)
}

/// سلاسل المصنّف المشتركة بترتيبها.
fn shared_strings(entries: &[ZipEntry]) -> Vec<String> {
    let Ok(xml) = xml_part(entries, "xl/sharedStrings.xml") else { return Vec::new() };
    xml.split("</si>").filter(|s| s.contains("<si")).map(|si| texts_of(si, "t").concat()).collect()
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let at = tag.find(&key)? + key.len();
    let end = tag[at..].find('"')? + at;
    Some(&tag[at..end])
}

fn xlsx_text(entries: &[ZipEntry]) -> Result<String, String> {
    let workbook = xml_part(entries, "xl/workbook.xml")?;
    let names: Vec<String> = workbook.split("<sheet ").skip(1).filter_map(|t| attr(&format!(" {t}"), "name").map(unescape)).collect();
    let strings = shared_strings(entries);
    let mut out = String::new();
    let mut sheet_no = 1;
    while let Some(entry) = find(entries, &format!("xl/worksheets/sheet{sheet_no}.xml")) {
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        check_well_formed(&xml).map_err(|e| format!("sheet {sheet_no} is not well-formed: {e}"))?;
        out.push_str(&format!("# sheet: {}\n", names.get(sheet_no - 1).cloned().unwrap_or_else(|| format!("Sheet{sheet_no}"))));
        for row in xml.split("</row>").filter(|r| r.contains("<row")) {
            let mut cells = Vec::new();
            for cell in row.split("<c ").skip(1) {
                let head = format!(" {}", &cell[..cell.find('>').unwrap_or(0)]);
                let kind = attr(&head, "t").unwrap_or("n");
                let value = texts_of(cell, "v").into_iter().next();
                let formula = texts_of(cell, "f").into_iter().next();
                let text = match kind {
                    "s" => value.and_then(|v| v.parse::<usize>().ok()).and_then(|i| strings.get(i).cloned()).unwrap_or_default(),
                    "inlineStr" => texts_of(cell, "t").concat(),
                    _ => match (value, formula) {
                        (Some(v), _) => v,
                        (None, Some(f)) => format!("={f}"),
                        (None, None) => String::new(),
                    },
                };
                cells.push(text.replace(['\t', '\n'], " "));
            }
            out.push_str(&cells.join("\t"));
            out.push('\n');
        }
        sheet_no += 1;
    }
    if sheet_no == 1 {
        return Err("the workbook has no worksheet part".into());
    }
    Ok(out)
}

fn pptx_text(entries: &[ZipEntry]) -> Result<String, String> {
    let mut out = String::new();
    let mut n = 1;
    while find(entries, &format!("ppt/slides/slide{n}.xml")).is_some() {
        let xml = xml_part(entries, &format!("ppt/slides/slide{n}.xml"))?;
        out.push_str(&format!("# slide {n}\n"));
        for paragraph in xml.split("</a:p>") {
            let line: String = texts_of(paragraph, "a:t").concat();
            if !line.is_empty() {
                out.push_str(&line);
                out.push('\n');
            }
        }
        n += 1;
    }
    if n == 1 {
        return Err("the presentation has no slide part".into());
    }
    Ok(out)
}

/// نصّ PDF مستخرَج مع إعادة الكلمات العربية إلى ترتيبها المنطقي وحروفها الأساسية.
pub fn pdf_logical_text(visual: &str) -> String {
    visual
        .lines()
        .map(|line| {
            let words: Vec<String> = line
                .split(' ')
                .map(|w| if super::xml::is_rtl_text(w) { unshape(&w.chars().rev().collect::<String>()) } else { w.to_string() })
                .collect();
            words.join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// نتيجة الاستخراج.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Extracted {
    pub kind: FileKind,
    pub text: String,
    pub truncated: bool,
}

/// يستخرج نصّ ملف من بايتاته واسمه.
pub fn extract(name: &str, bytes: &[u8]) -> Result<Extracted, String> {
    let kind = FileKind::from_name(name);
    let text = match kind {
        FileKind::Docx => docx_text(&read_zip(bytes).map_err(|e| e.to_string())?)?,
        FileKind::Xlsx => xlsx_text(&read_zip(bytes).map_err(|e| e.to_string())?)?,
        FileKind::Pptx => pptx_text(&read_zip(bytes).map_err(|e| e.to_string())?)?,
        FileKind::Pdf => pdf_logical_text(&read_pdf(bytes)?.text),
        FileKind::Csv | FileKind::Text | FileKind::Markdown | FileKind::Json | FileKind::Html => {
            let raw = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
            String::from_utf8(raw.to_vec()).map_err(|_| "the file is not UTF-8 text".to_string())?
        }
        FileKind::Unsupported => return Err(format!("{name} is not a file type this build reads")),
    };
    let (text, truncated) = bound(text);
    Ok(Extracted { kind, text, truncated })
}
