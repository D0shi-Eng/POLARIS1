// التحقق من الإيصال عند نقطة الفرض.
//
// الترتيب هنا ليس ذوقًا: أعمّ الأسباب أولًا (إيصال ليس إيصالًا)، ثم أدقّها
// (تغيّر الهدف). سببٌ دقيق يُقال حين يكون صحيحًا فقط؛ ونسبة رفضٍ إلى السبب
// الخطأ عيب تشخيصي يكلّف ساعات لاحقًا.
//
// كل مسار في هذا الملف ينتهي برفض أو بقبول صريح. لا يوجد مسار «غالبًا صحيح».

import { W5ErrorCode, w4Error, type W4Error } from "../errors.js";
import type { ApprovalReceiptIssuer } from "./issuer.js";
import type { ApprovalRegistry } from "./registry.js";
import type { ApprovalExpectation, ApprovalReceipt, ApprovalTargetBinding } from "./types.js";

export type ReceiptVerification = { readonly ok: true } | { readonly ok: false; readonly error: W4Error };

function refuse(code: (typeof W5ErrorCode)[keyof typeof W5ErrorCode], display: string, detail: string): ReceiptVerification {
  return { ok: false, error: w4Error(code, "APPROVAL", display, detail) };
}

const DENIED = "This action was approved for something else, or the approval is no longer valid.";

function sameTarget(a: ApprovalTargetBinding, b: ApprovalTargetBinding): boolean {
  if (a.logical !== b.logical || a.host !== b.host) return false;
  if (a.identity === undefined && b.identity === undefined) return true;
  if (a.identity === undefined || b.identity === undefined) return false;
  return a.identity.volume === b.identity.volume && a.identity.file === b.identity.file;
}

function sameEffects(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export interface ReceiptVerificationRequest {
  readonly receipt: unknown;
  readonly expectation: ApprovalExpectation;
  readonly issuer: ApprovalReceiptIssuer;
  readonly registry: ApprovalRegistry;
  readonly at: Date;
}

function looksLikeReceipt(value: unknown): value is ApprovalReceipt {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r["contract_version"] === "1.0" &&
    typeof r["approval_id"] === "string" &&
    typeof r["mission_id"] === "string" &&
    typeof r["correlation_id"] === "string" &&
    typeof r["invocation_id"] === "string" &&
    typeof r["policy_decision_id"] === "string" &&
    typeof r["plan_hash"] === "string" &&
    typeof r["request_hash"] === "string" &&
    typeof r["approved_at"] === "string" &&
    typeof r["expires_at"] === "string" &&
    typeof r["issuer"] === "string" &&
    typeof r["issuer_binding"] === "string" &&
    r["single_use"] === true &&
    Array.isArray(r["effects"]) &&
    typeof r["canonical_target"] === "object" &&
    r["canonical_target"] !== null
  );
}

/**
 * يتحقق من إيصال دون أن يستهلكه. الاستهلاك خطوة منفصلة يملكها السجل، لأن
 * «صالح» و«مستعمل الآن» سؤالان مختلفان، ودمجهما يجعل الفحص التشخيصي استهلاكًا.
 */
export function verifyReceipt(request: ReceiptVerificationRequest): ReceiptVerification {
  const { receipt: raw, expectation, issuer, registry, at } = request;

  if (!looksLikeReceipt(raw)) {
    return refuse(W5ErrorCode.APPROVAL_RECEIPT_INVALID, DENIED, "the value presented is not an approval receipt");
  }
  const receipt = raw;

  // 1) هل أصدره المُصدِر الموثوق أصلًا. كل إيصال مزيّف يتوقف هنا.
  if (receipt.issuer !== issuer.id || !issuer.bindingIsValid(receipt)) {
    return refuse(
      W5ErrorCode.APPROVAL_RECEIPT_INVALID,
      DENIED,
      "the receipt does not carry a valid binding from the trusted approval issuer",
    );
  }

  // 2) هل هو منح أصلًا.
  if (receipt.decision !== "GRANTED") {
    return refuse(W5ErrorCode.APPROVAL_REJECTED, DENIED, `receipt records ${receipt.decision}`);
  }

  // 3) هل ما زال معروفًا للنظام، وبأي حالة.
  const state = registry.state(receipt.approval_id);
  if (state === undefined) {
    return refuse(
      W5ErrorCode.APPROVAL_RECEIPT_INVALID,
      DENIED,
      `approval ${receipt.approval_id} is not registered in this system`,
    );
  }
  if (state === "CONSUMED") {
    return refuse(W5ErrorCode.APPROVAL_REPLAYED, DENIED, "this approval was already used");
  }
  if (state === "REJECTED") return refuse(W5ErrorCode.APPROVAL_REJECTED, DENIED, "the approval was rejected");
  if (state === "EXPIRED") return refuse(W5ErrorCode.APPROVAL_EXPIRED, DENIED, "the approval expired");
  if (state === "INVALIDATED") {
    return refuse(W5ErrorCode.APPROVAL_RECEIPT_INVALID, DENIED, "the approval was invalidated");
  }
  if (state !== "GRANTED") {
    return refuse(W5ErrorCode.APPROVAL_REQUIRED, DENIED, `approval is ${state}, not GRANTED`);
  }

  // 4) الوقت. الانتهاء يعني لا أثر، لا «مرّت ثانية فقط».
  if (at.getTime() >= Date.parse(receipt.expires_at)) {
    return refuse(W5ErrorCode.APPROVAL_EXPIRED, DENIED, `receipt expired at ${receipt.expires_at}`);
  }

  // 5) الربط بالسياق. كل حقل على حدة، وبسببه هو.
  if (
    receipt.mission_id !== expectation.mission_id ||
    receipt.correlation_id !== expectation.correlation_id ||
    receipt.invocation_id !== expectation.invocation_id ||
    receipt.policy_decision_id !== expectation.policy_decision_id
  ) {
    return refuse(
      W5ErrorCode.APPROVAL_BINDING_MISMATCH,
      DENIED,
      "the receipt belongs to a different mission, invocation or decision",
    );
  }
  if (!sameEffects(receipt.effects, expectation.effects)) {
    return refuse(W5ErrorCode.APPROVAL_EFFECT_CHANGED, DENIED, "the effects changed after approval");
  }
  if (!sameTarget(receipt.canonical_target, expectation.canonical_target)) {
    return refuse(W5ErrorCode.APPROVAL_TARGET_CHANGED, DENIED, "the target changed after approval");
  }
  if (receipt.plan_hash !== expectation.plan_hash) {
    return refuse(W5ErrorCode.APPROVAL_PLAN_CHANGED, DENIED, "the plan changed after approval");
  }

  return { ok: true };
}
