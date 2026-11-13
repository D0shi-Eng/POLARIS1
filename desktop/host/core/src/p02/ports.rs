// منافذ المنصّة: مخزن بيانات الاعتماد، ونافذة إدخالها، والبيئة.
//
// النواة لا تعرف Windows. طبقة الربط تحقن مخزن Credential Manager ونافذة
// الإدخال الأصلية؛ الاختبار يحقن مخزنًا في الذاكرة. وخارج Windows لا مخزن،
// فيُعلن غير متاح بدل أن يُكتب السرّ في ملف.

use std::collections::HashMap;
use std::sync::Mutex;

use polaris_host_providers::SecretValue;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CredentialStoreError {
    Unavailable,
    Failed(String),
}

pub trait CredentialStore: Send + Sync {
    fn available(&self) -> bool;
    fn read(&self, target: &str) -> Result<Option<SecretValue>, CredentialStoreError>;
    fn write(&self, target: &str, secret: &SecretValue) -> Result<(), CredentialStoreError>;
    /// يعيد true إن وُجد سجل وحُذف.
    fn delete(&self, target: &str) -> Result<bool, CredentialStoreError>;
}

pub enum PromptOutcome {
    Entered(SecretValue),
    Cancelled,
    Unavailable,
}

/// نافذة إدخال يملكها المضيف. العارض لا يرى ما يُكتب فيها.
pub trait CredentialPrompt: Send + Sync {
    fn prompt(&self, provider_display_name: &str) -> PromptOutcome;
}

pub trait Environment: Send + Sync {
    fn var(&self, name: &str) -> Option<String>;
}

/// لا مخزن: الحالة الصادقة خارج Windows.
pub struct UnavailableCredentialStore;

impl CredentialStore for UnavailableCredentialStore {
    fn available(&self) -> bool {
        false
    }
    fn read(&self, _: &str) -> Result<Option<SecretValue>, CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }
    fn write(&self, _: &str, _: &SecretValue) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }
    fn delete(&self, _: &str) -> Result<bool, CredentialStoreError> {
        Err(CredentialStoreError::Unavailable)
    }
}

/// مخزن في الذاكرة للاختبار. لا يُستعمل في ثنائي المنتج.
#[derive(Default)]
pub struct MemoryCredentialStore {
    entries: Mutex<HashMap<String, String>>,
}

impl CredentialStore for MemoryCredentialStore {
    fn available(&self) -> bool {
        true
    }
    fn read(&self, target: &str) -> Result<Option<SecretValue>, CredentialStoreError> {
        let entries = self.entries.lock().map_err(|_| CredentialStoreError::Failed("poisoned".into()))?;
        Ok(entries.get(target).and_then(|v| SecretValue::new(v.clone())))
    }
    fn write(&self, target: &str, secret: &SecretValue) -> Result<(), CredentialStoreError> {
        let mut entries = self.entries.lock().map_err(|_| CredentialStoreError::Failed("poisoned".into()))?;
        entries.insert(target.to_string(), secret.expose().to_string());
        Ok(())
    }
    fn delete(&self, target: &str) -> Result<bool, CredentialStoreError> {
        let mut entries = self.entries.lock().map_err(|_| CredentialStoreError::Failed("poisoned".into()))?;
        Ok(entries.remove(target).is_some())
    }
}

/// لا نافذة إدخال: الحالة خارج Windows وفي الاختبار العام.
pub struct NoPrompt;

impl CredentialPrompt for NoPrompt {
    fn prompt(&self, _: &str) -> PromptOutcome {
        PromptOutcome::Unavailable
    }
}

/// نافذة اختبار تعيد قيمة ثابتة. للاختبار وحده.
pub struct FixedPrompt(pub Option<String>);

impl CredentialPrompt for FixedPrompt {
    fn prompt(&self, _: &str) -> PromptOutcome {
        match &self.0 {
            Some(value) => SecretValue::new(value.clone()).map(PromptOutcome::Entered).unwrap_or(PromptOutcome::Cancelled),
            None => PromptOutcome::Cancelled,
        }
    }
}

/// بيئة العملية الحقيقية.
pub struct ProcessEnvironment;

impl Environment for ProcessEnvironment {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|v| !v.trim().is_empty())
    }
}

/// بيئة ثابتة للاختبار.
#[derive(Default)]
pub struct MapEnvironment(pub HashMap<String, String>);

