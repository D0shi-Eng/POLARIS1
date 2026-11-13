// كاتب PDF: تخطيط صفحات A4 لنموذج المستند (عناوين وفقرات وقوائم وجداول ومخططات).
//
// خطّان ممكنان: الخطوط القياسية (Helvetica) للنصّ اللاتيني بلا تضمين، أو خط TrueType
// مضمَّن كاملًا (CIDFontType2 بترميز Identity-H مع ToUnicode) حين تقدّمه المنصّة،
// وهو ما يجعل العربية مرسومة ومستخرَجة. ما لا يرسمه الخط يُحصى ويُعلن في التحقق،
// ولا يُستبدل بصمت ثم يُدّعى أن الملف كامل.

use std::collections::BTreeMap;

use miniz_oxide::deflate::compress_to_vec_zlib;

use super::super::spec::{Block, ChartKind, ChartSpec, DocumentSpec};
use super::super::xml::is_rtl_text;
use super::arabic::{shape, visual_order};
use super::font::TrueTypeFont;
use super::metrics::{helvetica_width, win_ansi};

const PAGE_W: f32 = 595.0;
const PAGE_H: f32 = 842.0;
const MARGIN: f32 = 56.0;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN;
const PALETTE: [(f32, f32, f32); 6] = [(0.24, 0.44, 0.88), (0.13, 0.65, 0.70), (0.88, 0.64, 0.24), (0.49, 0.36, 0.84), (0.18, 0.64, 0.42), (0.84, 0.36, 0.36)];

/// ما يُعاد مع الملف: بايتاته وعدد صفحاته وعدد المحارف التي لم يرسمها الخط.
pub struct PdfOutput {
    pub bytes: Vec<u8>,
    pub pages: usize,
    pub unsupported_glyphs: usize,
    pub embedded_font: bool,
}

struct Canvas<'f> {
    font: Option<&'f TrueTypeFont>,
    pages: Vec<String>,
    ops: String,
    y: f32,
    rtl: bool,
    used: BTreeMap<u16, char>,
    unsupported: usize,
}

fn num(v: f32) -> String {
    let r = (v * 100.0).round() / 100.0;
    if r.fract() == 0.0 {
        format!("{}", r as i64)
    } else {
        format!("{r:.2}")
    }
}

impl<'f> Canvas<'f> {
    fn new(font: Option<&'f TrueTypeFont>, rtl: bool) -> Self {
        Self { font, pages: Vec::new(), ops: String::new(), y: PAGE_H - MARGIN, rtl, used: BTreeMap::new(), unsupported: 0 }
    }

    fn new_page(&mut self) {
        if !self.ops.is_empty() {
            let done = std::mem::take(&mut self.ops);
            self.pages.push(done);
        }
        self.y = PAGE_H - MARGIN;
    }

    fn ensure(&mut self, needed: f32) {
        if self.y - needed < MARGIN {
            self.new_page();
        }
    }

    fn finish(mut self) -> (Vec<String>, BTreeMap<u16, char>, usize) {
        if !self.ops.is_empty() || self.pages.is_empty() {
            let done = std::mem::take(&mut self.ops);
            self.pages.push(done);
        }
        (self.pages, self.used, self.unsupported)
    }

    /// عرض نصّ (مشكَّل) بالنقاط.
    fn measure(&self, text: &str, size: f32, bold: bool) -> f32 {
        let units: u32 = match self.font {
            Some(f) => text.chars().map(|c| f.glyph(c).map(|g| f.width_1000(g)).unwrap_or(500)).sum(),
            None => text.chars().map(|c| win_ansi(c).map(|b| helvetica_width(b, bold) as u32).unwrap_or(556)).sum(),
        };
        units as f32 * size / 1000.0
    }

    /// يرمّز سطرًا مرتّبًا بصريًّا إلى معامل نصّ PDF، ويسجّل المحارف المستعملة.
    fn encode(&mut self, visual: &str) -> String {
        match self.font {
            Some(f) => {
                let mut hex = String::from("<");
                for c in visual.chars() {
                    let g = match f.glyph(c) {
                        Some(g) => g,
                        None => {
                            if !c.is_whitespace() {
                                self.unsupported += 1;
                            }
                            f.glyph('?').unwrap_or(0)
                        }
                    };
                    self.used.entry(g).or_insert(c);
                    hex.push_str(&format!("{g:04X}"));
                }
                hex.push('>');
                hex
            }
            None => {
                let mut s = String::from("(");
                for c in visual.chars() {
                    let b = match win_ansi(c) {
                        Some(b) => b,
                        None => {
                            self.unsupported += 1;
                            b'?'
                        }
                    };
                    match b {
                        b'(' | b')' | b'\\' => {
                            s.push('\\');
                            s.push(b as char);
                        }
                        0x20..=0x7E => s.push(b as char),
                        other => s.push_str(&format!("\\{other:03o}")),
                    }
                }
                s.push(')');
                s
            }
        }
    }

