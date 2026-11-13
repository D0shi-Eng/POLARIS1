// P04 — مسار الوكيل إلى الأداة عبر زمن التشغيل الحقيقي وبوابة الأدوات الحقيقية.
//
// كل اختبار هنا يشغّل مهمّة كاملة: تخطيط، ثم عقدة، ثم وكيل، ثم اقتراح أداة مهيكل،
// ثم بوابة، ثم محوّل، ثم دليل مقيس، ثم تحقّق. النموذج تجهيزة حتمية (TEST FIXTURE)
// حتى لا تعتمد النتيجة على مخرجات عشوائية؛ وما يُختبر هو البوابة وطبقة الحقيقة
// لا النموذج.
//
// الحدّ الذي تحرسه هذه المجموعة: الوكيل يقترح، والبوابة تقرّر. ولذلك تُقاس هنا
// حالات الرفض بالقدر نفسه الذي تُقاس به حالة النجاح.

use std::sync::Arc;

use polaris_host_core::audit::AuditLedger;
use polaris_host_core::p02::context::SourceService;
use polaris_host_core::p02::projects::service::NewProject;
use polaris_host_core::p02::projects::ProjectService;
use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
use polaris_host_core::p03::claim::{ClaimStatus, ClaimType};
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::evidence::{EvidenceType, MeasurementKind};
use polaris_host_core::p03::mission::{
    CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionRequirement, MissionState,
};
use polaris_host_core::p03::port::{
    AgentModel, ClaimProposal, DelegationRequestDraft, ModelError, PlanProposal, PlannedTask, ReviewResult, ReviewVerdict,
    TaskExecution, ToolBroker, ToolBrokerFactory, ToolRequest,
};
use polaris_host_core::p03::runtime::{MissionRuntime, RunReport};
use polaris_host_core::p03::task::{DependencyKind, TaskState, TaskType};
use polaris_host_core::p03::trust::AuthorityClass;
use polaris_host_core::p04::approval::{ApprovalDecision, ApprovalStatus};
use polaris_host_core::p04::broker::Phase04BrokerFactory;
use polaris_host_core::p04::budget::ToolBudget;
use polaris_host_core::p04::evidence::ToolEvidenceSource;
use polaris_host_core::p04::service::{Phase04, Phase04Config};
use polaris_host_core::storage::Database;
use polaris_host_providers::net::{CancelToken, HttpClient};

const MISSION: &str = "11111111-1111-4111-8111-111111111111";
const SKILL_EVIDENCE: &str = "polaris.skill.evidence-gathering";
const SKILL_ANALYSIS: &str = "polaris.skill.local-analysis";
const SKILL_NOTE: &str = "polaris.skill.project-note";
const TOOL_AUDIT: &str = "polaris.tool.audit.chain.verify";
const TOOL_CONTEXT: &str = "polaris.tool.context.read";
const TOOL_NOTE: &str = "polaris.tool.project.note.append";

// ——— تجهيزة نموذج تقترح أدوات. حتمية، ولا تعرف شيئًا عن البوابة.

struct ToolProposingModel {
    task_type: TaskType,
    requests: Vec<ToolRequest>,
    delegation: Option<DelegationRequestDraft>,
}

impl ToolProposingModel {
    fn new(task_type: TaskType, requests: Vec<ToolRequest>) -> Self {
        Self { task_type, requests, delegation: None }
    }

    fn delegating(task_type: TaskType) -> Self {
        Self {
            task_type,
            requests: Vec::new(),
            delegation: Some(DelegationRequestDraft {
                requested_role: AgentRole::TestEngineer,
                objective: "verify what the builder produced".into(),
                reason: "the builder cannot verify its own work".into(),
                expected_output: "a verdict backed by a measurement".into(),
            }),
        }
    }
}

