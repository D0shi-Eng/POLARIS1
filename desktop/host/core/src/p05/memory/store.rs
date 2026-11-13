// مخزن الذاكرة على قاعدة المنتج الوحيدة (SQLite، مخطط v4).
//
// الكتابة معاملة واحدة: قراءة ما هو محفوظ الآن في النطاق نفسه، ثم قرار التكرار
// والتعارض، ثم الكتابة. قرار يُبنى على قراءة خارج المعاملة يُنتج تكرارًا تحت التزامن.
//
// الحذف حقيقي (البند 13): المحتوى والموضوع والملخّص يُمحى من الصفّ، ومراجعه وسجلّ
// الوصول إليه وتعارضاته تُحذف، و`secure_delete` مُفعَّل فلا تبقى الصفحات المحرَّرة
// حاملةً للنصّ. يبقى معرّفٌ وحالة DELETED فقط، ليكون تاريخ الحذف نفسه صادقًا.

use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::p03::trust::Taint;
use crate::storage::{Database, StorageError};

use super::model::{
    content_digest, normalise, summarise, ConfidenceSource, ConflictState, MemoryCandidateV1, MemoryDecision, MemoryEntry,
    MemoryProvenance, MemoryScope, MemoryStatus, MemoryTrustClass, MemoryType, MemoryVerification, RejectReason, SourceKind,
    SourceRef,
};
use super::policy::ValidatedCandidate;

/// تعارض محفوظ بين مدخلين.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryConflict {
    pub conflict_id: String,
    pub memory_a: String,
    pub memory_b: String,
    pub subject: String,
    pub state: ConflictState,
    pub detected_at: String,
}

/// سجلّ قرار على مرشّح. بلا محتوى: البصمة وحدها.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionRecord {
    pub candidate_id: String,
    pub source: String,
    pub proposed_type: String,
    pub proposed_scope: String,
    pub mission_id: Option<String>,
    pub decision: String,
    pub reason_code: String,
    pub memory_id: Option<String>,
    pub decided_at: String,
}

/// مرشّح قائمة للعرض.
#[derive(Debug, Clone, Default)]
pub struct MemoryListFilter {
    pub scope: Option<MemoryScope>,
    pub memory_type: Option<MemoryType>,
    pub status: Option<MemoryStatus>,
    pub mission_id: Option<String>,
    pub project_id: Option<String>,
    pub text: Option<String>,
    pub limit: usize,
}

/// لماذا قُرئ مدخل. يُسجَّل في `memory_access`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessPurpose {
    AgentContext,
    UserView,
}

impl AccessPurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::AgentContext => "AGENT_CONTEXT",
            Self::UserView => "USER_VIEW",
        }
    }
}

const COLUMNS: &str = "memory_id, memory_type, scope, mission_id, project_id, subject, content, summary, content_digest, trust_class, \
    verification, taint_json, provenance_json, confidence_source, importance, status, version, created_at, updated_at, \
    last_accessed_at, expires_at, expires_at_ms";

fn read_row(row: &Row<'_>) -> rusqlite::Result<MemoryEntry> {
    let text = |i: usize| row.get::<_, String>(i);
    Ok(MemoryEntry {
        memory_id: text(0)?,
        memory_type: MemoryType::parse(&text(1)?).unwrap_or(MemoryType::Semantic),
        scope: MemoryScope::parse(&text(2)?).unwrap_or(MemoryScope::Mission),
        mission_id: row.get(3)?,
        project_id: row.get(4)?,
        subject: text(5)?,
        content: text(6)?,
        summary: text(7)?,
        content_digest: text(8)?,
        source_refs: Vec::new(),
        trust_class: MemoryTrustClass::parse(&text(9)?).unwrap_or(MemoryTrustClass::ModelGenerated),
        verification: MemoryVerification::parse(&text(10)?).unwrap_or(MemoryVerification::Unverified),
        taint: serde_json::from_str::<Taint>(&text(11)?).unwrap_or_default(),
        provenance: serde_json::from_str::<MemoryProvenance>(&text(12)?).unwrap_or(MemoryProvenance {
            producer: String::new(),
            mission_id: None,
            task_id: None,
            lineage: Vec::new(),
            recorded_at: String::new(),
        }),
        confidence_source: ConfidenceSource::parse(&text(13)?).unwrap_or(ConfidenceSource::None),
        importance: row.get::<_, i64>(14)?.clamp(1, 5) as u8,
        status: MemoryStatus::parse(&text(15)?).unwrap_or(MemoryStatus::Expired),
        version: row.get::<_, i64>(16)?.max(1) as u32,
        created_at: text(17)?,
        updated_at: text(18)?,
        last_accessed_at: row.get(19)?,
        expires_at: row.get(20)?,
        expires_at_ms: row.get::<_, Option<i64>>(21)?.map(|v| v.max(0) as u64),
    })
}

