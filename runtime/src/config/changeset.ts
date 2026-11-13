// مجموعات التغيير الذرّية. القاعدة الوحيدة: الكل أو لا شيء.
//
// التحقق يكتمل بالكامل قبل أي كتابة. الكتابة نفسها استبدال طبقة واحدة بطبقة جديدة
// مبنية مسبقًا، فلا توجد لحظة يكون فيها المخزن في حالة نصف مطبَّقة حتى نظريًا.

import { ErrorCode, type ContractError } from "@polaris/contracts";

import { findSetting, isCoreKey, CONFIG_SCHEMA_VERSION } from "./schema.js";
import { validateValue } from "./validate.js";
import type { ConfigStore } from "./store.js";
import type { Scope, SettingValue, WriteOrigin } from "./types.js";

export interface ConfigChange {
  readonly key: string;
  readonly scope: Scope;
  /** null يعني إزالة القيمة من هذا النطاق والعودة إلى ما دونه. */
  readonly value: SettingValue | null;
}

export interface Changeset {
  readonly changeset_id: string;
  readonly origin: WriteOrigin;
  readonly changes: readonly ConfigChange[];
}

export type ChangesetResult =
  | { readonly applied: true; readonly changeset_id: string; readonly change_count: number }
  | { readonly applied: false; readonly changeset_id: string; readonly errors: readonly ContractError[] };

function reject(key: string, code: ErrorCode, display: string, detail: string): ContractError {
  return { code, display_message: display, internal_detail: detail, pointer: `/${key}`, retryable: false };
}

/** يتحقق من المجموعة كاملة دون لمس المخزن. */
export function validateChangeset(changeset: Changeset): readonly ContractError[] {
  const errors: ContractError[] = [];
  const seen = new Set<string>();

  if (changeset.changes.length === 0) {
    errors.push(reject("", ErrorCode.VALIDATION_ERROR, "A changeset must contain at least one change.", "empty changeset"));
  }

  for (const change of changeset.changes) {
    const slot = `${change.scope}:${change.key}`;
    if (seen.has(slot)) {
      // مفتاحان لنفس الخانة يجعلان النتيجة معتمدة على ترتيب التطبيق. مرفوض.
      errors.push(reject(change.key, ErrorCode.CONFLICT, "The same setting is changed twice in one changeset.", slot));
      continue;
    }
    seen.add(slot);

    const definition = findSetting(change.key);
    if (definition === undefined) {
      errors.push(
        reject(change.key, ErrorCode.VALIDATION_ERROR, `Unknown setting "${change.key}".`, "not in config schema v1"),
      );
      continue;
    }

    // مساحة أسماء النواة محجوزة. مكوّن خارجي لا يكتب فيها مهما كانت القيمة صالحة.
    if (changeset.origin === "PLUGIN" && isCoreKey(change.key)) {
      errors.push(
        reject(
          change.key,
          ErrorCode.POLICY_DENIED,
          "A plugin cannot write to the reserved POLARIS namespace.",
          `origin=PLUGIN key=${change.key}`,
        ),
      );
      continue;
    }

    if (!definition.allowed_scopes.includes(change.scope)) {
      errors.push(
        reject(
          change.key,
          ErrorCode.POLICY_DENIED,
          `Setting "${change.key}" cannot be set in ${change.scope} scope.`,
          `allowed scopes: ${definition.allowed_scopes.join(", ")}`,
        ),
      );
      continue;
    }

    if (change.value !== null) errors.push(...validateValue(definition, change.value));
  }

  return errors;
}

/**
 * يطبّق المجموعة ذرّيًا. أي خطأ في أي تغيير يعني صفر تغييرات مطبَّقة.
 * الطبقات الجديدة تُبنى كاملة أولًا، ثم تُستبدل، فلا يمكن أن يفشل نصف التطبيق.
 */
export function applyChangeset(store: ConfigStore, changeset: Changeset): ChangesetResult {
  const errors = validateChangeset(changeset);
  if (errors.length > 0) {
    return { applied: false, changeset_id: changeset.changeset_id, errors };
  }

  const pending = new Map<Scope, Record<string, unknown>>();
  for (const change of changeset.changes) {
    let layer = pending.get(change.scope);
    if (layer === undefined) {
      layer = { ...store.readLayer(change.scope).values };
      pending.set(change.scope, layer);
    }
    if (change.value === null) delete layer[change.key];
    else layer[change.key] = change.value;
  }

  for (const [scope, values] of pending) {
    store.replaceLayer({ schema_version: CONFIG_SCHEMA_VERSION, scope, values });
  }

  return { applied: true, changeset_id: changeset.changeset_id, change_count: changeset.changes.length };
}
