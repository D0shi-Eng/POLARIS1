/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads the twelve Phase-04 operations return. No result carries a credential, a raw MCP body, a filesystem path outside a declared reference, or hidden model reasoning.
 */
export type DesktopPhase04ResultPayloadV1 =
  | SkillListResultV1
  | SkillGetResultV1
  | SkillConfigureResultV1
  | ToolListResultV1
  | ToolGetResultV1
  | ToolActivityListResultV1
  | McpListResultV1
  | McpRegisterResultV1
  | McpConfigureResultV1
  | McpRefreshResultV1
  | ApprovalListResultV1
  | ToolApprovalRespondResultV1;
/**
 * Stable identifier of a skill. Lowercase and bounded; it is never free text from a model.
 */
export type SkillId = string;
export type BoundedLabel = string;
/**
 * A bounded description. For an MCP-supplied description this is untrusted data that is displayed, never merged into an instruction.
 */
export type BoundedDescription = string;
/**
 * Exact three-part semantic version. Ranges are not permitted in contract payloads.
 */
export type SemVer = string;
/**
 * Stable identifier of a registered tool. A tool that is not in the registry under this exact identifier cannot be invoked.
 */
export type ToolId = string;
export type RiskClass = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
/**
 * Where the skill definition came from. No source grants authority; the source only records provenance.
 */
export type SkillSource = "BUILT_IN" | "USER_DEFINED" | "MCP_BACKED";
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
export type ToolProvider = "BUILT_IN" | "MCP";
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
/**
 * The network a tool may reach. No tool is granted free remote egress. LOOPBACK_ONLY is the loopback interface. WEB_NAVIGATION_POLICY (added by Phase-05) is held only by the built-in, trusted browser tools: http and https to public hosts on web ports, every name resolved and every address checked at connect time, every redirect re-checked, and loopback, private, link-local and metadata destinations refused. An MCP or untrusted tool can never hold it. CONNECTOR_EGRESS_POLICY (added by Phase-06) is held only by built-in, trusted connector tools: the host, path template and method come from the connector the user registered, public destinations are resolved and checked at connect time over HTTPS, loopback is literal, redirects are never followed, and the connector gateway enforces all of it. An MCP or untrusted tool can never hold it. MCP_REGISTERED_HTTPS (added by Phase-06) is held only by an untrusted MCP tool of a REMOTE_HTTPS server and always comes with EXTERNAL_SIDE_EFFECT, so every call waits for a human decision; public destinations are resolved and checked at connect time.
 */
export type NetworkPolicy =
  "NONE" | "LOOPBACK_ONLY" | "WEB_NAVIGATION_POLICY" | "CONNECTOR_EGRESS_POLICY" | "MCP_REGISTERED_HTTPS";
/**
 * TRUSTED_RUNTIME describes the adapter POLARIS itself implements. MCP_UNTRUSTED marks everything a server supplied: its metadata and its output are data.
 */
export type ToolTrustClass = "TRUSTED_RUNTIME" | "MCP_UNTRUSTED";
/**
 * Identifier the host issues for a registered MCP server. The server never chooses it.
 */
export type McpServerId = string;
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
export type ToolInvocationStatus = "SUCCEEDED" | "FAILED" | "DENIED" | "TIMED_OUT" | "CANCELLED" | "AWAITING_APPROVAL";
/**
 * Why the gateway refused or ended an invocation. Closed: a refusal is always one of these, never free prose.
 */
export type ToolDenialReason =
  | "UNKNOWN_TOOL"
  | "TOOL_DISABLED"
  | "SKILL_DISABLED"
  | "SKILL_DOES_NOT_ALLOW_TOOL"
  | "ARGUMENTS_INVALID"
  | "CAPABILITY_MISSING"
  | "EFFECT_NOT_PERMITTED"
  | "NETWORK_POLICY_DENIED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_MISSING"
  | "APPROVAL_MISMATCH"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALREADY_USED"
  | "APPROVAL_DENIED"
  | "BUDGET_EXHAUSTED"
  | "CROSS_MISSION_DENIED"
  | "SERVER_DISABLED"
  | "SERVER_UNREACHABLE"
  | "SCHEMA_DRIFT"
  | "RESULT_TOO_LARGE"
  | "RESULT_MALFORMED"
  | "SECRET_REQUESTED"
  | "CANCELLED";
