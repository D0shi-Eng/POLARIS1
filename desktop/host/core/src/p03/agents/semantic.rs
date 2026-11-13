// المصحّح الدلالي لمجموعة `agents-300-eval/2/semantic` (تكليف 2026-10-14، G3).
//
// لكل وكيل ملف مدخلات اصطناعي بحقائق مزروعة (مجموع، أو أعلى قيمة، أو تاريخ متعارض، أو بند ناقص، أو الخطر الأعلى درجة)، مشتقّ
// حتميًّا من بصمة معرّف الوكيل، وقيمته المتوقّعة تُحسب هنا عند بناء الحالة قبل أي تشغيل. التقرير يجب أن يحمل سطرًا
// `ANSWER: <value>`؛ المصحّح كود حتمي يستخرج أوّل سطر منها ويقارنه بالمتوقّع بعد تطبيع شكلي. لا نموذج يحكم على نموذج.
//
// سطر `ANSWER:` اتفاق بين الحالة والمصحّح وحدهما: لا يقرؤه المنتج ولا يُطلق فيه سلوكًا (درس X-16).

use serde::Serialize;

use super::definition::AgentDefinition;

/// نوع الحقيقة المزروعة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FactKind {
    Sum,
    Max,
    ConflictingDate,
    MissingItem,
    NamedRisk,
}

/// حقيقة مزروعة لوكيل: ملف المدخلات، والسؤال كما يدخل الطلب، والقيمة المتوقّعة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Planted {
    pub kind: FactKind,
    pub input_path: String,
    pub input_text: String,
    pub question: String,
    pub expected: String,
}

/// حكم المصحّح الدلالي.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SemanticGrade {
    pub report_found: bool,
    pub answer: Option<String>,
    pub expected: String,
    pub passed: bool,
}

/// مولّد حتمي صغير (xorshift64) مبذور ببصمة معرّف الوكيل: يكفي لأرقام اصطناعية قابلة للإعادة، وليس للتعمية.
struct Seeded(u64);

