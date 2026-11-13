// طبقة المزوّدين لـPOLARIS Phase-02.
//
// لماذا صندوق مستقل عن النواة: هنا فقط تُسمّى المزوّدات وتُكتب بروتوكولاتها.
// النواة تتعامل مع واصفات وسمات عامة، فلا يدخلها اسم مزوّد ولا اسم نموذج، ويبقى
// فحص Phase-01 «لا اسم نموذج مكتوب في المنتج» صادقًا على نطاقه كما هو.
//
// ما يملكه هذا الصندوق: نموذج المجال (واصف، صحة، نموذج مكتشف، رسائل)، وسياسة
// نقاط النهاية (حلقة محلية أو خروج بعيد)، وعميل HTTP/1.1 صغير قابل للإلغاء،
// والمحوّلات، وتطبيع الأخطاء، ونوع القيمة السرية الذي لا يُسلسَل.

#![forbid(unsafe_code)]
#![deny(clippy::all)]

pub mod adapters;
pub mod catalog;
pub mod domain;
pub mod error;
pub mod installation;
pub mod net;
pub mod redact;
pub mod secret;

pub use adapters::{adapter_for, CallContext, ProviderAdapter};
pub use catalog::{builtin_descriptors, descriptor, ProviderDescriptor};
pub use error::{ProviderError, ProviderErrorCode};
pub use secret::SecretValue;
