// التحقق من قيمة إعداد مقابل تعريفه. مصنّف الأخطاء مشترك مع عقود W2.

import { ErrorCode, findSecrets, type ContractError } from "@polaris/contracts";

import { findSetting } from "./schema.js";
import type { SecretRef, SettingDefinition, SettingValue } from "./types.js";

function invalid(key: string, detail: string, code: ErrorCode = ErrorCode.VALIDATION_ERROR): ContractError {
  return {
    code,
    display_message: `Setting "${key}" has an invalid value.`,
    internal_detail: detail,
    pointer: `/${key}`,
    retryable: false,
  };
}

function isSecretRef(value: unknown): value is SecretRef {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)["$secret_ref"] === "string"
  );
}

/** يتحقق من قيمة واحدة. يعيد قائمة فارغة عند الصلاحية. */
export function validateValue(definition: SettingDefinition, value: unknown): ContractError[] {
  const { key, type } = definition;

  switch (type) {
    case "BOOLEAN":
      return typeof value === "boolean" ? [] : [invalid(key, `expected boolean, got ${typeof value}`)];

    case "INTEGER": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return [invalid(key, `expected integer, got ${typeof value}`)];
      }
      if (definition.min !== undefined && value < definition.min) {
        return [invalid(key, `below minimum ${definition.min}`)];
      }
      if (definition.max !== undefined && value > definition.max) {
        return [invalid(key, `above maximum ${definition.max}`)];
      }
      return [];
    }

    case "ENUM":
      return typeof value === "string" && (definition.enum_values ?? []).includes(value)
        ? []
        : [invalid(key, `not one of ${(definition.enum_values ?? []).join(", ")}`)];

    case "STRING": {
      if (typeof value !== "string") return [invalid(key, `expected string, got ${typeof value}`)];
      if (definition.item_pattern !== undefined && !new RegExp(definition.item_pattern).test(value)) {
        return [invalid(key, "does not match the required pattern")];
      }
      return [];
    }

    case "STRING_LIST": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return [invalid(key, "expected an array of strings")];
      }
      if (definition.item_pattern !== undefined) {
        const pattern = new RegExp(definition.item_pattern);
        const bad = (value as string[]).filter((v) => !pattern.test(v));
        if (bad.length > 0) return [invalid(key, `${bad.length} item(s) do not match the required pattern`)];
      }
      return [];
    }

    case "SECRET_REF": {
      // القاعدة الجوهرية: إعداد سري يقبل مرجعًا فقط. أي محاولة لوضع قيمة سر حرفية تُرفض،
      // ويُعاد استخدام كاشف الأسرار من W2 حتى لا تكون هذه قاعدة موازية تنجرف عن تلك.
      if (typeof value === "string") {
        return [invalid(key, "a secret-backed setting accepts a reference object, never a literal value")];
      }
      if (!isSecretRef(value)) return [invalid(key, "expected { $secret_ref: string }")];
      const ref = value.$secret_ref;
      if (definition.item_pattern !== undefined && !new RegExp(definition.item_pattern).test(ref)) {
        return [invalid(key, "reference is not a well-formed URI")];
      }
      // الكاشف يُطبَّق على القيمة وحدها، لا على اسم المفتاح: إعداد من نوع SECRET_REF
      // يُفترض أن يحمل اسمًا يدل على اعتماد، وذلك صحيح لا مخالفة. ما نمنعه هو أن
      // يكون *المرجع* نفسه قيمة اعتماد حقيقية مموّهة في هيئة عنوان.
      if (findSecrets({ reference: ref }, "/").length > 0) {
        return [
          invalid(key, "reference itself looks like a credential value", ErrorCode.CONTRACT_VIOLATION),
        ];
      }
      return [];
    }

    default:
      return [invalid(key, `unknown setting type ${String(type)}`, ErrorCode.CONTRACT_VIOLATION)];
  }
}

/** يتحقق من قيمة لمفتاح، ويرفض المفاتيح المجهولة بدل تجاهلها. */
export function validateKeyValue(key: string, value: unknown): ContractError[] {
  const definition = findSetting(key);
  if (definition === undefined) {
    return [
      {
        code: ErrorCode.VALIDATION_ERROR,
        display_message: `Unknown setting "${key}".`,
        internal_detail: "not present in config schema v1",
        pointer: `/${key}`,
        retryable: false,
      },
    ];
  }
  return validateValue(definition, value);
}

export function isValidSettingValue(definition: SettingDefinition, value: unknown): value is SettingValue {
  return validateValue(definition, value).length === 0;
}
