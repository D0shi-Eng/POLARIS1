// بوابة Phase-08 النهائية: تقرأ الوثائق الثلاث عشرة وتحكم، ثم تُصدر الأحكام المنفصلة. لا حكم هنا
// يُرقّى: غياب القياس NOT_TESTED، ونقص البيئة BLOCKED، ولا يُقال «جاهز للإنتاج» أبدًا.
//
// الاستعمال: node p08-final-gate.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { MODEL_DEFERRED_CLAIMS } from "./p08-derive.mjs";
import { argument, evidenceSuffix, header, isCanonicalRun, P08_EVIDENCE, P08_FINAL_GATE, P08_TOOLS, readJson, worst, writeEvidence } from "./p08-common.mjs";

const verdictOfDoc = (docs, name) => docs[name]?.verdict ?? "NOT_TESTED";

const FUNCTIONAL_DOCUMENTS = ["phase-08-run", "phase-08-execution", "phase-08-browser", "phase-08-artifacts", "phase-08-ux", "phase-08-native-e2e", "phase-08-real-model", "phase-08-security"];

/**
 * POLARIS_FUNCTIONAL_RC (الإغلاق الوظيفي، 2026-09-30): PASS فقط حين تنجح الأسطح الحتمية والشروط الستة عشر
 * المعتمدة على النموذج الحقيقي كلها. شرط منها مؤجَّل = NOT_PROVEN؛ وأي شرط غير ناجح أو غائب = FAIL مع السبب.
 */
export function functionalVerdict(docs) {
  const surfaces = FUNCTIONAL_DOCUMENTS.map((n) => [n, verdictOfDoc(docs, n)]).filter(([, x]) => x !== "DEFERRED");
  // الشرط يُقرأ من أي وثيقة تحمله؛ الغائب NOT_TESTED
  const claimAnywhere = (id) => Object.values(docs).flatMap((d) => d?.claims ?? []).find((c) => c.claim_id === id)?.verdict ?? "NOT_TESTED";
  const model = MODEL_DEFERRED_CLAIMS.map((id) => [id, claimAnywhere(id)]);
  const reason = (pairs) => pairs.map(([k, x]) => `${k}=${x}`).join(", ");
  const badSurfaces = surfaces.filter(([, x]) => x !== "PASS");
  if (badSurfaces.length > 0) return `FAIL (${reason(badSurfaces)})`;
  if (model.some(([, x]) => x === "DEFERRED")) return "NOT_PROVEN (real-model conditions deferred)";
  const badModel = model.filter(([, x]) => x !== "PASS");
  return badModel.length === 0 ? "PASS" : `FAIL (${reason(badModel)})`;
}

/** الأحكام المنفصلة، كلٌّ من وثائقه. */
export function releaseVerdicts(docs, phase07) {
  const v = (name) => verdictOfDoc(docs, name);
  const claimIn = (name, id) => docs[name]?.claims?.find((c) => c.claim_id === id)?.verdict ?? "NOT_TESTED";
  // وثيقة مؤجَّلة بكاملها (قرار المالك) لا تدخل الحكم؛ شروطها لا تُحسب نجاحًا ولا تُخفى.
  const live = (names) => names.map(v).filter((x) => x !== "DEFERRED");
  const model = claimIn("phase-08-real-model", "P08-MODEL-02");
  const functional = functionalVerdict(docs);
  return {
    phase_08: worst(live(P08_EVIDENCE)),
    polaris_functional_rc: functional,
    windows_rc: functional === "PASS" && phase07?.release_verdicts?.windows_rc === "READY" ? "READY" : "NOT_READY",
    real_model_verified: model === "PASS" ? "VERIFIED" : model === "DEFERRED" ? "DEFERRED_TO_LATER_PHASE" : model === "BLOCKED" ? "BLOCKED_ENVIRONMENT" : "NOT_VERIFIED",
    model_tests: model === "DEFERRED" ? "DEFERRED_TO_LATER_PHASE (owner decision 2026-09-30; not claimed in Phase-08)" : "INCLUDED",
    real_browser_verified: v("phase-08-browser") === "PASS" ? "VERIFIED" : "NOT_VERIFIED",
    execution_environment: v("phase-08-execution") === "PASS" ? "VERIFIED_APPCONTAINER_JOB" : "NOT_VERIFIED",
    artifact_pipeline: v("phase-08-artifacts") === "PASS" ? "VERIFIED" : "NOT_VERIFIED",
    scheduler: v("phase-08-scheduler") === "PASS" ? "VERIFIED" : v("phase-08-scheduler"),
    oauth_foundation: claimIn("phase-08-integrations", "P08-LCY-OAUTH-PKCE") === "PASS" ? "FOUNDATION_VERIFIED_NO_LIVE_PROVIDER_LOGIN" : "NOT_VERIFIED",
    signing: phase07?.release_verdicts?.signing ?? "UNKNOWN",
    macos: "FOUNDATION_ONLY / NOT_NATIVE_VERIFIED",
    public_release: "NOT_RELEASED",
    github_private_repository: "PENDING_FINAL_REPOSITORY_STEP",
    manus_functional_comparison: "NOT_MEASURED",
    not_claimed: ["production ready", "enterprise ready", "macOS support", "signed build", "public release", "parity with any other product"],
  };
}

