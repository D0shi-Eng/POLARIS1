// عقد بايتات دليل POLARIS — الجانب العُقدي (Node).
//
// نفس العقد الذي يفرضه tools/evidence-contract/json-evidence.ps1 على جانب
// PowerShell، مصوغًا هنا للمستهلكين. القاعدة واحدة ولا تُخفَّف:
//
//     UTF-8، بلا BOM، وثيقة JSON صالحة، نهايات LF.
//
// ولماذا لا يُقشَّر الـBOM عند القراءة: text.replace(/^\uFEFF/, "") يجعل دليلًا
// فاسدًا مقبولًا ويُبقي الكاتب المنحرف حيًّا. القارئ هنا يُشخّص ويرفض.
//
// ── عقد سطر الأوامر (أُضيف في معالجة E9 الجنائية) ──────────────────────────
//
//   الدخل    : ملف دليل واحد مُسمّى صراحةً بعد --classify
//   الخرج    : وثيقة JSON واحدة، UTF-8 بلا BOM، على stdout ولا شيء سواها
//   التشخيص  : stderr وحده
//   الخروج   : 0 إن أُنتج التصنيف المطلوب فعلًا، وغير صفري إن أخفقت البنية
//   ومحظور قطعًا: الخروج بالرمز صفر ومخرَج فارغ.
//
// المستهلك لا يُطالَب بأي معالجة مسبقة: لا تقشير BOM، ولا `stdout || "{}"`،
// ولا التقاط استثناء يُعيد نتيجة مُلفَّقة. عقدٌ يحتاج ترقيعًا عند القارئ ليس
// عقدًا.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EVIDENCE_ENCODING_OK = "EVIDENCE_UTF8_NO_BOM";
export const EVIDENCE_UTF8_BOM_PRESENT = "EVIDENCE_UTF8_BOM_PRESENT";
export const EVIDENCE_UTF16_BOM_PRESENT = "EVIDENCE_UTF16_BOM_PRESENT";
export const EVIDENCE_FILE_EMPTY = "EVIDENCE_FILE_EMPTY";
export const EVIDENCE_FILE_MISSING = "EVIDENCE_FILE_MISSING";

/** بصمة البايتات الأولى كنصّ سداسي عشري، للتشخيص لا للمقارنة المنطقية. */
export function hexPrefix(buffer, count = 4) {
  return Array.from(buffer.subarray(0, count))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

/** التصنيف يقع على البايتات، قبل أي فكّ ترميز. */
export function classifyEvidenceBytes(buffer) {
  const first = hexPrefix(buffer, 4);
  if (buffer.length === 0) {
    return { ok: false, reason_code: EVIDENCE_FILE_EMPTY, first_bytes: "", length: 0 };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { ok: false, reason_code: EVIDENCE_UTF8_BOM_PRESENT, first_bytes: first, length: buffer.length };
  }
  if (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    return { ok: false, reason_code: EVIDENCE_UTF16_BOM_PRESENT, first_bytes: first, length: buffer.length };
  }
  return { ok: true, reason_code: EVIDENCE_ENCODING_OK, first_bytes: first, length: buffer.length };
}

/**
 * تعذُّر القراءة كلّه يُسمّى غيابًا، لا استثناءً يتسرّب.
 *
 * كان الفحص على statSync وحده، فمسارٌ يُحصى ولا يُقرأ (مجلد، أو منعُ وصول)
 * يرمي من readFileSync بعد أن أعلن التصنيف نجاحه. الجانب المُقابل داخل طبقة
 * التشغيل (runtime/tests/evidence-bytes.ts) يلتقط القراءة نفسها، والتطابق
 * بين التطبيقين جزء من العقد لا مصادفة.
 */
export function classifyEvidenceFile(path) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return { ok: false, reason_code: EVIDENCE_FILE_MISSING, first_bytes: "", length: 0, path };
  }
  return { ...classifyEvidenceBytes(buffer), path };
}

export class EvidenceEncodingError extends Error {
  constructor(classification) {
    super(
      `${classification.reason_code}: ${String(classification.path ?? "<buffer>")} (first bytes: ${classification.first_bytes})`,
    );
    this.name = "EvidenceEncodingError";
    this.reason_code = classification.reason_code;
    this.classification = classification;
  }
}

