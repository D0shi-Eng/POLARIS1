// راصد محصور مدعوم بالبوابة.
//
// يحوّل «اقرأ الهدف لتتأكد» إلى استدعاء عادي يمر بالبوابة والسياسة ونقطة الفرض
// والمنفّذ المحصور. لا اختصار، ولا امتياز، ولا قراءة خام.
//
// هوية المستدعي هنا SYSTEM لا AGENT، والوسم SYSTEM_DERIVED لا MODEL_GENERATED،
// لأن هذا الطلب لم يقترحه نموذج: أطلقه جذر التركيب على مسار متطلب مُعلَن.
// لو حمل وسم النموذج لَاحتاج رفع تصنيف لا معنى له، ولو ادّعى هوية وكيل لَكذب.

import { newId } from "../ids.js";
import type { CapabilityGatewayPort } from "../gateway/types.js";
import type { Doc } from "../policy/types.js";
import type { ConfinedObservation, ConfinedObserver } from "./observer.js";

export interface GatewayObserverOptions {
  readonly gateway: CapabilityGatewayPort;
  readonly correlation_id: string;
  readonly mission_id: string;
  readonly agent_id: string;
}

/** هوية نظام صريحة للرصد. لا تنتحل وكيلًا ولا مستخدمًا. */
export function systemObserverIdentity(): Doc {
  return {
    caller_type: "SYSTEM",
    principal_id: newId(),
    trust_tier: "TIER_0_TRUSTED",
    session_id: newId(),
  };
}

export class GatewayConfinedObserver implements ConfinedObserver {
  public readonly id = "polaris.proof.observer.gateway.v1";

  readonly #options: GatewayObserverOptions;
  readonly #identity = systemObserverIdentity();

  public constructor(options: GatewayObserverOptions) {
    this.#options = options;
  }

  public async observe(logicalTarget: string): Promise<ConfinedObservation> {
    const outcome = await this.#options.gateway.invoke(
      {
        capability_id: "polaris.fs.read_file",
        arguments: { path: logicalTarget },
        taint_labels: ["SYSTEM_DERIVED"],
        provenance_refs: [],
        causation_id: newId(),
      },
      {
        correlation_id: this.#options.correlation_id,
        mission_id: this.#options.mission_id,
        agent_id: this.#options.agent_id,
        caller_identity: this.#identity,
        attempt: 1,
      },
    );

    if (!outcome.ok) {
      return {
        ok: false,
        invocation_id: null,
        content_sha256: null,
        bytes: null,
        detail: `${outcome.error.code} at ${outcome.error.layer}: ${outcome.error.internal_detail}`,
      };
    }

    return {
      ok: true,
      invocation_id: outcome.result.invocation_id,
      content_sha256: outcome.result.content_sha256 ?? null,
      bytes: outcome.result.bytes,
      detail: `read ${String(outcome.result.bytes)} bytes through the confined executor`,
    };
  }
}
