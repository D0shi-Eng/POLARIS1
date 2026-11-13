// بوابة القدرات.
//
// مسؤوليتها الوحيدة: تحويل اقتراح غير موثوق إلى استدعاء مُعرَّف الهوية والسببية،
// والتحقق من أنه لا يوسّع ما أعلنه الواصف، ثم استشارة PDP، ثم تسليم قرار السماح
// إلى نقطة الفرض الصحيحة، ثم إعادة نتيجة منظّمة.
//
// ما ليست هي: ليست PDP، وليست تنفيذ الأداة، وليست الوكيل.
// الثابت المطلق: لا يوجد مسار تنفيذ يتجاوز هذه البوابة ثم نقطة الفرض.

import { checkInvariants, validateContract, type ContractError } from "@polaris/contracts";

import { idempotencyKey, newId, nowTimestamp, sha256 } from "../ids.js";
import { W4ErrorCode, W5ErrorCode, w4Error, type W4Error } from "../errors.js";
import { NETWORK_ACTIONS, isEffectAction, type EffectAction } from "../effects.js";
import type { AuditEmitter } from "../audit/emitter.js";
import { approvalObligationOf, type ApprovalCoordinator } from "../approval/coordinator.js";
import type { ApprovalReceipt } from "../approval/types.js";
import type { ConfigService } from "../config/service.js";
import type { ExecutionAdmission } from "../control/admission.js";
import { explain, type TrustTier } from "../policy/explain.js";
import type { LocalPdp } from "../policy/pdp.js";
import { POLICY_EPOCH, POLICY_SET_VERSION, type Doc } from "../policy/types.js";
import type { FilesystemPep } from "../pep/filesystem-pep.js";
import { mergeTaint, type TaintLabel } from "../trust/taint.js";
import {
  executionRequirements,
  findCapability,
  capabilityIds,
  materializeDescriptor,
  resourceRef,
  type CapabilityTemplate,
} from "./catalog.js";
import type {
  CapabilityGatewayPort,
  CapabilityProposal,
  GatewayCallContext,
  GatewayOutcome,
  ToolResult,
} from "./types.js";

export interface GatewayDependencies {
  readonly pdp: LocalPdp;
  readonly filesystem_pep: FilesystemPep;
  readonly audit: AuditEmitter;
  readonly config: ConfigService;
  /** معرّف مكوّن النواة الذي ينفّذ، لأحداث التدقيق. */
  readonly core_actor_id: string;
  /**
   * منسّق الموافقة. غيابه لا يفتح مسارًا: نقطة الفرض تظل ترفض أي قرار يحمل
   * التزام موافقة غير مستوفى، فغياب المنسّق يعني رفضًا لا تجاوزًا.
   */
  readonly approval?: ApprovalCoordinator;
  readonly admission?: ExecutionAdmission;
}

function contractError(code: ContractError["code"], display: string, detail: string): ContractError {
  return { code, display_message: display, internal_detail: detail, retryable: false };
}

export class CapabilityGateway implements CapabilityGatewayPort {
  readonly #pdp: LocalPdp;
  readonly #pep: FilesystemPep;
  readonly #audit: AuditEmitter;
  readonly #config: ConfigService;
  readonly #actorId: string;
  readonly #approval: ApprovalCoordinator | undefined;
  readonly #admission: ExecutionAdmission | undefined;

  public constructor(dependencies: GatewayDependencies) {
    this.#pdp = dependencies.pdp;
    this.#pep = dependencies.filesystem_pep;
    this.#audit = dependencies.audit;
    this.#config = dependencies.config;
    this.#actorId = dependencies.core_actor_id;
    this.#approval = dependencies.approval;
    this.#admission = dependencies.admission;
  }

  public availableCapabilities(): readonly string[] {
    return capabilityIds();
  }

  public effectsOf(capabilityId: string): readonly EffectAction[] | undefined {
    return findCapability(capabilityId)?.effects;
  }

