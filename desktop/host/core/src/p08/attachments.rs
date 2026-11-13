// وسيط الملفات المرفقة: الملف يدخل بايتات واسمًا، لا مسارًا.
//
// العارض يرسل محتوى ملف اختاره المستخدم (سحب وإفلات أو منتقي الملفات) واسمه وحده؛ لا
// يعبر مسار من جهاز المستخدم الحدّ أبدًا، ولا يُحفظ. الملف يُصنَّف (نوعه وحجمه وبصمته)،
// ويُوسَم `USER_PROVIDED_UNTRUSTED`: محتواه بيانات لا تعليمات. يُحفظ في منطقة انتظار
// يملكها POLARIS، ثم يُنسخ إلى `inputs/` في مساحة المهمّة حين يُربط بها.

use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::{Database, StorageError};

use super::artifacts::extract::FileKind;
use super::intake::inspect;
use super::workspace::{normalise_relative, WorkspaceRoot, INPUTS};

pub const MAX_ATTACHMENT_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_ATTACHMENTS_PER_MISSION: usize = 40;

/// امتدادات تنفيذية لا تُقبل مرفقًا: المرفق يُقرأ ويُحلَّل، ولا يُشغَّل.
const EXECUTABLE: [&str; 12] = ["exe", "dll", "msi", "scr", "com", "sys", "cpl", "ocx", "lnk", "appx", "msix", "jar"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttachmentView {
    pub attachment_id: String,
    pub mission_id: Option<String>,
    pub file_name: String,
    pub workspace_ref: String,
    pub file_kind: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub classification: &'static str,
    pub imported_at: String,
    /// v20: ما قاله فحص المحتوى (`intake::inspect`). فراغها في صفوف ما قبل v20.
    pub family: Option<String>,
    pub mime_type: Option<String>,
    pub content_check: Option<String>,
    pub model_access: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentError {
    NameRejected(String),
    TooLarge(usize),
    Executable(String),
    /// الاسم يدّعي صيغة والمحتوى غيرها.
    Spoofed { claimed: &'static str, detected: &'static str },
    NotFound,
    AlreadyBound,
    TooMany,
    Storage(String),
}

impl std::fmt::Display for AttachmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NameRejected(why) => write!(f, "the file name was rejected: {why}"),
            Self::TooLarge(n) => write!(f, "{n} bytes exceed the attachment limit"),
            Self::Executable(ext) => write!(f, ".{ext} files are not accepted as attachments"),
            Self::Spoofed { claimed, detected } => write!(f, "the file claims to be {claimed} but its content is {detected}"),
            Self::NotFound => write!(f, "no such attachment"),
            Self::AlreadyBound => write!(f, "the attachment already belongs to a mission"),
            Self::TooMany => write!(f, "the mission holds the maximum number of attachments"),
            Self::Storage(e) => write!(f, "attachment storage failed: {e}"),
        }
    }
}

fn storage(e: impl std::fmt::Display) -> AttachmentError {
    AttachmentError::Storage(e.to_string())
}

/// اسم ملف آمن: المقطع الأخير وحده، بعد قواعد ويندوز.
pub fn clean_name(name: &str) -> Result<String, AttachmentError> {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("").trim().to_string();
    let segments = normalise_relative(&last).map_err(|e| AttachmentError::NameRejected(e.to_string()))?;
    let clean = segments.join("");
    if clean.chars().count() > 200 {
        return Err(AttachmentError::NameRejected("the name is longer than 200 characters".into()));
    }
    Ok(clean)
}

pub struct AttachmentService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    staging_root: PathBuf,
    workspaces: WorkspaceRoot,
}

