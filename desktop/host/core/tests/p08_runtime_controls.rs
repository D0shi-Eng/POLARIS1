// P08-RUNTIME — ضوابط زمن التشغيل الحتمية حول نموذج حقيقي غير كامل (إصلاح Phase-08).
//
// كل اختبار هنا يقيس سببًا جذريًّا قِيس في التشغيل الأصلي أو ضابطًا يمنعه، بنموذج مُبرمَج
// (TEST FIXTURE) لا بنموذج حقيقي: الإلغاء يسود الفشل اللاحق، والإخفاق العابر يُعاد لا يُصلَح،
// والإكمال يُرفض مع مخرَج غائب، والاستكمال محدود، والخطة الناقصة تُصلَح، والتسليم يصل،
// ونتيجة الملاحظة تعود، والتذكير بالأداة محدود ولا يمنح سلطة، وحلقة الاختبار ← التعديل ← الإعادة.

use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Barrier, Mutex};

use polaris_host_providers::net::CancelToken;
use serde_json::json;

use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::cancel::{CancelArbitration, MissionCancellation};
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionState};
use polaris_host_core::p03::port::{
    AgentModel, ContractProbe, FileInspection, ModelError, PlanProposal, PlannedTask, ReviewResult, TaskContextSections, TaskExecution, ToolBroker, ToolDecision, ToolRecordNote,
    ToolRequest, ToolTurn,
};
use polaris_host_core::p03::retry::TransientPolicy;
use polaris_host_core::p03::runtime::{MissionRuntime, StopReason};
use polaris_host_core::p03::task::{DependencyKind, TaskState, TaskType};
use polaris_host_core::p03::trust::AuthorityClass;

// ——— تجهيزات.

