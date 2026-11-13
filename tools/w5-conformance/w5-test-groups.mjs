// مجموعات اختبارات W5، مُشغَّلة كلٌّ على حدة، وناتجها دليل.
//
// لماذا مجموعة مجموعة لا دفعة واحدة: «١٢ اختبارًا نجحت» لا يقول أي ادعاء
// أُثبت. الدليل يجب أن يقول: التدقيق كذا، والموافقة كذا، والإيقاف كذا،
// وإثبات الإنجاز كذا. رقم واحد لا يصلح حكمًا على أربعة أعمال مختلفة.
//
// ملكية الدليل: الأسماء القانونية لا تُكتب إلا حين يضع مشغّل W5 علامته في
// البيئة. أي تشغيل آخر يكتب باسم adhoc ويعلن عن نفسه، فلا ينتحل دليلًا.
//
// استخراج الملخّص — العيب الذي أُغلق هنا:
//   كان المستخرِج يقرأ شكل TAP وحده ("# tests 15") من المُبلِّغ الافتراضي.
//   المضيف الأصلي يحمل Node v24.14.1 ومُبلِّغه الافتراضي spec ("ℹ tests 15")،
//   فلم يطابق شيئًا وعادت كل العدّادات null على المجموعات الثماني.
//   الإصلاح طبقتان: المُبلِّغ يُفرض صراحةً (--test-reporter=tap) فلا يُترك
//   شكل المخرَج لإصدار المضيف؛ والقارئ يعرف الشكلين ويعلن أيهما قرأ.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";
import {
  REASON_EVIDENCE_INCOMPLETE,
  REASON_SUMMARY_UNREADABLE,
  W5_TEST_GROUPS_TOOL,
  W5_TEST_GROUP_SCHEMA_VERSION,
  W5_TEST_GROUP_TOOL,
  scanSummary,
  validateAggregate,
  validateGroupRecord,
} from "./w5-test-group-contract.mjs";

