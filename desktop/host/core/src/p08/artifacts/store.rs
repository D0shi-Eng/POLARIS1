// سجلّ المخرجات: واصف لكل ملف أنتجته مهمّة، بتحقّقه ومعاينته ومصدره.
//
// الواصف لا يُسجَّل إلا بعد إعادة فتح الملف والتحقق منه (verify_file). مخرَج فشل تحققه
// يُسجَّل FAILED بأسبابه، ولا يُحذف ولا يُرقّى: المستخدم يرى ما حدث فعلًا. المعاينة
// نصّ وحقائق محدودة، لا الملف نفسه، ولا تحمل مسارًا خارج المساحة.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::{Database, StorageError};

use super::extract::{extract, FileKind};
use super::verify::Verification;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArtifactType {
    Docx,
    Pptx,
    Xlsx,
    Pdf,
    Csv,
    Html,
    Markdown,
    Text,
    Json,
    Image,
    WebSite,
    CodeProject,
}

impl ArtifactType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docx => "DOCX",
            Self::Pptx => "PPTX",
            Self::Xlsx => "XLSX",
            Self::Pdf => "PDF",
            Self::Csv => "CSV",
            Self::Html => "HTML",
            Self::Markdown => "MARKDOWN",
            Self::Text => "TEXT",
            Self::Json => "JSON",
            Self::Image => "IMAGE",
            Self::WebSite => "WEB_SITE",
            Self::CodeProject => "CODE_PROJECT",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Pptx => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            Self::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Self::Pdf => "application/pdf",
            Self::Csv => "text/csv",
            Self::Html => "text/html",
            Self::Markdown => "text/markdown",
            Self::Text => "text/plain",
            Self::Json => "application/json",
            Self::Image => "image/png",
            Self::WebSite => "inode/directory; profile=web-site",
            Self::CodeProject => "inode/directory; profile=code-project",
        }
    }

    /// النوع من اسم الملف. ما لا يُعرف لا يصير مخرَجًا.
    pub fn from_name(name: &str) -> Option<Self> {
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
            return Some(Self::Image);
        }
        Some(match FileKind::from_name(name) {
            FileKind::Docx => Self::Docx,
            FileKind::Xlsx => Self::Xlsx,
            FileKind::Pptx => Self::Pptx,
            FileKind::Pdf => Self::Pdf,
            FileKind::Csv => Self::Csv,
            FileKind::Html => Self::Html,
            FileKind::Markdown => Self::Markdown,
            FileKind::Json => Self::Json,
            FileKind::Text => Self::Text,
            FileKind::Unsupported => return None,
        })
    }
}

/// واصف مخرَج كما يُعرض.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ArtifactDescriptor {
    pub artifact_id: String,
    pub mission_id: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub title: String,
    pub file_ref: String,
    pub mime_type: String,
    pub size: u64,
    pub sha256: String,
    pub created_at: String,
    pub source_task: Option<String>,
    pub verification: Value,
    pub preview: Value,
    pub provenance: Value,
}

/// ما يلزم لتسجيل مخرَج.
pub struct NewArtifact<'a> {
    pub mission_id: &'a str,
    pub task_id: Option<&'a str>,
    pub artifact_type: ArtifactType,
    pub title: &'a str,
    pub file_ref: &'a str,
    pub bytes_for_digest: &'a [u8],
    pub size: u64,
    pub verification: &'a Verification,
    pub preview: Value,
    /// من أنتجه: الأداة والوكيل. لا نصّ نموذج.
    pub producer: &'a str,
    pub agent_id: Option<&'a str>,
}

pub struct ArtifactStore {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
}

/// معاينة نصّية محدودة لملف، مع حقائق التحقق.
pub fn preview_of(name: &str, bytes: &[u8], verification: &Verification) -> Value {
    let facts: serde_json::Map<String, Value> = verification.facts.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
    let excerpt = match extract(name, bytes) {
        Ok(text) => text.text.chars().take(3_000).collect::<String>(),
        Err(_) => String::new(),
    };
    json!({ "excerpt": excerpt, "facts": facts })
}

