// انحدار بوابة Phase-00 — REG-PH00-001 … REG-PH00-012.
//
// العيب الذي وُلد منه هذا الملف وقع في تشغيل أصلي نظيف على ويندوز
// (2026-09-10T04:21:48Z). كل قياس في ذلك التشغيل كان أخضر:
//
//     مجموعات W6      9 نجحت، 0 فشلت، 0 محجوبة، 0 غير حاسمة، 0 غير مُختبَرة
//     dogfood         D01..D12 كلها PASS
//     مجموعة التشغيل  480 اختبارًا، 477 نجحت، 0 فشلت، 3 تُخطّيت، رمز الخروج 0
//     العقود          exit 0
//     W4 الأصلي       12/12
//     بايتات الدليل   43 وثيقة، 0 معيبة
//
// وكتبت البوابة رغم ذلك:
//
//     PH00-W2 = NOT_TESTED  STEP_NOT_IN_RUN_RECORD
//     PH00-W3 = FAIL        RUNTIME_SUITE_FAILED
//     PHASE-00 = FAIL
//
// السبب لم يكن في W2 ولا في W3: كان القارئ يقرأ الوثيقة الخطأ. W6 لا يقيس
// العقود ولا مجموعة طبقة التشغيل — يُفوّضهما إلى مشغّل W5 المجمَّد — والبوابة
// كانت تبحث عنهما داخل evidence/w6-run.json حيث لا يوجدان.
//
// و`undefined === 0` تساوي false: فحقلٌ غائب صار «فشلًا». وهذا هو المقلوب
// الدقيق لترقية NOT_TESTED إلى PASS، وكلاهما استبدالٌ للقياس بما ليس قياسًا.
//
// كل اختبار هنا يُشغّل البوابة الحقيقية على جذرٍ مؤقت مبذور بأدلة ذلك التشغيل
// نفسها، غير مُعدَّلة إلا بالتعديل المُعلن في الاختبار.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runtimeSrcPath } from "./helpers.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const GATE = join(REPOSITORY, "tools", "w6-conformance", "phase-00-gate.mjs");
const FIXTURE = join(REPOSITORY, "tests", "fixtures", "defect-fixtures", "2026-09-10-phase-00-gate-misbinding");

/** الوثائق العشر التي تشتق منها البوابة حكمها، بأسمائها القانونية. */
const SOURCES = [
  "w1-results.json",
  "w4-windows-conformance.json",
  "w5-run.json",
  "w6-run.json",
  "w6-test-groups.json",
  "w6-dogfood.json",
  "w6-skip-classification.json",
  "w6-evidence-bytes.json",
  "w6-repeatability.json",
  "w6-cleanup.json",
] as const;

type Doc = Record<string, unknown>;

interface Condition {
  readonly claim_id: string;
  readonly description: string;
  readonly source_week: string;
  readonly source_kind: string;
  readonly evidence_reference: string;
  readonly measurement_locator: string;
  readonly measured_in_this_run: boolean;
  readonly measurement_started: string;
  readonly measurement_completed: string;
  readonly evidence_complete: boolean;
  readonly verdict: string;
  readonly reason_code: string;
  readonly detail: string;
}

interface Gate {
  readonly conditions: readonly Condition[];
  readonly summary: Record<string, number>;
  readonly canonical: boolean;
  readonly verdict: string;
  readonly reason_code: string;
  readonly phase_01_gate: string;
}

const CLAIMS = [
  "PH00-W1",
  "PH00-W2",
  "PH00-W3",
  "PH00-W4",
  "PH00-W5",
  "PH00-W6-GROUPS",
  "PH00-W6-DOGFOOD",
  "PH00-W6-SKIPS",
  "PH00-W6-BYTES",
  "PH00-W6-REPEAT",
  "PH00-W6-CLEANUP",
  "PH00-W6-RUN",
] as const;

type Documents = Map<string, Doc>;
type Mutation = (documents: Documents) => void;

function fixtureDocument(name: string): Doc {
  return JSON.parse(readFileSync(join(FIXTURE, name), "utf8")) as Doc;
}

