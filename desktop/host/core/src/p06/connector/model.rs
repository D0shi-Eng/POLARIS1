// نموذج الموصلات: واصف، ومثيل، وقدرة (عملية مسجَّلة)، وحالة اعتماد، واستدعاء، ونتيجة.
//
// القاعدة الحاكمة (البند 13): الوكيل لا يسمّي عنوانًا. العنوان الأساسي والمسارات
// والأساليب المسموحة تأتي من سطح الإعدادات الموثوق حين يسجّل المستخدم الموصل، والوكيل
// يختار عملية مسجَّلة بمعرّفها ويملأ حججها المُصنَّفة فقط. لا مسار ولا مضيف ولا ترويسة
// تأتي من حجّة.

use serde::{Deserialize, Serialize};

use crate::p04::effect::ToolEffect;
use crate::p04::tool::RiskClass;

macro_rules! code_enum {
    ($(#[$doc:meta])* $name:ident { $($variant:ident => $code:literal),+ $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $code)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$(Self::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $code),+
                }
            }

            pub fn parse(code: &str) -> Option<Self> {
                match code {
                    $($code => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }
    };
}

code_enum!(
    /// أصناف الموصلات (البند 4).
    ConnectorCategory {
        Email => "EMAIL",
        Calendar => "CALENDAR",
        Files => "FILES",
        Messaging => "MESSAGING",
        ProjectManagement => "PROJECT_MANAGEMENT",
        CodeHosting => "CODE_HOSTING",
        Database => "DATABASE",
        CustomApi => "CUSTOM_API",
    }
);

code_enum!(
    /// أنماط الاعتماد (البند 6). OAUTH2 مُعلَن ولا يُنفَّذ في هذا البناء: لا تدفّق رسمي مدعوم.
    AuthMode {
        None => "NONE",
        ApiKey => "API_KEY",
        BearerToken => "BEARER_TOKEN",
        Basic => "BASIC",
        Oauth2 => "OAUTH2",
    }
);

code_enum!(
    /// ما تفعله العملية بالخدمة الخارجية (البند 7). كل ما عدا READ أثر خارجي.
    OperationAction {
        Read => "READ",
        Write => "WRITE",
        Delete => "DELETE",
        Send => "SEND",
        Publish => "PUBLISH",
        CreateExternalResource => "CREATE_EXTERNAL_RESOURCE",
        ModifyExternalResource => "MODIFY_EXTERNAL_RESOURCE",
    }
);

code_enum!(
    /// من يقدّم الموصل. اثنان في هذا البناء: REST عامّ، ومساحة عمل المشروع.
    ConnectorProvider {
        Rest => "polaris.rest",
        Workspace => "polaris.workspace",
    }
);

code_enum!(
    /// صنف الخروج. العامّ HTTPS إلى عناوين عامّة تُحلّ وتُفحص عند الاتصال؛ والمحلّي
    /// الحلقة المحلية الحرفية وحدها. لا صنف ثالث يبلغ شبكة خاصة.
    EgressClass {
        PublicHttps => "PUBLIC_HTTPS",
        Loopback => "LOOPBACK",
        None => "NONE",
    }
);

code_enum!(
    HttpMethod {
        Get => "GET",
        Post => "POST",
        Put => "PUT",
        Patch => "PATCH",
        Delete => "DELETE",
    }
);

code_enum!(
    ParamLocation {
        Path => "PATH",
        Query => "QUERY",
        Body => "BODY",
    }
);

code_enum!(
    ParamKind {
        String => "STRING",
        Integer => "INTEGER",
        Boolean => "BOOLEAN",
        Enum => "ENUM",
    }
);

code_enum!(
    ConnectorStatus {
        Registered => "REGISTERED",
        Enabled => "ENABLED",
        Disabled => "DISABLED",
    }
);

code_enum!(
    ProvenanceOrigin {
        UserRegistered => "USER_REGISTERED",
        OpenapiImport => "OPENAPI_IMPORT",
        BuiltInPreset => "BUILT_IN_PRESET",
    }
);

impl OperationAction {
    pub fn is_side_effect(self) -> bool {
        self != Self::Read
    }

    /// آثار العملية بمفردات Phase-04. الأثر الخارجي يوجب الموافقة بنيويًّا عند الختم.
    pub fn effects(self, egress: EgressClass) -> Vec<ToolEffect> {
        let mut effects = match egress {
            EgressClass::None => vec![ToolEffect::ReadLocal],
            EgressClass::PublicHttps | EgressClass::Loopback => vec![ToolEffect::NetworkEgress],
        };
        if self.is_side_effect() {
            effects.push(ToolEffect::ExternalSideEffect);
        }
        effects
    }

    /// الأسلوب الذي يليق بالفعل. عملية تُعلن «قراءة» بأسلوب يكتب تُرفض عند التسجيل.
    pub fn fits(self, method: HttpMethod) -> bool {
        match self {
            Self::Read => method == HttpMethod::Get,
            Self::Delete => method == HttpMethod::Delete,
            _ => method != HttpMethod::Get,
        }
    }
}

/// حجّة واحدة مُعلنة لعملية. الوكيل يملأ هذه وحدها.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OperationParam {
    pub name: String,
    pub location: ParamLocation,
    pub kind: ParamKind,
    pub required: bool,
    #[serde(default)]
    pub max_length: Option<u32>,
    #[serde(default)]
    pub minimum: Option<i64>,
    #[serde(default)]
    pub maximum: Option<i64>,
    #[serde(default)]
    pub allowed: Vec<String>,
}

