/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads the twelve Phase-05 operations return. No result carries a page body, pixels, a free file path, a credential, or hidden model reasoning.
 */
export type DesktopPhase05ResultPayloadV1 =
  | MemoryListResultV1
  | MemoryGetResultV1
  | MemoryDeleteResultV1
  | BrowserSessionListResultV1
  | BrowserSessionGetResultV1
  | SessionCancelResultV1
  | ComputerSessionListResultV1
  | ComputerSessionGetResultV1
  | ComputerWindowListResultV1
  | ComputerTargetGrantResultV1
  | ComputerTargetRevokeResultV1;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
/**
 * The kind of memory.
 */
export type MemoryType = "WORKING" | "EPISODIC" | "SEMANTIC" | "PREFERENCE" | "PROJECT";
/**
 * Where a memory is visible. A mission memory reaches no other mission unless explicitly promoted to a wider scope.
 */
export type MemoryScope = "MISSION" | "PROJECT" | "USER" | "SYSTEM";
/**
 * Who wrote the content. Approval of a write does not change who wrote it.
 */
export type MemoryTrustClass = "SYSTEM_GENERATED" | "MODEL_GENERATED" | "USER_DERIVED";
/**
 * Whether the entry was linked to measured evidence when it was written. There is no VERIFIED state: memory is never truth, and retrieval never re-verifies.
 */
export type MemoryVerification = "UNVERIFIED" | "EVIDENCE_LINKED" | "CONFLICTED";
/**
 * Taint carried by a memory entry. Union only; nothing removes a flag.
 */
export type TaintFlag = "UNTRUSTED_CONTENT" | "MODEL_GENERATED" | "AGENT_RELAYED" | "UNVERIFIED_CLAIM";
/**
 * Where the stated confidence came from. A model reporting its own confidence never raises trust.
 */
export type ConfidenceSource =
  "RUNTIME_EVIDENCE" | "RUNTIME_OBSERVATION" | "MODEL_SELF_REPORT" | "USER_APPROVED_WRITE" | "NONE";
/**
 * Lifecycle of a memory entry. A DELETED entry carries no subject, summary or content.
 */
export type MemoryStatus = "ACTIVE" | "SUPERSEDED" | "EXPIRED" | "DELETED";
export type BoundedLabel = string;
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
/**
 * The kind of a memory source reference.
 */
export type SourceKind = "MISSION" | "TASK" | "CLAIM" | "EVIDENCE" | "TOOL_INVOCATION" | "AGENT" | "USER";
/**
 * How two entries about one subject relate. The newer entry is never chosen as truth automatically.
 */
export type ConflictState =
  "NO_CONFLICT" | "CONFLICT" | "SUPERSEDED_BY_VERIFIED_SOURCE" | "INSUFFICIENT_EVIDENCE" | "SUPERSEDED_BY_USER";
/**
 * State of a browser or computer session. A terminal session is never reused.
 */
export type SessionState = "CREATED" | "ACTIVE" | "WAITING" | "CLOSED" | "FAILED" | "CANCELLED";
/**
 * A closed-vocabulary reason code, never free prose.
 */
export type ReasonCode = string;
/**
 * A browser action recorded in a session history.
 */
export type BrowserAction =
  "NAVIGATE" | "READ" | "CLICK" | "TYPE" | "BACK" | "FORWARD" | "RELOAD" | "DOWNLOAD" | "UPLOAD";
/**
 * Whether the action happened. A denial is recorded like an execution, with its reason.
 */
export type ActionStatus = "EXECUTED" | "DENIED" | "FAILED" | "CANCELLED";
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * The action-level outcome. Execution is not verification: whether the outcome was achieved is decided by the truth layer against observed evidence, never here.
 */
export type ActionOutcome = "ACTION_EXECUTED" | "NOT_EXECUTED";
/**
 * A window handle as a lowercase 0x-prefixed hexadecimal literal. A handle alone is not an identity; a grant binds the handle, the process id, the process creation time and the executable.
 */
export type WindowHandle = string;
/**
 * A computer action recorded in a session history.
 */
export type ComputerAction = "WINDOW_LIST" | "OBSERVE" | "FOCUS" | "POINTER_MOVE" | "CLICK" | "KEY" | "TYPE" | "SCROLL";

/**
 * Memory entries and the constant label that says none of them is truth.
 */
