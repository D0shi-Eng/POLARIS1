// بوابة بايتات أدلة Phase-01.
//
// التصنيف نفسه المستعمل منذ Phase-00: UTF-8 بلا BOM، وJSON صالح، وLF فقط،
// وسطر جديد أخير واحد بالضبط. لا تصنيف ثانٍ هنا — هذا مُغلِّف حول المُصنِّف
// القانوني، ويضيف شيئًا واحدًا: قائمة ما يجب أن يوجد.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { classifyEvidenceFile, isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, isCanonicalRun, P01_EVIDENCE, P01_FINAL_GATE, P01_TOOLS, stamp } from "./p01-groups.mjs";

const SCHEMA_VERSION = "1.0.0";

/** فحص إضافي فوق التصنيف: هل المستند يحمل الحقول التي تجعله دليلًا؟ */
function structuralCheck(path) {
  try {
    const document = JSON.parse(readFileSync(path, "utf8"));
    const required = ["schema_version", "tool", "phase", "canonical", "measured_at"];
    const absent = required.filter((field) => document[field] === undefined);
    return { ok: absent.length === 0, absent, verdict: document.verdict ?? null, canonical: document.canonical ?? null };
  } catch (error) {
    return { ok: false, absent: [], verdict: null, canonical: null, parse_error: String(error.message ?? error) };
  }
}

export function gate(root, options = {}) {
  const evidenceDirectory = join(root, "evidence");
  const suffix = evidenceSuffix();
  const records = [];

  const wanted = options.includeFinalGate === true ? [...P01_EVIDENCE, P01_FINAL_GATE] : P01_EVIDENCE;
  for (const base of wanted) {
    const name = `${base}${suffix}.json`;
    const path = join(evidenceDirectory, name);
    if (!existsSync(path)) {
      records.push({ document: name, present: false, ok: false, reason: "EVIDENCE_FILE_MISSING" });
      continue;
    }
    const classification = classifyEvidenceFile(path);
    const structure = structuralCheck(path);
    records.push({
      document: name,
      present: true,
      ok: classification.ok && structure.ok,
      reason: classification.ok ? (structure.ok ? "" : `MISSING_FIELDS:${structure.absent.join(",")}`) : classification.reason,
      bytes: classification.bytes ?? null,
      first_bytes: classification.first_bytes ?? null,
      trailing_newlines: classification.trailing_newlines ?? null,
      carriage_returns: classification.carriage_returns ?? null,
      verdict: structure.verdict,
      canonical: structure.canonical,
    });
  }

  // الدليل المجمّد الذي تعتمد عليه هذه المرحلة يُفحص كذلك، ولا يُكتب.
  for (const name of ["phase-01-baseline.json", "phase-00-final-gate.json"]) {
    const path = join(evidenceDirectory, name);
    if (!existsSync(path)) {
      records.push({ document: name, present: false, ok: false, reason: "PREREQUISITE_EVIDENCE_MISSING" });
      continue;
    }
    const classification = classifyEvidenceFile(path);
    records.push({
      document: name,
      present: true,
      ok: classification.ok,
      reason: classification.ok ? "" : classification.reason,
      bytes: classification.bytes ?? null,
      prerequisite: true,
    });
  }

  const summary = {
    checked: records.length,
    clean: records.filter((record) => record.ok).length,
    missing: records.filter((record) => !record.present).length,
    unclean: records.filter((record) => record.present && !record.ok).length,
  };

  const document = {
    schema_version: SCHEMA_VERSION,
    tool: P01_TOOLS.evidenceBytes,
    phase: "PHASE-01",
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    measured_at: stamp(),
    repository_root: root,
    pass: options.includeFinalGate === true ? "SECOND_AFTER_FINAL_GATE" : "FIRST_BEFORE_FINAL_GATE",
    contract: [
      "UTF-8 with no byte order mark",
      "valid JSON",
      "LF line endings only",
      "exactly one trailing LF",
      "the document declares schema_version, tool, phase, canonical and measured_at",
    ],
    documents: records,
    summary,
    evidence_complete: true,
    verdict: summary.clean === summary.checked ? "PASS" : "FAIL",
    reason_codes: records.filter((record) => !record.ok).map((record) => `${record.document}:${record.reason}`),
  };

  mkdirSync(evidenceDirectory, { recursive: true });
  const path = join(evidenceDirectory, `phase-01-evidence-bytes${suffix}.json`);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return { document, path };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { document, path } = gate(root, { includeFinalGate: process.argv.includes("--include-final-gate") });
  for (const record of document.documents) {
    console.log(`${record.ok ? "clean  " : "UNCLEAN"} ${record.document}${record.reason === "" ? "" : ` (${record.reason})`}`);
  }
  console.log(`byte gate: ${document.summary.clean}/${document.summary.checked}`);
  console.log(`wrote ${path}`);
  process.exitCode = document.verdict === "PASS" ? 0 : 1;
}