function need(documents: Documents, name: string): Doc {
  const document = documents.get(name);
  if (document === undefined) throw new Error(`${name} is not seeded`);
  return document;
}

function stepsOf(document: Doc): Doc[] {
  const steps = document["steps"];
  assert.equal(Array.isArray(steps), true, "the run record carries no steps array");
  return steps as Doc[];
}

function summaryOf(document: Doc): Doc {
  const summary = document["summary"];
  assert.equal(typeof summary, "object", "the record carries no summary");
  return summary as Doc;
}

/**
 * جذرٌ مؤقت مبذور بأدلة التشغيل الأصلي نفسها.
 *
 * البذرة تُنسخ من عيّنة العيب كما هي. لا تُعدَّل إلا بالتعديل المُعلن في
 * الاختبار، ولا يُعدَّل شيء ليصير أخضر: العيّنة هي التشغيل الذي كشف العيب.
 */
function seed(mutate: Mutation = () => undefined): string {
  const root = mkdtempSync(join(tmpdir(), "polaris-ph00-"));
  mkdirSync(join(root, "evidence"), { recursive: true });
  const documents: Documents = new Map();
  for (const name of SOURCES) documents.set(name, fixtureDocument(name));
  mutate(documents);
  for (const [name, document] of documents) {
    // نفس عقد البايتات: UTF-8 بلا BOM، LF، وسطر ختامي واحد.
    writeFileSync(join(root, "evidence", name), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
  return root;
}

function runGate(root: string): Gate {
  const environment = { ...process.env };
  // البوابة لا تكتب الاسم القانوني إلا بعلامة المشغّل، ولا اختبار يحملها.
  delete environment["POLARIS_W6_NATIVE_RUN"];
  const run = spawnSync(process.execPath, [GATE, "--root", root], { encoding: "utf8", env: environment });
  assert.notEqual(run.status, null, `the gate did not run: ${String(run.error?.message ?? "")}`);

  const canonicalName = join(root, "evidence", "phase-00-final-gate.json");
  assert.equal(existsSync(canonicalName), false, "a run without the runner's marker wrote a canonical Phase-00 verdict");

  const path = join(root, "evidence", "phase-00-final-gate.adhoc.json");
  assert.equal(existsSync(path), true, `the gate wrote no record\n${run.stdout}\n${run.stderr}`);

  const document = JSON.parse(readFileSync(path, "utf8")) as Gate;
  assert.equal(document.canonical, false);
  assert.equal(
    document.verdict === "PASS",
    run.status === 0,
    "the exit code and the written verdict disagree",
  );
  return document;
}

function claimOf(gate: Gate, id: string): Condition {
  const found = gate.conditions.find((condition) => condition.claim_id === id);
  if (found === undefined) throw new Error(`${id} is not in the gate record`);
  return found;
}

/** يُشغّل البوابة على بذرةٍ مُعدَّلة، ويحذف الجذر المؤقت مهما كانت النتيجة. */
function gateOver(mutate: Mutation = () => undefined): Gate {
  const root = seed(mutate);
  try {
    return runGate(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── REG-PH00-001 العقود قِيست ونجحت ─────────────────────────────────────────

test("REG-PH00-001 contracts verify at exit 0 makes PH00-W2 PASS, read from the document that holds it", () => {
  const gate = gateOver();
  const claim = claimOf(gate, "PH00-W2");
  assert.equal(claim.verdict, "PASS");
  assert.equal(claim.reason_code, "");
  assert.equal(claim.evidence_reference, "evidence/w5-run.json");
  assert.equal(claim.measurement_locator, "steps[name='contracts: verify'].exit_code");
  assert.equal(claim.evidence_complete, true);
  assert.equal(claim.measured_in_this_run, true);
});

// ── REG-PH00-002 قياسٌ غائب يُسمّى غائبًا ───────────────────────────────────

test("REG-PH00-002 a missing contracts step is NOT_TESTED, never FAIL and never PASS", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    w5["steps"] = stepsOf(w5).filter((step) => step["name"] !== "contracts: verify");
  });
  const claim = claimOf(gate, "PH00-W2");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "CONTRACTS_STEP_NOT_IN_RUN_RECORD");
  assert.equal(claim.evidence_complete, false);
  assert.notEqual(gate.verdict, "PASS");
  assert.equal(gate.phase_01_gate, "NOT_ALLOWED");
});

test("REG-PH00-002 a contracts step with no readable exit code is NOT_TESTED", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    for (const step of stepsOf(w5)) if (step["name"] === "contracts: verify") step["exit_code"] = null;
  });
  const claim = claimOf(gate, "PH00-W2");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "CONTRACTS_EXIT_CODE_UNREADABLE");
});

