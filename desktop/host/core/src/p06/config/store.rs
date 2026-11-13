// مخزن طبقات الإعدادات في قاعدة المنتج الوحيدة.
//
// الصفّ طبقةٌ ونطاقٌ ومفتاحٌ وقيمة JSON بسيطة. لا كتلة إعدادات كاملة في عمود
// واحد: كتلة كهذه تُقرأ كلها أو تُرفض كلها، ولا يُعرف مصدر أيّ قيمة فيها.
//
// المخطط مُصدَّر (`config_schema_version`). إصدار أحدث من هذا البناء يعني إعدادًا
// لا يُفهم، فيُغلق المخزن: لا قراءة ولا كتابة، والقيم تُحلّ من الافتراضي والسقف وحدهما.

use std::sync::Arc;

use rusqlite::params;
use serde_json::Value;

use crate::storage::{Database, StorageError};

use super::model::Layer;

/// إصدار مخطط الإعدادات الذي يفهمه هذا البناء.
pub const CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct StoredValue {
    pub layer: Layer,
    /// فارغ للمستخدم والأمان، ومعرّف مشروع أو مهمّة للطبقتين المُنطَّقتين.
    pub scope_id: String,
    pub key: String,
    pub value: Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigStoreError {
    /// المخزن كُتب بإصدار أحدث. يُغلق ولا يُقرأ.
    UnsupportedVersion { found: u32, supported: u32 },
    Storage(String),
}

impl From<StorageError> for ConfigStoreError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error.to_string())
    }
}

pub struct ConfigStore {
    db: Arc<Database>,
}

impl ConfigStore {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// إصدار المخطط كما كُتب. غيابه عيب ترحيل يُعامل كإصدار غير مفهوم.
    pub fn schema_version(&self) -> Result<u32, ConfigStoreError> {
        let raw: Option<String> = self.db.with(|conn| {
            let mut statement = conn.prepare("SELECT meta_value FROM config_meta WHERE meta_key = 'config_schema_version'")?;
            let mut rows = statement.query([])?;
            Ok(match rows.next()? {
                Some(row) => Some(row.get(0)?),
                None => None,
            })
        })?;
        match raw.and_then(|v| v.parse::<u32>().ok()) {
            Some(v) => Ok(v),
            None => Err(ConfigStoreError::UnsupportedVersion { found: 0, supported: CONFIG_SCHEMA_VERSION }),
        }
    }

    fn guard(&self) -> Result<(), ConfigStoreError> {
        let found = self.schema_version()?;
        if found != CONFIG_SCHEMA_VERSION {
            return Err(ConfigStoreError::UnsupportedVersion { found, supported: CONFIG_SCHEMA_VERSION });
        }
        Ok(())
    }

    /// كل الصفوف المحفوظة. الصفّ الذي لا يُفهم (طبقة مجهولة أو JSON تالف) يُعدّ ولا يُحلّ.
    pub fn load(&self) -> Result<(Vec<StoredValue>, u32), ConfigStoreError> {
        self.guard()?;
        let rows: Vec<(String, String, String, String, String)> = self.db.with(|conn| {
            let mut statement =
                conn.prepare("SELECT layer, scope_id, setting_key, value_json, updated_at FROM config_values ORDER BY layer, scope_id, setting_key")?;
            let mapped = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
            let mut out = Vec::new();
            for row in mapped {
                out.push(row?);
            }
            Ok(out)
        })?;
        let mut values = Vec::with_capacity(rows.len());
        let mut unreadable = 0u32;
        for (layer, scope_id, key, json, updated_at) in rows {
            match (Layer::parse(&layer), serde_json::from_str::<Value>(&json)) {
                (Some(layer), Ok(value)) => values.push(StoredValue { layer, scope_id, key, value, updated_at }),
                _ => unreadable += 1,
            }
        }
        Ok((values, unreadable))
    }

    pub fn put(&self, value: &StoredValue) -> Result<(), ConfigStoreError> {
        self.guard()?;
        let json = value.value.to_string();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO config_values (layer, scope_id, setting_key, value_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (layer, scope_id, setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                params![value.layer.as_str(), value.scope_id, value.key, json, value.updated_at],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    pub fn remove(&self, layer: Layer, scope_id: &str, key: &str) -> Result<bool, ConfigStoreError> {
        self.guard()?;
        let changed = self.db.with(|conn| {
            Ok(conn.execute(
                "DELETE FROM config_values WHERE layer = ?1 AND scope_id = ?2 AND setting_key = ?3",
                params![layer.as_str(), scope_id, key],
            )?)
        })?;
        Ok(changed > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Arc<Database>, ConfigStore) {
        let db = Arc::new(Database::in_memory().unwrap());
        (db.clone(), ConfigStore::new(db))
    }

    #[test]
    fn a_value_round_trips_per_layer_and_scope() {
        let (_, store) = store();
        let v = StoredValue { layer: Layer::User, scope_id: String::new(), key: "privacy.persist_memory".into(), value: Value::Bool(true), updated_at: "t".into() };
        store.put(&v).unwrap();
        let p = StoredValue { layer: Layer::Project, scope_id: "11111111-1111-4111-8111-111111111111".into(), ..v.clone() };
        store.put(&p).unwrap();
        let (loaded, unreadable) = store.load().unwrap();
        assert_eq!(unreadable, 0);
        assert_eq!(loaded.len(), 2);
        assert!(store.remove(Layer::User, "", "privacy.persist_memory").unwrap());
        assert_eq!(store.load().unwrap().0.len(), 1);
    }

    #[test]
    fn a_newer_config_schema_closes_the_store_for_reads_and_writes() {
        let (db, store) = store();
        db.with(|c| {
            c.execute("UPDATE config_meta SET meta_value = '2' WHERE meta_key = 'config_schema_version'", [])?;
            Ok(())
        })
        .unwrap();
        assert_eq!(store.load().unwrap_err(), ConfigStoreError::UnsupportedVersion { found: 2, supported: 1 });
        let v = StoredValue { layer: Layer::User, scope_id: String::new(), key: "privacy.persist_memory".into(), value: Value::Bool(true), updated_at: "t".into() };
        assert!(store.put(&v).is_err(), "a newer schema accepted a write");
    }

    #[test]
    fn the_schema_refuses_a_scoped_layer_without_a_scope_and_an_unscoped_layer_with_one() {
        let (db, _) = store();
        let insert = |layer: &str, scope: &str| {
            db.with(|c| {
                c.execute(
                    "INSERT INTO config_values (layer, scope_id, setting_key, value_json, updated_at) VALUES (?1, ?2, 'abc.def', 'true', 't')",
                    params![layer, scope],
                )?;
                Ok(())
            })
        };
        assert!(insert("PROJECT", "").is_err());
        assert!(insert("USER", "11111111-1111-4111-8111-111111111111").is_err());
        assert!(insert("ANYTHING", "").is_err());
        assert!(insert("USER", "").is_ok());
    }
}
