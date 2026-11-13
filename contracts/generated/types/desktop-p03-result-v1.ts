/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads the ten Phase-03 operations return. No result carries a secret, a raw provider body, a filesystem path outside a declared reference, or hidden model reasoning.
 */
export type DesktopPhase03ResultPayloadV1 =
  | MissionListResultV1
  | MissionGetResultV1
  | MissionCreateResultV1
  | MissionStartResultV1
  | MissionCancelResultV1
  | MissionResumeResultV1
  | TaskListResultV1
  | AgentListResultV1
  | ClaimListResultV1
  | EvidenceListResultV1;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
export type MissionTitle = string;
/**
 * Where an instruction or fact came from. Only SYSTEM_POLICY and DIRECT_USER_INSTRUCTION may command; an agent message never becomes a user instruction.
 */
export type AuthorityClass =
  | "SYSTEM_POLICY"
  | "DIRECT_USER_INSTRUCTION"
  | "TRUSTED_RUNTIME_FACT"
  | "AGENT_MESSAGE"
  | "MODEL_GENERATED"
  | "UNTRUSTED_CONTENT";
/**
 * Where the mission is in its execution lifecycle. It does not say whether success was proven; CompletionProofStatus answers that separately.
 */
export type MissionState =
  | "CREATED"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "WAITING_FOR_USER"
  | "BLOCKED"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "STOPPED";
/**
 * Whether successful completion was actually proven. COMPLETED and NOT_PROVEN coexist deliberately; the two are never merged.
 */
export type CompletionProofStatus = "NOT_EVALUATED" | "NOT_PROVEN" | "PROVEN";
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
export type MissionObjective = string;
/**
 * Who created the mission. Documentary; it grants no authority.
 */
export type MissionOrigin = "USER" | "SYSTEM";
/**
 * The two Phase-03 execution modes. There is no swarm mode, because there is no swarm semantics yet.
 */
export type ExecutionMode = "SINGLE_AGENT" | "COORDINATED_MULTI_AGENT";
/**
 * Priority, used only as a deterministic scheduling tiebreak.
 */
export type MissionPriority = "LOW" | "NORMAL" | "HIGH";
/**
 * Mission requirement status.
 */
export type RequirementStatus = "PENDING" | "SATISFIED" | "UNSATISFIED" | "UNVERIFIED" | "BLOCKED";
/**
 * A bounded summary or statement. Bounded so that one message cannot grow the database without limit.
 */
export type BoundedText = string;
/**
 * Why completion is not proven.
 */
export type BlockerKind =
  | "UNSATISFIED_REQUIREMENT"
  | "UNVERIFIED_REQUIREMENT"
  | "CONFLICTED_CLAIM"
  | "CRITICAL_POLICY_VIOLATION"
  | "NO_MANDATORY_REQUIREMENT"
  | "EXECUTION_INCOMPLETE";
/**
 * Whether a review used a different model. A model reviewing its own output is recorded as SAME_MODEL_REVIEW, never as independent.
 */
export type ReviewIndependence = "NOT_REVIEWED" | "SAME_MODEL_REVIEW" | "INDEPENDENT_MODEL_REVIEW";
/**
 * Why a run stopped before its natural end. A stop reason is a reason code, never internal detail. STORAGE_FAILURE (remediation 2026-10-12): the session log or the resume checkpoint could not be written, so the run stopped before its next side effect.
 */
export type StopReasonCode =
  | "NO_PROGRESS"
  | "BUDGET_EXHAUSTED"
  | "MODEL_OUTPUT_INVALID"
  | "NO_MODEL_ROUTED"
  | "TASK_GRAPH_INVALID"
  | "MISSION_CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_CREDIT_EXHAUSTED"
  | "DELIVERABLES_INCOMPLETE"
  | "TASKS_BLOCKED"
  | "TASKS_FAILED"
  | "REPEATED_DENIALS"
  | "TAMPER_DETECTED"
  | "STORAGE_FAILURE";
/**
 * The closed set of task kinds.
 */
export type TaskType =
  "PLAN" | "DESIGN" | "BUILD" | "DEBUG" | "REVIEW" | "SECURITY_REVIEW" | "TEST" | "RESEARCH" | "SYNTHESIZE";
/**
 * Task lifecycle state. INTERRUPTED exists because a task that was running when the application stopped must not still read RUNNING after a restart. UNVERIFIED_DONE (ADR-041): the agent said the step is done and no measured tool call belongs to it; it is terminal and never reads as success.
 */
export type TaskState =
  | "PENDING"
  | "READY"
  | "ASSIGNED"
  | "RUNNING"
  | "WAITING"
  | "REVIEW"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED"
  | "INTERRUPTED"
  | "UNVERIFIED_DONE";
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid1 = string;
/**
 * Explicit dependency semantics. Readiness is decided by these, never by array order.
 */
export type DependencyKind = "REQUIRES_SUCCESS" | "REQUIRES_COMPLETION";
/**
 * A behavioural template. A role is not a permission: naming an agent SECURITY_REVIEWER grants it nothing.
 */
