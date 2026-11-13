// تشغيل مجموعات اختبار Phase-04 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// آلة القراءة والحكم مستوردة كما هي من Phase-02: قارئ TAP، وقارئ cargo، وحَكَم
// المجموعة، وتصنيف التخطّي. قارئان لصيغة واحدة ينجرفان، وقد انجرفا مرة، فلا
// يُستنسخ المنطق هنا.
//
// الاستعمال:
//   node p04-test-groups.mjs --root D:\POLARIS --group P04-MCP
//   node p04-test-groups.mjs --root D:\POLARIS --all

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { loadSkipRegistry, SKIP_REGISTRY_MODULE } from "../p02-conformance/p02-skip-classification.mjs";
import { runGroup } from "../p02-conformance/p02-test-groups.mjs";
import { argument, header, P04_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p04-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";

const core = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--lib", "--", ...filters];

/**
 * المجموعات. `kind`: node أو cargo أو lint (يُحكم عليه برمز الخروج وحده).
 *
 * `P04-NATIVE-E2E` ليست مجموعة تُستدعى هنا: تُقاس بإطلاق المنتج نفسه، ويشتقّ
 * حكمها `p04-evaluate.mjs` من التقرير الذي كتبته النافذة. و`P04-SECURITY`
 * كذلك: فحصها ساكن على المصدر، لا حزمة اختبارات.
 */
export const P04_TEST_GROUPS = Object.freeze([
  {
    id: "P04-CONTRACTS",
    stage: "contracts",
    title: "contracts: the Phase-04 operations, payloads, results and registry",
    kind: "node",
    cwd: "contracts",
    command: ["node", "--test", "dist/tests/p04-contracts.test.js"],
  },
  {
    id: "P04-SKILLS",
    stage: "host-units",
    title: "skills: the closed descriptor, the built-in set, and what a skill cannot widen",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::skill"),
  },
  {
    id: "P04-TOOLS",
    stage: "host-units",
    title: "the tool registry, the effect taxonomy and the built-in adapters",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::tool", "p04::effect", "p04::builtin", "p04::proposal"),
  },
  {
    id: "P04-TOOL-GATEWAY",
    stage: "host-integration",
    title: "the gateway as the single path, and its boundary surface",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p04_gateway"],
  },
  {
    id: "P04-MCP",
    stage: "host-integration",
    title: "MCP over loopback: discovery, refusal, hostile metadata, timeout, drift",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p04_mcp"],
  },
  {
    id: "P04-AGENT-TOOLS",
    stage: "host-integration",
    title: "the real path: mission, agent, skill, proposal, gateway, result, evidence",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p04_tools"],
  },
  {
    id: "P04-APPROVAL",
    stage: "host-units",
    title: "approval binding, single use, expiry and every refusal it can produce",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::approval", "p04::budget"),
  },
  {
    id: "P04-EVIDENCE",
    stage: "host-units",
    title: "tool evidence: measured, typed, and unable to satisfy a test requirement",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::evidence", "p04::activity", "p04::view"),
  },
  {
    id: "P04-CANCELLATION",
    stage: "host-units",
    title: "cancellation reaches the gateway, the adapter and the next scheduling decision",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::gateway", "p04::broker"),
  },
  {
    id: "P04-DELEGATION",
    stage: "host-integration",
    title: "delegation and the agent message path measured inside a mission",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p03::delegation", "p03::message"),
  },
  {
    id: "P04-TRUST",
    stage: "host-units",
    title: "trust classification of tool output and MCP content, and schema sanitisation",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::mcp::sanitize", "p04::mcp::discovery", "p04::mcp::client", "p04::mcp::adapter", "p04::mcp::model", "p04::adapter"),
  },
  {
    id: "P04-PERSISTENCE",
    stage: "host-integration",
    title: "the Phase-04 store, the v3 migration, and what a restart must not turn into success",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p04::repository", "p04::service", "storage::migrations"),
  },
  {
    id: "P04-HOST-CORE",
    stage: "host-tests",
    title: "host core: every unit and every integration suite",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core"],
  },
  {
    id: "P04-HOST-BINDING",
    stage: "host-tests",
    title: "host binding with the measurement feature, including the Phase-04 probes",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"],
  },
  {
    id: "P04-HOST-LINT",
    stage: "host-tests",
    title: "clippy over the whole host workspace, warnings denied",
    kind: "lint",
    cwd: "desktop/host",
    command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  },
  {
    id: "P04-RENDERER",
    stage: "renderer-tests",
    title: "renderer: every test file, Phase-01 to Phase-04",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/*.test.js"],
  },
  {
    id: "P04-RENDERER-UI",
    stage: "renderer-tests",
    title: "renderer: the Phase-04 client, screens, closed vocabularies and accessibility",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/p04-ui.test.js"],
  },
  {
    id: "P04-TOOLING",
    stage: "renderer-tests",
    title: "Phase-04 instruments: fixtures, evaluation, derivation, security scan",
    kind: "node",
    cwd: ".",
    command: ["node", "--test", "tools/p04-conformance/tests/p04-tools.test.mjs"],
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
    const group = P04_TEST_GROUPS.find((entry) => entry.id === id);
    if (group === undefined) throw new Error(`UNKNOWN_GROUP ${id}`);
    const outcome = runGroup(root, group, registry);
    groups.push(outcome);
    const counts = outcome.counts === null ? "" : ` ${outcome.counts.passed ?? "?"}/${outcome.counts.tests ?? "?"} passed`;
    console.log(`${outcome.group_id.padEnd(20)} ${outcome.verdict.padEnd(12)}${counts} (${outcome.duration_ms} ms) ${outcome.reason}`);
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
    (a, b) => P04_TEST_GROUPS.findIndex((g) => g.id === a.group_id) - P04_TEST_GROUPS.findIndex((g) => g.id === b.group_id),
  );
  writeEvidence(path, {
    ...header(P04_TOOLS.groups, root),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all")
    ? P04_TEST_GROUPS.map((group) => group.id)
    : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p04-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
