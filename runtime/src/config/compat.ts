// سياسة التعامل مع المجهول: مفاتيح غير معروفة، ومخطط أحدث من هذا البناء.
//
// المبدأ: لا تجاهل صامت، ولا انهيار كامل.
// - مفتاح مجهول داخل مساحة النواة قد يكون حسّاسًا أمنيًا → عزل + تدهور معلن.
// - مفتاح مجهول خارجها ملك جهة أخرى → عزل بلا تدهور.
// - MAJOR أحدث → لا تُطبَّق أي قيمة من تلك الطبقة إطلاقًا.
//   مخطط أحدث لا يجوز أن يتحول تلقائيًا إلى إعداد ذي امتياز.
// - MINOR أحدث → تُطبَّق المفاتيح المعروفة فقط، والباقي معزول، والحالة متدهورة.

import { CONFIG_SCHEMA_VERSION, findSetting, isCoreKey } from "./schema.js";
import { validateValue } from "./validate.js";
import type { Degradation, QuarantinedKey, SettingValue, StoredLayer } from "./types.js";

export interface LayerReadResult {
  readonly applied: Readonly<Record<string, SettingValue>>;
  readonly degradations: readonly Degradation[];
  readonly quarantined: readonly QuarantinedKey[];
}

function parse(version: string): { major: number; minor: number } | null {
  const m = /^([1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version);
  return m === null ? null : { major: Number(m[1]), minor: Number(m[2]) };
}

const KNOWN = parse(CONFIG_SCHEMA_VERSION)!;

export function interpretLayer(layer: StoredLayer): LayerReadResult {
  const degradations: Degradation[] = [];
  const quarantined: QuarantinedKey[] = [];
  const applied: Record<string, SettingValue> = {};

  const version = parse(layer.schema_version);

  // إصدار غير مفهوم يُعامَل معاملة الأحدث: لا شيء يُطبَّق.
  if (version === null || version.major > KNOWN.major) {
    degradations.push({
      code: "LAYER_SCHEMA_MAJOR_TOO_NEW",
      scope: layer.scope,
      detail: `layer schema_version ${layer.schema_version} is not readable by this build (${CONFIG_SCHEMA_VERSION}); no value from this layer is applied`,
    });
    for (const key of Object.keys(layer.values)) {
      quarantined.push({ scope: layer.scope, key, reason: "LAYER_SCHEMA_MAJOR_TOO_NEW" });
    }
    return { applied, degradations, quarantined };
  }

  if (version.minor > KNOWN.minor) {
    degradations.push({
      code: "LAYER_SCHEMA_MINOR_TOO_NEW",
      scope: layer.scope,
      detail: `layer schema_version ${layer.schema_version} is newer than ${CONFIG_SCHEMA_VERSION}; only keys this build understands are applied`,
    });
  }

  for (const key of Object.keys(layer.values).sort()) {
    const value = layer.values[key];
    const definition = findSetting(key);

    if (definition === undefined) {
      const reason = isCoreKey(key) ? "UNKNOWN_RESERVED_KEY" : "LAYER_SCHEMA_MINOR_TOO_NEW";
      quarantined.push({ scope: layer.scope, key, reason });
      if (isCoreKey(key)) {
        // مفتاح في مساحة النواة لا نعرفه: قد يكون حسّاسًا. لا يُتجاهل بصمت أبدًا.
        degradations.push({
          code: "UNKNOWN_RESERVED_KEY",
          scope: layer.scope,
          key,
          detail: "reserved-namespace key is not known to this build and may be trust-sensitive",
        });
      }
      continue;
    }

    if (!definition.allowed_scopes.includes(layer.scope)) {
      quarantined.push({ scope: layer.scope, key, reason: "INVALID_STORED_VALUE" });
      degradations.push({
        code: "INVALID_STORED_VALUE",
        scope: layer.scope,
        key,
        detail: `stored in scope ${layer.scope}, which is not an allowed scope for this setting`,
      });
      continue;
    }

    const errors = validateValue(definition, value);
    if (errors.length > 0) {
      quarantined.push({ scope: layer.scope, key, reason: "INVALID_STORED_VALUE" });
      degradations.push({
        code: "INVALID_STORED_VALUE",
        scope: layer.scope,
        key,
        detail: errors[0]?.internal_detail ?? "value failed validation",
      });
      continue;
    }

    applied[key] = value as SettingValue;
  }

  return { applied, degradations, quarantined };
}
