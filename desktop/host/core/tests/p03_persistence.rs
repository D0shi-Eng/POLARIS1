// P03 — الحفظ والاستعادة عبر إعادة التشغيل.
//
// ما يُختبر هنا: أن حالة المهمّة تنجو من إعادة فتح القاعدة كما هي، وأن التعطّل لا
// يُخترع فوقه نجاح (البند 73). عقدة كانت تعمل لا تبقى «تعمل» بعد الإقلاع، ومهمّة
// كانت تنفّذ لا تبقى تدّعي التنفيذ.

use std::sync::Arc;

use polaris_host_core::p03::agent::AgentRegistry;
use polaris_host_core::p03::clock::RuntimeClock;
use polaris_host_core::p03::mission::{
    CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionRequirement, MissionState,
};
use polaris_host_core::p03::model_fixture::{FixtureModel, FixtureScenario};
use polaris_host_core::p03::repository::{MissionRepository, MissionSnapshot};
use polaris_host_core::p03::runtime::MissionRuntime;
use polaris_host_core::p03::task::TaskState;
use polaris_host_core::p03::trust::AuthorityClass;
use polaris_host_core::storage::Database;

fn mission(id: &str) -> Mission {
    Mission {
        mission_id: id.into(),
        project_id: None,
        title: "persisted mission".into(),
        title_authority: AuthorityClass::DirectUserInstruction,
        objective: "produce a verified result".into(),
        origin: MissionOrigin::User,
        execution_mode: ExecutionMode::CoordinatedMultiAgent,
        priority: MissionPriority::Normal,
        state: MissionState::Created,
        completion_proof_status: CompletionProofStatus::NotEvaluated,
        current_revision: 1,
        root_task_id: None,
        budget: MissionBudget::conservative(),
        requirements: vec![MissionRequirement::new("req-1", "a correct result", "p03.rule.fact", true)],
        created_at: "2026-01-01T00:00:00Z".into(),
        started_at: None,
        completed_at: None,
        result_summary: None,
        failure_reason: None,
        version: 1,
    }
}

/// `seed` يمنح كل مهمّة فضاء معرّفات حتميًّا ومتمايزًا، فلا تتصادم مهمّتان في اختبار واحد.
fn executed_snapshot_seeded(id: &str, seed: u64) -> MissionSnapshot {
    let mut runtime = MissionRuntime::new(mission(id), RuntimeClock::deterministic_seeded(seed), AgentRegistry::builtin());
    let model = FixtureModel::new(FixtureScenario::MultiAgentVerified);
    runtime.run(&model);
    MissionSnapshot {
        mission: runtime.mission().clone(),
        graph: runtime.graph().clone(),
        agents: runtime.agents().to_vec(),
        claims: runtime.claims().to_vec(),
        evidence: runtime.evidence().to_vec(),
        messages: runtime.messages().to_vec(),
        reviews: runtime.reviews().to_vec(),
        runtime: runtime.runtime_state(),
    }
}

fn executed_snapshot(id: &str) -> MissionSnapshot {
    executed_snapshot_seeded(id, 1)
}

#[test]
fn a_mission_survives_a_save_and_load_round_trip() {
    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db);
    let saved = executed_snapshot("11111111-1111-4111-8111-111111111111");
    repo.save(&saved).unwrap();

    let loaded = repo.load(&saved.mission.mission_id).unwrap();
    assert_eq!(loaded.mission.state, saved.mission.state);
    assert_eq!(loaded.mission.completion_proof_status, saved.mission.completion_proof_status);
    assert_eq!(loaded.mission.requirements.len(), saved.mission.requirements.len());
    assert_eq!(loaded.mission.requirements[0].status, saved.mission.requirements[0].status);
    assert_eq!(loaded.graph.len(), saved.graph.len());
    assert_eq!(loaded.graph.revision, saved.graph.revision);
    assert_eq!(loaded.agents.len(), saved.agents.len());
    assert_eq!(loaded.claims.len(), saved.claims.len());
    assert_eq!(loaded.evidence.len(), saved.evidence.len());
    // التبعيات نجت، فترتيب التنفيذ يبقى قابلًا لإعادة الاشتقاق.
    let saved_edges: usize = saved.graph.nodes().map(|n| n.dependencies.len()).sum();
    let loaded_edges: usize = loaded.graph.nodes().map(|n| n.dependencies.len()).sum();
    assert_eq!(loaded_edges, saved_edges);
}

#[test]
fn claim_status_and_evidence_lineage_survive_the_round_trip() {
    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db);
    let saved = executed_snapshot("22222222-2222-4222-8222-222222222222");
    repo.save(&saved).unwrap();
    let loaded = repo.load(&saved.mission.mission_id).unwrap();

    for original in &saved.claims {
        let restored = loaded.claims.iter().find(|c| c.claim_id == original.claim_id).expect("claim vanished");
        assert_eq!(restored.status, original.status, "a claim status changed across persistence");
        assert_eq!(restored.evidence_refs.len(), original.evidence_refs.len());
        // التلوّث لا يُغسل بالحفظ.
        assert_eq!(restored.taint, original.taint, "taint was lost across persistence");
    }
    for original in &saved.evidence {
        let restored = loaded.evidence.iter().find(|e| e.evidence_id == original.evidence_id).expect("evidence vanished");
        assert_eq!(restored.provenance.lineage, original.provenance.lineage, "lineage was lost");
        assert_eq!(restored.provenance.authority, original.provenance.authority);
    }
}

