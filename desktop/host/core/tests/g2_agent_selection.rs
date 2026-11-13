// G2 (تكليف 2026-10-14): المنسّق يختار الوكيل بنفسه من قائمة قصيرة يعرضها المضيف، والمضيف يتحقّق أن المختار منها ويسجّل
// القائمة والاختيار. ودرس X-16: لا سلوك يُطلقه نصّ لا يظهر إلا في حالات التقييم (معرّف وكيل أو مسار `outputs/agents/...`).
// TEST FIXTURE: النموذج مُبرمَج ويختار من القائمة كما يراها.

mod s2_support;

use std::sync::Arc;

use serde_json::{json, Value};

use polaris_host_core::p03::agents::memory::MemoryAgentMemory;
use polaris_host_core::p03::agents::AgentDirectory;
use polaris_host_core::p03::message::MessageType;
use polaris_host_core::p03::runtime::MissionRuntime;
use polaris_host_core::p03::specialist::SpecialistCatalog;
use s2_support::{calls, ok, text, LoopModel, World};

fn runtime(world: &World, objective: &str) -> MissionRuntime {
    world
        .runtime(objective, ok)
        .with_specialists(SpecialistCatalog::builtin(), None)
        .with_agents(AgentDirectory::builtin())
        .with_agent_memory(Arc::new(MemoryAgentMemory::default()))
}

/// معرّفات المرشحين كما رآها النموذج في تعليمة النظام.
fn shown_candidates(system: &str) -> Vec<String> {
    let Some(start) = system.find("<candidate_agents>") else { return Vec::new() };
    let end = system[start..].find("</candidate_agents>").map(|e| start + e).unwrap_or(system.len());
    system[start..end].lines().filter_map(|l| l.trim().strip_prefix("- ")).filter_map(|l| l.split_whitespace().next()).filter(|id| id.starts_with("agent.")).map(str::to_string).collect()
}

#[test]
fn g2_a_natural_request_shows_candidates_and_the_coordinator_delegates_to_one_it_was_shown() {
    let world = World::new();
    let objective = "حلّل القوائم المالية للشركة واحسب نسب الربحية";
    let chosen = Arc::new(std::sync::Mutex::new(String::new()));
    let (pick, pick_report) = (chosen.clone(), chosen.clone());
    // النموذج يختار أول مرشح رآه (يلتقطه `CandidateProbe` من تعليمة النظام قبل أول دور)، والمساعد يكتب تقرير عقده.
    let model = LoopModel::native()
        .then(move |_| Ok(calls(&[("delegate_task", json!({ "objective": "Analyse the financial statements and compute profitability ratios.", "agent_id": pick.lock().unwrap().clone() }))])))
        .then(move |_| {
            let d = AgentDirectory::builtin().get(&pick_report.lock().unwrap()).unwrap();
            Ok(calls(&[("write_file", json!({ "path": d.output.report_path, "content": polaris_host_core::p03::agents::grader::conforming_report(d, "ok.") }))]))
        })
        .then(|_| Ok(text("Report written.")))
        .then(|_| Ok(text("The specialist finished.")));
    let mut rt = runtime(&world, objective);
    let probe = CandidateProbe { inner: model, chosen };
    let report = rt.run(&probe);
    let seen = probe.inner.seen();
    let shown = shown_candidates(&seen[0].system);
    assert!(!shown.is_empty() && shown.len() <= 5, "the coordinator saw {} candidates", shown.len());
    assert!(shown.iter().any(|id| id.starts_with("agent.finance.")), "no finance agent among {shown:?}");
    assert_eq!(report.delegations_executed, 1, "{report:?}");
    let picked = probe.chosen.lock().unwrap().clone();
    assert_eq!(picked, shown[0]);
    assert!(rt.messages().iter().any(|m| m.message_type == MessageType::DelegationRequest && m.payload.starts_with(&format!("[AGENT_REQUEST to {picked} v"))));
    let selections = rt.agent_selections();
    assert_eq!(selections.len(), 1);
    assert_eq!(selections[0].offered, shown);
    assert_eq!(selections[0].chosen.as_deref(), Some(picked.as_str()));
    assert!(selections[0].accepted);
}

