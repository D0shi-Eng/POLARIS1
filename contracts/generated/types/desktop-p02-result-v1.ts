/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads of the Phase-02 operations. No field carries a credential, a raw provider body, a stack or an internal host path beyond the user's own workspace references.
 */
export type DesktopPhase02ResultPayloadV1 =
  | ProviderListResultV1
  | ProviderConfigureResultV1
  | ProviderCredentialResultV1
  | ProviderRefreshResultV1
  | ModelListResultV1
  | ModelConfigureResultV1
  | ModelPreferencesSetResultV1
  | ModelInvokeResultV1
  | ModelCancelResultV1
  | ProjectListResultV1
  | ProjectGetResultV1
  | ProjectMutationResultV1
  | ContextSourceResultV1
  | ContextPreviewResultV1
  | ContextAssembleResultV1;
/**
 * Identifier of a registered provider instance. Only ids the host registered are ever routed; an unknown id is refused by the host, not merely absent.
 */
export type ProviderId = string;
/**
 * Closed provider classes. A new class is an explicit registration, not a string. OPENAI_COMPATIBLE_API and CUSTOM_OPENAI_COMPATIBLE were added by ADR-037. CLAUDE_CLI and CODEX_CLI (2026-11-12) reach a remote model through a command-line tool installed on this computer.
 */
export type ProviderKind =
  | "LOCAL_OPENAI_COMPATIBLE"
  | "OLLAMA"
  | "LM_STUDIO"
  | "OPENAI"
  | "ANTHROPIC"
  | "GOOGLE"
  | "OPENROUTER"
  | "OPENAI_COMPATIBLE_API"
  | "CUSTOM_OPENAI_COMPATIBLE"
  | "CLAUDE_CLI"
  | "CODEX_CLI";
/**
 * Localization key, not localized prose. The contract carries the key; the renderer resolves the text. A translated string never crosses this boundary.
 */
export type DisplayKey = string;
/**
 * Protocol family. LOCAL_CLI: a local command-line process that makes the remote connection itself.
 */
export type EndpointType =
  "OPENAI_COMPATIBLE" | "OLLAMA_NATIVE" | "ANTHROPIC_MESSAGES" | "GOOGLE_GENERATIVE_LANGUAGE" | "LOCAL_CLI";
/**
 * Only officially supported authentication. OAuth is not modelled until a provider offers a supported desktop flow. CLI_LOGIN: the command-line tool holds its own sign-in; the host never reads or stores a credential for it.
 */
export type AuthMode = "NO_AUTH_LOCAL" | "API_KEY" | "OPTIONAL_API_KEY" | "CLI_LOGIN";
/**
 * Whether requests leave this computer.
 */
export type Locality = "LOCAL" | "REMOTE";
/**
 * LOOPBACK_PROVIDER_ACCESS reaches 127.0.0.1 or ::1 only. REMOTE_EGRESS reaches the provider's fixed https host only.
 */
export type NetworkClass = "LOOPBACK_PROVIDER_ACCESS" | "REMOTE_EGRESS";
/**
 * Where the host found a credential. The value itself never crosses.
 */
export type CredentialSource = "NONE" | "CREDENTIAL_STORE" | "ENVIRONMENT";
/**
 * UNKNOWN is a first-class answer and is never treated as SUPPORTED.
 */
export type Support = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
/**
 * Where a fact comes from. An estimated or reported value is never presented as measured.
 */
export type Provenance = "PROVIDER_REPORTED" | "LOCALLY_MEASURED" | "STATIC_DESCRIPTOR" | "ESTIMATED" | "UNKNOWN";
/**
 * Measured provider health. A timeout is UNKNOWN, not UNREACHABLE.
 */
export type HealthState =
  | "HEALTHY"
  | "DEGRADED"
  | "UNREACHABLE"
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "MISCONFIGURED"
  | "UNKNOWN";
/**
 * Machine reason for the health state.
 */
export type HealthReason =
  | "OK"
  | "NOT_CHECKED"
  | "PROVIDER_DISABLED"
  | "ENDPOINT_NOT_CONFIGURED"
  | "CREDENTIAL_MISSING"
  | "CREDENTIAL_STORE_UNAVAILABLE"
  | "ENDPOINT_REJECTED"
  | "CREDENTIAL_REJECTED"
  | "CONNECTION_REFUSED"
  | "NETWORK_UNREACHABLE"
  | "NAME_RESOLUTION_FAILED"
  | "TLS_FAILURE"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "PROTOCOL_MISMATCH"
  | "RESPONSE_INVALID"
  | "EGRESS_DENIED";
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
/**
 * Presence in the known default locations only; NOT_DETECTED is not NOT_INSTALLED.
 */
