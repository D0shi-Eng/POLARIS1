// D-MP-12 (مكافأة Manus 2026-10-20): نقل ملف أنشأه الوكيل أو تسميته أو حذفه داخل `outputs/` وحدها، عبر البوابة.
//
// قِيس في النسخة التنفيذية المعزولة مع Bonsai 2: طلب «سمِّ الملف status.docx» ترك نسختين، لأن الصندوق (AppContainer) لا يحذف
// ولا ينقل ملفًا كتبه المضيف («Access is denied»). الأداتان هنا تعملان في المضيف خلف البوابة، ولا تلمسان غير `outputs/`.

use std::sync::Arc;

use polaris_host_providers::net::CancelToken;
use serde_json::json;

use crate::audit::AuditLedger;
use crate::p03::clock::RuntimeClock;
use crate::p04::adapter::{ToolAdapter, ToolCallContext, ToolFailure};
use crate::p08::workspace::WorkspaceRoot;
use crate::storage::Database;

use super::service::ArtifactService;
use super::store::ArtifactStore;
use super::tools::{DeleteOutputTool, MoveOutputTool, RegisterTool, TOOL_DELETE_OUTPUT, TOOL_MOVE_OUTPUT};

const MISSION: &str = "00000000-0000-4000-8000-0000000000a1";

