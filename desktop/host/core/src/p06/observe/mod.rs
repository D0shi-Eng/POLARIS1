// الرصد (Phase-06): أحداث مهيكلة، ومقاييس محدودة، وصحّة، وأخطاء مجمّعة، وتنبيهات،
// وتصدير تشخيصي منقّح.
//
// أربعة أشياء لا تُخلط (البند 30): التدقيق للمساءلة في سلسلته، والأحداث للتشخيص هنا،
// والمقاييس تجميع هنا، والدليل إثبات في طبقة الحقيقة. لا شيء هنا يرفع ادّعاءً.

pub mod alerts;
pub mod event;
pub mod health;
pub mod metrics;
pub mod redact;

use std::sync::Arc;

use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

use super::config::{ConfigScope, ConfigService};
use alerts::{AlertBook, AlertKind, AlertSeverity};
use event::{EventDraft, EventStore, ObsEvent, Severity};
use health::HealthRegistry;
use metrics::Metrics;

pub struct ObservabilityService {
    pub events: EventStore,
    pub metrics: Metrics,
    pub health: HealthRegistry,
    pub alerts: AlertBook,
    config: Arc<ConfigService>,
    clock: RuntimeClock,
}

impl ObservabilityService {
    pub fn new(db: Option<Arc<Database>>, config: Arc<ConfigService>, clock: RuntimeClock) -> Self {
        Self { events: EventStore::new(db.clone()), metrics: Metrics::new(), health: HealthRegistry::new(), alerts: AlertBook::new(db), config, clock }
    }

    pub fn clock(&self) -> &RuntimeClock {
        &self.clock
    }

    /// يختم حدثًا ويكتبه. خطأ أو أسوأ يُجمَّع برمزه ويُحسب في نافذة القفزة.
    pub fn emit(&self, draft: EventDraft<'_>) -> ObsEvent {
        let event = draft.seal(self.clock.id(), self.clock.now());
        let retention = self.config.int("observability.event_retention", &ConfigScope::global()).clamp(100, 20_000) as usize;
        let stored = self.events.append(&event, retention);
        if !stored {
            self.alerts.raise(AlertKind::StorageIssue, AlertSeverity::Error, "obs_events", "EVENT_WRITE_FAILED", self.clock.id(), &event.timestamp);
        }
        if event.severity >= Severity::Error {
            self.metrics.error(event.component, event.reason_code.as_deref().unwrap_or("UNCLASSIFIED"));
            let threshold = self.config.int("observability.error_spike_threshold", &ConfigScope::global()).clamp(3, 100) as usize;
            if self.alerts.note_error(self.clock.now_millis(), threshold) {
                self.alerts.raise(AlertKind::ErrorSpike, AlertSeverity::Warning, event.component.as_str(), "ERROR_SPIKE", self.clock.id(), &event.timestamp);
            }
        }
        event
    }

    pub fn raise(&self, kind: AlertKind, severity: AlertSeverity, subject: &str, reason: &str) {
        let now = self.clock.now();
        self.alerts.raise(kind, severity, subject, reason, self.clock.id(), &now);
    }

    pub fn resolve(&self, kind: AlertKind, subject: &str) {
        let now = self.clock.now();
        self.alerts.resolve(kind, subject, &now);
    }
}

#[cfg(test)]
mod tests {
    use super::event::{Category, Component};
    use super::*;
    use crate::audit::AuditLedger;

    fn service() -> ObservabilityService {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let config = Arc::new(ConfigService::new(db.clone(), audit, RuntimeClock::deterministic()));
        ObservabilityService::new(Some(db), config, RuntimeClock::deterministic())
    }

    #[test]
    fn an_error_event_is_counted_by_code_and_a_burst_raises_an_error_spike_alert() {
        let obs = service();
        for _ in 0..10 {
            obs.emit(EventDraft::new(Component::Connector, Category::Invocation, Severity::Error, "connector.invoke", "FAILED").reason("UPSTREAM_5XX"));
        }
        assert_eq!(obs.metrics.error_count(Component::Connector, "UPSTREAM_5XX"), 10);
        let alerts = obs.alerts.list(false);
        assert!(alerts.iter().any(|a| a.kind == "ERROR_SPIKE"), "{alerts:?}");
    }
}
