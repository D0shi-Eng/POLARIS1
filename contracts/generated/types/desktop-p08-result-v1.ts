/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads the Phase-08 operations return. No result carries a credential value, a token or its vault reference, or an absolute path of the user's computer.
 */
export type DesktopPhase08ResultPayloadV1 =
  | WorkspaceListResultV1
  | WorkspacePreviewResultV1
  | WorkspaceExportResultV1
  | AttachmentStageResultV1
  | AttachmentDiscardResultV1
  | AttachmentListResultV1
  | AttachmentBindResultV1
  | ArtifactListResultV1
  | ArtifactGetResultV1
  | ExecutionStatusResultV1
  | ExecutionRunsResultV1
  | ExecutionRuntimePrepareResultV1
  | MissionModelSetResultV1
  | ScheduleListResultV1
  | ScheduleSaveResultV1
  | ScheduleEnableResultV1
  | ScheduleDeleteResultV1
  | ScheduleRunNowResultV1
  | OauthListResultV1
  | OauthConnectResultV1
  | OauthDisconnectResultV1
  | VoiceTranscribeResultV1
  | ShareListResultV1
  | ShareSetResultV1
  | PublishListResultV1
  | PublishProposeResultV1
  | PublishDecideResultV1
  | SkillPackageListResultV1
  | SkillPackageImportResultV1
  | DeviceExportResultV1
  | DeviceImportResultV1
  | IntegrationSettingsSetResultV1
  | ConversationBeginResultV1
  | ConversationContinueResultV1
  | ConversationGetResultV1
  | ConversationIndexResultV1
  | AgentCatalogResultV1
  | MissionSpecialistSetResultV1
  | ConversationUpdateResultV1
  | ConversationDeleteResultV1
  | ProjectDeleteResultV1
  | MemoryRememberResultV1
  | ConversationSearchResultV1
  | ProviderCatalogResultV1
  | ProviderCustomDeleteResultV1
  | MissionTraceResultV1
  | McpAcceptRedefinitionResultV1
  | WebSearchStatusResultV1
  | WebSearchTestResultV1
  | MemorySemanticStatusResultV1
  | MemorySemanticTestResultV1
  | MissionRatingResultV1
  | MissionNoteResultV1
  | ToolApprovalGrantsResultV1
  | ToolApprovalGrantRevokeResultV1
  | GitHubStatusResultV1;
/**
 * Lowercase RFC 4122 UUID. Uppercase and non-UUID identifiers are rejected.
 */
export type Uuid = string;
/**
 * A path relative to one mission workspace, with forward slashes. Absolute paths, drive letters, backslashes and alternate data streams are unrepresentable; '..' and reserved names are refused by the host.
 */
export type WorkspacePath = string;
export type FileName = string;
/**
 * Lowercase hex SHA-256 digest.
 */
export type Sha256Hex = string;
/**
 * RFC 3339 instant, UTC only, trailing 'Z' required. Local offsets are rejected so ordering is total and canonicalisation is stable.
 */
export type Timestamp = string;
export type ArtifactType =
  | "DOCX"
  | "PPTX"
  | "XLSX"
  | "PDF"
  | "CSV"
  | "HTML"
  | "MARKDOWN"
  | "TEXT"
  | "JSON"
  | "IMAGE"
  | "WEB_SITE"
  | "CODE_PROJECT";
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
 * What a scheduled mission does when a tool needs approval. Neither value grants the approval: the mission waits for the user, or it is cancelled and the reason recorded.
 */
export type ApprovalPolicy = "WAIT_FOR_APPROVAL" | "FAIL_ON_APPROVAL";
/**
 * SEPARATE_TASK: each run is its own task. SAME_TASK: each run is the next turn in the previous run's task; the first run starts it.
 */
export type RunTarget = "SEPARATE_TASK" | "SAME_TASK";
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
 * A specialist from the built-in catalog, as <domain>.<slug>. Issued by the catalog, never by a model.
 */
export type SpecialistId = string;
/**
 * The closed set of task kinds.
 */
