// P07 — النسخ الاحتياطي والاستعادة على مجلد بيانات حقيقي ومضيف حقيقي.

mod p07_support;

use polaris_host_core::p07::backup::{create_backup, list_backups, prune_backups, verify_backup, BackupReason};
use polaris_host_core::p07::integrity::{check_file, CheckDepth, IntegrityState};
use polaris_host_core::p07::restore::restore_backup;
use polaris_host_core::storage::lock::InstanceLock;
use p07_support::{create_project, host, now, project_names, store, temp_dir};

#[test]
fn p07_backup_a_backup_of_a_running_store_is_verified_and_counts_its_rows() {
    let dir = temp_dir("live");
    let h = host(&dir);
    create_project(&h, "alpha");
    create_project(&h, "beta");
    // التطبيق يعمل ويحمل القفل المشترك: النسخ لا يحتاج الحصري.
    let outcome = create_backup(&dir, BackupReason::Manual, &now(), 7).unwrap();
    assert_eq!(outcome.manifest.tables.get("projects"), Some(&2));
    assert_eq!(outcome.manifest.schema_version, polaris_host_core::storage::migrations::SUPPORTED_VERSION);
    let verified = verify_backup(&dir, &outcome.manifest.backup_id).unwrap();
    assert_eq!(verified.manifest, outcome.manifest);
    assert_eq!(check_file(&verified.database, CheckDepth::Full).state, IntegrityState::Healthy);
    // لا مجلد جزئي يبقى بعد نجاح.
    let leftovers = std::fs::read_dir(dir.join("backups")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with(".partial")).count();
    assert_eq!(leftovers, 0);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_backup_retention_keeps_the_newest_and_never_the_last() {
    let dir = temp_dir("prune");
    drop(host(&dir));
    let mut ids = Vec::new();
    for _ in 0..4 {
        ids.push(create_backup(&dir, BackupReason::Manual, &now(), 100).unwrap().manifest.backup_id);
        // المعرّف يبدأ بالثانية: ثانية واحدة بين النسخ تجعل الترتيب زمنيًا لا عشوائيًا.
        std::thread::sleep(std::time::Duration::from_millis(1100));
    }
    let removed = prune_backups(&dir, 2).unwrap();
    assert_eq!(removed.len(), 2);
    let kept: Vec<String> = list_backups(&dir).unwrap().into_iter().map(|e| e.backup_id).collect();
    assert_eq!(kept, vec![ids[3].clone(), ids[2].clone()]);
    prune_backups(&dir, 0).unwrap();
    assert_eq!(list_backups(&dir).unwrap().len(), 1, "retention removed the last backup");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_restore_brings_back_a_backup_and_keeps_the_replaced_store_recoverable() {
    let dir = temp_dir("restore");
    {
        let h = host(&dir);
        create_project(&h, "in-backup");
    }
    let backup = create_backup(&dir, BackupReason::Manual, &now(), 7).unwrap().manifest.backup_id;
    {
        let h = host(&dir);
        create_project(&h, "after-backup");
    }
    let lock = InstanceLock::exclusive(&dir).unwrap();
    let outcome = restore_backup(&dir, &backup, &lock, &now()).unwrap();
    drop(lock);
    let pre = outcome.pre_restore_backup.clone().expect("the replaced healthy store was not backed up first");
    let quarantined = outcome.quarantined.clone().expect("the replaced store was not quarantined");
    assert!(dir.join("quarantine").join(&quarantined.folder).join("polaris.db").exists());
    {
        let h = host(&dir);
        assert_eq!(project_names(&h), vec!["in-backup".to_string()]);
    }
    // الاستعادة قابلة للتراجع: النسخة التي أُخذت قبلها تحمل ما كُتب بعد النسخة الأولى.
    let lock = InstanceLock::exclusive(&dir).unwrap();
    restore_backup(&dir, &pre, &lock, &now()).unwrap();
    drop(lock);
    let h = host(&dir);
    assert_eq!(project_names(&h), vec!["after-backup".to_string(), "in-backup".to_string()]);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_restore_a_tampered_backup_is_refused_before_anything_moves() {
    let dir = temp_dir("tampered");
    {
        let h = host(&dir);
        create_project(&h, "live");
    }
    let backup = create_backup(&dir, BackupReason::Manual, &now(), 7).unwrap();
    let file = backup.path.join("polaris.db");
    let mut bytes = std::fs::read(&file).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    std::fs::write(&file, bytes).unwrap();
    let before = std::fs::read(store(&dir)).unwrap();
    let lock = InstanceLock::exclusive(&dir).unwrap();
    let error = restore_backup(&dir, &backup.manifest.backup_id, &lock, &now()).unwrap_err();
    assert_eq!(error.code, "BACKUP_DIGEST_MISMATCH");
    assert_eq!(std::fs::read(store(&dir)).unwrap(), before, "a refused restore changed the live store");
    assert!(!dir.join("quarantine").exists());
    drop(lock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_restore_is_refused_while_the_application_runs() {
    let dir = temp_dir("running");
    let h = host(&dir);
    create_project(&h, "running");
    let backup = create_backup(&dir, BackupReason::Manual, &now(), 7).unwrap().manifest.backup_id;
    assert!(InstanceLock::exclusive(&dir).is_err(), "maintenance obtained the exclusive lock under a running application");
    let shared = InstanceLock::shared(&dir).unwrap();
    assert_eq!(restore_backup(&dir, &backup, &shared, &now()).unwrap_err().code, "DATA_DIR_IN_USE");
    drop(shared);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}
