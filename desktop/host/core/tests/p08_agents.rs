// P08-AGENTS — تنسيق الوكلاء: المقيِّم يرى العمل، والتعديل يحمل سببه، والتفويض يعيد نتيجته، والمخطّط يُسمع.
//
// قِيس 2026-10-01 في الشيفرة (لا في تشغيل): المراجِع كان يتلقّى «راجع مخرجات المهمّة <معرّف>» وحده، وملاحظاته
// تُرمى عند «REVISE»؛ ونتيجة الزميل المفوَّض تُنشر على الناقل ولا يقرؤها أحد؛ ودور المخطّط المقترح يُهمَل. كل
// اختبار هنا بنموذج مُبرمَج (TEST FIXTURE) يقيس أن ما يصل المنفذ هو ما يقوله التصميم (ADR-033).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use polaris_host_providers::net::CancelToken;

use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionState};
use polaris_host_core::p03::port::{
    AgentModel, ContractProbe, DelegationRequestDraft, FileInspection, ModelError, PlanProposal, PlannedTask, ReviewInput, ReviewResult, ReviewVerdict, TaskContextSections,
    TaskExecution, ToolBroker, ToolDecision, ToolRecordNote, ToolRequest, ToolTurn,
};
use polaris_host_core::p03::retry::TransientPolicy;
use polaris_host_core::p03::runtime::MissionRuntime;
use polaris_host_core::p03::task::{DependencyKind, TaskState, TaskType};
use polaris_host_core::p03::trust::AuthorityClass;

fn mission(objective: &str) -> Mission {
    Mission {
        mission_id: "m-agents".into(),
        project_id: None,
        title: "agents".into(),
        title_authority: AuthorityClass::DirectUserInstruction,
        objective: objective.into(),
        origin: MissionOrigin::User,
        execution_mode: ExecutionMode::SingleAgent,
        priority: MissionPriority::Normal,
        state: MissionState::Created,
        completion_proof_status: CompletionProofStatus::NotEvaluated,
        current_revision: 1,
        root_task_id: None,
        budget: MissionBudget::extended(),
        requirements: Vec::new(),
        created_at: "t0".into(),
        started_at: None,
        completed_at: None,
        result_summary: None,
        failure_reason: None,
        version: 1,
    }
}

fn planned(key: &str, objective: &str, task_type: TaskType, role: AgentRole, deps: &[&str]) -> PlannedTask {
    PlannedTask {
        local_key: key.into(),
        title: key.into(),
        objective: objective.into(),
        task_type,
        depends_on: deps.iter().map(|d| d.to_string()).collect(),
        dependency_kind: DependencyKind::RequiresSuccess,
        recommended_role: role,
    }
}

fn exec(summary: &str) -> TaskExecution {
    TaskExecution { output_summary: summary.into(), claims: Vec::new(), evidence: Vec::new(), tool_requests: Vec::new(), delegation: None, input_tokens: 0, output_tokens: 0, failed: false }
}

type ExecStep = Box<dyn FnMut(AgentRole, &str) -> TaskExecution + Send>;

/// نموذج مُبرمَج يسجّل كل ما أُبلغ به: مدخل المراجعة، وملاحظاتها، ورسائل الزملاء، وأقسام السياق، والأدوار.
#[derive(Default)]
struct Recorder {
    plan: Mutex<Option<PlanProposal>>,
    steps: Mutex<VecDeque<ExecStep>>,
    verdicts: Mutex<VecDeque<(ReviewVerdict, String)>>,
    review_inputs: Mutex<Vec<(String, ReviewInput)>>,
    feedback: Mutex<Vec<(String, String)>>,
    messages: Mutex<Vec<(String, String)>>,
    contexts: Mutex<Vec<(String, TaskContextSections)>>,
    calls: Mutex<Vec<String>>,
    continues: AtomicU32,
    /// ردود مراجعة مشوّهة تسبق الحكم (لقياس الإصلاح الواحد).
    bad_reviews: AtomicU32,
    repairs: Mutex<Vec<(String, String)>>,
}