    fn font_ref(&self, bold: bool) -> &'static str {
        match (self.font.is_some(), bold) {
            (true, _) => "/F3",
            (false, true) => "/F2",
            (false, false) => "/F1",
        }
    }

    fn text_at(&mut self, x: f32, y: f32, size: f32, bold: bool, visual: &str, color: (f32, f32, f32)) {
        let operand = self.encode(visual);
        let font = self.font_ref(bold);
        // الخط المضمَّن واحد: الغامق يُحاكى برسم الحدّ مع الملء.
        let (render_on, render_off) = if self.font.is_some() && bold { ("2 Tr 0.35 w ", " 0 Tr") } else { ("", "") };
        self.ops.push_str(&format!(
            "BT {} {} {} rg {} {} {} RG {render_on}{font} {} Tf {} {} Td {operand} Tj{render_off} ET\n",
            num(color.0),
            num(color.1),
            num(color.2),
            num(color.0),
            num(color.1),
            num(color.2),
            num(size),
            num(x),
            num(y)
        ));
    }

    /// يلتفّ نصًّا منطقيًّا إلى أسطر تتّسع للعرض. يعيد أسطرًا مشكَّلة بترتيب منطقي.
    fn wrap(&self, text: &str, size: f32, bold: bool, width: f32) -> Vec<String> {
        let shaped = if self.font.is_some() { shape(text) } else { text.to_string() };
        let mut lines = Vec::new();
        let mut current = String::new();
        for word in shaped.split(' ') {
            let candidate = if current.is_empty() { word.to_string() } else { format!("{current} {word}") };
            if self.measure(&candidate, size, bold) <= width || current.is_empty() {
                current = candidate;
                // كلمة أطول من السطر تُقطع محرفًا محرفًا.
                while self.measure(&current, size, bold) > width && current.chars().count() > 1 {
                    let mut head = String::new();
                    for c in current.chars() {
                        head.push(c);
                        if self.measure(&head, size, bold) > width {
                            head.pop();
                            break;
                        }
                    }
                    if head.is_empty() {
                        break;
                    }
                    let rest: String = current.chars().skip(head.chars().count()).collect();
                    lines.push(head);
                    current = rest;
                }
            } else {
                lines.push(std::mem::take(&mut current));
                current = word.to_string();
            }
        }
        if !current.is_empty() || lines.is_empty() {
            lines.push(current);
        }
        lines
    }

    fn line_rtl(&self, logical: &str) -> bool {
        self.rtl || is_rtl_text(logical)
    }

    /// يكتب كتلة نصّ ملتفّة، محاذاة يمنى للنصّ العربي.
    fn block_text(&mut self, text: &str, size: f32, bold: bool, indent: f32, color: (f32, f32, f32), prefix: Option<&str>) {
        let leading = size * 1.4;
        let width = CONTENT_W - indent;
        let rtl = self.line_rtl(text);
        let lines = self.wrap(text, size, bold, width);
        for (i, line) in lines.iter().enumerate() {
            self.ensure(leading);
            self.y -= leading;
            let visual = if self.font.is_some() { visual_order(line, rtl) } else { line.clone() };
            let w = self.measure(&visual, size, bold);
            let x = if rtl { MARGIN + CONTENT_W - indent - w } else { MARGIN + indent };
            if i == 0 {
                if let Some(p) = prefix {
                    let px = if rtl { MARGIN + CONTENT_W - indent + 6.0 } else { MARGIN + indent - 12.0 };
                    self.text_at(px, self.y, size, false, p, color);
                }
            }
            self.text_at(x, self.y, size, bold, &visual, color);
        }
    }

    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, fill: Option<(f32, f32, f32)>, stroke: Option<(f32, f32, f32)>) {
        let mut op = String::new();
        if let Some(c) = fill {
            op.push_str(&format!("{} {} {} rg ", num(c.0), num(c.1), num(c.2)));
        }
        if let Some(c) = stroke {
            op.push_str(&format!("{} {} {} RG 0.5 w ", num(c.0), num(c.1), num(c.2)));
        }
        let paint = match (fill.is_some(), stroke.is_some()) {
            (true, true) => "B",
            (true, false) => "f",
            (false, true) => "S",
            (false, false) => "n",
        };
        self.ops.push_str(&format!("{op}{} {} {} {} re {paint}\n", num(x), num(y), num(w), num(h)));
    }

    fn line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, color: (f32, f32, f32), width: f32) {
        self.ops.push_str(&format!("{} {} {} RG {} w {} {} m {} {} l S\n", num(color.0), num(color.1), num(color.2), num(width), num(x1), num(y1), num(x2), num(y2)));
    }

    fn table(&mut self, header: &[String], rows: &[Vec<String>]) {
        let size = 9.0;
        let columns = header.len().max(1);
        let col_w = CONTENT_W / columns as f32;
        let pad = 4.0;
        let leading = size * 1.3;
        let draw_row = |canvas: &mut Canvas<'_>, cells: Vec<String>, is_header: bool| {
            let wrapped: Vec<Vec<String>> = cells.iter().map(|c| canvas.wrap(c, size, is_header, col_w - 2.0 * pad).into_iter().take(4).collect()).collect();
            let lines = wrapped.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let h = lines as f32 * leading + 2.0 * pad;
            canvas.ensure(h);
            let top = canvas.y;
            for i in 0..columns {
                // الجدول العربي يبدأ عموده الأول من اليمين.
                let slot = if canvas.rtl { columns - 1 - i } else { i };
                let x = MARGIN + slot as f32 * col_w;
                let fill = if is_header { Some((0.906, 0.925, 0.957)) } else { None };
                canvas.rect(x, top - h, col_w, h, fill, Some((0.54, 0.58, 0.65)));
                if let Some(cell_lines) = wrapped.get(i) {
                    for (n, l) in cell_lines.iter().enumerate() {
                        let rtl = canvas.line_rtl(l);
                        let visual = if canvas.font.is_some() { visual_order(l, rtl) } else { l.clone() };
                        let w = canvas.measure(&visual, size, is_header);
                        let tx = if rtl { x + col_w - pad - w } else { x + pad };
                        let ty = top - pad - (n as f32 + 1.0) * leading + 3.0;
                        canvas.text_at(tx, ty, size, is_header, &visual, (0.08, 0.13, 0.24));
                    }
                }
            }
            canvas.y = top - h;
        };
        draw_row(self, header.to_vec(), true);
        for r in rows {
            let mut cells = r.clone();
            cells.resize(columns, String::new());
            draw_row(self, cells, false);
        }
        self.y -= 8.0;
    }

    fn chart(&mut self, chart: &ChartSpec) {
        let height = 230.0;
        self.ensure(height + 10.0);
        let top = self.y;
        let bottom = top - height;
        self.block_text(&chart.title, 11.0, true, 0.0, (0.08, 0.13, 0.24), None);
        let plot_left = MARGIN + 42.0;
        let plot_right = MARGIN + CONTENT_W - 8.0;
        let plot_top = self.y - 8.0;
        let plot_bottom = bottom + 44.0;
        let values = chart.series.iter().flat_map(|s| s.values.iter().copied());
        let max = values.clone().fold(0.0f64, f64::max);
        let min = values.fold(0.0f64, f64::min);
        let span = if (max - min).abs() < f64::EPSILON { 1.0 } else { max - min };
        let to_y = |v: f64| plot_bottom + ((v - min) / span) as f32 * (plot_top - plot_bottom);
        for g in 0..=4 {
            let v = min + span * g as f64 / 4.0;
            let y = to_y(v);
            self.line(plot_left, y, plot_right, y, (0.85, 0.87, 0.9), 0.4);
            let label = if v.abs() >= 1000.0 { format!("{:.0}", v) } else { format!("{:.1}", v) };
            let w = self.measure(&label, 7.0, false);
            self.text_at(plot_left - 4.0 - w, y - 2.5, 7.0, false, &label, (0.35, 0.38, 0.45));
        }
        self.line(plot_left, plot_bottom, plot_right, plot_bottom, (0.35, 0.38, 0.45), 0.8);
        let n = chart.categories.len().max(1);
        let group = (plot_right - plot_left) / n as f32;
        let series = chart.series.len().max(1);
        for (s, ser) in chart.series.iter().enumerate() {
            let color = PALETTE[s % PALETTE.len()];
            match chart.kind {
                ChartKind::Bar => {
                    let bar = group * 0.7 / series as f32;
                    for (i, v) in ser.values.iter().enumerate() {
                        let x = plot_left + i as f32 * group + group * 0.15 + s as f32 * bar;
                        let (y0, y1) = (to_y(0.0f64.max(min)), to_y(*v));
                        self.rect(x, y0.min(y1), bar, (y1 - y0).abs().max(0.5), Some(color), None);
                    }
                }
                ChartKind::Line => {
                    let mut path = String::new();
                    for (i, v) in ser.values.iter().enumerate() {
                        let x = plot_left + i as f32 * group + group / 2.0;
                        path.push_str(&format!("{} {} {} ", num(x), num(to_y(*v)), if i == 0 { "m" } else { "l" }));
                    }
                    self.ops.push_str(&format!("{} {} {} RG 1.5 w {path}S\n", num(color.0), num(color.1), num(color.2)));
                    for (i, v) in ser.values.iter().enumerate() {
                        let x = plot_left + i as f32 * group + group / 2.0;
                        self.rect(x - 2.0, to_y(*v) - 2.0, 4.0, 4.0, Some(color), None);
                    }
                }
            }
        }
        for (i, c) in chart.categories.iter().enumerate() {
            let shaped = if self.font.is_some() { shape(c) } else { c.clone() };
            let mut label = shaped;
            while self.measure(&label, 7.0, false) > group - 2.0 && label.chars().count() > 1 {
                label.pop();
            }
            let visual = if self.font.is_some() { visual_order(&label, is_rtl_text(c)) } else { label };
            let w = self.measure(&visual, 7.0, false);
            let x = plot_left + i as f32 * group + (group - w) / 2.0;
            self.text_at(x, plot_bottom - 11.0, 7.0, false, &visual, (0.35, 0.38, 0.45));
        }
        let mut lx = plot_left;
        for (s, ser) in chart.series.iter().enumerate() {
            let color = PALETTE[s % PALETTE.len()];
            self.rect(lx, bottom + 14.0, 8.0, 8.0, Some(color), None);
            let name = if self.font.is_some() { visual_order(&shape(&ser.name), is_rtl_text(&ser.name)) } else { ser.name.clone() };
            self.text_at(lx + 11.0, bottom + 15.0, 8.0, false, &name, (0.2, 0.23, 0.3));
            lx += 24.0 + self.measure(&name, 8.0, false);
        }
        self.y = bottom - 8.0;
    }
}

