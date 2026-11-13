// التنبيهات المحلية (البند 50): ستة أنواع مغلقة، تُحفظ وتُجمَّع بموضوعها.
//
// التنبيه يتكرّر ولا يتضاعف: النوع والموضوع مفتاح واحد، والتكرار عدّاد. ولا إشعار
// سحابي في هذه المرحلة: التنبيه يُقرأ من الواجهة وحدها.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use rusqlite::params;
use serde::Serialize;

use crate::storage::Database;

use super::event::code;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AlertKind {
    BudgetNearLimit,
    BudgetExceeded,
    ProviderUnhealthy,
    ConnectorUnhealthy,
    ErrorSpike,
    StorageIssue,
    /// خطة 2026-10-07 (ADR-041 §3.2): حلقة توقّفت بلا تقدّم.
    NoProgressLoop,
    /// دورات الحلقة تجاوزت نصف حدّها.
    TurnsAboveExpected,
    /// المهمّة تجاوزت زمنها المتوقّع.
    MissionOvertime,
    /// مسبار الحقن وجد نمطًا في محتوى غير موثوق.
    InjectionDetected,
    /// ملف محميّ تغيّر، أو سلسلة تجزئة انكسرت.
    TamperDetected,
    /// ملف الطُعم قُرئ بلا طلب.
    HoneytokenRead,
}

