// LM Studio: واجهة متوافقة للاستدعاء، وواجهة REST الأغنى للاكتشاف.
//
// الاكتشاف يحاول `/api/v0/models` أولًا لأنها تبلغ بالنوع والمعمارية والتكميم
// وحالة التحميل وأقصى سياق. إن لم تكن متاحة (إصدار أقدم أو خادم آخر) يعود إلى
// `/v1/models` بمعرّفات فقط، وتبقى بقية الحقول مجهولة.
// لا يُحمَّل نموذج ولا يُفرَّغ من هنا: القراءة فقط.

use serde_json::Value;

use crate::adapters::common::{self, clean_model_id, clean_text, positive_u64, MAX_MODELS};
use crate::adapters::openai_compat::{Flavor, OpenAiCompatible};
use crate::adapters::{CallContext, ProviderAdapter};
use crate::domain::{
    CapabilityClaim, DiscoveredModel, Fact, HealthProbe, InvocationOutput, InvocationSpec, LoadedState, ModelCapability,
    ModelKind, Provenance,
};
use crate::error::{ProviderError, ProviderErrorCode};

pub struct LmStudio {
    compat: OpenAiCompatible,
}

impl Default for LmStudio {
    fn default() -> Self {
        Self::new()
    }
}

impl LmStudio {
    pub fn new() -> Self {
        Self { compat: OpenAiCompatible::with_flavor(Flavor::LocalStudio) }
    }

    /// يحلّل ردّ `/api/v0/models`.
    pub fn parse_rest_models(value: &Value) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let data = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| ProviderError::new(ProviderErrorCode::ProviderResponseInvalid, "models response has no data array"))?;
        let mut seen = std::collections::BTreeSet::new();
        let mut models = Vec::new();
        for entry in data.iter().take(MAX_MODELS) {
            let Some(id) = clean_model_id(entry.get("id")) else { continue };
            if !seen.insert(id.clone()) {
                continue;
            }
            let mut model = DiscoveredModel::bare(id);
            model.vendor = Fact::reported_opt(clean_text(entry.get("publisher"), 64));
            model.architecture = Fact::reported_opt(clean_text(entry.get("arch"), 64));
            model.quantization = Fact::reported_opt(clean_text(entry.get("quantization"), 32));
            // النافذة التي يخدم بها الخادم فعلًا هي نافذة التحميل، لا أقصى ما يدعمه النموذج (قِيس في
            // Phase-08: 262144 مُعلنة و8192 محمّلة، فكان المُوجِّه مع سقف المخرجات يتجاوز النافذة).
            let loaded = entry.get("state").and_then(Value::as_str) == Some("loaded");
            let window = if loaded { positive_u64(entry.get("loaded_context_length")).or_else(|| positive_u64(entry.get("max_context_length"))) } else { positive_u64(entry.get("max_context_length")) };
            model.context_window = Fact::reported_opt(window);
            match entry.get("type").and_then(Value::as_str) {
                Some("llm") => {
                    model.kind = ModelKind::Chat;
                    model.set_claim(ModelCapability::TextInput, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::VisionInput, CapabilityClaim::reported(false));
                    model.set_claim(ModelCapability::Embeddings, CapabilityClaim::reported(false));
                    model.set_claim(ModelCapability::Streaming, CapabilityClaim::documented(true));
                    // مخرجات مهيكلة بمخطط JSON موثّقة للخادم المحلي (تُرسل كـ json_schema).
                    model.set_claim(ModelCapability::Json, CapabilityClaim::documented(true));
                }
                Some("vlm") => {
                    model.kind = ModelKind::Chat;
                    model.set_claim(ModelCapability::TextInput, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::VisionInput, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::Embeddings, CapabilityClaim::reported(false));
                    model.set_claim(ModelCapability::Streaming, CapabilityClaim::documented(true));
                    // مخرجات مهيكلة بمخطط JSON موثّقة للخادم المحلي (تُرسل كـ json_schema).
                    model.set_claim(ModelCapability::Json, CapabilityClaim::documented(true));
                }
                Some("embeddings") => {
                    model.kind = ModelKind::Embedding;
                    model.set_claim(ModelCapability::Embeddings, CapabilityClaim::reported(true));
                    model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(false));
                }
                _ => {}
            }
            match entry.get("state").and_then(Value::as_str) {
                Some("loaded") => {
                    model.loaded_state = LoadedState::Loaded;
                    model.loaded_state_provenance = Provenance::ProviderReported;
                }
                Some("not-loaded") => {
                    model.loaded_state = LoadedState::NotLoaded;
                    model.loaded_state_provenance = Provenance::ProviderReported;
                }
                _ => {}
            }
            if let Some(list) = entry.get("capabilities").and_then(Value::as_array) {
                if list.iter().any(|c| c.as_str() == Some("tool_use")) {
                    model.set_claim(ModelCapability::Tools, CapabilityClaim::reported(true));
                }
            }
            models.push(model);
        }
        Ok(models)
    }
}

