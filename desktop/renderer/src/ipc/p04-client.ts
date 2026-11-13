// العميل المُصنَّف لـPhase-04: اثنتا عشرة دالّة، واحدة لكل عملية في السجل.
//
// القاعدة نفسها: لا دالّة عامة تقبل اسم عملية، ولا حمولة تسمّي فعلًا.
//
// وما لا يوجد في هذا الملف هو الخاصيّة الأمنية: لا `executeTool`، ولا `callTool`،
// ولا `callMcp`. العارض يقرأ السجل ويجيب موافقة؛ ولا يملك مسارًا ينفّذ أداة.

import type {
  ApprovalListResultV1,
  McpConfigureResultV1,
  McpListResultV1,
  McpRefreshResultV1,
  McpRegisterResultV1,
  SkillConfigureResultV1,
  SkillGetResultV1,
  SkillListResultV1,
  ToolActivityListResultV1,
  ToolApprovalRespondResultV1,
  ToolEffect,
  ToolGetResultV1,
  ToolListResultV1,
  ToolProvider,
} from "../generated/types/desktop-p04-result-v1";
import { callOperation, type CallContext, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { Phase04Operation } from "./operations";
import type { Transport } from "./transport";

/** مهلة القراءة العادية. */
const READ_TIMEOUT_MS = 8_000;
/** الكتابة في المخزن. */
const WRITE_TIMEOUT_MS = 12_000;
/**
 * التحديث يلمس الشبكة فعلًا: يهيّئ الخادم ثم يسأله عن أدواته. المهلة هنا هامش
 * نقل فوق مهلة المضيف، ولا تُقصّر التحقق: المضيف هو من يفرض المهلة الحقيقية.
 */
const REFRESH_TIMEOUT_MS = 30_000;

export interface Phase04ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

export interface RegisterServerInput {
  readonly name: string;
  /** نقطة على الحلقة المحلية وحدها. المضيف يحلّها من جديد ويرفض ما عداها. */
  readonly endpoint: string;
  readonly granted_effects?: readonly ToolEffect[];
}

/** يحذف الحقول غير المُعرَّفة: الحمولة مغلقة، و`undefined` ليس قيمة في العقد. */
function defined<T extends object>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export class Phase04Client {
  private readonly context: CallContext;

  constructor(options: Phase04ClientOptions) {
    this.context = {
      transport: options.transport,
      identity: options.identity,
      newId: options.newId,
      clock: options.clock,
    };
  }

  // ── المهارات ──────────────────────────────────────────────────────────────

  listSkills(): Promise<CallResult<SkillListResultV1>> {
    return this.call("skill.list", {}, READ_TIMEOUT_MS);
  }

  /** المهارة وأدواتها المسجَّلة معًا: اسمٌ بلا واصف يعني أداة لا وجود لها. */
  getSkill(skillId: string): Promise<CallResult<SkillGetResultV1>> {
    return this.call("skill.get", { skill_id: skillId }, READ_TIMEOUT_MS);
  }

  /** التفعيل وحده قابل للتغيير: لا توسيع لأدوات المهارة ولا لصنف خطرها. */
  configureSkill(skillId: string, enabled: boolean, idempotencyKey?: string): Promise<CallResult<SkillConfigureResultV1>> {
    return this.call("skill.configure", { skill_id: skillId, enabled }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── الأدوات ───────────────────────────────────────────────────────────────

  listTools(
    input: { readonly provider?: ToolProvider; readonly skill_id?: string } = {},
  ): Promise<CallResult<ToolListResultV1>> {
    return this.call("tool.list", defined(input), READ_TIMEOUT_MS);
  }

  /** قراءة واصف. القراءة ليست إذنًا، وهذه العملية لا تنفّذ شيئًا. */
  getTool(toolId: string): Promise<CallResult<ToolGetResultV1>> {
    return this.call("tool.get", { tool_id: toolId }, READ_TIMEOUT_MS);
  }

  listActivity(
    input: { readonly mission_id?: string; readonly limit?: number } = {},
  ): Promise<CallResult<ToolActivityListResultV1>> {
    return this.call("tool.activity.list", defined(input), READ_TIMEOUT_MS);
  }

  // ── خوادم MCP ─────────────────────────────────────────────────────────────

  listServers(): Promise<CallResult<McpListResultV1>> {
    return this.call("mcp.list", {}, READ_TIMEOUT_MS);
  }

  /** التسجيل لا يكتشف شيئًا ولا يمنح شيئًا فوق السقف الذي يسمّيه المستخدم. */
  registerServer(input: RegisterServerInput, idempotencyKey?: string): Promise<CallResult<McpRegisterResultV1>> {
    return this.call("mcp.register", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  configureServer(serverId: string, enabled: boolean, idempotencyKey?: string): Promise<CallResult<McpConfigureResultV1>> {
    return this.call("mcp.configure", { server_id: serverId, enabled }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  /** إعادة الاكتشاف. كل أداة تُتحقَّق من جديد، وكل مرفوضة تُبلَّغ بسببها. */
  refreshServer(serverId: string, idempotencyKey?: string): Promise<CallResult<McpRefreshResultV1>> {
    return this.call("mcp.refresh", { server_id: serverId }, REFRESH_TIMEOUT_MS, idempotencyKey);
  }

  // ── الموافقات ─────────────────────────────────────────────────────────────

  listApprovals(input: { readonly mission_id?: string } = {}): Promise<CallResult<ApprovalListResultV1>> {
    return this.call("approval.list", defined(input), READ_TIMEOUT_MS);
  }

  /**
   * جواب على موافقة بمعرّفها.
   *
   * الحمولة لا تستطيع أن تعيد ذكر الأداة ولا الحجج ولا الأثر: الرباط ثُبِّت حين
   * طُلبت الموافقة، والجواب لا يحمل إلا القرار.
   */
  respondToApproval(
    approvalId: string,
    decision: "GRANT" | "DENY",
    idempotencyKey?: string,
    scope: "ONCE" | "MISSION" = "ONCE",
  ): Promise<CallResult<ToolApprovalRespondResultV1>> {
    // ADR-042: «لهذه المهمّة» صراحةً؛ «مرّة» لا تُرسل حقلًا فتبقى الحمولة كما كانت.
    const payload = scope === "MISSION" ? { approval_id: approvalId, decision, scope } : { approval_id: approvalId, decision };
    return this.call("tool.approval.respond", payload, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  private call<T>(
    operation: Phase04Operation,
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
