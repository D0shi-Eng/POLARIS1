// النشر: مخرَج ← اقتراح نشر ← سياسة ← موافقة بشرية ← محوّل ناشر.
//
// لا ناشر إنترنت في هذا البناء. الناشر الوحيد المسجَّل «مجلد محلي» يكتب نسخة المخرَج تحت
// مجلد بيانات POLARIS (`publications/`)، وهو ما يستعمله الاختبار القانوني. أي ناشر آخر
// يُضاف محوّلًا يمرّ بالخطوات نفسها، ولا يُنشر شيء قبل قرار مستخدم صريح.

use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

use super::super::artifacts::store::ArtifactStore;
use super::super::workspace::{Access, WorkspaceRoot};

/// محوّل ناشر.
pub trait PublisherAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    /// هل هذا الناشر يُخرج شيئًا من الجهاز؟ نعم يعني أثرًا خارجيًّا.
    fn leaves_device(&self) -> bool;
    fn publish(&self, publication_id: &str, file_name: &str, bytes: &[u8]) -> Result<String, String>;
}

/// الناشر المحلي: نسخة داخل مجلد البيانات. لا شبكة.
pub struct LocalFolderPublisher {
    pub root: PathBuf,
}

impl PublisherAdapter for LocalFolderPublisher {
    fn id(&self) -> &'static str {
        "local-folder"
    }
    fn leaves_device(&self) -> bool {
        false
    }
    fn publish(&self, publication_id: &str, file_name: &str, bytes: &[u8]) -> Result<String, String> {
        let dir = self.root.join(publication_id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(file_name), bytes).map_err(|e| e.to_string())?;
        Ok(format!("publications/{publication_id}/{file_name}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PublicationView {
    pub publication_id: String,
    pub artifact_id: String,
    pub publisher: String,
    pub status: String,
    pub target: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct PublishService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    publishers: Vec<Arc<dyn PublisherAdapter>>,
    workspaces: WorkspaceRoot,
}

impl PublishService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock, publishers: Vec<Arc<dyn PublisherAdapter>>, workspaces: WorkspaceRoot) -> Self {
        Self { db, audit, clock, publishers, workspaces }
    }

    pub fn publishers(&self) -> Vec<(&'static str, bool)> {
        self.publishers.iter().map(|p| (p.id(), p.leaves_device())).collect()
    }

    /// اقتراح نشر. لا يُنشر شيء: الحالة AWAITING_APPROVAL حتى قرار المستخدم.
    pub fn propose(&self, artifacts: &ArtifactStore, artifact_id: &str, publisher: &str) -> Result<PublicationView, String> {
        let artifact = artifacts.get(artifact_id).map_err(|e| e.to_string())?.ok_or("no such artifact")?;
        if !self.publishers.iter().any(|p| p.id() == publisher) {
            return Err("POLICY: the publisher is not registered in this build".into());
        }
        if artifact.verification.get("status").and_then(|s| s.as_str()) != Some("VERIFIED") {
            return Err("POLICY: only a verified artifact can be proposed for publication".into());
        }
        let id = self.clock.id();
        let now = self.clock.now();
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_publications (publication_id, artifact_id, publisher, status, target, approval_id, created_at, updated_at) VALUES (?1, ?2, ?3, 'AWAITING_APPROVAL', '', NULL, ?4, ?4)",
                    params![id, artifact_id, publisher, now],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())?;
        self.get(&id)?.ok_or_else(|| "the proposal vanished".into())
    }

    /// قرار المستخدم. الموافقة وحدها تشغّل المحوّل، ومرة واحدة.
    pub fn decide(&self, artifacts: &ArtifactStore, publication_id: &str, grant: bool) -> Result<PublicationView, String> {
        let view = self.get(publication_id)?.ok_or("no such publication")?;
        if view.status != "AWAITING_APPROVAL" {
            return Err("the publication was already decided".into());
        }
        let (status, target) = if !grant {
            ("DENIED".to_string(), String::new())
        } else {
            let artifact = artifacts.get(&view.artifact_id).map_err(|e| e.to_string())?.ok_or("no such artifact")?;
            let publisher = self.publishers.iter().find(|p| p.id() == view.publisher).ok_or("the publisher vanished")?;
            let workspace = self.workspaces.for_mission(&artifact.mission_id).map_err(|e| e.to_string())?;
            let path = workspace.resolve(&artifact.file_ref, Access::Read).map_err(|e| e.to_string())?;
            if path.is_dir() {
                return Err("POLICY: directory artifacts are published as a packaged archive only".into());
            }
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            if crate::digest::sha256_hex(&bytes) != artifact.sha256 {
                return Err("the artifact changed after it was verified; it is not published".into());
            }
            let name = artifact.file_ref.rsplit('/').next().unwrap_or("artifact").to_string();
            match publisher.publish(publication_id, &name, &bytes) {
                Ok(target) => ("PUBLISHED".to_string(), target),
                Err(e) => ("FAILED".to_string(), e.chars().take(300).collect()),
            }
        };
        self.db
            .with(|c| Ok(c.execute("UPDATE p08_publications SET status = ?2, target = ?3, updated_at = ?4 WHERE publication_id = ?1", params![publication_id, status, target, self.clock.now()])?))
            .map_err(|e| e.to_string())?;
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::PublicationDecided,
            "publication",
            publication_id,
            if status == "PUBLISHED" { AuditOutcome::Success } else if status == "DENIED" { AuditOutcome::Denied } else { AuditOutcome::Failure },
            serde_json::json!({ "status": status, "publisher": view.publisher }),
        ));
        self.get(publication_id)?.ok_or_else(|| "the publication vanished".into())
    }

    fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<PublicationView> {
        Ok(PublicationView { publication_id: r.get(0)?, artifact_id: r.get(1)?, publisher: r.get(2)?, status: r.get(3)?, target: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)? })
    }

    pub fn get(&self, id: &str) -> Result<Option<PublicationView>, String> {
        self.db
            .with(|c| Ok(c.query_row("SELECT publication_id, artifact_id, publisher, status, target, created_at, updated_at FROM p08_publications WHERE publication_id = ?1", params![id], Self::row).optional()?))
            .map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Result<Vec<PublicationView>, String> {
        self.db
            .with(|c| {
                let mut s = c.prepare("SELECT publication_id, artifact_id, publisher, status, target, created_at, updated_at FROM p08_publications ORDER BY created_at DESC LIMIT 200")?;
                let rows = s.query_map([], Self::row)?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(|e| e.to_string())
    }
}
