// ترجمة الخطأ إلى شيء تستطيع الشاشة عرضه.
//
// ما يصل من المضيف هو رمز ومفتاح عرض. العارض لا يملك نصًّا إنجليزيًا مكتوبًا في
// مكوّن، ولا يعرض تفصيلًا داخليًا لأنه لا يستلم أيًّا منه أصلًا.

import { displayKeyForCategory, errorCategory } from "./operations";

/** تصنيفات الحدّ التسعة. */
export type DesktopErrorCategory =
  | "IPC_UNAVAILABLE"
  | "IPC_TIMEOUT"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_RESPONSE"
  | "NATIVE_SERVICE_UNAVAILABLE"
  | "CONFIG_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "FEATURE_NOT_AVAILABLE"
  | "INTERNAL_ERROR";

/** الخطأ كما تراه طبقة العرض: مفتاح، ورمز، وهل تُجدي إعادة المحاولة. */
export interface DisplayError {
  readonly category: DesktopErrorCategory;
  readonly code: string;
  readonly displayKey: string;
  readonly retryable: boolean;
}

/** الشكل الذي يحمله ظرف الرد عند الفشل. لا `internal_detail` فيه ولا `stack`. */
export interface BoundaryErrorPayload {
  readonly code?: unknown;
  readonly display_message?: unknown;
  readonly retryable?: unknown;
}

const CATEGORY_BY_DISPLAY_KEY = new Map<string, DesktopErrorCategory>();

function categoryByKey(key: string): DesktopErrorCategory | undefined {
  if (CATEGORY_BY_DISPLAY_KEY.size === 0) {
    for (const entry of [
      "IPC_UNAVAILABLE",
      "IPC_TIMEOUT",
      "UNSUPPORTED_OPERATION",
      "INVALID_RESPONSE",
      "NATIVE_SERVICE_UNAVAILABLE",
      "CONFIG_UNAVAILABLE",
      "PERMISSION_DENIED",
      "FEATURE_NOT_AVAILABLE",
      "INTERNAL_ERROR",
    ] as DesktopErrorCategory[]) {
      const record = errorCategory(entry);
      if (record !== undefined) CATEGORY_BY_DISPLAY_KEY.set(record.display_key, entry);
    }
  }
  return CATEGORY_BY_DISPLAY_KEY.get(key);
}

/** يبني خطأ عرض من تصنيف يعرفه العارض نفسه (انقطاع النقل، انتهاء المهلة). */
export function localError(category: DesktopErrorCategory, code: string): DisplayError {
  const record = errorCategory(category);
  return {
    category,
    code,
    displayKey: displayKeyForCategory(category),
    retryable: record?.retryable ?? false,
  };
}

/**
 * يترجم خطأ وصل في ظرف رد.
 *
 * التصنيف يُستنتج من مفتاح العرض لأن الظرف لا يحمل حقل تصنيف: `ContractError`
 * مجمّد في عقد النواة ولا يُوسَّع من أجل Phase-01. المفتاح كافٍ ومُعلَن في خريطة
 * الأخطاء، وهو ما يجعل هذا استنتاجًا من وثيقة لا تخمينًا.
 */
export function translateBoundaryError(payload: BoundaryErrorPayload | undefined): DisplayError {
  const displayKey = typeof payload?.display_message === "string" ? payload.display_message : "";
  const category = categoryByKey(displayKey) ?? "INTERNAL_ERROR";
  const record = errorCategory(category);
  return {
    category,
    code: typeof payload?.code === "string" ? payload.code : "INTERNAL_ERROR",
    displayKey: displayKey.startsWith("desktop.error.") ? displayKey : displayKeyForCategory(category),
    retryable: typeof payload?.retryable === "boolean" ? payload.retryable : (record?.retryable ?? false),
  };
}

/** هل حمل هذا الرد شيئًا لا يجوز أن يعبر الحدّ؟ يُستعمل كحارس في الاختبار وفي التشغيل. */
export function carriesForbiddenDetail(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "internal_detail" in error || "stack" in error;
}