/// كيف تحمي الخدمة نفسها من التكرار. HEADER يعني أنها تقبل مفتاحًا في ترويسة مُسمّاة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IdempotencySupport {
    None,
    Header { header: String },
}

/// قدرة الموصل: عملية مسجَّلة واحدة (البند 3/13).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectorOperation {
    pub operation_id: String,
    pub title: String,
    pub action: OperationAction,
    pub method: HttpMethod,
    /// قالب مسار من المسارات المسموحة، بمعاملات `{name}`.
    pub path: String,
    #[serde(default)]
    pub params: Vec<OperationParam>,
    #[serde(default = "no_idempotency")]
    pub idempotency: IdempotencySupport,
    /// مؤشّر JSON إلى معرّف المورد في الاستجابة. به وحده يُؤكَّد الإنشاء (البند 11).
    #[serde(default)]
    pub resource_id_pointer: Option<String>,
    /// مؤشّرات JSON لحقول تُلخَّص من الاستجابة. بيانات غير موثوقة، محدودة العدد والطول.
    #[serde(default)]
    pub result_fields: Vec<String>,
    /// مؤشّر JSON إلى كلفة تُبلغ بها الخدمة، وعملتها. غيابهما يعني كلفة غير مُبلَّغة.
    #[serde(default)]
    pub cost_pointer: Option<String>,
    #[serde(default)]
    pub cost_currency: Option<String>,
    /// PHASE-05: مؤشّر JSON إلى قائمة في الردّ، وحقول كل عنصر فيها. بدونهما يرى الوكيل «[n item(s)]» فقط، فلا يقرأ قائمة قنوات
    /// ولا صفحات. العناصر بيانات غير موثوقة محدودة العدد والطول، تصل الوكيل ناتجًا مسيَّجًا.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list_pointer: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub item_fields: Vec<String>,
}

fn no_idempotency() -> IdempotencySupport {
    IdempotencySupport::None
}

/// حدود المعدّل لكل موصل (البند 16).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RateLimit {
    pub requests_per_minute: u32,
    pub max_concurrent: u32,
}

impl Default for RateLimit {
    fn default() -> Self {
        Self { requests_per_minute: 60, max_concurrent: 2 }
    }
}

/// مصدر السرّ: مخزن بيانات الاعتماد بمرجعه، أو متغيّر بيئة بادئته محجوزة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SecretSource {
    None,
    CredentialStore { secret_ref: String },
    Environment { variable: String },
}

/// إعداد موصل REST (البند 13).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestConfig {
    pub base_url: String,
    pub egress_class: EgressClass,
    pub allowed_paths: Vec<String>,
    pub allowed_methods: Vec<HttpMethod>,
    pub auth_mode: AuthMode,
    pub secret: SecretSource,
    /// اسم الترويسة لمفتاح API. ليس سرًّا.
    #[serde(default)]
    pub api_key_header: Option<String>,
    /// اسم المستخدم لـBASIC. ليس سرًّا؛ كلمة المرور في مصدر السرّ.
    #[serde(default)]
    pub basic_username: Option<String>,
    pub timeout_ms: u64,
    pub max_response_bytes: u64,
    #[serde(default)]
    pub rate: RateLimit,
    /// ترويسات ثابتة غير سرّية تطلبها الخدمة (PHASE-05: `Notion-Version`). أسماؤها من `FIXED_HEADERS` وحدها، وقيمها رموز قصيرة؛
    /// لا يملؤها الوكيل ولا مسار التسجيل عبر IPC، بل الإعدادات الجاهزة المدمجة.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fixed_headers: Vec<FixedHeader>,
}

/// ترويسة ثابتة واحدة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixedHeader {
    pub name: String,
    pub value: String,
}

