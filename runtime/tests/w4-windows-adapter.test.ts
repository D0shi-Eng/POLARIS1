// حرّاس ثابتة على محوّل ويندوز ومشغّله.
//
// المحوّل يُبنى ويُشغَّل على ويندوز فقط، فلا يمكن تنفيذه من هنا. ما يمكن فعله —
// ويجب — هو منع إضعافه بصمت: كل ثابت أمني في ADR-001 و ADR-006 و ADR-007 مذكور
// هنا بالاسم، وأي حذف له يكسر اختبارًا.
//
// هذه ليست بديلًا عن التشغيل الأصلي. التشغيل الأصلي هو ما يصدر الحكم.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

import { runtimeSrcPath } from "./helpers.js";

const REPOSITORY = join(runtimeSrcPath(), "..", "..");
const ADAPTER = join(REPOSITORY, "tools", "w4-windows-adapter");
const RUNNER = join(REPOSITORY, "tools", "w4-windows-conformance", "run.ps1");
const PROBES = join(REPOSITORY, "tools", "w4-windows-conformance", "windows-probes.mjs");

function source(name: string): string {
  return readFileSync(join(ADAPTER, name), "utf8");
}

function adapterSource(): string {
  return readdirSync(ADAPTER)
    .filter((name) => name.endsWith(".cs"))
    .map((name) => readFileSync(join(ADAPTER, name), "utf8"))
    .join("\n");
}

/**
 * الشيفرة بلا تعليقات. الدرس نفسه الذي علّمه فحص الاستيراد سابقًا: تعليق يقول
 * "لا internetClient" ليس استعمالًا لـinternetClient، ومطابقة النص الخام تخلط
 * بين الوصف والفعل.
 */
function withoutComments(text: string, style: "cs" | "ps"): string {
  const withoutBlocks =
    style === "ps" ? text.replace(/<#[\s\S]*?#>/g, " ") : text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const lineComment = style === "ps" ? /(^|\s)#.*$/gm : /\/\/.*$/gm;
  return withoutBlocks.replace(lineComment, " ");
}

/**
 * الشيفرة بلا تعليقات ولا سلاسل نصية. الدرس نفسه ممتدًّا خطوة: سلسلة تبرير
 * تذكر اسم مكتبة ليست ارتباطًا بها، تمامًا كما أن التعليق ليس استدعاءً.
 */
function withoutCommentsOrStrings(text: string): string {
  return withoutComments(text, "cs")
    .replace(/@"(?:[^"]|"")*"/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)'/g, "'c'");
}

const CS_STRING_LITERAL = String.raw`(@?"(?:[^"\\]|\\.|"")*")`;

/**
 * ارتباط أصلي حقيقي بوحدة نظام، لا مجرد ذكرها.
 *
 * ما يُعدّ ارتباطًا: اسم المكتبة داخل DllImport، أو تحميل وحدة باسمها عبر
 * LoadLibrary/GetModuleHandle، أو معرّف في الشيفرة نفسها يحمل الاسم. وما ليس
 * ارتباطًا: تعليق يشرح سلوك المحمّل، أو سلسلة تبرير في الدليل تسمّي من يقرأ
 * متغيّر بيئة. الحارس الذي لا يفرّق بينهما يعاقب التوثيق ويترك التبعية.
 */
function nativeBindingsTo(moduleName: string, text: string): string[] {
  const code = withoutComments(text, "cs");
  const names = new RegExp(moduleName, "i");
  const found: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["DllImport", new RegExp(String.raw`\bDllImport\s*\(\s*` + CS_STRING_LITERAL, "g")],
    [
      "module load",
      new RegExp(
        String.raw`\b(?:LoadLibrary|LoadLibraryA|LoadLibraryW|LoadLibraryEx|LoadLibraryExA|LoadLibraryExW|GetModuleHandle|GetModuleHandleA|GetModuleHandleW|GetModuleHandleEx)\s*\(\s*` +
          CS_STRING_LITERAL,
        "g",
      ),
    ],
  ];
  for (const [label, pattern] of patterns) {
    let match: RegExpExecArray | null = pattern.exec(code);
    while (match !== null) {
      const literal = match[1] ?? "";
      if (names.test(literal)) found.push(`${label} ${literal}`);
      match = pattern.exec(code);
    }
  }
  const identifier = new RegExp(String.raw`\b[A-Za-z0-9_]*` + moduleName + String.raw`[A-Za-z0-9_]*\b`, "i");
  const hit = identifier.exec(withoutCommentsOrStrings(text));
  if (hit !== null) found.push(`identifier ${hit[0]}`);
  return found;
}

test("the Windows adapter exists and is built from the in-box compiler, with no external toolchain", () => {
  for (const file of [
    "Program.cs",
    "ConfinedLauncher.cs",
    "HandleX03Mode.cs",
    "ConfinedExecMode.cs",
    "PssHandleEnumeration.cs",
    "NtHandleEnumeration.cs",
    "HandleTableModel.cs",
    "AclInspector.cs",
    "MissionFixtures.cs",
    "AclControlProbe.cs",
    "build.ps1",
  ]) {
    assert.equal(existsSync(join(ADAPTER, file)), true, `${file} is missing from the Windows adapter`);
  }
  const build = source("build.ps1");
  assert.match(build, /Microsoft\.NET\\Framework64\\v4\.0\.30319\\csc\.exe/);
  // طبقة P/Invoke من W1 يُعاد استخدامها بدل كتابة نسخة أضعف.
  assert.match(build, /confinement-spike\\launcher\\Native/);
});

test("the launcher keeps every ADR-001 confinement invariant, by name", () => {
  const all = adapterSource();
  const required: ReadonlyArray<readonly [string, string]> = [
    ["PROC_THREAD_ATTRIBUTE_HANDLE_LIST", "explicit handle list"],
    ["CREATE_SUSPENDED", "the child must not execute before confinement is complete"],
    ["AssignProcessToJobObject", "job membership"],
    ["JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE", "kill on job close"],
    ["PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES", "AppContainer token"],
    ["CREATE_UNICODE_ENVIRONMENT", "constructed environment block"],
  ];
  for (const [needle, why] of required) {
    assert.ok(all.includes(needle), `the adapter lost ${why} (${needle})`);
  }

  // الضم إلى الـJob يقع قبل الاستئناف. النافذة بينهما هي نافذة الهروب.
  const launcher = source("ConfinedLauncher.cs");
  assert.ok(
    launcher.indexOf("AssignProcessToJobObject") < launcher.indexOf("ResumeThread"),
    "the child is resumed before it is assigned to the job",
  );
  // وفحص المقابض يقع قبل الاستئناف أيضًا، فهو شرط تنفيذ لا تقرير لاحق.
  assert.ok(
    launcher.indexOf("HandleScanner.Scan") < launcher.indexOf("ResumeThread"),
    "handles are scanned after the child was resumed, which makes the result racy",
  );
});

test("the AppContainer is created with zero capabilities and never asks for internetClient", () => {
  const all = adapterSource();
  assert.match(all, /capabilities\.CapabilityCount = 0;/);
  assert.match(all, /capabilities\.Capabilities = IntPtr\.Zero;/);
  // W1 أثبت أن قدرة الشبكة ليست تحكمًا بالوجهة. لا تُطلب هنا بحال.
  // الفحص على الشيفرة لا على النثر: تعليق ينفي القدرة ليس طلبًا لها.
  const code = withoutComments(all, "cs").replace(/internet_client_requested/g, "");
  assert.equal(/internetClient/i.test(code), false);
  // BREAKAWAY غير مضبوط: عدم ضبطه هو المنع.
  assert.equal(code.includes("JOB_OBJECT_LIMIT_BREAKAWAY_OK"), false);
  assert.equal(code.includes("SILENT_BREAKAWAY"), false);
});

// ── W-11: التعداد بلا سقف مخترع ──────────────────────────────────────────────

test("REGRESSION: no arbitrary handle-value ceiling may return, in any form", () => {
  const scanner = source("HandleScanner.cs");
  const enumeration = source("NtHandleEnumeration.cs");

  // العيب حرفيًا: سقف رقمي مخترع يُجرَّب المدى حتى يبلغه.
  assert.equal(scanner.includes("MaxHandleValue"), false, "the arbitrary handle ceiling is back by name");
  // مدى قيم المقابض لا يُحدّه رقم مكتوب، لا في الفاحص ولا في التعداد.
  const scannerCode = withoutComments(scanner, "cs");
  assert.equal(
    /value\s*<=\s*[0-9]{3,}/.test(scannerCode),
    false,
    "a handle-value loop is bounded by a numeric literal again",
  );
  assert.equal(scannerCode.includes("8192"), false, "the 8192 ceiling is back");
  assert.equal(scannerCode.includes("65536"), false, "the ceiling was merely raised to another guess");
  // والمدى الوحيد الباقي مشتق من القياس نفسه، لا من ثابت.
  assert.match(scanner, /CorroborationUpperBound/);
  assert.match(scanner, /snapshot\.MaxValue \+ overscan/);
  // وحجم المخزن في التعداد يحدّده النظام بما يطلبه، لا تخمين يتوقف عند سقف.
  assert.match(enumeration, /returned > length/);

  // المصدر الكامل للتعداد هو عدد النظام نفسه، لا تخمين.
  assert.match(enumeration, /NtQueryInformationProcess/);
  assert.match(enumeration, /ProcessHandleInformation/);
  assert.match(enumeration, /PROCESS_HANDLE_TABLE_ENTRY_INFO/);
  assert.match(enumeration, /STATUS_INFO_LENGTH_MISMATCH/);
});

// ── ADR-007 بعد التصحيح: الواجهة العامة أولًا، والداخلية معلنة كداخلية ────────

