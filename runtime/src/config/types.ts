// أنواع طبقة الإعدادات. النطاقات في W3 نطاقان فقط، والبقية توثيق مستقبلي لا تنفيذ.

/** نطاقات W3. الترتيب هنا هو ترتيب الأسبقية: الأخير يغلب. */
export const SCOPE_ORDER = ["DEFAULT", "USER"] as const;
export type Scope = (typeof SCOPE_ORDER)[number];

/**
 * نطاقات مؤجلة، موثقة ولا تُنفَّذ في W3:
 * WORKSPACE · PROJECT · SESSION · MACHINE · ORGANIZATION.
 * إضافتها لاحقًا تعني توسيع SCOPE_ORDER وإعادة إثبات PROP-006 فقط.
 */
export const DEFERRED_SCOPES = ["WORKSPACE", "PROJECT", "SESSION", "MACHINE", "ORGANIZATION"] as const;

export type SettingType = "BOOLEAN" | "INTEGER" | "STRING" | "STRING_LIST" | "ENUM" | "SECRET_REF";

/**
 * حساسية الإعداد. تحدد كيف يُعامَل عند الجهل به أو عند التصدير:
 * - NORMAL           إعداد عادي.
 * - TRUST_SENSITIVE  يؤثر على قرار أمني. لا يُتجاهل بصمت أبدًا.
 * - SECRET_REFERENCE يحمل مرجع سر، ولا يحمل قيمة سر إطلاقًا.
 */
export type Sensitivity = "NORMAL" | "TRUST_SENSITIVE" | "SECRET_REFERENCE";

/** متى يسري التغيير. W3 لا ينفّذ إعادة التشغيل، لكنه يصرّح بالدلالة. */
export type ApplySemantics = "IMMEDIATE" | "NEXT_MISSION" | "RESTART_REQUIRED";

export interface SecretRef {
  readonly $secret_ref: string;
}

export type SettingValue = boolean | number | string | readonly string[] | SecretRef;

export interface SettingDefinition {
  readonly key: string;
  readonly type: SettingType;
  readonly default: SettingValue;
  /** النطاقات التي يجوز ضبط هذا الإعداد فيها. ضبطه في غيرها رفض، لا تجاهل. */
  readonly allowed_scopes: readonly Scope[];
  readonly sensitivity: Sensitivity;
  readonly apply: ApplySemantics;
  readonly description: string;
  readonly enum_values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  /** قيد على كل عنصر في STRING_LIST، أو على قيمة STRING. */
  readonly item_pattern?: string;
}

/** مصدر الكتابة. يحرس مساحة أسماء النواة. */
export type WriteOrigin = "CORE" | "PLUGIN";

/** المسافة المحجوزة للنواة. لا يجوز لمكوّن خارجي الكتابة فيها. */
export const CORE_NAMESPACE_PREFIX = "polaris.";

export type ConfigIntegrity = "HEALTHY" | "DEGRADED";

export type DegradationCode =
  | "LAYER_SCHEMA_MAJOR_TOO_NEW"
  | "LAYER_SCHEMA_MINOR_TOO_NEW"
  | "UNKNOWN_RESERVED_KEY"
  | "INVALID_STORED_VALUE";

export interface Degradation {
  readonly code: DegradationCode;
  readonly scope: Scope;
  readonly key?: string;
  readonly detail: string;
}

export interface QuarantinedKey {
  readonly scope: Scope;
  readonly key: string;
  readonly reason: DegradationCode;
}

export interface ResolvedSetting {
  readonly key: string;
  readonly value: SettingValue;
  /** النطاق الذي فازت قيمته. DEFAULT يعني أن القيمة من المخطط نفسه. */
  readonly source_scope: Scope;
  readonly sensitivity: Sensitivity;
}

export interface EffectiveConfig {
  readonly schema_version: string;
  readonly settings: Readonly<Record<string, ResolvedSetting>>;
  readonly integrity: ConfigIntegrity;
  readonly degradations: readonly Degradation[];
  readonly quarantined: readonly QuarantinedKey[];
}

/** وثيقة مخزَّنة لنطاق واحد. */
export interface StoredLayer {
  readonly schema_version: string;
  readonly scope: Scope;
  readonly values: Readonly<Record<string, unknown>>;
}