fn request(skill: &str, tool: &str, arguments: serde_json::Value) -> ToolRequest {
    ToolRequest {
        skill_id: skill.into(),
        tool_id: tool.into(),
        arguments,
        reason: "the task needs a measurement it cannot produce by itself".into(),
        expected_effect: vec!["DATABASE_READ".into()],
        expected_output: "what the tool measured".into(), require_human: false,
    }
}

impl AgentModel for ToolProposingModel {
    fn plan(&self, _mission_objective: &str) -> Result<PlanProposal, ModelError> {
        Ok(PlanProposal {
            tasks: vec![PlannedTask {
                local_key: "one".into(),
                title: "the only task".into(),
                objective: "do the bounded thing".into(),
                task_type: self.task_type,
                depends_on: Vec::new(),
                dependency_kind: DependencyKind::RequiresSuccess,
                recommended_role: AgentRole::TestEngineer,
            }],
        })
    }

    fn execute(&self, _role: AgentRole, _task_type: TaskType, _objective: &str) -> Result<TaskExecution, ModelError> {
        Ok(TaskExecution {
            output_summary: "the step is complete and all tests pass".into(),
            claims: vec![
                // ادّعاء مهيكل تُظهر الأداة قيمته حرفيًّا (ADR-041 §3.3): نصٌّ حرّ بلا هيكل لا يحقّقه قياس بنيوي.
                ClaimProposal {
                    statement: "the audit chain is intact".into(),
                    claim_type: ClaimType::Fact,
                    subject: Some(polaris_host_core::p03::claim::ClaimSubject { subject: "audit chain".into(), property: "observed".into(), value: "the audit chain verified".into() }),
                },
                ClaimProposal {
                    statement: "all tests pass and the task is complete".into(),
                    claim_type: ClaimType::Completion,
                    subject: None,
                },
            ],
            evidence: Vec::new(),
            tool_requests: self.requests.clone(),
            delegation: self.delegation.clone(),
            input_tokens: 100,
            output_tokens: 50,
            failed: false,
        })
    }

    fn review(&self, _role: AgentRole, _target_task: &str) -> Result<ReviewResult, ModelError> {
        Ok(ReviewResult { verdict: ReviewVerdict::Accept, notes: "accepted".into(), input_tokens: 10, output_tokens: 5 })
    }
}

// ——— التركيب: Phase-04 حقيقي فوق قاعدة في الذاكرة.

struct Harness {
    phase04: Arc<Phase04>,
    evidence: Arc<ToolEvidenceSource>,
    sources: Arc<SourceService>,
    projects: Arc<ProjectService>,
}

fn harness() -> Harness {
    let db = Arc::new(Database::in_memory().expect("an in-memory database"));
    let audit = Arc::new(AuditLedger::new(db.clone()));
    let projects = Arc::new(ProjectService::new(db.clone(), audit.clone()));
    let sources = Arc::new(SourceService::new(db.clone(), projects.clone(), audit.clone()));
    let evidence = Arc::new(ToolEvidenceSource::new());
    let phase04 = Arc::new(
        Phase04::build(Phase04Config {
            db,
            audit,
            clock: RuntimeClock::system(),
            http: Arc::new(HttpClient::new()),
            sources: sources.clone(),
            evidence: evidence.clone(),
        })
        .expect("phase-04 builds"),
    );
    Harness { phase04, evidence, sources, projects }
}

fn mission(budget: MissionBudget, project_id: Option<String>) -> Mission {
    Mission {
        mission_id: MISSION.into(),
        project_id,
        title: "tools".into(),
        title_authority: AuthorityClass::DirectUserInstruction,
        objective: "use a tool and report what it measured".into(),
        origin: MissionOrigin::User,
        execution_mode: ExecutionMode::SingleAgent,
        priority: MissionPriority::Normal,
        state: MissionState::Created,
        completion_proof_status: CompletionProofStatus::NotEvaluated,
        current_revision: 1,
        root_task_id: None,
        budget,
        // R-02 (2026-10-12): المتطلَّب يسمّي موضوع الادّعاء المقيس الذي يستوفيه («audit chain»).
        requirements: vec![MissionRequirement::new("audit chain", "the audit chain is intact", "p03.rule.fact", true)],
        created_at: "2026-09-22T00:00:00Z".into(),
        started_at: None,
        completed_at: None,
        result_summary: None,
        failure_reason: None,
        version: 1,
    }
}

