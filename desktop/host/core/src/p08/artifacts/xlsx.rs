// كاتب مصنّفات Excel (XLSX): أوراق وصيغ وتنسيق وجداول Excel ومخططات.
//
// لا ماكرو (`.xlsm` غير ممكن بنيويًّا من هنا)، ولا وصلة خارجية، ولا اتصال بيانات.
// الصيغ تمرّ بقائمة رفض قبل الكتابة (spec::formula_ok)، وتُكتب بلا قيمة مخبّأة مع
// `fullCalcOnLoad` فيحسبها التطبيق الذي يفتح الملف ولا يثق بقيمة ادّعاها كاتب.

use super::chart::{cell_ref, chart_xml, ChartData};
use super::docx::{app_props, core_props, PACKAGE_RELS};
use super::spec::{CellValue, ChartSeries, ChartSpec, SheetSpec, WorkbookSpec};
use super::xml::{escape, is_rtl_text};
use super::zip::write_zip;

const MAIN_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

fn cell_xml(column: usize, row: usize, value: &CellValue, style: u32) -> String {
    let r = cell_ref(column, row);
    match value {
        CellValue::Empty => String::new(),
        CellValue::Number(n) => format!("<c r=\"{r}\" s=\"{}\"><v>{n}</v></c>", if n.fract() == 0.0 { style } else { 2 }),
        CellValue::Text(t) if t.starts_with('=') && t.len() > 1 => format!("<c r=\"{r}\" s=\"{style}\"><f>{}</f></c>", escape(&t[1..])),
        CellValue::Text(t) => format!("<c r=\"{r}\" s=\"{style}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>", escape(t)),
    }
}

fn width_of(sheet: &SheetSpec) -> usize {
    sheet.header.len().max(sheet.rows.iter().map(Vec::len).max().unwrap_or(0))
}

/// هل يصلح رأس الورقة لجدول Excel؟ أسماء أعمدة فريدة غير فارغة، وصفّ بيانات واحد على الأقل.
fn table_eligible(sheet: &SheetSpec) -> bool {
    if sheet.header.is_empty() || sheet.rows.is_empty() || sheet.header.len() != width_of(sheet) {
        return false;
    }
    let mut seen = std::collections::BTreeSet::new();
    sheet.header.iter().all(|h| !h.trim().is_empty() && seen.insert(h.to_lowercase()))
}

fn sheet_xml(sheet: &SheetSpec, has_drawing: bool, has_table: bool) -> String {
    let width = width_of(sheet);
    let rtl = is_rtl_text(&sheet.name) || sheet.header.iter().any(|h| is_rtl_text(h));
    let mut rows = String::new();
    let mut row_no = 1;
    if !sheet.header.is_empty() {
        rows.push_str("<row r=\"1\">");
        for (c, h) in sheet.header.iter().enumerate() {
            rows.push_str(&cell_xml(c, 1, &CellValue::Text(h.clone()), 1));
        }
        rows.push_str("</row>");
        row_no = 2;
    }
    for data in &sheet.rows {
        rows.push_str(&format!("<row r=\"{row_no}\">"));
        for (c, v) in data.iter().enumerate() {
            rows.push_str(&cell_xml(c, row_no, v, 0));
        }
        rows.push_str("</row>");
        row_no += 1;
    }
    let last_row = (row_no - 1).max(1);
    let mut cols = String::from("<cols>");
    for c in 0..width {
        let longest = sheet
            .header
            .get(c)
            .map(|h| h.chars().count())
            .into_iter()
            .chain(sheet.rows.iter().filter_map(|r| r.get(c)).map(|v| match v {
                CellValue::Text(t) => t.chars().count(),
                CellValue::Number(n) => n.to_string().len(),
                CellValue::Empty => 0,
            }))
            .max()
            .unwrap_or(8);
        let w = (longest as f64 * 1.2 + 2.0).clamp(8.0, 60.0);
        cols.push_str(&format!("<col min=\"{n}\" max=\"{n}\" width=\"{w:.1}\" customWidth=\"1\"/>", n = c + 1));
    }
    cols.push_str("</cols>");
    let dimension = format!("A1:{}", cell_ref(width.saturating_sub(1), last_row));
    let view = format!(
        "<sheetViews><sheetView workbookViewId=\"0\"{}>{}</sheetView></sheetViews>",
        if rtl { " rightToLeft=\"1\"" } else { "" },
        if sheet.header.is_empty() { String::new() } else { "<pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>".into() }
    );
    let drawing = if has_drawing { "<drawing r:id=\"rIdDrawing\"/>" } else { "" };
    let table = if has_table { "<tableParts count=\"1\"><tablePart r:id=\"rIdTable\"/></tableParts>" } else { "" };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"{MAIN_NS}\" xmlns:r=\"{R_NS}\"><dimension ref=\"{dimension}\"/>{view}<sheetFormatPr defaultRowHeight=\"15\"/>{cols}<sheetData>{rows}</sheetData><pageMargins left=\"0.7\" right=\"0.7\" top=\"0.75\" bottom=\"0.75\" header=\"0.3\" footer=\"0.3\"/>{drawing}{table}</worksheet>"
    )
}

