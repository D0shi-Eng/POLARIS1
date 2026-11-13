// إتاحة القدرات، كما يقرّرها المضيف.
//
// الاستعلام محدود وصريح ولا وجود لجامعة «كل القدرات»: استعلام غير محدود هو
// مُرسِل صغير بثياب أخرى. وكل معرّف طُلب يُجاب، ولو لم يعرفه المضيف — الحذف
// الصامت يجعل العارض يخمّن، والتخمين هو ما تمنعه هذه العملية أصلًا.

use serde_json::{json, Value};

use crate::capabilities;
use crate::ipc::errors::HostError;

pub struct CapabilityAvailabilityService;

impl Default for CapabilityAvailabilityService {
    fn default() -> Self {
        Self::new()
    }
}

impl CapabilityAvailabilityService {
    pub fn new() -> Self {
        Self
    }

    pub fn result(&self, payload: &Value) -> Result<Value, HostError> {
        self.result_with(payload, &capabilities::CapabilityFacts::phase_01())
    }

    pub fn result_with(&self, payload: &Value, facts: &capabilities::CapabilityFacts) -> Result<Value, HostError> {
        let ids = payload
            .get("capability_ids")
            .and_then(Value::as_array)
            .ok_or_else(|| HostError::validation("capability_ids is absent").at("/payload/capability_ids"))?;

        let capabilities: Vec<_> = ids
            .iter()
            .filter_map(Value::as_str)
            .map(|id| capabilities::resolve_with(id, facts))
            .collect();

        Ok(json!({ "capabilities": capabilities }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_requested_id_is_answered_including_unknown_ones() {
        let service = CapabilityAvailabilityService::new();
        let payload = json!({
            "capability_ids": ["polaris.desktop.settings", "polaris.desktop.nowhere"]
        });
        let result = service.result(&payload).unwrap();
        let answers = result["capabilities"].as_array().unwrap();
        assert_eq!(answers.len(), 2);
        assert_eq!(answers[0]["availability"]["state"], "AVAILABLE");
        assert_eq!(answers[1]["availability"]["state"], "UNAVAILABLE");
        assert_eq!(answers[1]["availability"]["reason"], "PHASE_NOT_IMPLEMENTED");
    }

    #[test]
    fn a_payload_without_the_query_is_a_validation_error() {
        assert!(CapabilityAvailabilityService::new().result(&json!({})).is_err());
    }
}