const GROUPS = [
  {
    id: "W5-A",
    name: "audit chain",
    claim: "append-only hash chain over canonical JSON detects modification, deletion, insertion, reordering and malformed records",
    file: "w5-audit-chain.test.js",
    evidence: "w5-audit-chain",
  },
  {
    id: "W5-B",
    name: "trusted approval",
    claim: "REQUIRE_APPROVAL is an obligation on ALLOW; a single-use receipt bound to mission, invocation, decision, effect, target and plan is required before any effect",
    file: "w5-approval.test.js",
    evidence: "w5-approval",
  },
  {
    id: "W5-C",
    name: "panic stop (host semantics)",
    claim: "admission closes, pending authority is invalidated, owned live executions are terminated by registered identity, and STOPPED is only entered after zero survivors are verified",
    file: "w5-panic-stop.test.js",
    evidence: "w5-panic-stop-host",
  },
  {
    id: "W5-D",
    name: "minimal completion proof",
    claim: "PROVEN requires an observable effect at the expected target, attributable to an authorised grant, with a verifying audit chain; a model statement alone never proves anything",
    file: "w5-completion-proof.test.js",
    evidence: "w5-completion-proof",
  },
  {
    id: "W5-S",
    name: "scenarios",
    claim: "the happy path, the adversarial path and the approval-required path each behave as specified end to end",
    file: "w5-scenarios.test.js",
    evidence: "w5-scenarios",
  },
  {
    id: "W5-R",
    name: "runner bootstrap",
    claim:
      "the Windows runner boots deterministically for zero, one and many missing markers, keeps StrictMode, resolves its root by a named method, and writes only non-canonical bootstrap evidence when it fails",
    file: "w5-runner-bootstrap.test.js",
    evidence: "w5-runner-bootstrap-regression",
  },
  {
    id: "W5-P",
    name: "package refresh path contract",
    claim:
      "the installed-package destination is built from declared segments, proven to be one canonical scalar path, and proven to be the intended package location under runtime/node_modules before anything is removed",
    file: "w5-runner-package-refresh.test.js",
    evidence: "w5-runner-package-refresh",
  },
  {
    id: "W5-E",
    name: "evidence byte contract",
    claim:
      "JSON evidence written by the PowerShell runners is UTF-8 without a byte order mark, parses without preprocessing, round-trips Arabic text, and a BOM-prefixed document is reported as EVIDENCE_UTF8_BOM_PRESENT rather than silently accepted",
    file: "w5-evidence-encoding.test.js",
    evidence: "w5-evidence-encoding",
  },
  {
    id: "W5-G",
    name: "test-group evidence contract",
    claim:
      "one schema governs W5 test-group evidence; exact counts are reported when the summary is readable, an unreadable or malformed summary stays INCONCLUSIVE with null counts rather than zeroes, and the eight-plus groups aggregate deterministically",
    file: "w5-test-group-contract.test.js",
    evidence: "w5-test-group-contract",
  },
  {
    id: "W5-N",
    name: "native panic-stop verdict derivation",
    claim:
      "the W5-P01 verdict is derived from the adapter's raw measured facts and not from the adapter's own judgement:"
      + " a child never created, never assigned, never resumed, never ready, never proven alive, never proven in the"
      + " owned job, or exited on its own is BLOCKED and never PASS; a child alive after the stop or an owned"
      + " survivor is FAIL; an unattributable or unproven death is INCONCLUSIVE; an unclean teardown forbids PASS;"
      + " and the confinement shape, the explicit handle list, the job-before-resume order and the absence of"
      + " kill-by-name are read from the adapter sources rather than from their comments",
    file: "w5-native-panic-stop.test.js",
    evidence: "w5-native-panic-stop",
  },
  {
    id: "W5-X",
    name: "structural invariants",
    claim: "the agent cannot reach the approval issuer or the ledger, panic stop imports no model or network, nothing kills a process by name, and no declared event type is unemitted",
    file: "w5-architecture.test.js",
    evidence: "w5-architecture",
  },
];

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function tail(text, limit = 2000) {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(trimmed.length - limit)}`;
}

const root = argument("--root", process.cwd());
const runtime = join(root, "runtime");
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env["POLARIS_W5_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";

/**
 * بيئة الابن.
 *
 * NODE_TEST_CONTEXT يُحذف عمدًا: وجوده يجعل `node --test` يقول
 *   "node:test run() is being called recursively within a test file. skipping running files."
 * على مجرى الخطأ، ثم يخرج بالرمز صفر ومخرَج فارغ — أي «لا إخفاقات» عن قياس
 * لم يقع. وقد لوحظ هذا الشكل فعلًا في نسخة تشغيل المالك الأصلية.
 */
const childEnvironment = { ...process.env };
const recursiveContextStripped = childEnvironment["NODE_TEST_CONTEXT"] !== undefined;
delete childEnvironment["NODE_TEST_CONTEXT"];

const results = [];
for (const group of GROUPS) {
  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      // المُبلِّغ يُفرض: شكل المخرَج جزء من العقد، لا اختيار للمضيف.
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      join("dist", "tests", group.file),
    ],
    { cwd: runtime, encoding: "utf8", env: childEnvironment, maxBuffer: 64 * 1024 * 1024 },
  );
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const summary = scanSummary(`${stdout}\n${stderr}`);
  const readable = summary.format !== "UNREADABLE";
  const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // التصنيف صريح: لم يُشغَّل شيء ≠ شُغِّل وفشل ≠ شُغِّل ولم يكتمل دليله.
  let verdict;
  let reason = "";
  if (run.error !== undefined && run.error !== null) {
    verdict = "BLOCKED";
    reason = `TEST_RUNNER_FAILED: ${run.error.message}`;
  } else if (!readable) {
    verdict = "INCONCLUSIVE";
    reason = REASON_SUMMARY_UNREADABLE;
  } else if (summary.values["tests"] === 0) {
    verdict = "NOT_TESTED";
    reason = "NO_TESTS_RAN";
  } else if ((summary.values["failed"] ?? 0) > 0) {
    verdict = "FAIL";
    reason = "ASSERTION_FAILED";
  } else if (run.status !== 0) {
    verdict = "INCONCLUSIVE";
    reason = `NONZERO_EXIT_WITHOUT_FAILURE:${String(run.status)}`;
  } else {
    verdict = "PASS";
  }

  // الغياب يبقى غيابًا. لا تحويل null إلى صفر في أي حقل عدّاد.
  const count = (name) => (readable && typeof summary.values[name] === "number" ? summary.values[name] : null);

  const record = {
    schema_version: W5_TEST_GROUP_SCHEMA_VERSION,
    tool: W5_TEST_GROUP_TOOL,
    canonical,
    group_id: group.id,
    group: group.name,
    claim: group.claim,
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    reporter: "tap",
    reporter_forced: true,
    recursive_test_context_stripped: recursiveContextStripped,
    summary_format: summary.format,
    measurement_started: startedAt,
    measurement_completed: completedAt,
    evidence_complete: readable,
    duration_ms: Date.now() - started,
    tests: count("tests"),
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
    todo: count("todo"),
    exit_code: run.status,
    verdict,
    reason_code: reason,
    evidence_reference: join("evidence", `${group.evidence}${suffix}.json`),
  };

  // مخرَج غير مقروء لا يُبتلع: ذيله يُحفظ حتى يُشخَّص السبب دون تخمين.
  if (!readable) {
    record.stdout_tail = tail(stdout);
    record.stderr_tail = tail(stderr);
  }

  // العقد يُتحقَّق منه قبل أن يُقرأ السجل حكمًا. مخالفة تُنزل الحكم إلى
  // INCONCLUSIVE مع رمز الدليل الناقص، ولا تُملأ بأصفار.
  const validation = validateGroupRecord(record);
  if (!validation.ok) {
    record.verdict = "INCONCLUSIVE";
    record.reason_code = REASON_EVIDENCE_INCOMPLETE;
    record.contract_violations = validation.violations;
  }

  if (!canonical) {
    record.non_canonical_note =
      "this run did not carry the W5 runner's marker, so it is not canonical evidence and must not be read as a W5 result";
  }

  const path = join(evidenceDirectory, `${group.evidence}${suffix}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  assertWrittenEvidence(path);
  results.push(record);

  const shown = (value) => (value === null ? "unknown" : String(value));
  console.log(
    `${record.verdict.padEnd(12)} ${group.id.padEnd(6)} ${group.name} — ${shown(record.tests)} tests, ` +
      `${shown(record.failed)} failed, ${shown(record.skipped)} skipped [summary: ${record.summary_format}]`,
  );
}

