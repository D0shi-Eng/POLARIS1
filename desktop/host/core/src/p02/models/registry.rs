// سجل النماذج المكتشفة.
//
// أربع حقائق منفصلة: مكتشف (له سجل)، ومفعّل (قرار المستخدم)، ومتاح (ظهر في آخر
// قائمة)، ومحمّل (كما أبلغ الخادم). التحديث لا يحذف: نموذج اختفى يصير MISSING
// ويبقى إعداده، ومزوّد لم يُجب يجعل نماذجه PROVIDER_UNREACHABLE لا محذوفة.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use polaris_host_providers::domain::DiscoveredModel;

use crate::p02::errors::P02Error;
use crate::storage::{Database, StorageError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelAvailability {
    Available,
    Missing,
    ProviderUnreachable,
    Unknown,
}

impl ModelAvailability {
    fn code(self) -> &'static str {
        match self {
            Self::Available => "AVAILABLE",
            Self::Missing => "MISSING",
            Self::ProviderUnreachable => "PROVIDER_UNREACHABLE",
            Self::Unknown => "UNKNOWN",
        }
    }

    fn parse(code: &str) -> Self {
        match code {
            "AVAILABLE" => Self::Available,
            "MISSING" => Self::Missing,
            "PROVIDER_UNREACHABLE" => Self::ProviderUnreachable,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ModelRecord {
    pub model_id: String,
    pub provider_id: String,
    pub facts: DiscoveredModel,
    pub enabled: bool,
    pub availability: ModelAvailability,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

/// معرّف النموذج الثابت.
pub fn model_id(provider_id: &str, provider_model_id: &str) -> String {
    format!("{provider_id}:{provider_model_id}")
}

pub struct ModelRegistry {
    db: Arc<Database>,
}

fn row_to_record(r: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, i64, String, String, String)> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
}

fn build(row: (String, String, String, i64, String, String, String)) -> Result<ModelRecord, StorageError> {
    let (model_id, provider_id, facts_json, enabled, availability, first, last) = row;
    let facts: DiscoveredModel = serde_json::from_str(&facts_json).map_err(|e| StorageError::Invalid(format!("model facts: {e}")))?;
    Ok(ModelRecord {
        model_id,
        provider_id,
        facts,
        enabled: enabled == 1,
        availability: ModelAvailability::parse(&availability),
        first_seen_at: first,
        last_seen_at: last,
    })
}

const SELECT: &str = "SELECT model_id, provider_id, facts_json, enabled, availability, first_seen_at, last_seen_at FROM models";

impl ModelRegistry {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// يدمج قائمة جديدة بذرّية: كل شيء أو لا شيء.
    pub fn merge(&self, provider_id: &str, discovered: &[DiscoveredModel], now: &str) -> Result<(), P02Error> {
        self.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE models SET availability = 'MISSING', last_refresh_at = ?2 WHERE provider_id = ?1",
                params![provider_id, now],
            )?;
            for model in discovered {
                let id = model_id(provider_id, &model.provider_model_id);
                let facts = serde_json::to_string(model).map_err(|e| StorageError::Invalid(e.to_string()))?;
                tx.execute(
                    "INSERT INTO models (model_id, provider_id, provider_model_id, facts_json, enabled, availability, first_seen_at, last_seen_at, last_refresh_at)
                     VALUES (?1, ?2, ?3, ?4, 0, 'AVAILABLE', ?5, ?5, ?5)
                     ON CONFLICT (model_id) DO UPDATE SET facts_json = excluded.facts_json, availability = 'AVAILABLE',
                     last_seen_at = excluded.last_seen_at, last_refresh_at = excluded.last_refresh_at",
                    params![id, provider_id, model.provider_model_id, facts, now],
                )?;
            }
            tx.commit()?;
            Ok(())
        })?;
        Ok(())
    }

    /// يزيل نماذج مزوّد حُذف (المخصّص). يعيد عددها.
    pub fn remove_provider(&self, provider_id: &str) -> Result<usize, P02Error> {
        Ok(self.db.with(|conn| Ok(conn.execute("DELETE FROM models WHERE provider_id = ?1", [provider_id])?))?)
    }

    /// المزوّد لم يُجب: النماذج تبقى، وحالتها تقول ذلك.
    pub fn mark_unreachable(&self, provider_id: &str, now: &str) -> Result<(), P02Error> {
        self.db.with(|conn| {
            conn.execute(
                "UPDATE models SET availability = 'PROVIDER_UNREACHABLE', last_refresh_at = ?2 WHERE provider_id = ?1",
                params![provider_id, now],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    pub fn list(&self, provider_id: Option<&str>) -> Result<Vec<ModelRecord>, P02Error> {
        Ok(self.db.with(|conn| {
            let (sql, args): (String, Vec<String>) = match provider_id {
                Some(p) => (format!("{SELECT} WHERE provider_id = ?1 ORDER BY model_id"), vec![p.to_string()]),
                None => (format!("{SELECT} ORDER BY provider_id, model_id"), vec![]),
            };
            let mut statement = conn.prepare(&sql)?;
            let rows = statement.query_map(rusqlite::params_from_iter(args.iter()), row_to_record)?;
            let mut out = Vec::new();
            for row in rows {
                out.push(build(row?)?);
            }
            Ok(out)
        })?)
    }

    pub fn get(&self, id: &str) -> Result<Option<ModelRecord>, P02Error> {
        let row = self.db.with(|conn| Ok(conn.query_row(&format!("{SELECT} WHERE model_id = ?1"), [id], row_to_record).optional()?))?;
        match row {
            Some(row) => Ok(Some(build(row)?)),
            None => Ok(None),
        }
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<ModelRecord, P02Error> {
        let changed = self.db.with(|conn| Ok(conn.execute("UPDATE models SET enabled = ?2 WHERE model_id = ?1", params![id, enabled as i64])?))?;
        if changed == 0 {
            return Err(P02Error::invalid("/model_id", format!("unknown model {id}")));
        }
        self.get(id)?.ok_or_else(|| P02Error::invalid("/model_id", "model vanished"))
    }

    pub fn counts(&self, provider_id: &str) -> Result<(u64, u64, u64), P02Error> {
        Ok(self.db.with(|conn| {
            Ok(conn.query_row(
                "SELECT count(*), coalesce(sum(enabled), 0), coalesce(sum(availability = 'AVAILABLE'), 0) FROM models WHERE provider_id = ?1",
                [provider_id],
                |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64, r.get::<_, i64>(2)? as u64)),
            )?)
        })?)
    }

    /// عدد النماذج المفعّلة والمتاحة: ما يُعرض في الرئيسية.
    pub fn enabled_available_count(&self) -> Result<u64, P02Error> {
        Ok(self.db.with(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM models WHERE enabled = 1 AND availability = 'AVAILABLE'", [], |r| r.get::<_, i64>(0))? as u64)
        })?)
    }
}

pub fn availability_code(value: ModelAvailability) -> &'static str {
    value.code()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> ModelRegistry {
        ModelRegistry::new(Arc::new(Database::in_memory().unwrap()))
    }

    fn found(ids: &[&str]) -> Vec<DiscoveredModel> {
        ids.iter().map(|id| DiscoveredModel::bare(id.to_string())).collect()
    }

    #[test]
    fn discovery_adds_disabled_models_and_keeps_user_choice() {
        let r = registry();
        r.merge("lm-studio", &found(&["a", "b"]), "2026-09-17T00:00:00Z").unwrap();
        let list = r.list(None).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|m| !m.enabled), "a discovered model must not be enabled silently");
        r.set_enabled("lm-studio:a", true).unwrap();
        r.merge("lm-studio", &found(&["a", "b"]), "2026-09-17T00:01:00Z").unwrap();
        assert!(r.get("lm-studio:a").unwrap().unwrap().enabled, "a refresh reset the user's choice");
    }

    #[test]
    fn a_vanished_model_is_marked_missing_not_deleted() {
        let r = registry();
        r.merge("ollama", &found(&["a", "b"]), "t1").unwrap();
        r.set_enabled("ollama:b", true).unwrap();
        r.merge("ollama", &found(&["a"]), "t2").unwrap();
        let b = r.get("ollama:b").unwrap().unwrap();
        assert_eq!(b.availability, ModelAvailability::Missing);
        assert!(b.enabled, "configuration of a missing model was dropped");
        assert_eq!(r.enabled_available_count().unwrap(), 0);
        r.merge("ollama", &found(&["a", "b"]), "t3").unwrap();
        assert_eq!(r.enabled_available_count().unwrap(), 1);
    }

    #[test]
    fn an_unreachable_provider_keeps_its_models() {
        let r = registry();
        r.merge("ollama", &found(&["a"]), "t1").unwrap();
        r.mark_unreachable("ollama", "t2").unwrap();
        let a = r.get("ollama:a").unwrap().unwrap();
        assert_eq!(a.availability, ModelAvailability::ProviderUnreachable);
        assert_eq!(r.counts("ollama").unwrap(), (1, 0, 0));
    }

    #[test]
    fn providers_do_not_touch_each_other() {
        let r = registry();
        r.merge("ollama", &found(&["same"]), "t1").unwrap();
        r.merge("lm-studio", &found(&["same"]), "t1").unwrap();
        r.merge("ollama", &found(&[]), "t2").unwrap();
        assert_eq!(r.get("lm-studio:same").unwrap().unwrap().availability, ModelAvailability::Available);
        assert_eq!(r.get("ollama:same").unwrap().unwrap().availability, ModelAvailability::Missing);
    }

    #[test]
    fn enabling_an_unknown_model_is_an_error() {
        assert!(registry().set_enabled("lm-studio:none", true).is_err());
    }
}
