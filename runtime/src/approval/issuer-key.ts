// مفتاح تكامل الإيصال.
//
// الادعاء بدقة: إيصال لم يصدره المُصدِر الموثوق لا يمكن أن يحمل ربطًا صحيحًا،
// لأن الربط يحتاج مفتاحًا لا يملكه غيره. هذا يغلق كل مسارات «الموافقة المزيّفة»:
// نصّ نموذج، وJSON ينتجه نموذج، ومخرج أداة، ومحتوى ملف يقول approved=true.
//
// وما لا يُدّعى: ليس توقيعًا، ولا عدم إنكار، ولا مقاومةً لمن يقرأ ذاكرة العملية.
// المفتاح عشوائي لكل عملية، ولا يُكتب في سجل ولا دليل ولا رسالة خطأ، ولا يظهر
// في أي حقل من حقول الإيصال. الحد هنا مُجرَّد عمدًا حتى يحلّ محله مخزن أسرار
// حقيقي دون تغيير المنطق.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface ApprovalIntegrityKey {
  /** اسم الآلية، يظهر في الدليل. لا يظهر المفتاح نفسه أبدًا. */
  readonly mechanism: "HMAC-SHA256-PROCESS-LOCAL";
  bind(payload: string): string;
  verify(payload: string, binding: string): boolean;
}

/**
 * مفتاح محلي للعملية، يُولَّد عشوائيًا عند الإنشاء.
 *
 * لا يوجد على هذا الصنف أي طريقة تُخرج المفتاح. المرجع الوحيد إليه محبوس في
 * حقل خاص، والمُصدِر وحده يحمل المرجع إلى الكائن — طبقة الوكيل لا تستطيع
 * حتى استيراد هذا الملف، ويحرس ذلك اختبار معماري.
 */
export class ProcessLocalApprovalKey implements ApprovalIntegrityKey {
  public readonly mechanism = "HMAC-SHA256-PROCESS-LOCAL" as const;

  readonly #key: Buffer;

  public constructor() {
    this.#key = randomBytes(32);
  }

  public bind(payload: string): string {
    return createHmac("sha256", this.#key).update(payload, "utf8").digest("hex");
  }

  public verify(payload: string, binding: string): boolean {
    const expected = Buffer.from(this.bind(payload), "utf8");
    const actual = Buffer.from(binding, "utf8");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
}
