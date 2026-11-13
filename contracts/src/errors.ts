// مفردات الأخطاء المشتركة. مطابقة لـ schemas/common/error.schema.json ويحرس التطابقَ اختبارُ تكافؤ.
// السبب: لا يوجد في POLARIS خطأ نصي حر، وكل حد ثقة يعيد رمزًا مصنفًا.

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  POLICY_DENIED: "POLICY_DENIED",
  MALFORMED_MESSAGE: "MALFORMED_MESSAGE",
  CONTRACT_VIOLATION: "CONTRACT_VIOLATION",
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ContractError {
  readonly code: ErrorCode;
  /** آمن للعرض لأي مستدعٍ مهما كان مستوى ثقته. */
  readonly display_message: string;
  /** تفصيل داخلي. يُحجب عن المستدعي غير الموثوق عبر بوابة الإفصاح. */
  readonly internal_detail?: string;
  readonly pointer?: string;
  readonly retryable?: boolean;
}

/** نتيجة موحّدة لكل عمليات التحقق في هذه الطبقة. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ContractError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(errors: readonly ContractError[]): Result<T> {
  return { ok: false, errors };
}

/**
 * بوابة الإفصاح: المستدعي غير الموثوق لا يرى internal_detail.
 * تُطبَّق عند حدود الثقة فقط، لا داخل النواة.
 */
export function redactForUntrusted(error: ContractError): ContractError {
  const { internal_detail: _hidden, ...safe } = error;
  return safe;
}
