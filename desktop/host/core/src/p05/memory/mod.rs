// الذاكرة: نموذج، وسياسة، ومخزن، واسترجاع، وكتلة سياق، وخدمة.
//
// الذاكرة ليست مرساة ثقة. كل ما هنا يُحفظ بمنشئه وتحقّقه وتلوّثه، ويُسترجَع بيانات
// غير موثوقة، ولا يُحقّق ادّعاءً ولا يغيّر سياسة ولا نموذجًا ولا مزوّدًا.

pub mod analyzer;
pub mod bm25;
pub mod context;
pub mod embedding;
pub mod fusion;
pub mod model;
pub mod policy;
pub mod retriever;
pub mod service;
pub mod stem_en;
pub mod store;
pub mod tool;

pub use model::{MemoryCandidateV1, MemoryDecision, MemoryEntry};
pub use service::MemoryService;
