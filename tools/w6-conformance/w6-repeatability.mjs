// إعادة الإنتاج على مستوى المشغّل: نفس السيناريو الأساسي مرتين، من نظافة.
//
// المجموعة W6-H تقيس إعادة الإنتاج داخل عملية واحدة. هذا الملف يقيس ما لا
// تراه من هناك: أن تشغيلين منفصلين — عمليتان مختلفتان، ومساحتا عمل جديدتان —
// يعطيان نفس النتائج، وأن الثاني لم يرث شيئًا من الأول على القرص.
//
// المقارنة على نتائج الاختبارات المفردة لا على رقم واحد: «كلاهما أخضر» تخفي
// اختبارًا تُخطّي في أحدهما وعمل في الآخر.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";
import { scanSummary } from "../w5-conformance/w5-test-group-contract.mjs";
import { parseTapResults } from "./w6-tap.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const root = argument("--root", process.cwd());
const runtime = join(root, "runtime");
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env["POLARIS_W6_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";

const SCENARIO_FILES = [join("dist", "tests", "w6-dogfood.test.js"), join("dist", "tests", "w6-repeatability.test.js")];

function leftoverWorkspaces() {
  try {
    return readdirSync(tmpdir()).filter((entry) => entry.startsWith("polaris-w4-") || entry.startsWith("polaris-w5-"));
  } catch {
    return [];
  }
}

function runOnce(label) {
  const environment = { ...process.env };
  delete environment["NODE_TEST_CONTEXT"];
  const started = stamp();
  const run = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "--test-reporter-destination=stdout", ...SCENARIO_FILES],
    { cwd: runtime, encoding: "utf8", env: environment, maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  const summary = scanSummary(output);
  return {
    label,
    measurement_started: started,
    measurement_completed: stamp(),
    exit_code: run.status,
    summary_format: summary.format,
    counts: summary.format === "UNREADABLE" ? null : summary.values,
    results: parseTapResults(output).map((result) => ({
      name: result.name,
      ok: result.ok,
      failed: result.failed,
      skipped: result.skipped,
    })),
  };
}

const before = leftoverWorkspaces();
const first = runOnce("FIRST");
const between = leftoverWorkspaces();
const second = runOnce("SECOND");
const after = leftoverWorkspaces();

/** الفروق باسم الاختبار. مصفوفة فارغة تعني تطابقًا حقيقيًا لا رقمين متساويين. */
function differences() {
  const found = [];
  const byName = new Map(second.results.map((result) => [result.name, result]));
  for (const result of first.results) {
    const other = byName.get(result.name);
    if (other === undefined) {
      found.push({ test: result.name, difference: "MISSING_IN_SECOND_RUN" });
      continue;
    }
    if (other.ok !== result.ok || other.failed !== result.failed || other.skipped !== result.skipped) {
      found.push({
        test: result.name,
        difference: "OUTCOME_CHANGED",
        first: { ok: result.ok, failed: result.failed, skipped: result.skipped },
        second: { ok: other.ok, failed: other.failed, skipped: other.skipped },
      });
    }
  }
  for (const result of second.results) {
    if (!first.results.some((candidate) => candidate.name === result.name)) {
      found.push({ test: result.name, difference: "MISSING_IN_FIRST_RUN" });
    }
  }
  return found;
}

const drift = differences();
const leaked = after.filter((entry) => !before.includes(entry));
const readable = first.summary_format !== "UNREADABLE" && second.summary_format !== "UNREADABLE";
const bothClean = first.exit_code === 0 && second.exit_code === 0;

let verdict;
let reason = "";
if (!readable) {
  verdict = "INCONCLUSIVE";
  reason = "TEST_SUMMARY_UNREADABLE";
} else if (first.results.length === 0) {
  verdict = "NOT_TESTED";
  reason = "NO_SCENARIO_RAN";
} else if (!bothClean) {
  verdict = "FAIL";
  reason = "SCENARIO_FAILED_IN_A_REPEAT_RUN";
} else if (drift.length > 0) {
  verdict = "FAIL";
  reason = "OUTCOME_DRIFT_BETWEEN_RUNS";
} else if (leaked.length > 0) {
  verdict = "FAIL";
  reason = "TEMPORARY_WORKSPACE_LEAKED";
} else {
  verdict = "PASS";
}

const document = {
  schema_version: "1.0.0",
  tool: "polaris.w6.repeatability",
  canonical,
  claim_id: "W6-D12-RUNNER",
  description: "the primary scenario, run twice in separate processes from clean workspaces, reaches identical outcomes and leaves nothing behind",
  platform: process.platform,
  native: process.platform === "win32",
  node_version: process.version,
  measurement_started: first.measurement_started,
  measurement_completed: second.measurement_completed,
  evidence_complete: readable,
  runs: [first, second],
  workspace_snapshots: { before, between, after, leaked },
  differences: drift,
  verdict,
  reason_code: reason,
  detail: `${String(first.results.length)} tests compared, ${String(drift.length)} differences, ${String(leaked.length)} leaked workspaces`,
  evidence_reference: join("evidence", `w6-repeatability${suffix}.json`),
};

if (!canonical) {
  document.non_canonical_note =
    "this run did not carry the W6 runner's marker, so it is not canonical evidence and must not be read as a W6 result";
}

const path = join(evidenceDirectory, `w6-repeatability${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

console.log(
  `W6 repeatability: ${verdict} — ${String(first.results.length)} tests compared, ` +
    `${String(drift.length)} differences, ${String(leaked.length)} leaked workspaces`,
);
for (const entry of drift) console.log(`  ${entry.test}: ${entry.difference}`);

process.exit(verdict === "PASS" ? 0 : 1);
