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
 * Lowercase namespaced identifier used for capability and policy names.
 */
export type Slug = string;
/**
 * Exact three-part semantic version. Ranges are not permitted in contract payloads.
 */
export type SemVer = string;
/**
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
 * UNKNOWN is a valid, honest answer and forbids automatic retry of a side-effecting capability.
 */
export type IdempotencySemantics =
  "AT_MOST_ONCE_LOCAL" | "AT_LEAST_ONCE" | "PROVIDER_IDEMPOTENT" | "BEST_EFFORT" | "UNKNOWN";
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex1 = string;

/**
 * What a capability CLAIMS it needs. This document is a privilege request submitted by an untrusted author, never a security attestation.
 */
export interface CapabilityDescriptorV1 {
  contract_version: ContractVersion;
  capability_id: Slug;
  capability_version: SemVer;
  display_name: string;
  description?: string;
  source: {
    origin: "BUILT_IN" | "FIRST_PARTY" | "THIRD_PARTY" | "USER_LOCAL";
    publisher_id: Slug;
    uri?: string;
  };
  input_schema_ref: string;
  output_schema_ref: string;
  /**
   * Machine-visible restatement of the rule: a declared effect is a request, not a guarantee. Constant so no descriptor can assert otherwise.
   */
  effect_declaration_semantics: "REQUESTED_PRIVILEGE";
  requested_effects: EffectList;
  risk_class: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  execution_requirements: ExecutionRequirements;
  /**
   * Required whenever UNRESTRICTED network is requested. No capability receives unmediated egress implicitly.
   */
  network_justification?: string;
  idempotency: IdempotencySpec;
  /**
   * @minItems 1
   * @maxItems 3
   */
  platform_requirements:
    | ["ANY" | "WINDOWS" | "MACOS"]
    | ["ANY" | "WINDOWS" | "MACOS", "ANY" | "WINDOWS" | "MACOS"]
    | ["ANY" | "WINDOWS" | "MACOS", "ANY" | "WINDOWS" | "MACOS", "ANY" | "WINDOWS" | "MACOS"];
  provenance?: {
    signed: boolean;
    signature_alg?: "ED25519";
    publisher_key_id?: Sha256Hex;
    signature?: string;
  };
  integrity?: Integrity;
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
export interface IdempotencySpec {
  semantics: IdempotencySemantics;
  /**
   * Whether the runtime may retry without operator confirmation.
   */
  retry_safe: boolean;
  /**
   * How the idempotency key for an invocation of this capability is produced.
   */
  key_derivation?: "CALLER_SUPPLIED" | "ARGUMENT_DIGEST";
}
/**
 * Digest of the canonicalised descriptor with this field removed.
 */
export interface Integrity {
  /**
   * Deterministic JSON canonicalisation: UTF-8, lexicographic key order by UTF-16 code unit, no insignificant whitespace, integers without exponent.
   */
  canonicalization: "POLARIS-CJSON-1";
  hash_alg: "SHA-256";
  hash: Sha256Hex;
  prev_hash?: Sha256Hex1;
}
