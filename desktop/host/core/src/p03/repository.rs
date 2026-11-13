// حفظ حالة المهمّة واستعادتها.
//
// لا مخزن ثانٍ (البند 71): جداول Phase-03 تعيش في قاعدة المنتَج نفسها. ولا يُخترع
// نجاح بعد تعطّل (البند 73): عقدة كانت RUNNING عند الإقلاع تصير INTERRUPTED، ثم
// يقرّر المنسّق. لا سرّ ولا سياق كامل يُخزَّن هنا (البند 72).

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::storage::{Database, StorageError};

use super::agent::{AgentInstance, AgentRole, AgentState};
use super::claim::{Claim, ClaimStatus, ClaimSubject, ClaimType};
use super::evidence::{EvidenceItem, EvidenceType, MeasurementKind, Provenance};
use super::graph::TaskGraph;
use super::message::{AgentMessage, MessageType, Recipient};
use super::runtime_state::RuntimeState;
use super::runtime::ReviewRecord;
use super::mission::{
    CompletionProofStatus, ExecutionMode, Mission, MissionBudget, MissionOrigin, MissionPriority, MissionRequirement, MissionState,
    RequirementStatus,
};
use super::task::{Dependency, DependencyKind, TaskNode, TaskState, TaskType};
use super::trust::AuthorityClass;

/// إصلاح ثابت حالة واحد عند الإقلاع: المهمّة، والثابت الذي أُصلح، وعدد الخطوات التي مسّها.
pub type InvariantRepair = (String, String, u32);

/// لقطة كاملة لمهمّة: ما يُحفظ وما يُستعاد معًا.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissionSnapshot {
    pub mission: Mission,
    pub graph: TaskGraph,
    pub agents: Vec<AgentInstance>,
    pub claims: Vec<Claim>,
    pub evidence: Vec<EvidenceItem>,
    /// رسائل الوكلاء على الناقل وأحكام المراجعة. تُضاف ولا تُمحى: لقطة لاحقة بلا رسائل لا تمسح ما حُفظ.
    pub messages: Vec<AgentMessage>,
    pub reviews: Vec<ReviewRecord>,
    /// حالة التشغيل التراكمية والإثبات المحسوم (R-07، R-03). تُحفظ في المعاملة نفسها وتُستعاد معها.
    pub runtime: RuntimeState,
}

/// سطر ملخّص لقائمة المهام.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MissionSummary {
    pub mission_id: String,
    pub title: String,
    pub state: MissionState,
    pub completion_proof_status: CompletionProofStatus,
    pub created_at: String,
    pub task_count: u32,
    pub tasks_succeeded: u32,
}

/// ما فعلته الاستعادة بعد الإقلاع.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecoveryReport {
    pub tasks_interrupted: u32,
    pub missions_blocked: u32,
}

/// زمن كتابة صفوف الأدلة داخل معاملة الحفظ، يُقرأ في مسار القياس الأصلي.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EvidenceWriteTimings {
    pub saves: u64,
    pub rows: u64,
    pub micros_total: u64,
}

pub struct MissionRepository {
    db: Arc<Database>,
    evidence_timings: std::sync::Mutex<EvidenceWriteTimings>,
}

