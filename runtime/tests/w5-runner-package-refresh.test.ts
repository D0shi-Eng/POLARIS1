// انحدار عقد مسارات تحديث الحزم في مشغّل W5.
//
// العيب الذي يحرسه هذا الملف وقع فعلًا في التشغيل الأصلي الثاني، وأوقف
// المشغّل بعد أن مرّت العقود و117 اختبارًا، وقبل أن يصل إلى أي مسبار:
//
//   Test-Path : Illegal characters in path.
//   At D:\POLARIS\tools\w5-conformance\run.ps1:438 char:7
//
// السبب لم يكن Test-Path. كان النصّ الحرفي الذي بنى الوجهة:
//
//   $installed = Join-Path $RepositoryRoot 'runtime\node_modules\@polaris\contracts'
//
// كُتب هذا السطر مرّةً بأداة فسّرت \n تسلسلَ هروب، فاستقرّ داخل الاقتباس محرف
// سطر جديد حقيقي (0x0A)، وصارت القيمة 'runtime' + LF + 'ode_modules\...'.
// النصّ المفرد لا يُظهر ذلك للعين: السطر يبدو سطرين في المحرّر لا قيمةً فاسدة.
//
// لماذا لم تمسكه W5-R: كانت تحرس الإقلاع — التطبيع والعدّ وحلّ الجذر — ولم
// يكن فيها فحص نصّي واحد على المحارف داخل النصوص الحرفية، ولا أي تمرين لمرحلة
// تحديث الحزم. والطبقة التي تُشغّل PowerShell تتخطّى على لينكس. فمرّ العيب
// إلى المالك.
//
// لذلك هذا الملف طبقتان، كما في W5-R:
//   ١) فحوص نصّية تعمل على أي منصّة — وهي وحدها كانت ستكشف العيب؛
//   ٢) تمرين حقيقي لعقد المسار حين يوجد مفسّر PowerShell.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runtimeSrcPath } from "./helpers.js";
import { readCanonicalEvidence } from "./evidence-bytes.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const RUNNER = join(REPOSITORY, "tools", "w5-conformance", "run.ps1");
const CONTRACT = join(REPOSITORY, "tools", "w5-conformance", "path-contract.ps1");
const RUNNER_TEXT = readFileSync(RUNNER, "utf8");
const CONTRACT_TEXT = readFileSync(CONTRACT, "utf8");
// وعقد بايتات الدليل يُنقَّط كذلك: بدونه يكتب المشغّل بترميز يختاره المضيف.
const JSON_EVIDENCE = join(REPOSITORY, "tools", "evidence-contract", "json-evidence.ps1");
const JSON_EVIDENCE_TEXT = readFileSync(JSON_EVIDENCE, "utf8");

const CONTRACTS_PACKAGE = "@polaris/contracts";

/** يُفضَّل POLARIS_PWSH، ثم pwsh، ثم powershell. غياب الثلاثة تخطٍّ مُسمّى لا تجاهل. */
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

// ── الطبقة الأولى: فحوص نصّية تعمل على أي منصّة ─────────────────────────────

interface LiteralOffence {
  readonly line: number;
  readonly escaped: string;
}

/** تهريب محارف التحكّم حتى يُرى العيب في رسالة الفشل بدل أن يكسر السطر. */
function escapeControl(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, (character) => {
    const code = character.charCodeAt(0);
    if (code === 10) return "\\n";
    if (code === 13) return "\\r";
    if (code === 9) return "\\t";
    if (code === 0) return "\\0";
    return `\\x${code.toString(16).padStart(2, "0")}`;
  });
}

/**
 * ماسح نصوص PowerShell الحرفية.
 *
 * يتخطّى التعليقات وسلاسل here-string — فيهما السطر الجديد مقصود — ويُبلّغ عن
 * كل نصّ حرفي مقتبس يحمل محرف تحكّم. هذا هو الفحص الذي كان غائبًا.
 */