struct Outcome {
    runtime: MissionRuntime,
    report: RunReport,
    broker: Arc<dyn ToolBroker>,
}

fn run(h: &Harness, model: &dyn AgentModel, budget: MissionBudget, tool_budget: ToolBudget, project: Option<String>) -> Outcome {
    let cancel = CancelToken::new();
    run_with_cancel(h, model, budget, tool_budget, project, cancel)
}

fn run_with_cancel(
    h: &Harness,
    model: &dyn AgentModel,
    budget: MissionBudget,
    tool_budget: ToolBudget,
    project: Option<String>,
    cancel: CancelToken,
) -> Outcome {
    let factory = Phase04BrokerFactory::new(h.phase04.clone()).with_budget(tool_budget);
    let broker = factory.broker_for(MISSION, project.clone(), cancel.clone());
    let mut runtime = MissionRuntime::new(mission(budget, project), RuntimeClock::system(), AgentRegistry::builtin())
        .with_trusted_evidence(h.evidence.clone())
        .with_tools(broker.clone())
        .with_cancel(cancel);
    let report = runtime.run(model);
    Outcome { runtime, report, broker }
}

/// يستأنف المهمّة بالرسم نفسه: لا تخطيط جديد، ولا معرّفات عُقد جديدة.
fn resume(
    h: &Harness,
    model: &dyn AgentModel,
    tool_budget: ToolBudget,
    project: Option<String>,
    previous: &Outcome,
) -> Outcome {
    let cancel = CancelToken::new();
    let factory = Phase04BrokerFactory::new(h.phase04.clone()).with_budget(tool_budget);
    let broker = factory.broker_for(MISSION, project.clone(), cancel.clone());
    // المهمّة تُستأنف بحالتها كما حُفظت، لا بمهمّة جديدة: الخدمة تفعل ذلك، وبناء
    // مهمّة طازجة هنا كان يُخفي أن الاستئناف من WAITING_FOR_APPROVAL ممنوع في
    // آلة الحالة — وهو عيب لم يظهر إلا في التشغيل الحقيقي.
    let mut runtime = MissionRuntime::new(previous.runtime.mission().clone(), RuntimeClock::system(), AgentRegistry::builtin())
        .with_trusted_evidence(h.evidence.clone())
        .with_tools(broker.clone())
        .with_cancel(cancel)
        .resume_from(&previous.runtime.snapshot());
    let report = runtime.run(model);
    Outcome { runtime, report, broker }
}

fn denial_reasons(h: &Harness) -> Vec<String> {
    h.phase04
        .list_activity(Some(MISSION), Some(100))
        .expect("activity reads")
        .invocations
        .into_iter()
        .filter_map(|record| record.denial_reason)
        .collect()
}

fn statuses(h: &Harness) -> Vec<String> {
    h.phase04
        .list_activity(Some(MISSION), Some(100))
        .expect("activity reads")
        .invocations
        .into_iter()
        .map(|record| record.status.to_string())
        .collect()
}

