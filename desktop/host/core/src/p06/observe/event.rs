// الأحداث المهيكلة: سجلّ التشخيص الوحيد في Phase-06.
//
// الفصل مقصود (البند 30): التدقيق للمساءلة (سلسلة بصمات لا تُحرَّر)، والأحداث
// للتشخيص (محدودة وتُقصّ)، والمقاييس تجميع، والدليل إثبات. لا يُكتب حدث في التدقيق
// ولا العكس. والحدث رموزٌ لا نثر: كل حقل نصّي رمز مغلق الشكل، فلا يحمل مطالبة
// نموذج ولا سرًّا ولا ترويسة ولا محتوى صفحة ولا حمولة موصل (البند 29).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use rusqlite::params;
use serde::Serialize;

use crate::storage::Database;

/// الخطورة. مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Severity {
    Debug,
    Info,
    Warning,
    Error,
    Critical,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warning => "WARNING",
            Self::Error => "ERROR",
            Self::Critical => "CRITICAL",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        [Self::Debug, Self::Info, Self::Warning, Self::Error, Self::Critical].into_iter().find(|s| s.as_str() == code)
    }
}

/// المكوّن الذي أصدر الحدث. مغلق، فلا تنفجر الأبعاد (البند 28).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Component {
    ConnectorGateway,
    Connector,
    Model,
    Tool,
    Browser,
    Computer,
    Memory,
    Mission,
    Budget,
    Cost,
    Config,
    Storage,
    Health,
    Diagnostics,
}

impl Component {
    pub const ALL: [Component; 14] = [
        Self::ConnectorGateway,
        Self::Connector,
        Self::Model,
        Self::Tool,
        Self::Browser,
        Self::Computer,
        Self::Memory,
        Self::Mission,
        Self::Budget,
        Self::Cost,
        Self::Config,
        Self::Storage,
        Self::Health,
        Self::Diagnostics,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ConnectorGateway => "CONNECTOR_GATEWAY",
            Self::Connector => "CONNECTOR",
            Self::Model => "MODEL",
            Self::Tool => "TOOL",
            Self::Browser => "BROWSER",
            Self::Computer => "COMPUTER",
            Self::Memory => "MEMORY",
            Self::Mission => "MISSION",
            Self::Budget => "BUDGET",
            Self::Cost => "COST",
            Self::Config => "CONFIG",
            Self::Storage => "STORAGE",
            Self::Health => "HEALTH",
            Self::Diagnostics => "DIAGNOSTICS",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_str() == code)
    }
}

/// صنف الحدث. مغلق.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Category {
    Invocation,
    Policy,
    Budget,
    RateLimit,
    Retry,
    Health,
    Config,
    Lifecycle,
    Security,
    Diagnostics,
}

impl Category {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Invocation => "INVOCATION",
            Self::Policy => "POLICY",
            Self::Budget => "BUDGET",
            Self::RateLimit => "RATE_LIMIT",
            Self::Retry => "RETRY",
            Self::Health => "HEALTH",
            Self::Config => "CONFIG",
            Self::Lifecycle => "LIFECYCLE",
            Self::Security => "SECURITY",
            Self::Diagnostics => "DIAGNOSTICS",
        }
    }
}

/// من قاس المدّة أو النتيجة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventProvenance {
    LocallyMeasured,
    ProviderReported,
    ConnectorReported,
}

impl EventProvenance {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocallyMeasured => "LOCALLY_MEASURED",
            Self::ProviderReported => "PROVIDER_REPORTED",
            Self::ConnectorReported => "CONNECTOR_REPORTED",
        }
    }
}

/// رمزٌ لا نثر: حروف وأرقام وفواصل رمزية فقط، ومحدود. ما عداه يُستبدل برمز ثابت.
pub fn code(raw: &str, max: usize) -> String {
    let ok = !raw.is_empty() && raw.len() <= max && raw.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-'));
    if ok {
        raw.to_string()
    } else {
        "UNCLASSIFIED".into()
    }
}

/// معرّف بشكل UUID أو لا شيء. قيمة أخرى لا تُكتب في حدث.
pub fn identifier(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let ok = raw.len() == 36 && raw.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    ok.then(|| raw.to_ascii_lowercase())
}

/// حدث واحد، بالمخطط المطلوب (البند 27).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObsEvent {
    pub event_id: String,
    pub timestamp: String,
    pub component: Component,
    pub category: Category,
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub operation: String,
    pub result: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    pub provenance: EventProvenance,
}

