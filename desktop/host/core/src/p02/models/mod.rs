// سجل النماذج وتفضيلات الاختيار.

pub mod listing;
pub mod preferences;
pub mod registry;
pub mod view;

pub use preferences::Preferences;
pub use registry::{ModelAvailability, ModelRecord, ModelRegistry};
