// خدمات المزوّدين في المضيف: السجل والإعداد، ووسيط الأسرار، والاكتشاف.

pub mod discovery;
pub mod health;
pub mod registry;
pub mod secrets;
pub mod view;

pub use discovery::ModelDiscovery;
pub use registry::ProviderRegistry;
pub use secrets::SecretBroker;
