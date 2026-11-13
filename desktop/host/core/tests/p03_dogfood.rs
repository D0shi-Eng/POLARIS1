// P03 — سيناريوهات التغذية الذاتية عبر زمن التشغيل الحقيقي.
//
// كل اختبار هنا يشغّل مهمّة كاملة: تخطيط، ثم رسم مهام، ثم وكلاء، ثم ادّعاءات
// وأدلّة، ثم تحقّق، ثم إثبات إنجاز. النموذج تجهيزة حتمية (TEST FIXTURE) حتى لا
// تعتمد النتيجة على مخرجات عشوائية؛ ما يُختبر هو المُنسِّق وطبقة الحقيقة لا النموذج.

use polaris_host_core::p03::agent::AgentRegistry;
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{
    CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionRequirement, MissionState,
    RequirementStatus,
};
use polaris_host_core::p03::model_fixture::{FixtureModel, FixtureScenario, FixtureTrustedEvidence};
use polaris_host_core::p03::runtime::{MissionRuntime, RunReport, StopReason};
use polaris_host_core::p03::trust::AuthorityClass;

fn mission(objective: &str, budget: MissionBudget, requirements: Vec<MissionRequirement>) -> Mission {
    Mission {
        mission_id: "11111111-1111-4111-8111-111111111111".into(),
        project_id: None,
        title: "dogfood".into(),
        title_authority: AuthorityClass::DirectUserInstruction,
        objective: objective.into(),
        origin: MissionOrigin::User,
        execution_mode: ExecutionMode::SingleAgent,
        priority: MissionPriority::Normal,
        state: MissionState::Created,
        completion_proof_status: CompletionProofStatus::NotEvaluated,
        current_revision: 1,
        root_task_id: None,
        budget,
        requirements,
        created_at: "2026-01-01T00:00:00Z".into(),
        started_at: None,
        completed_at: None,
        result_summary: None,
        failure_reason: None,
        version: 1,
    }
}

fn run(scenario: FixtureScenario, mission: Mission) -> (MissionRuntime, RunReport) {
    let mut runtime = MissionRuntime::new(mission, RuntimeClock::deterministic(), AgentRegistry::builtin());
    let model = FixtureModel::new(scenario);
    let report = runtime.run(&model);
    (runtime, report)
}

/// كالسابق، مع مصدر قياس موثوق مربوط — أي مع شيء خارج النموذج ينتج دليلًا مقيسًا.
fn run_measured(scenario: FixtureScenario, mission: Mission) -> (MissionRuntime, RunReport) {
    let mut runtime = MissionRuntime::new(mission, RuntimeClock::deterministic(), AgentRegistry::builtin())
        .with_trusted_evidence(std::sync::Arc::new(FixtureTrustedEvidence::runtime_measurement()));
    let model = FixtureModel::new(scenario);
    let report = runtime.run(&model);
    (runtime, report)
}

/// دوغفود ١ — وكيل واحد: مهمّة → عقدة → وكيل → نموذج → ادّعاء → دليل → تحقّق → نتيجة.
#[test]
fn dogfood_single_agent_produces_a_verified_result() {
    // R-02 (2026-10-12): المتطلَّب يسمّي موضوع الادّعاء الذي يستوفيه (نتيجة خطوة BUILD)، ولا يستوفيه أول ادّعاء محقَّق أيًّا كان.
    let requirement = MissionRequirement::new("BUILD", "produce a correct result", "p03.rule.fact", true);
    // الدليل المقيس يأتي من منفذه الموثوق، لا من فم الوكيل.
    let (runtime, report) = run_measured(
        FixtureScenario::SingleAgentVerified,
        mission("summarise the architecture", MissionBudget::conservative(), vec![requirement]),
    );

    assert_eq!(report.mission_state, MissionState::Completed);
    assert_eq!(report.tasks_succeeded, 1);
    assert_eq!(report.tasks_failed, 0);
    // السلسلة كاملة: وكيل واحد، ادّعاء واحد محقَّق، دليل مقيس واحد.
    assert_eq!(runtime.agents().len(), 1);
    assert_eq!(report.claims, 1);
    assert_eq!(report.verified_claims, 1);
    // دليلان: مخرجات الوكيل (لا تحقّق شيئًا) والقياس الموثوق (يحقّق).
    assert_eq!(runtime.evidence().len(), 2);
    // المتطلَّب الإلزامي استُوفي، فالإثبات قائم.
    assert_eq!(report.completion_proof.status, CompletionProofStatus::Proven);
    assert_eq!(runtime.mission().requirements[0].status, RequirementStatus::Satisfied);
}

