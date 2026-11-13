// اشتقاق أدلّة Phase-07 القانونية من قياسات هذا التشغيل.
//
// يقرأ السجلات الخام (المجموعات، والجرد، والتصليب، والتحزيم، والتوقيع، والتشغيل الأصلي
// للإصدار، ومخرجات الإصدار، وفحص الأسرار، وبوابة البايتات) وبوابات المراحل السابقة،
// ويكتب الوثائق الإحدى عشرة. كل وثيقة تحمل شروطها بقياساتها، وحكمها أسوأ أحكامها.
//
// الاستعمال: node p07-derive.mjs --root <root>

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { evaluateClaim, P07_CLAIMS } from "./p07-claims.mjs";
import { argument, evidenceSuffix, header, P07_EVIDENCE, P07_TOOLS, RAW_DIRECTORY, readJson, worst, writeEvidence } from "./p07-common.mjs";

const read = (root, path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null);

/** صفوف نموذج التهديد: `| T-xx | ... | tests: a, b |`. */
export function parseThreats(markdown) {
  if (markdown === null) return [];
  const rows = [];
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*(T-\d+)\s*\|(.*)\|\s*$/.exec(line.trim());
    if (match === null) continue;
    const cells = match[2].split("|").map((c) => c.trim());
    const last = cells[cells.length - 1] ?? "";
    const tests = last.replace(/^tests:\s*/i, "").split(",").map((t) => t.replace(/`/g, "").trim()).filter((t) => t.length > 0);
    rows.push({ id: match[1], summary: cells[1] ?? "", control: cells[cells.length - 2] ?? "", tests });
  }
  return rows;
}

function folderBytes(path) {
  if (!existsSync(path)) return null;
  let sum = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    sum += entry.isDirectory() ? (folderBytes(full) ?? 0) : statSync(full).size;
  }
  return sum;
}

const MIB = 1024 * 1024;

/** القياسات المحلية بطريقتها وبالحدّ المعلن قبل التشغيل. */
export function performance(root, inputs) {
  const e2e = inputs.e2e;
  const launch = (stage) => (e2e?.launches ?? []).find((l) => l.stage === stage);
  const maint = (command, predicate = () => true) => (e2e?.maint ?? []).filter((m) => m.command === command && m.ok && predicate(m));
  const release = (inputs.packaging?.builds ?? []).find((b) => b.label === "release");
  const memory = launch("release-after-upgrade")?.memory;
  const fullVerify = maint("verify").filter((m) => m.document?.result?.integrity?.depth === "FULL");
  const rows = [
    { name: "installer_release_bytes", value: release?.bytes ?? null, unit: "bytes", budget: 40 * MIB, method: "size of the NSIS installer written to release/rc" },
    { name: "installed_release_bytes", value: e2e?.sizes?.installed_release_bytes ?? null, unit: "bytes", budget: 150 * MIB, method: "sum of the files in the owned install folder after the upgrade" },
    { name: "product_exe_bytes", value: inputs.run?.builds?.product?.bytes ?? null, unit: "bytes", budget: 40 * MIB, method: "size of target/release/polaris-desktop.exe from stage 5" },
    { name: "maintenance_exe_bytes", value: inputs.run?.builds?.maintenance?.bytes ?? null, unit: "bytes", budget: 15 * MIB, method: "size of target/release/polaris-maint.exe from stage 5" },
    { name: "renderer_dist_bytes", value: folderBytes(join(root, "desktop", "renderer", "dist")), unit: "bytes", budget: 10 * MIB, method: "sum of the files in desktop/renderer/dist" },
    { name: "cold_start_to_bootstrap_ms", value: launch("release-after-upgrade")?.measurements?.cold_start_to_bootstrap_ms ?? null, unit: "ms", budget: 15000, method: "process start to the host's bootstrap report, installed release on a migrated store" },
    { name: "legacy_upgrade_start_to_bootstrap_ms", value: launch("fixture-on-legacy-store")?.measurements?.cold_start_to_bootstrap_ms ?? null, unit: "ms", budget: 20000, method: "process start to bootstrap, including the v1→current migration and its pre-migration copy" },
    { name: "recovery_start_to_bootstrap_ms", value: launch("release-on-damaged-store")?.measurements?.cold_start_to_bootstrap_ms ?? null, unit: "ms", budget: 20000, method: "process start to bootstrap, including quarantine and restore of a damaged store" },
    { name: "working_set_after_startup_bytes", value: memory === null || memory === undefined ? null : Number(memory.host_working_set_bytes) + Number(memory.child_working_set_bytes), unit: "bytes", budget: 1536 * MIB, method: "host plus WebView2 children working sets two seconds after bootstrap" },
    { name: "backup_ms", value: maint("backup")[0]?.duration_ms ?? null, unit: "ms", budget: 30000, method: "polaris-maint backup wall time (VACUUM INTO, full check, fingerprint, digest)" },
    { name: "verify_full_ms", value: fullVerify[fullVerify.length - 1]?.duration_ms ?? null, unit: "ms", budget: 30000, method: "polaris-maint verify --full wall time" },
    { name: "restore_ms", value: maint("restore")[0]?.duration_ms ?? null, unit: "ms", budget: 30000, method: "polaris-maint restore wall time, including the pre-restore backup" },
  ];
  return rows.map((r) => ({ ...r, provenance: "LOCALLY_MEASURED" }));
}

export function loadInputs(root) {
  const raw = join(root, RAW_DIRECTORY);
  const conf = JSON.parse(read(root, "desktop/host/app/tauri.conf.json") ?? "{}");
  const migrations = read(root, "desktop/host/core/src/storage/migrations.rs") ?? "";
  const inputs = {
    run: readJson(join(raw, "run.local.json")),
    groups: readJson(join(raw, "groups.local.json"))?.groups ?? [],
    inventory: readJson(join(raw, "inventory.local.json")),
    hardening: readJson(join(raw, "hardening.local.json")),
    packaging: readJson(join(raw, "packaging.local.json")),
    signing: readJson(join(raw, "signing.local.json")),
    e2e: readJson(join(raw, "release-e2e.local.json")),
    release: readJson(join(raw, "release.local.json")),
    security: readJson(join(raw, "security.local.json")),
    bytes: readJson(join(raw, "evidence-bytes.local.json")),
    gates: Object.fromEntries(["00", "01", "02", "03", "04", "05", "06"].map((p) => [p, readJson(join(root, "evidence", `phase-${p}-final-gate.json`))])),
    threats: parseThreats(read(root, "docs/phases/PHASE-07/PHASE-07-THREAT-MODEL.md")),
    tauriRelease: JSON.parse(read(root, "desktop/host/app/tauri.release.conf.json") ?? "{}"),
    productVersion: conf.version ?? null,
    fixtureVersion: "0.0.9",
    supportedSchema: Number(/pub const SUPPORTED_VERSION: i64 = (\d+);/.exec(migrations)?.[1] ?? NaN),
    sources: {
      appCargo: read(root, "desktop/host/app/Cargo.toml"),
      registry: read(root, "desktop/host/core/src/p06/config/registry.rs"),
      update: read(root, "desktop/host/core/src/p07/update.rs"),
      platform: read(root, "desktop/host/app/src/platform.rs"),
      lib: read(root, "desktop/host/app/src/lib.rs"),
    },
  };
  inputs.performance = performance(root, inputs);
  return inputs;
}

function extrasFor(document, inputs) {
  const e2e = inputs.e2e;
  switch (document) {
    case "phase-07-run":
      return { run_started: inputs.run?.run_started ?? null, environment: inputs.run?.environment ?? null, builds: inputs.run?.builds ?? null, stages: inputs.run?.stages ?? [], groups: inputs.groups.map((g) => ({ group_id: g.group_id, verdict: g.verdict, tests: g.counts?.tests ?? null, passed: g.counts?.passed ?? null, duration_ms: g.duration_ms })) };
    case "phase-07-hardening":
      return {
        cargo: inputs.inventory?.cargo === undefined ? null : { packages: inputs.inventory.cargo.packages, classes: inputs.inventory.cargo.classes, licenses: inputs.inventory.cargo.licenses },
        npm: (inputs.inventory?.npm ?? []).map((n) => ({ directory: n.directory, present: n.present, packages: n.packages, install_scripts: n.install_scripts, shipped: n.shipped })),
        binaries: inputs.hardening?.binaries ?? [],
        webview: inputs.hardening?.webview ?? null,
        source: inputs.hardening?.source ?? null,
        profile: inputs.hardening?.profile ?? null,
        acl: e2e?.acl ?? null,
      };
    case "phase-07-recovery":
      return { legacy_store: e2e?.steps?.legacy_store ?? null, legacy_upgrade: e2e?.steps?.legacy_upgrade ?? null, recovery: e2e?.steps?.recovery ?? null, restore: e2e?.steps?.restore ?? null };
    case "phase-07-packaging":
      return { builds: inputs.packaging?.builds ?? [], signing: inputs.signing ?? null, install: e2e?.steps?.install_fixture ?? null, upgrade: e2e?.steps?.upgrade ?? null, uninstall: e2e?.steps?.uninstall ?? null, release_artifacts: inputs.release ?? null };
    case "phase-07-updater":
      return { cross_implementation: e2e?.steps?.update ?? null, note: "the TEST key is generated for this run and never trusted by the product; no release key exists yet" };
    case "phase-07-enterprise":
      return { installed_tool: e2e?.steps?.policy ?? null, policy_path: "%ProgramData%\\POLARIS\\policy\\managed-policy.json", note: "machine-level placement needs an administrator and is not exercised natively here; the policy path, parsing and clamping are measured by the in-process suites and the installed tool" };
    case "phase-07-platform":
      return { platform: inputs.inventory?.platform ?? null };
    case "phase-07-security":
      return { threats: inputs.threats, network: inputs.inventory?.network ?? null, secret_scan: inputs.security ?? null };
    case "phase-07-release-e2e":
      return { blocked: e2e?.blocked ?? null, launches: e2e?.launches ?? [], before: e2e?.before ?? null, after: e2e?.after ?? null, sizes: e2e?.sizes ?? null, maint_commands: (e2e?.maint ?? []).map((m) => ({ command: m.command, exit_code: m.exit_code, ok: m.ok, code: m.code, duration_ms: m.duration_ms })), reason_codes: e2e?.reason_codes ?? [] };
    case "phase-07-performance":
      return { provenance: "LOCALLY_MEASURED", note: "this machine, this run; budgets were declared in tools/p07-conformance/p07-derive.mjs before the run; no comparison with any other product is made or implied", measurements: inputs.performance };
    case "phase-07-regression":
      return { regression_mode: inputs.run?.regression_mode ?? "RERUN", run_started: inputs.run?.run_started ?? null, gates: Object.entries(inputs.gates).map(([p, g]) => ({ phase: `PHASE-${p}`, verdict: g?.verdict ?? null, decided_at: g?.decided_at ?? g?.measured_at ?? null })), phase06_runner_exit: inputs.run?.phase06_runner_exit ?? null };
    default:
      return {};
  }
}

export function derive(root) {
  const inputs = loadInputs(root);
  const suffix = evidenceSuffix();
  const written = [];
  for (const document of P07_EVIDENCE) {
    const claims = P07_CLAIMS.filter((c) => c.document === document).map((claim) => ({ document, claim_id: claim.id, condition: claim.condition, ...evaluateClaim(inputs, claim) }));
    const body = { ...header(P07_TOOLS.derive, root), document, verdict: worst(claims.map((c) => c.verdict)), conditions: claims.length, claims, ...extrasFor(document, inputs) };
    writeEvidence(join(root, "evidence", `${document}${suffix}.json`), body);
    written.push({ document, verdict: body.verdict, conditions: claims.length });
  }
  return written;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  for (const row of derive(root)) console.log(`${row.verdict.padEnd(13)} ${row.document} (${row.conditions} condition(s))`);
}
