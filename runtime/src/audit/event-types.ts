// مفردات أنواع أحداث التدقيق.
//
// مفصولة عن المُصدِر لأن السلسلة والتحقق والمشاهد كلها تحتاجها، ولا يجوز أن
// تُعرَّف في الملف الذي يُصدِر فقط. المفردة هنا مطابقة تمامًا لِـ enum في
// contracts/schemas/audit-event.v1.schema.json، ويحرس التطابقَ اختبار انجراف
// يقرأ المخطط من مصدر الحقيقة.

/** مفردة W2 الأصلية. لم يُحذف منها شيء في W5. */
export type W2AuditEventType =
  | "IPC_MESSAGE_RECEIVED"
  | "CAPABILITY_DESCRIBED"
  | "INVOCATION_REQUESTED"
  | "POLICY_EVALUATED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_RESOLVED"
  | "EXECUTION_STARTED"
  | "EXECUTION_COMPLETED"
  | "MODEL_OUTPUT_VALIDATED"
  | "CONTRACT_VIOLATION_DETECTED";

/**
 * إضافات W5.
 *
 * APPROVAL_REQUESTED و APPROVAL_RESOLVED من مفردة W2 عامّان: الأول لا يفرّق بين
 * «النظام يشترط موافقة» و«الطلب عُرض على الإنسان»، والثاني لا يحمل سبب الحسم.
 * W5 يصدر البدائل المحدَّدة أدناه ولا يصدر العامّين، فلا يوجد مفهوم واحد باسمين
 * في مجرى الأحداث. الاسمان يبقيان في المخطط لأن حذف قيمة من enum تغيير كاسر.
 */
export type W5AuditEventType =
  | "MISSION_STARTED"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED"
  | "CAPABILITY_PROPOSED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_PRESENTED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_REPLAY_REFUSED"
  | "EXECUTION_GRANT_ISSUED"
  | "PANIC_STOP_REQUESTED"
  | "PANIC_STOP_ENTERED"
  | "EXECUTOR_TERMINATED_BY_STOP"
  | "PANIC_STOP_COMPLETED"
  | "SYSTEM_RESUMED"
  | "COMPLETION_PROOF_CREATED"
  | "COMPLETION_PROOF_FAILED";

export type AuditEventType = W2AuditEventType | W5AuditEventType;

/**
 * الأنواع التي يصدرها W5 فعلًا. قائمة صريحة حتى يستطيع اختبار أن يسأل:
 * هل كل نوع معلن له مسار ينتجه؟ ونوع بلا مسار عيب لا زينة.
 */
export const W5_EMITTED_EVENT_TYPES: readonly W5AuditEventType[] = [
  "MISSION_STARTED",
  "MISSION_COMPLETED",
  "MISSION_FAILED",
  "CAPABILITY_PROPOSED",
  "APPROVAL_REQUIRED",
  "APPROVAL_PRESENTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "APPROVAL_REPLAY_REFUSED",
  "EXECUTION_GRANT_ISSUED",
  "PANIC_STOP_REQUESTED",
  "PANIC_STOP_ENTERED",
  "EXECUTOR_TERMINATED_BY_STOP",
  "PANIC_STOP_COMPLETED",
  "SYSTEM_RESUMED",
  "COMPLETION_PROOF_CREATED",
  "COMPLETION_PROOF_FAILED",
];

/** الأنواع العامّة التي تجاوزتها مفردة W5 ولا يصدرها هذا البناء. */
export const SUPERSEDED_EVENT_TYPES: readonly W2AuditEventType[] = [
  "APPROVAL_REQUESTED",
  "APPROVAL_RESOLVED",
];

export type AuditOutcomeStatus = "SUCCESS" | "DENIED" | "FAILED" | "TIMEOUT" | "CANCELLED";

/** الحالات التي يشترط عقد AuditEventV1 معها حقل خطأ. */
export function statusRequiresError(status: AuditOutcomeStatus): boolean {
  return status === "FAILED" || status === "TIMEOUT" || status === "DENIED";
}
