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
 * Unique per attempt. Distinct from idempotency_key by design.
 */
export type Uuid = string;
/**
 * Stable identifier for one end-to-end causal chain: IPC -> Invocation -> Decision -> Audit.
 */
export type CorrelationId = string;
/**
 * The IPC message_id or model output id that produced this invocation.
 */
export type CausationId = string;
/**
 * Constant across every retry of the same logical operation.
 */
export type IdempotencyKey = string;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid1 = string;
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
 * Must be a subset of the descriptor's requested_effects. Enforced by INV-002, not by this schema.
 *
 * @minItems 1
 * @maxItems 64
 */
export type EffectList = [Effect, ...Effect[]];
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
/**
 * Data lineage marker. Propagated, never silently cleared.
 */
export type TaintLabel =
  "UNTRUSTED_WEB" | "UNTRUSTED_EMAIL" | "UNTRUSTED_FILE" | "MODEL_GENERATED" | "USER_SUPPLIED" | "SYSTEM_DERIVED";
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
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;

/**
 * A concrete, attributed request to execute one capability. Carries identity, causality, taint and the exact privileges being exercised.
 */
export interface CapabilityInvocationV1 {
  contract_version: ContractVersion;
  invocation_id: Uuid;
  correlation_id: CorrelationId;
  causation_id?: CausationId;
  idempotency_key: IdempotencyKey;
  mission_id: Uuid1;
  agent_id?: Uuid1;
  caller_identity: CallerIdentity;
  capability_id: Slug;
  capability_version: SemVer;
  requested_effects: EffectList;
  resource?: ResourceRef1;
  /**
   * Validated against the descriptor's input_schema_ref by the runtime; opaque here.
   */
  arguments: {};
  /**
   * @maxItems 16
   */
  taint_labels?:
    | []
    | [TaintLabel]
    | [TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel]
    | [TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel, TaintLabel]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ]
    | [
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel,
        TaintLabel
      ];
  /**
   * @maxItems 32
   */
  provenance_refs?: ProvenanceRef[];
  /**
   * 1 for the first try. Bounded so no retry loop is unbounded by construction.
   */
  attempt: number;
  execution_constraints: ExecutionRequirements;
  /**
   * Policy state this invocation was prepared against. Present without building a Config Service in W2.
   */
  policy_ref?: {
    policy_version: SemVer;
    policy_epoch: number;
  };
  created_at: Timestamp;
}
export interface CallerIdentity {
  caller_type: CallerType;
  principal_id: Uuid1;
  trust_tier: TrustTier;
  session_id: Uuid1;
  on_behalf_of?: PrincipalRef;
}
/**
 * Delegation is explicit and exactly one hop deep. Deeper chains require a contract revision, not nesting.
 */
export interface PrincipalRef {
  caller_type: CallerType;
  principal_id: Uuid1;
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
/**
 * Primary subject of the invocation, when it has one.
 */
export interface ResourceRef1 {
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
export interface ProvenanceRef {
  kind: "AUDIT_EVENT" | "MODEL_OUTPUT" | "CAPABILITY_RESULT" | "USER_INPUT";
  ref: Uuid1;
}
/**
 * The confinement the runtime will actually apply, at or below what the descriptor requested.
 */
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
