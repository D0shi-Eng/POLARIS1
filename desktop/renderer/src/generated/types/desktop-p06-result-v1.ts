/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads the thirty Phase-06 operations return. No result carries a credential value, a raw connector body, a free URL chosen by an agent, or an unlabelled estimate.
 */
export type DesktopPhase06ResultPayloadV1 =
  | ConnectorListResultV1
  | ConnectorGetResultV1
  | ConnectorResultV1
  | ConnectorRemoveResultV1
  | ConnectorTestResultV1
  | ConnectorCredentialResultV1
  | ConnectorOpenapiImportResultV1
  | ConnectorPresetListResultV1
  | UsageSummaryResultV1
  | UsageListResultV1
  | BudgetListResultV1
  | BudgetSetResultV1
  | BudgetRemoveResultV1
  | PricingListResultV1
  | PricingSetResultV1
  | PricingRemoveResultV1
  | ObservabilityHealthResultV1
  | ObservabilityEventsResultV1
  | ObservabilityMetricsResultV1
  | ObservabilityErrorsResultV1
  | ObservabilityAlertsResultV1
  | DiagnosticsExportResultV1
  | ConfigDescribeResultV1
  | ConfigEffectiveResultV1
  | ConfigSetResultV1
  | ConfigResetResultV1;
/**
 * A connector identifier issued by the host at registration.
 */
export type Uuid = string;
/**
 * The adapter family. polaris.rest is the generic REST connector; polaris.workspace reads the sources of one project.
 */
export type ConnectorProvider = "polaris.rest" | "polaris.workspace";
export type ConnectorCategory =
  "EMAIL" | "CALENDAR" | "FILES" | "MESSAGING" | "PROJECT_MANAGEMENT" | "CODE_HOSTING" | "DATABASE" | "CUSTOM_API";
/**
 * A registered connector operation. An agent chooses one of these; it never names a URL.
 */
export type OperationId = string;
/**
 * Every action other than READ is an EXTERNAL_SIDE_EFFECT that waits for a bound approval.
 */
export type OperationAction =
  "READ" | "WRITE" | "DELETE" | "SEND" | "PUBLISH" | "CREATE_EXTERNAL_RESOURCE" | "MODIFY_EXTERNAL_RESOURCE";
/**
 * OAUTH2 is part of the vocabulary and refused at registration in this build: no official flow is implemented.
 */
export type AuthMode = "NONE" | "API_KEY" | "BEARER_TOKEN" | "BASIC" | "OAUTH2";
/**
 * What a tool can cause. A tool that can change anything indirectly is not read-only, and declares every effect it can reach. DESKTOP_INPUT (added by Phase-05) is input to a window the user granted to one mission; it is not read-only, and a destructive or unknown target raises it to EXTERNAL_SIDE_EFFECT. WORKSPACE_READ, WORKSPACE_WRITE and SANDBOXED_EXECUTION (added by Phase-08) are confined to one mission workspace and one AppContainer sandbox; they grant nothing outside them, and anything that leaves them is declared with the effect it reaches (WRITE_LOCAL, NETWORK_EGRESS, EXTERNAL_SIDE_EFFECT).
 */
export type ToolEffect =
  | "LOCAL_COMPUTE"
  | "READ_LOCAL"
  | "WRITE_LOCAL"
  | "NETWORK_EGRESS"
  | "PROCESS_EXECUTION"
  | "SECRET_ACCESS"
  | "DATABASE_READ"
  | "DATABASE_WRITE"
  | "EXTERNAL_SIDE_EFFECT"
  | "DESKTOP_INPUT"
  | "WORKSPACE_READ"
  | "WORKSPACE_WRITE"
  | "SANDBOXED_EXECUTION";
export type RiskClass = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type ConnectorStatus = "REGISTERED" | "ENABLED" | "DISABLED";
export type ProvenanceOrigin = "USER_REGISTERED" | "OPENAPI_IMPORT" | "BUILT_IN_PRESET";
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid1 = string;
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
/**
 * PUBLIC_HTTPS reaches public addresses resolved and checked at connect time; LOOPBACK is the literal loopback interface only; NONE is a local connector with no network.
 */
