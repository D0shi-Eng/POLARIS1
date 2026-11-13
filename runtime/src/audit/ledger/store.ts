// منفذ التخزين للدفتر.
//
// حدٌّ لا تطبيق: السلسلة تلحق، والمخزن يحفظ. W5 يشحن تطبيقًا واحدًا في الذاكرة
// ويصرّح بحدوده. الاستمرارية عبر إعادة التشغيل ليست مُدّعاة في W5 — نفس الموقف
// الذي تتخذه ADR-003 §2 تجاه الإعدادات، ولنفس السبب: مخزن دائم يفرض حدودًا
// معمارية (من يملك الملف، ومن يُصلح التلف، وماذا يعني قفل) لا تُحسم عرضًا.
//
// اللحاق فقط: لا يوجد update ولا delete في هذا المنفذ، لأن دفترًا يقبلهما
// ليس دفتر لحاق مهما وُصف.

import type { AuditLedgerRecord } from "./record.js";

export interface LedgerStore {
  readonly id: string;
  /** هل يبقى المحتوى بعد انتهاء العملية. false يعني: لا تدّعِ استمرارية. */
  readonly durable: boolean;
  append(record: AuditLedgerRecord): void;
  /** كل السجلات بترتيب اللحاق. نسخة للقراءة، لا مرجع قابل للتعديل. */
  all(): readonly AuditLedgerRecord[];
  count(): number;
  /** آخر سجل، أو undefined على دفتر فارغ. */
  last(): AuditLedgerRecord | undefined;
}

/** دفتر Tier-0 في الذاكرة. لا يدّعي استمرارية، ويقول ذلك في durable. */
export class MemoryLedgerStore implements LedgerStore {
  public readonly id = "polaris.audit.ledger.memory.v1";
  public readonly durable = false;

  readonly #records: AuditLedgerRecord[] = [];

  public append(record: AuditLedgerRecord): void {
    this.#records.push(record);
  }

  public all(): readonly AuditLedgerRecord[] {
    return [...this.#records];
  }

  public count(): number {
    return this.#records.length;
  }

  public last(): AuditLedgerRecord | undefined {
    return this.#records[this.#records.length - 1];
  }
}
