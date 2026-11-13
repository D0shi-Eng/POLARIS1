// منافذ Phase-08 على ويندوز (ADR-028). خارج ويندوز الحزمة فارغة: لا صندوق ولا متصفّح بديلًا.
//
// `unsafe` هنا محصور في ملفات FFI مسمّاة (process.rs وsandbox.rs)، وكل كتلة منه تحمل سببها.

#[cfg(windows)]
pub mod browser;
pub mod discovery;
#[cfg(windows)]
pub mod process;
#[cfg(windows)]
pub mod sandbox;

#[cfg(windows)]
pub use browser::{find_edge, EdgeBrowser};
#[cfg(windows)]
pub use process::open_https_url;
#[cfg(windows)]
pub use sandbox::Win32Sandbox;
