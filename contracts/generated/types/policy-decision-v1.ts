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
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
/**
 * Stable identifier for one end-to-end causal chain: IPC -> Invocation -> Decision -> Audit.
 */
export type CorrelationId = string;
/**
 * Identifier of the immediately preceding message that caused this one.
 */
export type CausationId = string;
export type Obligation =
  | {
      type: "REQUIRE_APPROVAL";
      approver?: "END_USER" | "OPERATOR";
      expires_in_seconds?: number;
    }
  | {
      type: "REQUIRE_CONFINEMENT";
      requirements: ExecutionRequirements;
    }
  | {
      type: "RESTRICT_FILESYSTEM";
      /**
       * @minItems 1
       * @maxItems 64
       */
      paths: [ResourceRef, ...ResourceRef[]];
    }
  | {
      type: "PROHIBIT_NETWORK";
    }
  | {
      type: "REQUIRE_BROKERED_EGRESS";
      /**
       * @minItems 1
       * @maxItems 64
       */
      allowed_destinations: [NetworkDestination, ...NetworkDestination[]];
    }
  | {
      type: "AUDIT";
      level: "STANDARD" | "DETAILED";
    }
  | {
      type: "REDACT";
      /**
       * @minItems 1
       * @maxItems 32
       */
      pointers: [string, ...string[]];
    }
  | {
      type: "MAX_BYTES";
      max_bytes: number;
    };
/**
 * EXPLICIT_GRANT: only paths granted per task, reverted on completion (the W1-proven mode).
 */
export type FilesystemScope = "NONE" | "EXPLICIT_GRANT" | "USER_SCOPE" | "UNRESTRICTED";
/**
 * CONFINED_KILL_ON_CLOSE: descendants cannot break away and all die with the container.
 */
export type ProcessTreeMode = "UNCONSTRAINED" | "CONFINED_KILL_ON_CLOSE";
/**
 * NONE: no egress path exists at all. BROKERED_EGRESS: all egress traverses the POLARIS Egress PEP against a declared destination allow-list; NOT IMPLEMENTED as of W2. UNRESTRICTED: unmediated internet; representable so policy can name and refuse it.
 */
export type NetworkRequirement = "NONE" | "BROKERED_EGRESS" | "UNRESTRICTED";
/**
 * Ambient inheritance is deliberately absent from this enum. W1 proved inherited handles bypass filesystem confinement (probe X03), so it is unrepresentable by construction.
 */
export type HandleInheritanceMode = "NONE" | "EXPLICIT_ONLY";
/**
 * EXPLICIT_ONLY: the environment block is constructed, not inherited.
 */
export type EnvironmentMode = "EXPLICIT_ONLY" | "INHERITED";
export type ResourceKind =
  | "FILESYSTEM_PATH"
  | "PROCESS"
  | "NETWORK_ENDPOINT"
  | "MAILBOX"
  | "SECRET_REF"
  | "MEMORY_STORE"
  | "SYSTEM_SETTING"
  | "PAYMENT_INSTRUMENT"
  | "BROWSER_TARGET";
/**
 * Exact three-part semantic version. Ranges are not permitted in contract payloads.
 */
export type SemVer = string;
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;

/**
 * The PDP verdict for one invocation. Binary result plus typed obligations; approval is an obligation, never a third result.
 */
export interface PolicyDecisionV1 {
  contract_version: ContractVersion;
  decision_id: Uuid;
  invocation_id: Uuid;
  correlation_id: CorrelationId;
  causation_id?: CausationId;
  result: "ALLOW" | "DENY";
  /**
   * @maxItems 32
   */
  obligations: Obligation[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  reason_codes:
    | [
        | "DEFAULT_DENY"
        | "NO_MATCHING_RULE"
        | "EFFECT_NOT_GRANTED"
        | "RISK_CLASS_EXCEEDED"
        | "UNTRUSTED_CALLER"
        | "TAINTED_INPUT"
        | "NETWORK_NOT_BROKERED"
        | "RATE_LIMIT"
        | "APPROVAL_REQUIRED"
        | "EXPLICIT_ALLOW_RULE"
        | "USER_CONSENT_ON_FILE"
        | "CONFIG_DEGRADED"
        | "EVALUATION_ERROR"
        | "RESOURCE_OUT_OF_SCOPE"
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ]
    | [
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        ),
        (
          | "DEFAULT_DENY"
          | "NO_MATCHING_RULE"
          | "EFFECT_NOT_GRANTED"
          | "RISK_CLASS_EXCEEDED"
          | "UNTRUSTED_CALLER"
          | "TAINTED_INPUT"
          | "NETWORK_NOT_BROKERED"
          | "RATE_LIMIT"
          | "APPROVAL_REQUIRED"
          | "EXPLICIT_ALLOW_RULE"
          | "USER_CONSENT_ON_FILE"
          | "CONFIG_DEGRADED"
          | "EVALUATION_ERROR"
          | "RESOURCE_OUT_OF_SCOPE"
        )
      ];
  /**
   * Safe for any trust tier. Never contains rule bodies or policy internals.
   */
  display_reason: string;
  /**
   * Rule-level detail. Withheld from TIER_2_UNTRUSTED callers by the disclosure gate, not by this schema.
   */
  internal_reason?: string;
  policy_ref: {
    policy_version: SemVer;
    policy_epoch: number;
  };
  cacheability: {
    /**
     * false whenever the decision depended on invocation arguments or resource values.
     */
    cacheable: boolean;
    ttl_seconds?: number;
    invalidated_by_policy_epoch?: boolean;
  };
  decided_at: Timestamp;
}
export interface ExecutionRequirements {
  confinement: "NONE" | "CONFINED";
  filesystem_scope: FilesystemScope;
  process_tree: ProcessTreeMode;
  network: NetworkRequirement;
  handle_inheritance: HandleInheritanceMode;
  environment: EnvironmentMode;
  /**
   * Required when filesystem_scope is EXPLICIT_GRANT; forbidden otherwise.
   *
   * @maxItems 64
   */
  granted_paths?: ResourceRef[];
  /**
   * Required when network is BROKERED_EGRESS; forbidden otherwise.
   *
   * @maxItems 64
   */
  allowed_destinations?: NetworkDestination[];
  max_wall_clock_ms?: number;
  max_output_bytes?: number;
}
export interface ResourceRef {
  kind: ResourceKind;
  /**
   * Opaque to Core. Interpreted only by the platform adapter that owns the resource kind.
   */
  locator: string;
  /**
   * SUBTREE is only meaningful for hierarchical kinds such as FILESYSTEM_PATH.
   */
  scope?: "EXACT" | "SUBTREE";
}
export interface NetworkDestination {
  /**
   * DNS name or literal address. Wildcards are not permitted in v1.
   */
  host: string;
  port: number;
  protocol: "HTTPS" | "HTTP" | "TCP" | "UDP";
}