function controlCharacterLiterals(source: string): LiteralOffence[] {
  const offences: LiteralOffence[] = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const character = source[index] as string;
    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (source.startsWith("<#", index)) {
      const end = source.indexOf("#>", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      line += (source.slice(index, stop).match(/\n/g) ?? []).length;
      index = stop;
      continue;
    }
    if (character === "#") {
      const end = source.indexOf("\n", index);
      index = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("@'", index) || source.startsWith('@"', index)) {
      const quote = source[index + 1] as string;
      const terminator = `\n${quote}@`;
      const end = source.indexOf(terminator, index + 2);
      const stop = end < 0 ? source.length : end + terminator.length;
      line += (source.slice(index, stop).match(/\n/g) ?? []).length;
      index = stop;
      continue;
    }
    if (character === '"' || character === "'") {
      const start = index;
      const startLine = line;
      index += 1;
      while (index < source.length) {
        const current = source[index] as string;
        if (current === character) {
          if (source[index + 1] === character) {
            index += 2;
            continue;
          }
          break;
        }
        if (character === '"' && current === "`") {
          index += 2;
          continue;
        }
        if (current === "\n") line += 1;
        index += 1;
      }
      const literal = source.slice(start, index + 1);
      if (/[\u0000-\u001f\u007f]/.test(literal)) {
        offences.push({ line: startLine, escaped: escapeControl(literal).slice(0, 120) });
      }
      index += 1;
      continue;
    }
    index += 1;
  }
  return offences;
}

/** مقطع خطوة تحديث الحزم وحده: الترتيب داخله هو ما يُثبت، لا ورود الأسماء. */
function packageRefreshRegion(): string {
  const start = RUNNER_TEXT.indexOf('Invoke-Step "packages: refresh');
  assert.ok(start > 0, "the package refresh step must exist");
  const end = RUNNER_TEXT.indexOf('Invoke-Step "package resolution gate"', start);
  assert.ok(end > start, "the package resolution gate must follow the refresh step");
  return RUNNER_TEXT.slice(start, end);
}

test("P16: no string literal in the runner or its path contract carries a control character", () => {
  // الفحص المباشر للعيب. لو وُجد هذا السطر وحده لَما وصل العيب إلى المالك.
  assert.deepEqual(controlCharacterLiterals(RUNNER_TEXT), []);
  assert.deepEqual(controlCharacterLiterals(CONTRACT_TEXT), []);
});

test("P15: POSITIVE CONTROL — the scanner does see the exact shape that stopped the owner's run", () => {
  // ضبط موجب: ماسح لا يكشف العيب الأصلي حارسٌ بلا قيمة. الشكل هنا هو الشكل
  // الحقيقي: 'runtime' ثم 0x0A ثم 'ode_modules\@polaris\contracts'.
  const malformed = ["$installed = Join-Path $RepositoryRoot 'runtime", "ode_modules\\@polaris\\contracts'"].join("\n");
  const offences = controlCharacterLiterals(malformed);
  assert.equal(offences.length, 1);
  assert.equal(offences[0]?.line, 1);
  assert.match(offences[0]?.escaped ?? "", /runtime\\node_modules/);
});

test("the installed package path is built from declared segments, not from a path literal", () => {
  const region = packageRefreshRegion();
  assert.equal(
    /'[^']*node_modules[^']*'/.test(region),
    false,
    "a single path literal is exactly what carried the newline; the destination is built from segments",
  );
  assert.match(CONTRACT_TEXT, /function\s+Join-PathSegment/);
  assert.match(CONTRACT_TEXT, /function\s+Get-InstalledPackagePath/);
  assert.match(CONTRACT_TEXT, /function\s+ConvertTo-PackagePathSegment/);
});

test("P12: Test-Path is not reached until the path contract has passed", () => {
  const region = packageRefreshRegion();
  const preflight = region.indexOf("Invoke-PackageRefreshPreflight");
  const contract = region.indexOf("Assert-ScalarPathString");
  const testPath = region.indexOf("Test-Path");
  assert.ok(preflight >= 0, "the refresh step must run the preflight");
  assert.ok(contract >= 0, "the refresh step must assert the path contract");
  assert.ok(testPath > preflight && testPath > contract, "Test-Path must come after the contract");
});

test("P13: Remove-Item is not reached until the destination safety proof has passed", () => {
  const region = packageRefreshRegion();
  const preflight = region.indexOf("Invoke-PackageRefreshPreflight");
  const remove = region.indexOf("Remove-Item");
  assert.ok(remove > preflight, "Remove-Item must come after the destination safety proof");
  assert.match(CONTRACT_TEXT, /function\s+Assert-PackageRefreshDestinationSafe/);
  // البرهان يُستدعى في الإقلاع أيضًا، فقيمة فاسدة توقف التشغيل قبل أن يبدأ.
  assert.match(RUNNER_TEXT, /PACKAGE_REFRESH_PATH_CONTRACT/);
});