export type TaskType =
  "PLAN" | "DESIGN" | "BUILD" | "DEBUG" | "REVIEW" | "SECURITY_REVIEW" | "TEST" | "RESEARCH" | "SYNTHESIZE";
/**
 * Identifier of a registered provider instance. Only ids the host registered are ever routed; an unknown id is refused by the host, not merely absent.
 */
export type ProviderId = string;
/**
 * Closed provider classes. A new class is an explicit registration, not a string. OPENAI_COMPATIBLE_API and CUSTOM_OPENAI_COMPATIBLE were added by ADR-037. CLAUDE_CLI and CODEX_CLI (2026-11-12) reach a remote model through a command-line tool installed on this computer.
 */
export type ProviderKind =
  | "LOCAL_OPENAI_COMPATIBLE"
  | "OLLAMA"
  | "LM_STUDIO"
  | "OPENAI"
  | "ANTHROPIC"
  | "GOOGLE"
  | "OPENROUTER"
  | "OPENAI_COMPATIBLE_API"
  | "CUSTOM_OPENAI_COMPATIBLE"
  | "CLAUDE_CLI"
  | "CODEX_CLI";
/**
 * Localization key, not localized prose. The contract carries the key; the renderer resolves the text. A translated string never crosses this boundary.
 */
export type DisplayKey = string;
/**
 * Whether requests leave this computer.
 */
export type Locality = "LOCAL" | "REMOTE";
/**
 * Only officially supported authentication. OAuth is not modelled until a provider offers a supported desktop flow. CLI_LOGIN: the command-line tool holds its own sign-in; the host never reads or stores a credential for it.
 */
export type AuthMode = "NO_AUTH_LOCAL" | "API_KEY" | "OPTIONAL_API_KEY" | "CLI_LOGIN";

export interface WorkspaceListResultV1 {
  mission_id: Uuid;
  /**
   * @maxItems 2000
   */
  entries: {
    path: WorkspacePath;
    is_dir: boolean;
    size_bytes: number;
  }[];
  used_bytes: number;
}
export interface WorkspacePreviewResultV1 {
  path: WorkspacePath;
  kind: "TEXT" | "DOCUMENT" | "HTML" | "IMAGE" | "BINARY";
  mime_type: string;
  size_bytes: number;
  text?: string;
  data_url?: string;
  truncated: boolean;
}
export interface WorkspaceExportResultV1 {
  file_label: FileName;
  size_bytes: number;
  sha256: Sha256Hex;
}
export interface AttachmentStageResultV1 {
  attachment: AttachmentV1;
}
/**
 * A file the user attached. Its classification is fixed: user-provided content is data for the agent, never an instruction, and it is never sent to a remote model unless the user's routing allows it. Since schema v20 the host also states what content inspection found: the format family, the MIME type decided from the content signature, whether that signature matched the extension, and how the file reaches a model (extracted text, image input for a model that declares vision, or storage only). Rows staged before v20 carry null in these fields.
 */
export interface AttachmentV1 {
  attachment_id: Uuid;
  mission_id: Uuid | null;
  file_name: FileName;
  workspace_ref: string;
  file_kind: string;
  size_bytes: number;
  sha256: Sha256Hex;
  classification: "USER_PROVIDED_UNTRUSTED";
  imported_at: Timestamp;
  family?:
    | (
        | "TEXT"
        | "CODE"
        | "DOCUMENT"
        | "SPREADSHEET"
        | "PRESENTATION"
        | "IMAGE"
        | "AUDIO"
        | "VIDEO"
        | "ARCHIVE"
        | "BINARY"
      )
    | null;
  mime_type?: string | null;
  content_check?: ("MATCHED" | "UNVERIFIED") | null;
  model_access?: ("TEXT_EXTRACTION" | "IMAGE_INPUT" | "STORE_ONLY") | null;
}
export interface AttachmentDiscardResultV1 {
  attachment_id: Uuid;
  discarded: boolean;
}
export interface AttachmentListResultV1 {
  /**
   * @maxItems 500
   */
  attachments: AttachmentV1[];
}
export interface AttachmentBindResultV1 {
  mission_id: Uuid;
  /**
   * @maxItems 20
   */
  attachments:
    | []
    | [AttachmentV1]
    | [AttachmentV1, AttachmentV1]
    | [AttachmentV1, AttachmentV1, AttachmentV1]
    | [AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1]
    | [AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1]
    | [AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1]
    | [AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1]
    | [AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1, AttachmentV1]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ]
    | [
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1,
        AttachmentV1
      ];
}
export interface ArtifactListResultV1 {
  /**
   * @maxItems 200
   */
  artifacts: ArtifactV1[];
}
/**
 * An artifact descriptor. file_ref is relative to the mission workspace; the preview is an excerpt measured by the host, and provenance marks the content MODEL_GENERATED_UNTRUSTED.
 */
