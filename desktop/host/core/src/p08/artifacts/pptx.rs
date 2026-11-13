// كاتب العروض التقديمية (PPTX): شرائح بعناوين ونقاط وجداول ومخططات وملاحظات متحدّث.
//
// الشريحة الأولى غلاف (عنوان العرض وعنوانه الفرعي)، ثم شريحة لكل عنصر في النموذج.
// حين تحمل الشريحة نقاطًا ومرئيًّا معًا يُقسم العرض نصفين، وإلا يأخذ العنصر العرض
// كله. لا ماكرو ولا كائن OLE ولا صوت ولا فيديو ولا رابط خارجي.

use super::chart::{chart_xml, ChartData};
use super::docx::{app_props, core_props, PACKAGE_RELS};
use super::pptx_parts::*;
use super::spec::{DeckSpec, SlideSpec, TableSpec};
use super::xml::{escape, is_rtl_text};
use super::zip::write_zip;

const SLIDE_W: i64 = 12_192_000;
const LEFT: i64 = 609_600;
const TOP: i64 = 1_463_040;
const CONTENT_W: i64 = 10_972_800;
const CONTENT_H: i64 = 4_754_880;

fn paragraph(text: &str, rtl: bool, bullet: bool, size: Option<u32>, bold: bool) -> String {
    let rtl = rtl || is_rtl_text(text);
    let mut ppr = String::new();
    if rtl {
        ppr.push_str(" rtl=\"1\" algn=\"r\"");
    }
    if !bullet {
        ppr.push_str(" marL=\"0\" indent=\"0\"");
    }
    let bu = if bullet { "" } else { "<a:buNone/>" };
    let mut rpr = String::from(" lang=\"");
    rpr.push_str(if rtl { "ar-SA" } else { "en-US" });
    rpr.push('"');
    if let Some(s) = size {
        rpr.push_str(&format!(" sz=\"{s}\""));
    }
    if bold {
        rpr.push_str(" b=\"1\"");
    }
    format!("<a:p><a:pPr{ppr}>{bu}</a:pPr><a:r><a:rPr{rpr} dirty=\"0\"/><a:t>{}</a:t></a:r></a:p>", escape(text))
}

fn text_shape(id: u32, name: &str, ph: &str, frame: Option<(i64, i64, i64, i64)>, paragraphs: &str) -> String {
    let xfrm = match frame {
        Some((x, y, cx, cy)) => format!("<a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>"),
        None => String::new(),
    };
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{name}\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr>{xfrm}</p:spPr><p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>{paragraphs}</p:txBody></p:sp>"
    )
}

fn table_frame(id: u32, table: &TableSpec, rtl: bool, frame: (i64, i64, i64, i64)) -> String {
    let (x, y, cx, _) = frame;
    let columns = table.header.len() as i64;
    let col_w = cx / columns.max(1);
    let row_h: i64 = 370_840;
    let total_h = row_h * (table.rows.len() as i64 + 1);
    let mut grid = String::new();
    for _ in 0..columns {
        grid.push_str(&format!("<a:gridCol w=\"{col_w}\"/>"));
    }
    let cell = |text: &str, header: bool| {
        let fill = if header { "<a:solidFill><a:srgbClr val=\"14213D\"/></a:solidFill>" } else { "<a:solidFill><a:srgbClr val=\"EEF2F8\"/></a:solidFill>" };
        let color = if header { "<a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill>" } else { "" };
        let rtl_attr = if rtl || is_rtl_text(text) { " rtl=\"1\" algn=\"r\"" } else { "" };
        format!(
            "<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr{rtl_attr}/><a:r><a:rPr lang=\"en-US\" sz=\"1400\"{b} dirty=\"0\">{color}</a:rPr><a:t>{}</a:t></a:r></a:p></a:txBody><a:tcPr>{fill}</a:tcPr></a:tc>",
            escape(text),
            b = if header { " b=\"1\"" } else { "" }
        )
    };
    let mut rows = format!("<a:tr h=\"{row_h}\">");
    for h in &table.header {
        rows.push_str(&cell(h, true));
    }
    rows.push_str("</a:tr>");
    for r in &table.rows {
        rows.push_str(&format!("<a:tr h=\"{row_h}\">"));
        for i in 0..table.header.len() {
            rows.push_str(&cell(r.get(i).map(String::as_str).unwrap_or(""), false));
        }
        rows.push_str("</a:tr>");
    }
    let rtl_tbl = if rtl { " rtl=\"1\"" } else { "" };
    format!(
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"{id}\" name=\"Table {id}\"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp=\"1\"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{total_h}\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl><a:tblPr firstRow=\"1\" bandRow=\"1\"{rtl_tbl}/><a:tblGrid>{grid}</a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"
    )
}

