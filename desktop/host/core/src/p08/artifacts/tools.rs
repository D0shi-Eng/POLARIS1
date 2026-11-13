// أدوات المخرجات للوكيل: مستند، عرض، مصنّف، وتسجيل ملف موجود.
//
// الوكيل يقترح نموذج المحتوى (JSON) فقط؛ الكتابة والتحقق والتسجيل هنا. أثرها كتابة في
// مساحة المهمّة وحدها (WORKSPACE_WRITE)، فلا تحتاج موافقة: لا شيء خارج المساحة يتغيّر.
// تصدير مخرَج إلى مجلد للمستخدم عملية أخرى تمرّ بالموافقة (polaris.workspace.export).

use std::sync::Arc;

use serde_json::{json, Value};

use crate::p04::adapter::{reject_unknown_fields, EvidenceNoteStance, ToolAdapter, ToolCallContext, ToolEvidenceNote, ToolFailure, ToolOutcome};
use crate::p04::effect::ToolEffect;
use crate::p04::tool::ToolDescriptor;

use super::super::execution::tools::descriptor;
use super::service::{ArtifactService, OutputChange, OutputChangeError, Produced};
use super::spec::{DeckSpec, DocumentSpec, WorkbookSpec};

pub const TOOL_DOCUMENT: &str = "polaris.artifact.document";
pub const TOOL_PRESENTATION: &str = "polaris.artifact.presentation";
pub const TOOL_SPREADSHEET: &str = "polaris.artifact.spreadsheet";
pub const TOOL_REGISTER: &str = "polaris.artifact.register";
pub const TOOL_MOVE_OUTPUT: &str = "polaris.workspace.move";
pub const TOOL_DELETE_OUTPUT: &str = "polaris.workspace.delete";

fn outcome(p: Produced) -> ToolOutcome {
    let d = &p.descriptor;
    let failed: Vec<String> = p.verification.checks.iter().filter(|c| !c.passed).map(|c| format!("{}: {}", c.name, c.detail)).collect();
    let facts: Vec<String> = p.verification.facts.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let observation = format!(
        "artifact_id: {}\ntype: {}\npath: {}\nverification: {}\nfacts: {}\n{}",
        d.artifact_id,
        d.artifact_type,
        d.file_ref,
        p.verification.status,
        facts.join(", "),
        if failed.is_empty() { String::new() } else { format!("failed checks: {}\n", failed.join("; ")) }
    );
    ToolOutcome {
        summary: format!("{} {} written to {} and {}", d.artifact_type, d.title, d.file_ref, p.verification.status.to_lowercase()),
        measured_bytes: json!({ "artifact_id": d.artifact_id, "sha256": d.sha256, "verification": p.verification.status }).to_string().into_bytes(),
        supports: p.verification.verified(),
        detail: format!("artifact_id={} sha256={}", d.artifact_id, d.sha256),
        evidence: Some(ToolEvidenceNote { kind: "ARTIFACT_VERIFICATION", stance: EvidenceNoteStance::Observed(format!("{} {} {}", d.file_ref, d.artifact_type, p.verification.status)) }),
        observation: Some(observation),
    }
}

fn spec_of<T: serde::de::DeserializeOwned>(arguments: &Value) -> Result<T, ToolFailure> {
    let raw = arguments.get("spec").ok_or_else(|| ToolFailure::ArgumentsInvalid("spec is required".into()))?;
    serde_json::from_value(raw.clone()).map_err(|e| ToolFailure::ArgumentsInvalid(format!("spec does not match its contract: {e}")))
}

fn optional_path(arguments: &Value) -> Result<Option<String>, ToolFailure> {
    match arguments.get("path") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(p)) => {
            crate::p08::workspace::normalise_relative(p).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
            Ok(Some(p.clone()))
        }
        Some(_) => Err(ToolFailure::ArgumentsInvalid("path must be a string".into())),
    }
}

fn effects() -> Vec<ToolEffect> {
    vec![ToolEffect::WorkspaceWrite, ToolEffect::WorkspaceRead]
}

pub struct DocumentTool {
    pub service: Arc<ArtifactService>,
}