/** يقرأ دليلًا قانونيًا. البايتات تُثبت أولًا، ثم يُفكّ الترميز. */
export function readCanonicalEvidenceText(path) {
  const classification = classifyEvidenceFile(path);
  if (!classification.ok) throw new EvidenceEncodingError(classification);
  return readFileSync(path, "utf8");
}

export function readCanonicalEvidenceJson(path) {
  return JSON.parse(readCanonicalEvidenceText(path));
}

/** يُثبت أن ما كُتب مطابق للعقد. كاتبٌ لا يقرأ ما كتبه لا يُثبت شيئًا. */
export function assertWrittenEvidence(path) {
  const classification = classifyEvidenceFile(path);
  if (!classification.ok) throw new EvidenceEncodingError(classification);
  return classification;
}

// ── نقطة الدخول: العيب الذي أسقط E9، ولماذا سقط على ويندوز وحده ─────────────
//
// الحارس السابق كان:
//
//     import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
//
// وهو تركيبُ سلسلةٍ يدويّ ثم مقارنةُ سلسلةٍ بسلسلة. على ويندوز الأصلي يكون
// process.argv[1] هو "D:\\POLARIS\\tools\\evidence-contract\\evidence-bytes.mjs"،
// فتُنتج التركيبة "file://D:/POLARIS/..." بشرطتين، بينما import.meta.url هو
// "file:///D:/POLARIS/..." بثلاث. فتفشل المقارنة، فلا يُنفَّذ فرع سطر الأوامر،
// فينتهي المفسّر بالرمز صفر ومخرَج فارغ. والمستهلك يستلم سلسلة فارغة فيسقط عند
// JSON.parse برسالة "Unexpected end of JSON input" — وهي بالضبط رسالة E9.
//
// لم يمسكه المضيف اللينكسي لأن "file://" + "/home/..." يعطي ثلاث شرطات صدفةً.
// والعطل نفسه يقع على POSIX متى حمل المسار محرفًا يُرمَّز بالمئة — مسافة أو
// حرفًا غير لاتيني — لأن import.meta.url يُرمِّزه والتركيبة اليدوية لا تُرمِّزه.
// ذلك هو الضبط الموجب الذي يُعيد إنتاج العطل على أي مضيف.
//
// الإصلاح: المقارنة تقع على عناوين file: مُسلسَلة وفق WHATWG، لا على سلاسل.

/**
 * تمثيل قانوني وحيد لعنوان وحدة: تسلسل WHATWG، مع توحيد حالة حرف السواقة
 * على ويندوز حتى لا تُصبح "D:" و "d:" وحدتين مختلفتين.
 */
export function canonicalModuleUrl(href) {
  return new URL(href).href.replace(/^file:\/\/\/([A-Za-z]):/, (_match, drive) => `file:///${drive.toLowerCase()}:`);
}

/**
 * هل تُنفَّذ هذه الوحدة بوصفها نقطة الدخول؟ يُقارَن العنوانان بعد التقنين،
 * ويُجرَّب التمثيل الحقيقي (realpath) أيضًا حتى لا يُسكِت وصلٌ رمزيّ الفرع.
 */
export function isCliEntrypoint(moduleUrl, entryPath) {
  if (typeof entryPath !== "string" || entryPath.length === 0) return false;
  const add = (set, value) => {
    if (typeof value !== "string" || value.length === 0) return;
    try {
      set.add(canonicalModuleUrl(value));
    } catch {
      // تمثيل لا يقبل التحويل إلى عنوان لا يُقارَن، ولا يُسقط الحارس.
    }
  };
  const selves = new Set();
  add(selves, moduleUrl);
  try {
    add(selves, pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href);
  } catch {
    // الوحدة قد لا تكون على قرص (تقييم مباشر) — يكفي عنوانها المُعلَن.
  }
  const entries = new Set();
  try {
    add(entries, pathToFileURL(entryPath).href);
  } catch {
    // مسار لا يقبل التحويل ليس نقطة دخول لهذه الوحدة.
  }
  try {
    add(entries, pathToFileURL(realpathSync(entryPath)).href);
  } catch {
    // غياب الملف على القرص لا يُسقط المقارنة الأولى.
  }
  for (const entry of entries) if (selves.has(entry)) return true;
  return false;
}