impl AttachmentService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock, staging_root: PathBuf, workspaces: WorkspaceRoot) -> Self {
        Self { db, audit, clock, staging_root, workspaces }
    }

    /// يستقبل ملفًا في منطقة الانتظار. لا مهمّة بعد.
    pub fn stage(&self, file_name: &str, bytes: &[u8]) -> Result<AttachmentView, AttachmentError> {
        let name = clean_name(file_name)?;
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(AttachmentError::TooLarge(bytes.len()));
        }
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        if EXECUTABLE.contains(&ext.as_str()) || bytes.starts_with(b"MZ") {
            return Err(AttachmentError::Executable(if ext.is_empty() { "binary".into() } else { ext }));
        }
        // الامتداد لا يُصدَّق وحده: التوقيع يقرّر الصيغة، والمخادع يُرفض قبل أن يُكتب شيء.
        let inspection = match inspect(&name, bytes) {
            Ok(found) => found,
            Err(s) => {
                // الرفض يُسجَّل بسببه في دفتر التدقيق: الحدّ لا يحمل نصًّا حرًّا، والتدقيق يقول لماذا.
                let _ = self.audit.append(&AuditRecord::new(
                    AuditEventType::AttachmentImported,
                    "attachment",
                    "refused",
                    AuditOutcome::Denied,
                    serde_json::json!({ "stage": "REFUSED", "reason": "SPOOFED", "claimed": s.claimed, "detected": s.detected, "size": bytes.len() }),
                ));
                return Err(AttachmentError::Spoofed { claimed: s.claimed, detected: s.detected });
            }
        };
        let attachment_id = self.clock.id();
        let staging_id = self.clock.id();
        let dir = self.staging_root.join(&staging_id);
        std::fs::create_dir_all(&dir).map_err(storage)?;
        std::fs::write(dir.join(&name), bytes).map_err(storage)?;
        let sha = crate::digest::sha256_hex(bytes);
        let kind = FileKind::from_name(&name).as_str();
        let now = self.clock.now();
        self.db
            .with(|conn| {
                conn.execute(
                    "INSERT INTO p08_attachments (attachment_id, mission_id, staging_id, file_name, workspace_ref, file_kind, size_bytes, sha256, classification, imported_at, family, mime_type, content_check, model_access) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 'USER_PROVIDED_UNTRUSTED', ?8, ?9, ?10, ?11, ?12)",
                    params![
                        attachment_id,
                        staging_id,
                        name,
                        format!("staging/{name}"),
                        kind,
                        bytes.len() as i64,
                        sha,
                        now,
                        inspection.family.as_str(),
                        inspection.mime_type,
                        inspection.content_check.as_str(),
                        inspection.model_access.as_str()
                    ],
                )?;
                Ok(())
            })
            .map_err(storage)?;
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::AttachmentImported,
            "attachment",
            &attachment_id,
            AuditOutcome::Success,
            serde_json::json!({ "kind": kind, "family": inspection.family.as_str(), "mime": inspection.mime_type, "content_check": inspection.content_check.as_str(), "size": bytes.len(), "sha256": sha, "stage": "STAGED" }),
        ));
        self.get(&attachment_id)?.ok_or(AttachmentError::NotFound)
    }

    /// يربط مرفقات منتظرة بمهمّة: تُنسخ إلى `inputs/` في مساحتها، بأسماء لا تتصادم.
    pub fn bind(&self, mission_id: &str, attachment_ids: &[String]) -> Result<Vec<AttachmentView>, AttachmentError> {
        let workspace = self.workspaces.for_mission(mission_id).map_err(storage)?;
        let existing = self.list(Some(mission_id))?.len();
        if existing + attachment_ids.len() > MAX_ATTACHMENTS_PER_MISSION {
            return Err(AttachmentError::TooMany);
        }
        let mut out = Vec::new();
        for id in attachment_ids {
            let view = self.get(id)?.ok_or(AttachmentError::NotFound)?;
            if view.mission_id.is_some() {
                return Err(AttachmentError::AlreadyBound);
            }
            let staging_id: String = self.db.with(|c| Ok(c.query_row("SELECT staging_id FROM p08_attachments WHERE attachment_id = ?1", params![id], |r| r.get(0))?)).map_err(storage)?;
            let source = self.staging_root.join(&staging_id).join(&view.file_name);
            let bytes = std::fs::read(&source).map_err(storage)?;
            // اسم فريد داخل inputs/: الاسم نفسه، أو الاسم مع رقم.
            let mut target = format!("{INPUTS}/{}", view.file_name);
            let mut n = 2;
            while workspace.root().join(&target).exists() {
                let (stem, ext) = view.file_name.rsplit_once('.').map(|(s, e)| (s.to_string(), format!(".{e}"))).unwrap_or((view.file_name.clone(), String::new()));
                target = format!("{INPUTS}/{stem} ({n}){ext}");
                n += 1;
            }
            workspace.write_runtime(INPUTS, target.trim_start_matches(&format!("{INPUTS}/")), &bytes).map_err(storage)?;
            self.db
                .with(|conn| {
                    conn.execute("UPDATE p08_attachments SET mission_id = ?1, workspace_ref = ?2 WHERE attachment_id = ?3 AND mission_id IS NULL", params![mission_id, target, id])?;
                    Ok(())
                })
                .map_err(storage)?;
            let _ = std::fs::remove_dir_all(self.staging_root.join(&staging_id));
            let _ = self.audit.append(&AuditRecord::new(
                AuditEventType::AttachmentImported,
                "attachment",
                id,
                AuditOutcome::Success,
                serde_json::json!({ "mission_id": mission_id, "stage": "BOUND", "sha256": view.sha256 }),
            ));
            out.push(self.get(id)?.ok_or(AttachmentError::NotFound)?);
        }
        Ok(out)
    }

    /// يحذف مرفقًا لم يُربط بعد. المرفق المربوط جزء من المهمّة ويبقى.
    pub fn discard(&self, attachment_id: &str) -> Result<bool, AttachmentError> {
        let Some(view) = self.get(attachment_id)? else { return Err(AttachmentError::NotFound) };
        if view.mission_id.is_some() {
            return Err(AttachmentError::AlreadyBound);
        }
        let staging_id: String = self.db.with(|c| Ok(c.query_row("SELECT staging_id FROM p08_attachments WHERE attachment_id = ?1", params![attachment_id], |r| r.get(0))?)).map_err(storage)?;
        let _ = std::fs::remove_dir_all(self.staging_root.join(staging_id));
        self.db.with(|c| Ok(c.execute("DELETE FROM p08_attachments WHERE attachment_id = ?1 AND mission_id IS NULL", params![attachment_id])? > 0)).map_err(storage)
    }

    fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<AttachmentView> {
        Ok(AttachmentView {
            attachment_id: r.get(0)?,
            mission_id: r.get(1)?,
            file_name: r.get(2)?,
            workspace_ref: r.get(3)?,
            file_kind: r.get(4)?,
            size_bytes: r.get::<_, i64>(5)? as u64,
            sha256: r.get(6)?,
            classification: "USER_PROVIDED_UNTRUSTED",
            imported_at: r.get(7)?,
            family: r.get(8)?,
            mime_type: r.get(9)?,
            content_check: r.get(10)?,
            model_access: r.get(11)?,
        })
    }

    pub fn get(&self, attachment_id: &str) -> Result<Option<AttachmentView>, AttachmentError> {
        use rusqlite::OptionalExtension;
        self.db
            .with(|c| Ok(c.query_row("SELECT attachment_id, mission_id, file_name, workspace_ref, file_kind, size_bytes, sha256, imported_at, family, mime_type, content_check, model_access FROM p08_attachments WHERE attachment_id = ?1", params![attachment_id], Self::row).optional()?))
            .map_err(storage)
    }

    /// مرفقات مهمّة، أو المرفقات المنتظرة حين لا تُسمّى مهمّة.
    pub fn list(&self, mission_id: Option<&str>) -> Result<Vec<AttachmentView>, AttachmentError> {
        self.db
            .with(|c| {
                let (sql, arg): (&str, Option<&str>) = match mission_id {
                    Some(m) => ("SELECT attachment_id, mission_id, file_name, workspace_ref, file_kind, size_bytes, sha256, imported_at, family, mime_type, content_check, model_access FROM p08_attachments WHERE mission_id = ?1 ORDER BY imported_at", Some(m)),
                    None => ("SELECT attachment_id, mission_id, file_name, workspace_ref, file_kind, size_bytes, sha256, imported_at, family, mime_type, content_check, model_access FROM p08_attachments WHERE mission_id IS NULL ORDER BY imported_at", None),
                };
                let mut stmt = c.prepare(sql)?;
                let rows = match arg {
                    Some(m) => stmt.query_map(params![m], Self::row)?.collect::<Result<Vec<_>, _>>()?,
                    None => stmt.query_map([], Self::row)?.collect::<Result<Vec<_>, _>>()?,
                };
                Ok(rows)
            })
            .map_err(|e: StorageError| storage(e))
    }
}

