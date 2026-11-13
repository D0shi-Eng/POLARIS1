// خدمة المشاريع: إنشاء، وقراءة، وتحديث، وأرشفة. لا حذف نهائي في Phase-02.

use std::sync::Arc;

use serde_json::json;

use super::model::{clean_description, clean_name, Project, ProjectStatus, LANGUAGES};
use super::repository::{ProjectChanges, ProjectRepository};
use super::workspace::validate_root;
use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::ids::new_uuid_v4;
use crate::p02::errors::P02Error;
use crate::storage::{Database, StorageError};
use crate::time::now_rfc3339_utc;

pub struct NewProject {
    pub name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub workspace_root: Option<String>,
}

pub struct ProjectService {
    repo: ProjectRepository,
    audit: Arc<AuditLedger>,
}

fn not_found(error: StorageError) -> P02Error {
    match error {
        StorageError::NotFound => P02Error::invalid("/project_id", "unknown project"),
        other => P02Error::from(other),
    }
}

impl ProjectService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>) -> Self {
        Self { repo: ProjectRepository::new(db), audit }
    }

    pub fn create(&self, request: NewProject) -> Result<Project, P02Error> {
        let name = clean_name(&request.name).ok_or_else(|| P02Error::invalid("/name", "invalid project name"))?;
        let description = match request.description {
            Some(d) => clean_description(&d).ok_or_else(|| P02Error::invalid("/description", "invalid description"))?,
            None => String::new(),
        };
        let language = request.language.unwrap_or_else(|| "en".into());
        if !LANGUAGES.contains(&language.as_str()) {
            return Err(P02Error::invalid("/language", "unsupported language"));
        }
        let workspace_root = request.workspace_root.as_deref().map(validate_root).transpose()?;
        let now = now_rfc3339_utc();
        let project = Project {
            project_id: new_uuid_v4(),
            name,
            description,
            status: ProjectStatus::Active,
            language,
            workspace_root,
            default_model_id: None,
            version: 1,
            created_at: now.clone(),
            updated_at: now,
            context_source_count: 0,
        };
        self.repo.insert(&project)?;
        self.audit.append(&AuditRecord::new(
            AuditEventType::ProjectCreated,
            "project",
            &project.project_id,
            AuditOutcome::Success,
            json!({ "name_chars": project.name.chars().count(), "workspace_set": project.workspace_root.is_some(), "language": project.language }),
        ))?;
        self.get(&project.project_id)
    }

    pub fn get(&self, project_id: &str) -> Result<Project, P02Error> {
        self.repo.get(project_id)?.ok_or_else(|| P02Error::invalid("/project_id", "unknown project"))
    }

    pub fn find(&self, project_id: &str) -> Result<Option<Project>, P02Error> {
        Ok(self.repo.get(project_id)?)
    }

    pub fn list(&self, include_archived: bool, query: Option<&str>) -> Result<Vec<Project>, P02Error> {
        Ok(self.repo.list(include_archived, query.map(str::trim).filter(|q| !q.is_empty()))?)
    }

    pub fn update(&self, project_id: &str, expected_version: i64, mut changes: ProjectChanges) -> Result<Project, P02Error> {
        if let Some(name) = &changes.name {
            changes.name = Some(clean_name(name).ok_or_else(|| P02Error::invalid("/name", "invalid project name"))?);
        }
        if let Some(description) = &changes.description {
            changes.description = Some(clean_description(description).ok_or_else(|| P02Error::invalid("/description", "invalid description"))?);
        }
        if let Some(language) = &changes.language {
            if !LANGUAGES.contains(&language.as_str()) {
                return Err(P02Error::invalid("/language", "unsupported language"));
            }
        }
        if let Some(Some(root)) = &changes.workspace_root {
            changes.workspace_root = Some(Some(validate_root(root)?));
        }
        let current = self.get(project_id)?;
        if current.status == ProjectStatus::Archived && changes.status.is_none() {
            return Err(P02Error::Conflict("an archived project is read-only until it is restored".into()));
        }
        let updated = self.repo.update(project_id, expected_version, &changes, &now_rfc3339_utc()).map_err(not_found)?;
        let event = match (current.status, updated.status) {
            (ProjectStatus::Active, ProjectStatus::Archived) => AuditEventType::ProjectArchived,
            (ProjectStatus::Archived, ProjectStatus::Active) => AuditEventType::ProjectRestored,
            _ => AuditEventType::ProjectUpdated,
        };
        self.audit.append(&AuditRecord::new(
            event,
            "project",
            project_id,
            AuditOutcome::Success,
            json!({
                "version": updated.version,
                "name_changed": changes.name.is_some(),
                "workspace_changed": changes.workspace_root.is_some(),
                "default_model_changed": changes.default_model_id.is_some(),
            }),
        ))?;
        Ok(updated)
    }

    pub fn set_archived(&self, project_id: &str, expected_version: i64, archived: bool) -> Result<Project, P02Error> {
        let status = if archived { ProjectStatus::Archived } else { ProjectStatus::Active };
        self.update(project_id, expected_version, ProjectChanges { status: Some(status), ..Default::default() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> (ProjectService, Arc<AuditLedger>) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        (ProjectService::new(db, audit.clone()), audit)
    }

    fn new(name: &str) -> NewProject {
        NewProject { name: name.into(), description: None, language: Some("ar".into()), workspace_root: None }
    }

    #[test]
    fn creation_is_audited_without_the_name_itself() {
        let (s, audit) = service();
        let p = s.create(new("سرّي جدًا")).unwrap();
        assert_eq!(p.version, 1);
        assert_eq!(audit.count("PROJECT_CREATED").unwrap(), 1);
        assert!(!audit.all_detail_text().unwrap().contains("سرّي"));
    }

    #[test]
    fn archived_projects_are_read_only_until_restored() {
        let (s, audit) = service();
        let p = s.create(new("A")).unwrap();
        let archived = s.set_archived(&p.project_id, 1, true).unwrap();
        let blocked = s.update(&p.project_id, archived.version, ProjectChanges { name: Some("B".into()), ..Default::default() });
        assert!(matches!(blocked, Err(P02Error::Conflict(_))));
        let restored = s.set_archived(&p.project_id, archived.version, false).unwrap();
        assert_eq!(restored.status, ProjectStatus::Active);
        assert_eq!(audit.count("PROJECT_ARCHIVED").unwrap(), 1);
        assert_eq!(audit.count("PROJECT_RESTORED").unwrap(), 1);
    }

    #[test]
    fn invalid_input_is_refused_before_storage() {
        let (s, _) = service();
        assert!(s.create(new("  ")).is_err());
        assert!(s.create(NewProject { language: Some("xx".into()), ..new("A") }).is_err());
        assert!(s.create(NewProject { workspace_root: Some("relative".into()), ..new("A") }).is_err());
        assert!(s.list(true, None).unwrap().is_empty());
        assert!(matches!(s.update("missing", 1, ProjectChanges::default()), Err(P02Error::Invalid { .. })));
    }

    #[test]
    fn a_workspace_root_is_stored_canonically() {
        let (s, _) = service();
        let dir = crate::test_scratch::root().join(format!("proj-{}", new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = s.create(NewProject { workspace_root: Some(dir.to_string_lossy().to_string()), ..new("A") }).unwrap();
        assert!(p.workspace_root.is_some());
        let cleared = s.update(&p.project_id, 1, ProjectChanges { workspace_root: Some(None), ..Default::default() }).unwrap();
        assert!(cleared.workspace_root.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
