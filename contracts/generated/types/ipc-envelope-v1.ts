/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The single framing for every trust-crossing message between the POLARIS desktop surface and the trusted native core. Three closed message shapes; there is no fourth and no open extension point.
 */
export type IPCEnvelopeV1 = RequestEnvelope | ResponseEnvelope | EventEnvelope;
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
 * Class of principal. Closed set: an unknown caller type is a contract violation, not an extension point.
 */
export type CallerType = "CORE_UI" | "USER" | "AGENT" | "PLUGIN" | "SYSTEM";
/**
 * Disclosure tier. Internal policy reasoning is withheld from TIER_2_UNTRUSTED callers.
 */
export type TrustTier = "TIER_0_TRUSTED" | "TIER_1_LIMITED" | "TIER_2_UNTRUSTED";
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
/**
 * Closed operation set. An arbitrary operation name is unrepresentable, not merely rejected at runtime. The five desktop.* members were added additively at 1.1 (ADR-017); the nineteen provider.*, model.*, project.* and context.* members were added additively at 1.2 (ADR-019); the ten mission.*, task.*, agent.*, claim.* and evidence.* members were added additively at 1.3 (ADR-021); the twelve skill.*, tool.*, mcp.* and approval.* members were added additively at 1.4 (ADR-023); the twelve memory.*, browser.session.*, computer.session.*, computer.window.* and computer.target.* members were added additively at 1.5 (ADR-025). The twenty-eight connector.*, usage.*, budget.*, pricing.*, observability.*, diagnostics.* and config.* members were added additively at 1.6 (ADR-026). The thirty-two workspace.*, attachment.*, artifact.*, execution.*, mission.model.set, schedule.*, oauth.*, voice.transcribe, share.*, publish.*, skill.package.*, device.* and integration.settings.set members were added additively at 1.7 (ADR-028), and the four conversation.* members were added additively at 1.7 later (ADR-029), and agent.catalog and mission.specialist.set later still (ADR-030). The set is no more open than it was at 1.0. The four provider.catalog, provider.credential.put, provider.custom.save and provider.custom.delete members were added additively at 1.7 later still (ADR-037). The ten web.search.*, mission.rating.set, mission.note.add, tool.approval.grants, tool.approval.grant.revoke and github.* members were added additively at 1.7 later still (ADR-042).
 */
