// منسّق استيفاء التزام الموافقة.
//
// موقعه في السلسلة: بعد قرار السماح، وقبل الفرض. مسؤوليته الوحيدة أن يحوّل
// التزامًا إلى إيصال أو إلى رفض مُسمّى. لا يقرّر، ولا ينفّذ، ولا يحلّ مسارًا.
//
// وهو ليس الحارس الوحيد: نقطة الفرض تتحقق من الإيصال مرة ثانية بمصادرها هي.
// لو أُسقط هذا المنسّق من المسار كلّه، لبقي الأثر ممنوعًا. الدفاع في العمق
// هنا ليس شعارًا: الاختبار يستدعي نقطة الفرض مباشرة بلا منسّق ويثبت الرفض.

import { W5ErrorCode, failWith, succeed, w4Error, type Attempt } from "../errors.js";
import type { AuditEmitter } from "../audit/emitter.js";
import type { ConfigService } from "../config/service.js";
import { isEffectAction, type EffectAction } from "../effects.js";
import { nowTimestamp } from "../ids.js";
import type { GrantOperation } from "../pep/grant.js";
import { resolveGrantTarget } from "../pep/target-resolution.js";
import type { PathAuthority } from "../platform/path-authority.js";
import type { Doc } from "../policy/types.js";
import { argumentsDigest } from "./plan-hash.js";
import { buildApprovalRequest, hasExpired, type ApprovalRequestInput } from "./request.js";
import { ApprovalReceiptIssuer } from "./issuer.js";
import { ApprovalRegistry } from "./registry.js";
import type { TrustedApprovalSurface } from "./surface.js";
import type { ApprovalReceipt, ApprovalRequest, ApprovalTargetBinding, RiskClass, UntrustedContextBlock } from "./types.js";

function asRecord(value: unknown): Doc | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface ApprovalObligation {
  readonly approver: "END_USER" | "OPERATOR";
  readonly expires_in_seconds: number;
}

/** الحد الأدنى الافتراضي حين لا يحمل الالتزام مهلة. قصير عمدًا. */
const DEFAULT_EXPIRY_SECONDS = 120;

/**
 * يقرأ التزام الموافقة من قرار سياسة.
 * قرار الرفض لا يحمل التزام موافقة أصلًا — العقد يمنعه — ويُفحص هنا مع ذلك،
 * لأن نقطة الفرض لا تفترض صحة ما جاءها.
 */
export function approvalObligationOf(decision: Doc): ApprovalObligation | undefined {
  if (decision["result"] !== "ALLOW") return undefined;
  const obligation = asList(decision["obligations"])
    .map(asRecord)
    .find((o): o is Doc => o !== undefined && o["type"] === "REQUIRE_APPROVAL");
  if (obligation === undefined) return undefined;
  const approver = obligation["approver"] === "OPERATOR" ? "OPERATOR" : "END_USER";
  const expiry = obligation["expires_in_seconds"];
  return {
    approver,
    expires_in_seconds: typeof expiry === "number" && expiry > 0 ? expiry : DEFAULT_EXPIRY_SECONDS,
  };
}

export interface ApprovalCoordinatorDependencies {
  readonly surface: TrustedApprovalSurface;
  /** لحلّ الهدف الذي سيُعرض على الإنسان. الحلّ هنا مستقل عن حلّ نقطة الفرض. */
  readonly path_authority: PathAuthority;
  readonly config: ConfigService;
  readonly issuer?: ApprovalReceiptIssuer;
  readonly registry?: ApprovalRegistry;
  readonly audit: AuditEmitter;
  readonly core_actor_id: string;
  readonly now?: () => Date;
}

export interface ApprovalContext {
  readonly caller_identity: Doc;
  readonly agent_id: string;
  readonly capability_ref: { readonly capability_id: string; readonly capability_version: string };
  readonly resource: Doc;
}

export class ApprovalCoordinator {
  public readonly issuer: ApprovalReceiptIssuer;
  public readonly registry: ApprovalRegistry;

