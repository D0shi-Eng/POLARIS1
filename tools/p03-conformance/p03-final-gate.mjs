// البوابة النهائية لـPhase-03.
//
// كل شرط يُقرأ من الوثيقة التي يعيش فيها قياسه، ويُعاد تقييم الشروط التي تعيش
// في البوابة نفسها (البايتات، والتخطي، وأحكام المجموعات). لا ترقية: BLOCKED
// وINCONCLUSIVE وNOT_TESTED لا تصير PASS، وPHASE-03 = PASS فقط إن نجح كل شرط
// إلزامي. ثم تُفحص الوثائق القانونية المكتوبة فعلًا بحثًا عن سرّ قبل كتابة الحكم.
//
// الاستعمال: node p03-final-gate.mjs --root <root>

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P03_CLAIMS } from "./p03-claims.mjs";
import {
  argument,
  evidenceSuffix,
  header,
  isCanonicalRun,
  P03_EVIDENCE,
  P03_FINAL_GATE,
  P03_TOOLS,
  readJson,
  VERDICTS,
  writeEvidence,
} from "./p03-common.mjs";
import { loadInputs } from "./p03-derive.mjs";
import { evaluateClaim } from "./p03-evaluate.mjs";
import { findSecretLeaks } from "./p03-security.mjs";

export function evaluateGate(root) {
  const suffix = evidenceSuffix();
  const inputs = loadInputs(root);
  const documents = Object.fromEntries(P03_EVIDENCE.map((base) => [base, readJson(join(root, "evidence", `${base}${suffix}.json`))]));

  const rows = P03_CLAIMS.map((claim) => {
    if (claim.document === P03_FINAL_GATE) {
      const evaluated = evaluateClaim(inputs, claim);
      return {
        claim_id: claim.id,
        condition: claim.condition,
        evidence_reference: `evidence/${P03_FINAL_GATE}${suffix}.json`,
        verdict: evaluated.verdict,
        reason_code: evaluated.reason_code,
      };
    }
    const document = documents[claim.document];
    const reference = `evidence/${claim.document}${suffix}.json`;
    if (document === null || document === undefined) {
      return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: "NOT_TESTED", reason_code: `${claim.document} is absent` };
    }
    const found = Array.isArray(document.claims) ? document.claims.find((entry) => entry.claim_id === claim.id) : undefined;
    if (found === undefined) {
      return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: "NOT_TESTED", reason_code: `no record in ${claim.document}` };
    }
    const verdict = VERDICTS.includes(found.verdict) ? found.verdict : "INCONCLUSIVE";
    return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict, reason_code: found.reason_code ?? "" };
  });

  // فحص أخير للأسرار في الوثائق القانونية كما كُتبت فعلًا.
  const leaks = [];
  for (const base of P03_EVIDENCE) {
    try {
      const hits = findSecretLeaks(readFileSync(join(root, "evidence", `${base}${suffix}.json`), "utf8"));
      if (hits.length > 0) leaks.push(`${base}: ${hits.join(",")}`);
    } catch {
      // وثيقة غائبة يُحاسَب عليها شرطها.
    }
  }
  if (leaks.length > 0) {
    const s4 = rows.find((row) => row.claim_id === "P03-S4");
    if (s4 !== undefined) {
      s4.verdict = "FAIL";
      s4.reason_code = `a key-shaped value is present in canonical evidence: ${leaks.join("; ")}`;
    }
  }

  const failing = rows.filter((row) => row.verdict !== "PASS");
  const canonical = isCanonicalRun();
  const verdict = !canonical
    ? "INCONCLUSIVE"
    : failing.some((row) => row.verdict === "FAIL")
      ? "FAIL"
      : failing.some((row) => row.verdict === "BLOCKED")
        ? "BLOCKED"
        : failing.length > 0
          ? "INCONCLUSIVE"
          : "PASS";

  return {
    rules: [
      "a condition reads the document its measurement lives in",
      "an absent measurement is NOT_TESTED, never PASS",
      "BLOCKED, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
      "a run without the Phase-03 runner marker cannot close the phase",
      "a prior gate counts only if it was re-run inside this run",
      "PHASE-04 opens only on PHASE-03 = PASS",
      "no statement that POLARIS is better than any named product is made or implied by this gate",
    ],
    sources: Object.fromEntries(P03_EVIDENCE.map((base) => [base, { reference: `evidence/${base}${suffix}.json`, present: documents[base] !== null }])),
    conditions: rows,
    summary: {
      conditions: rows.length,
      pass: rows.filter((row) => row.verdict === "PASS").length,
      fail: rows.filter((row) => row.verdict === "FAIL").length,
      blocked: rows.filter((row) => row.verdict === "BLOCKED").length,
      inconclusive: rows.filter((row) => row.verdict === "INCONCLUSIVE").length,
      not_tested: rows.filter((row) => row.verdict === "NOT_TESTED").length,
    },
    evidence_secret_rescan: leaks.length === 0 ? "CLEAN" : "LEAK_FOUND",
    verdict,
    phase_04_gate: verdict === "PASS" ? "ALLOWED" : "NOT_ALLOWED",
    reason_codes: [...(canonical ? [] : ["NOT_CANONICAL_RUN"]), ...failing.map((row) => `${row.claim_id}_${row.verdict}`)],
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const gate = evaluateGate(root);
  const path = writeEvidence(join(root, "evidence", `${P03_FINAL_GATE}${evidenceSuffix()}.json`), { ...header(P03_TOOLS.gate, root), ...gate });
  for (const row of gate.conditions) console.log(`${row.verdict.padEnd(13)} ${row.claim_id}  ${String(row.reason_code).slice(0, 180)}`);
  console.log(`wrote ${path}`);
  console.log(`PHASE-03 = ${gate.verdict}`);
  console.log(`PHASE-04 GATE = ${gate.phase_04_gate}`);
  process.exitCode = gate.verdict === "PASS" ? 0 : 1;
}