impl ProviderAdapter for LmStudio {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        match common::get_json(ctx, ctx.endpoint.path("/api/v0/models"), Vec::new()) {
            Ok((value, _)) => Self::parse_rest_models(&value),
            // المسار الأغنى غير موجود: قائمة المعرّفات فقط، والباقي مجهول.
            Err(error) if matches!(error.http_status, Some(404) | Some(405)) => self.compat.discover_models(ctx),
            Err(error) => Err(error),
        }
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        common::probe(ctx, ctx.endpoint.path("/v1/models"), Vec::new())
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        self.compat.invoke(spec, ctx)
    }

    fn supports_native_tools(&self) -> bool {
        true
    }

    /// يمرّ بمحوّل الواجهة المتوافقة نفسه، فينقل الصور أجزاءَ `image_url`.
    fn supports_image_input(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Support;

    #[test]
    fn rest_metadata_is_reported_not_guessed() {
        let value = serde_json::json!({ "object": "list", "data": [
            { "id": "vision-model", "type": "vlm", "publisher": "pub", "arch": "arch-x", "quantization": "4bit", "state": "not-loaded", "max_context_length": 32768 },
            { "id": "embedder", "type": "embeddings", "state": "loaded" },
            { "id": "plain" }
        ]});
        let models = LmStudio::parse_rest_models(&value).unwrap();
        assert_eq!(models.len(), 3);
        let vision = &models[0];
        assert_eq!(vision.kind, ModelKind::Chat);
        assert!(vision.claim(ModelCapability::VisionInput).is_proven());
        assert_eq!(vision.context_window.value, Some(32768));
        assert_eq!(vision.context_window.provenance, Provenance::ProviderReported);
        assert_eq!(vision.loaded_state, LoadedState::NotLoaded);
        assert_eq!(models[1].kind, ModelKind::Embedding);
        assert_eq!(models[1].loaded_state, LoadedState::Loaded);
        let plain = &models[2];
        assert_eq!(plain.kind, ModelKind::Unknown);
        assert_eq!(plain.claim(ModelCapability::VisionInput).support, Support::Unknown);
        assert!(!plain.context_window.is_known());
        assert_eq!(plain.loaded_state, LoadedState::Unknown);
    }

    #[test]
    fn a_loaded_model_reports_the_window_it_is_served_with_not_its_maximum() {
        let value = serde_json::json!({ "data": [
            { "id": "a", "type": "llm", "state": "loaded", "max_context_length": 262144, "loaded_context_length": 8192 },
            { "id": "b", "type": "llm", "state": "not-loaded", "max_context_length": 32768 }
        ] });
        let models = LmStudio::parse_rest_models(&value).unwrap();
        assert_eq!(models[0].context_window.value, Some(8192));
        assert_eq!(models[1].context_window.value, Some(32768));
    }

}
