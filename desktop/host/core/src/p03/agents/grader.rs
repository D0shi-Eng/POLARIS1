// مصحِّح عقد المخرجات: كود حتمي يقرأ ملف التقرير كما قاسه المضيف، مستقلّ عن نثر الوكيل.
//
// ما يقيسه: وجود التقرير في مساره، وقسم الخلاصة، وعنوان لكل بند تحقّق بترتيبه، ونصّ حقيقي تحت كل عنوان. ما لا يقيسه: صحّة
// المحتوى المهني. نجاح هذا المصحِّح يعني أن الوكيل سلّم ما تعهّد بتسليمه بالشكل المتّفق عليه، لا أن ما كتبه صحيح؛ وهذا الحدّ
// يُكتب في الدليل الذي يسجّله.

use serde::Serialize;

use super::definition::AgentDefinition;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SectionGrade {
    pub heading: String,
    pub present: bool,
    pub chars: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentGrade {
    pub agent_id: String,
    pub version: String,
    pub report_found: bool,
    pub sections: Vec<SectionGrade>,
    pub passed: bool,
}

impl AgentGrade {
    /// سطر الدليل: ما قاسه المصحِّح، بلا محتوى التقرير.
    pub fn summary(&self) -> String {
        if !self.report_found {
            return format!("[AGENT_CONTRACT_GRADER] {} v{}: the report was not found", self.agent_id, self.version);
        }
        let ok = self.sections.iter().filter(|s| s.present && s.chars > 0).count();
        let missing: Vec<&str> = self.sections.iter().filter(|s| !s.present || s.chars == 0).map(|s| s.heading.as_str()).collect();
        format!(
            "[AGENT_CONTRACT_GRADER] {} v{}: {} — {ok}/{} required sections present with content{}",
            self.agent_id,
            self.version,
            if self.passed { "PASSED" } else { "FAILED" },
            self.sections.len(),
            if missing.is_empty() { String::new() } else { format!("; missing or thin: {}", missing.join(", ")) }
        )
    }
}

/// أقسام Markdown من المستوى الثاني بعناوينها ونصّها.
fn sections(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            out.push((heading.trim().to_string(), String::new()));
        } else if trimmed.starts_with("# ") {
            // عنوان من المستوى الأول يغلق القسم السابق ولا يفتح قسمًا مطلوبًا.
            out.push((String::new(), String::new()));
        } else if let Some((_, body)) = out.last_mut() {
            body.push_str(line);
            body.push('\n');
        }
    }
    out
}

fn content_chars(text: &str) -> usize {
    text.chars().filter(|c| !c.is_whitespace()).count()
}

/// يصحّح التقرير. `text` محتوى الملف كما قرأه المضيف، أو لا شيء إن لم يوجد.
pub fn grade(definition: &AgentDefinition, text: Option<&str>) -> AgentGrade {
    let required: Vec<String> = std::iter::once(definition.output.summary_heading.to_string()).chain(definition.output.check_headings.iter().cloned()).collect();
    let Some(text) = text else {
        return AgentGrade {
            agent_id: definition.agent_id.clone(),
            version: definition.version.clone(),
            report_found: false,
            sections: required.into_iter().map(|heading| SectionGrade { heading, present: false, chars: 0 }).collect(),
            passed: false,
        };
    };
    let found = sections(text);
    let mut cursor = 0usize;
    let mut graded = Vec::new();
    // العناوين تُطلب بترتيبها: عنوان بعد موضع سابقه.
    for heading in required {
        let wanted = heading.to_lowercase();
        let position = found.iter().enumerate().skip(cursor).find(|(_, (h, _))| {
            let h = h.to_lowercase();
            h == wanted || h.starts_with(&format!("{wanted} ")) || h.starts_with(&format!("{wanted}:")) || h.starts_with(&format!("{wanted} —")) || h.starts_with(&format!("{wanted} -"))
        });
        match position {
            Some((index, (_, body))) => {
                cursor = index + 1;
                let chars = content_chars(body);
                graded.push(SectionGrade { heading, present: true, chars: if chars >= definition.output.min_section_chars { chars } else { 0 } });
            }
            None => graded.push(SectionGrade { heading, present: false, chars: 0 }),
        }
    }
    let passed = graded.iter().all(|s| s.present && s.chars > 0);
    AgentGrade { agent_id: definition.agent_id.clone(), version: definition.version.clone(), report_found: true, sections: graded, passed }
}

/// تقرير يجتاز العقد، لتجهيزات الاختبار وحدها: نصّ تحت كل عنوان بترتيبه. لا يُستعمل في مسار المنتج.
pub fn conforming_report(definition: &AgentDefinition, note: &str) -> String {
    let mut out = format!("# {}\n\n## {}\n{note} This report follows the agent output contract.\n\n", definition.name_en, definition.output.summary_heading);
    for (heading, check) in definition.output.check_headings.iter().zip(&definition.checks) {
        out.push_str(&format!("## {heading} — {check}\nAddressed for this request: {check}\n\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p03::agents::AgentDirectory;

    #[test]
    fn a_conforming_report_passes_and_missing_or_thin_or_reordered_sections_fail() {
        let d = &AgentDirectory::builtin().definitions()[0];
        assert!(grade(d, Some(&conforming_report(d, "ok."))).passed);
        assert!(!grade(d, None).passed);
        let without_check_2 = conforming_report(d, "ok.").replace("## Check 2", "## Notes");
        assert!(!grade(d, Some(&without_check_2)).passed);
        let thin = "## Summary\nfine summary text here.\n## Check 1\nx\n## Check 2\nx\n## Check 3\nx\n## Check 4\nx\n".to_string();
        assert!(!grade(d, Some(&thin)).passed, "one-letter sections passed");
        let reordered = conforming_report(d, "ok.").replacen("## Summary", "## Check 9", 1) + "## Summary\nlate summary that comes after the checks.\n";
        assert!(!grade(d, Some(&reordered)).passed, "a summary after the checks passed");
    }
}