export type AgentRole =
  | "COORDINATOR"
  | "PLANNER"
  | "ARCHITECT"
  | "BUILDER"
  | "DEBUGGER"
  | "REVIEWER"
  | "SECURITY_REVIEWER"
  | "TEST_ENGINEER"
  | "RESEARCHER";
/**
 * Documentary classification of a role. It grants nothing; policy enforcement points decide what is allowed.
 */
export type SecurityClass = "STANDARD" | "SECURITY_SENSITIVE";
/**
 * Agent instance lifecycle state.
 */
export type AgentState =
  | "CREATED"
  | "IDLE"
  | "WORKING"
  | "WAITING"
  | "REVIEWING"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "STOPPED";
/**
 * The closed claim vocabulary.
 */
export type ClaimType =
  "FACT" | "RESULT" | "COMPLETION" | "REQUIREMENT_SATISFACTION" | "ASSUMPTION" | "RISK" | "OBSERVATION";
/**
 * SUPPORTED means evidence exists but the stricter rule did not pass. VERIFIED means a configured verification rule passed. Model confidence never becomes VERIFIED.
 */
export type ClaimStatus = "UNVERIFIED" | "SUPPORTED" | "VERIFIED" | "REFUTED" | "CONFLICTED" | "UNKNOWN";
/**
 * Taint flags merge by union only. Nothing subtracts a flag automatically.
 */
export type TaintFlag = "UNTRUSTED_CONTENT" | "MODEL_GENERATED" | "AGENT_RELAYED" | "UNVERIFIED_CLAIM";
/**
 * Closed evidence vocabulary. TOOL_RESULT was added in Phase-04: it is measured, because the tool gateway executed it, and it still does not satisfy a rule that requires a test artefact.
 */
export type EvidenceType =
  | "USER_CONFIRMATION"
  | "RUNTIME_MEASUREMENT"
  | "TEST_RESULT"
  | "TOOL_RESULT"
  | "ARTIFACT"
  | "SOURCE_DOCUMENT"
  | "PROJECT_CONTEXT"
  | "PROVIDER_RESPONSE"
  | "POLICY_DECISION"
  | "AUDIT_EVENT"
  | "COMPLETION_PROOF"
  | "AGENT_OUTPUT"
  | "GRADER_RESULT"
  | "MODEL_JUDGMENT";
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * Whether the evidence was measured or inferred. Inference is not measurement.
 */
export type MeasurementKind = "MEASURED" | "INFERRED";

export interface MissionListResultV1 {
  /**
   * @maxItems 500
   */
  missions: MissionSummaryV1[];
}
/**
 * A mission row. Progress is derived from task states; no percentage is invented when none can be computed.
 */
export interface MissionSummaryV1 {
  mission_id: Uuid;
  project_id?: Uuid;
  title: MissionTitle;
  title_authority?: AuthorityClass;
  state: MissionState;
  completion_proof_status: CompletionProofStatus;
  created_at: Timestamp;
  task_count: number;
  tasks_succeeded: number;
}
/**
 * The mission and its proof, always together. Reading one without the other is how a completed mission gets mistaken for a proven one.
 */