impl Recorder {
    fn new(plan: PlanProposal) -> Self {
        Self { plan: Mutex::new(Some(plan)), ..Default::default() }
    }
    fn step(self, step: impl FnMut(AgentRole, &str) -> TaskExecution + Send + 'static) -> Self {
        self.steps.lock().unwrap().push_back(Box::new(step));
        self
    }
    fn verdict(self, verdict: ReviewVerdict, notes: &str) -> Self {
        self.verdicts.lock().unwrap().push_back((verdict, notes.into()));
        self
    }
    fn next(&self, kind: &str, role: AgentRole, objective: &str) -> TaskExecution {
        self.calls.lock().unwrap().push(format!("{kind} {} {objective}", role.as_str()));
        let step = self.steps.lock().unwrap().pop_front();
        match step {
            Some(mut s) => s(role, objective),
            None => exec("nothing more to do"),
        }
    }
}

impl AgentModel for Recorder {
    fn plan(&self, _objective: &str) -> Result<PlanProposal, ModelError> {
        self.plan.lock().unwrap().take().ok_or_else(|| ModelError::InvalidOutput("planned once".into()))
    }
    fn execute(&self, role: AgentRole, _t: TaskType, objective: &str) -> Result<TaskExecution, ModelError> {
        Ok(self.next("execute", role, objective))
    }
    fn review(&self, role: AgentRole, target: &str) -> Result<ReviewResult, ModelError> {
        self.calls.lock().unwrap().push(format!("review {} {target}", role.as_str()));
        if self.bad_reviews.load(Ordering::SeqCst) > 0 {
            self.bad_reviews.fetch_sub(1, Ordering::SeqCst);
            return Err(ModelError::InvalidOutput("the output contains no JSON object".into()));
        }
        let (verdict, notes) = self.verdicts.lock().unwrap().pop_front().unwrap_or((ReviewVerdict::Accept, "fine".into()));
        Ok(ReviewResult { verdict, notes, input_tokens: 0, output_tokens: 0 })
    }
    fn continue_execution(&self, role: AgentRole, _t: TaskType, objective: &str, _turns: &[ToolTurn]) -> Result<TaskExecution, ModelError> {
        self.continues.fetch_add(1, Ordering::SeqCst);
        Ok(self.next("continue", role, objective))
    }
    fn recovery_enabled(&self) -> bool {
        true
    }
    fn note_task_context(&self, objective: &str, sections: &TaskContextSections) {
        self.contexts.lock().unwrap().push((objective.into(), sections.clone()));
    }
    fn note_review_input(&self, review_task: &str, input: &ReviewInput) {
        self.review_inputs.lock().unwrap().push((review_task.into(), input.clone()));
    }
    fn note_review_feedback(&self, objective: &str, notes: &str) {
        self.feedback.lock().unwrap().push((objective.into(), notes.into()));
    }
    fn note_agent_message(&self, objective: &str, message: &str) {
        self.messages.lock().unwrap().push((objective.into(), message.into()));
    }
    fn note_invalid_output(&self, objective: &str, detail: &str) -> bool {
        self.repairs.lock().unwrap().push((objective.into(), detail.into()));
        true
    }
}

/// منفذ قياس بلا ملفات ولا أدوات: يكفي لتفعيل ضوابط Phase-08 (العقد فارغ لهدف بلا مخرجات).
struct EmptyProbe;
impl ContractProbe for EmptyProbe {
    fn inspect_file(&self, _m: &str, _p: &str) -> FileInspection {
        FileInspection::default()
    }
    fn tool_history(&self, _m: &str) -> Vec<ToolRecordNote> {
        Vec::new()
    }
    fn workspace_files(&self, _m: &str) -> Vec<String> {
        vec!["notes.md".into()]
    }
}