export type InstallationState = "DETECTED" | "NOT_DETECTED" | "NOT_APPLICABLE" | "UNKNOWN";
/**
 * Whether a local server answered on its endpoint at the last check.
 */
export type RuntimeState = "RUNNING" | "NOT_RUNNING" | "NOT_APPLICABLE" | "UNKNOWN";
/**
 * Normalised provider outcome. Raw provider bodies never cross.
 */
export type ProviderOutcomeCode =
  | "PROVIDER_UNREACHABLE"
  | "PROVIDER_TIMEOUT"
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_CAPABILITY"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_INTERNAL_ERROR"
  | "CANCELLED"
  | "EGRESS_DENIED"
  | "CREDENTIAL_STORE_UNAVAILABLE"
  | "ENDPOINT_NOT_CONFIGURED"
  | "PROVIDER_DISABLED";
/**
 * Stable model identity: <provider_id>:<provider_model_id>. Quotes, angle brackets, backslash, backtick and whitespace are unrepresentable.
 */
export type ModelId = string;
/**
 * The identifier the provider itself uses.
 */
export type ProviderModelId = string;
/**
 * What the provider reports the model is for.
 */
export type ModelKind = "CHAT" | "EMBEDDING" | "UNKNOWN";
/**
 * Whether a local runtime reports the model as loaded. Polaris never loads or unloads a model itself.
 */
export type LoadedState = "LOADED" | "NOT_LOADED" | "UNKNOWN";
/**
 * Bounded capability vocabulary. There is no free-string capability.
 */
export type ModelCapability =
  | "TEXT_INPUT"
  | "TEXT_OUTPUT"
  | "VISION_INPUT"
  | "AUDIO_INPUT"
  | "AUDIO_OUTPUT"
  | "TOOLS"
  | "JSON"
  | "JSON_SCHEMA"
  | "EMBEDDINGS"
  | "REASONING"
  | "STREAMING";
/**
 * AVAILABLE: present in the latest listing. MISSING: listed before, absent now; its configuration is kept. PROVIDER_UNREACHABLE: the last refresh could not list.
 */
export type ModelAvailability = "AVAILABLE" | "MISSING" | "PROVIDER_UNREACHABLE" | "UNKNOWN";
/**
 * Stable model identity: <provider_id>:<provider_model_id>. Quotes, angle brackets, backslash, backtick and whitespace are unrepresentable.
 */
export type ModelId1 = string;
/**
 * The reasoning effort the user chose for every provider and model. Absent: each provider's default.
 */
export type ReasoningEffortLevel = "LOW" | "MEDIUM" | "HIGH" | "MAX";
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
/**
 * Phase-02 routing modes. There is no automatic quality, cost or ensemble routing.
 */
export type RoutingMode = "MANUAL" | "DEFAULT_MODEL" | "CAPABILITY_MATCH";
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * Normal removal is archival. Permanent deletion is not offered in Phase-02.
 */
export type ProjectStatus = "ACTIVE" | "ARCHIVED";
/**
 * Project language, one of the nine architectural locales.
 */
export type Language = "ar" | "en" | "de" | "fr" | "ru" | "zh" | "ko" | "ja" | "es";
/**
 * Context source type.
 */
export type SourceType = "WORKSPACE_ROOT" | "FILE" | "FOLDER" | "TEXT_NOTE" | "SYSTEM_CONTEXT" | "USER_INSTRUCTION";
/**
 * USER_AUTHORIZED_RESOURCE is not a trusted instruction: permission to read a file does not make its content authoritative.
 */
export type TrustClass =
  "DIRECT_USER_INSTRUCTION" | "USER_AUTHORIZED_RESOURCE" | "UNTRUSTED_CONTENT" | "SYSTEM_GENERATED" | "MODEL_GENERATED";
/**
 * Content classification. Only text classes are ever read as text.
 */
export type ContentClass =
  "SOURCE_CODE" | "DOCUMENTATION" | "CONFIGURATION" | "DATA" | "IMAGE" | "AUDIO" | "BINARY" | "UNKNOWN";
/**
 * Measured availability of a source at its last check.
 */
export type SourceAvailability = "AVAILABLE" | "MISSING" | "CHANGED" | "OUT_OF_SCOPE" | "NOT_READABLE" | "UNKNOWN";
/**
 * Why an item is in the bundle.
 */
export type InclusionReason = "USER_SELECTED" | "FOLDER_MEMBER" | "WORKSPACE_MEMBER";
/**
 * Why a candidate was left out. Nothing is left out silently.
 */
