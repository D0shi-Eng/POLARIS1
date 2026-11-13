// تخزين المشاريع.
//
// كل تعديل يشترط الإصدار المتوقع داخل جملة التحديث نفسها، فلا يكتب تحديثان
// متزامنان أحدهما فوق الآخر: الخاسر يرى تعارضًا لا نجاحًا.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use super::model::{parse_status, status_code, Project, ProjectStatus};
use crate::storage::{Database, StorageError};

pub struct ProjectRepository {
    db: Arc<Database>,
}

const COLUMNS: &str = "p.project_id, p.name, p.description, p.status, p.language, p.workspace_root, p.default_model_id, p.version, p.created_at, p.updated_at,
    (SELECT count(*) FROM context_sources s WHERE s.project_id = p.project_id AND s.status = 'ACTIVE')";

fn row(r: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        project_id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        status: parse_status(&r.get::<_, String>(3)?),
        language: r.get(4)?,
        workspace_root: r.get(5)?,
        default_model_id: r.get(6)?,
        version: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
        context_source_count: r.get(10)?,
    })
}

/// التغييرات المسموح بها في تحديث واحد. `Some(None)` يعني «امسح القيمة».
#[derive(Debug, Default, Clone)]
pub struct ProjectChanges {
    pub name: Option<String>,
    pub description: Option<String>,
    pub language: Option<String>,
    pub workspace_root: Option<Option<String>>,
    pub default_model_id: Option<Option<String>>,
    pub status: Option<ProjectStatus>,
}

