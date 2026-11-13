// اشتقاق وثائق Phase-01 المشتقّة: التشغيل، والتوطين، والوصول، والأمن، والانحدار.
//
// الاشتقاق لا يقيس. يقرأ ما قاسته المجموعات وما رصده المشغّل الأصلي وما تقوله
// الشجرة عن نفسها، ثم يضع كل ادعاء في الوثيقة التي يعيش فيها قياسه. ما لم يُقَس
// يبقى NOT_TESTED؛ ولا شيء يُرقّى لأن التشغيل كان مزعجًا.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { aggregate, claimsForDocument, P01_CLAIMS } from "./p01-claims.mjs";
import { collectFacts } from "./p01-facts.mjs";
import { argument, evidenceSuffix, isCanonicalRun, P01_TOOLS, stamp } from "./p01-groups.mjs";
import { RAW_PROBE_NAME } from "./p01-native.mjs";
import { STRIDE_SURFACES } from "./p01-stride.mjs";

const SCHEMA_VERSION = "1.0.0";

/** الوثائق التي تكتبها هذه الأداة، وعنوان كلٍّ منها. */
const DOCUMENTS = [
  ["phase-01-run", "P01-W3..W6/W11", "the shell as a product: build, hydration, navigation, honest surfaces"],
  ["phase-01-localization", "P01-W7", "nine locales architecturally, Arabic and English proven"],
  ["phase-01-accessibility", "P01-W8", "keyboard, focus, landmarks, names and states"],
  ["phase-01-security", "P01-W10", "the denial proofs and the STRIDE review"],
  ["phase-01-regression", "P01-W10", "Phase-00 after Phase-01"],
];

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function firstExisting(directory, base) {
  return readJson(join(directory, `${base}.json`)) ?? readJson(join(directory, `${base}.adhoc.json`));
}

/** حكم شرط واحد، مقروءًا من الوثيقة التي يخصّها. */
function evaluateRequirement(requirement, context) {
  switch (requirement.kind) {
    case "group": {
      const group = (context.groups?.groups ?? []).find((entry) => entry.group_id === requirement.id);
      if (group === undefined) return { verdict: "NOT_TESTED", detail: `group ${requirement.id} did not report` };
      return { verdict: group.verdict, detail: `${requirement.id} ${group.verdict}` };
    }
    case "native": {
      const section = context.e2e?.[requirement.path];
      if (section === undefined || section === null) {
        return { verdict: "NOT_TESTED", detail: `native ${requirement.path} was not measured` };
      }
      return { verdict: section.verdict, detail: `native ${requirement.path} ${section.verdict}` };
    }
    case "scenario": {
      const scenario = (context.e2e?.scenarios ?? []).find((entry) => entry.id === requirement.id);
      if (scenario === undefined) return { verdict: "NOT_TESTED", detail: `scenario ${requirement.id} was not measured` };
      return { verdict: scenario.verdict, detail: `scenario ${requirement.id} ${scenario.verdict}` };
    }
    case "document": {
      const document = context.documents[requirement.name];
      if (document === null || document === undefined) {
        return { verdict: "NOT_TESTED", detail: `${requirement.name} is absent` };
      }
      const verdict = document[requirement.field];
      return { verdict: typeof verdict === "string" ? verdict : "INCONCLUSIVE", detail: `${requirement.name}.${requirement.field}` };
    }
    case "fact": {
      const found = context.facts.get(requirement.id);
      if (found === undefined) return { verdict: "NOT_TESTED", detail: `fact ${requirement.id} was not computed` };
      return { verdict: found.verdict, detail: found.detail };
    }
    default:
      return { verdict: "INCONCLUSIVE", detail: `unknown requirement kind ${requirement.kind}` };
  }
}

