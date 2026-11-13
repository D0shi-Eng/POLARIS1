// تفضيلات الاختيار: النموذج الافتراضي للمستخدم، ونموذج المراجعة إن اختاره.
//
// لا تفضيل «محلي/بعيد» (قرار المالك 2026-10-07، ADR-040): المستخدم يختار أيّ نموذج مفعَّل، محليًّا كان أو عبر API،
// وما يختاره هو ما يُستعمل. موقع المزوّد صفة وصفية لا تحجب شيئًا.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::p02::errors::P02Error;
use crate::storage::Database;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PreferencesView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    /// نموذج المراجِع الذي اختاره المستخدم صراحةً، من أيّ صنف. غيابه = لا مراجعة مستقلّة، ولا نداء لمراجِع لم يُختَر.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_model_id: Option<String>,
    /// نموذج المراقب الأعمى (خطة 2026-10-07، ADR-041 §3.2). الافتراض: لا مراقب، والموافقة البشرية للطبقة 3 كما هي.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_model_id: Option<String>,
    /// جهد الاستدلال الذي اختاره المستخدم لكل المزوّدين والنماذج (LOW|MEDIUM|HIGH|MAX). غيابه = افتراضي كل مزوّد.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
}

pub struct Preferences {
    db: Arc<Database>,
}

const DEFAULT_MODEL: &str = "default_model_id";
const REVIEW_MODEL: &str = "review_model_id";
const MONITOR_MODEL: &str = "monitor_model_id";
const REASONING_EFFORT: &str = "reasoning_effort";

impl Preferences {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    fn read(&self, key: &str) -> Result<Option<String>, P02Error> {
        Ok(self.db.with(|conn| Ok(conn.query_row("SELECT value FROM preferences WHERE key = ?1", [key], |r| r.get(0)).optional()?))?)
    }

    fn write(&self, key: &str, value: Option<&str>) -> Result<(), P02Error> {
        self.db.with(|conn| {
            match value {
                Some(v) => conn.execute(
                    "INSERT INTO preferences (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    params![key, v],
                )?,
                None => conn.execute("DELETE FROM preferences WHERE key = ?1", [key])?,
            };
            Ok(())
        })?;
        Ok(())
    }

    pub fn default_model(&self) -> Result<Option<String>, P02Error> {
        self.read(DEFAULT_MODEL)
    }

    pub fn review_model(&self) -> Result<Option<String>, P02Error> {
        self.read(REVIEW_MODEL)
    }

    pub fn set_review_model(&self, model_id: Option<&str>) -> Result<(), P02Error> {
        self.write(REVIEW_MODEL, model_id)
    }

    pub fn monitor_model(&self) -> Result<Option<String>, P02Error> {
        self.read(MONITOR_MODEL)
    }

    pub fn set_monitor_model(&self, model_id: Option<&str>) -> Result<(), P02Error> {
        self.write(MONITOR_MODEL, model_id)
    }

    pub fn set_default_model(&self, model_id: Option<&str>) -> Result<(), P02Error> {
        self.write(DEFAULT_MODEL, model_id)
    }

    /// الجهد المختار، مقروءًا كقيمة صالحة فقط: قيمة غريبة في المخزن تُعامل «افتراضيًّا» ولا تصل مزوّدًا.
    pub fn reasoning_effort(&self) -> Result<Option<polaris_host_providers::domain::messages::ReasoningEffort>, P02Error> {
        Ok(self.read(REASONING_EFFORT)?.as_deref().and_then(polaris_host_providers::domain::messages::ReasoningEffort::from_preference))
    }

    /// يحفظ الجهد؛ القيمة يتحقق منها المستدعي (`set_preferences`).
    pub fn set_reasoning_effort(&self, level: Option<&str>) -> Result<(), P02Error> {
        self.write(REASONING_EFFORT, level)
    }

    pub fn view(&self) -> Result<PreferencesView, P02Error> {
        Ok(PreferencesView { default_model_id: self.default_model()?, review_model_id: self.review_model()?, monitor_model_id: self.monitor_model()?, reasoning_effort: self.read(REASONING_EFFORT)? })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_no_model_and_no_reviewer() {
        let p = Preferences::new(Arc::new(Database::in_memory().unwrap()));
        assert_eq!(p.view().unwrap(), PreferencesView { default_model_id: None, review_model_id: None, monitor_model_id: None, reasoning_effort: None });
        assert_eq!(p.reasoning_effort().unwrap(), None);
        p.set_reasoning_effort(Some("HIGH")).unwrap();
        assert_eq!(p.reasoning_effort().unwrap(), Some(polaris_host_providers::domain::messages::ReasoningEffort::High));
        p.set_reasoning_effort(Some("BOGUS")).unwrap();
        assert_eq!(p.reasoning_effort().unwrap(), None, "an unknown stored value must not reach a provider");
        p.set_reasoning_effort(None).unwrap();
        p.set_default_model(Some("ollama:a")).unwrap();
        assert_eq!(p.default_model().unwrap().as_deref(), Some("ollama:a"));
        p.set_default_model(None).unwrap();
        assert_eq!(p.default_model().unwrap(), None);
    }
}
