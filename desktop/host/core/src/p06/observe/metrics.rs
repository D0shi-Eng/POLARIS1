// المقاييس: عدّادات مغلقة، ومدرّجات زمن بسلال ثابتة، وأخطاء مجمّعة برمزها.
//
// محدودة عمدًا (البند 28): أسماء العدّادات تعداد لا نصّ، والأخطاء تُجمَّع بالمكوّن
// والرمز لا بنصّ الرسالة (البند 32)، ولها سقف مفاتيح، وما يفيض يُعدّ في سلّة واحدة.
// لا بُعد بمعرّف مهمّة أو مسار أو نصّ مستخدم: هذا ما يفجّر الأبعاد.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Serialize;

use super::event::{code, Component};

/// العدّادات المطلوبة (البند 28). مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Counter {
    MissionCount,
    MissionSuccessCount,
    MissionFailedCount,
    ModelCalls,
    ToolCalls,
    ConnectorCalls,
    ApprovalRequests,
    ApprovalDenials,
    BrowserActions,
    ComputerActions,
    MemoryWrites,
    Errors,
}

impl Counter {
    pub const ALL: [Counter; 12] = [
        Self::MissionCount,
        Self::MissionSuccessCount,
        Self::MissionFailedCount,
        Self::ModelCalls,
        Self::ToolCalls,
        Self::ConnectorCalls,
        Self::ApprovalRequests,
        Self::ApprovalDenials,
        Self::BrowserActions,
        Self::ComputerActions,
        Self::MemoryWrites,
        Self::Errors,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissionCount => "mission_count",
            Self::MissionSuccessCount => "mission_success_count",
            Self::MissionFailedCount => "mission_failed_count",
            Self::ModelCalls => "model_calls",
            Self::ToolCalls => "tool_calls",
            Self::ConnectorCalls => "connector_calls",
            Self::ApprovalRequests => "approval_requests",
            Self::ApprovalDenials => "approval_denials",
            Self::BrowserActions => "browser_actions",
            Self::ComputerActions => "computer_actions",
            Self::MemoryWrites => "memory_writes",
            Self::Errors => "errors",
        }
    }
}

/// السلال الثابتة لمدرّج الزمن، بالميلي ثانية. الأخيرة «أكثر من ذلك».
pub const LATENCY_BUCKETS_MS: [u64; 9] = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

#[derive(Debug, Clone, Default, Serialize)]
pub struct Histogram {
    /// عدد العيّنات في كل سلّة، والأخيرة لما فوق آخر حدّ.
    pub buckets: [u64; 10],
    pub count: u64,
    pub sum_ms: u64,
    pub max_ms: u64,
}

impl Histogram {
    pub fn observe(&mut self, ms: u64) {
        let index = LATENCY_BUCKETS_MS.iter().position(|b| ms <= *b).unwrap_or(LATENCY_BUCKETS_MS.len());
        self.buckets[index] += 1;
        self.count += 1;
        self.sum_ms = self.sum_ms.saturating_add(ms);
        self.max_ms = self.max_ms.max(ms);
    }

    pub fn mean_ms(&self) -> Option<u64> {
        (self.count > 0).then(|| self.sum_ms / self.count)
    }
}

/// أقصى عدد مفاتيح أخطاء مختلفة. ما يزيد يُعدّ تحت OTHER.
pub const MAX_ERROR_KEYS: usize = 200;

#[derive(Default)]
struct State {
    counters: BTreeMap<Counter, u64>,
    latency: BTreeMap<Component, Histogram>,
    errors: BTreeMap<(Component, String), u64>,
    overflow: u64,
}