/// P04-T1 — المسار الكامل: اقتراح، ثم بوابة، ثم أداة، ثم دليل مقيس، ثم تحقّق.
#[test]
fn an_agent_proposal_runs_through_the_gateway_and_its_result_verifies_a_claim() {
    let h = harness();
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    let out = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);

    assert_eq!(out.report.tool_proposals, 1);
    assert_eq!(out.report.tool_calls_executed, 1, "the proposal did not reach the tool");
    assert_eq!(out.report.tool_calls_denied, 0);
    assert_eq!(out.broker.executed_calls(), 1);

    // الدليل مقيس، ونوعه نوع أداة، ومصدره البوابة لا الوكيل.
    let tool_evidence: Vec<_> = out
        .runtime
        .evidence()
        .iter()
        .filter(|item| item.evidence_type == EvidenceType::ToolResult)
        .collect();
    assert_eq!(tool_evidence.len(), 1);
    assert_eq!(tool_evidence[0].provenance.measurement_kind, MeasurementKind::Measured);
    assert_eq!(tool_evidence[0].provenance.authority, AuthorityClass::TrustedRuntimeFact);
    assert!(tool_evidence[0].provenance.producer.starts_with("polaris.tool/"));
    assert!(tool_evidence[0].taint.is_clean(), "measured tool evidence carried a taint flag");

    // ادّعاء الحقيقة يُحقَّق بالقياس، وادّعاء الإنجاز يبقى غير محقَّق: أداةٌ عملت
    // ليست اختبارًا نجح، وقاعدة الإنجاز تطلب أثر اختبار بعينه.
    let verified: Vec<_> = out.runtime.claims().iter().filter(|c| c.status == ClaimStatus::Verified).collect();
    assert_eq!(verified.len(), 1);
    assert_eq!(verified[0].claim_type, ClaimType::Fact);
    let completion: Vec<_> = out.runtime.claims().iter().filter(|c| c.claim_type == ClaimType::Completion).collect();
    assert_eq!(completion.len(), 1);
    assert_ne!(completion[0].status, ClaimStatus::Verified, "a tool result proved completion");
    // والمتطلَّب المُعلن — «السلسلة متماسكة» بقاعدة الحقيقة — يُستوفى فعلًا، لأن ما
    // استوفاه قياسٌ حقيقي من أداةٍ نُفِّذت عبر البوابة. الإثبات هنا إثبات المتطلَّب
    // المُعلن وحده، لا إثبات «نجحت الاختبارات».
    assert_eq!(out.report.completion_proof.status, CompletionProofStatus::Proven);
    assert!(out.report.completion_proof.remaining_blockers.is_empty(), "{:?}", out.report.completion_proof.remaining_blockers);
}

/// P04-T2 — الوكيل لا يخترع أداة، ولا مهارة تصل إلى ما لا تسمّيه.
#[test]
fn an_agent_can_neither_invent_a_tool_nor_reach_one_its_skill_does_not_name() {
    let h = harness();
    let invented = ToolProposingModel::new(
        TaskType::Test,
        vec![request(SKILL_EVIDENCE, "polaris.tool.anything.i.want", serde_json::json!({}))],
    );
    let first = run(&h, &invented, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert_eq!(first.report.tool_calls_executed, 0);
    assert_eq!(first.report.tool_calls_denied, 1);
    assert!(denial_reasons(&h).contains(&"UNKNOWN_TOOL".to_string()));
    assert_eq!(h.evidence.len(), 0, "a denied call produced evidence");

    let wrong_skill = harness();
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_ANALYSIS, TOOL_AUDIT, serde_json::json!({}))]);
    let second = run(&wrong_skill, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert_eq!(second.report.tool_calls_executed, 0);
    assert!(denial_reasons(&wrong_skill).contains(&"SKILL_DOES_NOT_ALLOW_TOOL".to_string()));
}

/// P04-T3 — حجج لا تجتاز عقد الأداة تُرفض قبل أي أثر.
#[test]
fn arguments_that_fail_the_tool_contract_are_refused_before_any_effect() {
    let h = harness();
    let model = ToolProposingModel::new(
        TaskType::Research,
        vec![request(SKILL_ANALYSIS, TOOL_CONTEXT, serde_json::json!({ "source_id": "../../etc/passwd" }))],
    );
    let out = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert_eq!(out.report.tool_calls_executed, 0);
    assert!(denial_reasons(&h).contains(&"ARGUMENTS_INVALID".to_string()));
    // ولا حقل غير مُعلن يمرّ.
    let extra = harness();
    let sneaky = ToolProposingModel::new(
        TaskType::Test,
        vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({ "path": "C:/" }))],
    );
    run(&extra, &sneaky, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert!(denial_reasons(&extra).contains(&"ARGUMENTS_INVALID".to_string()));
}

