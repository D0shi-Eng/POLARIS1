// الإعلانات المشتركة لمشغّل Phase-04: العلامة، وأسماء الأدلة، والكاتب القانوني.
//
// ملف واحد يعلن ما تقيسه المرحلة، فلا يعيد كل مستهلك تعريف القائمة. البنية
// مأخوذة من Phase-03 عمدًا: ما أثبت صحّته هناك لا يُعاد تصميمه هنا.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا ما قانونيًا. لا يضعه إلا المشغّل. */
export const P04_MARKER = "POLARIS_P04_NATIVE_RUN";

export const SCHEMA_VERSION = "1.0.0";

export const P04_TOOLS = Object.freeze({
  groups: "polaris.p04.test-groups",
  security: "polaris.p04.security",
  evaluate: "polaris.p04.evaluate",
  derive: "polaris.p04.derive",
  claims: "polaris.p04.claims",
  bytes: "polaris.p04.evidence-bytes",
  gate: "polaris.p04.final-gate",
});

/** الوثائق القانونية بالترتيب الذي تُكتب به. وثيقة البوابة تُفحص في تمريرة ثانية. */
export const P04_EVIDENCE = Object.freeze([
  "phase-04-run",
  "phase-04-skills",
  "phase-04-tools",
  "phase-04-tool-gateway",
  "phase-04-mcp",
  "phase-04-agent-tools",
  "phase-04-approval",
  "phase-04-evidence",
  "phase-04-cancellation",
  "phase-04-delegation",
  "phase-04-native-e2e",
  "phase-04-security",
  "phase-04-performance",
  "phase-04-regression",
]);

export const P04_FINAL_GATE = "phase-04-final-gate";

/** مجلد القياسات الخام. ليست أدلة قانونية؛ الاشتقاق يقرؤها ويكتب الوثائق. */
export const RAW_DIRECTORY = join("evidence", "p04-native");

/**
 * مجموعات المطابقة التي تقيسها المرحلة، بالأسماء التي طلبها نطاق المرحلة.
 * كل مجموعة حاملة للأمن `mandatory`، ولا يجوز أن تخفي تخطّيًا بلا تفسير.
 */
export const P04_GROUPS = Object.freeze([
  "P04-CONTRACTS",
  "P04-SKILLS",
  "P04-TOOLS",
  "P04-TOOL-GATEWAY",
  "P04-MCP",
  "P04-AGENT-TOOLS",
  "P04-APPROVAL",
  "P04-EVIDENCE",
  "P04-CANCELLATION",
  "P04-DELEGATION",
  "P04-TRUST",
  "P04-PERSISTENCE",
  "P04-HOST-CORE",
  "P04-HOST-BINDING",
  "P04-HOST-LINT",
  "P04-RENDERER",
  "P04-RENDERER-UI",
  "P04-TOOLING",
  "P04-NATIVE-E2E",
  "P04-SECURITY",
]);

export function isCanonicalRun(environment = process.env) {
  return environment[P04_MARKER] === "1";
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
    phase: "PHASE-04",
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
