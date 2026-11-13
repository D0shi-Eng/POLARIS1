// مفردات أخطاء طبقة التشغيل. متميزة عن ErrorCode في العقود: تلك تصف خطأ عقد،
// وهذه تصف سبب توقف مسار تنفيذ. لا تُضاف رموز إلا عند وجود مسار حقيقي ينتجها.
//
// التصنيف واحد ومقسَّم بحسب المرحلة التي أدخلته: W4ErrorCode ثم W5ErrorCode.
// القسمة تاريخية لا معمارية، والاتحاد RuntimeErrorCode هو النوع المستعمل فعلًا.

export const W4ErrorCode = {
  /** المورد خارج نطاق نظام الملفات المسموح به. */
  FILESYSTEM_SCOPE_DENIED: "FILESYSTEM_SCOPE_DENIED",
  /** قيمة ملوّثة استُعملت كوسيطة فعل دون رفع تصنيف صالح. */
  TAINT_NOT_DECLASSIFIED: "TAINT_NOT_DECLASSIFIED",
  /** محاولة رفع تصنيف جرت وفشلت. */
  DECLASSIFICATION_FAILED: "DECLASSIFICATION_FAILED",
  /** القدرة غير موجودة في الفهرس. */
  CAPABILITY_NOT_FOUND: "CAPABILITY_NOT_FOUND",
  /** الأثر المطلوب لا يطابق ما أعلنه الواصف، أو لا يطابق العملية المنفَّذة. */
  EFFECT_MISMATCH: "EFFECT_MISMATCH",
  /** ميزانية أمان صلبة نفدت. */
  EXECUTION_BUDGET_EXCEEDED: "EXECUTION_BUDGET_EXCEEDED",
  /** مخرج النموذج لم يجتز بوابة ModelOutputContract. */
  MODEL_CONTRACT_VIOLATION: "MODEL_CONTRACT_VIOLATION",
  /** نقطة الفرض لم تستطع إثبات شرط تنفيذ، فأغلقت. */
  PEP_ENFORCEMENT_FAILED: "PEP_ENFORCEMENT_FAILED",
  /** السياسة رفضت. */
  POLICY_DENIED: "POLICY_DENIED",
  /** أثر شبكي: لا يوجد مسار فرض في W4 إطلاقًا. */
  NETWORK_EFFECT_UNAVAILABLE: "NETWORK_EFFECT_UNAVAILABLE",
} as const;

export type W4ErrorCode = (typeof W4ErrorCode)[keyof typeof W4ErrorCode];

/**
 * مفردات W5. مضافة إلى نفس التصنيف لا موازية له: الرمز الواحد لا يوجد باسمين،
 * ولا يُضاف رمز هنا إلا ومعه مسار حقيقي ينتجه واختبار يثبته.
 */
