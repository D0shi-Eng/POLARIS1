// عقود إثبات الإنجاز الأدنى.
//
// الفكرة كلها في التمييز بين جملتين:
//   «الوكيل يقول إنه أنجز»  ≠  «النظام رصد الأثر المطلوب ويستطيع أن يسنده».
// لذلك حالة الإثبات حقل مستقل، ولا تُشتق من حالة المهمة أبدًا.

import type { EffectAction } from "../effects.js";
import type { TargetIdentity } from "../pep/grant.js";
import type { W5ErrorCode } from "../errors.js";

/** ثلاث حالات فقط. لا يوجد «غالبًا مُثبَت». */
export type CompletionProofStatus = "PROVEN" | "NOT_PROVEN" | "FAILED";

/**
 * متطلب قابل للرصد، يُعلَن عند جذر التركيب لا في مقترح النموذج.
 * لو أعلنه النموذج لَاختار هو ما يُقاس به، وصار الإثبات تحصيل حاصل.
 */
export interface CompletionRequirement {
  readonly requirement_id: string;
  readonly mission_id: string;
  readonly effect: EffectAction;
  /** الهدف المتوقع، بالمسار المنطقي القانوني. */
  readonly expected_target: string;
  readonly description: string;
}

export interface ObservedTarget {
  readonly logical: string;
  readonly host: string;
  readonly exists: boolean;
  readonly identity?: TargetIdentity;
}

/** ما استند إليه الإثبات فعلًا. كل حقل هنا شيء رُصد، لا شيء افتُرض. */
export interface CompletionEvidence {
  readonly expected_target: string;
  readonly observed_target: ObservedTarget | null;
  /** المنحة التي يُنسب إليها الأثر، من سجل التدقيق لا من ادعاء. */
  readonly execution_grant_id: string | null;
  readonly executor_status: string | null;
  readonly executor_bytes: number | null;
  /** البصمة التي أبلغ بها المنفّذ عند الكتابة. */
  readonly executor_content_sha256: string | null;
  /** بصمة قراءة محصورة لاحقة عبر نفس سلسلة الفرض. */
  readonly reobserved_content_sha256: string | null;
  readonly reobservation_invocation_id: string | null;
  readonly audit_event_refs: readonly string[];
  readonly audit_chain_head: string;
  readonly audit_chain_verified: boolean;
  readonly audit_chain_binder: string;
}

export interface CompletionProof {
  readonly contract_version: "1.0";
  readonly completion_proof_id: string;
  readonly mission_id: string;
  readonly correlation_id: string;
  readonly requirement_id: string;
  readonly effect: EffectAction;
  readonly status: CompletionProofStatus;
  /** سبب عدم الإثبات. null عند PROVEN وحدها. */
  readonly reason_code: W5ErrorCode | null;
  readonly detail: string;
  readonly evidence: CompletionEvidence;
  readonly created_at: string;
}
