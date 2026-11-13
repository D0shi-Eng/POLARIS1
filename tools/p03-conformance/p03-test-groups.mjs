// تشغيل مجموعات اختبار Phase-03 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// آلة القراءة والحكم مأخوذة من Phase-02 كما هي: قارئ TAP، وقارئ cargo، وحَكَم
// المجموعة، وتصنيف التخطّي. قارئان لصيغة واحدة ينجرفان، وقد انجرفا مرة، فلا
// يُستنسخ المنطق هنا بل يُستورد.
//
// الاستعمال:
//   node p03-test-groups.mjs --root D:\POLARIS --group P03-TRUTH
//   node p03-test-groups.mjs --root D:\POLARIS --all

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { loadSkipRegistry, SKIP_REGISTRY_MODULE } from "../p02-conformance/p02-skip-classification.mjs";
import { runGroup } from "../p02-conformance/p02-test-groups.mjs";
import { argument, header, P03_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p03-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";

const core = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--lib", "--", ...filters];

/**
 * المجموعات. `kind`: node أو cargo أو lint (يُحكم عليه برمز الخروج وحده).
 * الترتيب هنا هو ترتيب المشغّل: الأسرع والأعمق اعتمادًا أولًا.
 *
 * `P03-NATIVE-E2E` ليست مجموعة تُستدعى هنا: تُقاس بإطلاق المنتج نفسه في المرحلة
 * ١٢ من المشغّل، ويشتقّ حكمها `p03-evaluate.mjs` من التقرير الذي كتبته النافذة.
 */
export const P03_TEST_GROUPS = Object.freeze([
  { id: "P03-CONTRACTS", stage: "contracts", title: "contracts: Phase-03 operations, payloads, results and registry", kind: "node", cwd: "contracts", command: ["node", "--test", "dist/tests/p03-contracts.test.js"] },
  { id: "P03-RUNTIME", stage: "runtime", title: "trusted runtime against the extended contracts", kind: "node", cwd: "runtime", command: ["node", "--test", "dist/tests/*.test.js"] },
  { id: "P03-AGENTS", stage: "host-units", title: "agent roles, capabilities and instances", kind: "cargo", cwd: "desktop/host", command: core("p03::agent") },
  { id: "P03-MISSIONS", stage: "host-units", title: "mission model, its closed state machine and the runtime clock", kind: "cargo", cwd: "desktop/host", command: core("p03::mission", "p03::clock") },
  { id: "P03-TASK-GRAPH", stage: "host-units", title: "task graph: build, cycles, ready set, dependencies, task state", kind: "cargo", cwd: "desktop/host", command: core("p03::graph", "p03::task") },
  { id: "P03-ORCHESTRATION", stage: "host-integration", title: "the mission runtime end to end: roles in order, review cycles, cancellation, determinism", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p03_dogfood"] },
  { id: "P03-BUDGETS", stage: "host-units", title: "budget ledger, loop guard and delegation bounds", kind: "cargo", cwd: "desktop/host", command: core("p03::budget", "p03::loopguard", "p03::delegation") },
  { id: "P03-TRUST", stage: "host-units", title: "authority classes, taint, prompt boundary and agent messages", kind: "cargo", cwd: "desktop/host", command: core("p03::trust", "p03::prompt", "p03::message", "p03::model_adapter") },
  { id: "P03-TRUTH", stage: "host-units", title: "claims, conflict detection and completion proof", kind: "cargo", cwd: "desktop/host", command: core("p03::claim", "p03::conflict", "p03::completion", "p03::verification") },
  { id: "P03-EVIDENCE", stage: "host-units", title: "evidence model, the trusted source and the probe runner", kind: "cargo", cwd: "desktop/host", command: core("p03::evidence", "p03::trusted_test_evidence", "p03::probe_runner") },
  { id: "P03-VERIFICATION", stage: "host-integration", title: "the trusted-evidence boundary suite: what may and may not become measured", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p03_trusted_evidence"] },
  { id: "P03-PERSISTENCE", stage: "host-integration", title: "mission persistence, recovery after restart, and the Phase-03 gateway surface", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p03_persistence", "--test", "p03_gateway"] },
  { id: "P03-HOST-CORE", stage: "host-tests", title: "host core: every unit and every integration suite", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core"] },
  { id: "P03-HOST-BINDING", stage: "host-tests", title: "host binding with the measurement feature, including the native probes", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"] },
  { id: "P03-HOST-LINT", stage: "host-tests", title: "clippy over the whole host workspace, warnings denied", kind: "lint", cwd: "desktop/host", command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"] },
  { id: "P03-RENDERER", stage: "renderer-tests", title: "renderer: every test file, Phase-01 to Phase-03", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/*.test.js"] },
  { id: "P03-RENDERER-UI", stage: "renderer-tests", title: "renderer: Phase-03 client, screens, localization, accessibility", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/p03-ui.test.js"] },
  { id: "P03-TOOLS", stage: "renderer-tests", title: "Phase-03 instruments: fixture server, evaluation, derivation, security scan", kind: "node", cwd: ".", command: ["node", "--test", "tools/p03-conformance/tests/p03-tools.test.mjs"] },
]);

/** يدمج نتيجة مجموعة في سجل المجموعات الخام، ويعيد رمز خروج للمشغّل. */
export async function recordGroups(root, ids) {
  const path = join(root, RAW_DIRECTORY, "groups.local.json");
  const previous = readJson(path);
  const groups = previous !== null && Array.isArray(previous.groups) ? previous.groups.filter((entry) => !ids.includes(entry.group_id)) : [];
  const { registry, error: registryError } = await loadSkipRegistry(root);
  let failed = false;
  for (const id of ids) {
    const group = P03_TEST_GROUPS.find((entry) => entry.id === id);
    if (group === undefined) throw new Error(`UNKNOWN_GROUP ${id}`);
    const outcome = runGroup(root, group, registry);
    groups.push(outcome);
    const counts = outcome.counts === null ? "" : ` ${outcome.counts.passed ?? "?"}/${outcome.counts.tests ?? "?"} passed`;
    console.log(`${outcome.group_id.padEnd(20)} ${outcome.verdict.padEnd(12)}${counts} (${outcome.duration_ms} ms) ${outcome.reason}`);
    // التخطّي يُطبع بأسمائه وأصنافه دائمًا، لا عند الإخفاق وحده.
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
  groups.sort(
    (a, b) => P03_TEST_GROUPS.findIndex((g) => g.id === a.group_id) - P03_TEST_GROUPS.findIndex((g) => g.id === b.group_id),
  );
  writeEvidence(path, {
    ...header(P03_TOOLS.groups, root),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all")
    ? P03_TEST_GROUPS.map((group) => group.id)
    : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p03-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