fn mission(objective: &str) -> Mission {
    Mission {
        mission_id: "m-p08".into(),
        project_id: None,
        title: "p08 runtime".into(),
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

fn task(key: &str, objective: &str, deps: &[&str]) -> PlannedTask {
    PlannedTask {
        local_key: key.into(),
        title: key.into(),
        objective: objective.into(),
        task_type: TaskType::Build,
        depends_on: deps.iter().map(|d| d.to_string()).collect(),
        dependency_kind: DependencyKind::RequiresSuccess,
        recommended_role: AgentRole::Builder,
    }
}

fn plan(tasks: Vec<PlannedTask>) -> PlanProposal {
    PlanProposal { tasks }
}

fn exec(summary: &str, tools: Vec<ToolRequest>) -> TaskExecution {
    TaskExecution { output_summary: summary.into(), claims: Vec::new(), evidence: Vec::new(), tool_requests: tools, delegation: None, input_tokens: 0, output_tokens: 0, failed: false }
}

fn tool(id: &str, arguments: serde_json::Value) -> ToolRequest {
    ToolRequest { skill_id: "polaris.skill.agentic-work".into(), tool_id: id.into(), arguments, reason: "needed".into(), expected_effect: Vec::new(), expected_output: String::new(), require_human: false, }
}

type PlanStep = Box<dyn FnMut() -> Result<PlanProposal, ModelError> + Send>;
type ExecStep = Box<dyn FnMut(&str, &[ToolTurn]) -> Result<TaskExecution, ModelError> + Send>;

/// نموذج مُبرمَج: خطوات مرتّبة للتخطيط وللتنفيذ/المتابعة، ويسجّل ما أُبلغ به.
#[derive(Default)]
struct Scripted {
    plans: Mutex<VecDeque<PlanStep>>,
    steps: Mutex<VecDeque<ExecStep>>,
    recovery: bool,
    wants_results: bool,
    feedback: Mutex<Vec<String>>,
    contexts: Mutex<Vec<(String, TaskContextSections)>>,
    reminders: Mutex<Vec<String>>,
    repairs: AtomicU32,
    continues: AtomicU32,
    /// رموز التخطيط كما «يبلّغها المزوّد» (D-8). `None`: لا تقرير.
    plan_usage: Mutex<Option<(u64, u64)>>,
}

impl Scripted {
    fn new(recovery: bool) -> Self {
        Self { recovery, ..Default::default() }
    }
    fn plan(self, step: impl FnMut() -> Result<PlanProposal, ModelError> + Send + 'static) -> Self {
        self.plans.lock().unwrap().push_back(Box::new(step));
        self
    }
    fn step(self, step: impl FnMut(&str, &[ToolTurn]) -> Result<TaskExecution, ModelError> + Send + 'static) -> Self {
        self.steps.lock().unwrap().push_back(Box::new(step));
        self
    }
    fn next_exec(&self, objective: &str, turns: &[ToolTurn]) -> Result<TaskExecution, ModelError> {
        let step = self.steps.lock().unwrap().pop_front();
        match step {
            Some(mut s) => s(objective, turns),
            None => Ok(exec("nothing more to do", Vec::new())),
        }
    }
}

impl AgentModel for Scripted {
    fn take_plan_usage(&self) -> Option<(u64, u64)> {
        self.plan_usage.lock().unwrap().take()
    }
    fn plan(&self, _objective: &str) -> Result<PlanProposal, ModelError> {
        let step = self.plans.lock().unwrap().pop_front();
        match step {
            Some(mut s) => s(),
            None => Err(ModelError::InvalidOutput("no scripted plan".into())),
        }
    }
    fn execute(&self, _role: AgentRole, _t: TaskType, objective: &str) -> Result<TaskExecution, ModelError> {
        self.next_exec(objective, &[])
    }
    fn review(&self, _role: AgentRole, _target: &str) -> Result<ReviewResult, ModelError> {
        Err(ModelError::InvalidOutput("no review in these scripts".into()))
    }
    fn wants_tool_results(&self, _objective: &str) -> bool {
        self.wants_results
    }
    fn note_invalid_output(&self, _objective: &str, _detail: &str) -> bool {
        self.repairs.fetch_add(1, Ordering::SeqCst);
        true
    }
    fn continue_execution(&self, _role: AgentRole, _t: TaskType, objective: &str, turns: &[ToolTurn]) -> Result<TaskExecution, ModelError> {
        self.continues.fetch_add(1, Ordering::SeqCst);
        self.next_exec(objective, turns)
    }
    fn recovery_enabled(&self) -> bool {
        self.recovery
    }
    fn note_plan_feedback(&self, feedback: &str) {
        self.feedback.lock().unwrap().push(feedback.to_string());
    }
    fn note_task_context(&self, objective: &str, sections: &TaskContextSections) {
        self.contexts.lock().unwrap().push((objective.to_string(), sections.clone()));
    }
    fn note_reminder(&self, _objective: &str, reminder: &str) {
        self.reminders.lock().unwrap().push(reminder.to_string());
    }
}

/// قاعدة القرار لكل أداة: (الحالة، الملخّص، الآثار).
type Decide = Box<dyn Fn(&ToolRequest) -> (String, String, Vec<String>) + Send + Sync>;

/// وسيط أدوات مُبرمَج: يعيد قرارًا لكل أداة بحسب قاعدة، ويسجّل النداء في سجلّ يقرؤه منفذ القياس.
struct Broker {
    decide: Decide,
    log: Arc<Mutex<Vec<ToolRecordNote>>>,
    files: Arc<Mutex<BTreeMap<String, FileInspection>>>,
    cancel_on: Option<(String, CancelToken)>,
}

impl ToolBroker for Broker {
    fn default_skill(&self) -> Option<String> {
        Some("polaris.skill.agentic-work".into())
    }
    fn tools_for(&self, _skill: &str) -> Vec<String> {
        Vec::new()
    }
    fn invoke(&self, task_id: &str, _agent: &str, request: &ToolRequest) -> ToolDecision {
        if let Some((tool, token)) = &self.cancel_on {
            if tool == &request.tool_id {
                // الإلغاء يُقبل أثناء الأداة، ثم تصل نتيجة فاشلة متأخّرة.
                token.cancel();
                return decision(request, "FAILED", "the tool was interrupted", None);
            }
        }
        let (status, summary, effects) = (self.decide)(request);
        if request.tool_id == "polaris.workspace.write" || request.tool_id.starts_with("polaris.artifact") || request.tool_id == "polaris.package.zip" {
            if let Some(path) = request.arguments.get("path").and_then(|p| p.as_str()) {
                self.files.lock().unwrap().insert(path.to_string(), FileInspection { exists: true, verified: true, has_chart: request.arguments.get("chart").is_some(), detail: "re-opened".into() });
            }
        }
        // اصطلاح الاختبار: رفضٌ ملخّصه «السبب: …» يحمل سببه.
        let denial = if status == "DENIED" { summary.split(':').next().map(str::to_string) } else { None };
        let mut log = self.log.lock().unwrap();
        let n = log.len();
        log.push(ToolRecordNote {
            invocation_id: format!("i{n}"),
            task_id: task_id.into(),
            tool_id: request.tool_id.clone(),
            status: status.clone(),
            denial_reason: denial.clone(),
            effects: effects.clone(),
            summary: summary.clone(),
        });
        let mut d = decision(request, &status, &summary, Some(format!("observed output of {}", request.tool_id)));
        d.denial_reason = denial;
        d
    }
    fn executed_calls(&self) -> u32 {
        self.log.lock().unwrap().len() as u32
    }
}

fn decision(request: &ToolRequest, status: &str, summary: &str, observation: Option<String>) -> ToolDecision {
    ToolDecision {
        invocation_id: "d".into(),
        tool_id: request.tool_id.clone(),
        skill_id: request.skill_id.clone(),
        status: status.into(),
        denial_reason: None,
        summary: summary.into(),
        evidence_recorded: true,
        pending_approval_id: if status == "AWAITING_APPROVAL" { Some("ap-1".into()) } else { None },
        observation,
    }
}

struct Probe {
    log: Arc<Mutex<Vec<ToolRecordNote>>>,
    files: Arc<Mutex<BTreeMap<String, FileInspection>>>,
}

impl ContractProbe for Probe {
    fn inspect_file(&self, _m: &str, path: &str) -> FileInspection {
        self.files.lock().unwrap().get(path).cloned().unwrap_or_default()
    }
    fn tool_history(&self, _m: &str) -> Vec<ToolRecordNote> {
        self.log.lock().unwrap().clone()
    }
    fn workspace_files(&self, _m: &str) -> Vec<String> {
        self.files.lock().unwrap().keys().cloned().collect()
    }
}

struct World {
    log: Arc<Mutex<Vec<ToolRecordNote>>>,
    files: Arc<Mutex<BTreeMap<String, FileInspection>>>,
}

impl World {
    fn new() -> Self {
        Self { log: Arc::new(Mutex::new(Vec::new())), files: Arc::new(Mutex::new(BTreeMap::new())) }
    }
    fn broker(&self, decide: impl Fn(&ToolRequest) -> (String, String, Vec<String>) + Send + Sync + 'static) -> Arc<dyn ToolBroker> {
        Arc::new(Broker { decide: Box::new(decide), log: self.log.clone(), files: self.files.clone(), cancel_on: None })
    }
    fn probe(&self) -> Arc<dyn ContractProbe> {
        Arc::new(Probe { log: self.log.clone(), files: self.files.clone() })
    }
}

fn ok(_: &ToolRequest) -> (String, String, Vec<String>) {
    ("SUCCEEDED".into(), "done".into(), Vec::new())
}

fn runtime(objective: &str, token: &CancelToken) -> MissionRuntime {
    MissionRuntime::new(mission(objective), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_cancel(token.clone()).with_transient_policy(TransientPolicy::immediate(2, 6))
}

// ——— D-8 (QA 2026-10-15): نداء التخطيط يُحاسب بما أبلغه المزوّد، لا برقم ثابت.

#[test]
fn qa_d8_the_plan_call_is_charged_what_the_provider_reported_not_a_fixed_estimate() {
    let token = CancelToken::new();
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "Write the note.", &[])]))).step(|_, _| Ok(exec("wrote the note", Vec::new())));
    *model.plan_usage.lock().unwrap() = Some((7, 3));
    let world = World::new();
    let mut rt = runtime("Write a short note.", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    // التخطيط 7+3 والتنفيذ 0+0 (التجهيزة لا تبلّغ رموزًا للتنفيذ): المجموع 10، لا 400.
    assert_eq!(report.total_tokens, 10, "{report:?}");
}

