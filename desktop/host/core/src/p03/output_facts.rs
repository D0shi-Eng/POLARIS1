// RW-A وRW-B (تكليف المالك 2026-10-27): حقائق يقيسها المضيف عن الملفات المكتوبة في المهمّة، لا تعليمات.
//
// RW-A: نتيجة التفويض تذكر لكل ملف كتبه المفوَّض حجمه وعدد كلماته وعناوينه كما على القرص، وتذكر أن مصحِّح العقد فحص تقرير
// العقد وحده. لا تدّعي صحة المحتوى ولا تقول «لا حاجة للتحقق».
// RW-B: نتيجة الكتابة تذكر إن كان المحتوى مطابقًا بايتًا لآخر كتابة للمسار، وعدد كتابات الوكيل للمسار من الثالثة. لا تمنع الكتابة.

use std::collections::HashMap;

use sha2::{Digest, Sha256};

pub const TOOL_WRITE: &str = "polaris.workspace.write";
pub const TOOL_EDIT: &str = "polaris.workspace.edit";
/// من هذه الكتابة للمسار نفسه يُذكر عددها.
pub const REWRITE_NOTE_FROM: u32 = 3;
const MAX_HEADINGS: usize = 12;
const HEADING_CHARS: usize = 60;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextFacts {
    pub bytes: usize,
    /// كلمات مفصولة بالمسافات: المقياس نفسه الذي حسبه المنسّق بـ`run_python` في التشغيل المقيس.
    pub words: usize,
    /// عناوين المستوى الثاني بترتيبها، بسقف.
    pub headings: Vec<String>,
}

pub fn text_facts(text: &str) -> TextFacts {
    let headings = text
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("## "))
        .map(|h| h.trim().chars().take(HEADING_CHARS).collect::<String>())
        .filter(|h| !h.is_empty())
        .take(MAX_HEADINGS)
        .collect();
    TextFacts { bytes: text.len(), words: text.split_whitespace().count(), headings }
}