// ── تنفيذ عقد سطر الأوامر ───────────────────────────────────────────────────

export const CLI_EXIT_OK = 0;
export const CLI_EXIT_USAGE = 2;
export const CLI_EXIT_INTERNAL = 3;
export const CLI_USAGE = "usage: evidence-bytes-cli.mjs --classify <path>";
export const CLI_INTERNAL_ERROR = "EVIDENCE_CLASSIFIER_INTERNAL_ERROR";
export const CLI_NO_DOCUMENT = "EVIDENCE_CLASSIFIER_PRODUCED_NO_DOCUMENT";
export const CLI_ENTRYPOINT_REPORT = "EVIDENCE_CLI_ENTRYPOINT_REPORT";

function legacyConstructedUrl(entryPath) {
  return `file://${entryPath.replace(/\\/g, "/")}`;
}

/**
 * منطق سطر الأوامر كاملًا، ودالةٌ تُعيد رمز الخروج بدل أن تُنهي العملية.
 * لا process.exit هنا ولا في مُغلِّفها: على ويندوز يكون مجرى الخرج إلى أنبوب
 * غير متزامن، والخروج الفوري بعد الكتابة يبتر الوثيقة — وهو الشكل الثاني من
 * العطل نفسه (وثيقة مقطوعة بدل وثيقة غائبة).
 */
export function runEvidenceBytesCli(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const moduleUrl = options.moduleUrl ?? import.meta.url;

  // تقرير قياس لنقطة الدخول: يُثبت أن الفرع نُفِّذ فعلًا، ويُسجّل التمثيلين
  // الأصليين على المضيف الحقيقي بدل أن يُفترضا.
  if (argv.includes("--entrypoint-report")) {
    const entryPath = typeof argv[1] === "string" ? argv[1] : null;
    let entryUrl = null;
    try {
      entryUrl = entryPath === null ? null : pathToFileURL(entryPath).href;
    } catch {
      entryUrl = null;
    }
    const report = {
      ok: true,
      reason_code: CLI_ENTRYPOINT_REPORT,
      platform: process.platform,
      node_version: process.version,
      module_url: moduleUrl,
      argv1: entryPath,
      entry_url: entryUrl,
      legacy_constructed_url: entryPath === null ? null : legacyConstructedUrl(entryPath),
      legacy_string_match: entryPath !== null && moduleUrl === legacyConstructedUrl(entryPath),
      is_cli_entrypoint: entryPath !== null && isCliEntrypoint(moduleUrl, entryPath),
    };
    stdout.write(`${JSON.stringify(report)}\n`);
    return CLI_EXIT_OK;
  }

  const index = argv.indexOf("--classify");
  if (index < 0 || index + 1 >= argv.length) {
    stderr.write(`${CLI_USAGE}\n`);
    return CLI_EXIT_USAGE;
  }

  let document;
  try {
    document = JSON.stringify(classifyEvidenceFile(argv[index + 1]));
  } catch (error) {
    stderr.write(`${CLI_INTERNAL_ERROR}: ${error instanceof Error ? error.message : String(error)}\n`);
    return CLI_EXIT_INTERNAL;
  }
  // نجاحٌ بلا وثيقة ليس نجاحًا. هذا الفرع هو ما يمنع الشكل "صفر ومخرَج فارغ".
  if (typeof document !== "string" || document.length === 0) {
    stderr.write(`${CLI_NO_DOCUMENT}\n`);
    return CLI_EXIT_INTERNAL;
  }
  stdout.write(`${document}\n`);
  return CLI_EXIT_OK;
}

// الاستدعاء المباشر لهذه الوحدة يظلّ مدعومًا، بحارسٍ يقارن العناوين لا السلاسل.
// ونقطة الدخول القانونية لعقد سطر الأوامر هي evidence-bytes-cli.mjs، وهي بلا
// حارس أصلًا فلا يمكن لأي تمثيل مسار أن يُسكتها.
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  process.exitCode = runEvidenceBytesCli(process.argv, { moduleUrl: import.meta.url });
}
