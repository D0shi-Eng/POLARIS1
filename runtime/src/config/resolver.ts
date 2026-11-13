// محلّل الإعدادات. حتمي بالكامل: لا ساعة، لا عشوائية، لا إدخال/إخراج، لا حالة عامة.
// نفس المخزن ينتج نفس الإعدادات الفعّالة في كل مرة، بايتًا ببايت بعد التقنين.

import { allSettings, CONFIG_SCHEMA_VERSION } from "./schema.js";
import { interpretLayer } from "./compat.js";
import { SCOPE_ORDER } from "./types.js";
import type { ConfigStore as Store } from "./store.js";
import type { Degradation, EffectiveConfig, QuarantinedKey, ResolvedSetting } from "./types.js";

/**
 * ترتيب الحل: DEFAULT ثم USER. الأخير يغلب.
 * القيمة الابتدائية لكل مفتاح هي default من المخطط، لا من طبقة مخزَّنة،
 * حتى يكون لكل إعداد قيمة صالحة دائمًا مهما كان المخزن.
 */
export function resolve(store: Store): EffectiveConfig {
  const settings: Record<string, ResolvedSetting> = {};
  const degradations: Degradation[] = [];
  const quarantined: QuarantinedKey[] = [];

  for (const definition of allSettings()) {
    settings[definition.key] = {
      key: definition.key,
      value: definition.default,
      source_scope: "DEFAULT",
      sensitivity: definition.sensitivity,
    };
  }

  for (const scope of SCOPE_ORDER) {
    const result = interpretLayer(store.readLayer(scope));
    degradations.push(...result.degradations);
    quarantined.push(...result.quarantined);

    for (const key of Object.keys(result.applied).sort()) {
      const current = settings[key];
      if (current === undefined) continue;
      settings[key] = { ...current, value: result.applied[key]!, source_scope: scope };
    }
  }

  return Object.freeze({
    schema_version: CONFIG_SCHEMA_VERSION,
    settings: Object.freeze(settings),
    integrity: degradations.length > 0 ? "DEGRADED" : "HEALTHY",
    degradations: Object.freeze(degradations),
    quarantined: Object.freeze(quarantined),
  });
}