test("the primary handle enumerator is the documented kernel32 Process Snapshotting API", () => {
  const pss = source("PssHandleEnumeration.cs");
  const scanner = source("HandleScanner.cs");

  // الواجهات العامة بأسمائها، من kernel32 لا من ntdll.
  for (const symbol of [
    "PssCaptureSnapshot",
    "PssQuerySnapshot",
    "PssWalkMarkerCreate",
    "PssWalkSnapshot",
    "PssFreeSnapshot",
    "PSS_CAPTURE_HANDLES",
    "PSS_QUERY_HANDLE_INFORMATION",
    "PSS_WALK_HANDLES",
  ]) {
    assert.ok(pss.includes(symbol), `the public snapshot enumerator lost ${symbol}`);
  }
  const pssCode = withoutComments(pss, "cs");
  assert.match(pssCode, /DllImport\("kernel32\.dll"/);
  assert.deepEqual(nativeBindingsTo("ntdll", pss), [], "the primary enumerator reaches into the internal API");

  // الترتيب: العامة تُستدعى قبل الداخلية، وليست الداخلية هي الأساس.
  const primaryAt = scanner.indexOf("PssHandleEnumeration.Query");
  const secondaryAt = scanner.indexOf("NtHandleEnumeration.Query");
  assert.ok(primaryAt >= 0, "the scanner no longer uses the public enumerator at all");
  assert.ok(primaryAt < secondaryAt, "the internal enumeration API runs before the public one again");
  assert.match(scanner, /PSS_PRIMARY/);
  assert.match(scanner, /NT_FALLBACK_DECLARED/);
});

test("PSS completeness is proven by the system's own counters, not asserted", () => {
  const pss = source("PssHandleEnumeration.cs");
  // عدّ النظام مسجَّل، والمشي ينتهي بـERROR_NO_MORE_ITEMS، والعددان يتطابقان.
  assert.match(pss, /HandlesCaptured/);
  assert.match(pss, /ERROR_NO_MORE_ITEMS/);
  assert.match(pss, /WalkEndedWithNoMoreItems/);
  assert.match(
    pss,
    /snapshot\.HandlesCapturedRecorded[\s\S]{0,200}snapshot\.WalkEndedWithNoMoreItems[\s\S]{0,200}snapshot\.ParsedCount == snapshot\.ReportedCount/,
    "an incomplete PSS walk is no longer required to fail",
  );
  // ولا سقف مخترع لقيم المقابض في المسار العام أيضًا.
  const pssCode = withoutComments(pss, "cs");
  assert.equal(pssCode.includes("8192"), false, "an invented handle-value ceiling appeared in the public path");
  assert.equal(pssCode.includes("65536"), false, "an invented handle-value ceiling appeared in the public path");
});

test("the internal API is labelled internal and never claimed to be publicly documented", () => {
  const enumeration = source("NtHandleEnumeration.cs");
  const scanner = source("HandleScanner.cs");

  assert.match(enumeration, /INTERNAL_UNDOCUMENTED/);
  assert.match(scanner, /INTERNAL_UNDOCUMENTED/);
  assert.match(scanner, /PUBLIC_DOCUMENTED/);
  // الادعاء الخاطئ لا يعود: لا يوصف ProcessHandleInformation بأنه موثّق رسميًا.
  const all = adapterSource();
  assert.equal(
    /ProcessHandleInformation[^\n]{0,120}(officially documented|موثّق رسميًا)/.test(all),
    false,
    "an undocumented PROCESSINFOCLASS value is described as officially documented again",
  );
  assert.equal(
    all.includes("لا توجد واجهة kernel32 موثّقة"),
    false,
    "the corrected ADR-007 claim about a missing documented kernel32 API is back in the adapter",
  );
});

test("disagreeing enumeration sources are never merged into a single reading", () => {
  const scanner = source("HandleScanner.cs");
  const launcher = source("ConfinedLauncher.cs");
  const x03 = source("HandleX03Mode.cs");
  const confined = source("ConfinedExecMode.cs");

  assert.match(scanner, /ReasonSourcesDisagree = "HANDLE_ENUMERATION_SOURCES_DISAGREE"/);
  assert.match(scanner, /PrimaryOnlyValues/);
  assert.match(scanner, /SecondaryOnlyValues/);
  // المقارنة تجري على هدف معلّق فقط، وامتناعها يُسجَّل بسببه.
  assert.match(scanner, /TargetSuspended/);
  assert.match(scanner, /TARGET_NOT_SUSPENDED/);
  // والابن يبقى معلّقًا طوال لقطة الوراثة الأساسية.
  assert.match(launcher, /scanContext\.TargetSuspended = true;/);
  assert.ok(
    launcher.indexOf("scanContext.TargetSuspended = true;") < launcher.indexOf("ResumeThread"),
    "the primary inheritance snapshot no longer happens while the child is suspended",
  );
  // الاختلاف يمنع الاستئناف، ويصير INCONCLUSIVE لا PASS ولا FAIL.
  assert.match(launcher, /WINDOWS_HANDLE_ENUMERATION_SOURCES_DISAGREE/);
  assert.ok(
    launcher.indexOf("WINDOWS_HANDLE_ENUMERATION_SOURCES_DISAGREE") < launcher.indexOf("ResumeThread"),
    "a self-contradicting enumeration is handled after the child was already resumed",
  );
  assert.match(confined, /result\.Verdict = "INCONCLUSIVE";\s*\n\s*result\.ReasonCode = HandleScanner\.ReasonSourcesDisagree/);
  assert.match(x03, /controlSourcesDisagree/);
  assert.match(x03, /executorSourcesDisagree/);
  // ومصدر التعداد المستعمل معلن في الدليل، فالمسار الاحتياطي لا يمرّ صامتًا.
  assert.match(x03, /handle_enumeration_primary_api/);
  assert.match(x03, /positive_control_enumeration_source/);
  assert.match(scanner, /"enumeration_source"/);
});

test("the lower-level enumeration API is isolated in one Windows-adapter file and never leaks into the domain", () => {
  const files = readdirSync(ADAPTER).filter((name) => name.endsWith(".cs"));
  // الفحص على التبعية لا على النص: DllImport أو تحميل وحدة أو معرّف — لا تعليق
  // ولا سلسلة تبرير. ملف يشرح لماذا يحتاج المحمّل SystemRoot لا يعتمد على ntdll.
  const touching = files.filter(
    (name) => nativeBindingsTo("ntdll", readFileSync(join(ADAPTER, name), "utf8")).length > 0,
  );
  assert.deepEqual(touching, ["NtHandleEnumeration.cs"], "ntdll is bound outside its single adapter file");
  // والملف المعزول يحمل ارتباطًا حقيقيًا: عزلٌ لشيء غير موجود ليس عزلًا.
  assert.ok(
    nativeBindingsTo("ntdll", source("NtHandleEnumeration.cs")).some((binding) => binding.startsWith("DllImport")),
    "the isolated file no longer carries the native binding the invariant is about",
  );
  // والواجهة العامة لا تُحسب هنا: هي kernel32، ولا تلمس ntdll بحال.

  // ولا شيء من هذا يظهر في عقود المجال ولا في runtime: التفصيل الأصلي لا يتسرّب.
  for (const area of [join(REPOSITORY, "contracts", "src"), join(REPOSITORY, "runtime", "src")]) {
    assert.equal(existsSync(area), true, `${area} is missing`);
    const entries = readdirSync(area, { recursive: true }) as string[];
    for (const entry of entries) {
      if (!entry.endsWith(".ts")) continue;
      // على الشيفرة لا على النثر: تعليق يشرح سلوك المحمّل ليس استدعاءً أصليًا.
      const text = withoutComments(readFileSync(join(area, entry), "utf8"), "cs");
      for (const detail of ["NtQueryInformationProcess", "ProcessHandleInformation", "DllImport"]) {
        assert.equal(text.includes(detail), false, `${entry} carries the Windows native detail ${detail}`);
      }
    }
  }
});

test("a scan that cannot prove its own completeness is never read as a clean handle table", () => {
  const scanner = source("HandleScanner.cs");
  const launcher = source("ConfinedLauncher.cs");
  const x03 = source("HandleX03Mode.cs");
  const confined = source("ConfinedExecMode.cs");

  assert.match(scanner, /EnumerationComplete/);
  assert.match(scanner, /CorroborationExtraValues/);
  // الفرض يقع قبل الاستئناف: تعداد ناقص يمنع تشغيل الابن، لا يُبلَّغ عنه بعده.
  assert.match(launcher, /WINDOWS_HANDLE_ENUMERATION_INCOMPLETE/);
  assert.ok(
    launcher.indexOf("WINDOWS_HANDLE_ENUMERATION_INCOMPLETE") < launcher.indexOf("ResumeThread"),
    "an incomplete enumeration is handled after the child was already resumed",
  );
  // والحكم: INCONCLUSIVE، لا PASS ولا FAIL.
  assert.match(x03, /EXECUTOR_ENUMERATION_INCOMPLETE/);
  assert.match(x03, /CONTROL_ENUMERATION_INCOMPLETE/);
  assert.match(x03, /executorScanComplete/);
  assert.match(confined, /HANDLE_ENUMERATION_INCOMPLETE/);
  assert.match(confined, /"INCONCLUSIVE";\s*\n\s*result\.ReasonCode = "HANDLE_ENUMERATION_INCOMPLETE"/);
});

test("handle findings are classified by origin, and the raw findings stay in the evidence", () => {
  const scanner = source("HandleScanner.cs");
  for (const origin of ["INHERITED_AT_CREATE", "PROBE_CREATED", "RUNTIME_OPENED"]) {
    assert.ok(scanner.includes(origin), `the origin taxonomy lost ${origin}`);
  }
  // القياس عند الإنشاء يقع على عملية معلّقة، والنسبة إلى الوراثة مبنية عليه.
  const launcher = source("ConfinedLauncher.cs");
  assert.match(launcher, /ScanHandlesBeforeResume/);
  assert.match(launcher, /ScanHandlesAfterResume/);
  // النتائج الخام كاملة، لا عدد مجرّد.
  for (const field of ["\"value\"", "\"path\"", "\"origin\"", "\"granted_access\"", "\"duplicable\""]) {
    assert.ok(scanner.includes(field), `the raw findings no longer report ${field}`);
  }
});

test("the X03 probe uses Windows handle semantics and refuses to pass without its positive controls", () => {
  const x03 = source("HandleX03Mode.cs");
  const scanner = source("HandleScanner.cs");

  // دلالات ويندوز، لا منطق واصفات لينكس.
  assert.match(scanner, /DuplicateHandle/);
  assert.match(scanner, /GetFinalPathNameByHandleW/);
  assert.equal(scanner.includes("/proc/self/fd"), false, "Linux descriptor logic must never be Windows evidence");

  // الضابط الموجب شرط سابق للحكم: بلا كشف تسرّب حقيقي لا يعني النظيف شيئًا.
  assert.match(x03, /AMBIENT_INHERITANCE_NO_HANDLE_LIST/);
  assert.match(x03, /controlDetected/);
  assert.match(
    x03,
    /if \(!controlDetected\)\s*\{\s*verdict = "INCONCLUSIVE";/,
    "a failed positive control must make the probe inconclusive, never passing",
  );
  // وضابط ثانٍ على أداة القياس نفسها: التعداد يجب أن يرى التسريب المعروف.
  assert.match(x03, /PARENT_SCAN_MISSED_KNOWN_LEAK/);
  assert.match(x03, /controlScanSawLeak/);
  // ولا تُقرأ قائمة فارغة نظافةً: الفحص نفسه يجب أن يكون قد جرى.
  assert.match(x03, /EXECUTOR_NOT_SCANNED/);
  assert.match(x03, /executorScanned/);
  // والحالة النظيفة تشمل منفّذ W4 الحقيقي، لا ابنًا اصطناعيًا فقط.
  assert.match(x03, /clean_w4_executor/);
  assert.match(x03, /host-script/);
});

// ── W-12: نموذج نطاق الـACL ──────────────────────────────────────────────────

test("REGRESSION: the mission root is never granted with inheritance, so the denied fixture inherits nothing", () => {
  const confined = source("ConfinedExecMode.cs");
  const container = source("AppContainerScope.cs");

  // العيب حرفيًا: GrantModify(missionRoot) بوراثة، فيرث "الخارج" نفس المنح.
  assert.equal(
    /GrantModify\w*\(\s*(missionRoot|fixtures\.Root)\s*[,)]/.test(confined),
    false,
    "the mission root is granted modify rights again, which reaches the denied fixture by inheritance",
  );
  assert.match(confined, /GrantTraverseOnly\(fixtures\.Root, MissionFixtures\.ScopeControlRoot\)/);
  assert.match(confined, /GrantModifyTree\(fixtures\.AllowedDirectory, MissionFixtures\.ScopeAllowedResource\)/);

  // الاجتياز بلا وراثة: هذه هي النقطة التي كان العيب فيها.
  const traverse = container.slice(container.indexOf("public bool GrantTraverseOnly"));
  assert.match(traverse, /InheritanceFlags\.None/);
  assert.equal(
    /GrantTraverseOnly[\s\S]{0,400}ContainerInherit/.test(container),
    false,
    "the traversal grant inherits again",
  );
});

test("the denied control resource is never named in any grant call", () => {
  const confined = withoutComments(source("ConfinedExecMode.cs"), "cs");
  // كل استدعاء منح على الحاوية يبدأ بـcontainer.Grant…؛ لا واحد منها يسمّي الممنوع.
  const grantCalls = confined.match(/container\.Grant\w*\([^)]*\)/g) ?? [];
  assert.ok(grantCalls.length >= 5, "the grant calls disappeared; this guard would pass vacuously");
  for (const call of grantCalls) {
    assert.equal(call.includes("Denied"), false, `a grant names the denied control resource: ${call}`);
  }
});

test("the three resource classes are explicitly separated, and the evidence carries the effective ACL", () => {
  const confined = source("ConfinedExecMode.cs");
  const fixtures = source("MissionFixtures.cs");
  const inspector = source("AclInspector.cs");

  for (const scopeClass of [
    "RUNTIME_CODE_SCOPE",
    "MISSION_ALLOWED_RESOURCE_SCOPE",
    "MISSION_DENIED_CONTROL_RESOURCE",
    "MISSION_CONTROL_POSITIVE_FIXTURE",
  ]) {
    assert.ok(fixtures.includes(scopeClass), `the scope taxonomy lost ${scopeClass}`);
  }
  // مجلدات منفصلة فيزيائيًا: لا انزلاق بمسار نسبي.
  assert.match(fixtures, /Path\.Combine\(Root, "scope"\)/);
  assert.match(fixtures, /Path\.Combine\(Root, "outside"\)/);
  assert.match(fixtures, /Path\.Combine\(Root, "control"\)/);
  assert.match(source("RuntimeCodeStaging.cs"), /Path\.Combine\(workspace, "runtime-code"\)/);

  // الـACL الفعلي يُقرأ ويُخرَج، ولا يُفترض من نيّة المنح.
  assert.match(confined, /AclInspector\.Describe/);
  assert.match(confined, /effective_acl/);
  assert.match(inspector, /GetAccessRules\(true, true, typeof\(SecurityIdentifier\)\)/);
  assert.match(inspector, /container_ace_inherited/);
  // ومجموعات حزم التطبيقات تُفحص بمعرّفها لا باسم عرض يتغيّر بلغة النظام.
  assert.match(inspector, /S-1-15-2-1/);
  assert.match(inspector, /S-1-15-2-2/);

  // وجود منح يصل إلى المورد الممنوع نتيجة أمنية، لا ملاحظة.
  assert.match(confined, /DENIED_RESOURCE_HAS_CONTAINER_ACE/);
  assert.match(confined, /result\.Verdict = "FAIL";\s*\n\s*result\.ReasonCode = "DENIED_RESOURCE_HAS_CONTAINER_ACE"/);
});

test("W-12 proves the OS boundary separately from the PEP, with an OS-level positive control", () => {
  const confined = source("ConfinedExecMode.cs");
  const control = source("AclControlProbe.cs");

  // (أ) نقطة الفرض ترفض للسبب المنطقي الصحيح، لا لأي سبب.
  assert.match(confined, /TARGET_OUTSIDE_GRANT/);
  assert.match(confined, /DENIED_READ_REFUSED_FOR_THE_WRONG_REASON/);

  // (ب) حدّ ويندوز نفسه يرفض: فتح خام من داخل الحاوية بلا مرور بالـPEP.
  assert.match(control, /openSync/);
  assert.match(confined, /os_boundary_refuses_denied_resource/);
  assert.match(confined, /DENIED_RESOURCE_OS_ACCESSIBLE/);

  // والضابط الموجب: نفس شكل الملف، ممنوحًا، يجب أن يُقرأ فعلًا.
  assert.match(control, /PositiveControlValid/);
  assert.match(confined, /OS_ACL_POSITIVE_CONTROL_DID_NOT_READ/);
  assert.match(
    confined,
    /result\.Verdict = "INCONCLUSIVE";\s*\n\s*result\.ReasonCode = "OS_ACL_POSITIVE_CONTROL_DID_NOT_READ"/,
    "a failed OS-level positive control must be inconclusive, never a confinement pass",
  );
});

test("W-12 classifies its blocker by stage instead of saying AppContainer failed", () => {
  const confined = source("ConfinedExecMode.cs");
  for (const stage of [
    "PROFILE_CREATE",
    "PROFILE_RECLAIM",
    "RUNTIME_CODE_STAGING",
    "ACL_GRANT",
    "ACL_INSPECTION",
    "JOB_CREATE",
    "CREATE_PROCESS_SUSPENDED",
    "HANDLE_VALIDATION",
    "JOB_ASSIGN",
    "RUNTIME_STARTUP",
    "ACL_CONTROL_STARTUP",
    "CLEANUP_VERIFICATION",
  ]) {
    assert.ok(confined.includes(stage), `the stage taxonomy lost ${stage}`);
  }
  // منح فاشل يُبلَّغ في مرحلته، لا بعد فشل CreateProcess بخطأ مُضلِّل.
  assert.match(confined, /if \(grantFailures\.Count > 0\)/);
  assert.match(confined, /"BLOCKED"/);
  assert.match(confined, /does not substitute for it/);
});

test("W-12 stays least-privilege: no ACL is granted outside the temporary workspace", () => {
  const confined = source("ConfinedExecMode.cs");
  const staging = source("RuntimeCodeStaging.cs");
  const container = source("AppContainerScope.cs");

  assert.match(confined, /GrantReadExecuteTree\(staging\.Root, MissionFixtures\.ScopeRuntimeCode\)/);
  // ولا منح على مسارات النظام ولا على شجرة المستودع ولا منح واسع.
  const code = withoutComments(confined + "\n" + staging + "\n" + container, "cs");
  for (const forbidden of ["Users:F", "Everyone:F", "ALL APPLICATION PACKAGES", "Program Files"]) {
    assert.equal(code.includes(forbidden), false, `a broad or system-scoped grant appeared: ${forbidden}`);
  }
  assert.equal(/Grant\w*\(\s*runtimeDist\s*[,)]/.test(code), false, "the repository tree is granted again");
  assert.equal(/Grant\w*\(\s*nodeDirectory\s*[,)]/.test(code), false, "the Node install directory is granted again");
  // وكل منح يقع تحت مساحة العمل المؤقتة: workspace أو ما اشتُقّ منها.
  assert.equal(/Grant\w*\(\s*"[A-Z]:\\/.test(code), false, "an absolute system path is granted");
});

test("runtime code scope is physically separate from mission resource scope, and proven identical to its source", () => {
  const confined = source("ConfinedExecMode.cs");
  const staging = source("RuntimeCodeStaging.cs");
  assert.match(confined, /ScopeRuntimeCode/);
  assert.match(confined, /ScopeAllowedResource/);
  assert.match(staging, /Path\.Combine\(workspace, "runtime-code"\)/);
  // والمنفّذ المحصور هو منفّذ W4 نفسه: يُثبَت بالبصمة لا بالادّعاء.
  assert.match(staging, /SHA256/);
  assert.match(staging, /byte_identical/);
  assert.match(staging, /is not byte-identical to its source/);
});

test("the launcher enforces handle scope before resume instead of only reporting it", () => {
  const launcher = source("ConfinedLauncher.cs");
  assert.match(launcher, /EnforceHandleScope/);
  assert.match(launcher, /WINDOWS_HANDLE_SCOPE_VIOLATION/);
  // الإنهاء يقع قبل الاستئناف، وإلا فالفرض متأخر عن التنفيذ.
  assert.ok(
    launcher.indexOf("WINDOWS_HANDLE_SCOPE_VIOLATION") < launcher.indexOf("ResumeThread"),
    "the violation is handled after the child was already resumed",
  );
  assert.match(launcher, /TerminateProcess\(processInformation\.hProcess, 259\)/);
  // ولا مسار احتياطي: الخرق يعيد النتيجة فورًا.
  assert.match(launcher, /outcome\.HandleScopeViolation = true;/);
});

// ── التنظيف جزء من الحكم ─────────────────────────────────────────────────────

test("the cleanup phase is measured, structured, and part of the verdict", () => {
  const confined = source("ConfinedExecMode.cs");
  const container = source("AppContainerScope.cs");

  assert.match(confined, /EXECUTION -> TEARDOWN -> CLEANUP_VERIFICATION -> FINAL_VERDICT/);
  for (const field of [
    "acl_restore_attempted",
    "acl_restore_success",
    "acl_restore_failures",
    "profile_delete_attempted",
    "profile_delete_success",
    "profile_delete_hresult",
    "runtime_code_cleanup_success",
    "mission_fixture_cleanup_success",
    "job_closed",
    "surviving_processes",
  ]) {
    assert.ok(
      confined.includes(field) || container.includes(field),
      `the structured cleanup result lost ${field}`,
    );
  }

  // الحكم النهائي لا يُحسب قبل اكتمال التنظيف.
  const cleanupCall = confined.indexOf("container.Cleanup()");
  const finalVerdict = confined.indexOf('json.Property("verdict", verdict)');
  assert.ok(cleanupCall > 0 && finalVerdict > 0, "the cleanup phase or the final verdict is missing");
  assert.ok(cleanupCall < finalVerdict, "the final verdict is written before cleanup has completed");

  // ونجاح تنفيذي مع تنظيف فاشل ليس نجاحًا.
  assert.match(confined, /verdict == "PASS" && !cleanupClean/);
  assert.match(confined, /CLEANUP_RESIDUAL_ACL_GRANT/);
  assert.match(confined, /CLEANUP_PROFILE_DELETE_FAILED/);
  // ولا يُبتلع إخفاق استعادة بلا دليل: الاستعادة تُتحقَّق بعد تنفيذها.
  assert.match(container, /ResidualContainerAces/);
  assert.equal(
    /catch \(Exception\)\s*\{\s*\}/.test(withoutComments(container, "cs")),
    false,
    "an exception is swallowed with no evidence during cleanup",
  );
});

test("an AppContainer profile is only deleted when this run owns its lifecycle", () => {
  const container = source("AppContainerScope.cs");
  for (const lifecycle of ["PROFILE_CREATED_THIS_RUN", "PROFILE_REUSED_OR_DERIVED", "PROFILE_STALE_DELETED"]) {
    assert.ok(container.includes(lifecycle), `the profile lifecycle taxonomy lost ${lifecycle}`);
  }
  // اشتقاق المعرّف ليس إنشاءً، ولا يمنح ملكية دورة الحياة.
  const reclaimFailed = container.indexOf("StaleReclaimFailed = true;");
  assert.ok(reclaimFailed > 0, "the unreclaimable-profile path is gone; this guard would pass vacuously");
  const derived = container.slice(reclaimFailed, container.indexOf("return false;", reclaimFailed));
  assert.match(derived, /DeriveAppContainerSidFromAppContainerName/);
  assert.equal(/_createdProfile = true/.test(derived), false, "deriving a SID marks the profile as created again");
  assert.equal(/OwnsProfile = true/.test(derived), false, "deriving a SID claims ownership of the profile again");
  assert.match(derived, /OwnsProfile = false/);
  assert.match(derived, /LifecycleReusedOrDerived/);
  // والحذف مشروط بالملكية، والاسترداد عملية صريحة ذات نتيجة مسجّلة.
  assert.match(container, /if \(OwnsProfile\)/);
  assert.match(container, /NOT_OWNED_BY_THIS_RUN/);
  assert.match(container, /ReclaimStaleProfile/);
  assert.match(container, /StaleDeleteHResult/);

  // وبيئة قياس غير نظيفة تُوقف القياس بدل أن تُقاس.
  const confined = source("ConfinedExecMode.cs");
  assert.match(confined, /STALE_PROFILE_NOT_RECLAIMED/);
  assert.match(confined, /result\.Verdict = "BLOCKED";[\s\S]{0,400}STALE_PROFILE_NOT_RECLAIMED/);
});

// ── تصنيف الأحكام ────────────────────────────────────────────────────────────

test("the probe harness never turns BLOCKED, INCONCLUSIVE or NOT_TESTED into a pass", () => {
  const probes = readFileSync(PROBES, "utf8");
  assert.match(probes, /outcome\.blocked\) record\(id, title, "BLOCKED"/);
  assert.match(probes, /outcome\.inconclusive\) record\(id, title, "INCONCLUSIVE"/);
  assert.match(probes, /failed > 0 \|\| blocked > 0 \|\| inconclusive > 0 \|\| notTested > 0 \? 1 : 0/);
  // غياب الثنائي عائق مُصنَّف، لا فشل أمني: لا يُدَّعى قياس لم يقع.
  assert.match(probes, /blocked_stage: "ADAPTER_BUILD"/);
  assert.match(probes, /Nothing about handles or confinement was measured/);
  // ولا يُرقّى حكم غائب إلى نجاح.
  assert.match(probes, /return \{ inconclusive: true, reason: `NO_VERDICT/);
  // W-11 و W-12 يستدعيان المحوّل فعلًا، ولا يُسجَّلان تخطّيًا بعد الآن.
  assert.match(probes, /runAdapter\(\s*"handle-x03"/);
  assert.match(probes, /runAdapter\(\s*"confined-exec"/);
  assert.equal(probes.includes("handle inheritance on Windows is NOT measured"), false);
  assert.equal(probes.includes("no AppContainer or Job Object confinement is claimed"), false);
});

test("every probe verdict carries the fields a review needs, and the raw evidence is the reference", () => {
  const probes = readFileSync(PROBES, "utf8");
  for (const field of [
    "measurement_started",
    "measurement_completed",
    "evidence_complete",
    "reason_code",
    "evidence_reference",
  ]) {
    assert.ok(probes.includes(field), `a probe verdict no longer carries ${field}`);
  }
  assert.match(probes, /VERDICT_CLASSIFICATION/);
  assert.match(probes, /NOT_TESTED/);
  assert.match(probes, /planNotTested/);
  // اختلاف التقرير عن الدليل الخام عيب في الأداة، والدليل الخام هو المرجع.
  assert.match(probes, /REPORT_EVIDENCE_DIVERGENCE/);
  assert.match(probes, /The raw evidence is the reference and the report is defective/);
  // واكتشاف هروب نقطة إعادة التحليل ادّعاء أمني: غياب الأداة عائق لا تخطٍّ.
  assert.match(probes, /MKLINK_UNAVAILABLE/);
});

test("the adapter source passes the static check that stands in for the compiler we cannot run here", () => {
  const check = spawnSync("node", [join(ADAPTER, "static-check.mjs")], { encoding: "utf8" });
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.match(check.stdout, /ADAPTER_STATIC_CHECK clean/);
  // وهو لا يدّعي أنه مُصرِّف.
  assert.match(check.stdout, /this is not a compiler/);
});

test("the runner installs deterministically, never audits or upgrades, and proves the lockfile did not move", () => {
  const runner = readFileSync(RUNNER, "utf8");
  assert.match(runner, /npm\.cmd/);
  assert.match(runner, /'ci'/);
  assert.match(runner, /package-lock\.json changed during the conformance run/);
  assert.match(runner, /Get-FileHash/);
  // ممنوع أثناء المطابقة: إصلاح تلقائي أو ترقية غير مضبوطة.
  const code = withoutComments(runner, "ps");
  assert.equal(/audit\s+fix/i.test(code), false);
  assert.equal(/npm.{0,20}'install'/.test(code), false);
  // وأمر واحد يكفي: التبعيات والبناء والفحص الساكن والاختبار والمسابر والهدم.
  assert.match(runner, /windows adapter: static check/);
  assert.match(runner, /windows adapter: build/);
  // بناء المحوّل يُتحقَّق منه بالثنائي نفسه، لا برسالة نجاح الخطوة.
  assert.match(runner, /ADAPTER_BUILD_FAILED/);
  assert.match(runner, /surviving_execution_hosts/);
  assert.match(runner, /leftover_appcontainer_profiles/);
  assert.match(runner, /w4-windows-run\.json/);
  // وملف تعريف باقٍ إخفاق تنظيف، لا تحذير يُمرَّر.
  assert.match(runner, /CLEANUP_LEFTOVER_APPCONTAINER_PROFILE/);
  assert.equal(code.includes("CLEANUP WARNING"), false, "a leftover profile is only a warning again");
});

// ── ADR-007: الحارس نفسه يُختبر بضابط موجب وآخر سالب ─────────────────────────

test("the ntdll isolation guard catches a real native binding and ignores documentation", () => {
  // ضابط موجب: تبعية حقيقية محرَّمة في ملف ليس NtHandleEnumeration.cs.
  const forbiddenDllImport = [
    "using System.Runtime.InteropServices;",
    "internal static class Smuggled",
    "{",
    '    [DllImport("ntdll.dll", SetLastError = true)]',
    "    internal static extern int NtQueryInformationProcess(",
    "        System.IntPtr process, int infoClass, System.IntPtr buffer, uint length, out uint returned);",
    "}",
  ].join("\n");
  assert.ok(
    nativeBindingsTo("ntdll", forbiddenDllImport).length > 0,
    "the guard no longer catches a real forbidden DllImport of ntdll",
  );

  // ضابط موجب ثانٍ: التحميل الديناميكي يتفادى DllImport ولا يتفادى الحارس.
  const forbiddenModuleLoad = [
    "internal static class Smuggled",
    "{",
    '    private static readonly System.IntPtr Module = NativeExtras.GetModuleHandleW("ntdll.dll");',
    "}",
  ].join("\n");
  assert.ok(
    nativeBindingsTo("ntdll", forbiddenModuleLoad).length > 0,
    "the guard no longer catches a dynamically loaded ntdll module",
  );

  // ضابط موجب ثالث: معرّف في الشيفرة يحمل الاسم.
  const forbiddenIdentifier = ["internal static class NtdllBridge", "{", "}"].join("\n");
  assert.ok(
    nativeBindingsTo("ntdll", forbiddenIdentifier).length > 0,
    "the guard no longer catches an ntdll-named code identifier",
  );

  // ضابط سالب: تعليق وسلسلة تبرير. توثيقٌ لا تبعية، ويجب ألا يُعاقَب.
  const documentationOnly = [
    "internal static class Plan",
    "{",
    "    // ntdll والمحمّل يقرآن هذا المسار لتحميل مكتبات النظام.",
    "    internal static string Justify()",
    "    {",
    '        return "ntdll and the loader resolve system modules through it";',
    "    }",
    "}",
  ].join("\n");
  assert.deepEqual(
    nativeBindingsTo("ntdll", documentationOnly),
    [],
    "the guard punishes documentation again instead of detecting a dependency",
  );

  // ولا يُستثنى ملف باسمه: الاستثناء يجعل الحارس اسمًا بلا فرض.
  const guard = readFileSync(join(REPOSITORY, "runtime", "tests", "w4-windows-adapter.test.ts"), "utf8");
  const detectorAt = guard.indexOf("function nativeBindingsTo");
  const detector = guard.slice(detectorAt, guard.indexOf("\n}", detectorAt));
  assert.equal(/\.cs\b/.test(detector), false, "the ntdll detector special-cases a file by name");
  const isolationAt = guard.indexOf('test("the lower-level enumeration API is isolated');
  const isolation = guard.slice(isolationAt, guard.indexOf("\n});", isolationAt));
  assert.equal(
    /ExecutionEnvironmentPlan/.test(isolation),
    false,
    "the ntdll isolation guard whitelists ExecutionEnvironmentPlan.cs instead of detecting a real dependency",
  );
});

// ── ADR-006: النطاق المحصور هو رسم استيراد المنفّذ، لا شجرة البناء ───────────

test("the staged runtime code is the executor's whole import graph and nothing else", () => {
  const staging = source("RuntimeCodeStaging.cs");
  const graph = source("RuntimeModuleGraph.cs");

  // النسخ الأعمى لشجرة dist كاملة لم يعد موجودًا.
  assert.equal(staging.includes("CopyTree"), false, "the whole build tree is copied into the confined scope again");

  // الرسم يُغلق قبل نسخ حرف واحد، وسبب كل تعذّر مسمّى.
  for (const reason of [
    "RUNTIME_CODE_STAGING_INCOMPLETE",
    "RUNTIME_CODE_STAGING_BARE_SPECIFIER",
    "RUNTIME_CODE_STAGING_ABSOLUTE_SPECIFIER",
    "RUNTIME_CODE_STAGING_ESCAPES_RUNTIME_ROOT",
    "RUNTIME_CODE_STAGING_UNRESOLVABLE_DYNAMIC_IMPORT",
  ]) {
    assert.ok(graph.includes(reason), `the module graph lost the classified reason ${reason}`);
  }
  const resolveAt = staging.indexOf("_graph.Resolve(");
  const copyAt = staging.indexOf("File.Copy(sourceNode");
  assert.ok(resolveAt >= 0, "staging no longer resolves the import graph");
  assert.ok(resolveAt < copyAt, "staging copies before it has proven the graph is complete");

  // الهوية لكل وحدة، لا لملفين مختارين.
  assert.match(staging, /Record\("EXECUTION_HOST"/);
  assert.match(staging, /Record\("RUNTIME_MODULE"/);
  assert.match(staging, /Record\("NODE_RUNTIME"/);
  assert.match(staging, /RUNTIME_CODE_STAGING_NOT_BYTE_IDENTICAL/);
  assert.match(staging, /source_sha256/);
  assert.match(staging, /staged_sha256/);
  assert.match(staging, /byte_identical/);

  // والنطاق ليس أوسع من الرسم: ملف مُدرَّج غير متوقَّع إخفاق تدريج.
  assert.match(staging, /RUNTIME_CODE_STAGING_UNEXPECTED_FILE/);
  assert.match(staging, /Unexpected\(Root, expected\)/);

  // وتدريج ناقص عائق مصنَّف، لا إخفاق أمني.
  const confined = source("ConfinedExecMode.cs");
  assert.match(
    confined,
    /result\.Verdict = "BLOCKED";\s*\n\s*result\.ReasonCode = staging\.FailureReasonCode/,
    "an incomplete staging is no longer reported as BLOCKED with its classified reason",
  );
});

test("the built executor's relative import graph resolves entirely inside the built runtime tree", () => {
  // القراءة على البناء الحقيقي بقواعد المُدرِّج نفسها: كل محدِّد نسبي يجب أن يوجد،
  // وألا يخرج من شجرة البناء، وألا يكون حزمة مجرّدة.
  const distRoot = join(REPOSITORY, "runtime", "dist");
  const entry = join(distRoot, "src", "exec", "host-main.js");
  assert.equal(existsSync(entry), true, "the built execution host is missing");

  const seen = new Set<string>([entry]);
  const pending: string[] = [entry];
  const specifierGroup = String.raw`("[^"\r\n]*"|'[^'\r\n]*')`;
  const patterns = [
    new RegExp(String.raw`(?:^|[^\w$.])(?:import|export)\b[^;]*?\bfrom\s*` + specifierGroup, "g"),
    new RegExp(String.raw`(?:^|[^\w$.])import\s*` + specifierGroup + String.raw`\s*;`, "g"),
    new RegExp(String.raw`(?:^|[^\w$.])import\s*\(\s*` + specifierGroup + String.raw`\s*\)`, "g"),
    new RegExp(String.raw`(?:^|[^\w$.])require\s*\(\s*` + specifierGroup + String.raw`\s*\)`, "g"),
  ];

  for (let index = 0; index < pending.length; index += 1) {
    const module = pending[index] ?? "";
    assert.notEqual(module, "", "the import-graph walk lost a module it had queued");
    const text = readFileSync(module, "utf8");
    assert.equal(
      new RegExp(String.raw`(?:^|[^\w$.])import\s*\(\s*(?!["'])`).test(text),
      false,
      `${module} carries a dynamic import that cannot be resolved statically`,
    );
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(text);
      while (match !== null) {
        const specifier = (match[1] ?? '""').slice(1, -1);
        match = pattern.exec(text);
        if (specifier.startsWith("node:")) continue;
        assert.ok(
          specifier.startsWith("./") || specifier.startsWith("../"),
          `${module} imports the non-relative specifier ${specifier}, which the staged scope cannot resolve`,
        );
        const resolved = join(dirname(module), specifier);
        assert.ok(
          resolved.startsWith(distRoot + sep),
          `${module} imports ${specifier}, which escapes the built runtime tree`,
        );
        assert.equal(existsSync(resolved), true, `${module} imports ${specifier}, which does not exist`);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          pending.push(resolved);
        }
      }
    }
  }
  assert.ok(seen.size >= 2, "the executor's import graph collapsed to a single file; the walk is not doing its work");
});

// ── W-12: تحليل الوحدات داخل الشجرة المُدرَّجة ───────────────────────────────

test("the staged tree is laid out so Node resolves it as ESM without reading above the granted scope", () => {
  const staging = source("RuntimeCodeStaging.cs");
  const confined = source("ConfinedExecMode.cs");

  // بيان الحزمة يقع في جذر النطاق الممنوح، فيتوقف بحث Node داخله.
  assert.match(staging, /ApplicationRoot = Path\.Combine\(Root, "app"\)/);
  assert.match(staging, /PackageManifestPath = Path\.Combine\(ApplicationRoot, "package\.json"\)/);
  assert.match(staging, /\{\\"type\\":\\"module\\"\}/);
  assert.match(staging, /STAGED_PACKAGE_MANIFEST/);

  // والمسار المُدرَّج للمضيف مشتق من الشجرة المُدرَّجة، لا من المستودع.
  assert.match(staging, /HostScriptPath = staged;/);

  // حلّ الوحدة الرئيسية لا يستدعي realpath: بدون هذين العلمين يستعلم المحمّل عن
  // جذر الوحدة التخزينية، وحاوية بصفر قدرات لا تملك حقًّا هناك.
  assert.match(confined, /--preserve-symlinks-main/);
  assert.match(confined, /--preserve-symlinks"/);
  assert.match(confined, /spec\.NodeStartupFlags = new string\[\]/);
  const flagsAt = confined.indexOf("spec.NodeStartupFlags");
  const commandAt = confined.indexOf("spec.CommandLine = ConfinedLauncher.BuildCommandLine");
  assert.ok(flagsAt >= 0 && flagsAt < commandAt, "the startup flags are not part of the production command line");

  // ولا NODE_PATH، ولا node_modules للمستودع داخل الحاوية.
  const all = withoutCommentsOrStrings(adapterSource());
  assert.equal(all.includes("NODE_PATH"), false, "NODE_PATH is used by the confined executor");
  assert.equal(all.includes("node_modules"), false, "a repository node_modules path reaches the confined executor");
  // ولا يُبنى مسار وحدات من جذر المستودع: المُدرَّج وحده هو ما يُطلَق.
  const plan = withoutCommentsOrStrings(source("ExecutionEnvironmentPlan.cs"));
  assert.equal(plan.includes("NODE_"), false, "a Node resolution variable is injected into the container environment");
});

test("POSITIVE CONTROL (this host, not Windows): the staged layout and startup flags produce a valid protocol response", () => {
  // ضابط تشخيصي على المضيف الحالي: يثبت أن التخطيط المُدرَّج وأعلام الإقلاع
  // يحلّان الوحدات ويُنتجان استجابة بروتوكول صحيحة. لا يثبت شيئًا عن AppContainer
  // ولا يغني عن W-12 على ويندوز — وهو مصنَّف بذلك في اسمه.
  const distRoot = join(REPOSITORY, "runtime", "dist");
  const workspace = mkdtempSync(join(tmpdir(), "polaris-w4-staged-"));
  try {
    const applicationRoot = join(workspace, "runtime-code", "app");
    const execDirectory = join(applicationRoot, "src", "exec");
    mkdirSync(execDirectory, { recursive: true });
    // إغلاق رسم الاستيراد يُحسب هنا كما يحسبه المُدرِّج، لا يُكتب قائمةً ثابتة:
    // قائمةٌ ثابتة تتعفّن بصمت عند إضافة وحدة، فيصير الضابط أخضر على تخطيط
    // ليس هو التخطيط المُدرَّج.
    const staged = new Set<string>();
    const pending = ["host-main.js"];
    while (pending.length > 0) {
      const name = pending.pop() as string;
      if (staged.has(name)) continue;
      staged.add(name);
      const text = readFileSync(join(distRoot, "src", "exec", name), "utf8");
      copyFileSync(join(distRoot, "src", "exec", name), join(execDirectory, name));
      for (const match of text.matchAll(/from\s+"\.\/([A-Za-z0-9._-]+\.js)"/g)) pending.push(match[1] as string);
    }
    assert.ok(staged.has("fs-executor.js"), "the executor module left the staged import graph");
    assert.ok(staged.has("target-object.js"), "the same-object module left the staged import graph");
    writeFileSync(join(applicationRoot, "package.json"), '{"type":"module"}\n');

    const scope = join(workspace, "mission", "scope");
    const work = join(workspace, "mission", "work");
    mkdirSync(scope, { recursive: true });
    mkdirSync(work, { recursive: true });
    const resource = join(scope, "in-scope.txt");
    writeFileSync(resource, "in-scope-content");
    // هوية الكائن كما يرصدها المُطلِق: المنفّذ يطابقها على مقبضه هو.
    const identity = statSync(resource, { bigint: true });

    const grant = {
      grant_id: "positive-control",
      correlation_id: "positive-control",
      invocation_id: "positive-control",
      decision_id: "positive-control",
      operation: "READ_FILE",
      target: {
        logical: "T:\\SCOPE\\in-scope.txt",
        host: resource,
        mode: "READ",
        identity: { volume: identity.dev.toString(), file: identity.ino.toString() },
      },
      allowed_host_roots: [scope],
      max_bytes: 262144,
      deadline_ms: 15000,
      encoding: "utf-8",
      allow_overwrite: false,
    };

    const launched = spawnSync(
      process.execPath,
      ["--preserve-symlinks-main", "--preserve-symlinks", join(execDirectory, "host-main.js")],
      { input: JSON.stringify(grant), encoding: "utf8", cwd: work, maxBuffer: 8 * 1024 * 1024 },
    );

    assert.equal(launched.status, 0, `the staged executor exited with ${String(launched.status)}: ${launched.stderr}`);
    // التحليل لا البحث النصي: الاستجابة وثيقة، وتُقرأ وثيقةً.
    const response: unknown = JSON.parse((launched.stdout ?? "").trim());
    assert.equal(typeof response === "object" && response !== null, true, "the executor produced no protocol object");
    const outcome = response as { status?: string; grant_id?: string };
    assert.equal(outcome.status, "SUCCESS", `the staged executor refused its own grant: ${launched.stdout}`);
    assert.equal(outcome.grant_id, "positive-control");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

// ── W-12: حالة كل نداء إدخال/إخراج مفحوصة ومسجَّلة ──────────────────────────

test("no WriteFile or ReadFile result is left unchecked, and every call state reaches the evidence", () => {
  const launcher = source("ConfinedLauncher.cs");
  const reader = source("PipeReader.cs");
  const confined = source("ConfinedExecMode.cs");

  // نتيجة كل نداء تُلتقط في متغيّر أو تُفحص في شرط. لا نداء مهمَل.
  for (const call of ["WriteFile", "ReadFile"]) {
    const pattern = new RegExp(String.raw`([\s\S]{0,40})NativeExtras\.` + call + String.raw`\(`, "g");
    const sources = launcher + "\n" + reader;
    let match: RegExpExecArray | null = pattern.exec(sources);
    let seen = 0;
    while (match !== null) {
      seen += 1;
      const prefix = match[1] ?? "";
      assert.match(
        prefix,
        /(?:bool\s+\w+\s*=\s*|if\s*\(\s*!?)\s*$/,
        `an unchecked NativeExtras.${call} call remains: ...${prefix.slice(-40)}`,
      );
      match = pattern.exec(sources);
    }
    assert.ok(seen > 0, `NativeExtras.${call} disappeared entirely; the audit would pass vacuously`);
  }

  // الاستئناف يُفحص: 0xFFFFFFFF إخفاق لا استئناف.
  assert.match(launcher, /ThreadResumeFailed/);
  assert.match(launcher, /previousSuspendCount == ThreadResumeFailed/);
  assert.match(launcher, /outcome\.ResumeSucceeded = true;/);

  // العدد المكتوب يُقارن بالمتوقَّع، والأنبوب المكسور يظهر.
  assert.match(launcher, /outcome\.StdinBytesWritten == outcome\.StdinBytesExpected/);
  assert.match(launcher, /StdinBrokenPipe/);
  assert.match(launcher, /ErrorBrokenPipe/);

  // نهاية الملف تُميَّز عن الخطأ في القراءة.
  assert.match(reader, /_result\.EndedAtEof = true;/);
  assert.match(reader, /_result\.Win32Error = error;/);

  // القراءة لا تُهجر على خروج مبكر: كل مجرى يُستنزَف في خيطه ثم يُنضَم إليه.
  assert.match(launcher, /outputThread\.Join\(PipeJoinMilliseconds\)/);
  assert.match(launcher, /errorThread\.Join\(PipeJoinMilliseconds\)/);

  // والاستنزاف يبدأ قبل كتابة المنحة: كتابةٌ أولًا تحجب الوالد على حمولة أكبر
  // من مخزن الأنبوب بينما يملأ الابن مخرجه، وهو تعليق متبادل لا ينكسر إلا بمهلة.
  const drainAt = launcher.indexOf("outputThread.Start()");
  const writeAt = launcher.indexOf("NativeExtras.WriteFile(");
  assert.ok(drainAt >= 0, "the output stream is no longer drained on its own thread");
  assert.ok(drainAt < writeAt, "the grant is written to stdin before the output streams are being drained");

  // والمهلة محدودة، ونتيجة الانتظار مسمّاة بحالتها.
  assert.match(launcher, /WAIT_TIMEOUT/);
  assert.match(launcher, /WAIT_FAILED/);
  assert.match(launcher, /WAIT_OBJECT_0/);
  assert.match(launcher, /GetExitCodeProcess\(processInformation\.hProcess, out exitCode\)\)/);
  assert.match(launcher, /outcome\.ExitCodeAvailable = true;/);

  // مجرى الخطأ مستقل عن البروتوكول، ومقبضه في القائمة الصريحة.
  assert.match(launcher, /startupInfo\.StartupInfo\.hStdError = stderrWrite;/);
  assert.match(launcher, /inheritable\.Add\(stderrWrite\);/);
  assert.match(launcher, /outcome\.StderrMerged = false;/);

  // والحالة كلها في الدليل بأسمائها.
  for (const field of [
    "stdin_write_success",
    "stdin_bytes_expected",
    "stdin_bytes_written",
    "stdout_read_success",
    "stdout_bytes_read",
    "stderr_merged",
    "child_exit_code",
    "resume_succeeded",
    "wait_result",
    "diagnostics",
  ]) {
    assert.ok(confined.includes(`"${field}"`), `the launch evidence lost ${field}`);
  }
});

// ── W-12: رمز خروج الابن ليس رقم خطأ Win32 ──────────────────────────────────

test("a child exit code is never reported as a Win32 API error", () => {
  const confined = source("ConfinedExecMode.cs");
  const probes = readFileSync(PROBES, "utf8");

  // الخلط الأصلي: رمز الخروج يُسند إلى حقل خطأ الواجهة.
  assert.equal(
    confined.includes("result.Win32Error = (int) allowedOutcome.ExitCode;"),
    false,
    "the child exit code is assigned to the Win32 error field again",
  );
  assert.match(confined, /result\.ChildExitCode = \(int\) allowedOutcome\.ExitCode;/);
  assert.match(confined, /result\.FailureValueSource = SourceChildExit;/);
  for (const source of ["NONE", "WIN32_API", "CHILD_EXIT_CODE"]) {
    assert.ok(confined.includes(`"${source}"`), `the failure-value taxonomy lost ${source}`);
  }
  assert.ok(confined.includes('"failure_value_source"'), "the evidence no longer names the failure value's source");
  assert.ok(confined.includes('"child_exit_code"'), "the evidence no longer carries child_exit_code");

  // والمشغّل يلتزم بالمصدر بدل أن يسمّي كل رقم win32.
  assert.match(probes, /function failureValue\(report\)/);
  assert.match(probes, /child exit code/);
  assert.equal(
    probes.includes("`${stage} (win32 ${String(report.win32_error ?? 0)}): ${why}`"),
    false,
    "the probe harness labels every blocked value as a win32 error again",
  );
});

// ── W-12: مدخل البروتوكول يُفحص قبل الكتابة، والاستجابة تُحلَّل ─────────────

test("the executor protocol payload is validated against the contract before it is written to stdin", () => {
  const confined = source("ConfinedExecMode.cs");
  const contract = source("ProtocolContract.cs");
  const builder = source("GrantBuilder.cs");

  const validateAt = confined.indexOf("allowedPayload.Validate(allowed.StdinPayload)");
  const launchAt = confined.indexOf("LaunchOutcome allowedOutcome = launcher.Launch(allowed);");
  assert.ok(validateAt >= 0, "the permitted-path payload is written without being validated");
  assert.ok(validateAt < launchAt, "the payload is validated after it was already written to the executor");
  assert.match(confined, /deniedPayload\.Validate\(denied\.StdinPayload\)/);

  // رفض العقد عيب بروتوكول مسمّى، لا نتيجة حصر.
  assert.match(contract, /PROTOCOL_PAYLOAD_CONTRACT_VIOLATION/);
  assert.match(contract, /PROTOCOL_PAYLOAD_NOT_JSON/);
  assert.match(confined, /result\.Stage = StageProtocolHandshake;/);

  // الشكل يُسجَّل بلا قيمة واحدة.
  assert.match(contract, /values_redacted/);
  assert.match(contract, /value_sha256_prefix/);
  assert.equal(
    contract.includes('json.Property("value", '),
    false,
    "the payload evidence carries raw values again",
  );

  // وما يبنيه المُطلِق هو ما يعلنه العقد: لا حقل يُخترع خارجه.
  const declared = new Set<string>();
  const knownAt = contract.indexOf("KnownMembers = new string[]");
  const knownBlock = contract.slice(knownAt, contract.indexOf("};", knownAt));
  for (const match of knownBlock.matchAll(/"([a-z0-9_]+)"/g)) declared.add(match[1] ?? "");
  const built = new Set<string>();
  const grantAt = builder.indexOf("internal static string ReadGrant");
  for (const match of builder.slice(grantAt).matchAll(/json\.(?:Property|Name)\("([a-z0-9_]+)"/g)) {
    built.add(match[1] ?? "");
  }
  // أعضاء الهدف الداخلية ليست أعضاء جذر، وتُستثنى بأسمائها لا بالتخمين.
  // ولا تُستثنى بلا فحص: العقد يفحص كلًّا منها صراحةً، وهذا ما يُثبَت هنا.
  for (const inner of ["logical", "host", "mode", "identity", "volume", "file"]) built.delete(inner);
  assert.match(contract, /targetValue\.MemberText\("logical"\)/);
  assert.match(contract, /targetValue\.MemberText\("host"\)/);
  assert.match(contract, /targetValue\.MemberText\("mode"\)/);
  assert.match(contract, /targetValue\.Member\("identity"\)/);
  assert.match(contract, /identityValue\.MemberText\("volume"\)/);
  assert.match(contract, /identityValue\.MemberText\("file"\)/);
  for (const name of built) {
    assert.ok(declared.has(name), `GrantBuilder emits ${name}, which the payload contract does not declare`);
  }
});

test("the protocol response is parsed as a document, never substring-matched", () => {
  const confined = source("ConfinedExecMode.cs");
  const reader = source("JsonReader.cs");
  const contract = source("ProtocolContract.cs");

  // البحث النصي عن الحقل لم يعد يقرّر شيئًا.
  for (const probe of ['IndexOf("\\"status\\":', 'IndexOf("\\"code\\":']) {
    assert.equal(confined.includes(probe), false, `a substring protocol check remains: ${probe}`);
  }
  assert.match(confined, /ProtocolResponse\.Parse\(allowedOutcome\.StandardOutput\)/);
  assert.match(confined, /ProtocolResponse\.Parse\(deniedOutcome\.StandardOutput\)/);
  assert.match(contract, /public bool Spoke \{ get \{ return Parsed && HasStatus; \} \}/);

  // والقارئ صارم: محتوى زائد بعد الوثيقة رفضٌ لا تسامح.
  assert.match(reader, /trailing content after the JSON document/);
  assert.match(reader, /unterminated string/);
  assert.match(reader, /a control character must be escaped in a string/);
});

// ── سلامة الدليل: الطابع الزمني لا يتبع تقويم ثقافة المضيف ──────────────────

test("evidence timestamps are written in the invariant calendar, not the host's locale calendar", () => {
  // العيب المرصود: ran_at كُتب "1448-03-22" لأن ثقافة المضيف تقويمها هجري.
  // دليل بتقويم متغيّر لا يُقارَن بين تشغيلين ولا يُقرأ ISO-8601.
  const program = source("Program.cs");
  assert.match(program, /InvariantCulture/);
  assert.equal(
    /ToString\("yyyy-MM-ddTHH:mm:ssZ"\)/.test(program),
    false,
    "the adapter writes ran_at in the host's calendar again",
  );
  for (const script of [RUNNER, join(ADAPTER, "build.ps1")]) {
    const text = readFileSync(script, "utf8");
    assert.equal(
      /ToString\("yyyy-MM-ddTHH:mm:ssZ"\)/.test(text),
      false,
      `${script} writes an evidence timestamp in the host's calendar`,
    );
    assert.match(text, /InvariantCulture/);
  }
});

test("a startup failure is classified from the executor's own diagnostics instead of being left unnamed", () => {
  const diagnosis = source("ExecutorStartupDiagnosis.cs");
  const confined = source("ConfinedExecMode.cs");

  for (const classification of [
    "NO_STARTUP_DIAGNOSTICS",
    "MODULE_RESOLUTION_ACCESS_DENIED",
    "MODULE_NOT_FOUND",
    "ESM_RESOLUTION_FAILED",
    "NATIVE_MODULE_LOAD_FAILED",
    "PROTOCOL_INPUT_REJECTED",
    "STARTUP_FAILURE_UNCLASSIFIED",
  ]) {
    assert.ok(diagnosis.includes(classification), `the startup taxonomy lost ${classification}`);
  }
  // التصنيف يقرأ مجرى الخطأ المستقل، لا مخرج البروتوكول.
  assert.match(confined, /ExecutorStartupDiagnosis\.Classify\(allowedOutcome\.StandardError\)/);
  assert.ok(confined.includes('"executor_startup_diagnosis"'), "the evidence no longer classifies the startup failure");
  // ولا يَعِد التصنيف بتوسيع صلاحية: العلاج إسقاط الحاجة لا منح الحق.
  assert.match(diagnosis, /must stop asking for it,/);
  // وكل الحالات تبقى عائقًا: التصنيف تشخيص لا حكم أمني.
  assert.equal(diagnosis.includes('"FAIL"'), false, "a startup classification was promoted to a security failure");
});

// ── W4 closure: SAME_OBJECT_VERIFY_AND_USE و RUNTIME_CODE_SCOPE بلا reparse ──

test("the read grant carries the target object identity, and the input contract requires it", () => {
  const builder = source("GrantBuilder.cs");
  const contract = source("ProtocolContract.cs");
  const confined = source("ConfinedExecMode.cs");

  // الهوية تُرصد على مقبض يفتحه المُطلِق، بواجهة موثّقة واحدة.
  const identity = source("TargetObjectIdentity.cs");
  assert.match(identity, /GetFileInformationByHandle/);
  assert.match(identity, /nFileIndexHigh/);
  assert.match(identity, /dwVolumeSerialNumber/);
  // ورقم كائن صفري ليس هوية: يُعلَن غير متاح بدل أن يمرّ تطابقًا.
  assert.match(identity, /identity\.Available = index != 0;/);

  // وتسافر في المنحة تحت target.identity.
  assert.match(builder, /json\.Name\("identity"\)\.BeginObject\(\);/);
  assert.match(builder, /json\.Property\("volume", identity\.Volume\);/);
  assert.match(builder, /json\.Property\("file", identity\.FileId\);/);

  // والعقد يشترطها في القراءة قبل أن يُكتب حرف على مدخل المنفّذ.
  assert.match(contract, /identityRequired = document\.MemberText\("operation"\) == "READ_FILE"/);
  assert.match(contract, /identityValid \|\| !identityRequired/);

  // ويُقاطَع الترميز بما تبلّغه بيئة التشغيل نفسها من داخل الحاوية.
  assert.match(confined, /target_identity_cross_check/);
  assert.match(confined, /TARGET_IDENTITY_ENCODING_DISAGREEMENT/);
  // والخلاف عيب أداة قياس: INCONCLUSIVE، ولا يُرقَّى إلى PASS.
  const disagreement = confined.indexOf("encodingDisagreement ? \"INCONCLUSIVE\"");
  assert.ok(disagreement > 0, "an identity encoding disagreement is still read as a confinement failure");
});

test("RUNTIME_CODE_SCOPE is proven reparse-free before any ACL grant and before any launch", () => {
  const scan = source("ReparseScan.cs");
  const confined = source("ConfinedExecMode.cs");

  // الفحص لا يتبع نقطة إعادة تحليل ليفحصها: سرد وسمات فقط، ولا نزول خلفها.
  assert.match(scan, /FindFirstFileW/);
  assert.match(scan, /if \(isDirectory && !isReparse\) \{ Walk\(entry, childRelative\); \}/);
  assert.equal(withoutCommentsOrStrings(scan).includes("Directory.GetFiles("), false,
    "the scan enumerates through an API that resolves entries instead of listing them");

  // المجموعة المسموحة صفر، والوسم والسمات تُسجَّلان لكل عثور.
  assert.match(scan, /json\.Property\("allowed_reparse_tags", new string\[0\]\)/);
  assert.match(scan, /json\.Property\("reparse_tag", finding\.ReparseTag\)/);
  assert.match(scan, /json\.Property\("file_attributes", finding\.FileAttributes\)/);
  assert.match(scan, /json\.Property\("classification", finding\.Classification\)/);

  // وتعذّر إثبات النظافة لا يمرّ مرور النظافة.
  assert.match(scan, /Incomplete = true;/);
  assert.match(confined, /reparse\.Incomplete \? "INCONCLUSIVE" : "BLOCKED"/);
  assert.match(confined, /ReparseScan\.ReasonPresent/);

  // والترتيب: الفحص بعد التدريج وقبل أول منح ACL وقبل أي إطلاق.
  const scanAt = confined.indexOf("reparse.Scan(staging.Root)");
  const grantAt = confined.indexOf("container.GrantReadExecuteTree(staging.Root");
  const launchAt = confined.indexOf("launcher.Launch(allowed)");
  assert.ok(scanAt > 0 && grantAt > 0 && launchAt > 0, "a stage disappeared from the confined execution path");
  assert.ok(scanAt < grantAt, "the runtime-code scope is granted an ACL before it is proven reparse-free");
  assert.ok(scanAt < launchAt, "the confined executor is launched before its code scope is proven reparse-free");
});

test("a stale build cannot be staged silently: every staged module is proven against its source", () => {
  const staging = source("RuntimeCodeStaging.cs");

  // كل ملف مُدرَّج يحمل بصمة مصدره وبصمة نسخته، والاختلاف يوقف التدريج.
  assert.match(staging, /identity\.SourceSha256 = Sha256\(source\);/);
  assert.match(staging, /identity\.StagedSha256 = Sha256\(staged\);/);
  assert.match(staging, /ReasonNotIdentical/);
  // وشجرة أوسع من إغلاق رسم الاستيراد عيب تدريج، لا تفصيل يُتسامح فيه.
  assert.match(staging, /ReasonUnexpectedFile/);

  // والمصدر نفسه يجب أن يكون مخرج بناء هذه الجولة: المشغّل يبني قبل أن يقيس.
  const runner = readFileSync(join(REPOSITORY, "tools", "w4-windows-conformance", "run.ps1"), "utf8");
  const build = runner.indexOf('"runtime: build"');
  const probes = runner.indexOf('"windows probes"');
  assert.ok(build > 0 && probes > build, "the probes stage a dist the run did not build");
});

// ── حارس سطح التصريف ────────────────────────────────────────────

/** تقسيم وسائط على فواصل المستوى الأعلى وحدها. */
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

/** نصّ ما بين قوسين متوازنين يبدآن عند openIndex. */
function betweenParentheses(code: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(openIndex + 1, i);
    }
  }
  throw new Error("an unbalanced call was found in the adapter source");
}

/**
 * REGRESSION — CS1501 في التشغيل الأصلي: تغيّر توقيع ReadGrant حين أُضيفت
 * target.identity، وبقي موضع نداء واحد بأربعة وسائط، فتوقّف البناء قبل أي
 * مسبار. الحارس يقيس المواضع كلها في كل جولة، لا موضعًا واحدًا في كل تشغيل.
 */
test("REGRESSION: every read-grant call site matches the declaration and carries a launcher-observed identity", () => {
  const builder = source("GrantBuilder.cs");

  // الإعلان: الهوية معامل أخير مطلوب، وليس اختياريًا ولا ذا قيمة افتراضية.
  const declarationAt = builder.indexOf("internal static string ReadGrant");
  assert.ok(declarationAt > 0, "GrantBuilder no longer declares ReadGrant");
  const parameters = splitArguments(betweenParentheses(builder, builder.indexOf("(", declarationAt)));
  assert.equal(parameters.length, 5, "the ReadGrant parameter list changed without this guard being updated");
  assert.match(parameters[parameters.length - 1] ?? "", /^TargetObjectIdentity\s+identity$/);
  for (const parameter of parameters) {
    assert.equal(parameter.includes("="), false, "a default value would let a call site omit the target identity");
  }

  // ومواضع النداء: كلها، في كل ملفّ محوّل، بنفس العدد وبهوية حقيقية.
  let callSites = 0;
  for (const name of readdirSync(ADAPTER).filter((entry) => entry.endsWith(".cs"))) {
    const code = source(name);
    const pattern = /GrantBuilder\.ReadGrant\s*\(/g;
    let match: RegExpExecArray | null = pattern.exec(code);
    while (match !== null) {
      callSites += 1;
      const args = splitArguments(betweenParentheses(code, match.index + match[0].length - 1));
      assert.equal(
        args.length,
        parameters.length,
        `${name} calls ReadGrant with ${String(args.length)} arguments; the declaration takes ${String(parameters.length)}`,
      );
      const identity = args[args.length - 1] ?? "";
      assert.match(identity, /^[A-Za-z_][A-Za-z0-9_]*$/, `${name} passes ${identity} as the target identity`);
      assert.match(
        code,
        new RegExp(`TargetObjectIdentity\\s+${identity}\\s*=\\s*TargetObjectIdentity\\.Of\\(`),
        `${name} passes ${identity} as the target identity without obtaining it from TargetObjectIdentity.Of`,
      );
      match = pattern.exec(code);
    }
    // ولا هوية تُصنع يدويًا: ذلك هو باب القيمة الصفرية أو المخترعة.
    if (name !== "TargetObjectIdentity.cs") {
      assert.equal(
        /new\s+TargetObjectIdentity\s*\(/.test(withoutCommentsOrStrings(code)),
        false,
        `${name} constructs a target object identity outside TargetObjectIdentity.Of`,
      );
    }
  }
  assert.ok(callSites >= 3, "a read-grant call site disappeared; the fixture and production paths are both expected");

  // والفحص الساكن يبقى حامل هذا الحارس، لأنه وحده من يسبق csc.exe على ويندوز.
  const staticCheck = readFileSync(join(ADAPTER, "static-check.mjs"), "utf8");
  assert.match(staticCheck, /the CS1501 class of defect/);
  assert.match(staticCheck, /signature\.overloads > 1 \|\| signature\.variable/);
  assert.match(staticCheck, /does not come from TargetObjectIdentity\.Of/);
  assert.match(staticCheck, /a target object identity is constructed outside TargetObjectIdentity\.Of/);
  assert.match(staticCheck, /the production read grant no longer carries target\.identity/);
});

/**
 * المنحة الناقلة في W-11 ليست استثناءً: هويتها تُرصد من نفس المسار
 * الموثوق، على الملفّ داخل النطاق نفسه الذي تحمله المنحة، وتُسجّل في الدليل.
 */
test("the X03 fixture grant carries a real identity for the very file it grants, and records it", () => {
  const x03 = source("HandleX03Mode.cs");

  assert.match(x03, /TargetObjectIdentity inScopeIdentity = TargetObjectIdentity\.Of\(inScopeFile\);/);
  const observedAt = x03.indexOf("TargetObjectIdentity.Of(inScopeFile)");
  const grantAt = x03.indexOf("GrantBuilder.ReadGrant");
  assert.ok(observedAt > 0 && grantAt > observedAt, "the fixture identity is observed after the grant is built");

  // الهوية تعود للملفّ الممنوح نفسه، لا لملفّ آخر يُرضي العقد.
  const grantArguments = splitArguments(betweenParentheses(x03, x03.indexOf("(", grantAt)));
  assert.equal(grantArguments[0], "inScopeFile");
  assert.equal(grantArguments[grantArguments.length - 1], "inScopeIdentity");

  // وتُسجّل بتوفّرها وسبب تعذّرها، فلا تُقرأ منحة بلا هوية صمتًا.
  assert.match(x03, /inScopeIdentity\.Emit\(json, "executor_read_target_identity"\);/);

  // ولا تتغيّر دلالة W-11: الحكم يبقى على الضابطين واكتمال التعداد.
  assert.match(
    x03,
    /executorClean = executorLaunched && executorScanned && executorScanComplete && outOfScope == 0;/,
  );
});
