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
 * The five read-only desktop operations added by IPCEnvelopeV1 1.1 (ADR-017). This is a strict subset of IPCEnvelopeV1 Operation; a parity test proves the two never drift.
 */
export type Phase01DesktopOperation =
  | "desktop.bootstrap"
  | "desktop.runtime.status"
  | "desktop.capability.availability"
  | "desktop.settings.describe"
  | "desktop.settings.read";
/**
 * The nineteen Phase-02 operations added by IPCEnvelopeV1 1.2 (ADR-019). A strict subset of IPCEnvelopeV1 Operation; a parity test proves the two never drift.
 */
export type Phase02DesktopOperation =
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
  | "context.assemble";
/**
 * The ten Phase-03 operations added by IPCEnvelopeV1 1.3. There is no agent.execute, agent.call or orchestrator.command: an operation whose payload could name an arbitrary action is not in this set and cannot be added to it without changing this contract.
 */
export type Phase03DesktopOperation =
  | "mission.list"
  | "mission.get"
  | "mission.create"
  | "mission.start"
  | "mission.cancel"
  | "mission.resume"
  | "task.list"
  | "agent.list"
  | "claim.list"
  | "evidence.list";
/**
 * The twelve Phase-04 operations added by IPCEnvelopeV1 1.4. There is no tool.execute, tool.invoke or mcp.call: the renderer can read the registry and answer an approval, and nothing here can run a tool. Tool invocation has exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway.
 */
export type Phase04DesktopOperation =
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
  | "tool.approval.respond";
/**
 * The twelve Phase-05 operations added by IPCEnvelopeV1 1.5. There is no browser.raw_execute, computer.raw_command or memory.trust: the renderer can read sessions and memory, delete a memory, grant a window to a mission and stop a session, and nothing here can navigate, click, type or raise the trust of a memory. Browser and computer actions have exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway.
 */
export type Phase05DesktopOperation =
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
  | "computer.target.revoke";
/**
 * The twenty-eight Phase-06 operations added by IPCEnvelopeV1 1.6. There is no connector.invoke, connector.execute or connector.call: the renderer registers, configures, tests and reads connectors, budgets, prices, observability and settings, and nothing here performs a connector operation on a service. Connector operations have exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway and then the connector gateway. No operation reveals a credential value.
 */
export type Phase06DesktopOperation =
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
  | "config.reset";
/**
 * The forty-three Phase-08 operations added by IPCEnvelopeV1 1.7 (the four conversation.* members later, ADR-029; agent.catalog and mission.specialist.set later still, ADR-030; conversation.update, conversation.delete and project.delete after them, ADR-031; memory.remember, ADR-032; conversation.search, ADR-031). There is no execution.command, execution.python, workspace.write, browser.execute, oauth.token.get or email.send: the renderer attaches files, reads workspaces, artifacts and runs, edits schedules, connections, grants and settings, and decides what waits for its decision. Commands, Python, browsing and workspace writes have exactly one caller, the trusted mission runtime, and exactly one path, the tool gateway. The ten web.search.*, mission.rating.set, mission.note.add, tool.approval.grants, tool.approval.grant.revoke and github.* members were added additively at 1.7 later still (ADR-042).
 */
export type Phase08DesktopOperation =
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
 * MAJOR.MINOR contract version. Consumers reject unknown MAJOR and unknown-higher MINOR.
 */
export type ContractVersion1 = string;
/**
 * A schema file path relative to contracts/schemas, plus a JSON Pointer to the definition inside it. The registry consistency test resolves every reference against the loaded schema set, so a dangling reference fails the build.
 */
export type SchemaReference = string;
/**
 * The single native service that answers the operation. One owner per operation; there is no dispatcher service.
 */
