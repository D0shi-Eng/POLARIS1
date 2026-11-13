// أوامر أداة الصيانة: تحليل الوسائط وتنفيذ الأمر وإعادة مستند JSON.
//
// الأداة تعمل والتطبيق مغلق أو مفتوح: ما يقرأ فقط (الفحص، القائمة، التحقق، النسخ)
// يعمل دائمًا؛ وما يستبدل القاعدة (الاستعادة، إعادة الضبط، الترقية) يطلب القفل
// الحصري ويُرفض إن كان التطبيق يعمل. لا أمر يحذف بيانات مستخدم: القاعدة المستبدلة
// تُعزل، والتقليم يطال النسخ الزائدة والتشخيص القديم فقط.
//
// المنطق هنا لا في الملف التنفيذي، فيُختبر كما هو داخل العملية.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

use crate::storage::lock::{InstanceLock, LockError};
use crate::storage::{migrations, Database};

use super::backup::{create_backup, list_backups, verify_backup, BackupReason};
use super::error::{MaintenanceError, MaintenanceResult};
use super::integrity::{check_file, CheckDepth, IntegrityState};
use super::layout;
use super::policy::{load_policy, PolicyState};
use super::restore::{reset_store, restore_backup};
use super::retention::{apply_retention, RetentionPolicy, DEFAULT_KEEP_BACKUPS};
use super::schema;
use super::update::{verify_artifact, verify_signed_update, TrustedKey, PRODUCT_TRUSTED_KEYS};

pub const TOOL_NAME: &str = "polaris-maint";

pub const USAGE: &str = "usage: polaris-maint <command> [options]
  version
  verify          --data-dir DIR [--full]
  backup          --data-dir DIR [--keep N]
  list-backups    --data-dir DIR
  verify-backup   --data-dir DIR --backup ID
  restore         --data-dir DIR --backup ID          (the application must be closed)
  upgrade         --data-dir DIR                      (the application must be closed)
  reset           --data-dir DIR --confirm-reset      (moves the store to quarantine; deletes nothing)
  retention       --data-dir DIR [--keep-backups N] [--keep-diagnostics N] [--downloads-days N] [--apply]
  policy-check    --file PATH
  update-verify   --signed PATH [--artifact PATH] [--current-version V] [--trusted-key-id ID --trusted-key-hex HEX]";

/// وسائط محلَّلة: أمر، وأعلام بقيمة، وأعلام مجرّدة.
#[derive(Debug, Default)]
pub struct Arguments {
    pub command: String,
    pub values: BTreeMap<String, OsString>,
    pub switches: Vec<String>,
}

const VALUE_FLAGS: &[&str] = &[
    "--data-dir",
    "--keep",
    "--backup",
    "--keep-backups",
    "--keep-diagnostics",
    "--downloads-days",
    "--file",
    "--signed",
    "--artifact",
    "--current-version",
    "--trusted-key-id",
    "--trusted-key-hex",
];
const SWITCHES: &[&str] = &["--full", "--apply", "--confirm-reset"];

fn usage(detail: impl Into<String>) -> MaintenanceError {
    MaintenanceError::new("USAGE", detail)
}

pub fn parse_arguments(raw: Vec<OsString>) -> MaintenanceResult<Arguments> {
    let mut iter = raw.into_iter();
    let command = iter.next().map(|c| c.to_string_lossy().to_string()).ok_or_else(|| usage("no command"))?;
    let mut parsed = Arguments { command, ..Default::default() };
    while let Some(flag) = iter.next() {
        let flag = flag.to_string_lossy().to_string();
        if SWITCHES.contains(&flag.as_str()) {
            parsed.switches.push(flag);
        } else if VALUE_FLAGS.contains(&flag.as_str()) {
            let value = iter.next().ok_or_else(|| usage(format!("{flag} needs a value")))?;
            if parsed.values.insert(flag.clone(), value).is_some() {
                return Err(usage(format!("{flag} given twice")));
            }
        } else {
            return Err(usage(format!("unknown argument {flag}")));
        }
    }
    Ok(parsed)
}

impl Arguments {
    fn path(&self, flag: &str) -> MaintenanceResult<PathBuf> {
        self.values.get(flag).map(PathBuf::from).ok_or_else(|| usage(format!("{flag} is required")))
    }

    fn text(&self, flag: &str) -> Option<String> {
        self.values.get(flag).map(|v| v.to_string_lossy().to_string())
    }

    fn count(&self, flag: &str, default: usize) -> MaintenanceResult<usize> {
        match self.text(flag) {
            None => Ok(default),
            Some(text) => text.parse::<usize>().map_err(|_| usage(format!("{flag} must be a whole number"))),
        }
    }

