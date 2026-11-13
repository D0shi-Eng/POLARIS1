// أداتا التنفيذ: `polaris.execution.command` (PowerShell) و`polaris.execution.python`.
//
// المسار الكامل لكل أمر: اقتراح الوكيل ← بوابة الأدوات (مخطط، قدرة `sandboxed_process`،
// سياسة، ميزانية) ← نقطة القرار هنا (`assess`: تصنيف الخطر، فتوسيع الآثار وإيجاب الموافقة
// لما يستحقّها) ← موافقة بشرية مربوطة بالحجج إن لزمت ← خدمة التنفيذ ← الصندوق ← نتيجة
// مقيسة ← دليل وتدقيق. لا يوجد في هذا الملف طريق يشغّل شيئًا خارج الصندوق.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::p04::adapter::{bounded, reject_unknown_fields, ToolAdapter, ToolAssessContext, ToolAssessment, ToolCallContext, ToolEvidenceNote, EvidenceNoteStance, ToolFailure, ToolOutcome};
use crate::p04::approval::ApprovalContext;
use crate::p04::effect::ToolEffect;
use crate::p04::tool::{NetworkPolicy, RiskClass, ToolDescriptor, ToolProvenance, ToolProvider, ToolTrustClass};

use super::super::workspace::Access;
use super::classify::{classify, CommandRisk};
use super::port::ExecutionLimits;
use super::service::{ExecutionResult, ExecutionService, RunSpec, Runtime};

pub const TOOL_COMMAND: &str = "polaris.execution.command";
pub const TOOL_PYTHON: &str = "polaris.execution.python";

const MAX_COMMAND: usize = 20_000;
const MAX_CODE: usize = 200_000;
const REGISTERED_AT: &str = "2026-09-25T00:00:00Z";

pub(crate) fn descriptor(tool_id: &str, name: &str, description: &str, effects: Vec<ToolEffect>) -> ToolDescriptor {
    ToolDescriptor {
        tool_id: tool_id.into(),
        provider: ToolProvider::BuiltIn,
        name: name.into(),
        description: description.into(),
        input_schema_ref: format!("{tool_id}.input.v1"),
        output_schema_ref: format!("{tool_id}.output.v1"),
        effects,
        required_capabilities: Vec::new(),
        risk: RiskClass::Moderate,
        requires_approval: false,
        network_policy: NetworkPolicy::None,
        enabled: true,
        trust_class: ToolTrustClass::TrustedRuntime,
        provenance: ToolProvenance {
            origin: "polaris.builtin".into(),
            server_id: None,
            server_name: None,
            declared_effects: Vec::new(),
            schema_digest: crate::digest::sha256_hex(tool_id.as_bytes()),
            registered_at: REGISTERED_AT.into(),
        },
    }
}

fn limits_from(arguments: &Value) -> ExecutionLimits {
    let mut limits = ExecutionLimits::DEFAULT;
    if let Some(seconds) = arguments.get("timeout_seconds").and_then(Value::as_u64) {
        limits.wall_time_ms = seconds.saturating_mul(1000);
    }
    limits.clamped()
}

fn optional_bool(arguments: &Value, name: &str) -> Result<bool, ToolFailure> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(ToolFailure::ArgumentsInvalid(format!("{name} must be a boolean"))),
    }
}

fn check_timeout(arguments: &Value) -> Result<(), ToolFailure> {
    match arguments.get("timeout_seconds") {
        None | Some(Value::Null) => Ok(()),
        Some(v) => match v.as_u64() {
            Some(n) if (1..=900).contains(&n) => Ok(()),
            _ => Err(ToolFailure::ArgumentsInvalid("timeout_seconds must be an integer between 1 and 900".into())),
        },
    }
}

/// المخاطر ← الآثار الإضافية وسياق الموافقة. خطر واحد يكفي لإيجاب الموافقة.
fn assessment_for(risks: &[CommandRisk], action: &str, preview: &str, agent_id: &str) -> ToolAssessment {
    if risks.is_empty() {
        return ToolAssessment::default();
    }
    let mut extra = vec![ToolEffect::ExternalSideEffect];
    if risks.contains(&CommandRisk::Network) {
        extra.push(ToolEffect::NetworkEgress);
    }
    ToolAssessment {
        extra_effects: extra,
        approval_context: Some(ApprovalContext {
            agent_id: agent_id.to_string(),
            action: action.to_string(),
            target: "the mission workspace (sandboxed)".into(),
            expected_effect: risks.iter().map(|r| r.as_str()).collect::<Vec<_>>().join(", "),
            risk: RiskClass::High,
            arguments_summary: bounded(preview, 300),
        }),
    }
}

