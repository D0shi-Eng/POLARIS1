// البوابة النهائية لـPhase-01.
//
// لا تُكتب PASS بيد هنا ولا في أي مكان آخر. كل صفّ يُقرأ من الوثيقة التي يعيش
// فيها قياسه، وأي صفّ لا يجد قياسه يبقى NOT_TESTED. وBLOCKED وINCONCLUSIVE
// وNOT_TESTED لا تُرقّى إلى PASS أبدًا — لا بعدد، ولا بأغلبية، ولا لأن الباقي
// أخضر.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P01_CLAIMS } from "./p01-claims.mjs";
import { argument, evidenceSuffix, isCanonicalRun, P01_FINAL_GATE, P01_TOOLS, stamp } from "./p01-groups.mjs";

const SCHEMA_VERSION = "1.0.0";

const VERDICTS = ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"];

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { __unreadable: String(error.message ?? error) };
  }
}

/** يقرأ وثيقة قانونية، وإن غابت يقرأ نسخة التشغيل غير القانوني ويقول ذلك. */
function loadDocument(evidenceDirectory, base) {
  const canonicalPath = join(evidenceDirectory, `${base}.json`);
  const adhocPath = join(evidenceDirectory, `${base}.adhoc.json`);
  if (existsSync(canonicalPath)) return { document: readJson(canonicalPath), reference: `${base}.json`, canonical: true };
  if (existsSync(adhocPath)) return { document: readJson(adhocPath), reference: `${base}.adhoc.json`, canonical: false };
  return { document: null, reference: `${base}.json`, canonical: false };
}

/**
 * حكم ادعاء واحد كما تقوله وثيقته.
 *
 * `P01-B1` استثناء بالشكل لا بالقاعدة: وثيقته تحمل الحكم في جذرها لا داخل قائمة
 * ادعاءات، لأنها كُتبت في W1 قبل وجود هذا الشكل. القراءة تتعامل مع الشكلين.
 */
function claimVerdict(claim, documents) {
  const entry = documents[claim.document];
  if (entry === undefined || entry.document === null) {
    return { verdict: "NOT_TESTED", reason: `${claim.document} is absent`, source: claim.document, canonical: false };
  }
  const document = entry.document;
  if (document.__unreadable !== undefined) {
    return { verdict: "INCONCLUSIVE", reason: `${claim.document} is unreadable`, source: entry.reference, canonical: false };
  }

  const list = Array.isArray(document.claims) ? document.claims : [];
  const found = list.find((record) => record.claim_id === claim.id);
  if (found !== undefined) {
    return {
      verdict: VERDICTS.includes(found.verdict) ? found.verdict : "INCONCLUSIVE",
      reason: found.reason_code ?? "",
      source: entry.reference,
      canonical: entry.canonical && document.canonical === true,
    };
  }

  // وثيقة تحمل حكمها في جذرها: الأساس، والأداء، ومجموعات الاختبار.
  if (document.claim_id === claim.id || claim.document === "phase-01-performance" || claim.document === "phase-01-test-groups") {
    const verdict = document.verdict;
    return {
      verdict: VERDICTS.includes(verdict) ? verdict : "INCONCLUSIVE",
      reason: Array.isArray(document.reason_codes) ? document.reason_codes.join("; ") : "",
      source: entry.reference,
      canonical: entry.canonical && document.canonical === true,
    };
  }

  return { verdict: "NOT_TESTED", reason: `${claim.id} has no record in ${entry.reference}`, source: entry.reference, canonical: entry.canonical };
}

