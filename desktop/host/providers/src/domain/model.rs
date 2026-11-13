// النموذج كما أبلغ عنه المزوّد.
//
// لا حقل يُملأ بتخمين: نافذة السياق، وعدد المعاملات، والتكميم، والرؤية، والأدوات
// كلها `Fact` أو `CapabilityClaim`، ومجهولة ما لم يقلها المزوّد.

use serde::{Deserialize, Serialize};

use super::facts::{CapabilityClaim, Fact, Provenance};

/// مفردات القدرات المحدودة. لا نصّ حرّ في العقد الموثوق.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelCapability {
    TextInput,
    TextOutput,
    VisionInput,
    AudioInput,
    AudioOutput,
    Tools,
    Json,
    JsonSchema,
    Embeddings,
    Reasoning,
    Streaming,
}

impl ModelCapability {
    pub const ALL: [ModelCapability; 11] = [
        Self::TextInput,
        Self::TextOutput,
        Self::VisionInput,
        Self::AudioInput,
        Self::AudioOutput,
        Self::Tools,
        Self::Json,
        Self::JsonSchema,
        Self::Embeddings,
        Self::Reasoning,
        Self::Streaming,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModelKind {
    Chat,
    Embedding,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoadedState {
    Loaded,
    NotLoaded,
    Unknown,
}

/// سعر لكل رمز كما أبلغ به المزوّد، نصًّا عشريًا كما ورد لتجنّب أخطاء التقريب.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pricing {
    pub input_price_usd: String,
    pub output_price_usd: String,
    /// الوحدة ثابتة: دولار لكل رمز.
    pub unit: PriceUnit,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PriceUnit {
    PerToken,
}

/// قدرة واحدة وادعاؤها.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityEntry {
    pub capability: ModelCapability,
    pub support: super::facts::Support,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredModel {
    pub provider_model_id: String,
    pub display_name: Fact<String>,
    pub kind: ModelKind,
    pub family: Fact<String>,
    pub vendor: Fact<String>,
    pub architecture: Fact<String>,
    pub context_window: Fact<u64>,
    pub max_output_tokens: Fact<u64>,
    pub quantization: Fact<String>,
    pub parameter_count: Fact<String>,
    pub loaded_state: LoadedState,
    pub loaded_state_provenance: Provenance,
    pub capabilities: Vec<CapabilityEntry>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pricing: Option<Pricing>,
}

impl DiscoveredModel {
    /// نموذج بمعرّفه فقط، وكل ما عداه مجهول.
    pub fn bare(provider_model_id: String) -> Self {
        Self {
            provider_model_id,
            display_name: Fact::unknown(),
            kind: ModelKind::Unknown,
            family: Fact::unknown(),
            vendor: Fact::unknown(),
            architecture: Fact::unknown(),
            context_window: Fact::unknown(),
            max_output_tokens: Fact::unknown(),
            quantization: Fact::unknown(),
            parameter_count: Fact::unknown(),
            loaded_state: LoadedState::Unknown,
            loaded_state_provenance: Provenance::Unknown,
            capabilities: ModelCapability::ALL
                .iter()
                .map(|c| CapabilityEntry {
                    capability: *c,
                    support: CapabilityClaim::UNKNOWN.support,
                    provenance: CapabilityClaim::UNKNOWN.provenance,
                })
                .collect(),
            pricing: None,
        }
    }

    pub fn claim(&self, capability: ModelCapability) -> CapabilityClaim {
        self.capabilities
            .iter()
            .find(|e| e.capability == capability)
            .map(|e| CapabilityClaim { support: e.support, provenance: e.provenance })
            .unwrap_or(CapabilityClaim::UNKNOWN)
    }

    pub fn set_claim(&mut self, capability: ModelCapability, claim: CapabilityClaim) {
        if let Some(entry) = self.capabilities.iter_mut().find(|e| e.capability == capability) {
            entry.support = claim.support;
            entry.provenance = claim.provenance;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::facts::Support;

    #[test]
    fn a_bare_model_claims_nothing() {
        let model = DiscoveredModel::bare("m".into());
        assert_eq!(model.capabilities.len(), 11);
        for capability in ModelCapability::ALL {
            assert!(!model.claim(capability).is_proven());
        }
        assert!(!model.context_window.is_known());
    }

    #[test]
    fn setting_a_claim_changes_only_that_capability() {
        let mut model = DiscoveredModel::bare("m".into());
        model.set_claim(ModelCapability::VisionInput, CapabilityClaim::reported(true));
        assert!(model.claim(ModelCapability::VisionInput).is_proven());
        assert_eq!(model.claim(ModelCapability::Tools).support, Support::Unknown);
    }
}
