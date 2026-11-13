// مخططات وسائط الأدوات المدمجة بصيغة JSON Schema، للعرض على النموذج في الاستدعاء الأصيل (خطة 2026-10-05، B1).
//
// المخطط عرضٌ يوجّه النموذج، لا حارس: التحقق الحاكم يبقى `validate()` في كل محوّل. لذلك القاعدة أن المخطط
// أضيق من التحقق أو مساوٍ له، لا أوسع: كل ما يقبله المخطط في عيّنات الاختبار يقبله `validate()`.
//
// لماذا بلا حدود طول ولا عدد (`maxLength`، `maxItems`): الخادم المحلي يحوّل مخطط الوسائط إلى قواعد فكّ
// مقيَّد، وحدٌّ كبير كـ 200000 محرف يضخّم القواعد بلا فائدة. الحدود تبقى في التحقق، وتُذكر في الوصف.
//
// قِيس 2026-10-05: الرفوض الثلاثة لـ ARGUMENTS_INVALID في بيانات المالك كلّها على `polaris.artifact.document`،
// ووصفها كان نثرًا فقط. هذا المخطط يصف الشكل نفسه بنية لا نثرًا.

use serde_json::{json, Value};

fn relative_path(what: &str) -> Value {
    json!({ "type": "string", "description": format!("{what}: a path relative to the mission workspace, without .. or a drive letter") })
}

fn strings(description: &str) -> Value {
    json!({ "type": "array", "items": { "type": "string" }, "description": description })
}

fn chart() -> Value {
    json!({
        "type": "object",
        "properties": {
            "title": { "type": "string" },
            "kind": { "type": "string", "enum": ["bar", "line"] },
            "categories": strings("1 to 200 category labels"),
            "series": {
                "type": "array",
                "description": "1 to 8 series; each has exactly one value per category",
                "items": {
                    "type": "object",
                    "properties": { "name": { "type": "string" }, "values": { "type": "array", "items": { "type": "number" } } },
                    "required": ["name", "values"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["title", "categories", "series"],
        "additionalProperties": false
    })
}

fn table_fields() -> (Value, Value) {
    (strings("1 to 30 column names"), json!({ "type": "array", "items": { "type": "array", "items": { "type": "string" } }, "description": "rows no wider than the header" }))
}

fn block() -> Value {
    let (header, rows) = table_fields();
    json!({
        "anyOf": [
            { "type": "object", "properties": { "type": { "const": "heading" }, "text": { "type": "string" }, "level": { "type": "integer", "enum": [1, 2, 3] } }, "required": ["type", "text"], "additionalProperties": false },
            { "type": "object", "properties": { "type": { "const": "paragraph" }, "text": { "type": "string" } }, "required": ["type", "text"], "additionalProperties": false },
            { "type": "object", "properties": { "type": { "const": "bullets" }, "items": strings("the list items") }, "required": ["type", "items"], "additionalProperties": false },
            { "type": "object", "properties": { "type": { "const": "table" }, "header": header, "rows": rows }, "required": ["type", "header", "rows"], "additionalProperties": false },
            { "type": "object", "properties": { "type": { "const": "chart" }, "chart": chart() }, "required": ["type", "chart"], "additionalProperties": false }
        ]
    })
}

fn language() -> Value {
    json!({ "type": "string", "enum": ["ar", "en"] })
}

pub fn document() -> Value {
    json!({
        "type": "object",
        "properties": {
            "format": { "type": "string", "enum": ["docx", "pdf", "html", "markdown"] },
            "path": relative_path("optional output file; default outputs/<title>.<ext>"),
            "spec": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "language": language(),
                    "blocks": { "type": "array", "items": block(), "description": "the document body, in order" }
                },
                "required": ["title", "blocks"],
                "additionalProperties": false
            }
        },
        "required": ["format", "spec"],
        "additionalProperties": false
    })
}

pub fn presentation() -> Value {
    let (header, rows) = table_fields();
    json!({
        "type": "object",
        "properties": {
            "path": relative_path("optional output .pptx file"),
            "spec": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "subtitle": { "type": "string" },
                    "language": language(),
                    "slides": {
                        "type": "array",
                        "description": "1 to 100 slides; a cover slide is added before them",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "bullets": strings("at most 20 bullets"),
                                "table": { "type": "object", "properties": { "header": header, "rows": rows }, "required": ["header", "rows"], "additionalProperties": false },
                                "chart": chart(),
                                "notes": { "type": "string" }
                            },
                            "required": ["title"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["title", "slides"],
                "additionalProperties": false
            }
        },
        "required": ["spec"],
        "additionalProperties": false
    })
}

pub fn spreadsheet() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": relative_path("optional output .xlsx file"),
            "spec": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "sheets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string", "description": "1 to 31 characters, none of [ ] : * ? / \\" },
                                "header": strings("column names; needed when the sheet has a chart"),
                                "rows": { "type": "array", "items": { "type": "array", "items": { "type": ["number", "string", "null"] } }, "description": "data rows under the header; a string starting with = is a formula" },
                                "chart": {
                                    "type": "object",
                                    "properties": {
                                        "title": { "type": "string" },
                                        "kind": { "type": "string", "enum": ["bar", "line"] },
                                        "value_columns": { "type": "array", "items": { "type": "integer" }, "description": "header indexes of the value columns; column 0 holds the categories" }
                                    },
                                    "required": ["title", "value_columns"],
                                    "additionalProperties": false
                                }
                            },
                            "required": ["name", "rows"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["title", "sheets"],
                "additionalProperties": false
            }
        },
        "required": ["spec"],
        "additionalProperties": false
    })
}