  public async invoke(proposal: CapabilityProposal, context: GatewayCallContext): Promise<GatewayOutcome> {
    // 0) القبول. الإيقاف يغلق الباب قبل أن يُقرأ الاقتراح، لا بعد أن يُقيَّم.
    const admitted = this.#admission?.admit("INVOCATION");
    if (admitted !== undefined && !admitted.ok) return { ok: false, error: admitted.error };

    // اقتراح النموذج يُسجَّل بوصفه اقتراحًا: ما طلبه، قبل أن يصير استدعاءً.
    // تمييزه عن INVOCATION_REQUESTED مقصود — الأول غير موثوق، والثاني مُتحقَّق منه.
    this.#audit.emit({
      event_type: "CAPABILITY_PROPOSED",
      correlation_id: context.correlation_id,
      causation_id: proposal.causation_id,
      caller_identity: context.caller_identity,
      actor: { kind: "AGENT", id: context.agent_id },
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      status: "SUCCESS",
      metadata: {
        proposed_capability: proposal.capability_id,
        taint_labels: [...proposal.taint_labels].join(","),
        argument_names: Object.keys(proposal.arguments).sort().join(","),
      },
    });

    // 1) حلّ القدرة. قدرة غير موجودة تتوقف هنا ولا تصل إلى السياسة.
    const template = findCapability(proposal.capability_id);
    if (template === undefined) {
      return this.#reject(
        context,
        w4Error(
          W4ErrorCode.CAPABILITY_NOT_FOUND,
          "GATEWAY",
          "That capability does not exist.",
          `unknown capability ${proposal.capability_id}`,
        ),
      );
    }

    // 2) الوسيطات. مجموعة مغلقة: وسيطة غير معلنة ترفض الاقتراح كله.
    const argumentCheck = this.#checkArguments(template, proposal.arguments);
    if (argumentCheck !== undefined) return this.#reject(context, argumentCheck);

    const path = String(proposal.arguments["path"]);
    const payload = template.operation === "WRITE_FILE" ? String(proposal.arguments["content"]) : undefined;

    // 3) بناء الاستدعاء. الهوية والسببية والارتباط تُنقل كما هي، لا تُعاد صياغتها.
    const descriptor = materializeDescriptor(template, path);
    const invocation = this.#buildInvocation(template, proposal, context, path, payload);

    const structural = validateContract("CapabilityInvocationV1", invocation);
    if (!structural.ok) {
      return this.#reject(
        context,
        w4Error(
          W4ErrorCode.EFFECT_MISMATCH,
          "GATEWAY",
          "The request could not be formed.",
          `invocation failed its contract: ${structural.errors.map((e) => e.internal_detail ?? e.display_message).join("; ")}`,
        ),
      );
    }

    // 4) الثوابت العابرة للعقود. INV-002 هو رفض التوسيع، و INV-006 هو بوابة النموذج.
    const invariants = checkInvariants({ descriptor, invocation });
    const breaches = invariants.flatMap((i) => i.violations);
    if (breaches.length > 0) {
      const isEffectBreach = breaches.some((b) => (b.internal_detail ?? "").startsWith("INV-002"));
      return this.#reject(
        context,
        w4Error(
          isEffectBreach ? W4ErrorCode.EFFECT_MISMATCH : W4ErrorCode.MODEL_CONTRACT_VIOLATION,
          "GATEWAY",
          "The request exercised a privilege the capability never declared.",
          breaches.map((b) => b.internal_detail ?? b.display_message).join("; "),
        ),
        invocation,
      );
    }

    this.#audit.emit({
      event_type: "INVOCATION_REQUESTED",
      correlation_id: context.correlation_id,
      causation_id: proposal.causation_id,
      caller_identity: context.caller_identity,
      actor: { kind: "AGENT", id: context.agent_id },
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      capability_ref: { capability_id: template.capability_id, capability_version: template.capability_version },
      invocation_id: String(invocation["invocation_id"]),
      resource: resourceRef(path),
      status: "SUCCESS",
    });

    // 5) القرار.
    const outcome = this.#pdp.decide({ invocation, descriptor });
    const tier = this.#tierOf(context.caller_identity);
    const explanation = explain(outcome.decision, outcome.verdicts, tier, this.#config);

    this.#audit.emit({
      event_type: "POLICY_EVALUATED",
      correlation_id: context.correlation_id,
      causation_id: String(invocation["invocation_id"]),
      caller_identity: context.caller_identity,
      actor: { kind: "CORE", id: this.#actorId },
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      capability_ref: { capability_id: template.capability_id, capability_version: template.capability_version },
      invocation_id: String(invocation["invocation_id"]),
      decision_id: String(outcome.decision["decision_id"]),
      resource: resourceRef(path),
      policy_ref: outcome.decision["policy_ref"] as Doc,
      status: outcome.decision["result"] === "ALLOW" ? "SUCCESS" : "DENIED",
      ...(outcome.decision["result"] === "ALLOW"
        ? {}
        : {
            error: contractError(
              "POLICY_DENIED",
              String(outcome.decision["display_reason"]),
              `reasons: ${(outcome.decision["reason_codes"] as string[]).join(", ")}`,
            ),
          }),
    });

    if (outcome.decision["result"] !== "ALLOW") {
      const reasons = (outcome.decision["reason_codes"] as string[]).join(", ");
      return {
        ok: false,
        error: w4Error(
          reasons.includes("TAINTED_INPUT")
            ? W4ErrorCode.TAINT_NOT_DECLASSIFIED
            : reasons.includes("NETWORK_NOT_BROKERED")
              ? W4ErrorCode.NETWORK_EFFECT_UNAVAILABLE
              : reasons.includes("RESOURCE_OUT_OF_SCOPE")
                ? W4ErrorCode.FILESYSTEM_SCOPE_DENIED
                : W4ErrorCode.POLICY_DENIED,
          "PDP",
          String(outcome.decision["display_reason"]),
          `policy denied: ${reasons}`,
        ),
        invocation,
        decision: outcome.decision,
        explanation,
      };
    }

    // 6) الفرض. أثر شبكي لا يصل هنا أصلًا، ومع ذلك يُغلق المسار صراحة.
    const actions = (invocation["requested_effects"] as Doc[])
      .map((e) => e["action"])
      .filter((a): a is string => typeof a === "string");
    if (actions.some((action) => isEffectAction(action) && NETWORK_ACTIONS.has(action))) {
      return {
        ok: false,
        error: w4Error(
          W4ErrorCode.NETWORK_EFFECT_UNAVAILABLE,
          "GATEWAY",
          "Network actions are not available.",
          "no egress enforcement point is registered in W4",
        ),
        invocation,
        decision: outcome.decision,
        explanation,
      };
    }

    // 5.5) استيفاء التزام الموافقة، إن حمله القرار.
    //
    // نقطة الفرض تتحقق من الإيصال مرة أخرى بمصادرها هي. ما يفعله هذا الموضع
    // هو الحصول عليه فقط. إسقاط هذه الخطوة لا يفتح مسارًا: نقطة الفرض ترفض.
    let receipt: ApprovalReceipt | undefined;
    const obligation = approvalObligationOf(outcome.decision);
    if (obligation !== undefined) {
      if (this.#approval === undefined) {
        return {
          ok: false,
          error: w4Error(
            W5ErrorCode.APPROVAL_REQUIRED,
            "APPROVAL",
            "This action needs approval, and no approval surface is available.",
            "the decision carries a REQUIRE_APPROVAL obligation and no approval coordinator is composed",
          ),
          invocation,
          decision: outcome.decision,
          explanation,
        };
      }
      const fulfilled = await this.#approval.fulfil({
        invocation,
        descriptor,
        decision: outcome.decision,
        operation: template.operation,
        obligation,
        context: {
          caller_identity: context.caller_identity,
          agent_id: context.agent_id,
          capability_ref: {
            capability_id: template.capability_id,
            capability_version: template.capability_version,
          },
          resource: resourceRef(path),
        },
      });
      if (!fulfilled.ok) {
        return { ok: false, error: fulfilled.error, invocation, decision: outcome.decision, explanation };
      }
      receipt = fulfilled.value;
    }

    const started = Date.now();
    this.#audit.emit({
      event_type: "EXECUTION_STARTED",
      correlation_id: context.correlation_id,
      causation_id: String(outcome.decision["decision_id"]),
      caller_identity: context.caller_identity,
      actor: { kind: "CORE", id: this.#actorId },
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      capability_ref: { capability_id: template.capability_id, capability_version: template.capability_version },
      invocation_id: String(invocation["invocation_id"]),
      decision_id: String(outcome.decision["decision_id"]),
      resource: resourceRef(path),
      status: "SUCCESS",
    });

    const enforced = await this.#pep.enforce({
      invocation,
      descriptor,
      decision: outcome.decision,
      operation: template.operation,
      ...(payload === undefined ? {} : { payload }),
      allowOverwrite: proposal.arguments["overwrite"] === true,
      ...(receipt === undefined ? {} : { approvalReceipt: receipt }),
      callerIdentity: context.caller_identity,
      missionId: context.mission_id,
      agentId: context.agent_id,
    });

    this.#audit.emit({
      event_type: "EXECUTION_COMPLETED",
      correlation_id: context.correlation_id,
      causation_id: String(outcome.decision["decision_id"]),
      caller_identity: context.caller_identity,
      actor: { kind: "CORE", id: this.#actorId },
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      capability_ref: { capability_id: template.capability_id, capability_version: template.capability_version },
      invocation_id: String(invocation["invocation_id"]),
      decision_id: String(outcome.decision["decision_id"]),
      resource: resourceRef(path),
      duration_ms: Date.now() - started,
      status: enforced.ok ? "SUCCESS" : "FAILED",
      ...(enforced.ok
        ? {}
        : { error: contractError("INTERNAL_ERROR", enforced.error.display_message, enforced.error.internal_detail) }),
      // ربط النتيجة بالمنحة التي أنتجتها. إثبات الإنجاز يقرأ من هنا، فلا يحتاج
      // أن يصدّق ادعاءً ولا أن يعيد اشتقاق النسبة من مسار.
      ...(enforced.ok
        ? {
            metadata: {
              grant_id: enforced.value.grant.grant_id,
              operation: enforced.value.grant.operation,
              bytes: String(enforced.value.outcome.bytes),
              ...(enforced.value.outcome.content_sha256 === undefined
                ? {}
                : { content_sha256: enforced.value.outcome.content_sha256 }),
              ...(enforced.value.outcome.wrote === undefined ? {} : { wrote: enforced.value.outcome.wrote }),
              ...(receipt === undefined ? {} : { approval_id: receipt.approval_id }),
            },
          }
        : {}),
    });

    if (!enforced.ok) {
      return { ok: false, error: enforced.error, invocation, decision: outcome.decision, explanation };
    }

    const content =
      enforced.value.outcome.content_base64 === undefined
        ? undefined
        : Buffer.from(enforced.value.outcome.content_base64, "base64").toString("utf8");

    // 7) النتيجة. التلوث ينتقل إلى الأمام: نتيجة أداة لا تصبح موثوقة بمجرد أنها نتيجة.
    const resultTaint: readonly TaintLabel[] = mergeTaint(proposal.taint_labels, ["UNTRUSTED_FILE"]);

    const result: ToolResult = {
      capability_id: template.capability_id,
      invocation_id: String(invocation["invocation_id"]),
      resource_logical: enforced.value.canonical.logical,
      bytes: enforced.value.outcome.bytes,
      truncated: enforced.value.outcome.truncated,
      ...(content === undefined ? {} : { content }),
      ...(enforced.value.outcome.content_sha256 === undefined
        ? {}
        : { content_sha256: enforced.value.outcome.content_sha256 }),
      ...(enforced.value.outcome.wrote === undefined ? {} : { wrote: enforced.value.outcome.wrote }),
      resource_authorization: "AUTHORIZED",
      content_trust: "UNTRUSTED",
      taint_labels: resultTaint,
      execution_host_id: enforced.value.host_id,
      windows_confinement: enforced.value.windows_confinement,
      enforcement_checks: enforced.value.checks,
    };

    return { ok: true, invocation, decision: outcome.decision, explanation, result };
  }

  #checkArguments(template: CapabilityTemplate, args: Readonly<Record<string, unknown>>): W4Error | undefined {
    const allowed = new Set(template.allowed_arguments);
    for (const key of Object.keys(args)) {
      if (!allowed.has(key)) {
        return w4Error(
          W4ErrorCode.EFFECT_MISMATCH,
          "GATEWAY",
          "The request carried an argument this capability does not accept.",
          `argument "${key}" is not declared by ${template.capability_id}`,
        );
      }
    }
    for (const key of template.required_arguments) {
      if (typeof args[key] !== "string") {
        return w4Error(
          W4ErrorCode.EFFECT_MISMATCH,
          "GATEWAY",
          "The request is missing a required argument.",
          `argument "${key}" is absent or is not a string`,
        );
      }
    }
    return undefined;
  }

  #buildInvocation(
    template: CapabilityTemplate,
    proposal: CapabilityProposal,
    context: GatewayCallContext,
    path: string,
    payload: string | undefined,
  ): Doc {
    const resource = resourceRef(path);
    // المحتوى لا يوضع في الاستدعاء: يُنقل بصمته وحجمه فقط، ويمر النص نفسه
    // إلى نقطة الفرض خارج المستند حتى لا يتسرب إلى السجلات.
    const args: Doc = { path, encoding: "utf-8" };
    if (payload !== undefined) {
      args["content_sha256"] = sha256(payload);
      args["content_bytes"] = Buffer.byteLength(payload, "utf8");
      if (proposal.arguments["overwrite"] === true) args["overwrite"] = true;
    }

    return {
      contract_version: "1.0",
      invocation_id: newId(),
      correlation_id: context.correlation_id,
      causation_id: proposal.causation_id,
      idempotency_key: idempotencyKey(template.capability_id, sha256(JSON.stringify(args))),
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      caller_identity: context.caller_identity,
      capability_id: template.capability_id,
      capability_version: template.capability_version,
      requested_effects: template.effects.map((action) => ({
        action,
        resource: { ...resource },
        data_classification: "INTERNAL",
      })),
      resource,
      arguments: args,
      taint_labels: [...proposal.taint_labels],
      provenance_refs: proposal.provenance_refs.map((p) => ({ ...p })),
      attempt: context.attempt,
      execution_constraints: executionRequirements(template, path),
      policy_ref: { policy_version: POLICY_SET_VERSION, policy_epoch: POLICY_EPOCH },
      created_at: nowTimestamp(),
    };
  }

  #tierOf(caller: Doc): TrustTier {
    const tier = caller["trust_tier"];
    return tier === "TIER_0_TRUSTED" || tier === "TIER_1_LIMITED" ? tier : "TIER_2_UNTRUSTED";
  }

  #reject(context: GatewayCallContext, error: W4Error, invocation?: Doc): GatewayOutcome {
    this.#audit.emit({
      event_type: "CONTRACT_VIOLATION_DETECTED",
      correlation_id: context.correlation_id,
      caller_identity: context.caller_identity,
      actor: { kind: "CORE", id: this.#actorId },
      mission_id: context.mission_id,
      agent_id: context.agent_id,
      status: "FAILED",
      error: contractError("CONTRACT_VIOLATION", error.display_message, `${error.code}: ${error.internal_detail}`),
    });
    return invocation === undefined ? { ok: false, error } : { ok: false, error, invocation };
  }
}
