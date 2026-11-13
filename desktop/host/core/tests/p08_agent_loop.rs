// ADR-039 — حلقة الوكيل: محادثة واحدة بأدوات تمرّ بالبوابة، وخطة يحدّثها الوكيل، وردّ نهائي بلا أداة.
//
// كل اختبار هنا بنموذج مُبرمَج (TEST FIXTURE) ووسيط أدوات مُبرمَج، لا بنموذج حقيقي. ما يُثبت: الحلقة تستمرّ ما دام الوكيل
// يطلب أدوات وتنتهي بردّه؛ كل أداة تصل البوابة بمعرّفها لا باسمها المعروض، ونتيجتها تعود برسالة أداة تحمل معرّف الاستدعاء؛
// الخطة تصير عُقدًا تُنسب إليها الأدوات؛ مخرَج مطلوب غائب يعيد الوكيل إلى العمل بحدّ؛ التكرار بلا تقدّم يوقف المهمّة؛ انتظار
// الموافقة يوقف الحلقة؛ الصيغة النصّية تعمل كالأصيلة؛ الردّ المعيب يُصلَح بملاحظة؛ الوكيل المساعد يبدأ بسياق نظيف.

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use polaris_host_providers::domain::{ChatMessage, ProposedToolCall, Role, ToolOffer};
use serde_json::json;

use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::agent_loop::LoopMode;
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionState};
use polaris_host_core::p03::port::{
    AgentModel, ContractProbe, FileInspection, LoopTurn, ModelError, PlanProposal, ReviewResult, TaskExecution, ToolBroker, ToolDecision, ToolRecordNote, ToolRequest,
};
use polaris_host_core::p03::retry::TransientPolicy;
use polaris_host_core::p03::runtime::{MissionRuntime, StopReason};
use polaris_host_core::p03::task::{TaskState, TaskType};
use polaris_host_core::p03::trust::AuthorityClass;

