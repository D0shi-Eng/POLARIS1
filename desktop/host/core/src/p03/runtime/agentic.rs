// حلقة الوكيل في زمن التشغيل (ADR-039): محادثة واحدة، وأدوات تمرّ بالبوابة، وخطة يحدّثها الوكيل فتُسجَّل عُقدًا، وردّ نهائي
// هو آخر ما كتبه الوكيل بلا أداة. انظر `p03/agent_loop.rs` لسبب التصميم ومصادره.
//
// ما يبقى كما هو في المسار القديم: كل أداة عبر `run_tool_requests` (البوابة، والموافقة، والميزانية، والدليل المقيس، والسرد)،
// وكل نداء نموذج عبر `guarded_call` (الإلغاء، وحجز الميزانية، والإعادة العابرة المحدودة)، والإنهاء عبر `finalize` (الإثبات من
// الأدلّة وحدها). ما لا يأتي من النموذج أبدًا: ادّعاء مُحقَّق، أو حالة «نجحت» لأداة لم تنجح عند البوابة.
//
// خطة 2026-10-07 (ADR-041): المحادثة تُكتب في سجلّ الجلسة وتُبنى منه (البدء، والمتابعة، والاستئناف بعد موافقة أو توقّف)؛ لكل
// وكيل ونداء وأداة امتداد؛ كل نتيجة أداة تمرّ بمسبار الحقن؛ أفعال الطبقة 3 بالمراقب الأعمى إن وُجد؛ قاعدة الاثنين تفرض
// إنسانًا؛ ثلاث رفضات للنمط نفسه توقف المسار؛ خطوة الخطة لا تصير SUCCEEDED بلا قياس؛ والتلاعب بملف محميّ يرفض النتيجة.

use polaris_host_providers::domain::{ProposedToolCall, ToolOffer};
use serde_json::{json, Value};

use super::support::*;
use super::*;
use crate::p03::agent_loop::{self as al, LoopConversation, LoopMode, LoopTool, SystemInputs};
use crate::p03::port::LoopTurn;
use crate::p03::model_adapter::{clean_title, split_suggestions, strip_reasoning, unwrap_reply};
use crate::p03::output_facts;
use crate::p03::security::{arguments_name_honeytoken, request_names_honeytoken, HONEYTOKEN_PATH};
use crate::p03::skill_use as su;
use crate::p03::tool_selection as ts;
use crate::p03::trust::rule_of_two;
use crate::p03::watch::measure::{self, RouteDecision};
use crate::p03::watch::monitor::{tier_of, ActionTier, MonitorInput, MonitorVerdict};
use crate::p03::watch::session::{rebuild, SessionKind};

/// نطاق حلقة واحدة: المهمّة نفسها، أو وكيل مساعد مفوَّض بعقدته ووكيله.
struct Scope {
    task_id: String,
    agent_id: String,
    helper: bool,
    max_turns: u32,
    /// تعريف الوكيل الذي يعمل في هذا النطاق، إن كان وكيلًا من الدليل (القسم 6).
    definition: Option<&'static crate::p03::agents::AgentDefinition>,
    /// PHASE-07: الهدف الذي تُختار به أدوات هذه الحلقة: طلب المستخدم للمنسّق، والهدف المفوَّض للمساعد.
    objective: String,
}

impl Scope {
    /// الجلسة الفرعية لمساعد: محادثته النظيفة لا تدخل محادثة طالبه.
    fn sub(&self) -> Option<&str> {
        self.helper.then_some(self.agent_id.as_str())
    }
}

/// ما انتهت إليه حلقة: ردّ نهائي، أو سبب توقّف، أو انتظار موافقة (لا هذا ولا ذاك).
struct LoopEnd {
    final_text: Option<String>,
    stop: Option<StopReason>,
}

impl LoopEnd {
    fn stopped(stop: StopReason) -> Self {
        Self { final_text: None, stop: Some(stop) }
    }
}

/// حالة حلقة واحدة بين دور وآخر (G4، 2026-10-14): ما كان متغيّرات محلّية في `drive_loop`، كي تُدار عدّة حلقات (فروع تفويض
/// متوازية) دورًا دورًا بالخطوات نفسها.
struct LoopRun {
    tools: Vec<LoopTool>,
    /// G-02-1 (2026-10-20): أدوات المهارة التي لم تُعرض بعد؛ تُحمَّل بـ`load_tools` أو باستدعائها باسمها.
    deferred: Vec<LoopTool>,
    /// ADR-043: المهارات التعليمية المعروضة على المنسّق في `use_skill`.
    playbooks: Vec<crate::p03::port::Playbook>,
    names: Vec<String>,
    offers: Vec<ToolOffer>,
    brief: Option<String>,
    /// G2: قائمة المرشحين التي رآها المنسّق، قسمًا مستقلًا في تعليمة النظام (R-43).
    candidates: Option<String>,
    profile: Option<String>,
    today: String,
    mode: LoopMode,
    system: String,
    convo: LoopConversation,
    repairs: u32,
    nudges: u32,
    contract_checks: u32,
    reviewed: bool,
    last_signature: Option<String>,
    repeated: u32,
    turn_index: u32,
    last_turn: bool,
    /// W-2: سقف ناتج الأداة لهذه الحلقة، من حدّ نافذتها في آخر تحضير.
    result_cap: al::ResultCap,
    /// R-38: في الدور الأخير، مسار تقرير العقد الذي لم يُكتب بعد: الأداة الوحيدة المقبولة فيه كتابته.
    final_report: Option<String>,
    /// تكليف 2026-10-15: قرار التوجيه اتُّخذ (تفويض أو handle_directly)، أو لا قائمة مرشحين أصلًا. قبله لا تُنفَّذ أداة عمل.
    routed: bool,
    /// استدعاءات عمل رُفضت قبل قرار التوجيه (حدّها `ROUTE_REFUSALS`).
    route_refusals: u32,
}

/// تعليمة النظام للحلقة بوضع نقل الأدوات المعطى.
fn system_for(today: &str, mode: LoopMode, tools: &[LoopTool], brief: Option<&str>, candidates: Option<&str>, helper: bool, profile: Option<&str>) -> String {
    al::system_prompt(&SystemInputs { today, mode, tools, specialist: brief, helper, profile, candidates })
}

/// فرع تفويض واحد بين بدئه وإتمامه (G4): العقدة، والوكيل المساعد، ونطاقه، وحالة حلقته.
struct Branch {
    helper: String,
    child: String,
    objective: String,
    definition: Option<&'static crate::p03::agents::AgentDefinition>,
    started: std::time::Instant,
    scope: Scope,
    run: Option<LoopRun>,
    end: Option<LoopEnd>,
}

/// أقصى تفويضات تجري معًا من ردّ واحد (G4). الحدّ الفعلي أصغر من هذا ومن توازي النموذج المعلن (`parallel_first_calls`: 1 للمحلي).
pub const MAX_PARALLEL_DELEGATIONS: usize = 3;

/// ما انتهى إليه استدعاء واحد كما يُعرض على النموذج ويُكتب في السجلّ.
struct CallResult {
    rendered: String,
    status: String,
    task_id: Option<String>,
    tool_id: Option<String>,
}

/// حالة نتيجة كما يكتبها `render_result` في سطرها الأول.
fn status_of(rendered: &str) -> String {
    rendered.lines().next().and_then(|l| l.strip_prefix("status: ")).map(|s| s.split(' ').next().unwrap_or(s).to_string()).unwrap_or_default()
}

