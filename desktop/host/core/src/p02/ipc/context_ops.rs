// عمليات السياق.

use serde_json::{json, Value};

use super::input::{code, opt_string, opt_u64, string, strings};
use super::to_value;
use crate::ipc::errors::HostError;
use crate::p02::context::assembler::BundleRequest;
use crate::p02::context::preview::preview as build_preview;
use crate::p02::context::sources::AddSource;
use crate::p02::context::SourceType;
use crate::p02::Phase02;

pub fn add(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let source_type = code::<SourceType>(payload, "source_type")?.ok_or_else(|| HostError::validation("source_type is absent").at("/payload/source_type"))?;
    let source = p02.sources.add(
        &project_id,
        AddSource {
            source_type,
            reference: opt_string(payload, "reference"),
            text: opt_string(payload, "text"),
            display_name: opt_string(payload, "display_name"),
        },
    )?;
    Ok(json!({ "source": to_value(&source)? }))
}

pub fn remove(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let source_id = string(payload, "source_id")?;
    let source = p02.sources.remove(&project_id, &source_id)?;
    Ok(json!({ "source": to_value(&source)? }))
}

pub fn preview(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let source_id = string(payload, "source_id")?;
    to_value(&build_preview(&p02.sources, &project_id, &source_id)?)
}

pub fn assemble(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let source_ids = strings(payload, "source_ids");
    let instruction = string(payload, "instruction")?;
    let project = p02.projects.get(&project_id)?;
    // نافذة النموذج إن سُمّي نموذج معروف؛ وإلا فالميزانية المحافظة.
    let window = match opt_string(payload, "model_id") {
        Some(id) => match p02.models.get(&id)? {
            Some(record) => record.facts.context_window.value,
            None => return Err(HostError::validation("unknown model").at("/payload/model_id")),
        },
        None => None,
    };
    let bundle = p02.assembler.assemble(&BundleRequest {
        project: &project,
        source_ids: &source_ids,
        instruction: &instruction,
        context_window: window,
        reserved_output_tokens: 1024,
        max_tokens: opt_u64(payload, "max_tokens"),
        max_files: opt_u64(payload, "max_files").map(|v| v as usize),
    })?;
    Ok(json!({ "bundle": to_value(&bundle.view)? }))
}
