// نواة المضيف الأصلي لـPOLARIS Phase-01.
//
// لماذا هذه النواة منفصلة عن ربط Tauri: الحدّ الأمني كله هنا — التحقق من الظرف،
// التوجيه المغلق، ختم الهوية، الخدمات، وإخفاء التفصيل الداخلي. الإطار لا يملك أيًّا
// من ذلك، ولذلك تُختبر النواة على أي مضيف دون نافذة ولا WebView2، ويبقى ما لا
// يمكن اختباره إلا على Windows صغيرًا ومحصورًا في طبقة app.

#![forbid(unsafe_code)]
#![deny(clippy::all)]

pub mod audit;
pub mod capabilities;
pub mod contracts;
pub mod diagnostics;
pub mod digest;
pub mod ids;
pub mod ipc;
pub mod model;
pub mod p02;
pub mod p03;
pub mod p04;
pub mod p05;
pub mod p06;
pub mod p07;
pub mod p08;
pub mod services;
pub mod settings;
pub mod storage;
pub mod test_scratch;
pub mod text;
pub mod time;

pub use ipc::gateway::{Gateway, GatewayOutcome};
pub use ipc::identity::TransportIdentity;
pub use services::host::DesktopHost;

/// إصدار عقد الظرف الذي يتكلّمه هذا المضيف. عمليات سطح المكتب أُضيفت في 1.1
/// (ADR-017)، وعمليات Phase-02 في 1.2 (ADR-019)، وعمليات Phase-03 في 1.3 (ADR-021)،
/// وعمليات Phase-04 في 1.4 (ADR-023)، وعمليات Phase-05 في 1.5 (ADR-025)، وعمليات
/// Phase-06 في 1.6 (ADR-026)، وعمليات Phase-08 في 1.7 (ADR-028). عملية لا تسافر داخل مستند يعلن إصدارًا أدنى من إصدار إدخالها.
pub const IPC_PROTOCOL_VERSION: &str = "1.7";

/// إصدار عقد الإعدادات الذي يصفه SettingsFacade.
pub const SETTINGS_SCHEMA_VERSION: &str = "1.0";

/// إصدار عقد النواة (contract_version في الظرف).
pub const CONTRACT_VERSION: &str = "1.7";