export type EgressClass = "PUBLIC_HTTPS" | "LOOPBACK" | "NONE";
/**
 * Where the host resolves the connector key at call time. The value never crosses the boundary.
 */
export type KeySource = "NONE" | "CREDENTIAL_STORE" | "ENVIRONMENT";
export type HealthSubject =
  | "PROVIDER"
  | "CONNECTOR"
  | "STORAGE"
  | "BROWSER"
  | "COMPUTER"
  | "MEMORY"
  | "TOOL_GATEWAY"
  | "AGENT_RUNTIME"
  | "CONFIG";
/**
 * UNKNOWN until measured in this session; a measurement from a previous start is never shown as present health.
 */
export type HealthState = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNAVAILABLE";
export type ReasonCode = string;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ParamLocation = "PATH" | "QUERY" | "BODY";
export type ParamKind = "STRING" | "INTEGER" | "BOOLEAN" | "ENUM";
export type IdempotencySupportV1 = IdempotencyNone | IdempotencyHeader;
export type JsonPointer = string;
/**
 * An ISO 4217 code. No amount is ever converted between currencies.
 */
export type Currency = string;
/**
 * Stable identifier of a registered tool. A tool that is not in the registry under this exact identifier cannot be invoked.
 */
export type ToolId = string;
export type InvocationOutcome = "SUCCEEDED" | "FAILED" | "DENIED" | "CANCELLED" | "REPLAYED" | "OUTCOME_UNKNOWN";
export type PresetId = string;
/**
 * ESTIMATED comes from a price the user entered with its source and is never an invoice; UNKNOWN carries no amount.
 */
export type CostProvenance = "PROVIDER_REPORTED" | "LOCALLY_MEASURED" | "ESTIMATED" | "UNKNOWN";
export type UsageCategory = "MODEL" | "TOOL" | "BROWSER" | "COMPUTER" | "CONNECTOR";
export type BudgetScope = "MISSION" | "PROJECT" | "DAY" | "PROVIDER" | "CONNECTOR";
export type BudgetDimension = "COST_MICROS" | "MODEL_TOKENS" | "EXTERNAL_CALLS";
/**
 * HARD blocks the next call before any effect; SOFT warns and permits.
 */
export type BudgetMode = "SOFT" | "HARD";
export type BudgetState = "WITHIN" | "NEAR_LIMIT" | "AT_LIMIT" | "EXCEEDED";
export type PricingTarget = "MODEL" | "CONNECTOR";
export type PricingUnit = "PER_MILLION_INPUT_TOKENS" | "PER_MILLION_OUTPUT_TOKENS" | "PER_CALL";
/**
 * An exact non-negative decimal. Money never travels as a binary float.
 */
export type DecimalText = string;
export type Component =
  | "CONNECTOR_GATEWAY"
  | "CONNECTOR"
  | "MODEL"
  | "TOOL"
  | "BROWSER"
  | "COMPUTER"
  | "MEMORY"
  | "MISSION"
  | "BUDGET"
  | "COST"
  | "CONFIG"
  | "STORAGE"
  | "HEALTH"
  | "DIAGNOSTICS";
export type EventCategory =
  | "INVOCATION"
  | "POLICY"
  | "BUDGET"
  | "RATE_LIMIT"
  | "RETRY"
  | "HEALTH"
  | "CONFIG"
  | "LIFECYCLE"
  | "SECURITY"
  | "DIAGNOSTICS";
export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type EventProvenance = "LOCALLY_MEASURED" | "PROVIDER_REPORTED" | "CONNECTOR_REPORTED";
export type AlertKind =
  | "BUDGET_NEAR_LIMIT"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_UNHEALTHY"
  | "CONNECTOR_UNHEALTHY"
  | "ERROR_SPIKE"
  | "STORAGE_ISSUE"
  | "NO_PROGRESS_LOOP"
  | "TURNS_ABOVE_EXPECTED"
  | "MISSION_OVERTIME"
  | "INJECTION_DETECTED"
  | "TAMPER_DETECTED"
  | "HONEYTOKEN_READ";
