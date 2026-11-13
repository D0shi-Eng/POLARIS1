// تشغيل مجموعات اختبار Phase-06 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// آلة القراءة والحكم مستوردة كما هي من Phase-02 (قارئ TAP، وقارئ cargo، وحَكَم المجموعة،
// وتصنيف التخطّي)، كما فعل Phase-04 وPhase-05: قارئان لصيغة واحدة ينجرفان.
//
// المجموعات السبع عشرة التي طلبها نطاق المرحلة بأسمائها، ثم مجموعات البناء الكلّي.
// `P06-NATIVE-E2E` ليست حزمة تُستدعى هنا: تُقاس بإطلاق المنتج نفسه مرّتين.
//
// المرشِّحات أسماء حقيقية: وحدات `p06::...` في النواة، وأسماء اختبارات التكامل `p06_...`.
// مرشِّح لا يطابق شيئًا يعطي مجموعة بلا اختبار، والحَكَم يرفضها — فالخطأ الإملائي لا يمرّ.
//
// الاستعمال:
//   node p06-test-groups.mjs --root D:\POLARIS --group P06-CONNECTORS
//   node p06-test-groups.mjs --root D:\POLARIS --all

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { loadSkipRegistry, SKIP_REGISTRY_MODULE } from "../p02-conformance/p02-skip-classification.mjs";
import { runGroup } from "../p02-conformance/p02-test-groups.mjs";
import { argument, header, P06_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p06-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";

/** كل حِزم اختبار النواة (الوحدات والتكامل)، مرشَّحةً بأسماء. */
const core = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--", ...filters];

export const P06_TEST_GROUPS = Object.freeze([
  {
    id: "P06-CONTRACTS",
    stage: "contracts",
    title: "contracts: the Phase-06 operations, payloads, results, registry and envelope 1.6",
    kind: "node",
    cwd: "contracts",
    command: ["node", "--test", "dist/tests/p06-contracts.test.js"],
  },
  {
    id: "P06-CONNECTORS",
    stage: "host-units",
    title: "connectors: the model, the store, OpenAPI proposals, registration disabled first, the workspace connector",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::connector::model", "p06::connector::store", "p06::connector::openapi", "p06_connectors_", "p06_every_phase06_operation"),
  },
  {
    id: "P06-CONNECTOR-SECURITY",
    stage: "host-units",
    title: "connector security: no URL, path or header from an agent, no redirect, bounded bodies, injected content stays data",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::connector::rest", "p06_connector_security_"),
  },
  {
    id: "P06-CONNECTOR-AUTH",
    stage: "host-units",
    title: "connector auth: secret references only, the credential store, the environment prefix, no value to the renderer",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::connector::secrets", "p06_connector_auth_"),
  },
  {
    id: "P06-CONNECTOR-GATEWAY",
    stage: "host-units",
    title: "the connector gateway: idempotency, the rate limiter, Retry-After, safe retries only, cancellation, policy before any request",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::connector::idempotency", "p06::connector::ratelimit", "p06::connector::tool", "p06_connector_gateway_", "p06_connector_policy_"),
  },
  {
    id: "P06-COST",
    stage: "host-units",
    title: "cost: provenance, no built-in price, the ledger keeps currencies and provenances apart",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::cost::model", "p06::cost::pricing", "p06::cost::ledger", "p06_cost_"),
  },
  {
    id: "P06-BUDGETS",
    stage: "host-units",
    title: "budgets: hard and soft, per mission, project, day, provider and connector, and the model call guard",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::cost::budget", "p06::cost::guard", "p06_budgets_"),
  },
  {
    id: "P06-OBSERVABILITY",
    stage: "host-units",
    title: "observability: structured events, bounded metrics, error aggregation, alerts, redaction, diagnostics",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::observe::event", "p06::observe::metrics", "p06::observe::alerts", "p06::observe::redact", "p06::observe::tests", "p06_observability_", "p06_diagnostics_"),
  },
  {
    id: "P06-HEALTH",
    stage: "host-units",
    title: "health: unknown until measured in this session, overall state, per-subject records",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::observe::health", "p06_health_"),
  },
  {
    id: "P06-SETTINGS",
    stage: "host-units",
    title: "settings: the catalogue, typed values, versioned persistence failing closed, writes with audit, and settings that take effect",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::config::model", "p06::config::registry", "p06::config::store", "p06::config::service", "p06::ipc", "p06_settings_"),
  },
  {
    id: "P06-EFFECTIVE-CONFIG",
    stage: "host-units",
    title: "effective config: defaults, user, project, mission, then security clamps, with a source for every value",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06::config::resolver", "p06_effective_config_"),
  },
  {
    id: "P06-PRIVACY",
    stage: "host-integration",
    title: "privacy settings are effective: local only, remote models, connector egress, browser internet, persistence",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06_privacy_", "p06_connector_policy_", "p06::cost::guard::tests::a_remote_model_call"),
  },
  {
    id: "P06-AGENT-INTEGRATION",
    stage: "host-integration",
    title: "the real path in process: mission, agent, skill, proposal, tool gateway, connector gateway, evidence, memory, usage",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p06_agent"],
  },
  {
    id: "P06-PERSISTENCE",
    stage: "host-integration",
    title: "the V5 store, restart persistence, interrupted calls recovered as outcome unknown, a newer config schema failing closed",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06_persistence_", "storage::migrations"),
  },
  {
    id: "P06-SECURITY",
    stage: "host-integration",
    title: "security: the credential canary never reaches the store, events, evidence or diagnostics; secret scanning; redaction",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p06_connector_security_the_credential", "p06::observe::redact", "p05::secret", "p06_diagnostics_"),
  },
  {
    id: "P06-HOST-CORE",
    stage: "host-tests",
    title: "host core: every unit and every integration suite, Phase-02 to Phase-06",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core"],
  },
  {
    id: "P06-HOST-BINDING",
    stage: "host-tests",
    title: "host binding with the measurement feature, including the Phase-06 probes and the E2E configuration",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"],
  },
  {
    id: "P06-HOST-LINT",
    stage: "host-tests",
    title: "clippy over the whole host workspace, warnings denied",
    kind: "lint",
    cwd: "desktop/host",
    command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  },
  {
    id: "P06-RENDERER",
    stage: "renderer-tests",
    title: "renderer: the Phase-06 client, Connectors, the settings control plane, observability screens, approvals, locales",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/p06-ui.test.js"],
  },
  {
    id: "P06-RENDERER-ALL",
    stage: "renderer-tests",
    title: "renderer: every test file, Phase-01 to Phase-06",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/*.test.js"],
  },
  {
    id: "P06-TOOLS",
    stage: "renderer-tests",
    title: "Phase-06 instruments: fixtures, evaluation, derivation, security scan, final gate",
    kind: "node",
    cwd: ".",
    command: ["node", "--test", "tools/p06-conformance/tests/p06-tools.test.mjs"],
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
    const group = P06_TEST_GROUPS.find((entry) => entry.id === id);
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
    (a, b) => P06_TEST_GROUPS.findIndex((g) => g.id === a.group_id) - P06_TEST_GROUPS.findIndex((g) => g.id === b.group_id),
  );
  writeEvidence(path, {
    ...header(P06_TOOLS.groups, root),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all")
    ? P06_TEST_GROUPS.map((group) => group.id)
    : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p06-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
