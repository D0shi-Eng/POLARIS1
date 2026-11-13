// استمرار جلسات المتصفّح وأفعالها وتنزيلاتها. بصمات وعناوين وحالات، لا محتوى صفحات.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;

use crate::storage::{Database, StorageError};

/// صفّ جلسة كما يُحفظ ويُعرض.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrowserSessionRecord {
    pub session_id: String,
    pub mission_id: String,
    pub owner_agent_id: String,
    pub state: String,
    pub current_origin: Option<String>,
    pub current_url: Option<String>,
    pub current_title: Option<String>,
    pub navigation_count: u32,
    pub action_count: u32,
    pub download_count: u32,
    pub upload_count: u32,
    pub created_at: String,
    pub last_activity_at: String,
    pub closed_reason: Option<String>,
}

/// فعل واحد في جلسة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrowserActionRecord {
    pub action_id: String,
    pub session_id: String,
    pub mission_id: String,
    pub task_id: String,
    pub action: String,
    pub target: String,
    pub status: String,
    pub reason_code: Option<String>,
    pub url: Option<String>,
    pub http_status: Option<u16>,
    pub content_digest: Option<String>,
    /// `ACTION_EXECUTED` أو `NOT_EXECUTED`. التحقّق من النتيجة ليس هنا: هو قرار طبقة الحقيقة.
    pub outcome: String,
    pub occurred_at: String,
    pub duration_ms: u64,
}

/// تنزيل محفوظ في مجلّد المهمّة المعزول.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DownloadRecord {
    pub download_id: String,
    pub session_id: String,
    pub mission_id: String,
    pub source_url: String,
    pub file_name: String,
    pub byte_count: u64,
    pub sha256: String,
    pub content_type: String,
    pub executable: bool,
    pub trust: String,
    pub downloaded_at: String,
}

const SESSION_COLUMNS: &str = "session_id, mission_id, owner_agent_id, state, current_origin, current_url, current_title, navigation_count, \
    action_count, download_count, upload_count, created_at, last_activity_at, closed_reason";

fn session_row(r: &Row<'_>) -> rusqlite::Result<BrowserSessionRecord> {
    Ok(BrowserSessionRecord {
        session_id: r.get(0)?,
        mission_id: r.get(1)?,
        owner_agent_id: r.get(2)?,
        state: r.get(3)?,
        current_origin: r.get(4)?,
        current_url: r.get(5)?,
        current_title: r.get(6)?,
        navigation_count: r.get::<_, i64>(7)? as u32,
        action_count: r.get::<_, i64>(8)? as u32,
        download_count: r.get::<_, i64>(9)? as u32,
        upload_count: r.get::<_, i64>(10)? as u32,
        created_at: r.get(11)?,
        last_activity_at: r.get(12)?,
        closed_reason: r.get(13)?,
    })
}

pub struct BrowserStore {
    db: Arc<Database>,
}