export type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type AlertState = "OPEN" | "RESOLVED";
export type SettingKey = string;
/**
 * A typed value in its plain JSON form: boolean, integer, decimal or code as text, or a list of short strings. The host parses it against the setting's kind and bounds.
 */
export type SettingValue = boolean | number | string | string[];
export type ValueSource = "DEFAULT" | "USER" | "PROJECT" | "MISSION" | "SECURITY_CLAMP";
export type ConfigSection =
  | "GENERAL"
  | "APPEARANCE"
  | "LANGUAGE"
  | "MODELS"
  | "PROVIDERS"
  | "AGENTS"
  | "SKILLS"
  | "TOOLS"
  | "MCP"
  | "MEMORY"
  | "BROWSER"
  | "COMPUTER"
  | "CONNECTORS"
  | "PRIVACY"
  | "SECURITY"
  | "BUDGETS"
  | "COST"
  | "OBSERVABILITY"
  | "ADVANCED";
export type SettingKind = "BOOLEAN" | "INTEGER" | "DECIMAL" | "ENUM" | "STRING" | "DURATION" | "BYTES" | "LIST";
export type SettingState = "EDITABLE" | "LOCKED" | "UNAVAILABLE_THIS_PHASE";
/**
 * DEFAULT lives in code and is not writable.
 */
export type ConfigLayer = "USER" | "PROJECT" | "MISSION" | "SECURITY";
export type Applies = "NEXT_OPERATION" | "NEXT_MISSION" | "IMMEDIATELY";
export type ConfigState = "OK" | "UNSUPPORTED_VERSION" | "UNREADABLE";

export interface ConnectorListResultV1 {
  /**
   * @minItems 0
   * @maxItems 200
   */
  connectors: ConnectorViewV1[];
  unreadable: number;
}
export interface ConnectorViewV1 {
  descriptor: ConnectorDescriptorV1;
  auth: ConnectorAuthStateV1;
  health: HealthRecordV1;
  last_activity_at?: Timestamp;
  operation_count: number;
  rest?: RestViewV1;
  workspace?: WorkspaceConfigV1;
  registered_at: Timestamp;
}
export interface ConnectorDescriptorV1 {
  connector_id: Uuid;
  provider: ConnectorProvider;
  display_name_key: string;
  display_name: string;
  description_key: string;
  version: string;
  category: ConnectorCategory;
  /**
   * @minItems 0
   * @maxItems 32
   */
  capabilities: ConnectorCapabilityV1[];
  auth_mode: AuthMode;
  /**
   * @minItems 0
   * @maxItems 10
   */
  effects:
    | []
    | [ToolEffect]
    | [ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect,
        ToolEffect
      ];
  risk_class: RiskClass;
  supports_read: boolean;
  supports_write: boolean;
  supports_webhook: boolean;
  supports_polling: boolean;
  supports_search: boolean;
  supports_files: boolean;
  enabled: boolean;
  status: ConnectorStatus;
  provenance: ConnectorProvenanceV1;
  egress_class: EgressClass;
}
export interface ConnectorCapabilityV1 {
  operation_id: OperationId;
  action: OperationAction;
  title: string;
}
export interface ConnectorProvenanceV1 {
  origin: ProvenanceOrigin;
  import_id: Uuid1 | null;
  spec_digest: Sha256Hex | null;
  registered_at: Timestamp;
}
/**
 * Whether a key is configured, where it comes from and when it was last set. There is no value field and no length field.
 */
