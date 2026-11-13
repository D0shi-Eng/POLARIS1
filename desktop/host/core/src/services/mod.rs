// الخدمات الأصلية. خدمة واحدة تملك كل عملية، ولا خدمة تملك أكثر من مسؤولية.
//
// لا يوجد `DesktopService` يجمع سبع مسؤوليات: البوابة توجّه إلى المالك المُسجَّل
// لكل عملية، والسجل هو من يسمّي المالك. هذا ما يجعل `C3` قابلًا للإثبات: لا نقطة
// إرسال عامة موجودة أصلًا.

pub mod app_info;
pub mod bootstrap;
pub mod capability_availability;
pub mod host;
pub mod platform_info;
pub mod runtime_status;
pub mod settings_facade;

pub use app_info::AppInfoService;
pub use bootstrap::BootstrapService;
pub use capability_availability::CapabilityAvailabilityService;
pub use host::DesktopHost;
pub use platform_info::PlatformInfoService;
pub use runtime_status::RuntimeStatusService;
pub use settings_facade::SettingsFacade;