impl BrowserStore {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn save_session(&self, s: &BrowserSessionRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                &format!(
                    "INSERT INTO browser_sessions ({SESSION_COLUMNS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
                     ON CONFLICT (session_id) DO UPDATE SET state = excluded.state, current_origin = excluded.current_origin,
                       current_url = excluded.current_url, current_title = excluded.current_title,
                       navigation_count = excluded.navigation_count, action_count = excluded.action_count,
                       download_count = excluded.download_count, upload_count = excluded.upload_count,
                       last_activity_at = excluded.last_activity_at, closed_reason = excluded.closed_reason"
                ),
                params![
                    s.session_id,
                    s.mission_id,
                    s.owner_agent_id,
                    s.state,
                    s.current_origin,
                    s.current_url,
                    s.current_title,
                    i64::from(s.navigation_count),
                    i64::from(s.action_count),
                    i64::from(s.download_count),
                    i64::from(s.upload_count),
                    s.created_at,
                    s.last_activity_at,
                    s.closed_reason
                ],
            )?;
            Ok(())
        })
    }

    pub fn record_action(&self, a: &BrowserActionRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO browser_actions (action_id, session_id, mission_id, task_id, action, target, status, reason_code, url,
                    http_status, content_digest, outcome, occurred_at, duration_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    a.action_id,
                    a.session_id,
                    a.mission_id,
                    a.task_id,
                    a.action,
                    a.target,
                    a.status,
                    a.reason_code,
                    a.url,
                    a.http_status.map(i64::from),
                    a.content_digest,
                    a.outcome,
                    a.occurred_at,
                    a.duration_ms as i64
                ],
            )?;
            Ok(())
        })
    }

    pub fn record_download(&self, d: &DownloadRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO browser_downloads (download_id, session_id, mission_id, source_url, file_name, byte_count, sha256,
                    content_type, executable, trust, downloaded_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    d.download_id,
                    d.session_id,
                    d.mission_id,
                    d.source_url,
                    d.file_name,
                    d.byte_count as i64,
                    d.sha256,
                    d.content_type,
                    i64::from(d.executable),
                    d.trust,
                    d.downloaded_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn sessions(&self, mission_id: Option<&str>) -> Result<Vec<BrowserSessionRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(&format!(
                "SELECT {SESSION_COLUMNS} FROM browser_sessions WHERE (?1 IS NULL OR mission_id = ?1) ORDER BY created_at DESC, session_id LIMIT 200"
            ))?;
            let rows = statement.query_map([mission_id], session_row)?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn session(&self, session_id: &str) -> Result<Option<BrowserSessionRecord>, StorageError> {
        self.db.with(|conn| {
            Ok(conn
                .query_row(&format!("SELECT {SESSION_COLUMNS} FROM browser_sessions WHERE session_id = ?1"), [session_id], session_row)
                .optional()?)
        })
    }

    pub fn actions(&self, session_id: &str) -> Result<Vec<BrowserActionRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT action_id, session_id, mission_id, task_id, action, target, status, reason_code, url, http_status, content_digest,
                    outcome, occurred_at, duration_ms FROM browser_actions WHERE session_id = ?1 ORDER BY occurred_at, action_id LIMIT 500",
            )?;
            let rows = statement
                .query_map([session_id], |r| {
                    Ok(BrowserActionRecord {
                        action_id: r.get(0)?,
                        session_id: r.get(1)?,
                        mission_id: r.get(2)?,
                        task_id: r.get(3)?,
                        action: r.get(4)?,
                        target: r.get(5)?,
                        status: r.get(6)?,
                        reason_code: r.get(7)?,
                        url: r.get(8)?,
                        http_status: r.get::<_, Option<i64>>(9)?.map(|v| v as u16),
                        content_digest: r.get(10)?,
                        outcome: r.get(11)?,
                        occurred_at: r.get(12)?,
                        duration_ms: r.get::<_, i64>(13)?.max(0) as u64,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn downloads(&self, mission_id: &str) -> Result<Vec<DownloadRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT download_id, session_id, mission_id, source_url, file_name, byte_count, sha256, content_type, executable, trust,
                    downloaded_at FROM browser_downloads WHERE mission_id = ?1 ORDER BY downloaded_at, download_id",
            )?;
            let rows = statement
                .query_map([mission_id], |r| {
                    Ok(DownloadRecord {
                        download_id: r.get(0)?,
                        session_id: r.get(1)?,
                        mission_id: r.get(2)?,
                        source_url: r.get(3)?,
                        file_name: r.get(4)?,
                        byte_count: r.get::<_, i64>(5)?.max(0) as u64,
                        sha256: r.get(6)?,
                        content_type: r.get(7)?,
                        executable: r.get::<_, i64>(8)? == 1,
                        trust: r.get(9)?,
                        downloaded_at: r.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /// بعد إقلاع جديد: جلسة كانت مفتوحة لم يعد لها محرّك يحملها. تُغلق بسبب صادق.
    pub fn close_after_restart(&self, now: &str) -> Result<u32, StorageError> {
        self.db.with(|conn| {
            Ok(conn.execute(
                "UPDATE browser_sessions SET state = 'CLOSED', closed_reason = 'HOST_RESTARTED', last_activity_at = ?1
                 WHERE state IN ('CREATED','ACTIVE','WAITING')",
                [now],
            )? as u32)
        })
    }
}
