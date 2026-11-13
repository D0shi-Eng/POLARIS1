// صفحات HTML: كتابة مستند مستقلّ من نموذج المحتوى، وفحص حزمة موقع كتبها الوكيل.
//
// الصفحة المولَّدة لا تحمل سكربتًا ولا موردًا بعيدًا: الأنماط مضمَّنة، والمخطط SVG
// مضمَّن، وسياسة أمن المحتوى في الوسم نفسه تمنع التحميل. حزمة الموقع التي يكتبها
// الوكيل تُفحص فحصًا بنيويًّا: الروابط المحلية موجودة داخل الحزمة، والروابط البعيدة
// تُحصى وتُعلن، و`javascript:` مرفوض. الفحص لا يشغّل شيئًا من الحزمة.

use super::spec::{Block, ChartKind, ChartSpec, DocumentSpec};
use super::xml::{escape, is_rtl_text};

const CSS: &str = "body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;margin:0;background:#f5f7fb;color:#14213d}main{max-width:880px;margin:0 auto;padding:40px 28px;background:#fff;min-height:100vh}h1{font-size:30px;margin:0 0 20px}h2{font-size:22px;margin:28px 0 10px}h3{font-size:18px;margin:22px 0 8px}p,li{line-height:1.65;font-size:16px}table{border-collapse:collapse;width:100%;margin:14px 0}th,td{border:1px solid #c9d1de;padding:8px 10px;text-align:start}th{background:#e7ecf4}figure{margin:18px 0}figcaption{font-weight:600;margin-bottom:6px}";

fn svg_chart(chart: &ChartSpec) -> String {
    let (w, h, left, bottom, top) = (640.0f64, 300.0f64, 48.0f64, 40.0f64, 16.0f64);
    let values: Vec<f64> = chart.series.iter().flat_map(|s| s.values.iter().copied()).collect();
    let max = values.iter().copied().fold(0.0f64, f64::max);
    let min = values.iter().copied().fold(0.0f64, f64::min);
    let span = if (max - min).abs() < f64::EPSILON { 1.0 } else { max - min };
    let plot_h = h - bottom - top;
    let y = |v: f64| top + plot_h - (v - min) / span * plot_h;
    let colors = ["#3d6fe0", "#22a6b3", "#e0a23d", "#7c5cd6", "#2fa36b", "#d65c5c"];
    let n = chart.categories.len().max(1) as f64;
    let group = (w - left - 10.0) / n;
    let mut body = String::new();
    for g in 0..=4 {
        let v = min + span * g as f64 / 4.0;
        body.push_str(&format!("<line x1=\"{left}\" x2=\"{}\" y1=\"{:.1}\" y2=\"{:.1}\" stroke=\"#e2e6ee\"/><text x=\"{}\" y=\"{:.1}\" font-size=\"10\" text-anchor=\"end\" fill=\"#5a6173\">{:.1}</text>", w - 10.0, y(v), y(v), left - 6.0, y(v) + 3.0, v));
    }
    let series_count = chart.series.len().max(1) as f64;
    for (s, ser) in chart.series.iter().enumerate() {
        let color = colors[s % colors.len()];
        match chart.kind {
            ChartKind::Bar => {
                let bar = group * 0.7 / series_count;
                for (i, v) in ser.values.iter().enumerate() {
                    let x = left + i as f64 * group + group * 0.15 + s as f64 * bar;
                    let (y0, y1) = (y(0.0f64.max(min)), y(*v));
                    body.push_str(&format!("<rect x=\"{x:.1}\" y=\"{:.1}\" width=\"{bar:.1}\" height=\"{:.1}\" fill=\"{color}\"><title>{}: {v}</title></rect>", y0.min(y1), (y1 - y0).abs().max(0.5), escape(&ser.name)));
                }
            }
            ChartKind::Line => {
                let points: Vec<String> = ser.values.iter().enumerate().map(|(i, v)| format!("{:.1},{:.1}", left + i as f64 * group + group / 2.0, y(*v))).collect();
                body.push_str(&format!("<polyline fill=\"none\" stroke=\"{color}\" stroke-width=\"2\" points=\"{}\"/>", points.join(" ")));
            }
        }
    }
    for (i, c) in chart.categories.iter().enumerate() {
        body.push_str(&format!("<text x=\"{:.1}\" y=\"{}\" font-size=\"10\" text-anchor=\"middle\" fill=\"#5a6173\">{}</text>", left + i as f64 * group + group / 2.0, h - bottom + 16.0, escape(c)));
    }
    format!(
        "<figure><figcaption>{}</figcaption><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {h}\" role=\"img\" aria-label=\"{}\">{body}</svg></figure>",
        escape(&chart.title),
        escape(&chart.title)
    )
}