export interface ArtifactV1 {
  artifact_id: Uuid;
  mission_id: Uuid;
  type: ArtifactType;
  title: string;
  file_ref: WorkspacePath;
  mime_type: string;
  size: number;
  sha256: Sha256Hex;
  created_at: Timestamp;
  source_task: string | null;
  verification: VerificationV1;
  preview: {};
  provenance: {};
}
/**
 * The host's own re-open verification of an artifact file.
 */
export interface VerificationV1 {
  status: "VERIFIED" | "FAILED";
  /**
   * @maxItems 400
   */
  checks: {}[];
  /**
   * @maxItems 64
   */
  facts: [unknown, unknown][];
  [k: string]: unknown;
}
export interface ArtifactGetResultV1 {
  artifact: ArtifactV1;
  /**
   * @maxItems 200
   */
  publications: PublicationV1[];
}
export interface PublicationV1 {
  publication_id: Uuid;
  artifact_id: Uuid;
  publisher: string;
  status: "AWAITING_APPROVAL" | "PUBLISHED" | "DENIED" | "FAILED";
  target: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface ExecutionStatusResultV1 {
  isolation: string;
  powershell: RuntimeStateV1;
  python: RuntimeStateV1;
  python_version: string | null;
  python_source_found: boolean;
  pdf_font_available: boolean;
  export_folder_configured: boolean;
  voice_configured: boolean;
  device_id: string;
  /**
   * @maxItems 16
   */
  setting_keys:
    | []
    | [IntegrationSettingKey]
    | [IntegrationSettingKey, IntegrationSettingKey]
    | [IntegrationSettingKey, IntegrationSettingKey, IntegrationSettingKey]
    | [IntegrationSettingKey, IntegrationSettingKey, IntegrationSettingKey, IntegrationSettingKey]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ]
    | [
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey,
        IntegrationSettingKey
      ];
  settings: IntegrationSettingsV1;
}
export interface RuntimeStateV1 {
  available: boolean;
  detail: string;
}
export interface IntegrationSettingsV1 {
  [k: string]: string | boolean | null;
}
export interface ExecutionRunsResultV1 {
  mission_id: Uuid;
  /**
   * @maxItems 100
   */
  runs: ExecutionRunV1[];
}
/**
 * One sandboxed run, sanitised and bounded. survivors counts processes still alive when the job was closed; it is expected to be zero.
 */
