// هوية الجهاز وقابلية نقل مساحات العمل: أساس لتعدّد الأجهزة دون مزامنة سحابية.
//
// الجهاز يحمل معرّفًا ثابتًا يُنشأ مرة واحدة. تصدير مساحة مهمّة ينتج حزمة ZIP ببيان (معرّف
// الجهاز، والمهمّة، وبصمة كل ملف)؛ والاستيراد يتحقّق من البيان والبصمات ثم يفكّ الملفات في
// مجلد استيراد جديد، ولا يلمس مهمّة قائمة ولا قاعدة البيانات. لا يُدّعى هنا دعم تعدّد أجهزة كامل.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

use super::super::artifacts::zip::{read_zip, write_zip};
use super::super::workspace::{normalise_relative, WorkspaceRoot, MAX_FILE_BYTES};

pub const BUNDLE_FORMAT: &str = "polaris.workspace.bundle.v1";

pub struct DeviceService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    workspaces: WorkspaceRoot,
    imports_root: PathBuf,
}

impl DeviceService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock, workspaces: WorkspaceRoot, imports_root: PathBuf) -> Self {
        Self { db, audit, clock, workspaces, imports_root }
    }

    /// معرّف هذا الجهاز، يُنشأ عند أول سؤال ثم يبقى.
    pub fn identity(&self) -> Result<(String, String), String> {
        let existing: Option<(String, String)> = self
            .db
            .with(|c| Ok(c.query_row("SELECT device_id, created_at FROM p08_device WHERE singleton = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).optional()?))
            .map_err(|e| e.to_string())?;
        if let Some(found) = existing {
            return Ok(found);
        }
        let id = self.clock.id();
        let now = self.clock.now();
        self.db
            .with(|c| Ok(c.execute("INSERT OR IGNORE INTO p08_device (singleton, device_id, created_at) VALUES (1, ?1, ?2)", params![id, now])?))
            .map_err(|e| e.to_string())?;
        self.identity()
    }

    /// يصدّر مساحة مهمّة (inputs/work/outputs) حزمةً واحدة. منطقة زمن التشغيل لا تُصدَّر.
    pub fn export_workspace(&self, mission_id: &str) -> Result<Vec<u8>, String> {
        let (device_id, _) = self.identity()?;
        let ws = self.workspaces.for_mission(mission_id).map_err(|e| e.to_string())?;
        let mut entries = Vec::new();
        let mut files = Vec::new();
        // ملف الطُعم (ADR-041) شأن هذا المضيف وحده: لا يُصدَّر إلى جهاز آخر.
        for e in ws.list(None, 12).map_err(|e| e.to_string())?.into_iter().filter(|e| !e.is_dir && e.path != crate::p03::security::HONEYTOKEN_PATH) {
            let bytes = ws.read(&e.path, MAX_FILE_BYTES).map_err(|e| e.to_string())?;
            files.push(json!({ "path": e.path, "sha256": crate::digest::sha256_hex(&bytes), "size": bytes.len() }));
            entries.push((format!("files/{}", e.path), bytes));
        }
        let manifest = json!({ "format": BUNDLE_FORMAT, "device_id": device_id, "mission_id": mission_id, "exported_at": self.clock.now(), "files": files });
        let mut all = vec![("manifest.json".to_string(), serde_json::to_vec_pretty(&manifest).unwrap_or_default())];
        all.extend(entries);
        let bytes = write_zip(&all).map_err(|e| e.to_string())?;
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::DeviceBundleExported, "mission", mission_id, AuditOutcome::Success, json!({ "files": all.len() - 1, "bytes": bytes.len() })));
        Ok(bytes)
    }

    /// يستورد حزمة بعد التحقق من كل بصمة. يعيد مجلد الاستيراد النسبي وعدد الملفات.
    pub fn import_workspace(&self, bundle: &[u8]) -> Result<(String, usize, Value), String> {
        let entries = read_zip(bundle).map_err(|e| e.to_string())?;
        let manifest: Value = entries.iter().find(|e| e.name == "manifest.json").and_then(|e| serde_json::from_slice(&e.data).ok()).ok_or("the bundle has no manifest")?;
        if manifest.get("format").and_then(Value::as_str) != Some(BUNDLE_FORMAT) {
            return Err("the bundle format is not supported".into());
        }
        let listed = manifest.get("files").and_then(Value::as_array).ok_or("the manifest lists no files")?;
        if entries.len() != listed.len() + 1 {
            return Err("the bundle holds files the manifest does not list".into());
        }
        let import_id = self.clock.id();
        let root = self.imports_root.join(&import_id);
        for item in listed {
            let path = item.get("path").and_then(Value::as_str).ok_or("a manifest entry has no path")?;
            let segments = normalise_relative(path).map_err(|e| e.to_string())?;
            let entry = entries.iter().find(|e| e.name == format!("files/{path}")).ok_or("a listed file is missing")?;
            if item.get("sha256").and_then(Value::as_str) != Some(crate::digest::sha256_hex(&entry.data).as_str()) {
                return Err(format!("{path} does not match its recorded digest"));
            }
            let target: PathBuf = segments.iter().fold(root.clone(), |p, s| p.join(s));
            write_under(&root, &target, &entry.data)?;
        }
        let summary = json!({ "source_device_id": manifest.get("device_id"), "source_mission_id": manifest.get("mission_id") });
        Ok((format!("imports/{import_id}"), listed.len(), summary))
    }
}

fn write_under(root: &Path, target: &Path, bytes: &[u8]) -> Result<(), String> {
    if !target.starts_with(root) {
        return Err("a path escaped the import folder".into());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(target, bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_workspace_round_trips_through_a_verified_bundle_and_a_tampered_one_is_refused() {
        let db = Arc::new(Database::in_memory().unwrap());
        let base = crate::test_scratch::root().join(format!("dev-{}", crate::ids::new_uuid_v4()));
        let ws = WorkspaceRoot::new(base.join("workspaces"));
        let s = DeviceService::new(db.clone(), Arc::new(AuditLedger::new(db)), RuntimeClock::system(), ws.clone(), base.join("imports"));
        let (id1, _) = s.identity().unwrap();
        assert_eq!(s.identity().unwrap().0, id1, "the device identity changed");
        let mission = crate::ids::new_uuid_v4();
        ws.for_mission(&mission).unwrap().write("outputs/report.md", b"# report").unwrap();
        let bundle = s.export_workspace(&mission).unwrap();
        let (folder, count, _) = s.import_workspace(&bundle).unwrap();
        assert_eq!(count, 1);
        assert_eq!(std::fs::read(base.join(&folder).join("outputs").join("report.md")).unwrap(), b"# report");
        let mut tampered = bundle.clone();
        let pos = tampered.windows(8).position(|w| w == b"# report").unwrap();
        tampered[pos] = b'!';
        assert!(s.import_workspace(&tampered).is_err());
        let _ = std::fs::remove_dir_all(base);
    }
}
