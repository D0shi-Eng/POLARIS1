// عمليات المشاريع.

use serde_json::{json, Value};

use super::input::{integer, opt_bool, opt_string, string, tri_string};
use super::to_value;
use crate::ipc::errors::HostError;
use crate::p02::models::listing::list_views;
use crate::p02::projects::repository::ProjectChanges;
use crate::p02::projects::service::NewProject;
use crate::p02::Phase02;

pub fn list(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let include_archived = opt_bool(payload, "include_archived").unwrap_or(false);
    let query = opt_string(payload, "query");
    let projects = p02.projects.list(include_archived, query.as_deref())?;
    Ok(json!({ "projects": to_value(&projects)? }))
}

pub fn get(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let project = p02.projects.get(&project_id)?;
    let mut sources = Vec::new();
    for source in p02.sources.list(&project_id)? {
        // القراءة تعيد القياس: غياب ملف أو تغيّره يظهر هنا لا لاحقًا.
        sources.push(p02.sources.measure(&project, &source)?);
    }
    // النموذج الذي سيُستعمل فعلًا بسلسلة الافتراض المعلنة.
    let (effective, origin) = match (&project.default_model_id, p02.preferences.default_model()?) {
        (Some(id), _) => (Some(id.clone()), "PROJECT_DEFAULT"),
        (None, Some(id)) => (Some(id), "USER_DEFAULT"),
        (None, None) => (None, "NONE"),
    };
    // النموذج المسمّى يجب أن يكون معروفًا للسجل، وإلا لا يُعرض كفعّال.
    let known = match &effective {
        Some(id) => list_views(&p02.providers, &p02.secrets, &p02.models, &p02.preferences, None)?.iter().any(|v| &v.model_id == id),
        None => false,
    };
    let mut result = json!({
        "project": to_value(&project)?,
        "sources": to_value(&sources)?,
        "effective_model_origin": if known { origin } else { "NONE" },
    });
    if let (true, Some(id)) = (known, effective) {
        result["effective_model_id"] = json!(id);
    }
    Ok(result)
}

pub fn create(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project = p02.projects.create(NewProject {
        name: string(payload, "name")?,
        description: opt_string(payload, "description"),
        language: opt_string(payload, "language"),
        workspace_root: opt_string(payload, "workspace_root"),
    })?;
    p02.sources.sync_workspace_source(&project)?;
    let project = p02.projects.get(&project.project_id)?;
    Ok(json!({ "project": to_value(&project)? }))
}

pub fn update(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let expected = integer(payload, "expected_version")?;
    let default_model = tri_string(payload, "default_model_id");
    if let Some(Some(id)) = &default_model {
        if p02.models.get(id)?.is_none() {
            return Err(HostError::validation("unknown model").at("/payload/default_model_id"));
        }
    }
    let changes = ProjectChanges {
        name: opt_string(payload, "name"),
        description: opt_string(payload, "description"),
        language: opt_string(payload, "language"),
        workspace_root: tri_string(payload, "workspace_root"),
        default_model_id: default_model,
        status: None,
    };
    let workspace_changed = changes.workspace_root.is_some();
    let project = p02.projects.update(&project_id, expected, changes)?;
    if workspace_changed {
        p02.sources.sync_workspace_source(&project)?;
    }
    let project = p02.projects.get(&project_id)?;
    Ok(json!({ "project": to_value(&project)? }))
}

pub fn archive(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let project_id = string(payload, "project_id")?;
    let expected = integer(payload, "expected_version")?;
    let archived = opt_bool(payload, "archived").ok_or_else(|| HostError::validation("archived is absent").at("/payload/archived"))?;
    let project = p02.projects.set_archived(&project_id, expected, archived)?;
    Ok(json!({ "project": to_value(&project)? }))
}