test("the defect is not papered over: no path is sanitised into legality", () => {
  // النمط المحرَّم: -replace على المسار حتى يمرّ. ذلك يجعل الحذف يعمل على
  // قيمة لم يقصدها أحد، ويُبقي المُنتِج الفاسد حيًّا.
  assert.equal(CONTRACT_TEXT.includes("-replace"), false);
  assert.equal(packageRefreshRegion().includes("-replace"), false);
  assert.equal(RUNNER_TEXT.includes("Set-StrictMode -Version Latest"), true);
  assert.match(RUNNER_TEXT, /\$ErrorActionPreference\s*=\s*"Stop"/);
});

test("the path contract keeps its success stream clean", () => {
  // دالة تكتب سطرًا نصّيًا على مجرى النجاح تُسلِّم المستدعي مصفوفةً من قيمتين
  // حيث ينتظر مسارًا واحدًا — وهو صنف العيب نفسه من باب آخر.
  assert.equal(CONTRACT_TEXT.includes("Write-Host"), false, "diagnostics belong on the verbose stream");
  assert.equal(CONTRACT_TEXT.includes("Write-Output"), false, "a data function returns, it does not write");
  assert.equal(CONTRACT_TEXT.includes("Format-Table"), false);
  assert.equal(CONTRACT_TEXT.includes("Format-List"), false);
  assert.equal(CONTRACT_TEXT.includes("Out-String"), false, "Out-String appends newlines to what it formats");
  assert.equal(CONTRACT_TEXT.includes("Select-Object name"), false);
});

test("every collection returned by the path contract uses the comma operator", () => {
  const offences: string[] = [];
  CONTRACT_TEXT.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("return ")) return;
    const returned = trimmed.slice("return ".length);
    const looksLikeCollection = returned.startsWith("@(") || /\.ToArray\(\)/.test(returned);
    if (looksLikeCollection && !returned.startsWith(",")) offences.push(`line ${String(index + 1)}: ${trimmed}`);
  });
  assert.deepEqual(offences, []);
});

test("the runner loads the path contract before any filesystem work", () => {
  const load = RUNNER_TEXT.indexOf("path-contract.ps1");
  const refresh = RUNNER_TEXT.indexOf('Invoke-Step "packages: refresh');
  assert.ok(load > 0 && load < refresh, "the contract module must be dot-sourced during bootstrap");
  assert.match(RUNNER_TEXT, /PATH_CONTRACT_MODULE/);
});

// ── الطبقة الثانية: تمرين حقيقي لعقد المسار ─────────────────────────────────

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface ShellRun {
  readonly status: number;
  readonly stdout: string;
  readonly combined: string;
}

/** يُنقِّط الوحدة ثم يُنفّذ الجسم. لا علامة تشغيل أصلي، فلا دليل قانوني. */
function runContract(body: string): ShellRun {
  const script = [
    "Set-StrictMode -Version Latest",
    "$ErrorActionPreference = 'Stop'",
    `. ${psQuote(CONTRACT)}`,
    body,
  ].join("\n");
  const environment = { ...process.env };
  delete environment["POLARIS_W5_NATIVE_RUN"];
  const result = spawnSync(SHELL as string, ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  return { status: result.status ?? -1, stdout, combined: `${stdout}\n${result.stderr ?? ""}` };
}

/** يحاول ويطبع REJECTED مع الرسالة، أو ACCEPTED مع القيمة. الرفض يجب أن يُسمّى. */
function attempt(body: string): string {
  return `try { ${body}; Write-Output 'ACCEPTED' } catch { Write-Output ('REJECTED ' + $_.Exception.Message) }`;
}

const ROOT_PLACEHOLDER = process.platform === "win32" ? "D:\\POLARIS" : "/opt/polaris";
const EXPECTED_DESTINATION = join(ROOT_PLACEHOLDER, "runtime", "node_modules", "@polaris", "contracts");

test("P1: a valid runtime package destination is one canonical scalar path", { skip: shellSkip }, () => {
  const run = runContract(
    [
      `$destination = Get-InstalledPackagePath -RepositoryRoot ${psQuote(ROOT_PLACEHOLDER)} -PackageName ${psQuote(CONTRACTS_PACKAGE)}`,
      "Write-Output ('count=' + @($destination).Count)",
      "Write-Output ('type=' + $destination.GetType().FullName)",
      "Write-Output ('value=' + $destination)",
    ].join("\n"),
  );
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /count=1/);
  assert.match(run.stdout, /type=System\.String/);
  assert.ok(run.stdout.includes(`value=${EXPECTED_DESTINATION}`), run.stdout);
});

