// سجل حالة الموافقات. مالك «مرة واحدة».
//
// لماذا الحالة هنا لا داخل الإيصال: إيصال يحمل حالته بنفسه لا يمكن أن يمنع
// إعادة استعماله، لأن المهاجم يعيد إرسال النسخة القديمة. الاستهلاك يجب أن
// يُسجَّل في مكان يملكه النظام، ويُقرأ منه.
//
// الاستهلاك يُسجَّل قبل وقوع الأثر لا بعده: انهيارٌ بينهما يترك إيصالًا
// مستهلكًا وأثرًا لم يقع — وهو الاتجاه الآمن. العكس يترك إيصالًا صالحًا وأثرًا
// وقع، أي موافقة واحدة بأثرين.

import type { ApprovalRequest, ApprovalState } from "./types.js";

export interface ApprovalEntry {
  readonly request: ApprovalRequest;
  readonly state: ApprovalState;
  readonly updated_at: string;
}

export type ConsumeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly state: ApprovalState; readonly detail: string };

export class ApprovalRegistry {
  readonly #entries = new Map<string, ApprovalEntry>();

  public register(request: ApprovalRequest, at: string): void {
    this.#entries.set(request.approval_id, { request, state: "PENDING", updated_at: at });
  }

  public get(approvalId: string): ApprovalEntry | undefined {
    return this.#entries.get(approvalId);
  }

  public state(approvalId: string): ApprovalState | undefined {
    return this.#entries.get(approvalId)?.state;
  }

  public settle(approvalId: string, state: ApprovalState, at: string): void {
    const entry = this.#entries.get(approvalId);
    if (entry === undefined) return;
    this.#entries.set(approvalId, { request: entry.request, state, updated_at: at });
  }

  /**
   * يستهلك موافقة ممنوحة. النجاح مرة واحدة فقط، وكل ما عداه رفض مُسمّى.
   * الاستهلاك ذرّي داخل هذه الخريطة: لا يوجد فحص ثم كتابة يفصل بينهما انتظار.
   */
  public consume(approvalId: string, at: string): ConsumeResult {
    const entry = this.#entries.get(approvalId);
    if (entry === undefined) {
      return { ok: false, state: "INVALIDATED", detail: `no approval is registered under ${approvalId}` };
    }
    if (entry.state !== "GRANTED") {
      return { ok: false, state: entry.state, detail: `approval is ${entry.state}, not GRANTED` };
    }
    this.#entries.set(approvalId, { request: entry.request, state: "CONSUMED", updated_at: at });
    return { ok: true };
  }

  /** إبطال كل ما لم يُستهلك بعد. يُستدعى من إيقاف الطوارئ. */
  public invalidateAllPending(at: string): readonly string[] {
    const invalidated: string[] = [];
    for (const [id, entry] of this.#entries) {
      if (entry.state === "PENDING" || entry.state === "GRANTED") {
        this.#entries.set(id, { request: entry.request, state: "INVALIDATED", updated_at: at });
        invalidated.push(id);
      }
    }
    return invalidated;
  }

  public pending(): readonly ApprovalRequest[] {
    return [...this.#entries.values()].filter((e) => e.state === "PENDING").map((e) => e.request);
  }

  public size(): number {
    return this.#entries.size;
  }
}