fn mission(objective: &str) -> Mission {
    Mission {
        mission_id: "m-loop".into(),
        project_id: None,
        title: "loop".into(),
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

type Turn = Box<dyn FnMut(&[ChatMessage]) -> Result<LoopTurn, ModelError> + Send>;

/// ما رآه النموذج في نداء: تعليمة النظام والرسائل وأسماء الأدوات.
#[derive(Clone)]
struct Seen {
    system: String,
    messages: Vec<ChatMessage>,
    tools: Vec<String>,
}

struct LoopModel {
    mode: Mutex<LoopMode>,
    turns: Mutex<VecDeque<Turn>>,
    seen: Mutex<Vec<Seen>>,
    reviewer: Option<Mutex<VecDeque<ReviewResult>>>,
}

impl LoopModel {
    fn new(mode: LoopMode) -> Self {
        Self { mode: Mutex::new(mode), turns: Mutex::new(VecDeque::new()), seen: Mutex::new(Vec::new()), reviewer: None }
    }
    fn then(self, turn: impl FnMut(&[ChatMessage]) -> Result<LoopTurn, ModelError> + Send + 'static) -> Self {
        self.turns.lock().unwrap().push_back(Box::new(turn));
        self
    }
    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl AgentModel for LoopModel {
    fn plan(&self, _: &str) -> Result<PlanProposal, ModelError> {
        Err(ModelError::InvalidOutput("the loop never plans with a graph".into()))
    }
    fn execute(&self, _: AgentRole, _: TaskType, _: &str) -> Result<TaskExecution, ModelError> {
        Err(ModelError::InvalidOutput("the loop never executes a graph step".into()))
    }
    fn review(&self, _: AgentRole, _: &str) -> Result<ReviewResult, ModelError> {
        match &self.reviewer {
            Some(queue) => queue.lock().unwrap().pop_front().ok_or_else(|| ModelError::InvalidOutput("no scripted review".into())),
            None => Err(ModelError::InvalidOutput("no reviewer".into())),
        }
    }
    fn reviews_independently(&self) -> bool {
        self.reviewer.is_some()
    }
    fn loop_mode(&self) -> Option<LoopMode> {
        Some(*self.mode.lock().unwrap())
    }
    fn loop_turn(&self, system: &str, messages: &[ChatMessage], tools: &[ToolOffer]) -> Result<LoopTurn, ModelError> {
        self.seen.lock().unwrap().push(Seen { system: system.into(), messages: messages.to_vec(), tools: tools.iter().map(|t| t.name.clone()).collect() });
        let turn = self.turns.lock().unwrap().pop_front();
        match turn {
            Some(mut t) => t(messages),
            None => Ok(text("nothing more")),
        }
    }
}

fn text(t: &str) -> LoopTurn {
    LoopTurn { text: t.into(), input_tokens: 10, output_tokens: 5, ..Default::default() }
}

fn calls(list: &[(&str, serde_json::Value)]) -> LoopTurn {
    LoopTurn {
        tool_calls: list.iter().enumerate().map(|(i, (name, args))| ProposedToolCall { id: Some(format!("call-{i}-{name}")), name: (*name).into(), arguments: args.to_string() }).collect(),
        input_tokens: 10,
        output_tokens: 5,
        ..Default::default()
    }
}

type Decide = Box<dyn Fn(&ToolRequest) -> (String, Option<String>) + Send + Sync>;

/// وسيط مُبرمَج: يسجّل كل طلب بعقدته، ويقرّر بالدالّة، ويكتب ملفًّا للكتابة الناجحة.
struct Broker {
    decide: Decide,
    log: Arc<Mutex<Vec<ToolRecordNote>>>,
    files: Arc<Mutex<BTreeMap<String, FileInspection>>>,
    requests: Arc<Mutex<Vec<(String, ToolRequest)>>>,
}

impl ToolBroker for Broker {
    fn default_skill(&self) -> Option<String> {
        Some("polaris.skill.agentic-work".into())
    }
    fn tools_for(&self, _: &str) -> Vec<String> {
        vec!["polaris.workspace.write".into(), "polaris.workspace.read".into(), "polaris.execution.python".into()]
    }
    fn tool_guide(&self, _: &str) -> Vec<(String, String)> {
        vec![("polaris.workspace.write".into(), "Write a file in the workspace.".into())]
    }
    fn tool_schemas(&self, _: &str) -> Vec<(String, serde_json::Value)> {
        vec![("polaris.workspace.write".into(), json!({ "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } }, "required": ["path", "content"] }))]
    }
    fn invoke(&self, task_id: &str, _agent: &str, request: &ToolRequest) -> ToolDecision {
        self.requests.lock().unwrap().push((task_id.to_string(), request.clone()));
        let (status, denial) = (self.decide)(request);
        if status == "SUCCEEDED" && request.tool_id == "polaris.workspace.write" {
            if let Some(path) = request.arguments.get("path").and_then(|p| p.as_str()) {
                self.files.lock().unwrap().insert(path.to_string(), FileInspection { exists: true, verified: true, has_chart: false, detail: "ok".into() });
            }
        }
        let mut log = self.log.lock().unwrap();
        let invocation_id = format!("i{}", log.len());
        log.push(ToolRecordNote {
            invocation_id,
            task_id: task_id.into(),
            tool_id: request.tool_id.clone(),
            status: status.clone(),
            denial_reason: denial.clone(),
            effects: Vec::new(),
            summary: format!("{} {}", request.tool_id, status),
        });
        drop(log);
        ToolDecision {
            invocation_id: "d".into(),
            tool_id: request.tool_id.clone(),
            skill_id: request.skill_id.clone(),
            status: status.clone(),
            denial_reason: denial,
            summary: format!("{} {status}", request.tool_id),
            evidence_recorded: status == "SUCCEEDED",
            pending_approval_id: (status == "AWAITING_APPROVAL").then(|| "ap-1".into()),
            observation: Some(format!("output of {}", request.tool_id)),
        }
    }
    fn executed_calls(&self) -> u32 {
        self.log.lock().unwrap().len() as u32
    }
    // ADR-043: مهارة تعليمية واحدة أداتها في مجموعة التشغيل المؤجَّلة لطلب لا يدلّ عليها.
    fn playbooks(&self) -> Vec<polaris_host_core::p03::port::Playbook> {
        vec![polaris_host_core::p03::port::Playbook { skill_id: "polaris.playbook.data-analysis".into(), description: "Analyse data with Python.".into(), body: "1. Read the file first and print its columns.".into(), trusted: true, required_tools: vec!["polaris.execution.python".into()] }]
    }
}

struct Probe {
    log: Arc<Mutex<Vec<ToolRecordNote>>>,
    files: Arc<Mutex<BTreeMap<String, FileInspection>>>,
}

impl ContractProbe for Probe {
    fn inspect_file(&self, _: &str, path: &str) -> FileInspection {
        self.files.lock().unwrap().get(path).cloned().unwrap_or_default()
    }
    fn tool_history(&self, _: &str) -> Vec<ToolRecordNote> {
        self.log.lock().unwrap().clone()
    }
    fn workspace_files(&self, _: &str) -> Vec<String> {
        self.files.lock().unwrap().keys().cloned().collect()
    }
}

struct World {
    log: Arc<Mutex<Vec<ToolRecordNote>>>,
    files: Arc<Mutex<BTreeMap<String, FileInspection>>>,
    requests: Arc<Mutex<Vec<(String, ToolRequest)>>>,
}

impl World {
    fn new() -> Self {
        Self { log: Arc::default(), files: Arc::default(), requests: Arc::default() }
    }
    fn runtime(&self, objective: &str, decide: impl Fn(&ToolRequest) -> (String, Option<String>) + Send + Sync + 'static) -> MissionRuntime {
        let broker = Broker { decide: Box::new(decide), log: self.log.clone(), files: self.files.clone(), requests: self.requests.clone() };
        MissionRuntime::new(mission(objective), RuntimeClock::deterministic(), AgentRegistry::builtin())
            .with_transient_policy(TransientPolicy::immediate(2, 6))
            .with_tools(Arc::new(broker))
            .with_contract_probe(Arc::new(Probe { log: self.log.clone(), files: self.files.clone() }))
            .with_reply()
            .with_agent_loop(true)
    }
    fn requests(&self) -> Vec<(String, ToolRequest)> {
        self.requests.lock().unwrap().clone()
    }
}

fn ok(_: &ToolRequest) -> (String, Option<String>) {
    ("SUCCEEDED".into(), None)
}

#[test]
fn p08_loop_runs_tools_through_the_gateway_until_a_reply_without_tools_and_records_the_plan() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/report.md summarising the notes.", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| {
            let mut turn = calls(&[("update_plan", json!({ "title": "ملخّص الملاحظات", "steps": [{ "step": "اكتب الملخّص", "status": "in_progress" }, { "step": "تحقّق", "status": "pending" }] }))]);
            turn.text = "سأكتب الملخّص.".into();
            Ok(turn)
        })
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/report.md", "content": "# Summary" }))])))
        .then(|messages| {
            // نتيجة الأداة عادت برسالة أداة تحمل معرّف الاستدعاء، وحالتها من البوابة.
            let last = messages.last().unwrap();
            assert_eq!(last.role, Role::Tool);
            assert_eq!(last.tool_call_id.as_deref(), Some("call-0-write_file"));
            assert!(last.text.starts_with("status: SUCCEEDED"), "{}", last.text);
            assert!(last.text.contains("<<<UNTRUSTED"), "tool output reached the model unfenced");
            Ok(calls(&[("update_plan", json!({ "steps": [{ "step": "اكتب الملخّص", "status": "completed" }, { "step": "تحقّق", "status": "completed" }] }))]))
        })
        .then(|_| Ok(text("كتبتُ الملخّص في outputs/report.md.\n>> اختصره أكثر")));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert_eq!(rt.mission().result_summary.as_deref(), Some("كتبتُ الملخّص في outputs/report.md."));
    assert_eq!(rt.mission().title, "ملخّص الملاحظات");
    // الأداة وصلت البوابة بمعرّفها، ونُسبت إلى خطوة الخطة الجارية لا إلى الجذر.
    let requests = world.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].1.tool_id, "polaris.workspace.write");
    let plan_step = rt.graph().nodes().find(|n| n.title == "اكتب الملخّص").expect("the plan step");
    assert_eq!(requests[0].0, plan_step.task_id, "the call was not attributed to the running plan step");
    // خطة 2026-10-07 (ADR-041 §3.3): الخطوة التي نُسبت إليها كتابة نجحت SUCCEEDED، و«تحقّق» التي قال الوكيل إنها تمّت بلا أداة
    // تخصّها UNVERIFIED_DONE، لا نجاحًا.
    let states: Vec<(String, TaskState)> = rt.graph().nodes().map(|n| (n.title.clone(), n.state)).collect();
    assert_eq!(states.iter().find(|(t, _)| t == "اكتب الملخّص").map(|(_, s)| *s), Some(TaskState::Succeeded), "{states:?}");
    assert_eq!(states.iter().find(|(t, _)| t == "تحقّق").map(|(_, s)| *s), Some(TaskState::UnverifiedDone), "{states:?}");
    assert_eq!(rt.graph().len(), 3, "root plus two plan steps");
    let seen = model.seen();
    assert_eq!(seen.len(), 4);
    assert!(seen[0].system.contains("<authority_and_safety>") && seen[0].system.contains("<how_to_work>"));
    assert!(seen[0].messages[0].text.starts_with("[USER_REQUEST]\nWrite outputs/report.md"));
    assert!(seen[0].tools.contains(&"write_file".to_string()) && seen[0].tools.contains(&"update_plan".to_string()));
    // التعليمة ثابتة طوال المهمّة: البادئة واحدة.
    assert!(seen.windows(2).all(|w| w[0].system == w[1].system));
}

#[test]
fn p08_loop_a_missing_deliverable_sends_the_agent_back_twice_then_the_mission_says_what_is_missing() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/report.md summarising the notes.", ok);
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(text("done"))).then(|messages| {
        let note = &messages.last().unwrap().text;
        assert!(note.contains("POLARIS checked the workspace") && note.contains("outputs/report.md"), "{note}");
        Ok(text("done again"))
    });
    let report = rt.run(&model);
    assert_eq!(model.seen().len(), 3, "the agent was sent back more or less than twice");
    assert!(matches!(report.stop_reason, Some(StopReason::DeliverablesIncomplete(_))), "{:?}", report.stop_reason);
    assert_ne!(report.mission_state, MissionState::Completed);
}

