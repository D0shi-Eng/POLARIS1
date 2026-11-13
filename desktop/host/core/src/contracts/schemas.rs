// تحميل مخططات JSON Schema وتجميعها مرة واحدة.
//
// المراجع بين الملفات نسبية كما هي على القرص (`./common/ids.schema.json`)، فتُسجَّل
// كل وثيقة تحت عنوان قاعدة يحاكي شجرة الملفات، وتُحلّ المراجع كما كُتبت دون تعديل
// أي `$ref`. تعديل مرجعٍ لجعله يعمل هنا يعني أن المضيف يتحقق من مخطط آخر غير الذي
// يتحقق منه العارض، وهذا بالضبط ما لا يجوز.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use boon::{Compiler, SchemaIndex, Schemas};
use serde_json::Value;

/// عنوان القاعدة الوهمي. لا يُجلب من الشبكة أبدًا؛ كل وثيقة مُسجَّلة سلفًا.
const BASE: &str = "polaris:/schemas/";

/// الملفات المضمَّنة: الإغلاق الكامل لمراجع سطح المكتب والظرف.
/// الترتيب مُثبَّت حتى يكون التسجيل حتميًا.
pub const EMBEDDED_SCHEMAS: &[(&str, &str)] = &[
    (
        "common/caller-identity.schema.json",
        include_str!("../../../../../contracts/schemas/common/caller-identity.schema.json"),
    ),
    (
        "common/effect.schema.json",
        include_str!("../../../../../contracts/schemas/common/effect.schema.json"),
    ),
    (
        "common/error.schema.json",
        include_str!("../../../../../contracts/schemas/common/error.schema.json"),
    ),
    (
        "common/execution.schema.json",
        include_str!("../../../../../contracts/schemas/common/execution.schema.json"),
    ),
    (
        "common/idempotency.schema.json",
        include_str!("../../../../../contracts/schemas/common/idempotency.schema.json"),
    ),
    (
        "common/ids.schema.json",
        include_str!("../../../../../contracts/schemas/common/ids.schema.json"),
    ),
    (
        "common/provenance.schema.json",
        include_str!("../../../../../contracts/schemas/common/provenance.schema.json"),
    ),
    (
        "desktop-availability.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-availability.schema.json"),
    ),
    (
        "desktop-bootstrap.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-bootstrap.schema.json"),
    ),
    (
        "desktop-error-mapping.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-error-mapping.v1.schema.json"),
    ),
    (
        "desktop-ipc-registry.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-ipc-registry.v1.schema.json"),
    ),
    (
        "desktop-operation.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-operation.schema.json"),
    ),
    (
        "desktop-p02-domain.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p02-domain.schema.json"),
    ),
    (
        "desktop-p02-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p02-request.v1.schema.json"),
    ),
    (
        "desktop-p02-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p02-result.v1.schema.json"),
    ),
    (
        "desktop-p03-domain.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p03-domain.schema.json"),
    ),
    (
        "desktop-p03-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p03-request.v1.schema.json"),
    ),
    (
        "desktop-p03-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p03-result.v1.schema.json"),
    ),
    (
        "desktop-p04-domain.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p04-domain.schema.json"),
    ),
    (
        "desktop-p04-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p04-request.v1.schema.json"),
    ),
    (
        "desktop-p04-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p04-result.v1.schema.json"),
    ),
    (
        "desktop-p05-domain.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p05-domain.schema.json"),
    ),
    (
        "desktop-p05-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p05-request.v1.schema.json"),
    ),
    (
        "desktop-p05-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p05-result.v1.schema.json"),
    ),
    (
        "desktop-p06-domain.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p06-domain.schema.json"),
    ),
    (
        "desktop-p06-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p06-request.v1.schema.json"),
    ),
    (
        "desktop-p06-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p06-result.v1.schema.json"),
    ),
    (
        "desktop-p08-domain.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p08-domain.schema.json"),
    ),
    (
        "desktop-p08-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p08-request.v1.schema.json"),
    ),
    (
        "desktop-p08-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-p08-result.v1.schema.json"),
    ),
    (
        "desktop-request.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-request.v1.schema.json"),
    ),
    (
        "desktop-result.v1.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-result.v1.schema.json"),
    ),
    (
        "desktop-settings.schema.json",
        include_str!("../../../../../contracts/schemas/desktop-settings.schema.json"),
    ),
    (
        "ipc-envelope.v1.schema.json",
        include_str!("../../../../../contracts/schemas/ipc-envelope.v1.schema.json"),
    ),
];

/// خطأ تحقق واحد: أين وقع، وماذا قال المخطط.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaValidationError {
    pub pointer: String,
    pub detail: String,
}

/// مجموعة المخططات المُجمَّعة. تُبنى مرة واحدة لكل عملية تشغيل.
pub struct SchemaSet {
    schemas: Schemas,
    indexes: BTreeMap<String, SchemaIndex>,
}

