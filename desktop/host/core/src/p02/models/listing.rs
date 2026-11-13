// قائمة النماذج بعرضها الكامل: سجل النموذج مع حال مزوّده الآن.
//
// يستعملها العرض والتوجيه معًا، فلا يرى المُحدِّد شيئًا لا يراه الموجِّه.

use std::collections::HashMap;

use polaris_host_providers::adapters::common::is_clean_model_id;
use polaris_host_providers::domain::HealthState;

use super::preferences::Preferences;
use super::registry::ModelRegistry;
use super::view::{build, ModelView, ProviderContext};
use crate::p02::errors::P02Error;
use crate::p02::providers::{ProviderRegistry, SecretBroker};

pub fn list_views(
    providers: &ProviderRegistry,
    secrets: &SecretBroker,
    models: &ModelRegistry,
    preferences: &Preferences,
    provider_filter: Option<&str>,
) -> Result<Vec<ModelView>, P02Error> {
    let default_model = preferences.default_model()?;
    let mut contexts: HashMap<String, ProviderContext> = HashMap::new();
    let mut out = Vec::new();
    for record in models.list(provider_filter)? {
        // سجلّ واحد لا يمثّله العقد كان يُسقط القائمة كلّها بـ INTERNAL_ERROR (2026-10-06):
        // يُتخطّى وحده، والباقي يُعرض.
        if !is_clean_model_id(&record.facts.provider_model_id) {
            continue;
        }
        if !contexts.contains_key(&record.provider_id) {
            // سجل لمزوّد لم يعد في الفهرس يُعرض بلا صحة ومعطّلًا.
            let context = match providers.state(&record.provider_id) {
                Ok(state) => {
                    let key = secrets.status(&state.descriptor);
                    let health = providers.health(&state, key.configured)?;
                    ProviderContext { locality: state.descriptor.locality, enabled: state.enabled, health: health.state }
                }
                Err(_) => ProviderContext {
                    locality: polaris_host_providers::domain::Locality::Remote,
                    enabled: false,
                    health: HealthState::Unknown,
                },
            };
            contexts.insert(record.provider_id.clone(), context);
        }
        let context = &contexts[&record.provider_id];
        out.push(build(&record, context, default_model.as_deref()));
    }
    Ok(out)
}
