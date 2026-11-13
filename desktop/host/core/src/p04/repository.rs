// استمرار Phase-04: حالة المهارات، وخوادم MCP وأدواتها، وسجل الاستدعاءات،
// والموافقات.
//
// ما يُحفظ وما لا يُحفظ قرار أمني لا تقني: تُحفظ الواصفات والبصمات والحالات
// والقرارات؛ ولا تُحفظ حجج الأداة كاملةً ولا ناتجها الخام. الحجج تُحفظ ببصمتها
// وبمعاينة محدودة، فلا يصير السجل مخزنًا لمحتوى وصل من طرف غير موثوق.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::storage::{Database, StorageError};

use super::activity::{InvocationStatus, ToolInvocationRecord};
use super::approval::{ApprovalBinding, ApprovalRecord, ApprovalStatus};
use super::effect::ToolEffect;
use super::mcp::model::{McpServer, McpServerState, McpTransport};
use super::tool::ToolDescriptor;

/// أداة خادم كما حُفظت: واصفها، ومخطط مدخلاتها، واسمها المُعلن.
#[derive(Debug, Clone)]
pub struct StoredMcpTool {
    pub descriptor: ToolDescriptor,
    pub declared_name: String,
    pub input_schema: String,
}

pub struct Phase04Repository {
    db: Arc<Database>,
}