impl Environment for MapEnvironment {
    fn var(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}

/// بادئة أهداف الإنتاج في Credential Manager. كل هدف منتج يبدأ بها.
pub const PRODUCTION_TARGET_PREFIX: &str = "POLARIS/";
/// بادئة النطاقات المعزولة. لا هدف إنتاج يبدأ بها، فلا يتقاطع النطاقان.
pub const SCOPED_TARGET_PREFIX: &str = "POLARIS/scope/";

/// نطاق مشتق من مجلد البيانات المستبدَل (D-1/D-2، 2026-10-15). المخزن الحقيقي واحد لكل
/// مستخدم Windows، فمجلد بيانات منفصل لا يكفي وحده: تشغيل اختبار لمزوّد بالمعرّف نفسه
/// كان يقرأ مفتاح المالك أو يحذفه. النطاق بصمة للمسار، لا نصّ حرّ: لا يستطيع أي متغيّر
/// أن يسمّي نطاق الإنتاج، لأن نطاق الإنتاج هو غياب النطاق.
pub fn credential_scope_for(data_dir: &std::path::Path) -> String {
    use sha2::{Digest, Sha256};
    let absolute = std::path::absolute(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    let mut text = absolute.to_string_lossy().replace('/', "\\");
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        text = rest.to_string();
    }
    // Windows لا يفرّق بين حالات الأحرف في المسار، فالمسار نفسه يعطي النطاق نفسه.
    let normalized = text.trim_end_matches('\\').to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// الهدف المقابل داخل نطاق. الدالة كلّية: لا هدف يخرج منها بلا بادئة النطاق.
pub fn scoped_target(scope: &str, target: &str) -> String {
    let rest = target.strip_prefix(PRODUCTION_TARGET_PREFIX).unwrap_or(target);
    format!("{SCOPED_TARGET_PREFIX}{scope}/{rest}")
}

/// مخزن يغلّف المخزن الحقيقي ويحوّل كل هدف إلى نطاقه. التشغيل بمجلد بيانات مستبدَل يأخذ
/// هذا المخزن دائمًا، فلا يملك مسارًا إلى أهداف الإنتاج: لا قراءة ولا كتابة ولا حذف.
pub struct ScopedCredentialStore {
    inner: std::sync::Arc<dyn CredentialStore>,
    scope: String,
}

impl ScopedCredentialStore {
    pub fn new(inner: std::sync::Arc<dyn CredentialStore>, scope: String) -> Self {
        Self { inner, scope }
    }

    pub fn scope(&self) -> &str {
        &self.scope
    }
}

impl CredentialStore for ScopedCredentialStore {
    fn available(&self) -> bool {
        self.inner.available()
    }
    fn read(&self, target: &str) -> Result<Option<SecretValue>, CredentialStoreError> {
        self.inner.read(&scoped_target(&self.scope, target))
    }
    fn write(&self, target: &str, secret: &SecretValue) -> Result<(), CredentialStoreError> {
        self.inner.write(&scoped_target(&self.scope, target), secret)
    }
    fn delete(&self, target: &str) -> Result<bool, CredentialStoreError> {
        self.inner.delete(&scoped_target(&self.scope, target))
    }
}

#[cfg(test)]
mod scope_tests {
    use std::path::Path;
    use std::sync::Arc;

    use super::*;

    fn secret(text: &str) -> SecretValue {
        SecretValue::new(text.to_string()).unwrap()
    }

    #[test]
    fn a_scoped_store_never_reads_writes_or_deletes_a_production_target() {
        // مخزن واحد يقوم مقام Credential Manager: هو مشترك بين الإنتاج والاختبار فعلًا.
        let shared: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        let production_target = "POLARIS/provider/openai";
        shared.write(production_target, &secret("sk-owner-synthetic-111")).unwrap();
        let test = ScopedCredentialStore::new(shared.clone(), credential_scope_for(Path::new(r"D:\qa\data")));
        assert!(test.read(production_target).unwrap().is_none(), "the test scope read the production key");
        test.write(production_target, &secret("sk-test-synthetic-222")).unwrap();
        assert_eq!(shared.read(production_target).unwrap().unwrap().expose(), "sk-owner-synthetic-111");
        assert!(test.delete(production_target).unwrap());
        assert_eq!(shared.read(production_target).unwrap().unwrap().expose(), "sk-owner-synthetic-111");
    }

    #[test]
    fn the_same_provider_in_two_scopes_keeps_two_values() {
        let shared: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore::default());
        let a = ScopedCredentialStore::new(shared.clone(), credential_scope_for(Path::new(r"D:\qa\a")));
        let b = ScopedCredentialStore::new(shared.clone(), credential_scope_for(Path::new(r"D:\qa\b")));
        assert_ne!(a.scope(), b.scope());
        a.write("POLARIS/provider/groq", &secret("sk-a")).unwrap();
        b.write("POLARIS/provider/groq", &secret("sk-b")).unwrap();
        assert_eq!(a.read("POLARIS/provider/groq").unwrap().unwrap().expose(), "sk-a");
        assert!(b.delete("POLARIS/provider/groq").unwrap());
        assert_eq!(a.read("POLARIS/provider/groq").unwrap().unwrap().expose(), "sk-a");
        assert!(b.read("POLARIS/provider/groq").unwrap().is_none());
    }

    #[test]
    fn the_scope_is_stable_for_one_folder_across_restarts_and_spellings() {
        let one = credential_scope_for(Path::new(r"D:\QA\Data"));
        assert_eq!(one, credential_scope_for(Path::new(r"d:\qa\data\")));
        assert_eq!(one, credential_scope_for(Path::new(r"D:/qa/data")));
        assert_eq!(one.len(), 16);
        assert!(one.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn every_scoped_target_carries_the_scope_prefix() {
        for target in ["POLARIS/provider/x", "POLARIS/connector/y", "anything", "", "POLARIS/scope/zz/provider/x"] {
            let mapped = scoped_target("0123456789abcdef", target);
            assert!(mapped.starts_with("POLARIS/scope/0123456789abcdef/"), "{target} -> {mapped}");
            assert_ne!(mapped, target);
        }
    }
}