  readonly #surface: TrustedApprovalSurface;
  readonly #paths: PathAuthority;
  readonly #config: ConfigService;
  readonly #audit: AuditEmitter;
  readonly #actorId: string;
  readonly #now: () => Date;

  public constructor(dependencies: ApprovalCoordinatorDependencies) {
    this.#surface = dependencies.surface;
    this.#paths = dependencies.path_authority;
    this.#config = dependencies.config;
    this.issuer = dependencies.issuer ?? new ApprovalReceiptIssuer();
    this.registry = dependencies.registry ?? new ApprovalRegistry();
    this.#audit = dependencies.audit;
    this.#actorId = dependencies.core_actor_id;
    this.#now = dependencies.now ?? ((): Date => new Date());
  }

  public get surfaceId(): string {
    return this.#surface.id;
  }

  /**
   * يستوفي التزام موافقة على قرار سماح بعينه.
   *
   * كل ما يُعرض على الإنسان يُشتق هنا من مصادر موثوقة: الواصف يعطي الاسم
   * والخطورة، وسلطة المسارات تعطي الهدف الحقيقي وهويته، والقرار يعطي معرّفه
   * والتزامه. لا يمر نثر النموذج من هذا الطريق إطلاقًا؛ وإن أراد المستدعي أن
   * يعرض سياقًا غير موثوق، فهو يمرّره في حقله المُعلَّم وحده.
   */
  public async fulfil(input: {
    readonly invocation: Doc;
    readonly descriptor: Doc;
    readonly decision: Doc;
    readonly operation: GrantOperation;
    readonly obligation: ApprovalObligation;
    readonly context: ApprovalContext;
    readonly untrusted_context?: readonly UntrustedContextBlock[];
  }): Promise<Attempt<ApprovalReceipt>> {
    const { invocation, descriptor, decision, operation, obligation, context } = input;

    const resource = asRecord(invocation["resource"]);
    const locator = typeof resource?.["locator"] === "string" ? (resource["locator"] as string) : "";
    if (locator.length === 0) {
      return failWith(
        w4Error(
          W5ErrorCode.APPROVAL_RECEIPT_INVALID,
          "APPROVAL",
          "This action could not be described for approval.",
          "the invocation carries no resource locator, so no trusted target can be shown",
        ),
      );
    }

    const resolved = resolveGrantTarget({
      path_authority: this.#paths,
      config: this.#config,
      operation,
      locator,
    });
    if (!resolved.ok) return failWith(resolved.error);
    const canonical = resolved.value.canonical;
    const target: ApprovalTargetBinding =
      canonical.identity === undefined
        ? { logical: canonical.logical, host: canonical.host }
        : { logical: canonical.logical, host: canonical.host, identity: canonical.identity };

    const effects = asList(invocation["requested_effects"])
      .map(asRecord)
      .map((e) => e?.["action"])
      .filter((a): a is EffectAction => typeof a === "string" && isEffectAction(a));

    const risk = descriptor["risk_class"];
    const riskClass: RiskClass =
      risk === "LOW" || risk === "MEDIUM" || risk === "HIGH" || risk === "CRITICAL" ? risk : "CRITICAL";

    return this.obtain(
      {
        mission_id: String(invocation["mission_id"]),
        correlation_id: String(invocation["correlation_id"]),
        invocation_id: String(invocation["invocation_id"]),
        policy_decision_id: String(decision["decision_id"]),
        capability_id: String(invocation["capability_id"]),
        capability_version: String(invocation["capability_version"]),
        display_name: typeof descriptor["display_name"] === "string" ? (descriptor["display_name"] as string) : String(invocation["capability_id"]),
        operation,
        effects,
        risk_class: riskClass,
        arguments_digest: argumentsDigest((invocation["arguments"] ?? {}) as Doc),
        execution_constraints: (invocation["execution_constraints"] ?? {}) as Doc,
        target,
        approver: obligation.approver,
        expires_in_seconds: obligation.expires_in_seconds,
        ...(input.untrusted_context === undefined ? {} : { untrusted_context: input.untrusted_context }),
      },
      context,
    );
  }