pub fn register() -> Value {
    json!({
        "type": "object",
        "properties": { "path": relative_path("an existing file or folder"), "title": { "type": "string" } },
        "required": ["path", "title"],
        "additionalProperties": false
    })
}

pub fn workspace_list() -> Value {
    json!({
        "type": "object",
        "properties": { "path": relative_path("optional folder to list"), "depth": { "type": "integer", "description": "1 to 6, default 3" } },
        "additionalProperties": false
    })
}

pub fn workspace_read() -> Value {
    json!({
        "type": "object",
        "properties": { "path": relative_path("the file to read"), "max_chars": { "type": "integer", "description": "200 to 60000" } },
        "required": ["path"],
        "additionalProperties": false
    })
}

pub fn workspace_write() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": relative_path("the file to write"),
            "content": { "type": "string", "description": "the UTF-8 text, at most 2 MB per call" },
            "append": { "type": "boolean", "description": "true adds content to the end of the file instead of replacing it; use it to write a long file in parts" }
        },
        "required": ["path", "content"],
        "additionalProperties": false
    })
}

/// تعديل جزئي: المثال المعلن يتقدّم على المشتقّ، لأن النصّ القديم الفارغ مرفوض ولا يقوله المخطط (لا حدود طول في المخططات).
pub fn workspace_edit() -> Value {
    json!({
        "type": "object",
        "properties": {
            "path": relative_path("the existing text file to edit"),
            "old_text": { "type": "string", "description": "the exact text to replace, copied from the file with its spaces and line breaks; it must appear exactly once and must not be empty" },
            "new_text": { "type": "string", "description": "the replacement text; empty deletes old_text" }
        },
        "required": ["path", "old_text", "new_text"],
        "additionalProperties": false,
        "examples": [ { "path": "outputs/index.html", "old_text": "<h1>Welcome</h1>", "new_text": "<h1>Hello</h1>" } ]
    })
}

pub fn workspace_export() -> Value {
    json!({
        "type": "object",
        "properties": { "path": relative_path("the workspace file to export"), "file_name": { "type": "string", "description": "a file name only, not a path" } },
        "required": ["path", "file_name"],
        "additionalProperties": false
    })
}

/// D-MP-12: نقل ملف أو مجلد داخل `outputs/` أو إعادة تسميته.
pub fn workspace_move() -> Value {
    json!({
        "type": "object",
        "properties": { "from": relative_path("under outputs/"), "to": relative_path("new path under outputs/") },
        "required": ["from", "to"],
        "additionalProperties": false
    })
}