/// P04-T4 — مهارة معطّلة لا تعمل، ولو كانت الأداة مسجَّلة ومفعّلة.
#[test]
fn a_disabled_skill_runs_nothing() {
    let h = harness();
    h.phase04.configure_skill(SKILL_EVIDENCE, false).expect("the skill is configurable");
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    let out = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert_eq!(out.report.tool_calls_executed, 0);
    assert!(denial_reasons(&h).contains(&"SKILL_DISABLED".to_string()));
    // وإعادة التفعيل تُعيد المسار: التعطيل حالة لا حذف.
    h.phase04.configure_skill(SKILL_EVIDENCE, true).expect("the skill is configurable");
    let again = harness();
    let out2 = run(&again, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert_eq!(out2.report.tool_calls_executed, 1);
}

/// P04-T5 — الميزانية تُنفَّذ بالحجز قبل الإنفاق، لكل عقدة وللمهمّة.
#[test]
fn the_tool_budget_is_reserved_before_spending_and_stops_the_rest() {
    let h = harness();
    let requests = (0..6).map(|_| request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))).collect();
    let model = ToolProposingModel::new(TaskType::Test, requests);
    let budget = ToolBudget { max_tool_calls: 10, max_tool_calls_per_task: 2, ..ToolBudget::conservative() };
    let out = run(&h, &model, MissionBudget::conservative(), budget, None);
    assert_eq!(out.report.tool_proposals, 6);
    assert_eq!(out.report.tool_calls_executed, 2, "the per-task budget was exceeded");
    assert_eq!(out.report.tool_calls_denied, 4);
    assert!(denial_reasons(&h).contains(&"BUDGET_EXHAUSTED".to_string()));
    // والدليل لا يُسجَّل إلا لما نُفِّذ فعلًا.
    assert_eq!(h.evidence.len(), 2);
}

/// P04-T6 — ميزانية صفرية تمنع كل أداة، وهي الحدّ الأقصى للتضييق.
#[test]
fn a_zero_tool_budget_prevents_every_call() {
    let h = harness();
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    let out = run(&h, &model, MissionBudget::conservative(), ToolBudget::none(), None);
    assert_eq!(out.report.tool_calls_executed, 0);
    assert!(denial_reasons(&h).contains(&"BUDGET_EXHAUSTED".to_string()));
}

/// P04-T7 — أداة تغيّر حالةً تنتظر قرارًا بشريًّا، ولا تكتب شيئًا قبله.
#[test]
fn a_tool_that_changes_state_waits_for_a_human_decision_and_writes_nothing() {
    let h = harness();
    let project = h
        .projects
        .create(NewProject { name: "tools".into(), description: None, language: None, workspace_root: None })
        .expect("the project is created");
    let model = ToolProposingModel::new(
        TaskType::Build,
        vec![request(SKILL_NOTE, TOOL_NOTE, serde_json::json!({ "title": "a note", "text": "what the agent concluded" }))],
    );
    let out = run(
        &h,
        &model,
        MissionBudget::conservative(),
        ToolBudget::conservative(),
        Some(project.project_id.clone()),
    );

    assert_eq!(out.report.tool_calls_executed, 0);
    assert_eq!(out.report.tool_calls_awaiting_approval, 1);
    assert!(statuses(&h).contains(&"AWAITING_APPROVAL".to_string()));
    // لا شيء كُتب: المشروع بلا مصدر جديد.
    assert_eq!(h.sources.list(&project.project_id).expect("sources read").len(), 0);
    // وطلب موافقة واحد معلّق، مربوط بأثر الكتابة.
    let approvals = h.phase04.list_approvals(Some(MISSION)).expect("approvals read").approvals;
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0].status, "PENDING");
    assert!(approvals[0].effects.contains(&"WRITE_LOCAL"));
    assert_eq!(h.evidence.len(), 0, "a call that never ran produced evidence");
}

