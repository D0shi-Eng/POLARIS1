// تشغيل مجموعات اختبار Phase-02 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// الأعداد تُقرأ من مخرَج المشغّل نفسه (TAP من node، وسطور `test … ok` من cargo).
// الاسم مهم: ادعاءات البوابة تُربط بأسماء اختبارات، فاختبار غائب يعني ادعاءً بلا
// قياس، لا ادعاءً ناجحًا. المجموعة التي لا يُفهم مخرَجها INCONCLUSIVE.
//
// الاستعمال:
//   node p02-test-groups.mjs --root D:\POLARIS --group P02-PROVIDERS
//   node p02-test-groups.mjs --root D:\POLARIS --all

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { childEnvironment, nodeInvocation, parseCargoSummary, parseTapSummary } from "../p01-conformance/p01-test-groups.mjs";
import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { parseTapResults } from "../w6-conformance/w6-tap.mjs";
import { classifySkips, loadSkipRegistry, SKIP_REGISTRY_MODULE } from "./p02-skip-classification.mjs";
import { argument, header, P02_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p02-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";

/**
 * المجموعات. `kind`: node أو cargo أو lint (يُحكم عليه برمز الخروج وحده).
 * الترتيب هنا هو ترتيب المشغّل: الأسرع والأعمق اعتمادًا أولًا.
 */
export const P02_GROUPS = Object.freeze([
  { id: "P02-CONTRACTS", stage: "contracts", title: "contracts: the whole suite, Phase-00 to Phase-02", kind: "node", cwd: "contracts", command: ["node", "--test", "dist/tests/*.test.js"] },
  { id: "P02-CONTRACTS-P02", stage: "contracts", title: "contracts: Phase-02 operations, payloads and registry", kind: "node", cwd: "contracts", command: ["node", "--test", "dist/tests/p02-contracts.test.js"] },
  { id: "P02-RUNTIME", stage: "runtime", title: "trusted runtime (Phase-00) against the extended contracts", kind: "node", cwd: "runtime", command: ["node", "--test", "dist/tests/*.test.js"] },
  { id: "P02-PROVIDERS", stage: "providers", title: "provider adapters, HTTP client, endpoint policy, errors, secrets", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-providers"] },
  { id: "P02-PROJECT-DB", stage: "projects", title: "project store: migrations, versioning, archive, workspace, audit chain", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--lib", "--", "p02::projects", "storage::", "audit::"] },
  { id: "P02-CONTEXT", stage: "context", title: "context engine: scope, classification, budgets, assembly, preview, prompt boundary", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--lib", "--", "p02::context"] },
  { id: "P02-HOST-CORE", stage: "host-tests", title: "host core: every unit, Phase-01 gateway and Phase-02 gateway", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core"] },
  { id: "P02-HOST-BINDING", stage: "host-tests", title: "host binding with the measurement feature", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"] },
  { id: "P02-HOST-LINT", stage: "host-tests", title: "clippy over the whole host workspace, warnings denied", kind: "lint", cwd: "desktop/host", command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"] },
  { id: "P02-RENDERER", stage: "renderer-tests", title: "renderer: every test file, Phase-01 and Phase-02", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/*.test.js"] },
  { id: "P02-RENDERER-UI", stage: "renderer-tests", title: "renderer: Phase-02 client, routes, screens, localization, accessibility", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/p02-ui.test.js"] },
  { id: "P02-TOOLS", stage: "renderer-tests", title: "Phase-02 instruments: fixture server, security scan, derivation", kind: "node", cwd: ".", command: ["node", "--test", "tools/p02-conformance/tests/p02-tools.test.mjs"] },
]);

/** أسماء اختبارات cargo ونتائجها، من سطور `test name ... ok`. */
export function parseCargoTests(output) {
  const tests = [];
  for (const match of output.replace(/\r\n?/g, "\n").matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)\s*$/gm)) {
    tests.push({ name: match[1], status: match[2] === "ok" ? "PASS" : match[2] === "FAILED" ? "FAIL" : "SKIPPED" });
  }
  return tests;
}

/**
 * أسماء اختبارات TAP ونتائجها وسبب تخطّيها.
 *
 * القراءة تُفوَّض إلى قارئ W6 المُجمَّد بدل تكرار لهجة TAP هنا: قارئان لصيغة
 * واحدة ينجرفان، وقد انجرفا فعلًا — كان القارئ المحلي يلتقط وجود التوجيه
 * `# SKIP` ثم يُسقِط نصّه، فيصل الحَكَم بلا السبب الذي يحكم بغيابه.
 */
export function parseTapTests(output) {
  return parseTapResults(output).map((result) => {
    // TODO يبقى محسوبًا متخطّيًا في هذا السجل كما كان: اختبار مؤجَّل ادعاء بلا
    // قياس، وحَكَم المجموعات الأمنية يقرأ هذا الحقل. تمييزه يُحفَظ في `directive`.
    const status = result.skipped || result.todo ? "SKIPPED" : result.failed ? "FAIL" : "PASS";
    if (status !== "SKIPPED") return { name: result.name, status };
    return { name: result.name, status, directive: result.todo ? "TODO" : "SKIP", reason: result.directive_reason };
  });
}

/**
 * حكم المجموعة.
 *
 * التخطّي: العدد وحده لا يحكم، ولا يُقبل لمجرّد أن الإخفاقات صفر. مجموعة Node
 * تُقابَل تخطّياتها بالسجل المُجمَّد في طبقة التشغيل (W6-K)، فتُقبل المُعلنة غير
 * المانعة وتُردّ المجهولة والأمنية والمانعة. مجموعة cargo تبقى على الحكم
 * السابق: `ignored` يصل بلا نصّ سبب فلا يُقابَل بإعلان، ويبقى تخطّيًا غير مفسَّر.
 */
export function verdictFor(kind, counts, exitCode, tests = [], registry = null) {
  if (kind === "lint") return exitCode === 0 ? { verdict: "PASS", reason: "" } : { verdict: "FAIL", reason: `NON_ZERO_EXIT_${exitCode}` };
  if (counts.tests === null) return { verdict: "INCONCLUSIVE", reason: "OUTPUT_NOT_PARSED" };
  if (counts.failed !== null && counts.failed > 0) return { verdict: "FAIL", reason: "TESTS_FAILED" };
  if (exitCode !== 0) return { verdict: "FAIL", reason: `NON_ZERO_EXIT_${exitCode}` };
  if (counts.tests === 0) return { verdict: "INCONCLUSIVE", reason: "NO_TEST_RAN" };
  const observed = tests.filter((test) => test.status === "SKIPPED");
  const reported = (counts.skipped ?? 0) + (counts.todo ?? 0);
  if (reported > 0 || observed.length > 0) {
    if (kind !== "node") return { verdict: "INCONCLUSIVE", reason: "UNEXPLAINED_SKIP" };
    const classification = classifySkips(observed, counts.skipped === null ? null : reported, registry);
    return {
      verdict: classification.verdict,
      reason: classification.reason,
      skip_classification: { summary: classification.summary, skips: classification.records },
    };
  }
  return { verdict: "PASS", reason: "" };
}

function withoutNodePath(env) {
  const copy = { ...env };
  delete copy.NODE_PATH;
  return copy;
}

export function runGroup(root, group, registry = null) {
  const started = Date.now();
  const { command, args } =
    group.kind === "node" ? nodeInvocation(group) : { command: group.command[0], args: group.command.slice(1) };
  const result = spawnSync(command, args, {
    cwd: join(root, group.cwd),
    encoding: "utf8",
    shell: false,
    maxBuffer: 128 * 1024 * 1024,
    // اختبارات Phase-00 تفحص تلوّث حلّ الحزم؛ NODE_PATH من الصدفة ليس من المستودع.
    env: withoutNodePath(childEnvironment(process.env)),
  });
  const duration = Date.now() - started;
  if (result.error) {
    return { group_id: group.id, stage: group.stage, title: group.title, command: [command, ...args].join(" "), verdict: "BLOCKED", reason: `SPAWN_FAILED_${result.error.code ?? "UNKNOWN"}`, counts: null, tests: [], duration_ms: duration };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const counts = group.kind === "cargo" ? parseCargoSummary(output) : group.kind === "node" ? parseTapSummary(output) : { tests: null };
  const tests = group.kind === "cargo" ? parseCargoTests(output) : group.kind === "node" ? parseTapTests(output) : [];
  const derived = verdictFor(group.kind, counts, result.status, tests, registry);
  const tail = output.split("\n").filter((line) => line.trim() !== "").slice(-40).join("\n");
  return {
    group_id: group.id,
    stage: group.stage,
    title: group.title,
    kind: group.kind,
    command: [group.command[0], ...args].join(" "),
    exit_code: result.status,
    counts: group.kind === "lint" ? null : counts,
    tests,
    duration_ms: duration,
    ...derived,
    ...(derived.verdict === "PASS" ? {} : { output_tail: tail }),
  };
}

/** يدمج نتيجة مجموعة في سجل المجموعات الخام، ويعيد رمز خروج للمشغّل. */
export async function recordGroups(root, ids) {
  const path = join(root, RAW_DIRECTORY, "groups.local.json");
  const previous = readJson(path);
  const groups = previous !== null && Array.isArray(previous.groups) ? previous.groups.filter((entry) => !ids.includes(entry.group_id)) : [];
  // السجل يُحمَّل مرة واحدة من البناء نفسه. تعذُّر تحميله لا يُسقِط التشغيل هنا:
  // يُسقِط حكم أي مجموعة تُظهر تخطّيًا، وهو الموضع الوحيد الذي يلزم فيه.
  const { registry, error: registryError } = await loadSkipRegistry(root);
  let failed = false;
  for (const id of ids) {
    const group = P02_GROUPS.find((entry) => entry.id === id);
    if (group === undefined) throw new Error(`UNKNOWN_GROUP ${id}`);
    const outcome = runGroup(root, group, registry);
    groups.push(outcome);
    const counts = outcome.counts === null ? "" : ` ${outcome.counts.passed ?? "?"}/${outcome.counts.tests ?? "?"} passed`;
    console.log(`${outcome.group_id.padEnd(20)} ${outcome.verdict.padEnd(12)}${counts} (${outcome.duration_ms} ms) ${outcome.reason}`);
    // التخطّي يُطبع بأسمائه وأصنافه دائمًا، لا عند الإخفاق وحده: رقمٌ مخفيّ خلف
    // حكم أخضر هو ما جعل هذه الثغرة ممكنة في المقام الأول.
    if (outcome.skip_classification !== undefined) {
      const s = outcome.skip_classification.summary;
      console.log(`  skipped=${s.skipped} declared_nonblocking=${s.declared_nonblocking} unexplained=${s.unexplained} blocking=${s.blocking}`);
      for (const skip of outcome.skip_classification.skips) {
        console.log(`  [${skip.class}] ${skip.test_name} - ${skip.reason}${skip.claim_owner === "" ? "" : ` (claim carried by ${skip.claim_owner})`}`);
      }
    }
    if (outcome.verdict !== "PASS") {
      failed = true;
      if (outcome.output_tail !== undefined) console.log(outcome.output_tail);
    }
  }
  groups.sort((a, b) => P02_GROUPS.findIndex((g) => g.id === a.group_id) - P02_GROUPS.findIndex((g) => g.id === b.group_id));
  writeEvidence(path, {
    ...header(P02_TOOLS.groups, root),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all")
    ? P02_GROUPS.map((group) => group.id)
    : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p02-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