impl MissionRuntime {
    /// تشغيل مهمّة بحلقة الوكيل. يُستدعى بدل مسار الرسم حين يُفعَّل للمهمّة ويدعمه المنفذ.
    pub(super) fn agent_run(&mut self, model: &dyn AgentModel) -> RunReport {
        // ضوابط المخرجات المطلوبة تعمل حين يوجد ما تُقاس به (المساحة وسجلّ البوابة).
        self.recovery = self.probe.is_some();
        if self.recovery {
            self.contract = MissionExecutionContract::derive(&self.mission.objective);
        }
        // ما أرفقه المستخدم يُبصم عند أول بدء، خارج المساحة (ADR-041 §3.4). الطلب الأول يأخذ البصمة، وما بعده يقرؤها.
        if let Some(probe) = self.probe.clone() {
            let _ = probe.protected_files(&self.mission.mission_id);
        }
        // قاعدة الاثنين، [B]: ملف المستخدم الشخصي، أو سياق مشروع، أو أداة معروضة تصل إلى بيانات حسّاسة.
        let offers_sensitive = self.tools.as_ref().is_some_and(|b| b.default_skill().map(|s| b.tools_for(&s)).unwrap_or_default().iter().any(|t| rule_of_two::touches_sensitive(t, b.tool_traits(t))));
        // العلم تراكمي (R-07): ما صار في المتناول في تشغيل سابق يبقى كذلك بعد الاستئناف.
        self.rule_of_two.sensitive_data = self.rule_of_two.sensitive_data || self.user_profile.is_some() || self.mission.project_id.is_some() || offers_sensitive;
        let resumed = self.graph.nodes().next().is_some();
        let prepared = if resumed { self.resume_phase() } else { self.loop_prepare() };
        if let Err(stop) = prepared {
            if self.is_cancelled() || matches!(stop, StopReason::Cancelled | StopReason::ProviderUnavailable(_)) {
                self.halt_with(stop);
                self.finalize();
            } else {
                self.fail_with(stop);
            }
            return self.report();
        }
        if self.mission.state != MissionState::Running {
            let now = self.clock.now();
            if let Err(e) = self.mission.transition_to(MissionState::Running, &now) {
                self.fail_with(StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)));
                return self.report();
            }
        }
        self.save_checkpoint();
        let Some(root) = self.mission.root_task_id.clone().or_else(|| self.graph.nodes().next().map(|n| n.task_id.clone())) else {
            self.fail_with(StopReason::GraphInvalid("the mission has no root step".into()));
            return self.report();
        };
        // خطة استؤنفت: عُقدها (غير الجذر) بترتيبها.
        self.loop_plan = self.graph.nodes().filter(|n| n.task_id != root && n.parent_task_id.as_deref() == Some(root.as_str())).map(|n| n.task_id.clone()).collect();

        // وكيل الحلقة: هويته من زمن التشغيل، ودوره لا يمنحه سلطة. عند الاستئناف تبقى هويته نفسها (R-01): وكيل الجذر المحفوظ يعود
        // للعمل بمعرّفه، فلا تتبدّل نسبة الأفعال والامتدادات بين تشغيلين لمهمّة واحدة، ولا يُحجز له مقعد وكيل ثانٍ من الميزانية.
        let agent_id = match self.resume_loop_agent(&root).map(Ok).unwrap_or_else(|| self.loop_agent(&root, AgentRole::Builder)) {
            Ok(id) => id,
            Err(stop) => {
                self.halt_with(stop);
                self.finalize();
                return self.report();
            }
        };
        let definition = self.pinned_definition();
        if let Some(d) = definition {
            self.bind_definition(&agent_id, d);
        }
        // G2: قائمة المرشحين تُحسب مرة لكل تشغيل من الطلب نفسه (حتمية)، قبل بناء المحادثة: الاستئناف يرى القائمة نفسها.
        self.offered_agents = if definition.is_none() { self.candidate_agents().into_iter().map(|d| d.agent_id.clone()).collect() } else { Vec::new() };

        let started = std::time::Instant::now();
        self.open_agent_span(&agent_id, None, &root);
        self.set_step(Some(&root));
        let max_turns = definition.map(|d| d.budget.max_turns).unwrap_or(al::MAX_LOOP_TURNS);
        let scope = Scope { task_id: root.clone(), agent_id: agent_id.clone(), helper: false, max_turns, definition, objective: self.mission.objective.clone() };
        let end = match self.loop_conversation(model, resumed, &scope) {
            Ok(convo) => self.drive_loop(model, &scope, convo),
            Err(end) => end,
        };
        self.set_step(None);
        self.budget.release_active_agent();
        if let Some(a) = self.agents.iter_mut().find(|a| a.agent_id == agent_id) {
            a.state = AgentState::Completed;
            a.last_active_at = self.clock.now();
        }
        // تنبيهات المراقبة (ADR-041 §3.2): حلقة بلا تقدّم، ودورات فوق نصف الحدّ، وتجاوز الزمن.
        match &end.stop {
            Some(StopReason::NoProgress) => self.security("NO_PROGRESS_LOOP", Some(&root), format!("the loop stopped without progress after {} turns", self.loop_turns)),
            Some(StopReason::BudgetExhausted(_)) | Some(StopReason::DeadlineExceeded) if self.budget.check_deadline(self.clock.now_millis()).is_err() => {
                self.security("MISSION_OVERTIME", Some(&root), "the mission ran past its time budget".into())
            }
            _ => {}
        }
        if self.loop_turns > al::MAX_LOOP_TURNS / 2 {
            self.security("TURNS_ABOVE_EXPECTED", Some(&root), format!("{} turns of {}", self.loop_turns, al::MAX_LOOP_TURNS));
        }
        self.close_loop(&root, end, model, definition.map(|d| (agent_id.clone(), d)));
        self.flush_chat_spans(model, None);
        let status = match self.mission.state {
            MissionState::Completed => "OK",
            MissionState::Cancelled => "CANCELLED",
            MissionState::WaitingForApproval => "AWAITING_APPROVAL",
            _ => "ERROR",
        };
        self.close_agent_span(&agent_id, started, status);
        self.report()
    }

    /// إنشاء المهمّة: عقدة جذر واحدة تمثّل الطلب. الخطة تُضاف عُقدًا تحتها حين يكتبها الوكيل.
    fn loop_prepare(&mut self) -> Result<(), StopReason> {
        let now = self.clock.now();
        self.mission.transition_to(MissionState::Planning, &now).map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;
        self.budget.reserve_task().map_err(StopReason::BudgetExhausted)?;
        let root_id = self.clock.id();
        let title: String = self.mission.title.chars().take(120).collect();
        let mut root = TaskNode::new(root_id.clone(), &self.mission.mission_id, title, self.mission.objective.clone(), TaskType::Build);
        root.max_attempts = 1;
        self.graph = TaskGraph::build(self.mission.mission_id.clone(), vec![root], self.mission.budget.max_tasks).map_err(|e| StopReason::GraphInvalid(format!("{e:?}")))?;
        self.mission.root_task_id = Some(root_id);
        let now = self.clock.now();
        self.mission.transition_to(MissionState::Ready, &now).map_err(|e| StopReason::GraphInvalid(format!("{:?} -> {:?}", e.from, e.to)))?;
        Ok(())
    }

    /// وكيل الجذر المحفوظ من تشغيل سابق، إن وُجد ولم يفشل. يعود جاريًا بمقعد نشط واحد.
    fn resume_loop_agent(&mut self, root: &str) -> Option<String> {
        let agent_id = self.agents.iter().rev().find(|a| a.current_task_id.as_deref() == Some(root) && a.state != AgentState::Failed).map(|a| a.agent_id.clone())?;
        self.budget.acquire_active_agent().ok()?;
        if let Some(agent) = self.agents.iter_mut().find(|a| a.agent_id == agent_id) {
            agent.state = AgentState::Working;
            agent.last_active_at = self.clock.now();
        }
        let _ = self.graph.set_state(root, TaskState::Running);
        Some(agent_id)
    }

    /// وكيل جديد على عقدة، بحدود الميزانية.
    fn loop_agent(&mut self, task_id: &str, role: AgentRole) -> Result<String, StopReason> {
        self.budget.reserve_agent().map_err(StopReason::BudgetExhausted)?;
        self.budget.acquire_active_agent().map_err(StopReason::BudgetExhausted)?;
        let agent_id = self.clock.id();
        let mut agent = AgentInstance::new(&agent_id, &self.mission.mission_id, role, self.clock.now());
        agent.current_task_id = Some(task_id.to_string());
        agent.state = AgentState::Working;
        self.agents.push(agent);
        let _ = self.graph.assign(task_id, &agent_id);
        let _ = self.graph.set_state(task_id, TaskState::Running);
        Ok(agent_id)
    }

    /// الرسالة الأولى: الطلب، وسياقه المسترجَع (بمسبار الحقن)، وملفات المساحة، وما أُنجز إن كانت المهمّة مستأنفة بلا سجلّ.
    fn opening(&mut self, model: &dyn AgentModel, resumed: bool) -> String {
        let mut context = model.loop_context(&self.mission.objective);
        // الذاكرة والملاحظات المسترجَعة محتوى غير موثوق ([A] في قاعدة الاثنين)، ويمرّ كلٌّ منها بالمسبار (ASI06).
        if !context.is_empty() {
            self.rule_of_two.untrusted_input = true;
        }
        for (label, text) in context.iter_mut() {
            if let Some(warning) = self.probe_untrusted(text, label, None) {
                *text = format!("{warning}\n{text}");
            }
        }
        let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
        let done = if resumed { self.done_actions() } else { Vec::new() };
        al::opening_message(&al::OpeningInputs { objective: &self.mission.objective, context: &context, files: &files, done: &done })
    }

    /// المحادثة التي تبدأ بها الحلقة (ADR-041 §3.2).
    /// - بلا سجلّ جلسة: كما كانت (الطلب، وعند الاستئناف قائمة «ما أُنجز»).
    /// - أول تشغيل لهذه المهمّة في جلستها: الأدوار السابقة من السجلّ كما هي، ثم رسالة هذا الطلب.
    /// - استئناف: السجلّ كما هو. الاستدعاء الذي انتظر قرارًا يُعاد بعقدته ووسائطه نفسها (فتستهلك البوابة الموافقة)، والذي قطعه
    ///   توقّف التطبيق يُعطى نتيجة صريحة بذلك. ما زال ينتظر قرارًا: تبقى المهمّة تنتظر.
    fn loop_conversation(&mut self, model: &dyn AgentModel, resumed: bool, scope: &Scope) -> Result<LoopConversation, LoopEnd> {
        let Some((log, session_id)) = self.session.clone() else {
            return Ok(LoopConversation::new(self.opening(model, resumed)));
        };
        let events = log.events(&session_id);
        if !events.iter().any(|e| e.mission_id == self.mission.mission_id) {
            let opening = self.opening(model, false);
            self.log_event(None, SessionKind::UserMessage, AuthorityClass::DirectUserInstruction, json!({ "text": opening, "request": self.mission.objective }));
            return Ok(LoopConversation::from_messages(rebuild(&log.events(&session_id)).messages));
        }
        let open: Vec<_> = rebuild(&events).open_calls.into_iter().filter(|c| c.mission_id == self.mission.mission_id).collect();
        for call in open {
            let task = call.task_id.clone().filter(|t| self.graph.get(t).is_some()).unwrap_or_else(|| scope.task_id.clone());
            let tool_id = call.tool_id.clone().unwrap_or_else(|| call.name.clone());
            let rendered = match call.status.as_deref() {
                // R-33 (2026-10-14، تعميم R-26 بعد إزالة توجيه X-16): تفويض انتظر فيه المساعد قرار المستخدم ليس أداة بوابة تُعاد بوسائطها؛
                // يُعاد التفويض نفسه إلى مساعد جديد بسياق يقول إن الفعل المنتظِر لم يُنفَّذ. الفعل نفسه إن رُفض لا يُسأل عنه ثانيةً (R-24).
                Some("AWAITING_APPROVAL") if call.name == al::DELEGATE_TOOL => {
                    let mut value: Value = serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({}));
                    let earlier = value.get("context").and_then(Value::as_str).unwrap_or_default().to_string();
                    let note = "An earlier helper for this sub-task stopped to wait for the user's decision on an action, and that action did not run. Complete the work without actions that need the user's approval; if one is essential, say so in your report.";
                    value["context"] = json!(if earlier.trim().is_empty() { note.to_string() } else { format!("{earlier}
{note}") });
                    self.loop_delegate(model, scope, &value.to_string())
                }
                Some("AWAITING_APPROVAL") => {
                    // الخطوة التي انتظرت تعود جارية: إليها تُنسب الأداة وما يليها، كما كانت قبل الانتظار.
                    if task != scope.task_id {
                        let _ = self.graph.set_state(&task, TaskState::Running);
                    }
                    let proposed = ProposedToolCall { id: Some(call.call_id.clone()), name: call.name.clone(), arguments: call.arguments.clone() };
                    self.execute_call(&task, &scope.agent_id, &tool_id, &proposed).rendered
                }
                _ => al::render_result(
                    "INTERRUPTED",
                    None,
                    "POLARIS stopped before this call's result was known; it may or may not have run. Check the workspace (list or read) before repeating it.",
                    None,
                ),
            };
            self.log_event(
                None,
                SessionKind::ToolResult,
                AuthorityClass::UntrustedContent,
                json!({ "call_id": call.call_id, "name": call.name, "tool_id": tool_id, "task_id": task, "status": status_of(&rendered), "text": rendered }),
            );
        }
        if !self.awaiting_approval.is_empty() {
            return Err(LoopEnd { final_text: None, stop: None });
        }
        Ok(LoopConversation::from_messages(rebuild(&log.events(&session_id)).messages))
    }

    /// الأدوات المعروضة على الوكيل: أداة الخطة والتفويض (لغير المساعد)، ثم أدوات السجلّ بأسمائها القصيرة ومخطّطاتها.
    fn loop_tools(&self, helper: bool, definition: Option<&'static crate::p03::agents::AgentDefinition>) -> Vec<LoopTool> {
        let mut tools = Vec::new();
        // وكيل من الدليل لا يفوّض ولا يرى إلا أدواته (أقل امتياز)؛ التفويض للمنسّق وحده.
        if !helper && definition.is_none() {
            tools.push(al::plan_tool());
            if self.mission.budget.max_delegations > 0 && self.mission.budget.max_delegation_depth > 0 {
                tools.push(al::delegate_tool());
            }
        }
        if let Some(broker) = &self.tools {
            if let Some(skill) = broker.default_skill() {
                let guide = broker.tool_guide(&skill);
                let schemas = broker.tool_schemas(&skill);
                for tool_id in broker.tools_for(&skill) {
                    if definition.is_some_and(|d| !d.allows(&tool_id)) {
                        continue;
                    }
                    let name = al::loop_tool_name(&tool_id);
                    if tools.iter().any(|t: &LoopTool| t.name == name) {
                        continue;
                    }
                    tools.push(LoopTool {
                        name,
                        description: guide.iter().find(|(t, _)| t == &tool_id).map(|(_, d)| d.clone()).unwrap_or_else(|| tool_id.clone()),
                        parameters: schemas.iter().find(|(t, _)| t == &tool_id).map(|(_, s)| s.clone()).unwrap_or_else(|| serde_json::json!({ "type": "object" })),
                        tool_id: Some(tool_id),
                    });
                }
            }
        }
        tools
    }

    /// تعليمات المتخصّص للطلب كله: المثبَّت، وإلا أفضل مطابقة للطلب في الكتالوج، وإلا لا أحد.
    fn loop_specialist(&self) -> Option<&'static Specialist> {
        let catalog = self.specialists?;
        if let Some(pinned) = &self.pinned_specialist {
            return catalog.get(pinned);
        }
        catalog.choose(None, &self.mission.objective, TaskType::Build)
    }

    /// G2: تعريفات المرشحين المعروضين على المنسّق، بترتيبهم.
    fn offered_definitions(&self) -> Vec<&'static crate::p03::agents::AgentDefinition> {
        let Some(directory) = self.agent_directory else { return Vec::new() };
        self.offered_agents.iter().filter_map(|id| directory.get(id)).collect()
    }

    /// يُلحق ملاحظة من المضيف بالمحادثة وبالسجلّ.
    fn host_note(&self, convo: &mut LoopConversation, scope: &Scope, text: String, authority: AuthorityClass) {
        self.log_event(scope.sub(), SessionKind::HostNote, authority, json!({ "text": text }));
        convo.push_user(text);
    }

    /// الحلقة نفسها. تنتهي بردّ بلا أداة، أو بحدّ، أو بإلغاء، أو بانتظار موافقة.
    ///
    /// G4 (2026-10-14): الدور مقسوم إلى تحضير (`turn_prepare`) ونداء نموذج (`loop_model_turn`) وتطبيق (`turn_apply`)، وحالة الحلقة
    /// في `LoopRun`، فتُدار فروع تفويض متوازية دورًا دورًا بالخطوات نفسها (`run_branches`). السلوك المنفرد كما كان.
    fn drive_loop(&mut self, model: &dyn AgentModel, scope: &Scope, convo: LoopConversation) -> LoopEnd {
        let mut run = match self.loop_begin(model, scope, convo) {
            Ok(run) => run,
            Err(end) => return end,
        };
        loop {
            if let Some(end) = self.turn_prepare(model, scope, &mut run) {
                return end;
            }
            let outcome = self.loop_model_turn(model, scope, &mut run, None);
            if let Some(end) = self.turn_apply(model, scope, &mut run, outcome) {
                return end;
            }
            run.turn_index += 1;
        }
    }

    /// بدء الحلقة: الأدوات، وتعليمة النظام، وذاكرة الوكيل، والتوجيه الحتمي. `Err` حين انتهت قبل أول دور (انتظار موافقة).
    fn loop_begin(&mut self, model: &dyn AgentModel, scope: &Scope, mut convo: LoopConversation) -> Result<LoopRun, LoopEnd> {
        let mut tools = self.loop_tools(scope.helper, scope.definition);
        // G-02-1 + PHASE-07: كل حلقة ترى الأدوات الأساسية وما يدلّ عليه هدفها (طلب المستخدم للمنسّق، والهدف المفوَّض للمساعد والوكيل
        // المعرَّف)، والباقي مؤجَّل يُذكر في `load_tools`. الوكيل المعرَّف يُختار له من قائمته المسموحة وحدها (`loop_tools`)، فالاختيار
        // يضيّق ولا يوسّع. ما ظهر في محادثة مستأنفة يُعرض، فلا يحمل السجلّ استدعاءً لأداة بلا تعريف.
        let used: Vec<String> = tools
            .iter()
            .filter(|t| convo.messages().iter().any(|m| m.tool_calls.iter().any(|c| c.name == t.name) || m.text.contains(&format!("\"{}\"", t.name))))
            .map(|t| t.name.clone())
            .collect();
        let (offered, deferred) = ts::select(tools, &scope.objective, &used);
        tools = offered;
        tools.extend(ts::load_tool(&deferred));
        let mut playbooks = Vec::new();
        if !scope.helper && scope.definition.is_none() {
            // ADR-043: فهرس المهارات التعليمية في وصف `use_skill`؛ متونها لا تدخل التعليمة.
            playbooks = self.tools.as_ref().map(|b| b.playbooks()).unwrap_or_default();
            tools.extend(su::use_skill_tool(&playbooks));
        }
        let mut names: Vec<String> = tools.iter().map(|t| t.name.clone()).collect();
        // متخصّص الوكيل المعرَّف (مثبَّتًا أو مفوَّضًا إليه)، وإلا متخصّص الطلب للمنسّق كما كان.
        let specialist = match scope.definition {
            Some(d) => self.specialists.unwrap_or_else(crate::p03::specialist::SpecialistCatalog::builtin).get(&d.specialist_id),
            None if scope.helper => None,
            // R-40 (قِيس 2026-10-14 على Bonsai، إعادة اختبار eval/2.1): منسّق يُقال له «You are working as the <X> specialist» ويُعرض عليه
            // وكيل X نفسه مرشحًا ينفّذ العمل بنفسه. حين يرى المنسّق قائمة مرشحين فهو موزّع لا متخصّص: الخبرة للوكيل المفوَّض إليه.
            None if !self.offered_agents.is_empty() => None,
            None => self.loop_specialist(),
        };
        if let (false, Some(s)) = (scope.helper, specialist) {
            self.narrate(NarrationKind::Step, &self.mission.title.chars().take(120).collect::<String>(), Some(s.specialist_id.clone()));
        }
        // عقد الوكيل وحدوده في تعليمة النظام (نصّ مضيف موثوق)، وذاكرته بيانات مسيَّجة في أوّل المحادثة، مرّة واحدة.
        let brief = match (specialist.map(Specialist::brief), scope.definition) {
            (Some(b), Some(d)) => Some(format!("{b}\n{}", d.contract_brief())),
            (b, _) => b,
        };
        // G2 (2026-10-14): لطلب غير مثبَّت يرى المنسّق قائمة المرشحين التي حسبها المضيف (`offered_agents`)، ويختار منها بنفسه أو
        // يعمل بنفسه. نصّ مضيف موثوق لا يمنح سلطة؛ التفويض يمرّ بالبوابة والمراقب، والمعرّف خارج القائمة يُرفض. حلّ محلّ توجيه
        // X-16 الحتمي الذي كان يُطلقه نصّ لا يظهر إلا في حالات التقييم (R-29).
        let candidates = match (scope.definition, scope.helper, names.iter().any(|n| n == al::DELEGATE_TOOL), self.offered_definitions()) {
            (None, false, true, offered) if !offered.is_empty() => {
                // القائمة تُسجَّل لكل تشغيل (للقياس) بعد بناء المحادثة، ولا تدخلها عند إعادة بنائها: المنسّق يراها في تعليمة النظام.
                self.log_event(None, SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, json!({ "text": format!("[POLARIS] candidate agents: {}", self.offered_agents.join(", ")), "agent_shortlist": self.offered_agents, "record_only": true }));
                Some(al::candidate_agents_note(&offered))
            }
            _ => None,
        };
        // تكليف 2026-10-15: مع قائمة المرشحين قرار ثانٍ صريح («أعمل بنفسي»)، والمضيف لا ينفّذ أداة عمل قبل أحد القرارين. محادثة
        // مستأنفة اتُّخذ فيها القرار لا تُعاد إليه.
        let routed = match candidates {
            None => true,
            Some(_) => {
                tools.push(al::direct_tool());
                names.push(al::DIRECT_TOOL.to_string());
                convo.messages().iter().any(|m| {
                    m.tool_calls.iter().any(|c| c.name == al::DELEGATE_TOOL || c.name == al::DIRECT_TOOL)
                        || (m.role == polaris_host_providers::domain::Role::Assistant && (m.text.contains("\"delegate_task\"") || m.text.contains("\"handle_directly\"")))
                })
            }
        };
        let offers: Vec<ToolOffer> = tools.iter().map(LoopTool::offer).collect();
        if let Some(d) = scope.definition {
            let marker = "[AGENT_MEMORY — records POLARIS kept for this agent identity";
            if !convo.messages().iter().any(|m| m.text.contains(marker)) {
                if let Some(block) = self.agent_memory_block(d) {
                    self.host_note(&mut convo, scope, block, AuthorityClass::UntrustedContent);
                }
            }
        }
        let today: String = self.clock.now().chars().take(10).collect();
        let mode = model.loop_mode().unwrap_or(LoopMode::Text);
        if mode == LoopMode::Text {
            // محادثة بُنيت من السجلّ باستدعاءات أصيلة تُحوَّل إلى الصيغة النصّية قبل أول نداء.
            convo.to_text_protocol();
        }
        let profile = if scope.helper { None } else { self.user_profile.clone() };
        let system = system_for(&today, mode, &tools, brief.as_deref(), candidates.as_deref(), scope.helper, profile.as_deref());
        // P0: ما عُرض على النموذج وحجمه، مرّة لكل حلقة (أسماء وأعداد فقط).
        let selection = measure::SelectionFacts { offered: &tools, deferred: deferred.len(), playbooks: playbooks.len(), system_chars: system.chars().count(), candidates: if candidates.is_some() { self.offered_agents.len() } else { 0 }, route_required: !routed, helper: scope.helper };
        self.log_event(scope.sub(), SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::selection_record(&selection));
        Ok(LoopRun {
            names,
            offers,
            tools,
            deferred,
            playbooks,
            brief,
            candidates,
            profile,
            today,
            mode,
            system,
            convo,
            repairs: 0,
            nudges: 0,
            contract_checks: 0,
            reviewed: false,
            last_signature: None,
            repeated: 0,
            turn_index: 0,
            last_turn: false,
            result_cap: al::ResultCap::Chars(al::RESULT_CHARS),
            final_report: None,
            routed,
            route_refusals: 0,
        })
    }

    /// ما قبل نداء النموذج في دور: الحدّ، والإلغاء، وعطل التخزين، والوقت، والتنبيهات، والضغط. يعيد نهاية الحلقة إن وقعت.
    fn turn_prepare(&mut self, model: &dyn AgentModel, scope: &Scope, run: &mut LoopRun) -> Option<LoopEnd> {
        if run.turn_index >= scope.max_turns {
            return Some(LoopEnd::stopped(StopReason::NoProgress));
        }
        let turn_index = run.turn_index;
        if !scope.helper {
            self.loop_turns += 1;
        }
        if self.is_cancelled() {
            self.cancelled = true;
            return Some(LoopEnd::stopped(StopReason::Cancelled));
        }
        // R-06: سجلّ الجلسة أو نقطة الاستئناف تعذّرت كتابتهما؛ لا دور جديد ولا أثر جانبي بعده.
        if let Some(stop) = self.storage_stop() {
            return Some(LoopEnd::stopped(stop));
        }
        if let Err(denied) = self.budget.check_deadline(self.clock.now_millis()) {
            return Some(LoopEnd::stopped(StopReason::BudgetExhausted(denied)));
        }
        // ADR-042: رسائل كتبها المستخدم والمهمّة تعمل. الحدّ هنا آمن: لا أداة جارية ولا نداء نموذج بعد. تصل رسالةَ مستخدم في المحادثة
        // (لا تعليمة نظام، ولا تمنح شيئًا)، وتُسجَّل في سجلّ الجلسة بصنفها، فيراها الاستئناف بترتيبها. الوكيل المفوَّض لا يقرؤها.
        if !scope.helper {
            if let Some(notes) = self.notes.clone() {
                for text in notes.take_pending_notes(&self.mission.mission_id) {
                    self.log_event(None, SessionKind::UserMessage, AuthorityClass::DirectUserInstruction, json!({ "text": text, "during_run": true }));
                    run.convo.push_user(format!("[The user sent this message while you were working. Take it into account from your next step; it does not change your permissions.]
{text}"));
                }
            }
        }
        let last_turn = turn_index + 1 == scope.max_turns;
        run.last_turn = last_turn;
        // R-25 (قِيس 2026-10-13 على Bonsai، typescript-engineer#specialized): وكيل أنفق دوراته في عمل جانبي وبلغ الدور الأخير بلا
        // مُخرَجه، وملاحظة الدور الأخير تمنع أي أداة فلا يستطيع كتابته. قبل الحدّ بأدوار قليلة يُنبَّه إلى ما لم يُكتب بعد.
        if !last_turn && scope.max_turns > al::LOW_TURNS_LEFT && turn_index + al::LOW_TURNS_LEFT == scope.max_turns {
            let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
            let mut missing: Vec<String> = if scope.helper { Vec::new() } else { self.unmet_now().iter().map(|c| format!("{} ({})", c.description, c.detail)).collect() };
            if let Some(d) = scope.definition {
                if self.probe.is_some() && !files.iter().any(|f| f == &d.output.report_path) {
                    missing.push(format!("{} (the report your output contract requires)", d.output.report_path));
                }
            }
            if !missing.is_empty() {
                self.host_note(&mut run.convo, scope, al::low_turns_note(&missing), AuthorityClass::TrustedRuntimeFact);
            }
        }
        if last_turn {
            // R-38: وكيل معرَّف بلغ دوره الأخير بلا تقرير عقده يُسمح له بكتابته وحده، وإلا فلا أداة كما كان.
            let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
            run.final_report = scope.definition.filter(|d| self.probe.is_some() && !files.iter().any(|f| f == &d.output.report_path)).map(|d| d.output.report_path.clone());
            let note = match &run.final_report {
                Some(path) => al::final_report_note(path),
                None => al::FINAL_TURN_NOTE.to_string(),
            };
            self.host_note(&mut run.convo, scope, note, AuthorityClass::TrustedRuntimeFact);
        }
        // W-2: الحدّ من نافذة النموذج إن عُرفت (قبل أن يرفض التوجيه الطلب)، وإلا الحدّ الثابت كما كان.
        // والميزانية معايرة بما بلّغه الخادم من رموز حقيقية في هذه المهمّة (تقدير التوجيه يقلّ عنها على بعض النماذج).
        let ratio = self.token_ratio;
        let limit = al::ConversationLimit { bytes: model.input_token_budget().map(|b| al::window_conversation_bytes(al::calibrated_budget(b, ratio), run.system.len(), al::offers_bytes(&run.offers))), ..al::ConversationLimit::FIXED };
        run.result_cap = al::result_cap(limit);
        if !run.convo.fits(limit) {
            self.compact(model, scope, &mut run.convo, limit, turn_index);
        }
        None
    }

    /// نداء النموذج لدور واحد عبر النداء المحروس. `first`: محاولة أولى جرت سلفًا في خيط فرع موازٍ (G4)، ومقعدها محجوز؛ ما بعدها
    /// من إعادات يجري هنا بالسياسة نفسها. `facts`: حقائق تلك المحاولة كما أخذها خيطها.
    fn loop_model_turn(&mut self, model: &dyn AgentModel, scope: &Scope, run: &mut LoopRun, first: Option<(FirstAttempt<LoopTurn>, Vec<crate::p03::port::CallFacts>)>) -> Result<LoopTurn, StopReason> {
        let (first, mut facts) = match first {
            Some((attempt, facts)) => (Some(attempt), facts),
            None => (None, Vec::new()),
        };
        // الأدوات تُعرض حتى في الردّ الأخير: بعض المزوّدين يرفض محادثة فيها استدعاءات بلا تعريف أدواتها. ما يُطلب فيه يُهمَل.
        let outcome = {
            let LoopRun { convo, system, mode, offers, tools, brief, candidates, profile, today, .. } = run;
            let (offers, tools, brief, candidates, profile, today) = (&*offers, &*tools, brief.as_deref(), candidates.as_deref(), profile.as_deref(), today.as_str());
            self.guarded_call_after(first, None, || {
                // خادم رفض الاستدعاء الأصيل أثناء المهمّة: تكمل بالصيغة النصّية، والمحادثة تُحوَّل إليها قبل النداء التالي.
                if let Some(now) = model.loop_mode() {
                    if now != *mode {
                        if now == LoopMode::Text {
                            convo.to_text_protocol();
                        }
                        *mode = now;
                        *system = system_for(today, now, tools, brief, candidates, scope.helper, profile);
                    }
                }
                model.loop_turn(system, convo.messages(), offers)
            })
        };
        facts.extend(model.take_call_facts());
        self.flush_chat_spans_with(facts, outcome.as_ref().ok().map(|t| (t.input_tokens, t.output_tokens)));
        // P0: حجم النداء وما عاد به، لكل دور (والفروع الموازية تمرّ من هنا كذلك).
        let turn = measure::TurnFacts {
            turn: run.turn_index,
            ok: outcome.is_ok(),
            input_tokens: outcome.as_ref().map(|t| t.input_tokens).unwrap_or(0),
            output_tokens: outcome.as_ref().map(|t| t.output_tokens).unwrap_or(0),
            tool_calls: outcome.as_ref().map(|t| t.tool_calls.len()).unwrap_or(0),
            system_chars: run.system.chars().count(),
            conversation_chars: run.convo.chars(),
            offered_count: run.offers.len(),
            routed: run.routed,
        };
        self.log_event(scope.sub(), SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::turn_record(&turn));
        // W-2: معايرة التقدير بما بلّغه الخادم لهذا الطلب نفسه (التعليمة والأدوات والمحادثة كما أُرسلت). النسبة لا تنخفض.
        if let Some(ratio) = outcome.as_ref().ok().and_then(|t| al::token_ratio_permille(t.input_tokens, run.system.len() + al::offers_bytes(&run.offers) + run.convo.bytes())) {
            if ratio > self.token_ratio {
                self.token_ratio = ratio;
                self.log_event(scope.sub(), SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::token_calibration_record(run.turn_index, ratio));
            }
        }
        outcome
    }

    /// ما بعد نداء النموذج في دور: الإصلاح، والردّ النهائي وضوابطه، أو تنفيذ الاستدعاءات. يعيد نهاية الحلقة إن وقعت.
    fn turn_apply(&mut self, model: &dyn AgentModel, scope: &Scope, run: &mut LoopRun, outcome: Result<LoopTurn, StopReason>) -> Option<LoopEnd> {
        let last_turn = run.last_turn;
        let final_report = run.final_report.clone();
        let turn_index = run.turn_index;
        let result_cap = run.result_cap;
        let LoopRun { tools, deferred, playbooks, names, offers, system, brief, candidates, profile, today, convo, mode, repairs, nudges, contract_checks, reviewed, last_signature, repeated, routed, route_refusals, .. } = run;
        let turn = match outcome {
            Ok(turn) => turn,
            Err(StopReason::ModelOutputInvalid(detail)) => {
                // موجّه لا يتّسع في نافذة النموذج: تقليم نواتج الأدوات القديمة ثم إعادة، قبل أن يُعدّ عيبًا.
                if detail.starts_with(crate::p03::model_adapter::CONTEXT_TOO_LARGE) && convo.prune(convo.chars() / 2) > 0 {
                    return None;
                }
                *repairs += 1;
                if *repairs > al::MAX_REPAIRS {
                    return Some(LoopEnd::stopped(StopReason::ModelOutputInvalid(detail)));
                }
                self.host_note(convo, scope, al::repair_note(&detail, names), AuthorityClass::TrustedRuntimeFact);
                return None;
            }
            Err(stop) => return Some(LoopEnd::stopped(stop)),
        };
        if let Err(denied) = self.budget.settle_model_call(turn.input_tokens, turn.output_tokens) {
            return Some(LoopEnd::stopped(StopReason::BudgetExhausted(denied)));
        }
        // R-37: ردّ قُطع عند سقف المخرجات واستدعاءاته بوسائط ليست كائن JSON: الوسائط مبتورة لا معطوبة. لا يُنفَّذ شيء، ولا يُحسب رفضًا
        // (ثلاث رفضات توقف المسار)، ولا يدخل الردّ المبتور المحادثة؛ يُخبَر الوكيل بالسقف وبالكتابة على أجزاء، بحدّ الإصلاحات نفسه.
        if turn.cut_at_limit && !last_turn {
            let cut: Vec<String> = turn.tool_calls.iter().filter(|c| !matches!(serde_json::from_str::<Value>(&c.arguments), Ok(Value::Object(_)))).map(|c| c.name.clone()).collect();
            if !cut.is_empty() {
                *repairs += 1;
                if *repairs > al::MAX_REPAIRS {
                    return Some(LoopEnd::stopped(StopReason::ModelOutputInvalid("the agent's tool calls were cut off at the output limit again and again".into())));
                }
                self.host_note(convo, scope, al::cut_off_note(&cut, turn.output_tokens), AuthorityClass::TrustedRuntimeFact);
                return None;
            }
        }
        let visible = strip_reasoning(&turn.text);
        // الدور الأخير لا ينفّذ أداة، إلا كتابة تقرير العقد الغائب في مساره (R-38)، مرة واحدة.
        let raw_calls: Vec<ProposedToolCall> = match (last_turn, &final_report) {
            (false, _) => turn.tool_calls.clone(),
            (true, Some(path)) => turn
                .tool_calls
                .iter()
                .filter(|c| c.name == al::loop_tool_name("polaris.workspace.write") && serde_json::from_str::<Value>(&c.arguments).ok().and_then(|v| v.get("path").and_then(Value::as_str).map(|p| p.trim_start_matches("./") == path.as_str())).unwrap_or(false))
                .take(1)
                .cloned()
                .collect(),
            (true, None) => Vec::new(),
        };
        // R-27 (قِيس 2026-10-13 على Bonsai، landing-page-builder): وسائط استدعاء ليست JSON صالحًا بقيت حرفيًّا في المحادثة، فرفض
        // خادم GGUF المحلي كل طلب بعدها بـ 500 (قالبه يعيد تحليل وسائط الاستدعاءات السابقة) وماتت المهمّة. التنفيذ يبقى بالوسائط الأصلية
        // (فيصدق رفض البوابة)، والمحادثة والسجلّ يحملان كائن JSON صالحًا فيه معاينة قصيرة للأصل.
        let shown: Vec<ProposedToolCall> = raw_calls.iter().map(|c| ProposedToolCall { arguments: al::conversation_arguments(&c.arguments), ..c.clone() }).collect();
        let shown = convo.push_assistant(&turn.text, &shown, turn.reasoning.clone());
        let calls: Vec<ProposedToolCall> = raw_calls.iter().zip(&shown).map(|(raw, s)| ProposedToolCall { id: s.id.clone(), ..raw.clone() }).collect();
        // G-02-1: `load_tools` أو أداة مؤجَّلة باسمها تحمّل مجموعتها قبل التسجيل والتنفيذ، فيُنفَّذ الاستدعاء بمعرّفه عند البوابة،
        // وتُعرض أدوات المجموعة من الدور التالي. لا شيء هنا يمنح إذنًا: البوابة تقرّر كما كانت.
        let mut wanted: Vec<ts::ToolGroup> = calls.iter().flat_map(|c| ts::requested_groups(&c.name, &c.arguments, deferred)).collect();
        // ADR-043: مهارة تعليمية تحمّل مجموعات أدواتها، فيجدها الوكيل حين يتبع طريقتها.
        wanted.extend(calls.iter().filter(|c| c.name == su::USE_SKILL).filter_map(|c| su::requested(&c.arguments, playbooks)).flat_map(su::groups_of));
        let loaded = if wanted.is_empty() { Vec::new() } else { ts::load(tools, deferred, &wanted) };
        if !loaded.is_empty() {
            *names = tools.iter().map(|t| t.name.clone()).collect();
            *offers = tools.iter().map(LoopTool::offer).collect();
            *system = system_for(today, *mode, tools, brief.as_deref(), candidates.as_deref(), scope.helper, profile.as_deref());
            // P0: مجموعة حُمّلت فتغيّرت بادئة التعليمة.
            self.log_event(scope.sub(), SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::loaded_record(turn_index, &loaded, tools, system.chars().count()));
        }
        let logged: Vec<Value> = shown
            .iter()
            .map(|c| json!({ "id": c.id, "name": c.name, "arguments": c.arguments, "tool_id": tools.iter().find(|t| t.name == c.name).and_then(|t| t.tool_id.clone()) }))
            .collect();
        self.log_event(
            scope.sub(),
            SessionKind::AssistantMessage,
            AuthorityClass::ModelGenerated,
            json!({ "text": turn.text, "tool_calls": logged, "reasoning": turn.reasoning, "text_protocol": *mode == LoopMode::Text }),
        );

        if calls.is_empty() {
            let answer = unwrap_reply(&visible);
            // استدعاء مكتوب نصًّا في الوضع الأصيل لا يُنفَّذ ولا يُقبل ردًّا نهائيًّا (قِيس 2026-10-07 على LM Studio وOllama).
            if *mode == LoopMode::Native && al::is_text_tool_call(&answer) && !last_turn {
                *repairs += 1;
                if *repairs > al::MAX_REPAIRS {
                    return Some(LoopEnd::stopped(StopReason::ModelOutputInvalid("the agent wrote tool calls as text instead of calling them".into())));
                }
                self.host_note(convo, scope, al::text_call_note(names), AuthorityClass::TrustedRuntimeFact);
                return None;
            }
            if answer.trim().is_empty() {
                *repairs += 1;
                if *repairs > al::MAX_REPAIRS {
                    return Some(LoopEnd::stopped(StopReason::ModelOutputInvalid("the agent's replies were empty".into())));
                }
                self.host_note(convo, scope, "[POLARIS] Your reply was empty. Continue the work with a tool call, or write your final message.".into(), AuthorityClass::TrustedRuntimeFact);
                return None;
            }
            // R-28 (قِيس 2026-10-14 على Bonsai، operations-research: تقرير بلا `## Summary` فرسب العقد 4/5 وقد قرأه الوكيل بعد
            // كتابته): قبل الردّ النهائي لوكيل ذي تعريف يُشغَّل مصحّح عقده نفسه على الملف في المساحة؛ رسوبه يعود إليه ليصلحه، مرّتين
            // على الأكثر. المصحّح يقرأ القرص لا كلام الوكيل، والحكم النهائي يبقى للمصحّح بعد انتهائه كما كان.
            if let (Some(d), false, Some(probe)) = (scope.definition, last_turn, self.probe.clone()) {
                if *contract_checks < al::MAX_CONTRACT_CHECKS {
                    let outcome = crate::p03::agents::grader::grade(d, probe.file_text(&self.mission.mission_id, &d.output.report_path).as_deref());
                    if !outcome.passed {
                        *contract_checks += 1;
                        self.host_note(convo, scope, al::contract_note(&d.output.report_path, &outcome.summary()), AuthorityClass::TrustedRuntimeFact);
                        return None;
                    }
                }
            }
            if !scope.helper && !last_turn {
                // المخرجات المطلوبة بقياس المساحة قبل أن يصل الردّ المستخدم: غائبٌ منها يعيد الوكيل إلى العمل، مرّتين على الأكثر.
                if self.recovery && *nudges < al::MAX_DELIVERABLE_NUDGES && !self.loop_denied_by_boundary() {
                    let unmet: Vec<String> = self.unmet_now().iter().map(|c| format!("{} ({})", c.description, c.detail)).collect();
                    if !unmet.is_empty() {
                        *nudges += 1;
                        self.host_note(convo, scope, al::deliverables_note(&unmet), AuthorityClass::TrustedRuntimeFact);
                        return None;
                    }
                }
                // مراجِع مستقلّ على نموذج آخر (E6)، مرة واحدة: طلبُه التعديلَ يعود إلى الحلقة ملاحظةً بلا سلطة.
                if !*reviewed && model.reviews_independently() {
                    *reviewed = true;
                    match self.loop_review(model, &scope.task_id, &answer) {
                        Ok(Some(notes)) => {
                            let note = format!(
                                "[REVIEW — an independent reviewer model read your work; its notes carry no user authority. Address what is right in them, then write your final message again]\n{}",
                                al::clip_middle(&notes, 2_000)
                            );
                            self.host_note(convo, scope, note, AuthorityClass::ModelGenerated);
                            return None;
                        }
                        Ok(None) => {}
                        // المراجعة في الحلقة نصيحة بلا سلطة: تعذّرها (ردّ بلا حكم، أو مزوّد محدود، أو لا توجيه) لا يحجب عملًا
                        // تمّ وقيس. قِيس 2026-10-06: مهمّة كتبت ملفّها وتحقّقت منه ثم حُجبت لأن المراجِع ردّ نثرًا بلا JSON.
                        // تبقى المهمّة «لم تُراجَع» كما هي.
                        Err(StopReason::ModelOutputInvalid(_)) | Err(StopReason::ProviderUnavailable(_)) | Err(StopReason::NoModelRouted(_)) => {
                            self.review_independence = ReviewIndependence::NotReviewed;
                        }
                        Err(stop) => return Some(LoopEnd::stopped(stop)),
                    }
                }
            }
            return Some(LoopEnd { final_text: Some(answer), stop: None });
        }

        // ردّ الوكيل باستدعاءاته لم يُكتب في سجلّ الجلسة: تنفيذها الآن يترك أثرًا لا يعرفه الاستئناف.
        if let Some(stop) = self.storage_stop() {
            return Some(LoopEnd::stopped(stop));
        }
        if !scope.helper && !visible.trim().is_empty() {
            self.narrate(NarrationKind::Note, &bounded_preview(visible.trim(), 400), None);
        }
        // تكليف 2026-10-15: قبل قرار التوجيه لا تُنفَّذ أداة عمل؛ الخطة تمرّ. القرار في الردّ نفسه يفتح ما معه.
        let mut route_first = false;
        if !scope.helper && !*routed {
            // P0: كل رفض قبل القرار، والقرار ودوره، يُسجَّلان للقياس.
            let decided = if calls.iter().any(|c| c.name == al::DELEGATE_TOOL) {
                Some(RouteDecision::Delegate)
            } else if calls.iter().any(|c| c.name == al::DIRECT_TOOL) {
                Some(RouteDecision::Direct)
            } else if calls.iter().any(|c| c.name != al::PLAN_TOOL && c.name != ts::LOAD_TOOLS && c.name != su::USE_SKILL) {
                // W-1 (تجربة خلف مفتاح، مطفأ افتراضيًّا): العمل الأول قرارٌ ضمني بالعمل المباشر، فلا يضيع دور على رفضه. التفويض يبقى متاحًا.
                if self.implicit_route {
                    Some(RouteDecision::Implicit)
                } else if *route_refusals < al::ROUTE_REFUSALS {
                    *route_refusals += 1;
                    route_first = true;
                    self.log_event(None, SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::route_refused_record(turn_index, *route_refusals));
                    None
                } else {
                    Some(RouteDecision::AfterRefusals)
                }
            } else {
                None
            };
            if let Some(decision) = decided {
                *routed = true;
                self.log_event(None, SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::route_record(turn_index, decision, *route_refusals));
            }
        }
        let signature: String = calls.iter().map(|c| format!("{}:{}", c.name, c.arguments)).collect::<Vec<_>>().join("|");
        *repeated = if last_signature.as_deref() == Some(signature.as_str()) { *repeated + 1 } else { 0 };
        *last_signature = Some(signature);

        // G4: ردّ واحد كل استدعاءاته تفويضات (اثنان فأكثر) = تفويضات مستقلّة بالبناء، لا يرى أيٌّ منها ناتج الآخر. تجري فروعًا
        // متوازية بحدّ النموذج المعلن؛ ونتائجها تعود بترتيب الاستدعاءات كأنها جرت متتالية.
        let width = self.delegation_width(model);
        let mut parallel: Vec<Option<CallResult>> = if !scope.helper && width > 1 && calls.len() > 1 && calls.iter().all(|c| c.name == al::DELEGATE_TOOL) && tools.iter().any(|t| t.name == al::DELEGATE_TOOL) {
            self.loop_delegate_parallel(model, scope, &calls, width).into_iter().map(Some).collect()
        } else {
            Vec::new()
        };
        // CP-07-2: قِيس أن المنسّق يصف تفويضين متتاليين بأنهما «بالتوازي» (وصف الأداة يقول «Several ... in one reply»). نتيجة
        // كل تفويض من ردّ فيه أكثر من تفويض تحمل سطر مضيف بما جرى فعلًا.
        let delegations = calls.iter().filter(|c| c.name == al::DELEGATE_TOOL).count();
        let ran_together = !parallel.is_empty();
        self.parallel_rounds += usize::from(ran_together);
        let mut text_results = String::new();
        let mut last_status = String::new();
        for (i, call) in calls.iter().enumerate() {
            let mut result = match parallel.get_mut(i).and_then(Option::take) {
                Some(result) => result,
                // `load_tools` يُعرض على كل حلقة فيها مؤجَّل (PHASE-07)؛ حلقة بلا مؤجَّل لا تراه، واسمه منها يمرّ إلى البوابة فترفضه.
                None if call.name == ts::LOAD_TOOLS && (!loaded.is_empty() || tools.iter().any(|t| t.name == ts::LOAD_TOOLS)) => {
                    let summary = if loaded.is_empty() {
                        "Nothing new was loaded: the requested groups are already offered or unknown.".to_string()
                    } else {
                        format!("Loaded: {}. These tools are offered from your next step.", loaded.join(", "))
                    };
                    CallResult { rendered: al::render_result("SUCCEEDED", None, &summary, None), status: "SUCCEEDED".into(), task_id: Some(scope.task_id.clone()), tool_id: None }
                }
                // ADR-043: متن المهارة نتيجةً للأداة، لا تعليمة نظام. معرّف خارج الفهرس لا يحمّل شيئًا.
                None if call.name == su::USE_SKILL && !scope.helper && scope.definition.is_none() => match su::requested(&call.arguments, playbooks) {
                    Some(playbook) => {
                        let (summary, observation) = su::result_parts(playbook);
                        CallResult { rendered: al::render_result("SUCCEEDED", None, &summary, observation.as_deref()), status: "SUCCEEDED".into(), task_id: Some(scope.task_id.clone()), tool_id: None }
                    }
                    None => CallResult { rendered: al::render_result("FAILED", Some("UNKNOWN_SKILL"), "No skill with that id is offered. Use one of the ids listed in use_skill.", None), status: "FAILED".into(), task_id: Some(scope.task_id.clone()), tool_id: None },
                },
                None if route_first && call.name != al::PLAN_TOOL => CallResult { rendered: al::route_first_note(), status: "NOT_RUN".into(), task_id: Some(scope.task_id.clone()), tool_id: None },
                None => {
                    if self.is_cancelled() || self.storage_stop().is_some() {
                        break;
                    }
                    // W-2: سقف ناتج هذه الحلقة (تفويض سابق في الدور نفسه ضبطه لحلقة المساعد).
                    self.result_cap = result_cap;
                    self.loop_call(model, scope, call, tools)
                }
            };
            // RW-B: الكتابة الناجحة تُسجَّل دائمًا (لـRW-A أيضًا)؛ والملاحظة خلف مفتاحها، خارج سياج الناتج كملاحظات المضيف.
            if result.status == "SUCCEEDED" {
                if let Some((path, seen)) = result.tool_id.as_deref().and_then(|t| self.write_ledger.record(&scope.agent_id, t, &call.arguments)) {
                    if let Some(note) = self.rewrite_note.then(|| output_facts::rewrite_note(&path, seen, scope.max_turns.saturating_sub(turn_index + 1))).flatten() {
                        result.rendered.push_str(&format!("\n{note}"));
                    }
                }
            }
            // W-2: قراءة أعادت المحتوى نفسه كاملًا الذي رآه الوكيل من قبل: حقيقة مقيسة خارج سياج الناتج، والقراءة تمّت.
            if result.status == "SUCCEEDED" {
                if let Some(path) = result.tool_id.as_deref().and_then(|t| self.read_ledger.record(&scope.agent_id, t, &call.arguments, &result.rendered)) {
                    result.rendered.push_str(&format!("\n{}", output_facts::reread_note(&path)));
                }
            }
            if delegations > 1 && call.name == al::DELEGATE_TOOL && result.status != "NOT_RUN" {
                result.rendered.push_str(&if ran_together {
                    format!("
host note: the {delegations} helpers of this reply ran at the same time (up to {width} at once).")
                } else {
                    format!("
host note: the {delegations} helpers of this reply ran one after another, not in parallel: this model runs one call at a time.")
                });
            }
            last_status = result.status.clone();
            self.log_event(
                scope.sub(),
                SessionKind::ToolResult,
                AuthorityClass::UntrustedContent,
                json!({ "call_id": call.id, "name": call.name, "tool_id": result.tool_id, "task_id": result.task_id, "status": result.status, "text": result.rendered, "text_protocol": *mode == LoopMode::Text }),
            );
            match *mode {
                LoopMode::Native => convo.push_tool_result(call.id.as_deref().unwrap_or_default(), result.rendered),
                LoopMode::Text => text_results.push_str(&format!("[TOOL_RESULT {}]\n{}\n\n", call.name, result.rendered)),
            }
        }
        if *mode == LoopMode::Text && !text_results.is_empty() {
            convo.push_user(text_results.trim_end().to_string());
        }
        if !self.awaiting_approval.is_empty() {
            // أداة تنتظر قرار المستخدم: الحلقة تقف والمهمّة تنتظر. الاستئناف يبني المحادثة من السجلّ كما هي (ADR-041).
            return Some(LoopEnd { final_text: None, stop: None });
        }
        // ثلاث رفضات للنمط نفسه في المهمّة (OpenAI Auto-review): المسار يقف ويطلب المستخدم.
        if let Some((pattern, _)) = self.denial_counts.iter().find(|(key, n)| **n >= crate::p03::denial_policy::limit(key)) {
            return Some(LoopEnd::stopped(StopReason::RepeatedDenials(pattern.clone())));
        }
        // R-38: تقرير العقد كُتب في الدور الأخير: لا دور بعده، فالحلقة تنتهي هنا بردّ، ويحكم المصحّح على الملف كما يحكم دائمًا.
        if let (true, Some(path)) = (last_turn, &final_report) {
            // الرسالة تقول ما جرى فعلًا عند البوابة (مراجعة finecomb: كانت تقول «كُتب» ولو رُفضت الكتابة)؛ والحكم للمصحّح على القرص.
            let note = match last_status.as_str() {
                "SUCCEEDED" => format!("Report written to {path}."),
                "" => format!("The report {path} was not written: no write to that path was made on the last turn."),
                status => format!("The report {path} was not written: the write ended {status}."),
            };
            let answer = unwrap_reply(&visible);
            return Some(LoopEnd { final_text: Some(if answer.trim().is_empty() || last_status != "SUCCEEDED" { format!("{answer}
{note}").trim().to_string() } else { answer }), stop: None });
        }
        match *repeated {
            0 => {}
            1 => self.host_note(convo, scope, al::REPEAT_NOTE.to_string(), AuthorityClass::TrustedRuntimeFact),
            _ => return Some(LoopEnd::stopped(StopReason::NoProgress)),
        }
        if !scope.helper {
            self.save_checkpoint();
        }
        None
    }

    /// الضغط بالتلخيص (ADR-041 §3.2): حين تتجاوز المحادثة ميزانيتها، نداء واحد يلخّص الأقدم ويُكتب حدث SUMMARY بمداه، والأصل
    /// باقٍ في السجلّ. بلا سجلّ، أو حين يتعذّر التلخيص: التقليم القائم.
    fn compact(&mut self, model: &dyn AgentModel, scope: &Scope, convo: &mut LoopConversation, limit: al::ConversationLimit, turn: u32) {
        // W-2: سياق المساعد يُلخَّص حين تُعرف النافذة؛ نافذة مجهولة = التقليم كما كان.
        if scope.helper && limit.bytes.is_some() {
            self.compact_helper(model, scope, convo, limit, turn);
            return;
        }
        let Some((log, session_id)) = self.session.clone().filter(|_| !scope.helper) else {
            convo.prune_to(limit);
            return;
        };
        let events = log.events(&session_id);
        // المدى المغطّى ينتهي قبل آخر رسالة مستخدم أو وكيل تبدأ دورًا كاملًا، فلا تنفصل نتيجة أداة عن استدعائها.
        let mut keep_from = events
            .iter()
            .rev()
            .filter(|e| matches!(e.kind, SessionKind::UserMessage | SessionKind::AssistantMessage))
            .nth(3)
            .map(|e| e.seq)
            .unwrap_or(0);
        // W-2: نافذة معروفة وما بعد المدى أكبر من نصف الحدّ وحده (ردّ واحد بقراءات كبيرة، قِيس على Bonsai 16k): يُغطّى كل شيء،
        // فيطوي الملخّص الاستدعاء ونتائجه معًا ولا تنفصل نتيجة عن استدعائها.
        if let Some(window_bytes) = limit.bytes {
            let tail: Vec<_> = events.iter().filter(|e| e.seq >= keep_from).cloned().collect();
            if LoopConversation::from_messages(rebuild(&tail).messages).bytes().saturating_mul(2) > window_bytes {
                keep_from = events.last().map(|e| e.seq + 1).unwrap_or(0);
            }
        }
        let covered: Vec<_> = events.iter().filter(|e| e.seq < keep_from).cloned().collect();
        if covered.len() < 2 {
            convo.prune_to(limit);
            return;
        }
        let messages = rebuild(&covered).messages;
        let text = match limit.bytes {
            // W-2: نافذة معروفة: نصّ كامل بلا قصّ وسط، على دفعات تتّسع في النافذة.
            Some(window_bytes) => self.summarise_chunks(model, &al::chunk_lines(messages.iter().map(al::message_line), al::summary_chunk_cap(window_bytes))),
            // نافذة مجهولة: نداء واحد كما كان.
            None => {
                let transcript: String = messages
                    .iter()
                    .map(|m| format!("[{:?}] {}{}", m.role, al::clip_middle(&m.text, 3_000), m.tool_calls.iter().map(|c| format!("\n  call {} {}", c.name, al::clip_middle(&c.arguments, 300))).collect::<String>()))
                    .collect::<Vec<_>>()
                    .join("\n");
                self.summarise_once(model, &format!("{}\n\n<<<TRANSCRIPT\n{}\nTRANSCRIPT>>>", al::SUMMARY_INSTRUCTION, al::clip_middle(&transcript, 60_000)))
            }
        };
        let Some(text) = text else {
            convo.prune_to(limit);
            return;
        };
        let last_covered = covered.last().map(|e| e.seq).unwrap_or(0);
        let appended = log.append(crate::p03::watch::session::SessionDraft {
            session_id: session_id.clone(),
            mission_id: self.mission.mission_id.clone(),
            kind: SessionKind::Summary,
            authority: AuthorityClass::ModelGenerated,
            payload: json!({ "text": text, "covers_from": covered.first().map(|e| e.seq), "covers_to": last_covered }),
            parent_seq: Some(last_covered),
        });
        // الملخّص حدث في سجلّ الاستئناف: تعذّر كتابته عطل تخزين كغيره (R-06)، والمحادثة تبقى كما هي مقلَّمة.
        if let Err(detail) = appended {
            self.note_storage_fault("SESSION_LOG_WRITE_FAILED", &detail);
            convo.prune_to(limit);
            return;
        }
        let mut rebuilt = LoopConversation::from_messages(rebuild(&log.events(&session_id)).messages);
        if model.loop_mode() == Some(LoopMode::Text) {
            rebuilt.to_text_protocol();
        }
        *convo = rebuilt;
        if !convo.fits(limit) {
            convo.prune_to(limit);
        }
    }

    /// نداء تلخيص واحد بلا أدوات، محجوز من الميزانية. نصّ الملخّص، أو لا شيء إن تعذّر.
    fn summarise_once(&mut self, model: &dyn AgentModel, prompt: &str) -> Option<String> {
        let request = vec![polaris_host_providers::domain::ChatMessage::text(polaris_host_providers::domain::Role::User, prompt.to_string())];
        let outcome = self.guarded_call(None, || model.loop_turn(al::SUMMARY_SYSTEM, &request, &[]));
        self.flush_chat_spans(model, outcome.as_ref().ok().map(|t| (t.input_tokens, t.output_tokens)));
        match outcome {
            Ok(t) if !strip_reasoning(&t.text).trim().is_empty() => {
                let _ = self.budget.settle_model_call(t.input_tokens, t.output_tokens);
                Some(strip_reasoning(&t.text).trim().to_string())
            }
            _ => None,
        }
    }

    /// W-2 (أ): نداء لكل دفعة كاملة، وسقف الكلمات مقسوم على الدفعات فيبقى المجموع في النافذة. دفعة لم تُلخَّص: لا شيء (لا طيّ
    /// جزئي يُسقط ما لم يُلخَّص).
    fn summarise_chunks(&mut self, model: &dyn AgentModel, chunks: &[String]) -> Option<String> {
        if chunks.is_empty() {
            return None;
        }
        let words = (900 / chunks.len()).max(150);
        let mut parts: Vec<String> = Vec::with_capacity(chunks.len());
        for (index, chunk) in chunks.iter().enumerate() {
            let instruction = al::helper_summary_instruction(words, index + 1, chunks.len());
            parts.push(self.summarise_once(model, &format!("{instruction}\n\n<<<TRANSCRIPT\n{chunk}\nTRANSCRIPT>>>"))?);
        }
        Some(parts.join("\n\n"))
    }

    /// W-2: تلخيص سياق المساعد. كان تقليمًا فقط يحمي أحدث 8 نواتج، فتتجاوز قراءات كبيرة النافذة وحدها. ما بين المهمّة وآخر ردّ
    /// (أو كل ما بعدها حين يتجاوز آخر ردّ نصف الحدّ) يُلخَّص على دفعات كاملة ويُطوى في رسالة المهمّة. يُحجز من الميزانية كغيره.
    /// تعذّر التلخيص، أو بقي التجاوز بعده: التقليم القائم.
    fn compact_helper(&mut self, model: &dyn AgentModel, scope: &Scope, convo: &mut LoopConversation, limit: al::ConversationLimit, turn: u32) {
        let window_bytes = limit.bytes.unwrap_or(al::CONVERSATION_CHAR_BUDGET);
        let Some(cut) = convo.summary_cut_within(window_bytes) else {
            convo.prune_to(limit);
            return;
        };
        let before = convo.bytes();
        let chunks = convo.summary_chunks(cut, al::summary_chunk_cap(window_bytes));
        let summary = self.summarise_chunks(model, &chunks);
        let ok = summary.is_some();
        let covered = summary.map(|text| convo.fold_summary(cut, &text)).unwrap_or(0);
        if !convo.fits(limit) {
            convo.prune_to(limit);
        }
        self.log_event(scope.sub(), SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, measure::helper_summary_record(turn, covered, before, convo.bytes(), ok, chunks.len()));
    }

    /// يقرّر استدعاءً واحدًا: أداتا الخطة والتفويض هنا، وكل ما عداهما عبر البوابة باسم المعرّف لا الاسم المعروض.
    fn loop_call(&mut self, model: &dyn AgentModel, scope: &Scope, call: &ProposedToolCall, tools: &[LoopTool]) -> CallResult {
        if !scope.helper && call.name == al::PLAN_TOOL {
            let rendered = self.apply_plan(&scope.task_id, &call.arguments);
            return CallResult { status: status_of(&rendered), rendered, task_id: Some(scope.task_id.clone()), tool_id: None };
        }
        if !scope.helper && call.name == al::DIRECT_TOOL && tools.iter().any(|t| t.name == al::DIRECT_TOOL) {
            let rendered = al::render_result("SUCCEEDED", None, "Route recorded: you handle this request yourself. Continue with the work.", None);
            return CallResult { status: status_of(&rendered), rendered, task_id: Some(scope.task_id.clone()), tool_id: None };
        }
        if !scope.helper && call.name == al::DELEGATE_TOOL && tools.iter().any(|t| t.name == al::DELEGATE_TOOL) {
            // الوكيل الفرعي فعل من الطبقة 3: يمرّ بالمراقب إن وُجد.
            if let Some(blocked) = self.monitor_blocks(al::DELEGATE_TOOL, &call.arguments, &scope.task_id) {
                return CallResult { status: "DENIED".into(), rendered: blocked, task_id: Some(scope.task_id.clone()), tool_id: None };
            }
            let rendered = self.loop_delegate(model, scope, &call.arguments);
            return CallResult { status: status_of(&rendered), rendered, task_id: Some(scope.task_id.clone()), tool_id: None };
        }
        // اسم خارج القائمة يمرّ كما جاء، فترفضه البوابة وتسجّل رفضه؛ لا تخمين لأقرب اسم.
        let tool_id = tools.iter().find(|t| t.name == call.name).and_then(|t| t.tool_id.clone()).unwrap_or_else(|| call.name.clone());
        let task = if scope.helper { scope.task_id.clone() } else { self.current_step(&scope.task_id) };
        let mut result = self.execute_call(&task, &scope.agent_id, &tool_id, call);
        if result.status == "DENIED" {
            // W-4: الرفض يُحسب بنمطه (الأداة وسببه)، ولسبب يصحّحه تغيير الوسائط بوسائطه المطبَّعة أيضًا (`denial_policy`).
            let reason = result.rendered.lines().next().and_then(|l| l.split_once('(')).map(|(_, r)| r.trim_end_matches(')').to_string()).unwrap_or_else(|| "DENIED".into());
            for key in crate::p03::denial_policy::keys(&tool_id, &reason, &call.arguments) {
                *self.denial_counts.entry(key).or_insert(0) += 1;
            }
        }
        result.tool_id = Some(tool_id);
        result
    }

    /// استدعاء أداة واحدة عند البوابة بضوابط الطبقات: الطُعم، والمراقب الأعمى للطبقة 3، وقاعدة الاثنين، ومسبار الحقن على الناتج.
    fn execute_call(&mut self, task: &str, agent_id: &str, tool_id: &str, call: &ProposedToolCall) -> CallResult {
        // أدوات الوكيل المعرَّف وميزانيته يفرضهما زمن التشغيل قبل كل شيء، فلا يبلغ البوابة ولا المراقب ما ليس له (القسم 6).
        if let Some(denied) = self.agent_policy_denial(agent_id, tool_id, task) {
            return CallResult { status: "DENIED".into(), rendered: denied, task_id: Some(task.to_string()), tool_id: Some(tool_id.to_string()) };
        }
        // الوسائط كما بثّها النموذج: كائن JSON يُمرَّر، وما سواه يُمرَّر نصًّا فترفضه البوابة برفض صياغة يحمل مثالًا صالحًا.
        let arguments = match serde_json::from_str::<Value>(&call.arguments) {
            Ok(value @ Value::Object(_)) => value,
            Ok(other) => other,
            Err(_) if call.arguments.trim().is_empty() => serde_json::json!({}),
            Err(_) => Value::String(call.arguments.clone()),
        };
        // ملف الطُعم (ADR-041 §3.4؛ PHASE-11): نداء يسمّيه، في أي حقل وبأي كتابة، والطلب لا يذكره، يُمنع قبل البوابة ويُسجَّل.
        // كان يُرصد ويمرّ، فيصل محتواه النموذج؛ الكشف وحده ليس حماية.
        if arguments_name_honeytoken(&arguments) && !request_names_honeytoken(&self.mission.objective) {
            self.security("HONEYTOKEN_READ", Some(task), format!("{tool_id} named {HONEYTOKEN_PATH}, which the request does not name: refused"));
            *self.denial_counts.entry(format!("{tool_id}:SECRET_REQUESTED")).or_insert(0) += 1;
            let rendered = al::render_result("DENIED", Some("SECRET_REQUESTED"), "that file holds credentials the request did not ask for; it is not read", None);
            return CallResult { status: "DENIED".into(), rendered, task_id: Some(task.to_string()), tool_id: Some(tool_id.to_string()) };
        }
        // قيمة الكناري في وسائط فعلٍ خارجي: تسريب لاعتماد طُعم، يُمنع قبل البوابة (ASI03).
        let traits = self.tools.as_ref().and_then(|b| b.tool_traits(tool_id));
        if call.arguments.contains(crate::p03::security::CANARY_PREFIX) && rule_of_two::external_change(tool_id, &arguments, traits) {
            self.security("CANARY_EXFILTRATION", Some(task), format!("{tool_id} carried the decoy credential value"));
            *self.denial_counts.entry(format!("{tool_id}:SECRET_REQUESTED")).or_insert(0) += 1;
            let rendered = al::render_result("DENIED", Some("SECRET_REQUESTED"), "the call carried a credential value it must not send anywhere", None);
            return CallResult { status: "DENIED".into(), rendered, task_id: Some(task.to_string()), tool_id: Some(tool_id.to_string()) };
        }
        if let Some(blocked) = self.monitor_blocks(tool_id, &call.arguments, task) {
            return CallResult { status: "DENIED".into(), rendered: blocked, task_id: Some(task.to_string()), tool_id: Some(tool_id.to_string()) };
        }
        // قاعدة الاثنين: [A] و[B] اجتمعا قبل فعل [C]، فينتظر إنسانًا.
        let require_human = self.rule_of_two.requires_human(tool_id, &arguments, traits);
        if require_human {
            self.security("RULE_OF_TWO", Some(task), format!("{tool_id} after untrusted input with sensitive data in reach: a human decides"));
        }
        let request = ToolRequest { skill_id: String::new(), tool_id: tool_id.to_string(), arguments, reason: String::new(), expected_effect: Vec::new(), expected_output: String::new(), require_human };
        let before = self.tool_decisions.len();
        self.run_tool_requests(task, agent_id, std::slice::from_ref(&request));
        let Some(decision) = self.tool_decisions.get(before).cloned() else {
            let rendered = al::render_result("CANCELLED", None, "the call was not made because the request was cancelled", None);
            return CallResult { status: "CANCELLED".into(), rendered, task_id: Some(task.to_string()), tool_id: Some(tool_id.to_string()) };
        };
        if decision.status == "SUCCEEDED" && rule_of_two::brings_untrusted(tool_id, traits) {
            self.rule_of_two.untrusted_input = true;
        }
        // قيمة الكناري حُجبت في `run_tool_requests` (PHASE-11) قبل أن تصل هنا.
        let mut rendered = al::render_result_capped(&decision.status, decision.denial_reason.as_deref(), &decision.summary, decision.observation.as_deref(), self.result_cap);
        // مسبار الحقن على ناتج الأداة قبل أن يدخل المحادثة: التحذير يسبق الناتج، والناتج يبقى كما هو مسيَّجًا.
        if let Some(observation) = decision.observation.as_deref() {
            if let Some(warning) = self.probe_untrusted(observation, tool_id, Some(task)) {
                rendered = format!("{warning}\n{rendered}");
            }
        }
        CallResult { status: decision.status.clone(), rendered, task_id: Some(task.to_string()), tool_id: Some(tool_id.to_string()) }
    }

    /// المراقب الأعمى على فعل من الطبقة 3، إن اختار المستخدم له نموذجًا. يرى الطلب والاستدعاء وحدهما. يعيد نتيجة الرفض إن منع.
    ///
    /// R-05 (2026-10-12): نداء المراقب نداء نموذج للمهمّة كغيره: يُفحص الإلغاء قبله وبعده، ويُحجز من ميزانية المهمّة، ويُكتب له
    /// امتداد `chat` بنموذجه ومزوّده ورموزه وقراره، ويُنسب إلى الوكيل والخطوة. نفاد الميزانية لا ينادي المراقب أصلًا. وكل ما
    /// ليس سماحًا صريحًا منعٌ بسببه الدقيق (منع، أو ردّ ملتبس، أو لا حكم).
    fn monitor_blocks(&mut self, tool_id: &str, arguments: &str, task: &str) -> Option<String> {
        let monitor = self.monitor.clone()?;
        if tool_id != al::DELEGATE_TOOL && tier_of(tool_id) != ActionTier::Boundary {
            return None;
        }
        let agent_id = self.active_agent.clone().unwrap_or_default();
        let input = MonitorInput {
            user_request: self.mission.objective.clone(),
            tool_id: tool_id.to_string(),
            arguments: arguments.to_string(),
            mission_id: self.mission.mission_id.clone(),
            agent_id: agent_id.clone(),
            task_id: task.to_string(),
        };
        let verdict = if self.is_cancelled() {
            MonitorVerdict::Unavailable("CANCELLED".into())
        } else if let Err(denied) = self.budget.reserve_model_call() {
            MonitorVerdict::Unavailable(format!("BUDGET_EXHAUSTED: {}", denied.dimension.as_str()))
        } else {
            let started_at = self.clock.now();
            let began = std::time::Instant::now();
            let verdict = monitor.review(&input);
            let facts = monitor.take_call_facts();
            let (input_tokens, output_tokens) = facts.iter().fold((0u64, 0u64), |(i, o), f| (i + f.input_tokens.unwrap_or(0), o + f.output_tokens.unwrap_or(0)));
            if facts.iter().any(|f| f.status == "OK") {
                if let Err(denied) = self.budget.settle_model_call(input_tokens, output_tokens) {
                    self.security("MONITOR_BUDGET", Some(task), format!("the monitor call exceeded the budget: {}", denied.dimension.as_str()));
                }
            } else {
                self.budget.abandon_model_call();
            }
            self.record_monitor_span(&agent_id, task, tool_id, &verdict, &facts, &started_at, began.elapsed().as_millis() as u64);
            // إلغاء وصل أثناء نداء المراقب يسود حكمه: لا فعل بعد «قف».
            if self.is_cancelled() {
                MonitorVerdict::Unavailable("CANCELLED".into())
            } else {
                verdict
            }
        };
        let preview = action_preview(&serde_json::from_str(arguments).unwrap_or(Value::Null));
        match verdict {
            MonitorVerdict::Allow => {
                self.security("MONITOR_ALLOWED", Some(task), tool_id.to_string());
                None
            }
            other => {
                let (code, explanation) = match &other {
                    MonitorVerdict::Block(reason) => ("MONITOR_BLOCKED", format!("an independent action monitor that sees only the user's request judged this call unnecessary for it: {reason}")),
                    MonitorVerdict::Unclear(reason) => ("MONITOR_UNCLEAR", format!("the action monitor answered without a clear ALLOW, so the call does not run: {reason}")),
                    MonitorVerdict::Unavailable(reason) => ("MONITOR_UNAVAILABLE", format!("the action monitor gave no decision ({reason}), so the call does not run")),
                    MonitorVerdict::Allow => unreachable!("handled above"),
                };
                self.security(other.code(), Some(task), format!("{tool_id}: {}", match &other { MonitorVerdict::Block(r) | MonitorVerdict::Unclear(r) | MonitorVerdict::Unavailable(r) => r.as_str(), MonitorVerdict::Allow => "" }));
                self.narrate(NarrationKind::Action, &format!("{tool_id} {preview}"), Some(format!("DENIED {code}")));
                Some(al::render_result("DENIED", Some(code), &explanation, None))
            }
        }
    }

    /// الخطوة الجارية: أول عقدة في الخطة حالتها «جارية»، وإلا الجذر. إليها تُنسب الأدوات وأحداث النموذج.
    fn current_step(&self, root: &str) -> String {
        self.loop_plan.iter().find(|id| self.graph.get(id).is_some_and(|n| n.state == TaskState::Running)).cloned().unwrap_or_else(|| root.to_string())
    }

    /// حالة خطوة قال الوكيل إنها تمّت: SUCCEEDED بقياس يخصّها، وإلا UNVERIFIED_DONE (ADR-041 §3.3).
    fn done_state(&self, task_id: &str) -> TaskState {
        if self.step_measured(task_id) {
            TaskState::Succeeded
        } else {
            TaskState::UnverifiedDone
        }
    }

    /// يطبّق خطة الوكيل على رسم المهمّة: عقدة لكل خطوة تحت الجذر، بعنوانها وحالتها كما قالها الوكيل. الحالة هنا سرد خطة
    /// لا إثبات: «اكتملت» لا تصير SUCCEEDED إلا بأداة نجحت لهذه الخطوة؛ غير ذلك UNVERIFIED_DONE.
    fn apply_plan(&mut self, root: &str, raw: &str) -> String {
        let Ok(value) = serde_json::from_str::<Value>(raw) else {
            return al::render_result("DENIED", Some("ARGUMENTS_INVALID"), "update_plan needs a JSON object with a steps list", None);
        };
        let Some(steps) = value.get("steps").and_then(Value::as_array) else {
            return al::render_result("DENIED", Some("ARGUMENTS_INVALID"), "update_plan needs \"steps\": a list of {\"step\", \"status\"}", None);
        };
        let first_plan = self.loop_plan.is_empty();
        let mut newly_running: Vec<String> = Vec::new();
        let mut seen = 0usize;
        for (i, step) in steps.iter().take(al::MAX_PLAN_ITEMS).enumerate() {
            let title: String = step.get("step").and_then(Value::as_str).unwrap_or_default().trim().chars().take(80).collect();
            if title.is_empty() {
                continue;
            }
            let said = step.get("status").and_then(Value::as_str).unwrap_or("pending");
            seen = i + 1;
            if let Some(id) = self.loop_plan.get(i).cloned() {
                let state = match said {
                    "completed" => self.done_state(&id),
                    "in_progress" => TaskState::Running,
                    _ => TaskState::Pending,
                };
                let before = self.graph.get(&id).map(|n| n.state);
                self.graph.set_title(&id, &title);
                if before != Some(state) {
                    let _ = self.graph.set_state(&id, state);
                    if state == TaskState::Running {
                        newly_running.push(title.clone());
                    }
                }
                continue;
            }
            if self.budget.reserve_task().is_err() {
                break;
            }
            let id = self.clock.id();
            // خطوة جديدة تُعلن «تمّت» قبل أن يُنسب إليها شيء: لا قياس لها.
            let state = match said {
                "completed" => TaskState::UnverifiedDone,
                "in_progress" => TaskState::Running,
                _ => TaskState::Pending,
            };
            let mut node = TaskNode::new(id.clone(), &self.mission.mission_id, title.clone(), title.clone(), TaskType::Build);
            node.parent_task_id = Some(root.to_string());
            node.state = state;
            let mutation = GraphMutation {
                proposal_id: self.clock.id(),
                agent_id: "polaris.runtime".into(),
                mission_id: self.mission.mission_id.clone(),
                base_revision: self.graph.revision,
                added_tasks: vec![node],
                added_dependencies: Vec::new(),
                reason: "AGENT_PLAN".into(),
            };
            if self.graph.apply_mutation(&mutation, self.mission.budget.max_tasks).is_err() {
                break;
            }
            self.loop_plan.push(id);
            if state == TaskState::Running {
                newly_running.push(title);
            }
        }
        // خطوات حُذفت من الخطة لم تعد مطلوبة: تُسجَّل ملغاة، لا ناجحة.
        for id in self.loop_plan.iter().skip(seen) {
            if self.graph.get(id).is_some_and(|n| !n.state.is_terminal()) {
                let _ = self.graph.set_state(id, TaskState::Cancelled);
            }
        }
        if first_plan && !self.loop_plan.is_empty() {
            let outline: Vec<String> = self.loop_plan.iter().filter_map(|id| self.graph.get(id)).enumerate().map(|(i, n)| format!("{}. {}", i + 1, n.title)).collect();
            self.narrate(NarrationKind::Plan, &outline.join("\n"), None);
        }
        for title in newly_running {
            self.narrate(NarrationKind::Step, &title, None);
        }
        if self.reply_enabled && !self.loop_titled {
            if let Some(title) = value.get("title").and_then(Value::as_str).and_then(clean_title) {
                self.set_loop_title(title);
            }
        }
        let current = self.current_step(root);
        self.set_step(Some(&current));
        let done = self.loop_plan.iter().filter(|id| self.graph.get(id).is_some_and(|n| n.state == TaskState::Succeeded)).count();
        let unverified = self.loop_plan.iter().filter(|id| self.graph.get(id).is_some_and(|n| n.state == TaskState::UnverifiedDone)).count();
        let running = self.loop_plan.iter().filter_map(|id| self.graph.get(id)).find(|n| n.state == TaskState::Running).map(|n| n.title.clone());
        al::render_result(
            "SUCCEEDED",
            None,
            &format!(
                "plan recorded: {} steps, {done} completed with a measured tool call{}{}",
                self.loop_plan.len(),
                if unverified > 0 { format!(", {unverified} marked done without any measured tool call (recorded UNVERIFIED_DONE)") } else { String::new() },
                running.map(|t| format!(", in progress: {t}")).unwrap_or_default()
            ),
            None,
        )
    }

    fn set_loop_title(&mut self, title: String) {
        self.loop_titled = true;
        self.mission.title = title.clone();
        if let Some(observer) = &self.observer {
            observer.retitle(&self.mission.mission_id, &title);
        }
    }

    /// تفويض وكيل مساعد: عقدة تحت الخطوة الجارية، ووكيل بسياق نظيف، وحلقة محدودة، وتقريره نتيجةً للطالب. بحدود التفويض والميزانية.
    /// الطلب والتقرير رسالتا وكيل على الناقل بمعرّفات زمن التشغيل وصنف AGENT_MESSAGE ثابت (ASI07)، ومحادثته في جلسة فرعية.
    fn loop_delegate(&mut self, model: &dyn AgentModel, scope: &Scope, raw: &str) -> String {
        let saved = self.step_and_agent();
        let mut branch = match self.delegate_begin(scope, raw) {
            Ok(branch) => branch,
            Err(rendered) => return rendered,
        };
        let opening = self.branch_opening(&branch, raw);
        let end = self.drive_loop(model, &branch.scope, LoopConversation::new(opening));
        branch.end = Some(end);
        self.delegate_finish(branch, saved)
    }

    /// الخطوة الجارية والوكيل النشط، ليعودا كما كانا بعد التفويض.
    fn step_and_agent(&self) -> (Option<String>, Option<String>) {
        (self.step_slot.as_ref().and_then(|s| s.lock().ok().and_then(|g| g.clone())), self.active_agent.clone())
    }

    /// كم تفويضًا من ردّ واحد يجري معًا (G4): توازي النموذج المعلن، بحدّ `MAX_PARALLEL_DELEGATIONS`.
    fn delegation_width(&self, model: &dyn AgentModel) -> usize {
        model.parallel_first_calls().clamp(1, MAX_PARALLEL_DELEGATIONS)
    }

    /// بدء فرع تفويض: التحقّق من الطلب، والحجز من الميزانية، والعقدة، والوكيل المساعد، ورسالة الطلب، وامتداد الوكيل. يعيد نتيجة
    /// الرفض إن لم يبدأ.
    fn delegate_begin(&mut self, scope: &Scope, raw: &str) -> Result<Branch, String> {
        let value: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
        let objective: String = value.get("objective").and_then(Value::as_str).unwrap_or_default().trim().chars().take(2_000).collect();
        if objective.is_empty() {
            return Err(al::render_result("DENIED", Some("ARGUMENTS_INVALID"), "delegate_task needs an \"objective\"", None));
        }
        // تفويض إلى وكيل معرَّف بمعرّفه (القسم 6). معرّف لا يعرفه الدليل يُرفض باسمه، ولا يُخمَّن أقرب وكيل.
        let requested_agent = value.get("agent_id").and_then(Value::as_str).map(str::trim).filter(|a| !a.is_empty()).map(str::to_string);
        // G2: المعرّف يجب أن يكون من القائمة التي عرضها المضيف على المنسّق لهذا الطلب؛ القائمة والاختيار يُسجَّلان.
        if let Some(id) = &requested_agent {
            if !self.record_agent_selection(id) {
                return Err(al::render_result(
                    "DENIED",
                    Some("AGENT_NOT_OFFERED"),
                    &format!("{id} is not one of the candidate agents POLARIS listed for this request ({}); choose one of them, delegate without agent_id, or do the work yourself", if self.offered_agents.is_empty() { "none were listed".to_string() } else { self.offered_agents.join(", ") }),
                    None,
                ));
            }
        }
        let definition = match (&requested_agent, self.agent_directory) {
            (Some(id), Some(directory)) => match directory.get(id) {
                Some(d) => Some(d),
                None => return Err(al::render_result("DENIED", Some("ARGUMENTS_INVALID"), &format!("no agent {id} exists in the directory"), None)),
            },
            (Some(id), None) => return Err(al::render_result("DENIED", Some("ARGUMENTS_INVALID"), &format!("agent {id} cannot be reached in this host"), None)),
            (None, _) => None,
        };
        self.delegations_requested += 1;
        if self.budget.reserve_delegation().is_err() || self.budget.reserve_task().is_err() {
            return Err(al::render_result("DENIED", Some("BUDGET_EXHAUSTED"), "no delegation budget is left for this request; do the work yourself", None));
        }
        let parent = self.current_step(&scope.task_id);
        let child = self.clock.id();
        let title: String = objective.chars().take(80).collect();
        // نوع العقدة من عقد مدخلات الوكيل المعرَّف (أول نوع يقبله)، وإلا بحث كما كان.
        let task_type = definition.and_then(|d| d.input.accepts.first().copied()).unwrap_or(TaskType::Research);
        let mut node = TaskNode::new(child.clone(), &self.mission.mission_id, title.clone(), objective.clone(), task_type);
        node.parent_task_id = Some(parent);
        let mutation = GraphMutation {
            proposal_id: self.clock.id(),
            agent_id: scope.agent_id.clone(),
            mission_id: self.mission.mission_id.clone(),
            base_revision: self.graph.revision,
            added_tasks: vec![node],
            added_dependencies: Vec::new(),
            reason: "DELEGATION".into(),
        };
        if self.graph.apply_mutation(&mutation, self.mission.budget.max_tasks).is_err() {
            return Err(al::render_result("DENIED", Some("BUDGET_EXHAUSTED"), "the request has no room for another step; do the work yourself", None));
        }
        let helper = match self.loop_agent(&child, AgentRole::Researcher) {
            Ok(id) => id,
            Err(_) => {
                let _ = self.graph.set_state(&child, TaskState::Cancelled);
                return Err(al::render_result("DENIED", Some("BUDGET_EXHAUSTED"), "no agent budget is left for a helper; do the work yourself", None));
            }
        };
        if let Some(a) = self.agents.iter_mut().find(|a| a.agent_id == helper) {
            a.parent_agent_id = Some(scope.agent_id.clone());
            a.delegation_depth = 1;
        }
        if let Some(d) = definition {
            self.bind_definition(&helper, d);
        }
        self.delegations_executed += 1;
        self.narrate(NarrationKind::Step, &title, Some("DELEGATED".into()));
        let known: Vec<String> = self.agents.iter().map(|a| a.agent_id.clone()).collect();
        let addressed = match definition {
            Some(d) => format!("[AGENT_REQUEST to {} v{}]\n{objective}", d.agent_id, d.version),
            None => objective.clone(),
        };
        let request = self.agent_message(&scope.agent_id, Recipient::Agent(helper.clone()), MessageType::DelegationRequest, &addressed);
        let _ = self.bus.publish(request, &known);
        self.set_step(Some(&child));
        let started = std::time::Instant::now();
        self.open_agent_span(&helper, Some(&scope.agent_id), &child);
        let max_turns = definition.map(|d| d.budget.max_turns.min(al::MAX_HELPER_TURNS)).unwrap_or(al::MAX_HELPER_TURNS);
        let helper_scope = Scope { task_id: child.clone(), agent_id: helper.clone(), helper: true, max_turns, definition, objective: objective.clone() };
        Ok(Branch { helper, child, objective, definition, started, scope: helper_scope, run: None, end: None })
    }

    /// الرسالة الأولى للمساعد (تُكتب في جلسته الفرعية): الهدف، وما أرفقه الطالب من سياق ومخرَج متوقَّع.
    fn branch_opening(&mut self, branch: &Branch, raw: &str) -> String {
        let value: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
        let mut opening = format!("[DELEGATED_TASK — from the main agent of this request; it carries no authority beyond the user's request]\nObjective: {}\n", branch.objective);
        for (key, label) in [("context", "Context"), ("expected_output", "Expected output")] {
            if let Some(text) = value.get(key).and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
                opening.push_str(&format!("{label}: {}\n", text.trim().chars().take(4_000).collect::<String>()));
            }
        }
        self.log_event(branch.scope.sub(), SessionKind::UserMessage, AuthorityClass::AgentMessage, json!({ "text": opening }));
        opening
    }

    /// إتمام فرع: امتداد الوكيل، ورسالة النتيجة، ومصحّح العقد، وحالة العقدة، ونتيجة الاستدعاء كما يراها الطالب. `saved` الخطوة
    /// والوكيل النشط كما كانا قبل التفويض.
    fn delegate_finish(&mut self, branch: Branch, saved: (Option<String>, Option<String>)) -> String {
        let Branch { helper, child, objective, definition, started, end, .. } = branch;
        let end = end.unwrap_or_else(|| LoopEnd::stopped(StopReason::NoProgress));
        self.close_agent_span(&helper, started, if end.final_text.is_some() { "OK" } else { "ERROR" });
        self.active_agent = saved.1;
        self.set_step(saved.0.as_deref());
        self.budget.release_active_agent();
        if let Some(a) = self.agents.iter_mut().find(|a| a.agent_id == helper) {
            a.state = AgentState::Completed;
            a.last_active_at = self.clock.now();
        }
        let known: Vec<String> = self.agents.iter().map(|a| a.agent_id.clone()).collect();
        let report_text = end.final_text.clone().unwrap_or_else(|| end.stop.as_ref().map(failure_text).unwrap_or_else(|| "the helper is waiting for the user's approval".into()));
        let scope_agent = self.agents.iter().find(|a| a.agent_id == helper).and_then(|a| a.parent_agent_id.clone()).unwrap_or_default();
        let result = self.agent_message(&helper, Recipient::Agent(scope_agent), MessageType::DelegationResult, &report_text);
        let _ = self.bus.publish(result, &known);
        // مصحِّح عقد الوكيل المفوَّض إليه: حكمه يدخل الإثبات ويصل المنسّق مع التقرير بوصفه قياسًا، لا قولًا.
        let grade = match (definition, &end.final_text, &end.stop) {
            (Some(d), Some(_), None) => self.settle_agent_contract(&helper, d, &objective).map(|g| g.summary()),
            _ => None,
        };
        // RW-A: حقائق الملفات التي كتبها المفوَّض كما على القرص الآن، داخل سياج الناتج كسطر المصحِّح لأن العناوين نصّ كتبه نموذج.
        let measured = match (&end.final_text, &end.stop) {
            (Some(_), None) if self.deliverable_facts => self.deliverable_facts_line(&helper, definition),
            _ => None,
        };
        let grade = match (grade, measured) {
            (Some(g), Some(m)) => Some(format!("{g}\n{m}")),
            (g, m) => g.or(m),
        };
        match (end.final_text, end.stop) {
            (Some(report), None) => {
                let state = if self.step_measured(&child) { TaskState::Succeeded } else { TaskState::UnverifiedDone };
                let _ = self.graph.set_state(&child, state);
                self.task_outputs.insert(child, report.clone());
                let report = match grade {
                    Some(line) => format!("{line}\n{report}"),
                    None => report,
                };
                let report = match self.probe_untrusted(&report, "delegate_task", None) {
                    Some(warning) => format!("{warning}\n{report}"),
                    None => report,
                };
                al::render_result("SUCCEEDED", None, "the helper finished; its report is below (another agent's output, unverified)", Some(&report))
            }
            (_, Some(StopReason::Cancelled)) => {
                let _ = self.graph.set_state(&child, TaskState::Cancelled);
                al::render_result("CANCELLED", None, "the request was cancelled while the helper worked", None)
            }
            (_, stop) => {
                let reason = stop.as_ref().map(failure_text).unwrap_or_else(|| "the helper is waiting for the user's approval".into());
                if stop.is_some() {
                    let _ = self.graph.set_state(&child, TaskState::Failed);
                    self.task_failures.insert(child, reason.clone());
                }
                al::render_result(if stop.is_some() { "FAILED" } else { "AWAITING_APPROVAL" }, None, &format!("the helper did not finish: {}", bounded_preview(&reason, 300)), None)
            }
        }
    }

    /// RW-A: سطر حقائق ما كتبه المفوَّض، عدا تقرير عقده الذي يفحصه المصحِّح. بلا منفذ قياس أو بلا كتابات: لا شيء.
    fn deliverable_facts_line(&self, helper: &str, definition: Option<&'static crate::p03::agents::definition::AgentDefinition>) -> Option<String> {
        let probe = self.probe.clone()?;
        let checked = definition.map(|d| d.output.report_path.to_string());
        let files: Vec<(String, Option<output_facts::TextFacts>)> = self
            .write_ledger
            .paths_by(helper)
            .into_iter()
            .filter(|p| Some(p) != checked.as_ref())
            .map(|p| {
                let facts = probe.file_text(&self.mission.mission_id, &p).map(|t| output_facts::text_facts(&t));
                (p, facts)
            })
            .collect();
        output_facts::deliverable_line(&files, checked.as_deref())
    }

    /// G4: تفويضات ردّ واحد على دفعات بعرض `width`. النتائج بترتيب الاستدعاءات.
    fn loop_delegate_parallel(&mut self, model: &dyn AgentModel, scope: &Scope, calls: &[ProposedToolCall], width: usize) -> Vec<CallResult> {
        let mut out = Vec::with_capacity(calls.len());
        for chunk in calls.chunks(width) {
            out.extend(self.run_branches(model, scope, chunk));
        }
        out
    }

    /// G4: فروع تفويض متوازية. كل فرع يبدأ ويُتمّ كما يبدأ التفويض المنفرد ويُتمّ؛ وبينهما جولات: تحضير دور كل فرع حيّ بالتسلسل،
    /// ثم نداءات النموذج معًا (كلٌّ في خيط، بخطوته المعلنة، ومقعده محجوز من الميزانية قبله)، ثم تطبيق ناتج كل فرع بالتسلسل (أدواته
    /// عبر البوابة، وسجلّه، وامتداداته، وإعاداته). ما يتوازى انتظار النموذج وحده، كما في E4.
    fn run_branches(&mut self, model: &dyn AgentModel, scope: &Scope, calls: &[ProposedToolCall]) -> Vec<CallResult> {
        let saved = self.step_and_agent();
        let mut results: Vec<Option<CallResult>> = calls.iter().map(|_| None).collect();
        let mut branches: Vec<(usize, Branch)> = Vec::new();
        for (i, call) in calls.iter().enumerate() {
            // الوكيل الفرعي فعل من الطبقة 3: يمرّ بالمراقب إن وُجد، كالمنفرد.
            if let Some(blocked) = self.monitor_blocks(al::DELEGATE_TOOL, &call.arguments, &scope.task_id) {
                results[i] = Some(CallResult { status: "DENIED".into(), rendered: blocked, task_id: Some(scope.task_id.clone()), tool_id: None });
                continue;
            }
            match self.delegate_begin(scope, &call.arguments) {
                Ok(mut branch) => {
                    let opening = self.branch_opening(&branch, &call.arguments);
                    match self.loop_begin(model, &branch.scope, LoopConversation::new(opening)) {
                        Ok(run) => branch.run = Some(run),
                        Err(end) => branch.end = Some(end),
                    }
                    branches.push((i, branch));
                }
                Err(rendered) => results[i] = Some(CallResult { status: status_of(&rendered), rendered, task_id: Some(scope.task_id.clone()), tool_id: None }),
            }
        }
        loop {
            // تحضير: كل فرع حيّ يُفحص قبل دوره (الحدّ، والإلغاء، والوقت...)، ويُحجز مقعد ندائه.
            let mut ready: Vec<usize> = Vec::new();
            for (k, (_, branch)) in branches.iter_mut().enumerate() {
                if branch.end.is_some() {
                    continue;
                }
                let Some(mut run) = branch.run.take() else { continue };
                self.set_step(Some(&branch.child));
                self.active_agent = Some(branch.helper.clone());
                let prepared = self.turn_prepare(model, &branch.scope, &mut run).or_else(|| {
                    if self.is_cancelled() {
                        self.cancelled = true;
                        return Some(LoopEnd::stopped(StopReason::Cancelled));
                    }
                    self.storage_stop().map(LoopEnd::stopped).or_else(|| self.budget.reserve_model_call().err().map(|denied| LoopEnd::stopped(StopReason::BudgetExhausted(denied))))
                });
                match prepared {
                    Some(end) => branch.end = Some(end),
                    None => {
                        // خادم رفض الاستدعاء الأصيل: تحويل الصيغة قبل النداء، كما يفعل النداء المحروس قبل كل محاولة.
                        if let Some(now) = model.loop_mode() {
                            if now != run.mode {
                                if now == LoopMode::Text {
                                    run.convo.to_text_protocol();
                                }
                                run.mode = now;
                                run.system = system_for(&run.today, now, &run.tools, run.brief.as_deref(), run.candidates.as_deref(), true, run.profile.as_deref());
                            }
                        }
                        ready.push(k);
                    }
                }
                branch.run = Some(run);
            }
            if ready.is_empty() {
                break;
            }
            if let Some(observer) = &self.observer {
                observer.thinking(&self.mission.mission_id, true);
            }
            let started_at = self.clock.now();
            let attempts: Vec<(Result<LoopTurn, ModelError>, Vec<crate::p03::port::CallFacts>, u64)> = std::thread::scope(|threads| {
                let handles: Vec<_> = ready
                    .iter()
                    .filter_map(|k| {
                        let branch = &branches[*k].1;
                        let run = branch.run.as_ref()?;
                        let step = branch.child.clone();
                        Some(threads.spawn(move || {
                            let began = std::time::Instant::now();
                            let outcome = crate::p03::cancel::with_thread_step(&step, || model.loop_turn(&run.system, run.convo.messages(), &run.offers));
                            (outcome, model.take_thread_call_facts(), began.elapsed().as_millis() as u64)
                        }))
                    })
                    .collect();
                handles.into_iter().map(|h| h.join().unwrap_or_else(|_| (Err(ModelError::InvalidOutput("a parallel branch panicked".into())), Vec::new(), 0))).collect()
            });
            if let Some(observer) = &self.observer {
                observer.thinking(&self.mission.mission_id, false);
            }
            // تطبيق: كل فرع بالتسلسل، بخطوته ووكيله، والنداء المحروس يكمل ما بعد المحاولة الأولى (الإعادة، وتحديد المعدّل، والإلغاء).
            for (k, (outcome, facts, latency_ms)) in ready.into_iter().zip(attempts) {
                let branch = &mut branches[k].1;
                let Some(mut run) = branch.run.take() else { continue };
                self.set_step(Some(&branch.child));
                self.active_agent = Some(branch.helper.clone());
                let first = FirstAttempt { outcome, started_at: started_at.clone(), latency_ms };
                let turn = self.loop_model_turn(model, &branch.scope, &mut run, Some((first, facts)));
                match self.turn_apply(model, &branch.scope, &mut run, turn) {
                    Some(end) => branch.end = Some(end),
                    None => run.turn_index += 1,
                }
                branch.run = Some(run);
            }
        }
        self.active_agent = saved.1.clone();
        self.set_step(saved.0.as_deref());
        for (i, branch) in branches {
            let rendered = self.delegate_finish(branch, saved.clone());
            results[i] = Some(CallResult { status: status_of(&rendered), rendered, task_id: Some(scope.task_id.clone()), tool_id: None });
        }
        results.into_iter().map(|r| r.unwrap_or_else(|| CallResult { status: "CANCELLED".into(), rendered: al::render_result("CANCELLED", None, "the call was not made", None), task_id: Some(scope.task_id.clone()), tool_id: None })).collect()
    }

    /// المراجعة المستقلّة (E6) في الحلقة: يقرأ المراجِع الطلب والردّ وما أنجزته البوابة والملفات. يعيد ملاحظاته إن طلب تعديلًا.
    fn loop_review(&mut self, model: &dyn AgentModel, root: &str, answer: &str) -> Result<Option<String>, StopReason> {
        let files = self.probe.as_ref().map(|p| p.workspace_files(&self.mission.mission_id)).unwrap_or_default();
        let mut work = vec![format!("Final message the agent wrote (agent output, unverified):\n{}", al::clip_middle(answer, 4_000))];
        let done = self.done_actions();
        if !done.is_empty() {
            work.push(format!("Tool calls that succeeded, measured by POLARIS:\n- {}", done.join("\n- ")));
        }
        model.note_review_input(root, &ReviewInput { objective: self.mission.objective.clone(), work, files: files.into_iter().take(60).collect() });
        let result = self.guarded_call(None, || model.review(AgentRole::Reviewer, root));
        self.flush_chat_spans(model, result.as_ref().ok().map(|r| (r.input_tokens, r.output_tokens)));
        let result = result?;
        self.budget.settle_model_call(result.input_tokens, result.output_tokens).map_err(StopReason::BudgetExhausted)?;
        // المراجِع البعيد قد تعذّر فراجع نموذج التنفيذ نفسه: تُسجَّل المراجعة كما جرت.
        let independent = model.reviews_independently();
        self.review_independence = if independent { ReviewIndependence::IndependentModelReview } else { ReviewIndependence::SameModelReview };
        self.reviews.push(ReviewRecord {
            review_id: self.clock.id(),
            task_id: root.to_string(),
            reviewer_agent: AgentRole::Reviewer.as_str().to_string(),
            verdict: match result.verdict {
                ReviewVerdict::Accept => "ACCEPT",
                ReviewVerdict::Revise => "REVISE",
                ReviewVerdict::Reject => "REJECT",
                ReviewVerdict::Blocked => "BLOCKED",
            },
            independence: if independent { "INDEPENDENT_MODEL_REVIEW" } else { "SAME_MODEL_REVIEW" },
            round: self.reviews.iter().filter(|r| r.task_id == root).count() as u32 + 1,
            notes: result.notes.chars().take(4000).collect(),
            created_at: self.clock.now(),
        });
        let revise = matches!(result.verdict, ReviewVerdict::Revise | ReviewVerdict::Reject) && !result.notes.trim().is_empty();
        Ok((revise && self.budget.reserve_review_round().is_ok()).then_some(result.notes))
    }

    /// هل رُفض شيء عند حدّ أمان أو سياسة أو بقرار إنسان؟ حينها لا يُعاد الوكيل إلى العمل لمخرَج غائب: الإعادة تدعو إلى طلب ما رُفض.
    fn loop_denied_by_boundary(&self) -> bool {
        self.probe.as_ref().is_some_and(|p| {
            let history = p.tool_history(&self.mission.mission_id);
            fulfilment::human_denied(&history) || fulfilment::boundary_denied(&history)
        })
    }

    /// يحسم ما انتهت إليه الحلقة: حالة الجذر وخطّته، والأدلّة المقيسة، والردّ، ثم الإنهاء المشترك.
    fn close_loop(&mut self, root: &str, end: LoopEnd, model: &dyn AgentModel, agent: Option<(String, &'static crate::p03::agents::AgentDefinition)>) {
        let waiting = !self.awaiting_approval.is_empty();
        // كشف التلاعب قبل أيّ حسم (ADR-041 §3.4): ملف محميّ تغيّر يرفض النتيجة مهما قال الوكيل.
        let tamper = if end.final_text.is_some() && end.stop.is_none() { self.check_tamper() } else { None };
        let end = match tamper {
            Some(detail) => LoopEnd { final_text: end.final_text, stop: Some(StopReason::TamperDetected(detail)) },
            None => end,
        };
        match (&end.final_text, &end.stop) {
            (Some(_), None) => {
                let _ = self.graph.set_state(root, TaskState::Succeeded);
                // ردّ نهائي بعد خطة: خطوة تركها الوكيل «جارية» أنهاها بردّه؛ تصير SUCCEEDED بقياس يخصّها وإلا UNVERIFIED_DONE.
                // «معلّقة» تبقى معلّقة كما قالها، ويغلقها مدقّق الثوابت حين تُحسم المهمّة.
                for id in self.loop_plan.clone() {
                    if self.graph.get(&id).is_some_and(|n| n.state == TaskState::Running) {
                        let state = self.done_state(&id);
                        let _ = self.graph.set_state(&id, state);
                    }
                }
            }
            (_, None) if waiting => {
                let _ = self.graph.set_state(root, TaskState::Waiting);
            }
            (_, Some(stop)) => {
                if !matches!(stop, StopReason::Cancelled) {
                    let _ = self.graph.set_state(root, TaskState::Failed);
                    self.task_failures.insert(root.to_string(), failure_text(stop));
                }
                self.halt_with(end.stop.clone().unwrap_or(StopReason::NoProgress));
            }
            (None, None) => {}
        }
        // الأدلّة المقيسة للجذر ولكل عقدة نُسبت إليها أدوات، من المنفذ الموثوق وحده.
        let ids: Vec<(String, TaskType)> = self.graph.nodes().map(|n| (n.task_id.clone(), n.task_type)).collect();
        for (id, kind) in ids {
            let _ = self.collect_trusted_evidence(&id, kind);
        }
        if let Some(text) = &end.final_text {
            let (answer, suggestions) = split_suggestions(text);
            self.task_outputs.insert(root.to_string(), answer.clone());
            if let Some(bounded) = bounded_answer(&answer) {
                self.mission.result_summary = Some(bounded);
            }
            if let (false, Some(observer)) = (suggestions.is_empty(), &self.observer) {
                observer.suggest(&self.mission.mission_id, &suggestions);
            }
        }
        // عنوان لم تسمّه الخطة: نداء صغير واحد، لطلب أطول من عنوان معقول.
        if self.reply_enabled && !self.loop_titled && !self.is_cancelled() && self.mission.objective.chars().count() > 40 && self.budget.reserve_model_call().is_ok() {
            let title = model.loop_title(&self.mission.objective);
            self.flush_chat_spans(model, title.as_ref().map(|(_, i, o)| (*i, *o)));
            match title {
                Some((title, input, output)) => {
                    let _ = self.budget.settle_model_call(input, output);
                    self.set_loop_title(title);
                }
                None => self.budget.abandon_model_call(),
            }
        }
        if let Some(observer) = &self.observer {
            let tool_calls = self.tool_decisions.len() as u32;
            observer.task_finished(&TaskOutcomeNote {
                mission_id: self.mission.mission_id.clone(),
                project_id: self.mission.project_id.clone(),
                task_id: root.to_string(),
                title: self.mission.title.clone(),
                task_type: TaskType::Build,
                state: self.graph.get(root).map(|n| n.state.as_str()).unwrap_or("UNKNOWN"),
                tool_calls,
            });
        }
        self.detect_conflicts();
        self.settle_requirements();
        self.settle_contract();
        // الإثبات من القياس (ADR-041 §3.3): متطلَّبات العقد وما سمّاه المستخدم نصًّا، كلٌّ بادّعاء يتحقّق بقياس يخصّه.
        if self.stop_reason.is_none() && end.final_text.is_some() {
            self.settle_measured_proof();
            if let Some(answer) = end.final_text.as_deref() {
                self.settle_citations(answer);
                self.settle_action_claims(answer);
            }
            // الوكيل المثبَّت يُصحَّح عقد مخرجاته بالمصحِّح المستقلّ، فيدخل حكمه الإثبات متطلَّبًا إلزاميًّا (القسم 6).
            if let Some((instance, definition)) = agent {
                let objective = self.mission.objective.clone();
                let _ = self.settle_agent_contract(&instance, definition, &objective);
            }
        }
        self.finalize();
    }
}