#[test]
fn a_crash_never_invents_success() {
    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db);
    // لقطة تحاكي تعطّلًا: المهمّة تعمل وعقدة قيد التنفيذ.
    let mut snapshot = executed_snapshot("33333333-3333-4333-8333-333333333333");
    snapshot.mission.state = MissionState::Running;
    snapshot.mission.completion_proof_status = CompletionProofStatus::NotEvaluated;
    let first = snapshot.graph.nodes().next().unwrap().task_id.clone();
    snapshot.graph.set_state(&first, TaskState::Running).unwrap();
    repo.save(&snapshot).unwrap();

    let report = repo.recover_after_restart().unwrap();
    assert!(report.tasks_interrupted >= 1, "a running task stayed running after restart");
    assert_eq!(report.missions_blocked, 1);

    let recovered = repo.load(&snapshot.mission.mission_id).unwrap();
    assert_eq!(recovered.mission.state, MissionState::Blocked, "a mission kept claiming execution after a crash");
    let task = recovered.graph.get(&first).unwrap();
    assert_eq!(task.state, TaskState::Interrupted);
    assert_ne!(task.state, TaskState::Succeeded, "a crash produced a succeeded task");
    // الإثبات لم يُرقَّ بالتعطّل.
    assert_ne!(recovered.mission.completion_proof_status, CompletionProofStatus::Proven);
}

#[test]
fn the_mission_list_is_deterministic_and_counts_real_tasks() {
    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db);
    repo.save(&executed_snapshot_seeded("44444444-4444-4444-8444-444444444444", 1_000)).unwrap();
    repo.save(&executed_snapshot_seeded("55555555-5555-4555-8555-555555555555", 2_000)).unwrap();

    let first = repo.list().unwrap();
    let again = repo.list().unwrap();
    assert_eq!(first, again, "the mission list is not deterministic");
    assert_eq!(first.len(), 2);
    for row in &first {
        assert_eq!(row.task_count, 4);
        assert_eq!(row.tasks_succeeded, 4);
    }
}

#[test]
fn loading_an_unknown_mission_is_not_found_rather_than_an_empty_mission() {
    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db);
    let error = repo.load("99999999-9999-4999-8999-999999999999").unwrap_err();
    assert!(matches!(error, polaris_host_core::storage::StorageError::NotFound), "{error:?}");
}

// قِيس 2026-10-05: جدولا المراجعات ورسائل الوكلاء بلا صفّ واحد في بيانات المالك رغم مراجعات REVISE حدثت؛
// لا كود كان يكتب فيهما. الأحكام والرسائل تُحفظ الآن مع لقطة التشغيل، ولقطة لاحقة بلا رسائل لا تمحوها.
#[test]
fn reviews_and_agent_messages_are_written_with_the_run_and_never_erased_by_a_later_snapshot() {
    let db = Arc::new(Database::in_memory().unwrap());
    let repo = MissionRepository::new(db.clone());
    let mut runtime = MissionRuntime::new(mission("22222222-2222-4222-8222-222222222222"), RuntimeClock::deterministic_seeded(7), AgentRegistry::builtin());
    runtime.run(&FixtureModel::new(FixtureScenario::ReviewThenAccept));
    assert!(runtime.reviews().len() >= 2, "the fixture reviews twice (REVISE then ACCEPT): {:?}", runtime.reviews());
    let snapshot = MissionSnapshot {
        mission: runtime.mission().clone(),
        graph: runtime.graph().clone(),
        agents: runtime.agents().to_vec(),
        claims: runtime.claims().to_vec(),
        evidence: runtime.evidence().to_vec(),
        messages: runtime.messages().to_vec(),
        reviews: runtime.reviews().to_vec(),
        runtime: runtime.runtime_state(),
    };
    repo.save(&snapshot).unwrap();
    let count = |table: &str| -> i64 {
        db.with(|conn| Ok(conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get::<_, i64>(0))?)).unwrap()
    };
    assert_eq!(count("reviews"), runtime.reviews().len() as i64);
    assert_eq!(count("agent_messages"), runtime.messages().len() as i64);
    let verdicts: Vec<String> = db.with(|conn| {
        let mut st = conn.prepare("SELECT verdict FROM reviews ORDER BY round")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }).unwrap();
    assert_eq!(verdicts.first().map(String::as_str), Some("REVISE"));
    // لقطة لاحقة (استئناف مثلًا) بلا رسائل ولا أحكام لا تمحو ما حُفظ.
    repo.save(&MissionSnapshot { messages: Vec::new(), reviews: Vec::new(), ..snapshot }).unwrap();
    assert_eq!(count("reviews"), runtime.reviews().len() as i64);
}
