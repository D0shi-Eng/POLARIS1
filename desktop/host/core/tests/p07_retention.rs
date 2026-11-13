// P07 — الاحتفاظ: التشغيل الجاف لا يحذف، والتطبيق يقصّ ما يُعاد إنتاجه فقط، والعزل لا يُمسّ.

mod p07_support;

use polaris_host_core::p07::backup::{create_backup, list_backups, BackupReason};
use polaris_host_core::p07::retention::{apply_retention, RetentionPolicy};
use p07_support::{host, now, temp_dir};

fn touch(path: &std::path::Path, days_old: u64) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, b"x").unwrap();
    let when = std::time::SystemTime::now() - std::time::Duration::from_secs(days_old * 86_400);
    std::fs::File::options().write(true).open(path).unwrap().set_modified(when).unwrap();
}

#[test]
fn p07_retention_a_dry_run_counts_and_an_applied_run_prunes_only_reproducible_files() {
    let dir = temp_dir("retention");
    drop(host(&dir));
    for _ in 0..3 {
        create_backup(&dir, BackupReason::Manual, &now(), 100).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
    }
    for i in 0..5 {
        touch(&dir.join("diagnostics").join(format!("polaris-diagnostics-2026092400000{i}.json")), 0);
    }
    touch(&dir.join("p05-downloads").join("m1").join("old.quarantine"), 40);
    touch(&dir.join("p05-downloads").join("m1").join("new.quarantine"), 1);
    touch(&dir.join("quarantine").join("20260101000000Z-damaged-aaaa").join("polaris.db"), 400);
    let policy = RetentionPolicy { keep_backups: 1, keep_diagnostics: 2, downloads_max_age_days: Some(30) };

    let dry = apply_retention(&dir, &policy, false).unwrap();
    assert_eq!((dry.backups_removed.len(), dry.diagnostics_removed.len(), dry.downloads_removed), (2, 3, 1));
    assert_eq!(list_backups(&dir).unwrap().len(), 3, "a dry run deleted a backup");
    assert_eq!(std::fs::read_dir(dir.join("diagnostics")).unwrap().count(), 5, "a dry run deleted a diagnostics file");

    let applied = apply_retention(&dir, &policy, true).unwrap();
    assert_eq!((applied.backups_removed.len(), applied.diagnostics_removed.len(), applied.downloads_removed), (2, 3, 1));
    assert_eq!(list_backups(&dir).unwrap().len(), 1);
    assert!(dir.join("p05-downloads/m1/new.quarantine").exists());
    assert!(!dir.join("p05-downloads/m1/old.quarantine").exists());
    assert!(dir.join("quarantine/20260101000000Z-damaged-aaaa/polaris.db").exists(), "retention touched quarantined user data");
    assert_eq!(applied.quarantine_folders_kept, 1);
    let audit = applied.tables.iter().find(|t| t.table == "audit_events").unwrap();
    assert!(audit.bound.starts_with("NEVER_PRUNED"));
    assert!(audit.rows.is_some());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_retention_a_policy_that_would_delete_everything_is_refused() {
    let dir = temp_dir("retention-invalid");
    for policy in [
        RetentionPolicy { keep_backups: 0, ..RetentionPolicy::default() },
        RetentionPolicy { downloads_max_age_days: Some(0), ..RetentionPolicy::default() },
        RetentionPolicy { keep_diagnostics: 5_000, ..RetentionPolicy::default() },
    ] {
        assert_eq!(apply_retention(&dir, &policy, true).unwrap_err().code, "RETENTION_INVALID");
    }
    let _ = std::fs::remove_dir_all(&dir);
}