export interface ExecutionRunV1 {
  run_id: Uuid;
  task_id: string;
  tool_id: string;
  runtime: "POWERSHELL" | "PYTHON";
  command_preview: string;
  status: string;
  exit_code: number | null;
  duration_ms: number;
  output_truncated: boolean;
  network: boolean;
  processes_total: number;
  survivors: number;
  output_excerpt: string;
  started_at: Timestamp;
  finished_at: Timestamp;
}
export interface ExecutionRuntimePrepareResultV1 {
  runtime: "PYTHON";
  available: boolean;
  version: string;
  files: number;
  bytes: number;
  reused: boolean;
}
export interface MissionModelSetResultV1 {
  mission_id: Uuid;
  model_id: ModelId | null;
}
export interface ScheduleListResultV1 {
  /**
   * @maxItems 200
   */
  schedules: ScheduleV1[];
}
export interface ScheduleV1 {
  schedule_id: Uuid;
  name: string;
  mission_template: MissionTemplateV1;
  timezone: TimeZone;
  schedule: ScheduleSpecV1;
  enabled: boolean;
  next_run: Timestamp | null;
  last_run: Timestamp | null;
  last_mission_id: Uuid | null;
  last_status: string | null;
  budget: {};
  approval_policy: ApprovalPolicy;
  created_at: Timestamp;
  updated_at: Timestamp;
  /**
   * @maxItems 10
   */
  recent_runs?:
    | []
    | [ScheduleRunV1]
    | [ScheduleRunV1, ScheduleRunV1]
    | [ScheduleRunV1, ScheduleRunV1, ScheduleRunV1]
    | [ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1]
    | [ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1]
    | [ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1]
    | [ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1, ScheduleRunV1]
    | [
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1
      ]
    | [
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1
      ]
    | [
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1,
        ScheduleRunV1
      ];
  /**
   * The last moment the schedule runs, or null.
   */
  end_at: Timestamp | null;
  run_target: RunTarget;
}
export interface MissionTemplateV1 {
  title: string;
  objective: string;
  project_id?: Uuid | null;
  model_id?: ModelId | null;
}
export interface ScheduleRunV1 {
  run_id: Uuid;
  schedule_id: Uuid;
  mission_id: Uuid | null;
  /**
   * PHASE-14: CATCH_UP = due while POLARIS was not running, run once on opening; RETRY = the one retry after a failed launch or a failed mission.
   */
  trigger_kind: "SCHEDULED" | "RUN_NOW" | "CATCH_UP" | "RETRY";
  status: string;
  detail: string;
  triggered_at: Timestamp;
}
export interface ScheduleSaveResultV1 {
  schedule: ScheduleV1;
}
export interface ScheduleEnableResultV1 {
  schedule: ScheduleV1;
}
export interface ScheduleDeleteResultV1 {
  schedule_id: Uuid;
  deleted: boolean;
}
export interface ScheduleRunNowResultV1 {
  schedule_id: Uuid;
  started: boolean;
}
export interface OauthListResultV1 {
  /**
   * @maxItems 32
   */
  providers: {
    provider_id: string;
    display_name: string;
    /**
     * @maxItems 32
     */
    default_scopes: string[];
  }[];
  /**
   * @maxItems 100
   */
  connections: OAuthConnectionV1[];
}
/**
 * An OAuth connection as the renderer may see it: status and scopes. Neither the access token, the refresh token nor their vault reference crosses the boundary.
 */
export interface OAuthConnectionV1 {
  connection_id: Uuid;
  provider_id: string;
  display_name: string;
  client_id: string;
  scopes: string;
  status: "PENDING" | "CONNECTED" | "FAILED" | "REVOKED" | "EXPIRED";
  stored_in_vault: boolean;
  expires_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface OauthConnectResultV1 {
  connection_id: Uuid;
  consent_url: string;
  redirect_uri: string;
  opened_in_browser: boolean;
}
export interface OauthDisconnectResultV1 {
  connection_id: Uuid;
  revoked: boolean;
}
export interface VoiceTranscribeResultV1 {
  text: string;
  seconds: number;
}
export interface ShareListResultV1 {
  /**
   * @maxItems 200
   */
  grants: ShareGrantV1[];
}
export interface ShareGrantV1 {
  grant_id: Uuid;
  object_type: "MISSION" | "ARTIFACT" | "WORKSPACE";
  object_id: Uuid;
  member: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  created_at: Timestamp;
}
export interface ShareSetResultV1 {
  /**
   * @maxItems 200
   */
  grants: ShareGrantV1[];
}
export interface PublishListResultV1 {
  /**
   * @maxItems 16
   */
  publishers:
    | []
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ]
    | [
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        },
        {
          publisher_id: string;
          leaves_device: boolean;
        }
      ];
  /**
   * @maxItems 200
   */
  publications: PublicationV1[];
}
export interface PublishProposeResultV1 {
  publication: PublicationV1;
}
export interface PublishDecideResultV1 {
  publication: PublicationV1;
}
export interface SkillPackageListResultV1 {
  /**
   * @maxItems 500
   */
  packages: SkillPackageV1[];
}
/**
 * An imported skill package. grants_authority is always false: a package describes a skill, it grants no capability.
 */
