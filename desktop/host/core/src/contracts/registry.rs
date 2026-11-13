// سجل عمليات IPC وخريطة الأخطاء، مقروءين من وثيقتَي البيانات نفسِهما اللتين
// يقرأهما العارض.
//
// السجل هو ما تُبنى منه البوابة، لا وصفٌ ثانٍ لها. وأهمّ ما فيه `routing_status`:
// صحة المخطط ليست إذنًا بالتوجيه. عملية معروفة للمخطط وغير موجَّهة تُرفض، وبلا هذا
// الفصل يصير «عضو enum صالح» مساويًا لـ«مأذون».

use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;

use super::schemas::SchemaSet;

/// وثيقة السجل كما هي على القرص، مضمَّنة وقت الترجمة.
pub const IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-01-ipc.registry.json");

/// سجل Phase-02. ملف منفصل: سجل Phase-01 لا يُحرَّر (ADR-019).
pub const PHASE02_IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-02-ipc.registry.json");

/// سجل Phase-03. ملف ثالث منفصل للسبب نفسه: سجلّا Phase-01 وPhase-02 لا يُحرَّران (ADR-021).
pub const PHASE03_IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-03-ipc.registry.json");

/// سجل Phase-04. ملف رابع منفصل للسبب نفسه (ADR-023).
pub const PHASE04_IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-04-ipc.registry.json");

/// سجل Phase-05. ملف خامس منفصل للسبب نفسه (ADR-025).
pub const PHASE05_IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-05-ipc.registry.json");

/// سجل Phase-06. ملف سادس منفصل للسبب نفسه (ADR-026).
pub const PHASE06_IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-06-ipc.registry.json");

/// سجل Phase-08. ملف سابع منفصل للسبب نفسه (ADR-028). Phase-07 لم يضف عمليات IPC.
pub const PHASE08_IPC_REGISTRY_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-08-ipc.registry.json");

/// وثيقة خريطة الأخطاء.
pub const ERROR_MAPPING_JSON: &str =
    include_str!("../../../../../contracts/registry/phase-01-error-mapping.json");

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DesktopOperationRecord {
    pub operation: String,
    pub envelope_version: String,
    pub request_schema: String,
    pub response_schema: String,
    pub owner: String,
    pub effect: String,
    /// صنف الأثر الأدق. إلزامي في سجلات Phase-02، وغائب في سجلات Phase-01.
    #[serde(default)]
    pub effect_class: Option<String>,
    pub idempotency: String,
    pub trust_boundary: String,
    pub caller_class: String,
    pub caller_identity_authority: String,
    pub error_categories: Vec<String>,
    pub availability: RecordAvailability,
    pub routing_status: String,
    pub phase_introduced: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct RecordAvailability {
    pub state: String,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DesktopIpcRegistry {
    pub contract_version: String,
    pub phase: String,
    pub envelope_contract: String,
    pub implementation_status: String,
    pub operations: Vec<DesktopOperationRecord>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ErrorMappingEntry {
    pub category: String,
    pub canonical_codes: Vec<String>,
    pub retryable: bool,
    pub detail_may_cross_boundary: bool,
    pub default_redaction: String,
    pub display_key: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ErrorMapping {
    pub contract_version: String,
    pub phase: String,
    pub entries: Vec<ErrorMappingEntry>,
}

impl DesktopIpcRegistry {
    /// السجل المُتحقَّق منه لعملية التشغيل. الفشل عيب بناء لا حالة تشغيل.
    pub fn shared() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load().expect("embedded desktop IPC registry must be valid")
        })
    }

    pub fn load() -> Result<Self, String> {
        Self::load_from(IPC_REGISTRY_JSON)
    }

    /// سجل Phase-02 المُتحقَّق منه.
    pub fn phase02() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load_from(PHASE02_IPC_REGISTRY_JSON).expect("embedded phase-02 IPC registry must be valid")
        })
    }

    /// سجل Phase-03 المُتحقَّق منه.
    pub fn phase03() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load_from(PHASE03_IPC_REGISTRY_JSON).expect("embedded phase-03 IPC registry must be valid")
        })
    }

    /// سجل Phase-04 المُتحقَّق منه.
    pub fn phase04() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load_from(PHASE04_IPC_REGISTRY_JSON).expect("embedded phase-04 IPC registry must be valid")
        })
    }

    /// سجل Phase-05 المُتحقَّق منه.
    pub fn phase05() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load_from(PHASE05_IPC_REGISTRY_JSON).expect("embedded phase-05 IPC registry must be valid")
        })
    }

    /// سجل Phase-06 المُتحقَّق منه.
    pub fn phase06() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load_from(PHASE06_IPC_REGISTRY_JSON).expect("embedded phase-06 IPC registry must be valid")
        })
    }

    /// سجل Phase-08 المُتحقَّق منه.
    pub fn phase08() -> &'static DesktopIpcRegistry {
        static SHARED: OnceLock<DesktopIpcRegistry> = OnceLock::new();
        SHARED.get_or_init(|| {
            DesktopIpcRegistry::load_from(PHASE08_IPC_REGISTRY_JSON).expect("embedded phase-08 IPC registry must be valid")
        })
    }

    pub fn load_from(text: &str) -> Result<Self, String> {
        let value: Value = serde_json::from_str(text)
            .map_err(|e| format!("IPC registry is not valid JSON: {e}"))?;
        SchemaSet::shared()
            .validate("desktop-ipc-registry.v1.schema.json", &value)
            .map_err(|errors| {
                format!(
                    "IPC registry does not satisfy its schema: {}",
                    errors
                        .iter()
                        .map(|e| format!("{} {}", e.pointer, e.detail))
                        .collect::<Vec<_>>()
                        .join("; ")
                )
            })?;
        serde_json::from_value(value).map_err(|e| format!("IPC registry shape mismatch: {e}"))
    }

    /// سجل عملية واحدة، أو لا شيء إن لم تكن مسجَّلة أصلًا.
    pub fn record(&self, operation: &str) -> Option<&DesktopOperationRecord> {
        self.operations.iter().find(|r| r.operation == operation)
    }

    /// هل تُوجَّه هذه العملية فعلًا؟ ثلاث حالات مختلفة تُختزل عمدًا إلى «لا» واحدة
    /// عند الحدّ: غير معروفة، ومعروفة غير مسجَّلة، ومسجَّلة غير موجَّهة.
    pub fn is_routed(&self, operation: &str) -> bool {
        self.record(operation)
            .is_some_and(|r| r.routing_status == "ROUTED")
    }

    /// أسماء العمليات الموجَّهة، بترتيب السجل.
    pub fn routed_operations(&self) -> Vec<&str> {
        self.operations
            .iter()
            .filter(|r| r.routing_status == "ROUTED")
            .map(|r| r.operation.as_str())
            .collect()
    }
}

