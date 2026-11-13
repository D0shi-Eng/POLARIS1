// بوابة Phase-00 النهائية — القراءة والكتابة والتقرير.
//
// لا تقيس هذه الأداة شيئًا، ولا تحسب حكمًا. تقرأ الأدلة القانونية التي كتبتها
// الأدوات، وتُسلّمها إلى الاشتقاق الخالص في phase-00-derivation.mjs، وتكتب ما
// يعود منه.
//
// ولماذا انفصل الاشتقاق: حين كان المنطق هنا، مختلطًا بالقرص والوسائط والخروج،
// لم يكن يُختبر إلا بتشغيل أصلي كامل على ويندوز. فمرّ عيبٌ بسيط ومكلف — قراءة
// القياس من وثيقةٍ لا يعيش فيها — إلى بوابةٍ نهائية بلا اختبار انحدار واحد
// يمسكه. الاشتقاق الآن دالّة تُستدعى بوثائق، ومُغلّفها هنا لا يقرّر شيئًا.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, readCanonicalEvidenceJson } from "../evidence-contract/evidence-bytes.mjs";
import { derivePhase00 } from "./phase-00-derivation.mjs";

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

// نفس قاعدة كل أدوات W6: الاسم القانوني لا يُكتب إلا بعلامة المشغّل. بوابةٌ
// نهائية باسم قانوني كتبها تشغيل غير أصلي هي أخطر ملف يمكن أن يوجد هنا.
const canonical = process.env["POLARIS_W6_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";

/** غياب الملف وفساد بايتاته وتعذُّر تحليله كلّه غياب، ويُسمّى كذلك لاحقًا. */
function read(name) {
  const path = join(evidenceDirectory, name);
  if (!existsSync(path)) return null;
  try {
    return readCanonicalEvidenceJson(path);
  } catch {
    return null;
  }
}

const evidence = {
  w1: read("w1-results.json"),
  w4Conformance: read("w4-windows-conformance.json"),
  w5Run: read("w5-run.json"),
  w6Run: read("w6-run.json"),
  w6Groups: read("w6-test-groups.json"),
  w6Dogfood: read("w6-dogfood.json"),
  w6Skips: read("w6-skip-classification.json"),
  w6Bytes: read("w6-evidence-bytes.json"),
  w6Repeat: read("w6-repeatability.json"),
  w6Cleanup: read("w6-cleanup.json"),
};

const derived = derivePhase00(evidence);

const document = {
  schema_version: "1.1.0",
  tool: "polaris.phase-00.final-gate",
  phase: "PHASE-00",
  platform: process.platform,
  native: process.platform === "win32",
  decided_at: stamp(),
  derived_from: [
    "evidence/w1-results.json",
    "evidence/w4-windows-conformance.json",
    "evidence/w5-run.json",
    "evidence/w6-run.json",
    "evidence/w6-test-groups.json",
    "evidence/w6-dogfood.json",
    "evidence/w6-skip-classification.json",
    "evidence/w6-evidence-bytes.json",
    "evidence/w6-repeatability.json",
    "evidence/w6-cleanup.json",
  ],
  rules: [
    "BLOCKED, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
    "a condition whose evidence is incomplete is not a satisfied condition",
    "a condition not measured in this run says so, and is never read as a fresh measurement",
    "an absent measurement is NOT_TESTED, never FAIL: a failure is a claim about a measurement that happened",
    "a claim reads the document its measurement lives in, and that document must be tied to this run",
    "an empty measurement_started or measurement_completed means the producing tool did not record one, and is never filled in here",
    "PHASE-00 = PASS only when every condition is PASS with complete evidence",
  ],
  conditions: derived.conditions,
  summary: derived.summary,
  canonical,
  verdict: derived.verdict,
  reason_code: derived.reason_code,
  phase_01_gate: derived.phase_01_gate,
};

if (!canonical) {
  document.non_canonical_note =
    "this gate did not carry the W6 runner's marker, so it is not a Phase-00 decision and must not be read as one";
}

const path = join(evidenceDirectory, `phase-00-final-gate${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

for (const entry of derived.conditions) {
  const measured = entry.measured_in_this_run ? "measured" : "carried";
  console.log(
    `${entry.verdict.padEnd(17)} ${entry.claim_id.padEnd(18)} ${measured.padEnd(9)} ${entry.description}` +
      (entry.reason_code === "" ? "" : ` — ${entry.reason_code}`),
  );
}
console.log("");
console.log(`PHASE-00 = ${document.verdict}${document.reason_code === "" ? "" : ` (${document.reason_code})`}`);
console.log(`PHASE-01 GATE = ${document.phase_01_gate}`);

process.exit(document.verdict === "PASS" ? 0 : 1);