export interface MemoryListResultV1 {
  /**
   * @maxItems 500
   */
  memories: MemoryViewV1[];
  label: "MEMORY — UNTRUSTED / NON-AUTHORITATIVE";
}
/**
 * A memory entry as listed: its type, scope, subject, bounded summary, origin, verification link, taint and provenance counts. Never hidden reasoning.
 */
export interface MemoryViewV1 {
  memory_id: Uuid;
  memory_type: MemoryType;
  scope: MemoryScope;
  mission_id?: Uuid;
  project_id?: Uuid;
  subject: string;
  summary: string;
  trust_class: MemoryTrustClass;
  verification: MemoryVerification;
  /**
   * @maxItems 4
   */
  taint:
    | []
    | [TaintFlag]
    | [TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag, TaintFlag];
  confidence_source: ConfidenceSource;
  importance: number;
  status: MemoryStatus;
  version: number;
  source: BoundedLabel;
  source_ref_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_accessed_at?: Timestamp;
}
/**
 * One memory entry and every conflict it takes part in.
 */
export interface MemoryGetResultV1 {
  memory: MemoryDetailViewV1;
  /**
   * @maxItems 100
   */
  conflicts: MemoryConflictViewV1[];
}
/**
 * One memory entry with its content, its constant untrusted label and its source lineage. The user owns this content and may delete it.
 */
export interface MemoryDetailViewV1 {
  memory_id: Uuid;
  memory_type: MemoryType;
  scope: MemoryScope;
  mission_id?: Uuid;
  project_id?: Uuid;
  subject: string;
  summary: string;
  trust_class: MemoryTrustClass;
  verification: MemoryVerification;
  /**
   * @maxItems 4
   */
  taint:
    | []
    | [TaintFlag]
    | [TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag]
    | [TaintFlag, TaintFlag, TaintFlag, TaintFlag];
  confidence_source: ConfidenceSource;
  importance: number;
  status: MemoryStatus;
  version: number;
  source: BoundedLabel;
  source_ref_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
  last_accessed_at?: Timestamp;
  content: string;
  label: "MEMORY — UNTRUSTED / NON-AUTHORITATIVE";
  /**
   * @maxItems 24
   */
  source_refs: SourceRefViewV1[];
  /**
   * @maxItems 24
   */
  lineage: BoundedLabel[];
}
/**
 * One source reference: its kind and identifier, never the source text.
 */
export interface SourceRefViewV1 {
  kind: SourceKind;
  reference: BoundedLabel;
}
/**
 * A recorded conflict between two entries. It is shown, never resolved by recency.
 */
export interface MemoryConflictViewV1 {
  conflict_id: Uuid;
  memory_a: Uuid;
  memory_b: Uuid;
  subject: string;
  state: ConflictState;
  detected_at: Timestamp;
}
/**
 * Whether this call deleted the entry. A second delete reports false.
 */
export interface MemoryDeleteResultV1 {
  memory_id: Uuid;
  deleted: boolean;
  status: "DELETED";
}
/**
 * Browser sessions.
 */
export interface BrowserSessionListResultV1 {
  /**
   * @maxItems 200
   */
  sessions: BrowserSessionViewV1[];
}
/**
 * A mission-bound browser session. Its page content is WEB_UNTRUSTED; only addresses, titles and counts cross here.
 */
export interface BrowserSessionViewV1 {
  session_id: Uuid;
  mission_id: Uuid;
  owner_agent_id: Uuid;
  state: SessionState;
  current_origin?: string;
  current_url?: string;
  current_title?: string;
  navigation_count: number;
  action_count: number;
  download_count: number;
  upload_count: number;
  trust: "WEB_UNTRUSTED";
  created_at: Timestamp;
  last_activity_at: Timestamp;
  closed_reason?: ReasonCode;
}
/**
 * One browser session with its history.
 */
export interface BrowserSessionGetResultV1 {
  session: BrowserSessionViewV1;
  /**
   * @maxItems 500
   */
  actions: BrowserActionViewV1[];
  /**
   * @maxItems 50
   */
  downloads: DownloadViewV1[];
}
/**
 * One browser action, executed or refused, with its reason and digest.
 */
export interface BrowserActionViewV1 {
  action_id: Uuid;
  task_id: Uuid;
  action: BrowserAction;
  target: string;
  status: ActionStatus;
  reason_code?: ReasonCode;
  url?: string;
  http_status?: number;
  content_digest?: Sha256Hex;
  outcome: ActionOutcome;
  occurred_at: Timestamp;
  duration_ms: number;
}
/**
 * A quarantined download. It is never opened or run, and carries no path.
 */