#[test]
fn p08_loop_the_same_failing_calls_get_one_note_then_the_mission_stops_for_no_progress() {
    let world = World::new();
    let mut rt = world.runtime("compute something", |_| ("FAILED".into(), None));
    let repeat = || Ok(calls(&[("run_python", json!({ "script": "print(1/0)" }))]));
    let model = LoopModel::new(LoopMode::Native).then(move |_| repeat()).then(move |_| repeat()).then(move |messages| {
        assert!(messages.last().unwrap().text.contains("same tool calls"), "no repeat note before the third attempt");
        repeat()
    });
    let report = rt.run(&model);
    assert!(matches!(report.stop_reason, Some(StopReason::NoProgress)), "{:?}", report.stop_reason);
    assert_eq!(world.requests().len(), 3);
}

#[test]
fn p08_loop_a_call_awaiting_approval_stops_the_loop_and_the_mission_waits() {
    let world = World::new();
    let mut rt = world.runtime("download something", |_| ("AWAITING_APPROVAL".into(), None));
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(calls(&[("run_python", json!({ "script": "x" }))]))).then(|_| panic!("the loop continued past an approval"));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::WaitingForApproval, "{:?}", report.stop_reason);
    assert!(rt.mission().result_summary.is_none());
}

#[test]
fn p08_loop_the_text_protocol_carries_calls_as_json_and_results_as_one_user_message() {
    let world = World::new();
    let mut rt = world.runtime("write a file", ok);
    let model = LoopModel::new(LoopMode::Text)
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/a.txt", "content": "hi" }))])))
        .then(|messages| {
            let last = messages.last().unwrap();
            assert_eq!(last.role, Role::User);
            assert!(last.text.starts_with("[TOOL_RESULT write_file]\nstatus: SUCCEEDED"), "{}", last.text);
            Ok(text("Wrote outputs/a.txt."))
        });
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert!(model.seen()[0].system.contains("<tool_call_format>"), "the text protocol was not described");
}

