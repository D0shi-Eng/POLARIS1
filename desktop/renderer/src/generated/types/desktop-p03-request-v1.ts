/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the ten Phase-03 operations accept. Every payload is a closed object; none can carry an operation name, a URL, a header, or a credential.
 */
export type DesktopPhase03RequestPayloadV1 =
  | MissionListRequestV1
  | MissionGetRequestV1
  | MissionCreateRequestV1
  | MissionStartRequestV1
  | MissionCancelRequestV1
  | MissionResumeRequestV1
  | TaskListRequestV1
  | AgentListRequestV1
  | ClaimListRequestV1
  | EvidenceListRequestV1;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
export type MissionTitle = string;
export type MissionObjective = string;
/**
 * The two Phase-03 execution modes. There is no swarm mode, because there is no swarm semantics yet.
 */
export type ExecutionMode = "SINGLE_AGENT" | "COORDINATED_MULTI_AGENT";
/**
 * Priority, used only as a deterministic scheduling tiebreak.
 */
export type MissionPriority = "LOW" | "NORMAL" | "HIGH";
/**
 * Named budget presets. The values each preset expands to are shown to the user; no preset is called best or smart, because nothing measured says it is.
 */
export type BudgetPreset = "CONSERVATIVE" | "BALANCED" | "EXTENDED" | "CUSTOM";

/**
 * Lists missions, optionally narrowed to one project. No side effect.
 */
export interface MissionListRequestV1 {
  project_id?: Uuid;
}
export interface MissionGetRequestV1 {
  mission_id: Uuid;
}
/**
 * Creates a mission. It does not start it: creation and execution are separate operations so that starting work is always an explicit act.
 */
export interface MissionCreateRequestV1 {
  title: MissionTitle;
  objective: MissionObjective;
  project_id?: Uuid;
  execution_mode?: ExecutionMode;
  priority?: MissionPriority;
  budget_preset?: BudgetPreset;
  budget?: MissionBudget;
  /**
   * @maxItems 50
   */
  requirements?: MissionRequirementInputV1[];
}
/**
 * Every enforced budget dimension. The upper bounds here are contract ceilings, not recommendations; the product default is conservative.
 */
export interface MissionBudget {
  max_wall_clock_ms: number;
  max_model_calls: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_total_tokens: number;
  max_tasks: number;
  max_agent_instances: number;
  max_active_agents: number;
  max_concurrent_model_calls: number;
  max_delegations: number;
  max_delegation_depth: number;
  max_retries: number;
  max_review_rounds: number;
  max_graph_revisions: number;
  max_tool_calls?: number;
  max_tool_calls_per_task?: number;
  max_external_side_effects?: number;
  max_network_tool_calls?: number;
  max_tool_runtime_ms?: number;
}
export interface MissionRequirementInputV1 {
  requirement_id: string;
  text: string;
  mandatory: boolean;
  verification_rule_id?: string;
}
/**
 * Starts orchestration for one mission that this session owns.
 */
export interface MissionStartRequestV1 {
  mission_id: Uuid;
}
/**
 * Cancels one mission. There is no cancel-all.
 */
export interface MissionCancelRequestV1 {
  mission_id: Uuid;
}
/**
 * Resumes a mission that a restart left blocked. Resuming never replays a completed side effect.
 */
export interface MissionResumeRequestV1 {
  mission_id: Uuid;
}
export interface TaskListRequestV1 {
  mission_id: Uuid;
}
/**
 * Lists role descriptors always, and the agent instances of one mission when a mission is named.
 */
export interface AgentListRequestV1 {
  mission_id?: Uuid;
}
export interface ClaimListRequestV1 {
  mission_id: Uuid;
}
export interface EvidenceListRequestV1 {
  mission_id: Uuid;
}
