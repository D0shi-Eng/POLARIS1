// تشكيل الحروف العربية وترتيبها البصري لكتابة PDF بلا محرّك تشكيل خطوط.
//
// PDF يرسم الحروف كما تُعطى، فلا يصل الحروف ولا يعكس الاتجاه. لذلك نحوّل النصّ
// المنطقي إلى أشكال العرض (Presentation Forms-B) بحسب موقع الحرف في الكلمة، ونجمع
// «لا» في محرف واحد، ثم نرتّب المقاطع بصريًّا (خوارزمية ثنائية الاتجاه مبسّطة: مقاطع
// عربية تُعكس، وأرقام ولاتينية تبقى من اليسار إلى اليمين). هذا يكفي لنصوص التقارير؛
// ولا يُدّعى أنه تطبيق كامل لخوارزمية Unicode الثنائية (UAX #9).

/// (أساس، منفرد، نهائي، ابتدائي، وسطي). صفر يعني أن الشكل غير موجود (حرف يتّصل يمينًا فقط).
const FORMS: &[(u32, u32, u32, u32, u32)] = &[
    (0x0621, 0xFE80, 0, 0, 0),
    (0x0622, 0xFE81, 0xFE82, 0, 0),
    (0x0623, 0xFE83, 0xFE84, 0, 0),
    (0x0624, 0xFE85, 0xFE86, 0, 0),
    (0x0625, 0xFE87, 0xFE88, 0, 0),
    (0x0626, 0xFE89, 0xFE8A, 0xFE8B, 0xFE8C),
    (0x0627, 0xFE8D, 0xFE8E, 0, 0),
    (0x0628, 0xFE8F, 0xFE90, 0xFE91, 0xFE92),
    (0x0629, 0xFE93, 0xFE94, 0, 0),
    (0x062A, 0xFE95, 0xFE96, 0xFE97, 0xFE98),
    (0x062B, 0xFE99, 0xFE9A, 0xFE9B, 0xFE9C),
    (0x062C, 0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0),
    (0x062D, 0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4),
    (0x062E, 0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8),
    (0x062F, 0xFEA9, 0xFEAA, 0, 0),
    (0x0630, 0xFEAB, 0xFEAC, 0, 0),
    (0x0631, 0xFEAD, 0xFEAE, 0, 0),
    (0x0632, 0xFEAF, 0xFEB0, 0, 0),
    (0x0633, 0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4),
    (0x0634, 0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8),
    (0x0635, 0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC),
    (0x0636, 0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0),
    (0x0637, 0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4),
    (0x0638, 0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8),
    (0x0639, 0xFEC9, 0xFECA, 0xFECB, 0xFECC),
    (0x063A, 0xFECD, 0xFECE, 0xFECF, 0xFED0),
    (0x0640, 0x0640, 0x0640, 0x0640, 0x0640),
    (0x0641, 0xFED1, 0xFED2, 0xFED3, 0xFED4),
    (0x0642, 0xFED5, 0xFED6, 0xFED7, 0xFED8),
    (0x0643, 0xFED9, 0xFEDA, 0xFEDB, 0xFEDC),
    (0x0644, 0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0),
    (0x0645, 0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4),
    (0x0646, 0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8),
    (0x0647, 0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC),
    (0x0648, 0xFEED, 0xFEEE, 0, 0),
    (0x0649, 0xFEEF, 0xFEF0, 0, 0),
    (0x064A, 0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4),
    (0x067E, 0xFB56, 0xFB57, 0xFB58, 0xFB59),
    (0x0686, 0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D),
    (0x0698, 0xFB8A, 0xFB8B, 0, 0),
    (0x06A9, 0xFB8E, 0xFB8F, 0xFB90, 0xFB91),
    (0x06AF, 0xFB92, 0xFB93, 0xFB94, 0xFB95),
    (0x06CC, 0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF),
];

/// لام-ألف: (الألف، منفرد، نهائي).
const LAM_ALEF: &[(u32, u32, u32)] = &[(0x0622, 0xFEF5, 0xFEF6), (0x0623, 0xFEF7, 0xFEF8), (0x0625, 0xFEF9, 0xFEFA), (0x0627, 0xFEFB, 0xFEFC)];

fn forms(c: char) -> Option<&'static (u32, u32, u32, u32, u32)> {
    FORMS.iter().find(|f| f.0 == c as u32)
}

/// حركات وعلامات لا تقطع الاتصال.
fn is_transparent(c: char) -> bool {
    matches!(c as u32, 0x064B..=0x065F | 0x0670 | 0x06D6..=0x06ED)
}

fn joins_left(c: char) -> bool {
    forms(c).is_some_and(|f| f.3 != 0)
}

fn joins_right(c: char) -> bool {
    forms(c).is_some_and(|f| f.2 != 0)
}

fn char_of(code: u32, fallback: char) -> char {
    char::from_u32(code).unwrap_or(fallback)
}