/// صفحة HTML مستقلّة من نموذج المستند.
pub fn document_html(spec: &DocumentSpec) -> Result<String, String> {
    spec.validate().map_err(|e| e.0)?;
    let rtl = spec.is_rtl();
    let lang = spec.language.clone().unwrap_or_else(|| if rtl { "ar".into() } else { "en".into() });
    let mut body = format!("<h1>{}</h1>", escape(&spec.title));
    for block in &spec.blocks {
        match block {
            Block::Heading { text, level } => body.push_str(&format!("<h{l}>{}</h{l}>", escape(text), l = level + 1)),
            Block::Paragraph { text } => {
                for line in text.split('\n').filter(|l| !l.trim().is_empty()) {
                    let dir = if is_rtl_text(line) { " dir=\"rtl\"" } else { "" };
                    body.push_str(&format!("<p{dir}>{}</p>", escape(line)));
                }
            }
            Block::Bullets { items } => {
                body.push_str("<ul>");
                for i in items {
                    body.push_str(&format!("<li>{}</li>", escape(i)));
                }
                body.push_str("</ul>");
            }
            Block::Table { header, rows } => {
                body.push_str("<table><thead><tr>");
                for h in header {
                    body.push_str(&format!("<th>{}</th>", escape(h)));
                }
                body.push_str("</tr></thead><tbody>");
                for r in rows {
                    body.push_str("<tr>");
                    for c in r {
                        body.push_str(&format!("<td>{}</td>", escape(c)));
                    }
                    body.push_str("</tr>");
                }
                body.push_str("</tbody></table>");
            }
            Block::Chart { chart } => body.push_str(&svg_chart(chart)),
        }
    }
    Ok(format!(
        "<!DOCTYPE html>\n<html lang=\"{}\" dir=\"{}\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\"><meta name=\"generator\" content=\"POLARIS\"><title>{}</title><style>{CSS}</style></head><body><main>{body}</main></body></html>\n",
        escape(&lang),
        if rtl { "rtl" } else { "ltr" },
        escape(&spec.title)
    ))
}

/// نتيجة فحص حزمة موقع.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SiteCheck {
    pub pages: usize,
    pub has_doctype: bool,
    pub has_title: bool,
    pub missing_local_refs: Vec<String>,
    pub remote_refs: Vec<String>,
    pub javascript_urls: usize,
    pub inline_scripts: usize,
}

impl SiteCheck {
    /// الحزمة صالحة: صفحة واحدة على الأقل، كلها بإعلان النوع وعنوان، بلا مرجع محلي
    /// مفقود ولا رابط `javascript:`. الموارد البعيدة لا تُسقط الحزمة، بل تُعلن.
    pub fn valid(&self) -> bool {
        self.pages > 0 && self.has_doctype && self.has_title && self.missing_local_refs.is_empty() && self.javascript_urls == 0
    }
}

fn attribute_values<'a>(html: &'a str, attribute: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    let needle = format!("{attribute}=");
    let mut from = 0;
    while let Some(at) = lower[from..].find(&needle) {
        let start = from + at + needle.len();
        // الاسم يجب أن يكون سمة كاملة، لا ذيل سمة أخرى (data-src).
        let before = lower[..from + at].chars().last();
        from = start;
        if before.is_some_and(|c| c.is_ascii_alphanumeric() || c == '-') {
            continue;
        }
        let rest = &html[start..];
        let (quote, body) = match rest.chars().next() {
            Some(q @ ('"' | '\'')) => (Some(q), &rest[1..]),
            _ => (None, rest),
        };
        let end = match quote {
            Some(q) => body.find(q),
            None => body.find(|c: char| c.is_whitespace() || c == '>'),
        }
        .unwrap_or(body.len());
        out.push(&body[..end]);
    }
    out
}