test("P2: the package name maps to the scoped node_modules destination", { skip: shellSkip }, () => {
  const run = runContract(
    [
      `$segments = ConvertTo-PackagePathSegment -PackageName ${psQuote(CONTRACTS_PACKAGE)}`,
      "Write-Output ('segments=' + ($segments -join '|'))",
      attempt("$null = ConvertTo-PackagePathSegment -PackageName '@polaris/contracts/../../..'"),
    ].join("\n"),
  );
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /segments=@polaris\|contracts/);
  assert.match(run.stdout, /REJECTED .*NPM_PACKAGE_NAME/);
});

test("P3: an object where a path is expected is rejected before Test-Path", { skip: shellSkip }, () => {
  const run = runContract(
    attempt("$null = Assert-ScalarPathString -Label 'installed' -Value ([pscustomobject] @{ path = 'x' })"),
  );
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*IS_STRING/);
});

test("P4: two strings where one path is expected is a cardinality error", { skip: shellSkip }, () => {
  const run = runContract(
    attempt(`$null = Assert-ScalarPathString -Label 'installed' -Value @('diagnostic text', ${psQuote(EXPECTED_DESTINATION)})`),
  );
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*SINGLE_VALUE/);
  assert.match(run.stdout, /count=2/);
});

test("P5: the exact malformed value — a newline inside the path — is rejected", { skip: shellSkip }, () => {
  // إعادة إنتاج القيمة الأصلية حرفيًا، لا شكلًا مشابهًا.
  const run = runContract(
    [
      `$malformed = ${psQuote(join(ROOT_PLACEHOLDER, "runtime"))} + [char] 10 + 'ode_modules'`,
      attempt("$null = Assert-ScalarPathString -Label 'installed' -Value $malformed"),
      `$carriage = ${psQuote(EXPECTED_DESTINATION)} + [char] 13`,
      attempt("$null = Assert-ScalarPathString -Label 'installed' -Value $carriage"),
      `$tab = ${psQuote(EXPECTED_DESTINATION)} + [char] 9`,
      attempt("$null = Assert-ScalarPathString -Label 'installed' -Value $tab"),
    ].join("\n"),
  );
  assert.equal(run.status, 0, run.combined);
  const rejections = run.stdout.split("\n").filter((line) => line.startsWith("REJECTED"));
  assert.equal(rejections.length, 3, run.stdout);
  for (const rejection of rejections) assert.match(rejection, /NO_ILLEGAL_CHARACTERS/);
  // والتشخيص يقول أي محرف، لا "قيمة غير صالحة" فحسب.
  assert.match(run.stdout, /codes=\[/);
});

test("P6: a NUL inside the path is rejected", { skip: shellSkip }, () => {
  const run = runContract(
    [
      `$withNul = ${psQuote(EXPECTED_DESTINATION)} + [char] 0`,
      attempt("$null = Assert-ScalarPathString -Label 'installed' -Value $withNul"),
    ].join("\n"),
  );
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*NO_ILLEGAL_CHARACTERS/);
});

function safetyAttempt(destination: string): string {
  return attempt(
    `$null = Assert-PackageRefreshDestinationSafe -RepositoryRoot ${psQuote(ROOT_PLACEHOLDER)} -Destination ${psQuote(destination)} -PackageName ${psQuote(CONTRACTS_PACKAGE)}`,
  );
}

test("P7: a destination outside runtime node_modules is refused", { skip: shellSkip }, () => {
  const run = runContract(safetyAttempt(join(ROOT_PLACEHOLDER, "runtime", "node_modules_backup", "@polaris", "contracts")));
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*PACKAGE_REFRESH_DESTINATION_UNSAFE/);
  assert.match(run.stdout, /inside_node_modules/);
});

