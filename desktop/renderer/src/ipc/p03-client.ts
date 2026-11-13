// العميل المُصنَّف لـPhase-03: عشر دوال، واحدة لكل عملية في السجل.
//
// القاعدة نفسها: لا دالة عامة تقبل اسم عملية، ولا حمولة تسمّي فعلًا. بدء مهمّة
// وإلغاؤها واستئنافها عمليات تحكّم مستقلّة بمفاتيح idempotency خاصّة بها، فلا
// يُعاد تشغيل أثر بإعادة إرسال.

import type {
  AgentListResultV1,
  ClaimListResultV1,
  EvidenceListResultV1,
  MissionCancelResultV1,
  MissionCreateResultV1,
  MissionGetResultV1,
  MissionListResultV1,
  MissionResumeResultV1,
  MissionStartResultV1,
  TaskListResultV1,
} from "../generated/types/desktop-p03-result-v1";
import type { BudgetPreset, ExecutionMode, MissionBudget, MissionPriority } from "../generated/types/desktop-p03-request-v1";
import { callOperation, type CallContext, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { Phase03Operation } from "./operations";
import type { Transport } from "./transport";

/** مهلة القراءة العادية. */
const READ_TIMEOUT_MS = 8_000;
/** إنشاء مهمّة يكتب في المخزن. */
const WRITE_TIMEOUT_MS = 12_000;
/**
 * تشغيل مهمّة يستدعي نموذجًا مرة أو أكثر. المهلة هنا هامش نقل فوق مهلة المضيف،
 * ولا تُقصّر التنفيذ: المضيف هو من يفرض المهلة الحقيقية وميزانية الوقت.
 */
const START_TIMEOUT_MS = 600_000;

export interface Phase03ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

export interface MissionRequirementInput {
  readonly requirement_id: string;
  readonly text: string;
  readonly mandatory: boolean;
  readonly verification_rule_id?: string;
}

export interface CreateMissionInput {
  readonly title: string;
  readonly objective: string;
  readonly project_id?: string;
  readonly execution_mode?: ExecutionMode;
  readonly priority?: MissionPriority;
  readonly budget_preset?: BudgetPreset;
  readonly budget?: MissionBudget;
  readonly requirements?: readonly MissionRequirementInput[];
}

/** يحذف الحقول غير المُعرَّفة: الحمولة مغلقة، و`undefined` ليس قيمة في العقد. */
function defined<T extends object>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export class Phase03Client {
  private readonly context: CallContext;

  constructor(options: Phase03ClientOptions) {
    this.context = {
      transport: options.transport,
      identity: options.identity,
      newId: options.newId,
      clock: options.clock,
    };
  }

  // ── المهام ────────────────────────────────────────────────────────────────

  listMissions(input: { readonly project_id?: string } = {}): Promise<CallResult<MissionListResultV1>> {
    return this.call("mission.list", defined(input), READ_TIMEOUT_MS);
  }

  /** المهمّة وإثباتها معًا: لا تُقرأ الحالة دون الإثبات. */
  getMission(missionId: string): Promise<CallResult<MissionGetResultV1>> {
    return this.call("mission.get", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  /** الإنشاء لا يشغّل شيئًا؛ البدء عملية مستقلّة. */
  createMission(input: CreateMissionInput, idempotencyKey?: string): Promise<CallResult<MissionCreateResultV1>> {
    return this.call("mission.create", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  startMission(missionId: string, idempotencyKey?: string): Promise<CallResult<MissionStartResultV1>> {
    return this.call("mission.start", { mission_id: missionId }, START_TIMEOUT_MS, idempotencyKey);
  }

  cancelMission(missionId: string, idempotencyKey?: string): Promise<CallResult<MissionCancelResultV1>> {
    return this.call("mission.cancel", { mission_id: missionId }, READ_TIMEOUT_MS, idempotencyKey);
  }

  resumeMission(missionId: string, idempotencyKey?: string): Promise<CallResult<MissionResumeResultV1>> {
    return this.call("mission.resume", { mission_id: missionId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── الرسم والوكلاء والحقيقة ───────────────────────────────────────────────

  listTasks(missionId: string): Promise<CallResult<TaskListResultV1>> {
    return this.call("task.list", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  /** أوصاف الأدوار دائمًا، وأمثلة الوكلاء لمهمّة مُسمّاة فقط. */
  listAgents(input: { readonly mission_id?: string } = {}): Promise<CallResult<AgentListResultV1>> {
    return this.call("agent.list", defined(input), READ_TIMEOUT_MS);
  }

  listClaims(missionId: string): Promise<CallResult<ClaimListResultV1>> {
    return this.call("claim.list", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  listEvidence(missionId: string): Promise<CallResult<EvidenceListResultV1>> {
    return this.call("evidence.list", { mission_id: missionId }, READ_TIMEOUT_MS);
  }

  private call<T>(
    operation: Phase03Operation,
    payload: Record<string, unknown>,
    timeoutMs: number,
    idempotencyKey?: string,
  ): Promise<CallResult<T>> {
    return callOperation<T>(this.context, operation, payload, {
      timeoutMs,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }
}
