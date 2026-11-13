// P08-CONVERSATION — المحادثة كما يراها المستخدم (بعد إغلاق Phase-08، ADR-029).
//
// ما قِيس على جهاز المالك (2026-09-30) وتقيسه هذه الاختبارات بعد الإصلاح:
// 1) «هلا» انتهت بتقرير خطوة بالإنجليزية بدل ردّ عليه ← خطوة ردّ تكتب للمستخدم ويُحفظ ردّها جوابًا.
// 2) المتابعة كانت مهمّة جديدة يُلصق السياق في رسالتها ← دور في المحادثة نفسها برسالة المستخدم كما كتبها،
//    يرث النموذج والمشروع ومساحة الملفات.
// 3) لا سرد حيّ (mission_events فارغ) ← الخطة والخطوات والأفعال وملاحظات الوكيل تُحفظ بترتيبها.
// النموذج هنا تجهيزة مُبرمَجة (TEST FIXTURE)، لا نموذج حقيقي.

mod p08_support;

use std::sync::{Arc, Mutex};

use p08_support::build;
use serde_json::json;

use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionState};
use polaris_host_core::p03::port::{
    AgentModel, MissionObserver, ModelError, NarrationKind, NarrationNote, PlanProposal, PlannedTask, ReplyInput, ReviewResult, TaskExecution,
};
use polaris_host_core::p03::runtime::MissionRuntime;
use polaris_host_core::p03::task::{DependencyKind, TaskType};
use polaris_host_core::p03::trust::AuthorityClass;

fn mission(objective: &str) -> Mission {
    Mission {
        mission_id: "11111111-1111-4111-8111-111111111111".into(),
        project_id: None,
        title: "هلا".into(),
        title_authority: AuthorityClass::DirectUserInstruction,
        objective: objective.into(),
        origin: MissionOrigin::User,
        execution_mode: ExecutionMode::SingleAgent,
        priority: MissionPriority::Normal,
        state: MissionState::Created,
        completion_proof_status: CompletionProofStatus::NotEvaluated,
        current_revision: 1,
        root_task_id: None,
        budget: MissionBudget::balanced(),
        requirements: Vec::new(),
        created_at: "2026-10-01T00:00:00Z".into(),
        started_at: None,
        completed_at: None,
        result_summary: None,
        failure_reason: None,
        version: 1,
    }
}

/// نموذج يكتب سطرًا للمستخدم مع الخطة ومع كل خطوة، ويعرف خطوة الردّ.
struct Talking {
    narration: Mutex<Option<String>>,
    replies: bool,
    reply_inputs: Mutex<Vec<ReplyInput>>,
}

impl Talking {
    fn new(replies: bool) -> Self {
        Self { narration: Mutex::new(None), replies, reply_inputs: Mutex::new(Vec::new()) }
    }
}

impl AgentModel for Talking {
    fn plan(&self, _objective: &str) -> Result<PlanProposal, ModelError> {
        *self.narration.lock().unwrap() = Some("سأرحّب بك ثم أعرض المساعدة.".into());
        Ok(PlanProposal {
            tasks: vec![PlannedTask {
                local_key: "greet".into(),
                title: "الترحيب".into(),
                objective: "Clarify Mission Objective".into(),
                task_type: TaskType::Research,
                depends_on: Vec::new(),
                dependency_kind: DependencyKind::RequiresSuccess,
                recommended_role: AgentRole::Researcher,
            }],
        })
    }
    fn execute(&self, _role: AgentRole, _task_type: TaskType, _objective: &str) -> Result<TaskExecution, ModelError> {
        *self.narration.lock().unwrap() = Some("رحّبتُ بالمستخدم.".into());
        Ok(TaskExecution {
            output_summary: "I asked the user in Arabic: 'ما المهمة التي تريد أن أخطط لها؟'".into(),
            claims: Vec::new(),
            evidence: Vec::new(),
            tool_requests: Vec::new(),
            delegation: None,
            input_tokens: 5,
            output_tokens: 5,
            failed: false,
        })
    }
    fn review(&self, _role: AgentRole, _target: &str) -> Result<ReviewResult, ModelError> {
        Err(ModelError::InvalidOutput("no review in this fixture".into()))
    }
    fn take_narration(&self, _objective: &str) -> Option<String> {
        self.narration.lock().unwrap().take()
    }
    fn take_title(&self, _objective: &str) -> Option<String> {
        Some("تحية قصيرة".into())
    }
    fn can_reply(&self) -> bool {
        self.replies
    }
    fn reply(&self, input: &ReplyInput) -> Result<(String, u64, u64), ModelError> {
        self.reply_inputs.lock().unwrap().push(input.clone());
        Ok(("أهلًا! كيف أقدر أساعدك اليوم؟".into(), 7, 9))
    }
}