// ── REG-PH00-003 فشلٌ مقيس يُسمّى فشلًا ─────────────────────────────────────

test("REG-PH00-003 a non-zero contracts exit code makes PH00-W2 FAIL and blocks Phase-00", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    for (const step of stepsOf(w5)) if (step["name"] === "contracts: verify") step["exit_code"] = 1;
  });
  const claim = claimOf(gate, "PH00-W2");
  assert.equal(claim.verdict, "FAIL");
  assert.equal(claim.reason_code, "CONTRACTS_VERIFY_FAILED");
  assert.equal(gate.verdict, "FAIL");
  assert.equal(gate.phase_01_gate, "NOT_ALLOWED");
});

// ── REG-PH00-004 العيب نفسه: مجموعة نظيفة لا تُقرأ فاشلة ────────────────────

test("REG-PH00-004 480 tests, 477 pass, 0 fail, 3 skipped at exit 0 is never RUNTIME_SUITE_FAILED", () => {
  const gate = gateOver();
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "PASS");
  assert.notEqual(claim.reason_code, "RUNTIME_SUITE_FAILED");
  assert.equal(claim.reason_code, "");
  assert.equal(claim.evidence_reference, "evidence/w5-run.json");
  assert.equal(claim.measurement_locator, "runtime_test_exit_code");
  assert.match(claim.detail, /480 tests, 477 pass, 0 fail, 3 skipped, exit 0/);
});

// ── REG-PH00-005 فشلٌ حقيقي في المجموعة يُفشل W3 ────────────────────────────

test("REG-PH00-005 a runtime suite with one failure makes PH00-W3 FAIL", () => {
  const gate = gateOver((documents) => {
    const skips = need(documents, "w6-skip-classification.json");
    const summary = skips["suite_summary"] as Doc;
    summary["failed"] = 1;
    summary["passed"] = 476;
    skips["failing_tests"] = ["the local PDP denies when config is DEGRADED"];
    const w5 = need(documents, "w5-run.json");
    w5["runtime_test_exit_code"] = 1;
    for (const step of stepsOf(w5)) if (step["name"] === "runtime: final test") step["exit_code"] = 1;
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "FAIL");
  assert.equal(claim.reason_code, "RUNTIME_SUITE_FAILED");
  assert.match(claim.detail, /the local PDP denies when config is DEGRADED/);
  assert.equal(gate.verdict, "FAIL");
});

// ── REG-PH00-006 دليلٌ غائب ليس فشلًا ───────────────────────────────────────

test("REG-PH00-006 a missing runtime suite exit code is NOT_TESTED, not FAIL", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    delete w5["runtime_test_exit_code"];
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "RUNTIME_SUITE_EXIT_CODE_NOT_IN_RUN_RECORD");
  assert.equal(claim.evidence_complete, false);
  assert.notEqual(gate.verdict, "PASS");
});