/// CP-09-1 (تشغيل Bonsai 2، 2026-10-21): مهمّتان سُجّلتا PROVEN ومتطلَّباهما الوحيدان أن الوكيلين المفوَّض إليهما كتبا تقريرَي
/// عقدهما؛ الملف الذي طلبه المستخدم لم يدخل الإثبات. متطلَّبات الوكلاء يضيفها المضيف، فلا تُعدّ متطلَّبات أعلنها المستخدم تُسقط
/// قياس عقد الطلب. هنا المساعد يكتب تقريره والملف المطلوب: وجود الملف وصيغته لا يثبتان محتواه، فالمهمّة غير مُثبَتة وعقد الطلب في متطلَّباتها.
#[test]
fn cp09_a_delegated_agent_contract_alone_never_proves_the_users_request() {
    let world = World::new();
    let objective = "Write outputs/finance.docx with an analysis of the company's financial statements and its profitability ratios";
    let chosen = Arc::new(std::sync::Mutex::new(String::new()));
    let (pick, pick_report) = (chosen.clone(), chosen.clone());
    let model = LoopModel::native()
        .then(move |_| Ok(calls(&[("delegate_task", json!({ "objective": "Analyse the financial statements and compute profitability ratios.", "agent_id": pick.lock().unwrap().clone() }))])))
        .then(move |_| {
            let d = AgentDirectory::builtin().get(&pick_report.lock().unwrap()).unwrap();
            Ok(calls(&[
                ("write_file", json!({ "path": "outputs/finance.docx", "content": "ratios" })),
                ("write_file", json!({ "path": d.output.report_path, "content": polaris_host_core::p03::agents::grader::conforming_report(d, "ok.") })),
            ]))
        })
        .then(|_| Ok(text("Report written.")))
        .then(|_| Ok(text("The analysis is ready in outputs/finance.docx.")));
    let mut rt = runtime(&world, objective);
    let probe = CandidateProbe { inner: model, chosen };
    let report = rt.run(&probe);
    assert_eq!(report.delegations_executed, 1, "{report:?}");
    let ids: Vec<String> = rt.mission().requirements.iter().map(|r| r.requirement_id.clone()).collect();
    assert!(ids.iter().any(|id| id.starts_with("AGENT-")), "the agent contract was not graded: {ids:?}");
    assert!(ids.iter().any(|id| !id.starts_with("AGENT-")), "the user's request never entered the proof: {ids:?}");
    assert_ne!(rt.mission().completion_proof_status, polaris_host_core::p03::mission::CompletionProofStatus::Proven, "the mission was proven without the requested file: {ids:?}");
}

/// يمرّر النداءات إلى النموذج المُبرمَج، ويلتقط أول مرشح من تعليمة النظام قبل أول دور.
struct CandidateProbe {
    inner: LoopModel,
    chosen: Arc<std::sync::Mutex<String>>,
}

impl polaris_host_core::p03::port::AgentModel for CandidateProbe {
    fn plan(&self, o: &str) -> Result<polaris_host_core::p03::port::PlanProposal, polaris_host_core::p03::port::ModelError> {
        self.inner.plan(o)
    }
    fn execute(&self, r: polaris_host_core::p03::agent::AgentRole, t: polaris_host_core::p03::task::TaskType, o: &str) -> Result<polaris_host_core::p03::port::TaskExecution, polaris_host_core::p03::port::ModelError> {
        self.inner.execute(r, t, o)
    }
    fn review(&self, r: polaris_host_core::p03::agent::AgentRole, t: &str) -> Result<polaris_host_core::p03::port::ReviewResult, polaris_host_core::p03::port::ModelError> {
        self.inner.review(r, t)
    }
    fn loop_mode(&self) -> Option<polaris_host_core::p03::agent_loop::LoopMode> {
        self.inner.loop_mode()
    }
    fn loop_turn(&self, system: &str, messages: &[polaris_host_providers::domain::ChatMessage], tools: &[polaris_host_providers::domain::ToolOffer]) -> Result<polaris_host_core::p03::port::LoopTurn, polaris_host_core::p03::port::ModelError> {
        if let Some(first) = shown_candidates(system).first() {
            let mut chosen = self.chosen.lock().unwrap();
            if chosen.is_empty() {
                *chosen = first.clone();
            }
        }
        self.inner.loop_turn(system, messages, tools)
    }
}

