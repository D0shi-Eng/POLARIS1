// انحدار عقد دليل مجموعات اختبارات W5.
//
// العيب الذي يحرسه هذا الملف وقع فعلًا في التشغيل الأصلي الثالث: المجموعات
// الثماني كلها خرجت
//
//     INCONCLUSIVE W5-A audit chain — null tests, null failed, null skipped
//
// ولم يكن ذلك خلافًا في المخطط بين المُنتِج والمستهلك: run.ps1 قرأ
// summary.failed و summary.blocked و summary.inconclusive و summary.not_tested
// بنجاح، وحكم W5_TEST_GROUP_NOT_CLEAN كما يجب. الخلل وقع قبل ذلك، داخل
// المُنتِج: مستخرِج الملخّص كان يقرأ شكل TAP وحده:
//
//     /^# tests (\d+)$/m
//
// المضيف الأصلي يحمل Node v24.14.1، ومُبلِّغ node:test الافتراضي هناك spec:
//
//     TAP   :  "# tests 15"
//     spec  :  "ℹ tests 15"      (U+2139، بايتاتها e2 84 b9)
//
// فلم يطابق التعبير سطرًا واحدًا، وعادت العدّادات null على المجموعات كلها.
//
// ما يثبت أن الاختبارات نفسها جرت: رموز الخروج بقيت صحيحة — ستّ مجموعات
// بالرمز 0، ومجموعتان (W5-R و W5-P) بالرمز 1، وهما بالضبط الملفان اللذان
// يحملان الإخفاقات السبعة الناتجة عن علامة ترتيب البايتات. لو لم تجرِ
// الاختبارات لكانت الرموز كلها صفرًا.
//
// الإصلاح طبقتان: المُبلِّغ يُفرض (--test-reporter=tap) فلا يُترك شكل المخرَج
// لإصدار المضيف؛ والمستخرِج يعرف الشكلين ويعلن أيّهما قرأ. والغياب يبقى
// غيابًا: null لا يصير صفرًا في أي حقل.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runtimeSrcPath } from "./helpers.js";
import { EVIDENCE_UTF8_BOM_PRESENT, classifyEvidenceFile, readCanonicalEvidence } from "./evidence-bytes.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const CONTRACT_PATH = join(REPOSITORY, "tools", "w5-conformance", "w5-test-group-contract.mjs");
const PRODUCER_PATH = join(REPOSITORY, "tools", "w5-conformance", "w5-test-groups.mjs");

interface Violation {
  readonly field: string;
  readonly reason: string;
}
interface ValidationResult {
  readonly ok: boolean;
  readonly violations: readonly Violation[];
}
interface SummaryScan {
  readonly format: string;
  readonly values: Record<string, number>;
}
interface ContractModule {
  readonly W5_TEST_GROUP_SCHEMA_VERSION: string;
  readonly W5_TEST_GROUP_TOOL: string;
  readonly W5_TEST_GROUPS_TOOL: string;
  readonly W5_VERDICTS: readonly string[];
  readonly REASON_EVIDENCE_INCOMPLETE: string;
  readonly REASON_SUMMARY_UNREADABLE: string;
  scanSummary(output: string): SummaryScan;
  validateGroupRecord(record: unknown): ValidationResult;
  validateAggregate(document: unknown): ValidationResult;
}

// الوحدة خارج rootDir الخاص بطبقة التشغيل، فتُحمَّل بمواصفة محسوبة لا حرفية.
const contract = (await import(pathToFileURL(CONTRACT_PATH).href)) as ContractModule;
const PRODUCER_TEXT = readFileSync(PRODUCER_PATH, "utf8");

