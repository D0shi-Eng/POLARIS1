// اشتقاق دليل P01-W2 القانوني: evidence/phase-01-ipc.json.
//
// الاشتقاق لا يقيس شيئًا بنفسه. يقرأ ما قاسته المجموعات، ويقرأ الحقائق البنيوية
// من مصدر الحقيقة نفسه (المخططات والسجل)، ثم يربط كل ادعاء بالوثيقة التي يعيش
// فيها قياسه — انضباط ADR-016 نفسه. ادعاء بلا قياس يبقى NOT_TESTED، ولا يُرقّى.
//
// وأهم ما يفعله هنا هو الامتناع: P01-C3 نصفه عقدٌ ونصفه مضيف. النصف الأول
// مُقاس هنا؛ الثاني لا مضيف له بعد. فيُكتب النصف الأول PASS باسمه، ويبقى
// الادعاء الكامل NOT_TESTED حتى P01-W3. جمعهما في PASS واحدة هو بالضبط الترقية
// التي تمنعها مصفوفة البوابة.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, readCanonicalEvidenceJson } from "../evidence-contract/evidence-bytes.mjs";
import { P01_W2_GROUPS, P01_W2_IPC_TOOL, P01_W2_NATIVE_MARKER } from "./p01-w2-groups.mjs";

const SCHEMA_VERSION = "1.0.0";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const root = argument("--root", process.cwd());
const contracts = join(root, "contracts");
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env[P01_W2_NATIVE_MARKER] === "1";
const suffix = canonical ? "" : ".adhoc";
const startedAt = stamp();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ── 1 الشرط المسبق: P01-B1 ──────────────────────────────────────────────────

let baseline = null;
let baselineReason = "";
try {
  baseline = readCanonicalEvidenceJson(join(evidenceDirectory, "phase-01-baseline.json"));
} catch (error) {
  baselineReason = `P01_B1_EVIDENCE_UNREADABLE: ${error.message}`;
}

const baselineSatisfied =
  baseline !== null &&
  baseline.claim_id === "P01-B1" &&
  baseline.verdict === "PASS" &&
  baseline.canonical === true &&
  baseline.native === true &&
  baseline.evidence_complete === true;

if (baseline !== null && !baselineSatisfied) {
  baselineReason = "P01_B1_NOT_PASS";
}

// ── 2 نتائج المجموعات ───────────────────────────────────────────────────────

let groups = null;
let groupsReason = "";
try {
  groups = readJson(join(evidenceDirectory, `phase-01-contract-tests${suffix}.json`));
} catch (error) {
  groupsReason = `TEST_GROUP_AGGREGATE_UNREADABLE: ${error.message}`;
}

function groupRecord(id) {
  return groups === null ? undefined : groups.groups.find((record) => record.group_id === id);
}

function groupsVerdict(ids) {
  const records = ids.map(groupRecord);
  if (records.some((record) => record === undefined)) return { verdict: "NOT_TESTED", reason: "GROUP_RECORD_MISSING" };
  if (records.some((record) => record.evidence_complete !== true)) {
    return { verdict: "INCONCLUSIVE", reason: "GROUP_EVIDENCE_INCOMPLETE" };
  }
  if (records.some((record) => record.verdict === "BLOCKED")) return { verdict: "BLOCKED", reason: "GROUP_BLOCKED" };
  if (records.some((record) => record.verdict === "FAIL")) return { verdict: "FAIL", reason: "GROUP_FAILED" };
  if (records.some((record) => record.verdict !== "PASS")) {
    return { verdict: "INCONCLUSIVE", reason: "GROUP_NOT_PASS" };
  }
  return { verdict: "PASS", reason: "" };
}

// ── 3 الحقائق البنيوية، مقروءة من مصدر الحقيقة لا من ذاكرة الأداة ───────────

const envelope = readJson(join(contracts, "schemas", "ipc-envelope.v1.schema.json"));
const registry = readJson(join(contracts, "registry", "phase-01-ipc.registry.json"));
const errorMapping = readJson(join(contracts, "registry", "phase-01-error-mapping.json"));
const versionSource = readFileSync(join(contracts, "src", "version.ts"), "utf8");

const supportedMatch = /IPCEnvelopeV1:\s*\{\s*major:\s*(\d+),\s*minor:\s*(\d+)\s*\}/.exec(versionSource);
const supportedVersion = supportedMatch === null ? null : `${supportedMatch[1]}.${supportedMatch[2]}`;

