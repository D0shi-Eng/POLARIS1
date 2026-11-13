// G4 (تكليف 2026-10-14): تفويضات مستقلّة يطلبها المنسّق في ردّ واحد تعمل فروعًا متوازية بحدّ معلن، مع الميزانية والإلغاء
// والتتبّع لكل فرع. TEST FIXTURE: النموذج مُبرمَج، والوسيط تجهيزة.
//
// ما يُثبت هنا:
// - التزامن: نداءا نموذج الفرعين يجريان معًا (حاجز لا يُفتح إلا إذا وصله النداءان معًا).
// - الإلغاء أثناء جولة متوازية يوقف الفرعين كليهما، ولا نداء بعده.
// - الميزانية: كل نداء يُحتسب مرة واحدة (العدد والرموز)، بلا تضاعف.
// - التتبّع: امتداد وكيل لكل فرع تحت المنسّق، وامتداد `chat` لكل نداء منسوب إلى فرعه.
// - النموذج الذي لا يعلن توازيًا (المحلي افتراضًا) يبقى متسلسلًا.

mod s2_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use polaris_host_providers::domain::{ChatMessage, ToolOffer};
use polaris_host_providers::net::CancelToken;
use serde_json::json;

use polaris_host_core::p03::agent::AgentRole;
use polaris_host_core::p03::agent_loop::LoopMode;
use polaris_host_core::p03::port::{AgentModel, LoopTurn, ModelError, PlanProposal, ReviewResult, TaskExecution};
use polaris_host_core::p03::runtime::StopReason;
use polaris_host_core::p03::task::{TaskState, TaskType};
use polaris_host_core::p03::watch::spans::MemorySpans;
use s2_support::{calls, ok, text, World};

/// عدّاد من بداخل نداء نموذج الفرع الآن، وأعلى قيمة بلغها.
#[derive(Default)]
struct Gauge {
    state: Mutex<(usize, usize)>,
    changed: Condvar,
}

impl Gauge {
    /// يدخل، وينتظر (بحدّ) حتى يبلغ العدد `want`، ثم يخرج. يعيد أعلى قيمة بلغها العدد.
    fn enter_and_wait(&self, want: usize) -> usize {
        let mut s = self.state.lock().unwrap();
        s.0 += 1;
        s.1 = s.1.max(s.0);
        self.changed.notify_all();
        let (mut s, _) = self.changed.wait_timeout_while(s, Duration::from_secs(3), |s| s.1 < want).unwrap();
        s.0 -= 1;
        s.1
    }
    fn peak(&self) -> usize {
        self.state.lock().unwrap().1
    }
}

/// نموذج يفوّض في ردّه الأول تفويضين مستقلّين، ونداءات الفرعين تمرّ بالحاجز.
struct FanOutModel {
    width: usize,
    gauge: Gauge,
    coordinator_calls: AtomicUsize,
    helper_calls: AtomicUsize,
    /// يُلغى حين يصل الفرعان معًا (محاكاة «قف» أثناء جولة متوازية).
    cancel_on_fan_out: Option<CancelToken>,
    /// PHASE-07: ما رآه المنسّق في ندائه الثاني (نتائج التفويضين).
    seen: Mutex<String>,
}

impl FanOutModel {
    fn new(width: usize, cancel_on_fan_out: Option<CancelToken>) -> Self {
        Self { width, gauge: Gauge::default(), coordinator_calls: AtomicUsize::new(0), helper_calls: AtomicUsize::new(0), cancel_on_fan_out, seen: Mutex::new(String::new()) }
    }
}

