// فتح القاعدة، وضبطها، والوصول المتسلسل إليها.
//
// اتصال واحد خلف قفل: الكتابات قليلة وقصيرة، والتسلسل يجعل الذرّية واضحة بلا
// تجمّع اتصالات. كل كتابة متعددة الخطوات تمرّ داخل معاملة.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};

use super::lock::InstanceLock;
use super::migrations;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    /// القاعدة أحدث من هذا البناء. لا قراءة ولا كتابة.
    SchemaTooNew { found: i64, supported: i64 },
    Open(String),
    Migration(String),
    Query(String),
    NotFound,
    Conflict,
    Invalid(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SchemaTooNew { found, supported } => write!(f, "database schema {found} is newer than supported {supported}"),
            Self::Open(e) => write!(f, "open: {e}"),
            Self::Migration(e) => write!(f, "migration: {e}"),
            Self::Query(e) => write!(f, "query: {e}"),
            Self::NotFound => f.write_str("not found"),
            Self::Conflict => f.write_str("version conflict"),
            Self::Invalid(e) => write!(f, "invalid: {e}"),
        }
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        match error {
            rusqlite::Error::QueryReturnedNoRows => Self::NotFound,
            other => Self::Query(other.to_string()),
        }
    }
}

pub struct Database {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
    /// قفل المثيل المشترك (Phase-07). يعيش ما عاشت القاعدة، فلا تستبدلها الصيانة تحتها.
    _instance: Option<InstanceLock>,
}

/// اسم ملف القاعدة داخل مجلد بيانات التطبيق.
pub const DATABASE_FILE: &str = "polaris.db";

impl Database {
    /// يفتح القاعدة في مجلد البيانات، ويطبّق الترحيلات بعد نسخ احتياطي.
    pub fn open(directory: &Path) -> Result<Self, StorageError> {
        let lock = InstanceLock::shared(directory).map_err(|e| StorageError::Open(e.to_string()))?;
        Self::open_with_lock(directory, lock)
    }

    /// يفتح القاعدة بقفل أخذه المستدعي. حارس الاسترداد يأخذ القفل قبل الفحص، ثم
    /// يسلّمه هنا، فلا تنفتح نافذة بين الفحص والفتح تستبدل فيها الصيانة الملف.
    pub fn open_with_lock(directory: &Path, lock: InstanceLock) -> Result<Self, StorageError> {
        std::fs::create_dir_all(directory).map_err(|e| StorageError::Open(e.to_string()))?;
        let path = directory.join(DATABASE_FILE);
        let existed = path.exists();
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| StorageError::Open(e.to_string()))?;
        // الإصدار يُقرأ قبل أي ضبط يكتب في الملف: قاعدة أحدث لا تُلمس إطلاقًا.
        let found = migrations::current_version(&conn)?;
        if found > migrations::SUPPORTED_VERSION {
            return Err(StorageError::SchemaTooNew { found, supported: migrations::SUPPORTED_VERSION });
        }
        configure(&conn, true)?;
        if existed && found > 0 && found < migrations::SUPPORTED_VERSION {
            backup(&conn, directory, found)?;
        }
        let mut conn = conn;
        migrations::apply(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn), path: Some(path), _instance: Some(lock) })
    }

    /// قاعدة في الذاكرة للاختبار وللحالة التي لا يُعرف فيها مجلد بيانات.
    pub fn in_memory() -> Result<Self, StorageError> {
        let mut conn = Connection::open_in_memory().map_err(|e| StorageError::Open(e.to_string()))?;
        configure(&conn, false)?;
        migrations::apply(&mut conn)?;
        Ok(Self { conn: Mutex::new(conn), path: None, _instance: None })
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// يدمج سجل الكتابة في الملف ويقصّه، عند الخروج النظيف (QA 2026-10-15، D-6). الإطار ينهي العملية
    /// بـ`process::exit` فلا يُسقط الاتصال، فكان كل شيء يبقى في `-wal` ويصير `polaris.db` وحده نسخة شبه
    /// فارغة لمن ينسخه. يعيد (مشغول، صفحات السجل، صفحات دُمجت) كما يعيدها SQLite.
    pub fn checkpoint(&self) -> Result<(i64, i64, i64), StorageError> {
        if self.path.is_none() {
            return Ok((0, 0, 0));
        }
        self.with(|c| Ok(c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?))
    }

    /// يعطي الاتصال لعمل قصير. القفل المسموم عيب داخلي لا يُتجاوز.
    pub fn with<T>(&self, work: impl FnOnce(&mut Connection) -> Result<T, StorageError>) -> Result<T, StorageError> {
        let mut guard = self.conn.lock().map_err(|_| StorageError::Query("database lock poisoned".into()))?;
        work(&mut guard)
    }
}

