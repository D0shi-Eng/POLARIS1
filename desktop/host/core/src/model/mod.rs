// نماذج القيم التي تعبر الحدّ. كلها مغلقة ومطابقة للمخططات، والاختبارات تتحقق
// من كل قيمة تُنتَج مقابل مخططها قبل أن تُعاد.

pub mod availability;
pub mod bootstrap;
pub mod settings;

pub use availability::{Availability, AvailabilityReason, AvailabilityState, CapabilityAvailability};
pub use bootstrap::{
    Appearance, Architecture, BootstrapSnapshot, BuildChannel, Direction, Locale, Platform,
    RuntimeReachability, RuntimeStatus,
};
pub use settings::{
    DisplaySafeValue, ResolvedSetting, SettingDescriptor, SettingMode, SettingSectionDescriptor,
    SettingValueKind,
};
