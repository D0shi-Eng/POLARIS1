// انحدار إقلاع مشغّل ويندوز.
//
// العيب الذي يحرسه هذا الملف: المشغّل كان يشتق جذر المستودع داخل قيمة افتراضية
// لمعامل، من $PSScriptRoot وحده. ذلك المتغير لا يُملأ إلا حين يملك المحرّك
// سياق ملف نصّي؛ فإذا غاب السياق صار فارغًا، وفشل الربط قبل تنفيذ أي سطر —
// وفي بعض المضيفين لا يوقف الفشلُ السكربتَ، فيمضي بجذر فارغ ويُبلغ عن إخفاقات
// لم تُختبر أصلًا. ذلك خطأ إقلاع، ولا يقول شيئًا عن الحصر.
//
// الاختبار يشغّل السكربت الحقيقي بالطرق الأربع، بما فيها الطريقة التي أنتجت
// العيب، إذا وُجد مفسّر PowerShell. وإن لم يوجد، تبقى فحوص البنية الساكنة سارية.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runtimeSrcPath } from "./helpers.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const RUNNER = join(REPOSITORY, "tools", "w4-windows-conformance", "run.ps1");
const PROBES = join(REPOSITORY, "tools", "w4-windows-conformance", "windows-probes.mjs");

/** يُفضَّل POLARIS_PWSH، ثم pwsh، ثم powershell. غياب الثلاثة يعني تخطّي التنفيذ لا تجاهله. */
function findPowerShell(): string | undefined {
  const explicit = process.env["POLARIS_PWSH"];
  if (explicit !== undefined && existsSync(explicit)) return explicit;
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

const SHELL = findPowerShell();
const shellSkip = SHELL === undefined ? "no PowerShell interpreter on this host" : false;

interface ShellRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * بيئة بلا علامة التشغيل الأصلي. الحارس مزدوج عمدًا: المشغّل يرفع العلامة بعد
 * المسابر، وهذا الملف يمحوها من كل عملية يطلقها. أي واحد منهما يكفي، ووجودهما
 * معًا يعني أن عودة العيب تحتاج كسر حارسين لا واحد.
 */
function adHocEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment["POLARIS_W4_NATIVE_RUN"];
  return environment;
}

