// P08-ARTIFACTS: كل كاتب يُنتج ملفًا يُعاد فتحه ويجتاز التحقق، بالعربية والإنجليزية.
//
// إن ضُبط `POLARIS_P08_ARTIFACT_OUT` تُحفظ الملفات هناك ليفتحها قارئ مستقل (Office أو
// LibreOffice أو مكتبات Python) في مُشغّل المرحلة. و`POLARIS_P08_PDF_FONT` يسمّي خط
// TrueType يُضمَّن في PDF العربي؛ غيابه يجعل اختبار PDF العربي يفشل صراحةً لا يُتخطّى.

use polaris_host_core::p08::artifacts::docx::write_docx;
use polaris_host_core::p08::artifacts::pdf::{write_pdf, TrueTypeFont};
use polaris_host_core::p08::artifacts::pptx::write_pptx;
use polaris_host_core::p08::artifacts::spec::{DeckSpec, DocumentSpec, WorkbookSpec};
use polaris_host_core::p08::artifacts::text::{document_markdown, write_csv};
use polaris_host_core::p08::artifacts::verify::verify_file;
use polaris_host_core::p08::artifacts::web::document_html;
use polaris_host_core::p08::artifacts::xlsx::write_xlsx;

const CREATED: &str = "2026-09-25T00:00:00Z";

fn keep(name: &str, bytes: &[u8]) {
    if let Ok(dir) = std::env::var("POLARIS_P08_ARTIFACT_OUT") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(std::path::Path::new(&dir).join(name), bytes).unwrap();
    }
}

fn english_document() -> DocumentSpec {
    serde_json::from_value(serde_json::json!({
        "title": "Quarterly Operations Report",
        "language": "en",
        "blocks": [
            {"type": "heading", "text": "Summary", "level": 1},
            {"type": "paragraph", "text": "Revenue grew in every region. Costs stayed within the approved budget."},
            {"type": "bullets", "items": ["North region led growth", "Support tickets fell by a third"]},
            {"type": "table", "header": ["Region", "Revenue", "Growth"], "rows": [["North", "1200", "12%"], ["South", "900", "7%"]]},
            {"type": "chart", "chart": {"title": "Revenue by region", "kind": "bar", "categories": ["North", "South"], "series": [{"name": "2026", "values": [1200, 900]}]}}
        ]
    }))
    .unwrap()
}

fn arabic_document() -> DocumentSpec {
    serde_json::from_value(serde_json::json!({
        "title": "تقرير المبيعات الربعي",
        "language": "ar",
        "blocks": [
            {"type": "heading", "text": "الملخص", "level": 1},
            {"type": "paragraph", "text": "نمت الإيرادات في جميع المناطق خلال عام 2026."},
            {"type": "bullets", "items": ["المنطقة الشمالية تصدّرت النمو", "انخفضت تذاكر الدعم"]},
            {"type": "table", "header": ["المنطقة", "الإيراد"], "rows": [["الشمال", "1200"], ["الجنوب", "900"]]},
            {"type": "chart", "chart": {"title": "الإيراد حسب المنطقة", "categories": ["الشمال", "الجنوب"], "series": [{"name": "2026", "values": [1200, 900]}]}}
        ]
    }))
    .unwrap()
}

fn assert_verified(name: &str, bytes: &[u8], expected: &[&str], glyphs: Option<usize>) -> polaris_host_core::p08::artifacts::verify::Verification {
    let expected: Vec<String> = expected.iter().map(|s| s.to_string()).collect();
    let v = verify_file(name, bytes, &expected, glyphs);
    assert!(v.verified(), "{name} failed verification: {:#?}", v.checks);
    keep(name, bytes);
    v
}

#[test]
fn docx_in_both_directions_reopens_and_verifies() {
    let en = write_docx(&english_document(), CREATED).unwrap();
    let v = assert_verified("mission-a-report.docx", &en, &["Quarterly Operations Report", "Revenue grew in every region"], None);
    assert_eq!(v.fact("tables"), Some(1));
    assert_eq!(v.fact("charts"), Some(1));
    let ar = write_docx(&arabic_document(), CREATED).unwrap();
    assert_verified("arabic-report.docx", &ar, &["تقرير المبيعات الربعي", "نمت الإيرادات"], None);
}

#[test]
fn xlsx_with_formulas_table_and_chart_reopens_and_verifies() {
    let spec: WorkbookSpec = serde_json::from_value(serde_json::json!({
        "title": "Sales analysis",
        "sheets": [{
            "name": "Data",
            "header": ["Region", "Q1", "Q2", "Total"],
            "rows": [["North", 100, 120, "=SUM(B2:C2)"], ["South", 80, 95, "=SUM(B3:C3)"], ["East", 60.5, 70, "=SUM(B4:C4)"]],
            "chart": {"title": "Quarterly sales", "value_columns": [1, 2]}
        }, {
            "name": "ملخص",
            "header": ["المؤشر", "القيمة"],
            "rows": [["الإجمالي", "=SUM(Data!D2:D4)"]]
        }]
    }))
    .unwrap();
    let bytes = write_xlsx(&spec, CREATED).unwrap();
    let v = assert_verified("mission-b-analysis.xlsx", &bytes, &["North", "Region", "الإجمالي"], None);
    assert_eq!(v.fact("sheets"), Some(2));
    assert_eq!(v.fact("formulas"), Some(4));
    assert_eq!(v.fact("tables"), Some(2));
    assert_eq!(v.fact("charts"), Some(1));
}

