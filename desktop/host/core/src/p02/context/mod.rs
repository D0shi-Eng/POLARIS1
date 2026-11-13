// أساس محرك السياق: مصادر مسجّلة، وقراءة محدودة، وتجميع حتمي بمصدر لكل عنصر.
//
// ليس RAG: لا فهرسة متجهية، ولا فهرسة خفية لقرص كامل. المستخدم يسمّي المصادر،
// والمضيف يقرأ منها ما تسمح به الميزانية، ويقول لماذا أدرج كل عنصر ولماذا أسقط غيره.

pub mod assembler;
pub mod classify;
pub mod model;
pub mod paths;
pub mod preview;
pub mod prompt;
pub mod reader;
pub mod sources;

pub use assembler::{Assembler, Bundle, BundleRequest};
pub use model::{ContentClass, ContextSource, SourceAvailability, SourceType, TrustClass};
pub use sources::SourceService;
