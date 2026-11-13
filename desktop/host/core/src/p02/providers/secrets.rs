// وسيط الأسرار: يحلّ مفتاح المزوّد عند الحاجة، ويُدخله ويحذفه، ولا يعيده أبدًا.
//
// المصادر بالترتيب: مخزن بيانات الاعتماد، ثم متغيّر البيئة الرسمي. القيمة تُعطى
// للمحوّل لبناء ترويسة ثم تُسقط؛ ما يخرج من هنا إلى الحدّ هو حالة لا قيمة.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use polaris_host_providers::catalog::ProviderDescriptor;
use polaris_host_providers::domain::AuthMode;
use polaris_host_providers::secret::{credential_target, secret_reference};
use polaris_host_providers::SecretValue;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::errors::P02Error;
use crate::p02::ports::{CredentialPrompt, CredentialStore, CredentialStoreError, Environment, PromptOutcome};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CredentialSource {
    None,
    CredentialStore,
    Environment,
}

/// حالة المفتاح كما تعبر الحدّ. لا حقل قيمة.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KeyStatus {
    pub required: bool,
    pub configured: bool,
    pub source: CredentialSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    pub store_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_variable: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CredentialOutcome {
    Stored,
    Cleared,
    PromptCancelled,
    StoreUnavailable,
    NotApplicable,
    NothingToClear,
}

/// هل يأخذ المزوّد مفتاحًا أصلًا؟ المطلوب والاختياري معًا.
fn takes_key(descriptor: &ProviderDescriptor) -> bool {
    matches!(descriptor.auth_mode, AuthMode::ApiKey | AuthMode::OptionalApiKey)
}

pub struct SecretBroker {
    store: Arc<dyn CredentialStore>,
    prompt: Arc<dyn CredentialPrompt>,
    environment: Arc<dyn Environment>,
    audit: Arc<AuditLedger>,
}

impl SecretBroker {
    pub fn new(store: Arc<dyn CredentialStore>, prompt: Arc<dyn CredentialPrompt>, environment: Arc<dyn Environment>, audit: Arc<AuditLedger>) -> Self {
        Self { store, prompt, environment, audit }
    }

    fn stored_key(&self, descriptor: &ProviderDescriptor) -> Option<SecretValue> {
        if !self.store.available() {
            return None;
        }
        self.store.read(&credential_target(&descriptor.id)).ok().flatten()
    }

    fn environment_key(&self, descriptor: &ProviderDescriptor) -> Option<SecretValue> {
        let var = descriptor.credential_env_var.as_deref()?;
        self.environment.var(var).and_then(SecretValue::new)
    }

    /// هل في متغيّر البيئة الرسمي قيمة؟ القيمة نفسها تُبنى وتُسقط هنا، ولا تخرج.
    pub fn environment_key_present(&self, descriptor: &ProviderDescriptor) -> bool {
        self.environment_key(descriptor).is_some()
    }

    /// المفتاح للنداء الحالي فقط. يُسقط بعد النداء.
    pub fn resolve(&self, descriptor: &ProviderDescriptor) -> Option<SecretValue> {
        if !takes_key(descriptor) {
            return None;
        }
        self.stored_key(descriptor).or_else(|| self.environment_key(descriptor))
    }

    pub fn status(&self, descriptor: &ProviderDescriptor) -> KeyStatus {
        let required = descriptor.auth_mode == AuthMode::ApiKey;
        let store_available = self.store.available();
        let environment_variable = descriptor.credential_env_var.clone();
        if !takes_key(descriptor) {
            return KeyStatus { required, configured: false, source: CredentialSource::None, reference: None, store_available, environment_variable };
        }
        let source = if self.stored_key(descriptor).is_some() {
            CredentialSource::CredentialStore
        } else if self.environment_key(descriptor).is_some() {
            CredentialSource::Environment
        } else {
            CredentialSource::None
        };
        let configured = source != CredentialSource::None;
        // المفتاح الاختياري (المخصّص) لا يُطلب، لكنه يُبلَّغ عنه مضبوطًا إن وُجد.
        KeyStatus {
            required,
            configured,
            source,
            reference: configured.then(|| secret_reference(&descriptor.id)),
            store_available,
            environment_variable,
        }
    }