#[derive(Default)]
struct Recorder {
    notes: Mutex<Vec<NarrationNote>>,
    thinking: Mutex<Vec<bool>>,
    titles: Mutex<Vec<String>>,
}

impl MissionObserver for Recorder {
    fn narrate(&self, note: &NarrationNote) {
        self.notes.lock().unwrap().push(note.clone());
    }
    fn thinking(&self, _mission_id: &str, active: bool) {
        self.thinking.lock().unwrap().push(active);
    }
    fn retitle(&self, _mission_id: &str, title: &str) {
        self.titles.lock().unwrap().push(title.to_string());
    }
}

#[test]
fn p08_conversation_a_conversation_mission_ends_with_a_reply_to_the_user_in_their_language() {
    let model = Talking::new(true);
    let mut rt = MissionRuntime::new(mission("هلا"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_reply();
    let report = rt.run(&model);
    assert_eq!(report.mission_state, MissionState::Completed);
    assert_eq!(rt.mission().result_summary.as_deref(), Some("أهلًا! كيف أقدر أساعدك اليوم؟"), "the user got a step report, not a reply");
    // خطوة الردّ ترى تقرير الخطوة ونتيجتها المقيسة، ولا تُحسب إلا نداءً واحدًا.
    let inputs = model.reply_inputs.lock().unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].outcome, "COMPLETED");
    assert!(inputs[0].reports[0].1.contains("I asked the user"));
    assert_eq!(report.model_calls, 3, "plan + step + reply");
}