#[test]
fn qa_d8_a_plan_without_reported_usage_charges_zero_not_an_invented_number() {
    let token = CancelToken::new();
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "Write the note.", &[])]))).step(|_, _| Ok(exec("wrote the note", Vec::new())));
    let world = World::new();
    let mut rt = runtime("Write a short note.", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(report.total_tokens, 0, "{report:?}");
}

// ——— P08-E2E-07: الإلغاء يسود.

#[test]
fn p08_cancel_accepted_during_planning_ends_cancelled_even_when_a_late_failure_arrives() {
    let registry = MissionCancellation::new();
    let handle = registry.begin("m-p08", "s");
    let token = handle.token.clone();
    let gate_token = handle.token.clone();
    let registry = Arc::new(registry);
    let r2 = registry.clone();
    // الإلغاء يُقبل أثناء نداء التخطيط، ثم يعود النداء بخطأ عادي متأخّر (قطع البث مثلًا).
    let model = Scripted::new(true).plan(move || {
        assert!(matches!(r2.arbitrate("m-p08", 5), CancelArbitration::Accepted(_)));
        assert!(gate_token.is_cancelled());
        Err(ModelError::InvalidOutput("stream ended without completion".into()))
    });
    let world = World::new();
    let mut rt = runtime("Use Python to print a number every second for ten minutes.", &token).with_gate(handle.gate.clone()).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Cancelled, "a cancel accepted during planning was saved as {:?}", report.mission_state);
    assert_eq!(report.stop_reason, Some(StopReason::Cancelled));
    // بعد الحسم لا يُقبل إلغاء آخر ولا يُعلَن كاذبًا.
    assert!(matches!(registry.arbitrate("m-p08", 9), CancelArbitration::AlreadyDecided("CANCELLED")));
}