/// نتيجة التشغيل ← نتيجة الأداة. نجاح الأداة يعني أن التشغيل تمّ وقِيس، لا أن الأمر نجح:
/// أمر خرج برمز غير صفري قياسٌ ناجح لواقع فاشل (`supports: false`).
fn outcome_of(result: &ExecutionResult, runs_tests: bool) -> Result<ToolOutcome, ToolFailure> {
    match result.status {
        "SANDBOX_UNAVAILABLE" => return Err(ToolFailure::Unavailable(result.stderr.clone())),
        "CANCELLED" => return Err(ToolFailure::Cancelled),
        _ => {}
    }
    let measured = serde_json::to_vec(&json!({
        "run_id": result.run_id,
        "status": result.status,
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
        "stdout_sha256": crate::digest::sha256_hex(result.stdout.as_bytes()),
        "stderr_sha256": crate::digest::sha256_hex(result.stderr.as_bytes()),
        "isolation": result.isolation,
    }))
    .unwrap_or_default();
    let exit = result.exit_code.map(|c| c.to_string()).unwrap_or_else(|| "none".into());
    let tests = if runs_tests { classify_tests(result) } else { None };
    let tests_note = tests.as_ref().map(|(passed, detail)| format!("; tests: {} ({detail})", if *passed { "TESTS_PASSED" } else { "TESTS_FAILED" })).unwrap_or_default();
    let summary = format!("{} run {} (exit {exit}) in {} ms, isolation {}{}{tests_note}", result.runtime.as_str(), result.status, result.duration_ms, result.isolation, result.limit.as_ref().map(|l| format!(", limit {l}")).unwrap_or_default());
    let mut observation = format!("status: {}\nexit_code: {exit}\n", result.status);
    if let Some((passed, detail)) = &tests {
        // تشغيل اختبارات أعاد رمزًا غير صفري قياسٌ ناجح لاختبارات فاشلة: ملاحظة تشخيص، لا فشل أداة.
        observation.push_str(&format!("outcome: EXECUTED, {} ({detail})\n", if *passed { "TESTS_PASSED" } else { "TESTS_FAILED — the run itself succeeded; read the failures below, fix the code and run the tests again" }));
    }
    if !result.stdout.is_empty() {
        observation.push_str(&format!("--- stdout ---\n{}\n", result.stdout));
    }
    if !result.stderr.is_empty() {
        observation.push_str(&format!("--- stderr ---\n{}\n", result.stderr));
    }
    if result.output_truncated {
        observation.push_str("(output truncated)\n");
    }
    if result.stderr.contains("ModuleNotFoundError") || result.stderr.contains("No module named") {
        // تلميح حتمي من زمن التشغيل (لا من محتوى الأداة): الحزم الخارجية غير مثبّتة، وللصيغ المكتبية أدوات.
        observation.push_str("note from POLARIS: only the Python standard library is installed in the sandbox. For XLSX, DOCX, PPTX or PDF output use polaris.artifact.spreadsheet, polaris.artifact.document or polaris.artifact.presentation with the computed values.\n");
    }
    Ok(ToolOutcome {
        summary,
        measured_bytes: measured,
        supports: result.succeeded(),
        detail: format!("run_id={} survivors={} processes={}", result.run_id, result.survivors, result.processes_total),
        evidence: Some(ToolEvidenceNote { kind: "EXECUTION_RESULT", stance: EvidenceNoteStance::Observed(bounded(&result.stdout, 2_000)) }),
        observation: Some(observation),
    })
}

/// `polaris.execution.command`: سكربت PowerShell داخل الصندوق.
pub struct CommandTool {
    pub service: Arc<ExecutionService>,
}

impl ToolAdapter for CommandTool {
    fn tool_id(&self) -> &str {
        TOOL_COMMAND
    }