/// سطر RW-A. `files`: المسار وحقائقه، أو لا شيء إن لم يوجد الآن. `checked_only`: تقرير العقد الذي فحصه المصحِّح، إن وُجد.
pub fn deliverable_line(files: &[(String, Option<TextFacts>)], checked_only: Option<&str>) -> Option<String> {
    if files.is_empty() {
        return None;
    }
    let parts: Vec<String> = files
        .iter()
        .map(|(path, facts)| match facts {
            Some(f) => format!(
                "{path}: {} bytes, {} words (whitespace-separated){}",
                f.bytes,
                f.words,
                if f.headings.is_empty() { String::new() } else { format!(", level-2 headings in order: {}", f.headings.join(" | ")) }
            ),
            None => format!("{path}: not found on disk now"),
        })
        .collect();
    let scope = checked_only.map(|p| format!(" The contract grader checked only {p}, not these files.")).unwrap_or_default();
    Some(format!("[POLARIS_MEASURED] Files the helper wrote, measured on disk after it finished: {}.{scope}", parts.join("; ")))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteSeen {
    /// كتابات هذا الوكيل لهذا المسار في المهمّة، بهذه.
    pub count: u32,
    /// المحتوى مطابق بايتًا لآخر كتابة كاملة للمسار من أي وكيل، ولم يُعدَّل بينهما.
    pub identical: bool,
}

/// كتابات المهمّة الناجحة. البصمة لكل مسار (تعديل يمحوها لأن المحتوى بعده غير معروف هنا)، والعدد لكل وكيل ومسار.
#[derive(Debug, Default)]
pub struct WriteLedger {
    last: HashMap<String, Option<[u8; 32]>>,
    counts: HashMap<(String, String), u32>,
    order: Vec<(String, String)>,
}

impl WriteLedger {
    /// يسجّل كتابة نجحت عند البوابة. غير الكتابة، أو وسائط بلا مسار: لا شيء.
    pub fn record(&mut self, agent_id: &str, tool_id: &str, arguments: &str) -> Option<(String, WriteSeen)> {
        if tool_id != TOOL_WRITE && tool_id != TOOL_EDIT {
            return None;
        }
        let args: serde_json::Value = serde_json::from_str(arguments).ok()?;
        let path = args.get("path")?.as_str()?.trim().to_string();
        if path.is_empty() {
            return None;
        }
        let hash: Option<[u8; 32]> = if tool_id == TOOL_WRITE { args.get("content").and_then(|c| c.as_str()).map(|c| Sha256::digest(c.as_bytes()).into()) } else { None };
        let identical = hash.is_some() && self.last.get(&path).copied().flatten() == hash;
        self.last.insert(path.clone(), hash);
        let key = (agent_id.to_string(), path.clone());
        let count = self.counts.entry(key.clone()).or_insert(0);
        *count += 1;
        let count = *count;
        if count == 1 {
            self.order.push(key);
        }
        Some((path, WriteSeen { count, identical }))
    }

    /// المسارات التي كتبها الوكيل، بترتيب أول كتابة.
    pub fn paths_by(&self, agent_id: &str) -> Vec<String> {
        self.order.iter().filter(|(a, _)| a == agent_id).map(|(_, p)| p.clone()).collect()
    }
}

/// سطر RW-B، أو لا شيء حين لا جديد يُقال.
pub fn rewrite_note(path: &str, seen: WriteSeen, actions_left: u32) -> Option<String> {
    let mut parts = Vec::new();
    if seen.identical {
        parts.push(format!("this write did not change {path}: the content is byte-identical to the last write to it in this request"));
    }
    if seen.count >= REWRITE_NOTE_FROM {
        parts.push(format!("you have written or edited {path} {} times in this task; {actions_left} actions remain", seen.count));
    }
    (!parts.is_empty()).then(|| format!("host note: {}.", parts.join("; ")))
}

pub const TOOL_READ: &str = "polaris.workspace.read";

/// W-2 (2026-10-28): قراءات المهمّة الكاملة لكل وكيل ومسار، ببصمة النتيجة كما صُيّرت للنموذج. نتيجة مقصوصة (من الأداة أو من
/// POLARIS) لا تُسجَّل: لا يُقال «كاملًا» عمّا لم يُرَ كاملًا.
#[derive(Debug, Default)]
pub struct ReadLedger {
    full: HashMap<(String, String), [u8; 32]>,
}

impl ReadLedger {
    /// يسجّل قراءة نجحت، ويعيد المسار إن كانت النتيجة مطابقة بايتًا لقراءة كاملة سابقة للوكيل نفسه.
    pub fn record(&mut self, agent_id: &str, tool_id: &str, arguments: &str, rendered: &str) -> Option<String> {
        if tool_id != TOOL_READ {
            return None;
        }
        let args: serde_json::Value = serde_json::from_str(arguments).ok()?;
        let path = args.get("path")?.as_str()?.trim().to_string();
        if rendered.contains("\n…(showing ") || rendered.contains("characters clipped by POLARIS)") {
            return None;
        }
        let hash: [u8; 32] = Sha256::digest(rendered.as_bytes()).into();
        let key = (agent_id.to_string(), path.clone());
        let repeated = self.full.get(&key) == Some(&hash);
        self.full.insert(key, hash);
        repeated.then_some(path)
    }
}

/// سطر حقيقة إعادة القراءة. لا يمنع شيئًا، ولا يدّعي أكثر من التطابق المقيس.
pub fn reread_note(path: &str) -> String {
    format!("host note: POLARIS already returned this exact content of {path} to you in full earlier in this task; this result is byte-identical, so the file has not changed since.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_re_read_is_noted_only_when_the_full_result_is_byte_identical() {
        let mut l = ReadLedger::default();
        let args = serde_json::json!({ "path": "inputs/a.txt" }).to_string();
        let full = "status: SUCCEEDED\nsummary: read inputs/a.txt (10 bytes, TEXT as text)\noutput:\n<<<UNTRUSTED\nbody\n UNTRUSTED>>>";
        assert_eq!(l.record("h", TOOL_READ, &args, full), None, "a first read is not a re-read");
        assert_eq!(l.record("h", TOOL_READ, &args, full), Some("inputs/a.txt".into()));
        assert_eq!(l.record("other", TOOL_READ, &args, full), None, "another agent never saw it");
        assert_eq!(l.record("h", TOOL_READ, &args, &full.replace("body", "changed")), None, "changed content");
        let clipped = full.replace("body", "a\n…(12 characters clipped by POLARIS)…\nb");
        assert_eq!(l.record("h", TOOL_READ, &args, &clipped), None);
        assert_eq!(l.record("h", TOOL_READ, &args, &clipped), None, "a clipped result is never called full");
        assert_eq!(l.record("h", TOOL_WRITE, &args, full), None);
        assert!(reread_note("inputs/a.txt").contains("already returned this exact content of inputs/a.txt"));
    }

    fn write(path: &str, content: &str) -> String {
        serde_json::json!({ "path": path, "content": content }).to_string()
    }

    #[test]
    fn facts_count_bytes_words_and_ordered_headings() {
        let f = text_facts("# T\n\n## الملخص\nنص قصير هنا\n## Risks\none two\n");
        assert_eq!(f.words, 11);
        assert_eq!(f.bytes, "# T\n\n## الملخص\nنص قصير هنا\n## Risks\none two\n".len());
        assert_eq!(f.headings, vec!["الملخص".to_string(), "Risks".to_string()]);
    }

    #[test]
    fn an_identical_write_is_seen_and_an_edit_clears_the_fingerprint() {
        let mut l = WriteLedger::default();
        assert_eq!(l.record("a", TOOL_WRITE, &write("o.md", "x")).unwrap().1, WriteSeen { count: 1, identical: false });
        assert_eq!(l.record("a", TOOL_WRITE, &write("o.md", "x")).unwrap().1, WriteSeen { count: 2, identical: true });
        l.record("a", TOOL_EDIT, &serde_json::json!({ "path": "o.md", "old_text": "x", "new_text": "y" }).to_string());
        assert_eq!(l.record("a", TOOL_WRITE, &write("o.md", "x")).unwrap().1, WriteSeen { count: 4, identical: false }, "content after an edit is unknown here");
        assert!(l.record("a", "polaris.workspace.read", &write("o.md", "x")).is_none());
        assert!(l.record("a", TOOL_WRITE, "not json").is_none());
    }

    #[test]
    fn counts_are_per_agent_and_paths_keep_first_write_order() {
        let mut l = WriteLedger::default();
        l.record("helper", TOOL_WRITE, &write("b.md", "1"));
        l.record("helper", TOOL_WRITE, &write("a.md", "1"));
        l.record("helper", TOOL_WRITE, &write("b.md", "2"));
        assert_eq!(l.record("coord", TOOL_WRITE, &write("b.md", "3")).unwrap().1.count, 1);
        assert_eq!(l.paths_by("helper"), vec!["b.md".to_string(), "a.md".to_string()]);
    }

    #[test]
    fn the_note_says_only_what_was_measured() {
        assert_eq!(rewrite_note("o.md", WriteSeen { count: 2, identical: false }, 5), None);
        let same = rewrite_note("o.md", WriteSeen { count: 2, identical: true }, 5).unwrap();
        assert!(same.contains("did not change o.md") && !same.contains("times"), "{same}");
        let third = rewrite_note("o.md", WriteSeen { count: 3, identical: false }, 4).unwrap();
        assert!(third.contains("3 times") && third.contains("4 actions remain"), "{third}");
    }

    #[test]
    fn the_deliverable_line_states_the_grader_scope_and_missing_files() {
        let line = deliverable_line(&[("outputs/report.md".into(), Some(text_facts("## A\none two three\n"))), ("gone.md".into(), None)], Some("outputs/agents/x/report.md")).unwrap();
        assert!(line.contains("outputs/report.md: 19 bytes, 5 words") && line.contains("headings in order: A"), "{line}");
        assert!(line.contains("gone.md: not found") && line.contains("checked only outputs/agents/x/report.md"), "{line}");
        assert!(!line.to_lowercase().contains("no need"), "{line}");
        assert_eq!(deliverable_line(&[], None), None);
    }
}
