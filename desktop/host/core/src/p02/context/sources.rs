// مصادر السياق: الإضافة، والإزالة، والقياس.
//
// المصدر مرجع يسمّيه المستخدم، لا نسخة من المحتوى. الإضافة تتحقق من المسار داخل
// جذر المشروع وتبصم الملف؛ القياس اللاحق يعيد الفحص ويعلن الغياب أو التغيّر.
// الإزالة ليّنة: السجل يبقى بحالة REMOVED ولا يُحذف.

use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};
use serde_json::json;

use super::classify::{is_sensitive, by_name};
use super::model::{code, parse, trust_for, ContentClass, ContextSource, SourceAvailability, SourceType};
use super::paths::{resolve, PathDenial};
use super::reader::{snapshot, ReadFailure};
use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::ids::new_uuid_v4;
use crate::p02::errors::P02Error;
use crate::p02::projects::{Project, ProjectService, ProjectStatus};
use crate::storage::Database;
use crate::time::now_rfc3339_utc;

/// أقصى عدد مصادر نشطة في مشروع.
pub const MAX_ACTIVE_SOURCES: i64 = 64;

pub struct AddSource {
    pub source_type: SourceType,
    pub reference: Option<String>,
    pub text: Option<String>,
    pub display_name: Option<String>,
}

pub struct SourceService {
    db: Arc<Database>,
    projects: Arc<ProjectService>,
    audit: Arc<AuditLedger>,
}

const COLUMNS: &str = "source_id, project_id, source_type, reference, text_body, display_name, trust_class, content_class, added_at, last_seen_at, availability, digest, byte_count";

fn row(r: &Row<'_>) -> rusqlite::Result<ContextSource> {
    Ok(ContextSource {
        source_id: r.get(0)?,
        project_id: r.get(1)?,
        source_type: parse(&r.get::<_, String>(2)?, SourceType::File),
        reference: r.get(3)?,
        text_body: r.get(4)?,
        display_name: r.get(5)?,
        trust_class: parse(&r.get::<_, String>(6)?, super::model::TrustClass::UntrustedContent),
        content_class: parse(&r.get::<_, String>(7)?, ContentClass::Unknown),
        added_at: r.get(8)?,
        last_seen_at: r.get(9)?,
        availability: parse(&r.get::<_, String>(10)?, SourceAvailability::Unknown),
        digest: r.get(11)?,
        byte_count: r.get::<_, Option<i64>>(12)?.map(|v| v.max(0) as u64),
    })
}

fn denial_to_error(denial: PathDenial) -> P02Error {
    match denial {
        PathDenial::NoWorkspace => P02Error::invalid("/reference", "the project has no usable workspace root"),
        PathDenial::InvalidReference => P02Error::invalid("/reference", "invalid relative reference"),
        PathDenial::Missing => P02Error::invalid("/reference", "the referenced item does not exist"),
        PathDenial::OutOfScope => P02Error::denied("/reference", "the reference leaves the workspace root"),
        PathDenial::ReparsePoint => P02Error::denied("/reference", "the reference crosses a reparse point"),
        PathDenial::NotReadable => P02Error::denied("/reference", "the referenced item is not readable"),
    }
}

pub fn denial_availability(denial: PathDenial) -> SourceAvailability {
    match denial {
        PathDenial::Missing => SourceAvailability::Missing,
        PathDenial::OutOfScope | PathDenial::ReparsePoint | PathDenial::NoWorkspace | PathDenial::InvalidReference => SourceAvailability::OutOfScope,
        PathDenial::NotReadable => SourceAvailability::NotReadable,
    }
}

fn clean_display(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    (!trimmed.is_empty() && trimmed.chars().count() <= 160 && !trimmed.chars().any(char::is_control)).then(|| trimmed.to_string())
}

impl SourceService {
    pub fn new(db: Arc<Database>, projects: Arc<ProjectService>, audit: Arc<AuditLedger>) -> Self {
        Self { db, projects, audit }
    }

