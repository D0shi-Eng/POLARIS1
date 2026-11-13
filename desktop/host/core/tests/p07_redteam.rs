// P07 — الفريق الأحمر: مدخلات يصنعها مهاجم محلّي يملك الكتابة في مجلد البيانات أو في
// مسار السياسة، ويحاول بها أن يزرع منطقًا أو يتسلّق خارج المجلد أو يوسّع حدًّا.
//
// كل هجوم هنا متّسق من داخله: البيان يطابق الملف الذي زرعه المهاجم، فالرفض يأتي من
// الطبقة التي يجب أن ترفض (بصمة المخطط، ونمط الاسم، والرابط)، لا من خطأ مصادفة.

mod p07_support;

use polaris_host_core::p07::backup::{create_backup, read_manifest, sha256_file, verify_backup, BackupReason, BackupManifest};
use polaris_host_core::p07::maintenance::execute;
use polaris_host_core::p07::policy::{load_policy, PolicyState};
use polaris_host_core::p07::restore::restore_backup;
use polaris_host_core::p07::schema;
use polaris_host_core::storage::lock::InstanceLock;
use polaris_host_core::storage::migrations;
use p07_support::{create_project, host, now, store, temp_dir};
use rusqlite::Connection;

/// يعيد كتابة البيان ليطابق ملفًا عدّله المهاجم: الخلاصة والحجم والبصمة كلها «صحيحة».
fn reseal(dir: &std::path::Path, manifest: &BackupManifest) {
    let backup_dir = dir.join("backups").join(&manifest.backup_id);
    let db = backup_dir.join("polaris.db");
    let (sha256, bytes) = sha256_file(&db).unwrap();
    let conn = Connection::open(&db).unwrap();
    let fingerprint = schema::fingerprint(&conn).unwrap();
    drop(conn);
    let mut resealed = manifest.clone();
    resealed.sha256 = sha256;
    resealed.bytes = bytes;
    resealed.schema_fingerprint = fingerprint;
    std::fs::write(backup_dir.join("manifest.json"), serde_json::to_string_pretty(&resealed).unwrap()).unwrap();
}

fn seeded_backup(name: &str) -> (std::path::PathBuf, BackupManifest) {
    let dir = temp_dir(name);
    {
        let h = host(&dir);
        create_project(&h, "victim data");
    }
    let manifest = create_backup(&dir, BackupReason::Manual, &now(), 7).unwrap().manifest;
    (dir, manifest)
}

