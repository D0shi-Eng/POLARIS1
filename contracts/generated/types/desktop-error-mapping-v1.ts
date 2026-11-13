/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * MAJOR.MINOR contract version. Consumers reject unknown MAJOR and unknown-higher MINOR.
 */
export type ContractVersion = string;
/**
 * The nine categories a Phase-01 screen may render. Closed: a tenth category is a contract change, not a string a component invents.
 */
export type DesktopErrorCategory =
  | "IPC_UNAVAILABLE"
  | "IPC_TIMEOUT"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_RESPONSE"
  | "NATIVE_SERVICE_UNAVAILABLE"
  | "CONFIG_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "FEATURE_NOT_AVAILABLE"
  | "INTERNAL_ERROR";
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_VERSION"
  | "POLICY_DENIED"
  | "MALFORMED_MESSAGE"
  | "CONTRACT_VIOLATION"
  | "DEPENDENCY_UNAVAILABLE"
  | "TIMEOUT"
  | "CONFLICT"
  | "INTERNAL_ERROR";
/**
 * Default redaction applied before an error crosses to the renderer. STRIP_INTERNAL_DETAIL removes internal_detail and keeps the JSON pointer; STRIP_ALL_DETAIL removes both, for errors whose pointer would itself describe host internals.
 */
export type Redaction = "STRIP_INTERNAL_DETAIL" | "STRIP_ALL_DETAIL";
/**
 * Localization key for the message shown. The contract carries no prose.
 */
export type DisplayKey = string;

/**
 * How the frozen POLARIS error vocabulary becomes a UI-facing category, and what is allowed to cross the trust boundary with it. This is a mapping over the existing vocabulary, never a second error universe.
 */
export interface DesktopErrorMappingV1 {
  contract_version: ContractVersion;
  phase: "PHASE-01";
  /**
   * @minItems 1
   * @maxItems 32
   */
  entries: [DesktopErrorMappingEntry, ...DesktopErrorMappingEntry[]];
}
export interface DesktopErrorMappingEntry {
  category: DesktopErrorCategory;
  /**
   * The frozen error codes that produce this category. The union over all entries must cover the whole vocabulary; a completeness test proves it.
   *
   * @minItems 1
   * @maxItems 9
   */
  canonical_codes:
    | [ErrorCode]
    | [ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode]
    | [ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode, ErrorCode];
  /**
   * Whether the shell may offer a retry. A retry offered for a permanent failure teaches the user to distrust the button.
   */
  retryable: boolean;
  /**
   * Whether internal_detail may reach the renderer. In Phase-01 this is false for every entry; a trusted diagnostics path is a later phase and would have to flip this in the open.
   */
  detail_may_cross_boundary: boolean;
  default_redaction: Redaction;
  display_key: DisplayKey;
}
