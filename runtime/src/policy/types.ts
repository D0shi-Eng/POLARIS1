// أنواع طبقة السياسة. الطلب يُبنى من عقود W2 مباشرة، لا من JSON مواز.

import type { EffectiveConfig } from "../config/types.js";

export type Doc = Record<string, unknown>;

/** معرّف مجموعة السياسات وإصدارها. تُذكر في كل قرار حتى يكون القرار قابلًا للتفسير لاحقًا. */
export const POLICY_SET_ID = "polaris.phase00.w3";
export const POLICY_SET_VERSION = "0.2.0";
/** حقبة محلية بسيطة. تتغير عند أي تعديل على نص السياسات. لا علاقة لها بسياسة المؤسسة. */
export const POLICY_EPOCH = 2;

/** أصغر عقد إصدار للسياسات: MAJOR مختلف يعني نصًا لا يفهمه هذا البناء. */
export const SUPPORTED_POLICY_MAJOR = 0;

export interface PdpRequest {
  /** CapabilityInvocationV1 — يُتحقق منه قبل التقييم. */
  readonly invocation: Doc;
  /** CapabilityDescriptorV1 للقدرة المستدعاة. */
  readonly descriptor: Doc;
}

export interface EffectVerdict {
  readonly effect_index: number;
  readonly action: string;
  readonly decision: "allow" | "deny";
  /** معرّفات سياسات Cedar التي حسمت هذا الأثر. فارغة تعني الرفض الافتراضي. */
  readonly matched_policy_ids: readonly string[];
  readonly evaluation_errors: readonly string[];
}

export interface PolicyEvaluation {
  readonly verdicts: readonly EffectVerdict[];
  readonly config: EffectiveConfig;
}