    fn switch(&self, name: &str) -> bool {
        self.switches.iter().any(|s| s == name)
    }
}

fn data_dir(args: &Arguments) -> MaintenanceResult<PathBuf> {
    let dir = args.path("--data-dir")?;
    if !dir.is_dir() {
        return Err(MaintenanceError::new("DATA_DIR_MISSING", dir.display().to_string()));
    }
    Ok(dir)
}

fn exclusive(dir: &Path) -> MaintenanceResult<InstanceLock> {
    InstanceLock::exclusive(dir).map_err(|e| match e {
        LockError::Busy => MaintenanceError::new("DATA_DIR_IN_USE", "close POLARIS before this command"),
        LockError::Io(detail) => MaintenanceError::new("STORE_IO", detail),
    })
}

fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn now() -> String {
    crate::time::now_rfc3339_utc()
}

/// ينفّذ أمرًا ويعيد نتيجته. الخطأ برمز مغلق.
pub fn run(args: &Arguments) -> MaintenanceResult<Value> {
    match args.command.as_str() {
        "version" => Ok(json!({
            "product_version": env!("CARGO_PKG_VERSION"),
            "supported_schema": migrations::SUPPORTED_VERSION,
            "trusted_update_keys": PRODUCT_TRUSTED_KEYS.len(),
            "backup_format": super::backup::MANIFEST_FORMAT,
            "policy_format": super::policy::POLICY_FORMAT,
            "update_format": super::update::SIGNED_FORMAT,
        })),
        "verify" => verify_command(args),
        "backup" => {
            let dir = data_dir(args)?;
            let keep = args.count("--keep", DEFAULT_KEEP_BACKUPS)?;
            Ok(to_value(&create_backup(&dir, BackupReason::Manual, &now(), keep)?))
        }
        "list-backups" => Ok(json!({ "backups": to_value(&list_backups(&data_dir(args)?)?) })),
        "verify-backup" => {
            let dir = data_dir(args)?;
            let id = args.text("--backup").ok_or_else(|| usage("--backup is required"))?;
            Ok(to_value(&verify_backup(&dir, &id)?))
        }
        "restore" => {
            let dir = data_dir(args)?;
            let id = args.text("--backup").ok_or_else(|| usage("--backup is required"))?;
            let lock = exclusive(&dir)?;
            Ok(to_value(&restore_backup(&dir, &id, &lock, &now())?))
        }
        "upgrade" => upgrade_command(args),
        "reset" => {
            if !args.switch("--confirm-reset") {
                return Err(usage("reset needs --confirm-reset"));
            }
            let dir = data_dir(args)?;
            let lock = exclusive(&dir)?;
            Ok(json!({ "quarantined": to_value(&reset_store(&dir, &lock, &now())?) }))
        }
        "retention" => {
            let dir = data_dir(args)?;
            let downloads = match args.text("--downloads-days") {
                None => None,
                Some(t) => Some(t.parse::<u64>().map_err(|_| usage("--downloads-days must be a whole number"))?),
            };
            let policy = RetentionPolicy {
                keep_backups: args.count("--keep-backups", DEFAULT_KEEP_BACKUPS)?,
                keep_diagnostics: args.count("--keep-diagnostics", super::retention::DEFAULT_KEEP_DIAGNOSTICS)?,
                downloads_max_age_days: downloads,
            };
            Ok(to_value(&apply_retention(&dir, &policy, args.switch("--apply"))?))
        }
        "policy-check" => {
            let file = args.path("--file")?;
            let loaded = load_policy(Some(&file));
            if loaded.state == PolicyState::InvalidLockdown {
                let code = loaded.reason_code.unwrap_or("POLICY_INVALID");
                return Err(MaintenanceError::new(code, loaded.detail.unwrap_or_default()));
            }
            Ok(to_value(&loaded))
        }
        "update-verify" => update_command(args),
        other => Err(usage(format!("unknown command {other}"))),
    }
}

