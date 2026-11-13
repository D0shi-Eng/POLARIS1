// P07 — الاسترداد: انهيار العملية، وقاعدة تالفة عند الإقلاع، ومثيل آخر يعمل.
//
// الانهيار حقيقي: عملية ابنة (هذا الملف التنفيذي نفسه) تفتح المنتج، تلتزم بصف، تبدأ
// معاملة ثانية وتكتب فيها، ثم تعلن جاهزيتها وتنتظر. العملية الأمّ تقتلها قتلًا صلبًا
// (`Child::kill`: TerminateProcess على Windows، وSIGKILL على Unix) بلا إغلاق ولا تنظيف،
// ثم تفتح المجلد بالمنتج الحقيقي وتقرأ ما بقي.

mod p07_support;

use std::process::Command;

use polaris_host_core::p07::integrity::{check_file, CheckDepth, IntegrityState};
use polaris_host_core::p07::recovery::{guard, RecoveryAction};
use polaris_host_core::storage::lock::InstanceLock;
use p07_support::{bare_host, corrupt_pages, create_project, host, now, project_names, store, temp_dir};

const CRASH_DIR_ENV: &str = "POLARIS_P07_CRASH_DIR";

/// مدخل العملية الابنة. خارج العملية الابنة (بلا المتغيّر) لا يفعل شيئًا ولا يُعدّ في
/// أي مجموعة Phase-07: اسمه لا يبدأ بـ `p07_`.
#[test]
fn crash_child_process_entry() {
    let Ok(dir) = std::env::var(CRASH_DIR_ENV) else { return };
    let dir = std::path::PathBuf::from(dir);
    let h = host(&dir);
    create_project(&h, "committed-before-crash");
    let db = h.host().phase02().unwrap().db.clone();
    let _: Result<(), polaris_host_core::storage::StorageError> = db.with(|c| {
        c.execute_batch(
            "BEGIN IMMEDIATE;
             INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, version, created_at, updated_at)
             VALUES ('0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', 'uncommitted-at-crash', '', 'ACTIVE', 'en', NULL, NULL, 1, 't', 't');",
        )?;
        // لا COMMIT ولا ROLLBACK ولا إغلاق: المعاملة مفتوحة حين تُقتل العملية.
        std::fs::write(dir.join("child-ready"), b"ready").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(120));
        Ok(())
    });
    panic!("the child process was not killed");
}

#[test]
fn p07_recovery_a_process_crash_keeps_committed_rows_and_loses_only_the_open_transaction() {
    let dir = temp_dir("crash");
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["crash_child_process_entry", "--exact", "--nocapture", "--test-threads=1"])
        .env(CRASH_DIR_ENV, &dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("the child process did not start");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while !dir.join("child-ready").exists() {
        assert!(std::time::Instant::now() < deadline, "the child never reached its open transaction");
        if let Ok(Some(status)) = child.try_wait() {
            panic!("the child exited before its open transaction: {status:?}");
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    child.kill().expect("the child could not be killed");
    let status = child.wait().unwrap();
    assert!(!status.success(), "the child was expected to die by kill, it exited with {status:?}");
    // ما بعد الانهيار: الملف سليم، والمعاملة المفتوحة لم تُكتب، والملتزم بقي.
    assert_eq!(check_file(&store(&dir), CheckDepth::Full).state, IntegrityState::Healthy);
    let h = host(&dir);
    assert_eq!(project_names(&h), vec!["committed-before-crash".to_string()]);
    let report = h.host().phase02().unwrap().recovery.clone().unwrap();
    assert_eq!(report.action, RecoveryAction::None, "a crash is not damage: nothing was quarantined");
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_recovery_a_corrupt_store_is_quarantined_and_the_latest_verified_backup_restored_at_startup() {
    let dir = temp_dir("corrupt");
    {
        let h = host(&dir);
        create_project(&h, "before-backup");
        // عشرات الصفوف تجعل الملف أكبر من صفحتين، فالإفساد يطال بيانات حقيقية.
        for i in 0..40 {
            create_project(&h, &format!("bulk-{i:02}"));
        }
    }
    let backup = polaris_host_core::p07::backup::create_backup(&dir, polaris_host_core::p07::backup::BackupReason::Manual, &now(), 7).unwrap();
    {
        let h = host(&dir);
        create_project(&h, "after-backup");
    }
    corrupt_pages(&store(&dir));
    assert!(check_file(&store(&dir), CheckDepth::Quick).state.damaged());

    let h = host(&dir);
    let p02 = h.host().phase02().expect("the store was not recovered");
    let report = p02.recovery.clone().unwrap();
    assert_eq!(report.action, RecoveryAction::RestoredFromBackup, "{report:?}");
    assert_eq!(report.restored_backup.as_deref(), Some(backup.manifest.backup_id.as_str()));
    let names = project_names(&h);
    assert!(names.contains(&"before-backup".to_string()));
    assert!(!names.contains(&"after-backup".to_string()), "a row written after the backup cannot come back from it");
    // الملف التالف لم يُحذف: عُزل كما هو.
    let quarantined = report.quarantined.clone().unwrap();
    let folder = dir.join("quarantine").join(&quarantined.folder);
    assert!(folder.join("polaris.db").exists(), "the damaged store was not kept in quarantine");
    assert!(dir.join("recovery").join("last-recovery.json").exists());
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_recovery_a_damaged_store_without_a_backup_fails_closed_and_is_left_untouched() {
    let dir = temp_dir("no-backup");
    let garbage = b"not a database, and there is no backup to restore".repeat(200);
    std::fs::write(store(&dir), &garbage).unwrap();
    let h = bare_host(&dir);
    assert!(h.phase02().is_none(), "a damaged store was opened as if it were healthy");
    assert!(h.phase06().is_none());
    assert_eq!(std::fs::read(store(&dir)).unwrap(), garbage, "the damaged store was modified");
    assert!(!dir.join("quarantine").exists(), "nothing may move without a backup to replace it");
    let report: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("recovery").join("last-recovery.json")).unwrap()).unwrap();
    assert_eq!(report["action"], "FAILED_CLOSED");
    assert_eq!(report["reason_code"], "STORE_NOT_A_DATABASE_NO_VERIFIED_BACKUP");
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_recovery_a_store_damaged_while_another_instance_runs_is_not_touched() {
    let dir = temp_dir("in-use");
    let running = InstanceLock::shared(&dir).unwrap();
    let garbage = b"damaged under a running instance".repeat(300);
    std::fs::write(store(&dir), &garbage).unwrap();
    let guarded = guard(&dir, &now()).unwrap();
    assert_eq!(guarded.report.action, RecoveryAction::FailedClosed);
    assert!(!guarded.report.exclusive);
    assert_eq!(guarded.report.reason_code, "STORE_DAMAGED_WHILE_IN_USE");
    assert_eq!(std::fs::read(store(&dir)).unwrap(), garbage);
    drop(guarded);
    drop(running);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_recovery_a_healthy_start_writes_no_report_and_holds_the_instance_lock() {
    let dir = temp_dir("healthy");
    let h = host(&dir);
    assert_eq!(h.host().phase02().unwrap().recovery.clone().unwrap().action, RecoveryAction::None);
    assert!(!dir.join("recovery").exists(), "a healthy start wrote a recovery report");
    assert!(InstanceLock::exclusive(&dir).is_err(), "the running application does not hold the instance lock");
    drop(h);
    assert!(InstanceLock::exclusive(&dir).is_ok(), "the lock outlived the application");
    let _ = std::fs::remove_dir_all(&dir);
}