    /// يُعرض حين يوجد صندوق وPowerShell فعلًا (مكافأة Manus 2026-10-19): أداة لا تعمل الآن تهدر نداءات النموذج.
    fn offered(&self) -> bool {
        self.service.available(Runtime::Powershell).is_ok()
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_COMMAND,
            "Run a PowerShell command in the sandbox",
            "Runs a Windows PowerShell script inside the mission's sandbox (AppContainer + Job Object), without network. The current location is the mission workspace (relative paths such as outputs\\report.txt resolve inside it; $W holds its absolute path). Arguments: command (string), optional timeout_seconds (1-900), optional working_directory (relative), optional network (boolean; needs approval). Returns exit code, stdout and stderr.",
            vec![ToolEffect::SandboxedExecution, ToolEffect::WorkspaceWrite, ToolEffect::WorkspaceRead],
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::command())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["command", "timeout_seconds", "working_directory", "network"])?;
        let command = arguments.get("command").and_then(Value::as_str).ok_or_else(|| ToolFailure::ArgumentsInvalid("command is required".into()))?;
        if command.trim().is_empty() || command.len() > MAX_COMMAND {
            return Err(ToolFailure::ArgumentsInvalid(format!("command must be 1..{MAX_COMMAND} bytes")));
        }
        check_timeout(arguments)?;
        optional_bool(arguments, "network")?;
        if let Some(dir) = arguments.get("working_directory") {
            let dir = dir.as_str().ok_or_else(|| ToolFailure::ArgumentsInvalid("working_directory must be a string".into()))?;
            crate::p08::workspace::normalise_relative(dir).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
        }
        Ok(())
    }

    fn assess(&self, arguments: &Value, context: &ToolAssessContext<'_>) -> Result<ToolAssessment, ToolFailure> {
        let command = arguments.get("command").and_then(Value::as_str).unwrap_or("");
        let risks = classify(command, optional_bool(arguments, "network")?);
        Ok(assessment_for(&risks, "EXECUTION_COMMAND", command, context.agent_id))
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        self.service.available(Runtime::Powershell).map_err(ToolFailure::Unavailable)?;
        let command = arguments.get("command").and_then(Value::as_str).unwrap_or("");
        let network = classify(command, optional_bool(arguments, "network")?).contains(&CommandRisk::Network);
        let workspace = self.service.workspaces().for_mission(context.mission_id).map_err(|e| ToolFailure::Unavailable(e.to_string()))?;
        let working_directory = match arguments.get("working_directory").and_then(Value::as_str) {
            Some(rel) => {
                let path = workspace.resolve(rel, Access::Read).map_err(|e| ToolFailure::OutOfScope(e.to_string()))?;
                std::fs::create_dir_all(&path).map_err(|e| ToolFailure::Unavailable(e.kind().to_string()))?;
                workspace.relative(&path).map(std::path::PathBuf::from)
            }
            None => None,
        };
        let mut limits = limits_from(arguments);
        limits.wall_time_ms = limits.wall_time_ms.min(context.timeout_ms.max(1_000));
        let result = self
            .service
            .run(RunSpec {
                mission_id: context.mission_id,
                task_id: context.task_id,
                tool_id: TOOL_COMMAND,
                runtime: Runtime::Powershell,
                source: command,
                script_path: None,
                arguments: Vec::new(),
                working_directory,
                limits,
                network,
                cancel: context.cancel,
            })
            .map_err(ToolFailure::Unavailable)?;
        outcome_of(&result, mentions_tests(command))
    }
}

/// `polaris.execution.python`: شيفرة Python أو ملف Python من المساحة، داخل الصندوق.
pub struct PythonTool {
    pub service: Arc<ExecutionService>,
}

impl ToolAdapter for PythonTool {
    fn tool_id(&self) -> &str {
        TOOL_PYTHON
    }

    /// يُعرض حين تكون بيئة Python مجهّزة (مكافأة Manus 2026-10-19). قِيس على تثبيت جديد أن النموذج نادى الأداة أربع مرات وكلها
    /// «the Python runtime has not been prepared» بدل أداة الجداول الأصلية المتاحة.
    /// DEF-35 (2026-10-29): تُعرض أيضًا حين توجد Python على الجهاز وتُعدّ عند أول نداء، فلا يبقى الوكيل بلا Python لأن زرًّا لم يُضغط.
    fn offered(&self) -> bool {
        self.service.python_offerable()
    }

    fn descriptor(&self) -> ToolDescriptor {
        descriptor(
            TOOL_PYTHON,
            "Run Python in the sandbox",
            "Runs Python code (code) or a Python file from the workspace (script, relative path) inside the mission's sandbox, without network. Only the Python standard library is available (third-party packages such as pandas, openpyxl or reportlab are not installed; installing one needs network and a human approval). To produce XLSX, DOCX, PPTX or PDF files use polaris.artifact.spreadsheet, polaris.artifact.document or polaris.artifact.presentation with the values you computed, not a Python library. Optional arguments (list of strings), timeout_seconds (1-900), network (boolean; needs approval). Typical result: exit code, stdout and stderr.",
            vec![ToolEffect::SandboxedExecution, ToolEffect::WorkspaceWrite, ToolEffect::WorkspaceRead],
        )
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        Some(crate::p08::tool_schemas::python())
    }