#[test]
fn p08_cancel_dominates_a_late_task_failure_and_a_late_tool_failure() {
    // فشل مهمّة يصل بعد إلغاء مقبول.
    let registry = Arc::new(MissionCancellation::new());
    let handle = registry.begin("m-p08", "s");
    let r2 = registry.clone();
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "do a", &[])]))).step(move |_, _| {
        let _ = r2.arbitrate("m-p08", 3);
        let mut e = exec("the model gave up", Vec::new());
        e.failed = true;
        Ok(e)
    });
    let world = World::new();
    let mut rt = runtime("do a", &handle.token).with_gate(handle.gate.clone()).with_tools(world.broker(ok));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Cancelled);
    assert!(rt.graph().nodes().all(|n| n.state != TaskState::Failed), "a task was recorded FAILED after the cancel");

    // نتيجة أداة فاشلة تصل بعد قبول الإلغاء أثناءها.
    let registry = Arc::new(MissionCancellation::new());
    let handle = registry.begin("m-p08", "s");
    let token = handle.token.clone();
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "run it", &[])]))).step(|_, _| Ok(exec("running", vec![tool("polaris.execution.python", json!({"code": "print(1)"}))])));
    let world = World::new();
    let broker: Arc<dyn ToolBroker> = Arc::new(Broker { decide: Box::new(ok), log: world.log.clone(), files: world.files.clone(), cancel_on: Some(("polaris.execution.python".into(), token.clone())) });
    let mut rt = runtime("run it", &token).with_gate(handle.gate.clone()).with_tools(broker);
    assert_eq!(rt.run(&model).mission_state, MissionState::Cancelled);
}

#[test]
fn p08_cancel_race_is_arbitrated_by_one_gate_whatever_the_interleaving() {
    // سباق حتمي بحاجز: الإلغاء يُطلب في اللحظة التي يعود فيها نداء التنفيذ بفشل عادي.
    for order in 0..2 {
        let registry = Arc::new(MissionCancellation::new());
        let handle = registry.begin("m-p08", "s");
        let barrier = Arc::new(Barrier::new(2));
        let (b1, r2) = (barrier.clone(), registry.clone());
        let canceller = std::thread::spawn(move || {
            b1.wait();
            matches!(r2.arbitrate("m-p08", 7), CancelArbitration::Accepted(_))
        });
        let b2 = barrier.clone();
        let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "do a", &[])]))).step(move |_, _| {
            if order == 0 {
                b2.wait();
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(ModelError::InvalidOutput("late ordinary failure".into()))
        });
        let world = World::new();
        let mut rt = runtime("do a", &handle.token).with_gate(handle.gate.clone()).with_tools(world.broker(ok));
        let report = rt.run(&model);
        if order == 1 {
            barrier.wait();
        }
        let accepted = canceller.join().unwrap();
        if accepted {
            assert_eq!(report.mission_state, MissionState::Cancelled, "an accepted cancel lost to a late failure");
        } else {
            assert_ne!(report.mission_state, MissionState::Cancelled, "a refused cancel still changed the state");
            assert_eq!(handle.gate.decided(), Some(report.mission_state.as_str()));
        }
    }
}

// ——— الإخفاق العابر للمزوّد.

#[test]
fn p08_a_provider_timeout_is_retried_after_a_wait_and_never_treated_as_malformed_output() {
    let model = Scripted::new(false)
        .plan(|| Err(ModelError::Transient("PROVIDER_TIMEOUT".into())))
        .plan(|| Ok(plan(vec![task("a", "do a", &[])])))
        .step(|_, _| Err(ModelError::Transient("PROVIDER_INTERNAL_ERROR".into())))
        .step(|_, _| Ok(exec("done", Vec::new())));
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime("do a", &token).with_tools(world.broker(ok));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed);
    assert_eq!(model.repairs.load(Ordering::SeqCst), 0, "a transient provider failure received a JSON repair note");
    assert_eq!(rt.transient_retries().retries_used, 2);
}

#[test]
fn p08_a_provider_that_stays_down_blocks_the_mission_as_unavailable_within_its_retry_bound() {
    let calls = Arc::new(AtomicU32::new(0));
    let c = calls.clone();
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "do a", &[])]))).step(move |_, _| {
        c.fetch_add(1, Ordering::SeqCst);
        Err(ModelError::Transient("PROVIDER_TIMEOUT".into()))
    });
    // خطوات إضافية لو أعيد النداء فوق الحدّ.
    let model = (0..5).fold(model, |m, _| {
        let c = calls.clone();
        m.step(move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            Err(ModelError::Transient("PROVIDER_TIMEOUT".into()))
        })
    });
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime("do a", &token).with_tools(world.broker(ok));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Blocked);
    assert!(matches!(report.stop_reason, Some(StopReason::ProviderUnavailable(_))), "{:?}", report.stop_reason);
    assert_eq!(calls.load(Ordering::SeqCst), 3, "one call plus two bounded retries");
    assert!(rt.mission().failure_reason.as_deref().is_some_and(|r| r.starts_with("PROVIDER_UNAVAILABLE")));
}