/// مدخلات حدث قبل أن يُختم بمعرّف ووقت. الحقول النصّية تُطهَّر عند البناء.
#[derive(Debug, Clone)]
pub struct EventDraft<'a> {
    pub component: Component,
    pub category: Category,
    pub severity: Severity,
    pub mission_id: Option<&'a str>,
    pub task_id: Option<&'a str>,
    pub agent_id: Option<&'a str>,
    pub operation: &'a str,
    pub result: &'a str,
    pub duration_ms: Option<u64>,
    pub reason_code: Option<&'a str>,
    pub provenance: EventProvenance,
}

impl<'a> EventDraft<'a> {
    pub fn new(component: Component, category: Category, severity: Severity, operation: &'a str, result: &'a str) -> Self {
        Self {
            component,
            category,
            severity,
            mission_id: None,
            task_id: None,
            agent_id: None,
            operation,
            result,
            duration_ms: None,
            reason_code: None,
            provenance: EventProvenance::LocallyMeasured,
        }
    }

    pub fn mission(mut self, mission_id: Option<&'a str>, task_id: Option<&'a str>, agent_id: Option<&'a str>) -> Self {
        self.mission_id = mission_id;
        self.task_id = task_id;
        self.agent_id = agent_id;
        self
    }

    pub fn duration(mut self, ms: u64) -> Self {
        self.duration_ms = Some(ms);
        self
    }

    pub fn reason(mut self, reason: &'a str) -> Self {
        self.reason_code = Some(reason);
        self
    }

    pub fn seal(&self, event_id: String, timestamp: String) -> ObsEvent {
        ObsEvent {
            event_id,
            timestamp,
            component: self.component,
            category: self.category,
            severity: self.severity,
            mission_id: identifier(self.mission_id),
            task_id: identifier(self.task_id),
            agent_id: identifier(self.agent_id),
            operation: code(self.operation, 120),
            result: code(self.result, 40),
            duration_ms: self.duration_ms,
            reason_code: self.reason_code.map(|r| code(r, 80)),
            provenance: self.provenance,
        }
    }
}

/// مخزن الأحداث: حلقة في الذاكرة للقراءة السريعة، وجدول محدود للبقاء بعد الإقلاع.
pub struct EventStore {
    db: Option<Arc<Database>>,
    ring: Mutex<VecDeque<ObsEvent>>,
    ring_capacity: usize,
}

impl EventStore {
    pub fn new(db: Option<Arc<Database>>) -> Self {
        Self { db, ring: Mutex::new(VecDeque::new()), ring_capacity: 2_000 }
    }

    /// يكتب حدثًا ويقصّ الجدول إلى حدّ الاحتفاظ. فشل الكتابة لا يُسقط المستدعي.
    pub fn append(&self, event: &ObsEvent, retention: usize) -> bool {
        if let Ok(mut ring) = self.ring.lock() {
            if ring.len() >= self.ring_capacity {
                ring.pop_front();
            }
            ring.push_back(event.clone());
        }
        let Some(db) = &self.db else { return true };
        db.with(|conn| {
            conn.execute(
                "INSERT INTO obs_events (event_id, occurred_at, component, category, severity, mission_id, task_id, agent_id, operation, result, duration_ms, reason_code, provenance)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    event.event_id,
                    event.timestamp,
                    event.component.as_str(),
                    event.category.as_str(),
                    event.severity.as_str(),
                    event.mission_id,
                    event.task_id,
                    event.agent_id,
                    event.operation,
                    event.result,
                    event.duration_ms.map(|d| d as i64),
                    event.reason_code,
                    event.provenance.as_str(),
                ],
            )?;
            conn.execute(
                "DELETE FROM obs_events WHERE seq <= (SELECT seq FROM obs_events ORDER BY seq DESC LIMIT 1 OFFSET ?1)",
                [retention as i64],
            )?;
            Ok(())
        })
        .is_ok()
    }

    /// آخر الأحداث، الأحدث أولًا. من الجدول إن وُجد، فتبقى بعد الإقلاع.
    pub fn recent(&self, limit: usize, component: Option<Component>, min_severity: Option<Severity>) -> Vec<ObsEvent> {
        let limit = limit.clamp(1, 1_000);
        if let Some(db) = &self.db {
            let rows = db.with(|conn| {
                let mut statement = conn.prepare(
                    "SELECT event_id, occurred_at, component, category, severity, mission_id, task_id, agent_id, operation, result, duration_ms, reason_code, provenance
                     FROM obs_events ORDER BY seq DESC LIMIT 5000",
                )?;
                let mapped = statement.query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, Option<String>>(5)?,
                        r.get::<_, Option<String>>(6)?,
                        r.get::<_, Option<String>>(7)?,
                        r.get::<_, String>(8)?,
                        r.get::<_, String>(9)?,
                        r.get::<_, Option<i64>>(10)?,
                        r.get::<_, Option<String>>(11)?,
                        r.get::<_, String>(12)?,
                    ))
                })?;
                let mut out = Vec::new();
                for row in mapped {
                    out.push(row?);
                }
                Ok(out)
            });
            if let Ok(rows) = rows {
                return rows
                    .into_iter()
                    .filter_map(|row| {
                        let component = Component::parse(&row.2)?;
                        let severity = Severity::parse(&row.4)?;
                        Some(ObsEvent {
                            event_id: row.0,
                            timestamp: row.1,
                            component,
                            category: category_of(&row.3),
                            severity,
                            mission_id: row.5,
                            task_id: row.6,
                            agent_id: row.7,
                            operation: row.8,
                            result: row.9,
                            duration_ms: row.10.map(|d| d.max(0) as u64),
                            reason_code: row.11,
                            provenance: match row.12.as_str() {
                                "PROVIDER_REPORTED" => EventProvenance::ProviderReported,
                                "CONNECTOR_REPORTED" => EventProvenance::ConnectorReported,
                                _ => EventProvenance::LocallyMeasured,
                            },
                        })
                    })
                    .filter(|e| component.is_none_or(|c| e.component == c))
                    .filter(|e| min_severity.is_none_or(|s| e.severity >= s))
                    .take(limit)
                    .collect();
            }
        }
        let ring = self.ring.lock().map(|r| r.clone()).unwrap_or_default();
        ring.into_iter()
            .rev()
            .filter(|e| component.is_none_or(|c| e.component == c))
            .filter(|e| min_severity.is_none_or(|s| e.severity >= s))
            .take(limit)
            .collect()
    }

    pub fn stored_count(&self) -> Option<u64> {
        let db = self.db.as_ref()?;
        db.with(|conn| Ok(conn.query_row("SELECT count(*) FROM obs_events", [], |r| r.get::<_, i64>(0))?)).ok().map(|n| n.max(0) as u64)
    }
}