/// يفحص حزمة موقع: `files` أسماء نسبية بفواصل أمامية مع محتواها.
pub fn check_site(files: &[(String, Vec<u8>)]) -> SiteCheck {
    let names: std::collections::BTreeSet<String> = files.iter().map(|(n, _)| n.to_lowercase()).collect();
    let mut check = SiteCheck { has_doctype: true, has_title: true, ..Default::default() };
    for (name, data) in files {
        if !(name.ends_with(".html") || name.ends_with(".htm")) {
            continue;
        }
        check.pages += 1;
        let html = String::from_utf8_lossy(data);
        let lower = html.to_ascii_lowercase();
        check.has_doctype &= lower.trim_start().starts_with("<!doctype html");
        check.has_title &= lower.contains("<title>") && !lower.contains("<title></title>");
        check.inline_scripts += lower.matches("<script>").count() + lower.matches("<script type=").count();
        let dir = name.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
        for value in attribute_values(&html, "src").into_iter().chain(attribute_values(&html, "href")) {
            let v = value.trim();
            let lv = v.to_ascii_lowercase();
            if lv.starts_with("javascript:") {
                check.javascript_urls += 1;
            } else if lv.starts_with("http://") || lv.starts_with("https://") || lv.starts_with("//") {
                check.remote_refs.push(v.to_string());
            } else if v.is_empty() || lv.starts_with('#') || lv.starts_with("mailto:") || lv.starts_with("data:") || lv.starts_with("tel:") {
            } else {
                let path = v.split(['?', '#']).next().unwrap_or(v);
                let joined = normalise(&format!("{dir}{path}"));
                if joined.as_ref().is_none_or(|p| !names.contains(&p.to_lowercase())) {
                    check.missing_local_refs.push(v.to_string());
                }
            }
        }
    }
    if check.pages == 0 {
        check.has_doctype = false;
        check.has_title = false;
    }
    check
}

/// يطبّع مسارًا نسبيًّا داخل الحزمة. `None` إن تسلّق خارجها.
fn normalise(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_generated_page_has_no_script_and_no_remote_resource() {
        let spec: DocumentSpec = serde_json::from_str(r#"{"title":"تقرير","blocks":[{"type":"paragraph","text":"<script>alert(1)</script>"},{"type":"chart","chart":{"title":"c","categories":["a"],"series":[{"name":"s","values":[1]}]}}]}"#).unwrap();
        let html = document_html(&spec).unwrap();
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("dir=\"rtl\""));
        let check = check_site(&[("index.html".into(), html.into_bytes())]);
        assert!(check.valid(), "{check:?}");
        assert!(check.remote_refs.is_empty());
    }

    #[test]
    fn a_site_with_a_missing_asset_or_javascript_url_is_invalid() {
        let page = b"<!doctype html><html><head><title>x</title><link href=\"style.css\"></head><body><a href=\"javascript:alert(1)\">x</a><img data-src=\"ignored.png\" src=\"../../etc/passwd\"><script src=\"https://cdn.example/x.js\"></script></body></html>".to_vec();
        let check = check_site(&[("index.html".into(), page)]);
        assert!(!check.valid());
        assert_eq!(check.javascript_urls, 1);
        assert!(check.missing_local_refs.iter().any(|r| r == "style.css"));
        assert!(check.missing_local_refs.iter().any(|r| r.contains("passwd")));
        assert_eq!(check.remote_refs, vec!["https://cdn.example/x.js".to_string()]);
    }

    #[test]
    fn local_references_resolve_relative_to_the_page() {
        let page = b"<!DOCTYPE html><html><head><title>t</title><link rel=stylesheet href=\"../css/site.css\"></head><body><a href=\"about.html#team\">a</a></body></html>".to_vec();
        let files = vec![("pages/index.html".into(), page), ("pages/about.html".into(), b"<!DOCTYPE html><title>a</title>".to_vec()), ("css/site.css".into(), b"body{}".to_vec())];
        let check = check_site(&files);
        assert!(check.valid(), "{check:?}");
    }
}
