// أساس "لماذا رُفض". هدفه أن يكون التفسير قابلًا للقراءة آليًا وبشريًا،
// وأن يكون الفصل بين ما يُعرض وما لا يُعرض قرارًا صريحًا في مكان واحد.
//
// القاعدة: TIER_2_UNTRUSTED لا يرى تفصيلًا داخليًا مهما كان الإعداد.
// TIER_1_LIMITED يراه فقط إذا سمح إعداد صريح. TIER_0_TRUSTED يراه دائمًا.

import type { ConfigService } from "../config/service.js";
import { policyFor, POLICIES } from "./policy-set.js";
import type { Doc, EffectVerdict } from "./types.js";

export type TrustTier = "TIER_0_TRUSTED" | "TIER_1_LIMITED" | "TIER_2_UNTRUSTED";

export interface EffectExplanation {
  readonly effect_index: number;
  readonly action: string;
  readonly decision: "allow" | "deny";
  readonly policy_ids: readonly string[];
  readonly cedar_policy_ids: readonly string[];
  readonly evaluation_errors: readonly string[];
}

export interface DenialExplanation {
  readonly result: string;
  readonly decision_id: string;
  readonly correlation_id: string;
  readonly policy_set_version: string;
  readonly policy_epoch: number;
  readonly reason_codes: readonly string[];
  readonly display_reason: string;
  /** موجود فقط عندما تسمح طبقة الثقة والإعداد بذلك. غيابه ليس خطأً. */
  readonly internal_reason?: string;
  readonly effects: readonly EffectExplanation[];
  readonly obligations: readonly string[];
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function maySeeInternal(tier: TrustTier, config: ConfigService): boolean {
  if (tier === "TIER_0_TRUSTED") return true;
  if (tier === "TIER_2_UNTRUSTED") return false;
  return config.get("polaris.diagnostics.expose_internal_reason") === true;
}

/** يبني تفسيرًا لمستدعٍ بطبقة ثقة محددة. نفس القرار يعطي تفسيرين مختلفين لطبقتين مختلفتين. */
export function explain(
  decision: Doc,
  verdicts: readonly EffectVerdict[],
  tier: TrustTier,
  config: ConfigService,
): DenialExplanation {
  const policyRef = (decision["policy_ref"] ?? {}) as Doc;

  const base: DenialExplanation = {
    result: String(decision["result"]),
    decision_id: String(decision["decision_id"]),
    correlation_id: String(decision["correlation_id"]),
    policy_set_version: String(policyRef["policy_version"] ?? "unknown"),
    policy_epoch: Number(policyRef["policy_epoch"] ?? -1),
    reason_codes: asList(decision["reason_codes"]).map(String),
    display_reason: String(decision["display_reason"]),
    effects: verdicts.map((v) => ({
      effect_index: v.effect_index,
      action: v.action,
      decision: v.decision,
      policy_ids: [...new Set(v.matched_policy_ids.map((id) => policyFor(id)?.policy_id ?? id))],
      cedar_policy_ids: v.matched_policy_ids,
      evaluation_errors: v.evaluation_errors,
    })),
    obligations: asList(decision["obligations"]).map((o) => String((o as Doc)["type"])),
  };

  if (!maySeeInternal(tier, config)) return base;
  const internal = decision["internal_reason"];
  return typeof internal === "string" ? { ...base, internal_reason: internal } : base;
}

/** عرض نصّي للمطوّر. لا واجهة رسومية في W3، والنص كافٍ لإثبات الأساس. */
export function renderExplanation(explanation: DenialExplanation): string {
  const lines: string[] = [
    `${explanation.result}  decision=${explanation.decision_id}`,
    `policy set ${explanation.policy_set_version} epoch ${String(explanation.policy_epoch)}`,
    `reasons: ${explanation.reason_codes.join(", ")}`,
    `shown to caller: ${explanation.display_reason}`,
  ];
  for (const effect of explanation.effects) {
    const matched = effect.policy_ids.length > 0 ? effect.policy_ids.join(", ") : "no matching policy (default deny)";
    lines.push(`  [${String(effect.effect_index)}] ${effect.action} -> ${effect.decision} via ${matched}`);
    for (const error of effect.evaluation_errors) lines.push(`      evaluation error: ${error}`);
  }
  if (explanation.obligations.length > 0) lines.push(`obligations: ${explanation.obligations.join(", ")}`);
  if (explanation.internal_reason !== undefined) lines.push(`internal: ${explanation.internal_reason}`);
  return lines.join("\n");
}

/** قائمة السياسات الفعّالة، لعرضها في أدوات المطوّر. */
export function describePolicies(): string {
  return POLICIES.map((p) => `${p.policy_id}  ${p.title}\n    ${p.rationale}`).join("\n");
}
