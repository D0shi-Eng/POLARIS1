// شكل النموذج كما يعبر الحدّ (`ModelView` في العقد).

use serde::Serialize;

use polaris_host_providers::domain::facts::{Fact, Provenance};
use polaris_host_providers::domain::model::{CapabilityEntry, LoadedState, ModelKind, Pricing};
use polaris_host_providers::domain::{HealthState, Locality};

use super::registry::{ModelAvailability, ModelRecord};

#[derive(Debug, Clone, Serialize)]
pub struct LoadedFact {
    pub value: LoadedState,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelView {
    pub model_id: String,
    pub provider_id: String,
    pub provider_model_id: String,
    pub display_name: Fact<String>,
    pub kind: ModelKind,
    pub family: Fact<String>,
    pub vendor: Fact<String>,
    pub architecture: Fact<String>,
    pub quantization: Fact<String>,
    pub parameter_count: Fact<String>,
    pub context_window: Fact<u64>,
    pub max_output_tokens: Fact<u64>,
    pub loaded_state: LoadedFact,
    pub capabilities: Vec<CapabilityEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pricing: Option<Pricing>,
    pub locality: Locality,
    pub enabled: bool,
    pub availability: ModelAvailability,
    pub stale: bool,
    pub is_default: bool,
    pub provider_enabled: bool,
    pub provider_health: HealthState,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

/// سياق المزوّد الذي يحتاجه العرض.
pub struct ProviderContext {
    pub locality: Locality,
    pub enabled: bool,
    pub health: HealthState,
}

pub fn build(record: &ModelRecord, provider: &ProviderContext, default_model: Option<&str>) -> ModelView {
    let facts = &record.facts;
    ModelView {
        model_id: record.model_id.clone(),
        provider_id: record.provider_id.clone(),
        provider_model_id: facts.provider_model_id.clone(),
        display_name: facts.display_name.clone(),
        kind: facts.kind,
        family: facts.family.clone(),
        vendor: facts.vendor.clone(),
        architecture: facts.architecture.clone(),
        quantization: facts.quantization.clone(),
        parameter_count: facts.parameter_count.clone(),
        context_window: facts.context_window.clone(),
        max_output_tokens: facts.max_output_tokens.clone(),
        loaded_state: LoadedFact { value: facts.loaded_state, provenance: facts.loaded_state_provenance },
        capabilities: facts.capabilities.clone(),
        pricing: facts.pricing.clone(),
        locality: provider.locality,
        enabled: record.enabled,
        availability: record.availability,
        stale: record.availability != ModelAvailability::Available,
        is_default: default_model == Some(record.model_id.as_str()),
        provider_enabled: provider.enabled,
        provider_health: provider.health,
        first_seen_at: record.first_seen_at.clone(),
        last_seen_at: record.last_seen_at.clone(),
    }
}

/// قابل للاختيار في المُحدِّد: مفعّل، ومتاح، ومزوّده مفعّل وصالح للتوجيه، ومحادثة غير منفية.
pub fn selectable(view: &ModelView) -> bool {
    view.enabled
        && view.availability == ModelAvailability::Available
        && view.provider_enabled
        && view.provider_health.is_routable()
        && view.kind != ModelKind::Embedding
}
