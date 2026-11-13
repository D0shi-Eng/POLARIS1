// حماية POLARIS نفسها من إعادة أثر خارجي عرضًا (البند 15).
//
// المفتاح نفسه بالحمولة نفسها: إعادة آمنة تُعيد النتيجة المحفوظة ولا تبلغ الخدمة.
// المفتاح نفسه بحمولة أخرى: تعارض. نداء انتهى ولا يُعرف أوقع أثره أم لا (مهلة بعد
// الإرسال، أو إقلاع قطعه): لا يُعاد آليًّا أبدًا، ويبقى محجوزًا حتى يقرّر إنسان.

use std::sync::Arc;

use rusqlite::params;

use crate::storage::{Database, StorageError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Begin {
    /// لا سجلّ سابق: حُجز المفتاح للنداء الحالي.
    Fresh,
    /// اكتمل سابقًا بالحمولة نفسها: هذه نتيجته المحفوظة.
    Replay { result_json: String, invocation_id: String },
    /// المفتاح نفسه بحمولة مختلفة.
    Conflict,
    /// نداء بالمفتاح نفسه جارٍ الآن.
    InFlight,
    /// نداء سابق بالمفتاح نفسه انتهى بنتيجة مجهولة. لا إعادة آلية.
    OutcomeUnknown,
}

pub struct IdempotencyLedger {
    db: Arc<Database>,
}

impl IdempotencyLedger {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// يبدأ نداءً بمفتاحه. العملية ذرّية داخل معاملة واحدة.
    pub fn begin(&self, connector_id: &str, operation_id: &str, key: &str, payload_digest: &str, invocation_id: &str, now: &str) -> Result<Begin, StorageError> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            let existing: Option<(String, String, Option<String>, String)> = {
                let mut statement = tx.prepare(
                    "SELECT payload_digest, state, result_json, invocation_id FROM connector_idempotency WHERE connector_id = ?1 AND operation_id = ?2 AND idempotency_key = ?3",
                )?;
                let mut rows = statement.query(params![connector_id, operation_id, key])?;
                match rows.next()? {
                    Some(r) => Some((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    None => None,
                }
            };
            let outcome = match existing {
                None => {
                    tx.execute(
                        "INSERT INTO connector_idempotency (connector_id, operation_id, idempotency_key, payload_digest, state, result_json, invocation_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, 'IN_FLIGHT', NULL, ?5, ?6, ?6)",
                        params![connector_id, operation_id, key, payload_digest, invocation_id, now],
                    )?;
                    Begin::Fresh
                }
                Some((digest, _, _, _)) if digest != payload_digest => Begin::Conflict,
                Some((_, state, result, previous)) => match state.as_str() {
                    "COMPLETED" => Begin::Replay { result_json: result.unwrap_or_default(), invocation_id: previous },
                    "IN_FLIGHT" => Begin::InFlight,
                    "OUTCOME_UNKNOWN" => Begin::OutcomeUnknown,
                    // فشل حاسم (رفضته الخدمة قبل أي أثر): محاولة جديدة بالمفتاح نفسه مسموحة.
                    _ => {
                        tx.execute(
                            "UPDATE connector_idempotency SET state = 'IN_FLIGHT', invocation_id = ?4, updated_at = ?5
                             WHERE connector_id = ?1 AND operation_id = ?2 AND idempotency_key = ?3",
                            params![connector_id, operation_id, key, invocation_id, now],
                        )?;
                        Begin::Fresh
                    }
                },
            };
            tx.commit()?;
            Ok(outcome)
        })
    }

    fn settle(&self, connector_id: &str, operation_id: &str, key: &str, state: &str, result_json: Option<&str>, now: &str) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "UPDATE connector_idempotency SET state = ?4, result_json = ?5, updated_at = ?6
                 WHERE connector_id = ?1 AND operation_id = ?2 AND idempotency_key = ?3",
                params![connector_id, operation_id, key, state, result_json.map(|r| r.chars().take(8000).collect::<String>()), now],
            )?;
            Ok(())
        })
    }

    pub fn complete(&self, connector_id: &str, operation_id: &str, key: &str, result_json: &str, now: &str) -> Result<(), StorageError> {
        self.settle(connector_id, operation_id, key, "COMPLETED", Some(result_json), now)
    }

    /// فشل حاسم: الخدمة ردّت بخطأ قبل أي أثر معروف.
    pub fn fail(&self, connector_id: &str, operation_id: &str, key: &str, now: &str) -> Result<(), StorageError> {
        self.settle(connector_id, operation_id, key, "FAILED", None, now)
    }

    /// لا يُعرف أوقع الأثر أم لا.
    pub fn unknown(&self, connector_id: &str, operation_id: &str, key: &str, now: &str) -> Result<(), StorageError> {
        self.settle(connector_id, operation_id, key, "OUTCOME_UNKNOWN", None, now)
    }

    /// بعد الإقلاع: كل نداء كان جاريًا نتيجته مجهولة. لا يُعاد منه شيء (البند 55).
    pub fn recover_after_restart(&self, now: &str) -> Result<u32, StorageError> {
        self.db.with(|conn| Ok(conn.execute("UPDATE connector_idempotency SET state = 'OUTCOME_UNKNOWN', updated_at = ?1 WHERE state = 'IN_FLIGHT'", [now])? as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger() -> IdempotencyLedger {
        IdempotencyLedger::new(Arc::new(Database::in_memory().unwrap()))
    }

    #[test]
    fn same_key_and_payload_replays_and_a_different_payload_conflicts() {
        let l = ledger();
        assert_eq!(l.begin("c", "o", "key-00000001", "d1", "i1", "t").unwrap(), Begin::Fresh);
        assert_eq!(l.begin("c", "o", "key-00000001", "d1", "i2", "t").unwrap(), Begin::InFlight, "a concurrent duplicate was admitted");
        l.complete("c", "o", "key-00000001", "{\"ok\":true}", "t").unwrap();
        assert_eq!(l.begin("c", "o", "key-00000001", "d1", "i3", "t").unwrap(), Begin::Replay { result_json: "{\"ok\":true}".into(), invocation_id: "i1".into() });
        assert_eq!(l.begin("c", "o", "key-00000001", "d2", "i4", "t").unwrap(), Begin::Conflict);
    }

    #[test]
    fn an_unknown_outcome_is_never_replayed_automatically() {
        let l = ledger();
        l.begin("c", "o", "key-00000002", "d1", "i1", "t").unwrap();
        l.unknown("c", "o", "key-00000002", "t").unwrap();
        assert_eq!(l.begin("c", "o", "key-00000002", "d1", "i2", "t").unwrap(), Begin::OutcomeUnknown);
    }

    #[test]
    fn a_definitive_failure_may_be_tried_again_with_the_same_key() {
        let l = ledger();
        l.begin("c", "o", "key-00000003", "d1", "i1", "t").unwrap();
        l.fail("c", "o", "key-00000003", "t").unwrap();
        assert_eq!(l.begin("c", "o", "key-00000003", "d1", "i2", "t").unwrap(), Begin::Fresh);
    }

    #[test]
    fn a_call_in_flight_at_a_restart_becomes_an_unknown_outcome_and_does_not_replay() {
        let db = Arc::new(Database::in_memory().unwrap());
        let before = IdempotencyLedger::new(db.clone());
        before.begin("c", "o", "key-00000004", "d1", "i1", "t").unwrap();
        let after = IdempotencyLedger::new(db);
        assert_eq!(after.recover_after_restart("t2").unwrap(), 1);
        assert_eq!(after.begin("c", "o", "key-00000004", "d1", "i2", "t3").unwrap(), Begin::OutcomeUnknown);
    }
}