/// إعداد موصل مساحة العمل: مشروع واحد، ونطاقه نطاق مصادره.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorConfig {
    Rest(RestConfig),
    Workspace(WorkspaceConfig),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectorProvenance {
    pub origin: ProvenanceOrigin,
    #[serde(default)]
    pub import_id: Option<String>,
    #[serde(default)]
    pub spec_digest: Option<String>,
    pub registered_at: String,
}

/// المثيل المحفوظ: هويّته وإعداده وعملياته.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectorInstance {
    pub connector_id: String,
    pub provider: ConnectorProvider,
    pub category: ConnectorCategory,
    pub display_name: String,
    pub version: String,
    pub enabled: bool,
    pub config: ConnectorConfig,
    pub operations: Vec<ConnectorOperation>,
    pub provenance: ConnectorProvenance,
    pub credential_updated_at: Option<String>,
    pub registered_at: String,
    pub updated_at: String,
    pub last_activity_at: Option<String>,
}

impl ConnectorInstance {
    pub fn auth_mode(&self) -> AuthMode {
        match &self.config {
            ConnectorConfig::Rest(rest) => rest.auth_mode,
            ConnectorConfig::Workspace(_) => AuthMode::None,
        }
    }

    pub fn egress_class(&self) -> EgressClass {
        match &self.config {
            ConnectorConfig::Rest(rest) => rest.egress_class,
            ConnectorConfig::Workspace(_) => EgressClass::None,
        }
    }

    pub fn operation(&self, operation_id: &str) -> Option<&ConnectorOperation> {
        self.operations.iter().find(|o| o.operation_id == operation_id)
    }

    pub fn status(&self) -> ConnectorStatus {
        if self.enabled {
            ConnectorStatus::Enabled
        } else {
            ConnectorStatus::Disabled
        }
    }

    /// معرّف الأداة في سجل Phase-04 لعملية من هذا الموصل.
    pub fn tool_id(&self, operation_id: &str) -> String {
        tool_id(&self.connector_id, operation_id)
    }

    /// الواصف المشتق (البند 3). يُشتق من المثيل، ولا يُخزَّن مستقلًّا فلا ينجرف.
    pub fn descriptor(&self) -> ConnectorDescriptor {
        let egress = self.egress_class();
        let mut effects: Vec<ToolEffect> = self.operations.iter().flat_map(|o| o.action.effects(egress)).collect();
        effects.sort();
        effects.dedup();
        let risk = if self.operations.iter().any(|o| o.action.is_side_effect()) {
            RiskClass::High
        } else if egress == EgressClass::None {
            RiskClass::Low
        } else {
            RiskClass::Moderate
        };
        ConnectorDescriptor {
            connector_id: self.connector_id.clone(),
            provider: self.provider,
            display_name_key: format!("connector.provider.{}", self.provider.as_str()),
            display_name: self.display_name.clone(),
            description_key: format!("connector.category.{}", self.category.as_str()),
            version: self.version.clone(),
            category: self.category,
            capabilities: self.operations.iter().map(|o| ConnectorCapability { operation_id: o.operation_id.clone(), action: o.action, title: o.title.clone() }).collect(),
            auth_mode: self.auth_mode(),
            effects,
            risk_class: risk,
            supports_read: self.operations.iter().any(|o| !o.action.is_side_effect()),
            supports_write: self.operations.iter().any(|o| o.action.is_side_effect()),
            supports_webhook: false,
            supports_polling: false,
            supports_search: self.operations.iter().any(|o| o.action == OperationAction::Read && o.params.iter().any(|p| p.location == ParamLocation::Query)),
            supports_files: self.category == ConnectorCategory::Files,
            enabled: self.enabled,
            status: self.status(),
            provenance: self.provenance.clone(),
            egress_class: egress,
        }
    }
}

pub fn tool_id(connector_id: &str, operation_id: &str) -> String {
    format!("connector:{connector_id}:{operation_id}")
}