    fn validate(&self, arguments: &Value) -> Result<(), ToolFailure> {
        reject_unknown_fields(arguments, &["code", "script", "arguments", "timeout_seconds", "network"])?;
        let code = arguments.get("code").and_then(Value::as_str);
        let script = arguments.get("script").and_then(Value::as_str);
        match (code, script) {
            (Some(c), None) if !c.trim().is_empty() && c.len() <= MAX_CODE => {}
            (None, Some(s)) => {
                crate::p08::workspace::normalise_relative(s).map_err(|e| ToolFailure::ArgumentsInvalid(e.to_string()))?;
                if !s.to_ascii_lowercase().ends_with(".py") {
                    return Err(ToolFailure::ArgumentsInvalid("script must name a .py file".into()));
                }
            }
            _ => return Err(ToolFailure::ArgumentsInvalid(format!("exactly one of code (1..{MAX_CODE} bytes) or script is required"))),
        }
        if let Some(args) = arguments.get("arguments") {
            let list = args.as_array().ok_or_else(|| ToolFailure::ArgumentsInvalid("arguments must be a list".into()))?;
            if list.len() > 32 || list.iter().any(|a| a.as_str().is_none_or(|s| s.len() > 2_000 || s.contains('\0'))) {
                return Err(ToolFailure::ArgumentsInvalid("arguments must be at most 32 strings of at most 2000 bytes".into()));
            }
        }
        check_timeout(arguments)?;
        optional_bool(arguments, "network")?;
        Ok(())
    }

    fn assess(&self, arguments: &Value, context: &ToolAssessContext<'_>) -> Result<ToolAssessment, ToolFailure> {
        let text = arguments.get("code").and_then(Value::as_str).unwrap_or_else(|| arguments.get("script").and_then(Value::as_str).unwrap_or(""));
        let risks = classify(text, optional_bool(arguments, "network")?);
        Ok(assessment_for(&risks, "EXECUTION_PYTHON", text, context.agent_id))
    }

    fn execute(&self, arguments: &Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        self.service.ensure_python().map_err(ToolFailure::Unavailable)?;
        let workspace = self.service.workspaces().for_mission(context.mission_id).map_err(|e| ToolFailure::Unavailable(e.to_string()))?;
        let (source, script_path) = match arguments.get("script").and_then(Value::as_str) {
            Some(rel) => {
                let path = workspace.resolve(rel, Access::Read).map_err(|e| ToolFailure::OutOfScope(e.to_string()))?;
                let bytes = std::fs::read(&path).map_err(|_| ToolFailure::OutOfScope(format!("{rel} does not exist in the workspace")))?;
                (String::from_utf8_lossy(&bytes).into_owned(), Some(path))
            }
            None => (arguments.get("code").and_then(Value::as_str).unwrap_or("").to_string(), None),
        };
        // التصنيف على نصّ الملف نفسه أيضًا: ملف كتبه الوكيل قد يحمل ما لم يظهر في الحجج.
        let risks = classify(&source, optional_bool(arguments, "network")?);
        if !risks.is_empty() && arguments.get("script").is_some() {
            return Err(ToolFailure::NotPermitted(format!(
                "the script file requests {} which needs approval; pass its code in `code` so the approval covers what actually runs",
                risks.iter().map(|r| r.as_str()).collect::<Vec<_>>().join(", ")
            )));
        }
        let network = risks.contains(&CommandRisk::Network);
        let args: Vec<String> = arguments.get("arguments").and_then(Value::as_array).map(|l| l.iter().filter_map(|a| a.as_str().map(String::from)).collect()).unwrap_or_default();
        let mut limits = limits_from(arguments);
        limits.wall_time_ms = limits.wall_time_ms.min(context.timeout_ms.max(1_000));
        let result = self
            .service
            .run(RunSpec {
                mission_id: context.mission_id,
                task_id: context.task_id,
                tool_id: TOOL_PYTHON,
                runtime: Runtime::Python,
                source: &source,
                script_path,
                arguments: args,
                working_directory: None,
                limits,
                network,
                cancel: context.cancel,
            })
            .map_err(ToolFailure::Unavailable)?;
        outcome_of(&result, mentions_tests(&source))
    }
}

