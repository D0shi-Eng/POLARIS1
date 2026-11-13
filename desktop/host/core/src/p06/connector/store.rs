// مخزن الموصلات: المثيلات وعملياتها، وسجلّ الاستدعاءات، واقتراحات الاستيراد.
//
// الإعداد يُحفظ JSON مُصنَّفًا ويُقرأ بالنوع نفسه، ثم يُتحقق منه كما يُتحقق عند
// التسجيل: صفّ عُدِّل على القرص خارج المضيف لا يصير موصلًا يعمل. ولا قيمة سرّ هنا.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::storage::{Database, StorageError};

use super::model::{
    ConnectorCategory, ConnectorConfig, ConnectorInstance, ConnectorOperation, ConnectorProvenance, ConnectorProvider, InvocationOutcome, OperationAction,
};

pub struct ConnectorStore {
    db: Arc<Database>,
}

/// سجلّ استدعاء واحد كما يُحفظ ويُعرض.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InvocationRow {
    pub invocation_id: String,
    pub connector_id: String,
    pub operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub action: String,
    pub status: String,
    pub attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,
    pub resource_refs: Vec<String>,
    pub summary: String,
    pub latency_ms: u64,
    pub started_at: String,
}

/// اقتراح استيراد محفوظ.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportRow {
    pub import_id: String,
    pub spec_digest: String,
    pub title: String,
    pub proposals_json: String,
    pub rejected_json: String,
    pub status: String,
    pub connector_id: Option<String>,
    pub created_at: String,
}

impl ConnectorStore {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn save(&self, instance: &ConnectorInstance) -> Result<(), StorageError> {
        let config = serde_json::to_string(&instance.config).map_err(|e| StorageError::Invalid(e.to_string()))?;
        let provenance = serde_json::to_string(&instance.provenance).map_err(|e| StorageError::Invalid(e.to_string()))?;
        let auth_mode = instance.auth_mode().as_str();
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO connectors (connector_id, provider, category, display_name, version, enabled, auth_mode, config_json, provenance_json,
                    credential_updated_at, registered_at, updated_at, last_activity_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
                 ON CONFLICT (connector_id) DO UPDATE SET display_name = excluded.display_name, version = excluded.version, enabled = excluded.enabled,
                    auth_mode = excluded.auth_mode, config_json = excluded.config_json, credential_updated_at = excluded.credential_updated_at,
                    updated_at = excluded.updated_at, last_activity_at = excluded.last_activity_at",
                params![
                    instance.connector_id,
                    instance.provider.as_str(),
                    instance.category.as_str(),
                    instance.display_name,
                    instance.version,
                    instance.enabled as i64,
                    auth_mode,
                    config,
                    provenance,
                    instance.credential_updated_at,
                    instance.registered_at,
                    instance.updated_at,
                    instance.last_activity_at,
                ],
            )?;
            tx.execute("DELETE FROM connector_operations WHERE connector_id = ?1", [&instance.connector_id])?;
            for op in &instance.operations {
                let definition = serde_json::to_string(op).map_err(|e| StorageError::Invalid(e.to_string()))?;
                tx.execute(
                    "INSERT INTO connector_operations (connector_id, operation_id, action, definition_json) VALUES (?1, ?2, ?3, ?4)",
                    params![instance.connector_id, op.operation_id, op.action.as_str(), definition],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
    }

    pub fn remove(&self, connector_id: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM connector_operations WHERE connector_id = ?1", [connector_id])?;
            let removed = tx.execute("DELETE FROM connectors WHERE connector_id = ?1", [connector_id])?;
            tx.commit()?;
            Ok(removed > 0)
        })
    }