impl MissionRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db, evidence_timings: std::sync::Mutex::new(EvidenceWriteTimings::default()) }
    }

    pub fn evidence_timings(&self) -> EvidenceWriteTimings {
        self.evidence_timings.lock().map(|t| *t).unwrap_or_default()
    }

    /// يحفظ لقطة كاملة داخل معاملة واحدة. إمّا تُكتب كلها أو لا شيء (البند 141).
    pub fn save(&self, snapshot: &MissionSnapshot) -> Result<(), StorageError> {
        // ثابت الصدق (E-2، تدقيق 2026-10-19): «مكتملة» بخطوة فاشلة أو محجوبة أو منقطعة تُحفظ بالحالة التي تقولها خطواتها،
        // وإثباتها NOT_PROVEN. يسبق إغلاقَ الخطوات المفتوحة: الحالة المصحَّحة هي ما يُغلق عليه.
        let mut normalized = std::borrow::Cow::Borrowed(snapshot);
        if let Some((state, reason)) = crate::p03::truth::unfinished_completion(snapshot.mission.state, &snapshot.graph) {
            let fixed = normalized.to_mut();
            fixed.mission.state = state;
            fixed.mission.failure_reason = Some(reason.chars().take(crate::p03::runtime::FAILURE_REASON_MAX_CHARS).collect());
            if state == MissionState::Blocked {
                fixed.mission.completed_at = None;
            }
            fixed.mission.completion_proof_status = CompletionProofStatus::NotProven;
            if let Some(proof) = fixed.runtime.proof.as_mut() {
                proof.status = CompletionProofStatus::NotProven;
            }
        }
        // ثابت الحالة عند كل حفظ (خطة 2026-10-07، ADR-041 §3.3): مهمّة نهائية لا تُحفظ بخطوة مفتوحة، أيًّا كان الكاتب
        // (التشغيل، أو الإلغاء خارجه، أو غيرهما). قِيس في قاعدة المالك: COMPLETED بخطوتين PENDING، وCANCELLED بجذر PENDING.
        if normalized.mission.state.is_terminal() && normalized.graph.nodes().any(|n| n.state.is_open()) {
            let fixed = normalized.to_mut();
            crate::p03::truth::close_open_steps(fixed.mission.state, &mut fixed.graph);
        }
        self.save_exact(&normalized)
    }

    /// يغلق خطوات دورٍ محجوب تجاوزته المحادثة (E-3، تدقيق 2026-10-19): المستخدم أرسل رسالة بعده، فأنشأت دورًا جديدًا، ولا
    /// مسار في المنتج يستأنف الدور السابق. خطواته المفتوحة والمنقطعة تُغلق CANCELLED بسبب مكتوب، والمهمّة تبقى BLOCKED كما
    /// انتهت: لا يُخترع إنجاز ولا يُعاد تشغيل شيء. الشرط على حالة المهمّة داخل الجملة نفسها، فلا يمسّ مهمّة عادت إلى العمل.
    /// متكرّر بلا أثر ثانٍ: يعيد عدد ما أغلقه الآن.
    pub fn close_superseded_steps(&self, mission_id: &str) -> Result<u32, StorageError> {
        self.db.with(|conn| {
            let n = conn.execute(
                "UPDATE tasks SET state = 'CANCELLED', version = version + 1,
                    failure_reason = substr('closed: the conversation continued with a new message while this blocked step was ' || state, 1, 400)
                 WHERE mission_id = ?1 AND state IN ('PENDING', 'READY', 'ASSIGNED', 'RUNNING', 'WAITING', 'REVIEW', 'INTERRUPTED')
                   AND EXISTS (SELECT 1 FROM missions m WHERE m.mission_id = ?1 AND m.state = 'BLOCKED')",
                params![mission_id],
            )?;
            Ok(n as u32)
        })
    }

    fn save_exact(&self, snapshot: &MissionSnapshot) -> Result<(), StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction().map_err(|e| StorageError::Query(e.to_string()))?;
            let m = &snapshot.mission;
            let budget_json = serde_json::to_string(&m.budget).map_err(|e| StorageError::Invalid(e.to_string()))?;
            tx.execute(
                "INSERT INTO missions (mission_id, project_id, title, title_authority, objective, origin, execution_mode, priority, state, completion_proof_status, current_revision, root_task_id, budget_json, result_summary, failure_reason, created_at, started_at, completed_at, version)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
                 ON CONFLICT (mission_id) DO UPDATE SET
                   title=excluded.title, state=excluded.state, completion_proof_status=excluded.completion_proof_status,
                   current_revision=excluded.current_revision, root_task_id=excluded.root_task_id, budget_json=excluded.budget_json,
                   result_summary=excluded.result_summary, failure_reason=excluded.failure_reason,
                   started_at=excluded.started_at, completed_at=excluded.completed_at, version=excluded.version",
                params![
                    m.mission_id, m.project_id, m.title, m.title_authority.as_str(), m.objective,
                    origin_str(m.origin), mode_str(m.execution_mode), priority_str(m.priority),
                    m.state.as_str(), m.completion_proof_status.as_str(), m.current_revision,
                    m.root_task_id, budget_json, m.result_summary, m.failure_reason,
                    m.created_at, m.started_at, m.completed_at, m.version
                ],
            )?;

            // المتطلَّبات والرسم والوكلاء والادّعاءات تُكتب من جديد لهذه المهمّة.
            tx.execute("DELETE FROM mission_requirements WHERE mission_id = ?1", params![m.mission_id])?;
            for (ordinal, r) in m.requirements.iter().enumerate() {
                tx.execute(
                    "INSERT INTO mission_requirements VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![r.requirement_id, m.mission_id, r.text, r.verification_rule_id, r.mandatory as i64, req_status_str(r.status), r.claim_ref, ordinal as i64],
                )?;
            }

            tx.execute("DELETE FROM task_dependencies WHERE mission_id = ?1", params![m.mission_id])?;
            tx.execute("DELETE FROM tasks WHERE mission_id = ?1", params![m.mission_id])?;
            for (ordinal, node) in snapshot.graph.nodes().enumerate() {
                tx.execute(
                    "INSERT INTO tasks VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                    params![
                        node.task_id, node.mission_id, node.parent_task_id, node.title, node.objective,
                        node.task_type.as_str(), node.state.as_str(), node.assigned_agent_id,
                        node.attempt, node.max_attempts, node.failure_reason,
                        snapshot.graph.revision, ordinal as i64, node.version
                    ],
                )?;
            }
            for node in snapshot.graph.nodes() {
                for dep in &node.dependencies {
                    tx.execute(
                        "INSERT INTO task_dependencies VALUES (?1,?2,?3,?4)",
                        params![m.mission_id, node.task_id, dep.task_id, dep_kind_str(dep.kind)],
                    )?;
                }
            }

            tx.execute("DELETE FROM agent_instances WHERE mission_id = ?1", params![m.mission_id])?;
            for a in &snapshot.agents {
                tx.execute(
                    "INSERT INTO agent_instances (agent_id, mission_id, role, model_id, state, delegation_depth, parent_agent_id, current_task_id, created_at, last_active_at, definition_id, definition_version) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        a.agent_id, a.mission_id, a.role.as_str(), a.model_id, a.state.as_str(), a.delegation_depth, a.parent_agent_id, a.current_task_id, a.created_at, a.last_active_at,
                        a.definition.as_ref().map(|d| d.0.clone()), a.definition.as_ref().map(|d| d.1.clone())
                    ],
                )?;
            }

            tx.execute("DELETE FROM claim_evidence WHERE claim_id IN (SELECT claim_id FROM claims WHERE mission_id = ?1)", params![m.mission_id])?;
            tx.execute("DELETE FROM claims WHERE mission_id = ?1", params![m.mission_id])?;
            let evidence_began = std::time::Instant::now();
            tx.execute("DELETE FROM evidence WHERE mission_id = ?1", params![m.mission_id])?;
            for e in &snapshot.evidence {
                let lineage = serde_json::to_string(&e.provenance.lineage).map_err(|x| StorageError::Invalid(x.to_string()))?;
                let taint = serde_json::to_string(&e.taint).map_err(|x| StorageError::Invalid(x.to_string()))?;
                tx.execute(
                    "INSERT INTO evidence VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        e.evidence_id, e.mission_id, e.evidence_type.as_str(), e.digest,
                        e.provenance.producer, e.provenance.authority.as_str(), e.provenance.source_ref,
                        lineage, measurement_str(e.provenance.measurement_kind), taint, e.summary, e.created_at
                    ],
                )?;
            }
            if let Ok(mut t) = self.evidence_timings.lock() {
                t.saves += 1;
                t.rows += snapshot.evidence.len() as u64;
                t.micros_total += evidence_began.elapsed().as_micros() as u64;
            }
            for c in &snapshot.claims {
                let taint = serde_json::to_string(&c.taint).map_err(|x| StorageError::Invalid(x.to_string()))?;
                let (subject, property, value) = match &c.subject {
                    Some(s) => (Some(s.subject.clone()), Some(s.property.clone()), Some(s.value.clone())),
                    None => (None, None, None),
                };
                tx.execute(
                    "INSERT INTO claims VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                    params![
                        c.claim_id, c.mission_id, c.task_id, c.agent_id, c.statement,
                        c.claim_type.as_str(), c.status.as_str(), subject, property, value,
                        taint, c.verification_required as i64, c.revision, c.created_at
                    ],
                )?;
                for id in &c.evidence_refs {
                    tx.execute("INSERT OR IGNORE INTO claim_evidence VALUES (?1,?2,'SUPPORTS')", params![c.claim_id, id])?;
                }
                for id in &c.counterevidence_refs {
                    tx.execute("INSERT OR IGNORE INTO claim_evidence VALUES (?1,?2,'COUNTERS')", params![c.claim_id, id])?;
                }
            }

            // رسائل الوكلاء وأحكام المراجعة تُضاف بمعرّفها (لا حذف): الحذف الوحيد مسار الإزالة الصريح (purge).
            // الأعمدة تُسمّى صراحةً (R-12، 2026-10-12): v17 أضاف `session_id` و`span_id` إلى الجدول، فكان الإدراج بلا أسماء أعمدة
            // يفشل لكل لقطة فيها رسالة، ويُسقط حفظ المهمّة كلها.
            for msg in &snapshot.messages {
                let (kind, recipient) = match &msg.recipient {
                    Recipient::Agent(id) => ("AGENT", Some(id.clone())),
                    Recipient::Coordinator => ("COORDINATOR", None),
                };
                let taint = serde_json::to_string(&msg.taint).map_err(|x| StorageError::Invalid(x.to_string()))?;
                let payload: String = msg.payload.chars().take(16_384).collect();
                tx.execute(
                    "INSERT OR IGNORE INTO agent_messages (message_id, mission_id, sender_agent_id, recipient_kind, recipient_id, message_type, causation_id, correlation_id, payload, taint_json, authority, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                    params![
                        msg.message_id, m.mission_id, msg.sender_agent_id, kind, recipient, msg.message_type.as_str(), msg.causation_id, msg.correlation_id, payload, taint,
                        msg.authority.as_str(), msg.created_at
                    ],
                )?;
            }
            for r in &snapshot.reviews {
                tx.execute(
                    "INSERT OR IGNORE INTO reviews (review_id, mission_id, task_id, reviewer_agent, verdict, independence, round, notes, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![r.review_id, m.mission_id, r.task_id, r.reviewer_agent, r.verdict, r.independence, r.round as i64, r.notes, r.created_at],
                )?;
            }

            let state_json = serde_json::to_string(&snapshot.runtime).map_err(|e| StorageError::Invalid(e.to_string()))?;
            tx.execute(
                "INSERT INTO mission_runtime_state (mission_id, state_json, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (mission_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
                params![m.mission_id, state_json, crate::time::now_rfc3339_utc()],
            )?;

            tx.commit().map_err(|e| StorageError::Query(e.to_string()))?;
            Ok(())
        })
    }

    /// يقرأ لقطة كاملة. مهمّة غائبة ليست لقطة فارغة بل `NotFound`.
    pub fn load(&self, mission_id: &str) -> Result<MissionSnapshot, StorageError> {
        self.db.with(|conn| {
            let mission = conn.query_row(
                "SELECT project_id, title, title_authority, objective, origin, execution_mode, priority, state, completion_proof_status, current_revision, root_task_id, budget_json, result_summary, failure_reason, created_at, started_at, completed_at, version FROM missions WHERE mission_id = ?1",
                params![mission_id],
                |row| {
                    let budget_json: String = row.get(11)?;
                    Ok(Mission {
                        mission_id: mission_id.to_string(),
                        project_id: row.get(0)?,
                        title: row.get(1)?,
                        title_authority: authority_from(&row.get::<_, String>(2)?),
                        objective: row.get(3)?,
                        origin: origin_from(&row.get::<_, String>(4)?),
                        execution_mode: mode_from(&row.get::<_, String>(5)?),
                        priority: priority_from(&row.get::<_, String>(6)?),
                        state: mission_state_from(&row.get::<_, String>(7)?),
                        completion_proof_status: proof_from(&row.get::<_, String>(8)?),
                        current_revision: row.get(9)?,
                        root_task_id: row.get(10)?,
                        budget: serde_json::from_str::<MissionBudget>(&budget_json).unwrap_or_else(|_| MissionBudget::conservative()),
                        requirements: Vec::new(),
                        result_summary: row.get(12)?,
                        failure_reason: row.get(13)?,
                        created_at: row.get(14)?,
                        started_at: row.get(15)?,
                        completed_at: row.get(16)?,
                        version: row.get(17)?,
                    })
                },
            )?;
            let mut mission = mission;

            let mut stmt = conn.prepare("SELECT requirement_id, text, verification_rule_id, mandatory, status, claim_ref FROM mission_requirements WHERE mission_id = ?1 ORDER BY ordinal")?;
            let rows = stmt.query_map(params![mission_id], |row| {
                Ok(MissionRequirement {
                    requirement_id: row.get(0)?,
                    text: row.get(1)?,
                    verification_rule_id: row.get(2)?,
                    mandatory: row.get::<_, i64>(3)? == 1,
                    status: req_status_from(&row.get::<_, String>(4)?),
                    claim_ref: row.get(5)?,
                    evidence_refs: Vec::new(),
                })
            })?;
            for r in rows {
                mission.requirements.push(r?);
            }

            // الرسم: العُقد بترتيبها المحفوظ، ثم حوافّها.
            let mut revision: u32 = 0;
            let mut nodes: Vec<TaskNode> = Vec::new();
            {
                let mut stmt = conn.prepare("SELECT task_id, parent_task_id, title, objective, task_type, state, assigned_agent_id, attempt, max_attempts, failure_reason, graph_revision, version FROM tasks WHERE mission_id = ?1 ORDER BY ordinal")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    let rev: u32 = row.get(10)?;
                    Ok((
                        rev,
                        TaskNode {
                            task_id: row.get(0)?,
                            mission_id: mission_id.to_string(),
                            parent_task_id: row.get(1)?,
                            title: row.get(2)?,
                            objective: row.get(3)?,
                            task_type: task_type_from(&row.get::<_, String>(4)?),
                            state: task_state_from(&row.get::<_, String>(5)?),
                            assigned_agent_id: row.get(6)?,
                            dependencies: Vec::new(),
                            required_capabilities: Vec::new(),
                            input_refs: Vec::new(),
                            output_refs: Vec::new(),
                            claim_ids: Vec::new(),
                            attempt: row.get(7)?,
                            max_attempts: row.get(8)?,
                            failure_reason: row.get(9)?,
                            version: row.get(11)?,
                        },
                    ))
                })?;
                for r in rows {
                    let (rev, node) = r?;
                    revision = revision.max(rev);
                    nodes.push(node);
                }
            }
            {
                let mut stmt = conn.prepare("SELECT task_id, depends_on, kind FROM task_dependencies WHERE mission_id = ?1 ORDER BY task_id, depends_on")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                })?;
                for r in rows {
                    let (task_id, depends_on, kind) = r?;
                    if let Some(node) = nodes.iter_mut().find(|n| n.task_id == task_id) {
                        node.dependencies.push(Dependency { task_id: depends_on, kind: dep_kind_from(&kind) });
                    }
                }
            }
            let graph = TaskGraph::restore(mission_id, nodes, revision)
                .map_err(|e| StorageError::Invalid(format!("stored task graph is invalid: {e:?}")))?;

            let mut agents = Vec::new();
            {
                let mut stmt = conn.prepare("SELECT agent_id, role, model_id, state, delegation_depth, parent_agent_id, current_task_id, created_at, last_active_at, definition_id, definition_version FROM agent_instances WHERE mission_id = ?1 ORDER BY created_at, agent_id")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    Ok(AgentInstance {
                        agent_id: row.get(0)?,
                        mission_id: mission_id.to_string(),
                        role: role_from(&row.get::<_, String>(1)?),
                        model_id: row.get(2)?,
                        state: agent_state_from(&row.get::<_, String>(3)?),
                        delegation_depth: row.get(4)?,
                        parent_agent_id: row.get(5)?,
                        current_task_id: row.get(6)?,
                        output_refs: Vec::new(),
                        created_at: row.get(7)?,
                        last_active_at: row.get(8)?,
                        definition: match (row.get::<_, Option<String>>(9)?, row.get::<_, Option<String>>(10)?) {
                            (Some(id), Some(version)) => Some((id, version)),
                            _ => None,
                        },
                    })
                })?;
                for a in rows {
                    agents.push(a?);
                }
            }

            let mut evidence = Vec::new();
            {
                let mut stmt = conn.prepare("SELECT evidence_id, evidence_type, digest, producer, authority, source_ref, lineage_json, measurement_kind, taint_json, summary, created_at FROM evidence WHERE mission_id = ?1 ORDER BY created_at, evidence_id")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    let lineage: String = row.get(6)?;
                    let taint: String = row.get(8)?;
                    Ok(EvidenceItem {
                        evidence_id: row.get(0)?,
                        mission_id: mission_id.to_string(),
                        evidence_type: evidence_type_from(&row.get::<_, String>(1)?),
                        created_at: row.get(10)?,
                        digest: row.get(2)?,
                        provenance: Provenance {
                            producer: row.get(3)?,
                            authority: authority_from(&row.get::<_, String>(4)?),
                            source_ref: row.get(5)?,
                            lineage: serde_json::from_str(&lineage).unwrap_or_default(),
                            measurement_kind: measurement_from(&row.get::<_, String>(7)?),
                        },
                        taint: serde_json::from_str(&taint).unwrap_or_default(),
                        summary: row.get(9)?,
                    })
                })?;
                for e in rows {
                    evidence.push(e?);
                }
            }

            let mut claims: Vec<Claim> = Vec::new();
            {
                let mut stmt = conn.prepare("SELECT claim_id, task_id, agent_id, statement, claim_type, status, subject, property, value, taint_json, verification_required, revision, created_at FROM claims WHERE mission_id = ?1 ORDER BY created_at, claim_id")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    let taint: String = row.get(9)?;
                    let subject: Option<String> = row.get(6)?;
                    let property: Option<String> = row.get(7)?;
                    let value: Option<String> = row.get(8)?;
                    Ok(Claim {
                        claim_id: row.get(0)?,
                        mission_id: mission_id.to_string(),
                        task_id: row.get(1)?,
                        agent_id: row.get(2)?,
                        statement: row.get(3)?,
                        claim_type: claim_type_from(&row.get::<_, String>(4)?),
                        status: claim_status_from(&row.get::<_, String>(5)?),
                        subject: match (subject, property, value) {
                            (Some(s), Some(p), Some(v)) => Some(ClaimSubject { subject: s, property: p, value: v }),
                            _ => None,
                        },
                        evidence_refs: Vec::new(),
                        counterevidence_refs: Vec::new(),
                        taint: serde_json::from_str(&taint).unwrap_or_default(),
                        verification_required: row.get::<_, i64>(10)? == 1,
                        revision: row.get(11)?,
                        created_at: row.get(12)?,
                    })
                })?;
                for c in rows {
                    claims.push(c?);
                }
            }
            {
                let mut stmt = conn.prepare("SELECT ce.claim_id, ce.evidence_id, ce.stance FROM claim_evidence ce JOIN claims c ON c.claim_id = ce.claim_id WHERE c.mission_id = ?1 ORDER BY ce.claim_id, ce.evidence_id")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                })?;
                for r in rows {
                    let (claim_id, evidence_id, stance) = r?;
                    if let Some(claim) = claims.iter_mut().find(|c| c.claim_id == claim_id) {
                        if stance == "SUPPORTS" {
                            claim.evidence_refs.push(evidence_id);
                        } else {
                            claim.counterevidence_refs.push(evidence_id);
                        }
                    }
                }
            }

            // الرسائل وأحكام المراجعة تُقرأ مع اللقطة: لقطة بلا هذه الصفوف كانت تُبنى عليها حالة استئناف ناقصة (R-01).
            let mut messages = Vec::new();
            {
                let mut stmt = conn.prepare("SELECT message_id, sender_agent_id, recipient_kind, recipient_id, message_type, causation_id, correlation_id, payload, taint_json, authority, created_at FROM agent_messages WHERE mission_id = ?1 ORDER BY created_at, rowid")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    let kind: String = row.get(2)?;
                    let recipient_id: Option<String> = row.get(3)?;
                    let taint: String = row.get(8)?;
                    Ok(AgentMessage {
                        message_id: row.get(0)?,
                        mission_id: mission_id.to_string(),
                        sender_agent_id: row.get(1)?,
                        recipient: match (kind.as_str(), recipient_id) {
                            ("AGENT", Some(id)) => Recipient::Agent(id),
                            _ => Recipient::Coordinator,
                        },
                        message_type: message_type_from(&row.get::<_, String>(4)?),
                        causation_id: row.get(5)?,
                        correlation_id: row.get(6)?,
                        payload: row.get(7)?,
                        taint: serde_json::from_str(&taint).unwrap_or_default(),
                        authority: authority_from(&row.get::<_, String>(9)?),
                        created_at: row.get(10)?,
                    })
                })?;
                for m in rows {
                    messages.push(m?);
                }
            }
            let mut reviews = Vec::new();
            {
                let mut stmt = conn.prepare("SELECT review_id, task_id, reviewer_agent, verdict, independence, round, notes, created_at FROM reviews WHERE mission_id = ?1 ORDER BY created_at, rowid")?;
                let rows = stmt.query_map(params![mission_id], |row| {
                    Ok(ReviewRecord {
                        review_id: row.get(0)?,
                        task_id: row.get(1)?,
                        reviewer_agent: row.get(2)?,
                        verdict: verdict_from(&row.get::<_, String>(3)?),
                        independence: independence_from(&row.get::<_, String>(4)?),
                        round: row.get::<_, i64>(5)? as u32,
                        notes: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                })?;
                for r in rows {
                    reviews.push(r?);
                }
            }
            // حالة تشغيل تالفة أو أحدث من البناء خطأ صريح: الاستئناف عليها بحالة فارغة يمنح ميزانية جديدة صامتًا.
            let state_json: Option<String> = conn
                .query_row("SELECT state_json FROM mission_runtime_state WHERE mission_id = ?1", params![mission_id], |r| r.get(0))
                .map(Some)
                .or_else(|e| if matches!(e, rusqlite::Error::QueryReturnedNoRows) { Ok(None) } else { Err(e) })?;
            let runtime = RuntimeState::parse(state_json.as_deref()).map_err(StorageError::Invalid)?;

            Ok(MissionSnapshot { mission, graph, agents, claims, evidence, messages, reviews, runtime })
        })
    }

    /// قائمة المهام بترتيب حتمي: الأحدث أولًا ثم بالمعرّف.
    pub fn list(&self) -> Result<Vec<MissionSummary>, StorageError> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT m.mission_id, m.title, m.state, m.completion_proof_status, m.created_at,
                        (SELECT count(*) FROM tasks t WHERE t.mission_id = m.mission_id),
                        (SELECT count(*) FROM tasks t WHERE t.mission_id = m.mission_id AND t.state = 'SUCCEEDED')
                 FROM missions m ORDER BY m.created_at DESC, m.mission_id",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(MissionSummary {
                    mission_id: row.get(0)?,
                    title: row.get(1)?,
                    state: mission_state_from(&row.get::<_, String>(2)?),
                    completion_proof_status: proof_from(&row.get::<_, String>(3)?),
                    created_at: row.get(4)?,
                    task_count: row.get::<_, i64>(5)? as u32,
                    tasks_succeeded: row.get::<_, i64>(6)? as u32,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
    }

    /// استعادة بعد إقلاع: لا عقدة تبقى RUNNING، ولا مهمّة تبقى تدّعي التنفيذ.
    /// لا يُخترع إنجاز: الحالة تصير INTERRUPTED/BLOCKED ليقرّر المنسّق (البند 73).
    /// يسجّل أن تشغيل المهمّة بدأ الآن (PLANNING ووقت البدء) لمهمّة ما زالت CREATED وحدها.
    ///
    /// قِيس على جهاز المالك (2026-10-01): اللقطة لا تُحفظ إلا عند انتهاء التشغيل، فتبقى المهمّة
    /// «لم تبدأ» في القاعدة والشاشة طوال عمل النموذج. الحالة الحيّة تُكتب هنا، واللقطة النهائية تكتب
    /// ما حُسم كما كانت. وإن انقطع التشغيل فالاستعادة بعد الإقلاع تحوّل PLANNING إلى BLOCKED.
    pub fn mark_started(&self, mission_id: &str, started_at: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| {
            let n = conn.execute(
                "UPDATE missions SET state = 'PLANNING', started_at = COALESCE(started_at, ?2) WHERE mission_id = ?1 AND state = 'CREATED'",
                params![mission_id, started_at],
            )?;
            Ok(n == 1)
        })
    }

    /// عنوان العرض فقط، دون لمس الحالة أو الهدف. يُستعمل لعنوان محادثة اقترحه المخطّط.
    pub fn set_title(&self, mission_id: &str, title: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| Ok(conn.execute("UPDATE missions SET title = ?2 WHERE mission_id = ?1", params![mission_id, title])? == 1))
    }

    /// ثوابت الحالة عند الإقلاع (ADR-041 §3.3): لا مهمّة تعمل بعدُ (لا عملية حيّة قبل أن يبدأ أيّ تشغيل)، ولا مهمّة نهائية
    /// بخطوة مفتوحة. يعيد ما أصلحه لكل مهمّة، ليُكتب تدقيقًا.
    pub fn boot_invariants(&self) -> Result<(RecoveryReport, Vec<InvariantRepair>), StorageError> {
        let recovery = self.recover_after_restart()?;
        let repaired = self.db.with(|conn| {
            let tx = conn.transaction().map_err(|e| StorageError::Query(e.to_string()))?;
            let rows: Vec<(String, String, u32)> = {
                let mut stmt = tx.prepare(
                    "SELECT m.mission_id, m.state, count(*) FROM missions m JOIN tasks t ON t.mission_id = m.mission_id
                     WHERE m.state IN ('COMPLETED', 'FAILED', 'CANCELLED') AND t.state IN ('PENDING', 'READY', 'ASSIGNED', 'RUNNING', 'WAITING', 'REVIEW')
                     GROUP BY m.mission_id, m.state",
                )?;
                let mapped = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? as u32)))?;
                mapped.collect::<Result<Vec<_>, _>>()?
            };
            for (mission_id, state, _) in &rows {
                tx.execute(
                    "UPDATE tasks SET state = 'CANCELLED', version = version + 1,
                        failure_reason = substr('closed at boot by the state invariant: the mission ended ' || ?2 || ' while this step was ' || state, 1, 400)
                     WHERE mission_id = ?1 AND state IN ('PENDING', 'READY', 'ASSIGNED', 'RUNNING', 'WAITING', 'REVIEW')",
                    params![mission_id, state],
                )?;
            }
            tx.commit().map_err(|e| StorageError::Query(e.to_string()))?;
            Ok(rows)
        })?;
        Ok((recovery, repaired))
    }

    /// ثابت الإثبات عند الإقلاع (E-2، تدقيق 2026-10-19): مهمّة حُفظت «مكتملة» قبل الحاجز وفيها خطوة محجوبة أو فاشلة أو منقطعة
    /// لا تُثبَت أبدًا، فإثباتها NOT_PROVEN. حالتها التاريخية لا تُعاد كتابتها: ما سُجّل يبقى، ويُقال إنه غير مُثبت. يعيد
    /// معرّفات ما صحّحه الآن ليُكتب تدقيقًا؛ متكرّر بلا أثر ثانٍ.
    pub fn boot_proof_invariant(&self) -> Result<Vec<String>, StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction().map_err(|e| StorageError::Query(e.to_string()))?;
            let ids: Vec<String> = {
                let mut stmt = tx.prepare(
                    "SELECT m.mission_id FROM missions m WHERE m.state = 'COMPLETED' AND m.completion_proof_status <> 'NOT_PROVEN'
                       AND EXISTS (SELECT 1 FROM tasks t WHERE t.mission_id = m.mission_id AND t.state IN ('BLOCKED', 'FAILED', 'INTERRUPTED'))
                     ORDER BY m.mission_id",
                )?;
                let mapped = stmt.query_map([], |r| r.get::<_, String>(0))?;
                mapped.collect::<Result<Vec<_>, _>>()?
            };
            for id in &ids {
                tx.execute("UPDATE missions SET completion_proof_status = 'NOT_PROVEN', version = version + 1 WHERE mission_id = ?1", params![id])?;
            }
            tx.commit().map_err(|e| StorageError::Query(e.to_string()))?;
            Ok(ids)
        })
    }

    pub fn recover_after_restart(&self) -> Result<RecoveryReport, StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction().map_err(|e| StorageError::Query(e.to_string()))?;
            let tasks = tx.execute(
                "UPDATE tasks SET state = 'INTERRUPTED', version = version + 1 WHERE state IN ('RUNNING', 'ASSIGNED')",
                [],
            )?;
            let missions = tx.execute(
                "UPDATE missions SET state = 'BLOCKED', version = version + 1 WHERE state IN ('RUNNING', 'PLANNING', 'VERIFYING')",
                [],
            )?;
            tx.commit().map_err(|e| StorageError::Query(e.to_string()))?;
            Ok(RecoveryReport { tasks_interrupted: tasks as u32, missions_blocked: missions as u32 })
        })
    }
}