/// يقرأ معرّف موصل وعملية من معرّف أداة. شكل غيره ليس أداة موصل.
pub fn parse_tool_id(tool_id: &str) -> Option<(String, String)> {
    let rest = tool_id.strip_prefix("connector:")?;
    let (connector, operation) = rest.split_once(':')?;
    (connector.len() == 36 && !operation.is_empty()).then(|| (connector.to_string(), operation.to_string()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectorCapability {
    pub operation_id: String,
    pub action: OperationAction,
    pub title: String,
}

/// الواصف (البند 3). حقوله كما طُلبت، ولا حقل سرّ فيه.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectorDescriptor {
    pub connector_id: String,
    pub provider: ConnectorProvider,
    pub display_name_key: String,
    pub display_name: String,
    pub description_key: String,
    pub version: String,
    pub category: ConnectorCategory,
    pub capabilities: Vec<ConnectorCapability>,
    pub auth_mode: AuthMode,
    pub effects: Vec<ToolEffect>,
    pub risk_class: RiskClass,
    pub supports_read: bool,
    pub supports_write: bool,
    pub supports_webhook: bool,
    pub supports_polling: bool,
    pub supports_search: bool,
    pub supports_files: bool,
    pub enabled: bool,
    pub status: ConnectorStatus,
    pub provenance: ConnectorProvenance,
    pub egress_class: EgressClass,
}

/// حالة الاعتماد كما تعبر الحدّ (البند 39): مضبوط أم لا، ومن أين، ومتى. لا قيمة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectorAuthState {
    pub mode: AuthMode,
    pub required: bool,
    pub configured: bool,
    pub source: &'static str,
    /// مرجع السرّ لا قيمته. الاسم محايد عمدًا: قواعد نظافة العقد ترفض مفتاحًا يسمّي سرًّا.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment_variable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
    pub store_available: bool,
}

code_enum!(
    /// حالة استدعاء موصل.
    InvocationOutcome {
        Succeeded => "SUCCEEDED",
        Failed => "FAILED",
        Denied => "DENIED",
        Cancelled => "CANCELLED",
        Replayed => "REPLAYED",
        OutcomeUnknown => "OUTCOME_UNKNOWN",
    }
);

/// نتيجة موصل (البند 10). لا سرّ فيها ولا جسم خام: ملخّص محدود ومراجع موارد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectorResult {
    pub invocation_id: String,
    pub connector_id: String,
    pub operation: String,
    pub status: InvocationOutcome,
    pub result_summary: String,
    pub external_resource_refs: Vec<String>,
    pub usage: ConnectorUsage,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ConnectorErrorView>,
    /// من أين جاء المحتوى: خدمة خارجية، غير موثوق دائمًا.
    pub provenance: &'static str,
    pub effect: OperationAction,
    /// هل أكّدت الخدمة النتيجة (معرّف مورد)؟ نجاح HTTP وحده ليس تأكيدًا.
    pub outcome_confirmed: bool,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct ConnectorUsage {
    pub attempts: u32,
    pub requests: u32,
    pub response_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    pub cost_provenance: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectorErrorView {
    pub code: String,
    pub retryable: bool,
}

// ——— التحقق من الإعداد: يُطبَّق عند التسجيل وعند القراءة من المخزن.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigRefusal {
    pub code: &'static str,
    pub pointer: String,
}

impl ConfigRefusal {
    fn at(code: &'static str, pointer: impl Into<String>) -> Self {
        Self { code, pointer: pointer.into() }
    }
}

pub fn is_operation_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_lowercase()
        && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-'))
}

pub fn is_param_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty() && bytes.len() <= 40 && bytes[0].is_ascii_lowercase() && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// أسماء ترويسة مفتاح API المقبولة. قائمة مغلقة: الاسم يدخل الطلب اسمًا ثابتًا، ولا
/// تستطيع قيمة إعداد أن تسمّي ترويسة يملكها النقل أو الأمن (Host، Authorization، Cookie).
pub const API_KEY_HEADERS: &[&str] = &["X-API-Key", "Api-Key", "X-Auth-Token", "X-Access-Token", "Ocp-Apim-Subscription-Key"];

/// أسماء ترويسة مفتاح التكرار المقبولة.
pub const IDEMPOTENCY_HEADERS: &[&str] = &["Idempotency-Key", "X-Idempotency-Key"];

/// أسماء الترويسات الثابتة المقبولة (PHASE-05). ترويسة اعتماد أو مضيف أو كعكة لا تدخل هنا أبدًا.
pub const FIXED_HEADERS: &[&str] = &["Notion-Version"];

pub fn fixed_header(name: &str) -> Option<&'static str> {
    FIXED_HEADERS.iter().copied().find(|h| h.eq_ignore_ascii_case(name))
}

/// قيمة ترويسة ثابتة: رمز قصير (تاريخ إصدار أو اسم)، لا نصّ حرّ ولا سرّ.
pub fn is_fixed_header_value(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

pub fn api_key_header(name: &str) -> Option<&'static str> {
    API_KEY_HEADERS.iter().copied().find(|h| h.eq_ignore_ascii_case(name))
}

pub fn idempotency_header(name: &str) -> Option<&'static str> {
    IDEMPOTENCY_HEADERS.iter().copied().find(|h| h.eq_ignore_ascii_case(name))
}

