// متحكّم إيقاف الطوارئ.
//
// يقود الإيقاف بالترتيب الذي يغلق الأبواب قبل أن يهدم ما خلفها:
//   1) إغلاق القبول    — لا مهمة، ولا استدعاء، ولا منحة، ولا إطلاق.
//   2) إبطال السلطة    — منح صدرت ولم تُستهلك، وموافقات معلّقة أو ممنوحة.
//   3) إنهاء المملوك   — بالهوية المسجّلة، لا بالاسم.
//   4) انتظار محدود    — لا انتظار بلا نهاية.
//   5) تحقق من الناجين — سؤال المقابض، لا افتراض النجاح.
//   6) STOPPED         — إن وإن فقط بلغت 3–5 حالة نهائية معرَّفة.
//
// الفشل مغلق: ناجٍ واحد، أو إنهاء لم يكتمل، يترك النظام في STOPPING بسبب
// مُسمّى. «موقوف على أي حال» ليست حالة في هذا النظام.
//
// لا يستورد هذا الملف نموذجًا ولا مزوّدًا ولا شبكة: الإيقاف لا يحتاج أيًّا منها.

import type { AuditEmitter } from "../audit/emitter.js";
import type { ApprovalRegistry } from "../approval/registry.js";
import { W5ErrorCode, type W5ErrorCode as W5Code } from "../errors.js";
import { newId, nowTimestamp } from "../ids.js";
import type { Doc } from "../policy/types.js";
import { OwnedExecutionRegistry, type OwnedExecutionHandle } from "./execution-registry.js";
import type { IssuedGrantLedger } from "./grant-ledger.js";
import { PanicStopMachine, type PanicStopState } from "./panic-stop.js";

/** ما يُنهي معروضًا بلا أثر عند الإيقاف. سطح الموافقة يحقّقه. */
export interface PendingApprovalSurface {
  expireAll(): readonly string[];
}

export interface TerminationRecord {
  readonly execution_id: string;
  readonly kind: string;
  readonly pid: number | null;
  readonly alive_before: boolean;
  readonly terminate_called: boolean;
  readonly alive_after: boolean;
  readonly waited_ms: number;
}

export interface PanicStopReport {
  readonly stop_id: string;
  readonly requested_at: string;
  readonly completed_at: string;
  readonly state: PanicStopState;
  readonly complete: boolean;
  readonly reason_code: W5Code | null;
  readonly owned_executions: number;
  readonly alive_before: number;
  readonly terminations: readonly TerminationRecord[];
  readonly survivors: readonly string[];
  readonly invalidated_grants: readonly string[];
  readonly invalidated_approvals: readonly string[];
  readonly expired_presentations: readonly string[];
  readonly duration_ms: number;
}

export interface StopControllerDependencies {
  readonly machine: PanicStopMachine;
  readonly executions: OwnedExecutionRegistry;
  readonly grants: IssuedGrantLedger;
  readonly approvals?: ApprovalRegistry;
  readonly surface?: PendingApprovalSurface;
  readonly audit: AuditEmitter;
  readonly core_actor_id: string;
  readonly system_identity: Doc;
  /** مهلة انتظار موت العملية بعد الإنهاء. محدودة دائمًا. */
  readonly termination_timeout_ms?: number;
  readonly poll_interval_ms?: number;
}

const DEFAULT_TERMINATION_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 25;