#[test]
fn pptx_with_table_chart_and_notes_reopens_and_verifies() {
    let deck: DeckSpec = serde_json::from_value(serde_json::json!({
        "title": "POLARIS Quarterly Review",
        "subtitle": "Operations, 2026",
        "slides": [
            {"title": "Highlights", "bullets": ["Revenue up 12%", "Costs on budget"], "notes": "Open with the growth number."},
            {"title": "By region", "table": {"header": ["Region", "Revenue"], "rows": [["North", "1200"], ["South", "900"]]}},
            {"title": "Trend", "bullets": ["Steady growth"], "chart": {"title": "Revenue", "kind": "line", "categories": ["Q1", "Q2", "Q3"], "series": [{"name": "2026", "values": [10, 12, 15]}]}}
        ]
    }))
    .unwrap();
    let bytes = write_pptx(&deck, CREATED).unwrap();
    let v = assert_verified("review-deck.pptx", &bytes, &["POLARIS Quarterly Review", "Revenue up 12%", "North"], None);
    assert_eq!(v.fact("slides"), Some(4));
    assert_eq!(v.fact("charts"), Some(1));
    assert_eq!(v.fact("notes"), Some(1));
    assert_eq!(v.fact("tables"), Some(1));
    let ar_deck: DeckSpec = serde_json::from_value(serde_json::json!({
        "title": "مراجعة الربع", "language": "ar",
        "slides": [{"title": "أبرز النتائج", "bullets": ["نمو الإيرادات", "التكاليف ضمن الميزانية"], "chart": {"title": "الإيراد", "categories": ["س1", "س2"], "series": [{"name": "2026", "values": [1, 2]}]}}]
    }))
    .unwrap();
    assert_verified("arabic-deck.pptx", &write_pptx(&ar_deck, CREATED).unwrap(), &["مراجعة الربع", "نمو الإيرادات"], None);
}

#[test]
fn a_latin_pdf_uses_standard_fonts_and_verifies() {
    let out = write_pdf(&english_document(), None, CREATED).unwrap();
    assert_eq!(out.unsupported_glyphs, 0);
    let v = assert_verified("mission-b-report.pdf", &out.bytes, &["Quarterly Operations Report", "Revenue grew"], Some(out.unsupported_glyphs));
    assert!(v.fact("pages").unwrap() >= 1);
}

#[test]
fn an_arabic_pdf_without_an_embedded_font_is_reported_not_passed() {
    let out = write_pdf(&arabic_document(), None, CREATED).unwrap();
    assert!(out.unsupported_glyphs > 0);
    let v = verify_file("x.pdf", &out.bytes, &[], Some(out.unsupported_glyphs));
    assert!(!v.verified(), "a PDF whose Arabic was replaced must not verify");
}

#[test]
fn an_arabic_pdf_with_an_embedded_font_renders_and_extracts_logically() {
    // الخط: ما يسمّيه POLARIS_P08_PDF_FONT، وإلا خط نظام معروف فيه حروف عربية (Arial على ويندوز،
    // DejaVu على لينكس). لا خط أبدًا ← فشل صريح، لا تخطٍّ صامت.
    let known = [r"C:\Windows\Fonts\arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"];
    let path = std::env::var("POLARIS_P08_PDF_FONT")
        .ok()
        .or_else(|| known.iter().find(|p| std::path::Path::new(p).exists()).map(|p| p.to_string()))
        .expect("POLARIS_P08_PDF_FONT must name a TrueType font with Arabic glyphs (no known system font was found)");
    let font = TrueTypeFont::parse(std::fs::read(path).unwrap()).unwrap();
    let out = write_pdf(&arabic_document(), Some(&font), CREATED).unwrap();
    assert!(out.embedded_font);
    assert_verified("arabic-report.pdf", &out.bytes, &["تقرير المبيعات الربعي", "الملخص", "2026"], Some(out.unsupported_glyphs));
    // وخط مضمَّن يرسم الإنجليزية أيضًا.
    let en = write_pdf(&english_document(), Some(&font), CREATED).unwrap();
    assert_verified("english-embedded.pdf", &en.bytes, &["Quarterly Operations Report"], Some(en.unsupported_glyphs));
}

#[test]
fn a_long_document_paginates() {
    let mut spec = english_document();
    for i in 0..120 {
        spec.blocks.push(polaris_host_core::p08::artifacts::spec::Block::Paragraph { text: format!("Paragraph {i} describes the operational detail of the quarter in plain words.") });
    }
    let out = write_pdf(&spec, None, CREATED).unwrap();
    assert!(out.pages >= 3, "{} pages", out.pages);
    let v = verify_file("long.pdf", &out.bytes, &["Paragraph 119".to_string()], Some(0));
    assert!(v.verified(), "{:#?}", v.checks);
    assert_eq!(v.fact("pages"), Some(out.pages as u64));
}

#[test]
fn html_markdown_and_csv_verify() {
    let html = document_html(&arabic_document()).unwrap();
    assert_verified("arabic-report.html", html.as_bytes(), &["تقرير المبيعات الربعي"], None);
    let md = document_markdown(&english_document()).unwrap();
    assert_verified("report.md", md.as_bytes(), &["# Quarterly Operations Report"], None);
    let csv = write_csv(&["Region".into(), "Revenue".into()], &[vec!["North".into(), "1200".into()]]);
    assert_verified("data.csv", &csv, &["North"], None);
}
