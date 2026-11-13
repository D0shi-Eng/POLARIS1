// دفتر سجلات رفع التصنيف.
//
// قاعدة ملكية صارمة: الكتابة في هذا الدفتر ملك خدمة الـDeclassifier وحدها.
// طبقة الوكيل لا تستورد هذا الملف إطلاقًا (يحرسه اختبار معمارية)، ولا يوجد
// مسار يجعل الوكيل يكتب سجلًا "ناجحًا" لنفسه.
//
// PDP يقرأ عبر DeclassificationReader فقط: قراءة، بلا إصدار.

import type { EffectAction } from "../effects.js";
import type { DeclassificationRecord } from "./record.js";

export interface DeclassificationQuery {
  readonly correlation_id: string;
  readonly action: EffectAction;
  readonly value: string;
}

/** الواجهة التي يراها PDP وكل مستهلك آخر: بحث فقط. */
export interface DeclassificationReader {
  find(query: DeclassificationQuery): DeclassificationRecord | undefined;
  records(): readonly DeclassificationRecord[];
}

function key(correlationId: string, action: EffectAction, value: string): string {
  return `${correlationId} ${action} ${value}`;
}

export class DeclassificationLedger implements DeclassificationReader {
  readonly #byKey = new Map<string, DeclassificationRecord>();
  readonly #ordered: DeclassificationRecord[] = [];

  /** يُستدعى من خدمة الـDeclassifier فقط. */
  public issue(record: DeclassificationRecord): DeclassificationRecord {
    this.#byKey.set(key(record.correlation_id, record.purpose.action, record.output_value), record);
    this.#ordered.push(record);
    return record;
  }

  /**
   * البحث مقيّد بالغرض: نفس القيمة ونفس السلسلة لكن بفعل آخر لا تطابق.
   * هذا هو ربط الغرض عمليًا، لا وصفًا في وثيقة.
   */
  public find(query: DeclassificationQuery): DeclassificationRecord | undefined {
    return this.#byKey.get(key(query.correlation_id, query.action, query.value));
  }

  public records(): readonly DeclassificationRecord[] {
    return this.#ordered;
  }

  /** عرض للقراءة فقط، يُسلَّم للمستهلكين بدل الدفتر نفسه. */
  public reader(): DeclassificationReader {
    return {
      find: (query) => this.find(query),
      records: () => this.records(),
    };
  }
}
