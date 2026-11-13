// كاتب مستندات Word (DOCX) من نموذج المحتوى.
//
// الحزمة الناتجة لا تحوي ماكرو ولا كائنًا مضمّنًا ولا رابطًا خارجيًّا ولا حقلًا
// محسوبًا: نوع المحتوى هو `document.main+xml` لا `macroEnabled`، ولا علاقة
// `TargetMode="External"` في أي ملف علاقات. الاتجاه يُحدَّد لكل فقرة من نصّها، فيصحّ
// مستند عربي ومستند إنجليزي ومستند يخلطهما.

use super::chart::{chart_xml, ChartData};
use super::spec::{Block, DocumentSpec};
use super::xml::{escape, is_rtl_text};
use super::zip::write_zip;

const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const C_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";

struct Ctx {
    doc_rtl: bool,
    charts: Vec<String>,
}

fn run(text: &str, rtl: bool, bold: bool) -> String {
    let mut props = String::new();
    if bold {
        props.push_str("<w:b/><w:bCs/>");
    }
    if rtl {
        props.push_str("<w:rtl/>");
    }
    let rpr = if props.is_empty() { String::new() } else { format!("<w:rPr>{props}</w:rPr>") };
    format!("<w:r>{rpr}<w:t xml:space=\"preserve\">{}</w:t></w:r>", escape(text))
}

fn paragraph(ctx: &Ctx, style: Option<&str>, text: &str, numbered: bool, bold: bool) -> String {
    let rtl = ctx.doc_rtl || is_rtl_text(text);
    let mut ppr = String::new();
    if let Some(s) = style {
        ppr.push_str(&format!("<w:pStyle w:val=\"{s}\"/>"));
    }
    if numbered {
        ppr.push_str("<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr>");
    }
    if rtl {
        ppr.push_str("<w:bidi/>");
    }
    let ppr = if ppr.is_empty() { String::new() } else { format!("<w:pPr>{ppr}</w:pPr>") };
    format!("<w:p>{ppr}{}</w:p>", run(text, rtl, bold))
}

fn table(ctx: &Ctx, header: &[String], rows: &[Vec<String>]) -> String {
    let columns = header.len();
    let width = 9000 / columns.max(1);
    let rtl = ctx.doc_rtl || header.iter().any(|h| is_rtl_text(h));
    let mut out = String::from("<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/>");
    if rtl {
        out.push_str("<w:bidiVisual/>");
    }
    out.push_str("<w:tblBorders>");
    for side in ["top", "left", "bottom", "right", "insideH", "insideV"] {
        out.push_str(&format!("<w:{side} w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"8A94A6\"/>"));
    }
    out.push_str("</w:tblBorders></w:tblPr><w:tblGrid>");
    for _ in 0..columns {
        out.push_str(&format!("<w:gridCol w:w=\"{width}\"/>"));
    }
    out.push_str("</w:tblGrid>");
    let mut emit_row = |cells: &[String], is_header: bool| {
        out.push_str("<w:tr>");
        if is_header {
            out.push_str("<w:trPr><w:tblHeader/></w:trPr>");
        }
        for i in 0..columns {
            let text = cells.get(i).map(String::as_str).unwrap_or("");
            let shade = if is_header { "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E7ECF4\"/>" } else { "" };
            out.push_str(&format!("<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/>{shade}</w:tcPr>{}</w:tc>", paragraph(ctx, None, text, false, is_header)));
        }
        out.push_str("</w:tr>");
    };
    emit_row(header, true);
    for r in rows {
        emit_row(r, false);
    }
    out.push_str("</w:tbl>");
    // Word يتطلّب فقرة بين جدولين متتاليين؛ فقرة فارغة بعد كل جدول تضمن ذلك.
    out.push_str("<w:p/>");
    out
}

fn chart_paragraph(index: usize) -> String {
    format!(
        "<w:p><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"5486400\" cy=\"3017520\"/><wp:docPr id=\"{id}\" name=\"Chart {id}\"/><a:graphic xmlns:a=\"{A_NS}\"><a:graphicData uri=\"{C_NS}\"><c:chart xmlns:c=\"{C_NS}\" xmlns:r=\"{R_NS}\" r:id=\"rIdChart{id}\"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
        id = index
    )
}

fn document_xml(spec: &DocumentSpec, ctx: &mut Ctx) -> String {
    let mut body = paragraph(ctx, Some("Title"), &spec.title, false, false);
    for block in &spec.blocks {
        match block {
            Block::Heading { text, level } => body.push_str(&paragraph(ctx, Some(&format!("Heading{level}")), text, false, false)),
            Block::Paragraph { text } => {
                for line in text.split('\n') {
                    body.push_str(&paragraph(ctx, None, line, false, false));
                }
            }
            Block::Bullets { items } => {
                for item in items {
                    body.push_str(&paragraph(ctx, Some("ListParagraph"), item, true, false));
                }
            }
            Block::Table { header, rows } => body.push_str(&table(ctx, header, rows)),
            Block::Chart { chart } => {
                ctx.charts.push(chart_xml(&ChartData::Literal(chart)));
                body.push_str(&chart_paragraph(ctx.charts.len()));
            }
        }
    }
    let bidi = if ctx.doc_rtl { "<w:bidi/>" } else { "" };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"{W_NS}\" xmlns:r=\"{R_NS}\" xmlns:wp=\"{WP_NS}\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1304\" w:bottom=\"1440\" w:left=\"1304\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>{bidi}</w:sectPr></w:body></w:document>"
    )
}

