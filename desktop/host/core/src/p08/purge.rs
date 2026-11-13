// الحذف الحقيقي لمحادثة أو مشروع (Phase-08، ADR-031).
//
// لكل جدول يحمل عمود مهمّة أو مشروع قاعدةٌ صريحة هنا: يُحذف صفّه، أو يُفصل عنه (يبقى الصفّ بلا مرجع).
// يُفصل ما هو محاسبة أو رصد (الاستعمال والكلفة، أحداث الرصد، استدعاءات الموصلات، قرارات الذاكرة، تشغيلات
// المجدول): حذفه يزوّر مجاميع لا تخصّ المحادثة وحدها، ولا يحمل شيء منه نصّها. سجلّ التدقيق المتسلسل لا
// يُمسّ (حذف حلقة منه يكسر السلسلة)، ويُضاف إليه حدث الحذف نفسه بلا عنوان ولا نصّ.
//
// اختبار في هذا الملف يمرّ على كل جداول القاعدة: جدول يُضاف لاحقًا بعمود مهمّة أو مشروع بلا قاعدة هنا
// يُسقطه، بدل أن يبقى فيه أثر محادثة حذفها المستخدم.

use rusqlite::{params, Connection};

use crate::storage::StorageError;

/// المعرّفات المحذوفة في المعاملة الجارية. جدول مؤقّت: لا يبقى بعد الاتصال ولا يُكتب في الملف.
const IDS: &str = "(SELECT id FROM temp.purge_ids)";