#[test]
fn g2_an_agent_the_coordinator_was_not_shown_is_refused_and_recorded() {
    let world = World::new();
    let objective = "حلّل القوائم المالية للشركة واحسب نسب الربحية";
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("delegate_task", json!({ "objective": "Write a poem.", "agent_id": "agent.writing.poet" }))])))
        .then(|_| Ok(text("I will do it myself.")));
    let mut rt = runtime(&world, objective);
    let report = rt.run(&model);
    let shown = shown_candidates(&model.seen()[0].system);
    assert!(!shown.contains(&"agent.writing.poet".to_string()), "the test premise is wrong: {shown:?}");
    assert_eq!(report.delegations_executed, 0);
    let result: String = model.seen()[1].messages.iter().map(|m| m.text.clone()).collect::<Vec<_>>().join("\n");
    assert!(result.contains("AGENT_NOT_OFFERED"), "{result}");
    assert!(rt.agents().iter().all(|a| a.definition.as_ref().map(|d| d.0.as_str()) != Some("agent.writing.poet")));
    let selections = rt.agent_selections();
    assert_eq!(selections.len(), 1);
    assert_eq!(selections[0].chosen.as_deref(), Some("agent.writing.poet"));
    assert!(!selections[0].accepted);
}

/// درس X-16: نصّ لا يظهر إلا في حالات التقييم (مسار مُخرَج الوكيل ومعرّفه) لا يُطلق توجيهًا حتميًّا ولا تفويضًا لم يطلبه النموذج.
#[test]
fn g2_text_only_eval_cases_carry_routes_nothing_by_itself() {
    let world = World::new();
    let d = &AgentDirectory::builtin().definitions()[0];
    let objective = format!("Read inputs/agents/x/brief.txt, then write {} for {}.", d.output.report_path, d.agent_id);
    let model = LoopModel::native().then(|_| Ok(text("Nothing to do.")));
    let mut rt = runtime(&world, &objective);
    let report = rt.run(&model);
    assert_eq!(report.delegations_executed, 0, "the host delegated on its own: {report:?}");
    let first = &model.seen()[0];
    assert!(first.system.contains("You are POLARIS"), "the first model call was not the coordinator's");
    let all: String = first.messages.iter().map(|m| m.text.clone()).collect();
    assert!(!all.contains("routed this request") && !first.system.contains("<specialist_agent>"));
}

#[test]
fn g2_small_talk_shows_no_candidates() {
    let world = World::new();
    let model = LoopModel::native().then(|_| Ok(text("أهلًا!")));
    let mut rt = runtime(&world, "هلا");
    rt.run(&model);
    assert!(shown_candidates(&model.seen()[0].system).is_empty());
    assert!(rt.agent_selections().is_empty());
    let _ = Value::Null;
}

/// R-40 (قِيس 2026-10-14 على Bonsai في إعادة اختبار eval/2.1: data-analyst وpython-developer، المتوقَّع أول المرشحين والمنسّق نفّذ العمل
/// بنفسه): المنسّق الذي يرى قائمة مرشحين لا يُقال له إنه هو المتخصّص. الخبرة للوكيل المفوَّض إليه، والمنسّق يوزّع (نمط المنسّق والعمال).
#[test]
fn r40_a_coordinator_shown_candidates_is_not_told_it_is_the_specialist() {
    let world = World::new();
    let model = LoopModel::native().then(|_| Ok(text("Done.")));
    let mut rt = runtime(&world, "حلّل القوائم المالية للشركة واحسب نسب الربحية");
    rt.run(&model);
    let system = &model.seen()[0].system;
    assert!(system.contains("<candidate_agents>"), "the premise failed: no candidates were shown");
    assert!(!system.contains("You are working as the"), "the coordinator was told it is the specialist while candidates were shown");
}

/// R-43 (قِيس 2026-10-14 على Bonsai، eval/2.1 و2.2: المنسّق لم يفوّض في 5 من 7 حالات اختيار ثم في data-analyst، والمتوقَّع أول المرشحين):
/// القائمة كانت تصل داخل `<domain_guidance>` بعبارة «Apply this expertise where it fits»، أي «اعمل بالخبرة بنفسك»، وخطوات العمل لا تذكر
/// التوجيه. نمط التوجيه (Anthropic، «Building effective agents»): قرار التوجيه خطوة أولى صريحة قبل العمل، والقائمة قسم مستقل.
#[test]
fn r43_a_coordinator_shown_candidates_routes_before_it_acts() {
    let world = World::new();
    let model = LoopModel::native().then(|_| Ok(text("Done.")));
    let mut rt = runtime(&world, "حلّل القوائم المالية للشركة واحسب نسب الربحية");
    rt.run(&model);
    let system = &model.seen()[0].system;
    assert!(system.contains("<candidate_agents>"), "the premise failed: no candidates were shown");
    assert!(!system.contains("Apply this expertise"), "the candidate list arrived as expertise for the coordinator to apply itself");
    let method = &system[system.find("<how_to_work>").unwrap()..system.find("</how_to_work>").unwrap()];
    let route = method.find("<candidate_agents>").expect("the method has no routing step for the candidate agents");
    let act = method.find("Act.").expect("the method lost its act step");
    assert!(route < act, "routing comes after acting:\n{method}");

    // بلا مرشحين لا خطوة توجيه: تعليمة المحادثة العادية كما كانت.
    let small = LoopModel::native().then(|_| Ok(text("أهلًا!")));
    runtime(&World::new(), "هلا").run(&small);
    assert!(!small.seen()[0].system.contains("<candidate_agents>"), "a routing step appeared without candidates");
}

