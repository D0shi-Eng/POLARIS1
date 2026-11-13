// رؤية المضيف للعقود.
//
// المخططات ووثائق السجل تُضمَّن وقت الترجمة من `contracts/` نفسها، لا تُنسخ.
// نسخة ثانية على القرص تنجرف بصمت؛ التضمين يجعل الانحراف خطأ ترجمة، ويجعل
// الثنائي يحمل البايتات نفسها التي راجعها أحد.

pub mod registry;
pub mod schemas;

pub use registry::{DesktopIpcRegistry, DesktopOperationRecord, ErrorMapping, ErrorMappingEntry, RegistrySet};
pub use schemas::{SchemaSet, SchemaValidationError};
