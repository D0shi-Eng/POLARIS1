// نقطة فرض نظام الملفات.
//
// وظيفتها ليست "تنفيذ ما سمحت به السياسة"، بل إثبات أن كل شرط تنفيذ قابل للفرض
// فعلًا قبل أن يقع أي أثر. كل مسار لا ينتهي بإثبات ينتهي برفض؛ لا يوجد
// سقوط إلى نظام ملفات خام.
//
// الفصل: هذه الطبقة لا تستدعي node:fs لأثر أداة. التطبيع تفعله سلطة المسارات،
// والأثر يقع في عملية التنفيذ خلف منحة.

import { newId, nowTimestamp } from "../ids.js";
import { FILESYSTEM_WRITE_ACTIONS, isEffectAction, NETWORK_ACTIONS, type EffectAction } from "../effects.js";
import { W4ErrorCode, W5ErrorCode, failWith, succeed, w4Error, type Attempt } from "../errors.js";
import { foldWindowsPath, parseWindowsPath } from "../platform/windows-path-rules.js";
import type { CanonicalPath, PathAuthority } from "../platform/path-authority.js";
import type { ConfigService } from "../config/service.js";
import type { Doc } from "../policy/types.js";
import type { AuditEmitter } from "../audit/emitter.js";
import { approvalObligationOf } from "../approval/coordinator.js";
import type { ApprovalReceiptIssuer } from "../approval/issuer.js";
import type { ApprovalRegistry } from "../approval/registry.js";
import { verifyReceipt } from "../approval/verify.js";
import { argumentsDigest, planHash } from "../approval/plan-hash.js";
import type { ApprovalExpectation, ApprovalTargetBinding } from "../approval/types.js";
import type { ExecutionAdmission } from "../control/admission.js";
import type { IssuedGrantLedger } from "../control/grant-ledger.js";
import { resolveGrantTarget } from "./target-resolution.js";
import type { ExecutionHost } from "./execution-host.js";
import type { ExecutionGrant, ExecutionOutcome, GrantOperation, WriteMode } from "./grant.js";

/** شروط التنفيذ التي يعرف هذا البناء كيف يفرضها. أي انحراف عنها فشل مغلق. */
const REQUIRED_EXECUTION: Readonly<Record<string, string>> = {
  confinement: "CONFINED",
  process_tree: "CONFINED_KILL_ON_CLOSE",
  handle_inheritance: "EXPLICIT_ONLY",
  environment: "EXPLICIT_ONLY",
  filesystem_scope: "EXPLICIT_GRANT",
  network: "NONE",
};

const DEFAULT_DEADLINE_MS = 5000;

export interface PepRequest {
  readonly invocation: Doc;
  readonly descriptor: Doc;
  readonly decision: Doc;
  readonly operation: GrantOperation;
  /** المحتوى المراد كتابته، نصًا. غائب في القراءة. */
  readonly payload?: string;
  readonly allowOverwrite?: boolean;
  /**
   * إيصال الموافقة، إن كان القرار يحمل التزام موافقة.
   * نوعه unknown عمدًا: نقطة الفرض لا تثق بشكل ما وصلها، بل تتحقق منه.
   */
  readonly approvalReceipt?: unknown;
  /** هوية المستدعي، لأحداث التدقيق. غيابها لا يمنع الفرض ولا يمنحه شيئًا. */
  readonly callerIdentity?: Doc;
  readonly missionId?: string;
  readonly agentId?: string;
}

/** ما تحتاجه نقطة الفرض للتحقق من إيصال موافقة بمصادرها هي. */
export interface ApprovalVerificationDependencies {
  readonly issuer: ApprovalReceiptIssuer;
  readonly registry: ApprovalRegistry;
}

export interface PepResult {
  readonly grant: ExecutionGrant;
  readonly outcome: ExecutionOutcome;
  readonly canonical: CanonicalPath;
  readonly host_id: string;
  readonly windows_confinement: boolean;
  /** ما فحصته نقطة الفرض فعلًا. دليل، لا وصف. */
  readonly checks: readonly string[];
}