/// يحوّل نصًّا منطقيًّا إلى أشكال العرض، بالترتيب المنطقي نفسه.
pub fn shape(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    // أقرب حرف غير شفّاف قبل/بعد الموضع.
    let prev_solid = |i: usize| chars[..i].iter().rev().find(|c| !is_transparent(**c)).copied();
    let next_solid = |i: usize| chars[i + 1..].iter().find(|c| !is_transparent(**c)).copied();
    while i < chars.len() {
        let c = chars[i];
        let Some(f) = forms(c) else {
            out.push(c);
            i += 1;
            continue;
        };
        let connect_prev = prev_solid(i).is_some_and(joins_left) && f.2 != 0;
        // لام يليها ألف: محرف مركّب واحد.
        if c == '\u{0644}' {
            if let Some(next_index) = (i + 1..chars.len()).find(|j| !is_transparent(chars[*j])) {
                if let Some(lig) = LAM_ALEF.iter().find(|l| l.0 == chars[next_index] as u32) {
                    out.push(char_of(if connect_prev { lig.2 } else { lig.1 }, c));
                    // الحركات بين اللام والألف تُحفظ بعد المركّب.
                    for m in &chars[i + 1..next_index] {
                        out.push(*m);
                    }
                    i = next_index + 1;
                    continue;
                }
            }
        }
        let connect_next = f.3 != 0 && next_solid(i).is_some_and(joins_right);
        let code = match (connect_prev, connect_next) {
            (true, true) => f.4,
            (true, false) => f.2,
            (false, true) => f.3,
            (false, false) => f.1,
        };
        out.push(char_of(if code == 0 { f.1 } else { code }, c));
        i += 1;
    }
    out
}

/// عكس `shape`: يعيد الأشكال إلى حروفها الأساسية لمقارنة النصّ بعد الاستخراج.
pub fn unshape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let code = c as u32;
        if let Some(l) = LAM_ALEF.iter().find(|l| l.1 == code || l.2 == code) {
            out.push('\u{0644}');
            out.push(char_of(l.0, c));
        } else if let Some(f) = FORMS.iter().find(|f| f.0 != 0x0640 && [f.1, f.2, f.3, f.4].contains(&code)) {
            out.push(char_of(f.0, c));
        } else {
            out.push(c);
        }
    }
    out
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Dir {
    Rtl,
    Ltr,
    Neutral,
}

fn direction(c: char) -> Dir {
    let code = c as u32;
    if matches!(code, 0x0590..=0x08FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF) && !matches!(code, 0x0660..=0x0669 | 0x06F0..=0x06F9) {
        Dir::Rtl
    } else if c.is_alphanumeric() {
        Dir::Ltr
    } else {
        Dir::Neutral
    }
}

fn mirror(c: char) -> char {
    match c {
        '(' => ')',
        ')' => '(',
        '[' => ']',
        ']' => '[',
        '{' => '}',
        '}' => '{',
        '<' => '>',
        '>' => '<',
        '«' => '»',
        '»' => '«',
        c => c,
    }
}

/// يرتّب سطرًا (مشكَّلًا) بصريًّا من اليسار إلى اليمين. `base_rtl` اتجاه الفقرة.
pub fn visual_order(line: &str, base_rtl: bool) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.is_empty() {
        return String::new();
    }
    // اتجاه كل محرف: المحايد يأخذ اتجاه جاريه إن اتّفقا، وإلا اتجاه الفقرة.
    let raw: Vec<Dir> = chars.iter().map(|c| direction(*c)).collect();
    let base = if base_rtl { Dir::Rtl } else { Dir::Ltr };
    let mut resolved = raw.clone();
    for i in 0..chars.len() {
        if raw[i] != Dir::Neutral {
            continue;
        }
        let before = raw[..i].iter().rev().find(|d| **d != Dir::Neutral).copied();
        let after = raw[i + 1..].iter().find(|d| **d != Dir::Neutral).copied();
        resolved[i] = match (before, after) {
            (Some(a), Some(b)) if a == b => a,
            _ => base,
        };
    }
    // مقاطع متجانسة الاتجاه بالترتيب المنطقي.
    let mut runs: Vec<(Dir, Vec<char>)> = Vec::new();
    for (c, d) in chars.iter().zip(resolved.iter()) {
        match runs.last_mut() {
            Some((dir, run)) if *dir == *d => run.push(*c),
            _ => runs.push((*d, vec![*c])),
        }
    }
    if base_rtl {
        runs.reverse();
    }
    let mut out = String::with_capacity(line.len());
    for (dir, run) in runs {
        if dir == Dir::Rtl {
            for c in run.into_iter().rev() {
                out.push(mirror(c));
            }
        } else {
            out.extend(run);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_take_their_positional_forms() {
        // «بيت»: باء ابتدائية، ياء وسطية، تاء نهائية.
        let shaped: Vec<u32> = shape("بيت").chars().map(|c| c as u32).collect();
        assert_eq!(shaped, vec![0xFE91, 0xFEF4, 0xFE96]);
        // «دار»: دال منفردة (لا تتصل يسارًا)، ألف منفردة، راء منفردة.
        let shaped: Vec<u32> = shape("دار").chars().map(|c| c as u32).collect();
        assert_eq!(shaped, vec![0xFEA9, 0xFE8D, 0xFEAD]);
    }

    #[test]
    fn lam_alef_becomes_one_ligature() {
        let shaped: Vec<u32> = shape("لا").chars().map(|c| c as u32).collect();
        assert_eq!(shaped, vec![0xFEFB]);
        let shaped: Vec<u32> = shape("سلام").chars().map(|c| c as u32).collect();
        assert_eq!(shaped, vec![0xFEB3, 0xFEFC, 0xFEE1]);
    }

    #[test]
    fn unshaping_restores_the_logical_letters() {
        for text in ["مرحبا بالعالم", "تقرير المبيعات لعام ٢٠٢٦", "لا إله"] {
            assert_eq!(unshape(&shape(text)), text);
        }
    }

    #[test]
    fn a_right_to_left_line_keeps_numbers_and_latin_left_to_right() {
        let visual = visual_order("abc 123", true);
        assert_eq!(visual, "abc 123");
        let visual = visual_order("ابت 2026", true);
        // الرقم يبقى 2026، والعربي يُعكس ويأتي على اليمين.
        assert!(visual.starts_with("2026"));
        assert!(visual.ends_with("ا"));
        assert_eq!(visual_order("(ب)", true), "(ب)");
    }
}
