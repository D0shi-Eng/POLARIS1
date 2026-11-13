// حارس صنف العيب P01_STARTUP_REPORT_ABSENT.
//
// العيب: العارض ترجم مخططات العقود وقت التشغيل عبر Ajv، أي عبر `new Function`.
// سياسة CSP في المنتج (`script-src 'self'` بلا `'unsafe-eval'`) منعت ذلك، فرمى
// أول تحقق EvalError قبل إرسال `desktop.bootstrap`، فلم يصل المضيف طلب، ولم
// يُكتب تقرير الإقلاع. خادم التطوير لا يُطبَّق عليه CSP، فبقي العيب مخفيًا حتى
// صارت الواجهة محزومة فعلًا.
//
// الحل الصحيح ترجمة وقت البناء، لا إضعاف السياسة. وهذا الحارس يغلق الصنف:
//  - P01-CSP-001: السياسة نفسها لا تسمح بتقييم النصوص ولا بسكربت مضمَّن.
//  - P01-CSP-002: شيفرة العارض لا تستورد مُترجِم Ajv وقت التشغيل.
//  - P01-CSP-003: الحزمة المبنية التي سيضمّها الثنائي لا تحوي تقييمًا للنصوص.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument } from "./p01-groups.mjs";

const result = (id, ok, detail = "") => ({ id, verdict: ok ? "PASS" : "FAIL", detail });

/** يقرأ توجيهات CSP إلى خريطة: اسم التوجيه ← قائمة المصادر. */
export function parseCsp(policy) {
  const directives = new Map();
  for (const part of String(policy ?? "").split(";")) {
    const tokens = part.trim().split(/\s+/).filter((token) => token !== "");
    if (tokens.length === 0) continue;
    directives.set(tokens[0].toLowerCase(), tokens.slice(1).map((token) => token.toLowerCase()));
  }
  return directives;
}

/** P01-CSP-001: سياسة المنتج تمنع تقييم النصوص والسكربت المضمَّن. */
export function checkPolicy(policy) {
  const directives = parseCsp(policy);
  const script = directives.get("script-src") ?? directives.get("default-src");
  if (script === undefined) return result("P01-CSP-001", false, "the product CSP declares neither script-src nor default-src");
  const weak = script.filter((source) =>
    ["'unsafe-eval'", "'wasm-unsafe-eval'", "'unsafe-inline'", "*", "data:", "blob:"].includes(source));
  return result(
    "P01-CSP-001",
    weak.length === 0,
    weak.length === 0 ? `script-src ${script.join(" ")}` : `script-src allows ${weak.join(" ")}`,
  );
}

/** مُترجِم Ajv وقت التشغيل: المدخل الرئيسي أو أحد مداخل المسودات. */
const RUNTIME_COMPILER_IMPORT = /\bfrom\s+["']ajv(?:\/dist\/(?:2019|2020|jtd|ajv|core))?(?:\.js)?["']|\brequire\(\s*["']ajv(?:\/dist\/(?:2019|2020|jtd|ajv|core))?(?:\.js)?["']\s*\)|["']ajv-formats["']/;

/** P01-CSP-002: لا ملف في شيفرة العارض يستورد مُترجِم Ajv. */
export function checkRendererSources(files) {
  const offenders = files.filter(({ text }) => RUNTIME_COMPILER_IMPORT.test(text)).map(({ name }) => name);
  return result(
    "P01-CSP-002",
    offenders.length === 0,
    offenders.length === 0 ? `${files.length} renderer source files, no run-time schema compiler` : `run-time Ajv compiler imported by ${offenders.join(", ")}`,
  );
}

/** أنماط تقييم النصوص. `Function(` تُطابَق فقط حين لا يسبقها محرف معرّف. */
const STRING_EVALUATION = [
  { name: "new Function", pattern: /\bnew\s+Function\s*\(/ },
  { name: "Function()", pattern: /(?<![\w$.])Function\s*\(/ },
  { name: "eval()", pattern: /(?<![\w$.])eval\s*\(/ },
  { name: "string timer", pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/ },
];

/** P01-CSP-003: الحزمة المبنية خالية من تقييم النصوص. */
export function checkBundle(files) {
  if (files.length === 0) return { id: "P01-CSP-003", verdict: "INCONCLUSIVE", detail: "no built JavaScript under renderer/dist" };
  const findings = [];
  for (const { name, text } of files) {
    for (const { name: kind, pattern } of STRING_EVALUATION) {
      if (pattern.test(text)) findings.push(`${name}: ${kind}`);
    }
  }
  return result(
    "P01-CSP-003",
    findings.length === 0,
    findings.length === 0 ? `${files.length} bundle file(s), no string evaluation` : findings.join("; "),
  );
}

function walk(directory, accept, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, accept, found);
    else if (accept(entry.name)) found.push(full);
  }
  return found;
}

const read = (root) => (file) => ({ name: path.relative(root, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") });

export function checkTree(root) {
  const renderer = path.join(root, "desktop", "renderer");
  const config = JSON.parse(readFileSync(path.join(root, "desktop", "host", "app", "tauri.conf.json"), "utf8"));
  const sources = walk(path.join(renderer, "src"), (name) => /\.(ts|tsx|js|mjs)$/.test(name)).map(read(root));
  const bundle = walk(path.join(renderer, "dist"), (name) => /\.(js|mjs)$/.test(name)).map(read(root));
  return [checkPolicy(config?.app?.security?.csp), checkRendererSources(sources), checkBundle(bundle)];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = path.resolve(argument("--root", process.cwd()));
  let failed = false;
  for (const r of checkTree(root)) {
    console.log(`${r.verdict.padEnd(12)} ${r.id}  ${r.detail}`);
    if (r.verdict !== "PASS") failed = true;
  }
  process.exitCode = failed ? 1 : 0;
}