const operations = envelope.$defs.Operation.enum;
const desktopOperations = operations.filter((operation) => operation.startsWith("desktop."));

const structure = {
  envelope_contract: "IPCEnvelopeV1",
  supported_version: supportedVersion,
  operation_set_closed: Array.isArray(envelope.$defs.Operation.enum) && !("pattern" in envelope.$defs.Operation),
  operation_count: operations.length,
  frozen_operations: operations.filter((operation) => !operation.startsWith("desktop.")),
  desktop_operations: desktopOperations,
  desktop_operation_count: desktopOperations.length,
  registry_operation_count: registry.operations.length,
  registry_implementation_status: registry.implementation_status,
  all_desktop_operations_read_only: registry.operations.every((record) => record.effect === "READ_ONLY"),
  all_desktop_operations_idempotency_not_required: registry.operations.every(
    (record) => record.idempotency === "NOT_REQUIRED",
  ),
  owning_services: [...new Set(registry.operations.map((record) => record.owner))].sort(),
  error_categories: errorMapping.entries.map((entry) => entry.category),
  error_detail_crosses_boundary: errorMapping.entries.some((entry) => entry.detail_may_cross_boundary === true),
};

// ── 4 الادعاءات ─────────────────────────────────────────────────────────────

function claim(id, condition, groupIds, extra = {}) {
  const derived = groups === null ? { verdict: "INCONCLUSIVE", reason: groupsReason } : groupsVerdict(groupIds);
  return {
    claim_id: id,
    condition,
    work_package: "P01-W2",
    tier: "any",
    measured_by: groupIds,
    evidence_reference: join("evidence", `phase-01-contract-tests${suffix}.json`),
    verdict: derived.verdict,
    reason_code: derived.reason,
    ...extra,
  };
}

const claims = [
  claim("P01-C1", "IPCEnvelopeV1 1.1 verifies and 1.0 documents remain valid", ["P01-CV", "P01-IPC", "P01-X"]),
  claim(
    "P01-C2",
    "every Phase-01 operation has request schema, response schema, error behaviour, trust boundary and owning service",
    ["P01-IPC", "P01-BS", "P01-AV", "P01-ST", "P01-ER", "P01-SH", "P01-RG"],
  ),
  claim(
    "P01-C3.contract",
    "the contract set contains no generic dispatch endpoint, and a schema-valid operation is not thereby routed",
    ["P01-RG", "P01-X"],
    {
      note:
        "this is the contract half of P01-C3 only. The host half — that no generic dispatch endpoint exists in a running host — has no host to measure yet and is P01-W3's.",
    },
  ),
  {
    claim_id: "P01-C3",
    condition: "no generic dispatch endpoint exists in the host",
    work_package: "P01-W2/W3",
    tier: "any",
    measured_by: [],
    evidence_reference: join("evidence", "phase-01-security.json"),
    verdict: "NOT_TESTED",
    reason_code: "NO_HOST_TO_MEASURE",
    note: "P01-W2 proves the contract half and records it as P01-C3.contract. The claim itself lands in P01-W3.",
  },
];

const regression = groupRecord("P01-R0");
const regressionVerdict = regression === undefined ? "NOT_TESTED" : regression.verdict;

// ── 5 الحكم ─────────────────────────────────────────────────────────────────

const mandatory = claims.filter((entry) => entry.claim_id === "P01-C1" || entry.claim_id === "P01-C2");
const reasonCodes = [];

if (!baselineSatisfied) reasonCodes.push(baselineReason || "P01_B1_NOT_SATISFIED");
if (groups === null) reasonCodes.push(groupsReason);
// ADR-019 D2: بعد الامتداد الإضافي 1.2 يبقى شرط P01 أن يدعم الظرف 1.1 على الأقل
// ضمن الرئيسي 1؛ رقم الإصدار الأعلى لا يُسقط عملية من عمليات 1.1.
if (!/^1\.([1-9]\d*)$/.test(structure.supported_version ?? "")) reasonCodes.push("ENVELOPE_NOT_AT_LEAST_1_1");
if (!structure.operation_set_closed) reasonCodes.push("OPERATION_SET_NOT_CLOSED");
if (structure.desktop_operation_count !== 5) reasonCodes.push("DESKTOP_OPERATION_COUNT_NOT_FIVE");
if (structure.registry_operation_count !== 5) reasonCodes.push("REGISTRY_OPERATION_COUNT_NOT_FIVE");
if (!structure.all_desktop_operations_read_only) reasonCodes.push("SIDE_EFFECTING_DESKTOP_OPERATION");
if (structure.error_detail_crosses_boundary) reasonCodes.push("INTERNAL_DETAIL_MAY_CROSS_BOUNDARY");
if (regressionVerdict !== "PASS") reasonCodes.push(`PHASE_00_CONTRACT_REGRESSION_${regressionVerdict}`);
for (const entry of mandatory) {
  if (entry.verdict !== "PASS") reasonCodes.push(`${entry.claim_id}_${entry.verdict}`);
}
if (!canonical) reasonCodes.push("NOT_CANONICAL_RUN");