/// ما يُحذف من صفوف حين تُحذف مهامّ محادثة، بترتيب يسبق فيه الفرعُ أصلَه (المفاتيح الأجنبية مفعّلة).
const MISSION_DELETE: &[&str] = &[
    // أدلّة الادّعاءات: لا عمود مهمّة فيها، فتُحذف بادّعاءات المهمّة وأدلّتها.
    "DELETE FROM claim_evidence WHERE claim_id IN (SELECT claim_id FROM claims WHERE mission_id IN {ids}) OR evidence_id IN (SELECT evidence_id FROM evidence WHERE mission_id IN {ids})",
    "DELETE FROM browser_actions WHERE mission_id IN {ids}",
    "DELETE FROM browser_downloads WHERE mission_id IN {ids}",
    "DELETE FROM browser_sessions WHERE mission_id IN {ids}",
    "DELETE FROM computer_actions WHERE mission_id IN {ids}",
    "DELETE FROM computer_observations WHERE mission_id IN {ids}",
    "DELETE FROM computer_target_grants WHERE mission_id IN {ids}",
    "DELETE FROM computer_sessions WHERE mission_id IN {ids}",
    "DELETE FROM task_dependencies WHERE mission_id IN {ids}",
    "DELETE FROM reviews WHERE mission_id IN {ids}",
    "DELETE FROM agent_messages WHERE mission_id IN {ids}",
    "DELETE FROM agent_instances WHERE mission_id IN {ids}",
    "DELETE FROM claims WHERE mission_id IN {ids}",
    "DELETE FROM evidence WHERE mission_id IN {ids}",
    "DELETE FROM mission_events WHERE mission_id IN {ids}",
    "DELETE FROM orchestration_checkpoints WHERE mission_id IN {ids}",
    "DELETE FROM mission_requirements WHERE mission_id IN {ids}",
    "DELETE FROM tasks WHERE mission_id IN {ids}",
    "DELETE FROM tool_approvals WHERE mission_id IN {ids}",
    "DELETE FROM tool_invocations WHERE mission_id IN {ids}",
    // خطة 2026-10-07 (ADR-041): سجلّ الجلسة يُحذف بجلساته كاملة (المحادثة وجلسات مساعديها الفرعية)، فلا تبقى سلسلة مقطوعة؛
    // والامتدادات وبصمات الملفات المحميّة تتبع مهمّتها.
    "DELETE FROM session_events WHERE mission_id IN {ids} OR session_id IN {ids} OR substr(session_id, 1, 36) IN {ids}",
    // مرساة نهاية الجلسة تتبع أحداثها (تكليف 2026-10-12): جلسة حُذفت أحداثها لا تبقى لها مرساة تُقرأ تلاعبًا.
    "DELETE FROM session_heads WHERE session_id NOT IN (SELECT DISTINCT session_id FROM session_events)",
    "DELETE FROM mission_runtime_state WHERE mission_id IN {ids}",
    // ذاكرة الوكلاء المكتوبة عن هذه المهمّة تُحذف بمنحها.
    "DELETE FROM agent_memory_grants WHERE memory_id IN (SELECT memory_id FROM agent_memories WHERE mission_id IN {ids})",
    "DELETE FROM agent_memories WHERE mission_id IN {ids}",
    "DELETE FROM spans WHERE mission_id IN {ids}",
    "DELETE FROM protected_files WHERE mission_id IN {ids}",
    // ذاكرة المهمّة نفسها تُحذف بتعارضاتها وسجلّ قراءتها؛ مصادرها تتبعها (ON DELETE CASCADE).
    "DELETE FROM memory_conflicts WHERE memory_a IN (SELECT memory_id FROM memories WHERE scope = 'MISSION' AND mission_id IN {ids}) OR memory_b IN (SELECT memory_id FROM memories WHERE scope = 'MISSION' AND mission_id IN {ids})",
    "DELETE FROM memory_access WHERE memory_id IN (SELECT memory_id FROM memories WHERE scope = 'MISSION' AND mission_id IN {ids})",
    "DELETE FROM memories WHERE scope = 'MISSION' AND mission_id IN {ids}",
    // مشاركات المهمّة ومخرجاتها ونشرها، قبل حذف المخرجات نفسها.
    "DELETE FROM p08_share_grants WHERE (object_type IN ('MISSION', 'WORKSPACE') AND object_id IN {ids}) OR (object_type = 'ARTIFACT' AND object_id IN (SELECT artifact_id FROM p08_artifacts WHERE mission_id IN {ids}))",
    "DELETE FROM p08_publications WHERE artifact_id IN (SELECT artifact_id FROM p08_artifacts WHERE mission_id IN {ids})",
    "DELETE FROM p08_artifacts WHERE mission_id IN {ids}",
    "DELETE FROM p08_execution_runs WHERE mission_id IN {ids}",
    "DELETE FROM p08_attachments WHERE mission_id IN {ids}",
    "DELETE FROM p08_mission_preferences WHERE mission_id IN {ids}",
    "DELETE FROM p08_conversation_entries WHERE mission_id IN {ids}",
    "DELETE FROM p08_mission_ratings WHERE mission_id IN {ids}",
    "DELETE FROM p08_turn_notes WHERE mission_id IN {ids}",
    "DELETE FROM p08_conversation_turns WHERE mission_id IN {ids}",
    "DELETE FROM p08_conversation_state WHERE thread_id IN {ids}",
    "DELETE FROM config_values WHERE layer = 'MISSION' AND scope_id IN {ids}",
    "DELETE FROM budgets WHERE scope = 'MISSION' AND scope_key IN {ids}",
];

/// ما يُفصل عن المهمّة ولا يُحذف: محاسبة ورصد بلا نصّ محادثة.
const MISSION_DETACH: &[&str] = &[
    "UPDATE memories SET mission_id = NULL WHERE scope <> 'MISSION' AND mission_id IN {ids}",
    "UPDATE memory_access SET mission_id = NULL WHERE mission_id IN {ids}",
    "UPDATE memory_decisions SET mission_id = NULL WHERE mission_id IN {ids}",
    "UPDATE usage_records SET mission_id = NULL WHERE mission_id IN {ids}",
    "UPDATE obs_events SET mission_id = NULL WHERE mission_id IN {ids}",
    "UPDATE connector_invocations SET mission_id = NULL WHERE mission_id IN {ids}",
    "UPDATE p08_schedule_runs SET mission_id = NULL WHERE mission_id IN {ids}",
    "UPDATE p08_schedules SET last_mission_id = NULL WHERE last_mission_id IN {ids}",
];