export function evaluateGate(root) {
  const evidenceDirectory = join(root, "evidence");
  const bases = [
    "phase-01-baseline",
    "phase-01-ipc",
    "phase-01-run",
    "phase-01-localization",
    "phase-01-accessibility",
    "phase-01-security",
    "phase-01-regression",
    "phase-01-desktop-e2e",
    "phase-01-performance",
    "phase-01-test-groups",
    "phase-01-evidence-bytes",
    "phase-01-final-gate",
  ];
  const documents = {};
  for (const base of bases) documents[base] = loadDocument(evidenceDirectory, base);

  // `P01-V1` يعيش في وثيقة البوابة نفسها، وقياسه في وثيقة البايتات.
  const byteGate = documents["phase-01-evidence-bytes"].document;

  const rows = P01_CLAIMS.map((claim) => {
    if (claim.id === "P01-V1") {
      const verdict = byteGate === null ? "NOT_TESTED" : byteGate.verdict === "PASS" ? "PASS" : "FAIL";
      return {
        claim_id: claim.id,
        condition: claim.condition,
        work_package: claim.work_package,
        tier: claim.tier,
        evidence_reference: join("evidence", documents["phase-01-evidence-bytes"].reference),
        verdict,
        reason_code: byteGate === null ? "BYTE_GATE_ABSENT" : (byteGate.reason_codes ?? []).join("; "),
        canonical_source: documents["phase-01-evidence-bytes"].canonical,
      };
    }
    const read = claimVerdict(claim, documents);
    return {
      claim_id: claim.id,
      condition: claim.condition,
      work_package: claim.work_package,
      tier: claim.tier,
      evidence_reference: join("evidence", read.source),
      verdict: read.verdict,
      reason_code: read.reason,
      canonical_source: read.canonical,
    };
  });

  const tally = Object.fromEntries(VERDICTS.map((verdict) => [verdict, rows.filter((row) => row.verdict === verdict).length]));
  const canonicalRun = isCanonicalRun();
  const nonCanonicalRows = rows.filter((row) => !row.canonical_source).map((row) => row.claim_id);

  // ما أظهره القياس، بمعزل عن ملكية التشغيل.
  let measuredVerdict;
  if (tally.FAIL > 0) measuredVerdict = "FAIL";
  else if (tally.BLOCKED > 0) measuredVerdict = "BLOCKED";
  else if (tally.NOT_TESTED > 0 || tally.INCONCLUSIVE > 0) measuredVerdict = "BLOCKED";
  else measuredVerdict = "PASS";

  const reasonCodes = [];
  for (const row of rows) {
    if (row.verdict !== "PASS") reasonCodes.push(`${row.claim_id}_${row.verdict}`);
  }
  if (!canonicalRun) reasonCodes.push("NOT_CANONICAL_RUN");
  if (nonCanonicalRows.length > 0) reasonCodes.push(`NON_CANONICAL_SOURCES:${nonCanonicalRows.length}`);

  // وحكم الوثيقة: تشغيل بلا علامة المشغّل ليس نتيجة Phase-01 مهما أظهر القياس.
  const verdict = canonicalRun ? measuredVerdict : "BLOCKED";
  const phase02Gate = verdict === "PASS" ? "ALLOWED" : "NOT_ALLOWED";

  const document = {
    schema_version: SCHEMA_VERSION,
    tool: P01_TOOLS.finalGate,
    phase: "PHASE-01",
    work_package: "P01-W12",
    canonical: canonicalRun,
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    measured_at: stamp(),
    repository_root: root,
    rules: [
      "a claim reads the document its measurement lives in",
      "an absent measurement is NOT_TESTED, never FAIL and never PASS",
      "BLOCKED, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
      "a run without the Phase-01 runner marker is not canonical evidence and cannot close the phase",
      "PHASE-02 opens only on PHASE-01 = PASS",
    ],
    sources: Object.fromEntries(
      Object.entries(documents).map(([base, entry]) => [
        base,
        { reference: entry.document === null ? null : join("evidence", entry.reference), canonical: entry.canonical },
      ]),
    ),
    conditions: rows,
    tally,
    total_conditions: rows.length,
    evidence_complete: rows.every((row) => row.verdict !== "NOT_TESTED"),
    measured_verdict: measuredVerdict,
    verdict,
    phase_02_gate: phase02Gate,
    reason_codes: reasonCodes,
  };

  if (!canonicalRun) {
    document.non_canonical_note =
      "this run did not carry the Phase-01 runner marker, so it is not canonical evidence and must not be read as a Phase-01 result";
  }

  mkdirSync(evidenceDirectory, { recursive: true });
  const path = join(evidenceDirectory, `${P01_FINAL_GATE}${evidenceSuffix()}.json`);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  assertWrittenEvidence(path);
  return { document, path };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { document, path } = evaluateGate(root);
  for (const row of document.conditions) {
    console.log(`${row.verdict.padEnd(13)} ${row.claim_id.padEnd(10)} ${row.condition.slice(0, 74)}`);
  }
  console.log("");
  console.log(`conditions      : ${document.total_conditions}`);
  for (const [verdict, count] of Object.entries(document.tally)) console.log(`${verdict.padEnd(16)}: ${count}`);
  console.log("");
  console.log(`PHASE-01 = ${document.verdict} (measured ${document.measured_verdict})`);
  console.log(`PHASE-02 GATE = ${document.phase_02_gate}`);
  console.log(`wrote ${path}`);
  process.exitCode = document.verdict === "PASS" ? 0 : 1;
}
