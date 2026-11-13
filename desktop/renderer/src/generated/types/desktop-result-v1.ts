/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of result payloads the five Phase-01 desktop operations return. Each is a closed object carrying shell facts only.
 */
export type DesktopResultPayloadV1 =
  | BootstrapSnapshot
  | DesktopRuntimeStatusResultV1
  | DesktopCapabilityAvailabilityResultV1
  | DesktopSettingsDescribeResultV1
  | DesktopSettingsReadResultV1;
/**
 * Exact three-part semantic version. Ranges are not permitted in contract payloads.
 */
export type SemVer = string;
/**
 * Release channel of this build.
 */
export type BuildChannel = "DEV" | "BETA" | "STABLE";
/**
 * Host platform. MACOS is representable because the host is cross-platform by construction; Phase-01 measures and claims WINDOWS only.
 */
export type Platform = "WINDOWS" | "MACOS";
/**
 * Host processor architecture.
 */
export type Architecture = "X64" | "ARM64";
/**
 * The nine architectural locales. Phase-01 proves ar and en; the other seven resolve through fallback and are still representable so that adding one is a resource change, not a contract change.
 */
export type Locale = "ar" | "en" | "de" | "fr" | "ru" | "zh" | "ko" | "ja" | "es";
/**
 * Writing direction. Derived by the host from the locale, never from a manual toggle.
 */
export type Direction = "RTL" | "LTR";
/**
 * Resolved appearance preference. SYSTEM means the host defers to the operating system setting.
 */
export type Appearance = "LIGHT" | "DARK" | "SYSTEM";
/**
 * Whether the trusted POLARIS core is attached to this host. In Phase-01 the honest value is NOT_ATTACHED: the seam is drawn and left unbuilt, and the shell says so rather than implying a running core.
 */
export type RuntimeReachability = "ATTACHED" | "NOT_ATTACHED" | "UNREACHABLE";
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
 * Present only when a runtime is actually attached and declared its contract version. Absent is honest; an invented version is not.
 */
export type ContractVersion = string;
/**
 * Lowercase namespaced identifier used for capability and policy names.
 */
export type Slug = string;
/**
 * MAJOR.MINOR contract version. Consumers reject unknown MAJOR and unknown-higher MINOR.
 */
export type ContractVersion1 = string;
/**
 * When the host observed this. The shell caches status as a query result with an explicit staleness story, and cannot tell a stale answer from a fresh one without this.
 */
export type Timestamp = string;
/**
 * Identifier of a settings section. Bounded as a Slug rather than enumerated: the section catalogue is P01-W6's to decide, while its shape is settled here. A free string is still unrepresentable.
 */
export type SettingSectionId = string;
/**
 * Localization key, not localized prose. The contract carries the key; the renderer resolves the text. A translated string never crosses this boundary.
 */
export type DisplayKey = string;
/**
 * What the user may actually do with the setting. A control that looks editable while doing nothing is the failure this enum exists to prevent.
 */
export type SettingMode = "ACTIVE" | "READ_ONLY" | "UNAVAILABLE_THIS_PHASE";
/**
 * Identifier of one setting inside a section.
 */
export type SettingId = string;
/**
 * The shape of the value the setting holds. Closed: an unknown kind is a contract change, not a rendering fallback.
 */
export type SettingValueKind = "BOOLEAN" | "INTEGER" | "TEXT" | "ENUM" | "LOCALE" | "APPEARANCE";
/**
 * Closed machine reason. The UI localises display text from state + reason; localized prose never enters the contract.
 */
export type AvailabilityReason1 =
  | "PHASE_NOT_IMPLEMENTED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PLATFORM_UNSUPPORTED"
  | "POLICY_DISABLED"
  | "RUNTIME_UNAVAILABLE";

/**
 * The complete Phase-01 bootstrap fact set. additionalProperties is false, so a host that grows a new fact must change this contract in the open.
 */
