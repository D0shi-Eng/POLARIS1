// ضوابط حتمية حول خطة النموذج وتنفيذه (Phase-08): اكتمال الخطة، ومهمّة الاستكمال، والتذكير
// بالأداة. كلها تصوغ نصًّا أو عقدة؛ لا تنفّذ شيئًا ولا تمنح شيئًا. النموذج يقترح، والبوابة تقرّر.

use super::contract::{DeliverableFormat, MissionExecutionContract, RequirementKind};
use super::fulfilment::RequirementCheck;
use super::port::PlanProposal;

/// أقصى مهامّ استكمال لمهمّة واحدة: فجوة تبقى بعدها تُعلَن، لا تُطارَد بلا نهاية.
pub const MAX_CONTINUATIONS: u32 = 2;
/// إصلاح خطة واحد.
pub const MAX_PLAN_REPAIRS: u32 = 1;
/// تذكير واحد بالأداة لكل مهمّة فرعية.
pub const MAX_REMINDERS_PER_TASK: u32 = 1;

/// كلمات تدلّ على أن مهمّة في الخطة تتناول متطلَّبًا. مطابقة نصّية على أهداف الخطة وعناوينها.
fn cues(kind: &RequirementKind) -> Vec<String> {
    match kind {
        RequirementKind::Artifact { path, format } => {
            let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
            let mut words = vec![name];
            words.extend(format_words(*format).iter().map(|w| w.to_string()));
            words
        }
        RequirementKind::ChartIn { .. } => vec!["chart".into()],
        RequirementKind::ExecutedCode { .. } => vec!["python".into()],
        RequirementKind::TestsPassing => vec!["test".into()],
        RequirementKind::NetworkProposal => vec!["download".into(), "network".into(), "http".into(), "fetch".into()],
        RequirementKind::BrowserVisit { .. } => vec!["browser".into(), "open http".into(), "page".into()],
    }
}

fn format_words(format: DeliverableFormat) -> &'static [&'static str] {
    match format {
        DeliverableFormat::Xlsx => &["xlsx", "workbook", "spreadsheet", "excel"],
        DeliverableFormat::Pdf => &["pdf"],
        DeliverableFormat::Docx => &["docx", "word document"],
        DeliverableFormat::Pptx => &["pptx", "deck", "slides", "powerpoint"],
        DeliverableFormat::Zip => &["zip", "package", "archive"],
        _ => &[],
    }
}

/// متطلّبات العقد التي لا تتناولها أي مهمّة في الخطة.
pub fn uncovered_by_plan<'a>(contract: &'a MissionExecutionContract, plan: &PlanProposal) -> Vec<&'a super::contract::ContractRequirement> {
    let text: String = plan.tasks.iter().map(|t| format!("{} {}", t.title, t.objective).to_lowercase()).collect::<Vec<_>>().join("\n");
    contract.requirements.iter().filter(|r| !cues(&r.kind).iter().any(|c| text.contains(c.as_str()))).collect()
}

/// ملاحظة إصلاح الخطة: الفجوة كما قاسها زمن التشغيل، بلا إعادة اكتشاف المهمّة.
pub fn plan_repair_note(uncovered: &[&super::contract::ContractRequirement]) -> String {
    let mut out = String::from("PLAN_REPAIR: your previous plan has no task that produces or checks the following required results. Return the complete plan again (same JSON contract), adding or extending tasks so that every item below is covered:\n");
    for r in uncovered {
        out.push_str(&format!("- {}\n", r.description));
    }
    out
}

/// الأداة المسجّلة التي تناسب متطلَّبًا، إن وُجدت، لتُذكر في هدف الاستكمال (اسم مسجَّل، لا إذن).
fn tool_hint(kind: &RequirementKind) -> Option<&'static str> {
    match kind {
        RequirementKind::Artifact { format, .. } => match format {
            DeliverableFormat::Xlsx => Some("polaris.artifact.spreadsheet (a sheet chart is its \"chart\" field)"),
            DeliverableFormat::Pdf | DeliverableFormat::Docx => Some("polaris.artifact.document"),
            DeliverableFormat::Pptx => Some("polaris.artifact.presentation"),
            DeliverableFormat::Zip => Some("polaris.package.zip"),
            _ => Some("polaris.workspace.write"),
        },
        RequirementKind::ChartIn { .. } => Some("polaris.artifact.spreadsheet with a sheet \"chart\""),
        RequirementKind::ExecutedCode { .. } => Some("polaris.execution.python"),
        RequirementKind::TestsPassing => Some("polaris.execution.command running the project's tests (for example python -m unittest -v in the project folder)"),
        RequirementKind::NetworkProposal => Some("polaris.execution.python with \"network\": true (a human decides)"),
        RequirementKind::BrowserVisit { .. } => Some("polaris.browser.open"),
    }
}

