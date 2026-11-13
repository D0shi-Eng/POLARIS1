// التحديث: فحص صحة واكتشاف نماذج لمزوّدات مسمّاة ومفعّلة.
//
// لا مسح منافذ ولا اكتشاف شبكة: كل مزوّد يُسأل على نقطة نهايته المُتحقَّق منها
// وحدها، وبمهلة محدودة. المزوّد المعطّل لا يُسأل أصلًا.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;

use polaris_host_providers::adapters::common::is_clean_model_id;
use polaris_host_providers::adapters::{adapter_for, CallContext};
use polaris_host_providers::catalog::documented_models;
use polaris_host_providers::domain::{CapabilityClaim, DiscoveredModel, Fact, ModelCapability, Support};
use polaris_host_providers::domain::{AuthMode, HealthProbe, HealthReason, HealthState, RuntimeState};
use polaris_host_providers::error::ProviderErrorCode;
use polaris_host_providers::net::{CancelToken, HttpClient};

use super::health::{HealthView, MeasuredMs};
use super::registry::ProviderRegistry;
use super::secrets::SecretBroker;
use super::view::ModelCounts;
use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::errors::P02Error;
use crate::p02::models::ModelRegistry;
use crate::p02::LiveFacts;
use crate::time::now_rfc3339_utc;

/// مهلة فحص مزوّد محلي.
const LOCAL_BUDGET: Duration = Duration::from_secs(6);
/// مهلة فحص مزوّد بعيد.
const REMOTE_BUDGET: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
pub struct OutcomeView {
    pub code: ProviderErrorCode,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshEntry {
    pub provider_id: String,
    pub health: HealthView,
    pub models: ModelCounts,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<OutcomeView>,
    pub duration: MeasuredMs,
}

/// يملأ من الفهرس الموثّق ما لم يقله المزوّد عن نماذجه: الاسم، ونافذة السياق، وحدّ المخرجات، والأدوات، والاستدلال،
/// والرؤية. كل ما يُملأ يحمل مصدره (STATIC_DESCRIPTOR)، ولا يُكتب فوق ما أبلغ به المزوّد ولا فوق ما قيس.
pub fn enrich(provider_id: &str, models: &mut [DiscoveredModel]) {
    let documented = documented_models(provider_id);
    if documented.is_empty() {
        return;
    }
    for model in models.iter_mut() {
        let Some(entry) = documented.iter().find(|d| d.id == model.provider_model_id) else { continue };
        if !model.display_name.is_known() {
            model.display_name = Fact::documented(entry.name.clone());
        }
        if !model.context_window.is_known() {
            if let Some(v) = entry.context_window {
                model.context_window = Fact::documented(v);
            }
        }
        if !model.max_output_tokens.is_known() {
            if let Some(v) = entry.max_output_tokens {
                model.max_output_tokens = Fact::documented(v);
            }
        }
        for (capability, flag) in [(ModelCapability::Tools, entry.tools), (ModelCapability::Reasoning, entry.reasoning), (ModelCapability::VisionInput, entry.vision)] {
            if model.claim(capability).support == Support::Unknown {
                model.set_claim(capability, CapabilityClaim::documented(flag));
            }
        }
    }
}

/// نموذج أعلنه المستخدم لمزوّده المخصّص: يُضاف إن لم يُعِده الخادم، ويُسمّى باسمه إن لم يسمّه الخادم.
fn add_declared(models: &mut Vec<DiscoveredModel>, model_id: String, display_name: Option<String>) {
    match models.iter_mut().find(|m| m.provider_model_id == model_id) {
        Some(found) => {
            if let (false, Some(name)) = (found.display_name.is_known(), display_name) {
                found.display_name = Fact::documented(name);
            }
        }
        None => {
            let mut model = DiscoveredModel::bare(model_id);
            if let Some(name) = display_name {
                model.display_name = Fact::documented(name);
            }
            model.set_claim(ModelCapability::Streaming, CapabilityClaim::documented(true));
            models.push(model);
        }
    }
}

pub struct ModelDiscovery {
    providers: Arc<ProviderRegistry>,
    secrets: Arc<SecretBroker>,
    models: Arc<ModelRegistry>,
    http: Arc<HttpClient>,
    audit: Arc<AuditLedger>,
    live: Arc<LiveFacts>,
}

fn outcome(code: ProviderErrorCode) -> OutcomeView {
    OutcomeView { code, retryable: code.retryable() }
}

impl ModelDiscovery {
    pub fn new(
        providers: Arc<ProviderRegistry>,
        secrets: Arc<SecretBroker>,
        models: Arc<ModelRegistry>,
        http: Arc<HttpClient>,
        audit: Arc<AuditLedger>,
        live: Arc<LiveFacts>,
    ) -> Self {
        Self { providers, secrets, models, http, audit, live }
    }

    pub fn refresh(&self, provider_ids: &[String]) -> Result<Vec<RefreshEntry>, P02Error> {
        let mut results = Vec::new();
        for id in provider_ids {
            results.push(self.refresh_one(id)?);
        }
        Ok(results)
    }

    fn counts(&self, provider_id: &str) -> Result<ModelCounts, P02Error> {
        let (discovered, enabled, available) = self.models.counts(provider_id)?;
        Ok(ModelCounts { discovered, enabled, available })
    }