/// تكليف 2026-10-15 (سجلّ محادثة eval/2.2 على Bonsai وNemotron 3 Ultra، وبعد e353ba5): التعليمة وحدها لم تكفِ، فالمنسّق يفحص مساحة
/// العمل أولًا ثم يسأل المستخدم بدل أن يفوّض. خطوة التوجيه يفرضها المضيف كما يفوّض Claude Code وكلاءه: حين يرى المنسّق مرشحين لا
/// تُنفَّذ أداة عمل قبل قرار التوجيه (delegate_task أو handle_directly)؛ والخطة والردّ النصّي (محادثة) يمرّان كما هما.
#[test]
fn route_turn_a_coordinator_shown_candidates_cannot_act_before_it_routes() {
    let world = World::new();
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("list_files", json!({ "path": "inputs" }))])))
        .then(|_| Ok(calls(&[("handle_directly", json!({ "reason": "No candidate covers this." }))])))
        .then(|_| Ok(calls(&[("list_files", json!({ "path": "inputs" }))])))
        .then(|_| Ok(text("Done.")));
    let mut rt = runtime(&world, "حلّل القوائم المالية للشركة واحسب نسب الربحية");
    rt.run(&model);
    let seen = model.seen();
    assert!(seen[0].system.contains("<candidate_agents>"), "the premise failed: no candidates were shown");
    let joined = |i: usize| seen[i].messages.iter().map(|m| m.text.clone()).collect::<Vec<_>>().join("\n");
    assert!(joined(1).contains("ROUTE_FIRST"), "a work tool ran before the route was decided:\n{}", joined(1));
    assert!(!joined(1).contains("status: SUCCEEDED"), "the refused call still ran:\n{}", joined(1));
    assert!(joined(3).matches("ROUTE_FIRST").count() == 1, "the call after handle_directly was refused again:\n{}", joined(3));
    assert!(joined(3).lines().filter(|l| l.starts_with("status: SUCCEEDED")).count() >= 2, "handle_directly or the work after it did not run:\n{}", joined(3));
}

#[test]
fn route_turn_never_blocks_a_request_without_candidates_and_gives_way_after_two_refusals() {
    let world = World::new();
    let model = LoopModel::native().then(|_| Ok(calls(&[("list_files", json!({ "path": "inputs" }))]))).then(|_| Ok(text("Done.")));
    runtime(&world, "هلا").run(&model);
    let after: String = model.seen()[1].messages.iter().map(|m| m.text.clone()).collect();
    assert!(!after.contains("ROUTE_FIRST") && after.contains("status: SUCCEEDED"), "{after}");

    // نموذج يصرّ على العمل بنفسه لا تقف مهمّته: بعد رفضين يمضي العمل، والتوجيه يبقى مسجّلًا أنه لم يقع.
    let world = World::new();
    let stubborn = LoopModel::native()
        .then(|_| Ok(calls(&[("list_files", json!({ "path": "inputs" }))])))
        .then(|_| Ok(calls(&[("list_files", json!({ "path": "work" }))])))
        .then(|_| Ok(calls(&[("list_files", json!({ "path": "outputs" }))])))
        .then(|_| Ok(text("Done.")));
    runtime(&world, "حلّل القوائم المالية للشركة واحسب نسب الربحية").run(&stubborn);
    let last: String = stubborn.seen()[3].messages.iter().map(|m| m.text.clone()).collect::<Vec<_>>().join("\n");
    assert_eq!(last.matches("ROUTE_FIRST").count(), 2, "{last}");
    assert!(last.contains("status: SUCCEEDED"), "the third call did not run:\n{last}");
}