export type OmissionReason =
  | "BUDGET_EXCEEDED"
  | "MAX_FILES_EXCEEDED"
  | "NOT_TEXT"
  | "INVALID_ENCODING"
  | "SENSITIVE_FILE_EXCLUDED"
  | "OUT_OF_SCOPE"
  | "MISSING"
  | "NOT_READABLE"
  | "REPARSE_POINT"
  | "SOURCE_REMOVED"
  | "UNKNOWN_SOURCE"
  | "TOO_LARGE_TO_READ";

export interface ProviderListResultV1 {
  /**
   * @minItems 0
   * @maxItems 128
   */
  providers: ProviderDescriptorView[];
}
/**
 * Facts about one provider. Nothing here is guessed, and nothing here is secret.
 */
export interface ProviderDescriptorView {
  provider_id: ProviderId;
  kind: ProviderKind;
  display_name: string;
  display_name_key: DisplayKey;
  endpoint_type: EndpointType;
  auth_mode: AuthMode;
  locality: Locality;
  network_class: NetworkClass;
  /**
   * Display form. Local endpoints are loopback only.
   */
  endpoint?: string;
  endpoint_configurable: boolean;
  enabled: boolean;
  configured: boolean;
  key_status: CredentialState;
  capabilities: ProviderCapabilities;
  health: ProviderHealth;
  models: ModelCounts;
}
/**
 * Credential facts only. There is no field that could carry a credential value.
 */
export interface CredentialState {
  required: boolean;
  configured: boolean;
  source: CredentialSource;
  reference?: string;
  store_available: boolean;
  environment_variable?: string;
}
/**
 * Protocol-level capabilities. Per-model capabilities are read from the model.
 */
export interface ProviderCapabilities {
  supports_streaming: CapabilityClaim;
  supports_model_listing: CapabilityClaim;
  supports_health_check: CapabilityClaim;
  supports_chat: CapabilityClaim;
  supports_embeddings: CapabilityClaim;
  supports_vision: CapabilityClaim;
  supports_audio_input: CapabilityClaim;
  supports_audio_output: CapabilityClaim;
  supports_tools: CapabilityClaim;
  supports_json_schema: CapabilityClaim;
  supports_system_prompt: CapabilityClaim;
  supports_reasoning_control: CapabilityClaim;
}
export interface CapabilityClaim {
  support: Support;
  provenance: Provenance;
}
export interface ProviderHealth {
  state: HealthState;
  reason_code: HealthReason;
  checked_at?: Timestamp;
  latency?: MeasuredMilliseconds;
  installation: InstallationState;
  runtime: RuntimeState;
}
/**
 * A duration measured on this host.
 */
export interface MeasuredMilliseconds {
  value: number;
  provenance: "LOCALLY_MEASURED";
}
export interface ModelCounts {
  discovered: number;
  enabled: number;
  available: number;
}
export interface ProviderConfigureResultV1 {
  provider: ProviderDescriptorView;
}
/**
 * The credential outcome. The value never crosses.
 */
export interface ProviderCredentialResultV1 {
  provider_id: ProviderId;
  outcome: "STORED" | "CLEARED" | "PROMPT_CANCELLED" | "STORE_UNAVAILABLE" | "NOT_APPLICABLE" | "NOTHING_TO_CLEAR";
  key_status: CredentialState;
}
export interface ProviderRefreshResultV1 {
  /**
   * @minItems 1
   * @maxItems 16
   */
  results:
    | [ProviderRefreshEntry]
    | [ProviderRefreshEntry, ProviderRefreshEntry]
    | [ProviderRefreshEntry, ProviderRefreshEntry, ProviderRefreshEntry]
    | [ProviderRefreshEntry, ProviderRefreshEntry, ProviderRefreshEntry, ProviderRefreshEntry]
    | [ProviderRefreshEntry, ProviderRefreshEntry, ProviderRefreshEntry, ProviderRefreshEntry, ProviderRefreshEntry]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ]
    | [
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry,
        ProviderRefreshEntry
      ];
}
export interface ProviderRefreshEntry {
  provider_id: ProviderId;
  health: ProviderHealth;
  models: ModelCounts;
  outcome?: ProviderOutcome;
  duration: MeasuredMilliseconds;
}
export interface ProviderOutcome {
  code: ProviderOutcomeCode;
  retryable: boolean;
}
export interface ModelListResultV1 {
  /**
   * @minItems 0
   * @maxItems 4000
   */
  models: ModelView[];
  preferences: ModelPreferences;
}
/**
 * A discovered model. DISCOVERED, ENABLED, AVAILABLE and LOADED are four separate facts.
 */