// ——— تحويلات المفردات المغلقة. صريحة عمدًا: مفردة مجهولة في القاعدة عيب بيانات
// لا حالة تشغيل، وتُردّ إلى قيمة محافظة بدل تخمين حالة أفضل.

fn origin_str(v: MissionOrigin) -> &'static str {
    match v {
        MissionOrigin::User => "USER",
        MissionOrigin::System => "SYSTEM",
    }
}

fn origin_from(v: &str) -> MissionOrigin {
    if v == "SYSTEM" { MissionOrigin::System } else { MissionOrigin::User }
}

fn mode_str(v: ExecutionMode) -> &'static str {
    match v {
        ExecutionMode::SingleAgent => "SINGLE_AGENT",
        ExecutionMode::CoordinatedMultiAgent => "COORDINATED_MULTI_AGENT",
    }
}

fn mode_from(v: &str) -> ExecutionMode {
    if v == "COORDINATED_MULTI_AGENT" { ExecutionMode::CoordinatedMultiAgent } else { ExecutionMode::SingleAgent }
}

fn priority_str(v: MissionPriority) -> &'static str {
    match v {
        MissionPriority::Low => "LOW",
        MissionPriority::Normal => "NORMAL",
        MissionPriority::High => "HIGH",
    }
}

fn priority_from(v: &str) -> MissionPriority {
    match v {
        "LOW" => MissionPriority::Low,
        "HIGH" => MissionPriority::High,
        _ => MissionPriority::Normal,
    }
}