// ——— عقد المهمّة: الإكمال والاستكمال والخطة.

const MISSION_B: &str = "Analyse inputs/sales.csv with Python in the sandbox. Then produce outputs/s.xlsx with a bar chart, and a PDF report outputs/s.pdf.";

#[test]
fn p08_completion_is_refused_while_a_required_artifact_is_missing() {
    // النموذج يقول «انتهيت» في كل مرة ولا ينتج PDF: لا COMPLETED.
    let model = Scripted::new(true).plan(|| Ok(plan(vec![task("a", "analyse the csv with python, build the xlsx workbook with its chart and the pdf report", &[])]))).step(|_, _| {
        Ok(exec("analysed", vec![tool("polaris.execution.python", json!({"code": "print(1)"})), tool("polaris.artifact.spreadsheet", json!({"path": "outputs/s.xlsx", "chart": {}}))]))
    });
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime(MISSION_B, &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_ne!(report.mission_state, MissionState::Completed, "the mission completed without its PDF");
    assert_eq!(report.mission_state, MissionState::Blocked);
    assert!(matches!(&report.stop_reason, Some(StopReason::DeliverablesIncomplete(ids)) if !ids.is_empty()));
    // الاستكمال محدود: مهمّتان إضافيتان على الأكثر.
    let continuations = rt.graph().nodes().filter(|n| n.title.starts_with("Complete the remaining deliverables")).count();
    assert!((1..=2).contains(&continuations), "{continuations} continuation tasks");
    let pdf = rt.contract_checks().iter().find(|c| c.description.contains("outputs/s.pdf")).unwrap();
    assert!(!pdf.satisfied);
}

#[test]
fn p08_a_missing_deliverable_gets_one_bounded_continuation_that_asks_only_for_it() {
    let seen = Arc::new(Mutex::new(String::new()));
    let s2 = seen.clone();
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("a", "analyse with python, write the xlsx workbook with a chart and the pdf", &[])])))
        .step(|_, _| Ok(exec("xlsx done", vec![tool("polaris.execution.python", json!({"code": "print(1)"})), tool("polaris.artifact.spreadsheet", json!({"path": "outputs/s.xlsx", "chart": {}}))])))
        // متابعة الملاحظة (python) ثم الإنهاء بلا PDF.
        .step(|_, _| Ok(exec("finished", Vec::new())))
        // مهمّة الاستكمال: تُنتج PDF وحده.
        .step(move |objective, _| {
            *s2.lock().unwrap() = objective.to_string();
            Ok(exec("pdf", vec![tool("polaris.artifact.document", json!({"path": "outputs/s.pdf", "format": "pdf"}))]))
        });
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime(MISSION_B, &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    let objective = seen.lock().unwrap().clone();
    assert!(objective.contains("outputs/s.pdf") && objective.contains("polaris.artifact.document"), "{objective}");
    assert!(!objective.contains("outputs/s.xlsx exists in the workspace and re-opens"), "the continuation asked to redo met work: {objective}");
    assert_eq!(rt.graph().nodes().filter(|n| n.title.starts_with("Complete the remaining deliverables")).count(), 1);
}

#[test]
fn p08_plan_completeness_detects_an_omitted_zip_and_one_repair_is_requested() {
    let objective = "Build outputs/site/index.html, validate it with Python and package the site as outputs/site.zip.";
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("a", "write outputs/site/index.html", &[]), task("b", "validate the links with python", &["a"])])))
        .plan(|| Ok(plan(vec![task("a", "write outputs/site/index.html", &[]), task("b", "validate the links with python", &["a"]), task("c", "package the site as a zip archive", &["b"])])));
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime(objective, &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let _ = rt.run(&model);
    let feedback = model.feedback.lock().unwrap().clone();
    assert_eq!(feedback.len(), 1, "exactly one plan repair");
    assert!(feedback[0].contains("outputs/site.zip") && feedback[0].contains("PLAN_REPAIR"));
    assert!(rt.graph().nodes().any(|n| n.objective.contains("zip")), "the repaired plan was not used");
}