#[test]
fn p07_redteam_a_resealed_backup_with_a_planted_trigger_is_refused_by_the_schema_fingerprint() {
    let (dir, manifest) = seeded_backup("trigger");
    let db = dir.join("backups").join(&manifest.backup_id).join("polaris.db");
    Connection::open(&db)
        .unwrap()
        .execute_batch("CREATE TRIGGER exfiltrate AFTER INSERT ON audit_events BEGIN UPDATE projects SET description = NEW.details_json; END;")
        .unwrap();
    reseal(&dir, &manifest);
    let error = verify_backup(&dir, &manifest.backup_id).unwrap_err();
    assert_eq!(error.code, "BACKUP_SCHEMA_MISMATCH", "{error}");
    let lock = InstanceLock::exclusive(&dir).unwrap();
    let before = std::fs::read(store(&dir)).unwrap();
    assert_eq!(restore_backup(&dir, &manifest.backup_id, &lock, &now()).unwrap_err().code, "BACKUP_SCHEMA_MISMATCH");
    assert_eq!(std::fs::read(store(&dir)).unwrap(), before);
    drop(lock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_redteam_a_resealed_backup_claiming_a_newer_schema_is_refused() {
    let (dir, manifest) = seeded_backup("newer");
    let db = dir.join("backups").join(&manifest.backup_id).join("polaris.db");
    Connection::open(&db).unwrap().pragma_update(None, "user_version", migrations::SUPPORTED_VERSION + 3).unwrap();
    reseal(&dir, &manifest);
    assert_eq!(verify_backup(&dir, &manifest.backup_id).unwrap_err().code, "STORE_SCHEMA_TOO_NEW");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_redteam_a_text_file_posing_as_a_backup_is_refused() {
    let (dir, manifest) = seeded_backup("posing");
    let backup_dir = dir.join("backups").join(&manifest.backup_id);
    std::fs::write(backup_dir.join("polaris.db"), b"MZ this is an executable, not a store".repeat(50)).unwrap();
    let (sha256, bytes) = sha256_file(&backup_dir.join("polaris.db")).unwrap();
    let mut forged = manifest.clone();
    forged.sha256 = sha256;
    forged.bytes = bytes;
    std::fs::write(backup_dir.join("manifest.json"), serde_json::to_string(&forged).unwrap()).unwrap();
    assert_eq!(verify_backup(&dir, &manifest.backup_id).unwrap_err().code, "STORE_CORRUPT");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_redteam_backup_ids_and_manifests_cannot_climb_out_of_the_data_folder() {
    let (dir, manifest) = seeded_backup("climb");
    for id in ["../../Windows", "..\\..\\Windows", "polaris-backup-../x", "", "polaris-backup-20260924185000Z-abcdef01/../../x"] {
        assert_eq!(verify_backup(&dir, id).unwrap_err().code, "BACKUP_PATH_REFUSED", "{id}");
        let (out, code) = execute(vec!["restore".into(), "--data-dir".into(), dir.clone().into_os_string(), "--backup".into(), id.into()]);
        assert_eq!((out["code"].as_str(), code), (Some("BACKUP_PATH_REFUSED"), 1), "{id}");
    }
    // بيان يسمّي نسخة أخرى، أو يحمل حقلًا زائدًا، أو يتضخّم.
    let path = dir.join("backups").join(&manifest.backup_id).join("manifest.json");
    let original = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, original.replacen(&manifest.backup_id, "polaris-backup-20000101000000Z-00000000", 1)).unwrap();
    assert_eq!(verify_backup(&dir, &manifest.backup_id).unwrap_err().code, "BACKUP_MANIFEST_INVALID");
    std::fs::write(&path, original.replacen("{", "{\"run_after_restore\": \"cmd.exe\",", 1)).unwrap();
    assert_eq!(read_manifest(&path).unwrap_err().code, "BACKUP_MANIFEST_INVALID");
    std::fs::write(&path, format!("{}{}", original, " ".repeat(70 * 1024))).unwrap();
    assert_eq!(read_manifest(&path).unwrap_err().code, "BACKUP_MANIFEST_INVALID");
    let _ = std::fs::remove_dir_all(&dir);
}

/// ينشئ رابطًا لمجلد: رابط رمزي على Unix، ونقطة وصل (junction) على Windows — لا تحتاج صلاحية مدير.
fn link_dir(target: &std::path::Path, link: &std::path::Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "the junction could not be created");
    }
}

#[test]
fn p07_redteam_a_backup_folder_that_is_a_link_to_another_place_is_refused() {
    let (dir, manifest) = seeded_backup("link");
    let outside = temp_dir("outside");
    let real = dir.join("backups").join(&manifest.backup_id);
    let moved = outside.join(&manifest.backup_id);
    std::fs::rename(&real, &moved).unwrap();
    link_dir(&moved, &real);
    assert_eq!(verify_backup(&dir, &manifest.backup_id).unwrap_err().code, "BACKUP_PATH_REFUSED");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&outside);
}

#[test]
fn p07_redteam_a_forged_policy_can_only_narrow_or_lock_down() {
    let dir = temp_dir("policy");
    let path = dir.join("managed-policy.json");
    let attempts = [
        // يحاول فتح الشبكة الخاصة للمتصفح (مقفل في البناء).
        r#"{"format":"polaris.managed-policy/1","policy_id":"x","settings":{"browser.private_network_allowed":true}}"#,
        // يحاول رفع حدٍّ فوق سقف البناء.
        r#"{"format":"polaris.managed-policy/1","policy_id":"x","settings":{"agents.max_concurrent_missions":999}}"#,
        // حقل «إذن كامل» خارج الصيغة.
        r#"{"format":"polaris.managed-policy/1","policy_id":"x","settings":{"privacy.allow_connector_egress":true},"grant":"all"}"#,
    ];
    for body in attempts {
        std::fs::write(&path, body).unwrap();
        let loaded = load_policy(Some(&path));
        assert_eq!(loaded.state, PolicyState::InvalidLockdown, "{body}");
        assert!(loaded.rows.iter().any(|r| r.key == "privacy.allow_connector_egress" && r.value == serde_json::Value::Bool(false)));
    }
    std::fs::write(&path, vec![b' '; 70 * 1024]).unwrap();
    assert_eq!(load_policy(Some(&path)).reason_code, Some("POLICY_TOO_LARGE"));
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir_all(&path).unwrap();
    assert_eq!(load_policy(Some(&path)).reason_code, Some("POLICY_UNREADABLE"));
    // وسياسة صالحة تطلب «أوسع» من الافتراضي لا توسّع: السياسة حدّ، والحدّ لا يرفع ما تحته.
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_redteam_maintenance_arguments_are_a_closed_vocabulary() {
    for args in [
        vec!["restore", "--data-dir"],
        vec!["verify", "--data-dir", "a", "--data-dir", "b"],
        vec!["verify", "--exec", "calc.exe"],
        vec!["delete-everything"],
        vec!["reset", "--data-dir", "."],
    ] {
        let (out, code) = execute(args.iter().map(|a| (*a).into()).collect());
        assert_eq!((out["ok"].as_bool(), code), (Some(false), 2), "{args:?} → {out}");
        assert_eq!(out["code"], "USAGE");
    }
}
