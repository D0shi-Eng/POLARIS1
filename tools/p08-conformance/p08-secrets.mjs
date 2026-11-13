// فحص الأسرار قبل أي رفع: الأشكال المعروفة، والإنتروبيا، والملفات التي ستُتتبَّع، والتاريخ.
//
// أربع طبقات، ولكلٍّ حكمها:
//   ١ — الأشكال: مفاتيح المزوّدين، ورموز GitHub وSlack وAWS، وكتل المفاتيح الخاصّة، وJWT.
//   ٢ — الإنتروبيا: قيمة طويلة عشوائية المظهر في إسناد اسمه يوحي بسرّ (key/token/secret/password).
//   ٣ — المُتتبَّع: كل ملف سيدخل المستودع (git ls-files إن وُجد، وإلا المسح مع قائمة الإقصاء نفسها
//       التي في .gitignore)، ومعه فحص أن ما لا يجوز رفعه (evidence/، _transfer/، القواعد والخزائن
//       المحلية، المثبّتات غير الموقّعة) غير مُتتبَّع.
//   ٤ — التاريخ: كل نسخة في تاريخ git إن وُجد مستودع؛ وإلا NOT_TESTED بسببه.
//
// لا يُكتب سرّ في أي مخرج: الاسم والملف والسطر فقط.
//
// الاستعمال: node p08-secrets.mjs --root <root> [--history]

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, header, P08_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p08-common.mjs";