/// كل (جدول، عمود) يشير إلى مهمّة وله قاعدة أعلاه. يحرسه الاختبار `every_mission_column_has_a_rule`.
#[cfg(test)]
const MISSION_COLUMNS: &[(&str, &str)] = &[
    ("missions", "mission_id"),
    ("mission_requirements", "mission_id"),
    ("tasks", "mission_id"),
    ("task_dependencies", "mission_id"),
    ("agent_instances", "mission_id"),
    ("agent_messages", "mission_id"),
    ("evidence", "mission_id"),
    ("claims", "mission_id"),
    ("reviews", "mission_id"),
    ("mission_events", "mission_id"),
    ("orchestration_checkpoints", "mission_id"),
    ("tool_invocations", "mission_id"),
    ("tool_approvals", "mission_id"),
    ("memories", "mission_id"),
    ("memory_access", "mission_id"),
    ("memory_decisions", "mission_id"),
    ("browser_sessions", "mission_id"),
    ("browser_actions", "mission_id"),
    ("browser_downloads", "mission_id"),
    ("computer_target_grants", "mission_id"),
    ("computer_sessions", "mission_id"),
    ("computer_actions", "mission_id"),
    ("computer_observations", "mission_id"),
    ("connector_invocations", "mission_id"),
    ("usage_records", "mission_id"),
    ("obs_events", "mission_id"),
    ("p08_artifacts", "mission_id"),
    ("p08_execution_runs", "mission_id"),
    ("p08_attachments", "mission_id"),
    ("p08_schedules", "last_mission_id"),
    ("p08_schedule_runs", "mission_id"),
    ("p08_mission_preferences", "mission_id"),
    ("p08_conversation_turns", "mission_id"),
    ("p08_conversation_turns", "thread_id"),
    ("p08_conversation_entries", "mission_id"),
    ("p08_conversation_state", "thread_id"),
    ("session_events", "mission_id"),
    ("session_events", "session_id"),
    ("spans", "mission_id"),
    ("protected_files", "mission_id"),
    ("mission_runtime_state", "mission_id"),
    ("agent_memories", "mission_id"),
    ("p08_mission_ratings", "mission_id"),
    ("p08_turn_notes", "mission_id"),
];

/// ما يُحذف أو يُفصل حين يُحذف مشروع. محادثاته لا تُحذف: تخرج من المشروع إلى قائمة المهامّ العامّة.
const PROJECT_STATEMENTS: &[&str] = &[
    "UPDATE missions SET project_id = NULL WHERE project_id = ?1",
    "DELETE FROM context_sources WHERE project_id = ?1",
    "DELETE FROM memory_conflicts WHERE memory_a IN (SELECT memory_id FROM memories WHERE scope = 'PROJECT' AND project_id = ?1) OR memory_b IN (SELECT memory_id FROM memories WHERE scope = 'PROJECT' AND project_id = ?1)",
    "DELETE FROM memory_access WHERE memory_id IN (SELECT memory_id FROM memories WHERE scope = 'PROJECT' AND project_id = ?1)",
    "DELETE FROM memories WHERE scope = 'PROJECT' AND project_id = ?1",
    "UPDATE memories SET project_id = NULL WHERE project_id = ?1",
    "UPDATE usage_records SET project_id = NULL WHERE project_id = ?1",
    "DELETE FROM config_values WHERE layer = 'PROJECT' AND scope_id = ?1",
    "DELETE FROM budgets WHERE scope = 'PROJECT' AND scope_key = ?1",
    // مهمّة مجدولة كانت تُنشأ في المشروع تُنشأ بعده خارج أي مشروع، ولا تفشل بمرجع مفقود.
    "UPDATE p08_schedules SET template_json = json_remove(template_json, '$.project_id') WHERE json_extract(template_json, '$.project_id') = ?1",
    "DELETE FROM projects WHERE project_id = ?1",
];

#[cfg(test)]
const PROJECT_COLUMNS: &[(&str, &str)] = &[("projects", "project_id"), ("context_sources", "project_id"), ("missions", "project_id"), ("memories", "project_id"), ("usage_records", "project_id")];

