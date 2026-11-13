// محدِّد معدّل الموصلات (البند 16): طلبات في الدقيقة، وطلبات متزامنة، وانتظار محدود.
//
// لا انتظار غير محدود ولا إعادة غير محكومة: إن كان الانتظار اللازم أطول من سقف
// الانتظار يُرفض الطلب محليًّا برمز RATE_LIMITED ولا يُرسل. والتزامن يُحجز بتصريح
// يُحرَّر عند إسقاطه، فلا يتسرّب مقعد حين يفشل النداء.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use super::model::RateLimit;

const WINDOW_MS: u64 = 60_000;

#[derive(Default)]
struct Lane {
    sent: VecDeque<u64>,
    in_flight: u32,
}

#[derive(Default)]
pub struct ConnectorRateLimiter {
    lanes: Mutex<BTreeMap<String, Lane>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Acquire {
    Granted,
    /// يجب الانتظار هذا القدر قبل أن يتّسع النافذة.
    WaitMs(u64),
    /// بلغ التزامن حدّه.
    Busy,
}

/// تصريح طلب واحد. إسقاطه يحرّر مقعد التزامن.
pub struct Permit {
    limiter: Arc<ConnectorRateLimiter>,
    connector_id: String,
}

impl Drop for Permit {
    fn drop(&mut self) {
        if let Ok(mut lanes) = self.limiter.lanes.lock() {
            if let Some(lane) = lanes.get_mut(&self.connector_id) {
                lane.in_flight = lane.in_flight.saturating_sub(1);
            }
        }
    }
}

impl ConnectorRateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// يحاول الحجز الآن دون انتظار. `Granted` يسجّل الإرسال ويأخذ مقعدًا.
    pub fn try_acquire(&self, connector_id: &str, limit: RateLimit, now_ms: u64) -> Acquire {
        let Ok(mut lanes) = self.lanes.lock() else { return Acquire::Busy };
        let lane = lanes.entry(connector_id.to_string()).or_default();
        while lane.sent.front().is_some_and(|t| now_ms.saturating_sub(*t) >= WINDOW_MS) {
            lane.sent.pop_front();
        }
        if lane.in_flight >= limit.max_concurrent {
            return Acquire::Busy;
        }
        if lane.sent.len() as u32 >= limit.requests_per_minute {
            let oldest = lane.sent.front().copied().unwrap_or(now_ms);
            return Acquire::WaitMs((oldest + WINDOW_MS).saturating_sub(now_ms).max(1));
        }
        lane.sent.push_back(now_ms);
        lane.in_flight += 1;
        Acquire::Granted
    }

    pub fn permit(self: &Arc<Self>, connector_id: &str) -> Permit {
        Permit { limiter: self.clone(), connector_id: connector_id.to_string() }
    }

    /// يسجّل إرسالًا إضافيًّا داخل تصريح قائم (محاولة ثانية). المحاولة طلب يُعدّ.
    pub fn note_retry(&self, connector_id: &str, now_ms: u64) {
        if let Ok(mut lanes) = self.lanes.lock() {
            lanes.entry(connector_id.to_string()).or_default().sent.push_back(now_ms);
        }
    }

    pub fn in_flight(&self, connector_id: &str) -> u32 {
        self.lanes.lock().ok().and_then(|l| l.get(connector_id).map(|lane| lane.in_flight)).unwrap_or(0)
    }

    pub fn in_flight_total(&self) -> u32 {
        self.lanes.lock().map(|l| l.values().map(|lane| lane.in_flight).sum()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_beyond_the_minute_window_must_wait_and_the_wait_is_measured() {
        let limiter = Arc::new(ConnectorRateLimiter::new());
        let limit = RateLimit { requests_per_minute: 2, max_concurrent: 5 };
        assert_eq!(limiter.try_acquire("c", limit, 1_000), Acquire::Granted);
        let _a = limiter.permit("c");
        assert_eq!(limiter.try_acquire("c", limit, 2_000), Acquire::Granted);
        let _b = limiter.permit("c");
        assert_eq!(limiter.try_acquire("c", limit, 3_000), Acquire::WaitMs(58_000));
        // بعد مرور الدقيقة على الأول يتّسع مقعد.
        assert_eq!(limiter.try_acquire("c", limit, 61_000), Acquire::Granted);
    }

    #[test]
    fn concurrency_is_bounded_and_a_dropped_permit_frees_its_seat() {
        let limiter = Arc::new(ConnectorRateLimiter::new());
        let limit = RateLimit { requests_per_minute: 100, max_concurrent: 1 };
        assert_eq!(limiter.try_acquire("c", limit, 0), Acquire::Granted);
        let permit = limiter.permit("c");
        assert_eq!(limiter.try_acquire("c", limit, 1), Acquire::Busy);
        drop(permit);
        assert_eq!(limiter.in_flight("c"), 0);
        assert_eq!(limiter.try_acquire("c", limit, 2), Acquire::Granted);
    }

    #[test]
    fn lanes_are_per_connector() {
        let limiter = Arc::new(ConnectorRateLimiter::new());
        let limit = RateLimit { requests_per_minute: 1, max_concurrent: 1 };
        assert_eq!(limiter.try_acquire("a", limit, 0), Acquire::Granted);
        assert_eq!(limiter.try_acquire("b", limit, 0), Acquire::Granted);
    }
}
