// العميل المُصنَّف لـPhase-05: اثنتا عشرة دالّة، واحدة لكل عملية في السجل.
//
// وما لا يوجد في هذا الملف هو الخاصيّة الأمنية: لا `navigate` ولا `click` ولا `type`
// ولا `trustMemory`. العارض يقرأ الذاكرة والجلسات، ويحذف ذاكرة يملكها المستخدم،
// ويمنح نافذة لمهمّة، ويوقف جلسة. الفعل على الويب أو الشاشة يبدأ من زمن تشغيل
// المهمّة الموثوق وحده، عبر بوابة الأدوات.

import type {
  BrowserSessionGetResultV1,
  BrowserSessionListResultV1,
  ComputerSessionGetResultV1,
  ComputerSessionListResultV1,
  ComputerTargetGrantResultV1,
  ComputerTargetRevokeResultV1,
  ComputerWindowListResultV1,
  MemoryDeleteResultV1,
  MemoryGetResultV1,
  MemoryListResultV1,
  SessionCancelResultV1,
} from "../generated/types/desktop-p05-result-v1";
import { callOperation, type CallContext, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { Phase05Operation } from "./operations";
import type { Transport } from "./transport";

const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 12_000;

export interface Phase05ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

export interface MemoryListInput {
  readonly scope?: "MISSION" | "PROJECT" | "USER" | "SYSTEM";
  readonly memory_type?: "WORKING" | "EPISODIC" | "SEMANTIC" | "PREFERENCE" | "PROJECT";
  readonly status?: "ACTIVE" | "SUPERSEDED" | "EXPIRED" | "DELETED";
  readonly mission_id?: string;
  readonly project_id?: string;
  readonly text?: string;
  readonly limit?: number;
}

/** يحذف الحقول غير المُعرَّفة والنصوص الفارغة: الحمولة مغلقة. */
function defined<T extends object>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

export class Phase05Client {
  private readonly context: CallContext;

  constructor(options: Phase05ClientOptions) {
    this.context = { transport: options.transport, identity: options.identity, newId: options.newId, clock: options.clock };
  }

  // ── الذاكرة ───────────────────────────────────────────────────────────────

  listMemories(input: MemoryListInput = {}): Promise<CallResult<MemoryListResultV1>> {
    return this.call("memory.list", defined(input), READ_TIMEOUT_MS);
  }

  getMemory(memoryId: string): Promise<CallResult<MemoryGetResultV1>> {
    return this.call("memory.get", { memory_id: memoryId }, READ_TIMEOUT_MS);
  }

  /** حذف حقيقي من المخزن: المحتوى والموضوع والمراجع تُمحى، لا تُخفى. */
  deleteMemory(memoryId: string, idempotencyKey?: string): Promise<CallResult<MemoryDeleteResultV1>> {
    return this.call("memory.delete", { memory_id: memoryId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── المتصفّح ──────────────────────────────────────────────────────────────

  listBrowserSessions(input: { readonly mission_id?: string } = {}): Promise<CallResult<BrowserSessionListResultV1>> {
    return this.call("browser.session.list", defined(input), READ_TIMEOUT_MS);
  }

  getBrowserSession(sessionId: string): Promise<CallResult<BrowserSessionGetResultV1>> {
    return this.call("browser.session.get", { session_id: sessionId }, READ_TIMEOUT_MS);
  }

  stopBrowserSession(sessionId: string, idempotencyKey?: string): Promise<CallResult<SessionCancelResultV1>> {
    return this.call("browser.session.cancel", { session_id: sessionId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── الحاسوب ───────────────────────────────────────────────────────────────

  listComputerSessions(input: { readonly mission_id?: string } = {}): Promise<CallResult<ComputerSessionListResultV1>> {
    return this.call("computer.session.list", defined(input), READ_TIMEOUT_MS);
  }

  getComputerSession(sessionId: string): Promise<CallResult<ComputerSessionGetResultV1>> {
    return this.call("computer.session.get", { session_id: sessionId }, READ_TIMEOUT_MS);
  }

  stopComputerSession(sessionId: string, idempotencyKey?: string): Promise<CallResult<SessionCancelResultV1>> {
    return this.call("computer.session.cancel", { session_id: sessionId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  /** جرد النوافذ للمستخدم ليمنح إحداها. لا يصل هذا الجرد إلى أي نموذج. */
  listWindows(input: { readonly mission_id?: string } = {}): Promise<CallResult<ComputerWindowListResultV1>> {
    return this.call("computer.window.list", defined(input), READ_TIMEOUT_MS);
  }

  /** يمنح نافذة لمهمّة واحدة. المضيف يقرأ هويّتها من النظام، لا من هذا الطلب. */
  grantWindow(missionId: string, hwnd: string, idempotencyKey?: string): Promise<CallResult<ComputerTargetGrantResultV1>> {
    return this.call("computer.target.grant", { mission_id: missionId, hwnd }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  revokeWindow(grantId: string, idempotencyKey?: string): Promise<CallResult<ComputerTargetRevokeResultV1>> {
    return this.call("computer.target.revoke", { grant_id: grantId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  private call<T>(operation: Phase05Operation, payload: Record<string, unknown>, timeoutMs: number, idempotencyKey?: string): Promise<CallResult<T>> {
    return callOperation<T>(this.context, operation, payload, { timeoutMs, ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) });
  }
}