export type Operation =
  | "capability.describe"
  | "capability.invoke"
  | "policy.evaluate"
  | "audit.append"
  | "model.complete"
  | "system.ping"
  | "desktop.bootstrap"
  | "desktop.runtime.status"
  | "desktop.capability.availability"
  | "desktop.settings.describe"
  | "desktop.settings.read"
  | "provider.list"
  | "provider.configure"
  | "provider.credential.set"
  | "provider.credential.clear"
  | "provider.refresh"
  | "model.list"
  | "model.configure"
  | "model.preferences.set"
  | "model.invoke"
  | "model.cancel"
  | "project.list"
  | "project.get"
  | "project.create"
  | "project.update"
  | "project.archive"
  | "context.add"
  | "context.remove"
  | "context.preview"
  | "context.assemble"
  | "mission.list"
  | "mission.get"
  | "mission.create"
  | "mission.start"
  | "mission.cancel"
  | "mission.resume"
  | "task.list"
  | "agent.list"
  | "claim.list"
  | "evidence.list"
  | "skill.list"
  | "skill.get"
  | "skill.configure"
  | "tool.list"
  | "tool.get"
  | "tool.activity.list"
  | "mcp.list"
  | "mcp.register"
  | "mcp.configure"
  | "mcp.refresh"
  | "approval.list"
  | "tool.approval.respond"
  | "memory.list"
  | "memory.get"
  | "memory.delete"
  | "browser.session.list"
  | "browser.session.get"
  | "browser.session.cancel"
  | "computer.session.list"
  | "computer.session.get"
  | "computer.session.cancel"
  | "computer.window.list"
  | "computer.target.grant"
  | "computer.target.revoke"
  | "connector.list"
  | "connector.get"
  | "connector.register"
  | "connector.configure"
  | "connector.remove"
  | "connector.test"
  | "connector.credential.set"
  | "connector.credential.clear"
  | "connector.openapi.import"
  | "connector.openapi.approve"
  | "connector.preset.list"
  | "connector.preset.register"
  | "usage.summary"
  | "usage.list"
  | "budget.list"
  | "budget.set"
  | "budget.remove"
  | "pricing.list"
  | "pricing.set"
  | "pricing.remove"
  | "observability.health"
  | "observability.events"
  | "observability.metrics"
  | "observability.errors"
  | "observability.alerts"
  | "diagnostics.export"
  | "config.describe"
  | "config.effective"
  | "config.set"
  | "config.reset"
  | "workspace.list"
  | "workspace.preview"
  | "workspace.export"
  | "attachment.stage"
  | "attachment.discard"
  | "attachment.artifact.stage"
  | "attachment.list"
  | "attachment.bind"
  | "artifact.list"
  | "artifact.get"
  | "execution.status"
  | "execution.runs"
  | "execution.runtime.prepare"
  | "mission.model.set"
  | "schedule.list"
  | "schedule.save"
  | "schedule.enable"
  | "schedule.delete"
  | "schedule.run_now"
  | "oauth.list"
  | "oauth.connect"
  | "oauth.disconnect"
  | "voice.transcribe"
  | "share.list"
  | "share.set"
  | "publish.list"
  | "publish.propose"
  | "publish.decide"
  | "skill.package.list"
  | "skill.package.import"
  | "device.export"
  | "device.import"
  | "integration.settings.set"
  | "conversation.begin"
  | "conversation.continue"
  | "conversation.get"
  | "conversation.index"
  | "agent.catalog"
  | "mission.specialist.set"
  | "conversation.update"
  | "conversation.delete"
  | "project.delete"
  | "memory.remember"
  | "conversation.search"
  | "mission.trace"
  | "mcp.tool.accept_redefinition"
  | "provider.catalog"
  | "provider.credential.put"
  | "provider.custom.save"
  | "provider.custom.delete"
  | "web.search.status"
  | "web.search.credential.put"
  | "web.search.test"
  | "mission.rating.set"
  | "mission.note.add"
  | "tool.approval.grants"
  | "tool.approval.grant.revoke"
  | "github.status"
  | "github.connect"
  | "github.disconnect"
  | "memory.semantic.status"
  | "memory.semantic.set"
  | "memory.semantic.test";
/**
 * Stable across retries of the same logical operation. Never changes when `attempt` changes.
 */
export type IdempotencyKey = string;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid1 = string;
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
 * Lowercase namespaced identifier used for capability and policy names.
 */
export type Slug = string;

export interface RequestEnvelope {
  contract_version: ContractVersion;
  protocol_version: ContractVersion;
  message_type: "REQUEST";
  message_id: Uuid;
  correlation_id: CorrelationId;
  causation_id?: CausationId;
  session_id: Uuid;
  caller_identity: CallerIdentity;
  timestamp: Timestamp;
  operation: Operation;
  payload: {};
  idempotency_key?: IdempotencyKey;
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
export interface ResponseEnvelope {
  contract_version: ContractVersion;
  protocol_version: ContractVersion;
  message_type: "RESPONSE";
  message_id: Uuid;
  request_id: Uuid1;
  correlation_id: CorrelationId;
  causation_id?: CausationId;
  session_id: Uuid;
  caller_identity: CallerIdentity;
  timestamp: Timestamp;
  result?: {};
  error?: ContractError;
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
export interface EventEnvelope {
  contract_version: ContractVersion;
  protocol_version: ContractVersion;
  message_type: "EVENT";
  message_id: Uuid;
  correlation_id: CorrelationId;
  causation_id?: CausationId;
  session_id: Uuid;
  caller_identity: CallerIdentity;
  timestamp: Timestamp;
  event_name: Slug;
  payload: {};
}
