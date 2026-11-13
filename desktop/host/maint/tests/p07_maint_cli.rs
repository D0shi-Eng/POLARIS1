// P07 — أداة الصيانة كما يشغّلها المستخدم: الملف التنفيذي الحقيقي في عملية منفصلة.
//
// الأداة تطبع مستند JSON واحدًا ورمز خروج. هنا تُشغَّل فعلًا (CARGO_BIN_EXE)، وتُقرأ
// مخرجاتها، ويُتحقق من أثرها على مجلد بيانات حقيقي.

#[path = "../../core/tests/p07_support/mod.rs"]
mod p07_support;

use std::process::Command;

use p07_support::{create_project, host, project_names, temp_dir};
use serde_json::Value;

fn maint(args: &[&std::ffi::OsStr]) -> (Value, i32) {
    let output = Command::new(env!("CARGO_BIN_EXE_polaris-maint")).args(args).output().expect("polaris-maint did not start");
    let text = String::from_utf8(output.stdout).expect("the tool printed non-UTF-8");
    let document: Value = serde_json::from_str(&text).unwrap_or_else(|_| panic!("the tool printed no JSON document: {text}"));
    (document, output.status.code().unwrap_or(-1))
}

fn os(value: &str) -> &std::ffi::OsStr {
    std::ffi::OsStr::new(value)
}

#[test]
fn p07_maint_the_tool_reports_its_version_and_formats() {
    let (out, code) = maint(&[os("version")]);
    assert_eq!(code, 0);
    assert_eq!(out["result"]["supported_schema"], polaris_host_core::storage::migrations::SUPPORTED_VERSION);
    assert_eq!(out["result"]["trusted_update_keys"], 0);
    let output = Command::new(env!("CARGO_BIN_EXE_polaris-maint")).output().unwrap();
    assert_eq!(output.status.code(), Some(2), "no command must be a usage error");
}

#[test]
fn p07_maint_verify_backup_and_restore_through_the_real_executable() {
    let dir = temp_dir("exe");
    {
        let h = host(&dir);
        create_project(&h, "kept");
    }
    let d = dir.as_os_str();
    let (verify, code) = maint(&[os("verify"), os("--data-dir"), d, os("--full")]);
    assert_eq!(code, 0, "{verify}");
    assert_eq!(verify["result"]["integrity"]["state"], "HEALTHY");
    assert_eq!(verify["result"]["schema"]["matches_reference"], true);
    assert_eq!(verify["result"]["in_use"], false);

    let (backup, code) = maint(&[os("backup"), os("--data-dir"), d]);
    assert_eq!(code, 0, "{backup}");
    let id = backup["result"]["manifest"]["backup_id"].as_str().unwrap().to_string();
    let (checked, code) = maint(&[os("verify-backup"), os("--data-dir"), d, os("--backup"), os(&id)]);
    assert_eq!(code, 0, "{checked}");

    {
        let h = host(&dir);
        create_project(&h, "discarded");
        // والتطبيق يعمل، الاستعادة مرفوضة برمزها.
        let (refused, code) = maint(&[os("restore"), os("--data-dir"), d, os("--backup"), os(&id)]);
        assert_eq!((refused["code"].as_str(), code), (Some("DATA_DIR_IN_USE"), 1));
    }
    let (restored, code) = maint(&[os("restore"), os("--data-dir"), d, os("--backup"), os(&id)]);
    assert_eq!(code, 0, "{restored}");
    assert!(restored["result"]["pre_restore_backup"].is_string());
    let h = host(&dir);
    assert_eq!(project_names(&h), vec!["kept".to_string()]);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_maint_reset_moves_a_damaged_store_aside_and_the_application_starts_fresh() {
    let dir = temp_dir("reset");
    std::fs::write(dir.join("polaris.db"), b"damaged beyond use".repeat(400)).unwrap();
    let d = dir.as_os_str();
    let (refused, code) = maint(&[os("reset"), os("--data-dir"), d]);
    assert_eq!((refused["code"].as_str(), code), (Some("USAGE"), 2), "reset without confirmation");
    let (reset, code) = maint(&[os("reset"), os("--data-dir"), d, os("--confirm-reset")]);
    assert_eq!(code, 0, "{reset}");
    let folder = reset["result"]["quarantined"]["folder"].as_str().unwrap();
    assert!(dir.join("quarantine").join(folder).join("polaris.db").exists(), "reset deleted instead of moving");
    let h = host(&dir);
    assert!(project_names(&h).is_empty());
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_maint_policy_check_reports_a_valid_policy_and_refuses_an_invalid_one() {
    let dir = temp_dir("policy-check");
    let good = dir.join("good.json");
    std::fs::write(&good, r#"{"format":"polaris.managed-policy/1","policy_id":"corp","settings":{"privacy.allow_connector_egress":false}}"#).unwrap();
    let (out, code) = maint(&[os("policy-check"), os("--file"), good.as_os_str()]);
    assert_eq!(code, 0, "{out}");
    assert_eq!(out["result"]["state"], "APPLIED");
    let bad = dir.join("bad.json");
    std::fs::write(&bad, "{ not json").unwrap();
    let (out, code) = maint(&[os("policy-check"), os("--file"), bad.as_os_str()]);
    assert_eq!((out["code"].as_str(), code), (Some("POLICY_INVALID"), 1));
    let _ = std::fs::remove_dir_all(&dir);
}
