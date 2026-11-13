// تشغيل مجموعات اختبار Phase-07 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// آلة القراءة والحكم مستوردة كما هي من Phase-02 (قارئ TAP، وقارئ cargo، وحَكَم المجموعة،
// وتصنيف التخطّي)، كما فعلت المراحل من الرابعة إلى السادسة: قارئان لصيغة واحدة ينجرفان.
//
// المرشِّحات أسماء حقيقية: وحدات `p07::...` و`storage::...` في النواة، وأسماء اختبارات
// التكامل `p07_...`. مرشِّح لا يطابق شيئًا يعطي مجموعة بلا اختبار، والحَكَم يرفضها.
//
// الاستعمال:
//   node p07-test-groups.mjs --root D:\POLARIS --group P07-RECOVERY
//   node p07-test-groups.mjs --root D:\POLARIS --all

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { loadSkipRegistry, SKIP_REGISTRY_MODULE } from "../p02-conformance/p02-skip-classification.mjs";
import { runGroup } from "../p02-conformance/p02-test-groups.mjs";
import { argument, header, P07_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p07-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";

/** حِزم اختبار النواة كلها (الوحدات والتكامل)، مرشَّحةً بأسماء. */
const core = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--", ...filters];

export const P07_TEST_GROUPS = Object.freeze([
  {
    id: "P07-CONTRACTS",
    stage: "contracts",
    title: "contracts: every schema, registry and envelope suite, unchanged by Phase-07",
    kind: "node",
    cwd: "contracts",
    command: ["node", "--test", "dist/tests/*.test.js"],
  },
  {
    id: "P07-RECOVERY",
    stage: "host-units",
    title: "recovery: a hard-killed process, a damaged store quarantined and restored at startup, fail-closed without a backup, the instance lock",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07::recovery", "p07::integrity", "storage::lock", "p07_recovery_"),
  },
  {
    id: "P07-BACKUP",
    stage: "host-units",
    title: "backup and restore: verified backups of a running store, retention of backups, reversible restore, tampered backups refused",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07::backup", "p07::layout", "p07_backup_", "p07_restore_"),
  },
  {
    id: "P07-MIGRATION",
    stage: "host-units",
    title: "migrations: every older schema upgraded through the product with its rows, a failed step leaves the old store, schema fingerprints",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07::schema", "storage::migrations", "storage::db", "p07_migration_"),
  },
  {
    id: "P07-RETENTION",
    stage: "host-units",
    title: "retention: dry run first, only reproducible files pruned, quarantine and audit never pruned",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07::retention", "p07_retention_"),
  },
  {
    id: "P07-UPDATER",
    stage: "host-units",
    title: "secure update foundation: Ed25519 signed manifests, trusted keys only, no downgrade, artifact digest and size",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07::update", "p07_update_"),
  },
  {
    id: "P07-ENTERPRISE",
    stage: "host-units",
    title: "managed policy: narrows and never widens, names its clamp, cannot be removed by the user, locks down when invalid",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07::policy", "p06::config::resolver", "p06::config::service", "p07_policy_"),
  },
  {
    id: "P07-REDTEAM",
    stage: "host-units",
    title: "red team: resealed backups with planted triggers, newer schemas, impostor files, climbing ids, links, forged policies, closed CLI vocabulary",
    kind: "cargo",
    cwd: "desktop/host",
    command: core("p07_redteam_"),
  },
  {
    id: "P07-MAINTENANCE",
    stage: "host-units",
    title: "the maintenance executable in a separate process: verify, backup, restore refused while running, reset to quarantine, policy check",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-maint"],
  },
  {
    id: "P07-HOST-CORE",
    stage: "host-tests",
    title: "host core: every unit and every integration suite, Phase-02 to Phase-07",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-core"],
  },
  {
    id: "P07-HOST-PROVIDERS",
    stage: "host-tests",
    title: "the provider layer crate",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host-providers"],
  },
  {
    id: "P07-HOST-BINDING",
    stage: "host-tests",
    title: "host binding with the measurement feature, including the managed policy path",
    kind: "cargo",
    cwd: "desktop/host",
    command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"],
  },
  {
    id: "P07-HOST-LINT",
    stage: "host-tests",
    title: "clippy over the whole host workspace including the maintenance tool, warnings denied",
    kind: "lint",
    cwd: "desktop/host",
    command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  },
  {
    id: "P07-A11Y",
    stage: "renderer-tests",
    title: "accessibility: every route in Arabic and English, WCAG AA contrast in both themes, visible focus, reduced motion",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/p07-a11y.test.js"],
  },
  {
    id: "P07-RENDERER-ALL",
    stage: "renderer-tests",
    title: "renderer: every test file, Phase-01 to Phase-07",
    kind: "node",
    cwd: "desktop/renderer",
    command: ["node", "--test", "build-tests/tests/*.test.js"],
  },
  {
    id: "P07-TOOLS",
    stage: "renderer-tests",
    title: "Phase-07 instruments: inventory, hardening, legacy store, update fixture, derivation, final gate",
    kind: "node",
    cwd: ".",
    command: ["node", "--test", "tools/p07-conformance/tests/p07-tools.test.mjs"],
  },
]);

/** يدمج نتيجة مجموعة في سجل المجموعات الخام، ويعيد رمز خروج للمشغّل. */
export async function recordGroups(root, ids) {
  const path = join(root, RAW_DIRECTORY, "groups.local.json");
  const previous = readJson(path);
  const groups = previous !== null && Array.isArray(previous.groups) ? previous.groups.filter((entry) => !ids.includes(entry.group_id)) : [];
  const { registry, error: registryError } = await loadSkipRegistry(root);
  let failed = false;
  for (const id of ids) {
    const group = P07_TEST_GROUPS.find((entry) => entry.id === id);
    if (group === undefined) throw new Error(`UNKNOWN_GROUP ${id}`);
    const outcome = runGroup(root, group, registry);
    groups.push(outcome);
    const counts = outcome.counts === null ? "" : ` ${outcome.counts.passed ?? "?"}/${outcome.counts.tests ?? "?"} passed`;
    console.log(`${outcome.group_id.padEnd(22)} ${outcome.verdict.padEnd(12)}${counts} (${outcome.duration_ms} ms) ${outcome.reason}`);
    if (outcome.skip_classification !== undefined) {
      const s = outcome.skip_classification.summary;
      console.log(`  skipped=${s.skipped} declared_nonblocking=${s.declared_nonblocking} unexplained=${s.unexplained} blocking=${s.blocking}`);
    }
    if (outcome.verdict !== "PASS") {
      failed = true;
      if (outcome.output_tail !== undefined) console.log(outcome.output_tail);
    }
  }
  groups.sort((a, b) => P07_TEST_GROUPS.findIndex((g) => g.id === a.group_id) - P07_TEST_GROUPS.findIndex((g) => g.id === b.group_id));
  writeEvidence(path, {
    ...header(P07_TOOLS.groups, root),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all")
    ? P07_TEST_GROUPS.map((group) => group.id)
    : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p07-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
