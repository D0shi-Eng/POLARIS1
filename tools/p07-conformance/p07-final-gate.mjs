// البوابة النهائية لـPhase-07، وأحكام الإصدار المنفصلة.
//
// كل شرط يُقرأ من الوثيقة التي يعيش فيها قياسه، ويُعاد تقييم شروط البوابة نفسها
// (البايتات). لا ترقية: BLOCKED وINCONCLUSIVE وNOT_TESTED لا تصير PASS، وPHASE-07 = PASS
// فقط إن نجح كل شرط إلزامي في تشغيل قانوني. ثم فحص أخير للأسرار في الوثائق كما كُتبت.
//
// أحكام الإصدار لا تُدمج في حكم واحد:
//   PHASE-07        الحكم الهندسي لهذه المرحلة.
//   WINDOWS_RC      READY فقط إن نجحت المرحلة، وإلا NOT_READY.
//   SIGNING         ما يقوله Windows عن التوقيع، كما قاسه المشغّل.
//   MACOS           FOUNDATION_ONLY ما لم يوجد تشغيل أصلي على macOS (لا يوجد).
//   PUBLIC_RELEASE  محجوب حتى يكون هناك توقيع حقيقي، ولا يُنشر شيء من هنا أبدًا.
//
// الاستعمال: node p07-final-gate.mjs --root <root>

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { findSecretLeaks } from "../p04-conformance/p04-security.mjs";
import { evaluateClaim, P07_CLAIMS } from "./p07-claims.mjs";
import { argument, evidenceSuffix, header, isCanonicalRun, P07_EVIDENCE, P07_FINAL_GATE, P07_TOOLS, readJson, VERDICTS, writeEvidence } from "./p07-common.mjs";
import { loadInputs } from "./p07-derive.mjs";

export function releaseVerdicts(verdict, signing, inventory) {
  const signingStatus = signing?.status ?? "NOT_MEASURED";
  const signed = signingStatus === "SIGNED";
  return {
    phase_07: verdict,
    windows_rc: verdict === "PASS" ? "READY" : "NOT_READY",
    signing: signingStatus,
    macos: inventory?.platform?.macos_native_verified === true ? "NATIVE_VERIFIED" : "FOUNDATION_ONLY",
    public_release: verdict !== "PASS" ? "BLOCKED_ON_PHASE_07" : signed ? "READY_FOR_OWNER_DECISION" : "BLOCKED_ON_SIGNING",
    published: false,
    not_claimed: ["production ready", "enterprise ready", "macOS native verified", "signed build", "public release ready"].filter((claim) => !(claim === "signed build" && signed)),
  };
}

export function evaluateGate(root) {
  const suffix = evidenceSuffix();
  const inputs = loadInputs(root);
  const documents = Object.fromEntries(P07_EVIDENCE.map((base) => [base, readJson(join(root, "evidence", `${base}${suffix}.json`))]));
  const rows = P07_CLAIMS.map((claim) => {
    const reference = `evidence/${claim.document}${suffix}.json`;
    if (claim.document === P07_FINAL_GATE) {
      const evaluated = evaluateClaim(inputs, claim);
      return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: evaluated.verdict, reason_code: evaluated.reason_code };
    }
    const document = documents[claim.document];
    if (document === null || document === undefined) return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: "NOT_TESTED", reason_code: `${claim.document} is absent` };
    const found = Array.isArray(document.claims) ? document.claims.find((entry) => entry.claim_id === claim.id) : undefined;
    if (found === undefined) return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: "NOT_TESTED", reason_code: `no record in ${claim.document}` };
    return { claim_id: claim.id, condition: claim.condition, evidence_reference: reference, verdict: VERDICTS.includes(found.verdict) ? found.verdict : "INCONCLUSIVE", reason_code: found.reason_code ?? "" };
  });

  const leaks = [];
  for (const base of P07_EVIDENCE) {
    try {
      const hits = findSecretLeaks(readFileSync(join(root, "evidence", `${base}${suffix}.json`), "utf8"));
      if (hits.length > 0) leaks.push(`${base}: ${hits.join(",")}`);
    } catch {
      // وثيقة غائبة يُحاسَب عليها شرطها.
    }
  }
  if (leaks.length > 0) {
    const row = rows.find((r) => r.claim_id === "P07-S4");
    if (row !== undefined) {
      row.verdict = "FAIL";
      row.reason_code = `a key-shaped value is present in canonical evidence: ${leaks.join("; ")}`;
    }
  }

  const failing = rows.filter((r) => r.verdict !== "PASS");
  const canonical = isCanonicalRun();
  const verdict = !canonical
    ? "INCONCLUSIVE"
    : failing.some((r) => r.verdict === "FAIL")
      ? "FAIL"
      : failing.some((r) => r.verdict === "BLOCKED")
        ? "BLOCKED"
        : failing.length > 0
          ? "INCONCLUSIVE"
          : "PASS";

  return {
    rules: [
      "a condition reads the document its measurement lives in",
      "an absent measurement is NOT_TESTED, never PASS",
      "BLOCKED, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
      "a run without the Phase-07 runner marker cannot close the phase",
      "a prior gate counts only if it was re-run inside this run",
      "the release verdicts are separate and none of them is 'production ready'",
      "nothing is published, uploaded or signed with an invented certificate by this gate or its runner",
    ],
    sources: Object.fromEntries(P07_EVIDENCE.map((base) => [base, { reference: `evidence/${base}${suffix}.json`, present: documents[base] !== null }])),
    conditions: rows,
    summary: {
      conditions: rows.length,
      pass: rows.filter((r) => r.verdict === "PASS").length,
      fail: rows.filter((r) => r.verdict === "FAIL").length,
      blocked: rows.filter((r) => r.verdict === "BLOCKED").length,
      inconclusive: rows.filter((r) => r.verdict === "INCONCLUSIVE").length,
      not_tested: rows.filter((r) => r.verdict === "NOT_TESTED").length,
    },
    evidence_secret_rescan: leaks.length === 0 ? "CLEAN" : "LEAK_FOUND",
    verdict,
    release_verdicts: releaseVerdicts(verdict, inputs.signing, inputs.inventory),
    reason_codes: [...(canonical ? [] : ["NOT_CANONICAL_RUN"]), ...failing.map((r) => `${r.claim_id}_${r.verdict}`)],
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const gate = evaluateGate(root);
  const path = writeEvidence(join(root, "evidence", `${P07_FINAL_GATE}${evidenceSuffix()}.json`), { ...header(P07_TOOLS.gate, root), ...gate });
  for (const row of gate.conditions) console.log(`${row.verdict.padEnd(13)} ${row.claim_id}  ${String(row.reason_code).slice(0, 200)}`);
  console.log(`wrote ${path}`);
  console.log(`PHASE-07       = ${gate.verdict}`);
  for (const [key, value] of Object.entries(gate.release_verdicts)) if (typeof value === "string") console.log(`${key.toUpperCase().padEnd(14)} = ${value}`);
  process.exitCode = gate.verdict === "PASS" ? 0 : 1;
}
