// خدمة الموصلات: عمليات الواجهة (سطح الإعدادات الموثوق) وتزامن أدواتها مع سجل Phase-04.
//
// لا عملية هنا تنفّذ عملية موصل على الخدمة لصالح العارض (البند 51). ما يصل من الواجهة:
// تسجيل، وتعديل محدود، وتفعيل وتعطيل، وإزالة، وفحص اتصال بعملية قراءة، وإدخال سرّ عبر
// نافذة النظام، واستيراد OpenAPI بمراجعة. والعمليات نفسها تبدأ من زمن تشغيل المهمّة
// وحده، عبر بوابة الأدوات ثم بوابة الموصلات.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use polaris_host_providers::net::CancelToken;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::p04::service::Phase04;
use crate::p06::config::{ConfigScope, ConfigService};
use crate::p06::observe::health::{HealthRecord, HealthState, HealthSubject};
use crate::p06::observe::ObservabilityService;
use crate::storage::StorageError;

use super::gateway::{ConnectorCall, ConnectorFailure, ConnectorGateway};
use super::model::{
    validate_display_name, validate_rest, AuthMode, ConfigRefusal, ConnectorAuthState, ConnectorCategory, ConnectorConfig, ConnectorDescriptor, ConnectorInstance,
    ConnectorOperation, ConnectorProvenance, ConnectorProvider, EgressClass, HttpMethod, ProvenanceOrigin, RateLimit, RestConfig, SecretSource, WorkspaceConfig,
};
use super::openapi;
use super::secrets::{secret_ref, CredentialOutcome};
use super::store::{ImportRow, InvocationRow};
use super::tool::{connector_skill, ConnectorToolAdapter, TOOL_PREFIX};
use super::workspace;