    /// كل المثيلات. صفّ لا يُقرأ بنوعه يُعدّ ويُتخطّى، ولا يُصلح في الذاكرة.
    pub fn load(&self) -> Result<(Vec<ConnectorInstance>, u32), StorageError> {
        #[allow(clippy::type_complexity)]
        let rows: Vec<(String, String, String, String, String, i64, String, String, Option<String>, String, String, Option<String>)> = self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT connector_id, provider, category, display_name, version, enabled, config_json, provenance_json, credential_updated_at,
                        registered_at, updated_at, last_activity_at FROM connectors ORDER BY registered_at, connector_id",
            )?;
            let mapped = statement.query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in mapped {
                out.push(row?);
            }
            Ok(out)
        })?;
        let mut instances = Vec::new();
        let mut unreadable = 0u32;
        for row in rows {
            let operations = self.operations(&row.0)?;
            let parsed = (
                ConnectorProvider::parse(&row.1),
                ConnectorCategory::parse(&row.2),
                serde_json::from_str::<ConnectorConfig>(&row.6),
                serde_json::from_str::<ConnectorProvenance>(&row.7),
            );
            let (Some(provider), Some(category), Ok(config), Ok(provenance)) = parsed else {
                unreadable += 1;
                continue;
            };
            let Some(operations) = operations else {
                unreadable += 1;
                continue;
            };
            instances.push(ConnectorInstance {
                connector_id: row.0,
                provider,
                category,
                display_name: row.3,
                version: row.4,
                enabled: row.5 == 1,
                config,
                operations,
                provenance,
                credential_updated_at: row.8,
                registered_at: row.9,
                updated_at: row.10,
                last_activity_at: row.11,
            });
        }
        Ok((instances, unreadable))
    }

    fn operations(&self, connector_id: &str) -> Result<Option<Vec<ConnectorOperation>>, StorageError> {
        let rows: Vec<(String, String)> = self.db.with(|conn| {
            let mut statement = conn.prepare("SELECT action, definition_json FROM connector_operations WHERE connector_id = ?1 ORDER BY operation_id")?;
            let mapped = statement.query_map([connector_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            let mut out = Vec::new();
            for row in mapped {
                out.push(row?);
            }
            Ok(out)
        })?;
        let mut out = Vec::new();
        for (action, json) in rows {
            let Ok(op) = serde_json::from_str::<ConnectorOperation>(&json) else { return Ok(None) };
            // العمود والتعريف يجب أن يتّفقا: فعلٌ عُدِّل في أحدهما وحده لا يُقرأ.
            if OperationAction::parse(&action) != Some(op.action) {
                return Ok(None);
            }
            out.push(op);
        }
        Ok(Some(out))
    }

    pub fn touch(&self, connector_id: &str, at: &str) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute("UPDATE connectors SET last_activity_at = ?2 WHERE connector_id = ?1", params![connector_id, at])?;
            Ok(())
        })
    }

    pub fn record_invocation(&self, row: &InvocationRow, retention: usize) -> Result<(), StorageError> {
        let refs = serde_json::to_string(&row.resource_refs).unwrap_or_else(|_| "[]".into());
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO connector_invocations (invocation_id, connector_id, operation_id, mission_id, task_id, action, status, attempts, http_status,
                    reason_code, result_digest, resource_refs, summary, latency_ms, started_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    row.invocation_id,
                    row.connector_id,
                    row.operation_id,
                    row.mission_id,
                    row.task_id,
                    row.action,
                    row.status,
                    row.attempts as i64,
                    row.http_status.map(i64::from),
                    row.reason_code,
                    row.result_digest,
                    refs,
                    row.summary,
                    row.latency_ms as i64,
                    row.started_at,
                ],
            )?;
            conn.execute(
                "DELETE FROM connector_invocations WHERE invocation_id IN (SELECT invocation_id FROM connector_invocations ORDER BY started_at DESC, invocation_id DESC LIMIT -1 OFFSET ?1)",
                [retention as i64],
            )?;
            Ok(())
        })
    }

    pub fn invocations(&self, connector_id: Option<&str>, mission_id: Option<&str>, limit: usize) -> Result<Vec<InvocationRow>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT invocation_id, connector_id, operation_id, mission_id, task_id, action, status, attempts, http_status, reason_code, result_digest,
                        resource_refs, summary, latency_ms, started_at
                 FROM connector_invocations WHERE (?1 IS NULL OR connector_id = ?1) AND (?2 IS NULL OR mission_id = ?2)
                 ORDER BY started_at DESC, rowid DESC LIMIT ?3",
            )?;
            let mapped = statement.query_map(params![connector_id, mission_id, limit.clamp(1, 1_000) as i64], |r| {
                let refs: String = r.get(11)?;
                Ok(InvocationRow {
                    invocation_id: r.get(0)?,
                    connector_id: r.get(1)?,
                    operation_id: r.get(2)?,
                    mission_id: r.get(3)?,
                    task_id: r.get(4)?,
                    action: r.get(5)?,
                    status: r.get(6)?,
                    attempts: r.get::<_, i64>(7)?.clamp(0, 10) as u32,
                    http_status: r.get::<_, Option<i64>>(8)?.map(|s| s.clamp(0, 999) as u16),
                    reason_code: r.get(9)?,
                    result_digest: r.get(10)?,
                    resource_refs: serde_json::from_str(&refs).unwrap_or_default(),
                    summary: r.get(12)?,
                    latency_ms: r.get::<_, i64>(13)?.max(0) as u64,
                    started_at: r.get(14)?,
                })
            })?;
            let mut out = Vec::new();
            for row in mapped {
                out.push(row?);
            }
            Ok(out)
        })
    }

    /// عدد النداءات التي بلغت الخدمة لمهمّة. المرفوض قبل الإرسال لا يُعدّ.
    pub fn external_calls_for_mission(&self, mission_id: &str) -> Result<u64, StorageError> {
        self.db.with(|conn| {
            Ok(conn.query_row(
                "SELECT COALESCE(SUM(attempts), 0) FROM connector_invocations WHERE mission_id = ?1 AND status NOT IN ('DENIED', 'REPLAYED')",
                [mission_id],
                |r| r.get::<_, i64>(0),
            )?
            .max(0) as u64)
        })
    }

    pub fn save_import(&self, row: &ImportRow) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO connector_imports (import_id, spec_digest, title, proposals_json, rejected_json, status, connector_id, created_at, decided_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)
                 ON CONFLICT (import_id) DO UPDATE SET status = excluded.status, connector_id = excluded.connector_id, decided_at = excluded.created_at",
                params![row.import_id, row.spec_digest, row.title, row.proposals_json, row.rejected_json, row.status, row.connector_id, row.created_at],
            )?;
            Ok(())
        })
    }

    pub fn import(&self, import_id: &str) -> Result<Option<ImportRow>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT import_id, spec_digest, title, proposals_json, rejected_json, status, connector_id, created_at FROM connector_imports WHERE import_id = ?1",
            )?;
            let mut rows = statement.query([import_id])?;
            Ok(match rows.next()? {
                Some(r) => Some(ImportRow {
                    import_id: r.get(0)?,
                    spec_digest: r.get(1)?,
                    title: r.get(2)?,
                    proposals_json: r.get(3)?,
                    rejected_json: r.get(4)?,
                    status: r.get(5)?,
                    connector_id: r.get(6)?,
                    created_at: r.get(7)?,
                }),
                None => None,
            })
        })
    }
}