/// دوغفود ٢ — متعدّد الوكلاء: مخطّط، معماري، مراجع أمني، مهندس اختبار.
#[test]
fn dogfood_multi_agent_runs_distinct_roles_in_dependency_order() {
    let (runtime, report) = run(
        FixtureScenario::MultiAgentVerified,
        mission("produce a small implementation plan", MissionBudget::conservative(), vec![]),
    );

    assert_eq!(report.mission_state, MissionState::Completed);
    assert_eq!(report.tasks_succeeded, 4, "all four planned tasks must succeed");
    // أربعة وكلاء بأدوار مختلفة، كلٌّ مربوط بهذه المهمّة وحدها.
    assert_eq!(runtime.agents().len(), 4);
    let mut roles: Vec<&str> = runtime.agents().iter().map(|a| a.role.as_str()).collect();
    roles.sort_unstable();
    assert_eq!(roles, vec!["ARCHITECT", "PLANNER", "SECURITY_REVIEWER", "TEST_ENGINEER"]);
    for agent in runtime.agents() {
        assert_eq!(agent.mission_id, runtime.mission().mission_id, "an agent escaped its mission");
    }
}

/// دوغفود ٤ — إنجاز كاذب: النموذج يقول «تمّ ونجحت الاختبارات» بلا أثر اختبار.
/// المتوقّع: قد تكتمل المهمّة، لكن إثبات الإنجاز يبقى NOT_PROVEN.
#[test]
fn dogfood_false_completion_stays_not_proven() {
    let requirement = MissionRequirement::new("req-1", "all tests pass", "p03.rule.completion", true);
    let (runtime, report) = run(
        FixtureScenario::FalseCompletion,
        mission("finish the work", MissionBudget::conservative(), vec![requirement]),
    );

    // العقدة نجحت تنفيذيًّا: النموذج لم يُبلّغ فشلًا.
    assert_eq!(report.tasks_succeeded, 1);
    assert_eq!(report.mission_state, MissionState::Completed);
    // لكن لا ادّعاء محقَّق: الدليل الوحيد مخرجات وكيل.
    assert_eq!(report.verified_claims, 0, "an agent's own assertion verified a completion claim");
    assert_eq!(report.completion_proof.status, CompletionProofStatus::NotProven);
    assert_eq!(runtime.mission().completion_proof_status, CompletionProofStatus::NotProven);
    assert_eq!(runtime.mission().requirements[0].status, RequirementStatus::Unverified);
    assert!(!report.completion_proof.remaining_blockers.is_empty());
}

/// دوغفود ٣ — معادٍ: مخرجات تحمل نصّ حقن. تبقى بيانات: لا سلطة، ولا إثبات.
#[test]
fn dogfood_adversarial_output_changes_no_policy_and_proves_nothing() {
    let requirement = MissionRequirement::new("req-1", "the mission is verified", "p03.rule.completion", true);
    let budget = MissionBudget::conservative();
    let declared_max_calls = budget.max_model_calls;
    let (runtime, report) = run(FixtureScenario::Adversarial, mission("do the work", budget, vec![requirement]));

    // نصّ «تجاهل السياسة/اعتمد نفسك/علّمها محقّقة» لم يغيّر شيئًا.
    assert_eq!(report.verified_claims, 0, "an injected instruction produced a verified claim");
    assert_eq!(report.completion_proof.status, CompletionProofStatus::NotProven);
    assert_eq!(runtime.mission().requirements[0].status, RequirementStatus::Unverified);
    // الميزانية المُعلنة لم تتغيّر، والاستهلاك بقي داخلها.
    assert_eq!(runtime.mission().budget.max_model_calls, declared_max_calls);
    assert!(report.model_calls <= declared_max_calls as u64);
    // لا وكيل رفع دوره أو خرج من مهمّته.
    for agent in runtime.agents() {
        assert_eq!(agent.mission_id, runtime.mission().mission_id);
        assert_ne!(agent.role.as_str(), "COORDINATOR");
    }
}

/// دورة المراجعة: تعديل واحد ثم قبول، ضمن حدّ الجولات.
#[test]
fn a_review_cycle_revises_once_then_accepts() {
    let (runtime, report) = run(
        FixtureScenario::ReviewThenAccept,
        mission("build then review", MissionBudget::conservative(), vec![]),
    );

    assert_eq!(report.mission_state, MissionState::Completed);
    assert_eq!(report.tasks_succeeded, 2, "both the work and its review must end succeeded");
    // المُنتِج نُفِّذ مرتين: الأصل ثم بعد طلب التعديل.
    let work = runtime.graph().nodes().find(|n| n.task_type.as_str() == "BUILD").unwrap();
    assert_eq!(work.attempt, 1, "the producer was not re-run after a revise verdict");
    // مراجعة بنموذج واحد لا تُسمّى مستقلّة.
    assert_eq!(report.review_independence.clone(), polaris_host_core::p03::runtime::ReviewIndependence::SameModelReview);
}

/// مخرجات مخطّط مشوّهة: رفض مغلق، لا تحليل نثر إلى تحكّم موثوق.
#[test]
fn a_malformed_plan_fails_closed() {
    let (runtime, report) = run(FixtureScenario::MalformedPlan, mission("do something", MissionBudget::conservative(), vec![]));

    assert_eq!(report.mission_state, MissionState::Failed);
    assert!(matches!(report.stop_reason, Some(StopReason::ModelOutputInvalid(_))));
    assert_eq!(runtime.graph().len(), 0, "a malformed plan produced tasks");
    assert_eq!(report.completion_proof.status, CompletionProofStatus::NotProven);
}

