// الإلحاق بالسلسلة والتحقق منها.
//
// تجزئة كل سجل تغطي تجزئة السابق وكل حقوله بترتيب ثابت، فأي تعديل أو حذف أو
// إدراج في الوسط يكسر السلسلة عند أول سجل بعده.

use std::sync::Arc;

use rusqlite::params;
use serde_json::Value;

use super::events::AuditRecord;
use crate::digest::sha256_hex;
use crate::ids::new_uuid_v4;
use crate::storage::{Database, StorageError};
use crate::time::now_rfc3339_utc;

pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// المفاتيح المحظورة في التفصيل. وجود أحدها عيب برمجي يُرفض.
const FORBIDDEN_DETAIL_KEYS: &[&str] = &["api_key", "apikey", "secret", "password", "token", "authorization", "credential_value", "prompt", "text", "content"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainVerification {
    Intact { records: u64 },
    Broken { at_seq: i64, reason: String },
}

pub struct AuditLedger {
    db: Arc<Database>,
}

/// الحقول بالترتيب: السابق، المعرّف، النوع، الوقت، نوع الموضوع، معرّفه، النتيجة، التفصيل.
fn record_hash(fields: [&str; 8]) -> String {
    let material = fields.join("\u{1f}");
    sha256_hex(material.as_bytes())
}

fn detail_is_clean(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().all(|(k, v)| {
            let lower = k.to_ascii_lowercase();
            !FORBIDDEN_DETAIL_KEYS.contains(&lower.as_str()) && detail_is_clean(v)
        }),
        Value::Array(items) => items.iter().all(detail_is_clean),
        Value::String(s) => s.len() <= 256,
        _ => true,
    }
}

impl AuditLedger {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// يُلحق سجلًا. التفصيل غير النظيف يُرفض ولا يُكتب منه شيء.
    pub fn append(&self, record: &AuditRecord) -> Result<String, StorageError> {
        if !detail_is_clean(&record.detail) {
            return Err(StorageError::Invalid("audit detail carries a forbidden key or an oversized value".into()));
        }
        let detail = serde_json::to_string(&record.detail).map_err(|e| StorageError::Invalid(e.to_string()))?;
        let event_id = new_uuid_v4();
        let occurred_at = now_rfc3339_utc();
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            let prev: String = tx
                .query_row("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1", [], |r| r.get(0))
                .unwrap_or_else(|_| GENESIS.to_string());
            let hash = record_hash([
                &prev,
                &event_id,
                record.event_type.as_str(),
                &occurred_at,
                record.subject_kind,
                &record.subject_id,
                record.outcome.as_str(),
                &detail,
            ]);
            tx.execute(
                "INSERT INTO audit_events (event_id, event_type, occurred_at, subject_kind, subject_id, outcome, detail_json, prev_hash, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![event_id, record.event_type.as_str(), occurred_at, record.subject_kind, record.subject_id, record.outcome.as_str(), detail, prev, hash],
            )?;
            tx.commit()?;
            Ok(event_id.clone())
        })
    }

    /// يتحقق من السلسلة كاملة.
    pub fn verify(&self) -> Result<ChainVerification, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT seq, event_id, event_type, occurred_at, subject_kind, subject_id, outcome, detail_json, prev_hash, hash FROM audit_events ORDER BY seq ASC",
            )?;
            let rows = statement.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                ))
            })?;
            let mut expected_prev = GENESIS.to_string();
            let mut count = 0u64;
            for row in rows {
                let (seq, id, kind, at, sk, sid, outcome, detail, prev, hash) = row?;
                if prev != expected_prev {
                    return Ok(ChainVerification::Broken { at_seq: seq, reason: "previous hash mismatch".into() });
                }
                if record_hash([&prev, &id, &kind, &at, &sk, &sid, &outcome, &detail]) != hash {
                    return Ok(ChainVerification::Broken { at_seq: seq, reason: "record hash mismatch".into() });
                }
                expected_prev = hash;
                count += 1;
            }
            Ok(ChainVerification::Intact { records: count })
        })
    }

    /// عدد السجلات من نوع معيّن. للاختبار ولأدلة التشغيل.
    pub fn count(&self, event_type: &str) -> Result<u64, StorageError> {
        self.db.with(|conn| {
            let n: i64 = conn.query_row("SELECT count(*) FROM audit_events WHERE event_type = ?1", [event_type], |r| r.get(0))?;
            Ok(n as u64)
        })
    }

    /// كل التفاصيل المسجّلة نصًّا، لفحص عدم التسريب.
    pub fn all_detail_text(&self) -> Result<String, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare("SELECT event_type || ' ' || subject_id || ' ' || detail_json FROM audit_events ORDER BY seq")?;
            let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
            let mut out = String::new();
            for row in rows {
                out.push_str(&row?);
                out.push('\n');
            }
            Ok(out)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::events::{AuditEventType, AuditOutcome};
    use serde_json::json;

    fn ledger() -> (AuditLedger, Arc<Database>) {
        let db = Arc::new(Database::in_memory().unwrap());
        (AuditLedger::new(db.clone()), db)
    }

    fn record(n: u32) -> AuditRecord {
        AuditRecord::new(AuditEventType::ProjectCreated, "project", format!("p{n}"), AuditOutcome::Success, json!({ "name_length": n }))
    }

    #[test]
    fn an_untouched_chain_verifies() {
        let (ledger, _) = ledger();
        for n in 0..5 {
            ledger.append(&record(n)).unwrap();
        }
        assert_eq!(ledger.verify().unwrap(), ChainVerification::Intact { records: 5 });
    }

    #[test]
    fn tampering_deleting_or_reordering_breaks_the_chain() {
        let (ledger, db) = ledger();
        for n in 0..4 {
            ledger.append(&record(n)).unwrap();
        }
        db.with(|c| Ok(c.execute("UPDATE audit_events SET detail_json = '{\"name_length\":99}' WHERE seq = 2", [])?)).unwrap();
        assert!(matches!(ledger.verify().unwrap(), ChainVerification::Broken { at_seq: 2, .. }));

        let (ledger, db) = self::ledger();
        for n in 0..4 {
            ledger.append(&record(n)).unwrap();
        }
        db.with(|c| Ok(c.execute("DELETE FROM audit_events WHERE seq = 2", [])?)).unwrap();
        assert!(matches!(ledger.verify().unwrap(), ChainVerification::Broken { at_seq: 3, .. }));
    }

    #[test]
    fn secrets_and_prompt_text_cannot_enter_the_detail() {
        let (ledger, _) = ledger();
        for bad in [json!({ "api_key": "x" }), json!({ "nested": { "Token": "x" } }), json!({ "prompt": "hello" }), json!({ "note": "x".repeat(300) })] {
            let rec = AuditRecord::new(AuditEventType::InvocationInitiated, "invocation", "i", AuditOutcome::Started, bad);
            assert!(ledger.append(&rec).is_err());
        }
        assert_eq!(ledger.verify().unwrap(), ChainVerification::Intact { records: 0 });
    }
}