#[test]
fn p08_loop_an_unusable_reply_gets_a_repair_note_naming_the_tools_and_the_mission_continues() {
    let world = World::new();
    let mut rt = world.runtime("say hello", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Err(ModelError::InvalidOutput("invocation did not complete: ProviderResponseInvalid: tool_use_failed: attempted to call tool 'polatis_workspace_write'".into())))
        .then(|messages| {
            let note = &messages.last().unwrap().text;
            assert!(note.contains("could not be used") && note.contains("write_file"), "{note}");
            Ok(text("مرحبًا!"))
        });
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert_eq!(rt.mission().result_summary.as_deref(), Some("مرحبًا!"));
}

#[test]
fn p08_loop_a_helper_starts_with_a_clean_context_and_its_report_returns_as_a_tool_result() {
    let world = World::new();
    let mut rt = world.runtime("research one question and answer", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("delegate_task", json!({ "objective": "find the answer", "context": "use the notes", "expected_output": "one line" }))])))
        .then(|messages| {
            // نداء المساعد: يبدأ بمهمّته وحدها، بلا طلب المستخدم ولا محادثة الوكيل الرئيسي.
            assert_eq!(messages.len(), 1);
            assert!(messages[0].text.starts_with("[DELEGATED_TASK"), "{}", messages[0].text);
            assert!(!messages[0].text.contains("[USER_REQUEST]"));
            Ok(text("the answer is 42"))
        })
        .then(|messages| {
            let last = messages.last().unwrap();
            assert_eq!(last.role, Role::Tool);
            assert!(last.text.contains("the answer is 42") && last.text.contains("unverified"), "{}", last.text);
            Ok(text("The answer is 42."))
        });
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert_eq!(report.delegations_executed, 1);
    let seen = model.seen();
    assert!(seen[1].system.contains("helper agent") && !seen[1].tools.contains(&"delegate_task".to_string()), "a helper could delegate again");
    // المساعد لم يُجرِ أداة تخصّ عقدته: تقريره مخرَج وكيل بلا قياس، فعقدته UNVERIFIED_DONE (ADR-041 §3.3).
    assert!(rt.graph().nodes().any(|n| n.task_type == TaskType::Research && n.state == TaskState::UnverifiedDone));
}

