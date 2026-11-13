// المتصفّح الحقيقي (Phase-08): Chromium بلا واجهة عبر بروتوكول أدوات المطوّر، كل طلب فيه يمرّ
// بسياسة التنقّل وعميل HTTP المضيف. انظر ADR-028 وPHASE-08-SECURITY.

pub mod cdp;
pub mod intercept;
pub mod page;
pub mod port;
pub mod service;
pub mod session;
pub mod tools;

pub use port::{chromium_arguments, read_devtools_active_port, BrowserProcess, BrowserProcessPort, UnavailableBrowser};
pub use service::BrowserService;
