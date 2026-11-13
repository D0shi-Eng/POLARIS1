/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the Phase-08 operations accept. No payload runs a command, runs Python, drives the browser, writes into a mission workspace, reads an OAuth token or sends a message: those have one caller, the trusted mission runtime, and one path, the tool gateway.
 */
export type DesktopPhase08RequestPayloadV1 =
  | WorkspaceListRequestV1
  | WorkspacePreviewRequestV1
  | WorkspaceExportRequestV1
  | AttachmentStageRequestV1
  | AttachmentDiscardRequestV1
  | AttachmentArtifactStageRequestV1
  | AttachmentListRequestV1
  | AttachmentBindRequestV1
  | ArtifactListRequestV1
  | ArtifactGetRequestV1
  | ExecutionStatusRequestV1
  | ExecutionRunsRequestV1
  | ExecutionRuntimePrepareRequestV1
  | MissionModelSetRequestV1
  | ScheduleListRequestV1
  | ScheduleSaveRequestV1
  | ScheduleEnableRequestV1
  | ScheduleDeleteRequestV1
  | ScheduleRunNowRequestV1
  | OauthListRequestV1
  | OauthConnectRequestV1
  | OauthDisconnectRequestV1
  | VoiceTranscribeRequestV1
  | ShareListRequestV1
  | ShareSetRequestV1
  | PublishListRequestV1
  | PublishProposeRequestV1
  | PublishDecideRequestV1
  | SkillPackageListRequestV1
  | SkillPackageImportRequestV1
  | DeviceExportRequestV1
  | DeviceImportRequestV1
  | IntegrationSettingsSetRequestV1
  | ConversationBeginRequestV1
  | ConversationContinueRequestV1
  | ConversationGetRequestV1
  | ConversationIndexRequestV1
  | AgentCatalogRequestV1
  | MissionSpecialistSetRequestV1
  | ConversationUpdateRequestV1
  | ConversationDeleteRequestV1
  | ProjectDeleteRequestV1
  | MemoryRememberRequestV1
  | ConversationSearchRequestV1
  | ProviderCatalogRequestV1
  | ProviderCredentialPutRequestV1
  | ProviderCustomSaveRequestV1
  | ProviderCustomDeleteRequestV1
  | MissionTraceRequestV1
  | McpAcceptRedefinitionRequestV1
  | WebSearchStatusRequestV1
  | WebSearchCredentialPutRequestV1
  | WebSearchTestRequestV1
  | MissionRatingSetRequestV1
  | MissionNoteAddRequestV1
  | ToolApprovalGrantsRequestV1
  | ToolApprovalGrantRevokeRequestV1
  | GitHubStatusRequestV1
  | GitHubConnectRequestV1
  | GitHubDisconnectRequestV1
  | MemorySemanticStatusRequestV1
  | MemorySemanticSetRequestV1
  | MemorySemanticTestRequestV1;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
/**
 * A path relative to one mission workspace, with forward slashes. Absolute paths, drive letters, backslashes and alternate data streams are unrepresentable; '..' and reserved names are refused by the host.
 */
export type WorkspacePath = string;
export type FileName = string;
export type ModelId = string;
/**
 * A fixed offset from UTC. Daylight-saving zones are represented by their current offset; the change is not followed (a declared limitation).
 */
export type TimeZone = string;
export type ScheduleSpecV1 =
  | {
      kind: "ONCE";
      at: Timestamp;
    }
  | {
      kind: "INTERVAL";
      minutes: number;
    }
  | {
      kind: "DAILY";
      time: string;
    }
  | {
      kind: "WEEKLY";
      /**
       * @minItems 1
       * @maxItems 7
       */
      days:
        | ["MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"]
        | ["MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN", "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"]
        | [
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
          ]
        | [
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
          ]
        | [
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
          ]
        | [
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
          ]
        | [
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN",
            "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"
          ];
      time: string;
    }
  | {
      kind: "MONTHLY";
      /**
       * @minItems 1
       * @maxItems 31
       */
      days: [number, ...number[]];
      time: string;
    };
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
/**
 * What a scheduled mission does when a tool needs approval. Neither value grants the approval: the mission waits for the user, or it is cancelled and the reason recorded.
 */
export type ApprovalPolicy = "WAIT_FOR_APPROVAL" | "FAIL_ON_APPROVAL";
/**
 * SEPARATE_TASK: each run is its own task. SAME_TASK: each run is the next turn in the previous run's task; the first run starts it.
 */
export type RunTarget = "SEPARATE_TASK" | "SAME_TASK";
/**
 * A Phase-08 setting. profile.* is what the user wrote about themselves on the Customize page; the agent reads it as the user's own words in every task.
 */
