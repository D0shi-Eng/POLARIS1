// مفاتيح Idempotency للعمليات ذات الأثر الجانبي.
//
// المفتاح نفسه مع الحمولة نفسها يعيد النتيجة المحفوظة دون تكرار الأثر. المفتاح
// نفسه مع حمولة مختلفة تعارضٌ صريح لا تنفيذ جديد. الذاكرة محدودة.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde_json::Value;

use crate::digest::sha256_hex;

const CAPACITY: usize = 512;

struct Entry {
    key: String,
    payload_digest: String,
    result: Value,
}

#[derive(Default)]
pub struct IdempotencyCache {
    entries: Mutex<VecDeque<Entry>>,
}

#[derive(Debug, PartialEq)]
pub enum Lookup {
    Miss,
    Replay(Value),
    Conflict,
}

fn key_of(session: &str, operation: &str, idempotency_key: &str) -> String {
    format!("{session}\u{1f}{operation}\u{1f}{idempotency_key}")
}

pub fn payload_digest(payload: &Value) -> String {
    sha256_hex(payload.to_string().as_bytes())
}

impl IdempotencyCache {
    pub fn lookup(&self, session: &str, operation: &str, idempotency_key: &str, payload: &Value) -> Lookup {
        let key = key_of(session, operation, idempotency_key);
        let digest = payload_digest(payload);
        let Ok(entries) = self.entries.lock() else { return Lookup::Miss };
        match entries.iter().find(|e| e.key == key) {
            None => Lookup::Miss,
            Some(e) if e.payload_digest == digest => Lookup::Replay(e.result.clone()),
            Some(_) => Lookup::Conflict,
        }
    }

    pub fn store(&self, session: &str, operation: &str, idempotency_key: &str, payload: &Value, result: &Value) {
        let Ok(mut entries) = self.entries.lock() else { return };
        if entries.len() >= CAPACITY {
            entries.pop_front();
        }
        entries.push_back(Entry {
            key: key_of(session, operation, idempotency_key),
            payload_digest: payload_digest(payload),
            result: result.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn same_key_same_payload_replays_and_different_payload_conflicts() {
        let cache = IdempotencyCache::default();
        let payload = json!({ "name": "A" });
        assert_eq!(cache.lookup("s", "project.create", "k1", &payload), Lookup::Miss);
        cache.store("s", "project.create", "k1", &payload, &json!({ "ok": 1 }));
        assert_eq!(cache.lookup("s", "project.create", "k1", &payload), Lookup::Replay(json!({ "ok": 1 })));
        assert_eq!(cache.lookup("s", "project.create", "k1", &json!({ "name": "B" })), Lookup::Conflict);
        assert_eq!(cache.lookup("s", "project.update", "k1", &payload), Lookup::Miss, "keys are per operation");
        assert_eq!(cache.lookup("other", "project.create", "k1", &payload), Lookup::Miss, "keys are per session");
    }

    #[test]
    fn the_cache_is_bounded() {
        let cache = IdempotencyCache::default();
        for i in 0..(CAPACITY + 10) {
            cache.store("s", "op", &format!("k{i}"), &json!({}), &json!({}));
        }
        assert_eq!(cache.lookup("s", "op", "k0", &json!({})), Lookup::Miss);
        assert_eq!(cache.lookup("s", "op", &format!("k{}", CAPACITY + 9), &json!({})), Lookup::Replay(json!({})));
    }
}
