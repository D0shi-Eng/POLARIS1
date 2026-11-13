// حالة النواة الموثوقة.
//
// الجواب الصادق في Phase-01 هو `NOT_ATTACHED`: الوصلة إلى النواة مرسومة ومتروكة
// غير مبنيّة. قشرة تدّعي نواةً موصولة في مرحلة لا توصل نواة هي شاشة تكذب على
// مستخدمها، و`runtime_contract_version` اختياري بالضبط ليكون الغياب جوابًا متاحًا.

use serde_json::{json, Value};

use crate::model::availability::Availability;
use crate::model::bootstrap::{RuntimeReachability, RuntimeStatus};
use crate::time::now_rfc3339_utc;

pub struct RuntimeStatusService;

impl Default for RuntimeStatusService {
    fn default() -> Self {
        Self::new()
    }
}

impl RuntimeStatusService {
    pub fn new() -> Self {
        Self
    }

    pub fn status(&self) -> RuntimeStatus {
        RuntimeStatus {
            reachability: RuntimeReachability::NotAttached,
            availability: Availability::phase_not_implemented(),
            runtime_contract_version: None,
        }
    }

    /// حمولة `desktop.runtime.status`: الحالة، ومتى رُصدت. بلا الطابع الزمني لا
    /// تستطيع القشرة أن تميّز جوابًا قديمًا من جديد.
    pub fn result(&self) -> Value {
        json!({
            "runtime_status": self.status(),
            "observed_at": now_rfc3339_utc(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_01_never_claims_an_attached_core() {
        let status = RuntimeStatusService::new().status();
        assert_eq!(status.reachability, RuntimeReachability::NotAttached);
        assert!(status.runtime_contract_version.is_none());
    }

    #[test]
    fn the_result_carries_an_observation_instant() {
        let value = RuntimeStatusService::new().result();
        let observed = value["observed_at"].as_str().unwrap();
        assert!(observed.ends_with('Z'));
    }
}