#[test]
fn p08_loop_an_unknown_tool_name_reaches_the_gateway_as_is_and_no_name_is_guessed() {
    let world = World::new();
    let mut rt = world.runtime("say hello", |r| if r.tool_id.starts_with("polaris.") { ("SUCCEEDED".into(), None) } else { ("DENIED".into(), Some("UNKNOWN_TOOL".into())) });
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(calls(&[("polatis_workspace_write", json!({ "path": "a" }))]))).then(|messages| {
        assert!(messages.last().unwrap().text.starts_with("status: DENIED (UNKNOWN_TOOL)"), "{}", messages.last().unwrap().text);
        Ok(text("hello"))
    });
    rt.run(&model);
    assert_eq!(world.requests()[0].1.tool_id, "polatis_workspace_write");
}

#[test]
fn p08_loop_an_independent_reviewer_asking_for_a_revision_sends_its_notes_back_once() {
    let world = World::new();
    let mut rt = world.runtime("explain something", ok);
    let mut model = LoopModel::new(LoopMode::Native).then(|_| Ok(text("first answer"))).then(|messages| {
        assert!(messages.last().unwrap().text.starts_with("[REVIEW"), "{}", messages.last().unwrap().text);
        Ok(text("better answer"))
    });
    model.reviewer = Some(Mutex::new(VecDeque::from(vec![ReviewResult { verdict: polaris_host_core::p03::port::ReviewVerdict::Revise, notes: "cite the source".into(), input_tokens: 1, output_tokens: 1 }])));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert_eq!(rt.mission().result_summary.as_deref(), Some("better answer"));
    assert_eq!(rt.reviews().len(), 1);
    assert_eq!(rt.reviews()[0].independence, "INDEPENDENT_MODEL_REVIEW");
}

// الجلسة 1 (2026-10-07): قِيس في التطبيق مرّتين أن نموذجًا محليًّا كتب استدعاء أداة نصًّا في ردّه الأخير بدل أن يستدعيها
// (`<tool_call> <function=read_file> …` على LM Studio، و`<function_call> {…}` على Ollama)، فقُبل النصّ ردًّا نهائيًّا
// وصارت المهمّة «مكتملة» بلا أن تُنفَّذ القراءة. نصّ الاستدعاء لا يُنفَّذ ولا يُقبل إنجازًا: يعود الوكيل بملاحظة إصلاح.
#[test]
fn s1_loop_a_tool_call_written_as_text_is_not_a_final_reply_and_the_agent_is_told_to_call_it() {
    let world = World::new();
    let mut rt = world.runtime("write hi to a.txt then read it back", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "a.txt", "content": "hi" }))])))
        .then(|_| Ok(text("<tool_call> <function=read_file> <parameter=path> a.txt </parameter> </function> </tool_call>")))
        .then(|messages| {
            let note = &messages.last().unwrap().text;
            assert!(note.contains("written as text") && note.contains("read_file"), "{note}");
            Ok(calls(&[("read_file", json!({ "path": "a.txt" }))]))
        })
        .then(|_| Ok(text("The file a.txt says: hi")));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    assert_eq!(rt.mission().result_summary.as_deref(), Some("The file a.txt says: hi"));
    let tools: Vec<String> = world.requests().iter().map(|r| r.1.tool_id.clone()).collect();
    assert_eq!(tools, vec!["polaris.workspace.write".to_string(), "polaris.workspace.read".to_string()], "the read never ran");
}

