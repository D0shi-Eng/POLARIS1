// تجهيزات الجلسة 2 (خطة 2026-10-07، ADR-041): نموذج حلقة مُبرمَج، ووسيط أدوات مُبرمَج، ومنفذ قياس. TEST FIXTURE كلها، لا
// نموذج حقيقي ولا بوابة حقيقية. ما يُقاس بها سلوك زمن التشغيل: ما يراه النموذج، وما يصل البوابة، وما يُحسم في المهمّة.

#![allow(dead_code)]

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use polaris_host_providers::domain::{ChatMessage, ProposedToolCall, ToolOffer};
use serde_json::json;

use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::agent_loop::LoopMode;
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionState};
use polaris_host_core::p03::port::{
    AgentModel, ContractProbe, FileInspection, LoopTurn, ModelError, PlanProposal, ReviewResult, TaskExecution, ToolBroker, ToolDecision, ToolRecordNote, ToolRequest,
};
use polaris_host_core::p03::retry::TransientPolicy;
use polaris_host_core::p03::runtime::MissionRuntime;
use polaris_host_core::p03::task::TaskType;
use polaris_host_core::p03::trust::AuthorityClass;

pub const MISSION_ID: &str = "22222222-2222-4222-8222-222222222222";

pub fn mission(objective: &str) -> Mission {
    Mission {
        mission_id: MISSION_ID.into(),
        project_id: None,
        title: "s2".into(),
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
        created_at: "2026-10-07T00:00:00Z".into(),
        started_at: None,
        completed_at: None,
        result_summary: None,
        failure_reason: None,
        version: 1,
    }
}

pub type Turn = Box<dyn FnMut(&[ChatMessage]) -> Result<LoopTurn, ModelError> + Send>;

#[derive(Clone)]
pub struct Seen {
    pub system: String,
    pub messages: Vec<ChatMessage>,
}

/// نموذج حلقة مُبرمَج: كل نداء يأخذ الدور التالي من الطابور ويسجّل ما رآه.
pub struct LoopModel {
    pub mode: LoopMode,
    pub turns: Mutex<VecDeque<Turn>>,
    pub seen: Mutex<Vec<Seen>>,
    /// كتل السياق المسترجَعة (ذاكرة مثلًا) كما يعيدها المنفذ الحقيقي: بيانات غير موثوقة.
    pub context: Vec<(String, String)>,
}

impl LoopModel {
    pub fn native() -> Self {
        Self { mode: LoopMode::Native, turns: Mutex::new(VecDeque::new()), seen: Mutex::new(Vec::new()), context: Vec::new() }
    }
    pub fn then(self, turn: impl FnMut(&[ChatMessage]) -> Result<LoopTurn, ModelError> + Send + 'static) -> Self {
        self.turns.lock().unwrap().push_back(Box::new(turn));
        self
    }
    pub fn with_context(mut self, label: &str, text: &str) -> Self {
        self.context.push((label.into(), text.into()));
        self
    }
    pub fn seen(&self) -> Vec<Seen> {
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
        Err(ModelError::InvalidOutput("no reviewer".into()))
    }
    fn loop_mode(&self) -> Option<LoopMode> {
        Some(self.mode)
    }
    fn loop_turn(&self, system: &str, messages: &[ChatMessage], _tools: &[ToolOffer]) -> Result<LoopTurn, ModelError> {
        self.seen.lock().unwrap().push(Seen { system: system.into(), messages: messages.to_vec() });
        let turn = self.turns.lock().unwrap().pop_front();
        match turn {
            Some(mut t) => t(messages),
            None => Ok(text("nothing more")),
        }
    }
    fn loop_context(&self, _objective: &str) -> Vec<(String, String)> {
        self.context.clone()
    }
}

pub fn text(t: &str) -> LoopTurn {
    LoopTurn { text: t.into(), input_tokens: 10, output_tokens: 5, ..Default::default() }
}

pub fn calls(list: &[(&str, serde_json::Value)]) -> LoopTurn {
    LoopTurn {
        tool_calls: list.iter().enumerate().map(|(i, (name, args))| ProposedToolCall { id: Some(format!("call-{i}-{name}")), name: (*name).into(), arguments: args.to_string() }).collect(),
        input_tokens: 10,
        output_tokens: 5,
        ..Default::default()
    }
}

/// قرار الوسيط لطلب: الحالة، وسبب الرفض، وما «لاحظته» الأداة.
pub type Decide = Box<dyn Fn(&ToolRequest) -> (String, Option<String>, Option<String>) + Send + Sync>;

pub struct Broker {
    pub decide: Decide,
    pub world: World,
}

