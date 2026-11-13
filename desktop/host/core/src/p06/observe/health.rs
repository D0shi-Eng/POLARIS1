// الصحّة: حالة مُصنَّفة لكل مكوّن، ومتى قيست، وفي أي إقلاع.
//
// القاعدة (البند 55): بعد الإقلاع تبدأ الصحّة UNKNOWN حتى تُقاس. قياسٌ من عملية سابقة
// لا يُعرض صحّةً حاضرة: الموصل الذي كان سليمًا أمس قد يكون مقطوعًا الآن، ولا يعرف
// المضيف ذلك حتى يقيسه. لذلك لا تُحفظ الصحّة على القرص أصلًا.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Serialize;

/// الحالات. مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthState {
    Unknown,
    Healthy,
    Degraded,
    Unhealthy,
    /// المكوّن غير موجود في هذا المضيف (لا سطح مكتب خارج Windows مثلًا).
    Unavailable,
}

impl HealthState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "UNKNOWN",
            Self::Healthy => "HEALTHY",
            Self::Degraded => "DEGRADED",
            Self::Unhealthy => "UNHEALTHY",
            Self::Unavailable => "UNAVAILABLE",
        }
    }
}

/// صنف المكوّن في نظرة الصحّة (البند 31).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HealthSubject {
    Provider,
    Connector,
    Storage,
    Browser,
    Computer,
    Memory,
    ToolGateway,
    AgentRuntime,
    Config,
}

impl HealthSubject {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Provider => "PROVIDER",
            Self::Connector => "CONNECTOR",
            Self::Storage => "STORAGE",
            Self::Browser => "BROWSER",
            Self::Computer => "COMPUTER",
            Self::Memory => "MEMORY",
            Self::ToolGateway => "TOOL_GATEWAY",
            Self::AgentRuntime => "AGENT_RUNTIME",
            Self::Config => "CONFIG",
        }
    }
}

/// قياس صحّة واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HealthRecord {
    pub subject: HealthSubject,
    /// معرّف المزوّد أو الموصل، أو اسم المكوّن نفسه.
    pub subject_id: String,
    pub state: HealthState,
    pub reason_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measured_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    /// «في هذا الإقلاع» أو «لم يُقس بعد». لا ثالث.
    pub measured_this_session: bool,
}

impl HealthRecord {
    pub fn unknown(subject: HealthSubject, subject_id: impl Into<String>) -> Self {
        Self {
            subject,
            subject_id: subject_id.into(),
            state: HealthState::Unknown,
            reason_code: "NOT_MEASURED_SINCE_START".into(),
            measured_at: None,
            latency_ms: None,
            measured_this_session: false,
        }
    }
}

/// سجل القياسات في هذه العملية. يبدأ فارغًا عند كل إقلاع.
#[derive(Default)]
pub struct HealthRegistry {
    records: Mutex<BTreeMap<(HealthSubject, String), HealthRecord>>,
}

impl HealthRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, subject: HealthSubject, subject_id: &str, state: HealthState, reason_code: &str, measured_at: String, latency_ms: Option<u64>) {
        if let Ok(mut records) = self.records.lock() {
            records.insert(
                (subject, subject_id.to_string()),
                HealthRecord {
                    subject,
                    subject_id: subject_id.to_string(),
                    state,
                    reason_code: super::event::code(reason_code, 80),
                    measured_at: Some(measured_at),
                    latency_ms,
                    measured_this_session: true,
                },
            );
        }
    }

    /// القياس الحاضر، أو UNKNOWN إن لم يُقس في هذا الإقلاع.
    pub fn get(&self, subject: HealthSubject, subject_id: &str) -> HealthRecord {
        self.records
            .lock()
            .ok()
            .and_then(|r| r.get(&(subject, subject_id.to_string())).cloned())
            .unwrap_or_else(|| HealthRecord::unknown(subject, subject_id))
    }

    pub fn forget(&self, subject: HealthSubject, subject_id: &str) {
        if let Ok(mut records) = self.records.lock() {
            records.remove(&(subject, subject_id.to_string()));
        }
    }

    pub fn all_of(&self, subject: HealthSubject) -> Vec<HealthRecord> {
        self.records.lock().map(|r| r.values().filter(|h| h.subject == subject).cloned().collect()).unwrap_or_default()
    }
}

/// نظرة الصحّة الكاملة (البند 31).
#[derive(Debug, Clone, Serialize)]
pub struct HealthOverview {
    pub measured_at: String,
    /// الأسوأ بين المكوّنات المقيسة. UNKNOWN لا يحسّن ولا يسيء.
    pub overall: HealthState,
    pub components: Vec<HealthRecord>,
}

/// الأسوأ بين الحالات المقيسة.
pub fn overall(records: &[HealthRecord]) -> HealthState {
    let measured: Vec<HealthState> = records.iter().map(|r| r.state).filter(|s| !matches!(s, HealthState::Unknown | HealthState::Unavailable)).collect();
    if measured.is_empty() {
        return HealthState::Unknown;
    }
    if measured.contains(&HealthState::Unhealthy) {
        HealthState::Unhealthy
    } else if measured.contains(&HealthState::Degraded) {
        HealthState::Degraded
    } else {
        HealthState::Healthy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unmeasured_subject_is_unknown_not_healthy() {
        let registry = HealthRegistry::new();
        let record = registry.get(HealthSubject::Connector, "c1");
        assert_eq!(record.state, HealthState::Unknown);
        assert!(!record.measured_this_session);
        registry.record(HealthSubject::Connector, "c1", HealthState::Healthy, "PROBE_OK", "t".into(), Some(4));
        let measured = registry.get(HealthSubject::Connector, "c1");
        assert_eq!(measured.state, HealthState::Healthy);
        assert!(measured.measured_this_session);
    }

    #[test]
    fn a_fresh_registry_is_what_a_restart_produces() {
        // لا شيء يُحفظ: سجلّ جديد هو ما يراه الإقلاع التالي، فكل شيء UNKNOWN.
        let before = HealthRegistry::new();
        before.record(HealthSubject::Provider, "p", HealthState::Healthy, "OK", "t".into(), None);
        let after = HealthRegistry::new();
        assert_eq!(after.get(HealthSubject::Provider, "p").state, HealthState::Unknown);
    }

    #[test]
    fn the_overall_state_is_the_worst_measured_one() {
        let mut records = vec![HealthRecord::unknown(HealthSubject::Connector, "a")];
        assert_eq!(overall(&records), HealthState::Unknown);
        let mut healthy = HealthRecord::unknown(HealthSubject::Storage, "s");
        healthy.state = HealthState::Healthy;
        records.push(healthy);
        assert_eq!(overall(&records), HealthState::Healthy);
        let mut bad = HealthRecord::unknown(HealthSubject::Provider, "p");
        bad.state = HealthState::Unhealthy;
        records.push(bad);
        assert_eq!(overall(&records), HealthState::Unhealthy);
    }
}