impl ToolAdapter for DocumentTool {
    fn tool_id(&self) -> &str {
        TOOL_DOCUMENT
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_DOCUMENT,
            "Create a document",
            r#"Creates a verified document in the workspace. Arguments: format ("docx"|"pdf"|"html"|"markdown"), optional path (relative, default outputs/<title>.<ext>), spec: {"title": str, "language": "ar"|"en", "blocks": [{"type":"heading","text":str,"level":1-3} | {"type":"paragraph","text":str} | {"type":"bullets","items":[str]} | {"type":"table","header":[str],"rows":[[str]]} | {"type":"chart","chart":{"title":str,"kind":"bar"|"line","categories":[str],"series":[{"name":str,"values":[number]}]}}]}. The file is re-opened and verified before it is registered. When the user names the file, pass that name as path (e.g. outputs/status.docx); to rename it later use move_file."#,
            effects(),
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::document())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["format", "path", "spec"])?;
        let format = arguments.get("format").and_then(Value::as_str).unwrap_or("docx");
        if !matches!(format, "docx" | "pdf" | "html" | "markdown" | "md") {
            return Err(ToolFailure::ArgumentsInvalid("format must be docx, pdf, html or markdown".into()));
        }
        optional_path(arguments)?;
        let spec: DocumentSpec = spec_of(arguments)?;
        spec.validate().map_err(|e| ToolFailure::ArgumentsInvalid(e.0))
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let spec: DocumentSpec = spec_of(arguments)?;
        let format = arguments.get("format").and_then(Value::as_str).unwrap_or("docx");
        let path = optional_path(arguments)?;
        self.service
            .document(context.mission_id, format, path.as_deref(), &spec, Some(context.task_id), Some(context.agent_id))
            .map(outcome)
            .map_err(ToolFailure::Unavailable)
    }
}

pub struct PresentationTool {
    pub service: Arc<ArtifactService>,
}

impl ToolAdapter for PresentationTool {
    fn tool_id(&self) -> &str {
        TOOL_PRESENTATION
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_PRESENTATION,
            "Create a presentation",
            r#"Creates a verified PowerPoint deck (.pptx). Arguments: optional path, spec: {"title": str, "subtitle": str, "language": "ar"|"en", "slides": [{"title": str, "bullets": [str], "table": {"header":[str],"rows":[[str]]}, "chart": {"title":str,"kind":"bar"|"line","categories":[str],"series":[{"name":str,"values":[number]}]}, "notes": str}]}. A cover slide is added first. When the user names the file, pass that name as path (e.g. outputs/status.docx); to rename it later use move_file."#,
            effects(),
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::presentation())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["path", "spec"])?;
        optional_path(arguments)?;
        let deck: DeckSpec = spec_of(arguments)?;
        deck.validate().map_err(|e| ToolFailure::ArgumentsInvalid(e.0))
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let deck: DeckSpec = spec_of(arguments)?;
        let path = optional_path(arguments)?;
        self.service.presentation(context.mission_id, path.as_deref(), &deck, Some(context.task_id), Some(context.agent_id)).map(outcome).map_err(ToolFailure::Unavailable)
    }
}

pub struct SpreadsheetTool {
    pub service: Arc<ArtifactService>,
}

impl ToolAdapter for SpreadsheetTool {
    fn tool_id(&self) -> &str {
        TOOL_SPREADSHEET
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_SPREADSHEET,
            "Create a spreadsheet",
            r#"Creates a verified Excel workbook (.xlsx). Arguments: optional path, spec: {"title": str, "sheets": [{"name": str, "header": [str], "rows": [[number|string|null]], "chart": {"title": str, "kind": "bar"|"line", "value_columns": [int]}}]}. A string starting with = is a formula (e.g. "=SUM(B2:B9)"); external links are refused. value_columns index the header, the first column holds categories. When the user names the file, pass that name as path (e.g. outputs/status.docx); to rename it later use move_file."#,
            effects(),
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::spreadsheet())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["path", "spec"])?;
        optional_path(arguments)?;
        let book: WorkbookSpec = spec_of::<WorkbookSpec>(arguments)?.normalized();
        book.validate().map_err(|e| ToolFailure::ArgumentsInvalid(e.0))
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let book: WorkbookSpec = spec_of::<WorkbookSpec>(arguments)?.normalized();
        let path = optional_path(arguments)?;
        self.service.spreadsheet(context.mission_id, path.as_deref(), &book, Some(context.task_id), Some(context.agent_id)).map(outcome).map_err(ToolFailure::Unavailable)
    }
}

pub struct RegisterTool {
    pub service: Arc<ArtifactService>,
}