export const W5ErrorCode = {
  // ── سلسلة التدقيق ────────────────────────────────────────────────────────
  /** السلسلة لا تتحقق. سبب عام يُستعمل حين لا يكون العطب أدق من ذلك. */
  AUDIT_CHAIN_CORRUPTED: "AUDIT_CHAIN_CORRUPTED",
  /** تجزئة السابق في سجل لا تساوي تجزئة سلسلة السجل الذي قبله. */
  AUDIT_PREVIOUS_HASH_MISMATCH: "AUDIT_PREVIOUS_HASH_MISMATCH",
  /** تجزئة الحدث لا تطابق محتواه المُقنَّن. */
  AUDIT_EVENT_HASH_MISMATCH: "AUDIT_EVENT_HASH_MISMATCH",
  /** السجل نفسه مشوَّه، أو حدثه لا يجتاز AuditEventV1. */
  AUDIT_RECORD_MALFORMED: "AUDIT_RECORD_MALFORMED",

  // ── الموافقة ─────────────────────────────────────────────────────────────
  /** القرار سماح، لكنه يحمل التزام موافقة لم يُستوفَ بعد. */
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  /** إيصال استُهلك من قبل. الاستهلاك مرة واحدة، ولا استثناء. */
  APPROVAL_REPLAYED: "APPROVAL_REPLAYED",
  /** الإيصال لا يربط نفسه بهذه المهمة أو هذا الاستدعاء أو هذا القرار. */
  APPROVAL_BINDING_MISMATCH: "APPROVAL_BINDING_MISMATCH",
  APPROVAL_PLAN_CHANGED: "APPROVAL_PLAN_CHANGED",
  APPROVAL_TARGET_CHANGED: "APPROVAL_TARGET_CHANGED",
  APPROVAL_EFFECT_CHANGED: "APPROVAL_EFFECT_CHANGED",
  /** الإيصال مشوَّه، أو تكامله لا يصمد. يشمل كل إيصال لم يصدره المُصدِر الموثوق. */
  APPROVAL_RECEIPT_INVALID: "APPROVAL_RECEIPT_INVALID",

  // ── إيقاف الطوارئ ────────────────────────────────────────────────────────
  /** النظام في حالة STOPPED. لا قبول لعمل جديد. */
  PANIC_STOP_ACTIVE: "PANIC_STOP_ACTIVE",
  /** النظام في حالة STOPPING. الإيقاف جارٍ ولم يبلغ حالته النهائية. */
  PANIC_STOP_IN_PROGRESS: "PANIC_STOP_IN_PROGRESS",
  /** تنفيذ مملوك لم يُنهَ خلال المهلة المحدودة. */
  PANIC_STOP_TERMINATION_FAILED: "PANIC_STOP_TERMINATION_FAILED",
  /** بقي تنفيذ مملوك حيًّا بعد الإنهاء. الإيقاف لا يُعلن مكتملًا. */
  PANIC_STOP_SURVIVORS_FOUND: "PANIC_STOP_SURVIVORS_FOUND",
  /** طُلب تنفيذ والنظام موقوف. */
  EXECUTION_REFUSED_WHILE_STOPPED: "EXECUTION_REFUSED_WHILE_STOPPED",

  // ── إثبات الإنجاز ────────────────────────────────────────────────────────
  /** الدليل الذي يشير إليه الإثبات غائب أو لا يُحلّ. */
  COMPLETION_EVIDENCE_MISSING: "COMPLETION_EVIDENCE_MISSING",
  /** الهدف المتوقع غير موجود على المضيف. */
  COMPLETION_TARGET_MISSING: "COMPLETION_TARGET_MISSING",
  /** سلسلة التدقيق التي يستند إليها الإثبات لا تتحقق. */
  COMPLETION_AUDIT_CHAIN_INVALID: "COMPLETION_AUDIT_CHAIN_INVALID",
  /** الهدف موجود، لكن لا شيء يثبت أن مسار التنفيذ المصرَّح به هو من أنتجه. */
  COMPLETION_EFFECT_NOT_PROVEN: "COMPLETION_EFFECT_NOT_PROVEN",
} as const;

export type W5ErrorCode = (typeof W5ErrorCode)[keyof typeof W5ErrorCode];

/** التصنيف الكامل لطبقة التشغيل. رمز واحد، مصدر واحد. */
export type RuntimeErrorCode = W4ErrorCode | W5ErrorCode;

export interface W4Error {
  readonly code: RuntimeErrorCode;
  /** آمن للعرض لأي مستدعٍ. */
  readonly display_message: string;
  /** تفصيل داخلي. يخضع لبوابة الإفصاح نفسها المستعملة في W3. */
  readonly internal_detail: string;
  /** الطبقة التي أوقفت المسار. إثبات "أي طبقة منعت" جزء من الاختبار، لا زينة. */
  readonly layer: EnforcementLayer;
}

/** ترتيب الطبقات كما يمر بها الاستدعاء. أي رفض يجب أن يُنسب إلى واحدة منها بدقة. */
export type EnforcementLayer =
  | "AGENT_BUDGET"
  | "MODEL_OUTPUT_GATE"
  | "PROPOSAL"
  | "GATEWAY"
  | "DECLASSIFIER"
  | "PDP"
  | "APPROVAL"
  | "PEP"
  | "PANIC_STOP"
  | "EXECUTOR"
  | "AUDIT"
  | "COMPLETION_PROOF";

export function w4Error(
  code: RuntimeErrorCode,
  layer: EnforcementLayer,
  display: string,
  detail: string,
): W4Error {
  return { code, layer, display_message: display, internal_detail: detail };
}

/** نتيجة موحّدة داخل طبقة التشغيل. متميزة عن Result في العقود عمدًا. */
export type Attempt<T, E = W4Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function succeed<T, E = W4Error>(value: T): Attempt<T, E> {
  return { ok: true, value };
}

export function failWith<T, E = W4Error>(error: E): Attempt<T, E> {
  return { ok: false, error };
}