export interface ConnectorAuthStateV1 {
  mode: AuthMode;
  required: boolean;
  configured: boolean;
  source: KeySource;
  reference?: string;
  environment_variable?: string;
  last_updated?: Timestamp;
  store_available: boolean;
}
export interface HealthRecordV1 {
  subject: HealthSubject;
  subject_id: string;
  state: HealthState;
  reason_code: ReasonCode;
  measured_at?: Timestamp;
  latency_ms?: number;
  measured_this_session: boolean;
}
export interface RestViewV1 {
  base_url: string;
  egress_class: EgressClass;
  /**
   * @minItems 1
   * @maxItems 32
   */
  allowed_paths: [string, ...string[]];
  /**
   * @minItems 1
   * @maxItems 5
   */
  allowed_methods:
    | [HttpMethod]
    | [HttpMethod, HttpMethod]
    | [HttpMethod, HttpMethod, HttpMethod]
    | [HttpMethod, HttpMethod, HttpMethod, HttpMethod]
    | [HttpMethod, HttpMethod, HttpMethod, HttpMethod, HttpMethod];
  timeout_ms: number;
  max_response_bytes: number;
  requests_per_minute: number;
  max_concurrent: number;
}
export interface WorkspaceConfigV1 {
  project_id: Uuid1;
}
export interface ConnectorGetResultV1 {
  connector: ConnectorViewV1;
  /**
   * @minItems 0
   * @maxItems 32
   */
  operations: OperationViewV1[];
  /**
   * @minItems 0
   * @maxItems 20
   */
  invocations:
    | []
    | [ConnectorInvocationV1]
    | [ConnectorInvocationV1, ConnectorInvocationV1]
    | [ConnectorInvocationV1, ConnectorInvocationV1, ConnectorInvocationV1]
    | [ConnectorInvocationV1, ConnectorInvocationV1, ConnectorInvocationV1, ConnectorInvocationV1]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ]
    | [
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1,
        ConnectorInvocationV1
      ];
}
export interface OperationViewV1 {
  operation: ConnectorOperationV1;
  tool_id: ToolId;
  side_effect: boolean;
  retry_safe: boolean;
}
/**
 * One registered operation: a fixed path template on the connector's base URL, a fixed method and typed arguments. It names no host and no header.
 */
export interface ConnectorOperationV1 {
  operation_id: OperationId;
  title: string;
  action: OperationAction;
  method: HttpMethod;
  path: string;
  /**
   * @minItems 0
   * @maxItems 16
   */
  params?:
    | []
    | [OperationParamV1]
    | [OperationParamV1, OperationParamV1]
    | [OperationParamV1, OperationParamV1, OperationParamV1]
    | [OperationParamV1, OperationParamV1, OperationParamV1, OperationParamV1]
    | [OperationParamV1, OperationParamV1, OperationParamV1, OperationParamV1, OperationParamV1]
    | [OperationParamV1, OperationParamV1, OperationParamV1, OperationParamV1, OperationParamV1, OperationParamV1]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ]
    | [
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1,
        OperationParamV1
      ];
  idempotency?: IdempotencySupportV1;
  resource_id_pointer?: JsonPointer | null;
  /**
   * @minItems 0
   * @maxItems 8
   */
  result_fields?:
    | []
    | [JsonPointer]
    | [JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer];
  cost_pointer?: JsonPointer | null;
  cost_currency?: Currency | null;
  /**
   * PHASE-05: a JSON pointer to a list in the response; its items reach the agent as bounded untrusted data.
   */
  list_pointer?: JsonPointer | null;
  /**
   * PHASE-05: the fields read from each list item.
   *
   * @minItems 0
   * @maxItems 8
   */
  item_fields?:
    | []
    | [JsonPointer]
    | [JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer]
    | [JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer, JsonPointer];
}
export interface OperationParamV1 {
  name: string;
  location: ParamLocation;
  kind: ParamKind;
  required: boolean;
  max_length?: number | null;
  minimum?: number | null;
  maximum?: number | null;
  /**
   * @minItems 0
   * @maxItems 32
   */
  allowed?: string[];
}
export interface IdempotencyNone {
  mode: "NONE";
}
export interface IdempotencyHeader {
  mode: "HEADER";
  header: string;
}
/**
 * One connector call as recorded: a bounded summary of untrusted content, never the raw body.
 */