export function evaluateClaim(claim, context) {
  const checks = claim.requires.map((requirement) => ({
    ...requirement,
    ...evaluateRequirement(requirement, context),
  }));
  const verdict = aggregate(checks.map((check) => check.verdict));
  return {
    claim_id: claim.id,
    condition: claim.condition,
    work_package: claim.work_package,
    tier: claim.tier,
    evidence_reference: join("evidence", `${claim.cites ?? claim.document}.json`),
    measured_by: checks.map((check) => check.detail),
    verdict,
    reason_code: verdict === "PASS" ? "" : checks.filter((check) => check.verdict !== "PASS").map((check) => check.detail).join("; "),
  };
}

export function buildContext(root) {
  const evidenceDirectory = join(root, "evidence");
  const groups = firstExisting(evidenceDirectory, "phase-01-test-groups");
  const e2e = firstExisting(evidenceDirectory, "phase-01-desktop-e2e");
  const performance = firstExisting(evidenceDirectory, "phase-01-performance");
  const raw = readJson(join(evidenceDirectory, RAW_PROBE_NAME));
  const documents = {
    "phase-01-baseline": readJson(join(evidenceDirectory, "phase-01-baseline.json")),
    "phase-01-ipc": firstExisting(evidenceDirectory, "phase-01-ipc"),
    "phase-01-performance": performance,
  };
  const facts = collectFacts(root, { raw, groups, e2e });
  return { groups, e2e, performance, raw, documents, facts };
}

function documentBody(name, workPackage, title, context, root) {
  const claims = claimsForDocument(name).map((claim) => evaluateClaim(claim, context));
  const verdict = aggregate(claims.map((claim) => claim.verdict));
  const usedFactIds = new Set(
    claimsForDocument(name)
      .flatMap((claim) => claim.requires)
      .filter((requirement) => requirement.kind === "fact")
      .map((requirement) => requirement.id),
  );

  const body = {
    schema_version: SCHEMA_VERSION,
    tool: P01_TOOLS.derive,
    phase: "PHASE-01",
    work_package: workPackage,
    title,
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    measured_at: stamp(),
    repository_root: root,
    inputs: {
      test_groups: context.groups === null ? null : join("evidence", "phase-01-test-groups.json"),
      native_e2e: context.e2e === null ? null : join("evidence", "phase-01-desktop-e2e.json"),
      raw_probe: context.raw === null ? null : join("evidence", RAW_PROBE_NAME),
    },
    facts: [...usedFactIds].sort().map((id) => context.facts.get(id) ?? { id, verdict: "NOT_TESTED", detail: "not computed" }),
    claims,
    evidence_complete: context.groups !== null,
    verdict,
    reason_codes: claims.filter((claim) => claim.verdict !== "PASS").map((claim) => `${claim.claim_id}_${claim.verdict}`),
  };

  if (name === "phase-01-security") {
    body.stride_review = STRIDE_SURFACES;
  }

  return body;
}

export function deriveAll(root) {
  const context = buildContext(root);
  const suffix = evidenceSuffix();
  const evidenceDirectory = join(root, "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });

  const written = [];
  for (const [name, workPackage, title] of DOCUMENTS) {
    const body = documentBody(name, workPackage, title, context, root);
    const path = join(evidenceDirectory, `${name}${suffix}.json`);
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    assertWrittenEvidence(path);
    written.push({ name, path, verdict: body.verdict });
  }
  return { written, context };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { written, context } = deriveAll(root);
  for (const entry of written) console.log(`${entry.verdict.padEnd(12)} ${entry.name}`);
  const unresolved = [...context.facts.values()].filter((entry) => entry.verdict !== "PASS");
  for (const entry of unresolved) console.log(`fact ${entry.verdict.padEnd(12)} ${entry.id}: ${entry.detail}`);
  const total = P01_CLAIMS.length;
  console.log(`derived ${written.length} documents covering ${total} declared conditions`);
  process.exitCode = written.every((entry) => entry.verdict === "PASS") ? 0 : 1;
}
