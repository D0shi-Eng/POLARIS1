// الإعلانات المشتركة لمشغّل Phase-03: العلامة، وأسماء الأدلة، والكاتب القانوني.
//
// ملف واحد يعلن ما تقيسه المرحلة، فلا يعيد كل مستهلك تعريف القائمة. البنية
// مأخوذة من Phase-02 عمدًا: ما أثبت صحّته هناك لا يُعاد تصميمه هنا.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا ما قانونيًا. لا يضعه إلا المشغّل. */
export const P03_MARKER = "POLARIS_P03_NATIVE_RUN";

export const SCHEMA_VERSION = "1.0.0";

export const P03_TOOLS = Object.freeze({
  groups: "polaris.p03.test-groups",
  security: "polaris.p03.security",
  evaluate: "polaris.p03.evaluate",
  derive: "polaris.p03.derive",
  claims: "polaris.p03.claims",
  bytes: "polaris.p03.evidence-bytes",
  gate: "polaris.p03.final-gate",
});

/** الوثائق القانونية بالترتيب الذي تُكتب به. وثيقة البوابة تُفحص في تمريرة ثانية. */
export const P03_EVIDENCE = Object.freeze([
  "phase-03-run",
  "phase-03-agents",
  "phase-03-missions",
  "phase-03-orchestration",
  "phase-03-trust",
  "phase-03-truth",
  "phase-03-native-e2e",
  "phase-03-security",
  "phase-03-performance",
  "phase-03-regression",
]);

export const P03_FINAL_GATE = "phase-03-final-gate";

/** مجلد القياسات الخام. ليست أدلة قانونية؛ الاشتقاق يقرؤها ويكتب الوثائق. */
export const RAW_DIRECTORY = join("evidence", "p03-native");

/**
 * مجموعات المطابقة التي تقيسها المرحلة. كل مجموعة حاملة للأمن `mandatory`،
 * ولا يجوز أن تخفي تخطّيًا بلا تفسير.
 */
export const P03_GROUPS = Object.freeze([
  "P03-CONTRACTS",
  "P03-RUNTIME",
  "P03-AGENTS",
  "P03-MISSIONS",
  "P03-TASK-GRAPH",
  "P03-ORCHESTRATION",
  "P03-BUDGETS",
  "P03-TRUST",
  "P03-TRUTH",
  "P03-EVIDENCE",
  "P03-VERIFICATION",
  "P03-PERSISTENCE",
  "P03-HOST-CORE",
  "P03-HOST-BINDING",
  "P03-HOST-LINT",
  "P03-RENDERER",
  "P03-RENDERER-UI",
  "P03-TOOLS",
  "P03-NATIVE-E2E",
]);

export function isCanonicalRun(environment = process.env) {
  return environment[P03_MARKER] === "1";
}

export function evidenceSuffix(environment = process.env) {
  return isCanonicalRun(environment) ? "" : ".adhoc";
}

export function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

export function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    return { __unreadable: String(error?.message ?? error) };
  }
}

/** يسلسل JSON بالشكل القانوني: مسافتان، وLF، وسطر أخير واحد. */
export function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** الكاتب الوحيد للأدلة القانونية: يكتب بلا BOM ثم يقرأ ما كتب ويثبته. */
export function writeEvidence(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(document), { encoding: "utf8" });
  assertWrittenEvidence(path);
  const text = readFileSync(path, "utf8");
  if (text.includes("\r")) throw new Error(`EVIDENCE_CR_PRESENT ${path}`);
  if (!text.endsWith("\n") || text.endsWith("\n\n")) throw new Error(`EVIDENCE_FINAL_NEWLINE ${path}`);
  JSON.parse(text);
  return path;
}

/** ترويسة كل وثيقة قانونية. */
export function header(tool, root, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    tool,
    phase: "PHASE-03",
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    measured_at: stamp(),
    repository_root: root,
    ...extra,
  };
}

/** الأحكام المسموحة. لا حكم سادس يُخترع، ولا ترقية من غير PASS إلى PASS. */
export const VERDICTS = Object.freeze(["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"]);

/** أسوأ حكم في قائمة: FAIL ثم BLOCKED ثم INCONCLUSIVE ثم NOT_TESTED ثم PASS. */
export function worst(verdicts) {
  const order = ["FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED", "PASS"];
  if (verdicts.length === 0) return "NOT_TESTED";
  for (const candidate of order) if (verdicts.includes(candidate)) return candidate;
  return "INCONCLUSIVE";
}

/** حكم من شرط منطقي، مع سبب حين لا يتحقّق. لا يُخترع PASS من غياب قياس. */
export function verdictOf(measured, satisfied) {
  if (measured !== true) return "NOT_TESTED";
  return satisfied === true ? "PASS" : "FAIL";
}