export interface MissionGetResultV1 {
  mission: MissionDetailV1;
  completion_proof: CompletionProofViewV1;
}
export interface MissionDetailV1 {
  mission_id: Uuid;
  project_id?: Uuid;
  title: MissionTitle;
  title_authority?: AuthorityClass;
  objective: MissionObjective;
  origin: MissionOrigin;
  execution_mode: ExecutionMode;
  priority: MissionPriority;
  state: MissionState;
  completion_proof_status: CompletionProofStatus;
  current_revision: number;
  root_task_id?: Uuid;
  budget: MissionBudget;
  /**
   * @maxItems 200
   */
  requirements: RequirementViewV1[];
  result_summary?: BoundedText;
  failure_reason?: string;
  created_at: Timestamp;
  started_at?: Timestamp;
  completed_at?: Timestamp;
  version: number;
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
export interface RequirementViewV1 {
  requirement_id: string;
  text: string;
  verification_rule_id: string;
  mandatory: boolean;
  status: RequirementStatus;
  claim_ref?: Uuid;
}
/**
 * The proof side of a mission, always reported next to the lifecycle state and never folded into it.
 */
export interface CompletionProofViewV1 {
  status: CompletionProofStatus;
  proof_summary: BoundedText;
  /**
   * @maxItems 200
   */
  verified_requirements: string[];
  /**
   * @maxItems 200
   */
  unverified_requirements: string[];
  /**
   * @maxItems 200
   */
  conflicted_claims: Uuid[];
  /**
   * @maxItems 200
   */
  remaining_blockers: BlockerViewV1[];
}
export interface BlockerViewV1 {
  kind: BlockerKind;
  detail?: string;
}
export interface MissionCreateResultV1 {
  mission_id: Uuid;
  state: MissionState;
  completion_proof_status: CompletionProofStatus;
  created_at: Timestamp;
}
export interface MissionStartResultV1 {
  mission_id: Uuid;
  state: MissionState;
  completion_proof: CompletionProofViewV1;
  report: MissionRunReportV1;
}
/**
 * What one orchestration run actually did. Counts are measured, not estimated. The tool and delegation counts were added in Phase-04 as optional fields, so a Phase-03 result stays valid.
 */
export interface MissionRunReportV1 {
  mission_state: MissionState;
  tasks_succeeded: number;
  tasks_failed: number;
  tasks_blocked: number;
  model_calls: number;
  total_tokens: number;
  claims: number;
  verified_claims: number;
  review_independence: ReviewIndependence;
  stop_reason?: StopReasonCode;
  tool_proposals?: number;
  tool_calls_executed?: number;
  tool_calls_denied?: number;
  tool_calls_awaiting_approval?: number;
  delegations_requested?: number;
  delegations_executed?: number;
  agent_messages?: number;
}
export interface MissionCancelResultV1 {
  mission_id: Uuid;
  state: MissionState;
}
/**
 * Resuming reports how many tasks a restart had interrupted. It never reports interrupted work as finished.
 */
export interface MissionResumeResultV1 {
  mission_id: Uuid;
  state: MissionState;
  tasks_interrupted: number;
}
export interface TaskListResultV1 {
  mission_id: Uuid;
  graph_revision: number;
  /**
   * @maxItems 500
   */
  tasks: TaskViewV1[];
  /**
   * The deterministic ready set at this revision, in scheduling order.
   *
   * @maxItems 500
   */
  ready: Uuid[];
}
export interface TaskViewV1 {
  task_id: Uuid;
  mission_id: Uuid;
  title: string;
  objective?: BoundedText;
  task_type: TaskType;
  state: TaskState;
  assigned_agent_id?: Uuid;
  parent_task_id?: Uuid1;
  /**
   * @maxItems 64
   */
  dependencies: TaskDependencyViewV1[];
  attempt: number;
  max_attempts: number;
}
export interface TaskDependencyViewV1 {
  depends_on: Uuid;
  kind: DependencyKind;
}
export interface AgentListResultV1 {
  /**
   * @maxItems 32
   */
  roles: AgentRoleViewV1[];
  /**
   * @maxItems 500
   */
  instances: AgentViewV1[];
}
/**
 * A role descriptor as the Agents screen shows it. There is no productivity score, because none is measured.
 */
export interface AgentRoleViewV1 {
  agent_type: AgentRole;
  display_name_key: string;
  purpose_key: string;
  /**
   * @maxItems 9
   */
  allowed_task_types:
    | []
    | [TaskType]
    | [TaskType, TaskType]
    | [TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType];
  max_delegation_depth: number;
  review_eligible: boolean;
  security_class: SecurityClass;
  enabled: boolean;
}
export interface AgentViewV1 {
  agent_id: Uuid;
  mission_id: Uuid;
  role: AgentRole;
  state: AgentState;
  /**
   * The model this agent was routed to, by registry id. Never an endpoint, never a credential.
   */
  model_id?: string;
  delegation_depth: number;
  parent_agent_id?: Uuid;
  current_task_id?: Uuid;
  created_at: Timestamp;
  last_active_at: Timestamp;
}
export interface ClaimListResultV1 {
  mission_id: Uuid;
  /**
   * @maxItems 2000
   */
  claims: ClaimViewV1[];
}
/**
 * A claim as the renderer may see it. There is no confidence percentage, because no measured definition of one exists.
 */
export interface ClaimViewV1 {
  claim_id: Uuid;
  mission_id: Uuid;
  task_id?: Uuid;
  /**
   * The agent that made the claim, or polaris.runtime for a claim the mission runtime records itself (deliverable and requirement checks).
   */
  agent_id: Uuid | "polaris.runtime";
  statement: BoundedText;
  claim_type: ClaimType;
  status: ClaimStatus;
  subject?: string;
  property?: string;
  value?: string;
  evidence_count: number;
  counterevidence_count: number;
  /**
   * @maxItems 4
   */
  taint:
    | []
    | [TaintFlag]
    | [TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag, TaintFlag];
  verification_required: boolean;
  created_at: Timestamp;
}
export interface EvidenceListResultV1 {
  mission_id: Uuid;
  /**
   * @maxItems 2000
   */
  evidence: EvidenceViewV1[];
}
export interface EvidenceViewV1 {
  evidence_id: Uuid;
  mission_id: Uuid;
  evidence_type: EvidenceType;
  digest: Sha256Hex;
  producer: string;
  authority: AuthorityClass;
  /**
   * Where the evidence came from, as an internal reference. It is not a URL the renderer may choose or the host will fetch.
   */
  source_ref: string;
  /**
   * The derivation lineage. Two items sharing a lineage root are one source, not two.
   *
   * @maxItems 32
   */
  lineage?: string[];
  measurement_kind: MeasurementKind;
  /**
   * @maxItems 4
   */
  taint:
    | []
    | [TaintFlag]
    | [TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag, TaintFlag];
  summary?: BoundedText;
  created_at: Timestamp;
}