export interface ConnectorInvocationV1 {
  invocation_id: Uuid1;
  connector_id: Uuid;
  operation_id: OperationId;
  mission_id?: Uuid1;
  task_id?: Uuid1;
  action: OperationAction;
  status: InvocationOutcome;
  attempts: number;
  http_status?: number;
  reason_code?: ReasonCode;
  result_digest?: Sha256Hex;
  /**
   * @minItems 0
   * @maxItems 8
   */
  resource_refs:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  summary: string;
  latency_ms: number;
  started_at: Timestamp;
}
export interface ConnectorResultV1 {
  connector: ConnectorViewV1;
}
export interface ConnectorRemoveResultV1 {
  connector_id: Uuid;
  removed: boolean;
  tools_removed: number;
}
export interface ConnectorTestResultV1 {
  connector_id: Uuid;
  probe_operation?: OperationId;
  health: HealthRecordV1;
  reason_code?: ReasonCode;
}
export interface ConnectorCredentialResultV1 {
  connector_id: Uuid;
  outcome: "STORED" | "CLEARED" | "PROMPT_CANCELLED" | "STORE_UNAVAILABLE" | "NOT_APPLICABLE" | "NOTHING_TO_CLEAR";
  auth: ConnectorAuthStateV1;
}
/**
 * Proposed operations and every rejected one with its reason. Document text is shown as data; nothing is enabled.
 */
export interface ConnectorOpenapiImportResultV1 {
  import_id: Uuid1;
  title: string;
  suggested_base_url?: string;
  /**
   * @minItems 1
   * @maxItems 32
   */
  operations: [ConnectorOperationV1, ...ConnectorOperationV1[]];
  /**
   * @minItems 0
   * @maxItems 400
   */
  rejected: RejectedOperationV1[];
  spec_digest: Sha256Hex;
  status: "PROPOSED";
}
export interface RejectedOperationV1 {
  method: string;
  path: string;
  reason: ReasonCode;
}
export interface ConnectorPresetListResultV1 {
  /**
   * @minItems 0
   * @maxItems 64
   */
  presets: ConnectorPresetV1[];
}
/**
 * A built-in connector preset: the service's official base URL and documented read operations. It carries no credential and no connection state.
 */
export interface ConnectorPresetV1 {
  preset_id: PresetId;
  display_name: string;
  category: ConnectorCategory;
  description: string;
  base_url: string;
  auth_mode: AuthMode;
  setup_hint: string;
  docs_url: string;
  /**
   * @minItems 1
   * @maxItems 32
   */
  operations: [ConnectorPresetOperationV1, ...ConnectorPresetOperationV1[]];
}
export interface ConnectorPresetOperationV1 {
  operation_id: OperationId;
  title: string;
  action: OperationAction;
}
export interface UsageSummaryResultV1 {
  day: string;
  today: UsageTotalsV1;
  mission: UsageTotalsV1 | null;
  project: UsageTotalsV1 | null;
  /**
   * @minItems 0
   * @maxItems 200
   */
  by_provider: UsageTotalsV1[];
  /**
   * @minItems 0
   * @maxItems 500
   */
  by_model: UsageTotalsV1[];
  /**
   * @minItems 0
   * @maxItems 200
   */
  by_connector: UsageTotalsV1[];
  /**
   * @minItems 0
   * @maxItems 5
   */
  by_category:
    | []
    | [UsageTotalsV1]
    | [UsageTotalsV1, UsageTotalsV1]
    | [UsageTotalsV1, UsageTotalsV1, UsageTotalsV1]
    | [UsageTotalsV1, UsageTotalsV1, UsageTotalsV1, UsageTotalsV1]
    | [UsageTotalsV1, UsageTotalsV1, UsageTotalsV1, UsageTotalsV1, UsageTotalsV1];
  show_estimated: boolean;
  /**
   * @minItems 4
   * @maxItems 4
   */
  provenance_vocabulary: [CostProvenance, CostProvenance, CostProvenance, CostProvenance];
  note: string;
}
/**
 * Totals kept apart by currency and provenance: an estimate and a report are never summed into one number.
 */
export interface UsageTotalsV1 {
  key: string;
  calls: number;
  input_tokens_reported: number;
  output_tokens_reported: number;
  calls_without_reported_tokens: number;
  wall_ms: number;
  external_requests: number;
  /**
   * @minItems 0
   * @maxItems 64
   */
  costs: CostBucketV1[];
  calls_with_unknown_cost: number;
}
export interface CostBucketV1 {
  currency: Currency;
  provenance: CostProvenance;
  micros: number;
  calls: number;
}
export interface UsageListResultV1 {
  /**
   * @minItems 0
   * @maxItems 500
   */
  records: UsageRecordV1[];
}
export interface UsageRecordV1 {
  record_id: Uuid1;
  recorded_at: Timestamp;
  category: UsageCategory;
  subject_id: string;
  mission_id: Uuid1 | null;
  project_id: Uuid1 | null;
  provider_id: string | null;
  model_id: string | null;
  connector_id: Uuid1 | null;
  tool_id: ToolId | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  tokens_provenance: CostProvenance;
  wall_ms: number;
  external_requests: number;
  cost: CostV1;
}
/**
 * An amount in millionths of a currency unit with its provenance. UNKNOWN has no amount.
 */
