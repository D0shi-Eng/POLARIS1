// نموذج المحتوى المشترك بين كُتّاب المستندات والعروض وPDF.
//
// النموذج يصف ما يُكتب، لا كيف يُرسم: عنوان وفقرة وقائمة وجدول ومخطط. الوكيل يقترح
// هذا النموذج JSON، فهو مخرجات نموذج غير موثوقة: يُفكَّك بعقد مغلق يرفض أي حقل
// غير مُعلن، وكل نصّ وعدد محدود بسقف قبل أن يصل إلى كاتب. لا مسار ملف ولا رابط
// ولا ماكرو في هذا النموذج أصلًا، فلا يستطيع المحتوى أن يطلب شيئًا خارج الملف.

use serde::{Deserialize, Serialize};

pub const MAX_BLOCKS: usize = 400;
pub const MAX_TEXT: usize = 8_000;
pub const MAX_TITLE: usize = 300;
pub const MAX_TABLE_ROWS: usize = 500;
pub const MAX_TABLE_COLUMNS: usize = 30;
pub const MAX_CHART_POINTS: usize = 200;
pub const MAX_CHART_SERIES: usize = 8;
pub const MAX_LIST_ITEMS: usize = 200;

/// سلسلة بيانات في مخطط.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChartSeries {
    pub name: String,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChartKind {
    Bar,
    Line,
}

/// مخطط: فئات وسلاسل قيم بطولها.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChartSpec {
    pub title: String,
    #[serde(default = "default_kind")]
    pub kind: ChartKind,
    pub categories: Vec<String>,
    pub series: Vec<ChartSeries>,
}

fn default_kind() -> ChartKind {
    ChartKind::Bar
}

/// كتلة محتوى واحدة.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Block {
    Heading { text: String, #[serde(default = "default_level")] level: u8 },
    Paragraph { text: String },
    Bullets { items: Vec<String> },
    Table { header: Vec<String>, rows: Vec<Vec<String>> },
    Chart { chart: ChartSpec },
}

fn default_level() -> u8 {
    1
}

/// مستند: عنوان ولغة وكتل.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentSpec {
    pub title: String,
    #[serde(default)]
    pub language: Option<String>,
    pub blocks: Vec<Block>,
}

/// شريحة: عنوان وكتل (نقاط، جدول، مخطط) وملاحظات متحدّث اختيارية.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SlideSpec {
    pub title: String,
    #[serde(default)]
    pub bullets: Vec<String>,
    #[serde(default)]
    pub table: Option<TableSpec>,
    #[serde(default)]
    pub chart: Option<ChartSpec>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableSpec {
    pub header: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// عرض تقديمي.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckSpec {
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    pub slides: Vec<SlideSpec>,
}

/// خلية جدول بيانات: نصّ أو رقم أو صيغة. الصيغة نصّ يبدأ بـ`=` ويُحفظ صيغةً.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CellValue {
    Number(f64),
    Text(String),
    Empty,
}

/// ورقة في مصنّف.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetSpec {
    pub name: String,
    #[serde(default)]
    pub header: Vec<String>,
    pub rows: Vec<Vec<CellValue>>,
    /// مخطط اختياري يُبنى من أعمدة هذه الورقة: عمود الفئات أول عمود، والقيم ما بعده.
    #[serde(default)]
    pub chart: Option<SheetChart>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetChart {
    pub title: String,
    #[serde(default = "default_kind")]
    pub kind: ChartKind,
    /// أعمدة القيم (فهرس يبدأ من 1 للعمود الثاني) — الأول دائمًا للفئات.
    pub value_columns: Vec<usize>,
}

/// مصنّف.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkbookSpec {
    pub title: String,
    pub sheets: Vec<SheetSpec>,
}

/// لماذا رُفض نموذج محتوى. نصّ قصير للوكيل والمستخدم.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecError(pub String);

fn text_ok(label: &str, text: &str, max: usize) -> Result<(), SpecError> {
    if text.chars().count() > max {
        return Err(SpecError(format!("{label} is longer than {max} characters")));
    }
    Ok(())
}

fn chart_ok(chart: &ChartSpec) -> Result<(), SpecError> {
    text_ok("chart title", &chart.title, MAX_TITLE)?;
    if chart.categories.is_empty() || chart.categories.len() > MAX_CHART_POINTS {
        return Err(SpecError(format!("a chart needs 1..{MAX_CHART_POINTS} categories")));
    }
    if chart.series.is_empty() || chart.series.len() > MAX_CHART_SERIES {
        return Err(SpecError(format!("a chart needs 1..{MAX_CHART_SERIES} series")));
    }
    for s in &chart.series {
        text_ok("series name", &s.name, MAX_TITLE)?;
        if s.values.len() != chart.categories.len() {
            return Err(SpecError(format!("series {} has {} values for {} categories", s.name, s.values.len(), chart.categories.len())));
        }
        if s.values.iter().any(|v| !v.is_finite()) {
            return Err(SpecError(format!("series {} holds a non-finite value", s.name)));
        }
    }
    Ok(())
}