/// هل يشغّل النصّ اختبارات؟ مطابقة حرفية لأطر الاختبار الشائعة، بلا تفسير.
pub(crate) fn mentions_tests(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("unittest") || lower.contains("pytest")
}

/// يقرأ نتيجة الاختبارات من مخرجاتها المقيسة (unittest أو pytest)، وإلا من رمز الخروج.
/// التشغيل الذي انتهى بمهلة أو إلغاء أو حدّ لا يُصنَّف: لم تكتمل الاختبارات.
pub(crate) fn classify_tests(result: &ExecutionResult) -> Option<(bool, String)> {
    if !matches!(result.status, "SUCCEEDED" | "FAILED") {
        return None;
    }
    let text = format!("{}\n{}", result.stdout, result.stderr);
    let ran = text.lines().find_map(|l| l.trim().strip_prefix("Ran ").and_then(|r| r.split_whitespace().next()).and_then(|n| n.parse::<u32>().ok()));
    let tail: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if let Some(n) = ran {
        let failed_line = tail.iter().rev().find(|l| l.starts_with("FAILED (")).map(|l| l.to_string());
        let ok_line = tail.iter().rev().any(|l| *l == "OK" || l.starts_with("OK ("));
        return Some(match (ok_line, failed_line) {
            (_, Some(f)) => (false, format!("{n} run, {f}")),
            (true, None) if result.exit_code == Some(0) => (true, format!("{n} run, OK")),
            _ => (false, format!("{n} run, exit {}", result.exit_code.unwrap_or(-1))),
        });
    }
    if let Some(line) = tail.iter().rev().find(|l| (l.contains(" passed") || l.contains(" failed")) && l.contains(" in ")) {
        let passed = !line.contains(" failed") && !line.contains(" error") && result.exit_code == Some(0);
        return Some((passed, line.trim_matches('=').trim().to_string()));
    }
    // لم تظهر خلاصة إطار اختبار: ربما لم يُعثر على المفسّر أو الوحدة. يُعدّ فشلًا لا نجاحًا.
    Some((false, format!("no test summary in the output, exit {}", result.exit_code.unwrap_or(-1))))
}


#[cfg(test)]
mod test_outcome_tests {
    use super::*;

    fn run(status: &'static str, exit: i64, stdout: &str, stderr: &str) -> ExecutionResult {
        ExecutionResult { run_id: "r".into(), runtime: Runtime::Powershell, status, exit_code: Some(exit), duration_ms: 5, stdout: stdout.into(), stderr: stderr.into(), output_truncated: false, network: false, processes_total: 1, survivors: 0, isolation: "TEST".into(), limit: None }
    }

    #[test]
    fn failing_unittest_output_is_an_executed_diagnostic_not_a_tool_failure() {
        let failed = run("FAILED", 1, "", "test_average (test_stats.StatsTest) ... FAIL\n----------------------------------------------------------------------\nRan 3 tests in 0.001s\n\nFAILED (failures=2)\n");
        let outcome = outcome_of(&failed, true).expect("a completed run is a tool success");
        assert!(outcome.summary.contains("tests: TESTS_FAILED") && outcome.summary.contains("3 run"), "{}", outcome.summary);
        assert!(outcome.observation.unwrap().contains("the run itself succeeded"));
        let passed = run("SUCCEEDED", 0, "", "Ran 3 tests in 0.001s\n\nOK\n");
        assert!(outcome_of(&passed, true).unwrap().summary.contains("tests: TESTS_PASSED (3 run, OK)"));
        let pytest = run("FAILED", 1, "==== 1 failed, 2 passed in 0.05s ====\n", "");
        assert!(outcome_of(&pytest, true).unwrap().summary.contains("TESTS_FAILED"));
        // لا خلاصة إطار اختبار (المفسّر غير موجود مثلًا): ليس نجاحًا أبدًا.
        let missing = run("FAILED", 1, "", "python : The term 'python' is not recognized\n");
        assert!(outcome_of(&missing, true).unwrap().summary.contains("TESTS_FAILED"));
        // تشغيل لا يخصّ الاختبارات لا يحمل وسمًا.
        assert!(!outcome_of(&passed, false).unwrap().summary.contains("tests:"));
        assert!(mentions_tests("python -m unittest -v") && mentions_tests("pytest -q") && !mentions_tests("python app.py"));
    }
}
