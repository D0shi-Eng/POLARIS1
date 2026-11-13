// سطح القراءة والتصدير. هذا هو المكان الوحيد الذي تغادر منه الإعدادات النظام،
// ولذلك هو المكان الذي تُطبَّق فيه قاعدة عدم تسريب الأسرار.
//
// في W3 لا يوجد Secret Store أصلًا: الإعداد السري يحمل مرجعًا فقط، ولا توجد دالة
// تُرجع قيمة سر. المرجع نفسه يُحجب عند التصدير لأنه قد يكشف بنية داخلية.

import type { EffectiveConfig, SettingValue } from "./types.js";

export const REDACTED = "[REDACTED:SECRET_REFERENCE]";

export interface ExportedSetting {
  readonly key: string;
  readonly value: SettingValue | typeof REDACTED;
  readonly source_scope: string;
  readonly sensitivity: string;
}

export interface ConfigExport {
  readonly schema_version: string;
  readonly integrity: string;
  readonly settings: readonly ExportedSetting[];
  readonly degradation_codes: readonly string[];
  readonly quarantined_keys: readonly string[];
}

/** تصدير آمن للعرض والتشخيص. لا يُخرج أي قيمة لإعداد مصنّف كمرجع سر. */
export function exportConfig(effective: EffectiveConfig): ConfigExport {
  const settings = Object.keys(effective.settings)
    .sort()
    .map((key) => {
      const resolved = effective.settings[key]!;
      return {
        key,
        value: resolved.sensitivity === "SECRET_REFERENCE" ? REDACTED : resolved.value,
        source_scope: resolved.source_scope,
        sensitivity: resolved.sensitivity,
      };
    });

  return {
    schema_version: effective.schema_version,
    integrity: effective.integrity,
    settings,
    degradation_codes: effective.degradations.map((d) => d.code),
    quarantined_keys: effective.quarantined.map((q) => `${q.scope}:${q.key}`),
  };
}
