// سجل المزوّدات: الواصفات الثابتة، وإعداد المستخدم، وآخر صحة مقيسة.
//
// نقطة النهاية تُحلّ هنا وحدها: المحلي إلى الحلقة المحلية، والبعيد إلى مضيفه الثابت.
// لا طريق آخر لبناء وجهة شبكية في المضيف، فلا يستطيع العارض ولا محتوى السياق
// اختيار وجهة.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};

use polaris_host_providers::catalog::{builtin_descriptors, custom_descriptor, descriptor, CustomRefusal, ProviderDescriptor};
use serde::{Deserialize, Serialize};
use polaris_host_providers::domain::{HealthReason, HealthState, InstallationState, Locality};
use polaris_host_providers::installation;
use polaris_host_providers::net::endpoint::{self, ResolvedEndpoint};

use super::health::{code_of, parse_installation, parse_reason, parse_runtime, parse_state, HealthView, MeasuredMs};
use crate::p02::errors::P02Error;
use crate::p02::ports::Environment;
use crate::storage::Database;
use crate::time::now_rfc3339_utc;

/// إعداد مزوّد كما يراه المضيف الآن.
#[derive(Debug, Clone)]
pub struct ProviderState {
    pub descriptor: Arc<ProviderDescriptor>,
    pub enabled: bool,
    /// نقطة نهاية مضبوطة من المستخدم للمحلي. للبعيد لا توجد أبدًا.
    pub endpoint_override: Option<String>,
}

impl ProviderState {
    pub fn endpoint(&self) -> Option<String> {
        self.endpoint_override.clone().or_else(|| self.descriptor.default_endpoint.clone())
    }
}

/// نموذج أعلنه المستخدم لمزوّده المخصّص (ADR-037). يُعرض حتى لو لم يُجب الخادم عن `/models`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeclaredModel {
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub display_name: Option<String>,
}

/// حدّ النماذج المعلَنة لمزوّد مخصّص واحد.
pub const MAX_DECLARED_MODELS: usize = 64;

pub struct ProviderRegistry {
    db: Arc<Database>,
    environment: Arc<dyn Environment>,
    is_windows: bool,
    remote_fixture: Option<String>,
}

impl ProviderRegistry {
    pub fn new(db: Arc<Database>, environment: Arc<dyn Environment>, is_windows: bool, remote_fixture: Option<String>) -> Self {
        Self { db, environment, is_windows, remote_fixture }
    }

    /// المدمجة والمستضافة بترتيب الفهرس، ثم المخصّصة بترتيب إنشائها.
    pub fn descriptors(&self) -> Result<Vec<Arc<ProviderDescriptor>>, P02Error> {
        let mut all: Vec<Arc<ProviderDescriptor>> = builtin_descriptors().to_vec();
        for id in self.custom_ids()? {
            if let Some(d) = self.custom(&id)? {
                all.push(d);
            }
        }
        Ok(all)
    }

    pub fn descriptor(&self, provider_id: &str) -> Result<Arc<ProviderDescriptor>, P02Error> {
        if let Some(d) = descriptor(provider_id) {
            return Ok(d);
        }
        self.custom(provider_id)?.ok_or_else(|| P02Error::invalid("/provider_id", format!("unknown provider {provider_id}")))
    }

    /// ما يهمّ الآن (ADR-037): المدمجة، وكل مزوّد له إعداد مخزّن (فُعّل أو عُطّل مرة)، والمخصّصة. الفهرس المستضاف
    /// كاملًا (نحو مئتي مزوّد) لا يُمرّ عليه في كل قراءة: ما لم يلمسه المستخدم لا حالة له تُقرأ ولا مفتاح يُسأل عنه.
    pub fn relevant(&self) -> Result<Vec<Arc<ProviderDescriptor>>, P02Error> {
        let configured: std::collections::BTreeSet<String> = self.db.with(|conn| {
            let mut stmt = conn.prepare("SELECT provider_id FROM provider_config")?;
            let ids = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<_, _>>()?;
            Ok(ids)
        })?;
        Ok(self
            .descriptors()?
            .into_iter()
            .filter(|d| d.kind != polaris_host_providers::domain::ProviderKind::OpenaiCompatibleApi || configured.contains(&d.id))
            .collect())
    }