fn runtime(objective: &str) -> MissionRuntime {
    MissionRuntime::new(mission(objective), RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_cancel(CancelToken::new())
        .with_transient_policy(TransientPolicy::immediate(2, 6))
        .with_contract_probe(Arc::new(EmptyProbe))
}

#[test]
fn p08_agents_the_reviewer_sees_the_work_and_a_revise_reaches_the_producer_with_its_reasons() {
    let model = Recorder::new(PlanProposal {
        tasks: vec![
            planned("draft", "Draft the greeting", TaskType::Build, AgentRole::Builder, &[]),
            planned("check", "Check the greeting is polite", TaskType::Review, AgentRole::Reviewer, &["draft"]),
        ],
    })
    .step(|_, _| exec("draft v1: hey"))
    .step(|_, _| exec("draft v2: hello, welcome"))
    .verdict(ReviewVerdict::Revise, "too curt; greet the user properly")
    .verdict(ReviewVerdict::Accept, "polite now");
    let mut rt = runtime("Write a short polite greeting");
    let report = rt.run(&model);

    let inputs = model.review_inputs.lock().unwrap().clone();
    assert_eq!(inputs.len(), 2, "each review call is given its input");
    assert_eq!(inputs[0].1.objective, "Check the greeting is polite");
    assert!(inputs[0].1.work.iter().any(|w| w.contains("draft v1: hey")), "the reviewer did not see the work: {:?}", inputs[0].1.work);
    assert!(inputs[1].1.work.iter().any(|w| w.contains("draft v2")), "the second review did not see the revision");
    assert_eq!(inputs[0].1.files, vec!["notes.md".to_string()]);
    // ملاحظات «REVISE» تصل المنتِج بهدفه هو، لا بهدف المراجعة.
    assert_eq!(model.feedback.lock().unwrap().clone(), vec![("Draft the greeting".to_string(), "too curt; greet the user properly".to_string())]);
    let executes = model.calls.lock().unwrap().iter().filter(|c| c.starts_with("execute") && c.ends_with("Draft the greeting")).count();
    assert_eq!(executes, 2, "the producer was not re-run after REVISE");
    assert_eq!(report.mission_state, MissionState::Completed, "{report:?}");
    // الرسالة على الناقل: من المراجِع إلى المنتِج، بسلطة رسالة وكيل.
    assert!(rt.messages().iter().any(|m| m.payload.contains("too curt")), "no review message on the bus");
}

#[test]
fn p08_agents_a_delegated_colleague_runs_and_its_result_reaches_the_requester_in_a_follow_up_round() {
    let model = Recorder::new(PlanProposal { tasks: vec![planned("page", "Build the landing page", TaskType::Build, AgentRole::Builder, &[])] })
        .step(|_, _| {
            let mut e = exec("started the page; need a palette");
            e.delegation = Some(DelegationRequestDraft {
                requested_role: AgentRole::Researcher,
                objective: "Find a calm colour palette".into(),
                reason: "design input".into(),
                expected_output: "three hex colours".into(),
            });
            e
        })
        .step(|role, objective| {
            assert_eq!(role, AgentRole::Researcher);
            assert_eq!(objective, "Find a calm colour palette");
            exec("palette: #0b3d91 #6fa8dc #f3f6fb")
        })
        .step(|_, objective| {
            assert_eq!(objective, "Build the landing page");
            exec("page built with the palette")
        });
    let mut rt = runtime("Build a landing page");
    let report = rt.run(&model);

    assert_eq!(report.delegations_executed, 1, "{report:?}");
    // الزميل تلقّى سياقه: ما يعمل عليه طالبه وما يحتاجه منه.
    let contexts = model.contexts.lock().unwrap().clone();
    let delegate = contexts.iter().find(|(o, _)| o == "Find a calm colour palette").expect("the colleague got no context");
    assert!(delegate.1.previous_results[0].contains("Build the landing page") && delegate.1.previous_results[0].contains("three hex colours"));
    // النتيجة وصلت طالبها، وأُعطي جولة يقرؤها فيها.
    let messages = model.messages.lock().unwrap().clone();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].0, "Build the landing page");
    assert!(messages[0].1.contains("#0b3d91") && messages[0].1.contains("RESEARCHER"), "{}", messages[0].1);
    assert_eq!(model.continues.load(Ordering::SeqCst), 1, "the requester did not get a round to read the result");
    let colleague = rt.agents().iter().find(|a| a.role == AgentRole::Researcher).expect("no colleague agent");
    assert_eq!(colleague.delegation_depth, 1);
    assert!(colleague.parent_agent_id.is_some());
    assert_eq!(report.mission_state, MissionState::Completed, "{report:?}");
}

#[test]
fn p08_agents_the_planner_role_is_used_when_the_registry_allows_it_and_ignored_when_it_does_not() {
    let model = Recorder::new(PlanProposal {
        tasks: vec![
            planned("fix", "Fix the failing parser", TaskType::Debug, AgentRole::Debugger, &[]),
            // REVIEWER لا يجيز BUILD في السجل: يبقى دور النوع.
            planned("ship", "Package the fix", TaskType::Build, AgentRole::Reviewer, &["fix"]),
        ],
    });
    let mut rt = runtime("Fix the parser and package it");
    rt.run(&model);
    let calls = model.calls.lock().unwrap().clone();
    assert!(calls.contains(&"execute DEBUGGER Fix the failing parser".to_string()), "{calls:?}");
    assert!(calls.contains(&"execute BUILDER Package the fix".to_string()), "{calls:?}");
}