/**
 * انتظار محدود بين استفسارين عن حياة العملية.
 *
 * المؤقّت لا يُطلق من حلقة الأحداث (لا unref): تسلسل الإيقاف عمل معلّق حقيقي
 * ومحدود بمهلة، وإطلاقه يعني أن العملية قد تخرج في منتصف الإنهاء فيبدو
 * «لا ناجين» ناتجًا عن الخروج لا عن قياس.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class PanicStopController {
  readonly #machine: PanicStopMachine;
  readonly #executions: OwnedExecutionRegistry;
  readonly #grants: IssuedGrantLedger;
  readonly #approvals: ApprovalRegistry | undefined;
  readonly #surface: PendingApprovalSurface | undefined;
  readonly #audit: AuditEmitter;
  readonly #actorId: string;
  readonly #identity: Doc;
  readonly #timeoutMs: number;
  readonly #pollMs: number;

  /** سلسلة ارتباط الإيقاف. مستقلة عن أي مهمة، لأن الإيقاف ليس جزءًا من مهمة. */
  readonly #correlationId = newId();

  public constructor(dependencies: StopControllerDependencies) {
    this.#machine = dependencies.machine;
    this.#executions = dependencies.executions;
    this.#grants = dependencies.grants;
    this.#approvals = dependencies.approvals;
    this.#surface = dependencies.surface;
    this.#audit = dependencies.audit;
    this.#actorId = dependencies.core_actor_id;
    this.#identity = dependencies.system_identity;
    this.#timeoutMs = dependencies.termination_timeout_ms ?? DEFAULT_TERMINATION_TIMEOUT_MS;
    this.#pollMs = dependencies.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  }

  public state(): PanicStopState {
    return this.#machine.state();
  }

  public correlationId(): string {
    return this.#correlationId;
  }

  /**
   * يطلب الإيقاف. آمن للاستدعاء أكثر من مرة: الطلب الثاني أثناء الإيقاف لا
   * يعيد تشغيل التسلسل ولا يزعم اكتمالًا؛ يعيد تقريرًا يقول إن الإيقاف جارٍ.
   */
  public async stop(reason: string): Promise<PanicStopReport> {
    const startedAt = Date.now();
    const requestedAt = nowTimestamp();
    const stopId = newId();

    this.#emit("PANIC_STOP_REQUESTED", "SUCCESS", { stop_id: stopId, reason_text: reason });

    if (!this.#machine.beginStop(requestedAt)) {
      const state = this.#machine.state();
      const code = state === "STOPPED" ? W5ErrorCode.PANIC_STOP_ACTIVE : W5ErrorCode.PANIC_STOP_IN_PROGRESS;
      return this.#report(stopId, requestedAt, startedAt, false, code, [], [], [], [], []);
    }

    // 1) القبول أُغلق بمجرد دخول STOPPING. لا حاجة إلى خطوة أخرى.
    this.#emit("PANIC_STOP_ENTERED", "SUCCESS", { stop_id: stopId, state: "STOPPING" });

    // 2) إبطال السلطة المعلّقة قبل الإنهاء: منحة تنجو من الإيقاف أخطر من عملية.
    const invalidatedGrants = this.#grants.invalidateOutstanding();
    const expiredPresentations = this.#surface?.expireAll() ?? [];
    const invalidatedApprovals = this.#approvals?.invalidateAllPending(nowTimestamp()) ?? [];

    // 3–5) الإنهاء والانتظار والتحقق.
    const handles = this.#executions.all().map((e) => e.handle);
    const terminations: TerminationRecord[] = [];
    for (const handle of handles) terminations.push(await this.#terminate(handle, stopId));

    const survivors = handles.filter((h) => h.isAlive()).map((h) => h.execution_id);
    const aliveBefore = terminations.filter((t) => t.alive_before).length;

    if (survivors.length > 0) {
      this.#emit("PANIC_STOP_COMPLETED", "FAILED", {
        stop_id: stopId,
        reason_code: W5ErrorCode.PANIC_STOP_SURVIVORS_FOUND,
        survivors: String(survivors.length),
      });
      return this.#report(
        stopId,
        requestedAt,
        startedAt,
        false,
        W5ErrorCode.PANIC_STOP_SURVIVORS_FOUND,
        terminations,
        survivors,
        invalidatedGrants,
        invalidatedApprovals,
        expiredPresentations,
        aliveBefore,
      );
    }

    const unfinished = terminations.filter((t) => t.alive_after);
    if (unfinished.length > 0) {
      this.#emit("PANIC_STOP_COMPLETED", "FAILED", {
        stop_id: stopId,
        reason_code: W5ErrorCode.PANIC_STOP_TERMINATION_FAILED,
      });
      return this.#report(
        stopId,
        requestedAt,
        startedAt,
        false,
        W5ErrorCode.PANIC_STOP_TERMINATION_FAILED,
        terminations,
        unfinished.map((t) => t.execution_id),
        invalidatedGrants,
        invalidatedApprovals,
        expiredPresentations,
        aliveBefore,
      );
    }

    // 6) الحالة النهائية تُكتسب، لا تُعلن.
    this.#machine.completeStop(nowTimestamp());
    this.#emit("PANIC_STOP_COMPLETED", "SUCCESS", { stop_id: stopId, state: "STOPPED" });
    return this.#report(
      stopId,
      requestedAt,
      startedAt,
      true,
      null,
      terminations,
      [],
      invalidatedGrants,
      invalidatedApprovals,
      expiredPresentations,
      aliveBefore,
    );
  }

  /** استئناف بفعل مالك صريح. لا يوجد مسار آخر يستدعي هذه الدالة. */
  public resume(): boolean {
    const resumed = this.#machine.resume(nowTimestamp());
    if (resumed) this.#emit("SYSTEM_RESUMED", "SUCCESS", { state: "RUNNING" });
    return resumed;
  }

  async #terminate(handle: OwnedExecutionHandle, stopId: string): Promise<TerminationRecord> {
    const startedAt = Date.now();
    const aliveBefore = handle.isAlive();
    if (!aliveBefore) {
      return {
        execution_id: handle.execution_id,
        kind: handle.kind,
        pid: handle.pid ?? null,
        alive_before: false,
        terminate_called: false,
        alive_after: false,
        waited_ms: 0,
      };
    }

    handle.terminate();
    let alive = handle.isAlive();
    while (alive && Date.now() - startedAt < this.#timeoutMs) {
      await sleep(this.#pollMs);
      alive = handle.isAlive();
    }
    const waited = Date.now() - startedAt;

    this.#emit(alive ? "PANIC_STOP_COMPLETED" : "EXECUTOR_TERMINATED_BY_STOP", alive ? "FAILED" : "SUCCESS", {
      stop_id: stopId,
      execution_id: handle.execution_id,
      pid: handle.pid === undefined ? "unknown" : String(handle.pid),
      waited_ms: String(waited),
      ...(alive ? { reason_code: W5ErrorCode.PANIC_STOP_TERMINATION_FAILED } : {}),
    });

    return {
      execution_id: handle.execution_id,
      kind: handle.kind,
      pid: handle.pid ?? null,
      alive_before: true,
      terminate_called: true,
      alive_after: alive,
      waited_ms: waited,
    };
  }

  #report(
    stopId: string,
    requestedAt: string,
    startedAt: number,
    complete: boolean,
    reason: W5Code | null,
    terminations: readonly TerminationRecord[],
    survivors: readonly string[],
    grants: readonly string[],
    approvals: readonly string[],
    presentations: readonly string[],
    aliveBefore = 0,
  ): PanicStopReport {
    return {
      stop_id: stopId,
      requested_at: requestedAt,
      completed_at: nowTimestamp(),
      state: this.#machine.state(),
      complete,
      reason_code: reason,
      owned_executions: this.#executions.count(),
      alive_before: aliveBefore,
      terminations,
      survivors,
      invalidated_grants: grants,
      invalidated_approvals: approvals,
      expired_presentations: presentations,
      duration_ms: Date.now() - startedAt,
    };
  }

  #emit(
    eventType:
      | "PANIC_STOP_REQUESTED"
      | "PANIC_STOP_ENTERED"
      | "EXECUTOR_TERMINATED_BY_STOP"
      | "PANIC_STOP_COMPLETED"
      | "SYSTEM_RESUMED",
    status: "SUCCESS" | "FAILED",
    metadata: Readonly<Record<string, string>>,
  ): void {
    this.#audit.emit({
      event_type: eventType,
      correlation_id: this.#correlationId,
      caller_identity: this.#identity,
      actor: { kind: "SYSTEM", id: this.#actorId },
      status,
      ...(status === "FAILED"
        ? {
            error: {
              code: "INTERNAL_ERROR" as const,
              display_message: "The stop sequence did not reach a clean terminal state.",
              internal_detail: `${eventType}: ${metadata["reason_code"] ?? "unspecified"}`,
              retryable: false,
            },
          }
        : {}),
      metadata,
    });
  }
}
