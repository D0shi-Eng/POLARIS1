// النسخ الاحتياطي المُتحقَّق منه.
//
// نسخة لا تُعدّ نسخة حتى تُقرأ بعد كتابتها: تُكتب في مجلد جزئي، وتُفحص سلامتها
// كاملة، وتُطابَق بصمة مخططها، ويُحسب خلاصتها، ثم يُكتب بيانها، ثم يُعاد تسمية
// المجلد دفعة واحدة. انهيار في المنتصف يترك مجلدًا جزئيًا لا يُعدّ ولا يُستعاد منه.
//
// النسخ يعمل والتطبيق يعمل: `VACUUM INTO` يقرأ لقطة متّسقة عبر سجل الكتابة
// المسبقة، فلا يحتاج قفلًا حصريًا. الاستعادة وحدها تحتاجه.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::storage::migrations;

use super::error::{MaintenanceError, MaintenanceResult};
use super::integrity::{check_connection, check_file, CheckDepth, IntegrityState};
use super::layout;
use super::schema;

/// صيغة البيان. تغيّرها يعني قارئًا جديدًا، لا تخمينًا.
pub const MANIFEST_FORMAT: &str = "polaris.backup/1";

/// حدّ حجم البيان: بيان أكبر ليس بيانًا كتبه المنتج.
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

/// سبب إنشاء النسخة. قائمة مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackupReason {
    Manual,
    PreRestore,
    PreUpgrade,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupManifest {
    pub format: String,
    pub backup_id: String,
    pub created_at: String,
    pub reason: BackupReason,
    pub schema_version: i64,
    pub schema_fingerprint: String,
    pub sha256: String,
    pub bytes: u64,
    pub product_version: String,
    /// عدد الصفوف في كل جدول: يثبت أن النسخة تحمل البيانات، ولا يحمل محتواها.
    pub tables: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupOutcome {
    pub manifest: BackupManifest,
    pub path: PathBuf,
    pub duration_ms: u128,
    pub pruned: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifiedBackup {
    pub manifest: BackupManifest,
    pub database: PathBuf,
    pub verify_ms: u128,
}

fn io(code: &'static str, e: impl std::fmt::Display) -> MaintenanceError {
    MaintenanceError::new(code, e.to_string())
}

/// عدد الصفوف في كل جدول يملكه المنتج.
pub fn table_counts(conn: &Connection) -> MaintenanceResult<BTreeMap<String, u64>> {
    let names: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
        .and_then(|mut stmt| stmt.query_map([], |row| row.get::<_, String>(0))?.collect())
        .map_err(|e| io("STORE_CORRUPT", e))?;
    let mut counts = BTreeMap::new();
    for name in names {
        // الاسم يأتي من المخطط نفسه لا من مدخل خارجي، ويُقتبس مع ذلك.
        let quoted = name.replace('"', "\"\"");
        let count: i64 = conn
            .query_row(&format!("SELECT count(*) FROM \"{quoted}\""), [], |row| row.get(0))
            .map_err(|e| io("STORE_CORRUPT", e))?;
        counts.insert(name, count.max(0) as u64);
    }
    Ok(counts)
}

/// خلاصة ملف بقراءة متدفّقة: قاعدة كبيرة لا تُحمَّل كلها في الذاكرة.
pub fn sha256_file(path: &Path) -> MaintenanceResult<(String, u64)> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| io("STORE_IO", e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buffer).map_err(|e| io("STORE_IO", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        total += n as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

/// ينشئ نسخة احتياطية مُتحقَّقًا منها من قاعدة مجلد البيانات.
pub fn create_backup(data_dir: &Path, reason: BackupReason, now: &str, keep: usize) -> MaintenanceResult<BackupOutcome> {
    let started = Instant::now();
    let source = layout::store_file(data_dir);
    let pre = check_file(&source, CheckDepth::Quick);
    match pre.state {
        IntegrityState::Healthy => {}
        IntegrityState::Missing | IntegrityState::Empty => {
            return Err(MaintenanceError::new("STORE_MISSING", "there is no store to back up"))
        }
        IntegrityState::SchemaTooNew => {
            return Err(MaintenanceError::new("STORE_SCHEMA_TOO_NEW", "the store is newer than this build"))
        }
        IntegrityState::NotADatabase => return Err(MaintenanceError::new("STORE_NOT_A_DATABASE", "the store is not a database")),
        IntegrityState::Corrupt => return Err(MaintenanceError::new("STORE_CORRUPT", "a damaged store is not backed up")),
        IntegrityState::Unreadable => return Err(MaintenanceError::new("STORE_IO", "the store cannot be read")),
    }
    let backups = data_dir.join(layout::BACKUPS_DIR);
    std::fs::create_dir_all(&backups).map_err(|e| io("BACKUP_FAILED", e))?;
    if layout::is_link(&backups) {
        return Err(MaintenanceError::new("BACKUP_PATH_REFUSED", "the backups folder is a link"));
    }
    let backup_id = layout::new_backup_id(now);
    let partial = backups.join(format!(".partial-{backup_id}"));
    std::fs::create_dir_all(&partial).map_err(|e| io("BACKUP_FAILED", e))?;
    let result = write_partial(&source, &partial, &backup_id, reason, now);
    let manifest = match result {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&partial);
            return Err(error);
        }
    };
    let final_dir = backups.join(&backup_id);
    std::fs::rename(&partial, &final_dir).map_err(|e| {
        let _ = std::fs::remove_dir_all(&partial);
        io("BACKUP_FAILED", e)
    })?;
    let pruned = prune_backups(data_dir, keep)?;
    Ok(BackupOutcome { manifest, path: final_dir, duration_ms: started.elapsed().as_millis(), pruned })
}

fn write_partial(source: &Path, partial: &Path, backup_id: &str, reason: BackupReason, now: &str) -> MaintenanceResult<BackupManifest> {
    let target = partial.join(layout::BACKUP_DB_FILE);
    {
        let conn = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .map_err(|e| io("STORE_IO", e))?;
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| io("STORE_IO", e))?;
        // المسار يُمرَّر وسيطًا مربوطًا لا نصًّا مركّبًا: لا اقتباس يُخطئ.
        conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()]).map_err(|e| io("BACKUP_FAILED", e))?;
    }
    let copy = Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| io("BACKUP_FAILED", e))?;
    let check = check_connection(&copy, CheckDepth::Full);
    if check.state != IntegrityState::Healthy {
        return Err(MaintenanceError::new("BACKUP_FAILED", format!("the written copy is {}", check.state.as_str())));
    }
    let schema_version = schema::verify_schema(&copy)?;
    let schema_fingerprint = schema::fingerprint(&copy)?;
    let tables = table_counts(&copy)?;
    drop(copy);
    let (sha256, bytes) = sha256_file(&target)?;
    let manifest = BackupManifest {
        format: MANIFEST_FORMAT.into(),
        backup_id: backup_id.into(),
        created_at: now.into(),
        reason,
        schema_version,
        schema_fingerprint,
        sha256,
        bytes,
        product_version: env!("CARGO_PKG_VERSION").into(),
        tables,
    };
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| io("BACKUP_FAILED", e))?;
    std::fs::write(partial.join(layout::BACKUP_MANIFEST_FILE), format!("{text}\n")).map_err(|e| io("BACKUP_FAILED", e))?;
    Ok(manifest)
}

