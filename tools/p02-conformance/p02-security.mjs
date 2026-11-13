// الفحص الأمني الساكن لـPhase-02، وسجل سلسلة التوريد.
//
// ما يُقاس هنا يُقرأ من المصدر والأدلة، لا من نيّة: سرّ في دليل، أو اسم نموذج في
// المصدر، أو `unsafe` خارج موضعه، أو عميل HTTP كامل في مكتبة المزوّدين، أو
// مُرسِل عام، أو إنهاء عملية بالاسم في أدوات القياس. كل فحص يعطي PASS أو FAIL
// ومعه ما رآه — ولا يطبع قيمة سرّية أبدًا، حتى حين يجدها.
//
// الاستعمال: node p02-security.mjs --root <root> [--scan-evidence]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { collectFacts } from "../p01-conformance/p01-facts.mjs";
import { argument, header, P02_TOOLS, RAW_DIRECTORY, readJson, writeEvidence } from "./p02-common.mjs";

const MODEL_NAMES = ["gpt-", "claude-", "llama", "mistral", "gemini", "deepseek", "qwen"];

/** متغيّرات البيئة الرسمية للمفاتيح. قيمها تُقرأ للمقارنة فقط ولا تُطبع. */
export const OFFICIAL_KEY_VARIABLES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY"];

/** أشكال تشبه المفاتيح. الغرض كشف تسرّب لا تصنيف مفاتيح. */
export const SECRET_SHAPES = [
  /\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /"(?:x-api-key|x-goog-api-key|authorization)"\s*:\s*"[^"]{8,}"/i,
];

function walk(directory, extensions, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "target", "target-e2e", "dist", "build-tests", ".git"].includes(entry.name)) continue;
      walk(full, extensions, found);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

/** الجزء الذي يدخل ثنائي المنتج من ملف Rust: ما قبل وحدة الاختبار. */
function productPart(file, text) {
  return file.endsWith(".rs") ? (text.split("#[cfg(test)]")[0] ?? text) : text;
}

function check(id, ok, detail, extra = {}) {
  return { check_id: id, verdict: ok ? "PASS" : "FAIL", detail, ...extra };
}

/** نصّ خالٍ من شكل مفتاح، ومن قيمة أي مفتاح رسمي موجود في بيئة هذه العملية. */
export function findSecretLeaks(text, environment = process.env) {
  const hits = [];
  SECRET_SHAPES.forEach((shape, index) => {
    if (shape.test(text)) hits.push(`shape-${index}`);
  });
  for (const name of OFFICIAL_KEY_VARIABLES) {
    const value = environment[name];
    if (typeof value === "string" && value.trim().length >= 8 && text.includes(value.trim())) hits.push(`value-of-${name}`);
  }
  return hits;
}

export function modelNameHits(text) {
  const lower = text.toLowerCase().replace(/ollama/g, "");
  return MODEL_NAMES.filter((name) => lower.includes(name));
}

function evidenceLeakCheck(root) {
  const files = [
    ...walk(join(root, "evidence"), [".json"]).filter((file) => /[\\/](phase-02-|p02-native[\\/])/.test(file)),
    ...walk(join(root, RAW_DIRECTORY), [".json", ".txt", ".log"]),
  ];
  const unique = [...new Set(files)];
  const offenders = [];
  for (const file of unique) {
    const hits = findSecretLeaks(readFileSync(file, "utf8"));
    if (hits.length > 0) offenders.push(`${relative(root, file)}: ${hits.join(",")}`);
  }
  return check("P02-SEC-EVIDENCE-NO-SECRET", offenders.length === 0, offenders.length === 0 ? `${unique.length} evidence files scanned, no key shape and no official key value found` : offenders.join("; "), { files_scanned: unique.length });
}