test("REG-PH00-006 a missing suite count record is NOT_TESTED: an exit code alone is not a measurement", () => {
  const gate = gateOver((documents) => {
    documents.delete("w6-skip-classification.json");
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "RUNTIME_SUITE_COUNTS_UNREADABLE");
  assert.notEqual(gate.verdict, "PASS");
});

test("REG-PH00-006 a suite that counted zero tests is NOT_TESTED, not a clean run", () => {
  const gate = gateOver((documents) => {
    const skips = need(documents, "w6-skip-classification.json");
    (skips["suite_summary"] as Doc)["tests"] = 0;
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "RUNTIME_SUITE_MEASURED_NOTHING");
});

// ── REG-PH00-007 لا رمز خروج قديم ولا وسيط يعلو على القياس النهائي ──────────

test("REG-PH00-007 a W5 record written outside this run's window is stale, not a fresh measurement", () => {
  // خطوة العقود في مشغّل W5 صلبة: تفشل فترمي فيتوقف قبل أن يكتب سجله، فيبقى
  // سجلّ التشغيل السابق الناجح على القرص. هذا هو ذلك الشكل بالضبط.
  const gate = gateOver((documents) => {
    need(documents, "w5-run.json")["ran_at"] = "2026-09-08T09:34:00Z";
  });
  for (const id of ["PH00-W2", "PH00-W3", "PH00-W5"]) {
    const claim = claimOf(gate, id);
    assert.equal(claim.verdict, "NOT_TESTED", `${id} read a stale document as a fresh measurement`);
    assert.equal(claim.reason_code, "EVIDENCE_STALE_FOR_THIS_RUN");
    assert.equal(claim.evidence_complete, false);
  }
  assert.notEqual(gate.verdict, "PASS");
});

test("REG-PH00-007 an intermediate exit code that contradicts the final suite step is not read as a result", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    // الحقل يقول صفرًا والخطوة الأخيرة تقول واحدًا: السجل يناقض نفسه.
    for (const step of stepsOf(w5)) if (step["name"] === "runtime: final test") step["exit_code"] = 1;
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "RUNTIME_SUITE_EXIT_CODE_DISAGREES_WITH_STEP");
  assert.notEqual(gate.verdict, "PASS");
});

test("REG-PH00-007 a clean suite that its own runner exited non-zero on never resolves upward", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    w5["runtime_test_exit_code"] = 1;
    for (const step of stepsOf(w5)) if (step["name"] === "runtime: final test") step["exit_code"] = 1;
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "FAIL");
  assert.equal(claim.reason_code, "RUNTIME_SUITE_FAILED");
});

test("REG-PH00-007 skipping the frozen W5 runner leaves the delegated claims unmeasured", () => {
  const gate = gateOver((documents) => {
    const w6 = need(documents, "w6-run.json");
    (w6["w5_regression"] as Doc)["skipped"] = true;
  });
  for (const id of ["PH00-W2", "PH00-W3", "PH00-W5"]) {
    const claim = claimOf(gate, id);
    assert.equal(claim.verdict, "NOT_TESTED");
    assert.equal(claim.reason_code, "W5_REGRESSION_SKIPPED");
    assert.equal(claim.measured_in_this_run, false, `${id} claims a measurement that this run did not make`);
  }
  assert.notEqual(gate.verdict, "PASS");
});

// ── REG-PH00-008 إخفاقات W4 و W5 تبقى مانعة ────────────────────────────────

test("REG-PH00-008 a W4 confinement regression that is not clean blocks closure", () => {
  const gate = gateOver((documents) => {
    const summary = summaryOf(need(documents, "w4-windows-conformance.json"));
    summary["passed"] = 11;
    summary["failed"] = 1;
  });
  assert.equal(claimOf(gate, "PH00-W4").verdict, "FAIL");
  assert.equal(claimOf(gate, "PH00-W4").reason_code, "W4_REGRESSION_NOT_CLEAN");
  assert.equal(gate.verdict, "FAIL");
  assert.equal(gate.phase_01_gate, "NOT_ALLOWED");
});

test("REG-PH00-008 a W5 run that is not PASS blocks closure", () => {
  const gate = gateOver((documents) => {
    const w5 = need(documents, "w5-run.json");
    w5["verdict"] = "NOT_CLEAN";
    w5["reason_codes"] = ["W5_NATIVE_PROBE_FAIL"];
  });
  const claim = claimOf(gate, "PH00-W5");
  assert.equal(claim.verdict, "FAIL");
  assert.equal(claim.reason_code, "W5_NATIVE_PROBE_FAIL");
  assert.equal(gate.verdict, "FAIL");
});