struct Fixture {
    dir: std::path::PathBuf,
    service: Arc<ArtifactService>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn fixture() -> Fixture {
    let dir = crate::test_scratch::root().join(format!("mp-outputs-{}", crate::ids::new_uuid_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = Arc::new(Database::in_memory().unwrap());
    let clock = RuntimeClock::system();
    let store = ArtifactStore::new(db.clone(), Arc::new(AuditLedger::new(db)), clock.clone());
    let service = Arc::new(ArtifactService::new(store, WorkspaceRoot::new(dir.clone()), None, clock));
    Fixture { dir, service }
}

impl Fixture {
    fn root(&self) -> std::path::PathBuf {
        self.service.workspaces().for_mission(MISSION).unwrap().root().to_path_buf()
    }

    fn put(&self, rel: &str, bytes: &[u8]) {
        let path = self.root().join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn register(&self, rel: &str, title: &str) {
        let tool = RegisterTool { service: self.service.clone() };
        call(&tool, json!({ "path": rel, "title": title })).expect("register");
    }

    fn cards(&self) -> Vec<(String, String)> {
        self.service.store.list(Some(MISSION), 50).unwrap().into_iter().map(|a| (a.file_ref, a.title)).collect()
    }

    fn exists(&self, rel: &str) -> bool {
        self.root().join(rel).exists()
    }
}

fn call(tool: &dyn ToolAdapter, arguments: serde_json::Value) -> Result<crate::p04::adapter::ToolOutcome, ToolFailure> {
    tool.validate(&arguments)?;
    let cancel = CancelToken::new();
    let context = ToolCallContext { mission_id: MISSION, task_id: "task-1", agent_id: "agent-1", project_id: None, timeout_ms: 10_000, cancel: &cancel };
    tool.execute(&arguments, &context)
}

fn mover(f: &Fixture) -> MoveOutputTool {
    MoveOutputTool { service: f.service.clone() }
}

fn deleter(f: &Fixture) -> DeleteOutputTool {
    DeleteOutputTool { service: f.service.clone() }
}

#[test]
fn mp_outputs_the_tools_are_named_for_the_gateway() {
    let f = fixture();
    assert_eq!(mover(&f).tool_id(), TOOL_MOVE_OUTPUT);
    assert_eq!(deleter(&f).tool_id(), TOOL_DELETE_OUTPUT);
    assert_eq!(TOOL_MOVE_OUTPUT, "polaris.workspace.move");
    assert_eq!(TOOL_DELETE_OUTPUT, "polaris.workspace.delete");
}

#[test]
fn mp_outputs_a_rename_leaves_one_file_and_one_card_under_the_new_name() {
    let f = fixture();
    f.put("outputs/Quarterly-status.md", b"# status\n");
    f.register("outputs/Quarterly-status.md", "Quarterly-status.md");
    let out = call(&mover(&f), json!({ "from": "outputs/Quarterly-status.md", "to": "outputs/status.md" })).expect("rename");
    assert!(out.observation.unwrap_or_default().contains("outputs/status.md"));
    assert!(!f.exists("outputs/Quarterly-status.md"), "the old copy stayed: two files after a rename (D-MP-12)");
    assert_eq!(std::fs::read(f.root().join("outputs/status.md")).unwrap(), b"# status\n");
    assert_eq!(f.cards(), vec![("outputs/status.md".to_string(), "status.md".to_string())], "the Library card must follow the file");
}

#[test]
fn mp_outputs_a_case_only_rename_works_on_windows() {
    let f = fixture();
    f.put("outputs/Budget.md", b"x");
    call(&mover(&f), json!({ "from": "outputs/Budget.md", "to": "outputs/budget.md" })).expect("a case-only rename is the same file, not a conflict");
    let names: Vec<String> = std::fs::read_dir(f.root().join("outputs")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(names, vec!["budget.md".to_string()]);
}

#[test]
fn mp_outputs_a_folder_moves_with_its_files_and_cards() {
    let f = fixture();
    f.put("outputs/site/index.html", b"<!doctype html><title>t</title>");
    f.put("outputs/site/app.css", b"body{}");
    f.register("outputs/site", "Site");
    call(&mover(&f), json!({ "from": "outputs/site", "to": "outputs/web/site" })).expect("move folder");
    assert!(f.exists("outputs/web/site/index.html") && f.exists("outputs/web/site/app.css"));
    assert!(!f.exists("outputs/site"));
    assert_eq!(f.cards(), vec![("outputs/web/site".to_string(), "Site".to_string())], "a title the user gave is kept");
}

#[test]
fn mp_outputs_an_existing_destination_is_never_overwritten() {
    let f = fixture();
    f.put("outputs/a.md", b"a");
    f.put("outputs/b.md", b"b");
    let err = call(&mover(&f), json!({ "from": "outputs/a.md", "to": "outputs/b.md" })).unwrap_err();
    assert!(matches!(err, ToolFailure::ArgumentsInvalid(_)), "{err:?}");
    assert_eq!(std::fs::read(f.root().join("outputs/b.md")).unwrap(), b"b");
    assert!(f.exists("outputs/a.md"));
}

#[test]
fn mp_outputs_a_delete_removes_the_file_and_its_card() {
    let f = fixture();
    f.put("outputs/old.md", b"old");
    f.put("outputs/keep.md", b"keep");
    f.register("outputs/old.md", "old.md");
    f.register("outputs/keep.md", "keep.md");
    call(&deleter(&f), json!({ "path": "outputs/old.md" })).expect("delete");
    assert!(!f.exists("outputs/old.md"));
    assert!(f.exists("outputs/keep.md"));
    assert_eq!(f.cards(), vec![("outputs/keep.md".to_string(), "keep.md".to_string())]);
}

#[test]
fn mp_outputs_inputs_and_every_other_area_are_out_of_reach() {
    let f = fixture();
    f.put("inputs/brief.docx", b"user file");
    f.put("work/draft.md", b"draft");
    f.put("outputs/a.md", b"a");
    let refused: Vec<(Box<dyn ToolAdapter>, serde_json::Value)> = vec![
        (Box::new(mover(&f)), json!({ "from": "inputs/brief.docx", "to": "outputs/brief.docx" })),
        (Box::new(mover(&f)), json!({ "from": "Inputs/brief.docx", "to": "outputs/brief.docx" })),
        (Box::new(mover(&f)), json!({ "from": "outputs/a.md", "to": "inputs/a.md" })),
        (Box::new(mover(&f)), json!({ "from": "work/draft.md", "to": "outputs/draft.md" })),
        (Box::new(mover(&f)), json!({ "from": "outputs/../inputs/brief.docx", "to": "outputs/x.docx" })),
        (Box::new(mover(&f)), json!({ "from": "outputs", "to": "outputs/x" })),
        (Box::new(mover(&f)), json!({ "from": "outputs/a.md", "to": ".polaris/a.md" })),
        (Box::new(deleter(&f)), json!({ "path": "inputs/brief.docx" })),
        (Box::new(deleter(&f)), json!({ "path": "inputs/.polaris-credentials.txt" })),
        (Box::new(deleter(&f)), json!({ "path": "work/draft.md" })),
        (Box::new(deleter(&f)), json!({ "path": "outputs" })),
        (Box::new(deleter(&f)), json!({ "path": "outputs/" })),
    ];
    for (tool, arguments) in refused {
        let result = call(tool.as_ref(), arguments.clone());
        assert!(result.is_err(), "{} accepted {arguments}", tool.tool_id());
    }
    assert_eq!(std::fs::read(f.root().join("inputs/brief.docx")).unwrap(), b"user file", "inputs/ was touched");
    assert_eq!(std::fs::read(f.root().join("work/draft.md")).unwrap(), b"draft");
    assert!(f.exists("outputs/a.md"));
}

#[test]
fn mp_outputs_a_missing_source_is_a_clear_argument_error() {
    let f = fixture();
    let err = call(&deleter(&f), json!({ "path": "outputs/none.md" })).unwrap_err();
    assert!(matches!(err, ToolFailure::ArgumentsInvalid(ref m) if m.contains("outputs/none.md")), "{err:?}");
    let err = call(&mover(&f), json!({ "from": "outputs/none.md", "to": "outputs/x.md" })).unwrap_err();
    assert!(matches!(err, ToolFailure::ArgumentsInvalid(_)), "{err:?}");
}

#[test]
fn mp_outputs_a_folder_cannot_move_into_itself() {
    let f = fixture();
    f.put("outputs/site/index.html", b"x");
    assert!(call(&mover(&f), json!({ "from": "outputs/site", "to": "outputs/site/inner" })).is_err());
    assert!(f.exists("outputs/site/index.html"));
}

#[test]
fn mp_outputs_the_creating_tools_no_longer_say_files_cannot_be_renamed() {
    let f = fixture();
    for tool in [
        Box::new(super::tools::DocumentTool { service: f.service.clone() }) as Box<dyn ToolAdapter>,
        Box::new(super::tools::PresentationTool { service: f.service.clone() }),
        Box::new(super::tools::SpreadsheetTool { service: f.service.clone() }),
    ] {
        let description = tool.descriptor().description;
        assert!(!description.contains("cannot be renamed or deleted"), "{}: {description}", tool.tool_id());
        assert!(description.contains("move_file"), "{}: the description should point to move_file: {description}", tool.tool_id());
    }
}