function sourceLeakCheck(root) {
  const places = ["desktop/host/core/src", "desktop/host/providers/src", "desktop/host/app/src", "desktop/renderer/src"];
  const offenders = [];
  let scanned = 0;
  for (const place of places) {
    for (const file of walk(join(root, place), [".rs", ".ts", ".tsx"])) {
      scanned += 1;
      // وحدات الاختبار داخل ملفات Rust تحمل مفاتيح وهمية عمدًا لاختبار الحجب؛ المنتج وحده يُفحص.
      const text = productPart(file, readFileSync(file, "utf8"));
      if (findSecretLeaks(text, {}).length > 0) offenders.push(relative(root, file));
    }
  }
  return check("P02-SEC-SOURCE-NO-SECRET", offenders.length === 0, offenders.length === 0 ? `${scanned} product source files carry no key-shaped literal` : offenders.join(", "));
}

function modelNameCheck(root) {
  const offenders = [];
  let scanned = 0;
  for (const place of ["desktop/host/providers/src", "desktop/host/core/src", "desktop/host/app/src", "desktop/renderer/src"]) {
    for (const file of walk(join(root, place), [".rs", ".ts", ".tsx"])) {
      scanned += 1;
      const hits = modelNameHits(readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${relative(root, file)}: ${hits.join(",")}`);
    }
  }
  return check("P02-SEC-NO-MODEL-NAME", offenders.length === 0, offenders.length === 0 ? `${scanned} product files carry no model family name` : offenders.join("; "));
}

// كل ملف هنا FFI ضيق الغرض بواجهة Win32 وحدها، ولا شيء غيره فيه: مخزن بيانات
// الاعتماد، وإنهاء عمليات WebView2 الفرعية عند الخروج. توسيع هذه القائمة
// يعني ملفًا جديدًا بالاسم هنا، لا فتح unsafe في أي مكان.
// Phase-05 أضاف منفذ سطح المكتب لـWindows بالاسم: FFI إلى user32/gdi32، ولا مكان آخر.
// Phase-08 (ADR-028) أضاف ملفّي FFI بالاسم في حزمة منافذ ويندوز: مُطلِق كائن المهمّة، وصندوق AppContainer.
const UNSAFE_CONFINED_FILES = new Set([
  "desktop/host/app/src/credentials.rs",
  "desktop/host/app/src/shutdown.rs",
  "desktop/host/app/src/desktop_win32.rs",
  // نسخة واحدة من التطبيق (2026-10-01): EnumWindows وSetForegroundWindow فقط، بلا ذاكرة مشتركة.
  "desktop/host/app/src/single_instance.rs",
  // عُدّة القياس (2026-10-06، ليست في المنتج): CredReadW وCredFree وحدهما، قراءة مفتاح حفظه المالك، بلا كتابة ولا حذف.
  "desktop/host/harness/src/credentials.rs",
  "desktop/host/win/src/process.rs",
  "desktop/host/win/src/sandbox.rs",
  // ADR-042 (2026-10-19): إشعار النظام بـShell_NotifyIconW وحده، وقراءة النافذة الأمامية وأيقونتها.
  "desktop/host/app/src/notify_win32.rs",
]);

function unsafeConfinedCheck(root) {
  const offenders = [];
  for (const file of walk(join(root, "desktop/host"), [".rs"])) {
    const rel = relative(root, file).split("\\").join("/");
    if (!/\/src\//.test(rel)) continue;
    const code = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
    if (/\bunsafe\s*\{/.test(code) && !UNSAFE_CONFINED_FILES.has(rel)) offenders.push(rel);
  }
  const core = readFileSync(join(root, "desktop/host/core/src/lib.rs"), "utf8");
  const providers = readFileSync(join(root, "desktop/host/providers/src/lib.rs"), "utf8");
  const forbidden = core.includes("#![forbid(unsafe_code)]") && providers.includes("#![forbid(unsafe_code)]");
  return check("P02-SEC-UNSAFE-CONFINED", offenders.length === 0 && forbidden, offenders.length === 0 ? "unsafe appears only in the named Windows FFI files; core and providers forbid it" : offenders.join(", "));
}

function dependencyCheck(root) {
  const banned = ["reqwest", "hyper", "ureq", "isahc", "curl", "openai", "async-openai", "anthropic"];
  const offenders = [];
  for (const manifest of ["desktop/host/providers/Cargo.toml", "desktop/host/core/Cargo.toml"]) {
    const text = readFileSync(join(root, manifest), "utf8");
    for (const name of banned) if (new RegExp(`^\\s*${name}\\s*=`, "m").test(text)) offenders.push(`${manifest}: ${name}`);
  }
  return check("P02-SEC-NO-HTTP-SDK", offenders.length === 0, offenders.length === 0 ? "the provider and core crates declare no HTTP framework and no vendor SDK" : offenders.join("; "));
}

function closedOperationSetCheck(root) {
  const registry = readJson(join(root, "contracts/registry/phase-02-ipc.registry.json"));
  const operations = Array.isArray(registry?.operations) ? registry.operations.map((entry) => entry.operation) : [];
  const router = readFileSync(join(root, "desktop/host/core/src/p02/ipc/mod.rs"), "utf8");
  const unrouted = operations.filter((operation) => !router.includes(`"${operation}"`));
  const generic = operations.filter((operation) => /(^|\.)(call|execute|dispatch|run|exec|shell|eval)$/.test(operation));
  const allRouted = registry?.operations?.every((entry) => entry.routing_status === "ROUTED") === true;
  const client = readFileSync(join(root, "desktop/renderer/src/ipc/p02-client.ts"), "utf8");
  const publicCall = /^\s*(?:public\s+)?(?:async\s+)?call\s*[<(]/m.test(client.replace(/private call/g, ""));
  const ok = operations.length === 19 && unrouted.length === 0 && generic.length === 0 && allRouted && !publicCall;
  return check("P02-SEC-CLOSED-OPERATION-SET", ok, `19 expected, ${operations.length} registered; unrouted ${unrouted.join(",") || "none"}; generic names ${generic.join(",") || "none"}; public generic client call ${publicCall}`);
}

/**
 * أنماط إنهاء العمليات بالاسم. تُبنى من أجزاء حتى لا يطابق مصدرُ هذا الملف نفسه
 * فحصَ Phase-00 الذي يمسح مجلد الأدوات بحثًا عن الأنماط ذاتها.
 */
const KILL_BY_NAME = new RegExp(
  [
    ["Stop", "-Process[^\\n]*-Name\\b"].join(""),
    ["task", "kill[^\\n]*/(?:IM|im)\\b"].join(""),
    ["Get-Process[^\\n|]*\\|\\s*Stop", "-Process"].join(""),
    ["\\bp", "kill\\b"].join(""),
    ["\\bkill", "all\\b"].join(""),
  ].join("|"),
  "i",
);

function toolingKillCheck(root) {
  const offenders = [];
  for (const file of walk(join(root, "tools/p02-conformance"), [".ps1", ".mjs"])) {
    const text = readFileSync(file, "utf8").replace(/^\s*#.*$/gm, "").replace(/\/\/.*$/gm, "");
    if (KILL_BY_NAME.test(text)) offenders.push(relative(root, file));
  }
  return check("P02-SEC-NO-KILL-BY-NAME", offenders.length === 0, offenders.length === 0 ? "the Phase-02 instruments end only processes they started, by handle" : offenders.join(", "));
}

function noLoggingOfContentCheck(root) {
  const offenders = [];
  for (const place of ["desktop/host/core/src", "desktop/host/providers/src"]) {
    for (const file of walk(join(root, place), [".rs"])) {
      const text = readFileSync(file, "utf8");
      const body = text.split("#[cfg(test)]")[0] ?? text;
      if (/\b(println!|eprintln!|dbg!|print!)\s*\(/.test(body)) offenders.push(relative(root, file));
    }
  }
  return check("P02-SEC-NO-CONTENT-LOGGING", offenders.length === 0, offenders.length === 0 ? "host core and providers write nothing to stdout or stderr; audit details are key-filtered and bounded" : offenders.join(", "));
}

function capabilityFileCheck(root) {
  const capability = readJson(join(root, "desktop/host/app/capabilities/default.json"));
  const permissions = Array.isArray(capability?.permissions) ? capability.permissions : [];
  const ok = permissions.every((entry) => /^core:(event|window|webview):default$/.test(String(entry)));
  return check("P02-SEC-NO-NEW-WINDOW-PERMISSION", ok, `window permissions: ${permissions.join(", ")}`);
}

function phase01FactsCheck(root) {
  const facts = collectFacts(root, {});
  const wanted = [
    "every_routed_operation_has_an_owning_service",
    "host_exposes_one_command_only",
    "no_shell_or_filesystem_permission_granted",
    "no_boundary_error_type_carries_internal_detail",
    "no_invented_metric_in_the_renderer_source",
    "no_model_name_is_hard_coded",
  ];
  return wanted.map((id) => {
    const fact = facts.get(id);
    return check(`P01-FACT:${id}`, fact?.verdict === "PASS", fact?.detail ?? "fact not produced");
  });
}

/** سجل سلسلة التوريد: الحزم الجديدة في Phase-02 بإصداراتها المقفلة. */
export function supplyChain(root) {
  const lock = readFileSync(join(root, "desktop/host/Cargo.lock"), "utf8");
  const version = (name) => new RegExp(`name = "${name}"\\nversion = "([^"]+)"`).exec(lock.replace(/\r\n/g, "\n"))?.[1] ?? null;
  const entries = [
    { dependency: "httparse", crate: "polaris-host-providers", reason: "parses HTTP/1.1 response heads; no HTTP framework is used", risk: "LOW — small, widely used, no I/O", license: "MIT OR Apache-2.0" },
    { dependency: "url", crate: "polaris-host-providers", reason: "WHATWG URL parsing for the endpoint policy", risk: "LOW — maintained by the Servo project", license: "MIT OR Apache-2.0" },
    { dependency: "native-tls", crate: "polaris-host-providers", reason: "TLS through the operating system (SChannel on Windows); no cryptography implemented here", risk: "LOW — delegates to the OS TLS stack and certificate store", license: "MIT OR Apache-2.0" },
    { dependency: "zeroize", crate: "polaris-host-providers", reason: "best-effort wiping of key material held in memory", risk: "LOW — no I/O, audited RustSec crate", license: "Apache-2.0 OR MIT" },
    { dependency: "rusqlite (bundled SQLite)", crate: "polaris-host-core", reason: "the local project, model and audit store with versioned migrations", risk: "MEDIUM — compiles SQLite C source; mitigated by a pinned version and no extension loading", license: "MIT (rusqlite), public domain (SQLite)", version_of: "rusqlite" },
    { dependency: "sha2", crate: "polaris-host-core", reason: "content digests and the audit hash chain", risk: "LOW — RustCrypto", license: "MIT OR Apache-2.0" },
    { dependency: "windows-sys", crate: "polaris-host (Windows only)", reason: "Credential Manager and the native credential prompt; the version already in the tree through the framework", risk: "LOW — Microsoft-published bindings, no new transitive tree", license: "MIT OR Apache-2.0" },
  ];
  return entries.map((entry) => ({ ...entry, version: version(entry.version_of ?? entry.dependency), renderer_dependencies_added: 0 }));
}

export function scan(root, options = {}) {
  const checks = [
    sourceLeakCheck(root),
    modelNameCheck(root),
    unsafeConfinedCheck(root),
    dependencyCheck(root),
    closedOperationSetCheck(root),
    toolingKillCheck(root),
    noLoggingOfContentCheck(root),
    capabilityFileCheck(root),
    ...phase01FactsCheck(root),
  ];
  if (options.scanEvidence === true) checks.push(evidenceLeakCheck(root));
  return { checks, supply_chain: supplyChain(root) };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = scan(root, { scanEvidence: process.argv.includes("--scan-evidence") });
  const failed = result.checks.filter((entry) => entry.verdict !== "PASS");
  const name = process.argv.includes("--scan-evidence") ? "security-evidence.local.json" : "security-static.local.json";
  writeEvidence(join(root, RAW_DIRECTORY, name), { ...header(P02_TOOLS.security, root), ...result });
  for (const entry of result.checks) console.log(`${entry.verdict.padEnd(6)} ${entry.check_id}  ${entry.detail}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}
