// انحدار ترميز دليل POLARIS — علامة ترتيب البايتات.
//
// العيب الذي يحرسه هذا الملف وقع فعلًا في التشغيل الأصلي الثالث. مرّت العقود
// (117/117)، ومرّ تحديث الحزم، ومرّ البناء، ومرّت مسابر W4 الاثنا عشر، ثم
// سقطت سبعة اختبارات في طبقة التشغيل برسالة واحدة:
//
//     SyntaxError: Unexpected token 'ي╗┐'
//
// الرمز المعروض تشويهٌ طرفي لثلاثة بايتات: EF BB BF — علامة ترتيب بايتات
// UTF-8. أول أربعة بايتات في الأدلة المعطوبة كانت بالضبط:
//
//     ef bb bf 7b       (BOM ثم '{')
//
// والسبب في الكاتب لا في القارئ: Windows PowerShell 5.1 يكتب BOM حين يُطلب
// منه UTF8 عبر Set-Content -Encoding UTF8 أو Out-File -Encoding utf8. وهذا
// سلوك 5.1، ولا يجوز الاعتماد على سلوك PowerShell 7 المختلف.
//
// لماذا لم يمسكه المضيف اللينكسي: لا PowerShell هناك، فالطبقة التي تُشغّل
// المشغّل تتخطّى، ولم يكن ثمّة فحص واحد على بايتات ملف دليل.
//
// ولماذا لا يُقشَّر الـBOM عند القراءة: ذلك يجعل دليلًا فاسدًا مقبولًا،
// ويُبقي الكاتب المنحرف حيًّا. المستهلك يُشخّص EVIDENCE_UTF8_BOM_PRESENT.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { runtimeSrcPath } from "./helpers.js";
import {
  EVIDENCE_FILE_MISSING,
  EVIDENCE_UTF16_BOM_PRESENT,
  EVIDENCE_UTF8_BOM_PRESENT,
  EVIDENCE_UTF8_NO_BOM,
  EvidenceEncodingError,
  classifyEvidenceBytes,
  classifyEvidenceFile,
  readCanonicalEvidence,
} from "./evidence-bytes.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const TOOLS = join(REPOSITORY, "tools");
const RUNNER = join(TOOLS, "w5-conformance", "run.ps1");
const PATH_CONTRACT = join(TOOLS, "w5-conformance", "path-contract.ps1");
const JSON_MODULE = join(TOOLS, "evidence-contract", "json-evidence.ps1");
const JSON_MODULE_MJS = join(TOOLS, "evidence-contract", "evidence-bytes.mjs");
const JSON_MODULE_CLI = join(TOOLS, "evidence-contract", "evidence-bytes-cli.mjs");
const E9_FORENSICS = join(REPOSITORY, "evidence", "w5-e9-cli-forensics.local.json");

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

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

// ── الطبقة الأولى: فحوص تعمل على أي منصّة ───────────────────────────────────

test("E7/E2: the classifier names a UTF-8 BOM instead of tolerating it", () => {
  const document = Buffer.concat([UTF8_BOM, Buffer.from('{"a":1}\n', "utf8")]);
  const classification = classifyEvidenceBytes(document, "<fixture>");
  assert.equal(classification.ok, false);
  assert.equal(classification.reason_code, EVIDENCE_UTF8_BOM_PRESENT);
  assert.equal(classification.first_bytes, "ef bb bf 7b");
});

test("E6: a UTF-16 byte order mark, either endianness, is a named defect too", () => {
  for (const prefix of [Buffer.from([0xff, 0xfe]), Buffer.from([0xfe, 0xff])]) {
    const classification = classifyEvidenceBytes(Buffer.concat([prefix, Buffer.from("{}", "utf8")]), "<fixture>");
    assert.equal(classification.ok, false);
    assert.equal(classification.reason_code, EVIDENCE_UTF16_BOM_PRESENT);
  }
});

test("E1: a conformant document begins with 0x7B and is classified clean", () => {
  const document = Buffer.from('{\n  "a": 1\n}\n', "utf8");
  assert.equal(document[0], 0x7b);
  const classification = classifyEvidenceBytes(document, "<fixture>");
  assert.equal(classification.ok, true);
  assert.equal(classification.reason_code, EVIDENCE_UTF8_NO_BOM);
});

