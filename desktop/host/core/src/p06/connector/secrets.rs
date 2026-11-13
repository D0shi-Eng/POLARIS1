// وسيط أسرار الموصلات (البند 6): المرجع يعبر الحدّ، والقيمة لا تعبر أبدًا.
//
// المصدران: مخزن بيانات الاعتماد (Windows Credential Manager) بمرجع ثابت لكل موصل،
// أو متغيّر بيئة بادئته محجوزة `POLARIS_CONNECTOR_`. القيمة تُحلّ عند النداء لبناء
// ترويسة ثم تُسقط؛ لا تصل إلى عارض ولا مُوجِّه وكيل ولا سجلّ ولا دليل ولا تشخيص.
// الإدخال عبر نافذة النظام: العارض لا يرى الحقل ولا ما يُكتب فيه.

use std::sync::Arc;

use polaris_host_providers::SecretValue;

use crate::p02::ports::{CredentialPrompt, CredentialStore, CredentialStoreError, Environment, PromptOutcome};

use super::model::{AuthMode, ConnectorAuthState, ConnectorConfig, ConnectorInstance, SecretSource};

/// الهدف في مخزن بيانات الاعتماد. معرّف الموصل وحده يدخله.
pub fn credential_target(connector_id: &str) -> String {
    format!("POLARIS/connector/{connector_id}")
}

/// المرجع الذي يُعرض بدل القيمة.
pub fn secret_ref(connector_id: &str) -> String {
    format!("secret://connectors/{connector_id}/default")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialOutcome {
    Stored,
    Cleared,
    PromptCancelled,
    StoreUnavailable,
    NotApplicable,
    NothingToClear,
}

impl CredentialOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stored => "STORED",
            Self::Cleared => "CLEARED",
            Self::PromptCancelled => "PROMPT_CANCELLED",
            Self::StoreUnavailable => "STORE_UNAVAILABLE",
            Self::NotApplicable => "NOT_APPLICABLE",
            Self::NothingToClear => "NOTHING_TO_CLEAR",
        }
    }
}

pub struct ConnectorSecrets {
    store: Arc<dyn CredentialStore>,
    prompt: Arc<dyn CredentialPrompt>,
    environment: Arc<dyn Environment>,
}

impl ConnectorSecrets {
    pub fn new(store: Arc<dyn CredentialStore>, prompt: Arc<dyn CredentialPrompt>, environment: Arc<dyn Environment>) -> Self {
        Self { store, prompt, environment }
    }

    fn source(instance: &ConnectorInstance) -> (AuthMode, SecretSource) {
        match &instance.config {
            ConnectorConfig::Rest(rest) => (rest.auth_mode, rest.secret.clone()),
            ConnectorConfig::Workspace(_) => (AuthMode::None, SecretSource::None),
        }
    }

    /// القيمة للنداء الحالي فقط. `None` حين لا سرّ مطلوب أو غير مضبوط.
    pub fn resolve(&self, instance: &ConnectorInstance) -> Option<SecretValue> {
        match Self::source(instance).1 {
            SecretSource::None => None,
            SecretSource::CredentialStore { .. } => {
                if !self.store.available() {
                    return None;
                }
                self.store.read(&credential_target(&instance.connector_id)).ok().flatten()
            }
            SecretSource::Environment { variable } => {
                if !super::model::is_environment_variable(&variable) {
                    return None;
                }
                self.environment.var(&variable).and_then(SecretValue::new)
            }
        }
    }

    /// الحالة كما تعبر الحدّ: مضبوط أم لا، ومن أين، ومتى. لا قيمة، ولا طول قيمة.
    pub fn status(&self, instance: &ConnectorInstance) -> ConnectorAuthState {
        let (mode, source) = Self::source(instance);
        let store_available = self.store.available();
        match source {
            SecretSource::None => ConnectorAuthState {
                mode,
                required: false,
                configured: false,
                source: "NONE",
                reference: None,
                environment_variable: None,
                last_updated: None,
                store_available,
            },
            SecretSource::CredentialStore { .. } => ConnectorAuthState {
                mode,
                required: true,
                configured: self.resolve(instance).is_some(),
                source: "CREDENTIAL_STORE",
                reference: Some(secret_ref(&instance.connector_id)),
                environment_variable: None,
                last_updated: instance.credential_updated_at.clone(),
                store_available,
            },
            SecretSource::Environment { variable } => ConnectorAuthState {
                mode,
                required: true,
                configured: self.resolve(instance).is_some(),
                source: "ENVIRONMENT",
                reference: Some(secret_ref(&instance.connector_id)),
                environment_variable: Some(variable),
                last_updated: None,
                store_available,
            },
        }
    }

    /// يفتح نافذة الإدخال الأصلية ويخزّن ما أُدخل. للموصلات التي مصدرها المخزن وحدها.
    pub fn set(&self, instance: &ConnectorInstance) -> Result<CredentialOutcome, String> {
        if !matches!(Self::source(instance).1, SecretSource::CredentialStore { .. }) {
            return Ok(CredentialOutcome::NotApplicable);
        }
        if !self.store.available() {
            return Ok(CredentialOutcome::StoreUnavailable);
        }
        let secret = match self.prompt.prompt(&instance.display_name) {
            PromptOutcome::Entered(secret) => secret,
            PromptOutcome::Cancelled => return Ok(CredentialOutcome::PromptCancelled),
            PromptOutcome::Unavailable => return Ok(CredentialOutcome::StoreUnavailable),
        };
        match self.store.write(&credential_target(&instance.connector_id), &secret) {
            Ok(()) => Ok(CredentialOutcome::Stored),
            Err(CredentialStoreError::Unavailable) => Ok(CredentialOutcome::StoreUnavailable),
            Err(CredentialStoreError::Failed(detail)) => Err(format!("credential store write failed: {detail}")),
        }
    }