fn verify_command(args: &Arguments) -> MaintenanceResult<Value> {
    let dir = data_dir(args)?;
    let depth = if args.switch("--full") { CheckDepth::Full } else { CheckDepth::Quick };
    let store = layout::store_file(&dir);
    let integrity = check_file(&store, depth);
    let schema_check = if integrity.state == IntegrityState::Healthy {
        match Connection::open_with_flags(&store, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) {
            Ok(conn) => match schema::verify_schema(&conn) {
                Ok(version) => json!({ "matches_reference": true, "version": version }),
                Err(e) => json!({ "matches_reference": false, "code": e.code }),
            },
            Err(e) => json!({ "matches_reference": false, "code": "STORE_IO", "detail": e.to_string() }),
        }
    } else {
        Value::Null
    };
    let in_use = matches!(InstanceLock::exclusive(&dir), Err(LockError::Busy));
    let recovery = std::fs::read_to_string(dir.join(layout::RECOVERY_DIR).join(layout::LAST_RECOVERY_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok());
    Ok(json!({
        "integrity": to_value(&integrity),
        "schema": schema_check,
        "supported_schema": migrations::SUPPORTED_VERSION,
        "in_use": in_use,
        "backups": to_value(&list_backups(&dir)?),
        "last_recovery": recovery,
    }))
}

fn upgrade_command(args: &Arguments) -> MaintenanceResult<Value> {
    let dir = data_dir(args)?;
    let lock = exclusive(&dir)?;
    let store = layout::store_file(&dir);
    let before = check_file(&store, CheckDepth::Full);
    match before.state {
        IntegrityState::Healthy => {}
        IntegrityState::SchemaTooNew => return Err(MaintenanceError::new("STORE_SCHEMA_TOO_NEW", "the store is newer than this build")),
        IntegrityState::Missing | IntegrityState::Empty => return Err(MaintenanceError::new("STORE_MISSING", "there is no store to upgrade")),
        other => return Err(MaintenanceError::new("STORE_CORRUPT", format!("the store is {}", other.as_str()))),
    }
    let from = before.schema_version.unwrap_or(0);
    let backup = if from < migrations::SUPPORTED_VERSION {
        Some(create_backup(&dir, BackupReason::PreUpgrade, &now(), usize::MAX)?.manifest.backup_id)
    } else {
        None
    };
    // الترقية نفسها هي فتح المنتج للقاعدة: الترحيل نفسه، والنسخة قبل الترحيل نفسها.
    let db = Database::open_with_lock(&dir, lock).map_err(|e| MaintenanceError::new("STORE_SCHEMA_UNKNOWN", e.to_string()))?;
    let to = db.with(|c| migrations::current_version(c)).map_err(|e| MaintenanceError::new("STORE_IO", e.to_string()))?;
    drop(db);
    let after = check_file(&store, CheckDepth::Full);
    Ok(json!({ "from_version": from, "to_version": to, "pre_upgrade_backup": backup, "after": to_value(&after) }))
}

fn update_command(args: &Arguments) -> MaintenanceResult<Value> {
    let signed = args.path("--signed")?;
    let bytes = std::fs::read(&signed).map_err(|e| MaintenanceError::new("UPDATE_MANIFEST_INVALID", e.to_string()))?;
    let current = args.text("--current-version").unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    // مفتاح يُمرَّر وسيطًا للتحقق من خطّ التوقيع نفسه؛ يُعلَن مصدره ولا يُضاف إلى البناء.
    let argument_key = match (args.text("--trusted-key-id"), args.text("--trusted-key-hex")) {
        (Some(id), Some(hex)) => {
            let public_key = decode_key(&hex).ok_or_else(|| usage("--trusted-key-hex must be 64 hex characters"))?;
            Some((id, public_key))
        }
        (None, None) => None,
        _ => return Err(usage("--trusted-key-id and --trusted-key-hex go together")),
    };
    let trusted: Vec<TrustedKey> = match &argument_key {
        Some((id, public_key)) => vec![TrustedKey { key_id: id.clone().into(), public_key: *public_key }],
        None => PRODUCT_TRUSTED_KEYS.to_vec(),
    };
    let verified = verify_signed_update(&bytes, &trusted, &current)?;
    let artifact = match args.values.get("--artifact") {
        Some(path) => Some(to_value(&verify_artifact(&verified, Path::new(path))?)),
        None => None,
    };
    Ok(json!({
        "key_source": if argument_key.is_some() { "ARGUMENT" } else { "BUILD" },
        "key_id": verified.key_id,
        "version": verified.manifest.version,
        "channel": verified.manifest.channel,
        "artifacts": verified.manifest.artifacts.len(),
        "artifact_verified": artifact,
    }))
}

fn decode_key(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        out[i] = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(out)
}

/// ما يطبعه الملف التنفيذي: مستند واحد، ورمز خروج.
pub fn execute(raw: Vec<OsString>) -> (Value, i32) {
    let outcome = parse_arguments(raw).and_then(|args| run(&args).map(|result| (args.command.clone(), result)));
    match outcome {
        Ok((command, result)) => (json!({ "tool": TOOL_NAME, "ok": true, "command": command, "result": result }), 0),
        Err(error) => {
            let exit = if error.code == "USAGE" { 2 } else { 1 };
            (json!({ "tool": TOOL_NAME, "ok": false, "code": error.code, "detail": error.detail }), exit)
        }
    }
}
