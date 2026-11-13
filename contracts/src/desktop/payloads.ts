// تحقق حمولات سطح المكتب: الطلب والنتيجة، كلٌّ مقابل مخططه المُسمّى في السجل.
//
// ملكية التحقق (PHASE-01-IPC-CONTRACTS.md §5): العارض يتحقق من الطلب قبل الإرسال
// ومن الرد قبل الإرجاع؛ والبوابة الأصلية تتحقق من الطلب قبل التوجيه ومن ردّها
// قبل الإجابة. الطرفان يستعملان هذه الدوال نفسها فوق ملفات المخططات نفسها، فلا
// «الواجهة تثق بالخلفية» ولا العكس.

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import { DESKTOP_REQUEST_SCHEMA, DESKTOP_RESULT_SCHEMA, type DesktopOperation } from "./operations.js";

export type PayloadDirection = "REQUEST" | "RESULT";

function secretViolations(value: unknown, basePointer: string): ContractError[] {
  return findSecretsDeep(value, basePointer).map((finding) => ({
    code: ErrorCode.CONTRACT_VIOLATION,
    display_message: "Desktop payload must not carry credentials.",
    // التفصيل لا يحمل القيمة المكتشفة أبدًا: كاشفُ أسرار يطبع السرّ ليس كاشفًا.
    internal_detail: `${finding.reason}: ${finding.detail}`,
    pointer: finding.pointer,
    retryable: false,
  }));
}

/** يتحقق من حمولة طلب عملية سطح مكتب، بنيةً ثم نظافةً أمنية. */
export function validateDesktopRequestPayload<T = unknown>(
  operation: DesktopOperation,
  payload: unknown,
): Result<T> {
  const structural = validateAgainstSchemaReference<T>(DESKTOP_REQUEST_SCHEMA[operation], payload);
  if (!structural.ok) return structural;

  const secrets = secretViolations(payload, "/payload");
  if (secrets.length > 0) return fail(secrets);

  return structural;
}

/** يتحقق من حمولة نتيجة عملية سطح مكتب. */
export function validateDesktopResultPayload<T = unknown>(
  operation: DesktopOperation,
  result: unknown,
): Result<T> {
  const structural = validateAgainstSchemaReference<T>(DESKTOP_RESULT_SCHEMA[operation], result);
  if (!structural.ok) return structural;

  const secrets = secretViolations(result, "/result");
  if (secrets.length > 0) return fail(secrets);

  return structural;
}

/** مدخل واحد للاتجاهين، لمن يوجّه برمجيًا اعتمادًا على السجل. */
export function validateDesktopPayload<T = unknown>(
  operation: DesktopOperation,
  direction: PayloadDirection,
  value: unknown,
): Result<T> {
  return direction === "REQUEST"
    ? validateDesktopRequestPayload<T>(operation, value)
    : validateDesktopResultPayload<T>(operation, value);
}