/// لماذا رُفض طلب واجهة. يُترجم في IPC إلى خطأ مُصنَّف بمؤشّر.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectorServiceError {
    Invalid { code: &'static str, pointer: String },
    NotFound,
    NotAvailable(&'static str),
    Conflict(&'static str),
    Storage(String),
}

impl From<ConfigRefusal> for ConnectorServiceError {
    fn from(r: ConfigRefusal) -> Self {
        Self::Invalid { code: r.code, pointer: r.pointer }
    }
}

impl From<StorageError> for ConnectorServiceError {
    fn from(e: StorageError) -> Self {
        Self::Storage(e.to_string())
    }
}

type Outcome<T> = Result<T, ConnectorServiceError>;

/// إعداد REST كما يصل من الواجهة، قبل أن يصير `RestConfig` مُتحقَّقًا.
#[derive(Debug, Clone, Deserialize)]
pub struct RestInput {
    pub base_url: String,
    pub egress_class: EgressClass,
    pub allowed_paths: Vec<String>,
    pub allowed_methods: Vec<HttpMethod>,
    pub auth_mode: AuthMode,
    /// مصدر المفتاح: NONE أو CREDENTIAL_STORE أو ENVIRONMENT. الأسماء محايدة عمدًا: قواعد
    /// نظافة العقد ترفض حقلًا يسمّي سرًّا في أي حمولة تعبر الحدّ.
    pub key_source: String,
    #[serde(default)]
    pub environment_variable: Option<String>,
    #[serde(default)]
    pub key_header: Option<String>,
    #[serde(default)]
    pub basic_username: Option<String>,
    pub timeout_ms: u64,
    pub max_response_bytes: u64,
    #[serde(default)]
    pub requests_per_minute: Option<u32>,
    #[serde(default)]
    pub max_concurrent: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegisterInput {
    pub provider: ConnectorProvider,
    pub category: ConnectorCategory,
    pub display_name: String,
    #[serde(default)]
    pub rest: Option<RestInput>,
    #[serde(default)]
    pub workspace: Option<WorkspaceConfig>,
    #[serde(default)]
    pub operations: Vec<ConnectorOperation>,
    /// PHASE-05: ترويسات الخدمة الثابتة من إعداد جاهز مدمج. `skip`: حمولة IPC لا تملؤها أبدًا.
    #[serde(skip)]
    pub fixed_headers: Vec<super::model::FixedHeader>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestView {
    pub base_url: String,
    pub egress_class: EgressClass,
    pub allowed_paths: Vec<String>,
    pub allowed_methods: Vec<HttpMethod>,
    pub timeout_ms: u64,
    pub max_response_bytes: u64,
    pub requests_per_minute: u32,
    pub max_concurrent: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorView {
    pub descriptor: ConnectorDescriptor,
    pub auth: ConnectorAuthState,
    pub health: HealthRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
    pub operation_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rest: Option<RestView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<WorkspaceConfig>,
    pub registered_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationView {
    pub operation: ConnectorOperation,
    pub tool_id: String,
    pub side_effect: bool,
    pub retry_safe: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorListResult {
    pub connectors: Vec<ConnectorView>,
    pub unreadable: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorGetResult {
    pub connector: ConnectorView,
    pub operations: Vec<OperationView>,
    pub invocations: Vec<InvocationRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorResultEnvelope {
    pub connector: ConnectorView,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorRemoveResult {
    pub connector_id: String,
    pub removed: bool,
    pub tools_removed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectorTestResult {
    pub connector_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe_operation: Option<String>,
    pub health: HealthRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CredentialResult {
    pub connector_id: String,
    pub outcome: &'static str,
    pub auth: ConnectorAuthState,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub import_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_base_url: Option<String>,
    pub operations: Vec<ConnectorOperation>,
    pub rejected: Vec<openapi::RejectedOperation>,
    pub spec_digest: String,
    pub status: String,
}

pub struct ConnectorService {
    pub gateway: Arc<ConnectorGateway>,
    phase04: Arc<Phase04>,
    config: Arc<ConfigService>,
    observe: Arc<ObservabilityService>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
}

impl ConnectorService {
    pub fn new(gateway: Arc<ConnectorGateway>, phase04: Arc<Phase04>, config: Arc<ConfigService>, observe: Arc<ObservabilityService>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { gateway, phase04, config, observe, audit, clock }
    }

    /// يعيد مزامنة أدوات الموصلات في سجل Phase-04 من المثيلات الحالية.
    pub fn sync_tools(&self) -> Vec<(String, &'static str)> {
        let mut adapters: Vec<Arc<dyn crate::p04::adapter::ToolAdapter>> = Vec::new();
        for instance in self.gateway.instances() {
            for op in &instance.operations {
                adapters.push(Arc::new(ConnectorToolAdapter::new(self.gateway.clone(), &instance, op)));
            }
        }
        self.phase04.sync_dynamic_tools(TOOL_PREFIX, connector_skill(&self.clock.now()), adapters).unwrap_or_else(|_| vec![("connector".into(), "UNKNOWN_TOOL")])
    }

    fn view(&self, instance: &ConnectorInstance) -> ConnectorView {
        let (rest, workspace) = match &instance.config {
            ConnectorConfig::Rest(r) => (
                Some(RestView {
                    base_url: r.base_url.clone(),
                    egress_class: r.egress_class,
                    allowed_paths: r.allowed_paths.clone(),
                    allowed_methods: r.allowed_methods.clone(),
                    timeout_ms: r.timeout_ms,
                    max_response_bytes: r.max_response_bytes,
                    requests_per_minute: r.rate.requests_per_minute,
                    max_concurrent: r.rate.max_concurrent,
                }),
                None,
            ),
            ConnectorConfig::Workspace(w) => (None, Some(w.clone())),
        };
        ConnectorView {
            descriptor: instance.descriptor(),
            auth: self.gateway.secrets.status(instance),
            health: self.observe.health.get(HealthSubject::Connector, &instance.connector_id),
            last_activity_at: instance.last_activity_at.clone(),
            operation_count: instance.operations.len(),
            rest,
            workspace,
            registered_at: instance.registered_at.clone(),
        }
    }

    fn found(&self, connector_id: &str) -> Outcome<ConnectorInstance> {
        self.gateway.instance(connector_id).ok_or(ConnectorServiceError::NotFound)
    }

    fn audit(&self, event: AuditEventType, subject: &str, outcome: AuditOutcome, detail: Value) {
        let _ = self.audit.append(&AuditRecord::new(event, "connector", subject, outcome, detail));
    }

    pub fn list(&self) -> ConnectorListResult {
        ConnectorListResult { connectors: self.gateway.instances().iter().map(|c| self.view(c)).collect(), unreadable: self.gateway.unreadable_at_load }
    }

    pub fn get(&self, connector_id: &str) -> Outcome<ConnectorGetResult> {
        let instance = self.found(connector_id)?;
        let operations = instance
            .operations
            .iter()
            .map(|op| OperationView { operation: op.clone(), tool_id: instance.tool_id(&op.operation_id), side_effect: op.action.is_side_effect(), retry_safe: super::rest::side_effect_safe(op) })
            .collect();
        let invocations = self.gateway.store.invocations(Some(connector_id), None, 20)?;
        Ok(ConnectorGetResult { connector: self.view(&instance), operations, invocations })
    }

    fn rest_config(&self, connector_id: &str, input: &RestInput) -> Outcome<RestConfig> {
        let secret = match input.key_source.as_str() {
            "NONE" => SecretSource::None,
            "CREDENTIAL_STORE" => SecretSource::CredentialStore { secret_ref: secret_ref(connector_id) },
            "ENVIRONMENT" => SecretSource::Environment { variable: input.environment_variable.clone().unwrap_or_default() },
            _ => return Err(ConnectorServiceError::Invalid { code: "SECRET_SOURCE_INVALID", pointer: "/rest/key_source".into() }),
        };
        let defaults = RateLimit::default();
        Ok(RestConfig {
            base_url: input.base_url.trim().to_string(),
            egress_class: input.egress_class,
            allowed_paths: input.allowed_paths.clone(),
            allowed_methods: {
                let mut m = input.allowed_methods.clone();
                m.sort();
                m.dedup();
                m
            },
            auth_mode: input.auth_mode,
            secret,
            api_key_header: input.key_header.clone(),
            basic_username: input.basic_username.clone(),
            timeout_ms: input.timeout_ms,
            max_response_bytes: input.max_response_bytes,
            rate: RateLimit { requests_per_minute: input.requests_per_minute.unwrap_or(defaults.requests_per_minute), max_concurrent: input.max_concurrent.unwrap_or(defaults.max_concurrent) },
            fixed_headers: Vec::new(),
        })
    }

    /// يسجّل موصلًا معطّلًا. التفعيل خطوة مستقلة يراها المستخدم (البند 14).
    pub fn register(&self, input: RegisterInput) -> Outcome<ConnectorResultEnvelope> {
        self.register_with(input, ProvenanceOrigin::UserRegistered, None, None)
    }

    /// PHASE-05: يسجّل إعدادًا جاهزًا مدمجًا (`presets`) معطّلًا وبلا اعتماد، بالمسار نفسه وفحصه نفسه.
    pub fn register_preset(&self, preset_id: &str, display_name: Option<&str>) -> Outcome<ConnectorResultEnvelope> {
        let input = super::presets::register_input(preset_id, display_name).ok_or(ConnectorServiceError::Invalid { code: "PRESET_UNKNOWN", pointer: "/preset_id".into() })?;
        // CP-12-3: قِيس في النسخة التنفيذية أن «أضف» مرّتين صنع موصلين متطابقين. موصل من قالب بالعنوان نفسه موجود ⇒ تعارض.
        // العنوان وحده لا يكفي: Google Calendar وDrive (وبريد Outlook وتقويمه) تشترك في العنوان وتختلف في المسارات.
        let base_url = input.rest.as_ref().map(|r| r.base_url.clone()).unwrap_or_default();
        let paths = input.rest.as_ref().map(|r| r.allowed_paths.clone()).unwrap_or_default();
        let exists = self.gateway.instances().iter().any(|c| {
            c.provenance.origin == ProvenanceOrigin::BuiltInPreset && matches!(&c.config, ConnectorConfig::Rest(rest) if rest.base_url == base_url && rest.allowed_paths == paths)
        });
        if exists {
            return Err(ConnectorServiceError::Conflict("PRESET_ALREADY_ADDED"));
        }
        self.register_with(input, ProvenanceOrigin::BuiltInPreset, None, None)
    }

    fn register_with(&self, input: RegisterInput, origin: ProvenanceOrigin, import_id: Option<String>, spec_digest: Option<String>) -> Outcome<ConnectorResultEnvelope> {
        let connector_id = self.clock.id();
        let display_name = validate_display_name(&input.display_name)?;
        let ceiling = self.config.uint("connectors.max_response_bytes", &ConfigScope::global());
        let (config, operations) = match (input.provider, input.rest, input.workspace) {
            (ConnectorProvider::Rest, Some(rest), None) => {
                let mut config = self.rest_config(&connector_id, &rest)?;
                config.fixed_headers = input.fixed_headers.clone();
                validate_rest(&config, &input.operations, ceiling)?;
                (ConnectorConfig::Rest(config), input.operations)
            }
            (ConnectorProvider::Workspace, None, Some(ws)) => {
                if !input.operations.is_empty() {
                    return Err(ConnectorServiceError::Invalid { code: "WORKSPACE_OPERATIONS_ARE_FIXED", pointer: "/operations".into() });
                }
                if input.category != ConnectorCategory::Files {
                    return Err(ConnectorServiceError::Invalid { code: "WORKSPACE_IS_FILES", pointer: "/category".into() });
                }
                (ConnectorConfig::Workspace(ws), workspace::operations())
            }
            _ => return Err(ConnectorServiceError::Invalid { code: "PROVIDER_CONFIG_MISMATCH", pointer: "/provider".into() }),
        };
        let now = self.clock.now();
        let instance = ConnectorInstance {
            connector_id: connector_id.clone(),
            provider: input.provider,
            category: input.category,
            display_name,
            version: "1".into(),
            enabled: false,
            config,
            operations,
            provenance: ConnectorProvenance { origin, import_id, spec_digest, registered_at: now.clone() },
            credential_updated_at: None,
            registered_at: now.clone(),
            updated_at: now,
            last_activity_at: None,
        };
        self.gateway.store.save(&instance)?;
        self.gateway.reload();
        let refused = self.sync_tools();
        self.audit(
            AuditEventType::ConnectorRegistered,
            &connector_id,
            AuditOutcome::Success,
            serde_json::json!({
                "provider": instance.provider.as_str(),
                "category": instance.category.as_str(),
                "egress_class": instance.egress_class().as_str(),
                "auth_mode": instance.auth_mode().as_str(),
                "operations": instance.operations.iter().map(|o| format!("{}:{}", o.operation_id, o.action.as_str())).collect::<Vec<_>>(),
                "origin": origin.as_str(),
                "tools_refused": refused.len(),
            }),
        );
        let stored = self.found(&connector_id)?;
        Ok(ConnectorResultEnvelope { connector: self.view(&stored) })
    }

    /// تفعيل وتعطيل وتسمية ومعدّل. العنوان والمسارات والعمليات لا تُعدَّل هنا: تغيير
    /// الوجهة تسجيلٌ جديد يُراجَع كاملًا، لا تعديلٌ صامت على موصل موثوق سلفًا.
    pub fn configure(&self, connector_id: &str, enabled: Option<bool>, display_name: Option<&str>, rate: Option<RateLimit>) -> Outcome<ConnectorResultEnvelope> {
        let mut instance = self.found(connector_id)?;
        if let Some(name) = display_name {
            instance.display_name = validate_display_name(name)?;
        }
        if let Some(enabled) = enabled {
            instance.enabled = enabled;
        }
        if let Some(rate) = rate {
            match &mut instance.config {
                ConnectorConfig::Rest(r) => {
                    if !(1..=600).contains(&rate.requests_per_minute) || !(1..=8).contains(&rate.max_concurrent) {
                        return Err(ConnectorServiceError::Invalid { code: "RATE_LIMIT_OUT_OF_RANGE", pointer: "/rate".into() });
                    }
                    r.rate = rate;
                }
                ConnectorConfig::Workspace(_) => return Err(ConnectorServiceError::Invalid { code: "RATE_LIMIT_NOT_APPLICABLE", pointer: "/rate".into() }),
            }
        }
        instance.updated_at = self.clock.now();
        self.gateway.store.save(&instance)?;
        self.gateway.reload();
        self.sync_tools();
        if !instance.enabled {
            self.observe.health.forget(HealthSubject::Connector, connector_id);
        }
        self.audit(
            AuditEventType::ConnectorConfigured,
            connector_id,
            if instance.enabled { AuditOutcome::Success } else { AuditOutcome::Denied },
            serde_json::json!({ "enabled": instance.enabled, "renamed": display_name.is_some(), "rate_changed": rate.is_some() }),
        );
        Ok(ConnectorResultEnvelope { connector: self.view(&instance) })
    }

    pub fn remove(&self, connector_id: &str) -> Outcome<ConnectorRemoveResult> {
        let instance = self.found(connector_id)?;
        let tools = instance.operations.len();
        let removed = self.gateway.store.remove(connector_id)?;
        self.gateway.secrets.forget(&instance);
        self.gateway.reload();
        self.sync_tools();
        self.observe.health.forget(HealthSubject::Connector, connector_id);
        self.audit(AuditEventType::ConnectorRemoved, connector_id, AuditOutcome::Success, serde_json::json!({ "tools_removed": tools }));
        Ok(ConnectorRemoveResult { connector_id: connector_id.to_string(), removed, tools_removed: tools })
    }

    /// فحص اتصال: عملية قراءة بلا حجج مطلوبة، عبر بوابة الموصلات نفسها.
    pub fn test(&self, connector_id: &str) -> Outcome<ConnectorTestResult> {
        let instance = self.found(connector_id)?;
        // المسبار: قراءة بلا حجج مطلوبة، ويُفضَّل ما اسمه «health» ثم «list».
        let readable: Vec<&ConnectorOperation> = instance.operations.iter().filter(|o| !o.action.is_side_effect() && !o.params.iter().any(|p| p.required)).collect();
        let probe = readable
            .iter()
            .find(|o| o.operation_id.ends_with(".health") || o.operation_id == "health")
            .or_else(|| readable.iter().find(|o| o.operation_id.ends_with(".list")))
            .or_else(|| readable.first())
            .map(|o| o.operation_id.clone());
        let Some(operation_id) = probe else {
            return Ok(ConnectorTestResult {
                connector_id: connector_id.into(),
                probe_operation: None,
                health: self.observe.health.get(HealthSubject::Connector, connector_id),
                reason_code: Some("NO_PROBE_OPERATION".into()),
            });
        };
        let cancel = CancelToken::new();
        let arguments = serde_json::json!({});
        let project = match &instance.config {
            ConnectorConfig::Workspace(w) => Some(w.project_id.clone()),
            ConnectorConfig::Rest(_) => None,
        };
        let call = ConnectorCall {
            connector_id,
            operation_id: &operation_id,
            arguments: &arguments,
            mission_id: None,
            task_id: None,
            agent_id: None,
            project_id: project.as_deref(),
            timeout_ms: 15_000,
            cancel: &cancel,
            probe: true,
        };
        let outcome = self.gateway.invoke(&call);
        let reason = match &outcome {
            Ok(_) => None,
            Err(failure) => Some(failure.code()),
        };
        // فشلٌ قبل الإرسال (معطّل، سياسة، اعتماد) لا يقول شيئًا عن الخدمة؛ لا يُكتب صحّة.
        if let Err(failure) = &outcome {
            if matches!(failure, ConnectorFailure::Disabled | ConnectorFailure::PolicyDenied(_) | ConnectorFailure::EgressDenied(_) | ConnectorFailure::AuthMissing) {
                self.observe.health.record(HealthSubject::Connector, connector_id, HealthState::Unknown, &failure.code(), self.clock.now(), None);
            }
        }
        if instance.egress_class() == EgressClass::None {
            let state = if outcome.is_ok() { HealthState::Healthy } else { HealthState::Unhealthy };
            self.observe.health.record(HealthSubject::Connector, connector_id, state, reason.as_deref().unwrap_or("PROBE_OK"), self.clock.now(), None);
        }
        let health = self.observe.health.get(HealthSubject::Connector, connector_id);
        self.audit(
            AuditEventType::ConnectorHealthChecked,
            connector_id,
            if outcome.is_ok() { AuditOutcome::Success } else { AuditOutcome::Failure },
            serde_json::json!({ "probe_operation": operation_id, "state": health.state.as_str(), "reason": reason }),
        );
        Ok(ConnectorTestResult { connector_id: connector_id.into(), probe_operation: Some(operation_id), health, reason_code: reason })
    }

    pub fn credential_set(&self, connector_id: &str) -> Outcome<CredentialResult> {
        let mut instance = self.found(connector_id)?;
        let outcome = self.gateway.secrets.set(&instance).map_err(ConnectorServiceError::Storage)?;
        if outcome == CredentialOutcome::Stored {
            instance.credential_updated_at = Some(self.clock.now());
            self.gateway.store.save(&instance)?;
            self.gateway.reload();
            self.audit(AuditEventType::ConnectorCredentialSet, connector_id, AuditOutcome::Success, serde_json::json!({ "source": "CREDENTIAL_STORE" }));
        }
        Ok(CredentialResult { connector_id: connector_id.into(), outcome: outcome.as_str(), auth: self.gateway.secrets.status(&instance) })
    }

    pub fn credential_clear(&self, connector_id: &str) -> Outcome<CredentialResult> {
        let mut instance = self.found(connector_id)?;
        let outcome = self.gateway.secrets.clear(&instance).map_err(ConnectorServiceError::Storage)?;
        if outcome == CredentialOutcome::Cleared {
            instance.credential_updated_at = Some(self.clock.now());
            self.gateway.store.save(&instance)?;
            self.gateway.reload();
            self.audit(AuditEventType::ConnectorCredentialCleared, connector_id, AuditOutcome::Success, serde_json::json!({ "source": "CREDENTIAL_STORE" }));
        }
        Ok(CredentialResult { connector_id: connector_id.into(), outcome: outcome.as_str(), auth: self.gateway.secrets.status(&instance) })
    }

    /// يحلّل وثيقة ويحفظ الاقتراح. لا يُسجَّل شيء.
    pub fn import(&self, spec_text: &str) -> Outcome<ImportResult> {
        let proposal = openapi::propose(spec_text).map_err(|r| ConnectorServiceError::Invalid { code: r.as_str(), pointer: "/spec".into() })?;
        let import_id = self.clock.id();
        let row = ImportRow {
            import_id: import_id.clone(),
            spec_digest: proposal.spec_digest.clone(),
            title: proposal.title.clone(),
            proposals_json: serde_json::to_string(&proposal.operations).unwrap_or_else(|_| "[]".into()),
            rejected_json: serde_json::to_string(&proposal.rejected).unwrap_or_else(|_| "[]".into()),
            status: "PROPOSED".into(),
            connector_id: None,
            created_at: self.clock.now(),
        };
        self.gateway.store.save_import(&row)?;
        self.audit(
            AuditEventType::ConnectorImportProposed,
            &import_id,
            AuditOutcome::Success,
            serde_json::json!({ "spec_digest": proposal.spec_digest, "proposed": proposal.operations.len(), "rejected": proposal.rejected.len() }),
        );
        Ok(ImportResult {
            import_id,
            title: proposal.title,
            suggested_base_url: proposal.suggested_base_url,
            operations: proposal.operations,
            rejected: proposal.rejected,
            spec_digest: proposal.spec_digest,
            status: "PROPOSED".into(),
        })
    }

    /// يسجّل المجموعة التي وافق عليها المستخدم وحدها، بعنوان أكّده، معطّلةً.
    pub fn approve_import(&self, import_id: &str, operation_ids: &[String], display_name: &str, category: ConnectorCategory, rest: RestInput) -> Outcome<ConnectorResultEnvelope> {
        let row = self.gateway.store.import(import_id)?.ok_or(ConnectorServiceError::NotFound)?;
        if row.status != "PROPOSED" {
            return Err(ConnectorServiceError::Conflict("IMPORT_ALREADY_DECIDED"));
        }
        let proposed: Vec<ConnectorOperation> = serde_json::from_str(&row.proposals_json).unwrap_or_default();
        if operation_ids.is_empty() {
            return Err(ConnectorServiceError::Invalid { code: "NO_OPERATION_APPROVED", pointer: "/operation_ids".into() });
        }
        let mut chosen = Vec::new();
        for id in operation_ids {
            match proposed.iter().find(|o| &o.operation_id == id) {
                Some(op) => chosen.push(op.clone()),
                None => return Err(ConnectorServiceError::Invalid { code: "OPERATION_NOT_PROPOSED", pointer: "/operation_ids".into() }),
            }
        }
        let envelope = self.register_with(
            RegisterInput { provider: ConnectorProvider::Rest, category, display_name: display_name.to_string(), rest: Some(rest), workspace: None, operations: chosen.clone(), fixed_headers: Vec::new() },
            ProvenanceOrigin::OpenapiImport,
            Some(import_id.to_string()),
            Some(row.spec_digest.clone()),
        )?;
        let decided = ImportRow { status: "APPROVED".into(), connector_id: Some(envelope.connector.descriptor.connector_id.clone()), created_at: self.clock.now(), ..row };
        self.gateway.store.save_import(&decided)?;
        self.audit(
            AuditEventType::ConnectorImportApproved,
            import_id,
            AuditOutcome::Success,
            serde_json::json!({ "approved": chosen.iter().map(|o| o.operation_id.clone()).collect::<Vec<_>>(), "connector_id": envelope.connector.descriptor.connector_id }),
        );
        Ok(envelope)
    }
}
