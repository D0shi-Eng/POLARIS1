// الإعلانات المشتركة لمشغّل Phase-07: العلامة، وأسماء الأدلّة، والكاتب القانوني، والأحكام.
//
// البنية نفسها التي أُغلقت بها المراحل السابقة: كاتب واحد يكتب بلا BOM ثم يقرأ ما كتب،
// وقاعدة الحكم الأسوأ، ولا ترقية من غير PASS إلى PASS. ما يختلف هو ما تقيسه المرحلة.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertWrittenEvidence } from "../evidence-contract/evidence-bytes.mjs";

/** متغيّر البيئة الذي يجعل تشغيلًا قانونيًا. لا يضعه إلا المشغّل. */
export const P07_MARKER = "POLARIS_P07_NATIVE_RUN";

export const SCHEMA_VERSION = "1.0.0";

export const P07_TOOLS = Object.freeze({
  groups: "polaris.p07.test-groups",
  inventory: "polaris.p07.inventory",
  hardening: "polaris.p07.hardening",
  derive: "polaris.p07.derive",
  bytes: "polaris.p07.evidence-bytes",
  security: "polaris.p07.security",
  release: "polaris.p07.release",
  gate: "polaris.p07.final-gate",
});

/** الوثائق القانونية بالترتيب الذي تُكتب به. وثيقة البوابة تُفحص في تمريرة ثانية. */
export const P07_EVIDENCE = Object.freeze([
  "phase-07-run",
  "phase-07-hardening",
  "phase-07-recovery",
  "phase-07-packaging",
  "phase-07-updater",
  "phase-07-enterprise",
  "phase-07-platform",
  "phase-07-security",
  "phase-07-release-e2e",
  "phase-07-performance",
  "phase-07-regression",
]);

export const P07_FINAL_GATE = "phase-07-final-gate";

/** مجلد القياسات الخام. ليست أدلّة قانونية؛ الاشتقاق يقرؤها ويكتب الوثائق. */
export const RAW_DIRECTORY = join("evidence", "p07-native");

/** مجلد مخرجات الإصدار المرشّح. */
export const RELEASE_DIRECTORY = join("release", "rc");

export function isCanonicalRun(environment = process.env) {
  return environment[P07_MARKER] === "1";
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

/** الكاتب الوحيد للأدلّة القانونية: يكتب بلا BOM ثم يقرأ ما كتب ويثبته. */
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
    phase: "PHASE-07",
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    measured_at: stamp(),
    repository_root: root,
    ...extra,
  };
}

/** الأحكام المسموحة. لا حكم سادس، ولا ترقية من غير PASS إلى PASS. */
export const VERDICTS = Object.freeze(["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"]);

/** أسوأ حكم في قائمة: FAIL ثم BLOCKED ثم INCONCLUSIVE ثم NOT_TESTED ثم PASS. */
export function worst(verdicts) {
  const order = ["FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED", "PASS"];
  if (verdicts.length === 0) return "NOT_TESTED";
  for (const candidate of order) if (verdicts.includes(candidate)) return candidate;
  return "INCONCLUSIVE";
}

/** حكم من شرط منطقي. قياس غائب NOT_TESTED، لا PASS. */
export function verdictOf(measured, satisfied) {
  if (measured !== true) return "NOT_TESTED";
  return satisfied === true ? "PASS" : "FAIL";
}

/** سجل قياس واحد داخل شرط. */
export function measure(requirement, verdict, detail) {
  return { requirement, verdict: VERDICTS.includes(verdict) ? verdict : "INCONCLUSIVE", detail };
}