fn pdf_text_string(text: &str) -> String {
    // سلسلة UTF-16BE مع علامة ترتيب البايت: تصلح لأي لغة في قاموس المعلومات.
    let mut hex = String::from("<FEFF");
    for unit in text.encode_utf16() {
        hex.push_str(&format!("{unit:04X}"));
    }
    hex.push('>');
    hex
}

fn to_unicode_cmap(used: &BTreeMap<u16, char>) -> String {
    let mut body = String::new();
    let entries: Vec<(&u16, &char)> = used.iter().collect();
    for chunk in entries.chunks(100) {
        body.push_str(&format!("{} beginbfchar\n", chunk.len()));
        for (g, c) in chunk {
            let mut units = String::new();
            let mut buf = [0u16; 2];
            for u in c.encode_utf16(&mut buf) {
                units.push_str(&format!("{u:04X}"));
            }
            body.push_str(&format!("<{g:04X}> <{units}>\n", g = **g));
        }
        body.push_str("endbfchar\n");
    }
    format!(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /POLARIS-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n{body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n"
    )
}

struct ObjectWriter {
    out: Vec<u8>,
    offsets: Vec<usize>,
}

impl ObjectWriter {
    fn new() -> Self {
        let mut out = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
        out.shrink_to_fit();
        Self { out, offsets: Vec::new() }
    }

    fn object(&mut self, id: usize, body: &str) {
        self.mark(id);
        self.out.extend_from_slice(format!("{id} 0 obj\n{body}\nendobj\n").as_bytes());
    }

    fn stream(&mut self, id: usize, dict: &str, data: &[u8], compress: bool) {
        self.mark(id);
        let (payload, filter) = if compress { (compress_to_vec_zlib(data, 6), " /Filter /FlateDecode") } else { (data.to_vec(), "") };
        self.out.extend_from_slice(format!("{id} 0 obj\n<< {dict}{filter} /Length {} >>\nstream\n", payload.len()).as_bytes());
        self.out.extend_from_slice(&payload);
        self.out.extend_from_slice(b"\nendstream\nendobj\n");
    }

    fn mark(&mut self, id: usize) {
        if self.offsets.len() < id {
            self.offsets.resize(id, 0);
        }
        self.offsets[id - 1] = self.out.len();
    }

    fn finish(mut self, root: usize, info: usize) -> Vec<u8> {
        let xref = self.out.len();
        let mut table = format!("xref\n0 {}\n0000000000 65535 f \n", self.offsets.len() + 1);
        for off in &self.offsets {
            table.push_str(&format!("{off:010} 00000 n \n"));
        }
        table.push_str(&format!("trailer\n<< /Size {} /Root {root} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n", self.offsets.len() + 1));
        self.out.extend_from_slice(table.as_bytes());
        self.out
    }
}

/// يكتب المستند PDF. `font` خط مضمَّن اختياري (يلزم للعربية).
pub fn write_pdf(spec: &DocumentSpec, font: Option<&TrueTypeFont>, created_utc: &str) -> Result<PdfOutput, String> {
    spec.validate().map_err(|e| e.0)?;
    let mut canvas = Canvas::new(font, spec.is_rtl());
    canvas.block_text(&spec.title, 22.0, true, 0.0, (0.08, 0.13, 0.24), None);
    canvas.y -= 10.0;
    for block in &spec.blocks {
        match block {
            Block::Heading { text, level } => {
                canvas.y -= 6.0;
                let size = match level {
                    1 => 16.0,
                    2 => 14.0,
                    _ => 12.0,
                };
                canvas.block_text(text, size, true, 0.0, (0.12, 0.23, 0.41), None);
                canvas.y -= 2.0;
            }
            Block::Paragraph { text } => {
                for line in text.split('\n') {
                    canvas.block_text(line, 11.0, false, 0.0, (0.1, 0.1, 0.12), None);
                }
                canvas.y -= 6.0;
            }
            Block::Bullets { items } => {
                for item in items {
                    canvas.block_text(item, 11.0, false, 18.0, (0.1, 0.1, 0.12), Some("\u{2022}"));
                }
                canvas.y -= 6.0;
            }
            Block::Table { header, rows } => canvas.table(header, rows),
            Block::Chart { chart } => canvas.chart(chart),
        }
    }
    let (pages, used, unsupported) = canvas.finish();
    let page_count = pages.len();

    // ترقيم الكائنات: 1 الفهرس، 2 الصفحات، 3 المعلومات، 4.. الخطوط، ثم الصفحات ومحتواها.
    let mut w = ObjectWriter::new();
    let mut next = 4;
    let fonts_dict;
    if let Some(f) = font {
        let type0 = next;
        let cid = next + 1;
        let descriptor = next + 2;
        let file = next + 3;
        let tounicode = next + 4;
        next += 5;
        let mut widths = String::new();
        for g in used.keys() {
            widths.push_str(&format!("{g} [{}] ", f.width_1000(*g)));
        }
        let name = format!("POLARIS+{}", f.postscript_name);
        w.object(type0, &format!("<< /Type /Font /Subtype /Type0 /BaseFont /{name} /Encoding /Identity-H /DescendantFonts [{cid} 0 R] /ToUnicode {tounicode} 0 R >>"));
        w.object(cid, &format!("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor {descriptor} 0 R /CIDToGIDMap /Identity /DW 500 /W [{widths}] >>"));
        w.object(
            descriptor,
            &format!(
                "<< /Type /FontDescriptor /FontName /{name} /Flags 32 /FontBBox [{} {} {} {}] /ItalicAngle 0 /Ascent {} /Descent {} /CapHeight {} /StemV 80 /FontFile2 {file} 0 R >>",
                f.scale(f.bbox[0]),
                f.scale(f.bbox[1]),
                f.scale(f.bbox[2]),
                f.scale(f.bbox[3]),
                f.scale(f.ascent),
                f.scale(f.descent),
                f.scale(f.ascent)
            ),
        );
        w.stream(file, &format!("/Length1 {}", f.bytes.len()), &f.bytes, true);
        w.stream(tounicode, "", to_unicode_cmap(&used).as_bytes(), true);
        fonts_dict = format!("/F3 {type0} 0 R");
    } else {
        w.object(next, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
        w.object(next + 1, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
        fonts_dict = format!("/F1 {} 0 R /F2 {} 0 R", next, next + 1);
        next += 2;
    }
    let mut kids = String::new();
    for ops in &pages {
        let page = next;
        let content = next + 1;
        next += 2;
        kids.push_str(&format!("{page} 0 R "));
        w.object(page, &format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << {fonts_dict} >> >> /Contents {content} 0 R >>", num(PAGE_W), num(PAGE_H)));
        w.stream(content, "", ops.as_bytes(), true);
    }
    w.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    w.object(2, &format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>"));
    let date = created_utc.replace(['-', ':', 'T', 'Z'], "");
    w.object(3, &format!("<< /Title {} /Producer (POLARIS) /CreationDate (D:{date}Z) >>", pdf_text_string(&spec.title)));
    Ok(PdfOutput { bytes: w.finish(1, 3), pages: page_count, unsupported_glyphs: unsupported, embedded_font: font.is_some() })
}
