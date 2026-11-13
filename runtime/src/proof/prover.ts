// المُثبِت.
//
// ترتيب الفحص ليس ذوقًا: السلسلة أولًا، لأن كل ما بعدها يُقرأ منها. سلسلة
// مكسورة تُبطل الإثبات مهما قال نظام الملفات — الدليل الذي لا يُسند لا يُثبِت.
//
// ثم الهدف، ثم النسبة، ثم المطابقة. كل مسار فشل له رمز سبب، ولا يوجد مسار
// يعيد PROVEN دون أن يكون كل شرط قد تحقق فعلًا.
//
// ما لا يقبله هذا الملف مدخلًا: قول النموذج. لا يوجد في التوقيع مكان له.

import { W5ErrorCode } from "../errors.js";
import type { AuditEmitter } from "../audit/emitter.js";
import { verifyChain } from "../audit/ledger/verify.js";
import type { ConfigService } from "../config/service.js";
import { newId, nowTimestamp } from "../ids.js";
import { resolveGrantTarget } from "../pep/target-resolution.js";
import type { PathAuthority } from "../platform/path-authority.js";
import type { Doc } from "../policy/types.js";
import { foldWindowsPath, parseWindowsPath } from "../platform/windows-path-rules.js";
import type { ConfinedObserver } from "./observer.js";
import type {
  CompletionEvidence,
  CompletionProof,
  CompletionProofStatus,
  CompletionRequirement,
  ObservedTarget,
} from "./types.js";

export interface CompletionProverDependencies {
  readonly path_authority: PathAuthority;
  readonly config: ConfigService;
  readonly audit: AuditEmitter;
  /** الرصد المحصور. غيابه يجعل مطابقة البصمة غير متاحة، ويُقال ذلك في الدليل. */
  readonly observer?: ConfinedObserver;
  readonly core_actor_id: string;
}

export interface ProveRequest {
  readonly requirement: CompletionRequirement;
  readonly correlation_id: string;
  readonly caller_identity: Doc;
}

function sameLocator(a: string, b: string): boolean {
  const left = parseWindowsPath(a);
  const right = parseWindowsPath(b);
  if (!left.ok || !right.ok) return a === b;
  return foldWindowsPath(left.parts.normalised) === foldWindowsPath(right.parts.normalised);
}

function metadataOf(event: Doc): Readonly<Record<string, string>> {
  const raw = event["metadata"];
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, string>)
    : {};
}

function locatorOf(event: Doc): string {
  const resource = event["resource"];
  if (typeof resource !== "object" || resource === null) return "";
  const locator = (resource as Record<string, unknown>)["locator"];
  return typeof locator === "string" ? locator : "";
}

export class CompletionProver {
  readonly #paths: PathAuthority;
  readonly #config: ConfigService;
  readonly #audit: AuditEmitter;
  readonly #observer: ConfinedObserver | undefined;
  readonly #actorId: string;

  public constructor(dependencies: CompletionProverDependencies) {
    this.#paths = dependencies.path_authority;
    this.#config = dependencies.config;
    this.#audit = dependencies.audit;
    this.#observer = dependencies.observer;
    this.#actorId = dependencies.core_actor_id;
  }

  public async prove(request: ProveRequest): Promise<CompletionProof> {
    const { requirement, correlation_id: correlationId } = request;
    const chain = verifyChain(this.#audit.chain.records(), { expected_ledger_id: this.#audit.chain.ledgerId });

    const evidence: {
      -readonly [K in keyof CompletionEvidence]: CompletionEvidence[K];
    } = {
      expected_target: requirement.expected_target,
      observed_target: null,
      execution_grant_id: null,
      executor_status: null,
      executor_bytes: null,
      executor_content_sha256: null,
      reobserved_content_sha256: null,
      reobservation_invocation_id: null,
      audit_event_refs: [],
      audit_chain_head: chain.head,
      audit_chain_verified: chain.ok,
      audit_chain_binder: chain.binder,
    };

    // 1) السلسلة. لا يُقرأ منها شيء قبل أن تتحقق.
    if (!chain.ok) {
      return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_AUDIT_CHAIN_INVALID, evidence, {
        detail: `audit chain does not verify: ${chain.defects.map((d) => d.kind).join(", ")}`,
      });
    }

    // 2) الهدف على المضيف. الوجود وحده ليس إثباتًا، لكن غيابه نفيٌ قاطع.
    const observed = this.#observeTarget(requirement.expected_target);
    evidence.observed_target = observed;
    if (observed === null || !observed.exists) {
      return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_TARGET_MISSING, evidence, {
        detail: `no observable artefact at ${requirement.expected_target}`,
      });
    }

