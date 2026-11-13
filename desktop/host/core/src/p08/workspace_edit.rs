// تعديل جزئي لملف نصّي في مساحة العمل (تكليف المالك 2026-10-27، بحث المعماريات الأربع W-3): يستبدل نصًّا قديمًا بنصّ جديد في
// موضع واحد بالضبط، بدل إعادة كتابة الملف كاملًا. المرجع الوظيفي `str_replace_editor` في OpenManus و`lines_replace` في AGIAgent؛
// التنفيذ مستقل.
//
// الحدود حدود `write_file` نفسها: المسار داخل مساحة المهمّة ومنطقة الكتابة، والكتابة ذرّية (ملف مؤقّت ثم إعادة تسمية)، والأثر
// WORKSPACE_WRITE فلا موافقة. صفر تطابقات أو أكثر من واحد رفضُ صياغة يقول العدد وما يفعله الوكيل، ولا يُكتب شيء.

use serde_json::{json, Value};

use crate::p04::adapter::{reject_unknown_fields, string_field, ToolAdapter, ToolCallContext, ToolFailure, ToolOutcome};
use crate::p04::effect::ToolEffect;
use crate::p04::tool::ToolDescriptor;

use super::execution::tools::descriptor;
use super::workspace::{normalise_relative, WorkspaceError, WorkspaceRoot, MAX_FILE_BYTES};

pub const TOOL_EDIT: &str = "polaris.workspace.edit";

/// حدّ كل من النصّين، كحدّ الكتابة.
const MAX_TEXT: usize = 2 * 1024 * 1024;

pub struct EditTool {
    pub workspaces: WorkspaceRoot,
}

fn failure(e: WorkspaceError) -> ToolFailure {
    match e {
        WorkspaceError::NotFound(_) | WorkspaceError::TooLarge(_) => ToolFailure::ArgumentsInvalid(e.to_string()),
        WorkspaceError::Io(_) => ToolFailure::Unavailable(e.to_string()),
        _ => ToolFailure::OutOfScope(e.to_string()),
    }
}

fn text_field<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, ToolFailure> {
    let text = arguments.get(key).and_then(Value::as_str).ok_or_else(|| ToolFailure::ArgumentsInvalid(format!("{key} must be a string")))?;
    if text.len() > MAX_TEXT {
        return Err(ToolFailure::ArgumentsInvalid(format!("{key} is larger than 2 MB")));
    }
    Ok(text)
}

impl ToolAdapter for EditTool {
    fn tool_id(&self) -> &str {
        TOOL_EDIT
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_EDIT,
            "Edit part of a text file in the workspace",
            "Replaces one exact piece of text in an existing UTF-8 file (HTML, CSS, code, Markdown…) under work/ or outputs/, without rewriting the whole file. Arguments: path (relative), old_text (copied exactly from the file, including spaces and line breaks; it must appear exactly once), new_text (its replacement; may be empty to delete it). Read the file first.",
            vec![ToolEffect::WorkspaceWrite],
        )
    }

    fn input_schema(&self) -> Option<Value> {
        Some(crate::p08::tool_schemas::workspace_edit())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["path", "old_text", "new_text"])?;
        let p = string_field(arguments, "path", 260)?;
        normalise_relative(&p).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
        if text_field(arguments, "old_text")?.is_empty() {
            return Err(ToolFailure::ArgumentsInvalid("old_text must not be empty; to write a whole file use write_file".into()));
        }
        text_field(arguments, "new_text")?;
        Ok(())
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        let ws = self.workspaces.for_mission(context.mission_id).map_err(|e| ToolFailure::Unavailable(e.to_string()))?;
        let rel = string_field(arguments, "path", 260)?;
        let old_text = text_field(arguments, "old_text")?;
        let new_text = text_field(arguments, "new_text")?;
        let before = ws.read(&rel, MAX_FILE_BYTES).map_err(failure)?;
        let text = String::from_utf8(before.clone()).map_err(|_| ToolFailure::ArgumentsInvalid(format!("{rel} is not a UTF-8 text file; edit_file changes text only, use write_file or the document tools")))?;
        let (edited, line) = replace_once(&text, old_text, new_text).map_err(|count| {
            ToolFailure::ArgumentsInvalid(if count == 0 {
                format!("old_text was not found in {rel}; read the file and copy the exact text, including spaces and line breaks")
            } else {
                format!("old_text appears {count} times in {rel}; include more of the surrounding text so it matches exactly one place")
            })
        })?;
        let bytes = edited.into_bytes();
        let path = ws.write(&rel, &bytes).map_err(failure)?;
        let written = ws.relative(&path).unwrap_or(rel);
        Ok(ToolOutcome {
            summary: format!("edited {written} at line {line} ({} → {} bytes)", before.len(), bytes.len()),
            measured_bytes: json!({ "path": written, "sha256_before": crate::digest::sha256_hex(&before), "sha256": crate::digest::sha256_hex(&bytes) }).to_string().into_bytes(),
            supports: true,
            detail: String::new(),
            evidence: None,
            observation: Some(format!("replaced one occurrence in {written} at line {line}; the file is now {} bytes", bytes.len())),
        })
    }
}

