// نموذج مجال المزوّدين والنماذج. أنواع بيانات فقط، بلا شبكة ولا تخزين.

pub mod facts;
pub mod health;
pub mod messages;
pub mod model;
pub mod provider;

pub use facts::{CapabilityClaim, Fact, Provenance, Support};
pub use health::{HealthProbe, HealthReason, HealthState, InstallationState, RuntimeState};
pub use messages::{ChatMessage, EffortWire, ImagePart, FinishReason, InvocationOutput, InvocationSpec, MaxTokensField, ProposedToolCall, ResponseFormat, Role, ToolOffer, Usage, WireProfile};
pub use model::{DiscoveredModel, LoadedState, ModelCapability, ModelKind, Pricing};
pub use provider::{AuthMode, EndpointType, Locality, ProviderCapabilities, ProviderKind};
