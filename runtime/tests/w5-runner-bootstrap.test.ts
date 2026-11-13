// انحدار إقلاع مشغّل W5.
//
// العيب الذي يحرسه هذا الملف وقع فعلًا في أول تشغيل أصلي، وأوقف المشغّل قبل
// أن يصل إلى أي قياس:
//
//   The property 'Count' cannot be found on this object.
//   FullyQualifiedErrorId : PropertyNotFoundStrict
//
// السبب: PowerShell يعدّ قيمة إرجاع الدالة إلى المجرى. فدالة تعيد مصفوفة
// تُسلِّم للمستدعي $null عند صفر عنصر، وقيمةً مفردة عند عنصر واحد، ومصفوفةً
// عند اثنين فأكثر. و.Count على الأوليَين تحت StrictMode ترمي.
//
// الحالة الوحيدة التي كانت تعمل هي «اثنان فأكثر» — أي الحالة التي لا يمرّ بها
// تشغيل سليم. جذرٌ صحيح يعني صفر علامات ناقصة، أي $null بالضبط.
//
// لماذا لم يمسكه المضيف اللينكسي: اختبارات المشغّل كانت تتخطّى لغياب مفسّر
// PowerShell. لذلك هذا الملف طبقتان: فحوص نصّية تعمل على أي منصّة، وتشغيل
// حقيقي حين يوجد مفسّر. الأولى وحدها كانت ستكفي لكشف العيب.

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
const RUNNER_TEXT = readFileSync(RUNNER, "utf8");
// المشغّل ينقّط عقد المسارات من جواره، فالعيّنة تحمل الملفين معًا.
const PATH_CONTRACT = join(REPOSITORY, "tools", "w5-conformance", "path-contract.ps1");
const PATH_CONTRACT_TEXT = readFileSync(PATH_CONTRACT, "utf8");
// وعقد بايتات الدليل يُنقَّط كذلك: بدونه يكتب المشغّل بترميز يختاره المضيف.
const JSON_EVIDENCE = join(REPOSITORY, "tools", "evidence-contract", "json-evidence.ps1");
const JSON_EVIDENCE_TEXT = readFileSync(JSON_EVIDENCE, "utf8");

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

/** العلامات التي يشترطها المشغّل. الحذف منها يصنع الحالات صفر/واحد/كثير. */
const MARKERS: ReadonlyArray<{ readonly key: string; readonly path: readonly string[]; readonly directory: boolean }> = [
  { key: "contracts", path: ["contracts", "package.json"], directory: false },
  { key: "runtime", path: ["runtime", "package.json"], directory: false },
  { key: "docs", path: ["desktop", "host"], directory: true },
  { key: "w4runner", path: ["tools", "w4-windows-conformance", "run.ps1"], directory: false },
  { key: "groups", path: ["tools", "w5-conformance", "w5-test-groups.mjs"], directory: false },
  { key: "adapter", path: ["tools", "w5-windows-adapter", "build.ps1"], directory: false },
];

interface Fixture {
  readonly root: string;
  readonly runner: string;
  dispose(): void;
}