#[test]
fn p08_agents_every_worker_sees_the_whole_plan_and_its_place_in_it() {
    let model = Recorder::new(PlanProposal {
        tasks: vec![
            planned("one", "Collect the figures", TaskType::Research, AgentRole::Researcher, &[]),
            planned("two", "Write the summary", TaskType::Build, AgentRole::Builder, &["one"]),
        ],
    });
    let mut rt = runtime("Summarise the figures");
    rt.run(&model);
    let contexts = model.contexts.lock().unwrap().clone();
    let second = contexts.iter().find(|(o, _)| o == "Write the summary").expect("no context for the second task");
    assert_eq!(second.1.plan_outline.len(), 2, "{:?}", second.1.plan_outline);
    assert!(second.1.plan_outline[0].starts_with("1. [SUCCEEDED] one"), "{:?}", second.1.plan_outline);
    assert!(second.1.plan_outline[1].ends_with("<- THIS TASK"), "{:?}", second.1.plan_outline);
}

#[test]
fn p08_agents_closed_fixture_ports_keep_their_behaviour_without_the_phase08_hooks() {
    // بلا منفذ قياس لا تعمل ضوابط Phase-08: لا مدخل مراجعة، ولا دور مخطّط، ولا مخطّط خطة.
    let model = Recorder::new(PlanProposal {
        tasks: vec![
            planned("fix", "Fix it", TaskType::Debug, AgentRole::Debugger, &[]),
            planned("check", "Check it", TaskType::Review, AgentRole::Reviewer, &["fix"]),
        ],
    });
    let mut rt = MissionRuntime::new(mission("Fix it"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_cancel(CancelToken::new());
    rt.run(&model);
    assert!(model.review_inputs.lock().unwrap().is_empty());
    assert!(model.contexts.lock().unwrap().is_empty());
    assert!(model.calls.lock().unwrap().contains(&"execute BUILDER Fix it".to_string()), "the closed path changed its role choice");
}

#[test]
fn p08_agents_a_malformed_review_reply_gets_one_repair_and_a_second_one_still_stops_the_run() {
    // قِيس 2026-10-02 بالنموذج الحقيقي: مراجِع أعاد نصًّا بلا JSON فحُجبت مهمّة نجح مستندها. الآن: إصلاح واحد.
    let plan = || PlanProposal {
        tasks: vec![
            planned("draft", "Draft the note", TaskType::Build, AgentRole::Builder, &[]),
            planned("check", "Check the note", TaskType::Review, AgentRole::Reviewer, &["draft"]),
        ],
    };
    let model = Recorder::new(plan()).step(|_, _| exec("note written"));
    model.bad_reviews.store(1, Ordering::SeqCst);
    let mut rt = runtime("Write a note");
    let report = rt.run(&model);
    let repairs = model.repairs.lock().unwrap().clone();
    assert_eq!(repairs.len(), 1, "{repairs:?}");
    assert!(repairs[0].1.contains("no JSON object"));
    assert_eq!(report.mission_state, MissionState::Completed, "{report:?}");

    // إصلاح واحد فقط: ردّان مشوّهان يوقفان التشغيل كما كان، فلا يُخترع حكم لم يصدر.
    let model = Recorder::new(plan()).step(|_, _| exec("note written"));
    model.bad_reviews.store(2, Ordering::SeqCst);
    let mut rt = runtime("Write a note");
    let report = rt.run(&model);
    assert_ne!(report.mission_state, MissionState::Completed, "{report:?}");
    assert_eq!(model.repairs.lock().unwrap().len(), 1);
}

// قِيس في بيانات المالك (2026-10-05): مهمّة مراجعتها محجوبة أُعلنت «مكتملة» لأن الإنهاء لم يفحص الحجب.
#[test]
fn p08_agents_a_mission_with_a_blocked_review_is_blocked_not_completed() {
    let model = Recorder::new(PlanProposal {
        tasks: vec![
            planned("draft", "Draft the greeting", TaskType::Build, AgentRole::Builder, &[]),
            planned("check", "Check the greeting is polite", TaskType::Review, AgentRole::Reviewer, &["draft"]),
        ],
    })
    .step(|_, _| exec("draft v1: hey"))
    .verdict(ReviewVerdict::Blocked, "cannot judge without the style guide");
    let mut rt = runtime("Write a short polite greeting");
    let report = rt.run(&model);
    assert_eq!(report.tasks_blocked, 1, "{report:?}");
    assert_eq!(report.mission_state, MissionState::Blocked, "a blocked review must not end as COMPLETED: {report:?}");
    let reason = rt.mission().failure_reason.clone().unwrap_or_default();
    assert!(reason.starts_with("TASKS_BLOCKED"), "the reason must say a task is blocked: {reason}");
    assert!(reason.contains("Check the greeting is polite"), "the reason names the blocked task: {reason}");
}

/// وسيط أدوات مُبرمَج: كل نداء يأخذ القرار التالي من القائمة (الحالة، سبب الرفض، الملخّص)، ويسجّل الطلب.
struct ScriptBroker {
    decisions: Mutex<VecDeque<(&'static str, Option<&'static str>, &'static str)>>,
    seen: Mutex<Vec<ToolRequest>>,
}

impl ScriptBroker {
    fn new(decisions: Vec<(&'static str, Option<&'static str>, &'static str)>) -> Self {
        Self { decisions: Mutex::new(decisions.into()), seen: Mutex::new(Vec::new()) }
    }
}

impl ToolBroker for ScriptBroker {
    fn default_skill(&self) -> Option<String> {
        Some("polaris.skill.agentic-work".into())
    }
    fn tools_for(&self, _skill: &str) -> Vec<String> {
        vec!["polaris.workspace.write".into()]
    }
    fn invoke(&self, _task_id: &str, _agent_id: &str, request: &ToolRequest) -> ToolDecision {
        let mut seen = self.seen.lock().unwrap();
        seen.push(request.clone());
        let (status, denial, summary) = self.decisions.lock().unwrap().pop_front().unwrap_or(("SUCCEEDED", None, "written"));
        ToolDecision {
            invocation_id: format!("inv-{}", seen.len()),
            tool_id: request.tool_id.clone(),
            skill_id: request.skill_id.clone(),
            status: status.into(),
            denial_reason: denial.map(str::to_string),
            summary: summary.into(),
            evidence_recorded: false,
            pending_approval_id: None,
            observation: None,
        }
    }
    fn executed_calls(&self) -> u32 {
        self.seen.lock().unwrap().len() as u32
    }
}

fn write_request(with_reason_inside: bool) -> ToolRequest {
    let mut arguments = serde_json::json!({ "path": "outputs/r.md", "content": "# Report" });
    if with_reason_inside {
        arguments["reason"] = serde_json::json!("save the report");
    }
    ToolRequest {
        skill_id: "polaris.skill.agentic-work".into(),
        tool_id: "polaris.workspace.write".into(),
        arguments,
        reason: "save the report".into(),
        expected_effect: vec!["WORKSPACE_WRITE".into()],
        expected_output: "the file".into(), require_human: false,
    }
}

const MISPLACED: &str = "the argument reason is not declared by this tool; reason belongs beside \"arguments\" in the tool request, not inside it";

// قِيس 2026-10-05: خمسة رفوض ARGUMENTS_INVALID في تشغيل واحد، والوكيل لم يرَ أيًّا منها لأن الكتابة ليست أداة ملاحظة.
#[test]
fn p08_agents_an_arguments_invalid_denial_gets_a_repair_round_that_shows_the_reason() {
    let model = Recorder::new(PlanProposal { tasks: vec![planned("write", "Write the report to outputs/r.md", TaskType::Build, AgentRole::Builder, &[])] })
        .step(|_, _| TaskExecution { tool_requests: vec![write_request(true)], ..exec("writing") })
        .step(|_, _| TaskExecution { tool_requests: vec![write_request(false)], ..exec("fixed the call") });
    let broker = Arc::new(ScriptBroker::new(vec![("DENIED", Some("ARGUMENTS_INVALID"), MISPLACED), ("SUCCEEDED", None, "written")]));
    let mut rt = runtime("Write the report to outputs/r.md").with_tools(broker.clone());
    let report = rt.run(&model);
    assert_eq!(broker.seen.lock().unwrap().len(), 2, "the corrected call never reached the gateway: {report:?}");
    assert!(broker.seen.lock().unwrap()[1].arguments.get("reason").is_none());
    // الكتابة المصحَّحة نجحت فلا تفشل العقدة. (حالة المهمّة يحكمها فحص الملف، والمنفذ الفارغ هنا لا يرى ملفات.)
    assert_eq!((report.tool_calls_executed, report.tool_calls_denied, report.tasks_failed), (1, 1, 0), "{report:?}");
}

// قِيس 2026-10-05 (MISSION-A): كتابة المستند رُفضت، ومهمّة «اكتب المستند» أُعلنت ناجحة رغم ذلك.
#[test]
fn p08_agents_a_task_whose_last_write_was_refused_does_not_succeed_and_says_why() {
    let model = Recorder::new(PlanProposal { tasks: vec![planned("write", "Write the report to outputs/r.md", TaskType::Build, AgentRole::Builder, &[])] })
        .step(|_, _| TaskExecution { tool_requests: vec![write_request(true)], ..exec("writing") })
        .step(|_, _| exec("I wrote the report to outputs/r.md"));
    let broker = Arc::new(ScriptBroker::new(vec![("DENIED", Some("ARGUMENTS_INVALID"), MISPLACED)]));
    let mut rt = runtime("Write the report to outputs/r.md").with_tools(broker);
    let report = rt.run(&model);
    assert_eq!(report.tasks_succeeded, 0, "a task whose write was refused was counted as succeeded: {report:?}");
    assert_ne!(report.mission_state, MissionState::Completed, "{report:?}");
    let reason = rt.mission().failure_reason.clone().unwrap_or_default();
    assert!(reason.starts_with("TASKS_FAILED"), "{reason}");
    assert!(reason.contains("polaris.workspace.write") && reason.contains("ARGUMENTS_INVALID"), "{reason}");
}

/// يحتفظ بكل نقطة استئناف كما حفظها التشغيل.
#[derive(Default)]
struct Checkpoints(Mutex<Vec<polaris_host_core::p03::repository::MissionSnapshot>>);

impl polaris_host_core::p03::runtime::RunCheckpoint for Checkpoints {
    fn save(&self, snapshot: &polaris_host_core::p03::repository::MissionSnapshot) -> Result<(), String> {
        self.0.lock().unwrap().push(snapshot.clone());
        Ok(())
    }
}

/// خطة 2026-10-05، E2: نقطة استئناف بعد التخطيط وبعد كل خطوة. تشغيل قُطع بعد الخطوة الأولى (والثانية جارية، فاستعادها
/// المضيف INTERRUPTED) يُستأنف من الرسم المحفوظ: لا يُعاد التخطيط، ولا تُعاد الخطوة المنتهية، وتُكمَل المقطوعة.
#[test]
fn p08_agents_a_run_cut_after_its_first_step_resumes_from_its_checkpoint_without_redoing_it() {
    let model = Recorder::new(PlanProposal {
        tasks: vec![
            planned("one", "Write the first part", TaskType::Build, AgentRole::Builder, &[]),
            planned("two", "Write the second part", TaskType::Build, AgentRole::Builder, &["one"]),
        ],
    });
    let saved = Arc::new(Checkpoints::default());
    let mut rt = runtime("Write two parts").with_checkpoint(saved.clone());
    let report = rt.run(&model);
    assert_eq!(report.tasks_succeeded, 2, "{report:?}");
    let points = saved.0.lock().unwrap().clone();
    assert_eq!(points.len(), 3, "expected a checkpoint after planning and after each step");
    assert!(points[0].graph.nodes().all(|n| n.state == TaskState::Pending), "the plan checkpoint already showed work");

    // القطع: آخر ما حُفظ قبل انتهاء الخطوة الثانية هو نقطة ما بعد الأولى، والثانية كانت جارية فاستعادها المضيف INTERRUPTED.
    let mut graph = points[1].graph.clone();
    let second = graph.nodes().find(|n| n.objective == "Write the second part").unwrap().task_id.clone();
    let first = graph.nodes().find(|n| n.objective == "Write the first part").unwrap().task_id.clone();
    assert_eq!(graph.get(&first).unwrap().state, TaskState::Succeeded);
    graph.set_state(&second, TaskState::Interrupted).unwrap();
    let mut cut = points[1].mission.clone();
    cut.state = MissionState::Blocked;

    let resumed_model = Recorder::new(PlanProposal { tasks: Vec::new() });
    let mut resumed = MissionRuntime::new(cut, RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_cancel(CancelToken::new())
        .with_transient_policy(TransientPolicy::immediate(2, 6))
        .with_contract_probe(Arc::new(EmptyProbe))
        .resume_from(&polaris_host_core::p03::repository::MissionSnapshot { graph, ..points[1].clone() });
    let report = resumed.run(&resumed_model);
    let calls = resumed_model.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 1, "the resumed run did more or less than the interrupted step: {calls:?}");
    assert!(calls[0].contains("Write the second part"), "{calls:?}");
    assert_eq!(report.mission_state, MissionState::Completed, "{report:?}");
}