fn configure(conn: &Connection, on_disk: bool) -> Result<(), StorageError> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    if on_disk {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
    }
    Ok(())
}

/// نسخة احتياطية قبل الترحيل، بآلية SQLite نفسها لا بنسخ ملف مفتوح.
fn backup(conn: &Connection, directory: &Path, from_version: i64) -> Result<(), StorageError> {
    let target = directory.join(format!("{DATABASE_FILE}.backup-v{from_version}"));
    if target.exists() {
        return Ok(());
    }
    let quoted = target.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{quoted}'"))
        .map_err(|e| StorageError::Migration(format!("backup before migration failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_checkpoint_leaves_a_complete_main_file_that_can_be_copied_alone() {
        let dir = temp_dir("checkpoint");
        let db = Database::open(&dir).unwrap();
        db.with(|c| {
            c.execute_batch("CREATE TABLE qa_probe(x TEXT); INSERT INTO qa_probe VALUES ('kept');")?;
            Ok(())
        })
        .unwrap();
        db.checkpoint().unwrap();
        let copy = dir.join("copy-of-main-file-only.db");
        std::fs::copy(dir.join(DATABASE_FILE), &copy).unwrap();
        let alone = Connection::open(&copy).unwrap();
        let rows: i64 = alone.query_row("SELECT count(*) FROM qa_probe", [], |r| r.get(0)).unwrap_or(-1);
        assert_eq!(rows, 1, "the main file alone did not hold the committed row");
        let wal = std::fs::metadata(dir.join(format!("{DATABASE_FILE}-wal"))).map(|m| m.len()).unwrap_or(0);
        assert_eq!(wal, 0, "the write-ahead log was not truncated");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = crate::test_scratch::root().join(format!("db-{name}-{}-{}", std::process::id(), crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_fresh_database_is_migrated_to_the_supported_version() {
        let dir = temp_dir("fresh");
        let db = Database::open(&dir).unwrap();
        let version = db.with(|c| migrations::current_version(c)).unwrap();
        assert_eq!(version, migrations::SUPPORTED_VERSION);
        drop(db);
        // إعادة الفتح لا تعيد الترحيل ولا تكسر شيئًا.
        let again = Database::open(&dir).unwrap();
        assert_eq!(again.with(|c| migrations::current_version(c)).unwrap(), migrations::SUPPORTED_VERSION);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_schema_fails_closed_and_is_left_untouched() {
        let dir = temp_dir("newer");
        {
            let conn = Connection::open(dir.join(DATABASE_FILE)).unwrap();
            conn.execute_batch("CREATE TABLE future_data (x INTEGER); INSERT INTO future_data VALUES (7);").unwrap();
            conn.pragma_update(None, "user_version", migrations::SUPPORTED_VERSION + 5).unwrap();
        }
        let error = Database::open(&dir).err().unwrap();
        assert!(matches!(error, StorageError::SchemaTooNew { .. }), "{error:?}");
        let conn = Connection::open(dir.join(DATABASE_FILE)).unwrap();
        let kept: i64 = conn.query_row("SELECT x FROM future_data", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 7, "data in a newer database was modified");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