pub fn is_environment_variable(value: &str) -> bool {
    value.strip_prefix("POLARIS_CONNECTOR_").is_some_and(|rest| !rest.is_empty() && rest.len() <= 40 && rest.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
}

/// معاملات قالب مسار بترتيبها، أو رفض إن لم يكن القالب آمن الشكل.
pub fn template_params(template: &str) -> Result<Vec<String>, &'static str> {
    if !template.starts_with('/') || template.len() > 200 {
        return Err("PATH_TEMPLATE_INVALID");
    }
    let mut params = Vec::new();
    for segment in template.split('/').skip(1) {
        if segment.is_empty() && template != "/" {
            return Err("PATH_TEMPLATE_INVALID");
        }
        if segment == "." || segment == ".." {
            return Err("PATH_TRAVERSAL");
        }
        if let Some(inner) = segment.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
            if !is_param_name(inner) {
                return Err("PATH_TEMPLATE_INVALID");
            }
            params.push(inner.to_string());
            continue;
        }
        if !segment.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~')) {
            return Err("PATH_TEMPLATE_INVALID");
        }
    }
    Ok(params)
}

pub fn validate_operation(op: &ConnectorOperation, allowed_paths: &[String], allowed_methods: &[HttpMethod], index: usize) -> Result<(), ConfigRefusal> {
    let at = |field: &str| format!("/operations/{index}/{field}");
    if !is_operation_id(&op.operation_id) {
        return Err(ConfigRefusal::at("OPERATION_ID_INVALID", at("operation_id")));
    }
    let title = op.title.trim();
    if title.is_empty() || title.chars().count() > 120 || title.chars().any(char::is_control) {
        return Err(ConfigRefusal::at("TITLE_INVALID", at("title")));
    }
    if !op.action.fits(op.method) {
        return Err(ConfigRefusal::at("METHOD_DOES_NOT_FIT_ACTION", at("method")));
    }
    if !allowed_methods.contains(&op.method) {
        return Err(ConfigRefusal::at("METHOD_NOT_ALLOWED", at("method")));
    }
    if !allowed_paths.contains(&op.path) {
        return Err(ConfigRefusal::at("PATH_NOT_ALLOWED", at("path")));
    }
    let placeholders = template_params(&op.path).map_err(|code| ConfigRefusal::at(code, at("path")))?;
    if op.params.len() > 16 {
        return Err(ConfigRefusal::at("TOO_MANY_PARAMS", at("params")));
    }
    let mut names: Vec<&str> = Vec::new();
    for (i, param) in op.params.iter().enumerate() {
        let p = |f: &str| format!("/operations/{index}/params/{i}/{f}");
        if !is_param_name(&param.name) || param.name == "idempotency_key" {
            return Err(ConfigRefusal::at("PARAM_NAME_INVALID", p("name")));
        }
        if names.contains(&param.name.as_str()) {
            return Err(ConfigRefusal::at("PARAM_DUPLICATE", p("name")));
        }
        names.push(&param.name);
        if param.location == ParamLocation::Path && (!placeholders.contains(&param.name) || !param.required || param.kind == ParamKind::Boolean) {
            return Err(ConfigRefusal::at("PATH_PARAM_INVALID", p("location")));
        }
        if param.location == ParamLocation::Body && op.method == HttpMethod::Get {
            return Err(ConfigRefusal::at("BODY_ON_GET", p("location")));
        }
        match param.kind {
            ParamKind::String if !param.max_length.is_some_and(|m| (1..=4000).contains(&m)) => {
                return Err(ConfigRefusal::at("STRING_BOUND_REQUIRED", p("max_length")));
            }
            ParamKind::Integer if !(param.minimum.is_some() && param.maximum.is_some() && param.minimum <= param.maximum) => {
                return Err(ConfigRefusal::at("INTEGER_BOUNDS_REQUIRED", p("minimum")));
            }
            ParamKind::Enum if param.allowed.is_empty() || param.allowed.len() > 32 || param.allowed.iter().any(|v| v.is_empty() || v.len() > 64) => {
                return Err(ConfigRefusal::at("ENUM_VALUES_REQUIRED", p("allowed")));
            }
            _ => {}
        }
    }
    if let Some(missing) = placeholders.iter().find(|name| !op.params.iter().any(|p| &p.name == *name && p.location == ParamLocation::Path)) {
        return Err(ConfigRefusal::at("PATH_PARAM_UNDECLARED", format!("/operations/{index}/path/{missing}")));
    }
    if let IdempotencySupport::Header { header } = &op.idempotency {
        if idempotency_header(header).is_none() || !op.action.is_side_effect() {
            return Err(ConfigRefusal::at("IDEMPOTENCY_HEADER_INVALID", at("idempotency")));
        }
    }
    for pointer in op.result_fields.iter().chain(op.resource_id_pointer.iter()).chain(op.cost_pointer.iter()) {
        if !pointer.starts_with('/') || pointer.len() > 120 || pointer.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err(ConfigRefusal::at("JSON_POINTER_INVALID", at("result_fields")));
        }
    }
    if op.result_fields.len() > 8 {
        return Err(ConfigRefusal::at("TOO_MANY_RESULT_FIELDS", at("result_fields")));
    }
    match (&op.cost_pointer, &op.cost_currency) {
        (Some(_), Some(c)) if crate::p06::cost::model::is_currency(c) => {}
        (None, None) => {}
        _ => return Err(ConfigRefusal::at("COST_REPORT_INVALID", at("cost_currency"))),
    }
    Ok(())
}