test("E10: NEGATIVE CONTROL — a BOM injected into a real file is reported, not swallowed", () => {
  const directory = mkdtempSync(join(tmpdir(), "polaris-evidence-bom-"));
  try {
    const clean = join(directory, "clean.json");
    const infected = join(directory, "infected.json");
    const body = '{\n  "verdict": "PASS"\n}\n';
    writeFileSync(clean, body, "utf8");
    writeFileSync(infected, Buffer.concat([UTF8_BOM, Buffer.from(body, "utf8")]));

    assert.equal(classifyEvidenceFile(clean).ok, true);
    assert.equal(classifyEvidenceFile(infected).reason_code, EVIDENCE_UTF8_BOM_PRESENT);

    // والقارئ القانوني يرفض بدل أن يقشّر.
    assert.deepEqual(readCanonicalEvidence(clean), { verdict: "PASS" });
    assert.throws(
      () => readCanonicalEvidence(infected),
      (error: unknown) =>
        error instanceof EvidenceEncodingError && error.reasonCode === EVIDENCE_UTF8_BOM_PRESENT,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing evidence file is named as missing, not as a parse failure", () => {
  assert.equal(classifyEvidenceFile(join(tmpdir(), "polaris-absent-evidence.json")).reason_code, EVIDENCE_FILE_MISSING);
});

// ── حارس ما قبل التحليل لعقد المصنّف الأداتي ────────────────────────────────
//
// العطل الذي أُغلق هنا وقع في تشغيل المالك الأصلي: كان E9 يُسلّم stdout إلى
// JSON.parse مباشرة، فسقط بـ
//
//     SyntaxError: Unexpected end of JSON input
//
// وهي رسالة تقول «السلسلة فارغة أو ناقصة» ولا تقول شيئًا عن اتفاق المصنّفين.
// أربعة أعطال مختلفة كانت تنهار إلى هذه الرسالة الواحدة. صارت تُسمّى واحدًا
// واحدًا، وتُقاس الوقائع قبل أي محاولة تحليل.

const TOOL_CLASSIFIER_NO_OUTPUT = "TOOL_CLASSIFIER_NO_OUTPUT";
const TOOL_CLASSIFIER_TRUNCATED_OUTPUT = "TOOL_CLASSIFIER_TRUNCATED_OUTPUT";
const TOOL_CLASSIFIER_PROCESS_FAILED = "TOOL_CLASSIFIER_PROCESS_FAILED";
const TOOL_CLASSIFIER_OUTPUT_CONTAMINATED = "TOOL_CLASSIFIER_OUTPUT_CONTAMINATED";

interface ToolInvocation {
  readonly label: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment_inherited: boolean;
  readonly environment_delta: Readonly<Record<string, string>>;
  readonly module_path: string;
  readonly module_existed_before_launch: boolean;
  readonly fixture_path: string;
  readonly fixture_existed_before_launch: boolean;
  readonly node_version: string;
  readonly platform: string;
  readonly exit_code: number | null;
  readonly signal: string | null;
  readonly spawn_error: string | null;
  readonly stdout_bytes: number;
  readonly stdout_first32_hex: string;
  readonly stdout_escaped: string;
  readonly stderr_bytes: number;
  readonly stderr_escaped: string;
  readonly document_count: number;
  readonly leading_noise: boolean;
  readonly trailing_noise: boolean;
  readonly cli_branch_executed: boolean;
  readonly defect: string | null;
}

function hexOf(buffer: Buffer, count: number): string {
  return Array.from(buffer.subarray(0, count))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

/** يستدعي المصنّف الأداتي ويُسجّل كل واقعة قابلة للقياس. لا تحليل هنا. */
function invokeToolClassifier(label: string, modulePath: string, args: readonly string[], fixturePath: string): ToolInvocation {
  const argv = [modulePath, ...args];
  const moduleExisted = existsSync(modulePath);
  const fixtureExisted = fixturePath === "" ? false : existsSync(fixturePath);
  const run = spawnSync(process.execPath, argv, { cwd: REPOSITORY, maxBuffer: 32 * 1024 * 1024 });
  const stdout: Buffer = run.stdout ?? Buffer.alloc(0);
  const stderr: Buffer = run.stderr ?? Buffer.alloc(0);
  const text = stdout.toString("utf8");
  const trimmed = text.trim();
  const documents = trimmed === "" ? [] : trimmed.split(/\n+/).filter((line) => line.trim().length > 0);
  const leadingNoise = trimmed.length > 0 && !trimmed.startsWith("{");
  const trailingNoise = trimmed.length > 0 && !trimmed.endsWith("}");

  let defect: string | null = null;
  if (run.error !== undefined) defect = TOOL_CLASSIFIER_PROCESS_FAILED;
  else if (run.signal !== null) defect = TOOL_CLASSIFIER_PROCESS_FAILED;
  else if (run.status !== 0) defect = TOOL_CLASSIFIER_PROCESS_FAILED;
  else if (stdout.length === 0) defect = TOOL_CLASSIFIER_NO_OUTPUT;
  else if (leadingNoise || documents.length > 1) defect = TOOL_CLASSIFIER_OUTPUT_CONTAMINATED;
  else if (trailingNoise) defect = TOOL_CLASSIFIER_TRUNCATED_OUTPUT;

  return {
    label,
    executable: process.execPath,
    argv,
    cwd: REPOSITORY,
    environment_inherited: true,
    environment_delta: {},
    module_path: modulePath,
    module_existed_before_launch: moduleExisted,
    fixture_path: fixturePath,
    fixture_existed_before_launch: fixtureExisted,
    node_version: process.version,
    platform: process.platform,
    exit_code: run.status,
    signal: run.signal === undefined ? null : run.signal,
    spawn_error: run.error === undefined ? null : run.error.message,
    stdout_bytes: stdout.length,
    stdout_first32_hex: hexOf(stdout, 32),
    stdout_escaped: JSON.stringify(text),
    stderr_bytes: stderr.length,
    stderr_escaped: JSON.stringify(stderr.toString("utf8")),
    document_count: documents.length,
    leading_noise: leadingNoise,
    trailing_noise: trailingNoise,
    cli_branch_executed: stdout.length > 0,
    defect,
  };
}

/** التحليل لا يقع إلا بعد أن يُنفى عطل البنية باسمه. */
function toolDocument(invocation: ToolInvocation): Record<string, unknown> {
  assert.equal(
    invocation.defect,
    null,
    `tool classifier infrastructure defect ${String(invocation.defect)}: ${JSON.stringify(invocation, null, 2)}`,
  );
  return JSON.parse(JSON.parse(invocation.stdout_escaped) as string) as Record<string, unknown>;
}

/** الحارس المُزال، محفوظًا نصًّا: مقارنة سلسلة بسلسلة، لا مقارنة عناوين. */
function removedEntrypointGuard(moduleUrl: string, entryPath: string): boolean {
  return moduleUrl === `file://${entryPath.replace(/\\/g, "/")}`;
}

/** نسخة عاملة من عقد البايتات في مجلد باسم يحمل مسافة ومحرفًا غير لاتيني. */
function awkwardlyNamedCopy(): { readonly directory: string; readonly module: string; readonly cli: string; dispose(): void } {
  const root = mkdtempSync(join(tmpdir(), "polaris-e9-path-"));
  const directory = join(root, "a b د");
  mkdirSync(directory, { recursive: true });
  const module = join(directory, "evidence-bytes.mjs");
  const cli = join(directory, "evidence-bytes-cli.mjs");
  writeFileSync(module, readFileSync(JSON_MODULE_MJS));
  writeFileSync(cli, readFileSync(JSON_MODULE_CLI));
  return {
    directory,
    module,
    cli,
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("E9: the tool-side and runtime-side classifiers agree on every fixture", () => {
  const directory = mkdtempSync(join(tmpdir(), "polaris-evidence-agree-"));
  const forensics: ToolInvocation[] = [];
  try {
    const body = '{\n  "أهلًا": "بالعالم"\n}\n';
    const fixtures: Record<string, Buffer> = {
      "clean.json": Buffer.from(body, "utf8"),
      "utf8-bom.json": Buffer.concat([UTF8_BOM, Buffer.from(body, "utf8")]),
      "utf16le-bom.json": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf8")]),
      "utf16be-bom.json": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(body, "utf8")]),
      "empty.json": Buffer.alloc(0),
    };
    for (const [name, content] of Object.entries(fixtures)) writeFileSync(join(directory, name), content);

    // تقرير نقطة الدخول يُسجَّل على المضيف الحقيقي: التمثيلان الأصليان، وحكم
    // الحارس المُزال، وحكم الحارس الحالي — قياسًا لا افتراضًا.
    forensics.push(invokeToolClassifier("entrypoint-report", JSON_MODULE_MJS, ["--entrypoint-report"], ""));

    for (const name of Object.keys(fixtures)) {
      const path = join(directory, name);
      const mine = classifyEvidenceFile(path);
      const invocation = invokeToolClassifier(name, JSON_MODULE_CLI, ["--classify", path], path);
      forensics.push(invocation);
      const parsed = toolDocument(invocation);
      assert.equal(invocation.exit_code, 0, invocation.stderr_escaped);
      assert.equal(parsed["ok"], mine.ok, `${name}: ok disagrees`);
      assert.equal(parsed["reason_code"], mine.reason_code, `${name}: reason_code disagrees`);
      assert.equal(parsed["first_bytes"], mine.first_bytes, `${name}: first_bytes disagree`);
    }
  } finally {
    mkdirSync(dirname(E9_FORENSICS), { recursive: true });
    writeFileSync(
      E9_FORENSICS,
      `${JSON.stringify(
        {
          schema_version: "1.0.0",
          tool: "polaris.w5.e9-cli-forensics",
          canonical: false,
          note: "measurement of the E9 tool-side classifier invocation; not a W5 verdict",
          platform: process.platform,
          node_version: process.version,
          module_under_test: JSON_MODULE_CLI,
          library_module: JSON_MODULE_MJS,
          invocations: forensics,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    rmSync(directory, { recursive: true, force: true });
  }
});

test("no PowerShell script writes JSON evidence through an implicitly encoded cmdlet", () => {
  // الفحص النصّي الذي كان غائبًا. Set-Content -Encoding UTF8 و Out-File -Encoding utf8
  // على 5.1 يكتبان BOM؛ فوجود أيّهما على مخرَج ConvertTo-Json هو العيب نفسه عائدًا.
  const offences: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "bin" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ps1")) continue;
      const source = readFileSync(full, "utf8");
      source.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) return;
        if (!/ConvertTo-Json/.test(trimmed)) return;
        if (/Set-Content|Out-File|Add-Content/.test(trimmed)) {
          offences.push(`${full}:${String(index + 1)}: ${trimmed}`);
        }
      });
      // والصياغة الممتدة على سطرين تُمسك كذلك.
      const joined = source.replace(/\r?\n\s*/g, " ");
      const pattern = /ConvertTo-Json[^|]*\|\s*(?:Set-Content|Out-File|Add-Content)/g;
      if (pattern.test(joined)) offences.push(`${full}: a ConvertTo-Json pipeline reaches an implicitly encoded cmdlet`);
    }
  };
  walk(TOOLS);
  assert.deepEqual(offences, []);
});

test("the canonical writer declares its encoder explicitly and verifies what it wrote", () => {
  const module = readFileSync(JSON_MODULE, "utf8");
  assert.match(module, /New-Object System\.Text\.UTF8Encoding\(\$false\)/);
  assert.match(module, /\[System\.IO\.File\]::WriteAllText/);
  assert.match(module, /function\s+Write-PolarisJsonFile/);
  assert.match(module, /function\s+Test-PolarisJsonEncoding/);
  assert.match(module, /EVIDENCE_UTF8_BOM_PRESENT/);
  // ولا يعتمد على [System.Text.Encoding]::UTF8، فهو يُصدر BOM. الفحص على
  // الشيفرة وحدها: التعليق الذي يشرح الفخّ ليس الفخّ، فتُنزع التعليقات أولًا.
  const code = module.replace(/<#[\s\S]*?#>/g, "").replace(/^\s*#.*$/gm, "");
  assert.equal(code.includes("[System.Text.Encoding]::UTF8"), false);
  assert.match(code, /New-Object System\.Text\.UTF8Encoding\(\$false\)/);
  assert.equal(code.includes("Set-Content"), false, "the canonical writer must not route through Set-Content");
  assert.equal(code.includes("Out-File"), false, "the canonical writer must not route through Out-File");

  // وكاتبٌ لا يقرأ ما كتبه لا يُثبت شيئًا: التحقّق بعد الكتابة جزء من الدالة.
  const writer = module.slice(module.indexOf("function Write-PolarisJsonFile"));
  assert.match(writer, /Test-PolarisJsonEncoding -Path \$target/);
});

// عيّنات مجمَّدة من التشغيل الأصلي المعطوب. تبقى حاملةً للعيب عمدًا: كاشفٌ
// بلا ضبط موجب حارسٌ بلا قيمة.
const DEFECT_FIXTURES = join(REPOSITORY, "evidence", "defect-fixtures", "2026-09-08-w5-utf8-bom");

// الملفات التي كتبها مشغّل PowerShell قبل الإصلاح وما زالت في مكانها. تُسمّى
// واحدًا واحدًا، ويسقط الاختبار على أي ملف آخر يحمل العيب. أول تشغيل أصلي بعد
// الإصلاح يعيد كتابتها نظيفة، والقائمة تبقى مقبولة لأنها تسمح بالنظيف أيضًا.
const HISTORICAL_BOM_ARTEFACTS = new Set([
  "w4-windows-adapter-build.json",
  "w4-windows-run.json",
  "w4-windows-run.stale-inconsistent.json",
  "w4-windows-runner-bootstrap.json",
  "w5-run.json",
  "w5-windows-adapter-build.json",
  "windows-sandbox.json",
]);

test("POSITIVE CONTROL: the frozen defect fixtures still carry the exact bytes that broke the run", () => {
  assert.equal(existsSync(DEFECT_FIXTURES), true, "the frozen defect fixtures were removed");
  const names = readdirSync(DEFECT_FIXTURES).filter((name) => name.endsWith(".json"));
  assert.ok(names.length >= 5, "the frozen defect fixture set shrank");
  for (const name of names) {
    const classification = classifyEvidenceFile(join(DEFECT_FIXTURES, name));
    assert.equal(classification.reason_code, EVIDENCE_UTF8_BOM_PRESENT, `${name} no longer carries the defect`);
    assert.equal(classification.first_bytes, "ef bb bf 7b", `${name}: unexpected leading bytes`);
  }
});

test("E8: no evidence file outside the named historical set carries a byte order mark", () => {
  const evidence = join(REPOSITORY, "evidence");
  if (!existsSync(evidence)) return;
  const defects: string[] = [];
  for (const name of readdirSync(evidence)) {
    if (!name.endsWith(".json")) continue;
    const path = join(evidence, name);
    const classification = classifyEvidenceFile(path);
    if (!classification.ok) {
      if (!HISTORICAL_BOM_ARTEFACTS.has(name)) {
        defects.push(`${name}: ${classification.reason_code} (${classification.first_bytes})`);
      }
      continue;
    }
    const text = readFileSync(path, "utf8");
    // لا بادئة ولا لاحقة طرفية: الوثيقة تبدأ بـ'{' أو '[' وتنتهي بنظيرها.
    assert.match(text.trimStart()[0] ?? "", /[[{]/, `${name} does not begin with a JSON document`);
    JSON.parse(text);
  }
  assert.deepEqual(defects, []);
});

// ── الطبقة الثانية: كتابة حقيقية بمفسّر PowerShell ──────────────────────────

interface Fixture {
  readonly root: string;
  readonly module: string;
  dispose(): void;
}

function moduleFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "polaris-json-evidence-"));
  const module = join(root, "tools", "evidence-contract", "json-evidence.ps1");
  mkdirSync(dirname(module), { recursive: true });
  writeFileSync(module, readFileSync(JSON_MODULE, "utf8"), "utf8");
  return {
    root,
    module,
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(module: string, body: string): { status: number; stdout: string; combined: string } {
  const script = ["Set-StrictMode -Version Latest", "$ErrorActionPreference = 'Stop'", `. ${psQuote(module)}`, body].join("\n");
  const result = spawnSync(SHELL as string, ["-NoProfile", "-Command", script], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? "";
  return { status: result.status ?? -1, stdout, combined: `${stdout}\n${result.stderr ?? ""}` };
}

test("E1/E2/E3/E7: the canonical writer produces a BOM-less document that JSON.parse reads directly", { skip: shellSkip }, () => {
  const fixture = moduleFixture();
  try {
    const target = join(fixture.root, "written.json");
    const run = runPowerShell(
      fixture.module,
      [
        "$record = [ordered] @{ verdict = 'PASS'; count = 3 }",
        `[void] (Write-PolarisJsonFile -Path ${psQuote(target)} -InputObject ([pscustomobject] $record) -Depth 5)`,
        "Write-Output 'WRITTEN'",
      ].join("\n"),
    );
    assert.equal(run.status, 0, run.combined);
    assert.match(run.stdout, /WRITTEN/);

    const bytes = readFileSync(target);
    assert.equal(bytes[0], 0x7b, `the document does not begin with '{' (first bytes: ${bytes.subarray(0, 4).toString("hex")})`);
    assert.equal(bytes.subarray(0, 3).equals(UTF8_BOM), false, "the writer emitted a UTF-8 BOM");
    assert.equal(classifyEvidenceFile(target).reason_code, EVIDENCE_UTF8_NO_BOM);

    // بلا أي معالجة مسبقة.
    const parsed = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    assert.equal(parsed["verdict"], "PASS");
    assert.equal(parsed["count"], 3);
  } finally {
    fixture.dispose();
  }
});

test("E4/E5: Arabic and other non-ASCII values round-trip as UTF-8", { skip: shellSkip }, () => {
  const fixture = moduleFixture();
  try {
    const target = join(fixture.root, "arabic.json");
    const value = "الإيقاف الاضطراري — لا ناجين";
    const run = runPowerShell(
      fixture.module,
      [
        `$record = [ordered] @{ note = ${psQuote(value)}; symbol = 'ℹ'; digits = '١٢٣' }`,
        `[void] (Write-PolarisJsonFile -Path ${psQuote(target)} -InputObject ([pscustomobject] $record) -Depth 5)`,
      ].join("\n"),
    );
    assert.equal(run.status, 0, run.combined);
    const parsed = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    assert.equal(parsed["note"], value);
    assert.equal(parsed["symbol"], "ℹ");
    assert.equal(parsed["digits"], "١٢٣");
    // وترميز الملف UTF-8 فعلًا: إعادة الترميز من البايتات تعطي النصّ نفسه.
    assert.equal(readFileSync(target).toString("utf8"), readFileSync(target, "utf8"));
  } finally {
    fixture.dispose();
  }
});

test("E10 (writer side): the writer refuses to report success over a BOM-prefixed file", { skip: shellSkip }, () => {
  const fixture = moduleFixture();
  try {
    const target = join(fixture.root, "infected.json");
    writeFileSync(target, Buffer.concat([UTF8_BOM, Buffer.from('{"a":1}\n', "utf8")]));
    const run = runPowerShell(
      fixture.module,
      [
        `$check = Test-PolarisJsonEncoding -Path ${psQuote(target)}`,
        "Write-Output ('ok=' + $check.ok)",
        "Write-Output ('reason=' + $check.reason_code)",
        "Write-Output ('bytes=' + $check.first_bytes)",
      ].join("\n"),
    );
    assert.equal(run.status, 0, run.combined);
    assert.match(run.stdout, /ok=False/);
    assert.match(run.stdout, /reason=EVIDENCE_UTF8_BOM_PRESENT/);
    assert.match(run.stdout, /bytes=ef bb bf/);
  } finally {
    fixture.dispose();
  }
});

test("E9 (writer side): Set-Content -Encoding UTF8 really does emit the BOM on this host", { skip: shellSkip }, () => {
  // ضبط موجب: لو لم يُظهر هذا المضيف السلوك، فالإصلاح يُثبت على مضيف لا يحمل
  // العيب — ويجب أن يُقال ذلك صراحةً بدل أن يُفترض. المُبلَّغ عنه هنا هو ما
  // فعله المضيف فعلًا، لا ما هو متوقّع منه.
  const fixture = moduleFixture();
  try {
    const target = join(fixture.root, "legacy.json");
    const run = runPowerShell(
      fixture.module,
      [
        `('{"a":1}') | Set-Content -LiteralPath ${psQuote(target)} -Encoding UTF8`,
        `$check = Test-PolarisJsonEncoding -Path ${psQuote(target)}`,
        "Write-Output ('edition=' + $PSVersionTable.PSVersion.ToString())",
        "Write-Output ('legacy_reason=' + $check.reason_code)",
      ].join("\n"),
    );
    assert.equal(run.status, 0, run.combined);
    assert.match(run.stdout, /legacy_reason=EVIDENCE_UTF8_(BOM_PRESENT|NO_BOM)/);
    // الحكم على الملف نفسه، لا على الإصدار المُعلَن: هذا سجل قياس لا افتراض.
    const observed = /legacy_reason=(\S+)/.exec(run.stdout)?.[1];
    assert.ok(observed !== undefined);
  } finally {
    fixture.dispose();
  }
});

test("the W5 runner loads the byte contract during bootstrap, before any evidence is written", () => {
  const runner = readFileSync(RUNNER, "utf8");
  const load = runner.indexOf("json-evidence.ps1");
  const firstWrite = runner.indexOf("Write-PolarisJsonFile");
  assert.ok(load > 0, "the runner does not load the byte contract module");
  assert.ok(firstWrite > 0, "the runner does not use the canonical writer");
  assert.match(runner, /JSON_EVIDENCE_MODULE/);
  // ووحدة عقد المسارات ما زالت تُحمَّل كذلك: هذه إضافة لا استبدال.
  assert.ok(readFileSync(PATH_CONTRACT, "utf8").length > 0);
  assert.match(runner, /PATH_CONTRACT_MODULE/);
});

// ── انحدار E9: عقد سطر أوامر المصنّف الأداتي ────────────────────────────────
//
// كل ما تحته يحرس عقدًا واحدًا: استدعاءٌ واحد، وثيقةٌ واحدة، مجرى تشخيص نظيف،
// ورمز خروجٍ يقول الحقيقة. ولا يُسمح لأي منها أن يُرضى بمخرَج فارغ.

function e9Fixture(): { readonly directory: string; readonly path: string; dispose(): void } {
  const directory = mkdtempSync(join(tmpdir(), "polaris-e9-cli-"));
  const path = join(directory, "clean.json");
  writeFileSync(path, Buffer.from('{\n  "أهلًا": "بالعالم"\n}\n', "utf8"));
  return {
    directory,
    path,
    dispose(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** يُشغّل المصنّف مكتبةً — استيرادًا لا استدعاءَ سطر أوامر — ويُعيد حكمه. */
function libraryClassification(fixture: string): Record<string, unknown> {
  const code =
    `import { classifyEvidenceFile } from ${JSON.stringify(pathToFileURL(JSON_MODULE_MJS).href)};\n` +
    `process.stdout.write(JSON.stringify(classifyEvidenceFile(${JSON.stringify(fixture)})));\n`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: REPOSITORY });
  assert.equal(run.status, 0, (run.stderr ?? Buffer.alloc(0)).toString("utf8"));
  return JSON.parse((run.stdout ?? Buffer.alloc(0)).toString("utf8")) as Record<string, unknown>;
}

/** يستدعي canonicalModuleUrl من الوحدة نفسها: التقنين واحد ولا يُعاد تعريفه. */
function canonicalUrls(hrefs: readonly string[]): readonly string[] {
  const code =
    `import { canonicalModuleUrl } from ${JSON.stringify(pathToFileURL(JSON_MODULE_MJS).href)};\n` +
    `process.stdout.write(JSON.stringify(${JSON.stringify(hrefs)}.map(canonicalModuleUrl)));\n`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: REPOSITORY });
  assert.equal(run.status, 0, (run.stderr ?? Buffer.alloc(0)).toString("utf8"));
  return JSON.parse((run.stdout ?? Buffer.alloc(0)).toString("utf8")) as string[];
}

function stubCli(body: string): { readonly path: string; dispose(): void } {
  const directory = mkdtempSync(join(tmpdir(), "polaris-e9-stub-"));
  const path = join(directory, "stub.mjs");
  writeFileSync(path, body, "utf8");
  return {
    path,
    dispose(): void {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("E9-R1/R2/R3/R4/R5: the CLI emits exactly one BOM-less JSON document, exit 0, clean stderr", () => {
  const fixture = e9Fixture();
  try {
    const invocation = invokeToolClassifier("contract", JSON_MODULE_CLI, ["--classify", fixture.path], fixture.path);
    assert.equal(invocation.defect, null, JSON.stringify(invocation, null, 2));
    assert.equal(invocation.exit_code, 0);                       // R2
    assert.ok(invocation.stdout_bytes > 0, "the CLI produced no document");   // R1
    assert.equal(invocation.document_count, 1, "stdout carries more than one document");  // R1
    assert.equal(invocation.stdout_first32_hex.startsWith("7b"), true, invocation.stdout_first32_hex); // R3
    assert.equal(invocation.stdout_first32_hex.startsWith("ef bb bf"), false, "the CLI emitted a BOM"); // R3
    assert.equal(invocation.stderr_bytes, 0, invocation.stderr_escaped);      // R4
    assert.equal(invocation.leading_noise, false);
    assert.equal(invocation.trailing_noise, false);

    // R5: بلا أي معالجة مسبقة — لا تقشير، ولا اقتطاع، ولا بديل افتراضي.
    const document = toolDocument(invocation);
    assert.equal(document["reason_code"], EVIDENCE_UTF8_NO_BOM);
    assert.equal(document["ok"], true);
  } finally {
    fixture.dispose();
  }
});

test("E9-R6: the library classifier and the CLI classifier agree field for field", () => {
  const fixture = e9Fixture();
  try {
    const infected = join(fixture.directory, "infected.json");
    writeFileSync(infected, Buffer.concat([UTF8_BOM, Buffer.from('{"a":1}\n', "utf8")]));
    for (const path of [fixture.path, infected, join(fixture.directory, "absent.json")]) {
      const library = libraryClassification(path);
      const cli = toolDocument(invokeToolClassifier("agreement", JSON_MODULE_CLI, ["--classify", path], path));
      assert.deepEqual(cli, library, `library and CLI disagree on ${path}`);
      // والجانب الثالث — مصنّف طبقة التشغيل — يوافقهما على الحقول المشتركة.
      const runtime = classifyEvidenceFile(path);
      assert.equal(cli["ok"], runtime.ok);
      assert.equal(cli["reason_code"], runtime.reason_code);
      assert.equal(cli["first_bytes"], runtime.first_bytes);
      assert.equal(cli["length"], runtime.length);
    }
  } finally {
    fixture.dispose();
  }
});

test("E9-R7: a path representation that defeated the removed guard no longer suppresses the CLI", () => {
  const fixture = e9Fixture();
  const copy = awkwardlyNamedCopy();
  try {
    // ضبط موجب يُعيد إنتاج العطل الأصلي على أي مضيف: مسار يحمل مسافة ومحرفًا
    // غير لاتيني، فيُرمِّزهما import.meta.url ولا تُرمِّزهما التركيبة اليدوية.
    const report = toolDocument(invokeToolClassifier("awkward-report", copy.module, ["--entrypoint-report"], ""));
    assert.equal(report["reason_code"], "EVIDENCE_CLI_ENTRYPOINT_REPORT");
    assert.equal(report["legacy_string_match"], false, "the removed guard would have matched — the control is not exercising the defect");
    assert.equal(report["is_cli_entrypoint"], true, "the current guard suppressed the CLI branch");

    for (const module of [copy.module, copy.cli]) {
      const invocation = invokeToolClassifier("awkward", module, ["--classify", fixture.path], fixture.path);
      assert.equal(invocation.defect, null, JSON.stringify(invocation, null, 2));
      assert.equal(invocation.cli_branch_executed, true);
      assert.equal(toolDocument(invocation)["ok"], true);
    }
  } finally {
    copy.dispose();
    fixture.dispose();
  }
});

test("E9-R8: drive-letter case and slash representation — positive and negative controls", () => {
  // الشكل الأصلي للعطل، محفوظًا بقيمه الويندوزية الحقيقية.
  const windowsModuleUrl = "file:///D:/POLARIS/tools/evidence-contract/evidence-bytes.mjs";
  const windowsArgv1 = "D:\\POLARIS\\tools\\evidence-contract\\evidence-bytes.mjs";
  assert.equal(
    removedEntrypointGuard(windowsModuleUrl, windowsArgv1),
    false,
    "the removed guard is expected to fail on native Windows spellings",
  );
  // ولماذا نجا المضيف اللينكسي: الشكل نفسه يطابق صدفةً على POSIX.
  assert.equal(removedEntrypointGuard("file:///home/x/evidence-bytes.mjs", "/home/x/evidence-bytes.mjs"), true);
  // وحتى على POSIX يسقط متى حمل المسار محرفًا يُرمَّز بالمئة.
  assert.equal(removedEntrypointGuard("file:///home/x/a%20b/evidence-bytes.mjs", "/home/x/a b/evidence-bytes.mjs"), false);

  // التقنين الحالي: حالة حرف السواقة لا تفرّق، واختلاف المسار يفرّق.
  const [upper, lower, other] = canonicalUrls([
    windowsModuleUrl,
    "file:///d:/POLARIS/tools/evidence-contract/evidence-bytes.mjs",
    "file:///D:/POLARIS/tools/evidence-contract/evidence-bytes-cli.mjs",
  ]);
  assert.equal(upper, lower, "drive-letter case must not split one module into two");
  assert.notEqual(upper, other, "two different modules must not canonicalise to one url");

  // وعلى ويندوز الأصلي: نفس الملف بتهجئة مختلفة ما زال يُنتج وثيقة.
  if (process.platform !== "win32") return;
  const fixture = e9Fixture();
  try {
    const drive = JSON_MODULE_CLI.slice(0, 1);
    const flipped = drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase();
    for (const spelling of [`${flipped}${JSON_MODULE_CLI.slice(1)}`, JSON_MODULE_CLI.replace(/\\/g, "/")]) {
      const invocation = invokeToolClassifier("spelling", spelling, ["--classify", fixture.path], fixture.path);
      assert.equal(invocation.defect, null, JSON.stringify(invocation, null, 2));
      assert.equal(toolDocument(invocation)["ok"], true);
    }
  } finally {
    fixture.dispose();
  }
});

test("E9-R9: a broken invocation exits non-zero and never reports empty success", () => {
  const fixture = e9Fixture();
  try {
    // العقد الحقيقي: بلا وسيط مطلوب لا وثيقة، ورمز الخروج يقول ذلك.
    for (const args of [[], ["--classify"]]) {
      const invocation = invokeToolClassifier("usage", JSON_MODULE_CLI, args, "");
      assert.notEqual(invocation.exit_code, 0, "an unusable invocation exited zero");
      assert.equal(invocation.stdout_bytes, 0, "a failed invocation still wrote to stdout");
      assert.ok(invocation.stderr_bytes > 0, "a failed invocation said nothing on stderr");
      assert.equal(invocation.defect, TOOL_CLASSIFIER_PROCESS_FAILED);
    }

    // ومصنّفٌ معطوب عمدًا — يحمل الحارس المُزال بعينه — يُسمّى ولا يُقبل.
    const stub = stubCli(
      [
        "// نسخة من الحارس المُزال، محفوظة عمدًا لإعادة إنتاج العطل.",
        'if (import.meta.url === `file://${process.argv[1].replace(/\\\\/g, "/")}`) {',
        '  process.stdout.write(JSON.stringify({ ok: true, reason_code: "EVIDENCE_UTF8_NO_BOM" }) + "\\n");',
        "}",
        "",
      ].join("\n"),
    );
    try {
      const directory = dirname(stub.path);
      const awkward = join(directory, "a b د");
      mkdirSync(awkward, { recursive: true });
      const suppressed = join(awkward, "stub.mjs");
      writeFileSync(suppressed, readFileSync(stub.path));
      const invocation = invokeToolClassifier("legacy-stub", suppressed, ["--classify", fixture.path], fixture.path);
      assert.equal(invocation.exit_code, 0, "the reproduction is expected to exit zero — that is the trap");
      assert.equal(invocation.stdout_bytes, 0, "the reproduction did not reproduce: it produced output");
      assert.equal(invocation.defect, TOOL_CLASSIFIER_NO_OUTPUT);
    } finally {
      stub.dispose();
    }
  } finally {
    fixture.dispose();
  }
});

test("E9-R10: the pre-parse guard names a typed infrastructure defect instead of a parse error", () => {
  const fixture = e9Fixture();
  const cases: ReadonlyArray<{ readonly body: string; readonly expected: string }> = [
    { body: 'process.stdout.write("");\n', expected: TOOL_CLASSIFIER_NO_OUTPUT },
    { body: 'process.stdout.write("{\\"ok\\":tru");\n', expected: TOOL_CLASSIFIER_TRUNCATED_OUTPUT },
    { body: 'process.stdout.write("noise\\n{\\"ok\\":true}\\n");\n', expected: TOOL_CLASSIFIER_OUTPUT_CONTAMINATED },
    { body: 'process.stdout.write("{\\"ok\\":true}\\n{\\"ok\\":true}\\n");\n', expected: TOOL_CLASSIFIER_OUTPUT_CONTAMINATED },
    { body: 'process.stderr.write("boom\\n");\nprocess.exitCode = 7;\n', expected: TOOL_CLASSIFIER_PROCESS_FAILED },
  ];
  try {
    for (const item of cases) {
      const stub = stubCli(item.body);
      try {
        const invocation = invokeToolClassifier("guard", stub.path, ["--classify", fixture.path], fixture.path);
        assert.equal(invocation.defect, item.expected, JSON.stringify(invocation, null, 2));
        assert.throws(
          () => toolDocument(invocation),
          (error: unknown) => error instanceof Error && error.message.includes(item.expected),
          `the guard did not name ${item.expected}`,
        );
      } finally {
        stub.dispose();
      }
    }
  } finally {
    fixture.dispose();
  }
});
