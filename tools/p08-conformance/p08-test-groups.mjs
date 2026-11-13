// تشغيل مجموعات اختبار Phase-08 وجمع أعدادها وأسماء اختباراتها الحقيقية.
//
// آلة القراءة والحكم مستوردة كما هي من Phase-02 (قارئ TAP، وقارئ cargo، وحَكَم المجموعة، وتصنيف
// التخطّي). المرشِّحات أسماء حقيقية: وحدات `p08::...` وأسماء اختبارات التكامل. مرشِّح لا يطابق شيئًا
// يعطي مجموعة بلا اختبار، والحَكَم يرفضها.
//
// المجموعات هنا ما يُقاس بالاختبارات. ما يُقاس على الجهاز الحقيقي (الصندوق، وEdge، والنموذج،
// والمعيار، وواجهة E2E) تقيسه عُدّة القياس والمشغّل الأصلي، ويجمعهما الاشتقاق.

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { loadSkipRegistry, SKIP_REGISTRY_MODULE } from "../p02-conformance/p02-skip-classification.mjs";
import { runGroup } from "../p02-conformance/p02-test-groups.mjs";
import { argument, header, P08_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p08-common.mjs";

const CARGO = process.platform === "win32" ? "cargo.exe" : "cargo";
const core = (...filters) => [CARGO, "test", "-p", "polaris-host-core", "--", ...filters];
const coreTest = (test, ...filters) => [CARGO, "test", "-p", "polaris-host-core", "--test", test, "--", ...filters];

export const P08_TEST_GROUPS = Object.freeze([
  { id: "P08-CONTRACTS", stage: "contracts", title: "contracts: every schema, registry and envelope suite including the Phase-08 IPC 1.7 contracts", kind: "node", cwd: "contracts", command: ["node", "--test", "dist/tests/*.test.js"] },
  { id: "P08-EXECUTION", stage: "host-units", title: "execution: command classification, output sanitising, limits, runtime catalogue, workspace confinement", kind: "cargo", cwd: "desktop/host", command: core("p08::execution", "p08::workspace") },
  { id: "P08-SANDBOX", stage: "host-integration", title: "sandbox path through the agent: writes outside the workspace refused, network and installs wait for approval", kind: "cargo", cwd: "desktop/host", command: coreTest("p08_agent", "write_outside", "network_and_package") },
  { id: "P08-PYTHON", stage: "host-integration", title: "Python through the gateway: the result feeds the next turn and a verified artifact is produced", kind: "cargo", cwd: "desktop/host", command: coreTest("p08_agent", "python_runs") },
  { id: "P08-BROWSER", stage: "host-integration", title: "real browser engine: CDP, request interception, policy, page scripts, and the real Chromium path where one is installed", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p08_browser", "--lib", "--", "p08::browser", "p08_browser"] },
  { id: "P08-ARTIFACTS", stage: "host-integration", title: "artifacts: DOCX, XLSX, PPTX, PDF (Latin and Arabic), HTML, Markdown, CSV; every one re-opened and verified", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p08_artifacts", "--lib", "--", "p08::artifacts", "verifies", "pdf", "paginates"] },
  { id: "P08-FILES", stage: "host-integration", title: "attachments: staged as name and content, executables and traversal refused, fenced as untrusted for the agent", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core", "--test", "p08_ipc", "--test", "p08_agent", "--lib", "--", "p08::attachments", "attachments_stage", "fenced_as_untrusted"] },
  { id: "P08-VOICE", stage: "host-units", title: "voice: local transcription only, bounded WAV, remote endpoints refused", kind: "cargo", cwd: "desktop/host", command: core("p08::integrations::voice", "refuse_a_remote_transcriber") },
  { id: "P08-SCHEDULER", stage: "host-units", title: "scheduler: specs, next run, due ticks, approval policy never bypassed, IPC round trip", kind: "cargo", cwd: "desktop/host", command: core("p08::scheduler", "p08::missions", "p08_ipc_schedules") },
  { id: "P08-OAUTH", stage: "host-units", title: "OAuth 2.0 PKCE: S256 challenge, state check, loopback redirect, tokens in the credential store, none over IPC", kind: "cargo", cwd: "desktop/host", command: core("p08::oauth", "p08_ipc_oauth") },
  { id: "P08-CONNECTORS", stage: "host-units", title: "integrations: email fixture with header-injection refusal, local publisher after a decision, shares, skill packages, device bundles", kind: "cargo", cwd: "desktop/host", command: core("p08::integrations", "p08_ipc_artifacts", "p08_ipc_skill_packages") },
  { id: "P08-IPC", stage: "host-integration", title: "Phase-08 IPC: thirty-two named operations, closed payloads, no execution route from the renderer", kind: "cargo", cwd: "desktop/host", command: coreTest("p08_ipc") },
  { id: "P08-HOST-CORE", stage: "host-tests", title: "host core: every unit and integration suite, Phase-02 to Phase-08", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-core"] },
  { id: "P08-HOST-OTHERS", stage: "host-tests", title: "providers, the Windows port crate and the measurement harness", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host-providers", "-p", "polaris-host-win", "-p", "polaris-p08-harness"] },
  { id: "P08-HOST-BINDING", stage: "host-tests", title: "host binding with the measurement feature, including the Phase-08 E2E configuration", kind: "cargo", cwd: "desktop/host", command: [CARGO, "test", "-p", "polaris-host", "--lib", "--features", "e2e"] },
  { id: "P08-HOST-LINT", stage: "host-tests", title: "clippy over the whole host workspace (product, Windows ports, maintenance, harness), warnings denied", kind: "lint", cwd: "desktop/host", command: [CARGO, "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"] },
  { id: "P08-UX", stage: "renderer-tests", title: "renderer Phase-08: composer, attachments, mission workspace, sandboxed preview, approvals, schedules, settings search, both directions", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/p08-ui.test.js"] },
  { id: "P08-A11Y", stage: "renderer-tests", title: "accessibility: every route in Arabic and English, contrast in both themes, focus, reduced motion", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/p07-a11y.test.js"] },
  { id: "P08-RENDERER-ALL", stage: "renderer-tests", title: "renderer: every test file, Phase-01 to Phase-08", kind: "node", cwd: "desktop/renderer", command: ["node", "--test", "build-tests/tests/*.test.js"] },
  { id: "P08-TOOLS", stage: "renderer-tests", title: "Phase-08 instruments: secret scan, repository check, derivation, final gate", kind: "node", cwd: ".", command: ["node", "--test", "tools/p08-conformance/tests/p08-tools.test.mjs"] },
]);

export async function recordGroups(root, ids) {
  const path = join(root, RAW_DIRECTORY, "groups.local.json");
  const previous = readJson(path);
  const groups = previous !== null && Array.isArray(previous.groups) ? previous.groups.filter((entry) => !ids.includes(entry.group_id)) : [];
  const { registry, error: registryError } = await loadSkipRegistry(root);
  let failed = false;
  for (const id of ids) {
    const group = P08_TEST_GROUPS.find((entry) => entry.id === id);
    if (group === undefined) throw new Error(`UNKNOWN_GROUP ${id}`);
    const outcome = runGroup(root, group, registry);
    groups.push(outcome);
    const counts = outcome.counts === null ? "" : ` ${outcome.counts.passed ?? "?"}/${outcome.counts.tests ?? "?"} passed`;
    console.log(`${outcome.group_id.padEnd(20)} ${outcome.verdict.padEnd(12)}${counts} (${outcome.duration_ms} ms) ${outcome.reason}`);
    if (outcome.verdict !== "PASS") {
      failed = true;
      if (outcome.output_tail !== undefined) console.log(outcome.output_tail);
    }
  }
  groups.sort((a, b) => P08_TEST_GROUPS.findIndex((g) => g.id === a.group_id) - P08_TEST_GROUPS.findIndex((g) => g.id === b.group_id));
  writeEvidence(path, {
    ...header(P08_TOOLS.groups),
    skip_registry: { module: SKIP_REGISTRY_MODULE.replace(/\\/g, "/"), loaded: registry !== null, error: registryError },
    groups,
  });
  return failed ? 1 : 0;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const ids = process.argv.includes("--all") ? P08_TEST_GROUPS.map((group) => group.id) : process.argv.flatMap((value, index) => (process.argv[index - 1] === "--group" ? [value] : []));
  if (ids.length === 0) {
    console.error("usage: p08-test-groups.mjs --root <root> (--all | --group <id> [--group <id>])");
    process.exitCode = 2;
  } else {
    process.exitCode = await recordGroups(root, ids);
  }
}