/// يستبدل التطابق الوحيد ويعيد النصّ ورقم سطر بدايته. عدد التطابقات (صفر أو أكثر من واحد) خطأً.
/// ملف بأسطر Windows (CRLF) يقبل نصًّا كُتب بأسطر LF (هكذا يكتب النموذج غالبًا)، فيُحوَّل النصّان إلى أسطر الملف.
fn replace_once(text: &str, old_text: &str, new_text: &str) -> Result<(String, usize), usize> {
    let mut count = text.matches(old_text).count();
    let (mut old, mut new) = (old_text.to_string(), new_text.to_string());
    if count == 0 && text.contains("\r\n") && old_text.contains('\n') && !old_text.contains("\r\n") {
        old = old_text.replace('\n', "\r\n");
        new = new_text.replace("\r\n", "\n").replace('\n', "\r\n");
        count = text.matches(old.as_str()).count();
    }
    if count != 1 {
        return Err(count);
    }
    let at = text.find(old.as_str()).unwrap_or(0);
    let line = text[..at].matches('\n').count() + 1;
    Ok((text.replacen(old.as_str(), &new, 1), line))
}

#[cfg(test)]
mod tests {
    use super::*;
    use polaris_host_providers::net::CancelToken;

    const MISSION: &str = "3f1c2a4e-8b7d-4e6f-9a1b-2c3d4e5f6a7b";

    fn setup() -> ((), EditTool) {
        let dir = crate::test_scratch::root().join(format!("edit-{}", crate::ids::new_uuid_v4()));
        ((), EditTool { workspaces: WorkspaceRoot::new(dir) })
    }

    fn put(tool: &EditTool, rel: &str, text: &str) {
        tool.workspaces.for_mission(MISSION).unwrap().write(rel, text.as_bytes()).unwrap();
    }

    fn get(tool: &EditTool, rel: &str) -> String {
        String::from_utf8(tool.workspaces.for_mission(MISSION).unwrap().read(rel, MAX_FILE_BYTES).unwrap()).unwrap()
    }

    fn run(tool: &EditTool, arguments: Value) -> Result<ToolOutcome, ToolFailure> {
        tool.validate(&arguments)?;
        let cancel = CancelToken::new();
        tool.execute(&arguments, &ToolCallContext { mission_id: MISSION, task_id: "t1", agent_id: "a1", project_id: None, timeout_ms: 10_000, cancel: &cancel })
    }

