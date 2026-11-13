/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the thirty Phase-06 operations accept. No payload can execute a connector operation, name a free URL for an agent, or carry a credential value.
 */
export type DesktopPhase06RequestPayloadV1 =
  | ConnectorListRequestV1
  | ConnectorGetRequestV1
  | ConnectorRegisterRequestV1
  | ConnectorConfigureRequestV1
  | ConnectorRemoveRequestV1
  | ConnectorTestRequestV1
  | ConnectorCredentialSetRequestV1
  | ConnectorCredentialClearRequestV1
  | ConnectorOpenapiImportRequestV1
  | ConnectorOpenapiApproveRequestV1
  | ConnectorPresetListRequestV1
  | ConnectorPresetRegisterRequestV1
  | UsageSummaryRequestV1
  | UsageListRequestV1
  | BudgetListRequestV1
  | BudgetSetRequestV1
  | BudgetRemoveRequestV1
  | PricingListRequestV1
  | PricingSetRequestV1
  | PricingRemoveRequestV1
  | ObservabilityHealthRequestV1
  | ObservabilityEventsRequestV1
  | ObservabilityMetricsRequestV1
  | ObservabilityErrorsRequestV1
  | ObservabilityAlertsRequestV1
  | DiagnosticsExportRequestV1
  | ConfigDescribeRequestV1
  | ConfigEffectiveRequestV1
  | ConfigSetRequestV1
  | ConfigResetRequestV1;
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
 * PUBLIC_HTTPS reaches public addresses resolved and checked at connect time; LOOPBACK is the literal loopback interface only; NONE is a local connector with no network.
 */
export type EgressClass = "PUBLIC_HTTPS" | "LOOPBACK" | "NONE";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/**
 * OAUTH2 is part of the vocabulary and refused at registration in this build: no official flow is implemented.
 */
export type AuthMode = "NONE" | "API_KEY" | "BEARER_TOKEN" | "BASIC" | "OAUTH2";
/**
 * Where the host resolves the connector key at call time. The value never crosses the boundary.
 */
export type KeySource = "NONE" | "CREDENTIAL_STORE" | "ENVIRONMENT";
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid1 = string;
/**
 * A registered connector operation. An agent chooses one of these; it never names a URL.
 */
export type OperationId = string;
/**
 * Every action other than READ is an EXTERNAL_SIDE_EFFECT that waits for a bound approval.
 */
export type OperationAction =
  "READ" | "WRITE" | "DELETE" | "SEND" | "PUBLISH" | "CREATE_EXTERNAL_RESOURCE" | "MODIFY_EXTERNAL_RESOURCE";
export type ParamLocation = "PATH" | "QUERY" | "BODY";
export type ParamKind = "STRING" | "INTEGER" | "BOOLEAN" | "ENUM";
export type IdempotencySupportV1 = IdempotencyNone | IdempotencyHeader;
export type JsonPointer = string;
/**
 * An ISO 4217 code. No amount is ever converted between currencies.
 */
export type Currency = string;
export type PresetId = string;
export type UsageCategory = "MODEL" | "TOOL" | "BROWSER" | "COMPUTER" | "CONNECTOR";
export type BudgetScope = "MISSION" | "PROJECT" | "DAY" | "PROVIDER" | "CONNECTOR";
export type BudgetDimension = "COST_MICROS" | "MODEL_TOKENS" | "EXTERNAL_CALLS";
/**
 * An exact non-negative decimal. Money never travels as a binary float.
 */
export type DecimalText = string;
/**
 * HARD blocks the next call before any effect; SOFT warns and permits.
 */
export type BudgetMode = "SOFT" | "HARD";
export type PricingTarget = "MODEL" | "CONNECTOR";
export type PricingUnit = "PER_MILLION_INPUT_TOKENS" | "PER_MILLION_OUTPUT_TOKENS" | "PER_CALL";
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
export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
/**
 * DEFAULT lives in code and is not writable.
 */
export type ConfigLayer = "USER" | "PROJECT" | "MISSION" | "SECURITY";
export type SettingKey = string;
/**
 * A typed value in its plain JSON form: boolean, integer, decimal or code as text, or a list of short strings. The host parses it against the setting's kind and bounds.
 */
export type SettingValue = boolean | number | string | string[];

/**
 * Lists registered connectors. No side effect.
 */
export interface ConnectorListRequestV1 {}
export interface ConnectorGetRequestV1 {
  connector_id: Uuid;
}
/**
 * Registers a connector, disabled. Enabling is a separate decision the user sees.
 */
