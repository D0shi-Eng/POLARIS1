// P07 — السياسة المُدارة على مسار المنتج: ملف سياسة، ومضيف حقيقي، وبوابة الإعدادات نفسها.
//
// الدعوى: السياسة تضيّق ولا توسّع، ومصدر القيمة المقصوصة معلن، والمستخدم لا يرفع حدًّا
// مُدارًا بالكتابة ولا بالحذف، وملف سياسة لا يصحّ يُغلق ولا يُتجاهل.

mod p07_support;

use polaris_host_core::p06::config::ConfigScope;
use polaris_host_core::p07::policy::{load_policy, PolicyState};
use p07_support::{host, temp_dir, Harness};
use serde_json::{json, Value};

fn effective(h: &Harness, key: &str) -> Value {
    let all = h.ok("config.effective", json!({}));
    all["values"].as_array().unwrap().iter().find(|v| v["key"] == key).cloned().unwrap()
}

fn write_policy(dir: &std::path::Path, body: &str) -> std::path::PathBuf {
    let path = dir.join("managed-policy.json");
    std::fs::write(&path, body).unwrap();
    path
}

#[test]
fn p07_policy_a_managed_policy_clamps_user_values_and_names_the_clamp() {
    let dir = temp_dir("policy-apply");
    let h = host(&dir.join("data"));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_connector_egress", "value": true }));
    h.ok("config.set", json!({ "layer": "USER", "key": "connectors.max_external_calls_per_mission", "value": 50 }));
    let path = write_policy(
        &dir,
        r#"{"format":"polaris.managed-policy/1","policy_id":"corp-baseline","settings":{"privacy.allow_connector_egress":false,"connectors.max_external_calls_per_mission":3}}"#,
    );
    let policy = load_policy(Some(&path));
    assert_eq!(policy.state, PolicyState::Applied);
    assert_eq!(h.host().apply_managed_policy(&policy), 2);
    let egress = effective(&h, "privacy.allow_connector_egress");
    assert_eq!((egress["value"].clone(), egress["source"].clone()), (json!(false), json!("SECURITY_CLAMP")));
    let calls = effective(&h, "connectors.max_external_calls_per_mission");
    assert_eq!((calls["value"].clone(), calls["source"].clone()), (json!(3), json!("SECURITY_CLAMP")));
    // المستهلكون يقرؤون الخدمة نفسها: القيمة المُدارة هي ما يُنفَّذ.
    let config = h.host().phase06().unwrap().config.clone();
    assert!(!config.bool("privacy.allow_connector_egress", &ConfigScope::global()));
    assert_eq!(config.int("connectors.max_external_calls_per_mission", &ConfigScope::global()), 3);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_policy_a_policy_cannot_widen_what_the_owner_narrowed() {
    let dir = temp_dir("policy-narrow");
    let h = host(&dir.join("data"));
    h.ok("config.set", json!({ "layer": "SECURITY", "key": "connectors.max_external_calls_per_mission", "value": 2 }));
    let path = write_policy(&dir, r#"{"format":"polaris.managed-policy/1","policy_id":"loose","settings":{"connectors.max_external_calls_per_mission":10}}"#);
    h.host().apply_managed_policy(&load_policy(Some(&path)));
    assert_eq!(effective(&h, "connectors.max_external_calls_per_mission")["value"], 2, "the policy widened a narrower owner limit");
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_policy_the_user_cannot_raise_or_remove_a_managed_limit() {
    let dir = temp_dir("policy-user");
    let h = host(&dir.join("data"));
    let path = write_policy(&dir, r#"{"format":"polaris.managed-policy/1","policy_id":"p","settings":{"privacy.allow_browser_internet":false}}"#);
    h.host().apply_managed_policy(&load_policy(Some(&path)));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_browser_internet", "value": true }));
    h.ok("config.set", json!({ "layer": "SECURITY", "key": "privacy.allow_browser_internet", "value": true }));
    assert_eq!(effective(&h, "privacy.allow_browser_internet")["value"], false);
    h.ok("config.reset", json!({ "layer": "SECURITY", "key": "privacy.allow_browser_internet" }));
    assert_eq!(effective(&h, "privacy.allow_browser_internet")["value"], false, "a reset removed the managed limit");
    assert_eq!(h.host().phase06().unwrap().config.managed_keys(), vec!["privacy.allow_browser_internet".to_string()]);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_policy_an_invalid_policy_file_locks_down_instead_of_being_ignored() {
    let dir = temp_dir("policy-invalid");
    let h = host(&dir.join("data"));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_browser_internet", "value": true }));
    let path = write_policy(&dir, r#"{"format":"polaris.managed-policy/1","policy_id":"broken","settings":{"privacy.allow_browser_internet":"yes"}}"#);
    let policy = load_policy(Some(&path));
    assert_eq!(policy.state, PolicyState::InvalidLockdown);
    assert_eq!(policy.reason_code, Some("POLICY_INVALID"));
    assert!(h.host().apply_managed_policy(&policy) > 0);
    assert_eq!(effective(&h, "privacy.allow_browser_internet")["value"], false);
    assert_eq!(effective(&h, "privacy.allow_connector_egress")["value"], false);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_policy_no_policy_file_changes_nothing() {
    let dir = temp_dir("policy-absent");
    let h = host(&dir.join("data"));
    let before = h.ok("config.effective", json!({}));
    let policy = load_policy(Some(&dir.join("absent.json")));
    assert_eq!(policy.state, PolicyState::NotConfigured);
    assert_eq!(h.host().apply_managed_policy(&policy), 0);
    let after = h.ok("config.effective", json!({}));
    assert_eq!(before["values"], after["values"]);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}