export interface SkillPackageV1 {
  package_id: string;
  name: string;
  version: string;
  author: string;
  manifest_sha256: Sha256Hex;
  signature_state: string;
  source: string;
  trust_state: string;
  rejection: string | null;
  imported_at: Timestamp;
  grants_authority: false;
}
export interface SkillPackageImportResultV1 {
  package: SkillPackageV1;
}
export interface DeviceExportResultV1 {
  file_label: FileName;
  size_bytes: number;
  sha256: Sha256Hex;
}
export interface DeviceImportResultV1 {
  import_folder: string;
  files: number;
  source_device_id: string | null;
  source_mission_id: string | null;
}
export interface IntegrationSettingsSetResultV1 {
  settings: IntegrationSettingsV1;
}
export interface ConversationBeginResultV1 {
  thread_id: Uuid;
  mission_id: Uuid;
}
export interface ConversationContinueResultV1 {
  thread_id: Uuid;
  mission_id: Uuid;
  seq: number;
}
export interface ConversationGetResultV1 {
  conversation: ConversationV1;
}
export interface ConversationV1 {
  thread_id: Uuid;
  title: string;
  project_id?: Uuid;
  /**
   * @maxItems 10001
   */
  turns: ConversationTurnV1[];
  /**
   * @maxItems 4000000
   */
  entries: ConversationEntryV1[];
  thinking: boolean;
}
/**
 * One user message and the mission that answered it. The message is shown as the user wrote it; answer is model output, displayed as data.
 */
export interface ConversationTurnV1 {
  mission_id: Uuid;
  seq: number;
  message: string;
  created_at: Timestamp;
  state: MissionState;
  completion_proof_status: CompletionProofStatus;
  started_at?: Timestamp;
  completed_at?: Timestamp;
  answer?: string;
  failure_reason?: string;
  model_id?: ModelId;
  specialist_id?: SpecialistId;
  rating?: number;
  /**
   * @maxItems 200
   */
  notes?: TurnNoteV1[];
}
/**
 * A message the user wrote while the mission ran. DELIVERED means the agent received it as a user message at delivered_at; NOT_DELIVERED means the mission ended first.
 */
export interface TurnNoteV1 {
  note_id: Uuid;
  mission_id: Uuid;
  seq: number;
  text: string;
  state: "QUEUED" | "DELIVERED" | "NOT_DELIVERED";
  created_at: Timestamp;
  delivered_at?: Timestamp;
}
/**
 * One line of a mission's live narration: the agent's words to the user (PLAN, NOTE), a step title (STEP), or a tool call with the status the gateway measured (ACTION).
 */
export interface ConversationEntryV1 {
  entry_id: number;
  mission_id: Uuid;
  kind: "PLAN" | "STEP" | "ACTION" | "NOTE" | "SUGGESTION";
  text: string;
  detail?: string;
  created_at: Timestamp;
}
/**
 * Follow-up turns and the conversation each belongs to (the missions a task list shows inside their conversation instead of on their own), and the conversations the task menu changed (ADR-031).
 */
export interface ConversationIndexResultV1 {
  /**
   * @maxItems 100000
   */
  follow_ups: {
    mission_id: Uuid;
    thread_id: Uuid;
  }[];
  /**
   * @maxItems 100000
   */
  threads?: ConversationThreadV1[];
}
/**
 * A conversation as the task menu left it. A conversation without a record is not pinned, not a favourite and not archived.
 */
