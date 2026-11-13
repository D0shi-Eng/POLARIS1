// البوابة النهائية لـPhase-02.
//
// كل شرط يُقرأ من الوثيقة التي يعيش فيها قياسه، ويُعاد تقييم الشروط التي تعيش
// في البوابة نفسها (البايتات، والتخطي). لا ترقية: BLOCKED وINCONCLUSIVE
// وNOT_TESTED لا تصير PASS، وPHASE-02 = PASS فقط إن نجح كل شرط إلزامي.
// ثم تُفحص الوثائق القانونية المكتوبة فعلًا بحثًا عن سرّ، قبل كتابة الحكم.
//
// الاستعمال: node p02-final-gate.mjs --root <root>

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P02_CLAIMS } from "./p02-claims.mjs";
import { argument, evidenceSuffix, header, isCanonicalRun, P02_EVIDENCE, P02_FINAL_GATE, P02_TOOLS, readJson, VERDICTS, writeEvidence } from "./p02-common.mjs";
import { loadInputs } from "./p02-derive.mjs";
import { evaluateClaim } from "./p02-evaluate.mjs";
import { findSecretLeaks } from "./p02-security.mjs";

export function evaluateGate(root) {
  const suffix = evidenceSuffix();
  const inputs = loadInputs(root);
  const documents = Object.fromEntries(P02_EVIDENCE.map((base) => [base, readJson(join(root, "evidence", `${base}${suffix}.json`))]));

  const rows = P02_CLAIMS.map((claim) => {
    if (claim.document === P02_FINAL_GATE) {
      const evaluated = evaluateClaim(inputs, claim);
      return { claim_id: claim.id, condition: claim.condition, evidence_reference: `evidence/${P02_FINAL_GATE}${suffix}.json`, verdict: evaluated.verdict, reason_code: evaluated.reason_code };
    }
    const document = documents[claim.document];
    const reference = `evidence/${claim.document}${suffix}.json`;
    if (document === null || document === undefined) return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: "NOT_TESTED", reason_code: `${claim.document} is absent` };
    const found = Array.isArray(document.claims) ? document.claims.find((entry) => entry.claim_id === claim.id) : undefined;
    if (found === undefined) return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: "NOT_TESTED", reason_code: `no record in ${claim.document}` };
    const verdict = VERDICTS.includes(found.verdict) ? found.verdict : "INCONCLUSIVE";
    return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict, reason_code: found.reason_code ?? "" };
  });

  // فحص أخير للأسرار في الوثائق القانونية كما كُتبت فعلًا.
  const leaks = [];
  for (const base of P02_EVIDENCE) {
    try {
      const hits = findSecretLeaks(readFileSync(join(root, "evidence", `${base}${suffix}.json`), "utf8"));
      if (hits.length > 0) leaks.push(`${base}: ${hits.join(",")}`);
    } catch {
      // وثيقة غائبة يُحاسَب عليها شرطها.
    }
  }
  if (leaks.length > 0) {
    const s5 = rows.find((row) => row.claim_id === "P02-S5");
    if (s5 !== undefined) {
      s5.verdict = "FAIL";
      s5.reason_code = `a key-shaped value is present in canonical evidence: ${leaks.join("; ")}`;
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
      "a run without the Phase-02 runner marker cannot close the phase",
      "PHASE-03 opens only on PHASE-02 = PASS",
      "no statement that POLARIS is better than any named product is made or implied by this gate",
    ],
    sources: Object.fromEntries(P02_EVIDENCE.map((base) => [base, { reference: `evidence/${base}${suffix}.json`, present: documents[base] !== null }])),
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
    phase_03_gate: verdict === "PASS" ? "ALLOWED" : "NOT_ALLOWED",
    reason_codes: [...(canonical ? [] : ["NOT_CANONICAL_RUN"]), ...failing.map((row) => `${row.claim_id}_${row.verdict}`)],
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const gate = evaluateGate(root);
  const path = writeEvidence(join(root, "evidence", `${P02_FINAL_GATE}${evidenceSuffix()}.json`), { ...header(P02_TOOLS.gate, root), ...gate });
  for (const row of gate.conditions) console.log(`${row.verdict.padEnd(13)} ${row.claim_id}  ${String(row.reason_code).slice(0, 180)}`);
  console.log(`wrote ${path}`);
  console.log(`PHASE-02 = ${gate.verdict}`);
  console.log(`PHASE-03 GATE = ${gate.phase_03_gate}`);
  process.exitCode = gate.verdict === "PASS" ? 0 : 1;
}
