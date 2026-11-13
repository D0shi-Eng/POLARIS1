// سجل التخطّي المُعلن.
//
// «٤٣٠ اختبارًا، ٤٢٧ نجحت، ٣ تُخطّيت» جملة غير كافية: التخطّي إمّا مشروع وإمّا
// ثغرة، والرقم لا يفرّق بينهما. هذا السجل يجعل كل تخطٍّ مُصنَّفًا بالاسم، ومعه
// من يحمل ادعاءه على ويندوز إن كان يحمله أحد.
//
// المطابقة تجري على **سبب** التخطّي لا على اسم الاختبار: السبب نصّ ثابت يكتبه
// الحارس مرة واحدة ويُشترك فيه كل اختبار يحرسه، فلا ينكسر السجل كلما أُعيدت
// صياغة عنوان اختبار.
//
// الأصناف كما نصّ عليها عقد W6:
//   A  مشروع بحسب المنصّة        — الأداة نفسها غير قابلة للتشغيل هنا
//   B  غير منطبق عن قصد          — الحالة لا توجد على هذه المنصّة أصلًا
//   C  محجوب مؤقتًا              — قابل للقياس نظريًا، ومنعته البيئة
//   D  أمني غير مُقاس            — Phase-00 لا تُغلق ومعه واحد من هذا الصنف

export type SkipClass = "A" | "B" | "C" | "D";

export interface SkipDeclaration {
  /** نصّ السبب كما يظهر بعد `# SKIP` في مخرَج TAP. المطابقة بالاحتواء. */
  readonly reason: string;
  readonly skip_class: SkipClass;
  readonly rationale: string;
  /** من يحمل الادعاء على ويندوز، أو "" إن كان الادعاء لا يخصّ ويندوز. */
  readonly windows_claim_carried_by: string;
  /** هل يمنع ظهور هذا التخطّي إغلاق Phase-00. */
  readonly blocks_closure: boolean;
}

export const SKIP_REGISTRY: readonly SkipDeclaration[] = [
  {
    reason: "no PowerShell interpreter on this host",
    skip_class: "A",
    rationale:
      "the test drives the Windows runner through a PowerShell interpreter. Without one the instrument cannot run at all, and it claims nothing. On the Tier-0 host the interpreter is present and none of these skip.",
    windows_claim_carried_by: "the same tests, running, on the Tier-0 host",
    blocks_closure: false,
  },
  {
    reason: "the /proc handle probe is a Linux-native check",
    skip_class: "A",
    rationale:
      "the probe reads /proc/self/fd to enumerate descriptors. That filesystem does not exist on Windows, so the instrument is platform-wrong there rather than the claim being unmeasured.",
    windows_claim_carried_by: "W-11 (X03 handle inheritance, native, with a positive control)",
    blocks_closure: false,
  },
  {
    reason: "junction creation needs a native Windows run",
    skip_class: "B",
    rationale:
      "the fixture builds a POSIX symlink to make a link that leaves the anchored root. On Windows the equivalent object is a directory junction, which the native runner creates and measures for real; the POSIX fixture would measure nothing there.",
    windows_claim_carried_by: "W-07 (junction escape detected as SYMLINK_ESCAPE) and W-06 (case-insensitive containment)",
    blocks_closure: false,
  },
  {
    reason: "this host does not permit symlink creation",
    skip_class: "C",
    rationale:
      "the host refused to create a symbolic link, so the link-escape fixtures could not be built. This is an environment refusal, not a platform mismatch: the claim is measurable here and was not measured. It did not occur on the Tier-0 host.",
    windows_claim_carried_by: "W-07, native — but the cross-platform executor-resolution claim is unmeasured whenever this appears",
    blocks_closure: true,
  },
];

export function findSkipDeclaration(reason: string): SkipDeclaration | undefined {
  const normalised = reason.trim();
  return SKIP_REGISTRY.find((declaration) => normalised.includes(declaration.reason));
}