// ── REG-PH00-009 عائقٌ في سجل W6 يبقى مانعًا ───────────────────────────────

test("REG-PH00-009 a blocker in the W6 run record blocks closure", () => {
  const gate = gateOver((documents) => {
    const w6 = need(documents, "w6-run.json");
    w6["verdict"] = "NOT_CLEAN";
    w6["reason_codes"] = ["W6_TEST_GROUP_NOT_CLEAN"];
  });
  const claim = claimOf(gate, "PH00-W6-RUN");
  assert.equal(claim.verdict, "FAIL");
  assert.equal(claim.reason_code, "W6_TEST_GROUP_NOT_CLEAN");
  assert.equal(gate.verdict, "FAIL");
});

// ── REG-PH00-010 تخطٍّ أمني غير مقيس يمنع الإغلاق ───────────────────────────

test("REG-PH00-010 a security-critical unmeasured skip prevents Phase-00 PASS", () => {
  const gate = gateOver((documents) => {
    const skips = need(documents, "w6-skip-classification.json");
    skips["verdict"] = "FAIL";
    skips["reason_code"] = "SECURITY_CRITICAL_SKIP_UNMEASURED";
    skips["by_class"] = { A: 1, B: 2, C: 0, D: 1, UNCLASSIFIED: 0 };
    skips["skipped_total"] = 4;
  });
  assert.equal(claimOf(gate, "PH00-W6-SKIPS").verdict, "FAIL");
  assert.equal(gate.verdict, "FAIL");
  assert.equal(gate.phase_01_gate, "NOT_ALLOWED");
});

test("REG-PH00-010 an unmeasured condition is never promoted, and never opens the Phase-01 gate", () => {
  const gate = gateOver((documents) => {
    const skips = need(documents, "w6-skip-classification.json");
    skips["verdict"] = "NOT_TESTED";
    skips["evidence_complete"] = false;
  });
  assert.equal(claimOf(gate, "PH00-W6-SKIPS").verdict, "NOT_TESTED");
  assert.notEqual(gate.verdict, "PASS");
  assert.equal(gate.phase_01_gate, "NOT_ALLOWED");
  assert.equal(gate.summary["unmeasured"], 1);
});

// ── REG-PH00-011 عيّنة التشغيل الأصلي نفسها ────────────────────────────────

test("REG-PH00-011 the owner-run fixture reproduces the defect and the fixed gate clears it", () => {
  // ١) ما كتبته البوابة المعيبة على هذه البايتات بعينها، محفوظًا كما كُتب.
  const defective = JSON.parse(readFileSync(join(FIXTURE, "phase-00-final-gate.json"), "utf8")) as Gate;
  const before = new Map(defective.conditions.map((condition) => [condition.claim_id, condition]));
  assert.equal(before.get("PH00-W2")?.verdict, "NOT_TESTED");
  assert.equal(before.get("PH00-W2")?.reason_code, "STEP_NOT_IN_RUN_RECORD");
  assert.equal(before.get("PH00-W3")?.verdict, "FAIL");
  assert.equal(before.get("PH00-W3")?.reason_code, "RUNTIME_SUITE_FAILED");
  assert.equal(defective.verdict, "FAIL");
  assert.equal(defective.phase_01_gate, "NOT_ALLOWED");

  // ٢) ولماذا كان لا بد أن يكتب ذلك: الموضعان القديمان غير موجودين في
  //    evidence/w6-run.json أصلًا، وهما موجودان في evidence/w5-run.json.
  const w6Run = fixtureDocument("w6-run.json");
  const w5Run = fixtureDocument("w5-run.json");
  assert.equal(
    stepsOf(w6Run).some((step) => step["name"] === "contracts: verify"),
    false,
    "the W6 run record does hold the contracts step: the defect would not reproduce",
  );
  assert.equal(w6Run["runtime_test_exit_code"], undefined);
  assert.equal(
    stepsOf(w5Run).some((step) => step["name"] === "contracts: verify"),
    true,
    "the W5 run record does not hold the contracts step: the fix would have nothing to read",
  );
  assert.equal(w5Run["runtime_test_exit_code"], 0);

  // ٣) وما تكتبه البوابة المُصلَحة على البايتات نفسها، بلا أي تعديل.
  const after = gateOver();
  assert.equal(claimOf(after, "PH00-W2").verdict, "PASS");
  assert.equal(claimOf(after, "PH00-W3").verdict, "PASS");
  assert.equal(after.verdict, "PASS");
  assert.equal(after.phase_01_gate, "ALLOWED");
  assert.equal(after.summary["failed"], 0);
  assert.equal(after.summary["unmeasured"], 0);
  assert.equal(after.summary["incomplete_evidence"], 0);
});