/// استنفاد ميزانية نداءات النموذج يوقف العمل قبل أي نداء غير مأذون.
#[test]
fn an_exhausted_model_call_budget_halts_before_unauthorised_work() {
    let mut budget = MissionBudget::conservative();
    // نداء واحد فقط: يكفي للتخطيط ولا يكفي لتنفيذ أي عقدة.
    budget.max_model_calls = 1;
    let (runtime, report) = run(FixtureScenario::MultiAgentVerified, mission("plan a lot", budget, vec![]));

    assert!(matches!(report.stop_reason, Some(StopReason::BudgetExhausted(_))), "{:?}", report.stop_reason);
    assert_eq!(report.model_calls, 1, "a model call happened past the declared budget");
    assert_eq!(report.tasks_succeeded, 0);
    assert_eq!(runtime.mission().completion_proof_status, CompletionProofStatus::NotProven);
}

/// الإلغاء ينتشر: لا جدولة جديدة، والحالة النهائية CANCELLED.
#[test]
fn a_cancelled_mission_stops_scheduling() {
    let mut runtime = MissionRuntime::new(
        mission("long work", MissionBudget::conservative(), vec![]),
        RuntimeClock::deterministic(),
        AgentRegistry::builtin(),
    );
    runtime.cancel();
    let model = FixtureModel::new(FixtureScenario::MultiAgentVerified);
    let report = runtime.run(&model);

    assert_eq!(report.mission_state, MissionState::Cancelled);
    assert_eq!(report.tasks_succeeded, 0, "work continued after cancellation");
    assert!(matches!(report.stop_reason, Some(StopReason::Cancelled)));
}

/// التشغيل حتمي: المدخلات نفسها تعطي المخرجات نفسها، بلا عشوائية.
#[test]
fn the_same_mission_runs_identically_twice() {
    let make = || mission("repeat me", MissionBudget::conservative(), vec![]);
    let (_, first) = run(FixtureScenario::MultiAgentVerified, make());
    let (_, second) = run(FixtureScenario::MultiAgentVerified, make());
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&second).unwrap(),
        "two identical runs diverged"
    );
}

/// الحارس الأهم: وكيل يعلن دليله `RUNTIME_MEASUREMENT` لا يصنع قياسًا.
///
/// السيناريو نفسه الذي يُحقَّق مع مصدر قياس موثوق، يبقى غير محقَّق بدونه — رغم أن
/// النموذج يعيد النوع نفسه حرفيًّا. لو صُدِّق تصنيف الوكيل لحقّق ادّعاءه بنفسه.
#[test]
fn an_agent_cannot_verify_its_own_claim_by_naming_its_evidence_a_measurement() {
    // R-02 (2026-10-12): المتطلَّب يسمّي موضوع الادّعاء الذي يستوفيه (نتيجة خطوة BUILD)، ولا يستوفيه أول ادّعاء محقَّق أيًّا كان.
    let requirement = MissionRequirement::new("BUILD", "produce a correct result", "p03.rule.fact", true);
    let (runtime, report) = run(
        FixtureScenario::SingleAgentVerified,
        mission("summarise the architecture", MissionBudget::conservative(), vec![requirement]),
    );

    assert_eq!(report.claims, 1);
    assert_eq!(report.verified_claims, 0, "an agent verified its own claim by labelling its own evidence");
    assert_eq!(report.completion_proof.status, CompletionProofStatus::NotProven);
    assert_eq!(runtime.mission().requirements[0].status, RequirementStatus::Unverified);

    // الدليل الوحيد المسجَّل هو مخرجات وكيل، مهما سمّاه النموذج.
    assert_eq!(runtime.evidence().len(), 1);
    let recorded = &runtime.evidence()[0];
    assert_eq!(recorded.evidence_type.as_str(), "AGENT_OUTPUT");
    assert_eq!(recorded.provenance.authority.as_str(), "MODEL_GENERATED");
    assert!(!recorded.evidence_type.is_measured(), "model output was recorded as a measurement");
}

/// ومع مصدر قياس موثوق، الادّعاء نفسه يُحقَّق: الفرق هو المصدر لا الصياغة.
#[test]
fn a_trusted_measurement_is_what_makes_the_same_claim_verifiable() {
    // R-02 (2026-10-12): المتطلَّب يسمّي موضوع الادّعاء الذي يستوفيه (نتيجة خطوة BUILD)، ولا يستوفيه أول ادّعاء محقَّق أيًّا كان.
    let requirement = MissionRequirement::new("BUILD", "produce a correct result", "p03.rule.fact", true);
    let (_, report) = run_measured(
        FixtureScenario::SingleAgentVerified,
        mission("summarise the architecture", MissionBudget::conservative(), vec![requirement]),
    );
    assert_eq!(report.verified_claims, 1);
    assert_eq!(report.completion_proof.status, CompletionProofStatus::Proven);
}