impl AgentModel for FanOutModel {
    fn plan(&self, _: &str) -> Result<PlanProposal, ModelError> {
        Err(ModelError::InvalidOutput("loop only".into()))
    }
    fn execute(&self, _: AgentRole, _: TaskType, _: &str) -> Result<TaskExecution, ModelError> {
        Err(ModelError::InvalidOutput("loop only".into()))
    }
    fn review(&self, _: AgentRole, _: &str) -> Result<ReviewResult, ModelError> {
        Err(ModelError::InvalidOutput("no reviewer".into()))
    }
    fn loop_mode(&self) -> Option<LoopMode> {
        Some(LoopMode::Native)
    }
    fn parallel_first_calls(&self) -> usize {
        self.width
    }
    fn loop_turn(&self, _system: &str, messages: &[ChatMessage], _tools: &[ToolOffer]) -> Result<LoopTurn, ModelError> {
        let first = messages.first().map(|m| m.text.clone()).unwrap_or_default();
        if first.starts_with("[DELEGATED_TASK") {
            self.helper_calls.fetch_add(1, Ordering::SeqCst);
            let branch = if first.contains("branch A") { "A" } else { "B" };
            let peak = self.gauge.enter_and_wait(2);
            if let Some(token) = &self.cancel_on_fan_out {
                if peak >= 2 {
                    token.cancel();
                }
                return Err(ModelError::Cancelled);
            }
            return Ok(text(&format!("Branch {branch} finished its part.")));
        }
        match self.coordinator_calls.fetch_add(1, Ordering::SeqCst) {
            0 => Ok(calls(&[
                ("delegate_task", json!({ "objective": "Research branch A: list the three oldest records." })),
                ("delegate_task", json!({ "objective": "Research branch B: list the three newest records." })),
            ])),
            _ => {
                *self.seen.lock().unwrap() = messages.iter().map(|m| m.text.as_str()).collect::<Vec<_>>().join("
");
                Ok(text("Both branches worked in parallel and reported; here is the combined answer."))
            }
        }
    }
}

#[test]
fn g4_two_independent_delegations_run_at_the_same_time_and_count_once() {
    let world = World::new();
    let spans = Arc::new(MemorySpans::default());
    let model = FanOutModel::new(3, None);
    let mut rt = world.runtime("Compare oldest and newest records.", ok).with_spans(spans.clone());
    let report = rt.run(&model);
    assert_eq!(model.gauge.peak(), 2, "the two helpers' model calls never overlapped");
    assert_eq!(report.delegations_executed, 2, "{report:?}");
    // نداءان للمنسّق ونداء لكل فرع، كلٌّ بـ 10 + 5 رموز: لا تضاعف ولا نقص.
    assert_eq!(model.coordinator_calls.load(Ordering::SeqCst), 2);
    assert_eq!(model.helper_calls.load(Ordering::SeqCst), 2);
    assert_eq!(report.model_calls, 4, "{report:?}");
    assert_eq!(report.total_tokens, 60, "{report:?}");
    let recorded = spans.spans();
    let agents: Vec<_> = recorded.iter().filter(|s| s.name == "invoke_agent").collect();
    let root = agents.iter().find(|s| s.parent_span_id.is_none()).expect("the coordinator has an agent span");
    let helpers: Vec<_> = agents.iter().filter(|s| s.parent_span_id.as_deref() == Some(root.span_id.as_str())).collect();
    assert_eq!(helpers.len(), 2, "each branch has its own agent span under the coordinator: {recorded:?}");
    for h in &helpers {
        let chats = recorded.iter().filter(|s| s.name == "chat" && s.parent_span_id.as_deref() == Some(h.span_id.as_str()) && s.agent_id == h.agent_id).count();
        assert_eq!(chats, 1, "the branch {:?} has {chats} chat spans", h.agent_id);
    }
    assert!(rt.graph().nodes().filter(|n| n.parent_task_id.is_some()).all(|n| n.state != TaskState::Running && n.state != TaskState::Failed));
}

#[test]
fn g4_cancelling_during_a_parallel_round_stops_both_branches() {
    let world = World::new();
    let token = CancelToken::new();
    let model = FanOutModel::new(3, Some(token.clone()));
    let mut rt = world.runtime("Compare oldest and newest records.", ok).with_cancel(token);
    let report = rt.run(&model);
    assert_eq!(model.gauge.peak(), 2, "the cancel did not arrive during a parallel round");
    assert_eq!(model.helper_calls.load(Ordering::SeqCst), 2, "a branch was called again after the cancel");
    assert_eq!(model.coordinator_calls.load(Ordering::SeqCst), 1, "the coordinator was called after the cancel");
    assert!(matches!(report.stop_reason, Some(StopReason::Cancelled)), "{report:?}");
    let children: Vec<_> = rt.graph().nodes().filter(|n| n.parent_task_id.is_some()).collect();
    assert_eq!(children.len(), 2);
    assert!(children.iter().all(|n| n.state == TaskState::Cancelled), "{:?}", children.iter().map(|n| n.state).collect::<Vec<_>>());
}

#[test]
fn g4_a_model_without_declared_parallelism_keeps_delegations_sequential() {
    let world = World::new();
    let model = FanOutModel::new(1, None);
    let mut rt = world.runtime("Compare oldest and newest records.", ok);
    let report = rt.run(&model);
    assert_eq!(model.gauge.peak(), 1, "a local model ran two calls at once");
    assert_eq!(report.delegations_executed, 2);
    assert_eq!(report.model_calls, 4);
}

/// CP-07-2 (تشغيل Bonsai 2، 2026-10-21): المنسّق قال «وزّعت العمل على مساعدين بالتوازي» والمساعدان جريا متتاليين على النموذج
/// المحلي. نتيجة كل تفويض من ردّ فيه أكثر من تفويض تحمل سطر مضيف يقول كيف جرى فعلًا، فلا يُستنتج التوازي من وصف الأداة.
#[test]
fn cp07_each_delegation_result_says_whether_the_helpers_ran_together_or_one_after_another() {
    for (width, expected, absent) in [(1, "one after another", "at the same time"), (3, "at the same time", "one after another")] {
        let world = World::new();
        let model = FanOutModel::new(width, None);
        let mut rt = world.runtime("Compare oldest and newest records.", ok);
        rt.run(&model);
        let seen = model.seen.lock().unwrap().clone();
        assert_eq!(seen.matches(expected).count(), 2, "width {width}: each of the two results must say {expected:?}: {seen}");
        assert!(!seen.contains(absent), "width {width}: {absent:?} must not appear: {seen}");
    }
}

/// PHASE-09: «worked in parallel» في الردّ ادّعاء فعلٍ يُقاس. على نموذج يعلن نداءً واحدًا في وقت واحد لم تجرِ جولة متوازية، فلا
/// يسند حدثٌ الادّعاء: متطلَّب غير مستوفى وحدث أمني. وحين جرت الفروع معًا فعلًا يُستوفى.
#[test]
fn cp09_a_reported_parallel_run_is_backed_only_when_the_branches_really_ran_together() {
    use polaris_host_core::p03::mission::RequirementStatus;
    for (width, backed) in [(1, false), (3, true)] {
        let world = World::new();
        let model = FanOutModel::new(width, None);
        let mut rt = world.runtime("Compare oldest and newest records.", ok);
        rt.run(&model);
        let status = rt.mission().requirements.iter().find(|r| r.requirement_id.starts_with('A') && !r.requirement_id.starts_with("AGENT-")).map(|r| r.status);
        let expected = if backed { RequirementStatus::Satisfied } else { RequirementStatus::Unsatisfied };
        assert_eq!(status, Some(expected), "width {width}: {:?}", rt.mission().requirements);
        assert_eq!(rt.security_events().iter().any(|e| e.kind == "ACTION_UNBACKED"), !backed, "width {width}");
    }
}