// ── REG-PH00-012 لا طريق ثابت إلى PASS ──────────────────────────────────────

const BREAKERS: ReadonlyArray<{ readonly claim: string; readonly mutate: Mutation }> = [
  { claim: "PH00-W1", mutate: (documents) => { documents.delete("w1-results.json"); } },
  {
    claim: "PH00-W2",
    mutate: (documents) => {
      const w5 = need(documents, "w5-run.json");
      for (const step of stepsOf(w5)) if (step["name"] === "contracts: verify") step["exit_code"] = 2;
    },
  },
  {
    claim: "PH00-W3",
    mutate: (documents) => {
      (need(documents, "w6-skip-classification.json")["suite_summary"] as Doc)["failed"] = 1;
    },
  },
  { claim: "PH00-W4", mutate: (documents) => { summaryOf(need(documents, "w4-windows-conformance.json"))["failed"] = 1; } },
  { claim: "PH00-W5", mutate: (documents) => { need(documents, "w5-run.json")["verdict"] = "NOT_CLEAN"; } },
  { claim: "PH00-W6-GROUPS", mutate: (documents) => { summaryOf(need(documents, "w6-test-groups.json"))["failed"] = 1; } },
  { claim: "PH00-W6-DOGFOOD", mutate: (documents) => { summaryOf(need(documents, "w6-dogfood.json"))["failed"] = 1; } },
  { claim: "PH00-W6-SKIPS", mutate: (documents) => { need(documents, "w6-skip-classification.json")["verdict"] = "FAIL"; } },
  { claim: "PH00-W6-BYTES", mutate: (documents) => { need(documents, "w6-evidence-bytes.json")["verdict"] = "FAIL"; } },
  { claim: "PH00-W6-REPEAT", mutate: (documents) => { need(documents, "w6-repeatability.json")["verdict"] = "FAIL"; } },
  { claim: "PH00-W6-CLEANUP", mutate: (documents) => { need(documents, "w6-cleanup.json")["clean"] = false; } },
  { claim: "PH00-W6-RUN", mutate: (documents) => { need(documents, "w6-run.json")["verdict"] = "NOT_CLEAN"; } },
];

test("REG-PH00-012 every condition can block Phase-00, so no path reaches PASS on its own", () => {
  assert.deepEqual(BREAKERS.map((entry) => entry.claim), [...CLAIMS], "a declared condition has no breaker");
  for (const entry of BREAKERS) {
    const gate = gateOver(entry.mutate);
    assert.notEqual(gate.verdict, "PASS", `breaking ${entry.claim} still reached PHASE-00 = PASS`);
    assert.equal(gate.phase_01_gate, "NOT_ALLOWED", `breaking ${entry.claim} still opened the Phase-01 gate`);
    assert.match(gate.reason_code, new RegExp(entry.claim.replace(/\W/g, "\\$&")), `${entry.claim} is not named in the reason`);
  }
});