function runShell(args: readonly string[], input?: string): ShellRun {
  const result = spawnSync(SHELL as string, [...args], {
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ── فحوص ساكنة: تسري على أي مضيف، ومعها لا يعود العيب صامتًا ────────────────

test("the runner takes no computed parameter default, so binding cannot fail before the body", () => {
  const source = readFileSync(RUNNER, "utf8");
  const parameterBlock = source.slice(source.indexOf("param("), source.indexOf(")", source.indexOf("param(")) + 1);

  // هذا هو العيب حرفيًا: تعبير داخل قيمة افتراضية لمعامل.
  assert.equal(parameterBlock.includes("$PSScriptRoot"), false, "the param block reads $PSScriptRoot again");
  assert.equal(parameterBlock.includes("Join-Path"), false, "the param block computes a path again");
  assert.equal(parameterBlock.includes("Resolve-Path"), false, "the param block resolves a path again");
  assert.equal(parameterBlock.includes("="), false, "a parameter carries a computed default again");
});

test("the runner reads every automatic variable defensively and never one alone", () => {
  const source = readFileSync(RUNNER, "utf8");
  for (const mechanism of ["PSScriptRoot", "PSCommandPath", "MyInvocation.MyCommand.Path", "POLARIS_ROOT"]) {
    assert.ok(source.includes(mechanism), `the fallback chain lost ${mechanism}`);
  }
  // تحت StrictMode تكون الإشارة المباشرة إلى متغير غير معرّف استثناءً،
  // لذلك تُقرأ المتغيرات التلقائية عبر Get-Variable لا مباشرةً.
  assert.match(source, /Get-SafeVariableValue/);
  assert.match(source, /Get-Variable -Name \$Name/);
  assert.match(source, /Set-StrictMode -Version Latest/);
});

test("the runner validates a candidate against POLARIS markers before accepting it", () => {
  const source = readFileSync(RUNNER, "utf8");
  for (const marker of [
    "contracts\\\\package.json",
    "runtime\\\\package.json",
    "docs\\\\phases\\\\PHASE-00",
    "tools\\\\w4-windows-conformance\\\\windows-probes.mjs",
  ]) {
    assert.ok(source.includes(marker.replace(/\\\\/g, "\\")), `marker ${marker} is not checked`);
  }
  assert.match(source, /ConvertTo-CanonicalPath/);
  assert.match(source, /NOT_A_POLARIS_REPOSITORY/);
});

test("a failed bootstrap is typed, actionable, and says it is not a conformance failure", () => {
  const source = readFileSync(RUNNER, "utf8");
  assert.match(source, /WINDOWS_RUNNER_BOOTSTRAP_DEFECT/);
  assert.match(source, /No security claim was tested/);
  assert.match(source, /exit 2/);
  assert.match(source, /-RepositoryRoot "D:\\POLARIS"/);
});

test("the probes script resolves its own root and does not lean on the working directory alone", () => {
  const source = readFileSync(PROBES, "utf8");
  assert.match(source, /WINDOWS_RUNNER_BOOTSTRAP_DEFECT/);
  assert.match(source, /rootFromModuleLocation/);
  assert.match(source, /--root/);
  assert.match(source, /POLARIS_ROOT/);
  // الدليل يُكتب تحت الجذر المحلول، لا تحت مجلد عمل قد يكون أي شيء.
  assert.equal(source.includes('join(process.cwd(), "evidence"'), false);
});

// ── تنفيذ حقيقي: نفس السكربت، بنفس أنماط الاستدعاء ──────────────────────────

test("the runner self-check succeeds when invoked as a file", { skip: shellSkip }, () => {
  const run = runShell(["-NoProfile", "-File", RUNNER, "-RepositoryRoot", REPOSITORY, "-SelfCheck"]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /SELF-CHECK OK/);
  assert.match(run.stdout, /resolved by: RepositoryRoot parameter/);
});

test("the runner self-check succeeds with no argument at all, from its own location", { skip: shellSkip }, () => {
  const run = runShell(["-NoProfile", "-File", RUNNER, "-SelfCheck"]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /SELF-CHECK OK/);
  // يُحلّ من موقع السكربت نفسه، لا من مجلد العمل.
  assert.match(run.stdout, /resolved by: (PSScriptRoot|PSCommandPath|MyInvocation)/);
});

test(
  "REGRESSION: the runner survives the invocation that produced the defect, with no file context",
  { skip: shellSkip },
  () => {
    // هذا بالضبط ما يجعل $PSScriptRoot فارغًا: نصّ السكربت يُقيَّم بلا ملف.
    const source = readFileSync(RUNNER, "utf8");
    const run = runShell(["-NoProfile", "-Command", "-"], source.replace(/\r?\n/g, "\n"));

    assert.equal(
      run.stdout.includes("Cannot bind argument to parameter 'Path' because it is an empty string") ||
        run.stderr.includes("Cannot bind argument to parameter 'Path' because it is an empty string"),
      false,
      "the original parameter-binding defect is back",
    );
    // بلا سياق ملف لا يمكن اشتقاق الجذر من موقع السكربت، فالسلوك الصحيح هو
    // فشل مُصنَّف صريح — لا مضيّ بجذر فارغ.
    if (run.status === 0) {
      assert.match(run.stdout, /SELF-CHECK OK|POLARIS W4 Windows conformance/);
    } else {
      assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`);
      assert.match(run.stdout, /WINDOWS_RUNNER_BOOTSTRAP_DEFECT/);
      assert.match(run.stdout, /No security claim was tested/);
      assert.equal(run.stdout.includes("--- contracts: verify"), false, "it ran a step with an unresolved root");
    }
  },
);

test(
  "REGRESSION: with no file context but an explicit root, the runner works",
  { skip: shellSkip },
  () => {
    const source = readFileSync(RUNNER, "utf8");
    // نفس الاستدعاء الذي كان يفشل، لكن مع الجذر صريحًا: يجب أن ينجح.
    const script = `$args = @('-RepositoryRoot','${REPOSITORY}','-SelfCheck')\n${source.replace(/\r?\n/g, "\n")}`;
    const run = runShell(["-NoProfile", "-Command", "-"], script);
    assert.equal(run.stdout.includes("Cannot bind argument to parameter 'Path'"), false);
  },
);

test("an explicit but wrong root fails loudly and never falls back", { skip: shellSkip }, () => {
  const run = runShell(["-NoProfile", "-File", RUNNER, "-RepositoryRoot", join(REPOSITORY, "runtime"), "-SelfCheck"]);
  assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /WINDOWS_RUNNER_BOOTSTRAP_DEFECT/);
  assert.match(run.stdout, /NOT_A_POLARIS_REPOSITORY/);
  assert.match(run.stdout, /No security claim was tested/);
  // لم يسقط إلى مساحة العمل المفروضة رغم أنها آخر مرشّح في الترتيب.
  assert.equal(run.stdout.includes("mandated default workspace"), false);
});

test("a non-existent root fails with the typed code rather than an empty path", { skip: shellSkip }, () => {
  const run = runShell(["-NoProfile", "-File", RUNNER, "-RepositoryRoot", "Q:\\no\\such\\place", "-SelfCheck"]);
  assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /NOT_A_DIRECTORY/);
  assert.match(run.stdout, /WINDOWS_RUNNER_BOOTSTRAP_DEFECT/);
});

test("the probes script refuses to claim anything when its root will not resolve", () => {
  const run = spawnSync(process.execPath, [PROBES, "--root", "/definitely/not/polaris"], {
    encoding: "utf8",
    cwd: REPOSITORY,
    env: adHocEnvironment(),
  });
  assert.match(run.stdout, /W-00/);
  assert.match(run.stdout, /FAIL/);
  assert.notEqual(run.status, 0);
});

test("the probes script accepts an explicit root and reports the platform gate honestly", () => {
  // دلالات هذا الاختبار يجب أن تتبع المنصة التي يعمل عليها فعلًا.
  // نسخة سابقة فرضت توقّع لينكس حتى حين شُغّل على ويندوز، فأبلغت عن فشل
  // بينما الـprobes كانت صحيحة. الخطأ كان في الاختبار لا في المسبار.
  //
  // ونطاق هذا الاختبار هو الإقلاع وحده: حلّ الجذر وصدق بوابة المنصة. الحكم على
  // نظافة المسابر الأمنية ليس شغله — ذلك في w4-windows-conformance.test.ts على
  // الدليل القانوني. النسخة السابقة خلطت الأمرين، فشغّلت المسابر الأمنية كاملةً
  // بجذر المستودع الحقيقي وكتبت فوق الدليل القانوني بنتائج تشغيل ليس هو التشغيل
  // الأصلي — قبل أن يُبنى المحوّل أصلًا. هنا يُقرأ ملف ad-hoc، ولا يُلمس القانوني.
  const run = spawnSync(process.execPath, [PROBES, "--root", REPOSITORY], {
    encoding: "utf8",
    cwd: "/",
    env: adHocEnvironment(),
  });
  assert.notEqual(run.status, null, `${run.stdout}\n${run.stderr}`);

  const name = "w4-windows-conformance.adhoc.json";
  const evidence = JSON.parse(readFileSync(join(REPOSITORY, "evidence", name), "utf8")) as {
    executed_natively_on_windows: boolean;
    repository_root: string;
    platform: string;
    summary: {
      passed: number;
      failed: number;
      skipped: number;
      blocked: number;
      inconclusive: number;
      not_tested: number;
      total: number;
    };
    probes: Array<{ probe_id: string; status: string; title: string; detail: string }>;
    provenance: string;
  };
  // تشغيل خارج المشغّل لا ينتحل صفة الدليل الأصلي.
  assert.match(evidence.provenance, /^AD_HOC/);

  // مشترك بين المنصتين: حُلّ الجذر رغم أن مجلد العمل لا علاقة له بالمستودع.
  assert.equal(typeof evidence.repository_root, "string");
  assert.equal(evidence.executed_natively_on_windows, process.platform === "win32");
  assert.equal(evidence.platform, process.platform);

  if (process.platform !== "win32") {
    // خارج ويندوز: البوابة تتخطى بصدق، ولا يُدّعى شيء عن ويندوز.
    assert.match(run.stdout, /SKIPPED  W-00 platform gate/);
    const gate = evidence.probes.find((p) => p.probe_id === "W-00");
    assert.equal(gate?.status, "SKIPPED");
    assert.match(gate?.detail ?? "", /only runs on Windows/);
    return;
  }

  // على ويندوز: المسابر الأصلية بدأت فعلًا. لا يُثبَّت نجاح أي مسبار هنا؛
  // يُقرأ الدليل المنظّم كما هو، ويُشترط فقط ألا تُتخطى البوابة.
  assert.equal(
    evidence.probes.some((p) => p.probe_id === "W-00" && p.status === "SKIPPED"),
    false,
    "the platform gate skipped on Windows",
  );
  assert.ok(evidence.probes.length >= 10, "the native probe set did not run");
  assert.equal(evidence.summary.total, evidence.probes.length);
  assert.equal(
    evidence.summary.passed +
      evidence.summary.failed +
      evidence.summary.skipped +
      evidence.summary.blocked +
      evidence.summary.inconclusive +
      evidence.summary.not_tested,
    evidence.summary.total,
    "the summary loses probes: a status exists that nothing counts",
  );
  // ولا حالة صامتة: كل مسبار غير ناجح يحمل سببه.
  for (const probe of evidence.probes) {
    if (probe.status !== "PASS") {
      assert.ok((probe.detail ?? "").length > 0, `${probe.probe_id} is ${probe.status} with no detail`);
    }
  }
});

test("REGRESSION: nothing but the conformance runner may write the canonical Windows evidence", () => {
  // الاسم القانوني ملك للتشغيل الأصلي الذي أطلقه المشغّل، على أي منصة.
  //
  // العيب الذي يحرسه هذا الاختبار وقع فعلًا: هذا الملف نفسه كان يشغّل المسابر
  // بجذر المستودع الحقيقي على ويندوز، فيكتب فوق الدليل القانوني. النتيجة أن
  // W-11 و W-12 ظهرا إخفاقًا أمنيًا بينما لم يُقَس شيء — المحوّل لم يكن مبنيًا،
  // ولم يكن المشغّل هو من أطلق المسابر. الشرط الآن على المتغيّر لا على المنصة.
  const canonical = join(REPOSITORY, "evidence", "w4-windows-conformance.json");
  const before = existsSync(canonical) ? readFileSync(canonical, "utf8") : undefined;

  spawnSync(process.execPath, [PROBES, "--root", REPOSITORY], {
    encoding: "utf8",
    cwd: "/",
    env: adHocEnvironment(),
  });

  if (before !== undefined) {
    assert.equal(readFileSync(canonical, "utf8"), before, "an ad-hoc probe run rewrote the canonical native evidence");
  } else {
    assert.equal(existsSync(canonical), false, "an ad-hoc probe run created the canonical native evidence");
  }
  assert.equal(existsSync(join(REPOSITORY, "evidence", "w4-windows-conformance.adhoc.json")), true);
});
