// شكل المزوّد كما يعبر الحدّ (`ProviderDescriptorView` في العقد).

use serde::Serialize;

use polaris_host_providers::domain::{AuthMode, EndpointType, Locality, ProviderCapabilities, ProviderKind};
use polaris_host_providers::net::NetworkClass;

use super::health::HealthView;
use super::registry::{ProviderRegistry, ProviderState};
use super::secrets::{KeyStatus, SecretBroker};
use crate::p02::errors::P02Error;
use crate::p02::models::ModelRegistry;

#[derive(Debug, Clone, Serialize)]
pub struct ModelCounts {
    pub discovered: u64,
    pub enabled: u64,
    pub available: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderView {
    pub provider_id: String,
    pub kind: ProviderKind,
    pub display_name: String,
    pub display_name_key: String,
    pub endpoint_type: EndpointType,
    pub auth_mode: AuthMode,
    pub locality: Locality,
    pub network_class: NetworkClass,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    pub endpoint_configurable: bool,
    pub enabled: bool,
    pub configured: bool,
    pub key_status: KeyStatus,
    pub capabilities: ProviderCapabilities,
    pub health: HealthView,
    pub models: ModelCounts,
}

pub fn build(registry: &ProviderRegistry, secrets: &SecretBroker, models: &ModelRegistry, state: &ProviderState) -> Result<ProviderView, P02Error> {
    let d = &state.descriptor;
    let key_status = secrets.status(d);
    let health = registry.health(state, key_status.configured)?;
    let resolved = registry.resolve_endpoint(state).ok();
    let (discovered, enabled, available) = models.counts(&d.id)?;
    let endpoint_ok = resolved.is_some();
    let configured = endpoint_ok && (!key_status.required || key_status.configured);
    Ok(ProviderView {
        provider_id: d.id.clone(),
        kind: d.kind,
        display_name: d.display_name.clone(),
        display_name_key: d.display_name_key.clone(),
        endpoint_type: d.endpoint_type,
        auth_mode: d.auth_mode,
        locality: d.locality,
        network_class: match d.locality {
            Locality::Local => NetworkClass::LoopbackProviderAccess,
            Locality::Remote => NetworkClass::RemoteEgress,
        },
        // العرض يأتي من الوجهة المُتحقَّق منها لا من النصّ المخزّن. تجهيزة الاختبار
        // تُعرض بعنوان المزوّد الحقيقي كي لا يظهر عنوان الحلقة المحلية لمزوّد بعيد.
        endpoint: match (&resolved, d.locality) {
            (Some(e), Locality::Local) => Some(e.display()),
            (Some(_), Locality::Remote) => d.default_endpoint.clone(),
            (None, _) => None,
        },
        endpoint_configurable: d.endpoint_configurable,
        enabled: state.enabled,
        configured,
        key_status,
        capabilities: d.capabilities,
        health,
        models: ModelCounts { discovered, enabled, available },
    })
}