impl ArtifactStore {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { db, audit, clock }
    }

    pub fn register(&self, new: NewArtifact<'_>) -> Result<ArtifactDescriptor, StorageError> {
        let artifact_id = self.clock.id();
        let created_at = self.clock.now();
        let sha256 = crate::digest::sha256_hex(new.bytes_for_digest);
        let verification = json!({ "status": new.verification.status, "checks": new.verification.checks, "facts": new.verification.facts });
        let provenance = json!({ "producer": new.producer, "agent_id": new.agent_id, "task_id": new.task_id, "authority": "RUNTIME_MEASURED_FILE", "content_trust": "MODEL_GENERATED_UNTRUSTED" });
        let mut preview = new.preview.to_string();
        if preview.len() > 60_000 {
            preview = json!({ "excerpt": "", "facts": {} , "note": "the preview was too large to keep" }).to_string();
        }
        let title: String = new.title.chars().take(300).collect();
        let title = if title.trim().is_empty() { new.file_ref.to_string() } else { title };
        let mut verification_text = verification.to_string();
        if verification_text.len() > 16_000 {
            verification_text = json!({ "status": new.verification.status, "checks": [], "facts": new.verification.facts, "note": "the check list was too long to keep" }).to_string();
        }
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO p08_artifacts (artifact_id, mission_id, artifact_type, title, file_ref, mime_type, size_bytes, sha256, created_at, source_task, verification_status, verification_json, preview_json, provenance_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    artifact_id,
                    new.mission_id,
                    new.artifact_type.as_str(),
                    title,
                    new.file_ref,
                    new.artifact_type.mime(),
                    new.size as i64,
                    sha256,
                    created_at,
                    new.task_id.map(|t| t.chars().take(64).collect::<String>()),
                    new.verification.status,
                    verification_text,
                    preview,
                    provenance.to_string()
                ],
            )?;
            Ok(())
        })?;
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ArtifactCreated,
            "artifact",
            &artifact_id,
            if new.verification.verified() { AuditOutcome::Success } else { AuditOutcome::Failure },
            json!({ "mission_id": new.mission_id, "type": new.artifact_type.as_str(), "sha256": sha256, "size": new.size, "verification": new.verification.status }),
        ));
        self.get(&artifact_id).and_then(|a| a.ok_or(StorageError::NotFound))
    }

    fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactDescriptor> {
        let parse = |s: String| serde_json::from_str::<Value>(&s).unwrap_or(Value::Null);
        Ok(ArtifactDescriptor {
            artifact_id: r.get(0)?,
            mission_id: r.get(1)?,
            artifact_type: r.get(2)?,
            title: r.get(3)?,
            file_ref: r.get(4)?,
            mime_type: r.get(5)?,
            size: r.get::<_, i64>(6)? as u64,
            sha256: r.get(7)?,
            created_at: r.get(8)?,
            source_task: r.get(9)?,
            verification: parse(r.get(10)?),
            preview: parse(r.get(11)?),
            provenance: parse(r.get(12)?),
        })
    }

    const COLUMNS: &'static str = "artifact_id, mission_id, artifact_type, title, file_ref, mime_type, size_bytes, sha256, created_at, source_task, verification_json, preview_json, provenance_json";

    pub fn get(&self, artifact_id: &str) -> Result<Option<ArtifactDescriptor>, StorageError> {
        self.db.with(|conn| Ok(conn.query_row(&format!("SELECT {} FROM p08_artifacts WHERE artifact_id = ?1", Self::COLUMNS), params![artifact_id], Self::row).optional()?))
    }

    /// هل سُجّل هذا المسار بهذا المحتوى نفسه من قبل (في أي مهمّة)؟ المتابعة في محادثة تشارك
    /// المساحة، فملف الدور الأول لا يُسجَّل مرة ثانية باسم الدور الثاني.
    pub fn has_same(&self, file_ref: &str, sha256: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| {
            Ok(conn
                .query_row("SELECT 1 FROM p08_artifacts WHERE file_ref = ?1 AND sha256 = ?2 LIMIT 1", params![file_ref, sha256], |_| Ok(()))
                .optional()?
                .is_some())
        })
    }

    /// صفوف مسار في المساحة أو ما تحته (مجلد): المعرّف والمهمّة والمسار والعنوان. المقارنة بلا حالة أحرف، كما يرى NTFS المسار.
    fn rows_under(&self, file_ref: &str) -> Result<Vec<(String, String, String, String)>, StorageError> {
        let prefix = format!("{file_ref}/");
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT artifact_id, mission_id, file_ref, title FROM p08_artifacts WHERE lower(file_ref) = lower(?1) OR lower(substr(file_ref, 1, length(?2))) = lower(?2)",
            )?;
            let out = stmt.query_map(params![file_ref, prefix], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
            Ok(out)
        })
    }

    /// D-MP-12: نُقل ملف أو مجلد داخل المساحة، فتتبعه بطاقاته. `same_workspace` يقول أيّ مهمّة تعمل في هذه المساحة (المتابعة في محادثة
    /// تشارك مساحة المهمّة الأولى). عنوان هو اسم الملف القديم يصير الاسم الجديد؛ عنوان سمّاه الوكيل أو المستخدم يبقى. يعيد عدد الصفوف.
    pub fn follow_move(&self, from: &str, to: &str, same_workspace: &dyn Fn(&str) -> bool) -> Result<usize, StorageError> {
        let rows: Vec<_> = self.rows_under(from)?.into_iter().filter(|(_, mission, _, _)| same_workspace(mission)).collect();
        let old_name = from.rsplit('/').next().unwrap_or(from).to_string();
        let new_name = to.rsplit('/').next().unwrap_or(to).to_string();
        self.db.with(|conn| {
            for (id, _, file_ref, title) in &rows {
                let moved = format!("{to}{}", file_ref.get(from.len()..).unwrap_or(""));
                let title = if *title == old_name && file_ref.len() == from.len() { new_name.clone() } else { title.clone() };
                conn.execute("UPDATE p08_artifacts SET file_ref = ?2, title = ?3 WHERE artifact_id = ?1", params![id, moved, title])?;
            }
            Ok(())
        })?;
        Ok(rows.len())
    }

    /// D-MP-12: حُذف ملف أو مجلد من المساحة، فتُحذف بطاقاته ومنحه وقرارات نشره (كما يفعل الحذف الكامل للمهمّة). السجلّ يبقى في
    /// دفتر التدقيق. يعيد معرّفات ما حُذف.
    pub fn forget_removed(&self, file_ref: &str, same_workspace: &dyn Fn(&str) -> bool) -> Result<Vec<String>, StorageError> {
        let ids: Vec<String> = self.rows_under(file_ref)?.into_iter().filter(|(_, mission, _, _)| same_workspace(mission)).map(|(id, _, _, _)| id).collect();
        self.db.with(|conn| {
            for id in &ids {
                conn.execute("DELETE FROM p08_share_grants WHERE object_type = 'ARTIFACT' AND object_id = ?1", params![id])?;
                conn.execute("DELETE FROM p08_publications WHERE artifact_id = ?1", params![id])?;
                conn.execute("DELETE FROM p08_artifacts WHERE artifact_id = ?1", params![id])?;
            }
            Ok(())
        })?;
        Ok(ids)
    }

    /// قيد تدقيق لتغيير في `outputs/` (نقل أو حذف) بلا محتوى ملف: المسارات النسبية والعدد.
    pub fn audit_output_change(&self, mission_id: &str, detail: Value) {
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::WorkspaceOutputChanged, "workspace", mission_id, AuditOutcome::Success, detail));
    }

    /// مخرجات مهمّة، أو أحدث المخرجات كلها حين لا تُسمّى مهمّة.
    pub fn list(&self, mission_id: Option<&str>, limit: usize) -> Result<Vec<ArtifactDescriptor>, StorageError> {
        self.db.with(|conn| {
            let rows = match mission_id {
                Some(m) => {
                    let mut stmt = conn.prepare(&format!("SELECT {} FROM p08_artifacts WHERE mission_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2", Self::COLUMNS))?;
                    let out = stmt.query_map(params![m, limit as i64], Self::row)?.collect::<Result<Vec<_>, _>>()?;
                    out
                }
                None => {
                    let mut stmt = conn.prepare(&format!("SELECT {} FROM p08_artifacts ORDER BY created_at DESC, rowid DESC LIMIT ?1", Self::COLUMNS))?;
                    let out = stmt.query_map(params![limit as i64], Self::row)?.collect::<Result<Vec<_>, _>>()?;
                    out
                }
            };
            Ok(latest_per_file(rows))
        })
    }
}