/** مستودع عيّنة يحمل كل العلامات إلا ما استُثني. */
function fixture(omit: readonly string[] = []): Fixture {
  const root = mkdtempSync(join(tmpdir(), "polaris-w5-bootstrap-"));
  for (const marker of MARKERS) {
    if (omit.includes(marker.key)) continue;
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
  writeFileSync(join(root, "tools", "w5-conformance", "path-contract.ps1"), PATH_CONTRACT_TEXT, "utf8");
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

interface ShellRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly combined: string;
}

function runSelfCheck(runner: string, args: readonly string[], cwd?: string): ShellRun {
  const environment = { ...process.env };
  // حارس مزدوج: لا اختبار يرفع علامة التشغيل الأصلي، فلا يكتب دليلًا قانونيًا.
  delete environment["POLARIS_W5_NATIVE_RUN"];
  const result = spawnSync(SHELL as string, ["-NoProfile", "-File", runner, ...args], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
    ...(cwd === undefined ? {} : { cwd }),
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, combined: `${stdout}\n${stderr}` };
}

function bootstrapRecord(root: string): Record<string, unknown> {
  const path = join(root, "evidence", "w5-runner-bootstrap.json");
  assert.equal(existsSync(path), true, "the bootstrap record must be written whatever happens");
  // القراءة القانونية: البايتات تُثبت قبل التحليل. علامة ترتيب بايتات هنا
  // عيبٌ يُسمّى — EVIDENCE_UTF8_BOM_PRESENT — لا محرف يُقشَّر بصمت.
  return readCanonicalEvidence(path);
}

// ── الطبقة الأولى: فحوص نصّية تعمل على أي منصّة ─────────────────────────────
//
// هذه هي الطبقة التي كانت غائبة. لو وُجدت لَكُشف العيب على المضيف اللينكسي
// قبل أن يصل إلى المالك.

test("the runner keeps StrictMode and stop-on-error: they exposed the defect, they stay", () => {
  assert.match(RUNNER_TEXT, /Set-StrictMode\s+-Version\s+Latest/);
  assert.match(RUNNER_TEXT, /\$ErrorActionPreference\s*=\s*"Stop"/);
});

test("every function that returns a collection uses the comma operator", () => {
  // بدونه يعدّ المجرى القيمة مرة أخرى، فتعود المصفوفة الفارغة $null والمصفوفة
  // أحادية العنصر قيمةً مفردة — أي أن الدالة تُعيد إنتاج العيب نفسه.
  const offences: string[] = [];
  const lines = RUNNER_TEXT.split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("return ")) return;
    const returned = trimmed.slice("return ".length);
    const looksLikeCollection = returned.startsWith("@(") || /\.ToArray\(\)/.test(returned);
    if (looksLikeCollection && !returned.startsWith(",")) {
      offences.push(`line ${String(index + 1)}: ${trimmed}`);
    }
  });
  assert.deepEqual(offences, []);
});

test("no .Count is taken on a receiver that was not proven to be a collection", () => {
  // المستقبِلات المقبولة: List<T>، أو متغيّر أُسند من @(...) أو من المُطبِّع.
  const lines = RUNNER_TEXT.split("\n");
  const safe = new Set<string>();
  for (const line of lines) {
    const list = /^\s*\$(?:script:)?(\w+)\s*=\s*New-Object\s+System\.Collections\.Generic\.List/.exec(line);
    if (list !== null) safe.add(list[1] as string);
    const wrapped = /^\s*\$(?:script:)?(\w+)\s*=\s*(?:ConvertTo-CountableArray\b|@\()/.exec(line);
    if (wrapped !== null) safe.add(wrapped[1] as string);
  }

  const offences: string[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // التعليقات تشرح العيب وتذكر .Count عمدًا.
    if (trimmed.startsWith("#") || trimmed.startsWith("<#")) return;
    const pattern = /\$(?:script:)?(\w+)\.Count\b/g;
    let match: RegExpExecArray | null = pattern.exec(line);
    while (match !== null) {
      const receiver = match[1] as string;
      if (!safe.has(receiver)) offences.push(`line ${String(index + 1)}: $${receiver}.Count — receiver is not a proven collection`);
      match = pattern.exec(line);
    }
  });
  assert.deepEqual(offences, []);
});