fn table_xml(sheet: &SheetSpec, id: usize) -> String {
    let width = width_of(sheet);
    let reference = format!("A1:{}", cell_ref(width - 1, sheet.rows.len() + 1));
    let mut columns = String::new();
    for (i, h) in sheet.header.iter().enumerate() {
        columns.push_str(&format!("<tableColumn id=\"{}\" name=\"{}\"/>", i + 1, escape(h)));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><table xmlns=\"{MAIN_NS}\" id=\"{id}\" name=\"Table{id}\" displayName=\"Table{id}\" ref=\"{reference}\" totalsRowShown=\"0\"><autoFilter ref=\"{reference}\"/><tableColumns count=\"{width}\">{columns}</tableColumns><tableStyleInfo name=\"TableStyleMedium2\" showFirstColumn=\"0\" showLastColumn=\"0\" showRowStripes=\"1\" showColumnStripes=\"0\"/></table>"
    )
}

fn drawing_xml(width: usize) -> String {
    let from_col = width + 1;
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><xdr:wsDr xmlns:xdr=\"http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
            "<xdr:twoCellAnchor><xdr:from><xdr:col>{fc}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>",
            "<xdr:to><xdr:col>{tc}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>18</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>",
            "<xdr:graphicFrame macro=\"\"><xdr:nvGraphicFramePr><xdr:cNvPr id=\"2\" name=\"Chart 1\"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>",
            "<xdr:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></xdr:xfrm><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/chart\">",
            "<c:chart xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:r=\"{r}\" r:id=\"rIdChart\"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>"
        ),
        fc = from_col,
        tc = from_col + 8,
        r = R_NS
    )
}

/// يبني نموذج المخطط من أعمدة الورقة. القيم غير الرقمية (صيغ ونصوص) تُخبّأ صفرًا:
/// المخطط يُعاد حسابه من المراجع عند الفتح، والقيمة المخبّأة ليست ادّعاءً.
fn sheet_chart_spec(sheet: &SheetSpec) -> Option<(ChartSpec, Vec<usize>)> {
    let chart = sheet.chart.as_ref()?;
    let categories = sheet
        .rows
        .iter()
        .map(|r| match r.first() {
            Some(CellValue::Text(t)) => t.clone(),
            Some(CellValue::Number(n)) => n.to_string(),
            _ => String::new(),
        })
        .collect();
    let series = chart
        .value_columns
        .iter()
        .map(|&c| ChartSeries {
            name: sheet.header.get(c).cloned().unwrap_or_else(|| format!("Series {c}")),
            values: sheet.rows.iter().map(|r| if let Some(CellValue::Number(n)) = r.get(c) { *n } else { 0.0 }).collect(),
        })
        .collect();
    Some((ChartSpec { title: chart.title.clone(), kind: chart.kind, categories, series }, chart.value_columns.clone()))
}

const STYLES: &str = concat!(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">",
    "<numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"#,##0.00\"/></numFmts>",
    "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><b/><sz val=\"11\"/><color rgb=\"FF14213D\"/><name val=\"Calibri\"/><family val=\"2\"/></font></fonts>",
    "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill><fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFE7ECF4\"/><bgColor indexed=\"64\"/></patternFill></fill></fills>",
    "<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style=\"thin\"><color rgb=\"FF8A94A6\"/></bottom><diagonal/></border></borders>",
    "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>",
    "<cellXfs count=\"3\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>",
    "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\"/>",
    "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs>",
    "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>"
);

