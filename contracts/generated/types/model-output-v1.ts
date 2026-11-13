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
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * Data lineage marker. Propagated, never silently cleared.
 */
export type TaintLabel =
  "UNTRUSTED_WEB" | "UNTRUSTED_EMAIL" | "UNTRUSTED_FILE" | "MODEL_GENERATED" | "USER_SUPPLIED" | "SYSTEM_DERIVED";
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;

/**
 * The gate between a model and the capability layer. Model output is not valid merely because it parses as JSON.
 */
export interface ModelOutputContractV1 {
  contract_version: ContractVersion;
  output_id: Uuid;
  correlation_id: CorrelationId;
  causation_id: CausationId;
  mission_id?: Uuid;
  agent_id?: Uuid;
  model_ref: {
    /**
     * Opaque to Core. No provider-specific payload shape enters this contract.
     */
    model_id: string;
    revision?: string;
  };
  output_type: "TEXT" | "STRUCTURED" | "TOOL_INVOCATION_PROPOSAL" | "REFUSAL";
  declared_schema_ref: string;
  declared_schema_version: ContractVersion;
  /**
   * Length of the raw completion. The raw text itself is never carried here.
   */
  raw_length?: number;
  raw_hash?: Sha256Hex;
  validation_status:
    | "VALID"
    | "INVALID_SCHEMA"
    | "MISSING_REQUIRED_FIELD"
    | "UNSUPPORTED_ACTION"
    | "MALFORMED_OUTPUT"
    | "REFUSAL"
    | "TIMEOUT"
    | "MODEL_CONTRACT_VIOLATION";
  /**
   * Present if and only if validation_status is VALID. Absent status means absent payload; there is no partially trusted state.
   */
  parsed_payload?: {};
  /**
   * @maxItems 32
   */
  violations: {
    code:
      | "SCHEMA_MISMATCH"
      | "MISSING_FIELD"
      | "UNKNOWN_ACTION"
      | "UNPARSEABLE"
      | "TRUNCATED"
      | "DISALLOWED_CONTENT"
      | "BUDGET_EXCEEDED";
    pointer?: string;
    detail: string;
  }[];
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
  loop_control: {
    attempt: number;
    /**
     * Bounded by the schema: unbounded retry is unrepresentable.
     */
    max_retries: number;
    iteration: number;
    max_iterations: number;
    /**
     * true when the loop must stop WITHOUT a valid output. A VALID output is never terminal: the loop ended by succeeding, not by exhausting a budget.
     */
    terminal: boolean;
    failure_reason?: "RETRY_BUDGET_EXHAUSTED" | "ITERATION_BUDGET_EXHAUSTED" | "NON_RETRYABLE_VIOLATION";
  };
  produced_at: Timestamp;
}