export interface ConversationThreadV1 {
  thread_id: Uuid;
  title: string;
  project_id?: Uuid;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
}
export interface AgentCatalogResultV1 {
  /**
   * @maxItems 64
   */
  domains: SpecialistDomainV1[];
  /**
   * @maxItems 1000
   */
  specialists: SpecialistV1[];
}
export interface SpecialistDomainV1 {
  domain_id: string;
  name_ar: string;
  name_en: string;
  count: number;
}
/**
 * A catalog specialist as the renderer shows it. Its working instructions stay in the host and reach only the model prompt. `agent` (remediation 2026-10-12) is the agent definition the host enforces when this specialist works: identity, version, tools, memory scope, budget and output contract.
 */
export interface SpecialistV1 {
  specialist_id: SpecialistId;
  domain_id: string;
  name_ar: string;
  name_en: string;
  summary_ar: string;
  summary_en: string;
  /**
   * @minItems 1
   * @maxItems 9
   */
  task_types:
    | [TaskType]
    | [TaskType, TaskType]
    | [TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType]
    | [TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType, TaskType];
  agent?: AgentDefinitionViewV1;
}
/**
 * An agent definition as the host enforces it (remediation 2026-10-12, section 6).
 */
export interface AgentDefinitionViewV1 {
  agent_id: string;
  version: string;
  /**
   * @maxItems 32
   */
  tools: string[];
  memory_namespace: string;
  report_path: string;
  max_turns: number;
  max_tool_calls: number;
  /**
   * This build does not carry a real-model acceptance result for any agent; one is recorded only from a real model run the owner authorised.
   */
  real_model_acceptance: "NOT_MEASURED";
}
export interface MissionSpecialistSetResultV1 {
  mission_id: Uuid;
  specialist_id: SpecialistId | null;
}
export interface ConversationUpdateResultV1 {
  thread: ConversationThreadV1;
}
export interface ConversationDeleteResultV1 {
  thread_id: Uuid;
  deleted: true;
  turns: number;
}
export interface ProjectDeleteResultV1 {
  project_id: Uuid;
  deleted: true;
  detached_missions: number;
}
export interface MemoryRememberResultV1 {
  decision: "PROMOTED" | "REJECTED" | "DUPLICATE" | "COALESCED";
  memory_id: Uuid | null;
  reason: string;
}
export interface ConversationSearchResultV1 {
  /**
   * @maxItems 50
   */
  results: {
    thread_id: Uuid;
    title: string;
    project_id?: Uuid;
    snippet: string;
    updated_at: string;
  }[];
}
/**
 * The provider catalog (ADR-037): built-in, catalogued from a dated models.dev snapshot, and custom. No credential, and no key status read from the store.
 */
export interface ProviderCatalogResultV1 {
  source: string;
  retrieved: string;
  /**
   * @maxItems 400
   */
  entries: {
    provider_id: ProviderId;
    kind: ProviderKind;
    display_name: string;
    display_name_key: DisplayKey;
    locality: Locality;
    auth_mode: AuthMode;
    enabled: boolean;
    documented_models: number;
    environment_key_present: boolean;
    environment_variable?: string;
    popular_rank?: number;
  }[];
}
export interface ProviderCustomDeleteResultV1 {
  provider_id: ProviderId;
  removed: boolean;
}
export interface MissionTraceResultV1 {
  mission_id: Uuid;
  semconv: string;
  /**
   * PHASE-10 (CP-10-1): one page, in start order.
   *
   * @maxItems 1000
   */
  spans: TraceSpanV1[];
  spans_total: number;
  /**
   * The `after` value of the next page; null on the last page.
   */
  next_after: number | null;
  /**
   * Measured over every span of the mission, not the page. A finished model call that reported no tokens counts in unreported, never as zero.
   */
  totals: {
    agents: number;
    model_calls: number;
    tool_calls: number;
    input_tokens: number;
    output_tokens: number;
    unreported: number;
    denied: number;
  };
  /**
   * @maxItems 100
   */
  security_events: {
    seq: number;
    kind: string;
    detail: string;
    created_at: string;
  }[];
  session_events: number;
  session_chain: {
    state: "INTACT" | "BROKEN";
    events?: number;
    at_seq?: number;
  };
  /**
   * OTLP/JSON ResourceSpans, only when include_otlp was asked.
   */
  otlp?: {};
}
/**
 * ADR-041: one OpenTelemetry GenAI span (invoke_agent, chat, execute_tool). The field set is pinned by semconv because the specification is still Development.
 */
