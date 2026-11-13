// قارئ PDF للتحقق وللتحليل: عدد الصفحات، ونصّ الصفحات، وعلامات المحتوى النشط.
//
// ليس عارض PDF: يقرأ الكائنات بالتسلسل، ويفكّ تدفّقات FlateDecode بسقف، ويستخرج
// معاملات Tj/TJ. يكفي لإثبات أن ملفًا كتبناه يُعاد فتحه بالبنية المتوقَّعة، ولقراءة
// نصّ ملف مرفوع بسيط. ملف لا يُقرأ هنا يُعلن غير مقروء، ولا يُفترض صالحًا.

use std::collections::BTreeMap;

use miniz_oxide::inflate::decompress_to_vec_zlib_with_limit;

use super::metrics::from_win_ansi;

const MAX_INFLATED: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PdfInfo {
    pub pages: usize,
    pub text: String,
    /// JavaScript أو إجراء تشغيل أو ملف مضمَّن: محتوى نشط لا نُنتجه أبدًا.
    pub active_content: bool,
    pub encrypted: bool,
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from >= hay.len() {
        return None;
    }
    hay[from..].windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

fn stream_length(dict: &str) -> Option<usize> {
    let at = dict.find("/Length ")?;
    dict[at + 8..].split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

fn parse_literal(bytes: &[u8], start: usize) -> (Vec<u8>, usize) {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut i = start + 1;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'\\' if i + 1 < bytes.len() => {
                let n = bytes[i + 1];
                match n {
                    b'n' => out.push(b'\n'),
                    b'r' => out.push(b'\r'),
                    b't' => out.push(b'\t'),
                    b'0'..=b'7' => {
                        let mut v = 0u32;
                        let mut k = 0;
                        while k < 3 && i + 1 + k < bytes.len() && (b'0'..=b'7').contains(&bytes[i + 1 + k]) {
                            v = v * 8 + (bytes[i + 1 + k] - b'0') as u32;
                            k += 1;
                        }
                        out.push(v as u8);
                        i += k + 1;
                        continue;
                    }
                    other => out.push(other),
                }
                i += 2;
            }
            b'(' => {
                depth += 1;
                out.push(b);
                i += 1;
            }
            b')' if depth == 0 => return (out, i + 1),
            b')' => {
                depth -= 1;
                out.push(b);
                i += 1;
            }
            _ => {
                out.push(b);
                i += 1;
            }
        }
    }
    (out, i)
}

fn parse_cmap(text: &str, map: &mut BTreeMap<u16, String>) {
    for block in text.split("beginbfchar").skip(1) {
        let body = block.split("endbfchar").next().unwrap_or("");
        let hexes: Vec<&str> = body.split(['<', '>']).map(str::trim).filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_hexdigit())).collect();
        for pair in hexes.chunks(2) {
            if let [g, u] = pair {
                let Ok(glyph) = u16::from_str_radix(g, 16) else { continue };
                let units: Vec<u16> = u.as_bytes().chunks(4).filter_map(|c| std::str::from_utf8(c).ok()).filter_map(|c| u16::from_str_radix(c, 16).ok()).collect();
                map.insert(glyph, String::from_utf16_lossy(&units));
            }
        }
    }
}

