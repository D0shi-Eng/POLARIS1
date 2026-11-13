// سطح الموافقة الموثوق.
//
// الحد: ما يعرض على الإنسان وينتظر فعله. لا يعرف سياسة، ولا ينفّذ شيئًا،
// ولا يستطيع أن يقرّر بنفسه — القرار يأتي من فعل صريح على الطرف الآخر.
//
// خارج سيطرة النموذج بالبناء: لا يوجد في هذا الحد مدخل يستقبل شيئًا من النموذج،
// ولا يستطيع الوكيل استيراد أي تطبيق له.

import type { ApprovalOutcomeKind, ApprovalRequest } from "./types.js";

export interface SurfaceDecision {
  readonly kind: ApprovalOutcomeKind;
  readonly at: string;
}

export interface TrustedApprovalSurface {
  readonly id: string;
  /** إقرار صريح يظهر في الدليل: هذا السطح خارج مسار النموذج. */
  readonly outside_model_control: true;
  /**
   * يعرض الطلب وينتظر فعلًا. لا يعود بمنح إلا بفعل صريح؛ وانتهاء المهلة
   * يعود بـEXPIRED — أي لا أثر — ولا يعود بمنح إطلاقًا.
   */
  present(request: ApprovalRequest): Promise<SurfaceDecision>;
}
