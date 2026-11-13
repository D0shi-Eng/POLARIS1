// فحص سلامة ملف القاعدة من خارج التطبيق وقبل فتحه للكتابة.
//
// الترتيب مقصود: ترويسة الملف أولًا بلا SQLite، فملف ليس قاعدة لا يُعطى لمحرّك
// قاعدة أصلًا. ثم فتح للقراءة وحدها، ثم الإصدار، ثم فحص الصفحات، ثم المفاتيح
// الأجنبية. لا شيء هنا يكتب في الملف.

use std::io::Read;
use std::path::Path;
use std::time::Instant;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::storage::migrations;

/// أول ستة عشر بايتًا في كل قاعدة SQLite.
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// أقصى عدد رسائل تُحفظ من فحص فاشل. الرسائل تصف صفحات لا محتوى.
const MAX_MESSAGES: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IntegrityState {
    /// الملف سليم بمخطط يفهمه هذا البناء.
    Healthy,
    /// ملف فارغ: SQLite يعامله قاعدة جديدة، والترحيل يبنيها.
    Empty,
    Missing,
    NotADatabase,
    Corrupt,
    SchemaTooNew,
    Unreadable,
}

impl IntegrityState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Healthy => "HEALTHY",
            Self::Empty => "EMPTY",
            Self::Missing => "MISSING",
            Self::NotADatabase => "NOT_A_DATABASE",
            Self::Corrupt => "CORRUPT",
            Self::SchemaTooNew => "SCHEMA_TOO_NEW",
            Self::Unreadable => "UNREADABLE",
        }
    }

    /// هل يُفتح الملف للتطبيق كما هو؟
    pub fn usable(self) -> bool {
        matches!(self, Self::Healthy | Self::Empty | Self::Missing)
    }

    /// هل الملف تالف على نحو يستدعي العزل والاسترداد؟ مخطط أحدث ليس تلفًا: يُترك كما هو.
    pub fn damaged(self) -> bool {
        matches!(self, Self::NotADatabase | Self::Corrupt)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckDepth {
    /// `PRAGMA quick_check`: خطيّ في حجم الملف، مناسب لكل إقلاع.
    Quick,
    /// `PRAGMA integrity_check`: يتحقق من الفهارس أيضًا، للصيانة والنسخ الاحتياطي.
    Full,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IntegrityReport {
    pub state: IntegrityState,
    pub depth: CheckDepth,
    pub schema_version: Option<i64>,
    pub foreign_key_violations: u64,
    pub messages: Vec<String>,
    pub bytes: u64,
    pub duration_us: u128,
}

fn report(state: IntegrityState, depth: CheckDepth, bytes: u64, started: Instant) -> IntegrityReport {
    IntegrityReport {
        state,
        depth,
        schema_version: None,
        foreign_key_violations: 0,
        messages: Vec::new(),
        bytes,
        duration_us: started.elapsed().as_micros(),
    }
}

fn has_sqlite_header(path: &Path) -> std::io::Result<bool> {
    let mut file = std::fs::File::open(path)?;
    let mut header = [0u8; 16];
    let mut read = 0;
    while read < header.len() {
        let n = file.read(&mut header[read..])?;
        if n == 0 {
            return Ok(false);
        }
        read += n;
    }
    Ok(&header == SQLITE_HEADER)
}

/// يفحص ملف قاعدة. لا يفتح الملف للكتابة ولا يرحّله.
pub fn check_file(path: &Path, depth: CheckDepth) -> IntegrityReport {
    let started = Instant::now();
    let bytes = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return report(IntegrityState::Missing, depth, 0, started),
        Err(_) => return report(IntegrityState::Unreadable, depth, 0, started),
    };
    if bytes == 0 {
        return report(IntegrityState::Empty, depth, 0, started);
    }
    match has_sqlite_header(path) {
        Ok(true) => {}
        Ok(false) => return report(IntegrityState::NotADatabase, depth, bytes, started),
        Err(_) => return report(IntegrityState::Unreadable, depth, bytes, started),
    }
    let conn = match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) {
        Ok(conn) => conn,
        Err(_) => return report(IntegrityState::Unreadable, depth, bytes, started),
    };
    let mut result = check_connection(&conn, depth);
    result.bytes = bytes;
    result.duration_us = started.elapsed().as_micros();
    result
}