fn load_sources(conn: &Connection, memory_id: &str) -> Result<Vec<SourceRef>, StorageError> {
    let mut statement = conn.prepare("SELECT source_kind, reference FROM memory_sources WHERE memory_id = ?1 ORDER BY source_kind, reference")?;
    let rows = statement
        .query_map([memory_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(kind, reference)| SourceKind::parse(&kind).map(|k| SourceRef::new(k, reference)))
        .collect())
}

fn with_sources(conn: &Connection, mut entries: Vec<MemoryEntry>) -> Result<Vec<MemoryEntry>, StorageError> {
    for entry in entries.iter_mut() {
        entry.source_refs = load_sources(conn, &entry.memory_id)?;
    }
    Ok(entries)
}

fn insert_sources(tx: &Transaction<'_>, memory_id: &str, refs: &[SourceRef]) -> Result<(), StorageError> {
    for source in refs {
        tx.execute(
            "INSERT OR IGNORE INTO memory_sources (memory_id, source_kind, reference) VALUES (?1, ?2, ?3)",
            params![memory_id, source.kind.as_str(), crate::p04::adapter::bounded(&source.reference, 200)],
        )?;
    }
    Ok(())
}

/// هل مراجع المرشّح الدالّة على السلالة (دليل، ادّعاء، نداء أداة) محتواة كلها في مراجع مدخل قائم؟
fn same_lineage(candidate: &[SourceRef], existing: &[SourceRef]) -> bool {
    let lineage: Vec<&SourceRef> =
        candidate.iter().filter(|r| matches!(r.kind, SourceKind::Evidence | SourceKind::Claim | SourceKind::ToolInvocation)).collect();
    !lineage.is_empty() && lineage.iter().all(|r| existing.contains(r))
}

pub struct MemoryStore {
    db: Arc<Database>,
}