impl ProjectRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn insert(&self, project: &Project) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, version, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    project.project_id,
                    project.name,
                    project.description,
                    status_code(project.status),
                    project.language,
                    project.workspace_root,
                    project.default_model_id,
                    project.version,
                    project.created_at,
                    project.updated_at
                ],
            )
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(ref f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => StorageError::Conflict,
                other => StorageError::from(other),
            })?;
            Ok(())
        })
    }

    pub fn get(&self, project_id: &str) -> Result<Option<Project>, StorageError> {
        self.db.with(|conn| Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM projects p WHERE p.project_id = ?1"), [project_id], row).optional()?))
    }

    pub fn list(&self, include_archived: bool, query: Option<&str>) -> Result<Vec<Project>, StorageError> {
        self.db.with(|conn| {
            let mut sql = format!("SELECT {COLUMNS} FROM projects p WHERE 1 = 1");
            if !include_archived {
                sql.push_str(" AND p.status = 'ACTIVE'");
            }
            // البحث نصّ حرفي داخل الاسم أو الوصف، لا نمط: محارف LIKE تُهرَّب.
            let pattern = query.map(|q| format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")));
            if pattern.is_some() {
                sql.push_str(" AND (p.name LIKE ?1 ESCAPE '\\' OR p.description LIKE ?1 ESCAPE '\\')");
            }
            sql.push_str(" ORDER BY p.updated_at DESC, p.project_id ASC LIMIT 1000");
            let mut statement = conn.prepare(&sql)?;
            let rows = match &pattern {
                Some(p) => statement.query_map([p], row)?.collect::<Result<Vec<_>, _>>()?,
                None => statement.query_map([], row)?.collect::<Result<Vec<_>, _>>()?,
            };
            Ok(rows)
        })
    }

    /// تحديث مشروط بالإصدار. إصدار قديم → تعارض، ولا شيء يُكتب.
    pub fn update(&self, project_id: &str, expected_version: i64, changes: &ProjectChanges, now: &str) -> Result<Project, StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            let current: Option<Project> =
                tx.query_row(&format!("SELECT {COLUMNS} FROM projects p WHERE p.project_id = ?1"), [project_id], row).optional()?;
            let Some(current) = current else { return Err(StorageError::NotFound) };
            if current.version != expected_version {
                return Err(StorageError::Conflict);
            }
            let name = changes.name.clone().unwrap_or(current.name);
            let description = changes.description.clone().unwrap_or(current.description);
            let language = changes.language.clone().unwrap_or(current.language);
            let workspace = changes.workspace_root.clone().unwrap_or(current.workspace_root);
            let model = changes.default_model_id.clone().unwrap_or(current.default_model_id);
            let status = changes.status.unwrap_or(current.status);
            let updated = tx.execute(
                "UPDATE projects SET name = ?2, description = ?3, language = ?4, workspace_root = ?5, default_model_id = ?6,
                 status = ?7, version = version + 1, updated_at = ?8 WHERE project_id = ?1 AND version = ?9",
                params![project_id, name, description, language, workspace, model, status_code(status), now, expected_version],
            )?;
            if updated != 1 {
                return Err(StorageError::Conflict);
            }
            let fresh = tx.query_row(&format!("SELECT {COLUMNS} FROM projects p WHERE p.project_id = ?1"), [project_id], row)?;
            tx.commit()?;
            Ok(fresh)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn project(id: &str, name: &str) -> Project {
        Project {
            project_id: id.into(),
            name: name.into(),
            description: String::new(),
            status: ProjectStatus::Active,
            language: "en".into(),
            workspace_root: None,
            default_model_id: None,
            version: 1,
            created_at: "2026-09-17T00:00:00Z".into(),
            updated_at: "2026-09-17T00:00:00Z".into(),
            context_source_count: 0,
        }
    }

    fn repo() -> (ProjectRepository, Arc<Database>) {
        let db = Arc::new(Database::in_memory().unwrap());
        (ProjectRepository::new(db.clone()), db)
    }

    #[test]
    fn create_read_update_archive_list() {
        let (r, _) = repo();
        r.insert(&project("p1", "Alpha")).unwrap();
        assert_eq!(r.get("p1").unwrap().unwrap().name, "Alpha");
        let changes = ProjectChanges { name: Some("Beta".into()), ..Default::default() };
        let updated = r.update("p1", 1, &changes, "2026-09-17T00:00:01Z").unwrap();
        assert_eq!((updated.name.as_str(), updated.version), ("Beta", 2));
        let archived = r.update("p1", 2, &ProjectChanges { status: Some(ProjectStatus::Archived), ..Default::default() }, "t").unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        assert!(r.list(false, None).unwrap().is_empty());
        assert_eq!(r.list(true, None).unwrap().len(), 1);
    }

    #[test]
    fn a_duplicate_identifier_is_a_conflict() {
        let (r, _) = repo();
        r.insert(&project("p1", "A")).unwrap();
        assert_eq!(r.insert(&project("p1", "B")), Err(StorageError::Conflict));
        assert_eq!(r.get("p1").unwrap().unwrap().name, "A");
    }

    #[test]
    fn a_stale_version_is_a_conflict_and_writes_nothing() {
        let (r, _) = repo();
        r.insert(&project("p1", "A")).unwrap();
        r.update("p1", 1, &ProjectChanges { name: Some("B".into()), ..Default::default() }, "t").unwrap();
        let stale = r.update("p1", 1, &ProjectChanges { name: Some("C".into()), ..Default::default() }, "t");
        assert_eq!(stale.err(), Some(StorageError::Conflict));
        assert_eq!(r.get("p1").unwrap().unwrap().name, "B");
        assert_eq!(r.update("nope", 1, &ProjectChanges::default(), "t").err(), Some(StorageError::NotFound));
    }

    #[test]
    fn concurrent_updates_with_the_same_version_leave_exactly_one_winner() {
        let (r, db) = repo();
        r.insert(&project("p1", "A")).unwrap();
        let r = Arc::new(ProjectRepository::new(db));
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let r = r.clone();
                thread::spawn(move || r.update("p1", 1, &ProjectChanges { name: Some(format!("N{i}")), ..Default::default() }, "t").is_ok())
            })
            .collect();
        let winners = handles.into_iter().map(|h| h.join().unwrap()).filter(|ok| *ok).count();
        assert_eq!(winners, 1);
        assert_eq!(r.get("p1").unwrap().unwrap().version, 2);
    }

    #[test]
    fn concurrent_reads_see_consistent_records() {
        let (r, db) = repo();
        for i in 0..20 {
            r.insert(&project(&format!("p{i:02}"), "X")).unwrap();
        }
        let r = Arc::new(ProjectRepository::new(db));
        let handles: Vec<_> = (0..6).map(|_| { let r = r.clone(); thread::spawn(move || r.list(true, None).unwrap().len()) }).collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), 20);
        }
    }

    #[test]
    fn search_is_literal_not_a_pattern() {
        let (r, _) = repo();
        r.insert(&project("p1", "100% ready")).unwrap();
        r.insert(&project("p2", "1000 ready")).unwrap();
        let found = r.list(false, Some("100%")).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].project_id, "p1");
        assert_eq!(r.list(false, Some("_")).unwrap().len(), 0);
    }

    #[test]
    fn a_failed_write_rolls_back() {
        let (r, db) = repo();
        r.insert(&project("p1", "A")).unwrap();
        // قيد التحقق يرفض الاسم الفارغ داخل المعاملة؛ لا يتغيّر الإصدار.
        let bad = r.update("p1", 1, &ProjectChanges { name: Some(String::new()), ..Default::default() }, "t");
        assert!(bad.is_err());
        let _ = db;
        let p = r.get("p1").unwrap().unwrap();
        assert_eq!((p.name.as_str(), p.version), ("A", 1));
    }
}