/// يتحقق من العنوان الأساسي وصنف خروجه. لا مستخدم ولا كلمة مرور ولا استعلام في العنوان.
pub fn validate_base_url(raw: &str, egress: EgressClass) -> Result<url::Url, &'static str> {
    if raw.len() > 300 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("BASE_URL_INVALID");
    }
    let parsed = url::Url::parse(raw).map_err(|_| "BASE_URL_INVALID")?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("CREDENTIALS_IN_URL");
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("QUERY_NOT_ALLOWED");
    }
    match egress {
        EgressClass::Loopback => {
            polaris_host_providers::net::endpoint::loopback(raw).map_err(|_| "HOST_NOT_LOOPBACK")?;
        }
        EgressClass::PublicHttps => {
            if parsed.scheme() != "https" {
                return Err("HTTPS_REQUIRED");
            }
            // عنوان حرفيّ خاص أو محلّي يُرفض الآن؛ والاسم يُحلّ ويُفحص عند كل اتصال.
            polaris_host_providers::net::endpoint::web_destination(&parsed, false).map_err(|e| match e {
                polaris_host_providers::net::EndpointError::PrivateAddress => "PRIVATE_ADDRESS",
                _ => "BASE_URL_INVALID",
            })?;
        }
        EgressClass::None => return Err("EGRESS_CLASS_INVALID"),
    }
    Ok(parsed)
}

pub fn validate_rest(config: &RestConfig, operations: &[ConnectorOperation], max_response_ceiling: u64) -> Result<(), ConfigRefusal> {
    validate_base_url(&config.base_url, config.egress_class).map_err(|code| ConfigRefusal::at(code, "/config/base_url"))?;
    if config.allowed_paths.is_empty() || config.allowed_paths.len() > 32 {
        return Err(ConfigRefusal::at("ALLOWED_PATHS_INVALID", "/config/allowed_paths"));
    }
    for (i, path) in config.allowed_paths.iter().enumerate() {
        template_params(path).map_err(|code| ConfigRefusal::at(code, format!("/config/allowed_paths/{i}")))?;
    }
    if config.allowed_methods.is_empty() {
        return Err(ConfigRefusal::at("ALLOWED_METHODS_INVALID", "/config/allowed_methods"));
    }
    match (config.auth_mode, &config.secret) {
        (AuthMode::Oauth2, _) => return Err(ConfigRefusal::at("OAUTH2_NOT_SUPPORTED", "/config/auth_mode")),
        (AuthMode::None, SecretSource::None) => {}
        (AuthMode::None, _) => return Err(ConfigRefusal::at("SECRET_WITHOUT_AUTH", "/config/secret")),
        (_, SecretSource::None) => return Err(ConfigRefusal::at("SECRET_SOURCE_REQUIRED", "/config/secret")),
        (_, SecretSource::Environment { variable }) if !is_environment_variable(variable) => {
            return Err(ConfigRefusal::at("ENVIRONMENT_VARIABLE_INVALID", "/config/secret/variable"))
        }
        _ => {}
    }
    if config.auth_mode == AuthMode::ApiKey && config.api_key_header.as_deref().and_then(api_key_header).is_none() {
        return Err(ConfigRefusal::at("API_KEY_HEADER_INVALID", "/config/api_key_header"));
    }
    if config.auth_mode == AuthMode::Basic
        && !config.basic_username.as_deref().is_some_and(|u| !u.is_empty() && u.len() <= 120 && !u.contains(':') && !u.chars().any(char::is_control))
    {
        return Err(ConfigRefusal::at("BASIC_USERNAME_INVALID", "/config/basic_username"));
    }
    if !(1_000..=60_000).contains(&config.timeout_ms) {
        return Err(ConfigRefusal::at("TIMEOUT_OUT_OF_RANGE", "/config/timeout_ms"));
    }
    if config.max_response_bytes < 1_024 || config.max_response_bytes > max_response_ceiling {
        return Err(ConfigRefusal::at("RESPONSE_LIMIT_OUT_OF_RANGE", "/config/max_response_bytes"));
    }
    if !(1..=600).contains(&config.rate.requests_per_minute) || !(1..=8).contains(&config.rate.max_concurrent) {
        return Err(ConfigRefusal::at("RATE_LIMIT_OUT_OF_RANGE", "/config/rate"));
    }
    if config.fixed_headers.len() > 4 || config.fixed_headers.iter().any(|h| fixed_header(&h.name).is_none() || !is_fixed_header_value(&h.value)) {
        return Err(ConfigRefusal::at("FIXED_HEADER_INVALID", "/config/fixed_headers"));
    }
    if operations.is_empty() || operations.len() > 32 {
        return Err(ConfigRefusal::at("OPERATIONS_INVALID", "/operations"));
    }
    // قائمة العناصر: مؤشّر واحد، وحتى ثمانية حقول، كلها مؤشّرات JSON قصيرة.
    let pointer_ok = |p: &String| p.starts_with('/') && p.len() <= 100 && !p.chars().any(char::is_control);
    for (i, op) in operations.iter().enumerate() {
        if op.list_pointer.as_ref().is_some_and(|p| !pointer_ok(p)) || op.item_fields.len() > 8 || !op.item_fields.iter().all(pointer_ok) || (op.list_pointer.is_none() && !op.item_fields.is_empty()) {
            return Err(ConfigRefusal::at("ITEM_FIELDS_INVALID", format!("/operations/{i}/item_fields")));
        }
    }
    let mut ids: Vec<&str> = Vec::new();
    for (i, op) in operations.iter().enumerate() {
        validate_operation(op, &config.allowed_paths, &config.allowed_methods, i)?;
        if ids.contains(&op.operation_id.as_str()) {
            return Err(ConfigRefusal::at("OPERATION_DUPLICATE", format!("/operations/{i}/operation_id")));
        }
        ids.push(&op.operation_id);
    }
    Ok(())
}

