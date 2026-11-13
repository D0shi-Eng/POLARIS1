// منفذ الرصد المحصور.
//
// لماذا لا يقرأ المُثبِت الملف بنفسه: لأن قراءة خام تعني أن الإثبات يستند إلى
// مسار غير مصرَّح به وغير مُدقَّق. الرصد هنا يمر بنفس السلسلة التي يمر بها أي
// أثر — بوابة، سياسة، نقطة فرض، منفّذ محصور — فيصير الرصد نفسه مُصرَّحًا
// ومسجَّلًا، ويصير تعذّره حدثًا لا صمتًا.

export interface ConfinedObservation {
  readonly ok: boolean;
  readonly invocation_id: string | null;
  readonly content_sha256: string | null;
  readonly bytes: number | null;
  readonly detail: string;
}

export interface ConfinedObserver {
  readonly id: string;
  /** يقرأ الهدف عبر مسار الفرض العادي. لا مسار مختصر، ولا امتياز إضافي. */
  observe(logicalTarget: string): Promise<ConfinedObservation>;
}
