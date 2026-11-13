// خدمة الإعدادات: الواصف، والقيم الفعلية بمصادرها، والكتابة المُتحقَّقة.
//
// العارض يعرض ويحرّر فقط (البند 34). التحقق والحلّ والقصّ والحفظ هنا. الكتابة
// تمرّ بترتيب ثابت: الإعداد معروف، والطبقة مأذونة له، والقيمة من نوعه وضمن حدوده،
// وطبقة الأمان لا تتجاوز سقف البناء، وطبقة المشروع أو المهمّة لا توسّع ما يحمل أمنًا
// عمّا فوقها. ما يُرفض يُرفض برمز مغلق، وما يُقبل يُحفظ ثم يُدقَّق.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use serde::Serialize;
use serde_json::Value;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

use super::model::{Layer, SettingState, SettingValue, ValueRefusal, ValueSource};
use super::registry::{catalogue, find};
use super::resolver::{parent_value, resolve, ConfigScope, ResolvedValue};
use super::store::{ConfigStore, ConfigStoreError, StoredValue, CONFIG_SCHEMA_VERSION};

/// حالة مخزن الإعدادات. غير `OK` يعني أن القيم تُحلّ من الافتراضي والسقف وحدهما.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigState {
    Ok,
    UnsupportedVersion,
    Unreadable,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigStatus {
    pub state: ConfigState,
    pub schema_version: u32,
    pub found_version: u32,
    pub unreadable_rows: u32,
    pub config_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigWriteError {
    Refused(ValueRefusal),
    /// المخزن مغلق (إصدار أحدث) أو تعذّرت الكتابة.
    Store(String),
    /// الطبقة المُنطَّقة بلا نطاق صالح، أو العكس.
    ScopeInvalid,
}

struct Cache {
    values: Vec<StoredValue>,
    state: ConfigState,
    found_version: u32,
    unreadable: u32,
}

pub struct ConfigService {
    store: ConfigStore,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    cache: RwLock<Cache>,
    version: AtomicU64,
    /// صفوف السياسة المُدارة (Phase-07): حدود أمان لا تُكتب في المخزن ولا تُحذف منه،
    /// وتنضمّ إلى الحلّ في كل حالة للمخزن، حتى المغلق منها.
    managed: RwLock<Vec<StoredValue>>,
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36 && value.chars().enumerate().all(|(i, c)| if matches!(i, 8 | 13 | 18 | 23) { c == '-' } else { c.is_ascii_hexdigit() && !c.is_ascii_uppercase() })
}

impl ConfigService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        let service = Self {
            store: ConfigStore::new(db),
            audit,
            clock,
            cache: RwLock::new(Cache { values: Vec::new(), state: ConfigState::Ok, found_version: CONFIG_SCHEMA_VERSION, unreadable: 0 }),
            version: AtomicU64::new(1),
            managed: RwLock::new(Vec::new()),
        };
        service.reload();
        service
    }

    /// يعيد قراءة المخزن. إصدار أحدث يغلق الطبقات كلها ولا يفسّر منها شيئًا.
    pub fn reload(&self) {
        let loaded = self.store.load();
        let Ok(mut cache) = self.cache.write() else { return };
        match loaded {
            Ok((values, unreadable)) => {
                cache.values = values;
                cache.state = ConfigState::Ok;
                cache.found_version = CONFIG_SCHEMA_VERSION;
                cache.unreadable = unreadable;
            }
            Err(ConfigStoreError::UnsupportedVersion { found, .. }) => {
                cache.values = Vec::new();
                cache.state = ConfigState::UnsupportedVersion;
                cache.found_version = found;
                cache.unreadable = 0;
            }
            Err(ConfigStoreError::Storage(_)) => {
                cache.values = Vec::new();
                cache.state = ConfigState::Unreadable;
            }
        }
        if let Ok(managed) = self.managed.read() {
            cache.values.extend(managed.iter().cloned());
        }
        self.version.fetch_add(1, Ordering::SeqCst);
    }

    /// يثبّت صفوف السياسة المُدارة. تُقبل صفوف طبقة الأمان العامة وحدها، وما عداها يُسقط.
    pub fn set_managed(&self, rows: Vec<StoredValue>) -> usize {
        let accepted: Vec<StoredValue> = rows.into_iter().filter(|r| r.layer == Layer::Security && r.scope_id.is_empty()).collect();
        let count = accepted.len();
        if let Ok(mut managed) = self.managed.write() {
            *managed = accepted;
        }
        self.reload();
        count
    }

    /// مفاتيح الإعدادات التي تديرها السياسة الآن.
    pub fn managed_keys(&self) -> Vec<String> {
        self.managed.read().map(|m| m.iter().map(|r| r.key.clone()).collect()).unwrap_or_default()
    }

    pub fn status(&self) -> ConfigStatus {
        let (state, found_version, unreadable_rows) = self
            .cache
            .read()
            .map(|c| (c.state, c.found_version, c.unreadable))
            .unwrap_or((ConfigState::Unreadable, 0, 0));
        ConfigStatus { state, schema_version: CONFIG_SCHEMA_VERSION, found_version, unreadable_rows, config_version: self.version.load(Ordering::SeqCst) }
    }

    fn snapshot(&self) -> Vec<StoredValue> {
        self.cache.read().map(|c| c.values.clone()).unwrap_or_default()
    }

    /// يحلّ إعدادًا واحدًا. مفتاح مجهول عيب برمجي في المستهلك، فيُعاد الافتراضي الأضيق: لا شيء.
    pub fn resolve(&self, key: &str, scope: &ConfigScope) -> Option<ResolvedValue> {
        let def = find(key)?;
        let cache = self.cache.read().ok()?;
        Some(resolve(def, &cache.values, scope))
    }

    pub fn effective(&self, scope: &ConfigScope) -> Vec<ResolvedValue> {
        let values = self.snapshot();
        catalogue().iter().map(|def| resolve(def, &values, scope)).collect()
    }

    // ——— قراءات مُصنَّفة للمستهلكين. كل واحدة تفشل إلى الافتراضي المُعلن، لا إلى «مسموح».

    pub fn bool(&self, key: &str, scope: &ConfigScope) -> bool {
        self.resolve(key, scope).and_then(|r| r.value.as_bool()).unwrap_or_else(|| find(key).and_then(|d| d.default_value().as_bool()).unwrap_or(false))
    }

    pub fn int(&self, key: &str, scope: &ConfigScope) -> i64 {
        self.resolve(key, scope).and_then(|r| r.value.as_i64()).unwrap_or_else(|| find(key).and_then(|d| d.default_value().as_i64()).unwrap_or(0))
    }

    pub fn uint(&self, key: &str, scope: &ConfigScope) -> u64 {
        self.resolve(key, scope).and_then(|r| r.value.as_u64()).unwrap_or_else(|| find(key).and_then(|d| d.default_value().as_u64()).unwrap_or(0))
    }

    pub fn code(&self, key: &str, scope: &ConfigScope) -> String {
        self.resolve(key, scope)
            .and_then(|r| r.value.as_code().map(str::to_string))
            .unwrap_or_else(|| find(key).and_then(|d| d.default_value().as_code().map(str::to_string)).unwrap_or_default())
    }

    fn check_scope(layer: Layer, scope_id: Option<&str>) -> Result<String, ConfigWriteError> {
        match (layer.scoped(), scope_id) {
            (true, Some(id)) if is_uuid(id) => Ok(id.to_string()),
            (false, None) => Ok(String::new()),
            (false, Some("")) => Ok(String::new()),
            _ => Err(ConfigWriteError::ScopeInvalid),
        }
    }

    /// يتحقق من قيمة لطبقة دون أن يكتبها. `context` نطاق الطبقة الأمّ (مشروع المهمّة).
    pub fn validate(&self, layer: Layer, key: &str, raw: &Value, context: &ConfigScope) -> Result<SettingValue, ValueRefusal> {
        let def = find(key).ok_or(ValueRefusal::UnknownSetting)?;
        match def.state {
            SettingState::UnavailableThisPhase => return Err(ValueRefusal::Unavailable),
            SettingState::Locked => return Err(ValueRefusal::LayerNotPermitted),
            SettingState::Editable => {}
        }
        if !def.layers.contains(&layer) {
            return Err(ValueRefusal::LayerNotPermitted);
        }
        let value = def.parse(raw)?;
        if let (Some(widening), Some(ceiling)) = (def.widening, def.ceiling_value()) {
            if widening.is_wider(&value, &ceiling) {
                return Err(ValueRefusal::AboveCeiling);
            }
        }
        if layer.scoped() {
            if let Some(widening) = def.widening {
                let values = self.snapshot();
                let parent = parent_value(def, &values, layer, context);
                if widening.is_wider(&value, &parent) {
                    return Err(ValueRefusal::WidensSecurity);
                }
                // والحدّ كذلك: تجاوز لا يُقبل وهو أوسع من حدّ الأمان.
                if let Some(limit) = super::resolver::clamp_of(def, &values) {
                    if widening.is_wider(&value, &limit) {
                        return Err(ValueRefusal::WidensSecurity);
                    }
                }
            }
        }
        Ok(value)
    }

    /// يكتب قيمة في طبقة. `context` يحمل مشروع المهمّة حين تكون الطبقة مهمّة.
    pub fn set(&self, layer: Layer, scope_id: Option<&str>, key: &str, raw: &Value, context: &ConfigScope) -> Result<ResolvedValue, ConfigWriteError> {
        let scope_id = Self::check_scope(layer, scope_id)?;
        if self.status().state != ConfigState::Ok {
            return Err(ConfigWriteError::Store("the configuration store is closed".into()));
        }
        let value = match self.validate(layer, key, raw, context) {
            Ok(value) => value,
            Err(refusal) => {
                let _ = self.audit.append(&AuditRecord::new(
                    AuditEventType::ConfigChanged,
                    "setting",
                    key.chars().take(120).collect::<String>(),
                    AuditOutcome::Denied,
                    serde_json::json!({ "layer": layer.as_str(), "reason": refusal.as_str() }),
                ));
                return Err(ConfigWriteError::Refused(refusal));
            }
        };
        let row = StoredValue { layer, scope_id: scope_id.clone(), key: key.to_string(), value: value.to_json(), updated_at: self.clock.now() };
        self.store.put(&row).map_err(|e| ConfigWriteError::Store(format!("{e:?}")))?;
        self.reload();
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ConfigChanged,
            "setting",
            key,
            AuditOutcome::Success,
            serde_json::json!({ "layer": layer.as_str(), "scoped": !scope_id.is_empty() }),
        ));
        let resolved_scope = match layer {
            Layer::Project => ConfigScope::project(scope_id),
            Layer::Mission => ConfigScope::mission(scope_id, context.project_id.clone()),
            Layer::User | Layer::Security => ConfigScope::global(),
        };
        self.resolve(key, &resolved_scope).ok_or(ConfigWriteError::Refused(ValueRefusal::UnknownSetting))
    }

    /// يحذف قيمة طبقة، فتعود القيمة الفعلية إلى ما فوقها.
    pub fn reset(&self, layer: Layer, scope_id: Option<&str>, key: &str) -> Result<bool, ConfigWriteError> {
        let scope_id = Self::check_scope(layer, scope_id)?;
        if find(key).is_none() {
            return Err(ConfigWriteError::Refused(ValueRefusal::UnknownSetting));
        }
        let removed = self.store.remove(layer, &scope_id, key).map_err(|e| ConfigWriteError::Store(format!("{e:?}")))?;
        self.reload();
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ConfigReset,
            "setting",
            key,
            if removed { AuditOutcome::Success } else { AuditOutcome::Denied },
            serde_json::json!({ "layer": layer.as_str(), "scoped": !scope_id.is_empty() }),
        ));
        Ok(removed)
    }

    /// عدد الإعدادات التي مصدرها الفعلي حدّ الأمان في نطاق. يُعرض في الملخّص التشخيصي.
    pub fn clamped_count(&self, scope: &ConfigScope) -> usize {
        self.effective(scope).iter().filter(|r| r.source == ValueSource::SecurityClamp).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: &str = "11111111-1111-4111-8111-111111111111";
    const MISSION: &str = "22222222-2222-4222-8222-222222222222";

    fn service() -> (Arc<Database>, ConfigService) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        (db.clone(), ConfigService::new(db, audit, RuntimeClock::deterministic()))
    }

    #[test]
    fn a_setting_change_takes_effect_on_the_next_read_and_survives_a_reload() {
        let (_, config) = service();
        assert!(config.bool("privacy.allow_browser_internet", &ConfigScope::global()));
        config.set(Layer::User, None, "privacy.allow_browser_internet", &Value::Bool(false), &ConfigScope::global()).unwrap();
        assert!(!config.bool("privacy.allow_browser_internet", &ConfigScope::global()));
        config.reload();
        assert!(!config.bool("privacy.allow_browser_internet", &ConfigScope::global()), "the value did not survive a reload from the store");
        assert!(config.reset(Layer::User, None, "privacy.allow_browser_internet").unwrap());
        assert!(config.bool("privacy.allow_browser_internet", &ConfigScope::global()));
    }

    #[test]
    fn a_project_or_mission_override_cannot_widen_a_security_setting() {
        let (_, config) = service();
        let global = ConfigScope::global();
        config.set(Layer::User, None, "connectors.max_external_calls_per_mission", &Value::from(5), &global).unwrap();
        let widened = config.set(Layer::Project, Some(PROJECT), "connectors.max_external_calls_per_mission", &Value::from(50), &global);
        assert_eq!(widened, Err(ConfigWriteError::Refused(ValueRefusal::WidensSecurity)));
        let narrowed = config.set(Layer::Project, Some(PROJECT), "connectors.max_external_calls_per_mission", &Value::from(3), &global).unwrap();
        assert_eq!((narrowed.value.as_i64(), narrowed.source), (Some(3), ValueSource::Project));
        // المهمّة تُقاس على مشروعها: 3، لا 5.
        let context = ConfigScope::project(PROJECT);
        let mission = config.set(Layer::Mission, Some(MISSION), "connectors.max_external_calls_per_mission", &Value::from(4), &context);
        assert_eq!(mission, Err(ConfigWriteError::Refused(ValueRefusal::WidensSecurity)));
        assert!(config.set(Layer::Mission, Some(MISSION), "connectors.max_external_calls_per_mission", &Value::from(1), &context).is_ok());
    }

    #[test]
    fn a_security_clamp_bounds_the_user_and_a_security_value_cannot_exceed_the_build_ceiling() {
        let (_, config) = service();
        let global = ConfigScope::global();
        config.set(Layer::Security, None, "agents.max_concurrent_missions", &Value::from(1), &global).unwrap();
        config.set(Layer::User, None, "agents.max_concurrent_missions", &Value::from(6), &global).unwrap();
        let resolved = config.resolve("agents.max_concurrent_missions", &global).unwrap();
        assert_eq!((resolved.value.as_i64(), resolved.source), (Some(1), ValueSource::SecurityClamp));
        assert_eq!(
            config.set(Layer::Security, None, "agents.max_concurrent_missions", &Value::from(9), &global),
            Err(ConfigWriteError::Refused(ValueRefusal::OutOfBounds))
        );
    }

    #[test]
    fn a_value_of_the_wrong_kind_an_unknown_key_or_a_forbidden_layer_is_refused() {
        let (_, config) = service();
        let global = ConfigScope::global();
        assert_eq!(config.set(Layer::User, None, "privacy.persist_memory", &Value::from(1), &global), Err(ConfigWriteError::Refused(ValueRefusal::WrongKind)));
        assert_eq!(config.set(Layer::User, None, "privacy.anything", &Value::Bool(true), &global), Err(ConfigWriteError::Refused(ValueRefusal::UnknownSetting)));
        assert_eq!(
            config.set(Layer::Project, Some(PROJECT), "appearance.theme", &Value::String("DARK".into()), &global),
            Err(ConfigWriteError::Refused(ValueRefusal::LayerNotPermitted))
        );
        assert_eq!(config.set(Layer::User, None, "appearance.theme", &Value::String("NEON".into()), &global), Err(ConfigWriteError::Refused(ValueRefusal::NotAllowedValue)));
        assert_eq!(config.set(Layer::User, None, "advanced.auto_update", &Value::Bool(true), &global), Err(ConfigWriteError::Refused(ValueRefusal::Unavailable)));
        assert_eq!(config.set(Layer::User, None, "browser.private_network_allowed", &Value::Bool(true), &global), Err(ConfigWriteError::Refused(ValueRefusal::LayerNotPermitted)));
        assert_eq!(config.set(Layer::Project, None, "privacy.persist_memory", &Value::Bool(true), &global), Err(ConfigWriteError::ScopeInvalid));
    }

    #[test]
    fn a_newer_config_schema_fails_closed_to_defaults_and_refuses_writes() {
        let (db, config) = service();
        config.set(Layer::User, None, "privacy.allow_connector_egress", &Value::Bool(false), &ConfigScope::global()).unwrap();
        db.with(|c| {
            c.execute("UPDATE config_meta SET meta_value = '7' WHERE meta_key = 'config_schema_version'", [])?;
            Ok(())
        })
        .unwrap();
        config.reload();
        let status = config.status();
        assert_eq!(status.state, ConfigState::UnsupportedVersion);
        assert_eq!(status.found_version, 7);
        // لا يُفسَّر شيء من المخزن الأحدث: القيمة تعود إلى الافتراضي المعلن.
        assert_eq!(config.resolve("privacy.allow_connector_egress", &ConfigScope::global()).unwrap().source, ValueSource::Default);
        assert!(matches!(config.set(Layer::User, None, "privacy.persist_memory", &Value::Bool(true), &ConfigScope::global()), Err(ConfigWriteError::Store(_))));
    }
}