fn table_ok(header: &[String], rows: &[Vec<String>]) -> Result<(), SpecError> {
    if header.is_empty() || header.len() > MAX_TABLE_COLUMNS {
        return Err(SpecError(format!("a table needs 1..{MAX_TABLE_COLUMNS} columns")));
    }
    if rows.len() > MAX_TABLE_ROWS {
        return Err(SpecError(format!("a table holds at most {MAX_TABLE_ROWS} rows")));
    }
    for cell in header.iter().chain(rows.iter().flatten()) {
        text_ok("table cell", cell, 2_000)?;
    }
    if rows.iter().any(|r| r.len() > header.len()) {
        return Err(SpecError("a table row is wider than its header".into()));
    }
    Ok(())
}

impl DocumentSpec {
    pub fn validate(&self) -> Result<(), SpecError> {
        text_ok("title", &self.title, MAX_TITLE)?;
        if self.title.trim().is_empty() {
            return Err(SpecError("the title is empty".into()));
        }
        if self.blocks.is_empty() || self.blocks.len() > MAX_BLOCKS {
            return Err(SpecError(format!("a document needs 1..{MAX_BLOCKS} blocks")));
        }
        for block in &self.blocks {
            match block {
                Block::Heading { text, level } => {
                    text_ok("heading", text, MAX_TITLE)?;
                    if !(1..=3).contains(level) {
                        return Err(SpecError("heading level must be 1..3".into()));
                    }
                }
                Block::Paragraph { text } => text_ok("paragraph", text, MAX_TEXT)?,
                Block::Bullets { items } => {
                    if items.is_empty() || items.len() > MAX_LIST_ITEMS {
                        return Err(SpecError(format!("a list needs 1..{MAX_LIST_ITEMS} items")));
                    }
                    for i in items {
                        text_ok("list item", i, 2_000)?;
                    }
                }
                Block::Table { header, rows } => table_ok(header, rows)?,
                Block::Chart { chart } => chart_ok(chart)?,
            }
        }
        Ok(())
    }

    /// كل النصوص المرئية بالترتيب. تُستعمل للتحقق بعد إعادة الفتح.
    pub fn visible_texts(&self) -> Vec<String> {
        let mut out = vec![self.title.clone()];
        for block in &self.blocks {
            match block {
                Block::Heading { text, .. } | Block::Paragraph { text } => out.push(text.clone()),
                Block::Bullets { items } => out.extend(items.iter().cloned()),
                Block::Table { header, rows } => {
                    out.extend(header.iter().cloned());
                    out.extend(rows.iter().flatten().cloned());
                }
                Block::Chart { chart } => out.push(chart.title.clone()),
            }
        }
        out.retain(|t| !t.trim().is_empty());
        out
    }

    pub fn is_rtl(&self) -> bool {
        match self.language.as_deref() {
            Some(l) => l.starts_with("ar") || l.starts_with("he") || l.starts_with("fa") || l.starts_with("ur"),
            None => super::xml::is_rtl_text(&self.title),
        }
    }
}

impl DeckSpec {
    pub fn validate(&self) -> Result<(), SpecError> {
        text_ok("title", &self.title, MAX_TITLE)?;
        if self.title.trim().is_empty() {
            return Err(SpecError("the title is empty".into()));
        }
        if self.slides.is_empty() || self.slides.len() > 100 {
            return Err(SpecError("a deck needs 1..100 slides".into()));
        }
        for slide in &self.slides {
            text_ok("slide title", &slide.title, MAX_TITLE)?;
            if slide.bullets.len() > 20 {
                return Err(SpecError("a slide holds at most 20 bullets".into()));
            }
            for b in &slide.bullets {
                text_ok("bullet", b, 1_000)?;
            }
            if let Some(t) = &slide.table {
                table_ok(&t.header, &t.rows)?;
                if t.rows.len() > 20 {
                    return Err(SpecError("a slide table holds at most 20 rows".into()));
                }
            }
            if let Some(c) = &slide.chart {
                chart_ok(c)?;
            }
            if let Some(n) = &slide.notes {
                text_ok("notes", n, MAX_TEXT)?;
            }
        }
        Ok(())
    }

    pub fn is_rtl(&self) -> bool {
        match self.language.as_deref() {
            Some(l) => l.starts_with("ar") || l.starts_with("he") || l.starts_with("fa") || l.starts_with("ur"),
            None => super::xml::is_rtl_text(&self.title),
        }
    }
}

