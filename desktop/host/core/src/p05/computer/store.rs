// استمرار منح النوافذ وجلسات التحكّم وأفعالها وبصمات ملاحظاتها. لا بكسلات ولا نصوص عناصر.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;

use crate::storage::{Database, StorageError};

use super::port::WindowIdentity;

/// منحة نافذة لمهمّة. يعطيها المستخدم، وتُربط بهويّة النافذة الكاملة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TargetGrant {
    pub grant_id: String,
    pub mission_id: String,
    pub identity: WindowIdentity,
    pub title: String,
    pub granted_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComputerSessionRecord {
    pub session_id: String,
    pub mission_id: String,
    pub agent_id: String,
    pub state: String,
    pub target: Option<TargetGrant>,
    pub created_at: String,
    pub last_action_at: Option<String>,
    pub action_count: u32,
    pub click_count: u32,
    pub keyboard_count: u32,
    pub capture_count: u32,
    pub closed_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ComputerActionRecord {
    pub action_id: String,
    pub session_id: String,
    pub mission_id: String,
    pub task_id: String,
    pub action: String,
    pub target: String,
    pub status: String,
    pub reason_code: Option<String>,
    pub observation_digest: Option<String>,
    pub occurred_at: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObservationRecord {
    pub observation_id: String,
    pub session_id: String,
    pub mission_id: String,
    pub window_json: String,
    pub width: u32,
    pub height: u32,
    pub frame_digest: String,
    pub layout_digest: String,
    pub element_count: u32,
    pub observed_at: String,
}

/// أقصى عدد لبصمات الملاحظات المحفوظة لكل جلسة. الأقدم يُحذف.
const MAX_OBSERVATION_ROWS: i64 = 50;

fn session_row(r: &Row<'_>) -> rusqlite::Result<ComputerSessionRecord> {
    let target: Option<String> = r.get(4)?;
    Ok(ComputerSessionRecord {
        session_id: r.get(0)?,
        mission_id: r.get(1)?,
        agent_id: r.get(2)?,
        state: r.get(3)?,
        target: target.and_then(|t| serde_json::from_str::<TargetGrantRow>(&t).ok()).map(TargetGrantRow::into_grant),
        created_at: r.get(5)?,
        last_action_at: r.get(6)?,
        action_count: r.get::<_, i64>(7)? as u32,
        click_count: r.get::<_, i64>(8)? as u32,
        keyboard_count: r.get::<_, i64>(9)? as u32,
        capture_count: r.get::<_, i64>(10)? as u32,
        closed_reason: r.get(11)?,
    })
}

#[derive(serde::Deserialize, Serialize)]
struct TargetGrantRow {
    grant_id: String,
    mission_id: String,
    identity: WindowIdentity,
    title: String,
    granted_at: String,
    revoked_at: Option<String>,
}

impl TargetGrantRow {
    fn from_grant(g: &TargetGrant) -> Self {
        Self {
            grant_id: g.grant_id.clone(),
            mission_id: g.mission_id.clone(),
            identity: g.identity.clone(),
            title: g.title.clone(),
            granted_at: g.granted_at.clone(),
            revoked_at: g.revoked_at.clone(),
        }
    }

    fn into_grant(self) -> TargetGrant {
        TargetGrant {
            grant_id: self.grant_id,
            mission_id: self.mission_id,
            identity: self.identity,
            title: self.title,
            granted_at: self.granted_at,
            revoked_at: self.revoked_at,
        }
    }
}

pub struct ComputerStore {
    db: Arc<Database>,
}

impl ComputerStore {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn save_grant(&self, g: &TargetGrant) -> Result<(), StorageError> {
        let identity = serde_json::to_string(&TargetGrantRow::from_grant(g)).unwrap_or_default();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO computer_target_grants (grant_id, mission_id, identity_json, granted_at, revoked_at) VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT (grant_id) DO UPDATE SET revoked_at = excluded.revoked_at",
                params![g.grant_id, g.mission_id, identity, g.granted_at, g.revoked_at],
            )?;
            Ok(())
        })
    }

    pub fn grants(&self, mission_id: Option<&str>) -> Result<Vec<TargetGrant>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT identity_json, revoked_at FROM computer_target_grants WHERE (?1 IS NULL OR mission_id = ?1) ORDER BY granted_at, grant_id",
            )?;
            let rows = statement
                .query_map([mission_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows
                .into_iter()
                .filter_map(|(json, revoked)| {
                    serde_json::from_str::<TargetGrantRow>(&json).ok().map(|row| {
                        let mut g = row.into_grant();
                        g.revoked_at = revoked;
                        g
                    })
                })
                .collect())
        })
    }

    pub fn save_session(&self, s: &ComputerSessionRecord) -> Result<(), StorageError> {
        let target = s.target.as_ref().map(|g| serde_json::to_string(&TargetGrantRow::from_grant(g)).unwrap_or_default());
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO computer_sessions (session_id, mission_id, agent_id, state, target_json, created_at, last_action_at,
                    action_count, click_count, keyboard_count, capture_count, closed_reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
                 ON CONFLICT (session_id) DO UPDATE SET state = excluded.state, target_json = excluded.target_json,
                    last_action_at = excluded.last_action_at, action_count = excluded.action_count, click_count = excluded.click_count,
                    keyboard_count = excluded.keyboard_count, capture_count = excluded.capture_count, closed_reason = excluded.closed_reason",
                params![
                    s.session_id,
                    s.mission_id,
                    s.agent_id,
                    s.state,
                    target,
                    s.created_at,
                    s.last_action_at,
                    i64::from(s.action_count),
                    i64::from(s.click_count),
                    i64::from(s.keyboard_count),
                    i64::from(s.capture_count),
                    s.closed_reason
                ],
            )?;
            Ok(())
        })
    }

    pub fn sessions(&self, mission_id: Option<&str>) -> Result<Vec<ComputerSessionRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT session_id, mission_id, agent_id, state, target_json, created_at, last_action_at, action_count, click_count,
                    keyboard_count, capture_count, closed_reason FROM computer_sessions WHERE (?1 IS NULL OR mission_id = ?1)
                 ORDER BY created_at DESC, session_id LIMIT 200",
            )?;
            let rows = statement.query_map([mission_id], session_row)?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn session(&self, session_id: &str) -> Result<Option<ComputerSessionRecord>, StorageError> {
        self.db.with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT session_id, mission_id, agent_id, state, target_json, created_at, last_action_at, action_count, click_count,
                        keyboard_count, capture_count, closed_reason FROM computer_sessions WHERE session_id = ?1",
                    [session_id],
                    session_row,
                )
                .optional()?)
        })
    }

    pub fn record_action(&self, a: &ComputerActionRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO computer_actions (action_id, session_id, mission_id, task_id, action, target, status, reason_code,
                    observation_digest, occurred_at, duration_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    a.action_id,
                    a.session_id,
                    a.mission_id,
                    a.task_id,
                    a.action,
                    a.target,
                    a.status,
                    a.reason_code,
                    a.observation_digest,
                    a.occurred_at,
                    a.duration_ms as i64
                ],
            )?;
            Ok(())
        })
    }

    pub fn actions(&self, session_id: &str) -> Result<Vec<ComputerActionRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT action_id, session_id, mission_id, task_id, action, target, status, reason_code, observation_digest, occurred_at,
                    duration_ms FROM computer_actions WHERE session_id = ?1 ORDER BY occurred_at, action_id LIMIT 500",
            )?;
            let rows = statement
                .query_map([session_id], |r| {
                    Ok(ComputerActionRecord {
                        action_id: r.get(0)?,
                        session_id: r.get(1)?,
                        mission_id: r.get(2)?,
                        task_id: r.get(3)?,
                        action: r.get(4)?,
                        target: r.get(5)?,
                        status: r.get(6)?,
                        reason_code: r.get(7)?,
                        observation_digest: r.get(8)?,
                        occurred_at: r.get(9)?,
                        duration_ms: r.get::<_, i64>(10)?.max(0) as u64,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /// يحفظ بصمة ملاحظة ويقصّ الأقدم فوق السقف: لا لقطات بلا نهاية.
    pub fn record_observation(&self, o: &ObservationRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO computer_observations (observation_id, session_id, mission_id, window_json, width, height, frame_digest,
                    layout_digest, element_count, capture_scope, trust, observed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'WINDOW','UNTRUSTED_CONTENT',?10)",
                params![
                    o.observation_id,
                    o.session_id,
                    o.mission_id,
                    o.window_json,
                    i64::from(o.width),
                    i64::from(o.height),
                    o.frame_digest,
                    o.layout_digest,
                    i64::from(o.element_count),
                    o.observed_at
                ],
            )?;
            tx.execute(
                "DELETE FROM computer_observations WHERE session_id = ?1 AND observation_id NOT IN (
                    SELECT observation_id FROM computer_observations WHERE session_id = ?1 ORDER BY observed_at DESC, observation_id DESC LIMIT ?2)",
                params![o.session_id, MAX_OBSERVATION_ROWS],
            )?;
            tx.commit()?;
            Ok(())
        })
    }

    pub fn observations(&self, session_id: &str) -> Result<Vec<ObservationRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT observation_id, session_id, mission_id, window_json, width, height, frame_digest, layout_digest, element_count, observed_at
                 FROM computer_observations WHERE session_id = ?1 ORDER BY observed_at DESC, observation_id DESC",
            )?;
            let rows = statement
                .query_map([session_id], |r| {
                    Ok(ObservationRecord {
                        observation_id: r.get(0)?,
                        session_id: r.get(1)?,
                        mission_id: r.get(2)?,
                        window_json: r.get(3)?,
                        width: r.get::<_, i64>(4)? as u32,
                        height: r.get::<_, i64>(5)? as u32,
                        frame_digest: r.get(6)?,
                        layout_digest: r.get(7)?,
                        element_count: r.get::<_, i64>(8)? as u32,
                        observed_at: r.get(9)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn close_after_restart(&self, now: &str) -> Result<u32, StorageError> {
        self.db.with(|conn| {
            Ok(conn.execute(
                "UPDATE computer_sessions SET state = 'CLOSED', closed_reason = 'HOST_RESTARTED', last_action_at = ?1
                 WHERE state IN ('CREATED','ACTIVE','WAITING')",
                [now],
            )? as u32)
        })
    }
}