export interface CostV1 {
  micros: number | null;
  currency: Currency | null;
  provenance: CostProvenance;
  pricing_source: string | null;
}
export interface BudgetListResultV1 {
  /**
   * @minItems 0
   * @maxItems 200
   */
  budgets: BudgetStatusV1[];
}
export interface BudgetStatusV1 {
  budget: BudgetV1;
  window: "LIFETIME" | "UTC_DAY";
  usage: BudgetUseV1;
  limit_display: string;
  used_display: string;
}
export interface BudgetV1 {
  budget_id: Uuid1;
  scope: BudgetScope;
  scope_key: string;
  dimension: BudgetDimension;
  limit: number;
  currency: Currency | null;
  mode: BudgetMode;
  warn_ratio_pct: number;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface BudgetUseV1 {
  budget_id: Uuid1;
  scope: BudgetScope;
  scope_key: string;
  dimension: BudgetDimension;
  mode: BudgetMode;
  limit: number;
  used: number;
  reserved: number;
  currency?: Currency;
  unmetered_calls: number;
  state: BudgetState;
}
export interface BudgetSetResultV1 {
  budget: BudgetV1;
  limit_display: string;
}
export interface BudgetRemoveResultV1 {
  budget_id: Uuid1;
  removed: boolean;
}
export interface PricingListResultV1 {
  /**
   * @minItems 0
   * @maxItems 400
   */
  entries: PricingViewV1[];
}
/**
 * A user-entered price. Every cost computed from it is ESTIMATED, never an invoice.
 */
export interface PricingViewV1 {
  entry: PricingEntryV1;
  amount: DecimalText;
  provenance: "ESTIMATED";
}
export interface PricingEntryV1 {
  pricing_id: Uuid1;
  target_kind: PricingTarget;
  target_id: string;
  unit: PricingUnit;
  amount_micros: number;
  currency: Currency;
  source_note: string;
  created_at: Timestamp;
}
export interface PricingSetResultV1 {
  entry: PricingViewV1;
}
export interface PricingRemoveResultV1 {
  pricing_id: Uuid1;
  removed: boolean;
}
export interface ObservabilityHealthResultV1 {
  measured_at: Timestamp;
  overall: HealthState;
  /**
   * @minItems 0
   * @maxItems 200
   */
  components: HealthRecordV1[];
}
export interface ObservabilityEventsResultV1 {
  /**
   * @minItems 0
   * @maxItems 500
   */
  events: ObsEventV1[];
  label: "STRUCTURED EVENTS — DIAGNOSTIC, NOT AUDIT";
}
/**
 * A structured diagnostic event: codes only. No prompt text, secret, header, page content or connector payload can be represented.
 */
export interface ObsEventV1 {
  event_id: Uuid1;
  timestamp: Timestamp;
  component: Component;
  category: EventCategory;
  severity: Severity;
  mission_id?: Uuid1;
  task_id?: Uuid1;
  agent_id?: Uuid1;
  operation: string;
  result: string;
  duration_ms?: number;
  reason_code?: ReasonCode;
  provenance: EventProvenance;
}
export interface ObservabilityMetricsResultV1 {
  metrics: MetricsSnapshotV1;
  queue_depths: QueueDepthsV1;
}
export interface MetricsSnapshotV1 {
  scope: "SINCE_START";
  counters: MetricCountersV1;
  /**
   * @minItems 0
   * @maxItems 14
   */
  latency:
    | []
    | [LatencyViewV1]
    | [LatencyViewV1, LatencyViewV1]
    | [LatencyViewV1, LatencyViewV1, LatencyViewV1]
    | [LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1]
    | [LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1]
    | [LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1]
    | [LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1, LatencyViewV1]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ]
    | [
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1,
        LatencyViewV1
      ];
  /**
   * @minItems 0
   * @maxItems 200
   */
  errors_by_code: ErrorGroupV1[];
  error_overflow: number;
  distinct_error_keys: number;
}
export interface MetricCountersV1 {
  mission_count: number;
  mission_success_count: number;
  mission_failed_count: number;
  model_calls: number;
  tool_calls: number;
  connector_calls: number;
  approval_requests: number;
  approval_denials: number;
  browser_actions: number;
  computer_actions: number;
  memory_writes: number;
  errors: number;
}
export interface LatencyViewV1 {
  component: Component;
  /**
   * @minItems 9
   * @maxItems 9
   */
  bucket_bounds_ms: [number, number, number, number, number, number, number, number, number];
  histogram: HistogramV1;
  mean_ms?: number;
}
export interface HistogramV1 {
  /**
   * @minItems 10
   * @maxItems 10
   */
  buckets: [number, number, number, number, number, number, number, number, number, number];
  count: number;
  sum_ms: number;
  max_ms: number;
}
export interface ErrorGroupV1 {
  component: Component;
  reason_code: ReasonCode;
  count: number;
}
export interface QueueDepthsV1 {
  running_missions: number;
  running_model_requests: number;
  pending_approvals: number;
  connector_requests_in_flight: number;
}
export interface ObservabilityErrorsResultV1 {
  /**
   * @minItems 0
   * @maxItems 200
   */
  errors_by_code: ErrorGroupV1[];
  overflow: number;
  distinct_keys: number;
  scope: "SINCE_START";
}
export interface ObservabilityAlertsResultV1 {
  /**
   * @minItems 0
   * @maxItems 200
   */
  alerts: AlertV1[];
}
export interface AlertV1 {
  alert_id: Uuid1;
  kind: AlertKind;
  severity: AlertSeverity;
  subject: string;
  reason_code: ReasonCode;
  first_at: Timestamp;
  last_at: Timestamp;
  occurrences: number;
  state: AlertState;
}
/**
 * A bounded, redacted local diagnostics document. It carries codes, states and counts; no secret, header, prompt, page or connector payload.
 */
