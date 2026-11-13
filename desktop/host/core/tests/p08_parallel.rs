// خطة 2026-10-05، E4 — نداءات التنفيذ الأولى لخطوات مستقلّة تجري معًا على نموذج بعيد، بحدّ ثلاث.
//
// ما يُثبت هنا: العرض يصل إلى حدّه ولا يتجاوزه، والافتراض (نموذج محلي) خطوة واحدة في وقت واحد، ونداء أول فشل يُعاد
// في دور خطوته بالمسار المنفرد ولا يُحتسب نجاحًا، والمراجعة لا تتوازى، وكل خطوة تُتمّ بالترتيب الحتمي نفسه.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use polaris_host_providers::net::CancelToken;

use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionState};
use polaris_host_core::p03::port::{AgentModel, ModelError, PlanProposal, PlannedTask, ReviewResult, ReviewVerdict, TaskExecution};
use polaris_host_core::p03::retry::TransientPolicy;
use polaris_host_core::p03::runtime::MissionRuntime;
use polaris_host_core::p03::task::{DependencyKind, TaskType};
use polaris_host_core::p03::trust::AuthorityClass;

fn mission() -> Mission {
    Mission {
        mission_id: "m-parallel".into(),
        project_id: None,
        title: "parallel".into(),
        title_authority: AuthorityClass::DirectUserInstruction,
        objective: "research three things, then combine them".into(),
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

fn planned(key: &str, task_type: TaskType, role: AgentRole, deps: &[&str]) -> PlannedTask {
    PlannedTask {
        local_key: key.into(),
        title: key.into(),
        objective: format!("do {key}"),
        task_type,
        depends_on: deps.iter().map(|d| d.to_string()).collect(),
        dependency_kind: DependencyKind::RequiresSuccess,
        recommended_role: role,
    }
}

fn plan() -> PlanProposal {
    PlanProposal {
        tasks: vec![
            planned("a", TaskType::Research, AgentRole::Researcher, &[]),
            planned("b", TaskType::Research, AgentRole::Researcher, &[]),
            planned("c", TaskType::Research, AgentRole::Researcher, &[]),
            planned("d", TaskType::Research, AgentRole::Researcher, &[]),
            planned("check", TaskType::Review, AgentRole::Reviewer, &["a", "b", "c", "d"]),
        ],
    }
}

struct Concurrent {
    width: usize,
    plan: Mutex<Option<PlanProposal>>,
    live: AtomicUsize,
    peak: AtomicUsize,
    executes: Mutex<HashMap<String, usize>>,
    /// خطوة يفشل نداؤها الأول عابرًا مرة واحدة.
    flaky: Option<&'static str>,
}

impl Concurrent {
    fn new(width: usize, flaky: Option<&'static str>) -> Self {
        Self { width, plan: Mutex::new(Some(plan())), live: AtomicUsize::new(0), peak: AtomicUsize::new(0), executes: Mutex::new(HashMap::new()), flaky }
    }
}

impl AgentModel for Concurrent {
    fn plan(&self, _objective: &str) -> Result<PlanProposal, ModelError> {
        self.plan.lock().unwrap().take().ok_or_else(|| ModelError::InvalidOutput("planned once".into()))
    }
    fn execute(&self, _role: AgentRole, _t: TaskType, objective: &str) -> Result<TaskExecution, ModelError> {
        let count = {
            let mut map = self.executes.lock().unwrap();
            let n = map.entry(objective.to_string()).or_insert(0);
            *n += 1;
            *n
        };
        let now = self.live.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(120));
        self.live.fetch_sub(1, Ordering::SeqCst);
        if self.flaky.is_some_and(|f| objective.ends_with(f)) && count == 1 {
            return Err(ModelError::Transient("PROVIDER_TIMEOUT".into()));
        }
        Ok(TaskExecution { output_summary: format!("{objective}: done"), claims: Vec::new(), evidence: Vec::new(), tool_requests: Vec::new(), delegation: None, input_tokens: 0, output_tokens: 0, failed: false })
    }
    fn review(&self, _role: AgentRole, _target: &str) -> Result<ReviewResult, ModelError> {
        let now = self.live.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        self.live.fetch_sub(1, Ordering::SeqCst);
        Ok(ReviewResult { verdict: ReviewVerdict::Accept, notes: "fine".into(), input_tokens: 0, output_tokens: 0 })
    }
    fn parallel_first_calls(&self) -> usize {
        self.width
    }
}

fn run(model: &Concurrent) -> MissionState {
    let mut rt = MissionRuntime::new(mission(), RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_cancel(CancelToken::new())
        .with_transient_policy(TransientPolicy::immediate(2, 6));
    rt.run(model).mission_state
}

#[test]
fn p08_parallel_a_remote_executor_runs_up_to_three_first_calls_together_and_never_more() {
    let model = Concurrent::new(3, None);
    let state = run(&model);
    assert_eq!(state, MissionState::Completed);
    assert_eq!(model.peak.load(Ordering::SeqCst), 3, "the first calls did not overlap up to the limit");
    let executes = model.executes.lock().unwrap().clone();
    assert_eq!(executes.len(), 4);
    assert!(executes.values().all(|n| *n == 1), "a step was executed twice: {executes:?}");
}

#[test]
fn p08_parallel_the_default_and_a_local_executor_stay_one_call_at_a_time() {
    let model = Concurrent::new(1, None);
    let state = run(&model);
    assert_eq!(state, MissionState::Completed);
    assert_eq!(model.peak.load(Ordering::SeqCst), 1);
}

#[test]
fn p08_parallel_a_failed_first_call_is_redone_in_its_turn_by_the_single_path() {
    let model = Concurrent::new(3, Some("b"));
    let state = run(&model);
    assert_eq!(state, MissionState::Completed);
    let executes = model.executes.lock().unwrap().clone();
    assert_eq!(executes.get("do b"), Some(&2), "the failed first call was not redone: {executes:?}");
    assert_eq!(executes.get("do a"), Some(&1));
}
