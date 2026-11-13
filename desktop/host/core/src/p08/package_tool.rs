// أداة `polaris.package.zip`: تحزيم مجلد من مساحة المهمّة في أرشيف ZIP ثم التحقّق منه (Phase-08).
//
// لماذا أداة حتمية: قِيس في MISSION-D أن الموقع بُني ثم لم يُحزَّم، لأن التحزيم كان يعتمد على أن
// يتذكّر النموذج صيغة أمر صدفة. هنا: الأرشيف يُكتب بالكاتب الحتمي نفسه الذي يكتب حزم OOXML، ثم
// يُعاد فتحه ويُتحقّق من كل مدخل (CRC، الأسماء، الحجم) ومن أن كل ملف مصدر موجود فيه. الأثر كتابة
// داخل المساحة وحدها؛ لا شيء يُستخرج إلى القرص أبدًا.

use std::path::Path;

use serde_json::{json, Value};

use crate::p04::adapter::{reject_unknown_fields, ToolAdapter, ToolCallContext, ToolFailure, ToolOutcome};
use crate::p04::effect::ToolEffect;
use crate::p04::tool::ToolDescriptor;

use super::artifacts::zip::{is_safe_entry_name, read_zip, write_zip};
use super::execution::tools::descriptor;
use super::workspace::{Access, WorkspaceRoot, MAX_FILE_BYTES};

pub const TOOL_ZIP: &str = "polaris.package.zip";
const MAX_FILES: usize = 2_000;

pub struct ZipTool {
    pub workspaces: WorkspaceRoot,
}

/// نتيجة التحقّق من أرشيف أُعيد فتحه.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipCheck {
    pub entries: Vec<String>,
    pub missing: Vec<String>,
    pub bytes: u64,
}

/// يعيد فتح أرشيف ويقارن مدخلاته بالأسماء المتوقّعة. كل مدخل يُفحص CRC عند القراءة.
pub fn verify_zip(bytes: &[u8], expected: &[String]) -> Result<ZipCheck, String> {
    let entries = read_zip(bytes).map_err(|e| e.to_string())?;
    let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    let missing = expected.iter().filter(|n| !names.contains(n)).cloned().collect();
    Ok(ZipCheck { entries: names, missing, bytes: bytes.len() as u64 })
}

/// يجمع ملفات مجلد (بلا روابط) بأسماء نسبية بفواصل أمامية.
fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>, total: &mut u64) -> Result<(), ToolFailure> {
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(|e| ToolFailure::Unavailable(e.kind().to_string()))?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| ToolFailure::Unavailable(e.kind().to_string()))?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect(root, &path, out, total)?;
            continue;
        }
        let name = path.strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        if name.ends_with(".tmp") || !is_safe_entry_name(&name) {
            continue;
        }
        *total += meta.len();
        if out.len() >= MAX_FILES || *total > MAX_FILE_BYTES {
            return Err(ToolFailure::ArgumentsInvalid("the folder is larger than a package this tool writes".into()));
        }
        out.push((name, std::fs::read(&path).map_err(|e| ToolFailure::Unavailable(e.kind().to_string()))?));
    }
    Ok(())
}

