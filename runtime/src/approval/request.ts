// بناء طلب الموافقة من حقول موثوقة وحدها.
//
// القاعدة التي يفرضها هذا الملف بالبناء لا بالتوثيق: لا يوجد في توقيع الدالة
// مدخل يقبل نصًا من النموذج ليصير ملخّصًا. السياق غير الموثوق — إن وُجد —
// يدخل في حقل منفصل مُعلَّم، ولا يُشتق منه أي حقل من حقول الملخّص.

import { canonicalize, sha256Hex } from "@polaris/contracts";

import type { EffectAction } from "../effects.js";
import { newId, nowTimestamp } from "../ids.js";
import type { GrantOperation } from "../pep/grant.js";
import type { Doc } from "../policy/types.js";
import { planHash, type PlanShape } from "./plan-hash.js";
import type {
  ApprovalRequest,
  ApprovalTargetBinding,
  RiskClass,
  TrustedActionSummary,
  UntrustedContextBlock,
} from "./types.js";

export interface ApprovalRequestInput {
  readonly mission_id: string;
  readonly correlation_id: string;
  readonly invocation_id: string;
  readonly policy_decision_id: string;
  readonly capability_id: string;
  readonly capability_version: string;
  readonly display_name: string;
  readonly operation: GrantOperation;
  readonly effects: readonly EffectAction[];
  readonly risk_class: RiskClass;
  readonly arguments_digest: string;
  readonly execution_constraints: Doc;
  readonly target: ApprovalTargetBinding;
  readonly approver: "END_USER" | "OPERATOR";
  readonly expires_in_seconds: number;
  /** سياق غير موثوق للعرض بجوار الملخّص. اختياري، وافتراضه لا شيء. */
  readonly untrusted_context?: readonly UntrustedContextBlock[];
  readonly now?: () => Date;
}

/** جملة الأثر. مبنية من الحقول الموثوقة، ولا تقبل نصًا جاهزًا من أي مصدر. */
function consequenceOf(operation: GrantOperation, target: ApprovalTargetBinding, exists: boolean): string {
  if (operation === "READ_FILE") return `POLARIS will read the contents of ${target.logical}.`;
  return exists
    ? `POLARIS will replace the existing contents of ${target.logical}.`
    : `POLARIS will create ${target.logical} and write to it.`;
}

export function buildApprovalRequest(input: ApprovalRequestInput): ApprovalRequest {
  const now = (input.now ?? ((): Date => new Date()))();
  const issuedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const expiresAt = new Date(now.getTime() + input.expires_in_seconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  const plan: PlanShape = {
    capability_id: input.capability_id,
    capability_version: input.capability_version,
    operation: input.operation,
    effects: input.effects,
    arguments_digest: input.arguments_digest,
    target: input.target,
    execution_constraints: input.execution_constraints,
  };

  const summary: TrustedActionSummary = {
    capability_id: input.capability_id,
    capability_version: input.capability_version,
    display_name: input.display_name,
    operation: input.operation,
    effects: [...input.effects],
    target_logical: input.target.logical,
    risk_class: input.risk_class,
    consequence: consequenceOf(input.operation, input.target, input.target.identity !== undefined),
  };

  return {
    contract_version: "1.0",
    approval_id: newId(),
    mission_id: input.mission_id,
    correlation_id: input.correlation_id,
    invocation_id: input.invocation_id,
    policy_decision_id: input.policy_decision_id,
    effects: [...input.effects],
    canonical_target: input.target,
    plan_hash: planHash(plan),
    risk_class: input.risk_class,
    reason: `Policy allows this action but requires ${input.approver === "OPERATOR" ? "an operator" : "your"} approval before it runs.`,
    summary,
    untrusted_context: [...(input.untrusted_context ?? [])],
    approver: input.approver,
    issued_at: issuedAt,
    expires_at: expiresAt,
    single_use: true,
  };
}

/** بصمة نصّ الطلب. يربط الإيصال بما عُرض فعلًا، لا بمعرّف الطلب وحده. */
export function requestHash(request: ApprovalRequest): string {
  return sha256Hex(canonicalize(request as unknown as Record<string, unknown>));
}

/** هل انتهت صلاحية الطلب عند لحظة بعينها. */
export function hasExpired(request: ApprovalRequest, at: Date): boolean {
  return at.getTime() >= Date.parse(request.expires_at);
}

export { nowTimestamp };