export type IntegrationSettingKey =
  | "voice.transcription_endpoint"
  | "voice.transcription_model"
  | "workspace.export_folder_label"
  | "browser.engine_enabled"
  | "web.search_endpoint"
  | "profile.nickname"
  | "profile.profession"
  | "profile.about"
  | "profile.instructions"
  | "web.search_provider"
  | "notifications.enabled"
  | "notifications.sound";
/**
 * A specialist from the built-in catalog, as <domain>.<slug>. Issued by the catalog, never by a model.
 */
export type SpecialistId = string;
/**
 * Identifier of a registered provider instance. Only ids the host registered are ever routed; an unknown id is refused by the host, not merely absent.
 */
export type ProviderId = string;

export interface WorkspaceListRequestV1 {
  mission_id: Uuid;
  path?: WorkspacePath;
  depth?: number;
}
/**
 * Previews one workspace file. Images return a data URL (never SVG), documents their extracted text, HTML its text for a script-free sandboxed frame. The content is data, never an instruction.
 */
export interface WorkspacePreviewRequestV1 {
  mission_id: Uuid;
  path: WorkspacePath;
  max_chars?: number;
}
/**
 * Copies one workspace file into the export folder the host configured, never overwriting an existing file. The result names the file, not its absolute path.
 */
export interface WorkspaceExportRequestV1 {
  mission_id: Uuid;
  path: WorkspacePath;
}
/**
 * Stages one user-provided file (at most 25 MiB). Executables are refused. The file is not read by any agent until it is bound to a mission.
 */
export interface AttachmentStageRequestV1 {
  file_name: FileName;
  content_base64: string;
}
export interface AttachmentDiscardRequestV1 {
  attachment_id: Uuid;
}
/**
 * Stages a copy of one file artifact from an earlier task as a new attachment (the composer's Library). The host reads the file from that task's workspace; the renderer never names a path. Folders (web sites, code projects) are refused.
 */
export interface AttachmentArtifactStageRequestV1 {
  artifact_id: Uuid;
}
export interface AttachmentListRequestV1 {
  mission_id?: Uuid;
}
export interface AttachmentBindRequestV1 {
  mission_id: Uuid;
  /**
   * @minItems 1
   * @maxItems 20
   */
  attachment_ids:
    | [Uuid]
    | [Uuid, Uuid]
    | [Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid, Uuid]
    | [
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid,
        Uuid
      ];
}
export interface ArtifactListRequestV1 {
  mission_id?: Uuid;
}
export interface ArtifactGetRequestV1 {
  artifact_id: Uuid;
}
/**
 * The execution environment as measured now: the isolation this host binds, whether each runtime can run, and the integration settings. No path crosses.
 */
export interface ExecutionStatusRequestV1 {}
export interface ExecutionRunsRequestV1 {
  mission_id: Uuid;
}
/**
 * Copies the base Python found on this computer into POLARIS's own data folder, once, so the sandbox can be granted read access without changing any permission on the user's files.
 */
export interface ExecutionRuntimePrepareRequestV1 {
  runtime: "PYTHON";
}
/**
 * Chooses the model for one mission. The choice is routed manually through Phase-02 routing and its egress gate, so a disabled model or a remote provider its policy forbids still fails.
 */
export interface MissionModelSetRequestV1 {
  mission_id: Uuid;
  model_id: ModelId | null;
}
export interface ScheduleListRequestV1 {}
/**
 * Creates a schedule, or updates the one named by schedule_id.
 */
export interface ScheduleSaveRequestV1 {
  schedule_id?: Uuid;
  name: string;
  mission_template: MissionTemplateV1;
  timezone: TimeZone;
  schedule: ScheduleSpecV1;
  enabled?: boolean;
  budget?: {};
  approval_policy: ApprovalPolicy;
  end_at?: Timestamp;
  run_target?: RunTarget;
}
export interface MissionTemplateV1 {
  title: string;
  objective: string;
  project_id?: Uuid | null;
  model_id?: ModelId | null;
}
export interface ScheduleEnableRequestV1 {
  schedule_id: Uuid;
  enabled: boolean;
}
export interface ScheduleDeleteRequestV1 {
  schedule_id: Uuid;
}
/**
 * Starts one run of a schedule now, in the background. The run is an ordinary mission: approvals it needs are not granted by the schedule.
 */
export interface ScheduleRunNowRequestV1 {
  schedule_id: Uuid;
}
export interface OauthListRequestV1 {}
/**
 * Starts an OAuth 2.0 authorization-code flow with PKCE (S256) and a loopback redirect. The client id is the user's own registration; the host never scrapes a sign-in page and never returns a token.
 */
export interface OauthConnectRequestV1 {
  provider_id: string;
  client_id: string;
  /**
   * @maxItems 32
   */
  scopes?: string[];
}
export interface OauthDisconnectRequestV1 {
  connection_id: Uuid;
}
/**
 * Transcribes one recording on a transcription server on this computer (loopback only). The audio is not stored.
 */