/// كل السجلات التي يوجّه منها المضيف: Phase-01 ثم Phase-02 ثم Phase-03 ثم Phase-04 ثم
/// Phase-05 ثم Phase-06 ثم Phase-08. البحث بالاسم الكامل وحده، ولا تصنيف ببادئة.
pub struct RegistrySet;

impl RegistrySet {
    pub fn all() -> [&'static DesktopIpcRegistry; 7] {
        [
            DesktopIpcRegistry::shared(),
            DesktopIpcRegistry::phase02(),
            DesktopIpcRegistry::phase03(),
            DesktopIpcRegistry::phase04(),
            DesktopIpcRegistry::phase05(),
            DesktopIpcRegistry::phase06(),
            DesktopIpcRegistry::phase08(),
        ]
    }

    pub fn record(operation: &str) -> Option<&'static DesktopOperationRecord> {
        Self::all().into_iter().find_map(|r| r.record(operation))
    }

    pub fn is_routed(operation: &str) -> bool {
        Self::record(operation).is_some_and(|r| r.routing_status == "ROUTED")
    }

    pub fn records() -> impl Iterator<Item = &'static DesktopOperationRecord> {
        Self::all().into_iter().flat_map(|r| r.operations.iter())
    }
}

impl ErrorMapping {
    pub fn shared() -> &'static ErrorMapping {
        static SHARED: OnceLock<ErrorMapping> = OnceLock::new();
        SHARED.get_or_init(|| ErrorMapping::load().expect("embedded error mapping must be valid"))
    }

    pub fn load() -> Result<Self, String> {
        let value: Value = serde_json::from_str(ERROR_MAPPING_JSON)
            .map_err(|e| format!("error mapping is not valid JSON: {e}"))?;
        SchemaSet::shared()
            .validate("desktop-error-mapping.v1.schema.json", &value)
            .map_err(|errors| {
                format!(
                    "error mapping does not satisfy its schema: {}",
                    errors
                        .iter()
                        .map(|e| format!("{} {}", e.pointer, e.detail))
                        .collect::<Vec<_>>()
                        .join("; ")
                )
            })?;
        serde_json::from_value(value).map_err(|e| format!("error mapping shape mismatch: {e}"))
    }

    pub fn entry(&self, category: &str) -> Option<&ErrorMappingEntry> {
        self.entries.iter().find(|e| e.category == category)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_loads_and_declares_five_routed_operations() {
        let registry = DesktopIpcRegistry::shared();
        assert_eq!(registry.envelope_contract, "IPCEnvelopeV1");
        assert_eq!(registry.operations.len(), 5);
        assert_eq!(registry.routed_operations().len(), 5);
    }

    #[test]
    fn the_phase02_registry_declares_nineteen_routed_operations_with_effect_classes() {
        let registry = DesktopIpcRegistry::phase02();
        assert_eq!(registry.phase, "PHASE-02");
        assert_eq!(registry.routed_operations().len(), 19);
        for record in &registry.operations {
            assert!(record.effect_class.is_some(), "{} has no effect class", record.operation);
            assert_eq!(record.envelope_version, "1.2");
            assert_eq!(record.idempotency == "REQUIRED", record.effect == "SIDE_EFFECTING");
        }
        assert!(RegistrySet::is_routed("model.invoke"));
        assert!(RegistrySet::is_routed("desktop.bootstrap"));
        assert!(!RegistrySet::is_routed("system.ping"));
        assert!(!RegistrySet::is_routed("model.call"));
    }

    #[test]
    fn the_phase04_registry_declares_twelve_routed_operations_with_effect_classes() {
        let registry = DesktopIpcRegistry::phase04();
        assert_eq!(registry.phase, "PHASE-04");
        assert_eq!(registry.routed_operations().len(), 12);
        for record in &registry.operations {
            assert!(record.effect_class.is_some(), "{} has no effect class", record.operation);
            assert_eq!(record.envelope_version, "1.4");
            assert_eq!(record.idempotency == "REQUIRED", record.effect == "SIDE_EFFECTING");
        }
        assert!(RegistrySet::is_routed("tool.list"));
        assert!(RegistrySet::is_routed("mission.start"));
        // ولا مسار تنفيذ أداة في أي سجل.
        for forbidden in ["tool.execute", "tool.invoke", "mcp.call", "skill.execute"] {
            assert!(!RegistrySet::is_routed(forbidden), "{forbidden} is routed");
            assert!(RegistrySet::record(forbidden).is_none(), "{forbidden} has a record");
        }
    }

    #[test]
    fn the_phase05_registry_declares_twelve_routed_operations_and_no_action_path() {
        let registry = DesktopIpcRegistry::phase05();
        assert_eq!(registry.phase, "PHASE-05");
        assert_eq!(registry.routed_operations().len(), 12);
        for record in &registry.operations {
            assert!(record.effect_class.is_some(), "{} has no effect class", record.operation);
            assert_eq!(record.envelope_version, "1.5");
            assert_eq!(record.idempotency == "REQUIRED", record.effect == "SIDE_EFFECTING");
        }
        assert!(RegistrySet::is_routed("memory.list"));
        assert!(RegistrySet::is_routed("computer.target.grant"));
        for forbidden in ["browser.raw_execute", "computer.raw_command", "memory.trust", "browser.navigate", "computer.click"] {
            assert!(!RegistrySet::is_routed(forbidden), "{forbidden} is routed");
            assert!(RegistrySet::record(forbidden).is_none(), "{forbidden} has a record");
        }
    }

    #[test]
    fn every_phase02_schema_reference_is_compiled() {
        let schemas = SchemaSet::shared();
        for record in RegistrySet::records() {
            assert!(schemas.knows(&record.request_schema), "{}", record.request_schema);
            assert!(schemas.knows(&record.response_schema), "{}", record.response_schema);
        }
    }

    #[test]
    fn every_registered_schema_reference_is_compiled() {
        let schemas = SchemaSet::shared();
        for record in &DesktopIpcRegistry::shared().operations {
            assert!(
                schemas.knows(&record.request_schema),
                "request schema {} is not compiled",
                record.request_schema
            );
            assert!(
                schemas.knows(&record.response_schema),
                "response schema {} is not compiled",
                record.response_schema
            );
        }
    }

    #[test]
    fn every_registered_error_category_has_a_mapping_entry() {
        let mapping = ErrorMapping::shared();
        for record in &DesktopIpcRegistry::shared().operations {
            for category in &record.error_categories {
                assert!(
                    mapping.entry(category).is_some(),
                    "category {category} has no mapping entry"
                );
            }
        }
    }

    #[test]
    fn no_mapping_entry_lets_internal_detail_cross_the_boundary() {
        for entry in &ErrorMapping::shared().entries {
            assert!(
                !entry.detail_may_cross_boundary,
                "category {} would leak internal detail",
                entry.category
            );
        }
    }
}