export const SHAPES = Object.freeze([
  { id: "openai", pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: "anthropic", pattern: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/ },
  { id: "google", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { id: "openrouter", pattern: /\bsk-or-v1-[A-Za-z0-9]{32,}\b/ },
  { id: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: "slack-token", pattern: /\bxox[abpors]-[A-Za-z0-9-]{20,}\b/ },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { id: "private-key-block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "bearer-literal", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{32,}/ },
]);

/** مجلدات لا تُرفع أبدًا ولا تُمسح بحثًا عن سرّ في الكود: مخرجات بناء واعتماديات وأدلّة خام. */
export const NEVER_TRACKED = Object.freeze(["node_modules", "target", "target-e2e", "dist", "build-tests", "evidence", "_transfer", "_to_delete", "release", ".git", ".vite", "coverage"]);
/** أنماط أسماء ملفات لا يجوز أن تُتتبَّع. */
export const FORBIDDEN_TRACKED = Object.freeze([/(^|\/)evidence\//, /(^|\/)_transfer\//, /\.local\.json$/, /\.(db|sqlite|sqlite3)(-wal|-shm)?$/i, /(^|\/)\.env(\..*)?$/, /\.(pem|pfx|p12|key)$/i, /(^|\/)vault\//i, /\.exe$/i, /\.msi$/i]);

/** أسماء مستخدم نائبة تظهر في الاختبارات والأمثلة؛ أيّ اسم غيرها يُعدّ مسارًا شخصيًّا. */
export const PLACEHOLDER_USERS = Object.freeze(["me", "x", "user", "public", "example", "default", "runneradmin", "someone", "alice", "bob", "name", "username", "<user>"]);

const TEXT = new Set([".rs", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".toml", ".yml", ".yaml", ".ps1", ".psm1", ".html", ".css", ".txt", ".py", ".sh", ".xml", ".svg", ".lock", ""]);

/** إنتروبيا شانون بالبِت لكل محرف. */
export function entropy(text) {
  const counts = new Map();
  for (const c of text) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const ASSIGN = /\b([A-Za-z_][A-Za-z0-9_]*(?:key|token|secret|password|passwd|credential)[A-Za-z0-9_]*)\b\s*[:=]\s*["'`]([A-Za-z0-9+/=_\-.]{24,})["'`]/gi;
/** قيم معروفة لا تحمل سرًّا: خلاصات ومعرّفات وتجهيزات اختبار معلنة. */
const BENIGN = [/^[0-9a-f]{64}$/i, /^[0-9a-f]{40}$/i, /^[0-9a-f-]{36}$/i, /fixture|example|placeholder|redacted|dummy|test/i, /^(.)\1+$/];

/**
 * قيمة اصطناعية معلنة الشكل: تسلسل أبجدي أو رقمي متّصل، أو علامة مثال/تجهيزة، أو ترويسة مفتاح
 * بلا جسم. هذه قيم اختبارات التنقيح نفسها، تُعدّ وتُسجَّل ولا تُحسب تسرّبًا.
 */
export function isSynthetic(value, line = "") {
  if (/abcdefghij|0123456789ab|EXAMPLE|fixture|FIXTURE|test-|dummy|placeholder/.test(value)) return true;
  if (/^eyJ/.test(value)) {
    // JWT المثال الشائع (sub = 1234567890) اصطناعي معلن.
    try {
      return Buffer.from(value.split(".")[1], "base64url").toString("utf8").includes("1234567890");
    } catch {
      return false;
    }
  }
  if (/PRIVATE KEY-----/.test(value)) return !/PRIVATE KEY-----\s*[A-Za-z0-9+/]{40,}/.test(line);
  return false;
}

export function scanText(text) {
  const hits = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const shape of SHAPES) {
      const match = line.match(shape.pattern);
      if (match !== null) hits.push({ line: index + 1, kind: shape.id, synthetic: isSynthetic(match[0], line) });
    }
    for (const m of line.matchAll(ASSIGN)) {
      const value = m[2];
      if (BENIGN.some((b) => b.test(value))) continue;
      if (entropy(value) >= 4.2) hits.push({ line: index + 1, kind: `high-entropy:${m[1]}`, synthetic: isSynthetic(value, line) });
    }
  });
  return hits;
}

/** قواعد .gitignore بصيغة مبسّطة (أسماء، ونجمة، ونجمتان، وشرطة ختامية للمجلد). لا نفي. */
export function ignoreRules(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => {
      const dir = l.endsWith("/");
      const body = l.replace(/\/$/, "").replace(/^\//, "");
      const anchored = body.includes("/");
      const source = body.split("**/").map((part) => part.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join("(?:.*/)?");
      return { dir, regex: new RegExp(anchored ? `^${source}$` : `(^|/)${source}$`) };
    });
}

export function ignored(rules, path, isDir) {
  return rules.some((r) => (!r.dir || isDir) && r.regex.test(path));
}

function walk(root, directory, rules, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = join(directory, entry.name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (ignored(rules, rel, entry.isDirectory())) continue;
    if (entry.isDirectory()) walk(root, full, rules, found);
    else found.push(rel);
  }
  return found;
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function trackedSet(root) {
  if (existsSync(join(root, ".git"))) {
    const listed = git(root, ["ls-files", "-z"]);
    if (listed !== null) return { source: "git ls-files", files: listed.split("\0").filter((f) => f !== "") };
  }
  const gitignore = join(root, ".gitignore");
  const rules = ignoreRules(existsSync(gitignore) ? readFileSync(gitignore, "utf8") : NEVER_TRACKED.map((n) => `${n}/`).join("\n"));
  return { source: "walk honouring .gitignore", files: walk(root, root, rules) };
}

export function scan(root, options = {}) {
  const { source, files } = trackedSet(root);
  const leaks = [];
  const synthetic = [];
  const forbidden = files.filter((f) => FORBIDDEN_TRACKED.some((p) => p.test(f)));
  let scanned = 0;
  for (const file of files) {
    const full = join(root, file);
    if (!TEXT.has(extname(file).toLowerCase()) || !existsSync(full) || statSync(full).size > 8 * 1024 * 1024) continue;
    scanned += 1;
    for (const hit of scanText(readFileSync(full, "utf8"))) (hit.synthetic ? synthetic : leaks).push({ file, line: hit.line, kind: hit.kind });
  }
  let history = { status: "NOT_TESTED", reason: "no git repository exists yet; history is scanned at the repository step" };
  if (options.history === true && existsSync(join(root, ".git"))) {
    const log = git(root, ["log", "--all", "-p", "--no-color", "--unified=0"]);
    if (log === null) history = { status: "BLOCKED", reason: "git log could not be read" };
    else {
      const hits = scanText(log.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n")).filter((h) => !h.synthetic);
      history = { status: hits.length === 0 ? "CLEAN" : "LEAK_FOUND", commits: Number((git(root, ["rev-list", "--all", "--count"]) ?? "0").trim()), findings: hits.map((h) => h.kind) };
    }
  }
  // أسماء المستخدم ومسارات ملفّه الشخصي لا تدخل ملفًا مُتتبَّعًا.
  const personal = [];
  for (const file of files) {
    const full = join(root, file);
    if (!TEXT.has(extname(file).toLowerCase()) || !existsSync(full) || statSync(full).size > 8 * 1024 * 1024) continue;
    const text = readFileSync(full, "utf8");
    for (const m of text.matchAll(/[A-Za-z]:\\{1,2}Users\\{1,2}([A-Za-z0-9._-]+)|\/Users\/([A-Za-z0-9._-]+)\/|\/home\/([A-Za-z0-9._-]+)\//g)) {
      const name = (m[1] ?? m[2] ?? m[3] ?? "").toLowerCase();
      if (!PLACEHOLDER_USERS.includes(name)) {
        personal.push(`${file}: ${name}`);
        break;
      }
    }
  }
  return { tracked_source: source, tracked_files: files.length, scanned_text_files: scanned, leaks, synthetic_fixture_values: synthetic.length, synthetic_files: [...new Set(synthetic.map((s) => s.file))], personal_paths: personal, forbidden_tracked: forbidden, history, verdict: leaks.length === 0 && forbidden.length === 0 && personal.length === 0 && history.status !== "LEAK_FOUND" ? "CLEAN" : "LEAK_FOUND" };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = scan(root, { history: process.argv.includes("--history") });
  writeEvidence(join(root, RAW_DIRECTORY, "secrets.local.json"), { ...header(P08_TOOLS.secrets), ...result });
  console.log(`${result.verdict}  ${result.scanned_text_files} text file(s) of ${result.tracked_files} (${result.tracked_source}); leaks ${result.leaks.length}; forbidden tracked ${result.forbidden_tracked.length}; history ${result.history.status}`);
  for (const leak of result.leaks.slice(0, 40)) console.log(`  ${leak.file}:${leak.line} ${leak.kind}`);
  for (const f of result.forbidden_tracked.slice(0, 40)) console.log(`  forbidden: ${f}`);
  for (const f of result.personal_paths.slice(0, 40)) console.log(`  personal path: ${f}`);
  process.exitCode = result.verdict === "CLEAN" ? 0 : 1;
}