export interface DiagnosticsExportResultV1 {
  file_name: string | null;
  bytes: number;
  level: "MINIMAL" | "STANDARD" | "DETAILED";
  /**
   * @minItems 3
   * @maxItems 12
   */
  sections:
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string];
  redactions: number;
  document: DiagnosticsDocumentV1;
}
export interface DiagnosticsDocumentV1 {
  schema: "polaris.diagnostics.v1";
  generated_at: Timestamp;
  level: "MINIMAL" | "STANDARD" | "DETAILED";
  label: "LOCAL DIAGNOSTICS — REDACTED, NO SECRETS";
  versions: DiagnosticsVersionsV1;
  health: HealthOverviewV1;
  /**
   * @minItems 0
   * @maxItems 500
   */
  recent_reason_codes: ReasonCountV1[];
  /**
   * @minItems 0
   * @maxItems 200
   */
  config_summary?: ConfigSummaryItemV1[];
  /**
   * @minItems 0
   * @maxItems 200
   */
  sensitive?: SensitiveStatusV1[];
  metrics?: MetricsSnapshotV1;
  queue_depths?: QueueDepthsV1;
  /**
   * @minItems 0
   * @maxItems 200
   */
  alerts?: AlertV1[];
  /**
   * @minItems 0
   * @maxItems 200
   */
  connectors?: DiagnosticsConnectorV1[];
  performance?: {
    [k: string]: number;
  } | null;
  redactions: number;
}
export interface DiagnosticsVersionsV1 {
  app: string;
  ipc_protocol: string;
  contract: string;
  storage_schema: number;
  config_schema: number;
}
export interface HealthOverviewV1 {
  measured_at: Timestamp;
  overall: HealthState;
  /**
   * @minItems 0
   * @maxItems 200
   */
  components: HealthRecordV1[];
}
export interface ReasonCountV1 {
  component: Component;
  reason_code: ReasonCode;
  count: number;
}
export interface ConfigSummaryItemV1 {
  key: SettingKey;
  value: SettingValue;
  source: ValueSource;
}
/**
 * A sensitive setting shown as configured, source and last update only. There is no reveal path.
 */
