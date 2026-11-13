// جرد التخطّي: كل اختبار تُخطّي في المجموعة كاملة، باسمه وسببه وصنفه.
//
// «٤٣٠ اختبارًا، ٤٢٧ نجحت، ٣ تُخطّيت» لم يكن كافيًا: الرقم لا يقول أي ثلاثة،
// ولا لماذا، ولا من يحمل ادعاءها على ويندوز. هذا الملف يشغّل المجموعة كاملة
// مرة واحدة بمُبلِّغ TAP مفروض، ويقابل كل تخطٍّ بسجل مُعلن داخل طبقة التشغيل.
//
// تخطٍّ لا يجد سجلًا ليس تفصيلًا يُتسامح فيه: هو تخطٍّ غير مصنَّف، وهو بالضبط
// الشكل الذي تختبئ فيه ثغرة أمنية خلف رقم أخضر. الخروج غير صفري.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";
import { scanSummary } from "../w5-conformance/w5-test-group-contract.mjs";
import { parseTapResults } from "./w6-tap.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const root = argument("--root", process.cwd());
const runtime = join(root, "runtime");
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env["POLARIS_W6_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";

// السجل يعيش داخل طبقة التشغيل ويُختبر هناك (W6-K). يُقرأ من البناء نفسه،
// فلا توجد نسخة ثانية منه تنجرف عن الأولى.
const registryUrl = pathToFileURL(join(runtime, "dist", "tests", "w6-skip-registry.js")).href;
let registry = null;
let registryError = "";
try {
  registry = await import(registryUrl);
} catch (error) {
  registryError = `SKIP_REGISTRY_UNAVAILABLE: ${error.message}`;
}

const started = stamp();
const environment = { ...process.env };
delete environment["NODE_TEST_CONTEXT"];

// الملفات تُعدّ صراحةً لا بنمط: توسيع الأنماط يختلف بين الصدفات، ونمطٌ لا
// يطابق شيئًا يخرج بصفر وبلا اختبارات — أي «لا إخفاقات» عن قياس لم يقع.
const testFiles = readdirSync(join(runtime, "dist", "tests"))
  .filter((entry) => entry.endsWith(".test.js"))
  .sort()
  .map((entry) => join("dist", "tests", entry));

const run = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "--test-reporter-destination=stdout", ...testFiles],
  { cwd: runtime, encoding: "utf8", env: environment, maxBuffer: 128 * 1024 * 1024 },
);
const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const summary = scanSummary(output);
const readable = summary.format !== "UNREADABLE";
const results = parseTapResults(output);
const skipped = results.filter((result) => result.skipped);
const failing = results.filter((result) => result.failed);

const classified = skipped.map((result) => {
  const declaration = registry === null ? undefined : registry.findSkipDeclaration(result.directive_reason);
  return {
    test: result.name,
    reason: result.directive_reason,
    skip_class: declaration?.skip_class ?? "UNCLASSIFIED",
    rationale: declaration?.rationale ?? "",
    windows_claim_carried_by: declaration?.windows_claim_carried_by ?? "",
    blocks_closure: declaration === undefined ? true : declaration.blocks_closure,
  };
});

const unclassified = classified.filter((entry) => entry.skip_class === "UNCLASSIFIED");
const securityCritical = classified.filter((entry) => entry.skip_class === "D");
const blocking = classified.filter((entry) => entry.blocks_closure);

const byClass = { A: 0, B: 0, C: 0, D: 0, UNCLASSIFIED: 0 };
for (const entry of classified) byClass[entry.skip_class] = (byClass[entry.skip_class] ?? 0) + 1;

let verdict;
let reason = "";
if (registry === null) {
  verdict = "BLOCKED";
  reason = registryError;
} else if (testFiles.length === 0) {
  verdict = "BLOCKED";
  reason = "NO_TEST_FILES_FOUND";
} else if (!readable) {
  verdict = "INCONCLUSIVE";
  reason = "TEST_SUMMARY_UNREADABLE";
} else if ((summary.values["failed"] ?? 0) > 0) {
  verdict = "FAIL";
  reason = "RUNTIME_SUITE_FAILED";
} else if (unclassified.length > 0) {
  verdict = "FAIL";
  reason = "SKIP_NOT_CLASSIFIED";
} else if (securityCritical.length > 0) {
  verdict = "FAIL";
  reason = "SECURITY_CRITICAL_SKIP_UNMEASURED";
} else if (blocking.length > 0) {
  verdict = "FAIL";
  reason = "SKIP_BLOCKS_CLOSURE";
} else if (skipped.length !== (summary.values["skipped"] ?? -1)) {
  // العدّ من مصدرين: أسطر النتائج والملخّص. اختلافهما يعني أن أحدهما لا يُقرأ.
  verdict = "INCONCLUSIVE";
  reason = `SKIP_COUNT_DOES_NOT_RECONCILE (lines=${String(skipped.length)}, summary=${String(summary.values["skipped"])})`;
} else {
  verdict = "PASS";
}

const document = {
  schema_version: "1.0.0",
  tool: "polaris.w6.skip-inventory",
  canonical,
  claim_id: "W6-SKIP",
  description: "every skipped test in the runtime suite, named and classified against the declared registry",
  platform: process.platform,
  native: process.platform === "win32",
  node_version: process.version,
  reporter: "tap",
  summary_format: summary.format,
  measurement_started: started,
  measurement_completed: stamp(),
  evidence_complete: readable && registry !== null,
  suite_summary: readable ? summary.values : null,
  observed_results: results.length,
  // قائمة التنفيذ بأسمائها. رقمٌ أخضر عن مجموعة لا تحمل أداة القياس ليس نتيجة،
  // وهذه القائمة هي ما يجعل «أي أداة كانت في التشغيل» سؤالًا له جواب في الدليل.
  test_files: testFiles.map((entry) => entry.replace(/\\/g, "/")),
  // الإخفاقات بأسمائها لا بعددها: عددٌ وحده يُنسب الفشل إلى الأسبوع الخطأ.
  failing_tests: failing.map((result) => result.name),
  skipped_total: skipped.length,
  by_class: byClass,
  skips: classified,
  unclassified,
  verdict,
  reason_code: reason,
  evidence_reference: join("evidence", `w6-skip-classification${suffix}.json`),
  interpretation:
    "class A is a platform-wrong instrument, B a case that does not exist on this platform, C an environment refusal of a measurable claim, D a security-critical claim left unmeasured. D and C block Phase-00 closure; an unclassified skip blocks it too, because an unnamed skip is indistinguishable from a hole.",
};

if (!canonical) {
  document.non_canonical_note =
    "this run did not carry the W6 runner's marker, so it is not canonical evidence and must not be read as a W6 result";
}

const path = join(evidenceDirectory, `w6-skip-classification${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

console.log(
  `runtime suite: ${String(summary.values["tests"] ?? "unknown")} tests, ` +
    `${String(summary.values["passed"] ?? "unknown")} pass, ${String(summary.values["failed"] ?? "unknown")} fail, ` +
    `${String(skipped.length)} skipped`,
);
for (const entry of classified) {
  console.log(`  [${entry.skip_class}] ${entry.test} — ${entry.reason}`);
}
console.log(`W6 skip inventory: ${verdict}${reason === "" ? "" : ` (${reason})`}`);

process.exit(verdict === "PASS" ? 0 : 1);