pub fn outcome_code(outcome: InvocationOutcome) -> &'static str {
    outcome.as_str()
}

#[cfg(test)]
mod tests {
    use super::super::model::tests::{read_op, rest};
    use super::super::model::{EgressClass, ProvenanceOrigin};
    use super::*;

    fn instance() -> ConnectorInstance {
        ConnectorInstance {
            connector_id: "11111111-1111-4111-8111-111111111111".into(),
            provider: ConnectorProvider::Rest,
            category: ConnectorCategory::CustomApi,
            display_name: "fixture".into(),
            version: "1".into(),
            enabled: true,
            config: ConnectorConfig::Rest(rest("http://127.0.0.1:1/", EgressClass::Loopback)),
            operations: vec![read_op()],
            provenance: ConnectorProvenance { origin: ProvenanceOrigin::UserRegistered, import_id: None, spec_digest: None, registered_at: "t".into() },
            credential_updated_at: None,
            registered_at: "t".into(),
            updated_at: "t".into(),
            last_activity_at: None,
        }
    }

    #[test]
    fn an_instance_round_trips_and_a_tampered_operation_is_not_read() {
        let db = Arc::new(Database::in_memory().unwrap());
        let store = ConnectorStore::new(db.clone());
        store.save(&instance()).unwrap();
        let (loaded, unreadable) = store.load().unwrap();
        assert_eq!(unreadable, 0);
        assert_eq!(loaded, vec![instance()]);
        // العمود يقول READ والتعريف يقول DELETE: لا يُقرأ.
        db.with(|c| {
            c.execute("UPDATE connector_operations SET definition_json = replace(definition_json, '\"READ\"', '\"DELETE\"')", [])?;
            Ok(())
        })
        .unwrap();
        let (loaded, unreadable) = store.load().unwrap();
        assert!(loaded.is_empty());
        assert_eq!(unreadable, 1);
    }

    #[test]
    fn invocations_are_bounded_by_retention() {
        let db = Arc::new(Database::in_memory().unwrap());
        let store = ConnectorStore::new(db);
        for i in 0..12 {
            store
                .record_invocation(
                    &InvocationRow {
                        invocation_id: format!("i{i:02}"),
                        connector_id: "c".into(),
                        operation_id: "o".into(),
                        mission_id: Some("m".into()),
                        task_id: None,
                        action: "READ".into(),
                        status: "SUCCEEDED".into(),
                        attempts: 1,
                        http_status: Some(200),
                        reason_code: None,
                        result_digest: None,
                        resource_refs: vec![],
                        summary: "s".into(),
                        latency_ms: 1,
                        started_at: format!("2026-09-23T00:00:{i:02}Z"),
                    },
                    5,
                )
                .unwrap();
        }
        assert_eq!(store.invocations(None, None, 100).unwrap().len(), 5);
        assert_eq!(store.external_calls_for_mission("m").unwrap(), 5);
    }
}