fn chart_frame(id: u32, rel: &str, frame: (i64, i64, i64, i64)) -> String {
    let (x, y, cx, cy) = frame;
    format!(
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"{id}\" name=\"Chart {id}\"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></p:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/chart\"><c:chart xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:r=\"{R_NS}\" r:id=\"{rel}\"/></a:graphicData></a:graphic></p:graphicFrame>"
    )
}

fn slide_document(tree: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:sld xmlns:a=\"{A_NS}\" xmlns:r=\"{R_NS}\" xmlns:p=\"{P_NS}\"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>{tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )
}

fn notes_document(text: &str, rtl: bool) -> String {
    let mut paragraphs = String::new();
    for line in text.split('\n') {
        paragraphs.push_str(&paragraph(line, rtl, false, None, false));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:notes xmlns:a=\"{A_NS}\" xmlns:r=\"{R_NS}\" xmlns:p=\"{P_NS}\"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>",
        text_shape(2, "Notes Placeholder 1", "<p:ph type=\"body\" idx=\"1\"/>", None, &paragraphs)
    )
}

/// علاقات جزء واحد: (المعرّف، النوع، الهدف).
type Rels = Vec<(String, &'static str, String)>;

struct Built {
    slide: String,
    rels: Rels,
    chart: Option<String>,
    notes: Option<String>,
}

fn build_slide(spec: &SlideSpec, rtl: bool, chart_no: &mut usize, slide_no: usize) -> Built {
    let mut tree = text_shape(2, "Title 1", "<p:ph type=\"title\"/>", None, &paragraph(&spec.title, rtl, false, None, true));
    let has_visual = spec.table.is_some() || spec.chart.is_some();
    let split = !spec.bullets.is_empty() && has_visual;
    let half = CONTENT_W / 2 - 152_400;
    // في العرض العربي يبدأ النصّ من اليمين، فيُعكس ترتيب النصفين.
    let (text_x, visual_x) = if rtl { (LEFT + half + 304_800, LEFT) } else { (LEFT, LEFT + half + 304_800) };
    if !spec.bullets.is_empty() {
        let mut paragraphs = String::new();
        for b in &spec.bullets {
            paragraphs.push_str(&paragraph(b, rtl, true, None, false));
        }
        let frame = if split { Some((text_x, TOP, half, CONTENT_H)) } else { None };
        tree.push_str(&text_shape(3, "Content 2", "<p:ph idx=\"1\"/>", frame, &paragraphs));
    }
    let visual_frame = if split { (visual_x, TOP, half, CONTENT_H) } else { (LEFT, TOP, CONTENT_W, CONTENT_H) };
    let mut rels = vec![("rIdLayout".to_string(), "slideLayout", "../slideLayouts/slideLayout1.xml".to_string())];
    let mut chart = None;
    if let Some(table) = &spec.table {
        let frame = if spec.chart.is_some() { (visual_frame.0, visual_frame.1, visual_frame.2, visual_frame.3 / 2) } else { visual_frame };
        tree.push_str(&table_frame(4, table, rtl, frame));
    }
    if let Some(c) = &spec.chart {
        *chart_no += 1;
        let frame = if spec.table.is_some() {
            (visual_frame.0, visual_frame.1 + visual_frame.3 / 2, visual_frame.2, visual_frame.3 / 2)
        } else {
            visual_frame
        };
        tree.push_str(&chart_frame(5, "rIdChart", frame));
        rels.push(("rIdChart".to_string(), "chart", format!("../charts/chart{chart_no}.xml")));
        chart = Some(chart_xml(&ChartData::Literal(c)));
    }
    let notes = spec.notes.as_ref().filter(|n| !n.trim().is_empty()).map(|n| {
        rels.push(("rIdNotes".to_string(), "notesSlide", format!("../notesSlides/notesSlide{slide_no}.xml")));
        notes_document(n, rtl)
    });
    Built { slide: slide_document(&tree), rels, chart, notes }
}

fn cover_slide(deck: &DeckSpec, rtl: bool) -> String {
    let mut title = paragraph(&deck.title, rtl, false, Some(4000), true);
    let sub = deck.subtitle.clone().unwrap_or_default();
    let subtitle = if sub.trim().is_empty() { String::new() } else { paragraph(&sub, rtl, false, Some(2000), false) };
    title = text_shape(2, "Title 1", "<p:ph type=\"title\"/>", Some((LEFT, 2_286_000, CONTENT_W, 1_371_600)), &title);
    let mut tree = title;
    if !subtitle.is_empty() {
        tree.push_str(&text_shape(3, "Subtitle 2", "<p:ph idx=\"1\"/>", Some((LEFT, 3_749_040, CONTENT_W, 914_400)), &subtitle));
    }
    // شريط لوني هادئ أسفل الغلاف: هوية بصرية لا أصل مأخوذ.
    tree.push_str(&format!("<p:sp><p:nvSpPr><p:cNvPr id=\"9\" name=\"Accent\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"0\" y=\"6400800\"/><a:ext cx=\"{SLIDE_W}\" cy=\"457200\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val=\"14213D\"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>"));
    slide_document(&tree)
}

/// يكتب العرض كاملًا.
pub fn write_pptx(deck: &DeckSpec, created_utc: &str) -> Result<Vec<u8>, String> {
    deck.validate().map_err(|e| e.0)?;
    let rtl = deck.is_rtl();
    let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
    let mut overrides = String::from(concat!(
        "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>",
        "<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>",
        "<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>",
        "<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>",
        "<Override PartName=\"/ppt/presProps.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presProps+xml\"/>",
        "<Override PartName=\"/ppt/viewProps.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml\"/>",
        "<Override PartName=\"/ppt/tableStyles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml\"/>",
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
        "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
    ));
    let mut pres_rels = vec![
        ("rIdMaster".to_string(), "slideMaster", "slideMasters/slideMaster1.xml".to_string()),
        ("rIdTheme".to_string(), "theme", "theme/theme1.xml".to_string()),
        ("rIdPresProps".to_string(), "presProps", "presProps.xml".to_string()),
        ("rIdViewProps".to_string(), "viewProps", "viewProps.xml".to_string()),
        ("rIdTableStyles".to_string(), "tableStyles", "tableStyles.xml".to_string()),
    ];
    let mut slide_ids = String::new();
    let mut slides: Vec<(String, Rels)> = vec![(cover_slide(deck, rtl), vec![("rIdLayout".to_string(), "slideLayout", "../slideLayouts/slideLayout1.xml".to_string())])];
    let mut chart_no = 0;
    let mut any_notes = false;
    for (i, s) in deck.slides.iter().enumerate() {
        let slide_no = i + 2;
        let built = build_slide(s, rtl, &mut chart_no, slide_no);
        if let Some(chart) = built.chart {
            parts.push((format!("ppt/charts/chart{chart_no}.xml"), chart.into_bytes()));
            overrides.push_str(&format!("<Override PartName=\"/ppt/charts/chart{chart_no}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawingml.chart+xml\"/>"));
        }
        if let Some(notes) = built.notes {
            any_notes = true;
            parts.push((format!("ppt/notesSlides/notesSlide{slide_no}.xml"), notes.into_bytes()));
            parts.push((
                format!("ppt/notesSlides/_rels/notesSlide{slide_no}.xml.rels"),
                rels(&[
                    ("rId1".to_string(), "notesMaster", "../notesMasters/notesMaster1.xml".to_string()),
                    ("rId2".to_string(), "slide", format!("../slides/slide{slide_no}.xml")),
                ])
                .into_bytes(),
            ));
            overrides.push_str(&format!("<Override PartName=\"/ppt/notesSlides/notesSlide{slide_no}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml\"/>"));
        }
        slides.push((built.slide, built.rels));
    }
    for (i, (xml, slide_rels)) in slides.iter().enumerate() {
        let n = i + 1;
        parts.push((format!("ppt/slides/slide{n}.xml"), xml.clone().into_bytes()));
        parts.push((format!("ppt/slides/_rels/slide{n}.xml.rels"), rels(slide_rels).into_bytes()));
        overrides.push_str(&format!("<Override PartName=\"/ppt/slides/slide{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"));
        pres_rels.push((format!("rIdSlide{n}"), "slide", format!("slides/slide{n}.xml")));
        slide_ids.push_str(&format!("<p:sldId id=\"{}\" r:id=\"rIdSlide{n}\"/>", 255 + n));
    }
    let mut notes_master_list = String::new();
    if any_notes {
        pres_rels.push(("rIdNotesMaster".to_string(), "notesMaster", "notesMasters/notesMaster1.xml".to_string()));
        notes_master_list = "<p:notesMasterIdLst><p:notesMasterId r:id=\"rIdNotesMaster\"/></p:notesMasterIdLst>".into();
        parts.push(("ppt/notesMasters/notesMaster1.xml".into(), notes_master_xml().into_bytes()));
        parts.push(("ppt/notesMasters/_rels/notesMaster1.xml.rels".into(), rels(&[("rId1".to_string(), "theme", "../theme/theme2.xml".to_string())]).into_bytes()));
        parts.push(("ppt/theme/theme2.xml".into(), theme_xml("POLARIS Notes").into_bytes()));
        overrides.push_str("<Override PartName=\"/ppt/notesMasters/notesMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml\"/><Override PartName=\"/ppt/theme/theme2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>");
    }
    let presentation = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:presentation xmlns:a=\"{A_NS}\" xmlns:r=\"{R_NS}\" xmlns:p=\"{P_NS}\" saveSubsetFonts=\"1\"{rtl_attr}><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rIdMaster\"/></p:sldMasterIdLst>{notes_master_list}<p:sldIdLst>{slide_ids}</p:sldIdLst><p:sldSz cx=\"{SLIDE_W}\" cy=\"6858000\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz=\"1800\"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>",
        rtl_attr = if rtl { " rtl=\"1\"" } else { "" }
    );
    let content_types = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>{overrides}</Types>"
    );
    let mut all = vec![
        ("[Content_Types].xml".to_string(), content_types.into_bytes()),
        ("_rels/.rels".to_string(), PACKAGE_RELS.replace("{MAIN}", "ppt/presentation.xml").into_bytes()),
        ("ppt/presentation.xml".to_string(), presentation.into_bytes()),
        ("ppt/_rels/presentation.xml.rels".to_string(), rels(&pres_rels).into_bytes()),
        ("ppt/slideMasters/slideMaster1.xml".to_string(), slide_master_xml().into_bytes()),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels".to_string(), rels(&[("rId1".to_string(), "slideLayout", "../slideLayouts/slideLayout1.xml".to_string()), ("rId2".to_string(), "theme", "../theme/theme1.xml".to_string())]).into_bytes()),
        ("ppt/slideLayouts/slideLayout1.xml".to_string(), slide_layout_xml().into_bytes()),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels".to_string(), rels(&[("rId1".to_string(), "slideMaster", "../slideMasters/slideMaster1.xml".to_string())]).into_bytes()),
        ("ppt/theme/theme1.xml".to_string(), theme_xml("POLARIS").into_bytes()),
        ("ppt/presProps.xml".to_string(), PRES_PROPS.as_bytes().to_vec()),
        ("ppt/viewProps.xml".to_string(), VIEW_PROPS.as_bytes().to_vec()),
        ("ppt/tableStyles.xml".to_string(), TABLE_STYLES.as_bytes().to_vec()),
        ("docProps/core.xml".to_string(), core_props(&deck.title, created_utc).into_bytes()),
        ("docProps/app.xml".to_string(), app_props().into_bytes()),
    ];
    all.extend(parts);
    write_zip(&all).map_err(|e| e.to_string())
}
