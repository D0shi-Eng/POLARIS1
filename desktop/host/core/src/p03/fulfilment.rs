// قياس الوفاء بعقد المهمّة (Phase-08): ما طُلب مقابل ما وُجد فعلًا.
//
// المصدر الوحيد هنا ما قاسه المضيف: ملف أُعيد فتحه في المساحة، ونداء أداة سُجِّل عند البوابة
// بحالته وآثاره وملخّص محوّلها الموثوق. قول النموذج «أنجزت» لا يدخل هذا القياس.

use serde::Serialize;

use super::contract::{ContractRequirement, MissionExecutionContract, RequirementKind};
use super::port::{ContractProbe, ToolRecordNote};

/// أدوات التشغيل التي قد تُشغِّل اختبارات، ويحمل ملخّصها وسم نتيجتها.
pub const TEST_CAPABLE_TOOLS: [&str; 2] = ["polaris.execution.python", "polaris.execution.command"];
/// الوسم الذي يضعه المحوّل الموثوق في ملخّص تشغيل اختبارات.
pub const TESTS_PASSED_TAG: &str = "tests: TESTS_PASSED";
pub const TESTS_FAILED_TAG: &str = "tests: TESTS_FAILED";

/// حكم متطلَّب واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RequirementCheck {
    pub id: String,
    pub description: String,
    pub satisfied: bool,
    pub detail: String,
    #[serde(skip)]
    pub kind: RequirementKind,
}

/// هل رفض إنسانٌ موافقةً في هذه المهمّة؟ حين يرفض لا يُعاد طلب ما رفضه باستكمال آلي.
pub fn human_denied(history: &[ToolRecordNote]) -> bool {
    history.iter().any(|r| r.denial_reason.as_deref() == Some("APPROVAL_DENIED"))
}

/// رفضٌ عند حدّ أمان أو سياسة (لا خطأ صياغة يصحّحه الوكيل): الشبكة، الأثر، النطاق، السرّ، المهارة.
/// (قِيس في انحدار Phase-05: متابعة بعد رفض سياسة أعادت الطلب المرفوض نفسه حتى نفدت الميزانية.)
pub const BOUNDARY_DENIALS: [&str; 9] = [
    "APPROVAL_DENIED",
    "NETWORK_POLICY_DENIED",
    "EFFECT_NOT_PERMITTED",
    "CROSS_MISSION_DENIED",
    "SECRET_REQUESTED",
    "CAPABILITY_MISSING",
    "SKILL_DOES_NOT_ALLOW_TOOL",
    "TOOL_DISABLED",
    "SKILL_DISABLED",
];

/// هل رفضت البوابة شيئًا في هذه المهمّة عند حدّ أمان أو سياسة؟ حينها لا يلاحق الاستكمال ما لم يتحقّق.
pub fn boundary_denied(history: &[ToolRecordNote]) -> bool {
    history.iter().any(|r| r.denial_reason.as_deref().is_some_and(|d| BOUNDARY_DENIALS.contains(&d)))
}

/// يقيس كل متطلَّب في العقد.
pub fn evaluate(contract: &MissionExecutionContract, mission_id: &str, probe: &dyn ContractProbe) -> Vec<RequirementCheck> {
    if contract.is_empty() {
        return Vec::new();
    }
    let history = probe.tool_history(mission_id);
    contract.requirements.iter().map(|r| check_one(r, mission_id, probe, &history)).collect()
}

fn check_one(requirement: &ContractRequirement, mission_id: &str, probe: &dyn ContractProbe, history: &[ToolRecordNote]) -> RequirementCheck {
    let (satisfied, detail) = match &requirement.kind {
        RequirementKind::Artifact { path, .. } => {
            let file = probe.inspect_file(mission_id, path);
            (file.exists && file.verified, if file.exists { file.detail } else { "the file does not exist".into() })
        }
        RequirementKind::ChartIn { path } => {
            let file = probe.inspect_file(mission_id, path);
            (file.exists && file.has_chart, if file.has_chart { "a chart part is present".into() } else { "no chart part was found".into() })
        }
        RequirementKind::ExecutedCode { tool_id } => {
            // تشغيل اختبارات Python عبر أداة الأوامر (unittest/pytest، بوسمها المقيس) تشغيلٌ لـPython أيضًا.
            let ran = history.iter().any(|r| r.status == "SUCCEEDED" && (&r.tool_id == tool_id || (tool_id == super::contract::TOOL_PYTHON && r.tool_id == "polaris.execution.command" && (r.summary.contains(TESTS_PASSED_TAG) || r.summary.contains(TESTS_FAILED_TAG)))));
            (ran, if ran { format!("{tool_id} ran") } else { format!("{tool_id} has not run successfully") })
        }
        RequirementKind::TestsPassing => {
            let last = history
                .iter()
                .rev()
                .find(|r| TEST_CAPABLE_TOOLS.contains(&r.tool_id.as_str()) && r.status == "SUCCEEDED" && (r.summary.contains(TESTS_PASSED_TAG) || r.summary.contains(TESTS_FAILED_TAG)));
            match last {
                Some(r) if r.summary.contains(TESTS_PASSED_TAG) => (true, "the latest test run passed".into()),
                Some(_) => (false, "the latest test run reported failing tests".into()),
                None => (false, "no test run has been measured".into()),
            }
        }
        RequirementKind::NetworkProposal => {
            let proposed = history.iter().any(|r| r.effects.iter().any(|e| e == "NETWORK_EGRESS") || r.status == "AWAITING_APPROVAL" || r.denial_reason.as_deref() == Some("APPROVAL_DENIED"));
            (proposed, if proposed { "a network step reached the approval path".into() } else { "no network step has been proposed".into() })
        }
        RequirementKind::BrowserVisit { .. } => {
            let opened = history.iter().any(|r| r.tool_id == "polaris.browser.open" && r.status == "SUCCEEDED");
            (opened, if opened { "the page was opened in the real browser".into() } else { "the page has not been opened in the browser".into() })
        }
    };
    RequirementCheck { id: requirement.id.clone(), description: requirement.description.clone(), satisfied, detail, kind: requirement.kind.clone() }
}