export interface TraceSpanV1 {
  span_id: string;
  trace_id: string;
  parent_span_id?: string | null;
  name: "invoke_agent" | "chat" | "execute_tool";
  agent_id?: string | null;
  task_id?: string | null;
  model_id?: string | null;
  provider_id?: string | null;
  tool_id?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  latency_ms?: number | null;
  cost_micros?: number | null;
  status: "OK" | "ERROR" | "DENIED" | "AWAITING_APPROVAL" | "CANCELLED";
  gate_decision?: string | null;
  started_at: string;
  semconv: string;
}
export interface McpAcceptRedefinitionResultV1 {
  tool_id: string;
  accepted: boolean;
  /**
   * @maxItems 500
   */
  pending: string[];
}
/**
 * The chosen web search provider and whether it has what it needs. A key is reported as present or absent, never shown.
 */
export interface WebSearchStatusResultV1 {
  provider: "NONE" | "SEARXNG" | "BRAVE";
  ready: boolean;
  searxng_endpoint_configured: boolean;
  brave_key_configured: boolean;
  secure_store_available: boolean;
}
/**
 * The outcome of one real test search, measured on the host.
 */
export interface WebSearchTestResultV1 {
  provider: "NONE" | "SEARXNG" | "BRAVE";
  outcome:
    "OK" | "NOT_CONFIGURED" | "AUTH_FAILED" | "RATE_LIMITED" | "UNREACHABLE" | "REFUSED" | "MALFORMED" | "TIMEOUT";
  results: number;
  duration_ms: number;
}
export interface MemorySemanticStatusResultV1 {
  enabled: boolean;
  endpoint: string | null;
  model: string | null;
  min_similarity: number;
  query_prefix: string;
  document_prefix: string;
  /**
   * The host ranks memory by similarity now; a saved setting alone is not enough.
   */
  active: boolean;
  /**
   * Retrievals ranked with similarity since this host started.
   */
  retrievals: number;
  /**
   * Retrievals that fell back to lexical ranking because embedding failed.
   */
  failures: number;
}
export interface MemorySemanticTestResultV1 {
  outcome: "OK" | "NOT_CONFIGURED" | "UNREACHABLE" | "MALFORMED_RESPONSE" | "REFUSED";
  dimensions: number | null;
  duration_ms: number;
}
/**
 * The stored rating.
 */
export interface MissionRatingResultV1 {
  mission_id: Uuid;
  rating: number;
  rated_at: Timestamp;
}
/**
 * The queued note.
 */
export interface MissionNoteResultV1 {
  note: TurnNoteV1;
}
/**
 * The mission's active grants.
 */
export interface ToolApprovalGrantsResultV1 {
  mission_id: Uuid;
  /**
   * @maxItems 64
   */
  grants: MissionGrantV1[];
}
/**
 * One mission-scoped approval: this tool, this resource, these effects, in this mission, until expires_at. The gateway still evaluates policy on every call.
 */
export interface MissionGrantV1 {
  grant_id: Uuid;
  tool_id: string;
  resource: string;
  /**
   * @minItems 1
   * @maxItems 8
   */
  effects:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string];
  created_at: Timestamp;
  expires_at: Timestamp;
}
/**
 * How many grants were revoked now.
 */
export interface ToolApprovalGrantRevokeResultV1 {
  mission_id: Uuid;
  revoked: number;
}
/**
 * Whether a GitHub token is stored, and the account and scopes GitHub reported when it was checked. Never the token.
 */
export interface GitHubStatusResultV1 {
  connected: boolean;
  secure_store_available: boolean;
  login?: string;
  grant_kind?: "FINE_GRAINED" | "CLASSIC" | "UNKNOWN";
  /**
   * @maxItems 32
   */
  scopes?: string[];
  checked_at?: Timestamp;
}
