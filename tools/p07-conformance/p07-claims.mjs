// شروط البوابة النهائية لـPhase-07، وكل شرط مربوط بقياسه.
//
// كل شرط دالّة تقرأ المدخلات المقيسة في هذا التشغيل (سجل المجموعات بأسماء اختباراتها،
// والجرد، والتصليب، والتحزيم، والتوقيع، والتشغيل الأصلي للإصدار، وبوابات المراحل
// السابقة) وتعيد قياساتها. حكم الشرط أسوأ أحكام قياساته. لا يُكتب PASS بيد، وقياس
// غائب NOT_TESTED.

import { measure, verdictOf, worst } from "./p07-common.mjs";

// ——— مساعدات القراءة

export function groupOf(inputs, id) {
  return (inputs.groups ?? []).find((g) => g.group_id === id) ?? null;
}

/** حكم مجموعة كاملة، بعدد اختبارات أدنى. */
export function groupMeasure(inputs, id, minimum = 1) {
  const group = groupOf(inputs, id);
  if (group === null) return measure(`group ${id}`, "NOT_TESTED", `${id} did not run`);
  const tests = group.counts?.tests ?? null;
  if (group.verdict !== "PASS") return measure(`group ${id}`, group.verdict, `${id} ${group.verdict} ${group.reason ?? ""}`.trim());
  if (group.kind !== "lint" && (tests === null || tests < minimum)) return measure(`group ${id}`, "FAIL", `${id} ran ${tests} test(s), fewer than ${minimum}`);
  return measure(`group ${id}`, "PASS", group.kind === "lint" ? `${id} PASS` : `${id} PASS (${group.counts.passed}/${tests})`);
}

/** اختبار بعينه في مجموعة: غيابه NOT_TESTED، وفشله FAIL. */
export function testMeasure(inputs, id, name) {
  const group = groupOf(inputs, id);
  if (group === null) return measure(`${id} :: ${name}`, "NOT_TESTED", `${id} did not run`);
  const found = (group.tests ?? []).filter((t) => t.name === name || t.name.endsWith(`::${name}`) || t.name.startsWith(`${name} `) || t.name === name.trim());
  if (found.length === 0) return measure(`${id} :: ${name}`, "NOT_TESTED", "the test is not in the group's output");
  const failed = found.filter((t) => t.status !== "PASS");
  return measure(`${id} :: ${name}`, failed.length === 0 ? "PASS" : "FAIL", failed.length === 0 ? `${found.length} test(s)` : `${failed.length} did not pass`);
}

function check(requirement, measured, satisfied, detail) {
  return measure(requirement, verdictOf(measured, satisfied), detail);
}

const launches = (inputs) => inputs.e2e?.launches ?? [];
const steps = (inputs) => inputs.e2e?.steps ?? {};

// ——— الشروط