/// يفحص اتصالًا مفتوحًا. يُستعمل للملف وللنسخة الاحتياطية بعد كتابتها.
pub fn check_connection(conn: &Connection, depth: CheckDepth) -> IntegrityReport {
    let started = Instant::now();
    let mut out = report(IntegrityState::Healthy, depth, 0, started);
    // ترويسة سليمة وجسد تالف: قراءة الإصدار نفسها قد تفشل.
    let version: i64 = match conn.query_row("PRAGMA user_version", [], |row| row.get(0)) {
        Ok(v) => v,
        Err(e) => {
            out.state = classify_sqlite_error(&e);
            out.messages.push(short(&e.to_string()));
            return out;
        }
    };
    out.schema_version = Some(version);
    let pragma = match depth {
        CheckDepth::Quick => "PRAGMA quick_check",
        CheckDepth::Full => "PRAGMA integrity_check",
    };
    let rows: Result<Vec<String>, rusqlite::Error> = conn
        .prepare(pragma)
        .and_then(|mut stmt| stmt.query_map([], |row| row.get::<_, String>(0))?.collect());
    match rows {
        Ok(lines) if lines.len() == 1 && lines[0] == "ok" => {}
        Ok(lines) => {
            out.state = IntegrityState::Corrupt;
            out.messages = lines.into_iter().take(MAX_MESSAGES).map(|l| short(&l)).collect();
            return out;
        }
        Err(e) => {
            out.state = classify_sqlite_error(&e);
            out.messages.push(short(&e.to_string()));
            return out;
        }
    }
    // المفاتيح الأجنبية: الصفحات سليمة لا تعني أن الصفوف متّسقة.
    let violations: Result<u64, rusqlite::Error> = conn
        .prepare("PRAGMA foreign_key_check")
        .and_then(|mut stmt| Ok(stmt.query_map([], |_| Ok(()))?.count() as u64));
    match violations {
        Ok(count) => {
            out.foreign_key_violations = count;
            if count > 0 {
                out.state = IntegrityState::Corrupt;
                out.messages.push(format!("{count} foreign key violation(s)"));
                return out;
            }
        }
        Err(e) => {
            out.state = classify_sqlite_error(&e);
            out.messages.push(short(&e.to_string()));
            return out;
        }
    }
    if version > migrations::SUPPORTED_VERSION {
        out.state = IntegrityState::SchemaTooNew;
    }
    out.duration_us = started.elapsed().as_micros();
    out
}

fn classify_sqlite_error(error: &rusqlite::Error) -> IntegrityState {
    match error {
        rusqlite::Error::SqliteFailure(failure, _) => match failure.code {
            rusqlite::ErrorCode::NotADatabase => IntegrityState::NotADatabase,
            rusqlite::ErrorCode::DatabaseCorrupt => IntegrityState::Corrupt,
            rusqlite::ErrorCode::CannotOpen | rusqlite::ErrorCode::PermissionDenied => IntegrityState::Unreadable,
            _ => IntegrityState::Corrupt,
        },
        _ => IntegrityState::Corrupt,
    }
}

/// رسالة مقصوصة: رسائل SQLite تذكر صفحات وجداول، ولا يُحفظ منها إلا بداية محدودة.
fn short(message: &str) -> String {
    message.chars().take(160).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = crate::test_scratch::root().join(format!("integrity-{name}-{}-{}", std::process::id(), crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_migrated_database_is_healthy_at_the_supported_version() {
        let dir = temp_dir("healthy");
        drop(crate::storage::Database::open(&dir).unwrap());
        let report = check_file(&dir.join("polaris.db"), CheckDepth::Full);
        assert_eq!(report.state, IntegrityState::Healthy, "{report:?}");
        assert_eq!(report.schema_version, Some(migrations::SUPPORTED_VERSION));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_without_the_sqlite_header_is_not_given_to_sqlite() {
        let dir = temp_dir("header");
        let path = dir.join("polaris.db");
        std::fs::write(&path, b"this is a text file pretending to be a store").unwrap();
        assert_eq!(check_file(&path, CheckDepth::Quick).state, IntegrityState::NotADatabase);
        assert_eq!(check_file(&dir.join("absent.db"), CheckDepth::Quick).state, IntegrityState::Missing);
        std::fs::write(&path, b"").unwrap();
        assert_eq!(check_file(&path, CheckDepth::Quick).state, IntegrityState::Empty);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_schema_is_reported_and_not_called_corrupt() {
        let dir = temp_dir("newer");
        let path = dir.join("polaris.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE t (x INTEGER);").unwrap();
            conn.pragma_update(None, "user_version", migrations::SUPPORTED_VERSION + 1).unwrap();
        }
        let report = check_file(&path, CheckDepth::Quick);
        assert_eq!(report.state, IntegrityState::SchemaTooNew);
        assert!(!report.state.damaged());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