export interface FilesystemPepDependencies {
  readonly path_authority: PathAuthority;
  readonly execution_host: ExecutionHost;
  readonly config: ConfigService;
  /**
   * التحقق من الموافقة. غيابه ليس تساهلًا: قرارٌ يحمل التزام موافقة يُرفض
   * حين لا يوجد متحقق، لأن نقطة فرض لا تستطيع إثبات استيفاء التزام تُغلق.
   */
  readonly approval?: ApprovalVerificationDependencies;
  /** بوابة القبول. غيابها يعني تركيبًا بلا إيقاف طوارئ، والقبول دائم. */
  readonly admission?: ExecutionAdmission;
  readonly grants?: IssuedGrantLedger;
  readonly audit?: AuditEmitter;
  readonly core_actor_id?: string;
}

function asRecord(value: unknown): Doc | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function enforcementFailure(detail: string): Attempt<PepResult> {
  return failWith(
    w4Error(
      W4ErrorCode.PEP_ENFORCEMENT_FAILED,
      "PEP",
      "The action could not be carried out under a provable confinement.",
      detail,
    ),
  );
}

function scopeDenied(detail: string): Attempt<PepResult> {
  return failWith(
    w4Error(W4ErrorCode.FILESYSTEM_SCOPE_DENIED, "PEP", "That location is outside the permitted scope.", detail),
  );
}

export class FilesystemPep {
  readonly #paths: PathAuthority;
  readonly #host: ExecutionHost;
  readonly #config: ConfigService;
  readonly #approval: ApprovalVerificationDependencies | undefined;
  readonly #admission: ExecutionAdmission | undefined;
  readonly #grants: IssuedGrantLedger | undefined;
  readonly #audit: AuditEmitter | undefined;
  readonly #actorId: string;

  public constructor(dependencies: FilesystemPepDependencies) {
    this.#paths = dependencies.path_authority;
    this.#host = dependencies.execution_host;
    this.#config = dependencies.config;
    this.#approval = dependencies.approval;
    this.#admission = dependencies.admission;
    this.#grants = dependencies.grants;
    this.#audit = dependencies.audit;
    this.#actorId = dependencies.core_actor_id ?? newId();
  }

