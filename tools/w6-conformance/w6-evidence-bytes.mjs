// بوابة بايتات الدليل، موسَّعة على كل دليل قانوني — لا على قائمة مكتوبة بيد.
//
// العيب الذي تغلقه (W6-DISCOVERIES D-01): بوابة W5 تحمل قائمة أسماء ثابتة تضم
// ما يكتبه PowerShell و Node، ولا تضم ما تكتبه المحوّلات الأصلية بلغة C#. أربعة
// ملفات دليل قانونية تقع خارجها، وثلاثتها كانت بلا سطر جديد ختامي. الدليل لم
// يكن كاذبًا؛ كان خارج مدى العقد. والقائمة المكتوبة بيد تُنسى، فالاكتشاف هنا
// بالنمط: كل ملف دليل قانوني يدخل البوابة لأنه موجود، لا لأن أحدًا تذكّره.
//
// والبنود الثلاثة التي يضيفها W6 فوق مصنِّف W5 (وهو يقرأ BOM وحده):
//   LF فقط          — لا CRLF داخل مستند دليل
//   وثيقة JSON صالحة — تُقرأ بلا معالجة مسبقة
//   سطر ختامي واحد   — لا صفر ولا اثنان
//
// الملفات غير القانونية عمدًا — عيّنات العيوب، ونسخ adhoc و local — تُستثنى
// بالاسم لا بالصمت: الاستثناء يظهر في الدليل مع سببه.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, classifyEvidenceFile } from "../evidence-contract/evidence-bytes.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * ما ليس دليلًا قانونيًا.
 *
 * `.adhoc` و `.local`  : تشغيل لم يحمل علامة المشغّل، ويعلن ذلك عن نفسه.
 * `invalid-provenance` و `stale-inconsistent` و `defect` : عيّنات عيوب مقصودة،
 *                        وجودها بشكل فاسد هو الغرض منها، وإصلاحها يفقدها معناها.
 * `windows-sandbox`    : سجل بيئة من W1، سابق لعقد البايتات ومجمَّد مع أدلته.
 */
const NON_CANONICAL = [
  { pattern: /\.adhoc\.json$/, reason: "a run without the runner's marker declares itself non-canonical" },
  { pattern: /\.local\.json$/, reason: "a local, non-native record that claims no measured result" },
  { pattern: /invalid-provenance/, reason: "a deliberate defect fixture: its provenance is the defect" },
  { pattern: /stale-inconsistent/, reason: "a deliberate defect fixture: a stale, BOM-prefixed document" },
  { pattern: /-defect\./, reason: "a defect record kept as a fixture" },
  { pattern: /^windows-sandbox\.json$/, reason: "a frozen W1 environment record, written before the byte contract" },
];

function nonCanonicalReason(name) {
  return NON_CANONICAL.find((entry) => entry.pattern.test(name))?.reason ?? "";
}

/** بنود W6 فوق مصنِّف BOM: سطور LF، JSON صالح، وسطر ختامي واحد بالضبط. */
function inspect(path) {
  const bomClassification = classifyEvidenceFile(path);
  const defects = [];
  if (!bomClassification.ok) defects.push(bomClassification.reason_code);

  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return { ok: false, defects: ["EVIDENCE_FILE_MISSING"], bytes: 0 };
  }

  const text = buffer.toString("utf8");
  if (text.includes("\r\n")) defects.push("EVIDENCE_CRLF_PRESENT");
  else if (text.includes("\r")) defects.push("EVIDENCE_LONE_CR_PRESENT");
  if (!text.endsWith("\n")) defects.push("EVIDENCE_NO_TRAILING_NEWLINE");
  else if (text.endsWith("\n\n")) defects.push("EVIDENCE_MULTIPLE_TRAILING_NEWLINES");
  try {
    JSON.parse(text);
  } catch (error) {
    defects.push(`EVIDENCE_NOT_VALID_JSON: ${error.message}`);
  }

  return { ok: defects.length === 0, defects, bytes: buffer.length };
}

const root = argument("--root", process.cwd());
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env["POLARIS_W6_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";

const started = stamp();
const names = readdirSync(evidenceDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();

const checked = [];
const excluded = [];
for (const name of names) {
  const reason = nonCanonicalReason(name);
  if (reason !== "") {
    excluded.push({ file: name, reason });
    continue;
  }
  const result = inspect(join(evidenceDirectory, name));
  checked.push({ file: name, ok: result.ok, defects: result.defects, bytes: result.bytes });
}

const defective = checked.filter((entry) => !entry.ok);

const document = {
  schema_version: "1.0.0",
  tool: "polaris.w6.evidence-bytes",
  canonical,
  claim_id: "W6-BYTES",
  description: "every canonical evidence document is UTF-8 without a BOM, LF-only, valid JSON, and ends with exactly one newline",
  contract: "UTF-8 no BOM · LF only · valid JSON document · exactly one trailing LF",
  discovery_note:
    "W5's gate carried a hand-kept list of seventeen names and reached sixteen files. Discovery here is by pattern, so a new producer of canonical evidence cannot be forgotten.",
  platform: process.platform,
  native: process.platform === "win32",
  measurement_started: started,
  measurement_completed: stamp(),
  evidence_complete: true,
  files_seen: names.length,
  checked: checked.length,
  excluded,
  defects: defective,
  results: checked,
  verdict: defective.length === 0 ? "PASS" : "FAIL",
  reason_code: defective.length === 0 ? "" : "W6_EVIDENCE_ENCODING_DEFECT",
  evidence_reference: join("evidence", `w6-evidence-bytes${suffix}.json`),
};

if (!canonical) {
  document.non_canonical_note =
    "this run did not carry the W6 runner's marker, so it is not canonical evidence and must not be read as a W6 result";
}

const path = join(evidenceDirectory, `w6-evidence-bytes${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

console.log(
  `W6 evidence bytes: ${String(checked.length)} canonical documents checked, ` +
    `${String(excluded.length)} excluded by declared reason, ${String(defective.length)} defective`,
);
for (const entry of defective) console.log(`  ${entry.file}: ${entry.defects.join(", ")}`);

process.exit(defective.length === 0 ? 0 : 1);
