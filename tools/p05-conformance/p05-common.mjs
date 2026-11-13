// الإعلانات المشتركة لمشغّل Phase-05: العلامة، وأسماء الأدلة، والكاتب القانوني.
//
// البنية مأخوذة من Phase-04 عمدًا: ما أثبت صحّته هناك لا يُعاد تصميمه هنا. الكاتب
// القانوني وقاعدة الحكم هما نفساهما؛ ما يختلف هو ما تقيسه المرحلة.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا ما قانونيًا. لا يضعه إلا المشغّل. */
export const P05_MARKER = "POLARIS_P05_NATIVE_RUN";

export const SCHEMA_VERSION = "1.0.0";

export const P05_TOOLS = Object.freeze({
  groups: "polaris.p05.test-groups",
  security: "polaris.p05.security",
  evaluate: "polaris.p05.evaluate",
  derive: "polaris.p05.derive",
  claims: "polaris.p05.claims",
  bytes: "polaris.p05.evidence-bytes",
  gate: "polaris.p05.final-gate",
});

/** الوثائق القانونية العشر بالترتيب الذي تُكتب به. وثيقة البوابة تُفحص في تمريرة ثانية. */
export const P05_EVIDENCE = Object.freeze([
  "phase-05-run",
  "phase-05-memory",
  "phase-05-browser",
  "phase-05-computer",
  "phase-05-agent-integration",
  "phase-05-security",
  "phase-05-native-e2e",
  "phase-05-performance",
  "phase-05-regression",
]);

export const P05_FINAL_GATE = "phase-05-final-gate";

/** مجلد القياسات الخام. ليست أدلة قانونية؛ الاشتقاق يقرؤها ويكتب الوثائق. */
export const RAW_DIRECTORY = join("evidence", "p05-native");

/** مجموعات المطابقة بالأسماء التي طلبها نطاق المرحلة، ثم مجموعات البناء والاختبار الكلّي. */
export const P05_GROUPS = Object.freeze([
  "P05-CONTRACTS",
  "P05-MEMORY",
  "P05-MEMORY-TRUST",
  "P05-BROWSER",
  "P05-BROWSER-SECURITY",
  "P05-COMPUTER",
  "P05-COMPUTER-SECURITY",
  "P05-AGENT-INTEGRATION",
  "P05-SKILL-INTEGRATION",
  "P05-EVIDENCE",
  "P05-CANCELLATION",
  "P05-APPROVAL",
  "P05-PERSISTENCE",
  "P05-TOOLS",
  "P05-HOST-CORE",
  "P05-HOST-BINDING",
  "P05-HOST-LINT",
  "P05-RENDERER",
  "P05-RENDERER-UI",
  "P05-NATIVE-E2E",
  "P05-SECURITY",
]);

export function isCanonicalRun(environment = process.env) {
  return environment[P05_MARKER] === "1";
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
    phase: "PHASE-05",
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