fn styles_xml() -> String {
    let heading = |id: &str, name: &str, size: u32, color: &str| {
        format!(
            "<w:style w:type=\"paragraph\" w:styleId=\"{id}\"><w:name w:val=\"{name}\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before=\"240\" w:after=\"120\"/><w:outlineLvl w:val=\"{lvl}\"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val=\"{color}\"/><w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size}\"/></w:rPr></w:style>",
            lvl = id.trim_start_matches("Heading").parse::<u32>().map(|n| n - 1).unwrap_or(0)
        )
    };
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"{w}\">",
            "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Arial\" w:eastAsia=\"Calibri\"/><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"en-US\" w:bidi=\"ar-SA\"/></w:rPr></w:rPrDefault>",
            "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"276\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>",
            "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>",
            "<w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/><w:pPr><w:spacing w:after=\"240\"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val=\"14213D\"/><w:sz w:val=\"48\"/><w:szCs w:val=\"48\"/></w:rPr></w:style>",
            "{h1}{h2}{h3}",
            "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:ind w:left=\"720\"/></w:pPr></w:style>",
            "</w:styles>"
        ),
        w = W_NS,
        h1 = heading("Heading1", "heading 1", 32, "1F3A68"),
        h2 = heading("Heading2", "heading 2", 28, "1F3A68"),
        h3 = heading("Heading3", "heading 3", 24, "33415C"),
    )
}

fn numbering_xml() -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:numbering xmlns:w=\"{W_NS}\"><w:abstractNum w:abstractNumId=\"0\"><w:multiLevelType w:val=\"singleLevel\"/><w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/><w:lvlText w:val=\"\u{2022}\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num></w:numbering>"
    )
}

/// خصائص المستند الأساسية. التاريخ يُمرَّر من ساعة التشغيل، لا يُقرأ هنا.
pub fn core_props(title: &str, created_utc: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>{}</dc:title><dc:creator>POLARIS</dc:creator><dcterms:created xsi:type=\"dcterms:W3CDTF\">{created_utc}</dcterms:created><dcterms:modified xsi:type=\"dcterms:W3CDTF\">{created_utc}</dcterms:modified></cp:coreProperties>",
        escape(title)
    )
}

pub fn app_props() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>POLARIS</Application></Properties>".into()
}

pub const PACKAGE_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"{MAIN}\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/><Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/></Relationships>";

/// يكتب الحزمة كاملة. `created_utc` بصيغة `YYYY-MM-DDTHH:MM:SSZ`.
pub fn write_docx(spec: &DocumentSpec, created_utc: &str) -> Result<Vec<u8>, String> {
    spec.validate().map_err(|e| e.0)?;
    let mut ctx = Ctx { doc_rtl: spec.is_rtl(), charts: Vec::new() };
    let document = document_xml(spec, &mut ctx);
    let mut overrides = String::from(concat!(
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>",
        "<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>",
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
        "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
    ));
    let mut rels = String::from(concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
        "<Relationship Id=\"rIdNumbering\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/>"
    ));
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for (i, chart) in ctx.charts.iter().enumerate() {
        let n = i + 1;
        overrides.push_str(&format!("<Override PartName=\"/word/charts/chart{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawingml.chart+xml\"/>"));
        rels.push_str(&format!("<Relationship Id=\"rIdChart{n}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart\" Target=\"charts/chart{n}.xml\"/>"));
        entries.push((format!("word/charts/chart{n}.xml"), chart.clone().into_bytes()));
    }
    rels.push_str("</Relationships>");
    let content_types = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>{overrides}</Types>"
    );
    let mut all = vec![
        ("[Content_Types].xml".to_string(), content_types.into_bytes()),
        ("_rels/.rels".to_string(), PACKAGE_RELS.replace("{MAIN}", "word/document.xml").into_bytes()),
        ("word/document.xml".to_string(), document.into_bytes()),
        ("word/_rels/document.xml.rels".to_string(), rels.into_bytes()),
        ("word/styles.xml".to_string(), styles_xml().into_bytes()),
        ("word/numbering.xml".to_string(), numbering_xml().into_bytes()),
        ("docProps/core.xml".to_string(), core_props(&spec.title, created_utc).into_bytes()),
        ("docProps/app.xml".to_string(), app_props().into_bytes()),
    ];
    all.extend(entries);
    write_zip(&all).map_err(|e| e.to_string())
}
