// مفردات أحداث التدقيق في Phase-02.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditEventType {
    ProviderConfigured,
    ProviderEnabled,
    ProviderDisabled,
    ProviderCredentialSet,
    ProviderCredentialCleared,
    ProviderRefreshed,
    ModelEnabled,
    ModelDisabled,
    DefaultModelChanged,
    RoutingPreferenceChanged,
    ProjectCreated,
    ProjectUpdated,
    ProjectArchived,
    ProjectRestored,
    ContextSourceAdded,
    ContextSourceRemoved,
    InvocationInitiated,
    RemoteInvocationInitiated,
    InvocationCompleted,
    InvocationFailed,
    InvocationCancelled,
    InvocationDenied,
    // Phase-03: دورة حياة المهمّة. لا تفصيل سرّي ولا سياق كامل يدخل هذه الأحداث.
    MissionCreated,
    MissionStarted,
    MissionCompleted,
    MissionCancelled,
    MissionFailed,
    MissionBlocked,
    /// خطة 2026-10-07 (ADR-041): مدقّق ثوابت الحالة أصلح مهمّة (عند الإقلاع أو الحفظ).
    StateInvariantRepaired,
    /// سلسلة تجزئة انكسرت، أو ملف محميّ تغيّر.
    TamperDetected,
    // Phase-04: المهارات والأدوات وخوادم MCP والموافقات. لا حجج أداة ولا ناتج خام
    // يدخل هذه الأحداث: معرّفات وبصمات وتصنيفات فقط.
    SkillConfigured,
    ToolInvoked,
    ToolCompleted,
    ToolFailed,
    ToolDenied,
    ToolApprovalRequested,
    ToolApprovalDecided,
    McpServerRegistered,
    McpServerConfigured,
    McpToolsDiscovered,
    DelegationRequested,
    DelegationCompleted,
    // Phase-05: الذاكرة وجلسات المتصفّح وسطح المكتب. معرّفات وحالات وبصمات فقط:
    // لا محتوى ذاكرة، ولا نصّ صفحة، ولا بكسلات شاشة.
    MemoryPromoted,
    MemoryRejected,
    MemoryDeleted,
    BrowserSessionOpened,
    BrowserSessionClosed,
    ComputerSessionOpened,
    ComputerSessionClosed,
    ComputerTargetGranted,
    ComputerTargetRevoked,
    // Phase-06: الإعدادات والموصلات والكلفة والرصد. معرّفات ورموز وبصمات فقط: لا
    // قيمة سرّ، ولا جسم استجابة، ولا حمولة موصل كاملة.
    ConfigChanged,
    ConfigReset,
    ConnectorRegistered,
    ConnectorConfigured,
    ConnectorRemoved,
    ConnectorCredentialSet,
    ConnectorCredentialCleared,
    ConnectorImportProposed,
    ConnectorImportApproved,
    ConnectorInvoked,
    ConnectorCompleted,
    ConnectorFailed,
    ConnectorDenied,
    ConnectorHealthChecked,
    BudgetSet,
    BudgetRemoved,
    BudgetExceeded,
    PricingSet,
    PricingRemoved,
    DiagnosticsExported,
    // Phase-08: بيئة التنفيذ والمخرجات والمرفقات والمجدول والتكاملات.
    ExecutionRunCompleted,
    ExecutionSandboxReleased,
    ArtifactCreated,
    AttachmentImported,
    WorkspaceExported,
    WorkspaceOutputChanged,
    ScheduleChanged,
    ScheduleTriggered,
    OAuthConnectionChanged,
    ShareGrantChanged,
    PublicationDecided,
    SkillPackageImported,
    DeviceBundleExported,
    TranscriptionCompleted,
    // إدارة المحادثات والمشاريع من قائمة «⋯» (ADR-031). معرّفات وأعداد فقط، لا عنوان ولا نصّ.
    ConversationChanged,
    ConversationDeleted,
    ProjectDeleted,
}

