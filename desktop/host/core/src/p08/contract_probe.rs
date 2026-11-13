// منفذ قياس عقد المهمّة في Phase-08: الملفات من مساحة المهمّة، والأدوات من سجلّ البوابة.
//
// قراءة فقط. الملف المطلوب يُعاد فتحه بمحقّق صيغته نفسه الذي يسجّل به المخرجات (OOXML، PDF، ZIP،
// CSV، JSON)؛ النصوص (HTML/CSS/JS/Markdown/Python) تكفيها UTF-8 غير فارغة. لا شيء هنا يكتب أو يمنح.

use std::sync::Arc;

use crate::p03::port::{ContractProbe, FileInspection, ToolRecordNote};
use crate::p04::service::Phase04;

use super::artifacts::verify::verify_file;
use super::artifacts::zip::read_zip;
use super::package_tool::verify_zip;
use super::workspace::{WorkspaceRoot, MAX_FILE_BYTES};

pub struct WorkspaceContractProbe {
    pub workspaces: WorkspaceRoot,
    pub phase04: Arc<Phase04>,
}

fn extension(path: &str) -> String {
    path.rsplit('.').next().unwrap_or("").to_ascii_lowercase()
}

/// يقيس ملفًّا واحدًا من بايتاته.
pub fn inspect_bytes(path: &str, bytes: &[u8]) -> FileInspection {
    let ext = extension(path);
    match ext.as_str() {
        "xlsx" | "docx" | "pptx" | "pdf" | "csv" | "json" => {
            let v = verify_file(path, bytes, &[], None);
            let has_chart = ext == "xlsx" && read_zip(bytes).is_ok_and(|entries| entries.iter().any(|e| e.name.starts_with("xl/charts/chart")));
            let failed: Vec<String> = v.checks.iter().filter(|c| !c.passed).map(|c| format!("{}: {}", c.name, c.detail)).collect();
            FileInspection { exists: true, verified: v.verified(), has_chart, detail: if failed.is_empty() { "re-opened and verified".into() } else { failed.join("; ") } }
        }
        "zip" => match verify_zip(bytes, &[]) {
            Ok(check) if !check.entries.is_empty() => FileInspection { exists: true, verified: true, has_chart: false, detail: format!("re-opened: {} entries", check.entries.len()) },
            Ok(_) => FileInspection { exists: true, verified: false, has_chart: false, detail: "the archive is empty".into() },
            Err(e) => FileInspection { exists: true, verified: false, has_chart: false, detail: e },
        },
        _ => {
            let text = std::str::from_utf8(bytes);
            let ok = text.is_ok_and(|t| !t.trim().is_empty());
            FileInspection { exists: true, verified: ok, has_chart: false, detail: if ok { format!("{} bytes of text", bytes.len()) } else { "empty or not UTF-8 text".into() } }
        }
    }
}

impl ContractProbe for WorkspaceContractProbe {
    fn inspect_file(&self, mission_id: &str, path: &str) -> FileInspection {
        let Ok(workspace) = self.workspaces.for_mission(mission_id) else { return FileInspection::default() };
        match workspace.read(path, MAX_FILE_BYTES) {
            Ok(bytes) => inspect_bytes(path, &bytes),
            Err(_) => FileInspection::default(),
        }
    }

    fn tool_history(&self, mission_id: &str) -> Vec<ToolRecordNote> {
        let mut records = self.phase04.repository.invocations(Some(mission_id), 500).unwrap_or_default();
        // الأقدم أولًا. الطوابع بدقّة الثانية؛ الترتيب داخل الثانية نفسها يتبع ترتيب السجلّ المعكوس.
        records.reverse();
        records
            .into_iter()
            .map(|r| ToolRecordNote {
                invocation_id: r.invocation_id,
                task_id: r.task_id,
                tool_id: r.tool_id,
                status: r.status.as_str().to_string(),
                denial_reason: r.denial_reason,
                effects: r.effects.iter().map(|e| e.as_str().to_string()).collect(),
                summary: r.summary,
            })
            .collect()
    }

    fn workspace_files(&self, mission_id: &str) -> Vec<String> {
        let Ok(workspace) = self.workspaces.for_mission(mission_id) else { return Vec::new() };
        workspace.list(None, 6).map(|entries| entries.into_iter().filter(|e| !e.is_dir).map(|e| e.path).take(200).collect()).unwrap_or_default()
    }

