// موصل مساحة العمل: مصادر مشروع واحد عبر خدمة سياق Phase-02 نفسها (البند 5).
//
// النطاق هو الحدّ: الموصل مربوط بمشروع عند تسجيله، والعمليتان تقرآن مصادر ذلك
// المشروع وحده بمعرّفاتها. لا مسار حرّ: المعرّف يُبحث عنه في المشروع، والملف يُحلّ
// داخل جذر مساحة العمل بقواعد Phase-02 نفسها. ولا كتابة: القراءة وحدها.

use std::sync::Arc;

use serde_json::Value;

use crate::p02::context::model::{code, SourceType};
use crate::p02::context::SourceService;
use crate::p04::adapter::bounded;

use super::model::{ConnectorOperation, HttpMethod, IdempotencySupport, OperationAction, OperationParam, ParamKind, ParamLocation};

pub const OP_LIST: &str = "files.list";
pub const OP_READ: &str = "files.read";

/// أقصى ما يُقرأ من ملف نصّي عبر الموصل.
pub const MAX_FILE_CHARS: usize = 16_000;

/// العمليتان الثابتتان لموصل مساحة العمل. لا تُستورد ولا تُعدَّل.
pub fn operations() -> Vec<ConnectorOperation> {
    vec![
        ConnectorOperation {
            operation_id: OP_LIST.into(),
            title: "List the project's context sources".into(),
            action: OperationAction::Read,
            method: HttpMethod::Get,
            path: "/sources".into(),
            params: vec![],
            idempotency: IdempotencySupport::None,
            resource_id_pointer: None,
            result_fields: vec![],
            cost_pointer: None,
            cost_currency: None,
            list_pointer: None,
            item_fields: Vec::new(),
        },
        ConnectorOperation {
            operation_id: OP_READ.into(),
            title: "Read one context source of the project".into(),
            action: OperationAction::Read,
            method: HttpMethod::Get,
            path: "/sources/{source_id}".into(),
            params: vec![OperationParam {
                name: "source_id".into(),
                location: ParamLocation::Path,
                kind: ParamKind::String,
                required: true,
                max_length: Some(64),
                minimum: None,
                maximum: None,
                allowed: vec![],
            }],
            idempotency: IdempotencySupport::None,
            resource_id_pointer: None,
            result_fields: vec![],
            cost_pointer: None,
            cost_currency: None,
            list_pointer: None,
            item_fields: Vec::new(),
        },
    ]
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceFailure {
    ProjectMissing,
    OutOfScope(String),
    Unavailable(String),
}

/// ما قرأه الموصل: ملخّص للوكيل وبايتات للبصمة.
pub struct WorkspaceRead {
    pub summary: String,
    pub measured: Vec<u8>,
    pub resource: Option<String>,
}

pub fn execute(sources: &Arc<SourceService>, project_id: &str, operation_id: &str, arguments: &Value) -> Result<WorkspaceRead, WorkspaceFailure> {
    let project = sources.projects().find(project_id).map_err(|e| WorkspaceFailure::Unavailable(format!("{e:?}")))?.ok_or(WorkspaceFailure::ProjectMissing)?;
    match operation_id {
        OP_LIST => {
            let listed = sources.list(project_id).map_err(|e| WorkspaceFailure::Unavailable(format!("{e:?}")))?;
            let lines: Vec<String> = listed
                .iter()
                .take(50)
                .map(|s| format!("{} {} {} {}", s.source_id, code(s.source_type), bounded(&s.display_name, 80), code(s.availability)))
                .collect();
            let summary = format!("{} source(s): {}", listed.len(), bounded(&lines.join(" | "), 1_200));
            Ok(WorkspaceRead { measured: summary.as_bytes().to_vec(), summary, resource: None })
        }
        OP_READ => {
            let source_id = arguments.get("source_id").and_then(Value::as_str).unwrap_or("");
            let found = sources.get(project_id, source_id).map_err(|e| WorkspaceFailure::Unavailable(format!("{e:?}")))?;
            let Some((source, active)) = found else {
                return Err(WorkspaceFailure::OutOfScope("no such source is attached to this connector's project".into()));
            };
            if !active {
                return Err(WorkspaceFailure::OutOfScope("the source was removed from the project".into()));
            }
            let text = match (&source.text_body, source.source_type) {
                (Some(text), SourceType::TextNote | SourceType::UserInstruction | SourceType::SystemContext) => text.clone(),
                (_, SourceType::File) => {
                    let root = project.workspace_root.clone().ok_or_else(|| WorkspaceFailure::OutOfScope("the project has no workspace".into()))?;
                    let path = crate::p02::context::paths::resolve(&root, &source.reference).map_err(|_| WorkspaceFailure::OutOfScope("the file is outside the workspace".into()))?;
                    let snapshot = crate::p02::context::reader::snapshot(&path).map_err(|_| WorkspaceFailure::Unavailable("the file could not be read".into()))?;
                    match snapshot.bytes {
                        Some(bytes) if !bytes.contains(&0) => match String::from_utf8(bytes) {
                            Ok(text) => text,
                            Err(_) => format!("binary file of {} bytes", snapshot.size),
                        },
                        Some(_) => format!("binary file of {} bytes", snapshot.size),
                        None => format!("file of {} bytes is above the read limit", snapshot.size),
                    }
                }
                _ => format!("{} source, availability {}", code(source.source_type), code(source.availability)),
            };
            let (cut, truncated) = crate::p02::context::reader::truncate_utf8(&text, MAX_FILE_CHARS);
            let summary = format!("{}{}", cut, if truncated { " …[truncated]" } else { "" });
            Ok(WorkspaceRead { measured: text.as_bytes().to_vec(), summary, resource: Some(format!("source:{}", source.source_id)) })
        }
        other => Err(WorkspaceFailure::OutOfScope(format!("{other} is not a workspace operation"))),
    }
}
