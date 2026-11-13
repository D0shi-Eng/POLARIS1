// تصنيف الأدلة الخاصة بويندوز.
//
// القاعدة: لا يُدّعى نتيجة ويندوز لم تُشغَّل. هذا الملف يحرس تلك القاعدة:
// يتأكد أن المشغّل الأصلي موجود وقابل للتشغيل، ويصنّف الجزء الذي يحتاج
// تشغيلًا أصليًا بوصفه REQUIRES_NATIVE_RUN حتى يوجد دليل حقيقي.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ChildProcessExecutionHost } from "../src/pep/child-execution-host.js";
import { HostPathAuthority } from "../src/platform/host-path-authority.js";
import { nowTimestamp } from "../src/ids.js";
import { makeWorkspace } from "./w4-helpers.js";
import { runtimeSrcPath } from "./helpers.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const HARNESS = join(REPOSITORY, "tools", "w4-windows-conformance");
const WINDOWS_EVIDENCE = join(REPOSITORY, "evidence", "w4-windows-conformance.json");

/** ما يعتمد على دلالات ويندوز الحقيقية ولا يمكن إثباته من مضيف آخر. */
const NATIVE_ONLY_CLAIMS = [
  "Windows reparse-point (junction) escape detection",
  "Windows case-insensitive path folding against a real volume",
  "Windows reserved device names and alternate data streams against a real volume",
  "Windows HANDLE-table inheritance (the X03 regression on Windows)",
  "AppContainer zero-capability confinement and Job Object containment",
];

test("the Windows conformance harness exists and is one runnable step", () => {
  for (const file of ["run.ps1", "windows-probes.mjs", "README.md"]) {
    assert.equal(existsSync(join(HARNESS, file)), true, `${file} is missing from the Windows harness`);
  }
  const runner = readFileSync(join(HARNESS, "run.ps1"), "utf8");
  assert.match(runner, /contracts: verify/);
  assert.match(runner, /runtime: build/);
  assert.match(runner, /runtime: test/);
  assert.match(runner, /windows-probes\.mjs/);
  assert.match(runner, /windows adapter: static check/);
});

test("REGRESSION: the runner produces the Windows evidence before the tests that consume it", () => {
  // العيب الذي يحرسه هذا الاختبار: خطوة "runtime: verify" كانت تسبق بناء المحوّل
  // وتشغيل المسابر، بينما اختبار runtime أدناه يشترط نظافة دليل المسابر. فكان
  // المشغّل يموت على دليل تشغيل سابق قبل أن يصل إلى ما ينتج الدليل الجديد —
  // حلقة مغلقة لا تصير خضراء أبدًا، ولا يظهر سببها في أي مخرَج.
  const runner = readFileSync(join(HARNESS, "run.ps1"), "utf8");
  const build = runner.indexOf('"windows adapter: build"');
  const probes = runner.indexOf('"windows probes"');
  const runtimeTest = runner.indexOf('"runtime: test"');
  const runtimeBuild = runner.indexOf('"runtime: build"');

  assert.ok(runtimeBuild > 0 && build > 0 && probes > 0 && runtimeTest > 0, "a conformance step is missing");
  assert.ok(runtimeBuild < build, "the adapter is built before the runtime dist the probes execute");
  assert.ok(build < probes, "the probes run before the adapter they invoke is built");
  assert.ok(probes < runtimeTest, "the runtime tests run before the evidence they read is produced");

  // والعلامة تُرفع بين المسابر والاختبارات، وإلا ورثتها عملية اختبار فكتبت فوق
  // الدليل القانوني — العيب نفسه من باب آخر.
  const flagSet = runner.indexOf("$env:POLARIS_W4_NATIVE_RUN = '1'");
  const flagCleared = runner.indexOf("Remove-Item Env:\\POLARIS_W4_NATIVE_RUN");
  assert.ok(flagSet > 0 && flagSet < probes, "the native-run flag is not set before the probes");
  assert.ok(flagCleared > probes && flagCleared < runtimeTest, "the native-run flag leaks into the runtime tests");

  // ولا خطوة "runtime: verify" واحدة تعيد ضمّ البناء إلى الاختبار قبل المسابر.
  // الفحص على الاستدعاء لا على النص: التعليق الذي يشرح العيب ليس العيب.
  assert.equal(
    /Invoke-(Soft)?Step\s+"runtime: verify"/.test(runner),
    false,
    "the combined verify step is back before the probes",
  );
});