export interface ConnectorRegisterRequestV1 {
  provider: ConnectorProvider;
  category: ConnectorCategory;
  display_name: string;
  rest?: RestInputV1;
  workspace?: WorkspaceConfigV1;
  /**
   * @minItems 0
   * @maxItems 32
   */
  operations?: ConnectorOperationV1[];
}
/**
 * A REST connector as the user registers it from the settings surface. The base URL, paths and methods are fixed here; an agent can only choose among the operations.
 */
export interface RestInputV1 {
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
  auth_mode: AuthMode;
  key_source: KeySource;
  environment_variable?: string;
  key_header?: "X-API-Key" | "Api-Key" | "X-Auth-Token" | "X-Access-Token" | "Ocp-Apim-Subscription-Key";
  basic_username?: string;
  timeout_ms: number;
  max_response_bytes: number;
  requests_per_minute?: number;
  max_concurrent?: number;
}
export interface WorkspaceConfigV1 {
  project_id: Uuid1;
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
 * Enables, disables, renames or re-rates a connector. The destination, paths and operations cannot be edited here.
 */
export interface ConnectorConfigureRequestV1 {
  connector_id: Uuid;
  enabled?: boolean;
  display_name?: string;
  requests_per_minute?: number;
  max_concurrent?: number;
}
export interface ConnectorRemoveRequestV1 {
  connector_id: Uuid;
}
/**
 * Measures health with one read operation through the connector gateway.
 */
export interface ConnectorTestRequestV1 {
  connector_id: Uuid;
}
/**
 * Opens the host's own credential prompt. The value is typed into a system window, never into the renderer.
 */
export interface ConnectorCredentialSetRequestV1 {
  connector_id: Uuid;
}
export interface ConnectorCredentialClearRequestV1 {
  connector_id: Uuid;
}
/**
 * Parses an OpenAPI 3 document into proposed operations. Nothing is registered.
 */
export interface ConnectorOpenapiImportRequestV1 {
  spec: string;
}
/**
 * Registers only the operations the user approved, at a base URL the user confirmed, disabled.
 */
export interface ConnectorOpenapiApproveRequestV1 {
  import_id: Uuid1;
  /**
   * @minItems 1
   * @maxItems 32
   */
  operation_ids: [OperationId, ...OperationId[]];
  display_name: string;
  category: ConnectorCategory;
  rest: RestInputV1;
}
/**
 * Lists the built-in connector presets. No side effect.
 */
export interface ConnectorPresetListRequestV1 {}
/**
 * Registers a built-in preset as a disabled connector without a credential. Its URL, paths, methods and headers come from the host, not from this payload.
 */
export interface ConnectorPresetRegisterRequestV1 {
  preset_id: PresetId;
  display_name?: string;
}
export interface UsageSummaryRequestV1 {
  mission_id?: Uuid1;
  project_id?: Uuid1;
}
export interface UsageListRequestV1 {
  mission_id?: Uuid1;
  category?: UsageCategory;
  limit?: number;
}
export interface BudgetListRequestV1 {
  mission_id?: Uuid1;
  project_id?: Uuid1;
}
export interface BudgetSetRequestV1 {
  scope: BudgetScope;
  scope_key?: string;
  dimension: BudgetDimension;
  limit: number | DecimalText;
  currency?: Currency;
  mode?: BudgetMode;
  warn_ratio_pct?: number;
}
export interface BudgetRemoveRequestV1 {
  budget_id: Uuid1;
}
export interface PricingListRequestV1 {}
/**
 * A price the user entered, with where it came from. POLARIS ships no price of its own.
 */
export interface PricingSetRequestV1 {
  target_kind: PricingTarget;
  target_id: string;
  unit: PricingUnit;
  amount: DecimalText;
  currency: Currency;
  source_note: string;
}
export interface PricingRemoveRequestV1 {
  pricing_id: Uuid1;
}
export interface ObservabilityHealthRequestV1 {}
export interface ObservabilityEventsRequestV1 {
  limit?: number;
  component?: Component;
  min_severity?: Severity;
}
export interface ObservabilityMetricsRequestV1 {}
export interface ObservabilityErrorsRequestV1 {}
export interface ObservabilityAlertsRequestV1 {
  include_resolved?: boolean;
}
/**
 * Writes a bounded, redacted local diagnostics document.
 */
export interface DiagnosticsExportRequestV1 {}
export interface ConfigDescribeRequestV1 {}
export interface ConfigEffectiveRequestV1 {
  project_id?: Uuid1;
  mission_id?: Uuid1;
}
/**
 * Writes one typed value into one layer. The host validates, clamps and refuses widening.
 */
export interface ConfigSetRequestV1 {
  layer: ConfigLayer;
  scope_id?: Uuid1;
  key: SettingKey;
  value: SettingValue;
}
export interface ConfigResetRequestV1 {
  layer: ConfigLayer;
  scope_id?: Uuid1;
  key: SettingKey;
}