/// يقرأ بيانًا بحدّ حجم وصيغة صارمة.
pub fn read_manifest(path: &Path) -> MaintenanceResult<BackupManifest> {
    if layout::is_link(path) {
        return Err(MaintenanceError::new("BACKUP_PATH_REFUSED", "the manifest is a link"));
    }
    let meta = std::fs::metadata(path).map_err(|e| io("BACKUP_NOT_FOUND", e))?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err(MaintenanceError::new("BACKUP_MANIFEST_INVALID", "the manifest is larger than any the product writes"));
    }
    let text = std::fs::read_to_string(path).map_err(|e| io("BACKUP_MANIFEST_INVALID", e))?;
    let manifest: BackupManifest = serde_json::from_str(&text).map_err(|e| io("BACKUP_MANIFEST_INVALID", e))?;
    if manifest.format != MANIFEST_FORMAT {
        return Err(MaintenanceError::new("BACKUP_MANIFEST_INVALID", format!("unknown format {}", manifest.format)));
    }
    if !layout::is_backup_id(&manifest.backup_id) {
        return Err(MaintenanceError::new("BACKUP_MANIFEST_INVALID", "the backup id is not a product backup id"));
    }
    if manifest.sha256.len() != 64 || !manifest.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(MaintenanceError::new("BACKUP_MANIFEST_INVALID", "the digest is not a SHA-256"));
    }
    Ok(manifest)
}