    /// يفتح نافذة الإدخال الأصلية ويخزّن ما أُدخل. القيمة لا تمرّ بالعارض أبدًا.
    pub fn set(&self, descriptor: &ProviderDescriptor) -> Result<CredentialOutcome, P02Error> {
        if !takes_key(descriptor) {
            return Ok(CredentialOutcome::NotApplicable);
        }
        if !self.store.available() {
            return Ok(CredentialOutcome::StoreUnavailable);
        }
        let secret = match self.prompt.prompt(&descriptor.display_name) {
            PromptOutcome::Entered(secret) => secret,
            PromptOutcome::Cancelled => return Ok(CredentialOutcome::PromptCancelled),
            PromptOutcome::Unavailable => return Ok(CredentialOutcome::StoreUnavailable),
        };
        match self.store.write(&credential_target(&descriptor.id), &secret) {
            Ok(()) => {}
            Err(CredentialStoreError::Unavailable) => return Ok(CredentialOutcome::StoreUnavailable),
            Err(CredentialStoreError::Failed(detail)) => return Err(P02Error::Unavailable(format!("credential store write failed: {detail}"))),
        }
        drop(secret);
        self.audit.append(&AuditRecord::new(
            AuditEventType::ProviderCredentialSet,
            "provider",
            &descriptor.id,
            AuditOutcome::Success,
            json!({ "source": "CREDENTIAL_STORE" }),
        ))?;
        Ok(CredentialOutcome::Stored)
    }

    /// يخزّن مفتاحًا كتبه المستخدم في نافذة الاتصال داخل التطبيق (ADR-037، قرار المالك 2026-10-06). القيمة تصل من
    /// العارض مرة واحدة في حمولة هذه العملية وحدها، وتُكتب إلى مخزن بيانات الاعتماد، ثم تُسقط وتُصفَّر. لا تُعاد، ولا تُسجَّل،
    /// ولا تدخل التدقيق إلا مصدرُها.
    pub fn put(&self, descriptor: &ProviderDescriptor, secret: SecretValue) -> Result<CredentialOutcome, P02Error> {
        if !takes_key(descriptor) {
            return Ok(CredentialOutcome::NotApplicable);
        }
        if !self.store.available() {
            return Ok(CredentialOutcome::StoreUnavailable);
        }
        match self.store.write(&credential_target(&descriptor.id), &secret) {
            Ok(()) => {}
            Err(CredentialStoreError::Unavailable) => return Ok(CredentialOutcome::StoreUnavailable),
            Err(CredentialStoreError::Failed(detail)) => return Err(P02Error::Unavailable(format!("credential store write failed: {detail}"))),
        }
        drop(secret);
        self.audit.append(&AuditRecord::new(
            AuditEventType::ProviderCredentialSet,
            "provider",
            &descriptor.id,
            AuditOutcome::Success,
            json!({ "source": "CREDENTIAL_STORE", "entry": "IN_APP_FIELD" }),
        ))?;
        Ok(CredentialOutcome::Stored)
    }