    // 3) النسبة: أي منحة مصرَّح بها أنتجت هذا الهدف، بحسب السجل لا بحسب الادعاء.
    const events = this.#audit.forCorrelation(correlationId);
    const issued = events.find(
      (e) =>
        e["event_type"] === "EXECUTION_GRANT_ISSUED" &&
        sameLocator(locatorOf(e), requirement.expected_target) &&
        metadataOf(e)["operation"] === "WRITE_FILE",
    );
    if (issued === undefined) {
      return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_EFFECT_NOT_PROVEN, evidence, {
        detail: "the artefact exists, but no authorised execution grant in this mission names it as a write target",
      });
    }
    const grantId = metadataOf(issued)["grant_id"] ?? null;
    evidence.execution_grant_id = grantId;
    evidence.audit_event_refs = [String(issued["event_id"])];

    // 4) هل بلغ المنفّذ نجاحًا لتلك المنحة بعينها.
    const completed = events.find(
      (e) =>
        e["event_type"] === "EXECUTION_COMPLETED" &&
        grantId !== null &&
        metadataOf(e)["grant_id"] === grantId,
    );
    if (completed === undefined) {
      return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_EVIDENCE_MISSING, evidence, {
        detail: `no execution outcome is recorded for grant ${String(grantId)}`,
      });
    }
    const outcome = completed["outcome"] as Record<string, unknown> | undefined;
    const status = typeof outcome?.["status"] === "string" ? (outcome["status"] as string) : null;
    evidence.executor_status = status;
    const completedMetadata = metadataOf(completed);
    evidence.executor_content_sha256 = completedMetadata["content_sha256"] ?? null;
    const bytes = completedMetadata["bytes"];
    evidence.executor_bytes = bytes === undefined ? null : Number(bytes);
    evidence.audit_event_refs = [...evidence.audit_event_refs, String(completed["event_id"])];

    if (status !== "SUCCESS") {
      return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_EFFECT_NOT_PROVEN, evidence, {
        detail: `the executor reported ${String(status)} for grant ${String(grantId)}`,
      });
    }

    // 5) المطابقة: قراءة محصورة عبر نفس السلسلة تعيد إنتاج ما أبلغ به المنفّذ.
    if (this.#observer !== undefined) {
      const reobserved = await this.#observer.observe(requirement.expected_target);
      evidence.reobserved_content_sha256 = reobserved.content_sha256;
      evidence.reobservation_invocation_id = reobserved.invocation_id;
      if (!reobserved.ok) {
        return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_EVIDENCE_MISSING, evidence, {
          detail: `the confined re-read of the artefact did not complete: ${reobserved.detail}`,
        });
      }
      if (
        evidence.executor_content_sha256 !== null &&
        reobserved.content_sha256 !== null &&
        reobserved.content_sha256 !== evidence.executor_content_sha256
      ) {
        return this.#finish(request, "NOT_PROVEN", W5ErrorCode.COMPLETION_EFFECT_NOT_PROVEN, evidence, {
          detail: "the artefact on disk does not match what the authorised execution wrote",
        });
      }
    }

    return this.#finish(request, "PROVEN", null, evidence, {
      detail: `the required effect was observed at ${requirement.expected_target} and is attributable to grant ${String(grantId)}`,
    });
  }

  #observeTarget(expected: string): ObservedTarget | null {
    const resolved = resolveGrantTarget({
      path_authority: this.#paths,
      config: this.#config,
      operation: "READ_FILE",
      locator: expected,
    });
    if (!resolved.ok) return null;
    const canonical = resolved.value.canonical;
    return {
      logical: canonical.logical,
      host: canonical.host,
      exists: canonical.exists,
      ...(canonical.identity === undefined ? {} : { identity: canonical.identity }),
    };
  }

  #finish(
    request: ProveRequest,
    status: CompletionProofStatus,
    reason: CompletionProof["reason_code"],
    evidence: CompletionEvidence,
    extra: { readonly detail: string },
  ): CompletionProof {
    const proof: CompletionProof = {
      contract_version: "1.0",
      completion_proof_id: newId(),
      mission_id: request.requirement.mission_id,
      correlation_id: request.correlation_id,
      requirement_id: request.requirement.requirement_id,
      effect: request.requirement.effect,
      status,
      reason_code: reason,
      detail: extra.detail,
      evidence,
      created_at: nowTimestamp(),
    };

    this.#audit.emit({
      event_type: status === "PROVEN" ? "COMPLETION_PROOF_CREATED" : "COMPLETION_PROOF_FAILED",
      correlation_id: request.correlation_id,
      caller_identity: request.caller_identity,
      actor: { kind: "CORE", id: this.#actorId },
      mission_id: request.requirement.mission_id,
      status: status === "PROVEN" ? "SUCCESS" : "FAILED",
      ...(status === "PROVEN"
        ? {}
        : {
            error: {
              code: "INTERNAL_ERROR" as const,
              display_message: "The required effect could not be proven.",
              internal_detail: `${String(reason)}: ${extra.detail}`,
              retryable: false,
            },
          }),
      metadata: {
        completion_proof_id: proof.completion_proof_id,
        requirement_id: proof.requirement_id,
        proof_status: status,
        reason_code: reason ?? "NONE",
        audit_chain_head: evidence.audit_chain_head,
        audit_chain_verified: String(evidence.audit_chain_verified),
        ...(evidence.execution_grant_id === null ? {} : { grant_id: evidence.execution_grant_id }),
      },
    });

    return proof;
  }
}