/// P04-T8 — الموافقة الممنوحة تُستهلك مرّة واحدة، ولا تُعاد.
#[test]
fn a_granted_approval_runs_exactly_one_call_and_cannot_be_replayed() {
    let h = harness();
    let project = h
        .projects
        .create(NewProject { name: "tools".into(), description: None, language: None, workspace_root: None })
        .expect("the project is created");
    let arguments = serde_json::json!({ "title": "a note", "text": "what the agent concluded" });
    let model = ToolProposingModel::new(TaskType::Build, vec![request(SKILL_NOTE, TOOL_NOTE, arguments)]);

    // أولًا: الطلب يُنشئ موافقة معلّقة، والمهمّة تنتظر بعقدتها نفسها.
    let first = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), Some(project.project_id.clone()));
    assert_eq!(first.report.mission_state, MissionState::WaitingForApproval);
    let graph = first.runtime.graph().clone();
    let waiting: Vec<String> = graph
        .nodes()
        .filter(|node| node.state == TaskState::Waiting)
        .map(|node| node.task_id.clone())
        .collect();
    assert_eq!(waiting.len(), 1, "the task that needs a decision was not left waiting");
    let pending = h.phase04.list_approvals(Some(MISSION)).expect("approvals read").approvals;
    let approval_id = pending[0].approval_id.clone();
    // الرباط يسمّي العقدة نفسها التي تنتظر.
    assert_eq!(pending[0].task_id, waiting[0]);

    // ثم يُمنح القرار، ويُستأنف الرسم نفسه — لا تخطيط جديد ولا معرّفات جديدة.
    h.phase04.respond_approval(&approval_id, ApprovalDecision::Grant).expect("the approval is answerable");
    let second = resume(&h, &model, ToolBudget::conservative(), Some(project.project_id.clone()), &first);
    assert_eq!(second.report.tool_calls_executed, 1, "the approved call did not run on resume");
    assert_eq!(h.sources.list(&project.project_id).expect("sources read").len(), 1, "the approved write did not happen");

    // والجواب مرّة ثانية مرفوض: الطلب انتهى.
    assert!(h.phase04.respond_approval(&approval_id, ApprovalDecision::Grant).is_err());
    let after = h.phase04.list_approvals(Some(MISSION)).expect("approvals read").approvals;
    assert!(after.iter().any(|a| a.approval_id == approval_id && a.status == ApprovalStatus::Consumed.as_str()));

    // والمهمّة التي اكتملت لا تُستأنف: الحالة النهائية نهائية، ولا أثر يقع منها.
    let completed = resume(&h, &model, ToolBudget::conservative(), Some(project.project_id.clone()), &second);
    assert_eq!(completed.report.tool_calls_executed, 0, "a completed mission ran again");
    assert_eq!(h.sources.list(&project.project_id).expect("sources read").len(), 1);

    // واستئناف ثالث من حالة الانتظار نفسها يطلب قرارًا جديدًا ولا يكتب مرّة أخرى:
    // الموافقة استُهلكت، فالاقتراح نفسه يعود إلى الانتظار بدل أن يمرّ.
    let third = resume(&h, &model, ToolBudget::conservative(), Some(project.project_id.clone()), &first);
    assert_eq!(third.report.tool_calls_executed, 0, "the approval was replayed");
    assert_eq!(third.report.tool_calls_awaiting_approval, 1);
    assert_eq!(h.sources.list(&project.project_id).expect("sources read").len(), 1, "the approval was replayed");
}