test("REG-PH00-012 an evidence directory with nothing in it is not a Phase-00 PASS", () => {
  const root = mkdtempSync(join(tmpdir(), "polaris-ph00-empty-"));
  try {
    mkdirSync(join(root, "evidence"), { recursive: true });
    const gate = runGate(root);
    assert.notEqual(gate.verdict, "PASS");
    assert.equal(gate.phase_01_gate, "NOT_ALLOWED");
    assert.equal(gate.summary["passed"], 0);
    for (const id of CLAIMS) assert.equal(claimOf(gate, id).verdict, "NOT_TESTED", `${id} claimed a result with no evidence`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── أدوات W3 تُسمّى، فلا تكون المجموعة شاهدًا غامضًا ────────────────────────

const W3_INSTRUMENTS = ["config.test.js", "config-properties.test.js", "policy.test.js"] as const;

function executedFiles(names: readonly string[]): string[] {
  return names.map((name) => `dist/tests/${name}`);
}

test("a run record that names its executed files must show the W3 instruments among them", () => {
  const gate = gateOver((documents) => {
    need(documents, "w6-skip-classification.json")["test_files"] = executedFiles([
      ...W3_INSTRUMENTS,
      "corpus.test.js",
      "integration.test.js",
    ]);
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "PASS");
  assert.match(claim.detail, /W3 instruments executed: config\.test\.js, config-properties\.test\.js, policy\.test\.js/);
  assert.equal(gate.verdict, "PASS");
});

test("a clean suite that never executed a W3 instrument is NOT_TESTED, not a W3 result", () => {
  // مجموعةٌ خضراء لا تحمل أداة القياس ليست قياسًا لـW3. هذا ما يمنع أن يصير
  // «٤٨٠ اختبارًا نجحت» شاهدًا على ادعاء لم تُشغَّل أداته أصلًا.
  const gate = gateOver((documents) => {
    need(documents, "w6-skip-classification.json")["test_files"] = executedFiles([
      "config.test.js",
      "config-properties.test.js",
    ]);
  });
  const claim = claimOf(gate, "PH00-W3");
  assert.equal(claim.verdict, "NOT_TESTED");
  assert.equal(claim.reason_code, "W3_INSTRUMENT_NOT_EXECUTED");
  assert.match(claim.detail, /policy\.test\.js/);
  assert.equal(claim.evidence_complete, false);
  assert.notEqual(gate.verdict, "PASS");
});

// ── منشأ كل ادعاء يُذكر، والمحمول يُقال إنه محمول ───────────────────────────

test("every Phase-00 condition names its week, its kind, its source and its measurement window", () => {
  const gate = gateOver();
  assert.deepEqual(gate.conditions.map((condition) => condition.claim_id), [...CLAIMS]);
  for (const condition of gate.conditions) {
    assert.ok(condition.source_week.length > 0, `${condition.claim_id}: no source week`);
    assert.ok(condition.source_kind.length > 0, `${condition.claim_id}: no source kind`);
    assert.ok(condition.description.length > 0, `${condition.claim_id}: no description`);
    assert.equal(typeof condition.evidence_complete, "boolean");
    assert.equal(typeof condition.measured_in_this_run, "boolean");
    assert.equal(typeof condition.measurement_started, "string");
    assert.equal(typeof condition.measurement_completed, "string");
    if (condition.verdict !== "NOT_TESTED") {
      assert.ok(condition.evidence_reference.length > 0, `${condition.claim_id}: a measured claim names no evidence`);
    }
  }
});

test("W1 is carried and says so, and the weeks measured through the frozen runners say that instead", () => {
  const gate = gateOver();
  const w1 = claimOf(gate, "PH00-W1");
  assert.equal(w1.measured_in_this_run, false);
  assert.equal(w1.source_kind, "CARRIED_FROZEN");
  assert.match(w1.detail, /CARRIED/);
  for (const id of ["PH00-W2", "PH00-W3", "PH00-W4", "PH00-W5"]) {
    const claim = claimOf(gate, id);
    assert.equal(claim.measured_in_this_run, true, `${id} is presented as carried, but this run measured it`);
    assert.equal(claim.source_kind, "DELEGATED_FROZEN_RUNNER");
  }
  for (const id of ["PH00-W6-GROUPS", "PH00-W6-DOGFOOD", "PH00-W6-RUN"]) {
    assert.equal(claimOf(gate, id).source_kind, "MEASURED_BY_W6");
  }
});
