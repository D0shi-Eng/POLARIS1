// الإعلانات المشتركة لمشغّل Phase-02: العلامة، وأسماء الأدلة، والكاتب القانوني.
//
// ملف واحد يعلن ما تقيسه المرحلة، فلا يعيد كل مستهلك تعريف القائمة.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا ما قانونيًا. لا يضعه إلا المشغّل. */
export const P02_MARKER = "POLARIS_P02_NATIVE_RUN";

export const SCHEMA_VERSION = "1.0.0";

export const P02_TOOLS = Object.freeze({
  groups: "polaris.p02.test-groups",
  security: "polaris.p02.security",
  live: "polaris.p02.live-probe",
  derive: "polaris.p02.derive",
  bytes: "polaris.p02.evidence-bytes",
  gate: "polaris.p02.final-gate",
});

/** الوثائق القانونية بالترتيب الذي تُكتب به. وثيقة البوابة تُفحص في تمريرة ثانية. */
export const P02_EVIDENCE = Object.freeze([
  "phase-02-run",
  "phase-02-providers",
  "phase-02-models",
  "phase-02-projects",
  "phase-02-context",
  "phase-02-security",
  "phase-02-native-e2e",
  "phase-02-performance",
  "phase-02-regression",
]);

export const P02_FINAL_GATE = "phase-02-final-gate";

/** مجلد القياسات الخام. ليست أدلة قانونية؛ الاشتقاق يقرؤها ويكتب الوثائق. */
export const RAW_DIRECTORY = join("evidence", "p02-native");

export function isCanonicalRun(environment = process.env) {
  return environment[P02_MARKER] === "1";
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
    phase: "PHASE-02",
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    measured_at: stamp(),
    repository_root: root,
    ...extra,
  };
}

/** الأحكام المسموحة. لا حكم رابع يُخترع، ولا ترقية من غير PASS إلى PASS. */
export const VERDICTS = Object.freeze(["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"]);

/** أسوأ حكم في قائمة: FAIL ثم BLOCKED ثم INCONCLUSIVE ثم NOT_TESTED ثم PASS. */
export function worst(verdicts) {
  const order = ["FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED", "PASS"];
  if (verdicts.length === 0) return "NOT_TESTED";
  for (const candidate of order) if (verdicts.includes(candidate)) return candidate;
  return "INCONCLUSIVE";
}
