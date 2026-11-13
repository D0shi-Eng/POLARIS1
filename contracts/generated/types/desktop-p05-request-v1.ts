/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the twelve Phase-05 operations accept. No payload can name a web destination, send input, carry a free file path, or raise the trust of a memory.
 */
export type DesktopPhase05RequestPayloadV1 =
  | MemoryListRequestV1
  | MemoryGetRequestV1
  | MemoryDeleteRequestV1
  | BrowserSessionListRequestV1
  | BrowserSessionGetRequestV1
  | BrowserSessionCancelRequestV1
  | ComputerSessionListRequestV1
  | ComputerSessionGetRequestV1
  | ComputerSessionCancelRequestV1
  | ComputerWindowListRequestV1
  | ComputerTargetGrantRequestV1
  | ComputerTargetRevokeRequestV1;
/**
 * Where a memory is visible. A mission memory reaches no other mission unless explicitly promoted to a wider scope.
 */
export type MemoryScope = "MISSION" | "PROJECT" | "USER" | "SYSTEM";
/**
 * The kind of memory.
 */
export type MemoryType = "WORKING" | "EPISODIC" | "SEMANTIC" | "PREFERENCE" | "PROJECT";
/**
 * Lifecycle of a memory entry. A DELETED entry carries no subject, summary or content.
 */
export type MemoryStatus = "ACTIVE" | "SUPERSEDED" | "EXPIRED" | "DELETED";
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
/**
 * A window handle as a lowercase 0x-prefixed hexadecimal literal. A handle alone is not an identity; a grant binds the handle, the process id, the process creation time and the executable.
 */
export type WindowHandle = string;

/**
 * Lists memory entries by scope, type, status, owner or text. Deleted entries are not listed unless DELETED is asked for. No side effect.
 */
export interface MemoryListRequestV1 {
  scope?: MemoryScope;
  memory_type?: MemoryType;
  status?: MemoryStatus;
  mission_id?: Uuid;
  project_id?: Uuid;
  text?: string;
  limit?: number;
}
/**
 * Reads one entry with its content, lineage and conflicts. Records a USER_VIEW access.
 */
export interface MemoryGetRequestV1 {
  memory_id: Uuid;
}
/**
 * Deletes an entry from the store: its content, subject and sources are erased, not hidden.
 */
export interface MemoryDeleteRequestV1 {
  memory_id: Uuid;
}
/**
 * Lists browser sessions, optionally for one mission. No side effect.
 */
export interface BrowserSessionListRequestV1 {
  mission_id?: Uuid;
}
/**
 * Reads one browser session with its action history and downloads. No side effect.
 */
export interface BrowserSessionGetRequestV1 {
  session_id: Uuid;
}
/**
 * Stops a browser session. No further browser action runs in it.
 */
export interface BrowserSessionCancelRequestV1 {
  session_id: Uuid;
}
/**
 * Lists computer sessions, optionally for one mission. No side effect.
 */
export interface ComputerSessionListRequestV1 {
  mission_id?: Uuid;
}
/**
 * Reads one computer session with its actions and observation digests. No side effect.
 */
export interface ComputerSessionGetRequestV1 {
  session_id: Uuid;
}
/**
 * Stops a computer session. No further input is sent in it.
 */
export interface ComputerSessionCancelRequestV1 {
  session_id: Uuid;
}
/**
 * Lists the visible windows so the user can grant one, and the grants of one mission. The inventory never reaches a model. No side effect.
 */
export interface ComputerWindowListRequestV1 {
  mission_id?: Uuid;
}
/**
 * Grants one window to one mission. The host reads the window identity from the system, never from this payload.
 */
export interface ComputerTargetGrantRequestV1 {
  mission_id: Uuid;
  hwnd: WindowHandle;
}
/**
 * Revokes a window grant. Actions bound to it are refused afterwards.
 */
export interface ComputerTargetRevokeRequestV1 {
  grant_id: Uuid;
}