    pub fn clear(&self, descriptor: &ProviderDescriptor) -> Result<CredentialOutcome, P02Error> {
        if !takes_key(descriptor) {
            return Ok(CredentialOutcome::NotApplicable);
        }
        if !self.store.available() {
            return Ok(CredentialOutcome::StoreUnavailable);
        }
        let removed = match self.store.delete(&credential_target(&descriptor.id)) {
            Ok(removed) => removed,
            Err(CredentialStoreError::Unavailable) => return Ok(CredentialOutcome::StoreUnavailable),
            Err(CredentialStoreError::Failed(detail)) => return Err(P02Error::Unavailable(format!("credential store delete failed: {detail}"))),
        };
        if !removed {
            return Ok(CredentialOutcome::NothingToClear);
        }
        self.audit.append(&AuditRecord::new(
            AuditEventType::ProviderCredentialCleared,
            "provider",
            &descriptor.id,
            AuditOutcome::Success,
            json!({ "source": "CREDENTIAL_STORE" }),
        ))?;
        Ok(CredentialOutcome::Cleared)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p02::ports::{FixedPrompt, MapEnvironment, MemoryCredentialStore, UnavailableCredentialStore};
    use crate::storage::Database;
    use polaris_host_providers::catalog::descriptor;

    const FAKE_KEY: &str = "sk-fixture-000000000000000000000000";

    fn broker(store: Arc<dyn CredentialStore>, prompt: Option<&str>, env: &[(&str, &str)]) -> (SecretBroker, Arc<AuditLedger>) {
        let audit = Arc::new(AuditLedger::new(Arc::new(Database::in_memory().unwrap())));
        let env = MapEnvironment(env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect());
        (SecretBroker::new(store, Arc::new(FixedPrompt(prompt.map(str::to_string))), Arc::new(env), audit.clone()), audit)
    }

    #[test]
    fn a_stored_key_is_reported_as_a_reference_only() {
        let (broker, audit) = broker(Arc::new(MemoryCredentialStore::default()), Some(FAKE_KEY), &[]);
        let openai = (*descriptor("openai").unwrap()).clone();
        assert!(!broker.status(&openai).configured);
        assert_eq!(broker.set(&openai).unwrap(), CredentialOutcome::Stored);
        let status = broker.status(&openai);
        assert!(status.configured);
        assert_eq!(status.source, CredentialSource::CredentialStore);
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains(FAKE_KEY));
        assert!(json.contains("secret://providers/openai/default"));
        assert!(!audit.all_detail_text().unwrap().contains(FAKE_KEY));
        assert_eq!(broker.resolve(&openai).unwrap().expose(), FAKE_KEY);
    }

    #[test]
    fn the_official_environment_variable_is_a_second_source() {
        let (broker, _) = broker(Arc::new(MemoryCredentialStore::default()), None, &[("ANTHROPIC_API_KEY", FAKE_KEY)]);
        let anthropic = (*descriptor("anthropic").unwrap()).clone();
        let status = broker.status(&anthropic);
        assert_eq!(status.source, CredentialSource::Environment);
        assert_eq!(status.environment_variable.as_deref(), Some("ANTHROPIC_API_KEY"));
        // متغيّر مزوّد آخر لا يُقرأ لهذا المزوّد.
        assert!(!broker.status(&(*descriptor("openai").unwrap()).clone()).configured);
    }

    #[test]
    fn a_cancelled_prompt_stores_nothing() {
        let (broker, _) = broker(Arc::new(MemoryCredentialStore::default()), None, &[]);
        let openai = (*descriptor("openai").unwrap()).clone();
        assert_eq!(broker.set(&openai).unwrap(), CredentialOutcome::PromptCancelled);
        assert!(!broker.status(&openai).configured);
    }

    #[test]
    fn without_a_store_nothing_is_written_anywhere() {
        let (broker, _) = broker(Arc::new(UnavailableCredentialStore), Some(FAKE_KEY), &[]);
        let openai = (*descriptor("openai").unwrap()).clone();
        assert_eq!(broker.set(&openai).unwrap(), CredentialOutcome::StoreUnavailable);
        assert!(!broker.status(&openai).store_available);
    }

    #[test]
    fn local_providers_need_no_key_and_clearing_is_honest() {
        let (broker, _) = broker(Arc::new(MemoryCredentialStore::default()), Some(FAKE_KEY), &[]);
        assert_eq!(broker.set(&(*descriptor("ollama").unwrap()).clone()).unwrap(), CredentialOutcome::NotApplicable);
        let openai = (*descriptor("openai").unwrap()).clone();
        assert_eq!(broker.clear(&openai).unwrap(), CredentialOutcome::NothingToClear);
        broker.set(&openai).unwrap();
        assert_eq!(broker.clear(&openai).unwrap(), CredentialOutcome::Cleared);
        assert!(broker.resolve(&openai).is_none());
    }
}
