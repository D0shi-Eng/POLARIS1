// طبقة الحدّ: الظرف، والهوية، والبوابة، والأخطاء.
//
// كل ما في هذه الطبقة موجود لسبب واحد: أن يكون العارض غير موثوق فعلًا لا قولًا.

pub mod envelope;
pub mod errors;
pub mod gateway;
pub mod identity;

pub use errors::{DesktopErrorCategory, HostError};
pub use gateway::{Gateway, GatewayOutcome};
pub use identity::TransportIdentity;