/// هدف مهمّة الاستكمال: ما بقي فقط، مع الملفات الموجودة، والأدوات المناسبة.
pub fn continuation_objective(unmet: &[&RequirementCheck], files: &[String]) -> String {
    let mut out = String::from("Finish only what is still missing from this mission; the earlier tasks' work is in the workspace and must not be redone. Missing, as measured by POLARIS:\n");
    for c in unmet {
        let hint = tool_hint(&c.kind).map(|t| format!(" (suitable tool: {t})")).unwrap_or_default();
        out.push_str(&format!("- {} — {}{}\n", c.description, c.detail, hint));
    }
    if !files.is_empty() {
        out.push_str("Files that already exist: ");
        out.push_str(&files.iter().take(40).cloned().collect::<Vec<_>>().join(", "));
        out.push('\n');
    }
    out.push_str("Produce each missing result with a tool call and look at the tool results before you finish.");
    out
}

/// متطلّبات «فعل» لم يُحاوَل صنفها بعد في المهمّة (لا ملف ينقص بل خطوة لم تُقترح).
pub fn untried_action_requirements<'a>(unmet: &[&'a RequirementCheck]) -> Vec<&'a RequirementCheck> {
    unmet
        .iter()
        .copied()
        .filter(|c| matches!(c.kind, RequirementKind::NetworkProposal | RequirementKind::ExecutedCode { .. } | RequirementKind::BrowserVisit { .. } | RequirementKind::TestsPassing))
        .collect()
}

/// نصّ التذكير بالأداة. يسمّي المتطلَّب والأداة المسجّلة، ويترك القرار للنموذج والبوابة.
pub fn reminder(untried: &[&RequirementCheck]) -> String {
    let mut out = String::from("REMINDER: this mission still has an unmet requirement that needs an action you have not proposed yet:\n");
    for c in untried {
        let hint = tool_hint(&c.kind).map(|t| format!(" — registered tool: {t}")).unwrap_or_default();
        out.push_str(&format!("- {}{}\n", c.description, hint));
    }
    out.push_str("Choose an allowed registered tool for it, or explain in output_summary why it cannot be completed. Proposing does not run anything: POLARIS policy and, where needed, a human decide.");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p03::agent::AgentRole;
    use crate::p03::port::PlannedTask;
    use crate::p03::task::{DependencyKind, TaskType};

    fn plan(objectives: &[&str]) -> PlanProposal {
        PlanProposal {
            tasks: objectives
                .iter()
                .enumerate()
                .map(|(i, o)| PlannedTask { local_key: format!("t{i}"), title: format!("task {i}"), objective: o.to_string(), task_type: TaskType::Build, depends_on: Vec::new(), dependency_kind: DependencyKind::RequiresSuccess, recommended_role: AgentRole::Builder })
                .collect(),
        }
    }

    #[test]
    fn a_plan_that_forgets_the_zip_is_detected_and_the_repair_names_only_the_gap() {
        let contract = MissionExecutionContract::derive("Build outputs/site/index.html, validate it with Python and package the site as outputs/site.zip.");
        let weak = plan(&["write outputs/site/index.html", "validate links with python"]);
        let gap = uncovered_by_plan(&contract, &weak);
        assert_eq!(gap.len(), 1, "{gap:?}");
        assert!(gap[0].description.contains("outputs/site.zip"));
        let note = plan_repair_note(&gap);
        assert!(note.contains("PLAN_REPAIR") && note.contains("outputs/site.zip") && !note.contains("index.html"));
        let complete = plan(&["write outputs/site/index.html", "validate links with python", "package the site into a zip archive"]);
        assert!(uncovered_by_plan(&contract, &complete).is_empty());
    }

    #[test]
    fn mission_b_plan_must_cover_reading_analysis_workbook_chart_and_pdf() {
        let contract = MissionExecutionContract::derive("Analyse inputs/sales.csv with Python, produce outputs/s.xlsx with a bar chart and a PDF report outputs/s.pdf.");
        let gap = uncovered_by_plan(&contract, &plan(&["analyse the csv with python and build the xlsx workbook"]));
        let names: Vec<&str> = gap.iter().map(|r| r.description.as_str()).collect();
        assert!(names.iter().any(|d| d.contains("s.pdf")), "{names:?}");
        assert!(names.iter().any(|d| d.contains("chart")), "{names:?}");
    }

    #[test]
    fn the_continuation_asks_for_the_missing_output_only_and_names_the_tool() {
        let check = RequirementCheck { id: "R2".into(), description: "outputs/s.pdf exists in the workspace and re-opens as a valid PDF file".into(), satisfied: false, detail: "the file does not exist".into(), kind: RequirementKind::Artifact { path: "outputs/s.pdf".into(), format: DeliverableFormat::Pdf } };
        let text = continuation_objective(&[&check], &["outputs/s.xlsx".to_string()]);
        assert!(text.contains("outputs/s.pdf") && text.contains("polaris.artifact.document") && text.contains("outputs/s.xlsx"));
        assert!(text.contains("must not be redone"));
    }

    #[test]
    fn a_reminder_names_the_action_and_leaves_the_decision_to_policy() {
        let check = RequirementCheck { id: "R1".into(), description: "a network step was proposed so that a human can decide it".into(), satisfied: false, detail: String::new(), kind: RequirementKind::NetworkProposal };
        let untried = untried_action_requirements(&[&check]);
        assert_eq!(untried.len(), 1);
        let text = reminder(&untried);
        assert!(text.contains("network") && text.contains("does not run anything") && text.contains("explain"));
    }
}
