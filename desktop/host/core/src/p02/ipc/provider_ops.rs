// عمليات المزوّدين.

use serde::Serialize;
use serde_json::{json, Value};

use super::input::{opt_bool, opt_string, string, strings};
use crate::p02::providers::registry::DeclaredModel;
use polaris_host_providers::catalog::{catalog_source, documented_models};
use polaris_host_providers::SecretValue;
use super::to_value;
use crate::audit::{AuditEventType, AuditOutcome, AuditRecord};
use crate::ipc::errors::HostError;
use crate::p02::providers::secrets::{CredentialOutcome, KeyStatus};
use crate::p02::providers::view::{build, ProviderView};
use crate::p02::Phase02;

fn view(p02: &Phase02, provider_id: &str) -> Result<ProviderView, HostError> {
    let state = p02.providers.state(provider_id)?;
    Ok(build(&p02.providers, &p02.secrets, &p02.models, &state)?)
}

pub fn list(p02: &Phase02) -> Result<Value, HostError> {
    let mut providers = Vec::new();
    for descriptor in p02.providers.relevant()? {
        providers.push(view(p02, &descriptor.id)?);
    }
    Ok(json!({ "providers": to_value(&providers)? }))
}

pub fn configure(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider_id = string(payload, "provider_id")?;
    let enabled = opt_bool(payload, "enabled");
    let endpoint = opt_string(payload, "endpoint");
    let before = p02.providers.state(&provider_id)?;
    let after = p02.providers.configure(&provider_id, enabled, endpoint.as_deref())?;
    let event = match (before.enabled, after.enabled) {
        (false, true) => AuditEventType::ProviderEnabled,
        (true, false) => AuditEventType::ProviderDisabled,
        _ => AuditEventType::ProviderConfigured,
    };
    p02.audit.append(&AuditRecord::new(
        event,
        "provider",
        &provider_id,
        AuditOutcome::Success,
        json!({ "enabled": after.enabled, "endpoint_changed": endpoint.is_some() }),
    ))?;
    Ok(json!({ "provider": to_value(&view(p02, &provider_id)?)? }))
}

#[derive(Serialize)]
struct CredentialResult {
    provider_id: String,
    outcome: CredentialOutcome,
    key_status: KeyStatus,
}

pub fn credential_set(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider_id = string(payload, "provider_id")?;
    let descriptor = p02.providers.descriptor(&provider_id)?;
    let outcome = p02.secrets.set(&descriptor)?;
    to_value(&CredentialResult { provider_id, outcome, key_status: p02.secrets.status(&descriptor) })
}

pub fn credential_clear(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider_id = string(payload, "provider_id")?;
    let descriptor = p02.providers.descriptor(&provider_id)?;
    let outcome = p02.secrets.clear(&descriptor)?;
    to_value(&CredentialResult { provider_id, outcome, key_status: p02.secrets.status(&descriptor) })
}

/// الفهرس كاملًا لنافذة «الاتصال بمزوّد» (ADR-037): مدخل خفيف لكل مزوّد، بلا قراءة مخزن الاعتماد لمئتي مزوّد. «له مفتاح في
/// البيئة» قراءة متغيّر بيئة لا قيمته، و«مفعّل» من الإعداد المخزّن.
pub fn catalog(p02: &Phase02) -> Result<Value, HostError> {
    let relevant: std::collections::HashSet<String> = p02.providers.relevant()?.into_iter().map(|d| d.id.clone()).collect();
    let mut entries = Vec::new();
    for d in p02.providers.descriptors()? {
        let state = if relevant.contains(&d.id) { Some(p02.providers.state(&d.id)?) } else { None };
        let environment_key_present = p02.secrets.environment_key_present(&d);
        let mut entry = json!({
            "provider_id": d.id,
            "kind": d.kind,
            "display_name": d.display_name,
            "display_name_key": d.display_name_key,
            "locality": d.locality,
            "auth_mode": d.auth_mode,
            "enabled": state.as_ref().is_some_and(|s| s.enabled),
            "documented_models": documented_models(&d.id).len(),
            "environment_key_present": environment_key_present,
        });
        if d.popular_rank > 0 {
            entry["popular_rank"] = json!(d.popular_rank);
        }
        if let Some(var) = &d.credential_env_var {
            entry["environment_variable"] = json!(var);
        }
        entries.push(entry);
    }
    let (source, retrieved) = catalog_source();
    Ok(json!({ "source": source, "retrieved": retrieved, "entries": entries }))
}

/// مفتاح كتبه المستخدم في نافذة الاتصال (ADR-037). يُبنى منه سرّ يُكتب إلى مخزن الاعتماد ثم يُسقط؛ النتيجة حالة لا قيمة.
pub fn credential_put(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider_id = string(payload, "provider_id")?;
    let descriptor = p02.providers.descriptor(&provider_id)?;
    let secret = payload
        .get("api_key")
        .and_then(Value::as_str)
        .map(str::to_string)
        .and_then(SecretValue::new)
        .ok_or_else(|| crate::p02::errors::P02Error::invalid("/api_key", "an API key of 1 to 4096 characters"))?;
    let outcome = p02.secrets.put(&descriptor, secret)?;
    to_value(&CredentialResult { provider_id, outcome, key_status: p02.secrets.status(&descriptor) })
}

/// ينشئ مزوّدًا مخصّصًا أو يعدّله، ويُعيد عرضه. لا مفتاح هنا: المفتاح عملية مستقلّة.
pub fn custom_save(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider_id = string(payload, "provider_id")?;
    let display_name = string(payload, "display_name")?;
    let base_url = string(payload, "base_url")?;
    let models: Vec<DeclaredModel> = match payload.get("models") {
        Some(value) => serde_json::from_value(value.clone()).map_err(|e| crate::p02::errors::P02Error::invalid("/models", e.to_string()))?,
        None => Vec::new(),
    };
    let (_, created) = p02.providers.save_custom(&provider_id, &display_name, &base_url, &models)?;
    p02.audit.append(&AuditRecord::new(
        if created { AuditEventType::ProviderEnabled } else { AuditEventType::ProviderConfigured },
        "provider",
        &provider_id,
        AuditOutcome::Success,
        json!({ "custom": true, "created": created, "declared_models": models.len() }),
    ))?;
    Ok(json!({ "provider": to_value(&view(p02, &provider_id)?)? }))
}

/// يحذف مزوّدًا مخصّصًا: إعداده، ونماذجه، ومفتاحه في مخزن الاعتماد. المزوّد المدمج والمستضاف لا يُحذفان (يُفصلان).
pub fn custom_delete(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider_id = string(payload, "provider_id")?;
    if !p02.providers.is_custom(&provider_id)? {
        return Err(crate::p02::errors::P02Error::denied("/provider_id", "only a custom provider can be deleted").into());
    }
    if let Ok(descriptor) = p02.providers.descriptor(&provider_id) {
        p02.secrets.clear(&descriptor)?;
    }
    let models = p02.models.remove_provider(&provider_id)?;
    let removed = p02.providers.delete_custom(&provider_id)?;
    p02.audit.append(&AuditRecord::new(
        AuditEventType::ProviderDisabled,
        "provider",
        &provider_id,
        AuditOutcome::Success,
        json!({ "custom": true, "deleted": removed, "models_removed": models }),
    ))?;
    Ok(json!({ "provider_id": provider_id, "removed": removed }))
}

pub fn refresh(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let ids = strings(payload, "provider_ids");
    for id in &ids {
        p02.providers.descriptor(id)?;
    }
    let results = p02.discovery.refresh(&ids)?;
    Ok(json!({ "results": to_value(&results)? }))
}