test("the harness refuses to claim anything when it is not run on Windows", () => {
  const probes = readFileSync(join(HARNESS, "windows-probes.mjs"), "utf8");
  assert.match(probes, /this harness only runs on Windows/);
  // ولا يوجد داخله أي مسار يكتب PASS بلا تنفيذ.
  assert.equal(probes.includes('record("W-01", "the path authority reports native Windows semantics", "PASS"'), false);
});

test("the runtime states honestly that it has no Windows confinement", () => {
  const workspace = makeWorkspace();
  try {
    const host = new ChildProcessExecutionHost({ workingDirectory: workspace.host });
    // ادعاء صريح ومحدود: عملية منفصلة ببيئة ومجارٍ صريحة، وليست AppContainer.
    assert.equal(host.windowsConfinement, false);
    const authority = new HostPathAuthority(workspace.mounts, process.platform);
    assert.equal(authority.nativeWindowsSemantics, process.platform === "win32");
  } finally {
    workspace.dispose();
  }
});

test("the Windows-dependent claims are classified, and any real evidence must be clean", () => {
  const nativeRun = process.platform === "win32";
  const evidence = existsSync(WINDOWS_EVIDENCE)
    ? (JSON.parse(readFileSync(WINDOWS_EVIDENCE, "utf8")) as {
        executed_natively_on_windows: boolean;
        provenance?: string;
        summary: {
          passed: number;
          failed: number;
          skipped: number;
          blocked?: number;
          inconclusive?: number;
          not_tested?: number;
        };
      })
    : undefined;

  if (evidence?.executed_natively_on_windows === true) {
    // يوجد دليل حقيقي: عندئذ يجب أن يكون نظيفًا بالمعنى الكامل.
    // عائق أو حكم غير حاسم ليس نجاحًا: لا يُقاس شيء في الأول، ولا يثبت شيء في
    // الثاني. الاكتفاء بـfailed كان يسمح لـW-12 المعطّلة بالمرور بصمت.
    assert.equal(evidence.summary.failed, 0, "the Windows conformance run reported failures");
    assert.equal(evidence.summary.blocked ?? 0, 0, "the Windows conformance run reported blocked probes");
    assert.equal(evidence.summary.inconclusive ?? 0, 0, "the Windows conformance run reported inconclusive probes");
    // ومسبار لم يُجرَ ليس مسبارًا نظيفًا: NOT_TESTED يمنع PASS مثل BLOCKED تمامًا.
    assert.equal(evidence.summary.not_tested ?? 0, 0, "the Windows conformance run left probes not tested");
    // والدليل القانوني لا يكتبه إلا المشغّل.
    if (evidence.provenance !== undefined) {
      assert.match(evidence.provenance, /^POLARIS_W4_NATIVE_RUN/, "the canonical evidence was not written by the runner");
    }
  }

  const classification = {
    subject: "POLARIS Phase-00 / W4 Windows-dependent claims",
    classified_at: nowTimestamp(),
    classifying_platform: process.platform,
    status: nativeRun ? "NATIVE_RUN_AVAILABLE" : "REQUIRES_NATIVE_RUN",
    native_evidence_present: evidence !== undefined,
    native_evidence_path: "evidence/w4-windows-conformance.json",
    harness: "tools/w4-windows-conformance/run.ps1",
    claims_requiring_a_native_run: NATIVE_ONLY_CLAIMS,
    note:
      "Everything else in W4 was proven on the host that ran the suite. These specific claims were not, and W4 does not assert them.",
  };
  const target = join(REPOSITORY, "evidence", "w4-windows-classification.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(classification, null, 2)}\n`, "utf8");

  assert.equal(classification.claims_requiring_a_native_run.length, 5);
  if (!nativeRun) assert.equal(classification.status, "REQUIRES_NATIVE_RUN");
});
