// طبقة IPC لـPhase-05: حمولة مُتحقَّق منها إلى نداء خدمة، ونتيجة إلى JSON.
//
// المطابقة شاملة فوق قائمة مغلقة. وما ليس في القائمة هو الخاصيّة الأمنية (البند 50):
// لا `browser.raw_execute`، ولا `computer.raw_command`، ولا `memory.trust`، ولا عملية
// عامّة تأخذ فعلًا حرًّا. الفعل على الويب أو الشاشة يبدأ من زمن تشغيل المهمّة وحده،
// عبر بوابة الأدوات. وما يصل من هنا: قراءة، وحذف ذاكرة، ومنح نافذة لمهمّة، وإيقاف جلسة.

use serde_json::Value;

use crate::ipc::errors::{DesktopErrorCategory, HostError};
use crate::p03::service::Phase03;

use super::service::{memory_filter, Phase05};

/// العمليات التي يملكها Phase-05. مغلقة ومطابقة للسجل.
pub const OPERATIONS: [&str; 12] = [
    "memory.list",
    "memory.get",
    "memory.delete",
    "browser.session.list",
    "browser.session.get",
    "browser.session.cancel",
    "computer.session.list",
    "computer.session.get",
    "computer.session.cancel",
    "computer.window.list",
    "computer.target.grant",
    "computer.target.revoke",
];

/// أسماء يحرسها هذا الملف بالاسم: وجود أحدها يعني أن مسارًا عامًّا أو ترقية ثقة عادت.
pub const FORBIDDEN_OPERATIONS: [&str; 10] = [
    "browser.raw_execute",
    "browser.execute",
    "browser.navigate",
    "computer.raw_command",
    "computer.execute",
    "computer.click",
    "memory.trust",
    "memory.verify",
    "memory.write",
    "action.execute",
];

pub fn handle(p05: &Phase05, phase03: Option<&Phase03>, operation: &str, payload: &Value, _session: &str) -> Result<Value, HostError> {
    match operation {
        "memory.list" => to_value(&p05.memory_list(memory_filter(payload)?)?),
        "memory.get" => to_value(&p05.memory_get(&required_str(payload, "memory_id")?)?),
        "memory.delete" => to_value(&p05.memory_delete(&required_str(payload, "memory_id")?)?),
        "browser.session.list" => to_value(&p05.browser_sessions(optional_str(payload, "mission_id"))?),
        "browser.session.get" => to_value(&p05.browser_session(&required_str(payload, "session_id")?)?),
        "browser.session.cancel" => to_value(&p05.browser_cancel(&required_str(payload, "session_id")?)?),
        "computer.session.list" => to_value(&p05.computer_sessions(optional_str(payload, "mission_id"))?),
        "computer.session.get" => to_value(&p05.computer_session(&required_str(payload, "session_id")?)?),
        "computer.session.cancel" => to_value(&p05.computer_cancel(&required_str(payload, "session_id")?)?),
        "computer.window.list" => to_value(&p05.computer_windows(optional_str(payload, "mission_id"))?),
        "computer.target.grant" => {
            let mission_id = required_str(payload, "mission_id")?;
            // المنحة لمهمّة قائمة لم تنته. مهمّة منتهية لا تستعمل نافذة، ومنحتها لا معنى لها.
            let Some(phase03) = phase03 else {
                return Err(HostError::feature_not_available("missions are unavailable, so no window can be granted"));
            };
            let mission = phase03.get(&mission_id)?;
            if matches!(mission.mission.state, "COMPLETED" | "FAILED" | "CANCELLED") {
                return Err(HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", "the mission has ended; a window cannot be granted to it"));
            }
            let hwnd = parse_hwnd(&required_str(payload, "hwnd")?)?;
            to_value(&p05.computer_grant(&mission_id, hwnd)?)
        }
        "computer.target.revoke" => to_value(&p05.computer_revoke(&required_str(payload, "grant_id")?)?),
        other => Err(HostError::internal(format!("routed operation {other} has no Phase-05 owner"))),
    }
}

fn parse_hwnd(raw: &str) -> Result<u64, HostError> {
    let digits = raw.strip_prefix("0x").ok_or_else(|| HostError::validation("hwnd must be a 0x-prefixed hexadecimal handle").at("/hwnd"))?;
    u64::from_str_radix(digits, 16).map_err(|_| HostError::validation("hwnd is not a hexadecimal handle").at("/hwnd"))
}

fn required_str(payload: &Value, key: &str) -> Result<String, HostError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| HostError::validation(format!("{key} is absent")).at(format!("/{key}")))
}

fn optional_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, HostError> {
    serde_json::to_value(value).map_err(|e| HostError::internal(format!("result serialisation failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operation_list_is_closed_and_carries_no_action_path() {
        assert_eq!(OPERATIONS.len(), 12);
        for forbidden in FORBIDDEN_OPERATIONS {
            assert!(!OPERATIONS.contains(&forbidden), "{forbidden} is in the Phase-05 vocabulary");
        }
        for operation in OPERATIONS {
            for verb in ["execute", "invoke", "raw", "navigate", "click", "type", "trust", "verify", "write"] {
                assert!(!operation.contains(verb), "{operation} reads like an action path");
            }
        }
    }

    #[test]
    fn a_window_handle_must_be_a_hexadecimal_literal() {
        assert_eq!(parse_hwnd("0x1a2b").unwrap(), 0x1a2b);
        assert!(parse_hwnd("6699").is_err());
        assert!(parse_hwnd("0xZZ").is_err());
    }
}