    fn custom_ids(&self) -> Result<Vec<String>, P02Error> {
        Ok(self.db.with(|conn| {
            let mut stmt = conn.prepare("SELECT provider_id FROM provider_custom ORDER BY created_at, provider_id")?;
            let ids = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(ids)
        })?)
    }

    /// واصف مزوّد مخصّص مخزّن. سجلّ لم يعد يجتاز البناء (عنوان صار مرفوضًا) لا يُعاد ولا يُتّصل به.
    fn custom(&self, provider_id: &str) -> Result<Option<Arc<ProviderDescriptor>>, P02Error> {
        let row = self.db.with(|conn| {
            Ok(conn
                .query_row("SELECT display_name, base_url FROM provider_custom WHERE provider_id = ?1", [provider_id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .optional()?)
        })?;
        Ok(row.and_then(|(name, base)| custom_descriptor(provider_id, &name, &base).ok()).map(Arc::new))
    }

    pub fn is_custom(&self, provider_id: &str) -> Result<bool, P02Error> {
        Ok(self.db.with(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM provider_custom WHERE provider_id = ?1", [provider_id], |r| r.get::<_, i64>(0))? > 0)
        })?)
    }

    /// النماذج التي أعلنها المستخدم لمزوّده المخصّص، أو قائمة فارغة.
    pub fn declared_models(&self, provider_id: &str) -> Result<Vec<DeclaredModel>, P02Error> {
        let raw = self.db.with(|conn| {
            Ok(conn.query_row("SELECT models_json FROM provider_custom WHERE provider_id = ?1", [provider_id], |r| r.get::<_, String>(0)).optional()?)
        })?;
        Ok(raw.and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default())
    }

    /// ينشئ مزوّدًا مخصّصًا أو يعدّله. المعرّف لا يأخذ معرّف مدمج ولا مستضاف، والعنوان https عامّ أو الحلقة المحلية.
    /// تغيير العنوان يُبطل آخر قياس. يعيد الحالة، وهل كان جديدًا.
    pub fn save_custom(&self, provider_id: &str, display_name: &str, base_url: &str, models: &[DeclaredModel]) -> Result<(ProviderState, bool), P02Error> {
        let built = custom_descriptor(provider_id, display_name, base_url).map_err(|refusal| match refusal {
            CustomRefusal::IdTaken => P02Error::denied("/provider_id", "this id belongs to a built-in or catalogued provider"),
            CustomRefusal::IdInvalid => P02Error::invalid("/provider_id", "lowercase letters, digits and dashes, starting with a letter"),
            CustomRefusal::NameInvalid => P02Error::invalid("/display_name", "a display name of 1 to 64 characters"),
            CustomRefusal::BaseUrlInvalid => P02Error::denied("/base_url", "a public https address, or http on this computer only"),
        })?;
        if models.len() > MAX_DECLARED_MODELS {
            return Err(P02Error::invalid("/models", format!("at most {MAX_DECLARED_MODELS} models")));
        }
        let mut seen = std::collections::BTreeSet::new();
        for (index, model) in models.iter().enumerate() {
            // قاعدة العقد لا قاعدة أوسع: معرّف بمحرف خارجها («—» مثلًا) كان يُحفظ ثم يُسقط
            // `model.list` كلّها عند المالك بـ INTERNAL_ERROR (2026-10-06).
            let id_ok = polaris_host_providers::adapters::common::is_clean_model_id(&model.model_id);
            let name_ok = model.display_name.as_deref().is_none_or(|n| !n.trim().is_empty() && n.chars().count() <= 120 && !n.chars().any(char::is_control));
            if !id_ok || !name_ok || !seen.insert(model.model_id.clone()) {
                return Err(P02Error::invalid("/models", format!("model {index}: a unique model id of visible ASCII characters without quotes, angle brackets, backslash or backtick, and an optional name")));
            }
        }
        let previous = self.db.with(|conn| {
            Ok(conn.query_row("SELECT base_url FROM provider_custom WHERE provider_id = ?1", [provider_id], |r| r.get::<_, String>(0)).optional()?)
        })?;
        let base = built.default_endpoint.clone().unwrap_or_default();
        let models_json = serde_json::to_string(models).map_err(|e| P02Error::invalid("/models", e.to_string()))?;
        let now = now_rfc3339_utc();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO provider_custom (provider_id, display_name, base_url, models_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT (provider_id) DO UPDATE SET display_name = excluded.display_name, base_url = excluded.base_url,
                 models_json = excluded.models_json, updated_at = excluded.updated_at",
                params![provider_id, built.display_name, base, models_json, now],
            )?;
            if previous.as_deref().is_some_and(|p| p != base) {
                conn.execute("DELETE FROM provider_health WHERE provider_id = ?1", [provider_id])?;
            }
            Ok(())
        })?;
        Ok((self.state(provider_id)?, previous.is_none()))
    }

    /// يحذف مزوّدًا مخصّصًا وإعداده وقياسه. النماذج تُزال في سجلّها، والمفتاح في مخزنه، بيد المتّصل.
    pub fn delete_custom(&self, provider_id: &str) -> Result<bool, P02Error> {
        Ok(self.db.with(|conn| {
            let removed = conn.execute("DELETE FROM provider_custom WHERE provider_id = ?1", [provider_id])?;
            conn.execute("DELETE FROM provider_config WHERE provider_id = ?1", [provider_id])?;
            conn.execute("DELETE FROM provider_health WHERE provider_id = ?1", [provider_id])?;
            Ok(removed > 0)
        })?)
    }

    pub fn state(&self, provider_id: &str) -> Result<ProviderState, P02Error> {
        let descriptor = self.descriptor(provider_id)?;
        let row = self.db.with(|conn| {
            Ok(conn
                .query_row("SELECT enabled, endpoint FROM provider_config WHERE provider_id = ?1", [provider_id], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?))
                })
                .optional()?)
        })?;
        let (enabled, endpoint_override) = match row {
            Some((enabled, endpoint)) => (enabled == 1, endpoint),
            None => (descriptor.enabled_by_default, None),
        };
        // سجل قديم يحمل نقطة نهاية لمزوّد بعيد لا يُحترم: البعيد ثابت.
        let endpoint_override = if descriptor.endpoint_configurable { endpoint_override } else { None };
        Ok(ProviderState { descriptor, enabled, endpoint_override })
    }

    /// يغيّر التفعيل أو نقطة النهاية. نقطة النهاية للمحلي فقط، وعلى الحلقة المحلية فقط.
    pub fn configure(&self, provider_id: &str, enabled: Option<bool>, endpoint_value: Option<&str>) -> Result<ProviderState, P02Error> {
        let current = self.state(provider_id)?;
        if let Some(raw) = endpoint_value {
            if !current.descriptor.endpoint_configurable || current.descriptor.locality != Locality::Local {
                return Err(P02Error::denied("/endpoint", "this provider's endpoint is fixed"));
            }
            endpoint::loopback(raw).map_err(|e| P02Error::denied("/endpoint", format!("endpoint rejected: {e:?}")))?;
        }
        let enabled = enabled.unwrap_or(current.enabled);
        let endpoint_override = endpoint_value.map(|v| v.trim_end_matches('/').to_string()).or(current.endpoint_override.clone());
        let now = now_rfc3339_utc();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO provider_config (provider_id, enabled, endpoint, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT (provider_id) DO UPDATE SET enabled = excluded.enabled, endpoint = excluded.endpoint, updated_at = excluded.updated_at",
                params![provider_id, enabled as i64, endpoint_override, now],
            )?;
            Ok(())
        })?;
        // نقطة نهاية جديدة تُبطل آخر قياس: صحة خادم آخر ليست صحة هذا.
        if endpoint_value.is_some() {
            self.db.with(|conn| {
                conn.execute("DELETE FROM provider_health WHERE provider_id = ?1", [provider_id])?;
                Ok(())
            })?;
        }
        self.state(provider_id)
    }

    /// يحلّ نقطة النهاية إلى وجهة مُتحقَّق منها، أو سببًا صحيًا يمنع الفحص.
    pub fn resolve_endpoint(&self, state: &ProviderState) -> Result<ResolvedEndpoint, HealthReason> {
        let raw = state.endpoint().ok_or(HealthReason::EndpointNotConfigured)?;
        match state.descriptor.locality {
            Locality::Local => endpoint::loopback(&raw).map_err(|_| HealthReason::EndpointRejected),
            Locality::Remote => {
                if let Some(fixture) = &self.remote_fixture {
                    return endpoint::remote_fixture(fixture).map_err(|_| HealthReason::EndpointRejected);
                }
                let host = state.descriptor.remote_host.as_deref().ok_or(HealthReason::EndpointRejected)?;
                endpoint::remote(&raw, host).map_err(|_| HealthReason::EndpointRejected)
            }
        }
    }

    pub fn installation(&self, state: &ProviderState) -> InstallationState {
        let env = |name: &str| self.environment.var(name);
        installation::probe(state.descriptor.kind, &env, self.is_windows)
    }

    pub fn save_health(&self, provider_id: &str, view: &HealthView) -> Result<(), P02Error> {
        let Some(checked_at) = &view.checked_at else { return Ok(()) };
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO provider_health (provider_id, state, reason_code, checked_at, latency_ms, installation, runtime) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (provider_id) DO UPDATE SET state = excluded.state, reason_code = excluded.reason_code, checked_at = excluded.checked_at,
                 latency_ms = excluded.latency_ms, installation = excluded.installation, runtime = excluded.runtime",
                params![
                    provider_id,
                    code_of(view.state),
                    code_of(view.reason_code),
                    checked_at,
                    view.latency.as_ref().map(|l| l.value as i64),
                    code_of(view.installation),
                    code_of(view.runtime)
                ],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    /// صحّة قاسها نداء حقيقي (E-4، تدقيق 2026-10-19). كانت الصحّة المحفوظة لا تُكتب إلا عند «تحديث» يدوي، فبقيت HEALTHY من
    /// 2026-09-30 والنداءات نفسها ترفع PROVIDER_UNREACHABLE. الآن آخر قياس يغلب أيًّا كان مصدره: الفحص أو النداء. حالتا التثبيت
    /// والتشغيل تبقيان كما قاسهما آخر فحص، فالنداء لا يقيسهما.
    pub fn record_call_health(&self, provider_id: &str, state: HealthState, reason: HealthReason, latency_ms: u64) -> Result<(), P02Error> {
        if provider_id.is_empty() {
            return Ok(());
        }
        let now = now_rfc3339_utc();
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO provider_health (provider_id, state, reason_code, checked_at, latency_ms, installation, runtime) VALUES (?1, ?2, ?3, ?4, ?5, 'UNKNOWN', 'UNKNOWN')
                 ON CONFLICT (provider_id) DO UPDATE SET state = excluded.state, reason_code = excluded.reason_code, checked_at = excluded.checked_at,
                 latency_ms = excluded.latency_ms",
                params![provider_id, code_of(state), code_of(reason), now, latency_ms as i64],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    /// هل آخر قياس محفوظ لصحّة المزوّد أقدم من عدد الثواني المعطى؟ مزوّد لم يُقس قطّ يُعدّ قديمًا.
    pub fn health_checked_before(&self, provider_id: &str, seconds: i64) -> bool {
        let threshold = crate::time::rfc3339_utc_seconds_ago(seconds);
        match self.stored_health(provider_id) {
            Ok(Some(view)) => view.checked_at.is_none_or(|at| at < threshold),
            Ok(None) => true,
            Err(_) => false,
        }
    }

    fn stored_health(&self, provider_id: &str) -> Result<Option<HealthView>, P02Error> {
        Ok(self.db.with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT state, reason_code, checked_at, latency_ms, installation, runtime FROM provider_health WHERE provider_id = ?1",
                    [provider_id],
                    |r| {
                        Ok(HealthView {
                            state: parse_state(&r.get::<_, String>(0)?),
                            reason_code: parse_reason(&r.get::<_, String>(1)?),
                            checked_at: Some(r.get::<_, String>(2)?),
                            latency: r.get::<_, Option<i64>>(3)?.map(|v| MeasuredMs::new(v.max(0) as u64)),
                            installation: parse_installation(&r.get::<_, String>(4)?),
                            runtime: parse_runtime(&r.get::<_, String>(5)?),
                        })
                    },
                )
                .optional()?)
        })?)
    }

    /// الصحة المعروضة: المحسوب يسبق المخزّن حين يمنع الفحص أصلًا.
    pub fn health(&self, state: &ProviderState, credential_present: bool) -> Result<HealthView, P02Error> {
        let installation = self.installation(state);
        if !state.enabled {
            return Ok(HealthView::computed(HealthState::Unknown, HealthReason::ProviderDisabled, installation));
        }
        if let Err(reason) = self.resolve_endpoint(state) {
            return Ok(HealthView::computed(HealthState::Misconfigured, reason, installation));
        }
        let needs_key = state.descriptor.auth_mode == polaris_host_providers::domain::AuthMode::ApiKey;
        if needs_key && !credential_present && state.descriptor.model_listing_requires_auth {
            return Ok(HealthView::computed(HealthState::AuthRequired, HealthReason::CredentialMissing, installation));
        }
        match self.stored_health(&state.descriptor.id)? {
            Some(mut stored) => {
                stored.installation = installation;
                Ok(stored)
            }
            None => Ok(HealthView::computed(HealthState::Unknown, HealthReason::NotChecked, installation)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p02::ports::MapEnvironment;
    use polaris_host_providers::domain::RuntimeState;

    fn registry() -> ProviderRegistry {
        ProviderRegistry::new(Arc::new(Database::in_memory().unwrap()), Arc::new(MapEnvironment::default()), false, None)
    }

    #[test]
    fn defaults_come_from_the_descriptor() {
        let r = registry();
        let local = r.state("lm-studio").unwrap();
        assert!(local.enabled);
        assert_eq!(local.endpoint().as_deref(), Some("http://127.0.0.1:1234"));
        let remote = r.state("openai").unwrap();
        assert!(!remote.enabled, "remote providers are opt-in");
        assert!(r.state("no-such-provider").is_err());
    }

    #[test]
    fn a_local_endpoint_can_move_only_within_loopback() {
        let r = registry();
        let state = r.configure("lm-studio", None, Some("http://127.0.0.1:4321/")).unwrap();
        assert_eq!(state.endpoint().as_deref(), Some("http://127.0.0.1:4321"));
        assert!(matches!(r.configure("lm-studio", None, Some("http://10.0.0.9:1234")), Err(P02Error::Denied { .. })));
        assert!(matches!(r.configure("lm-studio", None, Some("https://collector.example.test")), Err(P02Error::Denied { .. })));
    }

    #[test]
    fn a_remote_endpoint_cannot_be_changed_at_all() {
        let r = registry();
        assert!(matches!(r.configure("openai", None, Some("http://127.0.0.1:9")), Err(P02Error::Denied { .. })));
        let state = r.state("openai").unwrap();
        let endpoint = r.resolve_endpoint(&state).unwrap();
        assert_eq!(endpoint.host, "api.openai.com");
    }

    #[test]
    fn the_generic_local_server_is_misconfigured_until_an_endpoint_is_set() {
        let r = registry();
        let state = r.state("local-openai-compatible").unwrap();
        let health = r.health(&state, false).unwrap();
        assert_eq!(health.state, HealthState::Misconfigured);
        assert_eq!(health.reason_code, HealthReason::EndpointNotConfigured);
        assert!(health.checked_at.is_none(), "a computed state has no measurement instant");
    }

    #[test]
    fn a_disabled_provider_is_reported_as_disabled_not_offline() {
        let r = registry();
        r.configure("ollama", Some(false), None).unwrap();
        let state = r.state("ollama").unwrap();
        assert_eq!(r.health(&state, false).unwrap().reason_code, HealthReason::ProviderDisabled);
    }

    // P02-PROVIDER-HEALTH-003: مزوّد محلي مُفعَّل بنقطة نهاية صالحة لكن دون قياس بعدُ
    // → UNKNOWN / NOT_CHECKED بلا لحظة قياس. «مجهول» صحيحٌ قبل القياس، لا بعده.
    #[test]
    fn a_configured_provider_is_unknown_until_it_is_checked() {
        let r = registry();
        let state = r.state("lm-studio").unwrap();
        let health = r.health(&state, false).unwrap();
        assert_eq!(health.state, HealthState::Unknown);
        assert_eq!(health.reason_code, HealthReason::NotChecked);
        assert!(health.checked_at.is_none(), "an unmeasured state carries no instant");
        assert_eq!(health.runtime, RuntimeState::Unknown);
    }
}