export function gate(root) {
  const suffix = evidenceSuffix();
  const docs = Object.fromEntries(P08_EVIDENCE.map((name) => [name, readJson(join(root, "evidence", `${name}${suffix}.json`))]));
  const phase07 = readJson(join(root, "evidence", "phase-07-final-gate.json"));
  const all = P08_EVIDENCE.flatMap((name) => (docs[name]?.claims ?? [{ claim_id: `${name}-ABSENT`, condition: `${name} was derived`, verdict: "NOT_TESTED" }]).map((c) => ({ document: name, ...c })));
  const conditions = all.filter((c) => c.verdict !== "DEFERRED");
  const deferred = all.filter((c) => c.verdict === "DEFERRED");
  const count = (s) => conditions.filter((c) => c.verdict === s).length;
  const verdicts = releaseVerdicts(docs, phase07);
  const verdict = isCanonicalRun() ? verdicts.phase_08 : "INCONCLUSIVE";
  return {
    ...header(P08_TOOLS.gate),
    rules: [
      "a condition reads the document its measurement lives in",
      "an absent measurement is NOT_TESTED, never PASS",
      "an environment without a local model makes model-dependent conditions BLOCKED, never PASS",
      "BLOCKED, PARTIAL, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
      "a run without the Phase-08 runner marker cannot close the phase",
      "the release verdicts are separate and none of them is 'production ready'",
      "a DEFERRED condition (closed list of real-model conditions, owner decision) is listed apart, never counted as PASS",
    ],
    sources: Object.fromEntries(P08_EVIDENCE.map((n) => [n, { reference: `evidence/${n}${suffix}.json`, present: docs[n] !== null, verdict: verdictOfDoc(docs, n) }])),
    summary: { conditions: conditions.length, deferred: deferred.length, pass: count("PASS"), fail: count("FAIL"), partial: count("PARTIAL"), blocked: count("BLOCKED"), inconclusive: count("INCONCLUSIVE"), not_tested: count("NOT_TESTED") },
    not_passed: conditions.filter((c) => c.verdict !== "PASS").map((c) => ({ document: c.document, claim_id: c.claim_id, verdict: c.verdict, detail: c.detail ?? "" })),
    deferred: deferred.map((c) => ({ document: c.document, claim_id: c.claim_id, condition: c.condition, detail: c.detail ?? "" })),
    verdict,
    release_verdicts: verdicts,
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = gate(root);
  writeEvidence(join(root, "evidence", `${P08_FINAL_GATE}${evidenceSuffix()}.json`), result);
  console.log(`PHASE-08 = ${result.verdict}  (${result.summary.pass}/${result.summary.conditions} conditions PASS; ${result.deferred.length} deferred)`);
  for (const [k, v] of Object.entries(result.release_verdicts)) if (!Array.isArray(v)) console.log(`${k.toUpperCase().padEnd(28)} = ${v}`);
  for (const n of result.not_passed.slice(0, 60)) console.log(`  ${n.verdict.padEnd(11)} ${n.claim_id} ${String(n.detail).slice(0, 140)}`);
  process.exitCode = result.verdict === "PASS" ? 0 : 1;
}