fn mission_state_from(v: &str) -> MissionState {
    match v {
        "CREATED" => MissionState::Created,
        "PLANNING" => MissionState::Planning,
        "READY" => MissionState::Ready,
        "RUNNING" => MissionState::Running,
        "WAITING_FOR_APPROVAL" => MissionState::WaitingForApproval,
        "WAITING_FOR_USER" => MissionState::WaitingForUser,
        "VERIFYING" => MissionState::Verifying,
        "COMPLETED" => MissionState::Completed,
        "FAILED" => MissionState::Failed,
        "CANCELLED" => MissionState::Cancelled,
        "STOPPED" => MissionState::Stopped,
        // المجهول يُردّ إلى BLOCKED: أقلّ الحالات ادّعاءً.
        _ => MissionState::Blocked,
    }
}

fn proof_from(v: &str) -> CompletionProofStatus {
    match v {
        "PROVEN" => CompletionProofStatus::Proven,
        "NOT_EVALUATED" => CompletionProofStatus::NotEvaluated,
        // المجهول ليس إثباتًا أبدًا.
        _ => CompletionProofStatus::NotProven,
    }
}

fn req_status_str(v: RequirementStatus) -> &'static str {
    match v {
        RequirementStatus::Pending => "PENDING",
        RequirementStatus::Satisfied => "SATISFIED",
        RequirementStatus::Unsatisfied => "UNSATISFIED",
        RequirementStatus::Unverified => "UNVERIFIED",
        RequirementStatus::Blocked => "BLOCKED",
    }
}

