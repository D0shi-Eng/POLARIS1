// تنقية مخرجات العمليات قبل العرض أو إعادتها للنموذج.
//
// ثلاثة أشياء: حذف تسلسلات ANSI (ألوان وتحريك مؤشّر قد تخفي نصًّا أو تزوّر ما يراه
// المستخدم)، وحذف محارف التحكّم الأخرى، وحجب ما يشبه سرًّا في كل سطر. الأسطر تبقى
// أسطرًا — المخرجات النهائية نصّ طرفية، لا سطر تشخيص واحد.

const MARKERS: [&str; 8] = ["password", "passwd", "secret", "token", "api_key", "apikey", "authorization", "bearer"];

/// يحذف تسلسلات CSI/OSC وأي محرف تحكّم غير السطر الجديد والجدولة.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.peek() {
                Some('[') => {
                    chars.next();
                    // حتى محرف نهائي بين @ و~.
                    for n in chars.by_ref() {
                        if ('@'..='~').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC ينتهي بـBEL أو ESC\.
                    while let Some(n) = chars.next() {
                        if n == '\u{7}' {
                            break;
                        }
                        if n == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {
                    chars.next();
                }
            },
            '\r' => {}
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

fn looks_like_secret(token: &str) -> bool {
    let body = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    body.len() >= 32
        && body.chars().any(|c| c.is_ascii_digit())
        && body.chars().any(|c| c.is_ascii_alphabetic())
        && body.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | '+' | '='))
}

/// يحجب القيم بعد علامات الأسرار والمقاطع الطويلة الشبيهة بالمفاتيح، سطرًا سطرًا.
pub fn redact_lines(text: &str) -> String {
    text.lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if let Some(m) = MARKERS.iter().find(|m| lower.contains(*m)) {
                let at = lower.find(m).unwrap_or(0) + m.len();
                // ما بعد العلامة يُحجب كله: قيمة، أو ترويسة، أو سطر إعداد.
                let head: String = line.chars().take(line[..at.min(line.len())].chars().count()).collect();
                return format!("{head}: [REDACTED]");
            }
            line.split(' ').map(|t| if looks_like_secret(t) { "[REDACTED]" } else { t }).collect::<Vec<_>>().join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// التنقية الكاملة مع سقف بالمحارف. يعيد النصّ وهل قُطع.
pub fn sanitize(bytes: &[u8], max_chars: usize) -> (String, bool) {
    let text = redact_lines(&strip_ansi(&String::from_utf8_lossy(bytes)));
    if text.chars().count() <= max_chars {
        return (text, false);
    }
    // يُحتفظ بالنهاية: آخر المخرجات (الخطأ، النتيجة) أهمّ من بدايتها في الغالب.
    let skip = text.chars().count() - max_chars;
    (format!("…[{skip} characters omitted]\n{}", text.chars().skip(skip).collect::<String>()), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ansi_sequences_and_controls_are_removed() {
        let raw = "\u{1b}[31mred\u{1b}[0m \u{1b}]0;title\u{7}ok\u{8}\r\nnext";
        assert_eq!(strip_ansi(raw), "red ok\nnext");
    }

    #[test]
    fn secret_like_values_are_redacted_line_by_line() {
        let raw = "user=alice\nAPI_KEY=sk-live-0123456789abcdef0123456789abcdef\nplain line\nhash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
        let out = redact_lines(raw);
        assert!(!out.contains("0123456789abcdef0123456789abcdef"));
        assert!(out.contains("user=alice"));
        assert!(out.contains("plain line"));
        assert!(!out.contains("9f86d081884c7d659a2feaa0c55ad015"));
        assert_eq!(out.lines().count(), 4);
    }

    #[test]
    fn long_output_keeps_its_tail() {
        let (text, cut) = sanitize("a".repeat(100).as_bytes(), 10);
        assert!(cut);
        assert!(text.ends_with("aaaaaaaaaa"));
        assert!(text.starts_with("…[90"));
    }
}