impl ToolAdapter for RegisterTool {
    fn tool_id(&self) -> &str {
        TOOL_REGISTER
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_REGISTER,
            "Register a workspace file as an artifact",
            "Verifies and registers a file or folder that already exists in the workspace (for example a chart image or report written by Python, a static web site folder with index.html, or a code project folder). Arguments: path (relative), title.",
            effects(),
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::register())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["path", "title"])?;
        let path = arguments.get("path").and_then(Value::as_str).ok_or_else(|| ToolFailure::ArgumentsInvalid("path is required".into()))?;
        crate::p08::workspace::normalise_relative(path).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
        match arguments.get("title").and_then(Value::as_str) {
            Some(t) if !t.trim().is_empty() && t.chars().count() <= 300 => Ok(()),
            _ => Err(ToolFailure::ArgumentsInvalid("title must be 1..300 characters".into())),
        }
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let path = arguments.get("path").and_then(Value::as_str).unwrap_or("");
        let title = arguments.get("title").and_then(Value::as_str).unwrap_or("");
        self.service.register_existing(context.mission_id, path, title, Some(context.task_id), Some(context.agent_id)).map(outcome).map_err(ToolFailure::OutOfScope)
    }
}

/// D-MP-12: تصنيف رفض النقل أو الحذف كما تصنّفه أدوات المساحة الأخرى.
fn change_failure(e: OutputChangeError) -> ToolFailure {
    match e {
        OutputChangeError::OutOfScope(m) => ToolFailure::OutOfScope(m),
        OutputChangeError::Invalid(m) => ToolFailure::ArgumentsInvalid(m),
        OutputChangeError::Io(m) => ToolFailure::Unavailable(m),
    }
}

fn change_outcome(change: OutputChange) -> ToolOutcome {
    let (summary, observation) = match &change.to {
        Some(to) => (format!("moved {} to {to}", change.from), format!("moved {} to {to}; {} library card(s) now point to {to}. Only {to} exists now.", change.from, change.cards)),
        None => (format!("deleted {}", change.from), format!("deleted {}; {} library card(s) removed.", change.from, change.cards)),
    };
    ToolOutcome {
        summary,
        measured_bytes: json!({ "from": change.from, "to": change.to, "cards": change.cards }).to_string().into_bytes(),
        supports: true,
        detail: String::new(),
        evidence: None,
        observation: Some(observation),
    }
}

/// مسار نصّي مطلوب يجتاز فحص المسار النسبي. حصر المنطقة في `outputs/` يقع في الخدمة، فيُرفض المسار هناك خارج النطاق لا هنا.
fn required_path(arguments: &Value, field: &str) -> Result<String, ToolFailure> {
    let path = arguments.get(field).and_then(Value::as_str).ok_or_else(|| ToolFailure::ArgumentsInvalid(format!("{field} is required")))?;
    crate::p08::workspace::normalise_relative(path).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
    Ok(path.to_string())
}

/// نقل ملف أو مجلد داخل `outputs/` أو إعادة تسميته، في المضيف.
pub struct MoveOutputTool {
    pub service: Arc<ArtifactService>,
}

impl ToolAdapter for MoveOutputTool {
    fn tool_id(&self) -> &str {
        TOOL_MOVE_OUTPUT
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_MOVE_OUTPUT,
            "Rename or move an output file",
            "Renames or moves a file or folder under outputs/ to a new path under outputs/ (no second copy); its library card follows. Arguments: from, to. Never overwrites.",
            effects(),
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::workspace_move())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["from", "to"])?;
        required_path(arguments, "from")?;
        required_path(arguments, "to")?;
        Ok(())
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let from = required_path(arguments, "from")?;
        let to = required_path(arguments, "to")?;
        self.service.move_output(context.mission_id, &from, &to).map(change_outcome).map_err(change_failure)
    }
}

/// حذف ملف أو مجلد أنشأه الوكيل تحت `outputs/`، في المضيف.
pub struct DeleteOutputTool {
    pub service: Arc<ArtifactService>,
}

impl ToolAdapter for DeleteOutputTool {
    fn tool_id(&self) -> &str {
        TOOL_DELETE_OUTPUT
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_DELETE_OUTPUT,
            "Delete an output file",
            "Deletes a file or folder under outputs/ and its library card, when the user asks. Arguments: path.",
            effects(),
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::workspace_delete())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["path"])?;
        required_path(arguments, "path")?;
        Ok(())
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let path = required_path(arguments, "path")?;
        self.service.delete_output(context.mission_id, &path).map(change_outcome).map_err(change_failure)
    }
}
