/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the nineteen Phase-02 operations accept. Every payload is a closed object; no field can carry a URL chosen by the renderer, a header, or a credential.
 */
export type DesktopPhase02RequestPayloadV1 =
  | ProviderListRequestV1
  | ProviderConfigureRequestV1
  | ProviderCredentialSetRequestV1
  | ProviderCredentialClearRequestV1
  | ProviderRefreshRequestV1
  | ModelListRequestV1
  | ModelConfigureRequestV1
  | ModelPreferencesSetRequestV1
  | ModelInvokeRequestV1
  | ModelCancelRequestV1
  | ProjectListRequestV1
  | ProjectGetRequestV1
  | ProjectCreateRequestV1
  | ProjectUpdateRequestV1
  | ProjectArchiveRequestV1
  | ContextAddRequestV1
  | ContextRemoveRequestV1
  | ContextPreviewRequestV1
  | ContextAssembleRequestV1;
/**
 * Identifier of a registered provider instance. Only ids the host registered are ever routed; an unknown id is refused by the host, not merely absent.
 */
export type ProviderId = string;
/**
 * Stable model identity: <provider_id>:<provider_model_id>. Quotes, angle brackets, backslash, backtick and whitespace are unrepresentable.
 */
export type ModelId = string;
/**
 * How much hidden reasoning the user asks every provider for. MAX is the provider's highest level; a compatible interface that stops at high receives high.
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
 * Project language, one of the nine architectural locales.
 */
export type Language = "ar" | "en" | "de" | "fr" | "ru" | "zh" | "ko" | "ja" | "es";
/**
 * What the renderer may add. WORKSPACE_ROOT is created by the host from the project; SYSTEM_CONTEXT is host-generated and can never be supplied by the renderer.
 */
export type AddableSourceType = "FILE" | "FOLDER" | "TEXT_NOTE" | "USER_INSTRUCTION";

/**
 * Lists every registered provider with its last known health. No network access.
 */
export interface ProviderListRequestV1 {}
export interface ProviderConfigureRequestV1 {
  provider_id: ProviderId;
  enabled?: boolean;
  /**
   * A loopback endpoint for a local provider. Remote endpoints are fixed by the host and cannot be supplied.
   */
  endpoint?: string;
}
/**
 * Asks the host to open its native credential prompt. The request carries no credential and no field could carry one.
 */
export interface ProviderCredentialSetRequestV1 {
  provider_id: ProviderId;
}
export interface ProviderCredentialClearRequestV1 {
  provider_id: ProviderId;
}
/**
 * Probes health and discovers models for the named, enabled providers. A bounded list; there is no refresh-everything wildcard.
 */
export interface ProviderRefreshRequestV1 {
  /**
   * @minItems 1
   * @maxItems 16
   */
  provider_ids:
    | [ProviderId]
    | [ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId, ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId]
    | [ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId, ProviderId]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ]
    | [
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId,
        ProviderId
      ];
}
export interface ModelListRequestV1 {
  provider_id?: ProviderId;
  only_selectable?: boolean;
}
export interface ModelConfigureRequestV1 {
  model_id: ModelId;
  enabled: boolean;
}
export interface ModelPreferencesSetRequestV1 {
  default_model_id?: ModelId | null;
  /**
   * ADR-041: the reasoning-blind action monitor's model. null clears it.
   */
  monitor_model_id?: ModelId | null;
  /**
   * The reviewer model (ADR-040): any discovered model the user chooses, local or remote. Absent or null means no independent review. The host never calls a reviewer the user did not choose.
   */
  review_model_id?: ModelId | null;
  /**
   * The reasoning effort for every provider and model. null returns each provider to its default.
   */
  reasoning_effort?: ReasoningEffortLevel | null;
}
/**
 * A model invocation. There is no URL, header, credential or provider-specific field.
 */
export interface ModelInvokeRequestV1 {
  invocation_id: Uuid;
  routing_mode: RoutingMode;
  model_id?: ModelId;
  /**
   * @minItems 0
   * @maxItems 11
   */
  required_capabilities?:
    | []
    | [ModelCapability]
    | [ModelCapability, ModelCapability]
    | [ModelCapability, ModelCapability, ModelCapability]
    | [ModelCapability, ModelCapability, ModelCapability, ModelCapability]
    | [ModelCapability, ModelCapability, ModelCapability, ModelCapability, ModelCapability]
    | [ModelCapability, ModelCapability, ModelCapability, ModelCapability, ModelCapability, ModelCapability]
    | [
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability
      ]
    | [
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability
      ]
    | [
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability
      ]
    | [
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability
      ]
    | [
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability,
        ModelCapability
      ];
  project_id?: Uuid;
  /**
   * @minItems 0
   * @maxItems 32
   */
  context_source_ids?: Uuid[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  messages: [InvocationMessage, ...InvocationMessage[]];
  system_instruction?: string;
  temperature?: number;
  max_output_tokens?: number;
  response_format?: "TEXT" | "JSON";
  timeout_ms?: number;
}
/**
 * A conversation turn. The renderer cannot author SYSTEM or TOOL turns.
 */
export interface InvocationMessage {
  role: "USER" | "ASSISTANT";
  text: string;
}
/**
 * Cancels one invocation of this session. There is no cancel-all.
 */
export interface ModelCancelRequestV1 {
  invocation_id: Uuid;
}
export interface ProjectListRequestV1 {
  include_archived?: boolean;
  query?: string;
}
export interface ProjectGetRequestV1 {
  project_id: Uuid;
}
export interface ProjectCreateRequestV1 {
  /**
   * Display name.
   */
  name: string;
  /**
   * Free description. It is data, never an instruction.
   */
  description?: string;
  language?: Language;
  /**
   * An absolute local directory. A context scope reference, never a filesystem grant.
   */
  workspace_root?: string;
}
/**
 * Optimistic update: a stale expected_version is a conflict, not a silent overwrite.
 */
export interface ProjectUpdateRequestV1 {
  project_id: Uuid;
  expected_version: number;
  /**
   * Display name.
   */
  name?: string;
  /**
   * Free description. It is data, never an instruction.
   */
  description?: string;
  language?: Language;
  workspace_root?: string | null;
  default_model_id?: ModelId | null;
}
export interface ProjectArchiveRequestV1 {
  project_id: Uuid;
  expected_version: number;
  archived: boolean;
}
export interface ContextAddRequestV1 {
  project_id: Uuid;
  source_type: AddableSourceType;
  /**
   * A path relative to the workspace root. Absolute paths, parent segments and stream names are unrepresentable.
   */
  reference?: string;
  text?: string;
  display_name?: string;
}
export interface ContextRemoveRequestV1 {
  project_id: Uuid;
  source_id: Uuid;
}
export interface ContextPreviewRequestV1 {
  project_id: Uuid;
  source_id: Uuid;
}
export interface ContextAssembleRequestV1 {
  project_id: Uuid;
  /**
   * @minItems 1
   * @maxItems 32
   */
  source_ids: [Uuid, ...Uuid[]];
  instruction: string;
  model_id?: ModelId;
  max_tokens?: number;
  max_files?: number;
}