#[derive(Default)]
pub struct Metrics {
    state: Mutex<State>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorGroup {
    pub component: Component,
    pub reason_code: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LatencyView {
    pub component: Component,
    pub bucket_bounds_ms: [u64; 9],
    pub histogram: Histogram,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MetricsSnapshot {
    /// المقاييس تُعدّ منذ بدء هذه العملية. الاستعمال والكلفة يبقيان في دفترهما.
    pub scope: &'static str,
    pub counters: BTreeMap<&'static str, u64>,
    pub latency: Vec<LatencyView>,
    pub errors_by_code: Vec<ErrorGroup>,
    pub error_overflow: u64,
    pub distinct_error_keys: usize,
}

impl Metrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn increment(&self, counter: Counter) {
        self.add(counter, 1);
    }

    pub fn add(&self, counter: Counter, amount: u64) {
        if let Ok(mut state) = self.state.lock() {
            *state.counters.entry(counter).or_insert(0) += amount;
        }
    }

    pub fn latency(&self, component: Component, ms: u64) {
        if let Ok(mut state) = self.state.lock() {
            state.latency.entry(component).or_default().observe(ms);
        }
    }

    /// خطأ مجمّع برمزه. الرمز يُطهَّر: نصّ حرّ لا يصير مفتاحًا.
    pub fn error(&self, component: Component, reason_code: &str) {
        let reason = code(reason_code, 80);
        if let Ok(mut state) = self.state.lock() {
            *state.counters.entry(Counter::Errors).or_insert(0) += 1;
            let key = (component, reason);
            if state.errors.contains_key(&key) || state.errors.len() < MAX_ERROR_KEYS {
                *state.errors.entry(key).or_insert(0) += 1;
            } else {
                state.overflow += 1;
            }
        }
    }

    pub fn count(&self, counter: Counter) -> u64 {
        self.state.lock().map(|s| s.counters.get(&counter).copied().unwrap_or(0)).unwrap_or(0)
    }

    pub fn error_count(&self, component: Component, reason_code: &str) -> u64 {
        self.state.lock().map(|s| s.errors.get(&(component, reason_code.to_string())).copied().unwrap_or(0)).unwrap_or(0)
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        let state = self.state.lock();
        let Ok(state) = state else {
            return MetricsSnapshot { scope: "SINCE_START", counters: BTreeMap::new(), latency: Vec::new(), errors_by_code: Vec::new(), error_overflow: 0, distinct_error_keys: 0 };
        };
        let counters = Counter::ALL.iter().map(|c| (c.as_str(), state.counters.get(c).copied().unwrap_or(0))).collect();
        let latency = state
            .latency
            .iter()
            .map(|(component, h)| LatencyView { component: *component, bucket_bounds_ms: LATENCY_BUCKETS_MS, histogram: h.clone(), mean_ms: h.mean_ms() })
            .collect();
        let mut errors_by_code: Vec<ErrorGroup> =
            state.errors.iter().map(|((component, reason), count)| ErrorGroup { component: *component, reason_code: reason.clone(), count: *count }).collect();
        errors_by_code.sort_by(|a, b| b.count.cmp(&a.count).then(a.reason_code.cmp(&b.reason_code)));
        MetricsSnapshot {
            scope: "SINCE_START",
            counters,
            latency,
            distinct_error_keys: state.errors.len(),
            errors_by_code,
            error_overflow: state.overflow,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_are_grouped_by_component_and_code_not_by_message() {
        let metrics = Metrics::new();
        metrics.error(Component::Connector, "RATE_LIMITED");
        metrics.error(Component::Connector, "RATE_LIMITED");
        metrics.error(Component::Connector, "the server said: rate limited at 12:00");
        let snapshot = metrics.snapshot();
        assert_eq!(metrics.error_count(Component::Connector, "RATE_LIMITED"), 2);
        assert_eq!(metrics.error_count(Component::Connector, "UNCLASSIFIED"), 1, "a message became a metric key");
        assert_eq!(snapshot.counters["errors"], 3);
    }

    #[test]
    fn the_error_key_space_is_bounded() {
        let metrics = Metrics::new();
        for index in 0..(MAX_ERROR_KEYS + 50) {
            metrics.error(Component::Tool, &format!("CODE_{index}"));
        }
        let snapshot = metrics.snapshot();
        assert_eq!(snapshot.distinct_error_keys, MAX_ERROR_KEYS);
        assert_eq!(snapshot.error_overflow, 50);
    }

    #[test]
    fn a_latency_lands_in_the_first_bucket_that_holds_it() {
        let mut h = Histogram::default();
        h.observe(5);
        h.observe(10);
        h.observe(11);
        h.observe(20_000);
        assert_eq!(h.buckets[0], 2);
        assert_eq!(h.buckets[1], 1);
        assert_eq!(h.buckets[9], 1);
        assert_eq!(h.count, 4);
        assert_eq!(h.max_ms, 20_000);
    }

    #[test]
    fn every_required_counter_is_present_even_at_zero() {
        let snapshot = Metrics::new().snapshot();
        for name in [
            "mission_count",
            "mission_success_count",
            "mission_failed_count",
            "model_calls",
            "tool_calls",
            "connector_calls",
            "approval_requests",
            "approval_denials",
            "browser_actions",
            "computer_actions",
            "memory_writes",
            "errors",
        ] {
            assert_eq!(snapshot.counters.get(name), Some(&0), "{name} is missing");
        }
    }
}
