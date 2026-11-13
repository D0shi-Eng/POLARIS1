// انحدار رسم الحزم — REG-PKG-001 … REG-PKG-012.
//
// عيبان مختلفان وُلد منهما هذا الملف، ولا يجوز الخلط بينهما:
//
//   D1 — التبعية المحلّية كانت تتحقّق رابطًا في node_modules. الرابط كائن نظام
//        ملفات يكتبه آخر نظام تشغيل شغّل npm على نفس المجلد، و‎D:\POLARIS‎
//        يصل إليه اثنان. رابط لينكس لا يجتازه ويندوز، وjunction ويندوز لا
//        يُقرأ من لينكس — فيفشل tsc بـ TS2307 وتتلوه TS7006 المتتالية.
//        العلاج: install-links=true، فتُحزَم العقود وتُثبَّت حزمةً عادية.
//
//   D2 — المشغّل قرأ نتيجة البوابة خطأً. ‎& node …‎ يضع stdout في مجرى إخراج
//        الدالة، فعاد ‎return $LASTEXITCODE‎ مصفوفةً، و‎-ne 0‎ على مصفوفة ترشيح
//        لا مقارنة. أعلن المشغّل فشل حزم بينما البوابة كتبت PASS.
//
// القاعدة المفروضة هنا: الإعلان ليس حلًّا، ونجاح أمر ليس دليل حلّ. الحلّ يُقاس
// — تحقّقًا وبناءً وتحميلًا في Node وأنواعًا في TypeScript — على المضيف العامل.
//
// ملاحظة صدق: نجاح هذه الاختبارات على لينكس لا يثبت شيئًا عن ويندوز. البوابة
// نفسها هي ما يُشغَّل على ويندوز، وهي ما يكتب الدليل هناك.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { runtimeSrcPath } from "./helpers.js";

const RUNTIME = join(runtimeSrcPath(), "..");
const REPOSITORY = join(RUNTIME, "..");
const CONTRACTS = join(REPOSITORY, "contracts");
const GATE = join(REPOSITORY, "tools", "package-resolution", "check-package-graph.mjs");
const RUNNER = join(REPOSITORY, "tools", "w4-windows-conformance", "run.ps1");
const INSTALLED = join(RUNTIME, "node_modules", "@polaris", "contracts");

const EVIDENCE_NAME =
  process.platform === "win32" ? "w4-package-resolution.json" : "w4-package-resolution.local.json";

interface GateCheck {
  readonly check_id: string;
  readonly title: string;
  readonly status: string;
  readonly detail: string;
  readonly error_code: string | null;
}

interface GateRecord {
  readonly platform: string;
  readonly repository_root: string;
  readonly strategy: string;
  readonly materialization: string;
  readonly ran_at: string;
  readonly status: string;
  readonly error_code: string | null;
  readonly summary: { passed: number; failed: number; total: number };
  readonly checks: readonly GateCheck[];
}

function runGate(root: string): { status: number; stdout: string; record: GateRecord | undefined } {
  const result = spawnSync(process.execPath, [GATE, "--root", root], { encoding: "utf8", cwd: tmpdir() });
  const evidence = join(root, "evidence", EVIDENCE_NAME);
  const record = existsSync(evidence) ? (JSON.parse(readFileSync(evidence, "utf8")) as GateRecord) : undefined;
  return { status: result.status ?? -1, stdout: `${result.stdout}${result.stderr}`, record };
}

function checkOf(record: GateRecord | undefined, id: string): GateCheck | undefined {
  return record?.checks.find((check) => check.check_id === id);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const CONTRACTS_ENTRY_JS = 'export function validateContract() {\n  return { valid: true };\n}\n';
const CONTRACTS_ENTRY_DTS = "export declare function validateContract(): { valid: boolean };\n";

const FIXTURE_CONTRACTS_MANIFEST = JSON.stringify(
  {
    name: "@polaris/contracts",
    version: "1.0.0",
    private: true,
    type: "module",
    main: "./dist/src/index.js",
    types: "./dist/src/index.d.ts",
    exports: { ".": { types: "./dist/src/index.d.ts", import: "./dist/src/index.js" } },
    files: ["dist", "schemas"],
  },
  null,
  2,
);

const FIXTURE_RUNTIME_MANIFEST = JSON.stringify(
  {
    name: "@polaris/runtime",
    version: "0.1.0",
    private: true,
    type: "module",
    dependencies: { "@polaris/contracts": "file:../contracts" },
  },
  null,
  2,
);

const FIXTURE_RUNTIME_LOCK = JSON.stringify(
  {
    name: "@polaris/runtime",
    version: "0.1.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "@polaris/runtime", version: "0.1.0", dependencies: { "@polaris/contracts": "file:../contracts" } },
      "node_modules/@polaris/contracts": { version: "1.0.0", resolved: "file:../contracts" },
    },
  },
  null,
  2,
);

