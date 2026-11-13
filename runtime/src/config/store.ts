// مخزن الإعدادات. W3 يستخدم مخزنًا في الذاكرة فقط.
//
// تصريح صريح ومقصود: الذرّية المُثبَتة هنا ذرّية داخل عملية واحدة.
// لا يوجد ادعاء بـ crash-safety ولا durable transaction ولا RPO. لا يوجد قرص أصلًا.
// عندما يصل POLARIS إلى persistence حقيقية، تُستبدل هذه الطبقة خلف نفس الواجهة
// ويُعاد إثبات الذرّية على ذلك المخزن، لا يُنقل الادعاء إليه.

import type { Scope, StoredLayer } from "./types.js";
import { CONFIG_SCHEMA_VERSION } from "./schema.js";

export interface ConfigStore {
  readLayer(scope: Scope): StoredLayer;
  /** استبدال ذرّي لطبقة كاملة. لا توجد كتابة جزئية على مستوى الواجهة. */
  replaceLayer(layer: StoredLayer): void;
  snapshot(): readonly StoredLayer[];
}

/** نسخ عميق بسيط: القيم المخزَّنة JSON خالص، فلا حاجة لأكثر من ذلك. */
function freezeCopy(values: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze(JSON.parse(JSON.stringify(values)) as Record<string, unknown>);
}

export class InMemoryConfigStore implements ConfigStore {
  readonly #layers = new Map<Scope, StoredLayer>();

  public constructor(initial: readonly StoredLayer[] = []) {
    for (const layer of initial) this.replaceLayer(layer);
  }

  public readLayer(scope: Scope): StoredLayer {
    const found = this.#layers.get(scope);
    if (found !== undefined) return found;
    return Object.freeze({ schema_version: CONFIG_SCHEMA_VERSION, scope, values: Object.freeze({}) });
  }

  public replaceLayer(layer: StoredLayer): void {
    // التجميد يمنع تعديلًا عرضيًا من مستدعٍ يحتفظ بمرجع للطبقة بعد قراءتها.
    this.#layers.set(
      layer.scope,
      Object.freeze({ schema_version: layer.schema_version, scope: layer.scope, values: freezeCopy(layer.values) }),
    );
  }

  public snapshot(): readonly StoredLayer[] {
    return [...this.#layers.values()].sort((a, b) => a.scope.localeCompare(b.scope));
  }
}
