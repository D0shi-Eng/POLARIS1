// محوّل Cedar. مسؤوليته الوحيدة: تحويل طلب مُعدّ مسبقًا إلى حكم، وعدم رمي استثناء أبدًا.
// أي فشل — تحليل، تقييم، استثناء — يخرج كـ deny مع أسباب، لا كنجاح صامت.

import cedar from "@cedar-policy/cedar-wasm/nodejs";

import { CEDAR_POLICIES } from "./policy-set.js";
import type { CedarContext } from "./context.js";

export interface EngineVerdict {
  readonly decision: "allow" | "deny";
  readonly matched_policy_ids: readonly string[];
  readonly errors: readonly string[];
}

interface CedarResponse {
  type?: string;
  response?: {
    decision?: string;
    diagnostics?: { reason?: string[]; errors?: Array<{ policyId?: string; error?: { message?: string } }> };
  };
  errors?: Array<{ message?: string }>;
}

/** أسماء الكيانات ثابتة ومحصورة، فلا يستطيع مُدخل خارجي اختراع نوع كيان جديد. */
const PRINCIPAL_TYPE = "Polaris::Principal";
const ACTION_TYPE = "Polaris::Action";
const RESOURCE_TYPE = "Polaris::Resource";

export function evaluate(
  principalId: string,
  action: string,
  resourceId: string,
  context: CedarContext,
): EngineVerdict {
  try {
    const raw = cedar.isAuthorized({
      principal: { type: PRINCIPAL_TYPE, id: principalId },
      action: { type: ACTION_TYPE, id: action },
      resource: { type: RESOURCE_TYPE, id: resourceId },
      context: { ...context },
      policies: { staticPolicies: { ...CEDAR_POLICIES } },
      entities: [],
    } as never) as CedarResponse;

    if (raw.type !== "success" || raw.response === undefined) {
      return {
        decision: "deny",
        matched_policy_ids: [],
        errors: (raw.errors ?? []).map((e) => e.message ?? "cedar failure").slice(0, 8),
      };
    }

    const diagnostics = raw.response.diagnostics ?? {};
    const evaluationErrors = (diagnostics.errors ?? []).map(
      (e) => `${e.policyId ?? "?"}: ${e.error?.message ?? "evaluation error"}`,
    );

    // خطأ تقييم في أي سياسة يعني أننا لا نعرف الإجابة. لا نعرف = رفض.
    if (evaluationErrors.length > 0) {
      return { decision: "deny", matched_policy_ids: diagnostics.reason ?? [], errors: evaluationErrors };
    }

    return {
      decision: raw.response.decision === "allow" ? "allow" : "deny",
      matched_policy_ids: diagnostics.reason ?? [],
      errors: [],
    };
  } catch (error) {
    return {
      decision: "deny",
      matched_policy_ids: [],
      errors: [`engine exception: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/** يتحقق مرة واحدة عند الإقلاع من أن نص السياسات يُحلّل فعلًا. */
export function policySetParses(): { ok: boolean; detail: string } {
  try {
    const result = cedar.checkParsePolicySet({ staticPolicies: { ...CEDAR_POLICIES } } as never) as {
      type?: string;
      errors?: Array<{ message?: string }>;
    };
    return result.type === "success"
      ? { ok: true, detail: "policy set parses" }
      : { ok: false, detail: (result.errors ?? []).map((e) => e.message ?? "?").join("; ") };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