/// المتطلّبات غير المستوفاة وحدها.
pub fn unmet(checks: &[RequirementCheck]) -> Vec<&RequirementCheck> {
    checks.iter().filter(|c| !c.satisfied).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p03::port::FileInspection;
    use std::collections::BTreeMap;

    pub struct Probe {
        pub files: BTreeMap<String, FileInspection>,
        pub history: Vec<ToolRecordNote>,
    }

    impl ContractProbe for Probe {
        fn inspect_file(&self, _m: &str, path: &str) -> FileInspection {
            self.files.get(path).cloned().unwrap_or_default()
        }
        fn tool_history(&self, _m: &str) -> Vec<ToolRecordNote> {
            self.history.clone()
        }
        fn workspace_files(&self, _m: &str) -> Vec<String> {
            self.files.keys().cloned().collect()
        }
    }

    fn record(tool: &str, status: &str, summary: &str) -> ToolRecordNote {
        ToolRecordNote { invocation_id: "i".into(), task_id: "t".into(), tool_id: tool.into(), status: status.into(), denial_reason: None, effects: Vec::new(), summary: summary.into() }
    }

    #[test]
    fn a_missing_pdf_is_unmet_while_the_verified_workbook_is_met() {
        let contract = MissionExecutionContract::derive("Produce outputs/a.xlsx with a bar chart and a PDF report outputs/a.pdf using Python.");
        let mut files = BTreeMap::new();
        files.insert("outputs/a.xlsx".to_string(), FileInspection { exists: true, verified: true, has_chart: true, detail: "re-opened".into() });
        let probe = Probe { files, history: vec![record("polaris.execution.python", "SUCCEEDED", "PYTHON run SUCCEEDED")] };
        let checks = evaluate(&contract, "m", &probe);
        let missing: Vec<&str> = unmet(&checks).iter().map(|c| c.description.as_str()).collect();
        assert_eq!(missing.len(), 1, "{missing:?}");
        assert!(missing[0].contains("outputs/a.pdf"));
    }

    #[test]
    fn only_the_latest_measured_test_run_decides_and_a_model_claim_counts_for_nothing() {
        let contract = MissionExecutionContract::derive("Run the tests with python -m unittest in work/p/, fix the bug, rerun the tests until they pass.");
        let failing = record("polaris.execution.command", "SUCCEEDED", "POWERSHELL run FAILED (exit 1); tests: TESTS_FAILED (1 of 3 failed)");
        let passing = record("polaris.execution.command", "SUCCEEDED", "POWERSHELL run SUCCEEDED (exit 0); tests: TESTS_PASSED (3 run)");
        let tests_of = |history: Vec<ToolRecordNote>| {
            let probe = Probe { files: BTreeMap::new(), history };
            evaluate(&contract, "m", &probe).into_iter().find(|c| c.kind == RequirementKind::TestsPassing).unwrap().satisfied
        };
        assert!(!tests_of(vec![failing.clone()]), "a failing run satisfied the requirement");
        assert!(tests_of(vec![failing.clone(), passing.clone()]));
        assert!(!tests_of(vec![passing, failing]), "an older pass hid a newer failure");
        assert!(!tests_of(vec![record("polaris.workspace.write", "SUCCEEDED", "tests: TESTS_PASSED")]), "a tool that runs no tests satisfied the requirement");
    }

    #[test]
    fn a_network_proposal_counts_once_it_reaches_the_approval_path() {
        let contract = MissionExecutionContract::derive("Download https://example.org with Python and save the title to outputs/t.txt.");
        let mut awaiting = record("polaris.execution.python", "AWAITING_APPROVAL", "waits for a human decision");
        awaiting.effects = vec!["NETWORK_EGRESS".into()];
        let probe = Probe { files: BTreeMap::new(), history: vec![awaiting] };
        let checks = evaluate(&contract, "m", &probe);
        assert!(checks.iter().any(|c| c.kind == RequirementKind::NetworkProposal && c.satisfied));
        let mut denied = record("polaris.execution.python", "DENIED", "denied");
        denied.denial_reason = Some("APPROVAL_DENIED".into());
        assert!(human_denied(&[denied]));
    }
}