impl Seeded {
    fn of(agent_id: &str) -> Self {
        let hex = crate::digest::sha256_hex(format!("agents-300-eval/2/semantic:{agent_id}").as_bytes());
        Self(u64::from_str_radix(&hex[..16], 16).unwrap_or(0x9E37_79B9_7F4A_7C15).max(1))
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    /// عدد في [low, high].
    fn range(&mut self, low: u64, high: u64) -> u64 {
        low + self.next() % (high - low + 1)
    }
}

/// نوع الحقيقة بملف المجال، والبصمة تختار بين نوعين حيث يصلح كلاهما.
fn kind_for(profile_id: &str, seed: &mut Seeded) -> FactKind {
    let pick = seed.next().is_multiple_of(2);
    match profile_id {
        "documents" if pick => FactKind::MissingItem,
        "documents" => FactKind::ConflictingDate,
        "advisory" | "security" => FactKind::NamedRisk,
        "compute" if pick => FactKind::Sum,
        "compute" => FactKind::Max,
        "finance" => FactKind::Sum,
        "research" => FactKind::ConflictingDate,
        _ => FactKind::MissingItem,
    }
}

const LETTERS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ";

/// رموز فريدة بالبادئة نفسها، مثل `SITE-K` أو `DOC-07`.
fn codes(seed: &mut Seeded, prefix: &str, n: usize, letters: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    while out.len() < n {
        let code = if letters { format!("{prefix}-{}", LETTERS[seed.range(0, LETTERS.len() as u64 - 1) as usize] as char) } else { format!("{prefix}-{:02}", seed.range(1, 99)) };
        if !out.contains(&code) {
            out.push(code);
        }
    }
    out
}

/// يزرع حقيقة لوكيل. حتمي: الوكيل نفسه يأخذ المدخل نفسه في كل بناء.
pub fn plant(d: &AgentDefinition) -> Planted {
    let mut seed = Seeded::of(&d.agent_id);
    let kind = kind_for(d.profile_id, &mut seed);
    let slug = d.agent_id.rsplit('.').next().unwrap_or("agent");
    let input_path = format!("inputs/eval2/{}/{slug}/facts.txt", d.domain_id);
    let (input_text, question, expected) = match kind {
        FactKind::Sum => {
            let items = codes(&mut seed, "LINE", 6, false);
            let values: Vec<u64> = items.iter().map(|_| seed.range(120, 9_800)).collect();
            let mut text = String::from("Nakheel Labs (synthetic) — line items for the quarter, in SAR:\n");
            for (item, value) in items.iter().zip(&values) {
                text.push_str(&format!("{item}: {value}\n"));
            }
            (text, "What is the total of all line items in SAR (a whole number)?".to_string(), values.iter().sum::<u64>().to_string())
        }
        FactKind::Max => {
            let sites = codes(&mut seed, "SITE", 7, true);
            let mut values: Vec<u64> = Vec::new();
            while values.len() < sites.len() {
                let v = seed.range(100, 999);
                if !values.contains(&v) {
                    values.push(v);
                }
            }
            let mut text = String::from("Nakheel Labs (synthetic) — measured load per site, in units:\n");
            for (site, value) in sites.iter().zip(&values) {
                text.push_str(&format!("{site}: {value}\n"));
            }
            let top = sites.iter().zip(&values).max_by_key(|(_, v)| **v).map(|(s, _)| s.clone()).unwrap_or_default();
            (text, "Which site has the highest measured load? Give its site code.".to_string(), top)
        }
        FactKind::ConflictingDate => {
            let milestones = codes(&mut seed, "M", 5, false);
            let dates: Vec<(u64, u64)> = milestones.iter().map(|_| (seed.range(1, 12), seed.range(1, 27))).collect();
            let odd = seed.range(0, milestones.len() as u64 - 1) as usize;
            let mut text = String::from("Nakheel Labs (synthetic) — two schedules for the same milestones.\nSchedule A:\n");
            for (m, (month, day)) in milestones.iter().zip(&dates) {
                text.push_str(&format!("{m}: 2027-{month:02}-{day:02}\n"));
            }
            text.push_str("Schedule B:\n");
            let mut expected = String::new();
            for (i, (m, (month, day))) in milestones.iter().zip(&dates).enumerate() {
                let day = if i == odd { day + 1 } else { *day };
                if i == odd {
                    expected = format!("2027-{month:02}-{day:02}");
                }
                text.push_str(&format!("{m}: 2027-{month:02}-{day:02}\n"));
            }
            (text, "Exactly one milestone has a different date in Schedule B than in Schedule A. What is that milestone's date in Schedule B (YYYY-MM-DD)?".to_string(), expected)
        }
        FactKind::MissingItem => {
            let required = codes(&mut seed, "DOC", 6, false);
            let missing = seed.range(0, required.len() as u64 - 1) as usize;
            let mut text = String::from("Nakheel Labs (synthetic) — required documents:\n");
            for r in &required {
                text.push_str(&format!("- {r}\n"));
            }
            text.push_str("Submitted package:\n");
            for (i, r) in required.iter().enumerate().rev() {
                if i != missing {
                    text.push_str(&format!("- {r}\n"));
                }
            }
            (text, "Which required document is missing from the submitted package? Give its code.".to_string(), required[missing].clone())
        }
        FactKind::NamedRisk => {
            let risks = codes(&mut seed, "RISK", 5, false);
            // درجة الخطر = الاحتمال × الأثر، بأعلى درجة فريدة.
            let scores: Vec<(u64, u64)> = loop {
                let scores: Vec<(u64, u64)> = risks.iter().map(|_| (seed.range(1, 5), seed.range(1, 5))).collect();
                let products: Vec<u64> = scores.iter().map(|(l, i)| l * i).collect();
                let top = products.iter().copied().max().unwrap_or(0);
                if products.iter().filter(|p| **p == top).count() == 1 {
                    break scores;
                }
            };
            let mut text = String::from("Nakheel Labs (synthetic) — risk register (likelihood and impact on a 1–5 scale):\n");
            for (r, (l, i)) in risks.iter().zip(&scores) {
                text.push_str(&format!("{r}: likelihood {l}, impact {i}\n"));
            }
            let top = risks.iter().zip(&scores).max_by_key(|(_, (l, i))| l * i).map(|(r, _)| r.clone()).unwrap_or_default();
            (text, "Which risk has the highest score (likelihood × impact)? Give its code.".to_string(), top)
        }
    };
    Planted { kind, input_path, input_text, question, expected }
}

/// تطبيع شكلي للقيمة: أحرف كبيرة، بلا فراغات ولا علامات Markdown ولا فواصل آلاف ولا وحدة SAR ولا نقطة ختامية.
fn normalize(value: &str) -> String {
    let mut v: String = value.chars().filter(|c| !c.is_whitespace() && !matches!(c, '*' | '`' | '_' | '"' | '\'' | ',')).collect::<String>().to_uppercase();
    v = v.replace("SAR", "");
    while v.ends_with('.') {
        v.pop();
    }
    v
}

/// أوّل سطر `ANSWER:` في التقرير، مطبَّعًا. ما قبل الكلمة زخرفة Markdown فقط (تعداد أو تغليظ)، لا جملة تذكرها عرضًا.
pub fn extract_answer(report: &str) -> Option<String> {
    report.lines().find_map(|line| {
        const LABEL: &str = "ANSWER:";
        let at = line.char_indices().map(|(i, _)| i).find(|&i| line.get(i..i + LABEL.len()).is_some_and(|s| s.eq_ignore_ascii_case(LABEL)))?;
        if line[..at].chars().any(char::is_alphanumeric) {
            return None;
        }
        Some(normalize(&line[at + "ANSWER:".len()..]))
    })
}

/// يصحّح التقرير دلاليًّا: أوّل سطر `ANSWER:` يساوي المتوقّع بعد التطبيع.
pub fn grade_answer(expected: &str, report: Option<&str>) -> SemanticGrade {
    let answer = report.and_then(extract_answer);
    let passed = answer.as_deref().is_some_and(|a| !a.is_empty() && a == normalize(expected));
    SemanticGrade { report_found: report.is_some(), answer, expected: expected.to_string(), passed }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p03::agents::grader::conforming_report;
    use crate::p03::agents::AgentDirectory;

    fn with_answer(d: &AgentDefinition, answer: &str) -> String {
        format!("{}\nANSWER: {answer}\n", conforming_report(d, "Assessment for Nakheel Labs (control)."))
    }

    /// قيمة خاطئة من النوع نفسه: رقم مزاح، أو تاريخ مزاح يومًا، أو رمز آخر من المدخل نفسه.
    fn wrong(p: &Planted) -> String {
        match p.kind {
            FactKind::Sum => (p.expected.parse::<u64>().unwrap() + 1).to_string(),
            FactKind::ConflictingDate => {
                let day: u32 = p.expected[8..].parse().unwrap();
                format!("{}{:02}", &p.expected[..8], if day == 28 { 27 } else { day + 1 })
            }
            _ => p.input_text.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric() && c != '-')).find(|w| w.contains('-') && *w != p.expected && w.starts_with(&p.expected[..p.expected.find('-').unwrap() + 1])).unwrap().to_string(),
        }
    }

    #[test]
    fn every_agent_has_a_planted_fact_that_its_correct_report_passes_and_a_wrong_value_fails() {
        let mut bad = Vec::new();
        let mut kinds = std::collections::BTreeSet::new();
        for d in AgentDirectory::builtin().definitions() {
            let p = plant(d);
            kinds.insert(format!("{:?}", p.kind));
            if p.expected.is_empty() || !p.input_path.starts_with("inputs/") || p.question.is_empty() {
                bad.push(format!("{}: the planted fact is incomplete", d.agent_id));
                continue;
            }
            if p.input_text.contains(&d.agent_id) || p.input_text.contains("outputs/agents") {
                bad.push(format!("{}: the input names the agent or its deliverable", d.agent_id));
            }
            // موجب: البنية صحيحة والقيمة صحيحة.
            if !grade_answer(&p.expected, Some(&with_answer(d, &p.expected))).passed {
                bad.push(format!("{}: the correct value failed", d.agent_id));
            }
            // موجب بتنسيق Markdown شائع حول القيمة.
            if !grade_answer(&p.expected, Some(&format!("{}\n- **ANSWER:** `{}`.\n", conforming_report(d, "x"), p.expected))).passed {
                bad.push(format!("{}: the correct value in Markdown failed", d.agent_id));
            }
            // سلبي: البنية صحيحة والقيمة خاطئة.
            let w = wrong(&p);
            if grade_answer(&p.expected, Some(&with_answer(d, &w))).passed {
                bad.push(format!("{}: a wrong value {w} passed", d.agent_id));
            }
            // سلبي: البنية صحيحة بلا سطر ANSWER، والقيمة الصحيحة مذكورة في النثر وحده.
            if grade_answer(&p.expected, Some(&format!("{}\nThe value is {}.\n", conforming_report(d, "x"), p.expected))).passed {
                bad.push(format!("{}: a report without an ANSWER line passed", d.agent_id));
            }
            // سلبي: لا تقرير.
            if grade_answer(&p.expected, None).passed {
                bad.push(format!("{}: a missing report passed", d.agent_id));
            }
            // حتمية.
            if plant(d) != p {
                bad.push(format!("{}: the planted fact is not deterministic", d.agent_id));
            }
        }
        assert!(bad.is_empty(), "{} failures:\n{}", bad.len(), bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
        assert_eq!(kinds.len(), 5, "not all five fact kinds are used: {kinds:?}");
    }

    #[test]
    fn the_first_answer_line_is_the_one_graded() {
        assert_eq!(extract_answer("intro\nANSWER: 1,250 SAR\nANSWER: 9\n").as_deref(), Some("1250"));
        assert_eq!(extract_answer("answer: risk-07").as_deref(), Some("RISK-07"));
        assert_eq!(extract_answer("no line here"), None);
        assert!(!grade_answer("1250", Some("ANSWER: 12500")).passed);
        assert!(!grade_answer("2026-03-04", Some("ANSWER: 2026-03-05")).passed);
    }
}