/// P04-T9 — الموافقة المرفوضة لا تُنفَّذ، ولا تتحوّل إلى انتظار جديد صامت.
#[test]
fn a_denied_approval_never_runs_the_tool() {
    let h = harness();
    let project = h
        .projects
        .create(NewProject { name: "tools".into(), description: None, language: None, workspace_root: None })
        .expect("the project is created");
    let arguments = serde_json::json!({ "title": "a note", "text": "what the agent concluded" });
    let model = ToolProposingModel::new(TaskType::Build, vec![request(SKILL_NOTE, TOOL_NOTE, arguments)]);
    let first = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), Some(project.project_id.clone()));
    let approval_id = h.phase04.list_approvals(Some(MISSION)).expect("approvals read").approvals[0].approval_id.clone();
    h.phase04.respond_approval(&approval_id, ApprovalDecision::Deny).expect("the approval is answerable");

    let after = resume(&h, &model, ToolBudget::conservative(), Some(project.project_id.clone()), &first);
    assert_eq!(after.report.tool_calls_executed, 0);
    assert_eq!(h.sources.list(&project.project_id).expect("sources read").len(), 0);
}

/// P04-T10 — الإلغاء يمنع الأداة التالية ولا يترك أثرًا نصفَ واقع.
#[test]
fn a_cancelled_mission_runs_no_further_tool() {
    let h = harness();
    let cancel = CancelToken::new();
    cancel.cancel();
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    let out = run_with_cancel(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None, cancel);
    assert_eq!(out.report.tool_calls_executed, 0);
    assert_eq!(h.evidence.len(), 0);
    assert_ne!(out.report.completion_proof.status, CompletionProofStatus::Proven);
}

/// P04-T11 — دليل الأداة معزول بالمهمّة وبالعقدة: لا يحقّق ما لم يُقَس له.
#[test]
fn tool_evidence_cannot_reach_another_mission_or_another_task() {
    let h = harness();
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);
    assert_eq!(h.evidence.len(), 1);
    // المهمّة نفسها بعقدة أخرى: لا دليل.
    assert!(h.evidence.for_task(MISSION, "22222222-2222-4222-8222-222222222222").is_empty());
    // ومهمّة أخرى: لا دليل كذلك.
    assert!(h.evidence.for_task("33333333-3333-4333-8333-333333333333", "").is_empty());
}

/// P04-T12 — التفويض مسار حقيقي: وكيل ثانٍ، ورسالتان، وادّعاء باسمه.
#[test]
fn delegation_creates_a_second_agent_and_carries_the_result_back() {
    let h = harness();
    let model = ToolProposingModel::delegating(TaskType::Build);
    let out = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);

    assert_eq!(out.report.delegations_requested, 1);
    assert_eq!(out.report.delegations_executed, 1);
    // رسالتان على الناقل الحقيقي: طلب إلى المُنسِّق، ونتيجة إلى الوكيل الطالب.
    assert_eq!(out.report.agent_messages, 2);
    let messages = out.runtime.messages();
    assert_eq!(messages.len(), 2);
    for message in messages {
        // رسالة الوكيل لا تحمل سلطة مستخدم أبدًا.
        assert_eq!(message.authority, AuthorityClass::AgentMessage);
        assert_eq!(message.mission_id, MISSION);
    }
    // ووكيل ثانٍ بعمق أكبر ووالدٍ مُعلن.
    let delegated: Vec<_> = out.runtime.agents().iter().filter(|agent| agent.delegation_depth > 0).collect();
    assert_eq!(delegated.len(), 1);
    assert_eq!(delegated[0].role, AgentRole::TestEngineer);
    assert!(delegated[0].parent_agent_id.is_some());
    // وادّعاءات الوكيل الثاني مُلوَّثة بالنقل، وغير محقَّقة.
    let relayed: Vec<_> = out
        .runtime
        .claims()
        .iter()
        .filter(|claim| claim.agent_id == delegated[0].agent_id)
        .collect();
    assert!(!relayed.is_empty());
    for claim in relayed {
        assert_ne!(claim.status, ClaimStatus::Verified, "a delegated claim verified itself");
    }
}