fn extract_text(content: &[u8], cmap: &BTreeMap<u16, String>) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < content.len() {
        match content[i] {
            b'(' => {
                let (bytes, next) = parse_literal(content, i);
                out.extend(bytes.iter().map(|b| from_win_ansi(*b)));
                i = next;
            }
            b'<' if content.get(i + 1) != Some(&b'<') => {
                let end = find(content, b">", i).unwrap_or(content.len());
                let hex: Vec<u8> = content[i + 1..end].iter().copied().filter(u8::is_ascii_hexdigit).collect();
                if !cmap.is_empty() && hex.len().is_multiple_of(4) {
                    for chunk in hex.chunks(4) {
                        if let Some(g) = std::str::from_utf8(chunk).ok().and_then(|s| u16::from_str_radix(s, 16).ok()) {
                            out.push_str(cmap.get(&g).map(String::as_str).unwrap_or(""));
                        }
                    }
                } else {
                    for chunk in hex.chunks(2) {
                        if let Some(b) = std::str::from_utf8(chunk).ok().and_then(|s| u8::from_str_radix(s, 16).ok()) {
                            out.push(from_win_ansi(b));
                        }
                    }
                }
                i = end + 1;
            }
            b'E' if content.get(i + 1) == Some(&b'T') => {
                out.push('\n');
                i += 2;
            }
            _ => i += 1,
        }
    }
    out
}

/// يقرأ ملف PDF ويعيد معلوماته، أو سبب تعذّر القراءة.
pub fn read_pdf(bytes: &[u8]) -> Result<PdfInfo, String> {
    if !bytes.starts_with(b"%PDF-") {
        return Err("the file does not start with a PDF header".into());
    }
    let tail = &bytes[bytes.len().saturating_sub(1024)..];
    if find(tail, b"%%EOF", 0).is_none() {
        return Err("the file has no end-of-file marker".into());
    }
    let mut info = PdfInfo::default();
    let mut streams: Vec<Vec<u8>> = Vec::new();
    let mut inflated_total = 0usize;
    let mut cursor = 0;
    let mut objects = 0;
    while let Some(at) = find(bytes, b" obj", cursor) {
        objects += 1;
        if objects > 200_000 {
            return Err("too many objects".into());
        }
        let end = find(bytes, b"endobj", at).unwrap_or(bytes.len());
        let stream_at = find(bytes, b"stream", at).filter(|s| *s < end);
        let dict_end = stream_at.unwrap_or(end);
        let dict = String::from_utf8_lossy(&bytes[at..dict_end]).replace(['\r', '\n'], " ");
        let compact = dict.replace(' ', "");
        if compact.contains("/Type/Page/") || compact.contains("/Type/Page>") || compact.ends_with("/Type/Page") {
            info.pages += 1;
        }
        if compact.contains("/JavaScript") || compact.contains("/JS") || compact.contains("/Launch") || compact.contains("/EmbeddedFile") {
            info.active_content = true;
        }
        if compact.contains("/Encrypt") {
            info.encrypted = true;
        }
        if let (Some(s), Some(len)) = (stream_at, stream_length(&dict)) {
            let mut data_start = s + 6;
            if bytes.get(data_start) == Some(&b'\r') {
                data_start += 1;
            }
            if bytes.get(data_start) == Some(&b'\n') {
                data_start += 1;
            }
            if let Some(raw) = bytes.get(data_start..data_start + len) {
                let data = if compact.contains("/FlateDecode") {
                    decompress_to_vec_zlib_with_limit(raw, MAX_INFLATED - inflated_total).unwrap_or_default()
                } else {
                    raw.to_vec()
                };
                inflated_total += data.len();
                // ملف خط مضمَّن (/Length1 مع مسافة، لا «/Length153») ليس محتوى صفحة.
                if !dict.contains("/Length1 ") {
                    streams.push(data);
                }
            }
            cursor = data_start + len;
        } else {
            cursor = end.min(bytes.len());
        }
        if cursor <= at {
            cursor = at + 4;
        }
    }
    let mut cmap = BTreeMap::new();
    for s in &streams {
        let text = String::from_utf8_lossy(s);
        if text.contains("beginbfchar") {
            parse_cmap(&text, &mut cmap);
        }
    }
    for s in &streams {
        let text = String::from_utf8_lossy(s);
        if text.contains("beginbfchar") || !(text.contains(" Tj") || text.contains("TJ")) {
            continue;
        }
        info.text.push_str(&extract_text(s, &cmap));
    }
    if info.pages == 0 {
        return Err("the file declares no page".into());
    }
    Ok(info)
}