/// ملف واحد، بطاقة واحدة (مكافأة Manus 2026-10-19): كل كتابة لمسار تسجّل صفًّا جديدًا ويبقى القديم سجلًّا، لكن القائمة تعرض أحدث صفّ
/// لكل ملف في مهمّته. المقارنة بلا حالة أحرف: قِيس على ويندوز أن `outputs/Budget.xlsx` ثم `outputs/budget.xlsx` ملف واحد كُتب فوقه،
/// فظهرت بطاقتان إحداهما ببصمة محتوى لم يعد موجودًا. الصفوف مرتّبة بالأحدث أولًا، فيبقى الأول من كل مسار.
fn latest_per_file(rows: Vec<ArtifactDescriptor>) -> Vec<ArtifactDescriptor> {
    let mut seen = std::collections::HashSet::new();
    rows.into_iter().filter(|a| seen.insert((a.mission_id.clone(), a.file_ref.to_lowercase()))).collect()
}

#[cfg(test)]
mod latest_tests {
    use super::*;
    use crate::p08::artifacts::verify::Verification;

    fn register(store: &ArtifactStore, file_ref: &str, bytes: &[u8]) {
        let verification = Verification::from_checks(vec![("readable", true, String::new())], Vec::new());
        store
            .register(NewArtifact {
                mission_id: "00000000-0000-4000-8000-000000000001",
                task_id: None,
                artifact_type: ArtifactType::Xlsx,
                title: "Budget",
                file_ref,
                bytes_for_digest: bytes,
                size: bytes.len() as u64,
                verification: &verification,
                preview: json!({}),
                producer: "test",
                agent_id: None,
            })
            .unwrap();
    }

    #[test]
    fn a_rewritten_file_or_its_case_variant_is_listed_once_with_its_latest_content() {
        let db = Arc::new(Database::in_memory().unwrap());
        let store = ArtifactStore::new(db.clone(), Arc::new(AuditLedger::new(db)), RuntimeClock::system());
        register(&store, "outputs/Budget.xlsx", b"first");
        register(&store, "outputs/budget.xlsx", b"second");
        register(&store, "outputs/status.docx", b"doc");
        let listed = store.list(Some("00000000-0000-4000-8000-000000000001"), 50).unwrap();
        let budgets: Vec<_> = listed.iter().filter(|a| a.file_ref.eq_ignore_ascii_case("outputs/budget.xlsx")).collect();
        assert_eq!(budgets.len(), 1, "one file on disk, several cards: {listed:?}");
        assert_eq!(budgets[0].sha256, crate::digest::sha256_hex(b"second"), "the card does not hold the content now on disk");
        assert_eq!(listed.len(), 2);
    }
}
