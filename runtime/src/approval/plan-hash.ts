// بصمة الخطة.
//
// السؤال الذي تجيب عنه: «هل ما سيُنفَّذ الآن هو ما وافق عليه الإنسان؟»
// لذلك تشمل كل ما يغيّر معنى الفعل — القدرة، العملية، الآثار، الوسيطات،
// الهدف وهويته، وقيود التنفيذ — ولا تشمل ما لا يغيّره: الطوابع الزمنية،
// معرّفات عشوائية، ترتيب المفاتيح.
//
// أي حقل يُضاف هنا لاحقًا يضيّق القبول ولا يوسّعه.

import { canonicalize, sha256Hex } from "@polaris/contracts";

import type { EffectAction } from "../effects.js";
import type { GrantOperation } from "../pep/grant.js";
import type { Doc } from "../policy/types.js";
import type { ApprovalTargetBinding } from "./types.js";

export interface PlanShape {
  readonly capability_id: string;
  readonly capability_version: string;
  readonly operation: GrantOperation;
  readonly effects: readonly EffectAction[];
  /** بصمة وسيطات الاستدعاء كما بناها البوابة. المحتوى نفسه لا يدخل هنا. */
  readonly arguments_digest: string;
  readonly target: ApprovalTargetBinding;
  readonly execution_constraints: Doc;
}

export function planHash(plan: PlanShape): string {
  return sha256Hex(
    canonicalize({
      capability_id: plan.capability_id,
      capability_version: plan.capability_version,
      operation: plan.operation,
      effects: [...plan.effects].sort(),
      arguments_digest: plan.arguments_digest,
      target: {
        logical: plan.target.logical,
        host: plan.target.host,
        identity:
          plan.target.identity === undefined
            ? null
            : { volume: plan.target.identity.volume, file: plan.target.identity.file },
      },
      execution_constraints: plan.execution_constraints,
    }),
  );
}

/** بصمة وسيطات الاستدعاء. مصدر واحد حتى لا تُحسب بطريقتين. */
export function argumentsDigest(args: Doc): string {
  return sha256Hex(canonicalize(args));
}
