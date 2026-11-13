// P07 — الترقية من كل مخطط أقدم إلى المخطط الذي يفهمه البناء، بمسار المنتج نفسه.
//
// القاعدة القديمة تُبنى بالترحيلات نفسها حتى إصدارها (لا مخطط مكتوب باليد يدّعي أنه
// v1)، ثم تُكتب فيها صفوف، ثم يفتحها المنتج كما يفتح قاعدة مستخدم بعد تحديث.

mod p07_support;

use polaris_host_core::p07::backup::verify_backup;
use polaris_host_core::p07::integrity::{check_file, CheckDepth, IntegrityState};
use polaris_host_core::p07::maintenance::{execute, parse_arguments, run};
use polaris_host_core::p07::schema::verify_schema;
use polaris_host_core::storage::{migrations, Database, StorageError};
use p07_support::{bare_host, host, project_names, store, temp_dir};
use rusqlite::Connection;

fn legacy_store(dir: &std::path::Path, version: i64, project: &str) {
    let mut conn = Connection::open(store(dir)).unwrap();
    migrations::apply_up_to(&mut conn, version).unwrap();
    // من v16 (ADR-040) لا عمود لسياسة السياق؛ قبلها كان إلزاميًّا.
    let sql = if version >= 16 {
        "INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, version, created_at, updated_at)
         VALUES (?1, ?2, '', 'ACTIVE', 'ar', NULL, NULL, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    } else {
        "INSERT INTO projects (project_id, name, description, status, language, workspace_root, default_model_id, context_policy, version, created_at, updated_at)
         VALUES (?1, ?2, '', 'ACTIVE', 'ar', NULL, NULL, 'LOCAL_ONLY', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
    };
    conn.execute(
        sql,
        // الإصدار برقمين: من v10 صار «1111111{version}» تسعة محارف فلم يعد المعرّف UUID صالحًا (قِيس 2026-10-01).
        rusqlite::params![format!("111111{version:02}-1111-4111-8111-111111111111"), project],
    )
    .unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), version);
}

#[test]
fn p07_migration_every_older_schema_upgrades_through_the_product_with_its_rows() {
    for version in 1..migrations::SUPPORTED_VERSION {
        let dir = temp_dir(&format!("legacy-v{version}"));
        legacy_store(&dir, version, &format!("مشروع v{version}"));
        let h = host(&dir);
        assert_eq!(project_names(&h), vec![format!("مشروع v{version}")], "rows of a v{version} store did not survive the upgrade");
        let db = h.host().phase02().unwrap().db.clone();
        let schema = db.with(|c| Ok(verify_schema(c).map_err(|e| StorageError::Invalid(e.to_string())))).unwrap();
        assert_eq!(schema.unwrap(), migrations::SUPPORTED_VERSION, "v{version} upgraded to a schema unlike a fresh store");
        drop(h);
        // النسخة التي أخذها الفتح قبل الترحيل موجودة، بإصدارها القديم وسليمة.
        let pre = dir.join(format!("polaris.db.backup-v{version}"));
        let report = check_file(&pre, CheckDepth::Full);
        assert_eq!((report.state, report.schema_version), (IntegrityState::Healthy, Some(version)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn p07_migration_a_failed_step_leaves_the_older_store_and_its_rows_intact() {
    let dir = temp_dir("failed-step");
    legacy_store(&dir, 1, "survivor");
    {
        // جدول يحمل اسمًا ينشئه v2: خطوة v2 تفشل، ومعاملتها تُرجع كلها.
        let conn = Connection::open(store(&dir)).unwrap();
        conn.execute_batch("CREATE TABLE missions (x INTEGER);").unwrap();
    }
    let error = Database::open(&dir).err().expect("a failing migration opened");
    assert!(matches!(error, StorageError::Migration(_)), "{error:?}");
    let conn = Connection::open(store(&dir)).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), 1);
    let kept: String = conn.query_row("SELECT name FROM projects", [], |r| r.get(0)).unwrap();
    assert_eq!(kept, "survivor");
    drop(conn);
    // والمنتج يُعلن المخزن غير متاح بدل أن يعمل على نصف ترحيل.
    assert!(bare_host(&dir).phase02().is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p07_migration_the_maintenance_upgrade_takes_a_verified_pre_upgrade_backup() {
    let dir = temp_dir("maint-upgrade");
    legacy_store(&dir, 3, "v3 project");
    let args = parse_arguments(vec!["upgrade".into(), "--data-dir".into(), dir.clone().into_os_string()]).unwrap();
    let result = run(&args).unwrap();
    assert_eq!(result["from_version"], 3);
    assert_eq!(result["to_version"], migrations::SUPPORTED_VERSION);
    let backup = result["pre_upgrade_backup"].as_str().unwrap().to_string();
    let verified = verify_backup(&dir, &backup).unwrap();
    assert_eq!(verified.manifest.schema_version, 3, "the pre-upgrade backup is not the old schema");
    assert_eq!(verified.manifest.tables.get("projects"), Some(&1));
    // وترقية ثانية لا تفعل شيئًا ولا تأخذ نسخة.
    let (again, code) = execute(vec!["upgrade".into(), "--data-dir".into(), dir.clone().into_os_string()]);
    assert_eq!(code, 0);
    assert!(again["result"]["pre_upgrade_backup"].is_null());
    let _ = std::fs::remove_dir_all(&dir);
}
