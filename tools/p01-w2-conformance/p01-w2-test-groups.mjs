// مجموعات اختبارات P01-W2، كلٌّ مُشغَّلة على حدة، وناتجها دليل.
//
// عقد سجل المجموعة مستعار كاملًا من W5 — w5-test-group-contract.mjs — ولم
// يُستنسخ: نفس الحقول، ونفس التحقق، ونفس قاعدة «الغياب null لا صفر». صفرٌ
// مكانَ غياب يقول «لا إخفاقات» عن قياس لم يُقرأ، وهو أسوأ من الغياب.
//
// ملكية الدليل: الأسماء القانونية لا تُكتب إلا حين يضع مشغّل W2 علامته في
// البيئة. أي تشغيل آخر يكتب باسم adhoc ويعلن عن نفسه، فلا ينتحل دليلًا.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";
import {
  REASON_EVIDENCE_INCOMPLETE,
  REASON_SUMMARY_UNREADABLE,
  W5_TEST_GROUP_SCHEMA_VERSION,
  scanSummary,
  validateAggregate,
  validateGroupRecord,
} from "../w5-conformance/w5-test-group-contract.mjs";
import {
  P01_W2_GROUPS,
  P01_W2_NATIVE_MARKER,
  P01_W2_TEST_GROUPS_TOOL,
  P01_W2_TEST_GROUP_TOOL,
} from "./p01-w2-groups.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function tail(text, limit = 2000) {
  const trimmed = text.replace(/\s+$/, "");
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(trimmed.length - limit)}`;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const root = argument("--root", process.cwd());
const contracts = join(root, "contracts");
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env[P01_W2_NATIVE_MARKER] === "1";
const suffix = canonical ? "" : ".adhoc";

// NODE_TEST_CONTEXT يُحذف: وجوده يجعل `node --test` يتخطّى تشغيل الملفات ثم
// يخرج بصفر ومخرَج فارغ — أي «لا إخفاقات» عن قياس لم يقع. عيب W5 نفسه.
const childEnvironment = { ...process.env };
const recursiveContextStripped = childEnvironment["NODE_TEST_CONTEXT"] !== undefined;
delete childEnvironment["NODE_TEST_CONTEXT"];

const results = [];
for (const group of P01_W2_GROUPS) {
  const startedAt = stamp();
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "--test-reporter-destination=stdout",
      ...group.files.map((file) => join("dist", "tests", file)),
    ],
    { cwd: contracts, encoding: "utf8", env: childEnvironment, maxBuffer: 64 * 1024 * 1024 },
  );
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const summary = scanSummary(`${stdout}\n${stderr}`);
  const readable = summary.format !== "UNREADABLE";
  const completedAt = stamp();

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
    reason = "TEST_FAILURES";
  } else {
    verdict = "PASS";
  }

  const count = (field) => (readable ? (summary.values[field] ?? 0) : null);

  const record = {
    schema_version: W5_TEST_GROUP_SCHEMA_VERSION,
    tool: P01_W2_TEST_GROUP_TOOL,
    group_id: group.id,
    group: group.name,
    claim: group.claim,
    canonical,
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
    claim_ids: group.claim_ids,
    test_files: group.files,
  };

  if (!readable) {
    record.stdout_tail = tail(stdout);
    record.stderr_tail = tail(stderr);
  }

  const validation = validateGroupRecord(record);
  if (!validation.ok) {
    record.verdict = "INCONCLUSIVE";
    record.reason_code = REASON_EVIDENCE_INCOMPLETE;
    record.contract_violations = validation.violations;
  }

  if (!canonical) {
    record.non_canonical_note =
      "this run did not carry the P01-W2 runner's marker, so it is not canonical evidence and must not be read as a P01-W2 result";
  }

  const path = join(evidenceDirectory, `${group.evidence}${suffix}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  assertWrittenEvidence(path);
  results.push(record);

  const shown = (value) => (value === null ? "unknown" : String(value));
  console.log(
    `${record.verdict.padEnd(12)} ${group.id.padEnd(8)} ${group.name} — ${shown(record.tests)} tests, ` +
      `${shown(record.failed)} failed, ${shown(record.skipped)} skipped [summary: ${record.summary_format}]`,
  );
}

const anyIncomplete = results.some((result) => result.evidence_complete !== true);
const total = (field) => (anyIncomplete ? null : results.reduce((sum, result) => sum + result[field], 0));

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
  tool: P01_W2_TEST_GROUPS_TOOL,
  canonical,
  node_version: process.version,
  reporter: "tap",
  summary,
  groups: results,
};
const aggregateValidation = validateAggregate(aggregate);
if (!aggregateValidation.ok) aggregate.contract_violations = aggregateValidation.violations;

const aggregatePath = join(evidenceDirectory, `phase-01-contract-tests${suffix}.json`);
writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
assertWrittenEvidence(aggregatePath);

console.log(
  `P01-W2 test groups: ${String(summary.passed)} pass, ${String(summary.failed)} fail, ` +
    `${String(summary.blocked)} blocked, ${String(summary.inconclusive)} inconclusive, ` +
    `${String(summary.not_tested)} not tested`,
);
if (!aggregateValidation.ok) {
  console.log(`P01-W2 test-group evidence contract violations: ${String(aggregateValidation.violations.length)}`);
  for (const violation of aggregateValidation.violations) console.log(`  ${violation.field}: ${violation.reason}`);
}

const clean =
  aggregateValidation.ok && summary.failed + summary.blocked + summary.inconclusive + summary.not_tested === 0;
process.exit(clean ? 0 : 1);