export interface VoiceTranscribeRequestV1 {
  audio_base64: string;
  language?: string;
}
export interface ShareListRequestV1 {
  object_type: "MISSION" | "ARTIFACT" | "WORKSPACE";
  object_id: Uuid;
}
/**
 * Sets or removes (role null) one member's role. The grant is local data; it sends nothing to anyone.
 */
export interface ShareSetRequestV1 {
  object_type: "MISSION" | "ARTIFACT" | "WORKSPACE";
  object_id: Uuid;
  member: string;
  role: ("OWNER" | "EDITOR" | "VIEWER") | null;
}
export interface PublishListRequestV1 {}
/**
 * Proposes a verified artifact for publication. Nothing is published until publish.decide grants it.
 */
export interface PublishProposeRequestV1 {
  artifact_id: Uuid;
  publisher_id: string;
}
/**
 * The user's decision on one proposal. A grant publishes once, after re-checking the artifact's digest.
 */
export interface PublishDecideRequestV1 {
  publication_id: Uuid;
  decision: "GRANT" | "DENY";
}
export interface SkillPackageListRequestV1 {}
/**
 * Imports a skill package manifest. An imported package is UNTRUSTED and grants no authority whatever its signature state.
 */
export interface SkillPackageImportRequestV1 {
  manifest_json: string;
}
/**
 * Packs one mission workspace into a verified bundle in the export folder. This is portability, not synchronisation.
 */
export interface DeviceExportRequestV1 {
  mission_id: Uuid;
}
/**
 * Imports a workspace bundle into a new import folder after checking every digest. It touches no mission and no database row.
 */
export interface DeviceImportRequestV1 {
  bundle_base64: string;
}
/**
 * Writes one integration setting. A transcription endpoint that is not on this computer is refused.
 */
export interface IntegrationSettingsSetRequestV1 {
  key: IntegrationSettingKey;
  value: string | boolean | null;
}
/**
 * Declares a mission the renderer has just created as the first turn of a conversation, so the mission ends with a reply addressed to the user in the user's language.
 */
export interface ConversationBeginRequestV1 {
  mission_id: Uuid;
}
/**
 * Adds the user's next message to the conversation of this mission and creates the mission for that turn, inheriting its project, model and workspace. It does not start it: mission.start does.
 */
export interface ConversationContinueRequestV1 {
  mission_id: Uuid;
  message: string;
}
export interface ConversationGetRequestV1 {
  mission_id: Uuid;
}
export interface ConversationIndexRequestV1 {}
export interface AgentCatalogRequestV1 {}
/**
 * Pins one catalog specialist to a mission (and its follow-ups), or clears the pin with null. The specialist shapes instructions only; it grants no tool or permission.
 */
export interface MissionSpecialistSetRequestV1 {
  mission_id: Uuid;
  specialist_id: SpecialistId | null;
}
/**
 * What the task menu changes about a conversation, applied to every turn of it: a title the user chose (the planner no longer replaces it), pinning, favourites, archiving (hidden from the list, not deleted), and moving it into a project or out of one (null). An absent field is unchanged; at least one is present.
 */
export interface ConversationUpdateRequestV1 {
  thread_id: Uuid;
  title?: string;
  pinned?: boolean;
  favorite?: boolean;
  archived?: boolean;
  project_id?: Uuid | null;
}
/**
 * Deletes a conversation for good: its turns, narration, missions, evidence, outputs, mission memory and workspace folder. Refused while a turn is working or waiting for a decision. Accounting rows are detached, not deleted; the audit chain records the deletion without any title or text.
 */
export interface ConversationDeleteRequestV1 {
  thread_id: Uuid;
}
/**
 * Deletes a project: its instructions, context sources, project memory and project settings. Its conversations are not deleted; they leave the project. Refused while a mission in it is working.
 */
export interface ProjectDeleteRequestV1 {
  project_id: Uuid;
}
/**
 * Remember this: text the user wrote, about themselves (USER) or about a project (PROJECT, project_id required). It passes the same memory policy as any candidate (bounds, secret filter, type and scope, duplicates) and is stored USER_DERIVED and UNVERIFIED. It is not memory.write: no free type, no system scope, no trust upgrade. mission_id names the conversation it was said in.
 */
export interface MemoryRememberRequestV1 {
  text: string;
  scope: "USER" | "PROJECT";
  project_id?: Uuid;
  mission_id?: Uuid;
  /**
   * The subject as the user names it (agent plan D2). A newer statement by the user on the same named subject replaces their older one, which stays visible as superseded.
   */
  topic?: string;
}
/**
 * Searches conversation titles, the user messages and POLARIS replies, ignoring Arabic spelling variants (hamza forms, ta marbuta, alef maqsura, diacritics). An empty query lists the latest conversations. Read only.
 */