/// يكتب المصنّف كاملًا.
pub fn write_xlsx(spec: &WorkbookSpec, created_utc: &str) -> Result<Vec<u8>, String> {
    spec.validate().map_err(|e| e.0)?;
    let mut overrides = String::from(concat!(
        "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>",
        "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>",
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
        "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
    ));
    let mut workbook_sheets = String::new();
    let mut workbook_rels = String::new();
    let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
    let mut table_id = 0;
    let mut chart_id = 0;
    for (i, sheet) in spec.sheets.iter().enumerate() {
        let n = i + 1;
        let chart = sheet_chart_spec(sheet);
        let has_table = table_eligible(sheet);
        let mut sheet_rels = String::new();
        if let Some((chart_spec, columns)) = &chart {
            chart_id += 1;
            let first_row = if sheet.header.is_empty() { 1 } else { 2 };
            let xml = chart_xml(&ChartData::SheetRanges { spec: chart_spec, sheet: &sheet.name, first_row, category_column: 0, value_columns: columns });
            parts.push((format!("xl/charts/chart{chart_id}.xml"), xml.into_bytes()));
            parts.push((format!("xl/drawings/drawing{chart_id}.xml"), drawing_xml(width_of(sheet)).into_bytes()));
            parts.push((
                format!("xl/drawings/_rels/drawing{chart_id}.xml.rels"),
                format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rIdChart\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart\" Target=\"../charts/chart{chart_id}.xml\"/></Relationships>").into_bytes(),
            ));
            overrides.push_str(&format!("<Override PartName=\"/xl/charts/chart{chart_id}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawingml.chart+xml\"/><Override PartName=\"/xl/drawings/drawing{chart_id}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>"));
            sheet_rels.push_str(&format!("<Relationship Id=\"rIdDrawing\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing\" Target=\"../drawings/drawing{chart_id}.xml\"/>"));
        }
        if has_table {
            table_id += 1;
            parts.push((format!("xl/tables/table{table_id}.xml"), table_xml(sheet, table_id).into_bytes()));
            overrides.push_str(&format!("<Override PartName=\"/xl/tables/table{table_id}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml\"/>"));
            sheet_rels.push_str(&format!("<Relationship Id=\"rIdTable\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/table\" Target=\"../tables/table{table_id}.xml\"/>"));
        }
        parts.push((format!("xl/worksheets/sheet{n}.xml"), sheet_xml(sheet, chart.is_some(), has_table).into_bytes()));
        if !sheet_rels.is_empty() {
            parts.push((
                format!("xl/worksheets/_rels/sheet{n}.xml.rels"),
                format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{sheet_rels}</Relationships>").into_bytes(),
            ));
        }
        overrides.push_str(&format!("<Override PartName=\"/xl/worksheets/sheet{n}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"));
        workbook_sheets.push_str(&format!("<sheet name=\"{}\" sheetId=\"{n}\" r:id=\"rIdSheet{n}\"/>", escape(&sheet.name)));
        workbook_rels.push_str(&format!("<Relationship Id=\"rIdSheet{n}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{n}.xml\"/>"));
    }
    let workbook = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"{MAIN_NS}\" xmlns:r=\"{R_NS}\"><bookViews><workbookView/></bookViews><sheets>{workbook_sheets}</sheets><calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/></workbook>"
    );
    let rels = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{workbook_rels}<Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>"
    );
    let content_types = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>{overrides}</Types>"
    );
    let mut all = vec![
        ("[Content_Types].xml".to_string(), content_types.into_bytes()),
        ("_rels/.rels".to_string(), PACKAGE_RELS.replace("{MAIN}", "xl/workbook.xml").into_bytes()),
        ("xl/workbook.xml".to_string(), workbook.into_bytes()),
        ("xl/_rels/workbook.xml.rels".to_string(), rels.into_bytes()),
        ("xl/styles.xml".to_string(), STYLES.as_bytes().to_vec()),
        ("docProps/core.xml".to_string(), core_props(&spec.title, created_utc).into_bytes()),
        ("docProps/app.xml".to_string(), app_props().into_bytes()),
    ];
    all.extend(parts);
    write_zip(&all).map_err(|e| e.to_string())
}