impl AlertKind {
    pub const ALL: [AlertKind; 12] = [
        Self::BudgetNearLimit,
        Self::BudgetExceeded,
        Self::ProviderUnhealthy,
        Self::ConnectorUnhealthy,
        Self::ErrorSpike,
        Self::StorageIssue,
        Self::NoProgressLoop,
        Self::TurnsAboveExpected,
        Self::MissionOvertime,
        Self::InjectionDetected,
        Self::TamperDetected,
        Self::HoneytokenRead,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::BudgetNearLimit => "BUDGET_NEAR_LIMIT",
            Self::BudgetExceeded => "BUDGET_EXCEEDED",
            Self::ProviderUnhealthy => "PROVIDER_UNHEALTHY",
            Self::ConnectorUnhealthy => "CONNECTOR_UNHEALTHY",
            Self::ErrorSpike => "ERROR_SPIKE",
            Self::StorageIssue => "STORAGE_ISSUE",
            Self::NoProgressLoop => "NO_PROGRESS_LOOP",
            Self::TurnsAboveExpected => "TURNS_ABOVE_EXPECTED",
            Self::MissionOvertime => "MISSION_OVERTIME",
            Self::InjectionDetected => "INJECTION_DETECTED",
            Self::TamperDetected => "TAMPER_DETECTED",
            Self::HoneytokenRead => "HONEYTOKEN_READ",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AlertSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

impl AlertSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warning => "WARNING",
            Self::Error => "ERROR",
            Self::Critical => "CRITICAL",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Alert {
    pub alert_id: String,
    pub kind: String,
    pub severity: String,
    pub subject: String,
    pub reason_code: String,
    pub first_at: String,
    pub last_at: String,
    pub occurrences: u64,
    pub state: String,
}

/// نافذة قفزة الأخطاء بالميلي ثانية: خمس دقائق.
pub const ERROR_SPIKE_WINDOW_MS: u64 = 5 * 60 * 1000;

pub struct AlertBook {
    db: Option<Arc<Database>>,
    errors: Mutex<VecDeque<u64>>,
    memory: Mutex<Vec<Alert>>,
}

impl AlertBook {
    pub fn new(db: Option<Arc<Database>>) -> Self {
        Self { db, errors: Mutex::new(VecDeque::new()), memory: Mutex::new(Vec::new()) }
    }

    /// يرفع تنبيهًا أو يزيد تكراره. الموضوع يُطهَّر: لا نصّ حرّ.
    pub fn raise(&self, kind: AlertKind, severity: AlertSeverity, subject: &str, reason: &str, id: String, now: &str) {
        let subject = code(subject, 200);
        let reason = code(reason, 80);
        if let Some(db) = &self.db {
            let _ = db.with(|conn| {
                conn.execute(
                    "INSERT INTO obs_alerts (alert_id, kind, severity, subject, reason_code, first_at, last_at, occurrences, state)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1, 'OPEN')
                     ON CONFLICT (kind, subject) DO UPDATE SET occurrences = occurrences + 1, last_at = excluded.last_at,
                        severity = excluded.severity, reason_code = excluded.reason_code, state = 'OPEN'",
                    params![id, kind.as_str(), severity.as_str(), subject, reason, now],
                )?;
                Ok(())
            });
            return;
        }
        if let Ok(mut memory) = self.memory.lock() {
            match memory.iter_mut().find(|a| a.kind == kind.as_str() && a.subject == subject) {
                Some(existing) => {
                    existing.occurrences += 1;
                    existing.last_at = now.to_string();
                    existing.state = "OPEN".into();
                }
                None => memory.push(Alert {
                    alert_id: id,
                    kind: kind.as_str().into(),
                    severity: severity.as_str().into(),
                    subject,
                    reason_code: reason,
                    first_at: now.into(),
                    last_at: now.into(),
                    occurrences: 1,
                    state: "OPEN".into(),
                }),
            }
        }
    }

    pub fn resolve(&self, kind: AlertKind, subject: &str, now: &str) {
        let subject = code(subject, 200);
        if let Some(db) = &self.db {
            let _ = db.with(|conn| {
                conn.execute(
                    "UPDATE obs_alerts SET state = 'RESOLVED', last_at = ?3 WHERE kind = ?1 AND subject = ?2 AND state = 'OPEN'",
                    params![kind.as_str(), subject, now],
                )?;
                Ok(())
            });
            return;
        }
        if let Ok(mut memory) = self.memory.lock() {
            for alert in memory.iter_mut().filter(|a| a.kind == kind.as_str() && a.subject == subject) {
                alert.state = "RESOLVED".into();
            }
        }
    }

    /// يسجّل خطأً ويعيد صحيحًا إن تجاوز عدد الأخطاء في النافذة العتبة.
    pub fn note_error(&self, now_ms: u64, threshold: usize) -> bool {
        let Ok(mut errors) = self.errors.lock() else { return false };
        errors.push_back(now_ms);
        while errors.front().is_some_and(|t| now_ms.saturating_sub(*t) > ERROR_SPIKE_WINDOW_MS) {
            errors.pop_front();
        }
        while errors.len() > 10_000 {
            errors.pop_front();
        }
        errors.len() >= threshold
    }

    pub fn list(&self, include_resolved: bool) -> Vec<Alert> {
        if let Some(db) = &self.db {
            let rows = db.with(|conn| {
                let mut statement = conn.prepare(
                    "SELECT alert_id, kind, severity, subject, reason_code, first_at, last_at, occurrences, state FROM obs_alerts ORDER BY last_at DESC LIMIT 200",
                )?;
                let mapped = statement.query_map([], |r| {
                    Ok(Alert {
                        alert_id: r.get(0)?,
                        kind: r.get(1)?,
                        severity: r.get(2)?,
                        subject: r.get(3)?,
                        reason_code: r.get(4)?,
                        first_at: r.get(5)?,
                        last_at: r.get(6)?,
                        occurrences: r.get::<_, i64>(7)?.max(1) as u64,
                        state: r.get(8)?,
                    })
                })?;
                let mut out = Vec::new();
                for row in mapped {
                    out.push(row?);
                }
                Ok(out)
            });
            return rows.unwrap_or_default().into_iter().filter(|a| include_resolved || a.state == "OPEN").collect();
        }
        self.memory.lock().map(|m| m.iter().filter(|a| include_resolved || a.state == "OPEN").cloned().collect()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_repeated_alert_counts_rather_than_duplicates_and_can_be_resolved() {
        let db = Arc::new(Database::in_memory().unwrap());
        let book = AlertBook::new(Some(db));
        book.raise(AlertKind::BudgetNearLimit, AlertSeverity::Warning, "budget:b1", "NEAR_LIMIT", "a1".into(), "t1");
        book.raise(AlertKind::BudgetNearLimit, AlertSeverity::Warning, "budget:b1", "NEAR_LIMIT", "a2".into(), "t2");
        let open = book.list(false);
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].occurrences, 2);
        book.resolve(AlertKind::BudgetNearLimit, "budget:b1", "t3");
        assert!(book.list(false).is_empty());
        assert_eq!(book.list(true).len(), 1);
    }

    #[test]
    fn an_error_spike_needs_the_threshold_inside_the_window() {
        let book = AlertBook::new(None);
        for i in 0..4 {
            assert!(!book.note_error(i * 1_000, 5));
        }
        assert!(book.note_error(5_000, 5));
        // بعد انقضاء النافذة يعود العدّ من جديد.
        assert!(!book.note_error(5_000 + ERROR_SPIKE_WINDOW_MS + 10, 5));
    }

    #[test]
    fn free_text_does_not_become_an_alert_subject() {
        let book = AlertBook::new(None);
        book.raise(AlertKind::StorageIssue, AlertSeverity::Error, "disk C:\\Users\\me full", "WRITE_FAILED", "a".into(), "t");
        assert_eq!(book.list(false)[0].subject, "UNCLASSIFIED");
    }
}