export const P07_CLAIMS = Object.freeze([
  // ── التشغيل
  {
    id: "P07-Q1",
    document: "phase-07-run",
    condition: "every stage that builds or verifies ran and succeeded: contracts, runtime, renderer, product, measurement and maintenance binaries, installers",
    evaluate(inputs) {
      const stages = inputs.run?.stages ?? [];
      const required = ["2 contracts", "3 runtime", "4 renderer", "5 host build", "8 packaging"];
      return required.map((prefix) => {
        const stage = stages.find((s) => String(s.name).startsWith(prefix));
        return check(`stage ${prefix}`, stage !== undefined && stage.exit_code !== -1, stage?.exit_code === 0, stage === undefined ? "not run" : `exit ${stage.exit_code}`);
      });
    },
  },
  {
    id: "P07-Q2",
    document: "phase-07-run",
    condition: "every Phase-07 group and the full host, provider, binding, lint, renderer and contracts suites pass, with their tests counted and no unexplained skip",
    evaluate(inputs) {
      return [
        ["P07-RECOVERY", 5], ["P07-BACKUP", 5], ["P07-MIGRATION", 5], ["P07-RETENTION", 2], ["P07-UPDATER", 6], ["P07-ENTERPRISE", 5],
        ["P07-REDTEAM", 7], ["P07-MAINTENANCE", 4], ["P07-HOST-CORE", 700], ["P07-HOST-PROVIDERS", 1], ["P07-HOST-BINDING", 1], ["P07-HOST-LINT", 0],
        ["P07-A11Y", 5], ["P07-RENDERER-ALL", 170], ["P07-TOOLS", 1], ["P07-CONTRACTS", 500],
      ].map(([id, min]) => groupMeasure(inputs, id, min));
    },
  },

  // ── التصليب
  {
    id: "P07-H1",
    document: "phase-07-hardening",
    condition: "every dependency comes from its registry with a checksum or is a workspace member: crates.io with SHA-256 checksums, npm with SHA-512 integrity, no git or URL source",
    evaluate(inputs) {
      const cargo = inputs.inventory?.cargo;
      const npm = inputs.inventory?.npm ?? [];
      return [
        check("Cargo.lock sources", cargo !== undefined && cargo.lock_present, cargo?.offenders?.length === 0, cargo === undefined ? "no inventory" : `${cargo.packages} locked packages, offenders: ${cargo.offenders.join(", ") || "none"}`),
        ...["contracts", "runtime", "desktop/renderer"].map((dir) => {
          const n = npm.find((x) => x.directory === dir);
          return check(`${dir}/package-lock.json sources`, n !== undefined && n.present, n?.offenders?.length === 0, n === undefined || !n.present ? "absent" : `${n.packages} packages, offenders: ${n.offenders.join(", ") || "none"}`);
        }),
      ];
    },
  },
  {
    id: "P07-H2",
    document: "phase-07-hardening",
    condition: "every shipped dependency has a known licence with a permissive alternative: the Rust crates of the product and maintenance binaries and the renderer's runtime packages",
    evaluate(inputs) {
      const lic = inputs.inventory?.cargo?.licenses;
      const renderer = (inputs.inventory?.npm ?? []).find((x) => x.directory === "desktop/renderer");
      return [
        check("shipped crates", lic?.measured === true, lic?.unknown?.length === 0 && lic?.without_permissive_alternative?.length === 0, lic?.measured === true ? `${lic.shipped_crates} crates; unknown ${lic.unknown.length}; without a permissive alternative ${lic.without_permissive_alternative.join(", ") || "none"}` : `cargo metadata ${lic?.mode ?? "absent"}`),
        check("renderer runtime packages", renderer?.present === true, renderer?.shipped_without_permissive_alternative?.length === 0 && renderer?.shipped_license_unknown?.length === 0, renderer?.present ? `${renderer.shipped.length} packages; restrictive ${renderer.shipped_without_permissive_alternative.length}; unknown ${renderer.shipped_license_unknown.length}` : "absent"),
      ];
    },
  },
  {
    id: "P07-H3",
    document: "phase-07-hardening",
    condition: "the shipped product and maintenance binaries carry ASLR (DYNAMIC_BASE, HIGH_ENTROPY_VA), DEP (NX_COMPAT) and Control Flow Guard in their PE headers, the product as a window application and the tool as a console application",
    evaluate(inputs) {
      const bins = inputs.hardening?.binaries ?? [];
      return ["product", "maintenance"].map((id) => {
        const b = bins.find((x) => x.id === id);
        return check(`${id} PE header`, b !== undefined && b.present === true, b?.hardened === true, b === undefined || !b.present ? "binary absent" : `${b.format} ${b.subsystem} ${b.dll_characteristics} ${Object.entries(b.flags).filter(([, on]) => on).map(([f]) => f).join(" ")}`);
      });
    },
  },
  {
    id: "P07-H4",
    document: "phase-07-hardening",
    condition: "the webview is locked down: a self-only content policy without eval, no global Tauri object, a frozen prototype, no asset protocol, one window capability with three core permissions, no Tauri plugin",
    evaluate(inputs) {
      const w = inputs.hardening?.webview;
      return [check("tauri.conf.json and capabilities", w !== undefined, w?.ok === true, w === undefined ? "absent" : `csp default-src self ${w.csp_default_self}, object-src none ${w.csp_object_none}, eval ${!w.csp_no_unsafe_eval}; global tauri ${w.global_tauri}; asset protocol ${w.asset_protocol}; permissions ${w.permissions.join(", ")}; plugins ${w.plugins.length}`)];
    },
  },
  {
    id: "P07-H5",
    document: "phase-07-hardening",
    condition: "unsafe code is confined to named Win32 files of the binding, the core, providers and maintenance tool forbid it, product code starts a process only through the declared Job-Object launcher (ADR-028) and never disables TLS verification",
    evaluate(inputs) {
      const s = inputs.hardening?.source;
      return [
        check("unsafe confinement", s !== undefined, s?.undeclared_unsafe?.length === 0 && s?.forbids?.every((f) => f.forbids_unsafe), s === undefined ? "absent" : `unsafe in ${s.unsafe_files.join(", ")}; undeclared ${s.undeclared_unsafe.length}; forbid(unsafe_code) ${s.forbids.map((f) => `${f.file.split("/").slice(-3).join("/")}=${f.forbids_unsafe}`).join(" ")}`),
        check("process spawning", s !== undefined, (s?.undeclared_spawners ?? s?.spawners)?.length === 0, s === undefined ? "absent" : `${s.files} files; spawning ${s.spawners.join(", ") || "none"}; undeclared ${(s.undeclared_spawners ?? s.spawners).join(", ") || "none"}`),
        check("TLS verification", s !== undefined, s?.tls_bypass?.length === 0, s === undefined ? "absent" : `bypass ${s.tls_bypass.join(", ") || "none"}`),
      ];
    },
  },
  {
    id: "P07-H6",
    document: "phase-07-hardening",
    condition: "every place product code writes to disk is declared with its root, and the data folder the installed product used grants write access to no broad group",
    evaluate(inputs) {
      const s = inputs.hardening?.source;
      const acl = inputs.e2e?.acl;
      return [
        check("write sites", s !== undefined, s?.undeclared_write_sites?.length === 0, s === undefined ? "absent" : `${s.write_sites.length} declared write sites; undeclared ${s.undeclared_write_sites.join(", ") || "none"}`),
        check("data folder ACL", acl !== undefined && acl !== null, acl?.broad_write?.length === 0, acl === undefined || acl === null ? "not measured" : `${acl.rules.length} rule(s); broad write ${acl.broad_write.join(", ") || "none"}; owner ${acl.owner_sid}`),
      ];
    },
  },

  // ── الاسترداد
  {
    id: "P07-C1",
    document: "phase-07-recovery",
    condition: "a process killed in the middle of a transaction leaves a healthy store with every committed row and without the open transaction",
    evaluate: (inputs) => [testMeasure(inputs, "P07-RECOVERY", "p07_recovery_a_process_crash_keeps_committed_rows_and_loses_only_the_open_transaction")],
  },
  {
    id: "P07-C2",
    document: "phase-07-recovery",
    condition: "a damaged store is quarantined, never deleted, and replaced at startup by the newest verified backup; without a backup, or under a running instance, it is left untouched and the store fails closed",
    evaluate(inputs) {
      const r = steps(inputs).recovery;
      const launch = launches(inputs).find((l) => l.stage === "release-on-damaged-store");
      return [
        testMeasure(inputs, "P07-RECOVERY", "p07_recovery_a_corrupt_store_is_quarantined_and_the_latest_verified_backup_restored_at_startup"),
        testMeasure(inputs, "P07-RECOVERY", "p07_recovery_a_damaged_store_without_a_backup_fails_closed_and_is_left_untouched"),
        testMeasure(inputs, "P07-RECOVERY", "p07_recovery_a_store_damaged_while_another_instance_runs_is_not_touched"),
        check(
          "installed product on a damaged store",
          r !== undefined && launch !== undefined,
          r?.state_before !== "HEALTHY" && r?.action === "RESTORED_FROM_BACKUP" && r?.state_after === "HEALTHY" && r?.quarantine_kept === true && launch?.bootstrap_reached === true,
          r === undefined ? "not measured" : `before ${r.state_before}; action ${r.action}; restored ${r.restored_backup}; after ${r.state_after}; quarantine kept ${r.quarantine_kept}; bootstrap ${launch?.bootstrap_reached}`,
        ),
      ];
    },
  },
  {
    id: "P07-C3",
    document: "phase-07-recovery",
    condition: "backups of a running store are verified before they count, restore needs the application closed, keeps the replaced store recoverable, and refuses a tampered backup before anything moves",
    evaluate(inputs) {
      const r = steps(inputs).restore;
      return [
        groupMeasure(inputs, "P07-BACKUP", 5),
        testMeasure(inputs, "P07-MAINTENANCE", "p07_maint_verify_backup_and_restore_through_the_real_executable"),
        check("installed tool restore", r !== undefined, r?.ok === true && r?.state_after === "HEALTHY" && typeof r?.pre_restore_backup === "string" && r.pre_restore_backup.length > 0, r === undefined ? "not measured" : `backup ${r.backup}; ok ${r.ok}; pre-restore backup ${r.pre_restore_backup}; after ${r.state_after}`),
      ];
    },
  },
  {
    id: "P07-C4",
    document: "phase-07-recovery",
    condition: "every older schema upgrades through the product with its rows and a verified copy of the old store; a failed step leaves the old store intact",
    evaluate(inputs) {
      const l = steps(inputs).legacy_store;
      const u = steps(inputs).legacy_upgrade;
      const up = steps(inputs).upgrade;
      return [
        groupMeasure(inputs, "P07-MIGRATION", 5),
        testMeasure(inputs, "P07-MIGRATION", "p07_migration_every_older_schema_upgrades_through_the_product_with_its_rows"),
        testMeasure(inputs, "P07-MIGRATION", "p07_migration_a_failed_step_leaves_the_older_store_and_its_rows_intact"),
        check(
          "installed product on a real v1 store",
          l !== undefined && u !== undefined,
          l?.created === true && Number(l?.schema_version) === 1 && Number(u?.schema_after) === Number(inputs.supportedSchema) && u?.matches_reference === true && u?.pre_migration_copy === true && Number(u?.projects_after) === 1 && Number(up?.projects_after) === 1,
          u === undefined ? "not measured" : `v${l?.schema_version} → v${u.schema_after} (reference ${u.matches_reference}); pre-migration copy ${u.pre_migration_copy}; projects ${u.projects_after}, after the installer upgrade ${up?.projects_after}`,
        ),
      ];
    },
  },
  {
    id: "P07-C5",
    document: "phase-07-recovery",
    condition: "retention prunes only reproducible files (extra backups, old diagnostics, old quarantined downloads on request), runs dry first, and never prunes the audit chain, user work or quarantined stores",
    evaluate: (inputs) => [groupMeasure(inputs, "P07-RETENTION", 2), testMeasure(inputs, "P07-RETENTION", "p07_retention_a_dry_run_counts_and_an_applied_run_prunes_only_reproducible_files")],
  },

  // ── التحزيم
  {
    id: "P07-K1",
    document: "phase-07-packaging",
    condition: "a per-user NSIS installer for the current version is built from the release configuration, carries the maintenance tool, and installs no WebView2 runtime from the network",
    evaluate(inputs) {
      const p = inputs.packaging;
      const rc = inputs.tauriRelease?.bundle;
      const release = (p?.builds ?? []).find((b) => b.label === "release");
      return [
        check("release installer", p !== null && p !== undefined, release !== undefined && release.version === inputs.productVersion && release.bytes > 0, release === undefined ? "not built" : `${release.file} ${release.bytes} bytes sha256 ${release.sha256}`),
        check("upgrade fixture installer", p !== null && p !== undefined, (p?.builds ?? []).some((b) => b.label === "upgrade-fixture" && b.bytes > 0), `${(p?.builds ?? []).map((b) => `${b.label} ${b.version}`).join(", ")}`),
        check("release configuration", rc !== undefined, rc?.windows?.nsis?.installMode === "currentUser" && rc?.windows?.webviewInstallMode?.type === "skip" && Object.values(rc?.resources ?? {}).includes("polaris-maint.exe"), `installMode ${rc?.windows?.nsis?.installMode}; webview ${rc?.windows?.webviewInstallMode?.type}; resources ${Object.values(rc?.resources ?? {}).join(", ")}`),
      ];
    },
  },
  {
    id: "P07-K2",
    document: "phase-07-packaging",
    condition: "on Windows the older version installs, the release upgrades it in place, and the uninstaller removes the program, its registration and its shortcut while keeping the user's data",
    evaluate(inputs) {
      const s = steps(inputs);
      const e = inputs.e2e;
      return [
        check("install", s.install_fixture !== undefined, s.install_fixture?.exit_code === 0 && s.install_fixture?.registered_version === inputs.fixtureVersion && s.install_fixture?.maint_present === true, s.install_fixture === undefined ? `not run${e?.blocked ? `: ${e.blocked}` : ""}` : `exit ${s.install_fixture.exit_code}; registered ${s.install_fixture.registered_version}; tool ${s.install_fixture.maint_present}`),
        check("upgrade", s.upgrade !== undefined, s.upgrade?.exit_code === 0 && s.upgrade?.registered_version === inputs.productVersion && String(s.upgrade?.product_version ?? "").startsWith(inputs.productVersion), s.upgrade === undefined ? "not run" : `exit ${s.upgrade.exit_code}; registered ${s.upgrade.registered_version}; file ${s.upgrade.product_version}`),
        check(
          "uninstall",
          s.uninstall !== undefined,
          s.uninstall?.exit_code === 0 && s.uninstall?.uninstall_key_removed === true && s.uninstall?.product_removed === true && s.uninstall?.maint_removed === true && s.uninstall?.start_menu_shortcut_removed === true && s.uninstall?.data_preserved === true,
          s.uninstall === undefined ? "not run" : `exit ${s.uninstall.exit_code}; key removed ${s.uninstall.uninstall_key_removed}; program ${s.uninstall.product_removed}; tool ${s.uninstall.maint_removed}; shortcut ${s.uninstall.start_menu_shortcut_removed}; data kept ${s.uninstall.data_preserved}`,
        ),
      ];
    },
  },
  {
    id: "P07-K3",
    document: "phase-07-packaging",
    condition: "the signing status is the one Windows reports: signed only with a real certificate, otherwise unsigned and said so; no certificate is invented",
    evaluate(inputs) {
      const sig = inputs.signing;
      const truthful = sig !== null && sig !== undefined && ["SIGNED", "SIGNING_READY_UNSIGNED", "UNSIGNED_SIGNTOOL_MISSING", "SIGNING_NOT_READY"].includes(sig.status);
      return [check("Authenticode status", sig !== null && sig !== undefined, truthful, sig === null || sig === undefined ? "not measured" : `${sig.status}: ${sig.files.map((f) => `${f.file}=${f.authenticode}`).join(", ")}; signtool ${sig.signtool ?? "not found"}`)];
    },
  },

  // ── التحديث
  {
    id: "P07-U1",
    document: "phase-07-updater",
    condition: "an update manifest is accepted only when a trusted Ed25519 key signed its exact bytes, it is for this product and newer than the installed version, and the file matches its digest and size",
    evaluate: (inputs) => [groupMeasure(inputs, "P07-UPDATER", 6)],
  },
  {
    id: "P07-U2",
    document: "phase-07-updater",
    condition: "across two implementations: a manifest signed by Node with a per-run TEST key is verified by the installed tool, a changed installer is refused, and the product's own key list refuses it",
    evaluate(inputs) {
      const u = steps(inputs).update;
      return [check("installed tool against a Node-signed TEST manifest", u !== undefined, u?.fixture_signed === true && u?.valid_ok === true && u?.product_keys_code === "UPDATE_KEY_UNTRUSTED" && u?.tampered_code === "UPDATE_ARTIFACT_MISMATCH", u === undefined ? "not run" : `signed ${u.fixture_signed}; valid ${u.valid_ok}; product keys ${u.product_keys_code}; tampered ${u.tampered_code}`)];
    },
  },
  {
    id: "P07-U3",
    document: "phase-07-updater",
    condition: "there is no automatic update path in this build: no updater plugin, the auto-update setting is unavailable, and the product trusts no release key yet",
    evaluate(inputs) {
      const src = inputs.sources;
      return [
        check("no updater plugin", src.appCargo !== null, !/tauri-plugin-updater/.test(src.appCargo ?? ""), "desktop/host/app/Cargo.toml"),
        check("auto update unavailable", src.registry !== null, /later\("advanced\.auto_update"/.test(src.registry ?? ""), "advanced.auto_update is declared for a later phase"),
        check("no trusted release key", src.update !== null, /PRODUCT_TRUSTED_KEYS: &\[TrustedKey\] = &\[\];/.test(src.update ?? ""), "PRODUCT_TRUSTED_KEYS is empty"),
      ];
    },
  },

  // ── السياسة المُدارة
  {
    id: "P07-E1",
    document: "phase-07-enterprise",
    condition: "a managed policy narrows and never widens, names its clamp, cannot be raised or removed by the user, and an invalid policy locks down instead of being ignored",
    evaluate: (inputs) => [groupMeasure(inputs, "P07-ENTERPRISE", 5), testMeasure(inputs, "P07-REDTEAM", "p07_redteam_a_forged_policy_can_only_narrow_or_lock_down")],
  },
  {
    id: "P07-E2",
    document: "phase-07-enterprise",
    condition: "the product reads the policy from the machine-wide ProgramData folder at startup; the path override exists only in the measurement build",
    evaluate(inputs) {
      const platform = inputs.sources.platform ?? "";
      const lib = inputs.sources.lib ?? "";
      return [
        check("machine-wide path", platform !== "", /ProgramData/.test(platform) && /"POLARIS", "policy", "managed-policy\.json"/.test(platform), "desktop/host/app/src/platform.rs"),
        check("override in the measurement build only", platform !== "", /#\[cfg\(feature = "e2e"\)\]\s*pub const POLICY_PATH_ENV/.test(platform), "POLICY_PATH_ENV is compiled with the e2e feature only"),
        check("applied at startup", lib !== "", /apply_managed_policy\(&policy\)/.test(lib), "build_state applies the loaded policy"),
      ];
    },
  },
  {
    id: "P07-E3",
    document: "phase-07-enterprise",
    condition: "the installed maintenance tool validates a narrowing policy and refuses one that tries to open a locked setting",
    evaluate(inputs) {
      const p = steps(inputs).policy;
      return [check("installed tool policy check", p !== undefined, p?.valid_state === "APPLIED" && p?.widening_code === "POLICY_INVALID", p === undefined ? "not run" : `valid ${p.valid_state}; widening ${p.widening_code}`)];
    },
  },

  // ── المنصّة
  {
    id: "P07-PL1",
    document: "phase-07-platform",
    condition: "every operating-system condition in the core is inventoried with its reason; none is new or unexplained",
    evaluate(inputs) {
      const p = inputs.inventory?.platform;
      return [check("core platform sites", p !== undefined, p?.undeclared_core_sites?.length === 0, p === undefined ? "absent" : `${p.core_sites.length} file(s): ${p.core_sites.map((s) => `${s.file.split("/").slice(-2).join("/")}×${s.sites}`).join(", ")}; undeclared ${p.undeclared_core_sites.length}`)];
    },
  },
  {
    id: "P07-PL2",
    document: "phase-07-platform",
    condition: "Windows-specific code lives in named files of the binding, and every Windows port has a declared non-Windows fallback (desktop control, credential store, policy path)",
    evaluate(inputs) {
      const f = inputs.inventory?.platform?.non_windows_fallbacks;
      return [check("non-Windows fallbacks", f !== undefined, f?.desktop_port === true && f?.credential_store === true && f?.managed_policy_path === true, f === undefined ? "absent" : `desktop ${f.desktop_port}; credentials ${f.credential_store}; policy path ${f.managed_policy_path}`)];
    },
  },
  {
    id: "P07-PL3",
    document: "phase-07-platform",
    condition: "the macOS status is stated from evidence: nothing was built or run on macOS, so the verdict is FOUNDATION_ONLY and no macOS claim is made",
    evaluate(inputs) {
      const p = inputs.inventory?.platform;
      return [check("macOS evidence", p !== undefined, p?.macos_native_verified === false, p === undefined ? "absent" : p.macos_note)];
    },
  },

  // ── الأمن والخصوصية
  {
    id: "P07-S1",
    document: "phase-07-security",
    condition: "the threat model maps every threat to a control and to tests that ran and passed in this run",
    evaluate(inputs) {
      const rows = inputs.threats ?? [];
      if (rows.length === 0) return [measure("threat model", "NOT_TESTED", "docs/security/THREAT-MODEL.md has no threat rows")];
      return rows.map((row) => {
        const results = row.tests.map((name) => {
          const hit = (inputs.groups ?? []).flatMap((g) => g.tests ?? []).filter((t) => t.name === name || t.name.endsWith(`::${name}`));
          return hit.length === 0 ? "NOT_TESTED" : hit.every((t) => t.status === "PASS") ? "PASS" : "FAIL";
        });
        return measure(row.id, row.tests.length === 0 ? "NOT_TESTED" : worst(results), `${row.tests.length} test(s): ${results.join(" ")}`);
      });
    },
  },
  {
    id: "P07-S2",
    document: "phase-07-security",
    condition: "the red-team suite passes: resealed backups with planted triggers or newer schemas, impostor files, climbing ids, links, forged policies, a closed tool vocabulary",
    evaluate: (inputs) => [groupMeasure(inputs, "P07-REDTEAM", 7)],
  },
  {
    id: "P07-S3",
    document: "phase-07-security",
    condition: "the network surface is the declared one: one socket opener, declared HTTP users each with its guard, only user-enabled provider defaults as external addresses, no network API in the renderer, IPC-only connect-src",
    evaluate(inputs) {
      const n = inputs.inventory?.network;
      return [
        check("sockets and HTTP users", n !== undefined, n?.undeclared_socket_openers?.length === 0 && n?.undeclared_socket_users?.length === 0 && n?.undeclared_http_users?.length === 0, n === undefined ? "absent" : `openers ${n.socket_openers.join(", ")}; HTTP users ${n.http_client_users.length}; undeclared ${n.undeclared_socket_openers.length + n.undeclared_socket_users.length + n.undeclared_http_users.length}`),
        check("external addresses", n !== undefined, n?.undeclared_literals?.length === 0, n === undefined ? "absent" : `${n.external_literals.length} literal(s), undeclared ${n.undeclared_literals.join(", ") || "none"}`),
        check("renderer network", n !== undefined, n?.renderer_network_api_files?.length === 0 && n?.csp_connect_src === "ipc: http://ipc.localhost", n === undefined ? "absent" : `renderer files with a network API ${n.renderer_network_api_files.length}; connect-src ${n.csp_connect_src}`),
      ];
    },
  },
  {
    id: "P07-S4",
    document: "phase-07-security",
    condition: "no Phase-07 evidence document, raw record or release artifact carries a key-shaped value",
    evaluate(inputs) {
      const s = inputs.security;
      return [check("secret scan", s !== null && s !== undefined, s?.leaks?.length === 0 && s?.scanned > 0, s === null || s === undefined ? "not run yet" : `${s.scanned} file(s) scanned; leaks ${s.leaks.join(", ") || "none"}`)];
    },
  },

  // ── الإصدار على Windows
  {
    id: "P07-X1",
    document: "phase-07-release-e2e",
    condition: "every launch of the installed product opened its window, reached the renderer bootstrap from the packaged origin, closed gracefully with exit code 0 and left no process behind",
    evaluate(inputs) {
      const list = launches(inputs);
      if (list.length === 0) return [measure("launches", "NOT_TESTED", inputs.e2e?.blocked ?? "no launch was recorded")];
      const expected = ["fixture-on-legacy-store", "release-after-upgrade", "release-on-damaged-store"];
      return expected.map((stage) => {
        const l = list.find((x) => x.stage === stage);
        return check(stage, l !== undefined, l?.window_appeared === true && l?.bootstrap_reached === true && l?.closed_gracefully === true && l?.exit_code === 0 && l?.surviving_processes === 0 && String(l?.measurements?.renderer_origin ?? "").includes("tauri.localhost"), l === undefined ? "not run" : `window ${l.window_appeared}; bootstrap ${l.bootstrap_reached} (${l.measurements?.renderer_origin}); exit ${l.exit_code}; survivors ${l.surviving_processes}`);
      });
    },
  },
  {
    id: "P07-X2",
    document: "phase-07-release-e2e",
    condition: "the user's own POLARIS data folder (store and WebView2 profile) and installation are untouched, the test WebView2 profile lives in the owned tree, and every owned path is removed afterwards",
    evaluate(inputs) {
      const e = inputs.e2e;
      return [
        check("real data folder", e !== null && e !== undefined, e?.before?.real_data?.digest === e?.after?.real_data?.digest && e?.before?.real_data?.exists === e?.after?.real_data?.exists, e === null || e === undefined ? "not run" : `before exists ${e.before.real_data.exists} (${e.before.real_data.files} files); after ${e.after.real_data.exists} (${e.after.real_data.files} files); digest equal ${e.before.real_data.digest === e.after.real_data.digest}`),
        check("test WebView2 profile", (e?.launches ?? []).length > 0, (e?.launches ?? []).every((l) => l.webview_profile_owned === true), `profile written in the owned tree by ${(e?.launches ?? []).filter((l) => l.webview_profile_owned === true).length}/${(e?.launches ?? []).length} launch(es)`),
        check("installation state", e !== null && e !== undefined, e?.before?.install?.uninstall_key === false && e?.after?.install?.uninstall_key === false, e === null || e === undefined ? "not run" : `registered before ${e.before.install.uninstall_key}, after ${e.after.install.uninstall_key}`),
        check("owned paths", e !== null && e !== undefined, e?.after?.owned_root_removed === true && (e?.reason_codes ?? []).length === 0, e === null || e === undefined ? "not run" : `owned root removed ${e.after.owned_root_removed}; reason codes ${(e.reason_codes ?? []).join(", ") || "none"}`),
      ];
    },
  },

  // ── الأداء
  {
    id: "P07-P1",
    document: "phase-07-performance",
    condition: "footprint and timings are locally measured on this machine with their method, and stay inside the budgets declared before the run",
    evaluate(inputs) {
      return (inputs.performance ?? []).map((m) => (m.value === null || m.value === undefined ? measure(m.name, "NOT_TESTED", "not measured") : measure(m.name, m.budget === undefined || m.value <= m.budget ? "PASS" : "FAIL", `${m.value} ${m.unit}${m.budget === undefined ? "" : ` (budget ${m.budget})`}`)));
    },
  },

  // ── الانحدار
  ...["00", "01", "02", "03", "04", "05", "06"].map((phase) => ({
    id: `P07-R${Number(phase)}`,
    document: "phase-07-regression",
    condition: `the Phase-${phase} gate was re-run in this run and passes`,
    evaluate(inputs) {
      const gate = inputs.gates?.[phase];
      const started = inputs.run?.run_started ?? null;
      if (inputs.run?.skip_regression === true) return [measure(`PHASE-${phase} final gate`, "NOT_TESTED", "the regression stage was skipped by switch")];
      if (gate === null || gate === undefined) return [measure(`PHASE-${phase} final gate`, "NOT_TESTED", "absent")];
      // البوابة المجمّدة لـPhase-00 تكتب `decided_at`، والمراحل بعدها `measured_at`.
      const decided = gate.decided_at ?? gate.measured_at ?? null;
      // سياسة المالك (2026-09-30): كل مرحلة تُختبر منفصلة. في وضع PRIOR_GATES تُقرأ البوابة الأدنى كما حكم بها
      // مشغّلها، ويُشترط أن تكون قانونية وPASS؛ في وضع RERUN تُشترط حداثتها كما كانت.
      if (inputs.run?.regression_mode === "PRIOR_GATES") {
        const canonical = phase === "00" ? gate.native === true && gate.platform === "win32" : gate.canonical === true;
        return [check(`PHASE-${phase} final gate`, typeof decided === "string", canonical && gate.verdict === "PASS", `PHASE-${phase} = ${gate.verdict}, canonical ${canonical}, decided ${decided} (prior gate read, not re-run: each phase is tested separately)`)];
      }
      const fresh = started !== null && typeof decided === "string" && decided >= started;
      return [check(`PHASE-${phase} final gate`, fresh, gate.verdict === "PASS", fresh ? `PHASE-${phase} = ${gate.verdict}, decided ${decided}` : `stale: decided ${decided}, before this run (${started})`)];
    },
  })),

  // ── في البوابة نفسها
  {
    id: "P07-G1",
    document: "phase-07-final-gate",
    condition: "every canonical Phase-07 document and every prior final gate is UTF-8 without BOM, valid JSON, LF only, one final newline",
    evaluate(inputs) {
      const b = inputs.bytes;
      return [check("byte gate", b !== null && b !== undefined, b?.verdict === "PASS", b === null || b === undefined ? "not run yet" : `${b.summary.clean}/${b.summary.checked} clean`)];
    },
  },
]);

/** يقيّم شرطًا: حكمه أسوأ قياساته. */
export function evaluateClaim(inputs, claim) {
  let measured;
  try {
    measured = claim.evaluate(inputs);
  } catch (error) {
    measured = [measure("evaluation", "INCONCLUSIVE", `the evaluation raised: ${String(error?.message ?? error).slice(0, 200)}`)];
  }
  const verdict = worst(measured.map((m) => m.verdict));
  const reason = verdict === "PASS" ? "" : measured.filter((m) => m.verdict !== "PASS").map((m) => `${m.requirement}: ${m.detail}`).join("; ").slice(0, 600);
  return { verdict, reason_code: reason, measured_by: measured };
}