#[test]
fn s1_loop_an_agent_that_only_writes_calls_as_text_never_completes() {
    let world = World::new();
    let mut rt = world.runtime("read a.txt", ok);
    let mut model = LoopModel::new(LoopMode::Native);
    for _ in 0..6 {
        model = model.then(|_| Ok(text("<function_call> { \"function\": \"read_file\", \"arguments\": { \"path\": \"a.txt\" } } </function_call>")));
    }
    let report = rt.run(&model);
    assert_ne!(report.mission_state, MissionState::Completed, "a reply made only of a text tool call completed the mission");
    assert!(matches!(report.stop_reason, Some(StopReason::ModelOutputInvalid(_))), "{:?}", report.stop_reason);
}

// CP-03-b (G-02-1، 2026-10-20): المنسّق لا يتلقّى كل أدوات المهارة في كل نداء. الأساسي يُعرض، وما يدلّ عليه الطلب يُعرض،
// والباقي مؤجَّل يسمّيه `load_tools`. المؤجَّل لا يُخفى: يُحمَّل بطلب، أو يُنفَّذ باسمه عند البوابة كما كان.

#[test]
fn cp03_a_greeting_does_not_carry_the_code_tools_and_load_tools_names_them() {
    let world = World::new();
    let mut rt = world.runtime("هلا", ok);
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(text("أهلًا! كيف أساعدك؟")));
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed, "{:?}", report.stop_reason);
    let first = &model.seen()[0];
    assert!(!first.tools.contains(&"run_python".to_string()), "the code tools were offered to a greeting: {:?}", first.tools);
    assert!(first.tools.contains(&"load_tools".to_string()), "no load_tools while tools are deferred: {:?}", first.tools);
    assert!(first.tools.contains(&"write_file".to_string()), "a core tool was deferred: {:?}", first.tools);
}

#[test]
fn cp03_a_request_that_names_python_offers_the_code_tools_from_the_first_turn() {
    let world = World::new();
    let mut rt = world.runtime("Run a python script that prints the date", ok);
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(text("done")));
    rt.run(&model);
    assert!(model.seen()[0].tools.contains(&"run_python".to_string()), "{:?}", model.seen()[0].tools);
}

#[test]
fn cp03_load_tools_offers_the_group_from_the_next_turn() {
    let world = World::new();
    let mut rt = world.runtime("هلا", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("load_tools", json!({ "groups": ["code"] }))])))
        .then(|messages| {
            let last = messages.last().unwrap();
            assert!(last.text.starts_with("status: SUCCEEDED") && last.text.contains("run_python"), "{}", last.text);
            Ok(text("جاهز"))
        });
    rt.run(&model);
    let seen = model.seen();
    assert!(seen[1].tools.contains(&"run_python".to_string()), "the loaded group is not offered on the next turn: {:?}", seen[1].tools);
    assert!(!seen[1].tools.contains(&"load_tools".to_string()), "load_tools stayed with nothing left to load: {:?}", seen[1].tools);
    assert!(world.requests().is_empty(), "load_tools reached the gateway");
}

#[test]
fn cp03_a_deferred_tool_called_by_name_still_runs_through_the_gateway() {
    let world = World::new();
    let mut rt = world.runtime("هلا", ok);
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(calls(&[("run_python", json!({ "script": "print(1)" }))]))).then(|_| Ok(text("done")));
    rt.run(&model);
    let requests = world.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].1.tool_id, "polaris.execution.python", "the deferred tool did not reach the gateway by its id");
    assert!(model.seen()[1].tools.contains(&"run_python".to_string()));
}

