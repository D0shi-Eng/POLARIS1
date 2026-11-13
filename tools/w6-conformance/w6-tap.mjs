// قارئ TAP على مستوى الاختبار الواحد.
//
// المستخرِج الموجود في W5 يقرأ الملخّص: كم اختبارًا، وكم فشل. وذلك كافٍ لحكم
// مجموعة، وغير كافٍ لحكم سيناريو: السيناريو يمتد على اختبارات بعينها داخل
// مجموعة، فيلزم اسم كل اختبار ونتيجته وسبب تخطّيه إن تُخطّي.
//
// القراءة سطرية ومتحفّظة: لا يُفترض ترتيب، ولا تُقرأ كتلة YAML التشخيصية، ولا
// يُخمَّن شيء عند غموض السطر. سطرٌ لا يطابق شكل نتيجة TAP ليس نتيجة.

import { stripAnsi } from "../w5-conformance/w5-test-group-contract.mjs";

const RESULT = /^(ok|not ok)\s+(\d+)\s*-\s*(.*)$/;
const DIRECTIVE = /\s+#\s*(SKIP|TODO)\b\s*(.*)$/i;

/**
 * يعيد نتائج الاختبارات المفردة.
 *
 * كل نتيجة: { number, name, ok, skipped, todo, directive_reason }.
 * التخطّي ليس نجاحًا ولا فشلًا: TAP يكتبه `ok ... # SKIP <reason>`، فالعلم
 * يُقرأ من التوجيه لا من `ok`.
 */
export function parseTapResults(output) {
  const results = [];
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const line = raw.trim();
    const match = RESULT.exec(line);
    if (match === null) continue;
    let name = match[3];
    let skipped = false;
    let todo = false;
    let reason = "";
    const directive = DIRECTIVE.exec(name);
    if (directive !== null) {
      skipped = directive[1].toUpperCase() === "SKIP";
      todo = directive[1].toUpperCase() === "TODO";
      reason = directive[2].trim();
      name = name.slice(0, directive.index).trim();
    }
    results.push({
      number: Number(match[2]),
      name,
      ok: match[1] === "ok" && !skipped,
      failed: match[1] === "not ok",
      skipped,
      todo,
      directive_reason: reason,
    });
  }
  return results;
}