fn req_status_from(v: &str) -> RequirementStatus {
    match v {
        "SATISFIED" => RequirementStatus::Satisfied,
        "UNSATISFIED" => RequirementStatus::Unsatisfied,
        "PENDING" => RequirementStatus::Pending,
        "BLOCKED" => RequirementStatus::Blocked,
        _ => RequirementStatus::Unverified,
    }
}

fn task_type_from(v: &str) -> TaskType {
    match v {
        "PLAN" => TaskType::Plan,
        "DESIGN" => TaskType::Design,
        "DEBUG" => TaskType::Debug,
        "REVIEW" => TaskType::Review,
        "SECURITY_REVIEW" => TaskType::SecurityReview,
        "TEST" => TaskType::Test,
        "RESEARCH" => TaskType::Research,
        "SYNTHESIZE" => TaskType::Synthesize,
        _ => TaskType::Build,
    }
}

fn task_state_from(v: &str) -> TaskState {
    match v {
        "PENDING" => TaskState::Pending,
        "READY" => TaskState::Ready,
        "ASSIGNED" => TaskState::Assigned,
        "RUNNING" => TaskState::Running,
        "WAITING" => TaskState::Waiting,
        "REVIEW" => TaskState::Review,
        "SUCCEEDED" => TaskState::Succeeded,
        "FAILED" => TaskState::Failed,
        "CANCELLED" => TaskState::Cancelled,
        "INTERRUPTED" => TaskState::Interrupted,
        "UNVERIFIED_DONE" => TaskState::UnverifiedDone,
        _ => TaskState::Blocked,
    }
}