fn effects_json(effects: &[ToolEffect]) -> String {
    serde_json::to_string(&effects.iter().map(|e| e.as_str()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into())
}

fn effects_from(text: &str) -> Vec<ToolEffect> {
    serde_json::from_str::<Vec<String>>(text)
        .unwrap_or_default()
        .iter()
        .filter_map(|code| ToolEffect::parse(code))
        .collect()
}

fn server_row(r: &Row<'_>) -> rusqlite::Result<McpServer> {
    Ok(McpServer {
        server_id: r.get(0)?,
        name: r.get(1)?,
        endpoint: r.get(2)?,
        // CP-06-4 (PHASE-06): كان يُقرأ LOOPBACK_HTTP دائمًا، فعاد الخادم البعيد بعد إعادة التشغيل محليًّا في نظر النموذج. قيد العمود
        // يغلق المفردات؛ قيمة مجهولة تُعطّل الخادم بدل أن تُخمَّن.
        transport: McpTransport::parse(&r.get::<_, String>(3)?).unwrap_or(McpTransport::LoopbackHttp),
        state: if McpTransport::parse(&r.get::<_, String>(3)?).is_some() {
            McpServerState::parse(&r.get::<_, String>(4)?).unwrap_or(McpServerState::Registered)
        } else {
            McpServerState::Disabled
        },
        granted_effects: effects_from(&r.get::<_, String>(5)?),
        tool_count: r.get::<_, i64>(6)? as u32,
        rejected_tool_count: r.get::<_, i64>(7)? as u32,
        last_error: r.get(8)?,
        last_refresh_at: r.get(9)?,
        registered_at: r.get(10)?,
    })
}

const SERVER_COLUMNS: &str =
    "server_id, name, endpoint, transport, state, granted_effects, tool_count, rejected_tool_count, last_error, last_refresh_at, registered_at";

impl Phase04Repository {
    /// أدوات MCP معلّقة بإعادة تعريف لم يقبلها المستخدم (ADR-041، ASI04).
    pub fn redefinitions(&self) -> Result<Vec<String>, StorageError> {
        self.db.with(|conn| {
            let mut stmt = conn.prepare("SELECT tool_id FROM mcp_redefinitions ORDER BY detected_at")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn note_redefinition(&self, tool_id: &str, server_id: &str, now: &str) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute("INSERT OR IGNORE INTO mcp_redefinitions (tool_id, server_id, detected_at) VALUES (?1, ?2, ?3)", params![tool_id, server_id, now])?;
            Ok(())
        })
    }

    pub fn clear_redefinition(&self, tool_id: &str) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute("DELETE FROM mcp_redefinitions WHERE tool_id = ?1", params![tool_id])?;
            Ok(())
        })
    }

    /// المخزن نفسه، لمنفذ القياس في Phase-08 (بصمات الملفات المحميّة، ADR-041). قراءة وإلحاق، لا حذف.
    pub fn db(&self) -> &Arc<Database> {
        &self.db
    }

    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    // ——— المهارات: الحالة وحدها تُحفظ. التعريف مدمج ولا يأتي من القرص.

    pub fn skill_states(&self) -> Result<Vec<(String, bool, String)>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare("SELECT skill_id, enabled, updated_at FROM skill_state")?;
            let rows = statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? == 1, r.get::<_, String>(2)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn set_skill_enabled(&self, skill_id: &str, enabled: bool, now: &str) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO skill_state (skill_id, enabled, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (skill_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
                params![skill_id, i64::from(enabled), now],
            )?;
            Ok(())
        })
    }

    // ——— خوادم MCP.

    pub fn servers(&self) -> Result<Vec<McpServer>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(&format!("SELECT {SERVER_COLUMNS} FROM mcp_servers ORDER BY registered_at, server_id"))?;
            let rows = statement.query_map([], server_row)?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn server(&self, server_id: &str) -> Result<Option<McpServer>, StorageError> {
        self.db.with(|conn| {
            Ok(conn
                .query_row(&format!("SELECT {SERVER_COLUMNS} FROM mcp_servers WHERE server_id = ?1"), [server_id], server_row)
                .optional()?)
        })
    }

    pub fn save_server(&self, server: &McpServer) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                &format!(
                    "INSERT INTO mcp_servers ({SERVER_COLUMNS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                     ON CONFLICT (server_id) DO UPDATE SET
                       name = excluded.name, endpoint = excluded.endpoint, state = excluded.state,
                       granted_effects = excluded.granted_effects, tool_count = excluded.tool_count,
                       rejected_tool_count = excluded.rejected_tool_count, last_error = excluded.last_error,
                       last_refresh_at = excluded.last_refresh_at"
                ),
                params![
                    server.server_id,
                    server.name,
                    server.endpoint,
                    server.transport.as_str(),
                    server.state.as_str(),
                    effects_json(&server.granted_effects),
                    server.tool_count as i64,
                    server.rejected_tool_count as i64,
                    server.last_error,
                    server.last_refresh_at,
                    server.registered_at
                ],
            )?;
            Ok(())
        })
    }

    // ——— أدوات الخوادم.

    pub fn tools(&self) -> Result<Vec<StoredMcpTool>, StorageError> {
        self.db.with(|conn| {
            let mut statement =
                conn.prepare("SELECT tool_id, declared_name, descriptor_json, input_schema FROM mcp_tools ORDER BY tool_id")?;
            let rows = statement
                .query_map([], |r| {
                    let descriptor_json: String = r.get(2)?;
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, descriptor_json, r.get::<_, String>(3)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let mut out = Vec::new();
            for (_, declared_name, descriptor_json, input_schema) in rows {
                // واصف لا يُفكَّك لا يُرمَّم بالظنّ: يُترك، فلا تدخل أداة نصفُ معروفة.
                if let Ok(descriptor) = serde_json::from_str::<ToolDescriptor>(&descriptor_json) {
                    out.push(StoredMcpTool { descriptor, declared_name, input_schema });
                }
            }
            Ok(out)
        })
    }

    pub fn replace_server_tools(&self, server_id: &str, tools: &[StoredMcpTool], now: &str) -> Result<(), StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM mcp_tools WHERE server_id = ?1", [server_id])?;
            for tool in tools {
                tx.execute(
                    "INSERT INTO mcp_tools (tool_id, server_id, declared_name, descriptor_json, input_schema, schema_digest, discovered_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        tool.descriptor.tool_id,
                        server_id,
                        tool.declared_name,
                        serde_json::to_string(&tool.descriptor).unwrap_or_default(),
                        tool.input_schema,
                        tool.descriptor.provenance.schema_digest,
                        now
                    ],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
    }

    // ——— سجل الاستدعاءات.

    pub fn save_invocation(&self, record: &ToolInvocationRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO tool_invocations (invocation_id, mission_id, task_id, agent_id, skill_id, tool_id, status, denial_reason,
                    effects_json, arguments_digest, result_digest, evidence_id, approval_id, summary, started_at, duration_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
                 ON CONFLICT (invocation_id) DO NOTHING",
                params![
                    record.invocation_id,
                    record.mission_id,
                    record.task_id,
                    record.agent_id,
                    record.skill_id,
                    record.tool_id,
                    record.status.as_str(),
                    record.denial_reason,
                    effects_json(&record.effects),
                    record.arguments_digest,
                    record.result_digest,
                    record.evidence_id,
                    record.approval_id,
                    record.summary,
                    record.started_at,
                    record.duration_ms as i64
                ],
            )?;
            Ok(())
        })
    }

    pub fn invocations(&self, mission_id: Option<&str>, limit: usize) -> Result<Vec<ToolInvocationRecord>, StorageError> {
        let bounded = limit.clamp(1, 500) as i64;
        self.db.with(|conn| {
            let read = |r: &Row<'_>| -> rusqlite::Result<ToolInvocationRecord> {
                Ok(ToolInvocationRecord {
                    invocation_id: r.get(0)?,
                    mission_id: r.get(1)?,
                    task_id: r.get(2)?,
                    agent_id: r.get(3)?,
                    skill_id: r.get(4)?,
                    tool_id: r.get(5)?,
                    status: InvocationStatus::parse(&r.get::<_, String>(6)?).unwrap_or(InvocationStatus::Failed),
                    denial_reason: r.get(7)?,
                    effects: effects_from(&r.get::<_, String>(8)?),
                    arguments_digest: r.get(9)?,
                    result_digest: r.get(10)?,
                    evidence_id: r.get(11)?,
                    approval_id: r.get(12)?,
                    summary: r.get(13)?,
                    started_at: r.get(14)?,
                    duration_ms: r.get::<_, i64>(15)? as u64,
                })
            };
            let columns = "invocation_id, mission_id, task_id, agent_id, skill_id, tool_id, status, denial_reason, effects_json, arguments_digest, result_digest, evidence_id, approval_id, summary, started_at, duration_ms";
            // استعلام واحد لكل الحالتين: الفرع الذي يُسمّي مهمّة يقيّد بها، والفرع
            // الذي لا يسمّي يمرّ. كتابتهما استعلامين منفصلين تجعل عمر الجملة
            // المُعدّة داخل الفرع، وهو ما لا يحيا حتى تُقرأ صفوفه.
            let filter = mission_id.unwrap_or_default();
            let all = i64::from(mission_id.is_none());
            let mut statement = conn.prepare(&format!(
                "SELECT {columns} FROM tool_invocations WHERE (?1 = 1 OR mission_id = ?2)
                 ORDER BY started_at DESC, invocation_id DESC LIMIT ?3"
            ))?;
            let rows = statement.query_map(params![all, filter, bounded], read)?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    // ——— الموافقات.

    pub fn save_approval(&self, record: &ApprovalRecord) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO tool_approvals (approval_id, mission_id, task_id, tool_id, skill_id, arguments_digest, effects_json,
                    binding_digest, arguments_preview, reason, status, requested_at_ms, requested_at, decided_at, expires_at_ms, expires_at,
                    context_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
                 ON CONFLICT (approval_id) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at",
                params![
                    record.approval_id,
                    record.binding.mission_id,
                    record.binding.task_id,
                    record.binding.tool_id,
                    record.skill_id,
                    record.binding.arguments_digest,
                    effects_json(&record.binding.effects),
                    record.binding.digest(),
                    record.arguments_preview,
                    record.reason,
                    record.status.as_str(),
                    record.requested_at_ms as i64,
                    record.requested_at,
                    record.decided_at,
                    record.expires_at_ms as i64,
                    record.expires_at,
                    // الملخّص الموثوق (Phase-05). يُحفظ مع الطلب فيبقى معروضًا بعد إعادة التشغيل.
                    record.context.as_ref().and_then(|c| serde_json::to_string(c).ok())
                ],
            )?;
            Ok(())
        })
    }

    pub fn approvals(&self, mission_id: Option<&str>) -> Result<Vec<ApprovalRecord>, StorageError> {
        self.db.with(|conn| {
            let read = |r: &Row<'_>| -> rusqlite::Result<ApprovalRecord> {
                Ok(ApprovalRecord {
                    approval_id: r.get(0)?,
                    binding: ApprovalBinding {
                        mission_id: r.get(1)?,
                        task_id: r.get(2)?,
                        tool_id: r.get(3)?,
                        arguments_digest: r.get(5)?,
                        effects: effects_from(&r.get::<_, String>(6)?),
                    },
                    skill_id: r.get(4)?,
                    arguments_preview: r.get(7)?,
                    reason: r.get(8)?,
                    status: ApprovalStatus::parse(&r.get::<_, String>(9)?).unwrap_or(ApprovalStatus::Expired),
                    requested_at_ms: r.get::<_, i64>(10)? as u64,
                    requested_at: r.get(11)?,
                    decided_at: r.get(12)?,
                    expires_at_ms: r.get::<_, i64>(13)? as u64,
                    expires_at: r.get(14)?,
                    context: r.get::<_, Option<String>>(15)?.and_then(|text| serde_json::from_str(&text).ok()),
                })
            };
            let columns = "approval_id, mission_id, task_id, tool_id, skill_id, arguments_digest, effects_json, arguments_preview, reason, status, requested_at_ms, requested_at, decided_at, expires_at_ms, expires_at, context_json";
            let filter = mission_id.unwrap_or_default();
            let all = i64::from(mission_id.is_none());
            let mut statement = conn.prepare(&format!(
                "SELECT {columns} FROM tool_approvals WHERE (?1 = 1 OR mission_id = ?2) ORDER BY requested_at DESC LIMIT 200"
            ))?;
            let rows = statement.query_map(params![all, filter], read)?.collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /// بعد إقلاع جديد: كل موافقة كانت معلّقة لم يعد لها مَن ينتظرها.
    ///
    /// تركها معلّقة يعني أن نداءً من تشغيل سابق قد يُستكمَل بموافقة أُعطيت لسياق
    /// انتهى. الانتهاء بإعادة التشغيل هو الجواب الصادق.
    pub fn expire_pending_after_restart(&self, now: &str) -> Result<u32, StorageError> {
        self.db.with(|conn| {
            let changed = conn.execute(
                "UPDATE tool_approvals SET status = 'EXPIRED', decided_at = ?1 WHERE status IN ('PENDING', 'GRANTED')",
                [now],
            )?;
            Ok(changed as u32)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p04::approval::DEFAULT_APPROVAL_TTL_MS;

    fn repository() -> Phase04Repository {
        Phase04Repository::new(Arc::new(Database::in_memory().expect("an in-memory database")))
    }

    fn server() -> McpServer {
        McpServer {
            server_id: crate::ids::new_uuid_v4(),
            name: "fixture".into(),
            endpoint: "http://127.0.0.1:4200/mcp".into(),
            transport: McpTransport::LoopbackHttp,
            state: McpServerState::Enabled,
            granted_effects: vec![ToolEffect::LocalCompute, ToolEffect::NetworkEgress],
            tool_count: 1,
            rejected_tool_count: 2,
            last_error: None,
            last_refresh_at: Some("2026-09-22T00:01:00Z".into()),
            registered_at: "2026-09-22T00:00:00Z".into(),
        }
    }

    #[test]
    fn a_server_survives_a_save_and_read_round_trip() {
        let repository = repository();
        let server = server();
        repository.save_server(&server).unwrap();
        let read = repository.server(&server.server_id).unwrap().expect("the server is stored");
        assert_eq!(read, server);
        assert_eq!(repository.servers().unwrap().len(), 1);
    }

    #[test]
    fn the_store_itself_refuses_a_destination_outside_the_loopback_interface() {
        let repository = repository();
        let mut remote = server();
        remote.endpoint = "https://example.invalid/mcp".into();
        assert!(repository.save_server(&remote).is_err(), "a remote endpoint was stored");
    }

    #[test]
    fn skill_state_is_the_only_thing_persisted_about_a_skill() {
        let repository = repository();
        repository.set_skill_enabled("polaris.skill.project-note", false, "2026-09-22T00:00:00Z").unwrap();
        repository.set_skill_enabled("polaris.skill.project-note", true, "2026-09-22T00:05:00Z").unwrap();
        let states = repository.skill_states().unwrap();
        assert_eq!(states.len(), 1, "the same skill was stored twice");
        assert!(states[0].1);
        assert_eq!(states[0].2, "2026-09-22T00:05:00Z");
    }

    #[test]
    fn an_invocation_is_stored_once_and_read_back_newest_first() {
        let repository = repository();
        let base = ToolInvocationRecord {
            invocation_id: "i1".into(),
            mission_id: "m1".into(),
            task_id: "t1".into(),
            agent_id: "a1".into(),
            skill_id: "s".into(),
            tool_id: "polaris.tool.audit.chain.verify".into(),
            status: InvocationStatus::Succeeded,
            denial_reason: None,
            effects: vec![ToolEffect::DatabaseRead],
            arguments_digest: "d".into(),
            result_digest: Some("r".into()),
            evidence_id: Some("e".into()),
            approval_id: None,
            summary: "ok".into(),
            started_at: "2026-09-22T00:00:00Z".into(),
            duration_ms: 4,
        };
        repository.save_invocation(&base).unwrap();
        repository.save_invocation(&base).unwrap();
        let later = ToolInvocationRecord { invocation_id: "i2".into(), started_at: "2026-09-22T00:00:05Z".into(), ..base.clone() };
        repository.save_invocation(&later).unwrap();
        let read = repository.invocations(Some("m1"), 10).unwrap();
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].invocation_id, "i2");
        assert_eq!(read[0].effects, vec![ToolEffect::DatabaseRead]);
        assert!(repository.invocations(Some("m2"), 10).unwrap().is_empty());
    }

    #[test]
    fn an_approval_keeps_its_whole_binding_across_a_round_trip() {
        let repository = repository();
        let record = ApprovalRecord {
            approval_id: "a1".into(),
            binding: ApprovalBinding::new("m1", "t1", "polaris.tool.project.note.append", "argdigest", &[ToolEffect::WriteLocal]),
            skill_id: "polaris.skill.project-note".into(),
            arguments_preview: "{\"title\":\"x\"}".into(),
            reason: "the agent asked".into(),
            status: ApprovalStatus::Pending,
            requested_at_ms: 1000,
            requested_at: "2026-09-22T00:00:00Z".into(),
            decided_at: None,
            expires_at_ms: 1000 + DEFAULT_APPROVAL_TTL_MS,
            expires_at: "2026-09-22T00:05:00Z".into(),
            context: None,
        };
        repository.save_approval(&record).unwrap();
        let read = repository.approvals(Some("m1")).unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].binding, record.binding);
        assert_eq!(read[0].status, ApprovalStatus::Pending);
    }

    #[test]
    fn a_restart_ends_every_approval_that_was_waiting_or_granted() {
        let repository = repository();
        for (id, status) in [("a1", ApprovalStatus::Pending), ("a2", ApprovalStatus::Granted), ("a3", ApprovalStatus::Denied)] {
            repository
                .save_approval(&ApprovalRecord {
                    approval_id: id.into(),
                    binding: ApprovalBinding::new("m1", "t1", "polaris.tool.project.note.append", "d", &[ToolEffect::WriteLocal]),
                    skill_id: "s".into(),
                    arguments_preview: "{}".into(),
                    reason: "r".into(),
                    status,
                    requested_at_ms: 1,
                    requested_at: "2026-09-22T00:00:00Z".into(),
                    decided_at: None,
                    expires_at_ms: 2,
                    expires_at: "2026-09-22T00:05:00Z".into(),
                    context: None,
                })
                .unwrap();
        }
        assert_eq!(repository.expire_pending_after_restart("2026-09-22T01:00:00Z").unwrap(), 2);
        let read = repository.approvals(Some("m1")).unwrap();
        assert_eq!(read.iter().filter(|r| r.status == ApprovalStatus::Expired).count(), 2);
        assert_eq!(read.iter().filter(|r| r.status == ApprovalStatus::Denied).count(), 1);
    }
}
