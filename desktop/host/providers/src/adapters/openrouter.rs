// OpenRouter: بروتوكول متوافق تحت البادئة `/api`، وقائمة نماذج غنية بالبيانات.
//
// القائمة عامة في وثائق المزوّد فتُقرأ بلا مفتاح، والاستدعاء يتطلب مفتاحًا.
// البيانات الإضافية — طول السياق، والوسائط المدخلة، والمعاملات المدعومة، والسعر —
// كلها «أبلغ بها المزوّد»، ولا يُستنتج منها ما لم يُذكر.

use serde_json::Value;

use crate::adapters::common::{self, clean_model_id, clean_text, positive_u64, MAX_MODELS};
use crate::adapters::openai_compat::{Flavor, OpenAiCompatible};
use crate::adapters::{CallContext, ProviderAdapter};
use crate::domain::{
    CapabilityClaim, DiscoveredModel, Fact, HealthProbe, InvocationOutput, InvocationSpec, ModelCapability, ModelKind,
    Pricing, Provenance,
};
use crate::error::{ProviderError, ProviderErrorCode};

pub struct OpenRouter {
    compat: OpenAiCompatible,
}

impl Default for OpenRouter {
    fn default() -> Self {
        Self::new()
    }
}

fn price(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    let ok = !text.is_empty() && text.len() <= 24 && text.chars().all(|c| c.is_ascii_digit() || c == '.');
    ok.then(|| text.to_string())
}

impl OpenRouter {
    pub fn new() -> Self {
        Self { compat: OpenAiCompatible::with_flavor(Flavor::Router) }
    }

    pub fn parse_models(value: &Value) -> Result<Vec<DiscoveredModel>, ProviderError> {
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
            let mut model = DiscoveredModel::bare(id.clone());
            model.display_name = Fact::reported_opt(clean_text(entry.get("name"), 128));
            model.context_window = Fact::reported_opt(positive_u64(entry.get("context_length")));
            model.max_output_tokens = Fact::reported_opt(positive_u64(entry.pointer("/top_provider/max_completion_tokens")));
            if let Some((vendor, _)) = id.split_once('/') {
                model.vendor = Fact::reported(vendor.chars().take(64).collect());
            }
            if let Some(inputs) = entry.pointer("/architecture/input_modalities").and_then(Value::as_array) {
                let has = |m: &str| inputs.iter().any(|x| x.as_str() == Some(m));
                model.set_claim(ModelCapability::TextInput, CapabilityClaim::reported(has("text")));
                model.set_claim(ModelCapability::VisionInput, CapabilityClaim::reported(has("image")));
                model.set_claim(ModelCapability::AudioInput, CapabilityClaim::reported(has("audio")));
            }
            if let Some(outputs) = entry.pointer("/architecture/output_modalities").and_then(Value::as_array) {
                let has = |m: &str| outputs.iter().any(|x| x.as_str() == Some(m));
                model.set_claim(ModelCapability::TextOutput, CapabilityClaim::reported(has("text")));
                model.set_claim(ModelCapability::AudioOutput, CapabilityClaim::reported(has("audio")));
                if has("text") {
                    model.kind = ModelKind::Chat;
                }
            }
            if let Some(params) = entry.get("supported_parameters").and_then(Value::as_array) {
                let has = |p: &str| params.iter().any(|x| x.as_str() == Some(p));
                model.set_claim(ModelCapability::Tools, CapabilityClaim::reported(has("tools")));
                model.set_claim(ModelCapability::JsonSchema, CapabilityClaim::reported(has("structured_outputs")));
                model.set_claim(ModelCapability::Json, CapabilityClaim::reported(has("response_format")));
                model.set_claim(ModelCapability::Reasoning, CapabilityClaim::reported(has("reasoning")));
            }
            if let (Some(prompt), Some(completion)) = (price(entry.pointer("/pricing/prompt")), price(entry.pointer("/pricing/completion"))) {
                model.pricing = Some(Pricing {
                    input_price_usd: prompt,
                    output_price_usd: completion,
                    unit: crate::domain::model::PriceUnit::PerToken,
                    provenance: Provenance::ProviderReported,
                });
            }
            models.push(model);
        }
        Ok(models)
    }
}

impl ProviderAdapter for OpenRouter {
    fn discover_models(&self, ctx: &CallContext<'_>) -> Result<Vec<DiscoveredModel>, ProviderError> {
        let (value, _) = common::get_json(ctx, ctx.endpoint.path("/api/v1/models"), common::bearer(ctx))?;
        Self::parse_models(&value)
    }

    fn health_check(&self, ctx: &CallContext<'_>) -> HealthProbe {
        common::probe(ctx, ctx.endpoint.path("/api/v1/models"), Vec::new())
    }

    fn invoke(&self, spec: &InvocationSpec, ctx: &CallContext<'_>) -> Result<InvocationOutput, ProviderError> {
        self.compat.invoke_at(spec, ctx, ctx.endpoint.path("/api/v1/chat/completions"))
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
    fn rich_metadata_is_reported_with_provenance() {
        let value = serde_json::json!({ "data": [ {
            "id": "vendor/fixture-model",
            "name": "Fixture Model",
            "context_length": 200000,
            "architecture": { "input_modalities": ["text", "image"], "output_modalities": ["text"] },
            "top_provider": { "max_completion_tokens": 8192 },
            "pricing": { "prompt": "0.000003", "completion": "0.000015" },
            "supported_parameters": ["tools", "max_tokens"]
        }, { "id": "vendor/bare" } ]});
        let models = OpenRouter::parse_models(&value).unwrap();
        let rich = &models[0];
        assert_eq!(rich.vendor.value.as_deref(), Some("vendor"));
        assert!(rich.claim(ModelCapability::VisionInput).is_proven());
        assert!(rich.claim(ModelCapability::Tools).is_proven());
        assert_eq!(rich.claim(ModelCapability::JsonSchema).support, Support::Unsupported);
        assert_eq!(rich.pricing.as_ref().unwrap().input_price_usd, "0.000003");
        let bare = &models[1];
        assert!(bare.pricing.is_none());
        assert_eq!(bare.claim(ModelCapability::Tools).support, Support::Unknown);
    }

    #[test]
    fn prices_must_be_plain_decimals() {
        assert_eq!(price(Some(&serde_json::json!("0.1"))), Some("0.1".into()));
        assert_eq!(price(Some(&serde_json::json!("-1"))), None);
        assert_eq!(price(Some(&serde_json::json!(0.1))), None);
    }
}
