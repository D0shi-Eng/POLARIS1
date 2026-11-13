// أساس السياسة المُدارة: ملف يضعه مدير الجهاز، يضيّق ولا يوسّع.
//
// السياسة تُقرأ مرة عند الإقلاع وتصير صفوفًا في طبقة الأمان لا يكتبها المستخدم ولا
// يحذفها، فتمرّ بالمحلّل نفسه الذي أُغلق به Phase-06: الأضيق من سقف البناء ومن كل
// حدّ أمان هو الحدّ. لذلك لا تستطيع سياسة — ولو زوّرها مستخدم محلّي في مسار قابل
// للكتابة — أن توسّع شيئًا: أسوأ ما تفعله أن تضيّق.
//
// سياسة موجودة ولا تُقرأ أو لا تصحّ لا تُتجاهل: تُطبَّق «سياسة الإغلاق» — كل إعداد
// أمني منطقي في أضيق قيمه — ويُعلن السبب. غياب الملف وحده يعني «لا سياسة».

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::digest::sha256_hex;
use crate::p06::config::model::{Layer, SettingKind, SettingState, SettingValue};
use crate::p06::config::registry::{catalogue, find};
use crate::p06::config::store::StoredValue;

use super::error::MaintenanceError;

pub const POLICY_FORMAT: &str = "polaris.managed-policy/1";
pub const MAX_POLICY_BYTES: u64 = 64 * 1024;
pub const MAX_POLICY_SETTINGS: usize = 200;
/// ختم ثابت لصفوف السياسة: ليست كتابات مستخدم، ولا زمن كتابة لها.
const MANAGED_STAMP: &str = "managed-policy";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyDocument {
    format: String,
    policy_id: String,
    settings: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PolicyState {
    NotConfigured,
    Applied,
    /// ملف موجود لا يصحّ: طُبّقت سياسة الإغلاق.
    InvalidLockdown,
}

#[derive(Debug, Clone, Serialize)]
pub struct LoadedPolicy {
    pub state: PolicyState,
    pub policy_id: Option<String>,
    pub sha256: Option<String>,
    pub reason_code: Option<&'static str>,
    pub detail: Option<String>,
    pub managed_keys: Vec<String>,
    #[serde(skip)]
    pub rows: Vec<StoredValue>,
}

impl LoadedPolicy {
    pub fn not_configured() -> Self {
        Self { state: PolicyState::NotConfigured, policy_id: None, sha256: None, reason_code: None, detail: None, managed_keys: Vec::new(), rows: Vec::new() }
    }
}

fn invalid(detail: impl Into<String>) -> MaintenanceError {
    MaintenanceError::new("POLICY_INVALID", detail)
}

fn row(key: &str, value: Value) -> StoredValue {
    StoredValue { layer: Layer::Security, scope_id: String::new(), key: key.to_string(), value, updated_at: MANAGED_STAMP.into() }
}

/// يحلّ مستند سياسة ويتحقق من كل إعداد فيه. أي إعداد مرفوض يرفض المستند كله.
pub fn parse_policy(bytes: &[u8]) -> Result<(String, Vec<StoredValue>), MaintenanceError> {
    if bytes.len() as u64 > MAX_POLICY_BYTES {
        return Err(MaintenanceError::new("POLICY_TOO_LARGE", format!("{} bytes", bytes.len())));
    }
    let document: PolicyDocument = serde_json::from_slice(bytes).map_err(|e| invalid(e.to_string()))?;
    if document.format != POLICY_FORMAT {
        return Err(invalid(format!("unknown policy format {}", document.format)));
    }
    let id_ok = !document.policy_id.is_empty()
        && document.policy_id.len() <= 80
        && document.policy_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    if !id_ok {
        return Err(invalid("policy_id must be 1-80 characters of [A-Za-z0-9._-]"));
    }
    if document.settings.is_empty() || document.settings.len() > MAX_POLICY_SETTINGS {
        return Err(invalid("a policy manages between 1 and 200 settings"));
    }
    let mut rows = Vec::new();
    for (key, raw) in &document.settings {
        let def = find(key).ok_or_else(|| invalid(format!("unknown setting {key}")))?;
        // السياسة تدير حدود الأمان فقط: ما لا اتجاه توسيع له لا «أضيق» له.
        if def.state != SettingState::Editable || !def.layers.contains(&Layer::Security) || def.widening.is_none() {
            return Err(invalid(format!("{key} is not a manageable security setting")));
        }
        let value = def.parse(raw).map_err(|refusal| invalid(format!("{key}: {}", refusal.as_str())))?;
        if let (Some(widening), Some(ceiling)) = (def.widening, def.ceiling_value()) {
            if widening.is_wider(&value, &ceiling) {
                return Err(invalid(format!("{key}: above the build ceiling")));
            }
        }
        rows.push(row(key, value.to_json()));
    }
    Ok((document.policy_id, rows))
}

/// سياسة الإغلاق: كل إعداد أمني منطقي قابل للإدارة في أضيق قيمه.
pub fn lockdown_rows() -> Vec<StoredValue> {
    catalogue()
        .iter()
        .filter(|def| def.state == SettingState::Editable && def.layers.contains(&Layer::Security) && def.kind == SettingKind::Boolean)
        .filter_map(|def| {
            let widening = def.widening?;
            // «صحيح» أوسع من «خطأ»؟ فالأضيق خطأ، وإلا فالأضيق صحيح.
            let narrow = !widening.is_wider(&SettingValue::Boolean(true), &SettingValue::Boolean(false));
            Some(row(def.key, Value::Bool(narrow)))
        })
        .collect()
}

fn lockdown(reason_code: &'static str, detail: String, sha256: Option<String>) -> LoadedPolicy {
    let rows = lockdown_rows();
    LoadedPolicy {
        state: PolicyState::InvalidLockdown,
        policy_id: None,
        sha256,
        reason_code: Some(reason_code),
        detail: Some(detail),
        managed_keys: rows.iter().map(|r| r.key.clone()).collect(),
        rows,
    }
}

/// يقرأ السياسة من مسارها إن وُجد. لا مسار أو لا ملف ← لا سياسة.
pub fn load_policy(path: Option<&Path>) -> LoadedPolicy {
    let Some(path) = path else { return LoadedPolicy::not_configured() };
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return LoadedPolicy::not_configured(),
        Err(e) => return lockdown("POLICY_UNREADABLE", e.to_string(), None),
    };
    if !meta.is_file() {
        return lockdown("POLICY_UNREADABLE", "the policy path is not a regular file".into(), None);
    }
    if meta.len() > MAX_POLICY_BYTES {
        return lockdown("POLICY_TOO_LARGE", format!("{} bytes", meta.len()), None);
    }
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) => return lockdown("POLICY_UNREADABLE", e.to_string(), None),
    };
    let sha256 = sha256_hex(&bytes);
    match parse_policy(&bytes) {
        Ok((policy_id, rows)) => LoadedPolicy {
            state: PolicyState::Applied,
            policy_id: Some(policy_id),
            sha256: Some(sha256),
            reason_code: None,
            detail: None,
            managed_keys: rows.iter().map(|r| r.key.clone()).collect(),
            rows,
        },
        Err(error) => lockdown(error.code, error.detail, Some(sha256)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_valid_policy_becomes_security_rows() {
        let text = br#"{"format":"polaris.managed-policy/1","policy_id":"corp-1","settings":{"privacy.allow_connector_egress":false,"connectors.max_external_calls_per_mission":3}}"#;
        let (id, rows) = parse_policy(text).unwrap();
        assert_eq!(id, "corp-1");
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.layer == Layer::Security && r.scope_id.is_empty()));
    }

    #[test]
    fn a_policy_cannot_name_an_unknown_locked_or_non_security_setting() {
        for body in [
            r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{"privacy.anything":true}}"#,
            r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{"browser.private_network_allowed":true}}"#,
            r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{"appearance.theme":"DARK"}}"#,
            r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{"privacy.allow_connector_egress":1}}"#,
            r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{}}"#,
            r#"{"format":"polaris.managed-policy/2","policy_id":"p","settings":{"privacy.allow_connector_egress":false}}"#,
            r#"{"format":"polaris.managed-policy/1","policy_id":"../p","settings":{"privacy.allow_connector_egress":false}}"#,
            r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{"privacy.allow_connector_egress":false},"allow":"all"}"#,
        ] {
            assert_eq!(parse_policy(body.as_bytes()).unwrap_err().code, "POLICY_INVALID", "{body}");
        }
    }

    #[test]
    fn the_lockdown_turns_every_boolean_security_setting_to_its_narrow_value() {
        let rows = lockdown_rows();
        assert!(!rows.is_empty());
        for r in &rows {
            let def = find(&r.key).unwrap();
            let value = def.parse(&r.value).unwrap();
            let widening = def.widening.unwrap();
            let other = SettingValue::Boolean(!value.as_bool().unwrap());
            assert!(widening.is_wider(&other, &value), "{} lockdown value is not the narrow one", r.key);
        }
        assert!(rows.iter().any(|r| r.key == "privacy.allow_connector_egress" && r.value == Value::Bool(false)));
        assert!(rows.iter().any(|r| r.key == "privacy.allow_browser_internet" && r.value == Value::Bool(false)));
        // اختيار النموذج ليس قيدًا أمنيًّا (ADR-040): الإقفال لا يمنع نموذجًا اختاره المستخدم.
        assert!(rows.iter().all(|r| !r.key.contains("remote_models") && !r.key.contains("local_only")));
    }
}