fn dep_kind_str(v: DependencyKind) -> &'static str {
    match v {
        DependencyKind::RequiresSuccess => "REQUIRES_SUCCESS",
        DependencyKind::RequiresCompletion => "REQUIRES_COMPLETION",
    }
}

fn dep_kind_from(v: &str) -> DependencyKind {
    if v == "REQUIRES_COMPLETION" { DependencyKind::RequiresCompletion } else { DependencyKind::RequiresSuccess }
}

fn role_from(v: &str) -> AgentRole {
    match v {
        "COORDINATOR" => AgentRole::Coordinator,
        "PLANNER" => AgentRole::Planner,
        "ARCHITECT" => AgentRole::Architect,
        "DEBUGGER" => AgentRole::Debugger,
        "REVIEWER" => AgentRole::Reviewer,
        "SECURITY_REVIEWER" => AgentRole::SecurityReviewer,
        "TEST_ENGINEER" => AgentRole::TestEngineer,
        "RESEARCHER" => AgentRole::Researcher,
        _ => AgentRole::Builder,
    }
}

fn agent_state_from(v: &str) -> AgentState {
    match v {
        "CREATED" => AgentState::Created,
        "IDLE" => AgentState::Idle,
        "WORKING" => AgentState::Working,
        "WAITING" => AgentState::Waiting,
        "REVIEWING" => AgentState::Reviewing,
        "COMPLETED" => AgentState::Completed,
        "FAILED" => AgentState::Failed,
        "CANCELLED" => AgentState::Cancelled,
        "STOPPED" => AgentState::Stopped,
        _ => AgentState::Blocked,
    }
}