export interface DownloadViewV1 {
  download_id: Uuid;
  file_name: string;
  byte_count: number;
  sha256: Sha256Hex;
  content_type: string;
  executable: boolean;
  trust: "UNTRUSTED_CONTENT";
  downloaded_at: Timestamp;
}
/**
 * The session state after the stop.
 */
export interface SessionCancelResultV1 {
  session_id: Uuid;
  state: SessionState;
}
/**
 * Computer sessions.
 */
export interface ComputerSessionListResultV1 {
  /**
   * @maxItems 200
   */
  sessions: ComputerSessionViewV1[];
}
/**
 * A mission-bound computer session with its target window, counters, last observation and last action.
 */
export interface ComputerSessionViewV1 {
  session_id: Uuid;
  mission_id: Uuid;
  agent_id: Uuid;
  state: SessionState;
  target?: TargetViewV1;
  created_at: Timestamp;
  last_action_at?: Timestamp;
  action_count: number;
  click_count: number;
  keyboard_count: number;
  capture_count: number;
  closed_reason?: ReasonCode;
  last_observation?: ObservationViewV1;
  last_action?: ComputerActionViewV1;
}
/**
 * A window granted to one mission, bound to its full identity: handle, process id, process creation time and executable.
 */
export interface TargetViewV1 {
  grant_id: Uuid;
  mission_id: Uuid;
  title: string;
  executable: string;
  pid: number;
  hwnd: WindowHandle;
  process_created_at: string;
  granted_at: Timestamp;
  revoked_at?: Timestamp;
}
/**
 * A screen observation by its digests and dimensions. No pixels and no element text cross here.
 */
export interface ObservationViewV1 {
  observation_id: Uuid;
  observed_at: Timestamp;
  width: number;
  height: number;
  frame_digest: Sha256Hex;
  layout_digest: Sha256Hex;
  element_count: number;
  capture_scope: "WINDOW";
  trust: "UNTRUSTED_CONTENT";
}
/**
 * One computer action, executed or refused, bound to the observation digest it was proposed against.
 */
export interface ComputerActionViewV1 {
  action_id: Uuid;
  task_id: Uuid;
  action: ComputerAction;
  target: string;
  status: ActionStatus;
  reason_code?: ReasonCode;
  observation_digest?: string;
  occurred_at: Timestamp;
  duration_ms: number;
}
/**
 * One computer session with its actions and bounded observation digests.
 */
export interface ComputerSessionGetResultV1 {
  session: ComputerSessionViewV1;
  /**
   * @maxItems 500
   */
  actions: ComputerActionViewV1[];
  /**
   * @maxItems 20
   */
  observations:
    | []
    | [ObservationViewV1]
    | [ObservationViewV1, ObservationViewV1]
    | [ObservationViewV1, ObservationViewV1, ObservationViewV1]
    | [ObservationViewV1, ObservationViewV1, ObservationViewV1, ObservationViewV1]
    | [ObservationViewV1, ObservationViewV1, ObservationViewV1, ObservationViewV1, ObservationViewV1]
    | [ObservationViewV1, ObservationViewV1, ObservationViewV1, ObservationViewV1, ObservationViewV1, ObservationViewV1]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ]
    | [
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1,
        ObservationViewV1
      ];
}
/**
 * Whether desktop control exists on this host, the visible windows, and one mission grants.
 */
export interface ComputerWindowListResultV1 {
  available: boolean;
  /**
   * @maxItems 100
   */
  windows: DesktopWindowViewV1[];
  /**
   * @maxItems 50
   */
  grants: TargetViewV1[];
}
/**
 * A window shown to the user so they can grant it to a mission. This inventory never reaches a model.
 */
export interface DesktopWindowViewV1 {
  hwnd: WindowHandle;
  title: string;
  executable: string;
  pid: number;
  grantable: boolean;
  reason?: ReasonCode;
}
/**
 * The grant, with the identity the host read.
 */
export interface ComputerTargetGrantResultV1 {
  grant: TargetViewV1;
}
/**
 * Whether this call revoked the grant.
 */
export interface ComputerTargetRevokeResultV1 {
  grant_id: Uuid;
  revoked: boolean;
}