/// أقصى عدد صور تُعطى للنموذج في نداء واحد، وأقصى حجم لكل صورة (أصغر حدّ موثّق بين المزوّدين: 5 MiB لصورة في Anthropic).
pub const MAX_MODEL_IMAGES: usize = 8;
pub const MAX_MODEL_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

/// صور المرفقات لنموذج يرى (مكافأة Manus، 2026-10-19). تُقرأ من `inputs/` في مساحة المهمّة، ويُعاد فحص توقيعها عند القراءة:
/// ملف تغيّر بعد ربطه أو صفّ من قبل v20 لا يُعطى صورةً إلا إن قال محتواه ذلك الآن.
pub struct AttachmentImages {
    pub attachments: Arc<AttachmentService>,
    pub workspaces: WorkspaceRoot,
}

impl crate::p03::port::MissionImageSource for AttachmentImages {
    fn images_for(&self, mission_id: &str) -> Vec<crate::p03::port::MissionImage> {
        let Ok(list) = self.attachments.list(Some(mission_id)) else { return Vec::new() };
        let Ok(workspace) = self.workspaces.for_mission(mission_id) else { return Vec::new() };
        list.into_iter()
            .filter(|a| a.size_bytes <= MAX_MODEL_IMAGE_BYTES && a.model_access.as_deref().is_none_or(|m| m == "IMAGE_INPUT"))
            .filter_map(|a| {
                let bytes = workspace.read(&a.workspace_ref, MAX_MODEL_IMAGE_BYTES).ok()?;
                let found = inspect(&a.file_name, &bytes).ok()?;
                (found.model_access == super::intake::ModelAccess::ImageInput).then(|| crate::p03::port::MissionImage { path: a.workspace_ref.clone(), media_type: found.mime_type.to_string(), bytes })
            })
            .take(MAX_MODEL_IMAGES)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> (AttachmentService, PathBuf) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let base = crate::test_scratch::root().join(format!("att-{}", crate::ids::new_uuid_v4()));
        let s = AttachmentService::new(db, audit, RuntimeClock::system(), base.join("staging"), WorkspaceRoot::new(base.join("workspaces")));
        (s, base)
    }