const evidenceComplete = groups !== null && baseline !== null;

// ما أظهره القياس نفسه، بمعزل عن ملكية التشغيل.
let measuredVerdict;
if (!evidenceComplete) measuredVerdict = "INCONCLUSIVE";
else if (mandatory.some((entry) => entry.verdict === "FAIL") || regressionVerdict === "FAIL") measuredVerdict = "FAIL";
else if (mandatory.some((entry) => entry.verdict === "BLOCKED")) measuredVerdict = "BLOCKED";
else if (reasonCodes.filter((code) => code !== "NOT_CANONICAL_RUN").length > 0) measuredVerdict = "INCONCLUSIVE";
else measuredVerdict = "PASS";

// وحكم الوثيقة. تشغيل بلا علامة المشغّل ليس نتيجة W2 مهما أظهر القياس: PASS
// مكتوبة في وثيقة غير قانونية تُقرأ لاحقًا كإغلاق لحزمة عمل لم تُغلق. القياس
// يبقى منشورًا كاملًا تحت measured_verdict، فلا يُخفى ولا يُرقّى.
const verdict = canonical ? measuredVerdict : "INCONCLUSIVE";

const document = {
  schema_version: SCHEMA_VERSION,
  tool: P01_W2_IPC_TOOL,
  phase: "PHASE-01",
  work_package: "P01-W2",
  canonical,
  platform: process.platform,
  native: process.platform === "win32",
  node_version: process.version,
  run_started: startedAt,
  measured_at: stamp(),
  repository_root: root,
  prerequisite: {
    claim_id: "P01-B1",
    evidence_reference: join("evidence", "phase-01-baseline.json"),
    satisfied: baselineSatisfied,
    verdict: baseline === null ? "NOT_TESTED" : baseline.verdict,
    run_id: baseline === null ? "" : (baseline.run_id ?? ""),
  },
  decisions: [
    { id: "ADR-017", title: "the Phase-01 desktop operation set", status_at_w2_close: "ACCEPTED" },
    { id: "ADR-018", title: "the Phase-01 desktop host stack", status_at_w2_close: "ACCEPTED" },
  ],
  structure,
  test_groups: {
    evidence_reference: join("evidence", `phase-01-contract-tests${suffix}.json`),
    declared: P01_W2_GROUPS.map((group) => group.id),
    summary: groups === null ? null : groups.summary,
  },
  phase_00_regression: {
    group_id: "P01-R0",
    verdict: regressionVerdict,
    tests: regression === undefined ? null : regression.tests,
    failed: regression === undefined ? null : regression.failed,
  },
  claims,
  rules: [
    "a claim reads the document its measurement lives in; an absent measurement is NOT_TESTED",
    "BLOCKED, INCONCLUSIVE and NOT_TESTED are never promoted to PASS",
    "a run without the P01-W2 runner's marker is not canonical evidence and cannot close the work package",
    "the contract half of a claim is recorded under its own name, never merged into the whole claim",
  ],
  evidence_complete: evidenceComplete,
  measured_verdict: measuredVerdict,
  verdict,
  reason_codes: reasonCodes,
};

if (!canonical) {
  document.non_canonical_note =
    "this run did not carry the P01-W2 runner's marker, so it is not canonical evidence and must not be read as a P01-W2 result";
}

const path = join(evidenceDirectory, `phase-01-ipc${suffix}.json`);
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
assertWrittenEvidence(path);

console.log(`P01-W2 verdict: ${verdict} (measured ${measuredVerdict})${reasonCodes.length > 0 ? ` — ${reasonCodes.join(", ")}` : ""}`);
console.log(`wrote ${path}`);

process.exit(verdict === "PASS" ? 0 : 1);
