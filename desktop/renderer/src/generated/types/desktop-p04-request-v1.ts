/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the twelve Phase-04 operations accept. No payload can name a tool that is not registered, carry a raw command, name a remote destination, or carry a credential.
 */
export type DesktopPhase04RequestPayloadV1 =
  | SkillListRequestV1
  | SkillGetRequestV1
  | SkillConfigureRequestV1
  | ToolListRequestV1
  | ToolGetRequestV1
  | ToolActivityListRequestV1
  | McpListRequestV1
  | McpRegisterRequestV1
  | McpConfigureRequestV1
  | McpRefreshRequestV1
  | ApprovalListRequestV1
  | ToolApprovalRespondRequestV1;
/**
 * Stable identifier of a skill. Lowercase and bounded; it is never free text from a model.
 */
export type SkillId = string;
export type ToolProvider = "BUILT_IN" | "MCP";
/**
 * Stable identifier of a registered tool. A tool that is not in the registry under this exact identifier cannot be invoked.
 */
export type ToolId = string;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
export type BoundedLabel = string;
/**
 * LOOPBACK_HTTP: a server on the loopback interface. REMOTE_HTTPS (added by Phase-06): a server the user registered on a public https address, resolved and checked at every connection; its tools carry EXTERNAL_SIDE_EFFECT and wait for a human decision on every call. A process-spawning transport (STDIO) is PROCESS_EXECUTION and is deliberately out of scope.
 */
export type McpTransport = "LOOPBACK_HTTP" | "REMOTE_HTTPS";
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
 * Identifier the host issues for a registered MCP server. The server never chooses it.
 */
export type McpServerId = string;
export type ApprovalDecision = "GRANT" | "DENY";

/**
 * Lists every skill the host knows, enabled or not. No side effect.
 */
export interface SkillListRequestV1 {}
export interface SkillGetRequestV1 {
  skill_id: SkillId;
}
/**
 * Enables or disables a known skill. It cannot create a skill, widen its allowed tools, or change its risk class.
 */
export interface SkillConfigureRequestV1 {
  skill_id: SkillId;
  enabled: boolean;
}
export interface ToolListRequestV1 {
  provider?: ToolProvider;
  skill_id?: SkillId;
}
/**
 * Reads one registered tool descriptor. Reading a descriptor is not permission to invoke it, and this operation performs no invocation.
 */
export interface ToolGetRequestV1 {
  tool_id: ToolId;
}
export interface ToolActivityListRequestV1 {
  mission_id?: Uuid;
  limit?: number;
}
export interface McpListRequestV1 {}
/**
 * Registers an MCP server. Registration alone discovers nothing and grants nothing beyond this ceiling.
 */
export interface McpRegisterRequestV1 {
  name: BoundedLabel;
  /**
   * A loopback endpoint, or (Phase-06) a public https endpoint without credentials, query or fragment. The pattern is a first gate; the host resolves the endpoint again, refuses private, link-local and metadata addresses, and checks every address at connect time.
   */
  endpoint: string;
  transport?: McpTransport;
  /**
   * The ceiling the user grants this server. A tool from this server can never hold an effect outside this set, whatever the server declares.
   *
   * @maxItems 9
   */
  granted_effects?:
    | []
    | [ToolEffect]
    | [ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect]
    | [ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect, ToolEffect];
}
export interface McpConfigureRequestV1 {
  server_id: McpServerId;
  enabled: boolean;
}
/**
 * Re-discovers the tools of one server. Every discovered tool is validated again; a server that changed a tool definition has its old descriptor replaced only after the new one passes.
 */
export interface McpRefreshRequestV1 {
  server_id: McpServerId;
}
export interface ApprovalListRequestV1 {
  mission_id?: Uuid;
}
/**
 * Answers a pending approval by its identifier. The payload cannot restate the tool, the arguments or the effects: the binding was fixed when the approval was requested. scope MISSION was added additively (ADR-042).
 */
export interface ToolApprovalRespondRequestV1 {
  approval_id: Uuid;
  decision: ApprovalDecision;
  /**
   * ONCE (default) allows this exact call. MISSION also allows the same tool on the same resource with the same effects for the rest of this mission, until it expires or is revoked; the gateway still evaluates policy on every call, and tools with external, secret, desktop-input, process or database-write effects never accept it (ADR-042).
   */
  scope?: "ONCE" | "MISSION";
}