impl ToolBroker for Broker {
    fn default_skill(&self) -> Option<String> {
        Some("polaris.skill.agentic-work".into())
    }
    fn tools_for(&self, _: &str) -> Vec<String> {
        vec![
            "polaris.workspace.write".into(),
            "polaris.workspace.read".into(),
            "polaris.workspace.list".into(),
            "polaris.execution.python".into(),
            "polaris.execution.command".into(),
            "polaris.web.navigate".into(),
            // تكليف 2026-10-12: قراءة صفحة، لقياس مصحِّح الاقتباسات على الردّ.
            "polaris.web.read_page".into(),
        ]
    }
    fn tool_guide(&self, _: &str) -> Vec<(String, String)> {
        Vec::new()
    }
    fn tool_schemas(&self, _: &str) -> Vec<(String, serde_json::Value)> {
        vec![("polaris.workspace.write".into(), json!({ "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } } }))]
    }
    fn invoke(&self, task_id: &str, _agent: &str, request: &ToolRequest) -> ToolDecision {
        self.world.requests.lock().unwrap().push((task_id.to_string(), request.clone()));
        let (status, denial, observation) = (self.decide)(request);
        if status == "SUCCEEDED" && request.tool_id == "polaris.workspace.write" {
            if let Some(path) = request.arguments.get("path").and_then(|p| p.as_str()) {
                let content = request.arguments.get("content").and_then(|c| c.as_str()).unwrap_or_default().to_string();
                self.world.files.lock().unwrap().insert(path.to_string(), content);
            }
        }
        let mut log = self.world.log.lock().unwrap();
        let invocation_id = format!("i{}", log.len());
        log.push(ToolRecordNote {
            invocation_id: invocation_id.clone(),
            task_id: task_id.into(),
            tool_id: request.tool_id.clone(),
            status: status.clone(),
            denial_reason: denial.clone(),
            effects: Vec::new(),
            summary: format!("{} {}", request.tool_id, status),
        });
        drop(log);
        ToolDecision {
            invocation_id,
            tool_id: request.tool_id.clone(),
            skill_id: request.skill_id.clone(),
            status: status.clone(),
            denial_reason: denial,
            summary: format!("{} {status}", request.tool_id),
            evidence_recorded: status == "SUCCEEDED",
            pending_approval_id: (status == "AWAITING_APPROVAL").then(|| "ap-1".into()),
            observation,
        }
    }
    fn executed_calls(&self) -> u32 {
        self.world.log.lock().unwrap().len() as u32
    }
}

/// المساحة والسجلّ كما يراهما منفذ القياس: ملفات بمحتواها، وسجلّ البوابة.
#[derive(Clone, Default)]
pub struct World {
    pub log: Arc<Mutex<Vec<ToolRecordNote>>>,
    pub files: Arc<Mutex<BTreeMap<String, String>>>,
    pub requests: Arc<Mutex<Vec<(String, ToolRequest)>>>,
}

pub struct Probe {
    pub world: World,
}

impl ContractProbe for Probe {
    fn inspect_file(&self, _: &str, path: &str) -> FileInspection {
        match self.world.files.lock().unwrap().get(path) {
            Some(_) => FileInspection { exists: true, verified: true, has_chart: false, detail: "ok".into() },
            None => FileInspection::default(),
        }
    }
    fn tool_history(&self, _: &str) -> Vec<ToolRecordNote> {
        self.world.log.lock().unwrap().clone()
    }
    fn workspace_files(&self, _: &str) -> Vec<String> {
        self.world.files.lock().unwrap().keys().cloned().collect()
    }
    // PHASE-09: نصّ الملف كما كُتب، ليقرأ مصحِّح عقد الوكيل تقريره كما يقرؤه في المساحة الحقيقية.
    fn file_text(&self, _: &str, path: &str) -> Option<String> {
        self.world.files.lock().unwrap().get(path).cloned()
    }
}

impl World {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn with_file(self, path: &str, content: &str) -> Self {
        self.files.lock().unwrap().insert(path.into(), content.into());
        self
    }
    pub fn runtime(&self, objective: &str, decide: impl Fn(&ToolRequest) -> (String, Option<String>, Option<String>) + Send + Sync + 'static) -> MissionRuntime {
        self.runtime_for(mission(objective), decide)
    }
    /// زمن تشغيل لمهمّة قائمة (استئناف بعد موافقة أو إقلاع).
    pub fn runtime_for(&self, mission: Mission, decide: impl Fn(&ToolRequest) -> (String, Option<String>, Option<String>) + Send + Sync + 'static) -> MissionRuntime {
        let broker = Broker { decide: Box::new(decide), world: self.clone() };
        MissionRuntime::new(mission, RuntimeClock::deterministic(), AgentRegistry::builtin())
            .with_transient_policy(TransientPolicy::immediate(2, 6))
            .with_tools(Arc::new(broker))
            .with_contract_probe(Arc::new(Probe { world: self.clone() }))
            .with_reply()
            .with_agent_loop(true)
    }
    pub fn requests(&self) -> Vec<(String, ToolRequest)> {
        self.requests.lock().unwrap().clone()
    }
}

pub fn ok(_: &ToolRequest) -> (String, Option<String>, Option<String>) {
    ("SUCCEEDED".into(), None, Some("done".into()))
}