fn evidence_type_from(v: &str) -> EvidenceType {
    match v {
        "USER_CONFIRMATION" => EvidenceType::UserConfirmation,
        "RUNTIME_MEASUREMENT" => EvidenceType::RuntimeMeasurement,
        "TEST_RESULT" => EvidenceType::TestResult,
        "ARTIFACT" => EvidenceType::Artifact,
        "SOURCE_DOCUMENT" => EvidenceType::SourceDocument,
        "PROJECT_CONTEXT" => EvidenceType::ProjectContext,
        "PROVIDER_RESPONSE" => EvidenceType::ProviderResponse,
        "POLICY_DECISION" => EvidenceType::PolicyDecision,
        "AUDIT_EVENT" => EvidenceType::AuditEvent,
        "COMPLETION_PROOF" => EvidenceType::CompletionProof,
        "TOOL_RESULT" => EvidenceType::ToolResult,
        "GRADER_RESULT" => EvidenceType::GraderResult,
        "MODEL_JUDGMENT" => EvidenceType::ModelJudgment,
        // المجهول يُعامَل مخرجات وكيل: أضعف صنف، فلا يحقّق شيئًا. وهذا الفرع
        // خطِر حين يُنسى نوعٌ جديد: قياسٌ حقيقي يعود من القرص نثرَ وكيل بلا
        // شكوى. لذلك يحرسه اختبار يمرّ على كل عضو في المفردة.
        _ => EvidenceType::AgentOutput,
    }
}

