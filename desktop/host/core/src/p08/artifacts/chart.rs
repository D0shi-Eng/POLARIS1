// جزء المخطط (DrawingML chartSpace) المشترك بين Word وPowerPoint وExcel.
//
// في المستند والعرض تُكتب البيانات قيمًا حرفية (strLit/numLit) بلا مصنّف مضمَّن:
// المخطط يُرسم من قيمه نفسها، ولا يشير إلى ملف آخر يمكن أن يغيب أو يُستبدل. في
// المصنّف تُكتب مرجعًا إلى نطاق الورقة مع نسخة مخبّأة من القيم، كما يفعل Excel.

use super::spec::{ChartKind, ChartSpec};
use super::xml::escape;

/// مصدر بيانات المخطط: قيم حرفية، أو مراجع نطاقات في ورقة.
/// ألوان POLARIS للسلاسل، بالترتيب.
const PALETTE: [&str; 6] = ["3D6FE0", "22A6B3", "E0A23D", "7C5CD6", "2FA36B", "D65C5C"];

pub enum ChartData<'a> {
    Literal(&'a ChartSpec),
    SheetRanges { spec: &'a ChartSpec, sheet: &'a str, first_row: usize, category_column: usize, value_columns: &'a [usize] },
}

fn column_letter(mut index: usize) -> String {
    // index يبدأ من 0.
    let mut out = Vec::new();
    loop {
        out.push((b'A' + (index % 26) as u8) as char);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    out.iter().rev().collect()
}

pub fn cell_ref(column: usize, row: usize) -> String {
    format!("{}{}", column_letter(column), row)
}

fn quoted_sheet(sheet: &str) -> String {
    format!("'{}'", sheet.replace('\'', "''"))
}

fn number(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

fn str_points(values: &[String]) -> String {
    let mut out = format!("<c:ptCount val=\"{}\"/>", values.len());
    for (i, v) in values.iter().enumerate() {
        out.push_str(&format!("<c:pt idx=\"{i}\"><c:v>{}</c:v></c:pt>", escape(v)));
    }
    out
}

fn num_points(values: &[f64]) -> String {
    let mut out = format!("<c:formatCode>General</c:formatCode><c:ptCount val=\"{}\"/>", values.len());
    for (i, v) in values.iter().enumerate() {
        out.push_str(&format!("<c:pt idx=\"{i}\"><c:v>{}</c:v></c:pt>", number(*v)));
    }
    out
}

/// يكتب `chartN.xml` كاملًا.
pub fn chart_xml(data: &ChartData<'_>) -> String {
    let spec = match data {
        ChartData::Literal(s) => *s,
        ChartData::SheetRanges { spec, .. } => *spec,
    };
    let mut series = String::new();
    for (i, s) in spec.series.iter().enumerate() {
        let (tx, cat, val) = match data {
            ChartData::Literal(_) => (
                format!("<c:tx><c:v>{}</c:v></c:tx>", escape(&s.name)),
                format!("<c:cat><c:strLit>{}</c:strLit></c:cat>", str_points(&spec.categories)),
                format!("<c:val><c:numLit>{}</c:numLit></c:val>", num_points(&s.values)),
            ),
            ChartData::SheetRanges { sheet, first_row, category_column, value_columns, .. } => {
                let last = first_row + spec.categories.len() - 1;
                let col = value_columns.get(i).copied().unwrap_or(1);
                let q = quoted_sheet(sheet);
                let cat_ref = format!("{q}!${}${}:${}${}", column_letter(*category_column), first_row, column_letter(*category_column), last);
                let val_ref = format!("{q}!${}${}:${}${}", column_letter(col), first_row, column_letter(col), last);
                let name_ref = format!("{q}!${}${}", column_letter(col), first_row - 1);
                (
                    format!("<c:tx><c:strRef><c:f>{}</c:f><c:strCache><c:ptCount val=\"1\"/><c:pt idx=\"0\"><c:v>{}</c:v></c:pt></c:strCache></c:strRef></c:tx>", escape(&name_ref), escape(&s.name)),
                    format!("<c:cat><c:strRef><c:f>{}</c:f><c:strCache>{}</c:strCache></c:strRef></c:cat>", escape(&cat_ref), str_points(&spec.categories)),
                    format!("<c:val><c:numRef><c:f>{}</c:f><c:numCache>{}</c:numCache></c:numRef></c:val>", escape(&val_ref), num_points(&s.values)),
                )
            }
        };
        // لون صريح لكل سلسلة: بعض القرّاء لا يطبّقون لونًا افتراضيًّا على الأعمدة بلا تنسيق.
        let color = PALETTE[i % PALETTE.len()];
        let sp_pr = match spec.kind {
            ChartKind::Bar => format!("<c:spPr><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill></c:spPr>"),
            ChartKind::Line => format!("<c:spPr><a:ln w=\"28575\"><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill></a:ln></c:spPr>"),
        };
        let marker = if spec.kind == ChartKind::Line { "<c:marker><c:symbol val=\"circle\"/></c:marker>" } else { "" };
        let invert = if spec.kind == ChartKind::Bar { "<c:invertIfNegative val=\"0\"/>" } else { "" };
        series.push_str(&format!(
            "<c:ser><c:idx val=\"{i}\"/><c:order val=\"{i}\"/>{tx}{sp_pr}{invert}{marker}{cat}{val}{smooth}</c:ser>",
            smooth = if spec.kind == ChartKind::Line { "<c:smooth val=\"0\"/>" } else { "" }
        ));
    }
    let plot = match spec.kind {
        ChartKind::Bar => format!(
            "<c:barChart><c:barDir val=\"col\"/><c:grouping val=\"clustered\"/><c:varyColors val=\"0\"/>{series}<c:gapWidth val=\"150\"/><c:axId val=\"111\"/><c:axId val=\"222\"/></c:barChart>"
        ),
        ChartKind::Line => format!(
            "<c:lineChart><c:grouping val=\"standard\"/><c:varyColors val=\"0\"/>{series}<c:marker val=\"1\"/><c:axId val=\"111\"/><c:axId val=\"222\"/></c:lineChart>"
        ),
    };
    format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<c:chartSpace xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">",
            "<c:roundedCorners val=\"0\"/>",
            "<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>{title}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val=\"0\"/></c:title>",
            "<c:autoTitleDeleted val=\"0\"/><c:plotArea><c:layout/>{plot}",
            "<c:catAx><c:axId val=\"111\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"b\"/><c:numFmt formatCode=\"General\" sourceLinked=\"0\"/><c:tickLblPos val=\"nextTo\"/><c:crossAx val=\"222\"/><c:crosses val=\"autoZero\"/><c:auto val=\"1\"/><c:lblAlgn val=\"ctr\"/><c:lblOffset val=\"100\"/></c:catAx>",
            "<c:valAx><c:axId val=\"222\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"l\"/><c:majorGridlines/><c:numFmt formatCode=\"General\" sourceLinked=\"0\"/><c:tickLblPos val=\"nextTo\"/><c:crossAx val=\"111\"/><c:crosses val=\"autoZero\"/><c:crossBetween val=\"between\"/></c:valAx>",
            "</c:plotArea><c:legend><c:legendPos val=\"b\"/><c:overlay val=\"0\"/></c:legend><c:plotVisOnly val=\"1\"/><c:dispBlanksAs val=\"gap\"/></c:chart>",
            "</c:chartSpace>"
        ),
        title = escape(&spec.title),
        plot = plot
    )
}

#[cfg(test)]
mod tests {
    use super::super::spec::ChartSeries;
    use super::*;

    fn spec() -> ChartSpec {
        ChartSpec {
            title: "Sales & «returns»".into(),
            kind: ChartKind::Bar,
            categories: vec!["Q1".into(), "Q2".into()],
            series: vec![ChartSeries { name: "2026".into(), values: vec![1.0, 2.5] }],
        }
    }

    #[test]
    fn column_letters_follow_excel_numbering() {
        assert_eq!(column_letter(0), "A");
        assert_eq!(column_letter(25), "Z");
        assert_eq!(column_letter(26), "AA");
        assert_eq!(column_letter(701), "ZZ");
        assert_eq!(column_letter(702), "AAA");
    }

    #[test]
    fn literal_and_ranged_charts_are_well_formed() {
        let s = spec();
        let literal = chart_xml(&ChartData::Literal(&s));
        super::super::xml::check_well_formed(&literal).unwrap();
        assert!(literal.contains("<c:numLit>") && !literal.contains("<c:f>"));
        let ranged = chart_xml(&ChartData::SheetRanges { spec: &s, sheet: "O'Brien", first_row: 2, category_column: 0, value_columns: &[1] });
        super::super::xml::check_well_formed(&ranged).unwrap();
        assert!(ranged.contains("&apos;O&apos;&apos;Brien&apos;!$B$2:$B$3"));
    }
}