/** سجل مجموعة صالح، يُعدَّل نقطةً واحدة في كل ضبط سالب. */
function groupRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: contract.W5_TEST_GROUP_SCHEMA_VERSION,
    tool: contract.W5_TEST_GROUP_TOOL,
    canonical: true,
    group_id: "W5-A",
    group: "audit chain",
    claim: "append-only hash chain detects tampering",
    platform: "win32",
    native: true,
    node_version: "v24.14.1",
    reporter: "tap",
    reporter_forced: true,
    recursive_test_context_stripped: false,
    summary_format: "TAP",
    measurement_started: "2026-09-08T16:36:56Z",
    measurement_completed: "2026-09-08T16:36:58Z",
    evidence_complete: true,
    duration_ms: 2345,
    tests: 15,
    passed: 15,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    todo: 0,
    exit_code: 0,
    verdict: "PASS",
    reason_code: "",
    evidence_reference: "evidence/w5-audit-chain.json",
    ...overrides,
  };
}

function fieldsOf(result: ValidationResult): string[] {
  return result.violations.map((violation) => violation.field);
}

// ── G1..G3: الضبط الموجب ────────────────────────────────────────────────────

test("G1: valid W5-A group evidence validates and reports exact counts", () => {
  const record = groupRecord();
  const result = contract.validateGroupRecord(record);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
  assert.equal(record["tests"], 15);
  assert.equal(record["passed"], 15);
  assert.equal(record["failed"], 0);
  assert.equal(record["skipped"], 0);
});

test("G2: valid W5-P group evidence carrying 23 tests validates with that exact count", () => {
  const record = groupRecord({
    group_id: "W5-P",
    group: "package refresh path contract",
    tests: 23,
    passed: 23,
    failed: 0,
    skipped: 0,
    evidence_reference: "evidence/w5-runner-package-refresh.json",
  });
  const result = contract.validateGroupRecord(record);
  assert.deepEqual(result.violations, []);
  assert.equal(record["tests"], 23);
  // ولا يُقبل عدد لا يصالح أجزاءه.
  assert.equal(contract.validateGroupRecord(groupRecord({ tests: 23, passed: 22 })).ok, false);
});

test("G3: zero failures is the number 0 and never null", () => {
  const record = groupRecord({ failed: 0 });
  assert.equal(record["failed"], 0);
  assert.notEqual(record["failed"], null);
  assert.equal(contract.validateGroupRecord(record).ok, true);
  // والعكس محرَّم: دليل مكتمل لا يحمل null في عدّاد.
  const nulled = contract.validateGroupRecord(groupRecord({ failed: null }));
  assert.equal(nulled.ok, false);
  assert.ok(fieldsOf(nulled).includes("failed"));
});

// ── G4..G6: الضبط السالب ────────────────────────────────────────────────────

test("G4: one missing required summary field is EVIDENCE_INCOMPLETE, not a zero", () => {
  const record = groupRecord();
  delete record["skipped"];
  const result = contract.validateGroupRecord(record);
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).includes("skipped"), JSON.stringify(result.violations));
  // ولا يُملأ الغياب بصفر في أي مكان.
  assert.equal(record["skipped"], undefined);
});

test("G5: a wrong field type is rejected rather than coerced", () => {
  for (const [field, value] of [
    ["tests", "15"],
    ["evidence_complete", "true"],
    ["duration_ms", "2345"],
    ["verdict", "GREEN"],
    ["group_id", 5],
  ] as ReadonlyArray<readonly [string, unknown]>) {
    const result = contract.validateGroupRecord(groupRecord({ [field]: value }));
    assert.equal(result.ok, false, `${field} was accepted as ${JSON.stringify(value)}`);
    assert.ok(fieldsOf(result).includes(field), `${field}: ${JSON.stringify(result.violations)}`);
  }
});

