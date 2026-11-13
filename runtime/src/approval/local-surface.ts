// سطح موافقة محلي يملكه المالك.
//
// أدنى ما يكفي لـTier-0، وليس واجهة سطح المكتب النهائية — تلك تخص Phase 01،
// وما هنا مؤقت في شكله، معماري في حدّه: أي واجهة لاحقة تُنفّذ نفس المنفذ.
//
// ما يفرضه هذا الملف صراحةً:
//   - لا موافقة تلقائية: لا يوجد مسار يعيد GRANTED دون استدعاء grant().
//   - لا قيمة افتراضية خطرة: انتهاء المهلة يعود بـEXPIRED دائمًا.
//   - لا تركيز افتراضي على زر خطر: لا يوجد «فعل مقترح» في هذا النموذج أصلًا.
//   - طلب لا يُعرف لا يُحسم: grant() على معرّف مجهول يفشل ولا يُنشئ حالة.
//

import { nowTimestamp } from "../ids.js";
import type { SurfaceDecision, TrustedApprovalSurface } from "./surface.js";
import type { ApprovalRequest } from "./types.js";

type Settle = (decision: SurfaceDecision) => void;

interface PendingPresentation {
  readonly request: ApprovalRequest;
  readonly settle: Settle;
  readonly timer: NodeJS.Timeout;
}

export type PresentationListener = (request: ApprovalRequest) => void;

export interface OwnerControlledSurfaceOptions {
  /** مهلة قصوى للسطح نفسه. القيد الحاكم يبقى expires_at في الطلب. */
  readonly max_wait_ms?: number;
  readonly now?: () => Date;
}

export class OwnerControlledApprovalSurface implements TrustedApprovalSurface {
  public readonly id = "polaris.approval.surface.owner-local.v1";
  public readonly outside_model_control = true as const;

  readonly #pending = new Map<string, PendingPresentation>();
  readonly #listeners: PresentationListener[] = [];
  readonly #maxWaitMs: number;
  readonly #now: () => Date;

  public constructor(options: OwnerControlledSurfaceOptions = {}) {
    this.#maxWaitMs = options.max_wait_ms ?? 300000;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /** يُخطر الطرف المالك بأن طلبًا صار معروضًا. للعرض، لا للحسم. */
  public onPresented(listener: PresentationListener): void {
    this.#listeners.push(listener);
  }

  public present(request: ApprovalRequest): Promise<SurfaceDecision> {
    return new Promise<SurfaceDecision>((resolve) => {
      const remaining = Date.parse(request.expires_at) - this.#now().getTime();
      const wait = Math.max(0, Math.min(this.#maxWaitMs, remaining));

      const settle: Settle = (decision) => {
        const entry = this.#pending.get(request.approval_id);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.#pending.delete(request.approval_id);
        resolve(decision);
      };

      // المؤقّت يبقى ممسكًا بحلقة الأحداث عمدًا. طلب موافقة معروض هو عمل معلّق
      // حقيقي ينتظر إنسانًا؛ لو أُطلق (unref) لَخرجت العملية تاركةً الوعد بلا
      // حسم، ولصار «لا أثر» ناتجًا عن الخروج لا عن انتهاء المهلة. يُمسح فور
      // الحسم، فلا يطيل عمر العملية بعد انتهاء الانتظار.
      const timer = setTimeout(() => {
        settle({ kind: "EXPIRED", at: nowTimestamp() });
      }, wait);

      this.#pending.set(request.approval_id, { request, settle, timer });
      for (const listener of this.#listeners) listener(request);
    });
  }

  public pending(): readonly ApprovalRequest[] {
    return [...this.#pending.values()].map((p) => p.request);
  }

  /** فعل المالك الصريح. هذا هو المسار الوحيد إلى GRANTED في هذا البناء. */
  public grant(approvalId: string): boolean {
    return this.#settleExplicitly(approvalId, "GRANTED");
  }

  public reject(approvalId: string): boolean {
    return this.#settleExplicitly(approvalId, "REJECTED");
  }

  /** يُنهي كل ما هو معروض بلا أثر. يستدعيه إيقاف الطوارئ. */
  public expireAll(): readonly string[] {
    const ids = [...this.#pending.keys()];
    for (const id of ids) this.#settleExplicitly(id, "EXPIRED");
    return ids;
  }

  #settleExplicitly(approvalId: string, kind: SurfaceDecision["kind"]): boolean {
    const entry = this.#pending.get(approvalId);
    if (entry === undefined) return false;
    entry.settle({ kind, at: nowTimestamp() });
    return true;
  }
}
