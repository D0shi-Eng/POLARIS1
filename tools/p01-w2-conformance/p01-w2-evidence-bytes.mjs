// بوابة بايتات أدلة P01-W2.
//
// التصنيف نفسه لا يُكرَّر: البايتات الأولى يصنّفها evidence-bytes.mjs وحده.
// ما يضيفه هذا الملف هو بقية العقد التي لا تقع على البايتات الأولى — JSON صالح،
// نهايات LF، وسطر أخير واحد بالضبط — وتطبيقه على مجموعة وثائق مُسمّاة صراحةً.
//
// ولماذا لا تُكتشف الوثائق بنمط عام: نمط يلتقط كل phase-01-*.json سيلتقط أيضًا
// وثائق adhoc ووثائق مراحل لاحقة، فتمرّ البوابة على ما لا تملكه أو تسقط على ما
// لم يُنتَج بعد. القائمة صريحة، وغياب أي عنصر منها عيبٌ يُبلَّغ لا ملف يُتجاوز.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, classifyEvidenceFile } from "../evidence-contract/evidence-bytes.mjs";
import { P01_W2_GROUPS, P01_W2_NATIVE_MARKER } from "./p01-w2-groups.mjs";

const SCHEMA_VERSION = "1.0.0";
const TOOL = "polaris.p01.w2.evidence-bytes";

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

const canonical = process.env[P01_W2_NATIVE_MARKER] === "1";
const suffix = canonical ? "" : ".adhoc";

const documents = [
  `phase-01-ipc${suffix}.json`,
  `phase-01-contract-tests${suffix}.json`,
  ...P01_W2_GROUPS.map((group) => `${group.evidence}${suffix}.json`),
];

function inspect(name) {
  const path = join(evidenceDirectory, name);
  const classification = classifyEvidenceFile(path);
  const record = {
    document: name,
    encoding_ok: classification.ok,
    reason_code: classification.reason_code,
    first_bytes: classification.first_bytes,
    length: classification.length,
    json_valid: false,
    line_endings_lf_only: false,
    exactly_one_trailing_newline: false,
  };

  if (!classification.ok) {
    record.ok = false;
    return record;
  }

  const text = readFileSync(path, "utf8");
  try {
    JSON.parse(text);
    record.json_valid = true;
  } catch (error) {
    record.json_error = error.message;
  }
  record.line_endings_lf_only = !text.includes("\r");
  record.exactly_one_trailing_newline = text.endsWith("\n") && !text.endsWith("\n\n");
  record.ok =
    record.encoding_ok && record.json_valid && record.line_endings_lf_only && record.exactly_one_trailing_newline;
  return record;
}

const results = documents.map(inspect);
const failed = results.filter((record) => record.ok !== true);

const document = {
  schema_version: SCHEMA_VERSION,
  tool: TOOL,
  phase: "PHASE-01",
  work_package: "P01-W2",
  canonical,
  platform: process.platform,
  measured_at: stamp(),
  contract: ["UTF-8", "no BOM", "valid JSON", "LF only", "exactly one trailing LF"],
  documents: results,
  summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
  evidence_complete: true,
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  reason_codes: failed.map((record) => `${record.document}:${record.reason_code}`),
};

const path = join(evidenceDirectory, `phase-01-w2-evidence-bytes${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

console.log(
  `P01-W2 evidence byte gate: ${String(document.summary.passed)}/${String(document.summary.total)} clean — ${document.verdict}`,
);
for (const record of failed) console.log(`  ${record.document}: ${record.reason_code}`);

process.exit(failed.length === 0 ? 0 : 1);