#[test]
fn p08_conversation_without_a_conversation_the_closed_behaviour_is_unchanged() {
    // مهمّة ليست محادثة (مسارات Phase-03..07 وبواباتها): لا نداء ردّ، والجواب آخر تقرير خطوة كما كان.
    let model = Talking::new(true);
    let mut rt = MissionRuntime::new(mission("هلا"), RuntimeClock::deterministic(), AgentRegistry::builtin());
    let report = rt.run(&model);
    assert!(model.reply_inputs.lock().unwrap().is_empty());
    assert_eq!(report.model_calls, 2);
    assert!(rt.mission().result_summary.as_deref().unwrap_or_default().starts_with("I asked the user"));
    // ومنفذ لا يعرف الردّ لا يُحجز له نداء حتى في محادثة.
    let silent = Talking::new(false);
    let mut rt = MissionRuntime::new(mission("هلا"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_reply();
    assert_eq!(rt.run(&silent).model_calls, 2);
}

#[test]
fn p08_conversation_the_runtime_narrates_plan_step_and_note_and_signals_thinking() {
    let model = Talking::new(true);
    let recorder = Arc::new(Recorder::default());
    let mut rt = MissionRuntime::new(mission("هلا"), RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_reply()
        .with_observer(recorder.clone());
    rt.run(&model);
    let notes = recorder.notes.lock().unwrap();
    let kinds: Vec<NarrationKind> = notes.iter().map(|n| n.kind).collect();
    assert_eq!(kinds, vec![NarrationKind::Plan, NarrationKind::Step, NarrationKind::Note]);
    assert_eq!(notes[0].text, "سأرحّب بك ثم أعرض المساعدة.");
    assert_eq!(notes[1].text, "الترحيب");
    // «يفكّر» يبدأ وينتهي مع كل نداء: ثلاثة نداءات، ستّ إشارات متناوبة، والأخيرة إطفاء.
    let thinking = recorder.thinking.lock().unwrap();
    assert_eq!(*thinking, vec![true, false, true, false, true, false]);
    // عنوان المخطّط يحلّ محلّ «هلا» في المحادثة (قيس 2026-10-01: كل المهامّ في الشريط اسمها «هلا»).
    assert_eq!(*recorder.titles.lock().unwrap(), vec!["تحية قصيرة".to_string()]);
    assert_eq!(rt.mission().title, "تحية قصيرة");
    // ومهمّة ليست محادثة يبقى عنوانها كما سمّاه المستخدم.
    let plain = Arc::new(Recorder::default());
    let mut rt = MissionRuntime::new(mission("هلا"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_observer(plain.clone());
    rt.run(&model);
    assert!(plain.titles.lock().unwrap().is_empty());
    assert_eq!(rt.mission().title, "هلا");
}

#[test]
fn p08_conversation_the_proposed_title_names_the_conversation_and_never_a_follow_up() {
    let h = build(None);
    let created = h.ok("mission.create", json!({ "title": "هلا", "objective": "هلا" }));
    let first = created["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": first }));
    let p08 = h.host().phase08().unwrap();
    p08.conversations.retitle(&first, "تحية قصيرة");
    assert_eq!(h.ok("mission.get", json!({ "mission_id": first }))["mission"]["title"], "تحية قصيرة");
    let next = h.ok("conversation.continue", json!({ "mission_id": first, "message": "ما عاصمة اليابان؟" }));
    let second = next["mission_id"].as_str().unwrap().to_string();
    let before = h.ok("mission.get", json!({ "mission_id": second }))["mission"]["title"].clone();
    p08.conversations.retitle(&second, "عاصمة اليابان");
    assert_eq!(h.ok("mission.get", json!({ "mission_id": second }))["mission"]["title"], before);
    assert_eq!(h.ok("mission.get", json!({ "mission_id": first }))["mission"]["title"], "تحية قصيرة");
}

#[test]
fn p08_conversation_follow_up_is_a_turn_in_the_same_conversation_with_inherited_model_and_workspace() {
    let h = build(None);
    let created = h.ok("mission.create", json!({ "title": "هلا", "objective": "هلا", "budget_preset": "EXTENDED" }));
    let first = created["mission_id"].as_str().unwrap().to_string();
    h.ok("mission.model.set", json!({ "mission_id": first, "model_id": "lm-studio:qwen" }));
    let begun = h.ok("conversation.begin", json!({ "mission_id": first }));
    assert_eq!(begun["thread_id"], first.as_str());
    // متكرّر بلا أثر ثانٍ.
    assert_eq!(h.ok("conversation.begin", json!({ "mission_id": first }))["thread_id"], first.as_str());

    let next = h.ok("conversation.continue", json!({ "mission_id": first, "message": "اكمل" }));
    assert_eq!(next["thread_id"], first.as_str());
    assert_eq!(next["seq"], 1);
    let second = next["mission_id"].as_str().unwrap().to_string();
    assert_ne!(second, first);

    let p08 = h.host().phase08().unwrap();
    // النموذج موروث: رسالة المتابعة لا تحمل اختيارًا، فلا NO_MODEL_CONFIGURED.
    assert_eq!(p08.preferences.get(&second).and_then(|p| p.0).as_deref(), Some("lm-studio:qwen"));
    // مساحة الملفات مشتركة: ما كتبه الدور الأول يراه الثاني.
    assert_eq!(p08.workspaces.dir_of(&second), p08.workspaces.dir_of(&first));

    // المحادثة تُقرأ من أيّ دور فيها، والرسالة كما كتبها المستخدم (لا الهدف المركّب بسياقه).
    let view = h.ok("conversation.get", json!({ "mission_id": second }));
    let turns = view["conversation"]["turns"].as_array().unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0]["message"], "هلا");
    assert_eq!(turns[1]["message"], "اكمل");
    assert_eq!(turns[1]["state"], "CREATED");
    // هدف الدور الثاني رسالة المستخدم وحدها (خطة 2026-10-07، ADR-041): الأدوار السابقة يقرؤها الوكيل من سجلّ الجلسة.
    let objective = h.ok("mission.get", json!({ "mission_id": second }))["mission"]["objective"].as_str().unwrap().to_string();
    assert_eq!(objective, "اكمل");

    // الفهرس يسمّي المتابعة ومحادثتها، فتُعرض داخلها لا مهمّةً مستقلة.
    let index = h.ok("conversation.index", json!({}));
    assert!(index["follow_ups"].as_array().unwrap().iter().any(|f| f["mission_id"] == second.as_str() && f["thread_id"] == first.as_str()));

    // رسالة فارغة أو طويلة تُرفض بالعقد أو بالتحقّق، لا خطأً داخليًّا.
    let empty = h.err("conversation.continue", json!({ "mission_id": first, "message": "" }));
    assert_ne!(empty["code"], "INTERNAL_ERROR");
    let long = h.err("conversation.continue", json!({ "mission_id": first, "message": "x".repeat(6001) }));
    assert_ne!(long["code"], "INTERNAL_ERROR");
}

#[test]
fn p08_conversation_narration_is_stored_in_order_and_read_back_with_the_conversation() {
    let h = build(None);
    let created = h.ok("mission.create", json!({ "title": "t", "objective": "اكتب ملخصًا" }));
    let id = created["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let p08 = h.host().phase08().unwrap();
    let note = |kind, text: &str, detail: Option<&str>| NarrationNote { mission_id: id.clone(), kind, text: text.into(), detail: detail.map(str::to_string) };
    p08.conversations.narrate(&note(NarrationKind::Plan, "سأبحث ثم أكتب الملف.", None));
    p08.conversations.narrate(&note(NarrationKind::Step, "البحث", None));
    p08.conversations.narrate(&note(NarrationKind::Action, "polaris.web.navigate {\"url\":\"https://nodejs.org\"}", Some("SUCCEEDED")));
    p08.conversations.thinking(&id, true);
    let view = h.ok("conversation.get", json!({ "mission_id": id }));
    let entries = view["conversation"]["entries"].as_array().unwrap();
    let kinds: Vec<&str> = entries.iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, vec!["PLAN", "STEP", "ACTION"]);
    assert_eq!(entries[2]["detail"], "SUCCEEDED");
    assert_eq!(view["conversation"]["thinking"], true);
    p08.conversations.thinking(&id, false);
    assert_eq!(h.ok("conversation.get", json!({ "mission_id": id }))["conversation"]["thinking"], false);
}

#[test]
fn p08_conversation_a_started_mission_is_seen_running_before_its_run_ends() {
    // قِيس 2026-10-01: المهمّة كانت تبقى CREATED في القاعدة طوال عمل النموذج، فتقول الشاشة «لم تبدأ».
    let h = build(None);
    let created = h.ok("mission.create", json!({ "title": "t", "objective": "o" }));
    let id = created["mission_id"].as_str().unwrap().to_string();
    let p03 = h.host().phase03().unwrap();
    assert!(p03.repository.mark_started(&id, "2026-10-01T00:00:00Z").unwrap());
    let got = h.ok("mission.get", json!({ "mission_id": id }));
    assert_eq!(got["mission"]["state"], "PLANNING");
    assert_eq!(got["mission"]["started_at"], "2026-10-01T00:00:00Z");
    // لا يمسّ مهمّة ليست CREATED.
    assert!(!p03.repository.mark_started(&id, "2026-10-01T00:00:09Z").unwrap());
}

#[test]
fn p08_conversation_a_completed_mission_puts_its_outputs_in_the_library_once() {
    // قِيس 2026-10-01: الوكيل كتب outputs/water.md والمكتبة قالت «لا مخرجات بعد».
    use polaris_host_core::p03::port::MissionOutcomeNote;
    let h = build(None);
    let created = h.ok("mission.create", json!({ "title": "ماء", "objective": "اكتب ملفًّا عن فوائد الماء" }));
    let id = created["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let p08 = h.host().phase08().unwrap();
    let workspace = p08.workspaces.for_mission(&id).unwrap();
    workspace.write("outputs/water.md", "# فوائد الماء\n\nالماء يحفظ توازن الجسم.\n".as_bytes()).unwrap();
    workspace.write("outputs/site/index.html", b"<!doctype html><html><head><title>t</title></head><body>ok</body></html>").unwrap();
    workspace.write("outputs/site/style.css", b"body{margin:0}").unwrap();
    workspace.write("work/draft.md", b"draft").unwrap();
    let note = |mission: &str, state: &'static str, terminal: bool| MissionOutcomeNote {
        mission_id: mission.to_string(),
        project_id: None,
        title: "t".into(),
        state,
        terminal,
        proof_status: "UNPROVEN",
        tasks_succeeded: 1,
        tasks_failed: 0,
        tasks_blocked: 0,
        tool_calls_executed: 1,
        claims: Vec::new(),
        tool_history: Vec::new(),
    };
    // مهمّة فشلت أو لم تنتهِ: لا تسجيل.
    p08.observer.mission_finished(&note(&id, "FAILED", true));
    p08.observer.mission_finished(&note(&id, "WAITING_FOR_APPROVAL", false));
    assert_eq!(h.ok("artifact.list", json!({}))["artifacts"].as_array().unwrap().len(), 0);

    p08.observer.mission_finished(&note(&id, "COMPLETED", true));
    let listed = h.ok("artifact.list", json!({}));
    let refs: Vec<&str> = listed["artifacts"].as_array().unwrap().iter().map(|a| a["file_ref"].as_str().unwrap()).collect();
    assert!(refs.contains(&"outputs/water.md"), "{refs:?}");
    // الموقع مخرج واحد لا ملفات متفرقة، والمسودة خارج outputs/ لا تُسجَّل.
    assert!(refs.contains(&"outputs/site"), "{refs:?}");
    assert!(!refs.iter().any(|r| r.ends_with("style.css") || r.ends_with("index.html") || r.starts_with("work/")), "{refs:?}");
    let count = refs.len();

    // دور المتابعة يشارك المساحة: الملف نفسه بالمحتوى نفسه لا يُسجَّل مرّة ثانية.
    let next = h.ok("conversation.continue", json!({ "mission_id": id, "message": "شكرًا" }));
    let second = next["mission_id"].as_str().unwrap().to_string();
    p08.observer.mission_finished(&note(&second, "COMPLETED", true));
    p08.observer.mission_finished(&note(&id, "COMPLETED", true));
    assert_eq!(h.ok("artifact.list", json!({}))["artifacts"].as_array().unwrap().len(), count);
}

/// نموذج يسجّل ما عرضه عليه زمن التشغيل من متخصّصين وما أعطاه من تعليمات.
#[derive(Default)]
struct Specialised {
    offered: Mutex<Vec<String>>,
    briefs: Mutex<Vec<String>>,
}

impl AgentModel for Specialised {
    fn plan(&self, _objective: &str) -> Result<PlanProposal, ModelError> {
        Ok(PlanProposal {
            tasks: vec![PlannedTask {
                local_key: "analyse".into(),
                title: "تحليل القوائم".into(),
                objective: "Analyse the company's financial statements and profitability ratios".into(),
                task_type: TaskType::Research,
                depends_on: Vec::new(),
                dependency_kind: DependencyKind::RequiresSuccess,
                recommended_role: AgentRole::Researcher,
            }],
        })
    }
    fn execute(&self, _role: AgentRole, _task_type: TaskType, _objective: &str) -> Result<TaskExecution, ModelError> {
        Ok(TaskExecution { output_summary: "done".into(), claims: Vec::new(), evidence: Vec::new(), tool_requests: Vec::new(), delegation: None, input_tokens: 1, output_tokens: 1, failed: false })
    }
    fn review(&self, _role: AgentRole, _target: &str) -> Result<ReviewResult, ModelError> {
        Err(ModelError::InvalidOutput("no review".into()))
    }
    fn offer_specialists(&self, shortlist: &[(String, String)]) {
        self.offered.lock().unwrap().extend(shortlist.iter().map(|(id, _)| id.clone()));
    }
    fn brief(&self, _objective: &str, brief: &str) {
        self.briefs.lock().unwrap().push(brief.to_string());
    }
}

#[test]
fn p08_conversation_a_specialist_is_offered_chosen_briefed_and_named_in_the_step() {
    use polaris_host_core::p03::specialist::SpecialistCatalog;
    let catalog = SpecialistCatalog::builtin();
    // محادثة بلا تثبيت: يُعرض على المخطّط ما يناسب الطلب، ويختار زمن التشغيل للعقدة، ويُسرد معرّفه.
    let model = Specialised::default();
    let recorder = Arc::new(Recorder::default());
    let mut rt = MissionRuntime::new(mission("حلّل القوائم المالية للشركة واحسب نسب الربحية"), RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_specialists(catalog, None)
        .with_observer(recorder.clone());
    rt.run(&model);
    assert!(model.offered.lock().unwrap().contains(&"finance.financial-analyst".to_string()), "the planner was not offered the analyst");
    let briefs = model.briefs.lock().unwrap();
    assert_eq!(briefs.len(), 1);
    assert!(briefs[0].contains("Financial analyst") && briefs[0].contains("Before you report, make sure that:"));
    let step = recorder.notes.lock().unwrap().iter().find(|n| n.kind == NarrationKind::Step).cloned().unwrap();
    assert_eq!(step.detail.as_deref(), Some("finance.financial-analyst"));
    drop(briefs);

    // متخصّص ثبّته المستخدم يحلّ محلّ الاختيار، ولا تُعرض قائمة.
    let model = Specialised::default();
    let mut rt = MissionRuntime::new(mission("حلّل القوائم المالية للشركة"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_specialists(catalog, Some("writing.poet".into()));
    rt.run(&model);
    assert!(model.offered.lock().unwrap().is_empty());
    assert!(model.briefs.lock().unwrap()[0].contains("Poet"));

    // معرّف مثبَّت مجهول يُهمل، والمسار المغلق (بلا كتالوج) لا يرى قائمة ولا تعليمات.
    let model = Specialised::default();
    let mut rt = MissionRuntime::new(mission("حلّل القوائم المالية للشركة"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_specialists(catalog, Some("made.up".into()));
    rt.run(&model);
    assert!(model.briefs.lock().unwrap()[0].contains("Financial analyst"));
    let model = Specialised::default();
    let recorder = Arc::new(Recorder::default());
    let mut rt = MissionRuntime::new(mission("حلّل القوائم المالية للشركة"), RuntimeClock::deterministic(), AgentRegistry::builtin()).with_observer(recorder.clone());
    rt.run(&model);
    assert!(model.offered.lock().unwrap().is_empty() && model.briefs.lock().unwrap().is_empty());
    assert!(recorder.notes.lock().unwrap().iter().all(|n| n.detail.is_none() || n.kind != NarrationKind::Step));
}

#[test]
fn p08_conversation_the_catalog_is_readable_and_a_pinned_specialist_follows_the_conversation() {
    let h = build(None);
    let catalog = h.ok("agent.catalog", json!({}));
    assert_eq!(catalog["domains"].as_array().unwrap().len(), 20);
    let specialists = catalog["specialists"].as_array().unwrap();
    assert_eq!(specialists.len(), 300);
    // تعليمات العمل للموجّه وحده: لا تعبر إلى العارض.
    assert!(specialists.iter().all(|s| s.get("expertise").is_none() && s.get("checks").is_none() && s.get("keywords").is_none()));

    let created = h.ok("mission.create", json!({ "title": "t", "objective": "حلل الميزانية" }));
    let id = created["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let bad = h.err("mission.specialist.set", json!({ "mission_id": id, "specialist_id": "made.up" }));
    assert_ne!(bad["code"], "INTERNAL_ERROR");
    h.ok("mission.specialist.set", json!({ "mission_id": id, "specialist_id": "finance.financial-analyst" }));
    let view = h.ok("conversation.get", json!({ "mission_id": id }));
    assert_eq!(view["conversation"]["turns"][0]["specialist_id"], "finance.financial-analyst");
    let next = h.ok("conversation.continue", json!({ "mission_id": id, "message": "والسنة الماضية؟" }));
    let second = next["mission_id"].as_str().unwrap().to_string();
    let view = h.ok("conversation.get", json!({ "mission_id": second }));
    assert_eq!(view["conversation"]["turns"][1]["specialist_id"], "finance.financial-analyst", "the follow-up lost the pinned specialist");
    // إزالة التثبيت.
    h.ok("mission.specialist.set", json!({ "mission_id": id, "specialist_id": null }));
    assert!(h.ok("conversation.get", json!({ "mission_id": id }))["conversation"]["turns"][0].get("specialist_id").is_none());
}

/// قائمة «⋯» (ADR-031): قِيس 2026-10-01 أن إعادة التسمية والأرشفة والحذف والنقل إلى مشروع لم تكن موجودة
/// في المضيف أصلًا. هنا تُطبَّق على المحادثة كلّها (الدور الأول ومتابعاته)، والحذف لا يترك أثرًا.
#[test]
fn p08_conversation_the_task_menu_renames_pins_archives_moves_and_deletes_the_whole_conversation() {
    let h = build(None);
    let created = h.ok("mission.create", json!({ "title": "هلا", "objective": "هلا" }));
    let first = created["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": first }));
    let second = h.ok("conversation.continue", json!({ "mission_id": first, "message": "اكمل" }))["mission_id"].as_str().unwrap().to_string();
    let p08 = h.host().phase08().unwrap();
    let workspace = p08.workspaces.for_mission(&first).unwrap();
    workspace.write("outputs/note.md", "ملاحظة".as_bytes()).unwrap();
    let folder = p08.workspaces.dir_of(&first);
    assert!(folder.is_dir());

    // إعادة التسمية تُطبَّق على كل الأدوار، ولا يستبدلها عنوان يقترحه المخطّط بعد ذلك.
    let renamed = h.ok("conversation.update", json!({ "thread_id": first, "title": "  تحية   قصيرة " }));
    assert_eq!(renamed["thread"]["title"], "تحية قصيرة");
    for id in [&first, &second] {
        assert_eq!(h.ok("mission.get", json!({ "mission_id": id }))["mission"]["title"], "تحية قصيرة");
    }
    p08.conversations.retitle(&first, "عنوان من المخطّط");
    assert_eq!(h.ok("mission.get", json!({ "mission_id": first }))["mission"]["title"], "تحية قصيرة");
    // عنوان فارغ يُرفض عند البوابة أو بالتحقّق، لا خطأً داخليًّا.
    let blank = h.err("conversation.update", json!({ "thread_id": first, "title": "   " }));
    assert_ne!(blank["code"], "INTERNAL_ERROR");

    // تثبيت ومفضّلة وأرشفة تظهر في الفهرس. التغيير من دور متابعة يصيب المحادثة نفسها.
    h.ok("conversation.update", json!({ "thread_id": second, "pinned": true, "favorite": true }));
    h.ok("conversation.update", json!({ "thread_id": first, "archived": true }));
    let index = h.ok("conversation.index", json!({}));
    let state = index["threads"].as_array().unwrap().iter().find(|t| t["thread_id"] == first.as_str()).cloned().unwrap();
    assert_eq!((state["pinned"].as_bool(), state["favorite"].as_bool(), state["archived"].as_bool()), (Some(true), Some(true), Some(true)));
    h.ok("conversation.update", json!({ "thread_id": first, "archived": false, "pinned": false }));

    // النقل إلى مشروع يصيب كل الأدوار، والمتابعة التالية ترثه. ومشروع غير موجود يُرفض.
    let project = h.ok("project.create", json!({ "name": "NEXUS" }))["project"]["project_id"].as_str().unwrap().to_string();
    let moved = h.ok("conversation.update", json!({ "thread_id": first, "project_id": project }));
    assert_eq!(moved["thread"]["project_id"], project.as_str());
    assert_eq!(h.ok("mission.get", json!({ "mission_id": second }))["mission"]["project_id"], project.as_str());
    let missing = h.err("conversation.update", json!({ "thread_id": first, "project_id": "00000000-0000-4000-8000-000000000000" }));
    assert_eq!(missing["code"], "VALIDATION_ERROR");

    // دورٌ يعمل: لا حذف للمحادثة ولا لمشروعها.
    let db = rusqlite::Connection::open(h.data_dir.join("polaris.db")).unwrap();
    db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
    let conn_state = |state: &str| {
        db.execute("UPDATE missions SET state = ?2 WHERE mission_id = ?1", rusqlite::params![second, state]).unwrap();
    };
    conn_state("RUNNING");
    assert_eq!(h.err("conversation.delete", json!({ "thread_id": first }))["code"], "CONFLICT");
    assert_eq!(h.err("project.delete", json!({ "project_id": project }))["code"], "CONFLICT");
    conn_state("COMPLETED");

    // حذف المشروع لا يحذف محادثاته: تخرج منه.
    let gone = h.ok("project.delete", json!({ "project_id": project }));
    assert_eq!(gone["detached_missions"], 2);
    assert!(h.ok("mission.get", json!({ "mission_id": first }))["mission"]["project_id"].is_null());

    // الحذف حقيقي: لا مهمّة ولا دور ولا سرد ولا حالة ولا مجلّد.
    let deleted = h.ok("conversation.delete", json!({ "thread_id": second }));
    assert_eq!((deleted["thread_id"].as_str(), deleted["turns"].as_u64()), (Some(first.as_str()), Some(2)));
    for id in [&first, &second] {
        assert_ne!(h.call("mission.get", json!({ "mission_id": id }))["ok"], true);
    }
    let left: i64 = db
        .query_row(
            "SELECT (SELECT count(*) FROM p08_conversation_turns) + (SELECT count(*) FROM p08_conversation_entries) + (SELECT count(*) FROM p08_conversation_state) + (SELECT count(*) FROM tasks) + (SELECT count(*) FROM p08_mission_preferences)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(left, 0);
    assert!(!folder.exists(), "the workspace folder outlived its conversation");
    assert!(h.ok("conversation.index", json!({}))["threads"].as_array().unwrap().is_empty());
    // والحذف مسجَّل في سلسلة التدقيق بلا عنوان.
    let audit: String = db.query_row("SELECT detail_json FROM audit_events WHERE event_type = 'CONVERSATION_DELETED'", [], |r| r.get(0)).unwrap();
    assert!(!audit.contains("تحية"));
    // حذف ثانٍ: المحادثة لم تعد موجودة.
    assert_eq!(h.err("conversation.delete", json!({ "thread_id": first }))["code"], "VALIDATION_ERROR");
}

/// «تذكّر هذا» (ADR-032): قِيس 2026-10-01 أن ذاكرة المالك الحقيقية فيها 12 سجلًّا آليًّا ولا شيء عنه. هنا نصّ
/// يكتبه المستخدم يُحفظ عنه أو عن مشروع، بمصدره الحقيقي، ويمرّ بسياسة الذاكرة نفسها.
#[test]
fn p08_conversation_remember_this_stores_what_the_user_wrote_under_the_same_memory_policy() {
    let h = build(None);
    let saved = h.ok("memory.remember", json!({ "text": "I live in Riyadh and prefer short replies.", "scope": "USER" }));
    assert_eq!(saved["decision"], "PROMOTED");
    let id = saved["memory_id"].as_str().unwrap().to_string();
    let listed = h.ok("memory.list", json!({ "scope": "USER" }));
    let row = listed["memories"].as_array().unwrap().iter().find(|m| m["memory_id"] == id.as_str()).cloned().expect("the memory is not listed");
    // مصدره المستخدم، غير محقَّق، ولا يُرفع إلى سلطة.
    assert_eq!(row["trust_class"], "USER_DERIVED");
    assert_eq!(row["verification"], "UNVERIFIED");
    assert_eq!(row["confidence_source"], "USER_APPROVED_WRITE");

    // التكرار الحرفي لا يُكتب مرّتين، وما يشبه السرّ يُرفض ولا يُحفظ نصّه.
    assert_eq!(h.ok("memory.remember", json!({ "text": "I live in Riyadh and prefer short replies.", "scope": "USER" }))["decision"], "DUPLICATE");
    let secret = h.ok("memory.remember", json!({ "text": "my api key is sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c", "scope": "USER" }));
    assert_eq!(secret["decision"], "REJECTED");
    assert!(secret["memory_id"].is_null());

    // ذاكرة مشروع تحتاج مشروعًا نشطًا.
    assert_eq!(h.err("memory.remember", json!({ "text": "Deadline is Thursday.", "scope": "PROJECT" }))["code"], "VALIDATION_ERROR");
    let project = h.ok("project.create", json!({ "name": "NEXUS" }))["project"]["project_id"].as_str().unwrap().to_string();
    let in_project = h.ok("memory.remember", json!({ "text": "Deadline is Thursday.", "scope": "PROJECT", "project_id": project }));
    assert_eq!(in_project["decision"], "PROMOTED");
    // حذف المشروع يحذف ذاكرته.
    h.ok("project.delete", json!({ "project_id": project }));
    let left = h.ok("memory.list", json!({ "scope": "PROJECT" }));
    assert!(left["memories"].as_array().unwrap().iter().all(|m| m["status"] != "ACTIVE"), "project memory outlived its project");
}

/// أسئلة المتابعة (كما في مانوس): ردّ المهمّة يقترحها، وتُحفظ في سرد الدور بصنف SUGGESTION، ولا تُنفَّذ.
#[test]
fn p08_conversation_follow_up_suggestions_are_stored_with_the_turn_and_read_back() {
    let h = build(None);
    let id = h.ok("mission.create", json!({ "title": "اليابان", "objective": "ما عاصمة اليابان؟" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let p08 = h.host().phase08().unwrap();
    p08.conversations.suggest(&id, &["ما عدد سكانها؟".to_string(), "اعرض خريطة".to_string()]);
    // مهمّة ليست محادثة: لا يُحفظ لها شيء.
    p08.conversations.suggest("00000000-0000-4000-8000-000000000000", &["x x x".to_string()]);
    let view = h.ok("conversation.get", json!({ "mission_id": id }));
    let kinds: Vec<(String, String)> = view["conversation"]["entries"].as_array().unwrap().iter().map(|e| (e["kind"].as_str().unwrap().to_string(), e["text"].as_str().unwrap().to_string())).collect();
    assert_eq!(kinds, vec![("SUGGESTION".to_string(), "ما عدد سكانها؟".to_string()), ("SUGGESTION".to_string(), "اعرض خريطة".to_string())]);
}

/// نموذج يسمّي متخصّصًا لم يُعرض عليه (كما فعل النموذج الحقيقي لـ«هلا» في 2026-10-01).
struct Overreaching;

impl AgentModel for Overreaching {
    fn plan(&self, _objective: &str) -> Result<PlanProposal, ModelError> {
        Ok(PlanProposal {
            tasks: vec![PlannedTask {
                local_key: "greet".into(),
                title: "الرد على التحية".into(),
                objective: "Reply to the user's greeting".into(),
                task_type: TaskType::Synthesize,
                depends_on: Vec::new(),
                dependency_kind: DependencyKind::RequiresSuccess,
                recommended_role: AgentRole::Builder,
            }],
        })
    }
    fn execute(&self, _role: AgentRole, _task_type: TaskType, _objective: &str) -> Result<TaskExecution, ModelError> {
        Ok(TaskExecution { output_summary: "done".into(), claims: Vec::new(), evidence: Vec::new(), tool_requests: Vec::new(), delegation: None, input_tokens: 1, output_tokens: 1, failed: false })
    }
    fn review(&self, _role: AgentRole, _target: &str) -> Result<ReviewResult, ModelError> {
        Err(ModelError::InvalidOutput("no review".into()))
    }
    fn specialist_hint(&self, _objective: &str) -> Option<String> {
        Some("writing.business-writer".into())
    }
}

#[test]
fn p08_conversation_a_specialist_the_planner_was_not_offered_is_refused() {
    let recorder = Arc::new(Recorder::default());
    let mut rt = MissionRuntime::new(mission("هلا"), RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_specialists(polaris_host_core::p03::specialist::SpecialistCatalog::builtin(), None)
        .with_observer(recorder.clone());
    rt.run(&Overreaching);
    let step = recorder.notes.lock().unwrap().iter().find(|n| n.kind == NarrationKind::Step).cloned().unwrap();
    assert_eq!(step.detail, None, "a greeting step took a specialist nobody offered");
}

/// البحث (كما في مانوس): في العنوان والرسائل والأجوبة، بلا اعتبار لفروق الإملاء، بمقطع من النصّ الأصلي.
#[test]
fn p08_conversation_search_finds_messages_and_replies_across_arabic_spelling_variants() {
    let h = build(None);
    let id = h.ok("mission.create", json!({ "title": "سؤال", "objective": "ما هي المدينة الأكبر في اليابان؟" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let other = h.ok("mission.create", json!({ "title": "طقس", "objective": "كيف الطقس اليوم؟" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": other }));

    // «المدينه» بهاء تطابق «المدينة» بتاء مربوطة، والمقطع من النصّ كما كُتب.
    let found = h.ok("conversation.search", json!({ "query": "المدينه" }));
    let results = found["results"].as_array().unwrap();
    assert_eq!(results.len(), 1, "{found}");
    assert_eq!(results[0]["thread_id"], id.as_str());
    assert!(results[0]["snippet"].as_str().unwrap().contains("المدينة"));
    // العنوان يطابق كذلك، وطلب بلا نتيجة يعيد قائمة فارغة لا خطأ.
    assert_eq!(h.ok("conversation.search", json!({ "query": "طقس" }))["results"][0]["thread_id"], other.as_str());
    assert!(h.ok("conversation.search", json!({ "query": "zzzz" }))["results"].as_array().unwrap().is_empty());
    // طلب فارغ: أحدث المحادثات.
    assert_eq!(h.ok("conversation.search", json!({}))["results"].as_array().unwrap().len(), 2);
}