export type OwningService =
  | "BootstrapService"
  | "RuntimeStatusService"
  | "CapabilityAvailabilityService"
  | "SettingsFacade"
  | "ProviderRegistryService"
  | "ProviderConfigService"
  | "SecretBrokerService"
  | "ModelDiscoveryService"
  | "ModelRegistryService"
  | "ModelSelectionService"
  | "ModelInvocationService"
  | "ProjectService"
  | "ContextSourceService"
  | "ContextPreviewService"
  | "ContextAssemblyService"
  | "MissionService"
  | "MissionOrchestrationService"
  | "TaskGraphService"
  | "AgentRuntimeService"
  | "ClaimService"
  | "EvidenceService"
  | "SkillRegistryService"
  | "ToolRegistryService"
  | "ToolGatewayService"
  | "ToolActivityService"
  | "McpServerService"
  | "McpDiscoveryService"
  | "ToolApprovalService"
  | "MemoryService"
  | "BrowserSessionService"
  | "ComputerSessionService"
  | "ComputerTargetService"
  | "ConnectorService"
  | "ConnectorHealthService"
  | "ConnectorSecretService"
  | "ConnectorImportService"
  | "UsageLedgerService"
  | "BudgetService"
  | "PricingService"
  | "ObservabilityService"
  | "DiagnosticsService"
  | "ConfigControlPlane"
  | "WorkspaceService"
  | "AttachmentService"
  | "ArtifactService"
  | "ExecutionService"
  | "MissionPreferenceService"
  | "ConversationService"
  | "SpecialistCatalogService"
  | "SchedulerService"
  | "OAuthService"
  | "VoiceService"
  | "ShareService"
  | "PublishService"
  | "SkillPackageService"
  | "DeviceService"
  | "IntegrationSettingsService"
  | "WebSearchService"
  | "GitHubConnectorService";
/**
 * Effect classification. Every Phase-01 desktop operation is READ_ONLY. A SIDE_EFFECTING operation enters the idempotency conditional of the envelope in the same change.
 */
export type OperationEffect = "READ_ONLY" | "SIDE_EFFECTING";
/**
 * The finer effect class. Mandatory from Phase-02; absent on Phase-01 records, which are all READ_ONLY.
 */
export type EffectClass =
  | "READ"
  | "READ_RESOURCE"
  | "WRITE_CONFIG"
  | "SECRET_WRITE"
  | "CREATE_LOCAL_DATA"
  | "WRITE_LOCAL_DATA"
  | "NETWORK_PROBE"
  | "MODEL_INVOCATION"
  | "CONTROL";
/**
 * Whether the envelope must carry idempotency_key. READ_ONLY implies NOT_REQUIRED; the registry test proves the implication holds.
 */
export type IdempotencyRequirement = "NOT_REQUIRED" | "REQUIRED";
/**
 * The boundary an operation crosses. Phase-01 has exactly one; naming it makes a second one a visible contract change rather than an accident.
 */
export type TrustBoundary = "RENDERER_TO_NATIVE_HOST";
/**
 * Which class of caller may issue the operation. This is the class the native gateway stamps, never a value the renderer asserts. It maps onto the frozen CallerType CORE_UI at the envelope level; the registry names the class, the envelope names the type.
 */
export type CallerClass = "DESKTOP_RENDERER";
/**
 * Who decides caller identity for the operation. NATIVE_TRANSPORT means the host stamps identity from the transport and overwrites whatever the renderer asserted.
 */
export type CallerIdentityAuthority = "NATIVE_TRANSPORT";
/**
 * The nine categories a Phase-01 screen may render. Closed: a tenth category is a contract change, not a string a component invents.
 */
export type DesktopErrorCategory =
  | "IPC_UNAVAILABLE"
  | "IPC_TIMEOUT"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_RESPONSE"
  | "NATIVE_SERVICE_UNAVAILABLE"
  | "CONFIG_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "FEATURE_NOT_AVAILABLE"
  | "INTERNAL_ERROR";