  public async enforce(request: PepRequest): Promise<Attempt<PepResult>> {
    const checks: string[] = [];
    const { invocation, decision } = request;

    // 0) القبول. نقطة الفرض لا تُصدر سلطة بينما النظام موقوف، مهما قالت السياسة.
    const admitted = this.#admission?.admit("EXECUTION_GRANT");
    if (admitted !== undefined && !admitted.ok) return failWith(admitted.error);
    checks.push("panic-stop admission granted before any authority was minted");

    // 1) القرار يجب أن يكون سماحًا، ويجب أن يخص هذا الاستدعاء بعينه.
    if (decision["result"] !== "ALLOW") {
      return failWith(
        w4Error(W4ErrorCode.POLICY_DENIED, "PEP", "This action was not permitted.", "PEP invoked without an ALLOW decision"),
      );
    }
    if (decision["invocation_id"] !== invocation["invocation_id"]) {
      return enforcementFailure("decision does not bind to this invocation");
    }
    if (decision["correlation_id"] !== invocation["correlation_id"]) {
      return enforcementFailure("decision and invocation belong to different correlation chains");
    }
    checks.push("decision binds to this invocation and correlation chain");

    // 2) الأثر المطلوب يجب أن يطابق العملية المطلوبة. لا كتابة تحت غطاء قراءة.
    const effects = asList(invocation["requested_effects"]).map(asRecord).filter((e): e is Doc => e !== undefined);
    const actions = effects.map((e) => e["action"]).filter((a): a is string => typeof a === "string");
    if (actions.some((action) => isEffectAction(action) && NETWORK_ACTIONS.has(action))) {
      return failWith(
        w4Error(
          W4ErrorCode.NETWORK_EFFECT_UNAVAILABLE,
          "PEP",
          "Network actions are not available.",
          "no egress enforcement path exists in W4; a network effect can never be enforced here",
        ),
      );
    }
    const wantsWrite = actions.some((action) => isEffectAction(action) && FILESYSTEM_WRITE_ACTIONS.has(action));
    const wantsRead = actions.includes("read.filesystem");
    if (request.operation === "READ_FILE" && (!wantsRead || wantsWrite)) {
      return failWith(
        w4Error(W4ErrorCode.EFFECT_MISMATCH, "PEP", "The action does not match its declared effects.", `read operation with effects [${actions.join(", ")}]`),
      );
    }
    if (request.operation === "WRITE_FILE" && !wantsWrite) {
      return failWith(
        w4Error(W4ErrorCode.EFFECT_MISMATCH, "PEP", "The action does not match its declared effects.", `write operation with effects [${actions.join(", ")}]`),
      );
    }
    checks.push(`requested effects [${actions.join(", ")}] match operation ${request.operation}`);

    // 3) شروط الحصر. المطلوب معلن، والمجهول مرفوض.
    const obligations = asList(decision["obligations"]).map(asRecord).filter((o): o is Doc => o !== undefined);
    const confinement = asRecord(obligations.find((o) => o["type"] === "REQUIRE_CONFINEMENT")?.["requirements"]);
    if (confinement === undefined) return enforcementFailure("decision carries no REQUIRE_CONFINEMENT obligation");
    for (const [axis, expected] of Object.entries(REQUIRED_EXECUTION)) {
      if (confinement[axis] !== expected) {
        const detail = `execution requirement ${axis}=${String(confinement[axis])} is not supported by this enforcement point (expected ${expected})`;
        return axis === "network"
          ? failWith(
              w4Error(W4ErrorCode.NETWORK_EFFECT_UNAVAILABLE, "PEP", "Network actions are not available.", detail),
            )
          : enforcementFailure(detail);
      }
    }
    checks.push(`confinement obligation matches every supported axis: ${Object.keys(REQUIRED_EXECUTION).join(", ")}`);

    // 4) سقف البايتات. غيابه فشل مغلق: لا قراءة ولا كتابة بلا سقف.
    const ceiling = obligations.find((o) => o["type"] === "MAX_BYTES")?.["max_bytes"];
    if (typeof ceiling !== "number" || ceiling <= 0) {
      return enforcementFailure("decision carries no usable MAX_BYTES obligation");
    }
    checks.push(`byte ceiling ${String(ceiling)} taken from the MAX_BYTES obligation`);

    // 5) الهدف. يُقرأ من المورد، ويجب أن يكون معلنًا في المسارات الممنوحة.
    const resource = asRecord(invocation["resource"]);
    const locator = resource?.["locator"];
    if (typeof locator !== "string" || locator.length === 0) {
      return enforcementFailure("invocation carries no resource locator");
    }
    const grantedPaths = asList(confinement["granted_paths"])
      .map(asRecord)
      .map((p) => (typeof p?.["locator"] === "string" ? (p["locator"] as string) : undefined))
      .filter((p): p is string => p !== undefined);
    if (!this.#declaredAmongGrants(locator, grantedPaths)) {
      return scopeDenied("target is not among the paths the invocation was granted");
    }
    checks.push("target appears in the invocation granted_paths");

    // 6) النطاق المُعد. القراءة والكتابة لهما جذران مختلفان؛ الكتابة لا ترث نطاق القراءة.
    const containment = resolveGrantTarget({
      path_authority: this.#paths,
      config: this.#config,
      operation: request.operation,
      locator,
    });
    if (!containment.ok) return failWith(containment.error);
    const canonical = containment.value.canonical;
    checks.push(
      `target canonicalised to ${canonical.host} and proven inside ${containment.value.root} by ${this.#paths.platform} path authority`,
    );
    if (!this.#paths.nativeWindowsSemantics) {
      checks.push("WARNING: canonicalisation ran on a non-Windows host; Windows link and name semantics are NOT proven");
    }

    // 7) المنحة. الجذور تُمرَّر بشكلها الحقيقي ليعيد المنفّذ إثبات الاحتواء.
    const hostRoots = containment.value.host_roots;
    if (hostRoots.length === 0) return enforcementFailure("no configured root could be canonicalised on this host");

    const mode: "READ" | WriteMode =
      request.operation === "READ_FILE" ? "READ" : canonical.exists ? "MODIFY" : "CREATE";
    const deadline =
      typeof confinement["max_wall_clock_ms"] === "number" ? (confinement["max_wall_clock_ms"] as number) : DEFAULT_DEADLINE_MS;

    // هوية الكائن كما رُصدت على المسار المحلول تسافر مع المنحة: بها يثبت
    // المنفّذ على مقبضه هو أن ما فتحه هو ما أُقرّ، بلا إعادة حلّ للاسم.
    // وغيابها في القراءة فشل مغلق عند المنفّذ، لا تساهل.
    if (request.operation === "READ_FILE" && canonical.identity === undefined) {
      return enforcementFailure("the resolved target carries no object identity, so no grant can bind to it");
    }
    checks.push(
      canonical.identity === undefined
        ? "target does not exist yet, so no object identity is bound"
        : "grant bound to the resolved object identity observed at decision time",
    );

    const target: ExecutionGrant["target"] =
      canonical.identity === undefined
        ? { logical: canonical.logical, host: canonical.host, mode }
        : { logical: canonical.logical, host: canonical.host, mode, identity: canonical.identity };

    // 7.5) التزام الموافقة، بعد أن صار الهدف معروفًا بهويته وقبل أن تُصدَر أي سلطة.
    //
    // الموضع مقصود: الإيصال يُقارن بهدف حلّته نقطة الفرض بنفسها الآن، لا بهدف
    // حلّه المنسّق وقت العرض. اختلافهما هو بالضبط «تغيّر الهدف بعد الموافقة»،
    // ولا يُكتشف إلا إذا حلَّ الطرفان كلٌّ على حدة.
    const approval = this.#satisfyApproval(request, canonical, actions);
    if (!approval.ok) return failWith(approval.error);
    if (approval.value.length > 0) checks.push(approval.value);

    const base = {
      grant_id: newId(),
      correlation_id: String(invocation["correlation_id"]),
      invocation_id: String(invocation["invocation_id"]),
      decision_id: String(decision["decision_id"]),
      operation: request.operation,
      target,
      allowed_host_roots: hostRoots,
      max_bytes: ceiling,
      deadline_ms: deadline,
      encoding: "utf-8",
      allow_overwrite: request.allowOverwrite === true,
    } as const;

    let grant: ExecutionGrant;
    if (request.operation === "WRITE_FILE") {
      if (request.payload === undefined) return enforcementFailure("write enforcement invoked without a payload");
      const payload = Buffer.from(request.payload, "utf8");
      if (payload.byteLength > ceiling) {
        return enforcementFailure(`payload ${String(payload.byteLength)} exceeds the ceiling ${String(ceiling)}`);
      }
      if (canonical.exists && request.allowOverwrite !== true) {
        return enforcementFailure("target exists and overwrite was not authorised");
      }
      grant = { ...base, payload_base64: payload.toString("base64") };
    } else {
      grant = base;
    }

    this.#grants?.issued(grant.grant_id, grant.correlation_id, grant.invocation_id);
    this.#emitGrantIssued(request, grant);

    // القبول يُسأل مرة أخرى قبل الأثر مباشرة: إيقاف وقع بين إصدار المنحة
    // وتنفيذها يجب أن يمنع الأثر، لا أن يسبقه بميلي ثانية.
    const stillAdmitted = this.#admission?.admit("PROCESS_LAUNCH");
    if (stillAdmitted !== undefined && !stillAdmitted.ok) {
      this.#grants?.consumed(grant.grant_id);
      return failWith(stillAdmitted.error);
    }
    if (this.#grants !== undefined && this.#grants.state(grant.grant_id) !== "ISSUED") {
      return failWith(
        w4Error(
          W5ErrorCode.PANIC_STOP_ACTIVE,
          "PANIC_STOP",
          "POLARIS is stopped. Nothing new will run until it is resumed.",
          `grant ${grant.grant_id} was invalidated before it could be executed`,
        ),
      );
    }

    const outcome: ExecutionOutcome = await this.#host.execute(grant);
    this.#grants?.consumed(grant.grant_id);
    if (outcome.status !== "SUCCESS") {
      return failWith(
        w4Error(
          W4ErrorCode.PEP_ENFORCEMENT_FAILED,
          "EXECUTOR",
          "The action could not be completed.",
          `executor: ${outcome.error?.code ?? "UNKNOWN"} ${outcome.error?.detail ?? ""}`,
        ),
      );
    }
    checks.push(`execution host ${this.#host.id} completed the grant`);

    return succeed({
      grant,
      outcome,
      canonical,
      host_id: this.#host.id,
      windows_confinement: this.#host.windowsConfinement,
      checks,
    });
  }