/**
 * مستودع صناعي صغير يحمل علامات POLARIS ويُحقّق التبعية المحلّية حزمةً مُحزَّمة
 * — بنسخ الملفات لا بتشغيل npm، فلا شبكة ولا زمن تثبيت. هذه هي الحالة السليمة،
 * والاختبارات تُفسدها بطريقة واحدة كل مرة لتقيس ما تكشفه البوابة.
 */
function makeFixture(options: { readonly materializeDist: boolean } = { materializeDist: true }): string {
  const root = mkdtempSync(join(tmpdir(), "polaris-pkg-fixture-"));

  write(join(root, "docs", "phases", "PHASE-00", "README.md"), "marker\n");
  write(join(root, "tools", "w4-windows-conformance", "windows-probes.mjs"), "// marker\n");

  write(join(root, "contracts", "package.json"), FIXTURE_CONTRACTS_MANIFEST);
  write(join(root, "contracts", "schemas", "marker.json"), "{}\n");
  write(join(root, "contracts", "dist", "src", "index.js"), CONTRACTS_ENTRY_JS);
  write(join(root, "contracts", "dist", "src", "index.d.ts"), CONTRACTS_ENTRY_DTS);
  mkdirSync(join(root, "contracts", "node_modules"), { recursive: true });

  write(join(root, "runtime", "package.json"), FIXTURE_RUNTIME_MANIFEST);
  write(join(root, "runtime", "package-lock.json"), FIXTURE_RUNTIME_LOCK);
  write(join(root, "runtime", ".npmrc"), "install-links=true\n");
  mkdirSync(join(root, "runtime", "src"), { recursive: true });

  const installed = join(root, "runtime", "node_modules", "@polaris", "contracts");
  write(join(installed, "package.json"), FIXTURE_CONTRACTS_MANIFEST);
  if (options.materializeDist) {
    write(join(installed, "dist", "src", "index.js"), CONTRACTS_ENTRY_JS);
    write(join(installed, "dist", "src", "index.d.ts"), CONTRACTS_ENTRY_DTS);
  }
  return root;
}

// ── REG-PKG-001 ─────────────────────────────────────────────────────────────

test("REG-PKG-001: runtime resolves @polaris/contracts on this host, and the gate says so", () => {
  const gate = runGate(REPOSITORY);
  assert.equal(gate.status, 0, gate.stdout);

  const record = gate.record;
  assert.notEqual(record, undefined, "the gate wrote no evidence");
  assert.equal(record?.status, "PASS");
  assert.equal(record?.error_code, null);
  assert.equal(record?.summary.failed, 0);
  assert.ok((record?.summary.total ?? 0) >= 11, "the gate ran fewer checks than it declares");
  assert.equal(record?.platform, process.platform);
  // شكل التحقّق مكتوب في الدليل: نتيجة بلا معرفة آليةِ التحقّق لا تُقرأ.
  assert.equal(record?.materialization, "PACKED_PACKAGE");
  assert.match(record?.strategy ?? "", /install-links=true/);
});

test("REG-PKG-001 positive control: the gate fails on a graph that is only declared", () => {
  // ضابط موجب: بوابة لا تستطيع أن تُظهر فشلًا لا تثبت شيئًا حين لا تجد فشلًا.
  const root = makeFixture();
  rmSync(join(root, "runtime", "node_modules"), { recursive: true, force: true });

  const gate = runGate(root);
  assert.equal(gate.status, 2, "the gate passed a repository whose dependency was never installed");
  assert.equal(gate.record?.status, "FAIL");
  assert.equal(checkOf(gate.record, "PKG-04")?.status, "FAIL");
  assert.equal(checkOf(gate.record, "PKG-04")?.error_code, "POLARIS_PACKAGE_MATERIALIZATION_MISSING");
  assert.match(gate.stdout, /No security claim was tested/);
});