fn measurement_str(v: MeasurementKind) -> &'static str {
    match v {
        MeasurementKind::Measured => "MEASURED",
        MeasurementKind::Inferred => "INFERRED",
    }
}

fn measurement_from(v: &str) -> MeasurementKind {
    if v == "MEASURED" { MeasurementKind::Measured } else { MeasurementKind::Inferred }
}

fn claim_type_from(v: &str) -> ClaimType {
    match v {
        "FACT" => ClaimType::Fact,
        "RESULT" => ClaimType::Result,
        "COMPLETION" => ClaimType::Completion,
        "REQUIREMENT_SATISFACTION" => ClaimType::RequirementSatisfaction,
        "ASSUMPTION" => ClaimType::Assumption,
        "RISK" => ClaimType::Risk,
        _ => ClaimType::Observation,
    }
}

fn claim_status_from(v: &str) -> ClaimStatus {
    match v {
        "SUPPORTED" => ClaimStatus::Supported,
        "VERIFIED" => ClaimStatus::Verified,
        "REFUTED" => ClaimStatus::Refuted,
        "CONFLICTED" => ClaimStatus::Conflicted,
        "UNKNOWN" => ClaimStatus::Unknown,
        // المجهول لا يُرقّى إلى محقَّق أبدًا.
        _ => ClaimStatus::Unverified,
    }
}

fn message_type_from(v: &str) -> MessageType {
    [
        MessageType::TaskAssignment,
        MessageType::TaskUpdate,
        MessageType::Question,
        MessageType::Answer,
        MessageType::Proposal,
        MessageType::Claim,
        MessageType::EvidenceReference,
        MessageType::ReviewRequest,
        MessageType::ReviewResult,
        MessageType::BlockedNotice,
        MessageType::DelegationRequest,
        MessageType::DelegationResult,
        MessageType::CompletionNotice,
    ]
    .into_iter()
    .find(|t| t.as_str() == v)
    .unwrap_or(MessageType::TaskUpdate)
}

/// قيم المخطط المغلقة (قيد CHECK) تُعاد ثوابت؛ ما سواها لا يصل من القاعدة.
fn verdict_from(v: &str) -> &'static str {
    match v {
        "ACCEPT" => "ACCEPT",
        "REVISE" => "REVISE",
        "REJECT" => "REJECT",
        _ => "BLOCKED",
    }
}

fn independence_from(v: &str) -> &'static str {
    match v {
        "INDEPENDENT_MODEL_REVIEW" => "INDEPENDENT_MODEL_REVIEW",
        _ => "SAME_MODEL_REVIEW",
    }
}

fn authority_from(v: &str) -> AuthorityClass {
    match v {
        "SYSTEM_POLICY" => AuthorityClass::SystemPolicy,
        "DIRECT_USER_INSTRUCTION" => AuthorityClass::DirectUserInstruction,
        "TRUSTED_RUNTIME_FACT" => AuthorityClass::TrustedRuntimeFact,
        "AGENT_MESSAGE" => AuthorityClass::AgentMessage,
        "MODEL_GENERATED" => AuthorityClass::ModelGenerated,
        // المجهول يُردّ إلى أضعف صنف.
        _ => AuthorityClass::UntrustedContent,
    }
}

#[cfg(test)]
mod round_trip_tests {
    use super::*;

    /// نوع دليل يُكتب ثم يُقرأ فيعود كما كان.
    ///
    /// هذا الاختبار موجود لعيبٍ وقع فعلًا: `TOOL_RESULT` كان يُكتب صحيحًا ويُقرأ
    /// `AGENT_OUTPUT`، لأن فرعه نُسي في القارئ وابتلعه الفرع الأخير. النتيجة أن
    /// قياسًا حقيقيًّا كان يعود من القرص نثرَ وكيل بلا أي شكوى. المرور على كل
    /// عضو يجعل نسيان النوع التالي إخفاقًا لا صمتًا.
    #[test]
    fn every_evidence_type_survives_the_round_trip_to_storage_and_back() {
        for evidence_type in EvidenceType::ALL {
            let written = evidence_type.as_str();
            let read_back = evidence_type_from(written);
            assert_eq!(read_back, evidence_type, "{written} was written and read back as {}", read_back.as_str());
        }
        // ونصّ لا تعرفه المفردة يُردّ إلى أضعف صنف بدل أن يُخمَّن.
        assert_eq!(evidence_type_from("SOMETHING_NEW"), EvidenceType::AgentOutput);
    }
}
