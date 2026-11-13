// مستوى التحكّم في الإعدادات (Phase-06): إعدادات مُصنَّفة، وطبقات، وقيم فعلية بمصادرها.
//
// الافتراضي ← المستخدم ← المشروع ← المهمّة ← حدّ الأمان. العارض يعرض ويحرّر، والنواة
// تتحقق وتحلّ وتقصّ وتحفظ. ولا طبقة أدنى توسّع ما يحمل أمنًا.

pub mod model;
pub mod registry;
pub mod resolver;
pub mod service;
pub mod store;

pub use model::{Layer, Section, SettingKind, SettingValue, ValueRefusal, ValueSource};
pub use resolver::{ConfigScope, ResolvedValue};
pub use service::{ConfigService, ConfigState, ConfigWriteError};