export interface ModelView {
  model_id: ModelId;
  provider_id: ProviderId;
  provider_model_id: ProviderModelId;
  display_name: FactText;
  kind: ModelKind;
  family: FactText;
  vendor: FactText;
  architecture: FactText;
  quantization: FactText;
  parameter_count: FactText;
  context_window: FactInteger;
  max_output_tokens: FactInteger;
  loaded_state: LoadedFact;
  /**
   * @minItems 11
   * @maxItems 11
   */
  capabilities: [
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim,
    ModelCapabilityClaim
  ];
  pricing?: Pricing;
  locality: Locality;
  enabled: boolean;
  availability: ModelAvailability;
  stale: boolean;
  is_default: boolean;
  provider_enabled: boolean;
  provider_health: HealthState;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
}
export interface FactText {
  value?: string;
  provenance: Provenance;
}
export interface FactInteger {
  value?: number;
  provenance: Provenance;
}
export interface LoadedFact {
  value: LoadedState;
  provenance: Provenance;
}
export interface ModelCapabilityClaim {
  capability: ModelCapability;
  support: Support;
  provenance: Provenance;
}
/**
 * Provider-reported price per token, as the decimal string the provider sent. Never computed or estimated here.
 */
export interface Pricing {
  input_price_usd: string;
  output_price_usd: string;
  unit: "PER_TOKEN";
  provenance: "PROVIDER_REPORTED";
}
export interface ModelPreferences {
  default_model_id?: ModelId;
  review_model_id?: ModelId;
  monitor_model_id?: ModelId1;
  reasoning_effort?: ReasoningEffortLevel;
}
export interface ModelConfigureResultV1 {
  model: ModelView;
}
export interface ModelPreferencesSetResultV1 {
  preferences: ModelPreferences;
}
export interface ModelInvokeResultV1 {
  invocation_id: Uuid;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "DENIED" | "TIMED_OUT";
  routing: RoutingDecisionView;
  egress: EgressDecisionView;
  output?: InvocationOutputView;
  finish_reason?: "STOP" | "LENGTH" | "CONTENT_FILTER" | "TOOL_CALL" | "CANCELLED" | "UNKNOWN";
  usage?: UsageView;
  timing: InvocationTiming;
  context?: InvocationContextSummary;
  error?: ProviderOutcome;
  provider_request_id?: string;
}
export interface RoutingDecisionView {
  mode: RoutingMode;
  decision: "SELECTED" | "DENIED";
  model_id?: ModelId;
  provider_id?: ProviderId;
  locality?: Locality;
  /**
   * @minItems 1
   * @maxItems 8
   */
  reason_codes:
    | [
        | "MANUAL_SELECTION"
        | "PROJECT_DEFAULT"
        | "USER_DEFAULT"
        | "SOLE_ENABLED_MODEL"
        | "CAPABILITY_MATCH"
        | "NO_MODEL_CONFIGURED"
        | "MODEL_NOT_FOUND"
        | "MODEL_DISABLED"
        | "MODEL_UNAVAILABLE"
        | "MODEL_NOT_CHAT"
        | "PROVIDER_DISABLED"
        | "PROVIDER_UNHEALTHY"
        | "CAPABILITY_MISSING"
        | "CAPABILITY_UNKNOWN"
        | "NO_CANDIDATE"
        | "CONTEXT_TOO_LARGE"
        | "PROJECT_NOT_FOUND"
        | "PROJECT_ARCHIVED"
        | "SOURCE_NOT_IN_PROJECT"
        | "CANCELLED_BEFORE_START"
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ]
    | [
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        ),
        (
          | "MANUAL_SELECTION"
          | "PROJECT_DEFAULT"
          | "USER_DEFAULT"
          | "SOLE_ENABLED_MODEL"
          | "CAPABILITY_MATCH"
          | "NO_MODEL_CONFIGURED"
          | "MODEL_NOT_FOUND"
          | "MODEL_DISABLED"
          | "MODEL_UNAVAILABLE"
          | "MODEL_NOT_CHAT"
          | "PROVIDER_DISABLED"
          | "PROVIDER_UNHEALTHY"
          | "CAPABILITY_MISSING"
          | "CAPABILITY_UNKNOWN"
          | "NO_CANDIDATE"
          | "CONTEXT_TOO_LARGE"
          | "PROJECT_NOT_FOUND"
          | "PROJECT_ARCHIVED"
          | "SOURCE_NOT_IN_PROJECT"
          | "CANCELLED_BEFORE_START"
        )
      ];
  candidates_considered: number;
}
export interface EgressDecisionView {
  network_class?: NetworkClass;
  decision: "ALLOWED" | "DENIED" | "NOT_EVALUATED";
  reason: "LOOPBACK" | "REMOTE_ALLOWED" | "ROUTING_DENIED";
  context_attached: boolean;
}
/**
 * Model output is tainted data with no authority.
 */
