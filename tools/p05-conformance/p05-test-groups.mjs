// تشغيل مجموعات اختبار Phase-05 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// آلة القراءة والحكم مستوردة كما هي من Phase-02 (قارئ TAP، وقارئ cargo، وحَكَم
// المجموعة، وتصنيف التخطّي)، كما فعل Phase-04: قارئان لصيغة واحدة ينجرفان.
//
// المجموعات الست عشرة التي طلبها نطاق المرحلة بأسمائها، ثم مجموعات البناء الكلّي.
// `P05-NATIVE-E2E` و`P05-SECURITY` ليستا حزمتين تُستدعيان هنا: الأولى تُقاس بإطلاق
// المنتج نفسه، والثانية فحص ساكن على المصدر وعلى الأدلة المكتوبة.
//
// الاستعمال:
//   node p05-test-groups.mjs --root D:\POLARIS --group P05-MEMORY
//   node p05-test-groups.mjs --root D:\POLARIS --all

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { loadSkipRegistry, SKIP_REGISTRY_MODULE } from "../p02-conformance/p02-skip-classification.mjs";
import { runGroup } from "../p02-conformance/p02-test-groups.mjs";
import { argument, header, P05_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p05-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";

const core = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--lib", "--", ...filters];
const agent = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--test", "p05_agent", "--", ...filters];

export const P05_TEST_GROUPS = Object.freeze([
  {
    id: "P05-CONTRACTS",
    stage: "contracts",
    title: "contracts: the Phase-05 operations, payloads, results, registry and envelope 1.5",
    kind: "node",
    cwd: "contracts",
    command: ["node", "--test", "dist/tests/p05-contracts.test.js"],
  },
  {
    id: "P05-MEMORY",
    stage: "host-units",
    title: "memory: the model, the store, retrieval, the context block, lifecycle and deletion",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p05::memory::model", "p05::memory::service", "p05::memory::retriever", "p05::memory::context"),
  },
  {
    id: "P05-MEMORY-TRUST",
    stage: "host-units",
    title: "memory is not truth: write policy, secrets, labelling, fencing, and the V4 constraints",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p05::memory::policy", "p05::secret", "p03::prompt", "storage::migrations"),
  },
  {
    id: "P05-BROWSER",
    stage: "host-units",
    title: "the browser engine, the tolerant parser, observations, sessions and the web tools",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p05::browser::engine", "p05::browser::html", "p05::browser::observation", "p05::browser::runtime", "p05::browser::tools"),
  },
  {
    id: "P05-BROWSER-SECURITY",
    stage: "host-units",
    title: "navigation policy, side-effect classification, and destinations checked at connect time",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "-p", "polaris-host-providers", "--lib", "--", "p05::browser::url_policy", "p05::browser::classify", "net::endpoint"],
  },
  {
    id: "P05-COMPUTER",
    stage: "host-units",
    title: "computer use: grants, sessions, observation, the stale guard and dispatch",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p05::computer::runtime"),
  },
  {
    id: "P05-COMPUTER-SECURITY",
    stage: "host-units",
    title: "window identity with process reuse, sensitive surfaces, password fields and closed keys",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p05::computer::port", "p05::computer::risk"),
  },
  {
    id: "P05-AGENT-INTEGRATION",
    stage: "host-integration",
    title: "the real path in process: mission, agent, skill, proposal, gateway, memory, browser, computer, evidence",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p05_agent"],
  },
  {
    id: "P05-SKILL-INTEGRATION",
    stage: "host-units",
    title: "the Phase-05 skills and tools register in the Phase-04 registry, fine-grained and bounded",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p05::skill", "p05::tooling", "p04::tool", "p04::effect", "services::host", "capabilities"),
  },
  {
    id: "P05-EVIDENCE",
    stage: "host-units",
    title: "action executed is not outcome verified: observed evidence, neutral evidence, the widening rule",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p03::runtime", "p04::evidence", "p04::gateway"),
  },
  {
    id: "P05-CANCELLATION",
    stage: "host-integration",
    title: "cancellation stops an in-flight navigation and any further desktop input",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--", "cancel"],
  },
  {
    id: "P05-APPROVAL",
    stage: "host-integration",
    title: "external side effects wait for a bound approval carrying a host-written summary",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--", "approval"],
  },
  {
    id: "P05-PERSISTENCE",
    stage: "host-integration",
    title: "the V4 store, session recovery after restart, and a deleted memory that stays deleted",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--", "restart", "storage::migrations", "p05::session", "deleted"],
  },
  {
    id: "P05-HOST-CORE",
    stage: "host-tests",
    title: "host core: every unit and every integration suite",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core"],
  },
  {
    id: "P05-HOST-BINDING",
    stage: "host-tests",
    title: "host binding with the measurement feature, including the Phase-05 probes",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"],
  },
  {
    id: "P05-HOST-LINT",
    stage: "host-tests",
    title: "clippy over the whole host workspace, warnings denied",
    kind: "lint",
    cwd: "desktop/host",
    command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  },
  {
    id: "P05-RENDERER",
    stage: "renderer-tests",
    title: "renderer: every test file, Phase-01 to Phase-05",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/*.test.js"],
  },
  {
    id: "P05-RENDERER-UI",
    stage: "renderer-tests",
    title: "renderer: the Phase-05 client, Memory and Browser & Computer screens, approvals, locales",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/p05-ui.test.js"],
  },
  {
    id: "P05-TOOLS",
    stage: "renderer-tests",
    title: "Phase-05 instruments: fixtures, evaluation, derivation, security scan",
    kind: "node",
    cwd: ".",
    command: ["node", "--test", "tools/p05-conformance/tests/p05-tools.test.mjs"],
  },
]);

/** يدمج نتيجة مجموعة في سجل المجموعات الخام، ويعيد رمز خروج للمشغّل. */
export async function recordGroups(root, ids) {
  const path = join(root, RAW_DIRECTORY, "groups.local.json");
  const previous = readJson(path);
  const groups =
    previous !== null && Array.isArray(previous.groups) ? previous.groups.filter((entry) => !ids.includes(entry.group_id)) : [];
  const { registry, error: registryError } = await loadSkipRegistry(root);
  let failed = false;
  for (const id of ids) {
    const group = P05_TEST_GROUPS.find((entry) => entry.id === id);
    if (group === undefined) throw new Error(`UNKNOWN_GROUP ${id}`);
    const outcome = runGroup(root, group, registry);
    groups.push(outcome);
    const counts = outcome.counts === null ? "" : ` ${outcome.counts.passed ?? "?"}/${outcome.counts.tests ?? "?"} passed`;
    console.log(`${outcome.group_id.padEnd(24)} ${outcome.verdict.padEnd(12)}${counts} (${outcome.duration_ms} ms) ${outcome.reason}`);
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
    (a, b) => P05_TEST_GROUPS.findIndex((g) => g.id === a.group_id) - P05_TEST_GROUPS.findIndex((g) => g.id === b.group_id),
  );
  writeEvidence(path, {
    ...header(P05_TOOLS.groups, root),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all")
    ? P05_TEST_GROUPS.map((group) => group.id)
    : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p05-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