test("the resolver normalises the marker list before counting it", () => {
  assert.match(RUNNER_TEXT, /function\s+ConvertTo-CountableArray/);
  assert.match(RUNNER_TEXT, /ConvertTo-CountableArray\s+\(Get-MissingMarkers/);
});

test("bootstrap failure writes only the non-canonical record, never canonical W5 evidence", () => {
  const canonical = [
    "w5-run.json",
    "w5-test-groups.json",
    "w5-panic-stop.json",
    "w5-audit-chain.json",
    "w5-approval.json",
    "w5-completion-proof.json",
    "w5-scenarios.json",
  ];
  // مسار الإقلاع الفاشل ينتهي بـexit 2 قبل أي كتابة قانونية. الاسم الوحيد
  // الذي يجوز أن يُكتب فيه هو سجل الإقلاع غير القانوني.
  const bootstrapRegion = RUNNER_TEXT.slice(0, RUNNER_TEXT.indexOf("$script:CanonicalRunStarted = $true"));
  assert.ok(bootstrapRegion.length > 0, "the canonical-run marker must exist and come after bootstrap");
  for (const name of canonical) {
    assert.equal(bootstrapRegion.includes(name), false, `the bootstrap region must not write ${name}`);
  }
  assert.ok(bootstrapRegion.includes("w5-runner-bootstrap.json"));
});

// ── الطبقة الثانية: تشغيل حقيقي ─────────────────────────────────────────────

test(
  "REGRESSION A: zero missing markers — the shape that crashed — now boots cleanly",
  { skip: shellSkip },
  () => {
    const repo = fixture();
    try {
      const run = runSelfCheck(repo.runner, ["-RepositoryRoot", repo.root, "-SelfCheck"]);
      assert.equal(
        run.combined.includes("PropertyNotFoundStrict"),
        false,
        `the defect returned:\n${run.combined}`,
      );
      assert.match(run.stdout, /SELFCHECK RESULT: BOOTSTRAP_OK/);
      assert.equal(run.status, 0);

      const record = bootstrapRecord(repo.root);
      assert.equal(record["bootstrap_ok"], true);
      assert.equal(record["canonical"], false);
      assert.equal(record["canonical_run_started"], false);
      assert.equal(record["classification"], "NOT_TESTED");
      assert.equal(record["root_resolution_method"], "EXPLICIT_PARAMETER");
    } finally {
      repo.dispose();
    }
  },
);

test(
  "REGRESSION B: exactly one missing marker — the scalar-unwrap shape — fails loudly and names it",
  { skip: shellSkip },
  () => {
    const repo = fixture(["groups"]);
    try {
      const run = runSelfCheck(repo.runner, ["-RepositoryRoot", repo.root, "-SelfCheck"]);
      assert.equal(run.combined.includes("PropertyNotFoundStrict"), false, run.combined);
      assert.match(run.stdout, /classification : BLOCKED/);
      assert.match(run.stdout, /w5-test-groups\.mjs/);
      assert.equal(run.status, 2);

      const record = bootstrapRecord(repo.root);
      assert.equal(record["classification"], "BLOCKED");
      assert.equal(record["error_code"], "W5_RUNNER_BOOTSTRAP_DEFECT");
      assert.equal(record["bootstrap_ok"], false);
      assert.equal(record["failure_stage"], "ROOT_RESOLUTION");
    } finally {
      repo.dispose();
    }
  },
);

test(
  "REGRESSION C: several missing markers are all named, not just the first",
  { skip: shellSkip },
  () => {
    const repo = fixture(["groups", "adapter", "docs"]);
    try {
      const run = runSelfCheck(repo.runner, ["-RepositoryRoot", repo.root, "-SelfCheck"]);
      assert.equal(run.combined.includes("PropertyNotFoundStrict"), false, run.combined);
      for (const fragment of ["desktop", "w5-test-groups.mjs", "build.ps1"]) {
        assert.ok(run.stdout.includes(fragment), `the failure did not name ${fragment}`);
      }
      assert.equal(run.status, 2);
    } finally {
      repo.dispose();
    }
  },
);

test(
  "the root resolves from the script's own location when no argument is given",
  { skip: shellSkip },
  () => {
    const repo = fixture();
    try {
      const run = runSelfCheck(repo.runner, ["-SelfCheck"], tmpdir());
      assert.match(run.stdout, /SELFCHECK RESULT: BOOTSTRAP_OK/);
      assert.match(run.stdout, /resolved by: PSSCRIPTROOT/);
      assert.equal(bootstrapRecord(repo.root)["root_resolution_method"], "PSSCRIPTROOT");
    } finally {
      repo.dispose();
    }
  },
);

test(
  "an explicit but wrong root fails loudly and never falls back to a working one",
  { skip: shellSkip },
  () => {
    const good = fixture();
    const wrong = mkdtempSync(join(tmpdir(), "polaris-w5-not-a-repo-"));
    try {
      const run = runSelfCheck(good.runner, ["-RepositoryRoot", wrong, "-SelfCheck"]);
      assert.match(run.stdout, /classification : BLOCKED/);
      assert.equal(run.stdout.includes("SELFCHECK RESULT: BOOTSTRAP_OK"), false);
      assert.equal(run.status, 2);
      // ولم يُستعمل الجذر الصالح رغم توفّره: الخطأ الصريح يفشل صراحةً.
      //
      // المقارنة على ما اعتمده المشغّل جذرًا، لا على ظهور النص: مسار السكربت
      // نفسه يقع داخل العيّنة الصالحة ويظهر في سطر الموضع، وذلك ليس رجوعًا.
      assert.equal(run.stdout.includes("resolved by:"), false, "a wrong explicit root must never resolve");
      const record = bootstrapRecord(wrong);
      assert.equal(record["repository_root"], wrong);
      assert.equal(record["root_resolution_method"], "UNRESOLVED");
    } finally {
      good.dispose();
      rmSync(wrong, { recursive: true, force: true });
    }
  },
);

test(
  "the runner works from an arbitrary current working directory",
  { skip: shellSkip },
  () => {
    const repo = fixture();
    const elsewhere = mkdtempSync(join(tmpdir(), "polaris-w5-elsewhere-"));
    try {
      const run = runSelfCheck(repo.runner, ["-RepositoryRoot", repo.root, "-SelfCheck"], elsewhere);
      assert.match(run.stdout, /SELFCHECK RESULT: BOOTSTRAP_OK/);
      assert.equal(run.status, 0);
    } finally {
      repo.dispose();
      rmSync(elsewhere, { recursive: true, force: true });
    }
  },
);

test(
  "the self-check stops before any adapter build and before any probe",
  { skip: shellSkip },
  () => {
    const repo = fixture();
    try {
      const run = runSelfCheck(repo.runner, ["-RepositoryRoot", repo.root, "-SelfCheck"]);
      assert.match(run.stdout, /SELFCHECK RESULT: BOOTSTRAP_OK/);
      const forbidden = ["contracts: verify", "W5 adapter: build", "W5 native probe", "W4 native regression"];
      for (const step of forbidden) {
        assert.equal(run.stdout.includes(step), false, `the self-check ran ${step}`);
      }
      // ولا دليل قانوني واحد.
      for (const name of ["w5-run.json", "w5-test-groups.json", "w5-panic-stop.json"]) {
        assert.equal(existsSync(join(repo.root, "evidence", name)), false, `${name} was written by a self-check`);
      }
    } finally {
      repo.dispose();
    }
  },
);

test(
  "the bootstrap record states the host truthfully rather than assuming Windows",
  { skip: shellSkip },
  () => {
    const repo = fixture();
    try {
      runSelfCheck(repo.runner, ["-RepositoryRoot", repo.root, "-SelfCheck"]);
      const record = bootstrapRecord(repo.root);
      assert.equal(typeof record["powershell_version"], "string");
      assert.notEqual(record["powershell_version"], "");
      // على مضيف غير ويندوز يجب ألا يقول السجل Win32NT.
      if (process.platform !== "win32") {
        assert.notEqual(record["platform"], "Win32NT", "the record claimed Windows on a non-Windows host");
      }
    } finally {
      repo.dispose();
    }
  },
);

test(
  "a one-element JSON array is read without the StrictMode defect returning",
  { skip: shellSkip },
  () => {
    // نفس صنف العيب من باب آخر: ConvertFrom-Json ومصفوفة بعنصر واحد. المشغّل
    // يقرأ survivors من دليل المسبار، فيجب أن تتعامل الحالات الثلاث سواءً.
    const script = [
      "Set-StrictMode -Version Latest",
      "$ErrorActionPreference = 'Stop'",
      "function Get-JsonProperty { param($Object, [string] $Name)",
      "  if ($null -eq $Object) { return $null }",
      "  $p = $Object.PSObject.Properties[$Name]; if ($null -eq $p) { return $null }; return $p.Value }",
      "function ConvertTo-CountableArray { param($Value)",
      "  if ($null -eq $Value) { return ,@() }; return ,@($Value) }",
      "foreach ($json in @('{\"survivors\":[]}', '{\"survivors\":[\"1234\"]}', '{\"survivors\":[\"1\",\"2\"]}', '{}')) {",
      "  $doc = $json | ConvertFrom-Json",
      "  $items = ConvertTo-CountableArray (Get-JsonProperty -Object $doc -Name 'survivors')",
      "  Write-Output ('count=' + $items.Count) }",
    ].join("\n");
    const result = spawnSync(SHELL as string, ["-NoProfile", "-Command", script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
    assert.equal((result.stdout ?? "").includes("PropertyNotFoundStrict"), false);
    assert.deepEqual(
      (result.stdout ?? "").trim().split(/\r?\n/),
      ["count=0", "count=1", "count=2", "count=0"],
    );
  },
);