/// المراجع التي يحتاج المضيف تجميعها. المفتاح هو ما يظهر في السجل.
const COMPILED_REFERENCES: &[&str] = &[
    "ipc-envelope.v1.schema.json",
    "ipc-envelope.v1.schema.json#/$defs/RequestEnvelope",
    "ipc-envelope.v1.schema.json#/$defs/ResponseEnvelope",
    "desktop-ipc-registry.v1.schema.json",
    "desktop-error-mapping.v1.schema.json",
    "desktop-request.v1.schema.json#/$defs/DesktopBootstrapRequestV1",
    "desktop-request.v1.schema.json#/$defs/DesktopRuntimeStatusRequestV1",
    "desktop-request.v1.schema.json#/$defs/DesktopCapabilityAvailabilityRequestV1",
    "desktop-request.v1.schema.json#/$defs/DesktopSettingsDescribeRequestV1",
    "desktop-request.v1.schema.json#/$defs/DesktopSettingsReadRequestV1",
    "desktop-result.v1.schema.json#/$defs/DesktopBootstrapResultV1",
    "desktop-result.v1.schema.json#/$defs/DesktopRuntimeStatusResultV1",
    "desktop-result.v1.schema.json#/$defs/DesktopCapabilityAvailabilityResultV1",
    "desktop-result.v1.schema.json#/$defs/DesktopSettingsDescribeResultV1",
    "desktop-result.v1.schema.json#/$defs/DesktopSettingsReadResultV1",
];

impl SchemaSet {
    /// يبني المجموعة. الفشل هنا عيب بناء لا حالة تشغيل: مخطط لا يُجمَّع يعني أن
    /// المضيف لا يعرف ما الذي يقبله، والاستمرار بنصف معرفة أسوأ من التوقف.
    pub fn build() -> Result<Self, String> {
        let mut compiler = Compiler::new();
        compiler.set_default_draft(boon::Draft::V2020_12);

        for (name, body) in EMBEDDED_SCHEMAS {
            let value: Value = serde_json::from_str(body)
                .map_err(|e| format!("embedded schema {name} is not valid JSON: {e}"))?;
            compiler
                .add_resource(&format!("{BASE}{name}"), value)
                .map_err(|e| format!("embedded schema {name} could not be registered: {e}"))?;
        }

        let mut schemas = Schemas::new();
        let mut indexes = BTreeMap::new();
        // مراجع Phase-02 وPhase-03 تُقرأ من سجلّيهما المضمَّنين أنفسهما، فلا قائمة
        // ثانية تنجرف عنهما.
        let mut references: Vec<String> = COMPILED_REFERENCES.iter().map(|r| r.to_string()).collect();
        for (phase, json) in [
            ("phase-02", super::registry::PHASE02_IPC_REGISTRY_JSON),
            ("phase-03", super::registry::PHASE03_IPC_REGISTRY_JSON),
            ("phase-04", super::registry::PHASE04_IPC_REGISTRY_JSON),
            ("phase-05", super::registry::PHASE05_IPC_REGISTRY_JSON),
            ("phase-06", super::registry::PHASE06_IPC_REGISTRY_JSON),
            ("phase-08", super::registry::PHASE08_IPC_REGISTRY_JSON),
        ] {
            let document: Value = serde_json::from_str(json)
                .map_err(|e| format!("{phase} registry is not valid JSON: {e}"))?;
            for record in document.get("operations").and_then(Value::as_array).into_iter().flatten() {
                for field in ["request_schema", "response_schema"] {
                    if let Some(reference) = record.get(field).and_then(Value::as_str) {
                        if !references.iter().any(|r| r == reference) {
                            references.push(reference.to_string());
                        }
                    }
                }
            }
        }
        for reference in &references {
            let url = format!("{BASE}{reference}");
            let index = compiler
                .compile(&url, &mut schemas)
                .map_err(|e| format!("schema reference {reference} failed to compile: {e}"))?;
            indexes.insert(reference.clone(), index);
        }

        Ok(Self { schemas, indexes })
    }

    /// المجموعة المشتركة لعملية التشغيل.
    pub fn shared() -> &'static SchemaSet {
        static SHARED: OnceLock<SchemaSet> = OnceLock::new();
        SHARED.get_or_init(|| SchemaSet::build().expect("embedded contract schemas must compile"))
    }

    /// هل هذا المرجع مُجمَّع؟ يُستعمل في اختبار الاتساق مع السجل.
    pub fn knows(&self, reference: &str) -> bool {
        self.indexes.contains_key(reference)
    }

    /// يتحقق من قيمة مقابل مرجع مخطط مُسمّى.
    pub fn validate(&self, reference: &str, value: &Value) -> Result<(), Vec<SchemaValidationError>> {
        let Some(index) = self.indexes.get(reference) else {
            return Err(vec![SchemaValidationError {
                pointer: String::new(),
                detail: format!("schema reference {reference} is not compiled"),
            }]);
        };

        match self.schemas.validate(value, *index) {
            Ok(()) => Ok(()),
            Err(error) => {
                let mut collected = Vec::new();
                collect(&error, &mut collected);
                if collected.is_empty() {
                    collected.push(SchemaValidationError {
                        pointer: String::new(),
                        detail: "schema validation failed".to_string(),
                    });
                }
                Err(collected)
            }
        }
    }
}

/// يسطّح شجرة أخطاء boon إلى قائمة مسطّحة من (مؤشر، تفصيل).
fn collect(error: &boon::ValidationError, into: &mut Vec<SchemaValidationError>) {
    let pointer = error.instance_location.to_string();
    into.push(SchemaValidationError {
        pointer: if pointer.is_empty() { "/".to_string() } else { pointer },
        detail: error.kind.to_string(),
    });
    for cause in &error.causes {
        collect(cause, into);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_embedded_schema_compiles() {
        SchemaSet::build().expect("schemas compile");
    }

    #[test]
    fn embedded_set_is_sorted_and_unique() {
        let names: Vec<&str> = EMBEDDED_SCHEMAS.iter().map(|(n, _)| *n).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(names, sorted, "embedded schema list must be sorted and unique");
    }
}