export interface SensitiveStatusV1 {
  subject: string;
  configured: boolean;
  source: KeySource;
  reference: string | null;
  last_updated?: Timestamp | null;
}
export interface DiagnosticsConnectorV1 {
  connector_id: Uuid;
  provider: ConnectorProvider;
  category: ConnectorCategory;
  egress_class: EgressClass;
  enabled: boolean;
  operations: number;
}
export interface ConfigDescribeResultV1 {
  /**
   * @minItems 19
   * @maxItems 19
   */
  sections: [
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1,
    ConfigSectionV1
  ];
  status: ConfigStatusV1;
  /**
   * @minItems 4
   * @maxItems 4
   */
  layers: [ConfigLayer, ConfigLayer, ConfigLayer, ConfigLayer];
}
export interface ConfigSectionV1 {
  section: ConfigSection;
  label_key: string;
  /**
   * @minItems 1
   * @maxItems 32
   */
  settings: [SettingDescriptorV1, ...SettingDescriptorV1[]];
}
/**
 * A typed setting: its kind, bounds, the layers that may write it, whether it bears security, its build ceiling and the host component that reads it. It carries no current value.
 */
export interface SettingDescriptorV1 {
  key: SettingKey;
  kind: SettingKind;
  state: SettingState;
  default: SettingValue;
  /**
   * @minItems 0
   * @maxItems 4
   */
  layers:
    | []
    | [ConfigLayer]
    | [ConfigLayer, ConfigLayer]
    | [ConfigLayer, ConfigLayer, ConfigLayer]
    | [ConfigLayer, ConfigLayer, ConfigLayer, ConfigLayer];
  security_bearing: boolean;
  ceiling: SettingValue | null;
  applies: Applies;
  consumer: string;
  label_key: string;
  hint_key: string;
  bounds: SettingBoundsV1;
}
export interface SettingBoundsV1 {
  min: number | null;
  max: number | null;
  min_decimal: string | null;
  max_decimal: string | null;
  /**
   * @minItems 0
   * @maxItems 32
   */
  allowed: string[];
  max_length: number | null;
  max_items: number | null;
}
export interface ConfigStatusV1 {
  state: ConfigState;
  schema_version: number;
  found_version: number;
  unreadable_rows: number;
  config_version: number;
}
export interface ConfigEffectiveResultV1 {
  scope: ConfigScopeV1;
  /**
   * @minItems 0
   * @maxItems 200
   */
  values: ResolvedValueV1[];
  status: ConfigStatusV1;
  /**
   * @minItems 0
   * @maxItems 200
   */
  sensitive: SensitiveStatusV1[];
}
export interface ConfigScopeV1 {
  project_id: Uuid1 | null;
  mission_id: Uuid1 | null;
}
/**
 * One effective value and where it came from. ignored_layers lists a project or mission value that tried to widen a security-bearing setting.
 */
export interface ResolvedValueV1 {
  key: SettingKey;
  value: SettingValue;
  source: ValueSource;
  clamped: boolean;
  /**
   * @minItems 0
   * @maxItems 4
   */
  present_layers:
    | []
    | [ConfigLayer]
    | [ConfigLayer, ConfigLayer]
    | [ConfigLayer, ConfigLayer, ConfigLayer]
    | [ConfigLayer, ConfigLayer, ConfigLayer, ConfigLayer];
  /**
   * @minItems 0
   * @maxItems 4
   */
  ignored_layers:
    | []
    | [ConfigLayer]
    | [ConfigLayer, ConfigLayer]
    | [ConfigLayer, ConfigLayer, ConfigLayer]
    | [ConfigLayer, ConfigLayer, ConfigLayer, ConfigLayer];
  clamp?: SettingValue;
}
export interface ConfigSetResultV1 {
  key: SettingKey;
  layer: ConfigLayer;
  value: ResolvedValueV1;
}
export interface ConfigResetResultV1 {
  key: SettingKey;
  layer: ConfigLayer;
  removed: boolean;
  value: ResolvedValueV1 | null;
}