    pub fn projects(&self) -> &ProjectService {
        &self.projects
    }

    fn active_project(&self, project_id: &str) -> Result<Project, P02Error> {
        let project = self.projects.get(project_id)?;
        if project.status != ProjectStatus::Active {
            return Err(P02Error::Conflict("the project is archived".into()));
        }
        Ok(project)
    }

    pub fn list(&self, project_id: &str) -> Result<Vec<ContextSource>, P02Error> {
        Ok(self.db.with(|conn| {
            let mut statement = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM context_sources WHERE project_id = ?1 AND status = 'ACTIVE' ORDER BY added_at, source_id"
            ))?;
            let rows = statement.query_map([project_id], row)?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })?)
    }

    /// مصدر بمعرّفه، بشرط أن يخصّ المشروع. الحالة تُعاد مع السجل.
    pub fn get(&self, project_id: &str, source_id: &str) -> Result<Option<(ContextSource, bool)>, P02Error> {
        Ok(self.db.with(|conn| {
            Ok(conn
                .query_row(
                    &format!("SELECT {COLUMNS}, status FROM context_sources WHERE project_id = ?1 AND source_id = ?2"),
                    params![project_id, source_id],
                    |r| Ok((row(r)?, r.get::<_, String>(13)? == "ACTIVE")),
                )
                .optional()?)
        })?)
    }

    fn insert(&self, source: &ContextSource) -> Result<(), P02Error> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            let active: i64 = tx.query_row(
                "SELECT count(*) FROM context_sources WHERE project_id = ?1 AND status = 'ACTIVE'",
                [&source.project_id],
                |r| r.get(0),
            )?;
            if active >= MAX_ACTIVE_SOURCES {
                return Err(crate::storage::StorageError::Invalid("too many sources".into()));
            }
            let duplicate: i64 = tx.query_row(
                "SELECT count(*) FROM context_sources WHERE project_id = ?1 AND status = 'ACTIVE' AND source_type = ?2 AND reference = ?3",
                params![source.project_id, code(source.source_type), source.reference],
                |r| r.get(0),
            )?;
            if duplicate > 0 && matches!(source.source_type, SourceType::File | SourceType::Folder | SourceType::WorkspaceRoot) {
                return Err(crate::storage::StorageError::Conflict);
            }
            tx.execute(
                &format!("INSERT INTO context_sources ({COLUMNS}, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'ACTIVE')"),
                params![
                    source.source_id,
                    source.project_id,
                    code(source.source_type),
                    source.reference,
                    source.text_body,
                    source.display_name,
                    code(source.trust_class),
                    code(source.content_class),
                    source.added_at,
                    source.last_seen_at,
                    code(source.availability),
                    source.digest,
                    source.byte_count.map(|b| b as i64)
                ],
            )?;
            tx.commit()?;
            Ok(())
        })
        .map_err(|e| match e {
            crate::storage::StorageError::Invalid(detail) => P02Error::Conflict(detail),
            crate::storage::StorageError::Conflict => P02Error::Conflict("the source is already attached".into()),
            other => P02Error::from(other),
        })
    }

    pub fn add(&self, project_id: &str, request: AddSource) -> Result<ContextSource, P02Error> {
        let project = self.active_project(project_id)?;
        let now = now_rfc3339_utc();
        let mut source = ContextSource {
            source_id: new_uuid_v4(),
            project_id: project_id.to_string(),
            source_type: request.source_type,
            reference: String::new(),
            display_name: String::new(),
            trust_class: trust_for(request.source_type),
            content_class: ContentClass::Unknown,
            added_at: now.clone(),
            last_seen_at: None,
            availability: SourceAvailability::Unknown,
            digest: None,
            byte_count: None,
            text_body: None,
        };
        match request.source_type {
            SourceType::File | SourceType::Folder => {
                let reference = request.reference.ok_or_else(|| P02Error::invalid("/reference", "a reference is required"))?;
                let root = project.workspace_root.clone().ok_or_else(|| P02Error::invalid("/reference", "the project has no workspace root"))?;
                let path = resolve(&root, &reference).map_err(denial_to_error)?;
                let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                source.reference = super::paths::relative_display(Path::new(&root), &path).unwrap_or(reference);
                source.display_name = request.display_name.as_deref().and_then(clean_display).unwrap_or_else(|| name.clone());
                if request.source_type == SourceType::File {
                    if is_sensitive(&name) {
                        return Err(P02Error::denied("/reference", "files that usually carry credentials are not context"));
                    }
                    let snap = snapshot(&path).map_err(|f| match f {
                        ReadFailure::NotAFile => P02Error::invalid("/reference", "the reference is not a file"),
                        _ => P02Error::denied("/reference", "the file is not readable"),
                    })?;
                    source.content_class = snap.class;
                    source.digest = snap.digest;
                    source.byte_count = Some(snap.size);
                } else if !path.is_dir() {
                    return Err(P02Error::invalid("/reference", "the reference is not a folder"));
                } else {
                    source.content_class = ContentClass::Unknown;
                }
                source.availability = SourceAvailability::Available;
                source.last_seen_at = Some(now.clone());
            }
            SourceType::TextNote | SourceType::UserInstruction => {
                let text = request.text.ok_or_else(|| P02Error::invalid("/text", "text is required"))?;
                if text.trim().is_empty() || text.chars().count() > 16000 {
                    return Err(P02Error::invalid("/text", "invalid text"));
                }
                let display = request.display_name.as_deref().and_then(clean_display).ok_or_else(|| P02Error::invalid("/display_name", "invalid display name"))?;
                source.reference = format!("note:{}", source.source_id);
                source.display_name = display;
                source.content_class = ContentClass::Documentation;
                source.byte_count = Some(text.len() as u64);
                source.digest = Some(crate::digest::sha256_hex(text.as_bytes()));
                source.text_body = Some(text);
                source.availability = SourceAvailability::Available;
                source.last_seen_at = Some(now.clone());
            }
            SourceType::WorkspaceRoot | SourceType::SystemContext => {
                // لا يصل العارض إلى هنا (العقد يرفضه)، والمضيف يرفضه مرة ثانية.
                return Err(P02Error::denied("/source_type", "this source type is host-owned"));
            }
        }
        self.insert(&source)?;
        self.audit.append(&AuditRecord::new(
            AuditEventType::ContextSourceAdded,
            "context_source",
            &source.source_id,
            AuditOutcome::Success,
            json!({ "project_id": project_id, "source_type": code(source.source_type), "content_class": code(source.content_class), "byte_count": source.byte_count }),
        ))?;
        Ok(source)
    }

    /// مصدر جذر مساحة العمل: يُنشئه المضيف أو يزيله حسب حالة المشروع.
    pub fn sync_workspace_source(&self, project: &Project) -> Result<(), P02Error> {
        let existing: Vec<ContextSource> = self.list(&project.project_id)?.into_iter().filter(|s| s.source_type == SourceType::WorkspaceRoot).collect();
        match &project.workspace_root {
            None => {
                for source in existing {
                    self.mark_removed(&source.source_id)?;
                }
                Ok(())
            }
            Some(root) => {
                if !existing.is_empty() {
                    let name = Path::new(root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.clone());
                    self.db.with(|conn| {
                        conn.execute(
                            "UPDATE context_sources SET display_name = ?2, availability = 'AVAILABLE', last_seen_at = ?3 WHERE source_id = ?1",
                            params![existing[0].source_id, name.chars().take(160).collect::<String>(), now_rfc3339_utc()],
                        )?;
                        Ok(())
                    })?;
                    return Ok(());
                }
                let now = now_rfc3339_utc();
                let name = Path::new(root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.clone());
                let source = ContextSource {
                    source_id: new_uuid_v4(),
                    project_id: project.project_id.clone(),
                    source_type: SourceType::WorkspaceRoot,
                    reference: ".".into(),
                    display_name: name.chars().take(160).collect(),
                    trust_class: trust_for(SourceType::WorkspaceRoot),
                    content_class: ContentClass::Unknown,
                    added_at: now.clone(),
                    last_seen_at: Some(now),
                    availability: SourceAvailability::Available,
                    digest: None,
                    byte_count: None,
                    text_body: None,
                };
                self.insert(&source)
            }
        }
    }

    fn mark_removed(&self, source_id: &str) -> Result<(), P02Error> {
        self.db.with(|conn| {
            conn.execute("UPDATE context_sources SET status = 'REMOVED' WHERE source_id = ?1", [source_id])?;
            Ok(())
        })?;
        Ok(())
    }

    pub fn remove(&self, project_id: &str, source_id: &str) -> Result<ContextSource, P02Error> {
        self.active_project(project_id)?;
        let (source, active) = self.get(project_id, source_id)?.ok_or_else(|| P02Error::invalid("/source_id", "unknown source for this project"))?;
        if !active {
            return Err(P02Error::Conflict("the source is already removed".into()));
        }
        if source.source_type == SourceType::WorkspaceRoot {
            return Err(P02Error::denied("/source_id", "the workspace root follows the project setting"));
        }
        self.mark_removed(source_id)?;
        self.audit.append(&AuditRecord::new(
            AuditEventType::ContextSourceRemoved,
            "context_source",
            source_id,
            AuditOutcome::Success,
            json!({ "project_id": project_id, "source_type": code(source.source_type) }),
        ))?;
        Ok(source)
    }

    /// يعيد قياس مصدر ملف أو مجلد ويحفظ النتيجة.
    pub fn measure(&self, project: &Project, source: &ContextSource) -> Result<ContextSource, P02Error> {
        let mut updated = source.clone();
        let now = now_rfc3339_utc();
        match source.source_type {
            SourceType::File | SourceType::Folder | SourceType::WorkspaceRoot => {
                let resolved = match &project.workspace_root {
                    Some(root) => resolve(root, &source.reference),
                    None => Err(PathDenial::NoWorkspace),
                };
                match resolved {
                    Err(denial) => updated.availability = denial_availability(denial),
                    Ok(path) if source.source_type == SourceType::File => match snapshot(&path) {
                        Ok(snap) => {
                            updated.availability = if snap.digest.is_some() && source.digest.is_some() && snap.digest != source.digest {
                                SourceAvailability::Changed
                            } else {
                                SourceAvailability::Available
                            };
                            updated.content_class = if snap.digest.is_some() { snap.class } else { by_name(&source.display_name) };
                            updated.digest = snap.digest.or(updated.digest);
                            updated.byte_count = Some(snap.size);
                            updated.last_seen_at = Some(now);
                        }
                        Err(ReadFailure::NotAFile) => updated.availability = SourceAvailability::Missing,
                        Err(_) => updated.availability = SourceAvailability::NotReadable,
                    },
                    Ok(path) => {
                        updated.availability = if path.is_dir() { SourceAvailability::Available } else { SourceAvailability::Missing };
                        if path.is_dir() {
                            updated.last_seen_at = Some(now);
                        }
                    }
                }
            }
            _ => {}
        }
        self.db.with(|conn| {
            conn.execute(
                "UPDATE context_sources SET availability = ?2, digest = ?3, byte_count = ?4, last_seen_at = ?5, content_class = ?6 WHERE source_id = ?1",
                params![
                    updated.source_id,
                    code(updated.availability),
                    updated.digest,
                    updated.byte_count.map(|b| b as i64),
                    updated.last_seen_at,
                    code(updated.content_class)
                ],
            )?;
            Ok(())
        })?;
        Ok(updated)
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::p02::projects::service::NewProject;

    pub fn setup() -> (Arc<SourceService>, Project, std::path::PathBuf, Arc<AuditLedger>) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let projects = Arc::new(ProjectService::new(db.clone(), audit.clone()));
        let dir = crate::test_scratch::root().join(format!("src-{}", new_uuid_v4()));
        std::fs::create_dir_all(dir.join("docs")).unwrap();
        std::fs::write(dir.join("docs").join("readme.md"), "# Title\nbody").unwrap();
        std::fs::write(dir.join(".env"), "API_KEY=x").unwrap();
        let project = projects
            .create(NewProject { name: "P".into(), description: None, language: None, workspace_root: Some(dir.to_string_lossy().to_string()) })
            .unwrap();
        let service = Arc::new(SourceService::new(db, projects, audit.clone()));
        service.sync_workspace_source(&project).unwrap();
        (service, project, dir, audit)
    }

    fn file(reference: &str) -> AddSource {
        AddSource { source_type: SourceType::File, reference: Some(reference.into()), text: None, display_name: None }
    }

    #[test]
    fn a_file_source_is_added_with_its_digest_and_trust() {
        let (s, p, dir, audit) = setup();
        let src = s.add(&p.project_id, file("docs/readme.md")).unwrap();
        assert_eq!(src.reference, "docs/readme.md");
        assert_eq!(src.trust_class, super::super::model::TrustClass::UserAuthorizedResource);
        assert!(src.digest.is_some());
        assert_eq!(s.list(&p.project_id).unwrap().len(), 2, "the workspace root and the file");
        assert_eq!(audit.count("CONTEXT_SOURCE_ADDED").unwrap(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicates_sensitive_files_and_escapes_are_refused() {
        let (s, p, dir, _) = setup();
        s.add(&p.project_id, file("docs/readme.md")).unwrap();
        assert!(matches!(s.add(&p.project_id, file("docs/readme.md")), Err(P02Error::Conflict(_))));
        assert!(matches!(s.add(&p.project_id, file(".env")), Err(P02Error::Denied { .. })));
        assert!(s.add(&p.project_id, file("../outside.txt")).is_err());
        assert!(matches!(s.add(&p.project_id, file("docs/missing.md")), Err(P02Error::Invalid { .. })));
        let host_owned = AddSource { source_type: SourceType::SystemContext, reference: None, text: Some("x".into()), display_name: Some("x".into()) };
        assert!(matches!(s.add(&p.project_id, host_owned), Err(P02Error::Denied { .. })));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_or_deleted_file_is_reported_on_measurement() {
        let (s, p, dir, _) = setup();
        let src = s.add(&p.project_id, file("docs/readme.md")).unwrap();
        std::fs::write(dir.join("docs").join("readme.md"), "# Title\nchanged").unwrap();
        let measured = s.measure(&p, &src).unwrap();
        assert_eq!(measured.availability, SourceAvailability::Changed);
        std::fs::remove_file(dir.join("docs").join("readme.md")).unwrap();
        let measured = s.measure(&p, &measured).unwrap();
        assert_eq!(measured.availability, SourceAvailability::Missing);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn removal_is_soft_and_single() {
        let (s, p, dir, _) = setup();
        let note = s
            .add(&p.project_id, AddSource { source_type: SourceType::TextNote, reference: None, text: Some("remember".into()), display_name: Some("n".into()) })
            .unwrap();
        s.remove(&p.project_id, &note.source_id).unwrap();
        assert!(matches!(s.remove(&p.project_id, &note.source_id), Err(P02Error::Conflict(_))));
        assert!(s.get(&p.project_id, &note.source_id).unwrap().is_some());
        let root = s.list(&p.project_id).unwrap().into_iter().find(|x| x.source_type == SourceType::WorkspaceRoot).unwrap();
        assert!(matches!(s.remove(&p.project_id, &root.source_id), Err(P02Error::Denied { .. })));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_source_of_another_project_is_not_reachable() {
        let (s, p, dir, _) = setup();
        let src = s.add(&p.project_id, file("docs/readme.md")).unwrap();
        let other = s.projects().create(NewProject { name: "Q".into(), description: None, language: None, workspace_root: None }).unwrap();
        assert!(s.get(&other.project_id, &src.source_id).unwrap().is_none());
        assert!(s.remove(&other.project_id, &src.source_id).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