test("REG-PKG-001: the gate refuses to claim anything when its root will not resolve", () => {
  const result = spawnSync(process.execPath, [GATE, "--root", join(tmpdir(), "definitely-not-polaris")], {
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /BOOTSTRAP FAILED/);
});

// ── REG-PKG-002 · REG-PKG-009 ───────────────────────────────────────────────

interface TypeScriptResolver {
  readonly version: string;
  readonly ModuleKind: { readonly NodeNext: number };
  readonly ModuleResolutionKind: { readonly NodeNext: number };
  readonly ScriptTarget: { readonly ES2022: number };
  readonly sys: unknown;
  resolveModuleName(
    name: string,
    containingFile: string,
    options: Record<string, unknown>,
    host: unknown,
  ): { resolvedModule?: { resolvedFileName: string } };
}

function resolveWithTypeScript(): { version: string; file: string | undefined } {
  const ts = createRequire(join(RUNTIME, "package.json"))("typescript") as TypeScriptResolver;
  const resolved = ts.resolveModuleName(
    "@polaris/contracts",
    join(RUNTIME, "src", "runtime.ts"),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
    },
    ts.sys,
  );
  return { version: ts.version, file: resolved.resolvedModule?.resolvedFileName };
}

test("REG-PKG-002: TypeScript resolves the package declarations with the runtime's own settings", () => {
  // نفس المُحلِّل الذي يستعمله tsc، بنفس الوضع — لا فحص وجود ملف ولا alias.
  const { version, file } = resolveWithTypeScript();
  assert.notEqual(file, undefined, `TypeScript ${version} cannot resolve @polaris/contracts: this is TS2307`);
  assert.ok(file?.endsWith(".d.ts"), `TypeScript resolved ${String(file)}, which is not a declaration file`);
  assert.equal(existsSync(file as string), true);
});

test("REG-PKG-009: clean materialisation produces TypeScript-resolvable declarations inside the package", () => {
  // الإعلانات تأتي من الحزمة المثبَّتة، لا من مجلد العقود عبر رابط.
  const { file } = resolveWithTypeScript();
  const inside = relative(realpathSync(INSTALLED), realpathSync(file as string));
  assert.equal(inside.startsWith(".."), false, `declarations resolved outside the materialised package: ${String(file)}`);
});

// ── REG-PKG-003 · REG-PKG-008 ───────────────────────────────────────────────

const NODE_PROBE = [
  'const url = import.meta.resolve("@polaris/contracts");',
  'const module = await import("@polaris/contracts");',
  'process.stdout.write(JSON.stringify({ url, callable: typeof module.validateContract === "function", exported: Object.keys(module).length }));',
].join("\n");

function importFromRuntime(): { url: string; callable: boolean; exported: number } {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", NODE_PROBE], {
    cwd: RUNTIME,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as { url: string; callable: boolean; exported: number };
}

test("REG-PKG-003: Node itself imports the built package from the runtime package", () => {
  // نجاح tsc لا يثبت حلّ Node. هذا الاختبار يقيس المحرّك لا المُصرِّف.
  const report = importFromRuntime();
  assert.equal(report.callable, true, "the package loaded but does not expose validateContract");
  assert.ok(report.exported > 0);
});