test("G6: malformed JSON is an unreadable document, never an empty result", () => {
  const directory = mkdtempSync(join(tmpdir(), "polaris-group-contract-"));
  try {
    const path = join(directory, "w5-audit-chain.json");
    writeFileSync(path, '{ "group_id": "W5-A", ', "utf8");
    assert.throws(() => readCanonicalEvidence(path), SyntaxError);
    // ووثيقة ليست كائنًا ترفض كذلك، بلا افتراض حقول.
    assert.equal(contract.validateGroupRecord(null).ok, false);
    assert.equal(contract.validateGroupRecord([]).ok, false);
    assert.equal(contract.validateGroupRecord("{}").ok, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("G7: a BOM-prefixed group document is an encoding defect, not a successful parse", () => {
  const directory = mkdtempSync(join(tmpdir(), "polaris-group-bom-"));
  try {
    const path = join(directory, "w5-audit-chain.json");
    writeFileSync(
      path,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${JSON.stringify(groupRecord(), null, 2)}\n`, "utf8")]),
    );
    assert.equal(classifyEvidenceFile(path).reason_code, EVIDENCE_UTF8_BOM_PRESENT);
    assert.throws(() => readCanonicalEvidence(path));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// ── G8..G10: المُجمَّع ──────────────────────────────────────────────────────

test("G8: the producer and the contract carry the same schema version", () => {
  assert.match(PRODUCER_TEXT, /W5_TEST_GROUP_SCHEMA_VERSION/);
  assert.equal(PRODUCER_TEXT.includes('from "./w5-test-group-contract.mjs"'), true);
  // ولا نسخة ثانية من الرقم داخل المُنتِج.
  assert.equal(/schema_version:\s*"/.test(PRODUCER_TEXT), false, "the producer hard-codes a schema version of its own");
  assert.equal(typeof contract.W5_TEST_GROUP_SCHEMA_VERSION, "string");
});

function aggregate(groups: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  const incomplete = groups.some((group) => group["evidence_complete"] !== true);
  const total = (field: string): number | null =>
    incomplete ? null : groups.reduce((sum, group) => sum + (group[field] as number), 0);
  return {
    schema_version: contract.W5_TEST_GROUP_SCHEMA_VERSION,
    tool: contract.W5_TEST_GROUPS_TOOL,
    canonical: true,
    node_version: "v24.14.1",
    reporter: "tap",
    summary: {
      passed: groups.filter((group) => group["verdict"] === "PASS").length,
      failed: groups.filter((group) => group["verdict"] === "FAIL").length,
      blocked: groups.filter((group) => group["verdict"] === "BLOCKED").length,
      inconclusive: groups.filter((group) => group["verdict"] === "INCONCLUSIVE").length,
      not_tested: groups.filter((group) => group["verdict"] === "NOT_TESTED").length,
      total_tests: total("tests"),
      total_failed: total("failed"),
      total_skipped: total("skipped"),
      groups_with_incomplete_evidence: groups.filter((group) => group["evidence_complete"] !== true).length,
    },
    groups: [...groups],
  };
}

test("G9: every group aggregates deterministically", () => {
  const ids = ["W5-A", "W5-B", "W5-C", "W5-D", "W5-S", "W5-R", "W5-P", "W5-E", "W5-G", "W5-X"];
  const groups = ids.map((id) => groupRecord({ group_id: id }));
  const document = aggregate(groups);
  const result = contract.validateAggregate(document);
  assert.deepEqual(result.violations, []);
  const summary = document["summary"] as Record<string, unknown>;
  assert.equal(summary["passed"], ids.length);
  assert.equal(summary["total_tests"], 15 * ids.length);
  // والتجميع لا يعتمد على ترتيب المجموعات.
  const reversed = aggregate([...groups].reverse());
  assert.deepEqual((reversed["summary"] as Record<string, unknown>)["total_tests"], summary["total_tests"]);
});

test("G10: the group tally and the group array must reconcile", () => {
  const groups = [groupRecord({ group_id: "W5-A" }), groupRecord({ group_id: "W5-B" })];
  const document = aggregate(groups);
  const summary = document["summary"] as Record<string, unknown>;
  summary["passed"] = 3;
  const result = contract.validateAggregate(document);
  assert.equal(result.ok, false);
  assert.ok(fieldsOf(result).some((field) => field === "summary"), JSON.stringify(result.violations));
});

test("one unreadable group makes the totals unknown rather than zero", () => {
  const groups = [
    groupRecord({ group_id: "W5-A" }),
    groupRecord({
      group_id: "W5-B",
      evidence_complete: false,
      verdict: "INCONCLUSIVE",
      reason_code: contract.REASON_SUMMARY_UNREADABLE,
      summary_format: "UNREADABLE",
      tests: null,
      passed: null,
      failed: null,
      skipped: null,
      cancelled: null,
      todo: null,
    }),
  ];
  const document = aggregate(groups);
  const summary = document["summary"] as Record<string, unknown>;
  assert.equal(summary["total_tests"], null);
  assert.notEqual(summary["total_tests"], 0);
  assert.equal(summary["inconclusive"], 1);
  assert.deepEqual(contract.validateAggregate(document).violations, []);
  // وصفرٌ مكان الغياب مرفوض صراحةً.
  summary["total_tests"] = 0;
  assert.equal(contract.validateAggregate(document).ok, false);
});

// ── مستخرِج الملخّص: العيب نفسه، مباشرةً ────────────────────────────────────

test("the extractor reads the TAP shape, the spec shape, and CRLF line endings alike", () => {
  const tap = contract.scanSummary(
    ["ok 1 - a", "1..3", "# tests 3", "# suites 0", "# pass 2", "# fail 0", "# cancelled 0", "# skipped 1", "# todo 0"].join("\n"),
  );
  assert.equal(tap.format, "TAP");
  assert.deepEqual(tap.values, { tests: 3, passed: 2, failed: 0, skipped: 1, cancelled: 0, todo: 0 });

  // خاتم CRLF كان سيُسقط المطابقة على $ في الوضع متعدّد الأسطر.
  const crlf = contract.scanSummary(
    ["# tests 3", "# pass 2", "# fail 0", "# cancelled 0", "# skipped 1", "# todo 0"].join("\r\n"),
  );
  assert.equal(crlf.format, "TAP");
  assert.equal(crlf.values["tests"], 3);

  // شكل spec — وهو ما أنتجه المضيف الأصلي فعلًا تحت Node v24.
  const spec = contract.scanSummary(
    ["ℹ tests 3", "ℹ suites 0", "ℹ pass 2", "ℹ fail 0", "ℹ cancelled 0", "ℹ skipped 1", "ℹ todo 0"].join("\n"),
  );
  assert.equal(spec.format, "SPEC");
  assert.equal(spec.values["tests"], 3);
  assert.equal(spec.values["passed"], 2);
});

test("REGRESSION: the exact native shape — no summary at all — stays UNREADABLE, never zero", () => {
  const scan = contract.scanSummary("(node:30572) Warning: node:test run() is being called recursively within a test file. skipping running files.\n");
  assert.equal(scan.format, "UNREADABLE");
  assert.deepEqual(scan.values, {});
  // وهذا ما يجعل السجل INCONCLUSIVE بعدّادات null: لا صفر واحد.
  const record = contract.validateGroupRecord(
    groupRecord({
      evidence_complete: false,
      verdict: "INCONCLUSIVE",
      summary_format: "UNREADABLE",
      reason_code: contract.REASON_SUMMARY_UNREADABLE,
      tests: null,
      passed: null,
      failed: null,
      skipped: null,
      cancelled: null,
      todo: null,
    }),
  );
  assert.deepEqual(record.violations, []);
  // ودليل غير مكتمل لا يجوز أن يحمل حكمًا مقيسًا.
  const lying = contract.validateGroupRecord(
    groupRecord({ evidence_complete: false, verdict: "PASS", tests: null, passed: null, failed: null, skipped: null, cancelled: null, todo: null }),
  );
  assert.equal(lying.ok, false);
  assert.ok(fieldsOf(lying).includes("verdict"));
});

test("the producer forces the reporter instead of trusting the host default", () => {
  assert.match(PRODUCER_TEXT, /--test-reporter=tap/);
  assert.match(PRODUCER_TEXT, /--test-reporter-destination=stdout/);
  // والسياق التكراري يُنزع صراحةً: وجوده يجعل node يتخطّى الملفات ويخرج بصفر.
  assert.match(PRODUCER_TEXT, /delete childEnvironment\["NODE_TEST_CONTEXT"\]/);
  // ولا تحويل غياب إلى صفر في المُنتِج.
  assert.equal(/tally\.\w+\s*\?\?\s*0/.test(PRODUCER_TEXT), false);
  assert.equal(/\(r\.tests \?\? 0\)/.test(PRODUCER_TEXT), false);
});

test("MEASUREMENT: the forced tap reporter is readable on this host's Node, the default may not be", () => {
  const directory = mkdtempSync(join(tmpdir(), "polaris-reporter-"));
  try {
    const file = join(directory, "sample.test.js");
    writeFileSync(
      file,
      [
        'import test from "node:test";',
        'test("a", () => {});',
        'test("b", () => {});',
        'test("c", { skip: true }, () => {});',
      ].join("\n"),
      "utf8",
    );
    writeFileSync(join(directory, "package.json"), '{"type":"module"}\n', "utf8");

    const environment = { ...process.env };
    delete environment["NODE_TEST_CONTEXT"];

    const forced = spawnSync(
      process.execPath,
      ["--test", "--test-reporter=tap", "--test-reporter-destination=stdout", file],
      { encoding: "utf8", env: environment, maxBuffer: 16 * 1024 * 1024 },
    );
    const forcedScan = contract.scanSummary(`${forced.stdout ?? ""}\n${forced.stderr ?? ""}`);
    assert.equal(forcedScan.format, "TAP", `${forced.stdout ?? ""}\n${forced.stderr ?? ""}`);
    assert.equal(forcedScan.values["tests"], 3);
    assert.equal(forcedScan.values["passed"], 2);
    assert.equal(forcedScan.values["skipped"], 1);

    // القياس لا الافتراض: الشكل الافتراضي على هذا المضيف يُسجَّل ويُقارن.
    const byDefault = spawnSync(process.execPath, ["--test", file], {
      encoding: "utf8",
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    });
    const defaultScan = contract.scanSummary(`${byDefault.stdout ?? ""}\n${byDefault.stderr ?? ""}`);
    assert.ok(
      ["TAP", "SPEC"].includes(defaultScan.format),
      `this host's default reporter produced an unrecognised summary shape on ${process.version}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("REGRESSION: NODE_TEST_CONTEXT in the environment destroys the summary — so the producer strips it", () => {
  // الشكل الذي لوحظ فعلًا في نسخة تشغيل المالك: تحذير على مجرى الخطأ، مخرَج
  // فارغ، ورمز خروج صفر — أي «لا إخفاقات» عن قياس لم يقع.
  const directory = mkdtempSync(join(tmpdir(), "polaris-recursive-"));
  try {
    const file = join(directory, "sample.test.js");
    writeFileSync(file, ['import test from "node:test";', 'test("a", () => {});'].join("\n"), "utf8");
    writeFileSync(join(directory, "package.json"), '{"type":"module"}\n', "utf8");

    const poisoned = { ...process.env, NODE_TEST_CONTEXT: "child-v8" };
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], {
      encoding: "utf8",
      env: poisoned,
      maxBuffer: 16 * 1024 * 1024,
    });
    const scan = contract.scanSummary(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
    assert.equal(scan.format, "UNREADABLE", run.stdout ?? "");
    assert.equal(run.status, 0, "the recursive guard exits zero — which is why it must never be read as a pass");

    const clean = { ...process.env };
    delete clean["NODE_TEST_CONTEXT"];
    const second = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], {
      encoding: "utf8",
      env: clean,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(contract.scanSummary(`${second.stdout ?? ""}\n${second.stderr ?? ""}`).format, "TAP");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
