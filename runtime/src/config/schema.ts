// مخطط الإعدادات v1. مصدر الحقيقة الوحيد لما هو إعداد صالح في POLARIS.
// صغير عمدًا: كل إعداد هنا يخدم قرارًا حقيقيًا في W3، لا توسعًا استباقيًا.

import { CORE_NAMESPACE_PREFIX, type SettingDefinition } from "./types.js";

/** MAJOR.MINOR لمخطط الإعدادات. مستقل عن إصدارات عقود W2. */
// 1.1 أضاف polaris.filesystem.allowed_write_roots في W4. الإضافة MINOR: طبقات 1.0 تبقى مقروءة.
// 1.2 أضاف مفاتيح الموافقة في W5. الإضافة MINOR أيضًا: طبقات 1.0 و1.1 تبقى مقروءة،
// والافتراض الآمن هو ألا يشترط أي أثر موافقة حتى يُعلن ذلك صراحةً.
export const CONFIG_SCHEMA_VERSION = "1.2";

const DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "polaris.filesystem.allowed_read_roots",
    type: "STRING_LIST",
    default: ["D:\\POLARIS"],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description: "Absolute roots a capability may be granted read access under. Anything outside is out of scope.",
    item_pattern: "^[A-Za-z]:\\\\[^\\0]*$",
  },
  {
    key: "polaris.filesystem.allow_write",
    type: "BOOLEAN",
    default: false,
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description: "Whether write-shaped filesystem effects may be considered at all. W3 implements no write capability.",
  },
  {
    key: "polaris.filesystem.allowed_write_roots",
    type: "STRING_LIST",
    default: [],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description:
      "Absolute roots a capability may be granted write access under. Empty by default: a write scope is granted deliberately, never inherited from the read scope.",
    item_pattern: "^[A-Za-z]:\\\\[^\\0]*$",
  },
  {
    key: "polaris.network.brokered_egress.enabled",
    type: "BOOLEAN",
    default: false,
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description:
      "Whether brokered egress authorization may be granted. Default false: no Egress PEP exists, so no network effect can be authorised out of the box.",
  },
  {
    key: "polaris.network.brokered_egress.allowed_destinations",
    type: "STRING_LIST",
    default: [],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description: "Destinations, as host:port, that brokered egress may be authorised for. Wildcards are not accepted.",
    item_pattern: "^[A-Za-z0-9._-]{1,255}:[0-9]{1,5}$",
  },
  {
    key: "polaris.approval.required_effects",
    type: "STRING_LIST",
    default: [],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description:
      "Effect actions that may only run after explicit human approval. Empty by default: an approval requirement is declared deliberately. Listing an effect here never widens what policy allows; it only adds an obligation to an ALLOW.",
    item_pattern: "^[a-z]+\\.[a-z]+$",
  },
  {
    key: "polaris.approval.expires_in_seconds",
    type: "INTEGER",
    default: 120,
    min: 1,
    max: 3600,
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description:
      "How long an approval request stays answerable. Expiry resolves to no effect, never to an approval. The ceiling matches the REQUIRE_APPROVAL obligation in PolicyDecisionV1.",
  },
  {
    key: "polaris.approval.approver",
    type: "ENUM",
    default: "END_USER",
    enum_values: ["END_USER", "OPERATOR"],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "NEXT_MISSION",
    description: "Who the approval obligation names as the approver. Carried on the obligation, not decided by the agent.",
  },
  {
    key: "polaris.audit.detail_level",
    type: "ENUM",
    default: "STANDARD",
    enum_values: ["STANDARD", "DETAILED"],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "NORMAL",
    apply: "IMMEDIATE",
    description: "Detail level carried on the AUDIT obligation attached to decisions.",
  },
  {
    key: "polaris.execution.max_output_bytes",
    type: "INTEGER",
    default: 1048576,
    min: 1,
    max: 1073741824,
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "NORMAL",
    apply: "NEXT_MISSION",
    description: "Ceiling attached as a MAX_BYTES obligation. Never raises what the invocation already constrains.",
  },
  {
    key: "polaris.ui.language",
    type: "ENUM",
    default: "en",
    enum_values: ["en", "ar"],
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "NORMAL",
    apply: "IMMEDIATE",
    description: "Interface language. RTL handling is a UI concern, not a policy concern.",
  },
  {
    key: "polaris.diagnostics.expose_internal_reason",
    type: "BOOLEAN",
    default: false,
    allowed_scopes: ["DEFAULT", "USER"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "IMMEDIATE",
    description:
      "Whether a TIER_1_LIMITED caller may see internal policy reasoning. TIER_2_UNTRUSTED never sees it regardless.",
  },
  {
    key: "polaris.model.provider_credential_ref",
    type: "SECRET_REF",
    default: { $secret_ref: "polaris-secret://unset" },
    allowed_scopes: ["USER"],
    sensitivity: "SECRET_REFERENCE",
    apply: "NEXT_MISSION",
    description:
      "Reference to a provider credential held elsewhere. POLARIS config never stores a credential value, only a reference.",
    item_pattern: "^[a-z][a-z0-9+.-]*://[^\\s]{1,512}$",
  },
  {
    key: "polaris.security.fail_closed",
    type: "BOOLEAN",
    default: true,
    allowed_scopes: ["DEFAULT"],
    sensitivity: "TRUST_SENSITIVE",
    apply: "IMMEDIATE",
    description:
      "Whether the PDP denies when it cannot reach a decision. Not settable in USER scope: a user cannot switch off fail-closed.",
  },
];

const BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(DEFINITIONS.map((d) => [d.key, d]));

export function allSettings(): readonly SettingDefinition[] {
  return DEFINITIONS;
}

export function findSetting(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isCoreKey(key: string): boolean {
  return key.startsWith(CORE_NAMESPACE_PREFIX);
}
