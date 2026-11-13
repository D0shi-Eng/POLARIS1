// أنواع بوابة القدرات: ما يدخلها، وما يخرج منها.

import type { EffectAction } from "../effects.js";
import type { W4Error } from "../errors.js";
import type { Doc } from "../policy/types.js";
import type { DenialExplanation } from "../policy/explain.js";
import type { TaintLabel } from "../trust/taint.js";

/**
 * اقتراح استدعاء قدرة. هذا ما يستطيع الوكيل تقديمه، ولا شيء غيره.
 * لاحظ ما ليس هنا: لا متطلبات تنفيذ، ولا سقوف، ولا آثار حرة، ولا مسار مضيف.
 * تخفيف الحصر غير قابل للتمثيل في هذا النوع أصلًا.
 */
export interface CapabilityProposal {
  readonly capability_id: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** الوسوم التي يحملها المقترح. المقترح المشتق من نموذج يحمل MODEL_GENERATED دائمًا. */
  readonly taint_labels: readonly TaintLabel[];
  readonly provenance_refs: readonly Doc[];
  /** معرّف مخرج النموذج الذي أنتج هذا المقترح. */
  readonly causation_id: string;
}

export interface GatewayCallContext {
  readonly correlation_id: string;
  readonly mission_id: string;
  readonly agent_id: string;
  readonly caller_identity: Doc;
  readonly attempt: number;
}

/** نتيجة أداة منظّمة. تفرّق صراحةً بين تصريح المورد وثقة المحتوى. */
export interface ToolResult {
  readonly capability_id: string;
  readonly invocation_id: string;
  readonly resource_logical: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content?: string;
  readonly content_sha256?: string;
  readonly wrote?: "CREATE" | "MODIFY";
  /** المورد كان مصرّحًا به. لا يعني هذا إطلاقًا أن محتواه موثوق. */
  readonly resource_authorization: "AUTHORIZED";
  readonly content_trust: "UNTRUSTED";
  readonly taint_labels: readonly TaintLabel[];
  readonly execution_host_id: string;
  readonly windows_confinement: boolean;
  readonly enforcement_checks: readonly string[];
}

export type GatewayOutcome =
  | {
      readonly ok: true;
      readonly invocation: Doc;
      readonly decision: Doc;
      readonly explanation: DenialExplanation;
      readonly result: ToolResult;
    }
  | {
      readonly ok: false;
      readonly error: W4Error;
      readonly invocation?: Doc;
      readonly decision?: Doc;
      readonly explanation?: DenialExplanation;
    };

/**
 * المنفذ الوحيد الذي تراه طبقة الوكيل. الوكيل لا يعرف PDP ولا PEP ولا منفّذًا،
 * ولا يستطيع بناء استدعاء بنفسه: هو يقدّم اقتراحًا فقط.
 */
export interface CapabilityGatewayPort {
  invoke(proposal: CapabilityProposal, context: GatewayCallContext): Promise<GatewayOutcome>;
  /** القدرات المتاحة، لبناء موجّه النظام. أسماء فقط. */
  availableCapabilities(): readonly string[];
  /**
   * الآثار التي تعلنها قدرة. بيانات وصفية لا امتياز: يحتاجها الوكيل ليطلب
   * رفع تصنيف لكل أثر على حدة، ولا تمنحه أي قدرة على تجاوز البوابة.
   */
  effectsOf(capabilityId: string): readonly EffectAction[] | undefined;
}