  /** المقارنة على الشكل القانوني لا على النص الخام. */
  #declaredAmongGrants(locator: string, grants: readonly string[]): boolean {
    const target = parseWindowsPath(locator);
    if (!target.ok) return false;
    const folded = foldWindowsPath(target.parts.normalised);
    return grants.some((granted) => {
      const parsed = parseWindowsPath(granted);
      return parsed.ok && foldWindowsPath(parsed.parts.normalised) === folded;
    });
  }

  /**
   * يستوفي التزام الموافقة إن وُجد.
   *
   * الترتيب: هل هناك التزام؟ ثم هل نملك متحققًا أصلًا؟ ثم هل جاء إيصال؟ ثم
   * هل يربط نفسه بهذا الفعل بعينه؟ ثم استهلاكه. الاستهلاك آخر خطوة قبل
   * الأثر، ويقع قبله لا بعده: انهيار بينهما يترك إيصالًا محروقًا وأثرًا لم يقع.
   */
  #satisfyApproval(request: PepRequest, canonical: CanonicalPath, actions: readonly string[]): Attempt<string> {
    const obligation = approvalObligationOf(request.decision);
    if (obligation === undefined) return succeed("");

    if (this.#approval === undefined) {
      return failWith(
        w4Error(
          W4ErrorCode.PEP_ENFORCEMENT_FAILED,
          "PEP",
          "This action needs approval, and approval cannot be verified here.",
          "the decision carries a REQUIRE_APPROVAL obligation but this enforcement point has no approval verifier",
        ),
      );
    }
    if (request.approvalReceipt === undefined) {
      return failWith(
        w4Error(
          W5ErrorCode.APPROVAL_REQUIRED,
          "APPROVAL",
          "This action needs your approval before it can run.",
          "the decision carries a REQUIRE_APPROVAL obligation and no receipt was presented",
        ),
      );
    }

    const binding: ApprovalTargetBinding =
      canonical.identity === undefined
        ? { logical: canonical.logical, host: canonical.host }
        : { logical: canonical.logical, host: canonical.host, identity: canonical.identity };

    const expectation: ApprovalExpectation = {
      mission_id: String(request.invocation["mission_id"]),
      correlation_id: String(request.invocation["correlation_id"]),
      invocation_id: String(request.invocation["invocation_id"]),
      policy_decision_id: String(request.decision["decision_id"]),
      effects: actions.filter((a): a is EffectAction => isEffectAction(a)),
      canonical_target: binding,
      plan_hash: planHash({
        capability_id: String(request.invocation["capability_id"]),
        capability_version: String(request.invocation["capability_version"]),
        operation: request.operation,
        effects: actions.filter((a): a is EffectAction => isEffectAction(a)),
        arguments_digest: argumentsDigest((request.invocation["arguments"] ?? {}) as Doc),
        target: binding,
        execution_constraints: (request.invocation["execution_constraints"] ?? {}) as Doc,
      }),
    };

    const verified = verifyReceipt({
      receipt: request.approvalReceipt,
      expectation,
      issuer: this.#approval.issuer,
      registry: this.#approval.registry,
      at: new Date(),
    });
    if (!verified.ok) {
      // إعادة الاستعمال حدث أمني قائم بذاته، لا مجرد خطأ يُعاد إلى المستدعي.
      // رفضٌ لا يظهر في الدفتر هو رفض لا يستطيع أحد أن يراه لاحقًا.
      if (verified.error.code === W5ErrorCode.APPROVAL_REPLAYED) {
        this.#emitReplayRefused(request, expectation, verified.error.internal_detail);
      }
      return failWith(verified.error);
    }

    const approvalId = (request.approvalReceipt as { readonly approval_id: string }).approval_id;
    const consumed = this.#approval.registry.consume(approvalId, nowTimestamp());
    if (!consumed.ok) {
      this.#emitReplayRefused(request, expectation, `approval ${approvalId}: ${consumed.detail}`);
      return failWith(
        w4Error(
          W5ErrorCode.APPROVAL_REPLAYED,
          "APPROVAL",
          "This approval was already used.",
          `approval ${approvalId}: ${consumed.detail}`,
        ),
      );
    }

    return succeed(
      `approval ${approvalId} verified against this enforcement point's own target resolution and consumed once`,
    );
  }

  #emitReplayRefused(request: PepRequest, expectation: ApprovalExpectation, detail: string): void {
    if (this.#audit === undefined || request.callerIdentity === undefined) return;
    this.#audit.emit({
      event_type: "APPROVAL_REPLAY_REFUSED",
      correlation_id: expectation.correlation_id,
      causation_id: expectation.policy_decision_id,
      caller_identity: request.callerIdentity,
      actor: { kind: "CORE", id: this.#actorId },
      ...(request.missionId === undefined ? {} : { mission_id: request.missionId }),
      ...(request.agentId === undefined ? {} : { agent_id: request.agentId }),
      capability_ref: {
        capability_id: String(request.invocation["capability_id"]),
        capability_version: String(request.invocation["capability_version"]),
      },
      invocation_id: expectation.invocation_id,
      decision_id: expectation.policy_decision_id,
      resource: { kind: "FILESYSTEM_PATH", locator: expectation.canonical_target.logical, scope: "EXACT" },
      status: "DENIED",
      error: {
        code: "POLICY_DENIED",
        display_message: "This approval was already used.",
        internal_detail: detail,
        retryable: false,
      },
      metadata: { reason_code: W5ErrorCode.APPROVAL_REPLAYED },
    });
  }

  #emitGrantIssued(request: PepRequest, grant: ExecutionGrant): void {
    if (this.#audit === undefined || request.callerIdentity === undefined) return;
    this.#audit.emit({
      event_type: "EXECUTION_GRANT_ISSUED",
      correlation_id: grant.correlation_id,
      causation_id: grant.decision_id,
      caller_identity: request.callerIdentity,
      actor: { kind: "CORE", id: this.#actorId },
      ...(request.missionId === undefined ? {} : { mission_id: request.missionId }),
      ...(request.agentId === undefined ? {} : { agent_id: request.agentId }),
      capability_ref: {
        capability_id: String(request.invocation["capability_id"]),
        capability_version: String(request.invocation["capability_version"]),
      },
      invocation_id: grant.invocation_id,
      decision_id: grant.decision_id,
      resource: { kind: "FILESYSTEM_PATH", locator: grant.target.logical, scope: "EXACT" },
      status: "SUCCESS",
      metadata: {
        grant_id: grant.grant_id,
        operation: grant.operation,
        target_mode: grant.target.mode,
        max_bytes: String(grant.max_bytes),
        ...(grant.target.identity === undefined
          ? {}
          : {
              target_volume: grant.target.identity.volume,
              target_file: grant.target.identity.file,
            }),
      },
    });
  }
}
