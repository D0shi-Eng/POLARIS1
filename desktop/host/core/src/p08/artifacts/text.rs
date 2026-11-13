// الصيغ النصّية: CSV وMarkdown ونصّ عادي.
//
// CSV يُكتب بترميز RFC 4180 مع علامة ترتيب البايت UTF-8 حتى يفتحه Excel بالعربية
// صحيحًا. وتُحيَّد الخلايا التي تبدأ بـ= أو + أو - أو @ بعلامة اقتباس مفردة: ملف CSV
// يُفتح في جدول بيانات قد يُفسّر تلك الخلايا صيغًا (حقن الصيغ في CSV).

use super::spec::{Block, DocumentSpec};

pub fn csv_escape(cell: &str) -> String {
    let neutral = if cell.starts_with(['=', '+', '-', '@', '\t', '\r']) && cell.parse::<f64>().is_err() { format!("'{cell}") } else { cell.to_string() };
    if neutral.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", neutral.replace('"', "\"\""))
    } else {
        neutral
    }
}

pub fn write_csv(header: &[String], rows: &[Vec<String>]) -> Vec<u8> {
    let mut out = String::from("\u{FEFF}");
    let mut emit = |cells: &[String]| {
        out.push_str(&cells.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    };
    if !header.is_empty() {
        emit(header);
    }
    for r in rows {
        emit(r);
    }
    out.into_bytes()
}

/// يحلّل CSV (RFC 4180) إلى صفوف. يُستعمل للتحقق بعد الكتابة ولقراءة المرفقات.
pub fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match (quoted, c) {
            (true, '"') if chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            (true, '"') => quoted = false,
            (true, c) => cell.push(c),
            (false, '"') if cell.is_empty() => quoted = true,
            (false, ',') => row.push(std::mem::take(&mut cell)),
            (false, '\r') => {}
            (false, '\n') => {
                row.push(std::mem::take(&mut cell));
                rows.push(std::mem::take(&mut row));
            }
            (false, c) => cell.push(c),
        }
    }
    if quoted {
        return Err("an unterminated quoted field".into());
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    Ok(rows)
}

/// Markdown من نموذج المستند.
pub fn document_markdown(spec: &DocumentSpec) -> Result<String, String> {
    spec.validate().map_err(|e| e.0)?;
    let mut out = format!("# {}\n\n", spec.title.trim());
    for block in &spec.blocks {
        match block {
            Block::Heading { text, level } => out.push_str(&format!("{} {}\n\n", "#".repeat(*level as usize + 1), text.trim())),
            Block::Paragraph { text } => out.push_str(&format!("{}\n\n", text.trim())),
            Block::Bullets { items } => {
                for i in items {
                    out.push_str(&format!("- {}\n", i.trim()));
                }
                out.push('\n');
            }
            Block::Table { header, rows } => {
                let cell = |s: &str| s.replace('|', "\\|").replace('\n', " ");
                out.push_str(&format!("| {} |\n", header.iter().map(|h| cell(h)).collect::<Vec<_>>().join(" | ")));
                out.push_str(&format!("|{}\n", " --- |".repeat(header.len())));
                for r in rows {
                    let mut cells: Vec<String> = r.iter().map(|c| cell(c)).collect();
                    cells.resize(header.len(), String::new());
                    out.push_str(&format!("| {} |\n", cells.join(" | ")));
                }
                out.push('\n');
            }
            Block::Chart { chart } => {
                out.push_str(&format!("**{}**\n\n| |{}\n|---|{}\n", chart.title, chart.series.iter().map(|s| format!(" {} |", s.name)).collect::<String>(), "---|".repeat(chart.series.len())));
                for (i, c) in chart.categories.iter().enumerate() {
                    out.push_str(&format!("| {c} |{}\n", chart.series.iter().map(|s| format!(" {} |", s.values[i])).collect::<String>()));
                }
                out.push('\n');
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_round_trips_quotes_commas_newlines_and_arabic() {
        let header = vec!["name".to_string(), "note".to_string()];
        let rows = vec![vec!["أحمد".to_string(), "a, \"b\"\nc".to_string()]];
        let bytes = write_csv(&header, &rows);
        let parsed = parse_csv(std::str::from_utf8(&bytes).unwrap()).unwrap();
        assert_eq!(parsed, vec![header, rows[0].clone()]);
    }

    #[test]
    fn formula_like_cells_are_neutralised_but_negative_numbers_are_not() {
        assert_eq!(csv_escape("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(csv_escape("@SUM(A1)"), "'@SUM(A1)");
        assert_eq!(csv_escape("-12.5"), "-12.5");
    }
}