const anyIncomplete = results.some((result) => result.evidence_complete !== true);
const total = (field) =>
  anyIncomplete ? null : results.reduce((sum, result) => sum + result[field], 0);

const summary = {
  passed: results.filter((r) => r.verdict === "PASS").length,
  failed: results.filter((r) => r.verdict === "FAIL").length,
  blocked: results.filter((r) => r.verdict === "BLOCKED").length,
  inconclusive: results.filter((r) => r.verdict === "INCONCLUSIVE").length,
  not_tested: results.filter((r) => r.verdict === "NOT_TESTED").length,
  total_tests: total("tests"),
  total_failed: total("failed"),
  total_skipped: total("skipped"),
  groups_with_incomplete_evidence: results.filter((r) => r.evidence_complete !== true).length,
};

const aggregate = {
  schema_version: W5_TEST_GROUP_SCHEMA_VERSION,
  tool: W5_TEST_GROUPS_TOOL,
  canonical,
  node_version: process.version,
  reporter: "tap",
  summary,
  groups: results,
};
const aggregateValidation = validateAggregate(aggregate);
if (!aggregateValidation.ok) aggregate.contract_violations = aggregateValidation.violations;

const aggregatePath = join(evidenceDirectory, `w5-test-groups${suffix}.json`);
writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
assertWrittenEvidence(aggregatePath);

console.log(
  `W5 test groups: ${String(summary.passed)} pass, ${String(summary.failed)} fail, ${String(summary.blocked)} blocked, ${String(summary.inconclusive)} inconclusive, ${String(summary.not_tested)} not tested`,
);
if (!aggregateValidation.ok) {
  console.log(`W5 test-group evidence contract violations: ${String(aggregateValidation.violations.length)}`);
  for (const violation of aggregateValidation.violations) {
    console.log(`  ${violation.field}: ${violation.reason}`);
  }
}

const clean =
  aggregateValidation.ok &&
  summary.failed + summary.blocked + summary.inconclusive + summary.not_tested === 0;
process.exit(clean ? 0 : 1);
