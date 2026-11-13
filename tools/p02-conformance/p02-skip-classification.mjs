// تصنيف التخطّي في مجموعات Node التابعة لـPhase-02.
//
// العيب الذي أغلقه هذا الملف
// (P02_RUNTIME_SKIP_CLASSIFIER_NOT_USING_FROZEN_W6_SKIP_INVENTORY):
// كان حَكَم المجموعات يقرأ من الملخّص عدد المتخطّى وحده، فإن كان أكبر من صفر
// أصدر INCONCLUSIVE/UNEXPLAINED_SKIP. وهو حكم صادق في مبناه: تخطٍّ بلا اسم ولا
// سبب لا يُفرَّق عن ثغرة. لكنه كان يصدره حتى حين يكون السبب مُعلنًا ومُصنَّفًا
// منذ Phase-00، لأن القارئ كان يُسقِط نصّ `# SKIP <reason>` من سطر TAP فلا يبقى
// في السجل ما يُقابَل به الإعلان. أي: القياس لم يكن يجمع المعلومة التي يحكم
// بغيابها.
//
// العلاج ليس قائمة سماح ثانية في Phase-02: السجل المُجمَّد يعيش في طبقة التشغيل
// (runtime/tests/w6-skip-registry.ts) ويُختبر هناك تحت W6-K. هذا الملف يستهلكه
// كما يستهلكه جرد W6، فمصدر الحقيقة واحد ولا تنجرف نسختان.
//
// المطابقة على **نصّ السبب** لا على اسم الاختبار، كما نصّ عليه عقد W6: السبب
// ثابت يكتبه الحارس مرة واحدة، والاسم يُعاد صوغه. واسم الاختبار يُحفَظ في السجل
// مع ذلك، فهُويّة ما تُخطّي لا تضيع من الدليل ولو لم تكن مفتاح البحث.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** موضع السجل المُجمَّد داخل بناء طبقة التشغيل. لا نسخة ثانية منه هنا. */
export const SKIP_REGISTRY_MODULE = join("runtime", "dist", "tests", "w6-skip-registry.js");

/**
 * يحمّل السجل المُجمَّد من البناء. الفشل ليس تفصيلًا يُتسامح فيه: بلا سجل لا
 * تصنيف، وبلا تصنيف لا يجوز اعتبار تخطٍّ مشروعًا.
 */
export async function loadSkipRegistry(root) {
  const url = pathToFileURL(join(root, SKIP_REGISTRY_MODULE)).href;
  try {
    const module = await import(url);
    if (typeof module.findSkipDeclaration !== "function") {
      return { registry: null, error: "SKIP_REGISTRY_MALFORMED: findSkipDeclaration is not a function" };
    }
    return { registry: module, error: "" };
  } catch (error) {
    return { registry: null, error: `SKIP_REGISTRY_UNAVAILABLE: ${error?.message ?? String(error)}` };
  }
}

/**
 * يصنّف سجلات التخطّي المرصودة مقابل السجل المُعلن.
 *
 * `skips`   : [{ name, reason, directive }] — `directive` إمّا SKIP أو TODO.
 * `expected`: عدد المتخطّى كما قاله ملخّص المشغّل (skipped + todo)، أو null.
 * `registry`: وحدة السجل المُجمَّد، أو null إن تعذّر تحميلها.
 *
 * الترتيب فاصل: كل شرط أدناه يُغلق الباب، ولا يُرقّى شيء إلى PASS بعد فتحه.
 */
export function classifySkips(skips, expected, registry) {
  if (registry === null || registry === undefined) {
    return { verdict: "BLOCKED", reason: "SKIP_REGISTRY_UNAVAILABLE", records: [], summary: emptySummary(skips.length) };
  }
  if (expected === null || expected === undefined) {
    return { verdict: "INCONCLUSIVE", reason: "SKIP_SUMMARY_NOT_PARSED", records: [], summary: emptySummary(skips.length) };
  }
  // العدّ من مصدرين: سطور النتائج والملخّص. اختلافهما يعني أن أحدهما لا يُقرأ،
  // فثمّة تخطٍّ لم يصل إلى التصنيف أصلًا — وهو بالضبط ما لا يجوز التسامح فيه.
  if (skips.length !== expected) {
    return {
      verdict: "INCONCLUSIVE",
      reason: `SKIP_COUNT_DOES_NOT_RECONCILE (records=${String(skips.length)}, summary=${String(expected)})`,
      records: [],
      summary: emptySummary(skips.length),
    };
  }

  const records = skips.map((skip) => {
    // التوجيه TODO ليس تخطّيًا مُعلنًا: السجل يُعلن أسباب SKIP وحدها، فيبقى
    // TODO غير مصنَّف حتى يُعلَن صراحةً. اختبارٌ مؤجَّل ادعاءٌ بلا قياس.
    const declaration = skip.directive === "SKIP" ? registry.findSkipDeclaration(skip.reason ?? "") : undefined;
    const skipClass = declaration?.skip_class ?? "UNCLASSIFIED";
    return {
      test_name: skip.name,
      reason: skip.reason ?? "",
      directive: skip.directive ?? "SKIP",
      class: skipClass,
      rationale: declaration?.rationale ?? "",
      claim_owner: declaration?.windows_claim_carried_by ?? "",
      platform_legitimate: skipClass === "A" || skipClass === "B",
      security_critical: skipClass === "D",
      blocks_closure: declaration === undefined ? true : declaration.blocks_closure,
    };
  });

  const summary = summarise(records);
  if (summary.unexplained > 0) return { verdict: "INCONCLUSIVE", reason: "UNEXPLAINED_SKIP", records, summary };
  if (summary.security_critical > 0) return { verdict: "BLOCKED", reason: "SECURITY_CRITICAL_SKIP_UNMEASURED", records, summary };
  if (summary.blocking > 0) return { verdict: "BLOCKED", reason: "SKIP_BLOCKS_CLOSURE", records, summary };
  return { verdict: "PASS", reason: "", records, summary };
}

function emptySummary(skipped) {
  return { skipped, declared_nonblocking: 0, unexplained: 0, blocking: 0, security_critical: 0, by_class: { A: 0, B: 0, C: 0, D: 0, UNCLASSIFIED: 0 } };
}

function summarise(records) {
  const summary = emptySummary(records.length);
  for (const record of records) {
    summary.by_class[record.class] = (summary.by_class[record.class] ?? 0) + 1;
    if (record.class === "UNCLASSIFIED") summary.unexplained += 1;
    if (record.security_critical) summary.security_critical += 1;
    if (record.blocks_closure) summary.blocking += 1;
    else if (record.class !== "UNCLASSIFIED") summary.declared_nonblocking += 1;
  }
  return summary;
}
