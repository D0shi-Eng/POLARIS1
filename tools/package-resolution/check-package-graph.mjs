// بوابة حلّ الحزم — POLARIS Phase-00 / W4.
//
// خطوة واحدة تُجيب سؤالًا واحدًا: هل تحلّ runtime حزمةَ ‎@polaris/contracts‎
// على هذا المضيف فعلًا — بناءً وتحميلًا وأنواعًا — أم أن الإعلان وحده موجود؟
//
// تُشغَّل قبل التحقّق من runtime وقبل أي مسبار أصلي. فشلها عيبُ إقلاع مُصنَّف،
// لا فشلَ مطابقة أمنية: لا شيء عن الحصر يُستنتج منها بأي حال.
//
//   node tools/package-resolution/check-package-graph.mjs --root D:\POLARIS
//
// المخرج: 0 سليم، 2 عيب إقلاع مُصنَّف.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveRepositoryRoot, REPOSITORY_MARKERS } from "./repository-root.mjs";
import { firstErrorCode, MATERIALIZATION, runChecks } from "./package-graph-checks.mjs";

const BOOTSTRAP_ERROR_CODE = "WINDOWS_PACKAGE_RESOLUTION_BOOTSTRAP_DEFECT";
const STRATEGY =
  "npm local file: dependency with install-links=true — runtime depends on file:../contracts, and npm packs " +
  "that directory and installs it as an ordinary node_modules package. No symlink, no junction, no cross-OS link.";

const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");
const resolution = resolveRepositoryRoot(argv);

if (resolution.root === undefined) {
  process.stdout.write(`\nPOLARIS package-resolution gate — BOOTSTRAP FAILED\nerror_code : ${BOOTSTRAP_ERROR_CODE}\n`);
  process.stdout.write("reason     : the repository root could not be determined or did not validate.\n\n");
  for (const attempt of resolution.attempts) {
    process.stdout.write(`  ${attempt.source.padEnd(34)} ${attempt.status.padEnd(26)} ${attempt.candidate}\n`);
  }
  process.stdout.write(`\nrequired markers: ${REPOSITORY_MARKERS.join(", ")}\n`);
  process.exit(2);
}

const root = resolution.root;
const checks = runChecks(root);
const failed = checks.filter((check) => check.status === "FAIL");

const record = {
  harness: "polaris.w4.package-resolution",
  harness_version: "1.0.0",
  platform: process.platform,
  node: process.version,
  ran_at: new Date().toISOString(),
  repository_root: root,
  repository_root_resolution: resolution.attempts,
  strategy: STRATEGY,
  materialization: MATERIALIZATION,
  status: failed.length === 0 ? "PASS" : "FAIL",
  error_code: failed.length === 0 ? null : firstErrorCode(checks),
  bootstrap_error_class: failed.length === 0 ? null : BOOTSTRAP_ERROR_CODE,
  summary: { passed: checks.length - failed.length, failed: failed.length, total: checks.length },
  checks,
};

// الاسم القانوني ملك للتشغيل الأصلي على ويندوز. تشغيل على منصة أخرى يكتب باسم
// آخر، فلا يمحو دليلًا حقيقيًا ولا يدّعي مكانه.
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const evidenceName =
  process.platform === "win32" ? "w4-package-resolution.json" : "w4-package-resolution.local.json";
const evidencePath = join(evidenceDirectory, evidenceName);
writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

for (const check of checks) {
  process.stdout.write(`${check.status.padEnd(7)} ${check.check_id}  ${check.title}\n`);
  if (check.status !== "PASS") process.stdout.write(`        ${check.detail}\n`);
}
process.stdout.write(`\nstrategy : ${STRATEGY}\n`);
process.stdout.write(`evidence : ${evidencePath}\n`);

if (wantsJson) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);

if (failed.length > 0) {
  process.stdout.write(`\nPACKAGE RESOLUTION FAILED\n`);
  process.stdout.write(`error_code : ${record.error_code}\n`);
  process.stdout.write(`class      : ${BOOTSTRAP_ERROR_CODE}\n`);
  process.stdout.write("This is a package-graph bootstrap defect. No security claim was tested, and no\n");
  process.stdout.write("confinement result is implied. Nothing about W4 conformance follows from it.\n");
  process.exit(2);
}

process.stdout.write("\npackage resolution proven on this host.\n");
process.exit(0);