/**
 * LOOPBACK_HTTP: a server on the loopback interface. REMOTE_HTTPS (added by Phase-06): a server the user registered on a public https address, resolved and checked at every connection; its tools carry EXTERNAL_SIDE_EFFECT and wait for a human decision on every call. A process-spawning transport (STDIO) is PROCESS_EXECUTION and is deliberately out of scope.
 */
export type McpTransport = "LOOPBACK_HTTP" | "REMOTE_HTTPS";
export type McpServerState = "REGISTERED" | "ENABLED" | "DISABLED" | "UNREACHABLE";
export type ApprovalStatus = "PENDING" | "GRANTED" | "DENIED" | "EXPIRED" | "CONSUMED";

export interface SkillListResultV1 {
  /**
   * @maxItems 200
   */
  skills: SkillViewV1[];
}
export interface SkillViewV1 {
  skill_id: SkillId;
  name: BoundedLabel;
  description: BoundedDescription;
  version: SemVer;
  enabled: boolean;
  /**
   * @maxItems 32
   */
  required_capabilities: BoundedLabel[];
  /**
   * The only tools a task running under this skill may propose. A tool outside this list is denied even when it exists and is enabled.
   *
   * @maxItems 64
   */
  allowed_tools: ToolId[];
  input_schema_ref: BoundedLabel;
  output_schema_ref: BoundedLabel;
  risk_class: RiskClass;
  source: SkillSource;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface SkillGetResultV1 {
  skill: SkillViewV1;
  /**
   * The registered descriptors of the tools this skill allows. A name in allowed_tools with no descriptor here is a tool that does not exist.
   *
   * @maxItems 64
   */
  tools: ToolViewV1[];
}
export interface ToolViewV1 {
  tool_id: ToolId;
  provider: ToolProvider;
  name: BoundedLabel;
  description: BoundedDescription;
  /**
   * @minItems 1
   * @maxItems 10
   */
  effects:
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
  /**
   * @maxItems 32
   */
  required_capabilities: BoundedLabel[];
  risk: RiskClass;
  requires_approval: boolean;
  network_policy: NetworkPolicy;
  enabled: boolean;
  trust_class: ToolTrustClass;
  input_schema_ref: BoundedLabel;
  output_schema_ref: BoundedLabel;
  provenance: {
    origin: BoundedLabel;
    server_id?: McpServerId;
    server_name?: BoundedLabel;
    /**
     * What the server asked for. It is a request, never a grant: the effective effects are the intersection with what the user granted the server.
     *
     * @maxItems 10
     */
    declared_effects?:
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
    schema_digest?: Sha256Hex;
    registered_at: Timestamp;
  };
}
export interface SkillConfigureResultV1 {
  skill: SkillViewV1;
}
export interface ToolListResultV1 {
  /**
   * @maxItems 500
   */
  tools: ToolViewV1[];
}
export interface ToolGetResultV1 {
  tool: ToolViewV1;
  /**
   * @maxItems 200
   */
  allowed_by_skills?: SkillId[];
}
export interface ToolActivityListResultV1 {
  mission_id?: Uuid;
  /**
   * @maxItems 500
   */
  invocations: ToolInvocationViewV1[];
  summary?: MissionToolSummaryV1;
}
/**
 * One record of one attempt to use a tool. A denied attempt is recorded exactly like a successful one; silence is never the record of a refusal.
 */
export interface ToolInvocationViewV1 {
  invocation_id: Uuid;
  mission_id: Uuid;
  task_id?: Uuid;
  agent_id?: Uuid;
  skill_id?: SkillId;
  tool_id: ToolId;
  status: ToolInvocationStatus;
  denial_reason?: ToolDenialReason;
  /**
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
  arguments_digest: Sha256Hex;
  result_digest?: Sha256Hex;
  evidence_id?: Uuid;
  approval_id?: Uuid;
  summary?: BoundedDescription;
  started_at: Timestamp;
  duration_ms: number;
}
export interface MissionToolSummaryV1 {
  mission_id: Uuid;
  /**
   * @maxItems 500
   */
  invocations: ToolInvocationViewV1[];
  /**
   * @maxItems 64
   */
  skills_used: SkillId[];
  /**
   * @maxItems 64
   */
  tools_used: ToolId[];
  budget: ToolBudgetV1;
  usage: ToolBudgetUsageV1;
  pending_approvals?: number;
}
/**
 * Every tool budget dimension, checked by reservation before the call, never after it.
 */
export interface ToolBudgetV1 {
  max_tool_calls: number;
  max_tool_calls_per_task: number;
  max_external_side_effects: number;
  max_network_tool_calls: number;
  max_tool_runtime_ms: number;
}
export interface ToolBudgetUsageV1 {
  tool_calls: number;
  external_side_effects: number;
  network_tool_calls: number;
  tool_runtime_ms: number;
}
export interface McpListResultV1 {
  /**
   * @maxItems 100
   */
  servers: McpServerViewV1[];
}
export interface McpServerViewV1 {
  server_id: McpServerId;
  name: BoundedLabel;
  /**
   * The loopback endpoint as the host resolved it. It carries no credential because a tool server is never given one.
   */
  endpoint: string;
  transport: McpTransport;
  state: McpServerState;
  /**
   * @maxItems 10
   */
  granted_effects:
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
  tool_count: number;
  rejected_tool_count?: number;
  last_error?: ToolDenialReason;
  last_refresh_at?: Timestamp;
  registered_at: Timestamp;
}
export interface McpRegisterResultV1 {
  server: McpServerViewV1;
}
export interface McpConfigureResultV1 {
  server: McpServerViewV1;
}
export interface McpRefreshResultV1 {
  server: McpServerViewV1;
  /**
   * @maxItems 200
   */
  accepted: ToolViewV1[];
  /**
   * Tools whose definition changed after discovery and that stay disabled until the user accepts the new definition (remediation 2026-10-12).
   *
   * @maxItems 200
   */
  pending_redefinitions?: ToolId[];
  /**
   * Every tool the server offered and the registry refused, with the reason. A rejected tool is reported, never silently dropped.
   *
   * @maxItems 200
   */
  rejected: {
    declared_name: BoundedLabel;
    reason: ToolDenialReason;
    detail?: BoundedDescription;
  }[];
}
export interface ApprovalListResultV1 {
  /**
   * @maxItems 200
   */
  approvals: ApprovalViewV1[];
}
/**
 * An approval is bound to one mission, one task, one tool, one arguments digest, one effect set and one expiry. It cannot be replayed for anything else.
 */
export interface ApprovalViewV1 {
  approval_id: Uuid;
  mission_id: Uuid;
  task_id?: Uuid;
  tool_id: ToolId;
  skill_id?: SkillId;
  /**
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
  arguments_digest: Sha256Hex;
  arguments_preview?: BoundedDescription;
  reason?: BoundedDescription;
  status: ApprovalStatus;
  requested_at: Timestamp;
  decided_at?: Timestamp;
  expires_at: Timestamp;
  context?: ApprovalContextV1;
}
/**
 * A trusted summary of what approving would allow, written by the runtime from its own state (session, page, window, element), never from model prose. Optional: Phase-04 tools do not write it.
 */
export interface ApprovalContextV1 {
  agent_id: Uuid;
  action: string;
  target: string;
  expected_effect: string;
  risk: RiskClass;
  arguments_summary: string;
}
export interface ToolApprovalRespondResultV1 {
  approval: ApprovalViewV1;
}
