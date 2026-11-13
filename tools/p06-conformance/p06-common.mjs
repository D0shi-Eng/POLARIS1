// الإعلانات المشتركة لمشغّل Phase-06: العلامة، وأسماء الأدلة، والكاتب القانوني.
//
// البنية مأخوذة من Phase-05 عمدًا: ما أثبت صحّته هناك لا يُعاد تصميمه هنا. الكاتب
// القانوني وقاعدة الحكم هما نفساهما؛ ما يختلف هو ما تقيسه المرحلة.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا ما قانونيًا. لا يضعه إلا المشغّل. */
export const P06_MARKER = "POLARIS_P06_NATIVE_RUN";

export const SCHEMA_VERSION = "1.0.0";

export const P06_TOOLS = Object.freeze({
  groups: "polaris.p06.test-groups",
  security: "polaris.p06.security",
  evaluate: "polaris.p06.evaluate",
  derive: "polaris.p06.derive",
  claims: "polaris.p06.claims",
  bytes: "polaris.p06.evidence-bytes",
  gate: "polaris.p06.final-gate",
});

/** الوثائق القانونية العشر بالترتيب الذي تُكتب به. وثيقة البوابة تُفحص في تمريرة ثانية. */
export const P06_EVIDENCE = Object.freeze([
  "phase-06-run",
  "phase-06-connectors",
  "phase-06-cost",
  "phase-06-observability",
  "phase-06-settings",
  "phase-06-security",
  "phase-06-native-e2e",
  "phase-06-performance",
  "phase-06-regression",
]);

export const P06_FINAL_GATE = "phase-06-final-gate";

/** مجلد القياسات الخام. ليست أدلة قانونية؛ الاشتقاق يقرؤها ويكتب الوثائق. */
export const RAW_DIRECTORY = join("evidence", "p06-native");

/** مجموعات المطابقة بالأسماء التي طلبها نطاق المرحلة، ثم مجموعات البناء والاختبار الكلّي. */
export const P06_GROUPS = Object.freeze([
  "P06-CONTRACTS",
  "P06-CONNECTORS",
  "P06-CONNECTOR-SECURITY",
  "P06-CONNECTOR-AUTH",
  "P06-CONNECTOR-GATEWAY",
  "P06-COST",
  "P06-BUDGETS",
  "P06-OBSERVABILITY",
  "P06-HEALTH",
  "P06-SETTINGS",
  "P06-EFFECTIVE-CONFIG",
  "P06-PRIVACY",
  "P06-AGENT-INTEGRATION",
  "P06-PERSISTENCE",
  "P06-RENDERER",
  "P06-NATIVE-E2E",
  "P06-SECURITY",
  "P06-TOOLS",
  "P06-HOST-CORE",
  "P06-HOST-BINDING",
  "P06-HOST-LINT",
  "P06-RENDERER-ALL",
]);

/** المجموعات التي تُشغَّل حِزَمًا. `P06-NATIVE-E2E` تُقاس بإطلاق المنتج نفسه، لا هنا. */
export const P06_RUN_GROUPS = Object.freeze(P06_GROUPS.filter((id) => id !== "P06-NATIVE-E2E"));

export function isCanonicalRun(environment = process.env) {
  return environment[P06_MARKER] === "1";
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
    phase: "PHASE-06",
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
