// واجهة خدمة الإعدادات. لا يقرأ أي مكوّن آخر المخزن ولا المحلّل مباشرة،
// ولا يقرأ ملف إعدادات بنفسه. هذا الحد هو ما يجعل الحل قابلًا للتفسير والاختبار.

import type { ContractError } from "@polaris/contracts";

import { applyChangeset, validateChangeset, type Changeset, type ChangesetResult } from "./changeset.js";
import { exportConfig, type ConfigExport } from "./export.js";
import { resolve } from "./resolver.js";
import { InMemoryConfigStore, type ConfigStore } from "./store.js";
import type { EffectiveConfig, SettingValue, StoredLayer } from "./types.js";

export class ConfigService {
  readonly #store: ConfigStore;
  #cached: EffectiveConfig;

  public constructor(store: ConfigStore = new InMemoryConfigStore()) {
    this.#store = store;
    this.#cached = resolve(store);
  }

  public static fromLayers(layers: readonly StoredLayer[]): ConfigService {
    return new ConfigService(new InMemoryConfigStore(layers));
  }

  /** الإعدادات الفعّالة الحالية. مُجمّدة، فلا يمكن للمستدعي تعديلها موضعيًا. */
  public effective(): EffectiveConfig {
    return this.#cached;
  }

  public get(key: string): SettingValue | undefined {
    return this.#cached.settings[key]?.value;
  }

  /** قراءة مُلزِمة بالنوع للمواضع التي يكون فيها غياب المفتاح خطأ برمجيًا. */
  public require<T extends SettingValue>(key: string): T {
    const resolved = this.#cached.settings[key];
    if (resolved === undefined) throw new Error(`config key not in schema: ${key}`);
    return resolved.value as T;
  }

  public dryRun(changeset: Changeset): readonly ContractError[] {
    return validateChangeset(changeset);
  }

  /** تطبيق ذرّي. عند الفشل لا يتغير شيء، والإعدادات الفعّالة تبقى كما كانت. */
  public apply(changeset: Changeset): ChangesetResult {
    const before = this.#cached;
    const result = applyChangeset(this.#store, changeset);
    this.#cached = result.applied ? resolve(this.#store) : before;
    return result;
  }

  public export(): ConfigExport {
    return exportConfig(this.#cached);
  }
}