impl AuditEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProviderConfigured => "PROVIDER_CONFIGURED",
            Self::ProviderEnabled => "PROVIDER_ENABLED",
            Self::ProviderDisabled => "PROVIDER_DISABLED",
            Self::ProviderCredentialSet => "PROVIDER_CREDENTIAL_SET",
            Self::ProviderCredentialCleared => "PROVIDER_CREDENTIAL_CLEARED",
            Self::ProviderRefreshed => "PROVIDER_REFRESHED",
            Self::ModelEnabled => "MODEL_ENABLED",
            Self::ModelDisabled => "MODEL_DISABLED",
            Self::DefaultModelChanged => "DEFAULT_MODEL_CHANGED",
            Self::RoutingPreferenceChanged => "ROUTING_PREFERENCE_CHANGED",
            Self::ProjectCreated => "PROJECT_CREATED",
            Self::ProjectUpdated => "PROJECT_UPDATED",
            Self::ProjectArchived => "PROJECT_ARCHIVED",
            Self::ProjectRestored => "PROJECT_RESTORED",
            Self::ContextSourceAdded => "CONTEXT_SOURCE_ADDED",
            Self::ContextSourceRemoved => "CONTEXT_SOURCE_REMOVED",
            Self::InvocationInitiated => "INVOCATION_INITIATED",
            Self::RemoteInvocationInitiated => "REMOTE_INVOCATION_INITIATED",
            Self::InvocationCompleted => "INVOCATION_COMPLETED",
            Self::InvocationFailed => "INVOCATION_FAILED",
            Self::InvocationCancelled => "INVOCATION_CANCELLED",
            Self::InvocationDenied => "INVOCATION_DENIED",
            Self::MissionCreated => "MISSION_CREATED",
            Self::MissionStarted => "MISSION_STARTED",
            Self::MissionCompleted => "MISSION_COMPLETED",
            Self::MissionCancelled => "MISSION_CANCELLED",
            Self::MissionFailed => "MISSION_FAILED",
            Self::MissionBlocked => "MISSION_BLOCKED",
            Self::StateInvariantRepaired => "STATE_INVARIANT_REPAIRED",
            Self::TamperDetected => "TAMPER_DETECTED",
            Self::SkillConfigured => "SKILL_CONFIGURED",
            Self::ToolInvoked => "TOOL_INVOKED",
            Self::ToolCompleted => "TOOL_COMPLETED",
            Self::ToolFailed => "TOOL_FAILED",
            Self::ToolDenied => "TOOL_DENIED",
            Self::ToolApprovalRequested => "TOOL_APPROVAL_REQUESTED",
            Self::ToolApprovalDecided => "TOOL_APPROVAL_DECIDED",
            Self::McpServerRegistered => "MCP_SERVER_REGISTERED",
            Self::McpServerConfigured => "MCP_SERVER_CONFIGURED",
            Self::McpToolsDiscovered => "MCP_TOOLS_DISCOVERED",
            Self::DelegationRequested => "DELEGATION_REQUESTED",
            Self::DelegationCompleted => "DELEGATION_COMPLETED",
            Self::MemoryPromoted => "MEMORY_PROMOTED",
            Self::MemoryRejected => "MEMORY_REJECTED",
            Self::MemoryDeleted => "MEMORY_DELETED",
            Self::BrowserSessionOpened => "BROWSER_SESSION_OPENED",
            Self::BrowserSessionClosed => "BROWSER_SESSION_CLOSED",
            Self::ComputerSessionOpened => "COMPUTER_SESSION_OPENED",
            Self::ComputerSessionClosed => "COMPUTER_SESSION_CLOSED",
            Self::ComputerTargetGranted => "COMPUTER_TARGET_GRANTED",
            Self::ComputerTargetRevoked => "COMPUTER_TARGET_REVOKED",
            Self::ConfigChanged => "CONFIG_CHANGED",
            Self::ConfigReset => "CONFIG_RESET",
            Self::ConnectorRegistered => "CONNECTOR_REGISTERED",
            Self::ConnectorConfigured => "CONNECTOR_CONFIGURED",
            Self::ConnectorRemoved => "CONNECTOR_REMOVED",
            Self::ConnectorCredentialSet => "CONNECTOR_CREDENTIAL_SET",
            Self::ConnectorCredentialCleared => "CONNECTOR_CREDENTIAL_CLEARED",
            Self::ConnectorImportProposed => "CONNECTOR_IMPORT_PROPOSED",
            Self::ConnectorImportApproved => "CONNECTOR_IMPORT_APPROVED",
            Self::ConnectorInvoked => "CONNECTOR_INVOKED",
            Self::ConnectorCompleted => "CONNECTOR_COMPLETED",
            Self::ConnectorFailed => "CONNECTOR_FAILED",
            Self::ConnectorDenied => "CONNECTOR_DENIED",
            Self::ConnectorHealthChecked => "CONNECTOR_HEALTH_CHECKED",
            Self::BudgetSet => "BUDGET_SET",
            Self::BudgetRemoved => "BUDGET_REMOVED",
            Self::BudgetExceeded => "BUDGET_EXCEEDED",
            Self::PricingSet => "PRICING_SET",
            Self::PricingRemoved => "PRICING_REMOVED",
            Self::DiagnosticsExported => "DIAGNOSTICS_EXPORTED",
            Self::ExecutionRunCompleted => "EXECUTION_RUN_COMPLETED",
            Self::ExecutionSandboxReleased => "EXECUTION_SANDBOX_RELEASED",
            Self::ArtifactCreated => "ARTIFACT_CREATED",
            Self::AttachmentImported => "ATTACHMENT_IMPORTED",
            Self::WorkspaceExported => "WORKSPACE_EXPORTED",
            Self::WorkspaceOutputChanged => "WORKSPACE_OUTPUT_CHANGED",
            Self::ScheduleChanged => "SCHEDULE_CHANGED",
            Self::ScheduleTriggered => "SCHEDULE_TRIGGERED",
            Self::OAuthConnectionChanged => "OAUTH_CONNECTION_CHANGED",
            Self::ShareGrantChanged => "SHARE_GRANT_CHANGED",
            Self::PublicationDecided => "PUBLICATION_DECIDED",
            Self::SkillPackageImported => "SKILL_PACKAGE_IMPORTED",
            Self::DeviceBundleExported => "DEVICE_BUNDLE_EXPORTED",
            Self::TranscriptionCompleted => "TRANSCRIPTION_COMPLETED",
            Self::ConversationChanged => "CONVERSATION_CHANGED",
            Self::ConversationDeleted => "CONVERSATION_DELETED",
            Self::ProjectDeleted => "PROJECT_DELETED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditOutcome {
    Success,
    Failure,
    Denied,
    Cancelled,
    Started,
}

impl AuditOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Success => "SUCCESS",
            Self::Failure => "FAILURE",
            Self::Denied => "DENIED",
            Self::Cancelled => "CANCELLED",
            Self::Started => "STARTED",
        }
    }
}

/// سجل واحد قبل أن يُربط بالسلسلة.
#[derive(Debug, Clone)]
pub struct AuditRecord {
    pub event_type: AuditEventType,
    pub subject_kind: &'static str,
    pub subject_id: String,
    pub outcome: AuditOutcome,
    /// تفصيل محدود: معرّفات وأطوال وتصنيفات. لا أسرار ولا نصوص كاملة.
    pub detail: Value,
}

impl AuditRecord {
    pub fn new(event_type: AuditEventType, subject_kind: &'static str, subject_id: impl Into<String>, outcome: AuditOutcome, detail: Value) -> Self {
        Self { event_type, subject_kind, subject_id: subject_id.into(), outcome, detail }
    }
}