    pub fn clear(&self, instance: &ConnectorInstance) -> Result<CredentialOutcome, String> {
        if !matches!(Self::source(instance).1, SecretSource::CredentialStore { .. }) {
            return Ok(CredentialOutcome::NotApplicable);
        }
        if !self.store.available() {
            return Ok(CredentialOutcome::StoreUnavailable);
        }
        match self.store.delete(&credential_target(&instance.connector_id)) {
            Ok(true) => Ok(CredentialOutcome::Cleared),
            Ok(false) => Ok(CredentialOutcome::NothingToClear),
            Err(CredentialStoreError::Unavailable) => Ok(CredentialOutcome::StoreUnavailable),
            Err(CredentialStoreError::Failed(detail)) => Err(format!("credential store delete failed: {detail}")),
        }
    }

    /// يحذف السرّ المخزَّن عند إزالة الموصل. لا يبقى سرّ يتيم بلا موصل.
    pub fn forget(&self, instance: &ConnectorInstance) {
        if matches!(Self::source(instance).1, SecretSource::CredentialStore { .. }) && self.store.available() {
            let _ = self.store.delete(&credential_target(&instance.connector_id));
        }
    }
}

/// ترويسة الاعتماد لنداء، مبنيّة من القيمة لحظة الإرسال. تُسقط مع الطلب.
pub fn auth_header(mode: AuthMode, api_key_header: Option<&str>, basic_username: Option<&str>, secret: &SecretValue) -> Option<(&'static str, String)> {
    match mode {
        AuthMode::None | AuthMode::Oauth2 => None,
        AuthMode::BearerToken => Some(("Authorization", format!("Bearer {}", secret.expose()))),
        AuthMode::Basic => {
            let user = basic_username?;
            Some(("Authorization", format!("Basic {}", base64(format!("{user}:{}", secret.expose()).as_bytes()))))
        }
        AuthMode::ApiKey => super::model::api_key_header(api_key_header?).map(|name| (name, secret.expose().to_string())),
    }
}

/// ترميز base64 القياسي بلا تبعية. BASIC وحده يحتاجه.
pub fn base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::model::tests::{read_op, rest};
    use super::super::model::{ConnectorCategory, ConnectorProvenance, ConnectorProvider, EgressClass, ProvenanceOrigin};
    use super::*;
    use crate::p02::ports::{FixedPrompt, MapEnvironment, MemoryCredentialStore};

    fn instance(secret: SecretSource) -> ConnectorInstance {
        let mut config = rest("http://127.0.0.1:1/", EgressClass::Loopback);
        config.secret = secret;
        ConnectorInstance {
            connector_id: "11111111-1111-4111-8111-111111111111".into(),
            provider: ConnectorProvider::Rest,
            category: ConnectorCategory::CustomApi,
            display_name: "fixture".into(),
            version: "1".into(),
            enabled: true,
            config: ConnectorConfig::Rest(config),
            operations: vec![read_op()],
            provenance: ConnectorProvenance { origin: ProvenanceOrigin::UserRegistered, import_id: None, spec_digest: None, registered_at: "t".into() },
            credential_updated_at: None,
            registered_at: "t".into(),
            updated_at: "t".into(),
            last_activity_at: None,
        }
    }

    #[test]
    fn a_stored_secret_is_resolved_for_a_call_and_its_status_carries_no_value() {
        let secrets = ConnectorSecrets::new(
            Arc::new(MemoryCredentialStore::default()),
            Arc::new(FixedPrompt(Some("canary-secret-value-123".into()))),
            Arc::new(MapEnvironment::default()),
        );
        let instance = instance(SecretSource::CredentialStore { secret_ref: "x".into() });
        assert!(!secrets.status(&instance).configured);
        assert_eq!(secrets.set(&instance).unwrap(), CredentialOutcome::Stored);
        let status = secrets.status(&instance);
        assert!(status.configured);
        let text = serde_json::to_string(&status).unwrap();
        assert!(!text.contains("canary-secret-value-123"), "the status carried the value");
        assert_eq!(secrets.resolve(&instance).unwrap().expose(), "canary-secret-value-123");
        assert_eq!(secrets.clear(&instance).unwrap(), CredentialOutcome::Cleared);
        assert!(secrets.resolve(&instance).is_none());
    }

    #[test]
    fn only_a_reserved_environment_variable_can_be_a_secret_source() {
        let mut env = MapEnvironment::default();
        env.0.insert("POLARIS_CONNECTOR_TEST_TOKEN".into(), "fixture-token-abc".into());
        env.0.insert("PATH".into(), "C:\\Windows".into());
        let secrets = ConnectorSecrets::new(Arc::new(MemoryCredentialStore::default()), Arc::new(FixedPrompt(None)), Arc::new(env));
        let good = instance(SecretSource::Environment { variable: "POLARIS_CONNECTOR_TEST_TOKEN".into() });
        assert_eq!(secrets.resolve(&good).unwrap().expose(), "fixture-token-abc");
        let bad = instance(SecretSource::Environment { variable: "PATH".into() });
        assert!(secrets.resolve(&bad).is_none(), "an arbitrary environment variable was read as a secret");
    }

    #[test]
    fn base64_matches_the_standard_alphabet() {
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(base64(b"a"), "YQ==");
        assert_eq!(base64(b"ab"), "YWI=");
    }
}