export interface ConversationSearchRequestV1 {
  query?: string;
  limit?: number;
}
/**
 * Reads the provider catalog for the connect dialog (ADR-037): every built-in, catalogued and custom provider, without reading a credential.
 */
export interface ProviderCatalogRequestV1 {}
/**
 * Stores an API key typed in the app's connect dialog. The only renderer payload that carries a credential, and only in this field.
 */
export interface ProviderCredentialPutRequestV1 {
  provider_id: ProviderId;
  /**
   * The key the user typed in the in-app connect field. The one payload field allowed to carry a credential (ADR-037, owner decision 2026-10-06). The host stores it in the operating system's credential store and never returns it.
   */
  api_key: string;
}
/**
 * Creates or edits a user-defined OpenAI-compatible provider. Carries no credential: the key travels in provider.credential.put.
 */
export interface ProviderCustomSaveRequestV1 {
  provider_id: ProviderId;
  display_name: string;
  /**
   * A public https address, or http on this computer only. The host resolves it and refuses a private address.
   */
  base_url: string;
  /**
   * @maxItems 64
   */
  models?: {
    model_id: string;
    display_name?: string;
  }[];
}
/**
 * Deletes a custom provider, its models and its stored key. A built-in or catalogued provider is disconnected, not deleted.
 */
export interface ProviderCustomDeleteRequestV1 {
  provider_id: ProviderId;
}
export interface MissionTraceRequestV1 {
  mission_id: Uuid;
  /**
   * ADR-041: return the spans as OTLP/JSON as well. Nothing is sent anywhere.
   */
  include_otlp?: boolean;
  /**
   * PHASE-10 (CP-10-1): how many spans, in start order, to skip before this page.
   */
  after?: number;
  /**
   * PHASE-10 (CP-10-1): the page size; 500 when absent.
   */
  limit?: number;
}
export interface McpAcceptRedefinitionRequestV1 {
  tool_id: string;
}
/**
 * Reads which web search provider is chosen and whether it is ready. No side effect, no network.
 */
export interface WebSearchStatusRequestV1 {}
/**
 * Stores the user's API key for the web search provider in the operating system credential store, or deletes it when api_key is null. The key never comes back.
 */
export interface WebSearchCredentialPutRequestV1 {
  provider: "BRAVE";
  api_key: string | null;
}
/**
 * Sends one real search with a fixed neutral query to the chosen provider and reports the outcome. Network effect, initiated by the user.
 */
export interface WebSearchTestRequestV1 {}
/**
 * Stores the user's rating of a finished turn on this computer. It is not sent anywhere and does not train a model.
 */
export interface MissionRatingSetRequestV1 {
  mission_id: Uuid;
  rating: number;
}
/**
 * Queues a message for a running mission. The agent reads it as a user message at the next safe point between steps; it never enters the system instruction and grants nothing.
 */
export interface MissionNoteAddRequestV1 {
  mission_id: Uuid;
  text: string;
}
/**
 * Lists the active mission-scoped approval grants of a mission.
 */
export interface ToolApprovalGrantsRequestV1 {
  mission_id: Uuid;
}
/**
 * Revokes one mission-scoped grant, or all of the mission's grants when grant_id is absent.
 */
export interface ToolApprovalGrantRevokeRequestV1 {
  mission_id: Uuid;
  grant_id?: Uuid;
}
/**
 * Reads whether a GitHub token is stored and what GitHub said about it when it was last checked. No network.
 */
export interface GitHubStatusRequestV1 {}
/**
 * Checks a GitHub token the user created (a fine-grained token with read-only access is recommended) against the GitHub API and stores it in the operating system credential store. The token never comes back.
 */
export interface GitHubConnectRequestV1 {
  token: string;
}
/**
 * Deletes the stored GitHub token. Revoking it on GitHub stays the user's action.
 */
export interface GitHubDisconnectRequestV1 {}
/**
 * PHASE-12: the semantic memory setting and whether the host ranks memory by similarity now.
 */
export interface MemorySemanticStatusRequestV1 {}
/**
 * PHASE-12: choose an embedding server on this computer and its model, or turn semantic ranking off. Memory text is never sent anywhere else by this setting.
 */
export interface MemorySemanticSetRequestV1 {
  enabled: boolean;
  /**
   * An embedding server on this computer only; the host checks it again.
   */
  endpoint?: string;
  model?: string;
  min_similarity?: number;
  query_prefix?: string;
  document_prefix?: string;
}
/**
 * Embeds one fixed sentence with the saved server; no memory is read or sent.
 */
export interface MemorySemanticTestRequestV1 {}