#[test]
fn p08_a_plan_that_stays_incomplete_after_repair_gets_a_runtime_task_for_the_gap() {
    let objective = "Build outputs/site/index.html and package the site as outputs/site.zip.";
    let model = Scripted::new(true).plan(|| Ok(plan(vec![task("a", "write outputs/site/index.html", &[])]))).plan(|| Ok(plan(vec![task("a", "write outputs/site/index.html", &[])])));
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime(objective, &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let _ = rt.run(&model);
    assert!(rt.graph().nodes().any(|n| n.title == "Cover the remaining required results" && n.objective.contains("outputs/site.zip")));
}

// ——— التسليم والملاحظة والتذكير.

#[test]
fn p08_a_predecessor_result_reaches_the_dependent_task_as_a_structured_bounded_handoff() {
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("read", "read the data", &[]), task("write", "write outputs/r.md", &["read"])])))
        .step(|_, _| Ok(exec("FINDING-7Q: totals are 895/668/487", vec![tool("polaris.workspace.read", json!({"path": "inputs/x.csv"}))])))
        .step(|_, _| Ok(exec("read done", Vec::new())))
        .step(|_, _| Ok(exec("report", vec![tool("polaris.workspace.write", json!({"path": "outputs/r.md"}))])));
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime("Read the data and write outputs/r.md.", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let _ = rt.run(&model);
    let contexts = model.contexts.lock().unwrap().clone();
    let (_, second) = contexts.iter().find(|(o, _)| o == "write outputs/r.md").expect("the dependent task received no context");
    let text = second.previous_results.join("\n");
    assert!(text.contains("FINDING-7Q") && text.contains("polaris.workspace.read SUCCEEDED") && text.contains("unverified"), "{text}");
    assert!(!text.contains("observed output of"), "raw tool output travelled in the handoff");
    assert!(second.remaining_requirements.iter().any(|r| r.contains("outputs/r.md")));
}

#[test]
fn p08_an_observation_only_result_returns_to_the_model_while_requirements_remain() {
    // الوكيل يقرأ ولا يطلب المتابعة؛ بقاء متطلَّب غائب يعيد إليه النتيجة.
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("a", "read inputs/n.txt and write outputs/n.md", &[])])))
        .step(|_, _| Ok(exec("reading", vec![tool("polaris.workspace.read", json!({"path": "inputs/n.txt"}))])))
        .step(|_, turns| {
            assert!(turns.iter().any(|t| t.observation.as_deref() == Some("observed output of polaris.workspace.read")));
            Ok(exec("written", vec![tool("polaris.workspace.write", json!({"path": "outputs/n.md"}))]))
        });
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime("Read inputs/n.txt and write outputs/n.md.", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert!(model.continues.load(Ordering::SeqCst) >= 1, "the observation never fed another turn");
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
}

#[test]
fn p08_an_unmet_network_requirement_gets_one_reminder_and_the_proposal_still_waits_for_a_human() {
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("a", "download https://example.org with python and save its title to outputs/title.txt", &[])])))
        // يُنهي بلا أي أداة: يُذكَّر مرة واحدة.
        .step(|_, _| Ok(exec("I cannot reach the site", Vec::new())))
        .step(|_, _| Ok(exec("proposing the network step", vec![tool("polaris.execution.python", json!({"code": "import urllib.request", "network": true}))])));
    let world = World::new();
    let token = CancelToken::new();
    let broker = world.broker(|r: &ToolRequest| {
        if r.arguments.get("network").and_then(|n| n.as_bool()) == Some(true) {
            ("AWAITING_APPROVAL".into(), "waits for a human decision".into(), vec!["NETWORK_EGRESS".into()])
        } else {
            ok(r)
        }
    });
    let mut rt = runtime("Use Python with network access to download https://example.org and save its title to outputs/title.txt.", &token).with_tools(broker).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(model.reminders.lock().unwrap().len(), 1, "the reminder is bounded to one");
    assert!(model.reminders.lock().unwrap()[0].contains("network"));
    // التذكير لا يمنح شيئًا: الاقتراح انتظر قرارًا بشريًّا ولم يُنفَّذ.
    assert_eq!(report.mission_state, MissionState::WaitingForApproval);
    assert_eq!(report.tool_calls_executed, 0);
    assert_eq!(report.tool_calls_awaiting_approval, 1);
}

// ——— حلقة البرمجة.

