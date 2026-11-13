// عقود الموافقة الموثوقة.
//
// عقود على مستوى طبقة التشغيل، لا عقود W2 أساسية: العقود الستة مغلقة عمدًا،
// وشكل الموافقة في Tier-0 لم يُقَس بما يكفي لتجميده في مخطط JSON مصدرًا للحقيقة.
// القرار مسجَّل في ADR-011، ومعه شرط الترقية: إذا عبَر الإيصال حدَّ عملية أو
// حدَّ ثقة، صار عقدًا أساسيًا بمخططه.
//
// ما يجعل هذه الأنواع أمنية لا وصفية: الربط. الإيصال لا يقول «مسموح»، بل يقول
// «مسموح لهذا الأثر بعينه على هذا الكائن بعينه في هذا الاستدعاء بعينه».

import type { EffectAction } from "../effects.js";
import type { GrantOperation, TargetIdentity } from "../pep/grant.js";

export type RiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ApprovalDecision = "GRANTED" | "REJECTED";

/** حالة الطلب في السجل. الانتقال إليها من واحدة فقط، ولا عودة. */
export type ApprovalState = "PENDING" | "GRANTED" | "REJECTED" | "EXPIRED" | "CONSUMED" | "INVALIDATED";

/**
 * الهدف كما رُصد وقت بناء الطلب. الهوية غائبة حين لا يوجد كائن بعد (إنشاء ملف)،
 * وحضورها في القراءة والتعديل هو ما يجعل «تغيّر الهدف» قابلًا للكشف.
 */
export interface ApprovalTargetBinding {
  readonly logical: string;
  readonly host: string;
  readonly identity?: TargetIdentity;
}

/**
 * ملخّص الفعل المعروض على الإنسان. كل حقل فيه مشتق من مصدر موثوق:
 * فهرس القدرات، وسلطة المسارات، وقرار السياسة. لا نثر نموذج، ولا محتوى ملف.
 */
export interface TrustedActionSummary {
  readonly capability_id: string;
  readonly capability_version: string;
  readonly display_name: string;
  readonly operation: GrantOperation;
  readonly effects: readonly EffectAction[];
  readonly target_logical: string;
  readonly risk_class: RiskClass;
  /** ما سيحدث إن وافق. جملة مبنية من الحقول أعلاه، لا نصٌّ حرّ من أي مصدر. */
  readonly consequence: string;
}

/**
 * سياق غير موثوق قد يُعرض بجوار الملخّص، معزولًا ومُعلَّمًا.
 * وجوده اختياري، وغيابه هو الافتراضي: لا شيء يفرض عرض نثر النموذج إطلاقًا.
 */
export interface UntrustedContextBlock {
  readonly label: string;
  readonly content_trust: "UNTRUSTED";
  readonly body: string;
}

export interface ApprovalRequest {
  readonly contract_version: "1.0";
  readonly approval_id: string;
  readonly mission_id: string;
  readonly correlation_id: string;
  readonly invocation_id: string;
  readonly policy_decision_id: string;
  readonly effects: readonly EffectAction[];
  readonly canonical_target: ApprovalTargetBinding;
  /** بصمة الخطة: القدرة والعملية والآثار وبصمة الوسيطات والهدف وقيود التنفيذ. */
  readonly plan_hash: string;
  readonly risk_class: RiskClass;
  /** سبب مقروء، مبني من حقول موثوقة. */
  readonly reason: string;
  readonly summary: TrustedActionSummary;
  readonly untrusted_context: readonly UntrustedContextBlock[];
  readonly approver: "END_USER" | "OPERATOR";
  readonly issued_at: string;
  readonly expires_at: string;
  readonly single_use: true;
}

export interface ApprovalReceipt {
  readonly contract_version: "1.0";
  readonly approval_id: string;
  readonly mission_id: string;
  readonly correlation_id: string;
  readonly invocation_id: string;
  readonly policy_decision_id: string;
  readonly decision: ApprovalDecision;
  readonly effects: readonly EffectAction[];
  readonly canonical_target: ApprovalTargetBinding;
  readonly plan_hash: string;
  /** بصمة الطلب الذي أُقرّ. تربط الإيصال بنصّ الطلب لا بمعرّفه فقط. */
  readonly request_hash: string;
  readonly approved_at: string;
  readonly expires_at: string;
  readonly single_use: true;
  /** هوية المُصدِر. تظهر في الدليل. */
  readonly issuer: string;
  /**
   * ربط تكامل بمفتاح يملكه المُصدِر وحده. ليس توقيعًا ولا عدم إنكار:
   * هو ما يجعل إيصالًا لم يصدره المُصدِر الموثوق غير قابل للتزوير من داخل
   * العملية — بما في ذلك أي إيصال ينتجه نموذج أو أداة أو محتوى ملف.
   */
  readonly issuer_binding: string;
}

/** ما تتوقعه نقطة الفرض وقت التحقق. تُبنى من مصادرها هي، لا من الإيصال. */
export interface ApprovalExpectation {
  readonly mission_id: string;
  readonly correlation_id: string;
  readonly invocation_id: string;
  readonly policy_decision_id: string;
  readonly effects: readonly EffectAction[];
  readonly canonical_target: ApprovalTargetBinding;
  readonly plan_hash: string;
}

export type ApprovalOutcomeKind = "GRANTED" | "REJECTED" | "EXPIRED";

export interface ApprovalOutcome {
  readonly kind: ApprovalOutcomeKind;
  readonly approval_id: string;
  readonly at: string;
  /** الإيصال حاضر عند المنح فقط. الرفض والانتهاء لا يُنتجان إيصالًا إطلاقًا. */
  readonly receipt?: ApprovalReceipt;
}