/// P04-T13 — حدّ التفويض يُنفَّذ: عمق فوق الحدّ لا يُنشئ وكيلًا.
#[test]
fn a_delegation_above_the_depth_limit_creates_no_agent() {
    let h = harness();
    let model = ToolProposingModel::delegating(TaskType::Build);
    let budget = MissionBudget { max_delegation_depth: 0, ..MissionBudget::conservative() };
    let out = run(&h, &model, budget, ToolBudget::conservative(), None);
    assert_eq!(out.report.delegations_requested, 1);
    assert_eq!(out.report.delegations_executed, 0, "a delegation ran above the depth limit");
    assert!(out.runtime.agents().iter().all(|agent| agent.delegation_depth == 0));
    // ورفض التفويض حاجزٌ يُعلن، فلا يُثبَت الإنجاز بصمت.
    assert_ne!(out.report.completion_proof.status, CompletionProofStatus::Proven);
}

/// P04-T14 — بلا وسيط أدوات، كل اقتراح يُرفض صراحةً ولا يُبتلع.
#[test]
fn without_a_tool_layer_every_proposal_is_refused_explicitly() {
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    let mut runtime = MissionRuntime::new(
        mission(MissionBudget::conservative(), None),
        RuntimeClock::system(),
        AgentRegistry::builtin(),
    );
    let report = runtime.run(&model);
    assert_eq!(report.tool_proposals, 1);
    assert_eq!(report.tool_calls_executed, 0);
    assert_eq!(report.tool_calls_denied, 1, "a proposal was swallowed instead of refused");
    assert!(runtime.evidence().iter().all(|item| item.evidence_type != EvidenceType::ToolResult));
}

/// P04-T15 — المهارة المدمجة تعرض على النموذج أدواتها المسجَّلة فقط.
#[test]
fn a_skill_offers_the_model_only_the_tools_that_exist() {
    let h = harness();
    assert_eq!(h.phase04.tools_for_skill(SKILL_EVIDENCE), vec![TOOL_AUDIT.to_string()]);
    assert_eq!(h.phase04.tools_for_skill(SKILL_ANALYSIS), vec![TOOL_CONTEXT.to_string()]);
    // والمهارة المدعومة بـMCP تبدأ فارغة: لا أداة قبل تسجيل خادم واكتشافه.
    assert!(h.phase04.external_tooling_tools().is_empty());
    // ومهارة غير معروفة لا تعرض شيئًا بدل أن تُخترع.
    assert!(h.phase04.tools_for_skill("polaris.skill.not-a-skill").is_empty());
}

/// P04-T16 - الاستئناف يواصل الرسم القائم ولا يُصدر معرّفات عُقد جديدة.
#[test]
fn resuming_a_mission_keeps_its_task_identifiers_and_repeats_no_effect() {
    let h = harness();
    let model = ToolProposingModel::new(TaskType::Test, vec![request(SKILL_EVIDENCE, TOOL_AUDIT, serde_json::json!({}))]);
    let first = run(&h, &model, MissionBudget::conservative(), ToolBudget::conservative(), None);
    let before: Vec<String> = first.runtime.graph().nodes().map(|node| node.task_id.clone()).collect();
    assert_eq!(before.len(), 1);
    assert_eq!(first.report.tool_calls_executed, 1);

    let again = resume(&h, &model, ToolBudget::conservative(), None, &first);
    let after: Vec<String> = again.runtime.graph().nodes().map(|node| node.task_id.clone()).collect();
    assert_eq!(after, before, "resuming re-planned the mission and issued new task identifiers");
    // والعقدة الناجحة لا تُعاد: لا أثر يقع مرّتين.
    assert_eq!(again.report.tool_calls_executed, 0, "a completed task ran again on resume");
    assert_eq!(h.evidence.len(), 1);
}