    /// بصمة ملف الآن (خطة 2026-10-07، ADR-041 §3.4).
    fn file_digest(&self, mission_id: &str, path: &str) -> Option<String> {
        let workspace = self.workspaces.for_mission(mission_id).ok()?;
        workspace.read(path, MAX_FILE_BYTES).ok().map(|bytes| crate::digest::sha256_hex(&bytes))
    }

    /// بصمات inputs/ كما أُخذت عند أول طلب للمهمّة، في المخزن خارج المساحة. الطلب الأول يأخذها، ولا تُستبدل بعده.
    fn protected_files(&self, mission_id: &str) -> Vec<(String, String)> {
        let db = self.phase04.repository.db();
        let stored = |db: &crate::storage::Database| -> Vec<(String, String)> {
            db.with(|conn| {
                let mut stmt = conn.prepare("SELECT path, sha256 FROM protected_files WHERE mission_id = ?1 ORDER BY path")?;
                let rows = stmt.query_map([mission_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
        };
        let existing: Vec<(String, String)> = stored(db).into_iter().filter(|(p, _)| p != "(none)").collect();
        let taken: bool = db.with(|conn| Ok(conn.query_row("SELECT count(*) FROM protected_files WHERE mission_id = ?1", [mission_id], |r| r.get::<_, i64>(0))? > 0)).unwrap_or(false);
        if taken {
            return existing;
        }
        let Ok(workspace) = self.workspaces.for_mission(mission_id) else { return Vec::new() };
        let files: Vec<String> = workspace.list(Some(super::workspace::INPUTS), 6).map(|entries| entries.into_iter().filter(|e| !e.is_dir).map(|e| e.path).take(200).collect()).unwrap_or_default();
        let now = crate::time::now_rfc3339_utc();
        let mut out = Vec::new();
        for path in files {
            if let Ok(bytes) = workspace.read(&path, MAX_FILE_BYTES) {
                let digest = crate::digest::sha256_hex(&bytes);
                let _ = db.with(|conn| {
                    conn.execute("INSERT OR IGNORE INTO protected_files (mission_id, path, sha256, taken_at) VALUES (?1, ?2, ?3, ?4)", rusqlite::params![mission_id, path, digest, now])?;
                    Ok(())
                });
                out.push((path, digest));
            }
        }
        // مساحة بلا مرفقات تُسجَّل بعلامة «أُخذت ولا شيء»، فلا يُعاد الأخذ لاحقًا بعد أن يعمل الوكيل.
        if out.is_empty() {
            let _ = db.with(|conn| {
                conn.execute("INSERT OR IGNORE INTO protected_files (mission_id, path, sha256, taken_at) VALUES (?1, '(none)', ?2, ?3)", rusqlite::params![mission_id, "0".repeat(64), now])?;
                Ok(())
            });
        }
        out
    }

    /// النصّ المستخرج من مخرَج، بالمستخرِج نفسه الذي تقرأ به أداة القراءة (DOCX/PDF/PPTX/XLSX/نصّ).
    fn file_text(&self, mission_id: &str, path: &str) -> Option<String> {
        let workspace = self.workspaces.for_mission(mission_id).ok()?;
        let bytes = workspace.read(path, MAX_FILE_BYTES).ok()?;
        super::artifacts::extract::extract(path, &bytes).ok().map(|t| t.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p08::artifacts::spec::{CellValue, SheetChart, SheetSpec, WorkbookSpec, ChartKind};
    use crate::p08::artifacts::xlsx::write_xlsx;

    #[test]
    fn a_workbook_with_a_chart_is_seen_as_verified_with_a_chart_and_text_needs_content() {
        let book = WorkbookSpec {
            title: "Sales".into(),
            sheets: vec![SheetSpec {
                name: "Totals".into(),
                header: vec!["Region".into(), "Total".into()],
                rows: vec![vec![CellValue::Text("Riyadh".into()), CellValue::Number(895.0)]],
                chart: Some(SheetChart { title: "Totals".into(), kind: ChartKind::Bar, value_columns: vec![1] }),
            }],
        };
        let bytes = write_xlsx(&book, "2026-09-28T00:00:00Z").unwrap();
        let seen = inspect_bytes("outputs/s.xlsx", &bytes);
        assert!(seen.exists && seen.verified && seen.has_chart, "{seen:?}");
        assert!(!inspect_bytes("outputs/a.md", b"   ").verified);
        assert!(inspect_bytes("outputs/site/index.html", b"<html></html>").verified);
        assert!(!inspect_bytes("outputs/x.zip", b"not a zip").verified);
    }
}