pub fn validate_display_name(name: &str) -> Result<String, ConfigRefusal> {
    let trimmed = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() || trimmed.chars().count() > 120 || trimmed.chars().any(char::is_control) {
        return Err(ConfigRefusal::at("DISPLAY_NAME_INVALID", "/display_name"));
    }
    Ok(trimmed)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn rest(base_url: &str, egress: EgressClass) -> RestConfig {
        RestConfig {
            base_url: base_url.into(),
            egress_class: egress,
            allowed_paths: vec!["/items".into(), "/items/{item_id}".into()],
            allowed_methods: vec![HttpMethod::Get, HttpMethod::Post],
            auth_mode: AuthMode::BearerToken,
            secret: SecretSource::Environment { variable: "POLARIS_CONNECTOR_TEST_TOKEN".into() },
            api_key_header: None,
            basic_username: None,
            timeout_ms: 5_000,
            max_response_bytes: 65_536,
            rate: RateLimit::default(),
            fixed_headers: Vec::new(),
        }
    }

    pub fn read_op() -> ConnectorOperation {
        ConnectorOperation {
            operation_id: "items.get".into(),
            title: "Get an item".into(),
            action: OperationAction::Read,
            method: HttpMethod::Get,
            path: "/items/{item_id}".into(),
            params: vec![OperationParam {
                name: "item_id".into(),
                location: ParamLocation::Path,
                kind: ParamKind::String,
                required: true,
                max_length: Some(64),
                minimum: None,
                maximum: None,
                allowed: vec![],
            }],
            idempotency: IdempotencySupport::None,
            resource_id_pointer: None,
            result_fields: vec!["/name".into()],
            cost_pointer: None,
            cost_currency: None,
            list_pointer: None,
            item_fields: Vec::new(),
        }
    }

    #[test]
    fn a_well_formed_rest_connector_validates() {
        assert_eq!(validate_rest(&rest("http://127.0.0.1:4100/api", EgressClass::Loopback), &[read_op()], 4 * 1024 * 1024), Ok(()));
    }

    #[test]
    fn an_endpoint_that_reaches_a_private_network_or_carries_credentials_is_refused() {
        let ops = [read_op()];
        for (url, egress, code) in [
            ("https://10.0.0.5/api", EgressClass::PublicHttps, "PRIVATE_ADDRESS"),
            ("https://169.254.169.254/latest", EgressClass::PublicHttps, "PRIVATE_ADDRESS"),
            ("https://127.0.0.1/api", EgressClass::PublicHttps, "PRIVATE_ADDRESS"),
            ("http://api.example.test/", EgressClass::PublicHttps, "HTTPS_REQUIRED"),
            ("https://user:pw@api.example.test/", EgressClass::PublicHttps, "CREDENTIALS_IN_URL"),
            ("https://api.example.test/?key=1", EgressClass::PublicHttps, "QUERY_NOT_ALLOWED"),
            ("http://192.168.1.1:80/", EgressClass::Loopback, "HOST_NOT_LOOPBACK"),
            ("http://localhost.evil.test:80/", EgressClass::Loopback, "HOST_NOT_LOOPBACK"),
            ("file:///C:/Windows", EgressClass::Loopback, "HOST_NOT_LOOPBACK"),
        ] {
            let refusal = validate_rest(&rest(url, egress), &ops, 4_194_304).unwrap_err();
            assert_eq!(refusal.code, code, "{url}");
        }
    }

    #[test]
    fn a_path_template_cannot_traverse_or_carry_a_query() {
        for bad in ["items", "/../admin", "/items/..", "/items?x=1", "/items/%2e%2e", "/a//b", "/{Bad}"] {
            assert!(template_params(bad).is_err(), "{bad} was accepted");
        }
        assert_eq!(template_params("/items/{item_id}/notes").unwrap(), vec!["item_id".to_string()]);
    }

    #[test]
    fn an_operation_must_stay_inside_the_allowed_paths_and_methods_and_fit_its_action() {
        let config = rest("http://127.0.0.1:1/", EgressClass::Loopback);
        let mut op = read_op();
        op.path = "/admin".into();
        assert_eq!(validate_operation(&op, &config.allowed_paths, &config.allowed_methods, 0).unwrap_err().code, "PATH_NOT_ALLOWED");
        let mut op = read_op();
        op.method = HttpMethod::Post;
        assert_eq!(validate_operation(&op, &config.allowed_paths, &config.allowed_methods, 0).unwrap_err().code, "METHOD_DOES_NOT_FIT_ACTION");
        let mut op = read_op();
        op.action = OperationAction::Delete;
        op.method = HttpMethod::Delete;
        assert_eq!(validate_operation(&op, &config.allowed_paths, &config.allowed_methods, 0).unwrap_err().code, "METHOD_NOT_ALLOWED");
        let mut op = read_op();
        op.params.clear();
        assert_eq!(validate_operation(&op, &config.allowed_paths, &config.allowed_methods, 0).unwrap_err().code, "PATH_PARAM_UNDECLARED");
    }

    #[test]
    fn oauth2_is_declared_but_not_accepted_and_a_secret_needs_a_bounded_source() {
        let mut config = rest("http://127.0.0.1:1/", EgressClass::Loopback);
        config.auth_mode = AuthMode::Oauth2;
        assert_eq!(validate_rest(&config, &[read_op()], 4_194_304).unwrap_err().code, "OAUTH2_NOT_SUPPORTED");
        config.auth_mode = AuthMode::BearerToken;
        config.secret = SecretSource::Environment { variable: "PATH".into() };
        assert_eq!(validate_rest(&config, &[read_op()], 4_194_304).unwrap_err().code, "ENVIRONMENT_VARIABLE_INVALID", "an arbitrary environment variable became a secret source");
        config.secret = SecretSource::None;
        assert_eq!(validate_rest(&config, &[read_op()], 4_194_304).unwrap_err().code, "SECRET_SOURCE_REQUIRED");
        config.auth_mode = AuthMode::ApiKey;
        config.secret = SecretSource::CredentialStore { secret_ref: "x".into() };
        config.api_key_header = Some("Authorization".into());
        assert_eq!(validate_rest(&config, &[read_op()], 4_194_304).unwrap_err().code, "API_KEY_HEADER_INVALID");
    }

    #[test]
    fn effects_follow_the_action_so_every_write_carries_an_external_side_effect() {
        for action in OperationAction::ALL {
            let effects = action.effects(EgressClass::PublicHttps);
            assert!(effects.contains(&ToolEffect::NetworkEgress));
            assert_eq!(effects.contains(&ToolEffect::ExternalSideEffect), *action != OperationAction::Read, "{}", action.as_str());
        }
        assert_eq!(OperationAction::Read.effects(EgressClass::None), vec![ToolEffect::ReadLocal]);
    }

    #[test]
    fn a_tool_identifier_round_trips() {
        let id = tool_id("11111111-1111-4111-8111-111111111111", "items.get");
        assert!(crate::p04::tool::is_valid_tool_id(&id), "{id} is not a valid tool identifier");
        assert_eq!(parse_tool_id(&id), Some(("11111111-1111-4111-8111-111111111111".into(), "items.get".into())));
        assert_eq!(parse_tool_id("polaris.web.navigate"), None);
    }
}
