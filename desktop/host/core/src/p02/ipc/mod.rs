// طبقة IPC لـPhase-02: تحويل الحمولة المُتحقَّق منها إلى نداء خدمة، والنتيجة إلى JSON.
//
// هذه الطبقة لا تملك قاعدة عمل. البوابة تحقّقت من الحمولة مقابل مخططها قبل الوصول
// إلى هنا؛ القراءة هنا دفاعية فقط، وأي غياب غير متوقع خطأ تحقق لا افتراض.

pub mod context_ops;
pub mod idempotency;
pub mod input;
pub mod model_ops;
pub mod project_ops;
pub mod provider_ops;

use serde_json::Value;

use crate::ipc::errors::HostError;
use crate::p02::Phase02;

/// العمليات التي يملكها Phase-02، بالاسم الكامل. مغلقة ومطابقة للسجل.
pub const OPERATIONS: [&str; 19] = [
    "provider.list",
    "provider.configure",
    "provider.credential.set",
    "provider.credential.clear",
    "provider.refresh",
    "model.list",
    "model.configure",
    "model.preferences.set",
    "model.invoke",
    "model.cancel",
    "project.list",
    "project.get",
    "project.create",
    "project.update",
    "project.archive",
    "context.add",
    "context.remove",
    "context.preview",
    "context.assemble",
];

/// عمليات المزوّدين التي أُضيفت في الظرف 1.7 (ADR-037): مسجّلة في سجلّ Phase-08 كما سُجّلت `project.delete`، ومالكها
/// طبقة المزوّدين هنا. الموجّه يرسلها إلى هذا المعالج.
pub const CATALOG_OPERATIONS: [&str; 4] = ["provider.catalog", "provider.credential.put", "provider.custom.save", "provider.custom.delete"];

/// ينفّذ عملية Phase-02 مسمّاة. المطابقة شاملة: لا فرع «أي شيء آخر» بمنطق عام.
pub fn handle(p02: &Phase02, operation: &str, payload: &Value, session: &str) -> Result<Value, HostError> {
    match operation {
        "provider.list" => provider_ops::list(p02),
        "provider.configure" => provider_ops::configure(p02, payload),
        "provider.credential.set" => provider_ops::credential_set(p02, payload),
        "provider.credential.clear" => provider_ops::credential_clear(p02, payload),
        "provider.catalog" => provider_ops::catalog(p02),
        "provider.credential.put" => provider_ops::credential_put(p02, payload),
        "provider.custom.save" => provider_ops::custom_save(p02, payload),
        "provider.custom.delete" => provider_ops::custom_delete(p02, payload),
        "provider.refresh" => provider_ops::refresh(p02, payload),
        "model.list" => model_ops::list(p02, payload),
        "model.configure" => model_ops::configure(p02, payload),
        "model.preferences.set" => model_ops::set_preferences(p02, payload),
        "model.invoke" => model_ops::invoke(p02, payload, session),
        "model.cancel" => model_ops::cancel(p02, payload, session),
        "project.list" => project_ops::list(p02, payload),
        "project.get" => project_ops::get(p02, payload),
        "project.create" => project_ops::create(p02, payload),
        "project.update" => project_ops::update(p02, payload),
        "project.archive" => project_ops::archive(p02, payload),
        "context.add" => context_ops::add(p02, payload),
        "context.remove" => context_ops::remove(p02, payload),
        "context.preview" => context_ops::preview(p02, payload),
        "context.assemble" => context_ops::assemble(p02, payload),
        other => Err(HostError::internal(format!("routed operation {other} has no Phase-02 owner"))),
    }
}

/// يسلسل نتيجة خدمة. الفشل هنا عيب داخلي.
pub fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, HostError> {
    serde_json::to_value(value).map_err(|e| HostError::internal(format!("result serialisation failed: {e}")))
}