/// اسم ورقة Excel صالح: 1..31 محرفًا، بلا المحارف المحظورة.
pub fn valid_sheet_name(name: &str) -> bool {
    let n = name.chars().count();
    (1..=31).contains(&n) && !name.chars().any(|c| matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\')) && !name.starts_with('\'')
}

impl WorkbookSpec {
    /// ورقة بمخطط بلا `header` صفّها الأول كله نصوص (لا صيغ): ذلك الصفّ رأسها (DEF-34، 2026-10-29). الناتج في الملف واحد: الرأس
    /// يُكتب صفًّا أول كما كان الصفّ. ما سوى ذلك لا يُلمس، فيبقى الرفض للحالات الأخرى كما هو.
    pub fn normalized(mut self) -> Self {
        for sheet in &mut self.sheets {
            let names_first = sheet.rows.first().is_some_and(|row| !row.is_empty() && row.iter().all(|c| matches!(c, CellValue::Text(t) if !t.starts_with('='))));
            if sheet.chart.is_some() && sheet.header.is_empty() && sheet.rows.len() > 1 && names_first {
                let first = sheet.rows.remove(0);
                sheet.header = first.into_iter().map(|c| if let CellValue::Text(t) = c { t } else { String::new() }).collect();
            }
            // والرأس المكرَّر صفًّا أول في `rows` (قِيس أصليًّا بعد الإصلاح: كُتب الرأس مرتين فانزاحت صيغ النموذج صفًّا، ومنها
            // `SUM(Data!B2:E2)` التي جمعت أسماء الأعمدة). الصفّ المطابق للرأس حرفيًّا يُحذف، فيقع الصفّ الثاني حيث افترضته الصيغ.
            let repeats_header = !sheet.header.is_empty()
                && sheet.rows.first().is_some_and(|row| row.len() == sheet.header.len() && row.iter().zip(&sheet.header).all(|(c, h)| matches!(c, CellValue::Text(t) if t == h)));
            if repeats_header {
                sheet.rows.remove(0);
            }
        }
        self
    }

    pub fn validate(&self) -> Result<(), SpecError> {
        text_ok("title", &self.title, MAX_TITLE)?;
        if self.sheets.is_empty() || self.sheets.len() > 20 {
            return Err(SpecError("a workbook needs 1..20 sheets".into()));
        }
        let mut names = std::collections::BTreeSet::new();
        for sheet in &self.sheets {
            if !valid_sheet_name(&sheet.name) {
                return Err(SpecError(format!("{} is not a valid sheet name", sheet.name)));
            }
            if !names.insert(sheet.name.to_lowercase()) {
                return Err(SpecError(format!("the sheet name {} repeats", sheet.name)));
            }
            if sheet.rows.len() > 10_000 {
                return Err(SpecError("a sheet holds at most 10000 rows".into()));
            }
            let width = sheet.header.len().max(sheet.rows.iter().map(Vec::len).max().unwrap_or(0));
            if width == 0 || width > 100 {
                return Err(SpecError("a sheet needs 1..100 columns".into()));
            }
            for cell in sheet.rows.iter().flatten() {
                match cell {
                    CellValue::Text(t) => {
                        text_ok("cell", t, 4_000)?;
                        if t.starts_with('=') && !formula_ok(t) {
                            return Err(SpecError(format!("the formula {t} is not accepted")));
                        }
                    }
                    CellValue::Number(n) if !n.is_finite() => return Err(SpecError("a cell holds a non-finite number".into())),
                    _ => {}
                }
            }
            if let Some(chart) = &sheet.chart {
                text_ok("chart title", &chart.title, MAX_TITLE)?;
                // أسماء السلاسل تأتي من الرأس، فمخطط بلا رأس لا مرجع لأسمائه.
                if sheet.header.is_empty() {
                    return Err(SpecError(
                        "a sheet chart needs the column names in the sheet's \"header\" field, for example \"header\": [\"Product\", \"Q1\", \"Q2\"], with the data rows in \"rows\"".into(),
                    ));
                }
                if chart.value_columns.is_empty() || chart.value_columns.iter().any(|c| *c == 0 || *c >= width) {
                    return Err(SpecError("a chart value column is outside the sheet".into()));
                }
                if sheet.rows.is_empty() || sheet.rows.len() > MAX_CHART_POINTS {
                    return Err(SpecError(format!("a sheet chart needs 1..{MAX_CHART_POINTS} rows")));
                }
            }
        }
        Ok(())
    }
}