    #[test]
    fn a_path_never_crosses_only_the_last_name_is_kept() {
        assert_eq!(clean_name("C:\\Users\\me\\Documents\\report.docx").unwrap(), "report.docx");
        assert_eq!(clean_name("/home/me/تقرير.pdf").unwrap(), "تقرير.pdf");
        assert!(clean_name("..").is_err());
        assert!(clean_name("CON.txt").is_err());
        assert!(clean_name("a:b.txt").is_err());
    }

    #[test]
    fn staged_files_bind_into_inputs_with_unique_names_and_executables_are_refused() {
        let (s, base) = service();
        let a = s.stage("C:\\secret\\path\\data.csv", b"a,b\n1,2\n").unwrap();
        let b = s.stage("data.csv", b"x\n").unwrap();
        assert!(!a.workspace_ref.contains("secret"), "a user path leaked: {}", a.workspace_ref);
        assert!(matches!(s.stage("tool.exe", b"MZ.."), Err(AttachmentError::Executable(_))));
        assert!(matches!(s.stage("renamed.txt", b"MZ\x90\x00"), Err(AttachmentError::Executable(_))));
        // مكافأة Manus (2026-10-19): صورة لُصقت تُفحص بتوقيعها، وملف PDF باسم صورة يُرفض.
        let image = s.stage("pasted-image-20261019-190507.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\x01\xe0\0\0\x01\x40\x08\x02\0\0\0").unwrap();
        assert_eq!((image.family.as_deref(), image.mime_type.as_deref(), image.content_check.as_deref(), image.model_access.as_deref()), (Some("IMAGE"), Some("image/png"), Some("MATCHED"), Some("IMAGE_INPUT")));
        assert!(matches!(s.stage("photo.png", b"%PDF-1.7"), Err(AttachmentError::Spoofed { detected: "PDF", .. })));
        assert!(s.discard(&image.attachment_id).unwrap());
        let mission = crate::ids::new_uuid_v4();
        let bound = s.bind(&mission, &[a.attachment_id.clone(), b.attachment_id.clone()]).unwrap();
        assert_eq!(bound[0].workspace_ref, "inputs/data.csv");
        assert_eq!(bound[1].workspace_ref, "inputs/data (2).csv");
        assert!(matches!(s.bind(&mission, std::slice::from_ref(&a.attachment_id)), Err(AttachmentError::AlreadyBound)));
        assert!(matches!(s.discard(&a.attachment_id), Err(AttachmentError::AlreadyBound)));
        let ws = base.join("workspaces").join(&mission).join("inputs");
        assert_eq!(std::fs::read(ws.join("data.csv")).unwrap(), b"a,b\n1,2\n");
        // الصورة المربوطة تصل مصدر الصور، والنصّ لا يصله.
        let pic = s.stage("shot.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x10\0\0\0\x10\x08\x02\0\0\0").unwrap();
        let pictures = crate::ids::new_uuid_v4();
        s.bind(&pictures, std::slice::from_ref(&pic.attachment_id)).unwrap();
        let source = AttachmentImages { attachments: Arc::new(s), workspaces: WorkspaceRoot::new(base.join("workspaces")) };
        let images = crate::p03::port::MissionImageSource::images_for(&source, &pictures);
        assert_eq!(images.iter().map(|i| (i.path.as_str(), i.media_type.as_str())).collect::<Vec<_>>(), vec![("inputs/shot.png", "image/png")]);
        let _ = std::fs::remove_dir_all(base);
    }
}
