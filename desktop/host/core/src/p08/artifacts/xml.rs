// أدوات XML الدنيا للحزم المولَّدة: تهريب آمن، وفحص سلامة البنية، واستخراج نصوص.
//
// الفحص هنا ليس محلّل XML كاملًا: هو ما يكفي لإثبات أن ما كتبناه نحن متوازن الوسوم
// ومهرَّب الكيانات، وأن ما نقرؤه من ملف مستخدم لا يحوي DTD (مدخل هجمات الكيانات
// الخارجية). ما يُرفض هنا لا «يُصلَح»: ملف غير سليم يُبلَّغ غير سليم.

/// يهرّب نصًّا لمحتوى عنصر أو قيمة سمة، ويحذف محارف التحكّم غير المسموحة في XML 1.0.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' | '\n' | '\r' => out.push(c),
            c if (c as u32) < 0x20 => {}
            '\u{FFFE}' | '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

/// هل في النصّ محرف عربي (أو من كتل RTL المجاورة)؟ يحدّد اتجاه الفقرة.
pub fn is_rtl_text(text: &str) -> bool {
    text.chars().any(|c| matches!(c as u32, 0x0590..=0x08FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XmlError {
    Doctype,
    Unbalanced(String),
    BadEntity(String),
    Unterminated,
    Empty,
}

impl std::fmt::Display for XmlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Doctype => write!(f, "a DOCTYPE declaration is not accepted"),
            Self::Unbalanced(t) => write!(f, "unbalanced tag {t}"),
            Self::BadEntity(e) => write!(f, "unknown entity {e}"),
            Self::Unterminated => write!(f, "unterminated markup"),
            Self::Empty => write!(f, "no root element"),
        }
    }
}

fn check_entities(text: &str) -> Result<(), XmlError> {
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        let tail = &rest[i + 1..];
        let end = tail.find(';').ok_or_else(|| XmlError::BadEntity(tail.chars().take(8).collect()))?;
        let name = &tail[..end];
        let ok = matches!(name, "amp" | "lt" | "gt" | "quot" | "apos")
            || (name.starts_with("#x") && name.len() > 2 && u32::from_str_radix(&name[2..], 16).is_ok())
            || (name.starts_with('#') && name.len() > 1 && name[1..].parse::<u32>().is_ok());
        if !ok {
            return Err(XmlError::BadEntity(name.to_string()));
        }
        rest = &tail[end + 1..];
    }
    Ok(())
}

/// يفحص سلامة البنية: وسوم متوازنة، كيانات معروفة، لا DTD، جذر واحد على الأقل.
pub fn check_well_formed(xml: &str) -> Result<(), XmlError> {
    let mut stack: Vec<String> = Vec::new();
    let mut rest = xml;
    let mut saw_root = false;
    while let Some(open) = rest.find('<') {
        check_entities(&rest[..open])?;
        let after = &rest[open..];
        if after.starts_with("<!--") {
            let end = after.find("-->").ok_or(XmlError::Unterminated)?;
            rest = &after[end + 3..];
            continue;
        }
        if after.starts_with("<![CDATA[") {
            let end = after.find("]]>").ok_or(XmlError::Unterminated)?;
            rest = &after[end + 3..];
            continue;
        }
        if after.starts_with("<!") {
            return Err(XmlError::Doctype);
        }
        if after.starts_with("<?") {
            let end = after.find("?>").ok_or(XmlError::Unterminated)?;
            rest = &after[end + 2..];
            continue;
        }
        // نهاية الوسم مع احترام القيم المقتبسة.
        let mut quote: Option<char> = None;
        let mut end = None;
        for (i, c) in after.char_indices().skip(1) {
            match (quote, c) {
                (Some(q), c) if c == q => quote = None,
                (Some(_), _) => {}
                (None, '"') | (None, '\'') => quote = Some(c),
                (None, '>') => {
                    end = Some(i);
                    break;
                }
                (None, '<') => return Err(XmlError::Unterminated),
                _ => {}
            }
        }
        let end = end.ok_or(XmlError::Unterminated)?;
        let inner = &after[1..end];
        check_entities(inner)?;
        if let Some(name) = inner.strip_prefix('/') {
            let name = name.trim();
            match stack.pop() {
                Some(top) if top == name => {}
                _ => return Err(XmlError::Unbalanced(name.to_string())),
            }
        } else {
            saw_root = true;
            let self_closing = inner.ends_with('/');
            let name: String = inner.trim_end_matches('/').split_whitespace().next().unwrap_or("").to_string();
            if name.is_empty() {
                return Err(XmlError::Unterminated);
            }
            if !self_closing {
                stack.push(name);
            }
        }
        rest = &after[end + 1..];
    }
    check_entities(rest)?;
    if let Some(open) = stack.pop() {
        return Err(XmlError::Unbalanced(open));
    }
    if !saw_root {
        return Err(XmlError::Empty);
    }
    Ok(())
}

