// مُصدِر الإيصالات. المكوّن الوحيد الذي يستطيع أن يُنتج إيصالًا صالحًا.
//
// هذا هو ثابت AGENT_CANNOT_SELF_APPROVE في صورته البنيوية: المفتاح محبوس هنا،
// والوكيل لا يستطيع استيراد هذا الملف (يحرسه اختبار معماري)، ولا يملك مرجعًا
// إلى نسخة منه. أي «إيصال» من مصدر آخر يفشل في التحقق لأنه لا يحمل ربطًا
// صحيحًا، لا لأننا فحصنا من أين جاء.
//
// المُصدِر لا يقرّر. هو يوثّق قرارًا اتُّخذ على سطح موثوق.

import { canonicalize } from "@polaris/contracts";

import { requestHash } from "./request.js";
import { ProcessLocalApprovalKey, type ApprovalIntegrityKey } from "./issuer-key.js";
import type { ApprovalReceipt, ApprovalRequest } from "./types.js";

/** الحقول التي يقع عليها الربط: الإيصال كله عدا الربط نفسه. */
export function receiptBindingPayload(receipt: Omit<ApprovalReceipt, "issuer_binding">): string {
  return canonicalize(receipt as unknown as Record<string, unknown>);
}

export class ApprovalReceiptIssuer {
  public readonly id: string;

  readonly #key: ApprovalIntegrityKey;

  public constructor(id = "polaris.approval.issuer.v1", key: ApprovalIntegrityKey = new ProcessLocalApprovalKey()) {
    this.id = id;
    this.#key = key;
  }

  public get mechanism(): string {
    return this.#key.mechanism;
  }

  /** يُصدِر إيصال منح. لا يوجد مسار يُصدِر إيصالًا لقرار رفض أو انتهاء صلاحية. */
  public issue(request: ApprovalRequest, approvedAt: string): ApprovalReceipt {
    const body: Omit<ApprovalReceipt, "issuer_binding"> = {
      contract_version: "1.0",
      approval_id: request.approval_id,
      mission_id: request.mission_id,
      correlation_id: request.correlation_id,
      invocation_id: request.invocation_id,
      policy_decision_id: request.policy_decision_id,
      decision: "GRANTED",
      effects: [...request.effects],
      canonical_target: request.canonical_target,
      plan_hash: request.plan_hash,
      request_hash: requestHash(request),
      approved_at: approvedAt,
      expires_at: request.expires_at,
      single_use: true,
      issuer: this.id,
    };
    return { ...body, issuer_binding: this.#key.bind(receiptBindingPayload(body)) };
  }

  /** هل هذا الإيصال من هذا المُصدِر ولم يُعدَّل. لا يفحص الربط بالسياق. */
  public bindingIsValid(receipt: ApprovalReceipt): boolean {
    const { issuer_binding: binding, ...body } = receipt;
    if (typeof binding !== "string" || binding.length === 0) return false;
    return this.#key.verify(receiptBindingPayload(body), binding);
  }
}
