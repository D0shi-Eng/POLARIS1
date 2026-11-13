// Phase-05: الذاكرة، واستعمال المتصفّح، واستعمال الحاسوب.
//
// يُبنى فوق Phase-03 (المهمّة والوكيل وطبقة الحقيقة) وPhase-04 (المهارات وبوابة
// الأدوات) ولا يعيد تصميم أيٍّ منهما. القواعد الحاكمة: الذاكرة ليست حقيقة، ومحتوى
// الويب غير موثوق، وملاحظة الشاشة ليست تعليمة مستخدم، والمتصفّح والحاسوب لا يبلغان
// أثرًا إلا عبر بوابة الأدوات ونقطة قرارها.

pub mod browser;
pub mod computer;
pub mod hooks;
pub mod ipc;
pub mod memory;
pub mod secret;
pub mod service;
pub mod session;
pub mod skill;
pub mod tooling;
pub mod view;

pub use service::{Phase05, Phase05Config};