/// صيغة مقبولة: دوالّ حساب وإشارات خلايا فقط. لا وصل خارجي (`[`، `!` إلى مصنّف آخر
/// عبر مسار)، ولا DDE، ولا دوالّ تستدعي شيئًا خارج الملف.
pub fn formula_ok(formula: &str) -> bool {
    let upper = formula.to_ascii_uppercase();
    if formula.len() > 1_000 || formula.contains('[') || formula.contains('|') || formula.contains('"') && upper.contains("CMD") {
        return false;
    }
    const FORBIDDEN: [&str; 8] = ["WEBSERVICE(", "HYPERLINK(", "CALL(", "REGISTER(", "EXEC(", "FILTERXML(", "IMPORTDATA(", "RTD("];
    !FORBIDDEN.iter().any(|f| upper.contains(f))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_field_is_refused_rather_than_ignored() {
        let bad = r#"{"title":"t","blocks":[{"type":"paragraph","text":"x","macro":"AutoOpen"}]}"#;
        assert!(serde_json::from_str::<DocumentSpec>(bad).is_err());
    }

    #[test]
    fn a_chart_with_mismatched_series_is_refused() {
        let spec = DocumentSpec {
            title: "t".into(),
            language: None,
            blocks: vec![Block::Chart {
                chart: ChartSpec { title: "c".into(), kind: ChartKind::Bar, categories: vec!["a".into(), "b".into()], series: vec![ChartSeries { name: "s".into(), values: vec![1.0] }] },
            }],
        };
        assert!(spec.validate().is_err());
    }

    #[test]
    fn dangerous_formulas_are_refused() {
        for f in ["=WEBSERVICE(\"http://x\")", "=HYPERLINK(\"file:///c:/x\")", "=[book.xlsx]Sheet1!A1", "=cmd|' /c calc'!A0"] {
            assert!(!formula_ok(f), "{f} was accepted");
        }
        assert!(formula_ok("=SUM(B2:B9)"));
        assert!(formula_ok("=AVERAGE(Data!B2:B9)"));
    }

    /// DEF-34 (تدقيق 2026-10-29): Bonsai أرسل أسماء الأعمدة صفًّا أول في `rows` بلا `header`، فرُفض «needs a header row» بمثال لا
    /// يذكر الحقل، وكرّر الطلب نفسه حتى توقّفت المهمّة (M03 مرتين). صفّ أول كله نصوص هو رأس، فيُرفع إليه.
    #[test]
    fn a_chart_sheet_whose_first_row_holds_the_column_names_takes_it_as_its_header() {
        let sent = r#"{"title":"Sales","sheets":[{"name":"Data","rows":[["","Q1","Q2"],["Product A",120,150],["Product B",80,95]],"chart":{"title":"Units","value_columns":[1,2],"kind":"bar"}}]}"#;
        let book = serde_json::from_str::<WorkbookSpec>(sent).unwrap().normalized();
        assert_eq!(book.sheets[0].header, vec!["".to_string(), "Q1".into(), "Q2".into()]);
        assert_eq!(book.sheets[0].rows.len(), 2);
        assert!(book.validate().is_ok(), "{:?}", book.validate());
    }

    /// قِيس أصليًّا (2026-10-29، بعد DEF-34): Bonsai أرسل `header` وكرّر أسماء الأعمدة نفسها صفًّا أول في `rows`، فكُتب الرأس
    /// مرتين وانزاحت صيغه صفًّا. الصفّ المطابق للرأس يُحذف في كل ورقة، بمخطط أو بدونه.
    #[test]
    fn a_first_row_that_repeats_the_header_is_dropped_so_formulas_point_at_the_data() {
        let sent = r#"{"title":"Sales","sheets":[
            {"name":"Data","header":["Product","Q1"],"rows":[["Product","Q1"],["Product A",120],["Product B",80]]},
            {"name":"KPIs","header":["Metric","Product A"],"rows":[["Metric","Product A"],["Total","=SUM(Data!B2:B2)"]]}]}"#;
        let book = serde_json::from_str::<WorkbookSpec>(sent).unwrap().normalized();
        assert_eq!(book.sheets[0].rows.len(), 2);
        assert_eq!(book.sheets[0].rows[0][0], CellValue::Text("Product A".into()));
        assert_eq!(book.sheets[1].rows.len(), 1);
        assert!(book.validate().is_ok());
    }

    #[test]
    fn a_chart_sheet_without_column_names_is_refused_with_the_field_named() {
        let sent = r#"{"title":"Sales","sheets":[{"name":"Data","rows":[["A",120,150],["B",80,95]],"chart":{"title":"Units","value_columns":[1,2]}}]}"#;
        let err = serde_json::from_str::<WorkbookSpec>(sent).unwrap().normalized().validate().unwrap_err();
        assert!(err.0.contains("\"header\""), "{}", err.0);
    }

    #[test]
    fn sheet_names_follow_the_excel_rules() {
        assert!(valid_sheet_name("Data"));
        assert!(valid_sheet_name("بيانات"));
        assert!(!valid_sheet_name(""));
        assert!(!valid_sheet_name("a/b"));
        assert!(!valid_sheet_name(&"x".repeat(32)));
    }
}