fn category_of(code: &str) -> Category {
    match code {
        "INVOCATION" => Category::Invocation,
        "POLICY" => Category::Policy,
        "BUDGET" => Category::Budget,
        "RATE_LIMIT" => Category::RateLimit,
        "RETRY" => Category::Retry,
        "HEALTH" => Category::Health,
        "CONFIG" => Category::Config,
        "LIFECYCLE" => Category::Lifecycle,
        "SECURITY" => Category::Security,
        _ => Category::Diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_text_never_becomes_an_event_field() {
        let draft = EventDraft::new(Component::Connector, Category::Invocation, Severity::Info, "Authorization: Bearer sk-abc", "ok result")
            .reason("the password is hunter2")
            .mission(Some("not-a-uuid"), None, None);
        let event = draft.seal("e1".into(), "t".into());
        assert_eq!(event.operation, "UNCLASSIFIED");
        assert_eq!(event.result, "UNCLASSIFIED");
        assert_eq!(event.reason_code.as_deref(), Some("UNCLASSIFIED"));
        assert_eq!(event.mission_id, None);
        let text = serde_json::to_string(&event).unwrap();
        for leaked in ["Bearer", "sk-abc", "hunter2", "password"] {
            assert!(!text.contains(leaked), "{leaked} reached an event");
        }
    }

    #[test]
    fn the_store_is_bounded_by_the_retention_setting() {
        let db = Arc::new(Database::in_memory().unwrap());
        let store = EventStore::new(Some(db));
        for index in 0..30 {
            let event = EventDraft::new(Component::Tool, Category::Invocation, Severity::Info, "tool.call", "OK").seal(format!("e{index}"), "t".into());
            assert!(store.append(&event, 10));
        }
        assert_eq!(store.stored_count(), Some(10));
        let recent = store.recent(5, None, None);
        assert_eq!(recent.len(), 5);
        assert_eq!(recent[0].event_id, "e29", "the newest event is not first");
    }

    #[test]
    fn events_can_be_filtered_by_component_and_severity() {
        let store = EventStore::new(None);
        store.append(&EventDraft::new(Component::Tool, Category::Invocation, Severity::Info, "a", "OK").seal("1".into(), "t".into()), 100);
        store.append(&EventDraft::new(Component::Connector, Category::Invocation, Severity::Error, "b", "FAILED").seal("2".into(), "t".into()), 100);
        assert_eq!(store.recent(10, Some(Component::Connector), None).len(), 1);
        assert_eq!(store.recent(10, None, Some(Severity::Warning)).len(), 1);
    }
}