// CP-04 (ADR-043): المهارة التعليمية تُعرض فهرسًا في `use_skill`، ومتنها نتيجة الأداة، وأدواتها تُحمَّل معها. لا تبلغ البوابة.
#[test]
fn cp04_use_skill_returns_the_method_and_offers_its_tools_from_the_next_turn() {
    let world = World::new();
    let mut rt = world.runtime("هلا", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("use_skill", json!({ "skill_id": "polaris.playbook.data-analysis" }))])))
        .then(|messages| {
            let last = messages.last().unwrap();
            assert!(last.text.starts_with("status: SUCCEEDED") && last.text.contains("Read the file first"), "{}", last.text);
            Ok(text("جاهز"))
        });
    rt.run(&model);
    let seen = model.seen();
    assert!(seen[0].tools.contains(&"use_skill".to_string()), "{:?}", seen[0].tools);
    assert!(!seen[0].tools.contains(&"run_python".to_string()), "the skill's tool was offered before the skill was used");
    assert!(seen[1].tools.contains(&"run_python".to_string()), "the skill's tool group did not follow it: {:?}", seen[1].tools);
    assert!(world.requests().is_empty(), "use_skill reached the gateway");
}

#[test]
fn cp04_an_unlisted_skill_id_loads_nothing() {
    let world = World::new();
    let mut rt = world.runtime("هلا", ok);
    let model = LoopModel::new(LoopMode::Native).then(|_| Ok(calls(&[("use_skill", json!({ "skill_id": "user.playbook.evil" }))]))).then(|messages| {
        assert!(messages.last().unwrap().text.contains("UNKNOWN_SKILL"), "{}", messages.last().unwrap().text);
        Ok(text("ok"))
    });
    rt.run(&model);
    assert!(!model.seen()[1].tools.contains(&"run_python".to_string()));
}

// CP-07 (PHASE-07، 2026-10-21): المساعد المفوَّض لا يتلقّى كل أدوات المهارة. قِيس في تشغيل Bonsai (2026-10-20) أن المساعد يرى القائمة
// كاملة (3109–4122 رمز مطالبة في أول نداء). يرى الآن الأساسي وما يدلّ عليه هدفه المفوَّض، والباقي في `load_tools`.

#[test]
fn cp07_a_delegated_helper_sees_the_tools_its_objective_needs_not_every_tool() {
    let world = World::new();
    let mut rt = world.runtime("research one question and answer", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("delegate_task", json!({ "objective": "write a short summary of the notes" }))])))
        .then(|_| Ok(text("summary written")))
        .then(|_| Ok(text("Done.")));
    rt.run(&model);
    let helper = &model.seen()[1];
    assert!(!helper.tools.contains(&"run_python".to_string()), "a helper with no code in its objective was offered Python: {:?}", helper.tools);
    assert!(helper.tools.contains(&"write_file".to_string()), "a core tool was withheld from the helper: {:?}", helper.tools);
    assert!(helper.tools.contains(&"load_tools".to_string()), "the helper cannot reach its deferred tools: {:?}", helper.tools);
}

#[test]
fn cp07_a_helper_whose_objective_needs_code_gets_it_and_can_load_more() {
    let world = World::new();
    let mut rt = world.runtime("research one question and answer", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("delegate_task", json!({ "objective": "compute the totals with a python script" }))])))
        .then(|_| Ok(text("totals computed")))
        .then(|_| Ok(text("Done.")));
    rt.run(&model);
    assert!(model.seen()[1].tools.contains(&"run_python".to_string()), "{:?}", model.seen()[1].tools);
}

#[test]
fn cp07_a_helper_can_load_a_deferred_group_itself() {
    let world = World::new();
    let mut rt = world.runtime("research one question and answer", ok);
    let model = LoopModel::new(LoopMode::Native)
        .then(|_| Ok(calls(&[("delegate_task", json!({ "objective": "write a short summary of the notes" }))])))
        .then(|_| Ok(calls(&[("load_tools", json!({ "groups": ["code"] }))])))
        .then(|messages| {
            assert!(messages.last().unwrap().text.contains("run_python"), "{}", messages.last().unwrap().text);
            Ok(text("summary written"))
        })
        .then(|_| Ok(text("Done.")));
    rt.run(&model);
    assert!(model.seen()[2].tools.contains(&"run_python".to_string()), "the helper's load_tools did not offer the group: {:?}", model.seen()[2].tools);
    assert!(world.requests().is_empty(), "load_tools reached the gateway");
}
