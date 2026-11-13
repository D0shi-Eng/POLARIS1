// بوابة بايتات أدلة Phase-03: UTF-8 بلا BOM، JSON صالح، LF وحده، وسطر أخير واحد.
//
// مُغلِّف حول المصنِّف القانوني، ويضيف قائمة ما يجب أن يوجد. وثيقة البوابة
// النهائية تُفحص في تمريرة ثانية بعد كتابتها (--include-final-gate).
//
// الاستعمال: node p03-evidence-bytes.mjs --root <root> [--include-final-gate]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyEvidenceFile, isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, header, P03_EVIDENCE, P03_FINAL_GATE, P03_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p03-common.mjs";

export function inspectBytes(path, options = {}) {
  if (!existsSync(path)) return { present: false, ok: false, reason: "EVIDENCE_FILE_MISSING" };
  const classification = classifyEvidenceFile(path);
  if (!classification.ok) return { present: true, ok: false, reason: classification.reason_code };
  const text = readFileSync(path, "utf8");
  const problems = [];
  if (text.includes("\r")) problems.push("CARRIAGE_RETURN_PRESENT");
  if (!text.endsWith("\n")) problems.push("NO_FINAL_NEWLINE");
  if (text.endsWith("\n\n")) problems.push("MORE_THAN_ONE_FINAL_NEWLINE");
  let document = null;
  try {
    document = JSON.parse(text);
  } catch {
    problems.push("INVALID_JSON");
  }
  if (document !== null && options.prerequisite !== true) {
    const absent = ["schema_version", "tool", "phase", "canonical", "measured_at"].filter((field) => document[field] === undefined);
    if (absent.length > 0) problems.push(`MISSING_FIELDS:${absent.join(",")}`);
  }
  return {
    present: true,
    ok: problems.length === 0,
    reason: problems.join(";"),
    bytes: classification.length,
    verdict: document?.verdict ?? null,
    canonical: document?.canonical ?? null,
  };
}

export function byteGate(root, options = {}) {
  const suffix = evidenceSuffix();
  const names = options.includeFinalGate === true ? [...P03_EVIDENCE, P03_FINAL_GATE] : [...P03_EVIDENCE];
  const records = names.map((base) => ({ document: `${base}${suffix}.json`, ...inspectBytes(join(root, "evidence", `${base}${suffix}.json`)) }));
  for (const prerequisite of ["phase-00-final-gate.json", "phase-01-final-gate.json", "phase-02-final-gate.json"]) {
    // وثائق المراحل السابقة لها بنيتها الخاصة؛ البايتات وحدها تُفحص هنا.
    records.push({ document: prerequisite, prerequisite: true, ...inspectBytes(join(root, "evidence", prerequisite), { prerequisite: true }) });
  }
  const summary = {
    checked: records.length,
    clean: records.filter((record) => record.ok).length,
    missing: records.filter((record) => !record.present).length,
    unclean: records.filter((record) => record.present && !record.ok).length,
  };
  return { records, summary, verdict: summary.clean === summary.checked ? "PASS" : "FAIL" };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const include = process.argv.includes("--include-final-gate");
  const result = byteGate(root, { includeFinalGate: include });
  writeEvidence(join(root, RAW_DIRECTORY, include ? "evidence-bytes-final.local.json" : "evidence-bytes.local.json"), {
    ...header(P03_TOOLS.bytes, root),
    ...result,
  });
  for (const record of result.records) console.log(`${record.ok ? "clean  " : "UNCLEAN"} ${record.document} ${record.reason ?? ""}`);
  console.log(`byte gate: ${result.summary.clean}/${result.summary.checked} clean`);
  process.exitCode = result.verdict === "PASS" ? 0 : 1;
}