test("P8: the repository root as a deletion target is refused", { skip: shellSkip }, () => {
  const run = runContract(safetyAttempt(ROOT_PLACEHOLDER));
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*PACKAGE_REFRESH_DESTINATION_UNSAFE/);
  assert.match(run.stdout, /not_repository_root/);
});

test("P9: the node_modules root as a deletion target is refused", { skip: shellSkip }, () => {
  const run = runContract(safetyAttempt(join(ROOT_PLACEHOLDER, "runtime", "node_modules")));
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*PACKAGE_REFRESH_DESTINATION_UNSAFE/);
  assert.match(run.stdout, /not_node_modules_root/);
});

test("P10: the contracts source directory as a deletion target is refused", { skip: shellSkip }, () => {
  const run = runContract(safetyAttempt(join(ROOT_PLACEHOLDER, "contracts")));
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /REJECTED .*PACKAGE_REFRESH_DESTINATION_UNSAFE/);
  assert.match(run.stdout, /not_contracts_source/);
});

test("P11: the intended destination passes canonicalisation and containment", { skip: shellSkip }, () => {
  const run = runContract(
    [
      `$state = Assert-PackageRefreshDestinationSafe -RepositoryRoot ${psQuote(ROOT_PLACEHOLDER)} -Destination ${psQuote(EXPECTED_DESTINATION)} -PackageName ${psQuote(CONTRACTS_PACKAGE)}`,
      "Write-Output ('safe=' + $state.safe)",
      "foreach ($name in @($state.checks.Keys)) { Write-Output ($name + '=' + $state.checks[$name]) }",
      "Write-Output ('destination=' + $state.destination)",
    ].join("\n"),
  );
  assert.equal(run.status, 0, run.combined);
  assert.match(run.stdout, /safe=True/);
  assert.equal(run.stdout.includes("=False"), false, run.stdout);
  assert.ok(run.stdout.includes(`destination=${EXPECTED_DESTINATION}`), run.stdout);
});

test("P16: the fixed construction never reaches Test-Path with an illegal path", { skip: shellSkip }, () => {
  const run = runContract(
    [
      `$destination = Get-InstalledPackagePath -RepositoryRoot ${psQuote(ROOT_PLACEHOLDER)} -PackageName ${psQuote(CONTRACTS_PACKAGE)}`,
      "$exists = Test-Path -LiteralPath $destination",
      "Write-Output ('test_path_ran=' + $exists)",
    ].join("\n"),
  );
  assert.equal(run.status, 0, run.combined);
  assert.equal(run.combined.includes("Illegal characters in path"), false, run.combined);
  assert.match(run.stdout, /test_path_ran=/);
});

// ── الفحص المسبق داخل المشغّل نفسه ──────────────────────────────────────────

const MARKERS: ReadonlyArray<{ readonly path: readonly string[]; readonly directory: boolean }> = [
  { path: ["contracts", "package.json"], directory: false },
  { path: ["runtime", "package.json"], directory: false },
  { path: ["desktop", "host"], directory: true },
  { path: ["tools", "w4-windows-conformance", "run.ps1"], directory: false },
  { path: ["tools", "w5-conformance", "w5-test-groups.mjs"], directory: false },
  { path: ["tools", "w5-windows-adapter", "build.ps1"], directory: false },
];

interface Fixture {
  readonly root: string;
  readonly runner: string;
  dispose(): void;
}