    #[test]
    fn one_exact_match_is_replaced_and_nothing_else_changes() {
        let (_d, tool) = setup();
        put(&tool, "outputs/index.html", "<h1>Old</h1>\n<p>keep</p>\n");
        let outcome = run(&tool, json!({ "path": "outputs/index.html", "old_text": "<h1>Old</h1>", "new_text": "<h1>New</h1>" })).unwrap();
        assert_eq!(get(&tool, "outputs/index.html"), "<h1>New</h1>\n<p>keep</p>\n");
        assert!(outcome.summary.contains("outputs/index.html"), "{}", outcome.summary);
    }

    #[test]
    fn no_match_and_several_matches_are_refused_with_the_count_and_the_file_is_untouched() {
        let (_d, tool) = setup();
        put(&tool, "outputs/a.css", ".b{color:red}\n.b{color:red}\n");
        let none = run(&tool, json!({ "path": "outputs/a.css", "old_text": ".c{}", "new_text": "x" }));
        assert!(matches!(&none, Err(ToolFailure::ArgumentsInvalid(m)) if m.contains("not found")), "{none:?}");
        let many = run(&tool, json!({ "path": "outputs/a.css", "old_text": ".b{color:red}", "new_text": "x" }));
        assert!(matches!(&many, Err(ToolFailure::ArgumentsInvalid(m)) if m.contains("2 times")), "{many:?}");
        assert_eq!(get(&tool, "outputs/a.css"), ".b{color:red}\n.b{color:red}\n");
    }

    #[test]
    fn an_empty_old_text_unknown_fields_and_a_traversal_are_refused_before_any_read() {
        let (_d, tool) = setup();
        assert!(tool.validate(&json!({ "path": "outputs/a.txt", "old_text": "", "new_text": "x" })).is_err());
        assert!(tool.validate(&json!({ "path": "outputs/a.txt", "old_text": "a", "new_text": "b", "all": true })).is_err());
        assert!(tool.validate(&json!({ "path": "../a.txt", "old_text": "a", "new_text": "b" })).is_err());
        assert!(tool.validate(&json!({ "path": "outputs/a.txt", "old_text": "a" })).is_err());
    }

    #[test]
    fn a_missing_file_and_a_binary_file_are_refused() {
        let (_d, tool) = setup();
        let missing = run(&tool, json!({ "path": "outputs/none.txt", "old_text": "a", "new_text": "b" }));
        assert!(matches!(missing, Err(ToolFailure::ArgumentsInvalid(_))), "{missing:?}");
        tool.workspaces.for_mission(MISSION).unwrap().write("outputs/x.bin", &[0xff, 0xfe, 0x00, 0x41]).unwrap();
        let binary = run(&tool, json!({ "path": "outputs/x.bin", "old_text": "A", "new_text": "B" }));
        assert!(matches!(&binary, Err(ToolFailure::ArgumentsInvalid(m)) if m.contains("UTF-8")), "{binary:?}");
    }

    #[test]
    fn a_file_with_windows_line_breaks_matches_text_written_with_plain_line_breaks() {
        let (_d, tool) = setup();
        put(&tool, "work/a.md", "# T\r\nline one\r\nline two\r\n");
        run(&tool, json!({ "path": "work/a.md", "old_text": "line one\nline two", "new_text": "line 1\nline 2" })).unwrap();
        assert_eq!(get(&tool, "work/a.md"), "# T\r\nline 1\r\nline 2\r\n");
    }

    #[test]
    fn the_read_only_inputs_area_cannot_be_edited() {
        let (_d, tool) = setup();
        let ws = tool.workspaces.for_mission(MISSION).unwrap();
        let _ = ws.write_runtime("inputs", "data.csv", b"a,b\n");
        let refused = run(&tool, json!({ "path": "inputs/data.csv", "old_text": "a,b", "new_text": "x,y" }));
        assert!(refused.is_err(), "{refused:?}");
        assert_eq!(String::from_utf8(ws.read("inputs/data.csv", MAX_FILE_BYTES).unwrap()).unwrap(), "a,b\n");
    }
}
