// وسوم التلوث وقواعد انتشارها. المفردات مأخوذة حرفيًا من عقد W2
// (provenance.schema.json) حتى لا توجد مفردة تلوث ثانية موازية للعقد.

export const TAINT_LABELS = [
  "UNTRUSTED_WEB",
  "UNTRUSTED_EMAIL",
  "UNTRUSTED_FILE",
  "MODEL_GENERATED",
  "USER_SUPPLIED",
  "SYSTEM_DERIVED",
] as const;

export type TaintLabel = (typeof TAINT_LABELS)[number];

/**
 * الوسوم التي تجعل القيمة غير موثوقة كوسيطة فعل.
 * MODEL_GENERATED من ضمنها بقرار صريح: مخرج النموذج ليس موثوقًا لأنه معقول.
 */
const UNTRUSTED: ReadonlySet<TaintLabel> = new Set<TaintLabel>([
  "UNTRUSTED_WEB",
  "UNTRUSTED_EMAIL",
  "UNTRUSTED_FILE",
  "MODEL_GENERATED",
]);

export function isTaintLabel(value: unknown): value is TaintLabel {
  return typeof value === "string" && (TAINT_LABELS as readonly string[]).includes(value);
}

/** هل تحمل هذه المجموعة وسمًا واحدًا على الأقل يمنع استعمالها كوسيطة فعل بلا رفع تصنيف. */
export function carriesUntrustedTaint(labels: readonly TaintLabel[]): boolean {
  return labels.some((label) => UNTRUSTED.has(label));
}

export function untrustedSubset(labels: readonly TaintLabel[]): readonly TaintLabel[] {
  return sortLabels(labels.filter((label) => UNTRUSTED.has(label)));
}

function sortLabels(labels: readonly TaintLabel[]): TaintLabel[] {
  return [...new Set(labels)].sort((a, b) => TAINT_LABELS.indexOf(a) - TAINT_LABELS.indexOf(b));
}

/**
 * الدمج اتحاد فقط. لا توجد عملية طرح في هذه الوحدة إطلاقًا:
 * إسقاط وسم لا يحدث إلا عبر سجل رفع تصنيف موقّع من خدمة الـDeclassifier،
 * ولا يحدث أبدًا عند التسلسل ولا عند عبور حدّ أداة.
 */
export function mergeTaint(...groups: ReadonlyArray<readonly TaintLabel[]>): readonly TaintLabel[] {
  return sortLabels(groups.flat());
}

/** قراءة وسوم من مستند عقد، مع تجاهل أي قيمة ليست وسمًا معروفًا. */
export function readTaint(value: unknown): readonly TaintLabel[] {
  return Array.isArray(value) ? sortLabels(value.filter(isTaintLabel)) : [];
}

/**
 * وسم افتراضي لوسيطة فعل مشتقة من النموذج (القاعدة الثابتة في W4 §20).
 * لا يوجد مسار يجعل وسيطة مقترحة من النموذج بلا هذا الوسم.
 */
export const MODEL_PARAMETER_DEFAULT_TAINT: readonly TaintLabel[] = ["MODEL_GENERATED"];