#[test]
fn p08_a_failing_test_run_is_a_diagnostic_observation_and_the_edit_retest_loop_completes() {
    let runs = Arc::new(AtomicU32::new(0));
    let r2 = runs.clone();
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("fix", "run the tests in work/p, fix work/p/stats.py, rerun the tests and write outputs/report.md", &[])])))
        .step(|_, _| Ok(exec("running the tests", vec![tool("polaris.execution.command", json!({"command": "python -m unittest -v"}))])))
        .step(|_, turns| {
            // النتيجة الفاشلة عادت ملاحظةً، لا فشل أداة ولا فشل مهمّة.
            assert!(turns.last().is_some_and(|t| t.status == "SUCCEEDED" && t.summary.contains("TESTS_FAILED")));
            Ok(exec("fixing", vec![tool("polaris.workspace.write", json!({"path": "work/p/stats.py"}))]))
        })
        .step(|_, _| Ok(exec("rerunning", vec![tool("polaris.execution.command", json!({"command": "python -m unittest -v"}))])))
        .step(|_, turns| {
            assert!(turns.last().is_some_and(|t| t.summary.contains("TESTS_PASSED")));
            Ok(exec("reporting", vec![tool("polaris.workspace.write", json!({"path": "outputs/report.md"}))]))
        });
    let world = World::new();
    let token = CancelToken::new();
    let broker = world.broker(move |r: &ToolRequest| {
        if r.tool_id == "polaris.execution.command" {
            let n = r2.fetch_add(1, Ordering::SeqCst);
            let tag = if n == 0 { "tests: TESTS_FAILED (1 of 3 failed)" } else { "tests: TESTS_PASSED (3 run)" };
            ("SUCCEEDED".into(), format!("POWERSHELL run EXECUTED; {tag}"), vec!["SANDBOXED_EXECUTION".into()])
        } else {
            ok(r)
        }
    });
    let mut rt = runtime("Copy the project to work/p/, run the tests with python -m unittest, fix the bug in work/p/stats.py, rerun the tests until they pass, then write outputs/report.md.", &token)
        .with_tools(broker)
        .with_contract_probe(world.probe());
    // work/p/stats.py موجود قبل البدء (نُسخ في مهمّة سابقة).
    world.files.lock().unwrap().insert("work/p/stats.py".into(), FileInspection { exists: true, verified: true, has_chart: false, detail: String::new() });
    let report = rt.run(&model);
    assert_eq!(runs.load(Ordering::SeqCst), 2, "the tests ran before and after the edit");
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert!(rt.contract_checks().iter().all(|c| c.satisfied), "{:?}", rt.contract_checks());
}

#[test]
fn p08_fixture_ports_keep_their_closed_behaviour_without_the_recovery_hooks() {
    // منفذ بلا ضوابط Phase-08 لا يرى عقدًا ولا استكمالًا ولا تذكيرًا، حتى مع وجود منفذ القياس.
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "say done", &[])]))).step(|_, _| Ok(exec("done", Vec::new())));
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime(MISSION_B, &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed);
    assert!(rt.contract().is_empty() && model.contexts.lock().unwrap().is_empty() && model.reminders.lock().unwrap().is_empty());
}

#[test]
fn p08_a_task_whose_reply_stays_malformed_after_its_repair_gets_one_fresh_attempt_then_fails_as_before() {
    let model = Scripted::new(true)
        .plan(|| Ok(plan(vec![task("a", "write outputs/n.md", &[])])))
        .step(|_, _| Err(ModelError::InvalidOutput("expected `,`".into())))
        .step(|_, _| Err(ModelError::InvalidOutput("expected `,` again".into())))
        .step(|_, _| Ok(exec("written", vec![tool("polaris.workspace.write", json!({"path": "outputs/n.md"}))])));
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime("Write outputs/n.md.", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert_eq!(rt.graph().nodes().next().unwrap().attempt, 1, "the fresh attempt was not counted");
    // بلا ضوابط Phase-08: الفشل كما أُغلق.
    let closed = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "x", &[])]))).step(|_, _| Err(ModelError::InvalidOutput("bad".into()))).step(|_, _| Err(ModelError::InvalidOutput("bad".into())));
    let mut rt = runtime("x", &token).with_tools(world.broker(ok));
    assert_eq!(rt.run(&closed).mission_state, MissionState::Blocked);
}

// ——— قِيس في التشغيل القانوني (MISSION-D): محاولات فاشلة تراكمت «نداءات متزامنة» وهمية حتى
// رفض الدفتر نداءً شرعيًّا (ConcurrentModelCalls limit 3, requested 4) في مهمّة بوكيل واحد.