export interface BootstrapSnapshot {
  app_version: SemVer;
  build_channel: BuildChannel;
  platform: Platform;
  architecture: Architecture;
  locale: Locale;
  direction: Direction;
  appearance: Appearance;
  runtime_status: RuntimeStatus;
  /**
   * Capabilities the host will actually answer for right now. An empty array is a valid and honest answer.
   *
   * @maxItems 128
   */
  enabled_capabilities: Slug[];
  /**
   * Everything the shell can name but cannot use, each with a state and a machine reason.
   *
   * @maxItems 128
   */
  unavailable_capabilities: CapabilityAvailability[];
  settings_schema_version: ContractVersion1;
  ipc_protocol_version: ContractVersion1;
}
/**
 * Runtime reachability and posture. Facts only: no process id, no path, no environment, no stack trace.
 */
export interface RuntimeStatus {
  reachability: RuntimeReachability;
  availability: Availability;
  runtime_contract_version?: ContractVersion;
}
/**
 * A state, and a machine reason whenever the state is not AVAILABLE.
 */
export interface Availability {
  state: AvailabilityState;
  reason?: AvailabilityReason;
}
/**
 * Availability of one capability, as the host determined it. The renderer never computes this from a build-time constant.
 */
export interface CapabilityAvailability {
  capability_id: Slug;
  availability: Availability;
}
export interface DesktopRuntimeStatusResultV1 {
  runtime_status: RuntimeStatus;
  observed_at: Timestamp;
}
export interface DesktopCapabilityAvailabilityResultV1 {
  /**
   * One entry per capability the request named. A capability the host does not know is answered UNAVAILABLE with a reason, never omitted silently.
   *
   * @maxItems 64
   */
  capabilities: CapabilityAvailability[];
}
/**
 * Structure and per-setting mode. No value of any kind appears in a describe result.
 */
export interface DesktopSettingsDescribeResultV1 {
  settings_schema_version: ContractVersion1;
  /**
   * @maxItems 32
   */
  sections: SettingSectionDescriptor[];
}
export interface SettingSectionDescriptor {
  section_id: SettingSectionId;
  label_key: DisplayKey;
  mode: SettingMode;
  availability_reason?: AvailabilityReason;
  /**
   * @maxItems 64
   */
  settings: SettingDescriptor[];
}
/**
 * One setting, described structurally. No value is carried here — describing is not reading.
 */
export interface SettingDescriptor {
  setting_id: SettingId;
  value_kind: SettingValueKind;
  mode: SettingMode;
  label_key: DisplayKey;
  description_key?: DisplayKey;
  availability_reason?: AvailabilityReason1;
  /**
   * Permitted members for an ENUM-kind setting. Bounded tokens, never localized labels.
   *
   * @maxItems 32
   */
  allowed_values?: string[];
}
/**
 * Resolved, display-safe values for one section. A secret-bearing setting is reported as configured and its value is withheld.
 */
export interface DesktopSettingsReadResultV1 {
  section_id: SettingSectionId;
  /**
   * @maxItems 64
   */
  settings: ResolvedSetting[];
}
export interface ResolvedSetting {
  setting_id: SettingId;
  mode: SettingMode;
  value?: DisplaySafeValue;
  availability_reason?: AvailabilityReason;
  /**
   * True when the host holds a value and will not disclose it — a credential-backed setting above all. The value member is then always absent. The field states the observable fact rather than classifying the data behind it, and its name deliberately avoids credential vocabulary: the secret detector matches on key names, so a contract field called secret_* or *_token would be rejected by the project's own hygiene rule.
   */
  value_withheld?: boolean;
}
/**
 * Absent whenever the host will not disclose a value — a secret-bearing setting, or one unavailable in this phase. Absence is the honest answer; a placeholder is not.
 */
export interface DisplaySafeValue {
  kind: SettingValueKind;
  boolean_value?: boolean;
  integer_value?: number;
  /**
   * Display-safe text only. Secret-bearing settings are never resolved through this path; the secret-hygiene rules reject credential shapes here.
   */
  text_value?: string;
  /**
   * A bounded token for ENUM, LOCALE and APPEARANCE kinds. Named code_value, not value, so that nothing free-form can be smuggled under a generic name.
   */
  code_value?: string;
}
