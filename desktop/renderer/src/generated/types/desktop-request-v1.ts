/* eslint-disable */
/**
 * GENERATED FILE - DO NOT EDIT MANUALLY.
 * Source of truth: contracts/schemas/. Regenerate with `npm run generate`.
 * Manual edits are detected by the generated-type drift test and fail the build.
 */
/**
 * The closed set of request payloads the five Phase-01 desktop operations accept. Every payload is a closed object; there is no Record<string, unknown> escape hatch and no arbitrary JSON anywhere in the set.
 */
export type DesktopRequestPayloadV1 =
  | DesktopBootstrapRequestV1
  | DesktopRuntimeStatusRequestV1
  | DesktopCapabilityAvailabilityRequestV1
  | DesktopSettingsDescribeRequestV1
  | DesktopSettingsReadRequestV1;
/**
 * Lowercase namespaced identifier used for capability and policy names.
 */
export type Slug = string;
/**
 * Identifier of a settings section. Bounded as a Slug rather than enumerated: the section catalogue is P01-W6's to decide, while its shape is settled here. A free string is still unrepresentable.
 */
export type SettingSectionId = string;
/**
 * Identifier of one setting inside a section.
 */
export type SettingId = string;

/**
 * Bootstrap takes no parameters. It is an empty closed object rather than an absent payload: the envelope already requires `payload`, and a closed empty object states that nothing may be smuggled in beside it. The contract version travels on the envelope, so the payload does not restate it.
 */
export interface DesktopBootstrapRequestV1 {}
/**
 * Runtime status takes no parameters, for the same reason as bootstrap.
 */
export interface DesktopRuntimeStatusRequestV1 {}
export interface DesktopCapabilityAvailabilityRequestV1 {
  /**
   * A bounded, explicit query. There is deliberately no 'all capabilities' wildcard: an unbounded query is a small dispatcher.
   *
   * @minItems 1
   * @maxItems 64
   */
  capability_ids: [Slug, ...Slug[]];
}
export interface DesktopSettingsDescribeRequestV1 {
  /**
   * Restricts the description to the named sections. Absent means the whole tree, which is bounded by the host's own section catalogue and not by the caller.
   *
   * @minItems 1
   * @maxItems 32
   */
  section_ids?: [SettingSectionId, ...SettingSectionId[]];
}
/**
 * Reads one named section. A read spanning sections is not expressible, so a single request can never become a settings dump.
 */
export interface DesktopSettingsReadRequestV1 {
  section_id: SettingSectionId;
  /**
   * Restricts the read to named settings inside the section. Absent means the whole section.
   *
   * @minItems 1
   * @maxItems 64
   */
  setting_ids?: [SettingId, ...SettingId[]];
}
