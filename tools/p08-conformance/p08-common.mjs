// الإعلانات المشتركة لمشغّل Phase-08: العلامة، وأسماء الأدلّة، والكاتب القانوني، والأحكام.
//
// البنية نفسها التي أُغلقت بها المراحل السابقة: كاتب واحد يكتب بلا BOM ثم يقرأ ما كتب، وقاعدة
// الحكم الأسوأ، ولا ترقية من غير PASS إلى PASS. ما يختلف هو ما تقيسه المرحلة.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا قانونيًا. لا يضعه إلا المشغّل. */
export const P08_MARKER = "POLARIS_P08_NATIVE_RUN";
export const SCHEMA_VERSION = "1.0.0";

export const P08_TOOLS = Object.freeze({
  groups: "polaris.p08.test-groups",
  secrets: "polaris.p08.secret-scan",
  repository: "polaris.p08.repository",
  derive: "polaris.p08.derive",
  gate: "polaris.p08.final-gate",
});

/** الوثائق القانونية بالترتيب الذي تُكتب به. وثيقة البوابة تُكتب بعدها. */
export const P08_EVIDENCE = Object.freeze([
  "phase-08-run",
  "phase-08-real-model",
  "phase-08-execution",
  "phase-08-browser",
  "phase-08-artifacts",
  "phase-08-scheduler",
  "phase-08-integrations",
  "phase-08-ux",
  "phase-08-benchmark",
  "phase-08-security",
  "phase-08-native-e2e",
  "phase-08-regression",
  "phase-08-repository",
]);

export const P08_FINAL_GATE = "phase-08-final-gate";

/** القياسات الخام. ليست أدلّة قانونية ولا تُرفع إلى أي مستودع. */
export const RAW_DIRECTORY = join("evidence", "p08-native");

export function isCanonicalRun(environment = process.env) {
  return environment[P08_MARKER] === "1";
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

export function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** الكاتب الوحيد للأدلّة: يكتب بلا BOM ثم يقرأ ما كتب ويثبته. */
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

/** ترويسة كل وثيقة. لا مسار مطلق للجهاز: الجذر يُكتب اسمًا منطقيًا فقط. */
export function header(tool, extra = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    tool,
    phase: "PHASE-08",
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    measured_at: stamp(),
    repository: "POLARIS",
    ...extra,
  };
}

export const VERDICTS = Object.freeze(["PASS", "FAIL", "PARTIAL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"]);

/** أسوأ حكم: FAIL ثم BLOCKED ثم INCONCLUSIVE ثم PARTIAL ثم NOT_TESTED ثم PASS. */
export function worst(verdicts) {
  const order = ["FAIL", "BLOCKED", "INCONCLUSIVE", "PARTIAL", "NOT_TESTED", "PASS"];
  if (verdicts.length === 0) return "NOT_TESTED";
  for (const candidate of order) if (verdicts.includes(candidate)) return candidate;
  return "INCONCLUSIVE";
}

/** حكم من شرط منطقي. قياس غائب NOT_TESTED، لا PASS. */
export function verdictOf(measured, satisfied) {
  if (measured !== true) return "NOT_TESTED";
  return satisfied === true ? "PASS" : "FAIL";
}

export function raw(root, name) {
  return readJson(join(root, RAW_DIRECTORY, name));
}
