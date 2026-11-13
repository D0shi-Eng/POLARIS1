// الاحتفاظ: ما يُقصّ، وما لا يُقصّ، ولماذا.
//
// القصّ يطال ما يعيد المنتج إنتاجه أو ما هو نسخة من غيره: النسخ الاحتياطية الزائدة
// عن العدد المحفوظ، وملفات التشخيص القديمة، والمجلدات الجزئية المتروكة. ولا يطال
// أبدًا: سجل التدقيق (سلسلته تنكسر بالحذف)، ولا المهام والأدلّة، ولا مجلد العزل
// (بيانات المستخدم التالفة لا تُحذف آليًا)، ولا التنزيلات المعزولة إلا بطلب صريح.
//
// جداول الأحداث واستدعاءات الموصلات محدودة أصلًا بإعدادات Phase-06، وهذا الملف
// يجرد حدودها ولا يكرّرها.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use super::backup::prune_backups;
use super::error::{MaintenanceError, MaintenanceResult};
use super::layout;

/// ما يحفظه الاحتفاظ افتراضيًا.
pub const DEFAULT_KEEP_BACKUPS: usize = 7;
pub const DEFAULT_KEEP_DIAGNOSTICS: usize = 20;
/// حدّ أعلى معقول: عدد أكبر ليس سياسة احتفاظ.
pub const MAX_KEEP: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    pub keep_backups: usize,
    pub keep_diagnostics: usize,
    /// التنزيلات المعزولة الأقدم من هذا العدد من الأيام تُحذف. `None`: لا تُلمس.
    pub downloads_max_age_days: Option<u64>,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self { keep_backups: DEFAULT_KEEP_BACKUPS, keep_diagnostics: DEFAULT_KEEP_DIAGNOSTICS, downloads_max_age_days: None }
    }
}

impl RetentionPolicy {
    pub fn validate(&self) -> MaintenanceResult<()> {
        if self.keep_backups == 0 || self.keep_backups > MAX_KEEP || self.keep_diagnostics > MAX_KEEP {
            return Err(MaintenanceError::new("RETENTION_INVALID", "keep counts must be within 1..=1000 (backups) and 0..=1000 (diagnostics)"));
        }
        if matches!(self.downloads_max_age_days, Some(0)) {
            return Err(MaintenanceError::new("RETENTION_INVALID", "a download age of zero days would delete everything"));
        }
        Ok(())
    }
}

/// جدول وحدّه كما يعلنه المنتج.
#[derive(Debug, Clone, Serialize)]
pub struct TableRetention {
    pub table: String,
    pub rows: Option<u64>,
    pub bound: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionReport {
    pub applied: bool,
    pub backups_removed: Vec<String>,
    pub diagnostics_removed: Vec<String>,
    pub downloads_removed: u64,
    pub quarantine_folders_kept: u64,
    pub tables: Vec<TableRetention>,
}

/// الجداول التي تنمو مع الاستعمال، وحدّ كل منها. جدول غير مُدرج هنا ينمو بقرار صريح.
const TABLE_BOUNDS: &[(&str, &str)] = &[
    ("obs_events", "BOUNDED_BY_SETTING observability.event_retention"),
    ("connector_invocations", "BOUNDED_BY_SETTING advanced.connector_invocation_retention"),
    ("audit_events", "NEVER_PRUNED hash chain integrity"),
    ("missions", "NEVER_PRUNED user work"),
    ("evidence", "NEVER_PRUNED user work"),
    ("usage_records", "NEVER_PRUNED budget and cost history"),
    ("mission_events", "UNBOUNDED_DECLARED mission timeline"),
    ("tool_invocations", "UNBOUNDED_DECLARED tool call history"),
    ("browser_actions", "UNBOUNDED_DECLARED browser action history"),
    ("computer_actions", "UNBOUNDED_DECLARED computer action history"),
    ("memory_access", "UNBOUNDED_DECLARED memory read history"),
];

fn table_inventory(data_dir: &Path) -> Vec<TableRetention> {
    let conn = Connection::open_with_flags(layout::store_file(data_dir), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok();
    TABLE_BOUNDS
        .iter()
        .map(|(table, bound)| {
            let rows = conn.as_ref().and_then(|c| {
                c.query_row(&format!("SELECT count(*) FROM \"{table}\""), [], |row| row.get::<_, i64>(0)).ok().map(|n| n.max(0) as u64)
            });
            TableRetention { table: (*table).into(), rows, bound }
        })
        .collect()
}

fn files_newest_first(dir: &Path, prefix: &str) -> Vec<std::path::PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<_> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
        .map(|e| e.path())
        .collect();
    // الاسم يحمل الختم الزمني، فالترتيب الأبجدي العكسي هو الأحدث أولًا.
    files.sort_by(|a, b| b.cmp(a));
    files
}

fn old_downloads(dir: &Path, max_age_days: u64) -> Vec<std::path::PathBuf> {
    let limit = std::time::Duration::from_secs(max_age_days.saturating_mul(86_400));
    let now = std::time::SystemTime::now();
    let mut out = Vec::new();
    let Ok(missions) = std::fs::read_dir(dir) else { return out };
    for mission in missions.flatten() {
        if layout::is_link(&mission.path()) {
            continue;
        }
        let Ok(files) = std::fs::read_dir(mission.path()) else { continue };
        for file in files.flatten() {
            let old = file
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|modified| now.duration_since(modified).ok())
                .is_some_and(|age| age > limit);
            if old && file.file_name().to_string_lossy().ends_with(".quarantine") {
                out.push(file.path());
            }
        }
    }
    out
}

/// يحسب ما سيُقصّ، ويقصّه إن طُلب. التشغيل الجاف هو الافتراضي في الأداة.
pub fn apply_retention(data_dir: &Path, policy: &RetentionPolicy, apply: bool) -> MaintenanceResult<RetentionReport> {
    policy.validate()?;
    let backups_removed = if apply {
        prune_backups(data_dir, policy.keep_backups)?
    } else {
        super::backup::list_backups(data_dir)?.into_iter().skip(policy.keep_backups).map(|e| e.backup_id).collect()
    };
    let diagnostics: Vec<_> = files_newest_first(&data_dir.join(layout::DIAGNOSTICS_DIR), "polaris-diagnostics-")
        .into_iter()
        .skip(policy.keep_diagnostics)
        .collect();
    let mut diagnostics_removed = Vec::new();
    for path in diagnostics {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if !apply || std::fs::remove_file(&path).is_ok() {
            diagnostics_removed.push(name);
        }
    }
    let mut downloads_removed = 0;
    if let Some(days) = policy.downloads_max_age_days {
        for path in old_downloads(&data_dir.join(layout::DOWNLOADS_DIR), days) {
            if !apply || std::fs::remove_file(&path).is_ok() {
                downloads_removed += 1;
            }
        }
    }
    let quarantine_folders_kept = std::fs::read_dir(data_dir.join(layout::QUARANTINE_DIR)).map(|e| e.flatten().count() as u64).unwrap_or(0);
    Ok(RetentionReport {
        applied: apply,
        backups_removed,
        diagnostics_removed,
        downloads_removed,
        quarantine_folders_kept,
        tables: table_inventory(data_dir),
    })
}