    fn refresh_one(&self, provider_id: &str) -> Result<RefreshEntry, P02Error> {
        let started = Instant::now();
        let state = self.providers.state(provider_id)?;
        let descriptor = state.descriptor.clone();
        let installation = self.providers.installation(&state);

        // حالات تمنع الاتصال أصلًا: تُعلن كما هي، بلا شبكة.
        if !state.enabled {
            return Ok(RefreshEntry {
                provider_id: provider_id.to_string(),
                health: HealthView::computed(HealthState::Unknown, HealthReason::ProviderDisabled, installation),
                models: self.counts(provider_id)?,
                outcome: None,
                duration: MeasuredMs::new(started.elapsed().as_millis() as u64),
            });
        }
        let endpoint = match self.providers.resolve_endpoint(&state) {
            Ok(e) => e,
            Err(reason) => {
                return Ok(RefreshEntry {
                    provider_id: provider_id.to_string(),
                    health: HealthView::computed(HealthState::Misconfigured, reason, installation),
                    models: self.counts(provider_id)?,
                    outcome: None,
                    duration: MeasuredMs::new(started.elapsed().as_millis() as u64),
                })
            }
        };
        let credential = self.secrets.resolve(&descriptor);
        if descriptor.auth_mode == AuthMode::ApiKey && credential.is_none() && descriptor.model_listing_requires_auth {
            return Ok(RefreshEntry {
                provider_id: provider_id.to_string(),
                health: HealthView::computed(HealthState::AuthRequired, HealthReason::CredentialMissing, installation),
                models: self.counts(provider_id)?,
                outcome: Some(outcome(ProviderErrorCode::AuthRequired)),
                duration: MeasuredMs::new(started.elapsed().as_millis() as u64),
            });
        }

        let budget = if endpoint.class == polaris_host_providers::net::NetworkClass::LoopbackProviderAccess { LOCAL_BUDGET } else { REMOTE_BUDGET };
        let cancel = CancelToken::new();
        let adapter = adapter_for(descriptor.kind);
        self.live.mark_network_contact();
        let ctx = CallContext { http: &self.http, endpoint: &endpoint, credential: credential.as_ref(), cancel: &cancel, deadline: Instant::now() + budget, idle: None };
        let probe: HealthProbe = adapter.health_check(&ctx);
        let now = now_rfc3339_utc();
        let mut health = HealthView::measured(probe, now.clone(), installation);
        let mut result_outcome = None;

        if probe.state.is_routable() {
            let ctx = CallContext { http: &self.http, endpoint: &endpoint, credential: credential.as_ref(), cancel: &cancel, deadline: Instant::now() + budget, idle: None };
            match adapter.discover_models(&ctx) {
                Ok(mut models) => {
                    enrich(provider_id, &mut models);
                    // معرّف مُعلَن قبل تشديد القاعدة قد يبقى مخزّنًا؛ لا يُضاف فيُفسد القائمة.
                    for declared in self.providers.declared_models(provider_id)?.into_iter().filter(|d| is_clean_model_id(&d.model_id)) {
                        add_declared(&mut models, declared.model_id, declared.display_name);
                    }
                    self.models.merge(provider_id, &models, &now)?
                }
                Err(error) => {
                    self.models.mark_unreachable(provider_id, &now)?;
                    result_outcome = Some(outcome(error.code));
                    // الفحص نجح والقائمة فشلت: الخادم يعمل لكنه لا يجيب بما نفهم.
                    if error.code == ProviderErrorCode::ProviderResponseInvalid {
                        health.state = HealthState::Misconfigured;
                        health.reason_code = HealthReason::ProtocolMismatch;
                    }
                }
            }
        } else {
            self.models.mark_unreachable(provider_id, &now)?;
            result_outcome = Some(outcome(match probe.state {
                HealthState::AuthFailed => ProviderErrorCode::AuthFailed,
                HealthState::AuthRequired => ProviderErrorCode::AuthRequired,
                HealthState::Unknown if probe.reason == HealthReason::ProviderTimeout => ProviderErrorCode::ProviderTimeout,
                HealthState::Misconfigured => ProviderErrorCode::ProviderResponseInvalid,
                _ => ProviderErrorCode::ProviderUnreachable,
            }));
        }
        if probe.runtime == RuntimeState::Unknown && health.runtime == RuntimeState::Unknown && endpoint.class != polaris_host_providers::net::NetworkClass::LoopbackProviderAccess {
            health.runtime = RuntimeState::NotApplicable;
        }
        self.providers.save_health(provider_id, &health)?;
        let counts = self.counts(provider_id)?;
        self.audit.append(&AuditRecord::new(
            AuditEventType::ProviderRefreshed,
            "provider",
            provider_id,
            if result_outcome.is_none() { AuditOutcome::Success } else { AuditOutcome::Failure },
            json!({
                "health_state": super::health::state_code(health.state),
                "network_class": if endpoint.class == polaris_host_providers::net::NetworkClass::LoopbackProviderAccess { "LOOPBACK_PROVIDER_ACCESS" } else { "REMOTE_EGRESS" },
                "models_discovered": counts.discovered,
                "models_available": counts.available,
            }),
        ))?;
        Ok(RefreshEntry {
            provider_id: provider_id.to_string(),
            health,
            models: counts,
            outcome: result_outcome,
            duration: MeasuredMs::new(started.elapsed().as_millis() as u64),
        })
    }
}