/// يتحقق من نسخة كاملة: المسار، والبيان، والخلاصة، والسلامة، والمخطط.
pub fn verify_backup(data_dir: &Path, backup_id: &str) -> MaintenanceResult<VerifiedBackup> {
    let started = Instant::now();
    let dir = layout::backup_dir(data_dir, backup_id)
        .ok_or_else(|| MaintenanceError::new("BACKUP_PATH_REFUSED", "not a product backup id"))?;
    if !dir.exists() {
        return Err(MaintenanceError::new("BACKUP_NOT_FOUND", backup_id.to_string()));
    }
    let backups_root = data_dir.join(layout::BACKUPS_DIR);
    if layout::is_link(&backups_root) || layout::is_link(&dir) || !layout::resolves_inside(&backups_root, &dir) {
        return Err(MaintenanceError::new("BACKUP_PATH_REFUSED", "the backup folder is a link or leaves the data folder"));
    }
    let manifest = read_manifest(&dir.join(layout::BACKUP_MANIFEST_FILE))?;
    if manifest.backup_id != backup_id {
        return Err(MaintenanceError::new("BACKUP_MANIFEST_INVALID", "the manifest names another backup"));
    }
    let database = dir.join(layout::BACKUP_DB_FILE);
    if layout::is_link(&database) || !layout::resolves_inside(&dir, &database) {
        return Err(MaintenanceError::new("BACKUP_PATH_REFUSED", "the backup file is a link"));
    }
    let (sha256, bytes) = sha256_file(&database).map_err(|e| MaintenanceError::new("BACKUP_NOT_FOUND", e.detail))?;
    if sha256 != manifest.sha256 || bytes != manifest.bytes {
        return Err(MaintenanceError::new("BACKUP_DIGEST_MISMATCH", "the backup file is not the file its manifest describes"));
    }
    let report = check_file(&database, CheckDepth::Full);
    match report.state {
        IntegrityState::Healthy => {}
        IntegrityState::SchemaTooNew => {
            return Err(MaintenanceError::new("STORE_SCHEMA_TOO_NEW", "the backup is newer than this build"))
        }
        other => return Err(MaintenanceError::new("STORE_CORRUPT", format!("the backup is {}", other.as_str()))),
    }
    let conn = Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| io("STORE_IO", e))?;
    let version = schema::verify_schema(&conn)?;
    if version != manifest.schema_version || schema::fingerprint(&conn)? != manifest.schema_fingerprint {
        return Err(MaintenanceError::new("BACKUP_SCHEMA_MISMATCH", "the manifest and the file disagree on the schema"));
    }
    if version > migrations::SUPPORTED_VERSION {
        return Err(MaintenanceError::new("STORE_SCHEMA_TOO_NEW", "the backup is newer than this build"));
    }
    Ok(VerifiedBackup { manifest, database, verify_ms: started.elapsed().as_millis() })
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupEntry {
    pub backup_id: String,
    pub created_at: Option<String>,
    pub reason: Option<BackupReason>,
    pub schema_version: Option<i64>,
    pub bytes: Option<u64>,
    /// حالة البيان وحدها. التحقق الكامل يطلب `verify_backup`.
    pub manifest_state: &'static str,
}

/// النسخ الموجودة، الأحدث أولًا. المجلدات الجزئية وما لا يطابق اسمه النمط لا تُعدّ.
pub fn list_backups(data_dir: &Path) -> MaintenanceResult<Vec<BackupEntry>> {
    let root = data_dir.join(layout::BACKUPS_DIR);
    let Ok(entries) = std::fs::read_dir(&root) else { return Ok(Vec::new()) };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !layout::is_backup_id(&name) {
            continue;
        }
        let manifest = read_manifest(&entry.path().join(layout::BACKUP_MANIFEST_FILE));
        found.push(match manifest {
            Ok(m) => BackupEntry {
                backup_id: name,
                created_at: Some(m.created_at),
                reason: Some(m.reason),
                schema_version: Some(m.schema_version),
                bytes: Some(m.bytes),
                manifest_state: "READABLE",
            },
            Err(_) => BackupEntry { backup_id: name, created_at: None, reason: None, schema_version: None, bytes: None, manifest_state: "INVALID" },
        });
    }
    // المعرّف يبدأ بالختم الزمني، فترتيبه ترتيب زمني.
    found.sort_by(|a, b| b.backup_id.cmp(&a.backup_id));
    Ok(found)
}

/// أحدث نسخة تجتاز التحقق الكامل، إن وُجدت.
pub fn latest_verified(data_dir: &Path) -> MaintenanceResult<Option<VerifiedBackup>> {
    for entry in list_backups(data_dir)? {
        if let Ok(verified) = verify_backup(data_dir, &entry.backup_id) {
            return Ok(Some(verified));
        }
    }
    Ok(None)
}

/// يبقي أحدث `keep` نسخة ويحذف الأقدم، ويحذف المجلدات الجزئية المتروكة.
/// لا يحذف آخر نسخة أبدًا، ولا يتبع رابطًا.
pub fn prune_backups(data_dir: &Path, keep: usize) -> MaintenanceResult<Vec<String>> {
    let keep = keep.max(1);
    let root = data_dir.join(layout::BACKUPS_DIR);
    let mut removed = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(".partial-polaris-backup-") && !layout::is_link(&entry.path()) && std::fs::remove_dir_all(entry.path()).is_ok() {
                removed.push(name);
            }
        }
    }
    for entry in list_backups(data_dir)?.into_iter().skip(keep) {
        let Some(dir) = layout::backup_dir(data_dir, &entry.backup_id) else { continue };
        if layout::is_link(&dir) || !layout::resolves_inside(&root, &dir) {
            continue;
        }
        std::fs::remove_dir_all(&dir).map_err(|e| io("RETENTION_INVALID", e))?;
        removed.push(entry.backup_id);
    }
    Ok(removed)
}