/**
 * Closed availability state. AVAILABLE means usable now; READ_ONLY means observable but not actionable; UNAVAILABLE means absent by design in this phase; BLOCKED means a prerequisite is unmet; ERROR means the host could not determine it.
 */
export type AvailabilityState = "AVAILABLE" | "READ_ONLY" | "UNAVAILABLE" | "BLOCKED" | "ERROR";
/**
 * Closed machine reason. The UI localises display text from state + reason; localized prose never enters the contract.
 */
export type AvailabilityReason =
  | "PHASE_NOT_IMPLEMENTED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PLATFORM_UNSUPPORTED"
  | "POLICY_DISABLED"
  | "RUNTIME_UNAVAILABLE";
/**
 * Whether the gateway will dispatch the operation at all. A schema-valid operation whose record says NOT_ROUTED is refused with UNSUPPORTED_OPERATION; validity is not authorisation.
 */
export type RoutingStatus = "ROUTED" | "NOT_ROUTED";

/**
 * An authoritative desktop IPC registry for one phase: one record per operation, naming its schemas, its owning native service, its effect, its trust boundary, its caller class, its error categories and its routing status. The native gateway is built from these documents; they are not a second description of it.
 */
export interface DesktopIpcRegistryV1 {
  contract_version: ContractVersion;
  phase: "PHASE-01" | "PHASE-02" | "PHASE-03" | "PHASE-04" | "PHASE-05" | "PHASE-06" | "PHASE-08";
  /**
   * The one envelope these operations travel in. A second envelope contract would be visible here as a second value; there is none.
   */
  envelope_contract: "IPCEnvelopeV1";
  /**
   * SPECIFIED means this document states what the gateway must do and no gateway exists yet — the state P01-W2 leaves it in. IMPLEMENTED is P01-W3's to set, once a host actually routes these operations. The field exists so that a specification cannot be read as a measurement.
   */
  implementation_status: "SPECIFIED" | "IMPLEMENTED";
  /**
   * @minItems 1
   * @maxItems 64
   */
  operations: [DesktopOperationRecord, ...DesktopOperationRecord[]];
}
export interface DesktopOperationRecord {
  operation:
    | Phase01DesktopOperation
    | Phase02DesktopOperation
    | Phase03DesktopOperation
    | Phase04DesktopOperation
    | Phase05DesktopOperation
    | Phase06DesktopOperation
    | Phase08DesktopOperation;
  envelope_version: ContractVersion1;
  request_schema: SchemaReference;
  response_schema: SchemaReference;
  owner: OwningService;
  effect: OperationEffect;
  effect_class?: EffectClass;
  idempotency: IdempotencyRequirement;
  trust_boundary: TrustBoundary;
  caller_class: CallerClass;
  caller_identity_authority: CallerIdentityAuthority;
  /**
   * The categories this operation may produce. An operation that could return anything would list all nine, which is itself a reviewable claim.
   *
   * @minItems 1
   * @maxItems 9
   */
  error_categories:
    | [DesktopErrorCategory]
    | [DesktopErrorCategory, DesktopErrorCategory]
    | [DesktopErrorCategory, DesktopErrorCategory, DesktopErrorCategory]
    | [DesktopErrorCategory, DesktopErrorCategory, DesktopErrorCategory, DesktopErrorCategory]
    | [DesktopErrorCategory, DesktopErrorCategory, DesktopErrorCategory, DesktopErrorCategory, DesktopErrorCategory]
    | [
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory
      ]
    | [
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory
      ]
    | [
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory
      ]
    | [
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory,
        DesktopErrorCategory
      ];
  availability: Availability;
  routing_status: RoutingStatus;
  phase_introduced: "PHASE-01" | "PHASE-02" | "PHASE-03" | "PHASE-04" | "PHASE-05" | "PHASE-06" | "PHASE-08";
}
/**
 * Availability of the operation itself, using the one availability model rather than a private flag.
 */
export interface Availability {
  state: AvailabilityState;
  reason?: AvailabilityReason;
}