#[test]
fn p08_failed_model_attempts_release_their_concurrency_so_a_long_mission_is_not_blocked_by_phantom_calls() {
    let mut model = Scripted::new(true).plan(|| Ok(plan(vec![task("a", "step a", &[]), task("b", "step b", &["a"]), task("c", "step c", &["b"]), task("d", "step d", &["c"])])));
    for _ in 0..4 {
        // كل مهمّة: إخفاق عابر ثم مخرجات مشوّهة (تُصلَح) ثم ردّ صالح — محاولتان فاشلتان لكلٍّ منها.
        model = model
            .step(|_, _| Err(ModelError::Transient("PROVIDER_TIMEOUT".into())))
            .step(|_, _| Err(ModelError::InvalidOutput("expected `,`".into())))
            .step(|_, _| Ok(exec("done", Vec::new())));
    }
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = MissionRuntime::new(mission("four steps"), RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_cancel(token.clone())
        .with_transient_policy(TransientPolicy::immediate(2, 8))
        .with_tools(world.broker(ok));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert!(!matches!(report.stop_reason, Some(StopReason::BudgetExhausted(_))), "a phantom concurrent call exhausted the budget");
}

// ——— انحدار Phase-05 (P05-E2E-13a): رفض عند حدّ السياسة لا يُتابَع ولا يُستكمَل ولا يُكرَّر.

#[test]
fn p08_a_policy_denial_is_not_followed_reminded_or_continued_and_a_repeated_request_ends_the_rounds() {
    // النموذج يعيد الطلب المرفوض نفسه في كل ردّ لو سُئل.
    let mut model = Scripted::new(true).plan(|| Ok(plan(vec![task("a", "open http://169.254.169.254/ and read it", &[])])));
    for _ in 0..8 {
        model = model.step(|_, _| Ok(exec("opening", vec![tool("polaris.browser.open", json!({"url": "http://169.254.169.254/"}))])));
    }
    let world = World::new();
    let token = CancelToken::new();
    let deny = |_: &ToolRequest| ("DENIED".to_string(), "NETWORK_POLICY_DENIED: a metadata address".to_string(), Vec::new());
    let mut rt = runtime("Open http://169.254.169.254/ in the browser and read it.", &token).with_tools(world.broker(deny)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(world.log.lock().unwrap().len(), 1, "a request refused at the policy boundary was proposed again");
    assert_eq!(model.continues.load(Ordering::SeqCst), 0, "a policy denial fed a follow-up turn");
    assert!(model.reminders.lock().unwrap().is_empty(), "a reminder invited the refused request");
    assert!(!matches!(report.stop_reason, Some(StopReason::BudgetExhausted(_))), "{:?}", report.stop_reason);
}

#[test]
fn p08_identical_requests_after_seeing_their_results_end_the_tool_rounds() {
    let mut model = Scripted { wants_results: true, ..Scripted::new(false) }.plan(|| Ok(plan(vec![task("a", "list files", &[])])));
    for _ in 0..8 {
        model = model.step(|_, _| Ok(exec("listing", vec![tool("polaris.workspace.list", json!({"path": "."}))])));
    }
    let world = World::new();
    let token = CancelToken::new();
    let mut rt = runtime("List the files.", &token).with_tools(world.broker(ok));
    let _ = rt.run(&model);
    assert!(world.log.lock().unwrap().len() <= 2, "the same request ran {} times", world.log.lock().unwrap().len());
}

// ——— الردّ النهائي يصل المستخدم (قيس 2026-09-30 في بيانات المالك: مهمّة «هلا» اكتملت و result_summary = NULL،
// فلم يرَ المستخدم أي جواب). المهمّة المكتملة تحمل آخر ما قاله الوكيل في آخر مهمّة لها مخرَج، محدودًا.

#[test]
fn p08_a_completed_mission_carries_the_agent_final_answer_as_its_result_summary() {
    let token = CancelToken::new();
    let model = Scripted::new(false)
        .plan(|| Ok(plan(vec![task("greet", "greet the user", &[]), task("offer", "offer help", &["greet"])])))
        .step(|_, _| Ok(exec("Hello!", Vec::new())))
        .step(|_, _| Ok(exec("Hello! How can I help you today?", Vec::new())));
    let world = World::new();
    let mut rt = runtime("hi", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed);
    assert_eq!(rt.mission().result_summary.as_deref(), Some("Hello! How can I help you today?"), "the user never sees the agent's answer");
}

#[test]
fn p08_the_result_summary_is_bounded_to_the_store_limit_on_a_character_boundary() {
    let token = CancelToken::new();
    let long = "ب".repeat(5000);
    let answer = long.clone();
    let model = Scripted::new(false).plan(|| Ok(plan(vec![task("a", "answer", &[])]))).step(move |_, _| Ok(exec(&answer, Vec::new())));
    let world = World::new();
    let mut rt = runtime("hi", &token).with_tools(world.broker(ok)).with_contract_probe(world.probe());
    rt.run(&model);
    let summary = rt.mission().result_summary.clone().expect("no summary");
    assert!(summary.chars().count() <= 4000, "the summary exceeds the column limit");
    assert!(long.starts_with(summary.trim_end_matches('…')));
}