  /**
   * يبني الطلب، ويعرضه، ويعيد إيصالًا عند المنح وحده.
   * كل مسار آخر — رفض، انتهاء، طلب فقد تسجيله — يعود بخطأ مُسمّى ولا إيصال معه.
   */
  public async obtain(
    input: Omit<ApprovalRequestInput, "now">,
    context: ApprovalContext,
  ): Promise<Attempt<ApprovalReceipt>> {
    const request = buildApprovalRequest({ ...input, now: this.#now });
    this.registry.register(request, nowTimestamp());

    this.#emit("APPROVAL_REQUIRED", request, context, "SUCCESS");
    this.#emit("APPROVAL_PRESENTED", request, context, "SUCCESS");

    const decision = await this.#surface.present(request);

    if (decision.kind === "REJECTED") {
      this.registry.settle(request.approval_id, "REJECTED", decision.at);
      this.#emit("APPROVAL_REJECTED", request, context, "DENIED", "The action was not approved.");
      return failWith(
        w4Error(W5ErrorCode.APPROVAL_REJECTED, "APPROVAL", "The action was not approved.", "the approver rejected it"),
      );
    }

    if (decision.kind === "EXPIRED") {
      this.registry.settle(request.approval_id, "EXPIRED", decision.at);
      this.#emit("APPROVAL_EXPIRED", request, context, "TIMEOUT", "The approval request expired.");
      return failWith(
        w4Error(
          W5ErrorCode.APPROVAL_EXPIRED,
          "APPROVAL",
          "The approval request expired and nothing was done.",
          `approval ${request.approval_id} expired at ${request.expires_at}`,
        ),
      );
    }

    // منح. تُفحص الصلاحية مرة أخرى هنا: قد يكون الفعل وقع بعد انقضاء المهلة.
    if (hasExpired(request, this.#now())) {
      this.registry.settle(request.approval_id, "EXPIRED", nowTimestamp());
      this.#emit("APPROVAL_EXPIRED", request, context, "TIMEOUT", "The approval request expired.");
      return failWith(
        w4Error(
          W5ErrorCode.APPROVAL_EXPIRED,
          "APPROVAL",
          "The approval request expired and nothing was done.",
          "the approval arrived after the request had already expired",
        ),
      );
    }

    this.registry.settle(request.approval_id, "GRANTED", decision.at);
    const receipt = this.issuer.issue(request, decision.at);
    this.#emit("APPROVAL_GRANTED", request, context, "SUCCESS");
    return succeed(receipt);
  }

  #emit(
    eventType:
      | "APPROVAL_REQUIRED"
      | "APPROVAL_PRESENTED"
      | "APPROVAL_GRANTED"
      | "APPROVAL_REJECTED"
      | "APPROVAL_EXPIRED",
    request: ApprovalRequest,
    context: ApprovalContext,
    status: "SUCCESS" | "DENIED" | "TIMEOUT",
    display?: string,
  ): void {
    this.#audit.emit({
      event_type: eventType,
      correlation_id: request.correlation_id,
      causation_id: request.policy_decision_id,
      caller_identity: context.caller_identity,
      actor: { kind: "CORE", id: this.#actorId },
      mission_id: request.mission_id,
      agent_id: context.agent_id,
      capability_ref: context.capability_ref,
      invocation_id: request.invocation_id,
      decision_id: request.policy_decision_id,
      resource: context.resource,
      status,
      ...(display === undefined
        ? {}
        : {
            error: {
              code: "POLICY_DENIED" as const,
              display_message: display,
              internal_detail: `${eventType}: approval ${request.approval_id}`,
              retryable: false,
            },
          }),
      metadata: {
        approval_id: request.approval_id,
        plan_hash: request.plan_hash,
        risk_class: request.risk_class,
        approver: request.approver,
        expires_at: request.expires_at,
        surface: this.#surface.id,
      },
    });
  }
}
