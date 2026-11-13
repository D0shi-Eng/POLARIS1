// أحكام سيناريوهات W6 (D01..D12) — مُشتقّة من قياسات وقعت، لا من تشغيل جديد.
//
// لا يشغّل هذا الملف اختبارًا واحدًا. القياس وقع مرة: مجموعات W6 شغّلها مشغّل
// المجموعات، والمسابر الأصلية شغّلها مشغّلا W4 و W5 المجمَّدان. ما يفعله هنا هو
// الربط: أي اختبار يخصّ أي سيناريو، وأي دليل أصلي يحمل الجزء الذي لا يُقاس
// خارج ويندوز — ثم إصدار حكم لكل سيناريو من ذلك وحده.
//
// القاعدة التي لا تُكسر: نتيجة على لينكس لا تصير ادعاءً عن ويندوز. سيناريو
// `native_only` بلا دليل أصلي حكمه NOT_TESTED، مهما نجح ما حوله.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, readCanonicalEvidenceJson } from "../evidence-contract/evidence-bytes.mjs";
import { W6_DOGFOOD_TOOL, W6_SCENARIOS } from "./w6-groups.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const root = argument("--root", process.cwd());
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env["POLARIS_W6_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";

function readOrNull(name) {
  const path = join(evidenceDirectory, name);
  if (!existsSync(path)) return null;
  try {
    return readCanonicalEvidenceJson(path);
  } catch {
    return null;
  }
}

const groupsDocument = readOrNull(`w6-test-groups${suffix}.json`);
const w4Conformance = readOrNull("w4-windows-conformance.json");
const w5Probe = readOrNull("w5-panic-stop.json");

/** نتائج الاختبارات المفردة عبر كل المجموعات، أو null إن لم يكن الدليل مقروءًا. */
function allTestResults() {
  if (groupsDocument === null || !Array.isArray(groupsDocument.groups)) return null;
  const results = [];
  for (const group of groupsDocument.groups) {
    for (const result of group.test_results ?? []) results.push({ ...result, group_id: group.group_id });
  }
  return results;
}

/** حكم مسبار W4 بمعرّفه، أو NOT_TESTED إن لم يوجد دليل أصلي. */
function w4Probe(probeId) {
  if (w4Conformance === null || !Array.isArray(w4Conformance.probes)) {
    return { verdict: "NOT_TESTED", reason_code: "NATIVE_EVIDENCE_MISSING" };
  }
  const probe = w4Conformance.probes.find((candidate) => candidate.probe_id === probeId);
  if (probe === undefined) return { verdict: "NOT_TESTED", reason_code: "PROBE_NOT_IN_EVIDENCE" };
  return { verdict: String(probe.verdict), reason_code: String(probe.reason_code ?? "") };
}

/**
 * الجزء الأصلي من كل سيناريو، مقروءًا من أدلة الأدوات المجمَّدة.
 *
 * الخريطة صريحة ومكتوبة هنا لا مشتقّة بالاسم: ربطُ سيناريو بمسبار قرارٌ
 * يُراجَع، لا مطابقة نصّية تنجح بالصدفة.
 */
function nativePart(scenarioId) {
  switch (scenarioId) {
    case "W6-D01":
      return [
        { source: "W-08", ...w4Probe("W-08") },
        { source: "W-09", ...w4Probe("W-09") },
      ];
    case "W6-D02":
      return [{ source: "W-10", ...w4Probe("W-10") }];
    case "W6-D06":
      return [
        {
          source: "W5-P01",
          verdict: w5Probe === null ? "NOT_TESTED" : String(w5Probe.verdict ?? "NOT_TESTED"),
          reason_code: w5Probe === null ? "NATIVE_EVIDENCE_MISSING" : String(w5Probe.reason_code ?? ""),
        },
      ];
    case "W6-D09":
      return [{ source: "W-12", ...w4Probe("W-12") }];
    case "W6-D10":
      return [{ source: "W-11", ...w4Probe("W-11") }];
    case "W6-D11":
      return [
        { source: "W-12", ...w4Probe("W-12") },
        {
          source: "W5-P01 appcontainer",
          verdict:
            w5Probe === null
              ? "NOT_TESTED"
              : w5Probe.appcontainer?.internet_client_requested === false && w5Probe.appcontainer?.capability_count === 0
                ? "PASS"
                : "FAIL",
          reason_code: w5Probe === null ? "NATIVE_EVIDENCE_MISSING" : "",
        },
      ];
    default:
      return [];
  }
}

const measuredAt = stamp();
const results = allTestResults();
const scenarios = [];

for (const scenario of W6_SCENARIOS) {
  const matched = results === null ? [] : results.filter((result) => result.name.startsWith(scenario.prefix));
  const native = nativePart(scenario.id);
  const nativeClean = native.length > 0 && native.every((part) => part.verdict === "PASS");
  const nativeUnmeasured = native.filter((part) => part.verdict !== "PASS");

  let verdict;
  let reason = "";
  let evidenceComplete;

  if (scenario.native_only) {
    // لا يُقاس خارج ويندوز أصلًا: الحكم من الدليل الأصلي وحده.
    evidenceComplete = native.length > 0 && nativeUnmeasured.every((part) => part.reason_code !== "NATIVE_EVIDENCE_MISSING");
    verdict = nativeClean ? "PASS" : native.some((part) => part.verdict === "FAIL") ? "FAIL" : "NOT_TESTED";
    reason = nativeClean ? "" : (nativeUnmeasured[0]?.reason_code || "NATIVE_CLAIM_UNMEASURED");
  } else if (results === null) {
    evidenceComplete = false;
    verdict = "INCONCLUSIVE";
    reason = "W6_TEST_GROUP_EVIDENCE_UNREADABLE";
  } else if (matched.length === 0) {
    evidenceComplete = false;
    verdict = "NOT_TESTED";
    reason = "NO_TEST_CARRIES_THIS_SCENARIO";
  } else if (matched.some((result) => result.failed)) {
    evidenceComplete = true;
    verdict = "FAIL";
    reason = "ASSERTION_FAILED";
  } else if (matched.every((result) => result.skipped)) {
    evidenceComplete = true;
    verdict = "NOT_TESTED";
    reason = "ALL_TESTS_SKIPPED";
  } else {
    evidenceComplete = true;
    verdict = "PASS";
  }

  scenarios.push({
    claim_id: scenario.id,
    description: scenario.title,
    platform: process.platform,
    native: process.platform === "win32",
    native_only: scenario.native_only,
    measurement_started: measuredAt,
    measurement_completed: stamp(),
    evidence_complete: evidenceComplete,
    verdict,
    reason_code: reason,
    tests: matched.map((result) => ({
      group_id: result.group_id,
      name: result.name,
      ok: result.ok,
      failed: result.failed,
      skipped: result.skipped,
      skip_reason: result.directive_reason,
    })),
    native_parts: native,
    native_corroboration: native.length === 0 ? "NONE_REQUIRED" : nativeClean ? "CLEAN" : "NOT_CLEAN",
    limits: scenario.limits,
    evidence_reference: join("evidence", `w6-dogfood${suffix}.json`),
  });
}

const summary = {
  total: scenarios.length,
  passed: scenarios.filter((s) => s.verdict === "PASS").length,
  failed: scenarios.filter((s) => s.verdict === "FAIL").length,
  blocked: scenarios.filter((s) => s.verdict === "BLOCKED").length,
  inconclusive: scenarios.filter((s) => s.verdict === "INCONCLUSIVE").length,
  not_tested: scenarios.filter((s) => s.verdict === "NOT_TESTED").length,
  scenarios_with_incomplete_evidence: scenarios.filter((s) => s.evidence_complete !== true).length,
};

const document = {
  schema_version: "1.0.0",
  tool: W6_DOGFOOD_TOOL,
  canonical,
  platform: process.platform,
  node_version: process.version,
  derived_from: [
    `evidence/w6-test-groups${suffix}.json`,
    "evidence/w4-windows-conformance.json",
    "evidence/w5-panic-stop.json",
  ],
  interpretation:
    "scenario verdicts are derived from measurements that already happened. A Linux result never becomes a Windows claim: a native-only scenario with no native evidence is NOT_TESTED.",
  summary,
  scenarios,
};

if (!canonical) {
  document.non_canonical_note =
    "this run did not carry the W6 runner's marker, so it is not canonical evidence and must not be read as a W6 result";
}

const path = join(evidenceDirectory, `w6-dogfood${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

for (const scenario of scenarios) {
  console.log(
    `${scenario.verdict.padEnd(12)} ${scenario.claim_id.padEnd(8)} ${scenario.description} ` +
      `[${String(scenario.tests.length)} tests, native: ${scenario.native_corroboration}]` +
      (scenario.reason_code === "" ? "" : ` — ${scenario.reason_code}`),
  );
}
console.log(
  `W6 dogfood: ${String(summary.passed)}/${String(summary.total)} scenarios PASS, ` +
    `${String(summary.failed)} fail, ${String(summary.not_tested)} not tested, ` +
    `${String(summary.inconclusive)} inconclusive`,
);

process.exit(summary.failed + summary.blocked + summary.inconclusive + summary.not_tested === 0 ? 0 : 1);