/// D-MP-12: حذف ملف أو مجلد تحت `outputs/`.
pub fn workspace_delete() -> Value {
    json!({
        "type": "object",
        "properties": { "path": relative_path("under outputs/") },
        "required": ["path"],
        "additionalProperties": false
    })
}

pub fn python() -> Value {
    json!({
        "type": "object",
        "description": "give exactly one of code or script",
        // مثال صالح (كلمة توضيح في المعيار، لا قيد): القاعدة «واحد من الاثنين» لا يحملها المخطط دون oneOf، وoneOf قد يغيّر
        // قواعد الفكّ التي يبنيها الخادم من المخطط. المثال يظهر في إرشاد الرفض (B6) ويراه النموذج مع تعريف الأداة.
        "examples": [{ "code": "print(1 + 1)" }],
        "properties": {
            "code": { "type": "string", "description": "Python source to run" },
            "script": relative_path("a .py file in the workspace to run"),
            "arguments": strings("at most 32 command-line arguments"),
            "timeout_seconds": { "type": "integer", "description": "1 to 900" },
            "network": { "type": "boolean", "description": "true needs a human approval" }
        },
        "additionalProperties": false
    })
}

pub fn command() -> Value {
    json!({
        "type": "object",
        "properties": {
            "command": { "type": "string" },
            "timeout_seconds": { "type": "integer", "description": "1 to 900" },
            "working_directory": relative_path("optional working folder"),
            "network": { "type": "boolean", "description": "true needs a human approval" }
        },
        "required": ["command"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{json, Value};

    use crate::audit::ledger::AuditLedger;
    use crate::p03::clock::RuntimeClock;
    use crate::p04::adapter::ToolAdapter;
    use crate::p08::artifacts::service::ArtifactService;
    use crate::p08::artifacts::store::ArtifactStore;
    use crate::p08::artifacts::tools::{DeleteOutputTool, DocumentTool, MoveOutputTool, PresentationTool, RegisterTool, SpreadsheetTool};
    use crate::p08::execution::port::UnavailableSandbox;
    use crate::p08::execution::runtime::RuntimeCatalog;
    use crate::p08::execution::service::ExecutionService;
    use crate::p08::execution::tools::{CommandTool, PythonTool};
    use crate::p08::workspace::WorkspaceRoot;
    use crate::p08::workspace_tools::workspace_adapters;
    use crate::storage::Database;

    /// كل المحوّلات المدمجة التي تُعلن مخططًا، ببنية دنيا لا تنفّذ شيئًا: الاختبار يمسّ `validate` وحدها.
    fn adapters() -> Vec<Arc<dyn ToolAdapter>> {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let clock = RuntimeClock::system();
        let workspaces = WorkspaceRoot::new(std::env::temp_dir().join("polaris-schema-test"));
        let artifacts = Arc::new(ArtifactService::new(ArtifactStore::new(db.clone(), audit.clone(), clock.clone()), workspaces.clone(), None, clock.clone()));
        let execution = Arc::new(ExecutionService::new(Arc::new(UnavailableSandbox("test")), workspaces.clone(), RuntimeCatalog::default(), db, audit, clock));
        let mut all = workspace_adapters(&workspaces, None);
        all.push(Arc::new(CommandTool { service: execution.clone() }));
        all.push(Arc::new(PythonTool { service: execution }));
        all.push(Arc::new(DocumentTool { service: artifacts.clone() }));
        all.push(Arc::new(PresentationTool { service: artifacts.clone() }));
        all.push(Arc::new(SpreadsheetTool { service: artifacts.clone() }));
        all.push(Arc::new(RegisterTool { service: artifacts.clone() }));
        all.push(Arc::new(MoveOutputTool { service: artifacts.clone() }));
        all.push(Arc::new(DeleteOutputTool { service: artifacts }));
        all
    }

    fn schema_accepts(schema: &Value, arguments: &Value) -> bool {
        let mut compiler = boon::Compiler::new();
        compiler.set_default_draft(boon::Draft::V2020_12);
        compiler.add_resource("polaris:/test/schema.json", schema.clone()).unwrap();
        let mut schemas = boon::Schemas::new();
        let index = compiler.compile("polaris:/test/schema.json", &mut schemas).expect("the schema does not compile");
        schemas.validate(arguments, index).is_ok()
    }

    fn chart() -> Value {
        json!({ "title": "Sales", "kind": "bar", "categories": ["Q1", "Q2"], "series": [{ "name": "2026", "values": [1.5, 2.0] }] })
    }

    /// لكل أداة: وسائط صحيحة يقبلها المخطط والتحقق معًا، ووسائط خاطئة يرفضها الاثنان.
    fn samples(tool_id: &str) -> (Vec<Value>, Vec<Value>) {
        match tool_id {
            "polaris.workspace.list" => (vec![json!({}), json!({ "path": "outputs", "depth": 2 })], vec![json!({ "folder": "x" })]),
            "polaris.workspace.read" => (vec![json!({ "path": "notes.txt" }), json!({ "path": "a/b.md", "max_chars": 500 })], vec![json!({}), json!({ "path": "a", "extra": 1 })]),
            "polaris.workspace.write" => (
                vec![json!({ "path": "outputs/a.txt", "content": "مرحبا" }), json!({ "path": "outputs/a.txt", "content": "more", "append": true })],
                vec![json!({ "path": "a.txt" }), json!({ "path": "a.txt", "content": 3 }), json!({ "path": "a.txt", "content": "x", "append": "yes" })],
            ),
            "polaris.workspace.edit" => (
                vec![json!({ "path": "outputs/index.html", "old_text": "<h1>A</h1>", "new_text": "" }), json!({ "path": "work/a.md", "old_text": "x", "new_text": "y" })],
                vec![json!({ "path": "outputs/index.html", "old_text": "a" }), json!({ "path": "a.txt", "old_text": "a", "new_text": "b", "all": true }), json!({ "path": "a.txt", "old_text": 1, "new_text": "b" })],
            ),
            "polaris.workspace.export" => (vec![json!({ "path": "outputs/a.txt", "file_name": "a.txt" })], vec![json!({ "path": "outputs/a.txt" })]),
            "polaris.execution.command" => (vec![json!({ "command": "dir", "timeout_seconds": 30 })], vec![json!({}), json!({ "command": "dir", "shell": "cmd" })]),
            "polaris.execution.python" => (
                vec![json!({ "code": "print(1)" }), json!({ "script": "run.py", "arguments": ["--x"], "timeout_seconds": 60, "network": false })],
                vec![json!({ "code": "print(1)", "reason": "why" }), json!({ "script": "run.py", "arguments": "--x" })],
            ),
            "polaris.artifact.document" => (
                vec![
                    json!({ "format": "docx", "spec": { "title": "تقرير", "language": "ar", "blocks": [
                        { "type": "heading", "text": "مقدمة", "level": 1 },
                        { "type": "paragraph", "text": "نص." },
                        { "type": "bullets", "items": ["أ", "ب"] },
                        { "type": "table", "header": ["x", "y"], "rows": [["1", "2"]] },
                        { "type": "chart", "chart": chart() }
                    ] } }),
                    json!({ "format": "pdf", "path": "outputs/r.pdf", "spec": { "title": "R", "blocks": [{ "type": "paragraph", "text": "p" }] } }),
                ],
                vec![
                    // الأشكال الخاطئة التي يكتبها نموذج محلي عادةً: نصّ بلا كتل، ونوع كتلة مجهول، وحقل غلاف داخل الوسائط.
                    json!({ "format": "docx", "spec": { "title": "R", "content": "text" } }),
                    json!({ "format": "docx", "spec": { "title": "R", "blocks": [{ "type": "image", "src": "a.png" }] } }),
                    json!({ "format": "docx", "spec": { "title": "R", "blocks": [] }, "reason": "x" }),
                    json!({ "format": "rtf", "spec": { "title": "R", "blocks": [{ "type": "paragraph", "text": "p" }] } }),
                ],
            ),
            "polaris.artifact.presentation" => (
                vec![json!({ "spec": { "title": "D", "subtitle": "s", "language": "en", "slides": [{ "title": "One", "bullets": ["a"], "table": { "header": ["h"], "rows": [["v"]] }, "chart": chart(), "notes": "n" }] } })],
                vec![json!({ "spec": { "title": "D", "slides": [{ "heading": "One" }] } })],
            ),
            "polaris.artifact.spreadsheet" => (
                vec![json!({ "spec": { "title": "B", "sheets": [{ "name": "Data", "header": ["k", "v"], "rows": [["a", 1], ["b", "=SUM(B2:B2)"], [null, 2]], "chart": { "title": "c", "kind": "line", "value_columns": [1] } }] } })],
                vec![json!({ "spec": { "title": "B", "sheets": [{ "name": "Data", "rows": [[{ "v": 1 }]] }] } })],
            ),
            "polaris.artifact.register" => (vec![json!({ "path": "site", "title": "Site" })], vec![json!({ "path": "site" })]),
            "polaris.workspace.move" => (vec![json!({ "from": "outputs/a.docx", "to": "outputs/b.docx" })], vec![json!({ "from": "outputs/a.docx" }), json!({ "from": "outputs/a.docx", "to": "outputs/b.docx", "force": true })]),
            "polaris.workspace.delete" => (vec![json!({ "path": "outputs/a.docx" })], vec![json!({}), json!({ "path": 3 })]),
            other => panic!("no samples for {other}"),
        }
    }

    #[test]
    fn every_declared_schema_compiles_and_agrees_with_its_validator_on_the_samples() {
        let mut covered = 0;
        for adapter in adapters() {
            let Some(schema) = adapter.input_schema() else { continue };
            let id = adapter.tool_id().to_string();
            assert_eq!(schema["type"], "object", "{id}: the schema is not an object schema");
            assert_eq!(schema["additionalProperties"], false, "{id}: the schema admits undeclared fields");
            let (good, bad) = samples(&id);
            for arguments in &good {
                assert!(schema_accepts(&schema, arguments), "{id}: the schema refused a valid sample {arguments}");
                assert!(adapter.validate(arguments).is_ok(), "{id}: validate refused a sample the schema shows as valid {arguments}: {:?}", adapter.validate(arguments).err());
            }
            for arguments in &bad {
                assert!(adapter.validate(arguments).is_err(), "{id}: validate accepted an invalid sample {arguments}");
                assert!(!schema_accepts(&schema, arguments), "{id}: the schema shows an invalid sample as valid {arguments}");
            }
            covered += 1;
        }
        assert_eq!(covered, 13, "a built-in tool lost or gained a schema without samples");
    }

    /// خطة 2026-10-05، B6: المثال الأدنى الذي يعرضه إرشاد الرفض يقبله المخطط والتحقق الحقيقي معًا، وإلا كان المثال يضلّل.
    #[test]
    fn the_minimal_example_shown_in_a_refusal_is_accepted_by_the_real_validator() {
        for adapter in adapters() {
            let Some(schema) = adapter.input_schema() else { continue };
            let example = crate::p04::guidance::example_of(&schema, "", 0);
            assert!(schema_accepts(&schema, &example), "{}: the schema refused its own minimal example {example}", adapter.tool_id());
            assert!(adapter.validate(&example).is_ok(), "{}: validate refused the minimal example {example}: {:?}", adapter.tool_id(), adapter.validate(&example).err());
        }
    }

    #[test]
    fn schemas_carry_no_length_or_count_bounds_that_would_inflate_a_decoding_grammar() {
        for adapter in adapters() {
            let Some(schema) = adapter.input_schema() else { continue };
            let text = schema.to_string();
            for key in ["maxLength", "maxItems", "minLength", "minItems", "pattern"] {
                assert!(!text.contains(key), "{}: the schema carries {key}", adapter.tool_id());
            }
        }
    }
}