fn run(conn: &Connection, statements: &[&str]) -> Result<usize, StorageError> {
    let mut rows = 0;
    for statement in statements {
        rows += conn.execute(&statement.replace("{ids}", IDS), [])?;
    }
    Ok(rows)
}

/// يحذف مهامّ (محادثة بأدوارها) وكل ما يخصّها في معاملة واحدة. يعيد عدد الصفوف التي حُذفت أو فُصلت.
/// لا يمسّ القرص: مجلّدات المساحة يحذفها المستدعي بعد نجاح المعاملة.
pub fn purge_missions(conn: &mut Connection, ids: &[String]) -> Result<usize, StorageError> {
    let tx = conn.transaction().map_err(|e| StorageError::Query(e.to_string()))?;
    tx.execute_batch("CREATE TEMP TABLE IF NOT EXISTS purge_ids (id TEXT PRIMARY KEY NOT NULL); DELETE FROM temp.purge_ids;")?;
    for id in ids {
        tx.execute("INSERT OR IGNORE INTO temp.purge_ids (id) VALUES (?1)", params![id])?;
    }
    let mut rows = run(&tx, MISSION_DETACH)?;
    rows += run(&tx, MISSION_DELETE)?;
    rows += tx.execute(&format!("DELETE FROM missions WHERE mission_id IN {IDS}"), [])?;
    tx.execute("DELETE FROM temp.purge_ids", [])?;
    tx.commit().map_err(|e| StorageError::Query(e.to_string()))?;
    Ok(rows)
}

/// يحذف مشروعًا: تعليماته ومصادره وذاكرته وإعداداته. محادثاته تبقى خارج أي مشروع.
pub fn purge_project(conn: &mut Connection, project_id: &str) -> Result<usize, StorageError> {
    let tx = conn.transaction().map_err(|e| StorageError::Query(e.to_string()))?;
    let mut rows = 0;
    for statement in PROJECT_STATEMENTS {
        rows += tx.execute(statement, params![project_id])?;
    }
    tx.commit().map_err(|e| StorageError::Query(e.to_string()))?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::storage::migrations::apply(&mut conn).unwrap();
        conn
    }

    fn columns_named(conn: &Connection, names: &[&str]) -> Vec<(String, String)> {
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let mut out = Vec::new();
        for table in tables {
            let cols: Vec<String> = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap().query_map([], |r| r.get(1)).unwrap().collect::<Result<_, _>>().unwrap();
            for col in cols {
                if names.contains(&col.as_str()) {
                    out.push((table.clone(), col));
                }
            }
        }
        out
    }

    #[test]
    fn every_mission_column_has_a_rule() {
        let conn = migrated();
        for (table, col) in columns_named(&conn, &["mission_id", "last_mission_id", "thread_id"]) {
            assert!(MISSION_COLUMNS.contains(&(table.as_str(), col.as_str())), "{table}.{col} points at a mission but has no purge rule");
            let named = format!("{table} SET {col}");
            let covered = table == "missions" || MISSION_DELETE.iter().chain(MISSION_DETACH).any(|s| s.contains(&format!("FROM {table} ")) || s.contains(&named));
            assert!(covered, "{table}.{col} is listed but no statement touches it");
        }
    }

    #[test]
    fn every_project_column_has_a_rule() {
        let conn = migrated();
        for (table, col) in columns_named(&conn, &["project_id"]) {
            assert!(PROJECT_COLUMNS.contains(&(table.as_str(), col.as_str())), "{table}.{col} points at a project but has no purge rule");
            assert!(PROJECT_STATEMENTS.iter().any(|s| s.contains(&format!("FROM {table} ")) || s.contains(&format!("UPDATE {table} "))), "{table} has no statement");
        }
    }

    #[test]
    fn every_statement_is_valid_sql_on_an_empty_database() {
        let mut conn = migrated();
        assert_eq!(purge_missions(&mut conn, &["00000000-0000-4000-8000-000000000000".to_string()]).unwrap(), 0);
        assert_eq!(purge_project(&mut conn, "00000000-0000-4000-8000-000000000000").unwrap(), 0);
    }
}