/** مستودع عيّنة يحمل العلامات، ومعه المشغّل ووحدة عقد المسارات بجواره. */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "polaris-w5-refresh-"));
  for (const marker of MARKERS) {
    const target = join(root, ...marker.path);
    if (marker.directory) mkdirSync(target, { recursive: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "placeholder\n", "utf8");
    }
  }
  const runner = join(root, "tools", "w5-conformance", "run.ps1");
  mkdirSync(dirname(runner), { recursive: true });
  writeFileSync(runner, RUNNER_TEXT, "utf8");
  writeFileSync(join(root, "tools", "w5-conformance", "path-contract.ps1"), CONTRACT_TEXT, "utf8");
  const jsonEvidence = join(root, "tools", "evidence-contract", "json-evidence.ps1");
  mkdirSync(dirname(jsonEvidence), { recursive: true });
  writeFileSync(jsonEvidence, JSON_EVIDENCE_TEXT, "utf8");
  return {
    root,
    runner,
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("P14: the package-refresh preflight runs under the interpreter and touches nothing", { skip: shellSkip }, () => {
  const repo = fixture();
  try {
    const environment = { ...process.env };
    delete environment["POLARIS_W5_NATIVE_RUN"];
    const result = spawnSync(
      SHELL as string,
      ["-NoProfile", "-File", repo.runner, "-RepositoryRoot", repo.root, "-PackageRefreshPreflight"],
      { encoding: "utf8", env: environment, maxBuffer: 32 * 1024 * 1024 },
    );
    const stdout = result.stdout ?? "";
    const combined = `${stdout}\n${result.stderr ?? ""}`;
    assert.equal(result.status, 0, combined);
    assert.match(stdout, /PACKAGE_REFRESH_PREFLIGHT = PASS/);
    // الوجهة تُطبع مقتبسة، فمحرف تحكّم داخلها يُرى بين القوسين.
    assert.ok(
      stdout.includes(`"${join(repo.root, "runtime", "node_modules", "@polaris", "contracts")}"`),
      stdout,
    );
    // ولا أثر: لا حذف، ولا تثبيت، ولا دليل قانوني.
    assert.equal(existsSync(join(repo.root, "runtime", "node_modules")), false, "the preflight created node_modules");
    for (const name of ["w5-run.json", "w5-test-groups.json", "w5-panic-stop.json"]) {
      assert.equal(existsSync(join(repo.root, "evidence", name)), false, `${name} was written by a preflight`);
    }
    // القراءة القانونية: البايتات تُثبت قبل التحليل، فلا BOM يمرّ صامتًا.
    const record = readCanonicalEvidence(join(repo.root, "evidence", "w5-runner-bootstrap.json"));
    assert.equal(record["canonical"], false);
    assert.equal(record["classification"], "NOT_TESTED");
    assert.equal(record["canonical_measurement_started"], false);
    // ولا يقول السجل PASS لـW5: فحص مسبق نظيف ليس نتيجة.
    assert.equal(record["verdict"], undefined);
  } finally {
    repo.dispose();
  }
});

test("the malformed runner cannot pass the preflight: negative control", { skip: shellSkip }, () => {
  // نفس المشغّل، وقد أُعيد إليه العيب الأصلي في وحدة العقد: الوجهة تُبنى من
  // نصّ حرفي يحمل 0x0A. يجب أن يقف التشغيل عائقًا مُسمّى قبل أي قياس.
  const repo = fixture();
  try {
    const broken = CONTRACT_TEXT.replace(
      "  return (Join-PathSegment -Label \"installed\" -Root $modules -Segments $segments)",
      "  return ($modules + [System.IO.Path]::DirectorySeparatorChar + 'runtime' + [char] 10 + 'ode_modules')",
    );
    assert.notEqual(broken, CONTRACT_TEXT, "the negative control did not patch the contract");
    writeFileSync(join(repo.root, "tools", "w5-conformance", "path-contract.ps1"), broken, "utf8");
    const environment = { ...process.env };
    delete environment["POLARIS_W5_NATIVE_RUN"];
    const result = spawnSync(
      SHELL as string,
      ["-NoProfile", "-File", repo.runner, "-RepositoryRoot", repo.root, "-PackageRefreshPreflight"],
      { encoding: "utf8", env: environment, maxBuffer: 32 * 1024 * 1024 },
    );
    const stdout = result.stdout ?? "";
    assert.equal(result.status, 2, `${stdout}\n${result.stderr ?? ""}`);
    assert.equal(stdout.includes("PACKAGE_REFRESH_PREFLIGHT = PASS"), false, stdout);
    assert.match(stdout, /classification : BLOCKED/);
    // القراءة القانونية: البايتات تُثبت قبل التحليل، فلا BOM يمرّ صامتًا.
    const record = readCanonicalEvidence(join(repo.root, "evidence", "w5-runner-bootstrap.json"));
    assert.equal(record["classification"], "BLOCKED");
    assert.equal(record["error_code"], "W5_PACKAGE_REFRESH_PATH_DEFECT");
    assert.equal(record["failure_stage"], "PACKAGE_REFRESH_PATH_CONTRACT");
    assert.equal(record["canonical_measurement_started"], false);
  } finally {
    repo.dispose();
  }
});