impl MemoryStore {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// يسجّل قرارًا على مرشّح، بلا محتوى.
    fn record_decision(
        tx: &Transaction<'_>,
        candidate: &MemoryCandidateV1,
        decision: &MemoryDecision,
        now: &str,
    ) -> Result<(), StorageError> {
        tx.execute(
            "INSERT OR REPLACE INTO memory_decisions (candidate_id, source, proposed_type, proposed_scope, mission_id, decision,
                reason_code, memory_id, content_digest, decided_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                candidate.candidate_id,
                candidate.source.as_str(),
                candidate.proposed_type.as_str(),
                candidate.proposed_scope.as_str(),
                candidate.mission_id,
                decision.code(),
                decision.reason_code(),
                decision.memory_id(),
                content_digest(&candidate.content),
                now
            ],
        )?;
        Ok(())
    }

    /// يسجّل رفضًا قرّرته السياسة قبل أي كتابة.
    pub fn record_rejection(&self, candidate: &MemoryCandidateV1, reason: RejectReason, now: &str) -> Result<MemoryDecision, StorageError> {
        let decision = MemoryDecision::Rejected { reason };
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            Self::record_decision(&tx, candidate, &decision, now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(decision)
    }

    /// يرقّي مرشّحًا اجتاز السياسة: تكرار، ثم سلالة، ثم تعارض، ثم كتابة. معاملة واحدة.
    pub fn promote(
        &self,
        validated: &ValidatedCandidate,
        memory_id: &str,
        conflict_ids: &mut dyn FnMut() -> String,
        now: &str,
        expires_at_ms: Option<(u64, String)>,
    ) -> Result<MemoryDecision, StorageError> {
        let candidate = &validated.candidate;
        let digest = content_digest(&validated.content);
        let subject_key = normalise(&validated.subject);
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            let existing: Vec<MemoryEntry> = {
                let mut statement = tx.prepare(&format!(
                    "SELECT {COLUMNS} FROM memories WHERE status = 'ACTIVE' AND scope = ?1
                       AND ifnull(mission_id, '') = ifnull(?2, '') AND ifnull(project_id, '') = ifnull(?3, '')"
                ))?;
                let rows = statement
                    .query_map(
                        params![
                            candidate.proposed_scope.as_str(),
                            scope_mission(candidate),
                            scope_project(candidate)
                        ],
                        read_row,
                    )?
                    .collect::<Result<Vec<_>, _>>()?;
                drop(statement);
                let mut out = Vec::new();
                for mut entry in rows.into_iter().filter(|e| normalise(&e.subject) == subject_key) {
                    entry.source_refs = load_sources(&tx, &entry.memory_id)?;
                    out.push(entry);
                }
                out
            };

            // ١ — التكرار الحرفي: المحتوى نفسه في النطاق والموضوع نفسيهما.
            if let Some(same) = existing.iter().find(|e| e.content_digest == digest) {
                let decision = if candidate.source_refs.iter().all(|r| same.source_refs.contains(r)) {
                    MemoryDecision::Duplicate { memory_id: same.memory_id.clone() }
                } else {
                    // القيمة نفسها من مصدر آخر: تُدمج المراجع ولا يُكتب صفّ ثانٍ.
                    insert_sources(&tx, &same.memory_id, &candidate.source_refs)?;
                    tx.execute(
                        "UPDATE memories SET version = version + 1, updated_at = ?2 WHERE memory_id = ?1",
                        params![same.memory_id, now],
                    )?;
                    MemoryDecision::Coalesced { memory_id: same.memory_id.clone() }
                };
                Self::record_decision(&tx, candidate, &decision, now)?;
                tx.commit()?;
                return Ok(decision);
            }

            // ٢ — تكرار السلالة: الحقيقة نفسها مشتقّة من المصدر نفسه بصياغة أخرى.
            if let Some(same) = existing.iter().find(|e| same_lineage(&candidate.source_refs, &e.source_refs)) {
                let decision = MemoryDecision::Coalesced { memory_id: same.memory_id.clone() };
                tx.execute(
                    "UPDATE memories SET version = version + 1, updated_at = ?2 WHERE memory_id = ?1",
                    params![same.memory_id, now],
                )?;
                Self::record_decision(&tx, candidate, &decision, now)?;
                tx.commit()?;
                return Ok(decision);
            }

            // ٣ — التعارض: الموضوع نفسه بقيمة أخرى. لا يُختار الأحدث حقيقةً.
            let mut verification = validated.verification;
            let mut state = ConflictState::NoConflict;
            for other in &existing {
                // D2: المستخدم يحدّث ما قاله هو عن موضوع سمّاه (ADR-038). مدخلان كلاهما كتبهما المستخدم بنفسه («تذكّر هذا»)
                // في النطاق والموضوع نفسيهما: الأحدث يحلّ محلّ الأقدم، ويبقى الأقدم مرئيًّا «مستبدَلًا». قول وكيل لا يدخل هنا.
                let user_update = candidate.producer == "user" && other.provenance.producer == "user";
                let (row_state, supersede_other, mark_other, mark_new) = if user_update {
                    (ConflictState::SupersededByUser, true, false, false)
                } else {
                    match (validated.verification, other.verification) {
                    // مصدر مربوط بدليل يحلّ محلّ قول غير محقَّق، ويبقى الاستبدال مرئيًّا.
                    (MemoryVerification::EvidenceLinked, MemoryVerification::Unverified) => {
                        (ConflictState::SupersededByVerifiedSource, true, false, false)
                    }
                    // قول غير محقَّق يخالف مدخلًا مربوطًا بدليل: لا يكفي ليغيّره.
                    (MemoryVerification::Unverified, MemoryVerification::EvidenceLinked) => {
                        (ConflictState::InsufficientEvidence, false, false, true)
                    }
                    _ => (ConflictState::Conflict, false, true, true),
                    }
                };
                if supersede_other {
                    tx.execute(
                        "UPDATE memories SET status = 'SUPERSEDED', updated_at = ?2, version = version + 1 WHERE memory_id = ?1",
                        params![other.memory_id, now],
                    )?;
                }
                if mark_other {
                    tx.execute(
                        "UPDATE memories SET verification = 'CONFLICTED', updated_at = ?2, version = version + 1 WHERE memory_id = ?1",
                        params![other.memory_id, now],
                    )?;
                }
                if mark_new {
                    verification = MemoryVerification::Conflicted;
                }
                tx.execute(
                    "INSERT INTO memory_conflicts (conflict_id, memory_a, memory_b, subject, state, detected_at) VALUES (?1,?2,?3,?4,?5,?6)",
                    params![conflict_ids(), other.memory_id, memory_id, validated.subject, row_state.as_str(), now],
                )?;
                // الحالة المُبلَّغة هي الأشدّ: تعارض قائم أشدّ من استبدال محسوم.
                state = match (state, row_state) {
                    (ConflictState::Conflict, _) | (_, ConflictState::Conflict) => ConflictState::Conflict,
                    (ConflictState::InsufficientEvidence, _) | (_, ConflictState::InsufficientEvidence) => {
                        ConflictState::InsufficientEvidence
                    }
                    (_, other_state) => other_state,
                };
            }

            // ٤ — الكتابة.
            let provenance = MemoryProvenance {
                producer: candidate.producer.clone(),
                mission_id: candidate.mission_id.clone(),
                task_id: candidate.task_id.clone(),
                lineage: candidate.source_refs.iter().map(SourceRef::label).collect(),
                recorded_at: now.to_string(),
            };
            let (expires_ms, expires_text) = match &expires_at_ms {
                Some((ms, text)) => (Some(*ms as i64), Some(text.clone())),
                None => (None, None),
            };
            tx.execute(
                &format!("INSERT INTO memories ({COLUMNS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)"),
                params![
                    memory_id,
                    candidate.proposed_type.as_str(),
                    candidate.proposed_scope.as_str(),
                    scope_mission(candidate),
                    scope_project(candidate),
                    validated.subject,
                    validated.content,
                    summarise(&validated.content),
                    digest,
                    validated.trust_class.as_str(),
                    verification.as_str(),
                    serde_json::to_string(&validated.taint).unwrap_or_else(|_| "{}".into()),
                    serde_json::to_string(&provenance).unwrap_or_else(|_| "{}".into()),
                    validated.confidence_source.as_str(),
                    i64::from(candidate.importance),
                    MemoryStatus::Active.as_str(),
                    1_i64,
                    now,
                    now,
                    Option::<String>::None,
                    expires_text,
                    expires_ms
                ],
            )?;
            insert_sources(&tx, memory_id, &candidate.source_refs)?;
            let decision = MemoryDecision::Promoted { memory_id: memory_id.to_string(), conflict: state };
            Self::record_decision(&tx, candidate, &decision, now)?;
            tx.commit()?;
            Ok(decision)
        })
    }

    pub fn get(&self, memory_id: &str) -> Result<Option<MemoryEntry>, StorageError> {
        self.db.with(|conn| {
            let entry = conn
                .query_row(&format!("SELECT {COLUMNS} FROM memories WHERE memory_id = ?1"), [memory_id], read_row)
                .optional()?;
            match entry {
                Some(mut entry) => {
                    entry.source_refs = load_sources(conn, memory_id)?;
                    Ok(Some(entry))
                }
                None => Ok(None),
            }
        })
    }

    pub fn list(&self, filter: &MemoryListFilter) -> Result<Vec<MemoryEntry>, StorageError> {
        let limit = if filter.limit == 0 { 200 } else { filter.limit.min(500) } as i64;
        self.db.with(|conn| {
            let mut statement = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM memories
                 WHERE (?1 IS NULL OR scope = ?1) AND (?2 IS NULL OR memory_type = ?2)
                   AND (?3 IS NULL OR status = ?3) AND (?3 IS NOT NULL OR status <> 'DELETED')
                   AND (?4 IS NULL OR mission_id = ?4) AND (?5 IS NULL OR project_id = ?5)
                   AND (?6 IS NULL OR instr(lower(subject), lower(?6)) > 0 OR instr(lower(content), lower(?6)) > 0)
                 ORDER BY updated_at DESC, memory_id LIMIT ?7"
            ))?;
            let rows = statement
                .query_map(
                    params![
                        filter.scope.map(MemoryScope::as_str),
                        filter.memory_type.map(MemoryType::as_str),
                        filter.status.map(MemoryStatus::as_str),
                        filter.mission_id,
                        filter.project_id,
                        filter.text.as_deref().filter(|t| !t.trim().is_empty()),
                        limit
                    ],
                    read_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            with_sources(conn, rows)
        })
    }

    /// المدخلات النشطة التي يجوز لمهمّة أن تراها. عزل النطاق هنا، في الاستعلام نفسه.
    pub fn visible_to(
        &self,
        mission_id: &str,
        project_id: Option<&str>,
        include_user: bool,
        include_system: bool,
    ) -> Result<Vec<MemoryEntry>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM memories WHERE status = 'ACTIVE' AND (
                    (scope = 'MISSION' AND (mission_id = ?1 OR mission_id IN (
                        SELECT t2.mission_id FROM p08_conversation_turns t1
                        JOIN p08_conversation_turns t2 ON t2.thread_id = t1.thread_id
                        WHERE t1.mission_id = ?1)))
                 OR (scope = 'PROJECT' AND ?2 IS NOT NULL AND project_id = ?2)
                 OR (scope = 'USER' AND ?3 = 1)
                 OR (scope = 'SYSTEM' AND ?4 = 1))
                 ORDER BY updated_at DESC, memory_id LIMIT 400"
            ))?;
            let rows = statement
                .query_map(params![mission_id, project_id, i64::from(include_user), i64::from(include_system)], read_row)?
                .collect::<Result<Vec<_>, _>>()?;
            with_sources(conn, rows)
        })
    }

    /// المهامّ الأخرى في محادثة هذه المهمّة (فارغة لمهمّة ليست في محادثة).
    pub fn thread_missions(&self, mission_id: &str) -> Result<Vec<String>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT t2.mission_id FROM p08_conversation_turns t1 JOIN p08_conversation_turns t2 ON t2.thread_id = t1.thread_id
                 WHERE t1.mission_id = ?1 AND t2.mission_id <> ?1 ORDER BY t2.seq LIMIT 200",
            )?;
            let rows = statement.query_map(params![mission_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn conflicts_touching(&self, ids: &[String]) -> Result<Vec<MemoryConflict>, StorageError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        self.db.with(|conn| {
            let mut out = Vec::new();
            let mut statement = conn.prepare(
                "SELECT conflict_id, memory_a, memory_b, subject, state, detected_at FROM memory_conflicts
                 WHERE memory_a = ?1 OR memory_b = ?1 ORDER BY detected_at, conflict_id",
            )?;
            for id in ids {
                let rows = statement
                    .query_map([id], |r| {
                        Ok(MemoryConflict {
                            conflict_id: r.get(0)?,
                            memory_a: r.get(1)?,
                            memory_b: r.get(2)?,
                            subject: r.get(3)?,
                            state: ConflictState::parse(&r.get::<_, String>(4)?).unwrap_or(ConflictState::Conflict),
                            detected_at: r.get(5)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for row in rows {
                    if !out.iter().any(|c: &MemoryConflict| c.conflict_id == row.conflict_id) {
                        out.push(row);
                    }
                }
            }
            Ok(out)
        })
    }

    pub fn record_access(&self, ids: &[String], mission_id: Option<&str>, purpose: AccessPurpose, now: &str) -> Result<(), StorageError> {
        if ids.is_empty() {
            return Ok(());
        }
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in ids {
                tx.execute(
                    "INSERT INTO memory_access (memory_id, mission_id, purpose, accessed_at) VALUES (?1, ?2, ?3, ?4)",
                    params![id, mission_id, purpose.as_str(), now],
                )?;
                tx.execute("UPDATE memories SET last_accessed_at = ?2 WHERE memory_id = ?1", params![id, now])?;
            }
            tx.commit()?;
            Ok(())
        })
    }

    pub fn access_count(&self, memory_id: &str) -> Result<u64, StorageError> {
        self.db.with(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM memory_access WHERE memory_id = ?1", [memory_id], |r| r.get::<_, i64>(0))? as u64)
        })
    }

    /// المداخل التي قُرئت سياقًا لوكيل في مهمّة بعينها، بلا تكرار. قياس للنطاق لا أكثر.
    pub fn accessed_for_agent(&self, mission_id: &str) -> Result<Vec<String>, StorageError> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT memory_id FROM memory_access WHERE mission_id = ?1 AND purpose = 'AGENT_CONTEXT' ORDER BY memory_id",
            )?;
            let rows = stmt.query_map([mission_id], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }

    /// حذف حقيقي. يعيد `false` إن لم يوجد المدخل أو كان محذوفًا سلفًا.
    pub fn delete(&self, memory_id: &str, now: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| {
            // الصفحات المحرَّرة تُصفَّر، فلا يبقى النصّ المحذوف في ملف القاعدة.
            conn.pragma_update(None, "secure_delete", "ON")?;
            let tx = conn.transaction()?;
            let found: Option<String> =
                tx.query_row("SELECT status FROM memories WHERE memory_id = ?1", [memory_id], |r| r.get(0)).optional()?;
            match found.as_deref() {
                None | Some("DELETED") => return Ok(false),
                _ => {}
            }
            tx.execute("DELETE FROM memory_sources WHERE memory_id = ?1", [memory_id])?;
            tx.execute("DELETE FROM memory_access WHERE memory_id = ?1", [memory_id])?;
            tx.execute("DELETE FROM memory_conflicts WHERE memory_a = ?1 OR memory_b = ?1", [memory_id])?;
            // PHASE-08: المتجه يحمل معنى النصّ المحذوف، فيُحذف معه (الصفّ يبقى بحالة DELETED، فلا يعمل التتابع هنا).
            tx.execute("DELETE FROM memory_embeddings WHERE memory_id = ?1", [memory_id])?;
            tx.execute(
                "UPDATE memories SET status = 'DELETED', subject = '', content = '', summary = '', content_digest = '',
                    taint_json = '{}', provenance_json = '{}', version = version + 1, updated_at = ?2, expires_at = NULL,
                    expires_at_ms = NULL, last_accessed_at = NULL WHERE memory_id = ?1",
                params![memory_id, now],
            )?;
            tx.commit()?;
            Ok(true)
        })
    }

    /// PHASE-08: المتجهات المحفوظة لهذه المدخلات بنموذج واحد، مع بصمة المحتوى الذي حُسبت منه.
    pub fn vectors(&self, ids: &[String], model_id: &str) -> Result<std::collections::HashMap<String, (String, Vec<f32>)>, StorageError> {
        self.db.with(|conn| {
            let mut out = std::collections::HashMap::new();
            let mut stmt = conn.prepare("SELECT content_digest, vector FROM memory_embeddings WHERE memory_id = ?1 AND model_id = ?2")?;
            for id in ids {
                let row: Option<(String, Vec<u8>)> = stmt.query_row(params![id, model_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
                if let Some((digest, blob)) = row {
                    let vector = blob.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
                    out.insert(id.clone(), (digest, vector));
                }
            }
            Ok(out)
        })
    }

    /// يحفظ متجهات (أو يستبدلها) لمدخلات ما زالت نشطة. مدخل حُذف أو تغيّر أثناء الحساب لا يأخذ متجهًا.
    pub fn put_vectors(&self, rows: &[(String, String, Vec<f32>)], model_id: &str, now: &str) -> Result<usize, StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            let mut written = 0;
            for (id, digest, vector) in rows {
                let blob: Vec<u8> = vector.iter().flat_map(|f| f.to_le_bytes()).collect();
                written += tx.execute(
                    "INSERT OR REPLACE INTO memory_embeddings (memory_id, model_id, content_digest, dim, vector, created_at)
                     SELECT memory_id, ?2, ?3, ?4, ?5, ?6 FROM memories WHERE memory_id = ?1 AND status = 'ACTIVE' AND content_digest = ?3",
                    params![id, model_id, digest, vector.len() as i64, blob, now],
                )?;
            }
            tx.commit()?;
            Ok(written)
        })
    }

    /// عدد المتجهات المحفوظة لمدخل (لكل النماذج): للاختبار وللفحص بعد الحذف.
    pub fn vector_count(&self, memory_id: &str) -> Result<u64, StorageError> {
        self.db.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM memory_embeddings WHERE memory_id = ?1", [memory_id], |r| r.get::<_, i64>(0))? as u64))
    }

    /// ذاكرة العمل تنتهي بانتهاء مهمّتها.
    pub fn expire_working(&self, mission_id: &str, now: &str) -> Result<usize, StorageError> {
        self.db.with(|conn| {
            Ok(conn.execute(
                "UPDATE memories SET status = 'EXPIRED', updated_at = ?2, version = version + 1
                 WHERE status = 'ACTIVE' AND memory_type = 'WORKING' AND mission_id = ?1",
                params![mission_id, now],
            )?)
        })
    }

    /// كل مدخل انقضى أجله يصير EXPIRED. الانقضاء حقيقة زمنية لا قرار.
    pub fn expire_due(&self, now_ms: u64, now: &str) -> Result<usize, StorageError> {
        self.db.with(|conn| {
            Ok(conn.execute(
                "UPDATE memories SET status = 'EXPIRED', updated_at = ?2, version = version + 1
                 WHERE status = 'ACTIVE' AND expires_at_ms IS NOT NULL AND expires_at_ms <= ?1",
                params![now_ms as i64, now],
            )?)
        })
    }

    pub fn decisions(&self, mission_id: Option<&str>) -> Result<Vec<DecisionRecord>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT candidate_id, source, proposed_type, proposed_scope, mission_id, decision, reason_code, memory_id, decided_at
                 FROM memory_decisions WHERE (?1 IS NULL OR mission_id = ?1) ORDER BY decided_at, candidate_id LIMIT 500",
            )?;
            let rows = statement
                .query_map([mission_id], |r| {
                    Ok(DecisionRecord {
                        candidate_id: r.get(0)?,
                        source: r.get(1)?,
                        proposed_type: r.get(2)?,
                        proposed_scope: r.get(3)?,
                        mission_id: r.get(4)?,
                        decision: r.get(5)?,
                        reason_code: r.get(6)?,
                        memory_id: r.get(7)?,
                        decided_at: r.get(8)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /// عدد الصفوف التي ما زال محتواها النصّي يطابق نصًّا بعينه. يُقاس به أن الحذف حقيقي.
    pub fn rows_containing(&self, needle: &str) -> Result<u64, StorageError> {
        self.db.with(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM memories WHERE instr(content, ?1) > 0 OR instr(subject, ?1) > 0 OR instr(summary, ?1) > 0",
                [needle],
                |r| r.get::<_, i64>(0),
            )? as u64)
        })
    }
}

fn scope_mission(candidate: &MemoryCandidateV1) -> Option<String> {
    // مدخل مشروع أو مستخدم لا يُربط بمهمّة في عموده: ربطه يجعل الاسترجاع عبر المهامّ
    // يعتمد على مهمّة المنشأ، والمنشأ يبقى في السلالة.
    match candidate.proposed_scope {
        MemoryScope::Mission => candidate.mission_id.clone(),
        _ => None,
    }
}

fn scope_project(candidate: &MemoryCandidateV1) -> Option<String> {
    match candidate.proposed_scope {
        MemoryScope::Mission | MemoryScope::Project => candidate.project_id.clone(),
        _ => None,
    }
}