/// يفكّ الكيانات الخمسة والمراجع الرقمية. ما لا يُعرف يبقى حرفيًّا (بعد فحص السلامة لا يحدث).
pub fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let Some(end) = tail.find(';') else {
            out.push_str(&rest[i..]);
            return out;
        };
        let name = &tail[..end];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            n if n.starts_with("#x") => u32::from_str_radix(&n[2..], 16).ok().and_then(char::from_u32),
            n if n.starts_with('#') => n[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => out.push(c),
            None => {
                out.push('&');
                out.push_str(name);
                out.push(';');
            }
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    out
}

/// يجمع نصوص عناصر باسم محدَّد (مثل `w:t` أو `a:t` أو `t`) بالترتيب.
pub fn texts_of(xml: &str, element: &str) -> Vec<String> {
    let open_plain = format!("<{element}>");
    let open_attr = format!("<{element} ");
    let close = format!("</{element}>");
    let mut out = Vec::new();
    let mut rest = xml;
    loop {
        let a = rest.find(&open_plain);
        let b = rest.find(&open_attr);
        let start = match (a, b) {
            (Some(x), Some(y)) => x.min(y),
            (Some(x), None) | (None, Some(x)) => x,
            (None, None) => break,
        };
        let after = &rest[start..];
        let Some(gt) = after.find('>') else { break };
        if after[..gt].ends_with('/') {
            rest = &after[gt + 1..];
            continue;
        }
        let body = &after[gt + 1..];
        let Some(end) = body.find(&close) else { break };
        out.push(unescape(&body[..end]));
        rest = &body[end + close.len()..];
    }
    out
}

/// عدد مرّات ظهور عنصر مفتوح (مع سمات أو بدونها).
pub fn count_elements(xml: &str, element: &str) -> usize {
    let a = format!("<{element}>");
    let b = format!("<{element} ");
    let c = format!("<{element}/>");
    xml.matches(&a).count() + xml.matches(&b).count() + xml.matches(&c).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaping_round_trips_and_drops_forbidden_controls() {
        let raw = "a<b>&\"c'\u{0001}عربي";
        let e = escape(raw);
        assert!(!e.contains('\u{0001}'));
        assert_eq!(unescape(&e), "a<b>&\"c'عربي");
        assert!(check_well_formed(&format!("<r a=\"{e}\">{e}</r>")).is_ok());
    }

    #[test]
    fn a_doctype_is_refused_so_external_entities_cannot_be_declared() {
        let xxe = "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY x SYSTEM \"file:///c:/secret\">]><r>&x;</r>";
        assert_eq!(check_well_formed(xxe), Err(XmlError::Doctype));
    }

    #[test]
    fn unbalanced_or_unknown_entities_fail() {
        assert!(check_well_formed("<a><b></a>").is_err());
        assert!(check_well_formed("<a>&nbsp;</a>").is_err());
        assert!(check_well_formed("<a>").is_err());
        assert!(check_well_formed("text").is_err());
        assert!(check_well_formed("<a x='1>2'><b/></a>").is_ok());
    }

    #[test]
    fn texts_are_extracted_in_order_across_attribute_forms() {
        let xml = r#"<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; مرحبا</w:t></w:r><w:t/></w:p>"#;
        assert_eq!(texts_of(xml, "w:t"), vec!["Hello".to_string(), " & مرحبا".to_string()]);
        assert_eq!(count_elements(xml, "w:r"), 2);
    }

    #[test]
    fn arabic_is_detected_as_right_to_left() {
        assert!(is_rtl_text("تقرير 2026"));
        assert!(!is_rtl_text("Report 2026"));
    }
}