impl ToolAdapter for ZipTool {
    fn tool_id(&self) -> &str {
        TOOL_ZIP
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_ZIP,
            "Package a workspace folder as a ZIP archive",
            r#"Packages every file of a workspace folder into a ZIP archive, then re-opens the archive and verifies each entry (CRC, safe names, all source files present). Arguments: source (relative folder, e.g. "outputs/site"), path (relative .zip to write, e.g. "outputs/site.zip"). Typical result: the archive path, its entry names and VERIFIED, or the reason it failed. Writes only inside the mission workspace."#,
            vec![ToolEffect::WorkspaceRead, ToolEffect::WorkspaceWrite],
        )
    }

    // R-21: المخطط يقول ما يقوله `validate`: مجلّد مصدر ومسار .zip، كلاهما نسبي داخل المساحة.
    fn input_schema(&self) -> Option<Value> {
        Some(serde_json::json!({
            "type": "object",
            "properties": {
                "source": { "type": "string", "description": "relative workspace folder to package, e.g. outputs/site" },
                "path": { "type": "string", "description": "relative .zip file to write, e.g. outputs/site.zip" }
            },
            "required": ["source", "path"],
            "additionalProperties": false
        }))
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["source", "path"])?;
        let source = arguments.get("source").and_then(Value::as_str).ok_or_else(|| ToolFailure::ArgumentsInvalid("source is required".into()))?;
        crate::p08::workspace::normalise_relative(source).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
        let path = arguments.get("path").and_then(Value::as_str).ok_or_else(|| ToolFailure::ArgumentsInvalid("path is required".into()))?;
        crate::p08::workspace::normalise_relative(path).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
        if !path.to_ascii_lowercase().ends_with(".zip") {
            return Err(ToolFailure::ArgumentsInvalid("path must name a .zip file".into()));
        }
        Ok(())
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        let workspace = self.workspaces.for_mission(context.mission_id).map_err(|e| ToolFailure::Unavailable(e.to_string()))?;
        let source_rel = arguments.get("source").and_then(Value::as_str).unwrap_or("");
        let target_rel = arguments.get("path").and_then(Value::as_str).unwrap_or("");
        let source = workspace.resolve(source_rel, Access::Read).map_err(|e| ToolFailure::OutOfScope(e.to_string()))?;
        if !source.is_dir() {
            return Err(ToolFailure::ArgumentsInvalid(format!("{source_rel} is not a folder in the workspace")));
        }
        let target = workspace.resolve(target_rel, Access::Write).map_err(|e| ToolFailure::OutOfScope(e.to_string()))?;
        if target.starts_with(&source) {
            return Err(ToolFailure::ArgumentsInvalid("the archive cannot be written inside the folder it packages".into()));
        }
        let mut files = Vec::new();
        let mut total = 0u64;
        collect(&source, &source, &mut files, &mut total)?;
        if files.is_empty() {
            return Err(ToolFailure::ArgumentsInvalid(format!("{source_rel} holds no files to package")));
        }
        let names: Vec<String> = files.iter().map(|(n, _)| n.clone()).collect();
        let bytes = write_zip(&files).map_err(|e| ToolFailure::Unavailable(e.to_string()))?;
        workspace.write(target_rel, &bytes).map_err(|e| ToolFailure::OutOfScope(e.to_string()))?;
        // إعادة الفتح من القرص، لا من الذاكرة: ما يُتحقَّق منه هو ما كُتب فعلًا.
        let written = workspace.read(target_rel, MAX_FILE_BYTES).map_err(|e| ToolFailure::Unavailable(e.to_string()))?;
        let check = verify_zip(&written, &names).map_err(ToolFailure::Unavailable)?;
        let verified = check.missing.is_empty() && check.entries.len() == names.len();
        let status = if verified { "VERIFIED" } else { "FAILED" };
        Ok(ToolOutcome {
            summary: format!("ZIP {target_rel} written from {source_rel} with {} entries and {}", check.entries.len(), status.to_lowercase()),
            measured_bytes: json!({ "path": target_rel, "entries": check.entries.len(), "bytes": check.bytes, "sha256": crate::digest::sha256_hex(&written), "verification": status }).to_string().into_bytes(),
            supports: verified,
            detail: format!("entries={} bytes={}", check.entries.len(), check.bytes),
            evidence: None,
            observation: Some(format!("path: {target_rel}\nverification: {status}\nentries: {}\n{}", check.entries.join(", "), if check.missing.is_empty() { String::new() } else { format!("missing: {}\n", check.missing.join(", ")) })),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p08::artifacts::zip::write_zip;

    #[test]
    fn a_written_archive_reopens_and_every_source_file_is_found() {
        let files = vec![("index.html".to_string(), b"<!doctype html><title>x</title>".to_vec()), ("css/style.css".to_string(), b"body{}".to_vec())];
        let bytes = write_zip(&files).unwrap();
        let check = verify_zip(&bytes, &["index.html".into(), "css/style.css".into()]).unwrap();
        assert!(check.missing.is_empty());
        assert_eq!(check.entries.len(), 2);
        let partial = verify_zip(&bytes, &["about.html".into()]).unwrap();
        assert_eq!(partial.missing, vec!["about.html".to_string()]);
        // أرشيف مبتور لا يمرّ سليمًا.
        assert!(verify_zip(&bytes[..bytes.len() - 10], &[]).is_err());
    }
}
