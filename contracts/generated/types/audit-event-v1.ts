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
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
/**
 * Class of principal. Closed set: an unknown caller type is a contract violation, not an extension point.
 */
export type CallerType = "CORE_UI" | "USER" | "AGENT" | "PLUGIN" | "SYSTEM";
/**
 * Disclosure tier. Internal policy reasoning is withheld from TIER_2_UNTRUSTED callers.
 */
export type TrustTier = "TIER_0_TRUSTED" | "TIER_1_LIMITED" | "TIER_2_UNTRUSTED";
/**
 * Lowercase namespaced identifier used for capability and policy names.
 */
export type Slug = string;
/**
 * Exact three-part semantic version. Ranges are not permitted in contract payloads.
 */
export type SemVer = string;
/**
 * Closed v1 vocabulary. Extension happens by contract version bump, not by free strings.
 */
export type EffectAction =
  | "read.filesystem"
  | "write.filesystem"
  | "create.filesystem"
  | "delete.filesystem"
  | "execute.process"
  | "install.package"
  | "network.fetch"
  | "network.send"
  | "network.publish"
  | "browser.navigate"
  | "browser.submit"
  | "email.read"
  | "email.send"
  | "secret.reference"
  | "secret.deref"
  | "memory.read"
  | "memory.write"
  | "system.read"
  | "system.modify"
  | "payment.prepare"
  | "payment.commit";
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
 * Sensitivity of the data the effect touches.
 */
export type DataClassification = "PUBLIC" | "INTERNAL" | "SENSITIVE" | "SECRET";
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
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex1 = string;

/**
 * A causal, replayable record. Not a log line: every event names its actor, its cause and the decision that authorised it.
 */
export interface AuditEventV1 {
  contract_version: ContractVersion;
  event_id: Uuid;
  event_type:
    | "IPC_MESSAGE_RECEIVED"
    | "CAPABILITY_DESCRIBED"
    | "INVOCATION_REQUESTED"
    | "POLICY_EVALUATED"
    | "APPROVAL_REQUESTED"
    | "APPROVAL_RESOLVED"
    | "EXECUTION_STARTED"
    | "EXECUTION_COMPLETED"
    | "MODEL_OUTPUT_VALIDATED"
    | "CONTRACT_VIOLATION_DETECTED"
    | "MISSION_STARTED"
    | "MISSION_COMPLETED"
    | "MISSION_FAILED"
    | "CAPABILITY_PROPOSED"
    | "APPROVAL_REQUIRED"
    | "APPROVAL_PRESENTED"
    | "APPROVAL_GRANTED"
    | "APPROVAL_REJECTED"
    | "APPROVAL_EXPIRED"
    | "APPROVAL_REPLAY_REFUSED"
    | "EXECUTION_GRANT_ISSUED"
    | "PANIC_STOP_REQUESTED"
    | "PANIC_STOP_ENTERED"
    | "EXECUTOR_TERMINATED_BY_STOP"
    | "PANIC_STOP_COMPLETED"
    | "SYSTEM_RESUMED"
    | "COMPLETION_PROOF_CREATED"
    | "COMPLETION_PROOF_FAILED";
  correlation_id: CorrelationId;
  causation_id?: CausationId;
  occurred_at: Timestamp;
  /**
   * Monotonic per correlation_id. Breaks timestamp ties so ordering is total and hash chaining is well-defined.
   */
  sequence: number;
  /**
   * The component that performed the action. Distinct from caller_identity, which is who asked for it.
   */
  actor: {
    kind: "CORE" | "AGENT" | "USER" | "PLUGIN" | "SYSTEM";
    id: Uuid;
  };
  caller_identity: CallerIdentity;
  mission_id?: Uuid;
  agent_id?: Uuid;
  capability_ref?: {
    capability_id: Slug;
    capability_version: SemVer;
  };
  invocation_id?: Uuid;
  decision_id?: Uuid;
  /**
   * @maxItems 64
   */
  effects?: Effect[];
  resource?: ResourceRef;
  outcome: {
    status: "SUCCESS" | "DENIED" | "FAILED" | "TIMEOUT" | "CANCELLED";
    error?: ContractError;
    duration_ms?: number;
  };
  policy_ref?: {
    policy_version: SemVer;
    policy_epoch: number;
  };
  /**
   * @maxItems 32
   */
  provenance_refs?: ProvenanceRef[];
  /**
   * Bounded, string-only, slug-keyed. Secret-bearing keys and values are rejected by the audit hygiene rule (INV-007), which this schema alone cannot express.
   */
  metadata?: {
    [k: string]: string;
  };
  integrity?: Integrity;
}
export interface CallerIdentity {
  caller_type: CallerType;
  principal_id: Uuid;
  trust_tier: TrustTier;
  session_id: Uuid;
  on_behalf_of?: PrincipalRef;
}
/**
 * Delegation is explicit and exactly one hop deep. Deeper chains require a contract revision, not nesting.
 */
export interface PrincipalRef {
  caller_type: CallerType;
  principal_id: Uuid;
}
export interface Effect {
  action: EffectAction;
  resource?: ResourceRef;
  destination?: NetworkDestination;
  data_classification?: DataClassification;
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
export interface ContractError {
  code: ErrorCode;
  /**
   * Safe to show any caller at any trust tier.
   */
  display_message: string;
  /**
   * Withheld from TIER_2_UNTRUSTED callers.
   */
  internal_detail?: string;
  /**
   * RFC 6901 JSON Pointer into the offending payload.
   */
  pointer?: string;
  retryable?: boolean;
}
export interface ProvenanceRef {
  kind: "AUDIT_EVENT" | "MODEL_OUTPUT" | "CAPABILITY_RESULT" | "USER_INPUT";
  ref: Uuid;
}
export interface Integrity {
  /**
   * Deterministic JSON canonicalisation: UTF-8, lexicographic key order by UTF-16 code unit, no insignificant whitespace, integers without exponent.
   */
  canonicalization: "POLARIS-CJSON-1";
  hash_alg: "SHA-256";
  hash: Sha256Hex;
  prev_hash?: Sha256Hex1;
}