export interface InvocationOutputView {
  text: string;
  trust_class: "MODEL_GENERATED";
  authority: "NONE";
}
export interface UsageView {
  input_tokens: FactInteger;
  output_tokens: FactInteger;
}
export interface InvocationTiming {
  total: MeasuredMilliseconds;
  first_byte?: MeasuredMilliseconds;
  streamed: boolean;
}
export interface InvocationContextSummary {
  items: number;
  omitted: number;
  estimated_tokens: TokenEstimate;
  truncated: boolean;
  bundle_digest: Sha256Hex;
}
/**
 * A token count with its provenance. An estimate is labelled ESTIMATED.
 */
export interface TokenEstimate {
  value: number;
  provenance: "ESTIMATED" | "PROVIDER_REPORTED";
  method: "UTF8_BYTES_DIV_4" | "PROVIDER_TOKENIZER";
}
export interface ModelCancelResultV1 {
  invocation_id: Uuid;
  outcome: "CANCELLATION_REQUESTED" | "ALREADY_FINISHED" | "PRE_CANCELLED";
}
export interface ProjectListResultV1 {
  /**
   * @minItems 0
   * @maxItems 1000
   */
  projects: ProjectView[];
}
export interface ProjectView {
  project_id: Uuid;
  /**
   * Display name.
   */
  name: string;
  /**
   * Free description. It is data, never an instruction.
   */
  description: string;
  status: ProjectStatus;
  language: Language;
  /**
   * An absolute local directory. A context scope reference, never a filesystem grant.
   */
  workspace_root?: string;
  default_model_id?: ModelId;
  version: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  context_source_count: number;
}
export interface ProjectGetResultV1 {
  project: ProjectView;
  /**
   * @minItems 0
   * @maxItems 512
   */
  sources: ContextSourceView[];
  effective_model_id?: ModelId;
  effective_model_origin: "PROJECT_DEFAULT" | "USER_DEFAULT" | "NONE";
}
export interface ContextSourceView {
  source_id: Uuid;
  project_id: Uuid;
  source_type: SourceType;
  reference: string;
  display_name: string;
  trust_class: TrustClass;
  content_class: ContentClass;
  added_at: Timestamp;
  last_seen_at?: Timestamp;
  availability: SourceAvailability;
  digest?: Sha256Hex;
  byte_count?: number;
}
export interface ProjectMutationResultV1 {
  project: ProjectView;
}
export interface ContextSourceResultV1 {
  source: ContextSourceView;
}
/**
 * Bounded metadata and a bounded text preview. The preview is untrusted content.
 */
export interface ContextPreviewResultV1 {
  source: ContextSourceView;
  preview?: string;
  preview_truncated?: boolean;
  encoding: "UTF8" | "NOT_TEXT" | "INVALID" | "NONE";
  /**
   * @minItems 0
   * @maxItems 200
   */
  entries?: string[];
  modified_at?: Timestamp;
  preview_trust_class: "UNTRUSTED_CONTENT";
}
export interface ContextAssembleResultV1 {
  bundle: ContextBundleView;
}
/**
 * Metadata of a deterministic context bundle. Content stays in the host.
 */
export interface ContextBundleView {
  project_id: Uuid;
  bundle_digest: Sha256Hex;
  /**
   * @minItems 0
   * @maxItems 256
   */
  items: ContextItem[];
  /**
   * @minItems 0
   * @maxItems 512
   */
  omitted: OmittedItem[];
  instruction_trust_class: "DIRECT_USER_INSTRUCTION";
  total_bytes: number;
  estimated_tokens: TokenEstimate;
  budget: ContextBudget;
  truncated: boolean;
}
export interface ContextItem {
  source_id: Uuid;
  item_reference: string;
  trust_class: TrustClass;
  content_class: ContentClass;
  inclusion_reason: InclusionReason;
  digest: Sha256Hex;
  byte_count: number;
  included_bytes: number;
  estimated_tokens: TokenEstimate;
  truncated: boolean;
}
export interface OmittedItem {
  source_id: Uuid;
  item_reference: string;
  reason: OmissionReason;
}
/**
 * The hard budget actually applied.
 */
export interface ContextBudget {
  max_sources: number;
  max_files: number;
  max_total_bytes: number;
  max_single_source_bytes: number;
  max_tokens: number;
  context_window_known: boolean;
  reserved_output_tokens: number;
}