test("REG-PKG-008: clean materialisation produces a Node-loadable package, not a link", () => {
  const entry = lstatSync(INSTALLED);
  assert.equal(entry.isSymbolicLink(), false, "the dependency is a link again; install-links=true is not in force");
  assert.equal(entry.isDirectory(), true);

  const report = importFromRuntime();
  const inside = relative(realpathSync(INSTALLED), realpathSync(new URL(report.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
  assert.equal(inside.startsWith(".."), false, `Node resolved ${report.url}, which is outside the materialised package`);
});

// ── REG-PKG-004 · REG-PKG-012 ───────────────────────────────────────────────

function collect(directory: string, extensions: readonly string[], accumulator: string[] = []): string[] {
  if (!existsSync(directory)) return accumulator;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name === "node_modules" || item.name === "dist") continue;
    const full = join(directory, item.name);
    if (item.isDirectory()) collect(full, extensions, accumulator);
    else if (extensions.some((extension) => item.name.endsWith(extension))) accumulator.push(full);
  }
  return accumulator;
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("REG-PKG-004: runtime declares no contract-owned dependency and holds no contract-shaped directory", () => {
  for (const forbidden of ["contracts", "schemas", join("src", "contracts")]) {
    assert.equal(existsSync(join(RUNTIME, forbidden)), false, `runtime/${forbidden} exists`);
  }
  const manifest = readJson(join(RUNTIME, "package.json"));
  const dependencies = { ...(manifest["dependencies"] as object), ...(manifest["devDependencies"] as object) };
  for (const owned of ["ajv", "ajv-formats", "json-schema-to-typescript"]) {
    assert.equal(owned in dependencies, false, `runtime declares ${owned}, which belongs to contracts`);
  }
});

test("REG-PKG-012: no contract schema or source is duplicated under runtime source", () => {
  // ADR-002: مصدر واحد للحقيقة، يُقاس بالمحتوى لا بالاسم. الحزمة المثبَّتة تحت
  // node_modules أثر مدير حزم مشتقّ آليًا ومُهمَل في git، لا مصدر ثانٍ.
  const sources = new Map<string, string>();
  for (const path of collect(join(CONTRACTS, "src"), [".ts"])) sources.set(digest(path), relative(REPOSITORY, path));
  for (const path of collect(join(CONTRACTS, "schemas"), [".json"])) sources.set(digest(path), relative(REPOSITORY, path));
  for (const path of collect(join(CONTRACTS, "generated"), [".ts"])) sources.set(digest(path), relative(REPOSITORY, path));

  const copies: string[] = [];
  for (const path of [...collect(join(RUNTIME, "src"), [".ts", ".json"]), ...collect(join(RUNTIME, "tests"), [".ts", ".json"])]) {
    const original = sources.get(digest(path));
    if (original !== undefined) copies.push(`${relative(REPOSITORY, path)} copies ${original}`);
  }
  assert.deepEqual(copies, [], "contract sources have been copied into runtime source");
  assert.ok(sources.size > 0, "no contract sources were measured, so this test proved nothing");

  const ignored = readFileSync(join(REPOSITORY, ".gitignore"), "utf8");
  assert.match(ignored, /^node_modules\/$/m, "the materialised package would otherwise be carried between machines");
  assert.match(ignored, /^dist\/$/m);
});

// ── REG-PKG-005 ─────────────────────────────────────────────────────────────

test("REG-PKG-005: the dependency is declared, lockfile-pinned and materialised as a packed package", () => {
  const manifest = readJson(join(RUNTIME, "package.json"));
  const declared = (manifest["dependencies"] as Record<string, string>)["@polaris/contracts"];
  assert.equal(declared, "file:../contracts", "the local dependency is no longer declared explicitly");

  // الإعداد مملوك للمستودع لا لسطر أمر: تثبيت لاحق لا يستطيع إعادة الرابط.
  const npmrc = readFileSync(join(RUNTIME, ".npmrc"), "utf8");
  assert.match(npmrc, /^\s*install-links\s*=\s*true\s*$/m);

  const lock = readJson(join(RUNTIME, "package-lock.json"));
  const packages = lock["packages"] as Record<string, Record<string, unknown>>;
  const entry = packages["node_modules/@polaris/contracts"];
  assert.notEqual(entry, undefined, "the lockfile does not pin the dependency");
  assert.equal(entry?.["resolved"], "file:../contracts");
  assert.equal(entry?.["link"], undefined, "the lockfile still pins the dependency as a link");
  assert.equal(packages["../contracts"], undefined, "the lockfile still carries a link-target entry");

  // بقايا تقاعُد npm تعني تثبيتًا لم يكتمل — غالبًا لأن نظامًا آخر كتب المدخل.
  const scope = join(RUNTIME, "node_modules", "@polaris");
  assert.deepEqual(readdirSync(scope).filter((name) => name !== "contracts"), []);
});

test("REG-PKG-005: the runner repairs a foreign dependency tree instead of trusting that one exists", () => {
  const runner = readFileSync(RUNNER, "utf8");
  assert.equal(runner.includes("dependencies present, no install"), false, "the runner accepts a node_modules directory on sight again");
  assert.match(runner, /Test-DeclaredDependenciesPresent/);
  assert.match(runner, /Remove-NodeModules/);
  // الحذف لا يتبع الرابط: هدفه سيكون مجلد العقود.
  assert.match(runner, /rmdir \/s \/q/);
  assert.match(runner, /followed a link into the contracts package/);
  // npm.cmd لا npm.ps1، والإصلاح بـ npm ci وحده — لا npm install أثناء التشغيل.
  assert.match(runner, /'npm\.cmd'/);
  assert.match(runner, /&\s+\$script:NpmCommand\s+'ci'/);
  assert.equal(/&\s+\$script:NpmCommand\s+'install'/.test(runner), false);
  assert.equal(/&\s+\$script:NpmCommand\s+'audit'/.test(runner), false);
});

// ── REG-PKG-006 ─────────────────────────────────────────────────────────────

test("REG-PKG-006: the Windows runner proves package resolution before it runs any native probe", () => {
  const runner = readFileSync(RUNNER, "utf8");
  assert.match(runner, /check-package-graph\.mjs/, "the runner never invokes the package resolution gate");

  const contractsInstallAt = runner.indexOf("$lockState += Initialize-Package -PackageName 'contracts'");
  const contractsVerifyAt = runner.indexOf('Invoke-Step "contracts: verify"');
  const runtimeInstallAt = runner.indexOf("$lockState += Initialize-Package -PackageName 'runtime'");
  const gateAt = runner.indexOf('Write-Host "--- package resolution gate"');
  // خطوة "runtime: verify" الواحدة انقسمت إلى بناء قبل المسابر واختبار بعدها،
  // لأن اختبارات runtime تستهلك دليل المسابر. البوابة تسبقهما جميعًا كما كانت.
  const runtimeBuildAt = runner.indexOf('Invoke-Step "runtime: build"');
  const adapterAt = runner.indexOf('Invoke-Step "windows adapter: build"');
  const probesAt = runner.indexOf('Invoke-SoftStep "windows probes"');
  const runtimeTestAt = runner.indexOf('Invoke-SoftStep "runtime: test"');

  assert.notEqual(gateAt, -1, "the runner has no package resolution step");
  assert.notEqual(runtimeBuildAt, -1, "the runner no longer builds runtime before the probes");
  assert.notEqual(probesAt, -1, "the runner no longer runs the native probes");
  assert.notEqual(runtimeTestAt, -1, "the runner no longer runs the runtime tests");
  // ترتيب الاعتماد: العقود تُثبَّت وتُبنى قبل أن تُحزَم وتُثبَّت داخل runtime.
  assert.ok(contractsInstallAt < contractsVerifyAt, "contracts is verified before its dependencies are installed");
  assert.ok(contractsVerifyAt < runtimeInstallAt, "runtime materialises the contracts package before contracts is built");
  assert.ok(runtimeInstallAt < gateAt, "the gate runs before the dependency is materialised");
  assert.ok(gateAt < runtimeBuildAt, "runtime is built before package resolution is proven");
  assert.ok(gateAt < adapterAt, "the native adapter is built before package resolution is proven");
  assert.ok(gateAt < probesAt, "native probes run before package resolution is proven");
  assert.ok(probesAt < runtimeTestAt, "the runtime tests read the probe evidence before it is produced");

  // فشل البوابة عيب إقلاع مُصنَّف، لا نتيجة أمنية.
  assert.match(runner, /WINDOWS_PACKAGE_RESOLUTION_BOOTSTRAP_DEFECT/);
  assert.match(runner, /W-11 and W-12 remain NOT_EXECUTED_THIS_RUN/);
  assert.match(runner, /exit 2/);
  assert.match(runner, /Initialize-Package -PackageName 'runtime' -Force/);
});

test("REG-PKG-006: the runner reads the gate's exit code, never its output", () => {
  // العيب D2 حرفيًا: مخرجات الأمر الأصلي كانت تعود مع رمز الخروج في مصفوفة،
  // فصار كل تشغيل ناجح فشلًا. المخرجات تذهب إلى المضيف، والمُعاد عدد صحيح.
  const runner = readFileSync(RUNNER, "utf8");
  const body = runner.slice(runner.indexOf("function Invoke-PackageResolutionGate"));
  const definition = body.slice(0, body.indexOf("\n}\n") + 3);

  assert.match(definition, /&\s+node\s+\$script:PackageResolutionGate\s+--root\s+\$RepositoryRoot\s*\|\s*Out-Host/);
  assert.match(definition, /return\s+\[int\]\s+\$LASTEXITCODE/);
  assert.equal(/return\s+\$LASTEXITCODE\s*$/m.test(definition), false, "the gate's exit code is returned unguarded again");
  // وحارس صريح عند المُنادي، فلا يعود التسريب صامتًا.
  assert.match(runner, /\$gateCode -isnot \[int\]/);
});

// ── REG-PKG-007 ─────────────────────────────────────────────────────────────

test("REG-PKG-007: a foreign link cannot become the runtime dependency", () => {
  // نفس الحالة التي أوقفت التشغيل الأصلي الثالث، مصنوعة عمدًا: مدخل رابط بدل
  // حزمة. الاستراتيجية الجديدة ترفضه بوصفه شكلًا خاطئًا للتحقّق، لا بانتظار
  // فشل اجتيازه — فلا يهمّ أيّ نظام تشغيل كتبه.
  const root = makeFixture();
  const installed = join(root, "runtime", "node_modules", "@polaris", "contracts");
  rmSync(installed, { recursive: true, force: true });
  symlinkSync(join(root, "contracts"), installed, "junction");

  const gate = runGate(root);
  assert.equal(gate.status, 2, "a link was accepted as the materialised dependency");
  const materialization = checkOf(gate.record, "PKG-04");
  assert.equal(materialization?.status, "FAIL");
  assert.equal(materialization?.error_code, "POLARIS_PACKAGE_MATERIALIZATION_FOREIGN");
  assert.match(materialization?.detail ?? "", /link/i);
});

// ── REG-PKG-010 ─────────────────────────────────────────────────────────────

test("REG-PKG-010: a package materialised before the contracts build fails with an explicit build-order error", () => {
  // D2 بصيغة الحزمة المُحزَّمة: التثبيت ينجح، والحزمة تصل بلا dist. النجاح
  // ليس دليلًا، والفشل هنا يجب أن يسمّي السبب لا أن يظهر لاحقًا كـ TS2307.
  const root = makeFixture({ materializeDist: false });

  const gate = runGate(root);
  assert.equal(gate.status, 2, "a package without its entry point was accepted");
  const surface = checkOf(gate.record, "PKG-07");
  assert.equal(surface?.status, "FAIL");
  assert.equal(surface?.error_code, "POLARIS_CONTRACTS_NOT_BUILT");
  assert.match(surface?.detail ?? "", /packed before contracts was built/);
  // والعقود نفسها مبنيّة، فالخطأ ترتيبٌ لا بناءٌ غائب.
  assert.equal(checkOf(gate.record, "PKG-06")?.status, "PASS");
});

// ── REG-PKG-011 ─────────────────────────────────────────────────────────────

test("REG-PKG-011: rerunning the gate is idempotent and changes nothing on disk", () => {
  const before = readdirSync(join(RUNTIME, "node_modules", "@polaris"));
  const first = runGate(REPOSITORY);
  const second = runGate(REPOSITORY);
  const after = readdirSync(join(RUNTIME, "node_modules", "@polaris"));

  assert.equal(first.status, 0, first.stdout);
  assert.equal(second.status, 0, second.stdout);
  assert.deepEqual(before, after, "running the gate changed the dependency tree");

  const normalise = (record: GateRecord | undefined): string =>
    JSON.stringify({ ...(record ?? {}), ran_at: "" });
  assert.equal(normalise(first.record), normalise(second.record), "two runs of the gate disagreed");
});

test("REG-PKG-011: the runner stamps the tree it installs and refuses one stamped by another host", () => {
  // إعادة التشغيل على نفس المضيف لا تُعيد التثبيت؛ وإعادة التشغيل بعد نظام آخر
  // تُعيده. الملكيّة تُقاس بختم مكتوب، لا تُستنتج من فشل اجتياز رابط.
  const runner = readFileSync(RUNNER, "utf8");
  assert.match(runner, /\.polaris-host\.json/);
  assert.match(runner, /function Write-HostStamp/);
  assert.match(runner, /function Test-HostStamp/);
  assert.match(runner, /if \(-not \(Test-HostStamp -PackagePath \$PackagePath\)\) \{ return \$false \}/);
  assert.match(runner, /Write-HostStamp -PackagePath \$packagePath/);
  // الختم يُقارن بهوية النظام كما يراها Node، وهي نفس ما تكتبه البوابة.
  assert.match(runner, /node -p "process\.platform"/);
});

// ── البوابة نفسها ───────────────────────────────────────────────────────────

test("REG-PKG-006: the gate is a real file the runner can call, and it is not the probes script", () => {
  assert.equal(existsSync(GATE), true, "tools/package-resolution/check-package-graph.mjs is missing");
  const gate = readFileSync(GATE, "utf8");
  assert.match(gate, /WINDOWS_PACKAGE_RESOLUTION_BOOTSTRAP_DEFECT/);
  assert.match(gate, /--root/);
  // الاسم القانوني للدليل ملك للتشغيل الأصلي؛ غير ويندوز يكتب باسم آخر.
  assert.match(gate, /w4-package-resolution\.local\.json/);
  assert.match(gate, /w4-package-resolution\.json/);
});
