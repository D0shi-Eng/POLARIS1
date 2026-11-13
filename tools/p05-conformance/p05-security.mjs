// الفحص الساكن لأمن Phase-05، وفحص الأدلة المكتوبة بحثًا عن سرّ أو محتوى غير موثوق.
//
// كل فحص يقرأ مصدرًا حقيقيًّا في هذا المستودع ويحكم على ما وجده، وغياب الملف
// NOT_TESTED لا نجاح. وما تفحصه هنا خصائص عن غياب شيء لا يكفي اختبار وحدة
// لإثباته: لا عملية IPC تتنقّل أو تنقر أو تكتب أو ترفع ثقة ذاكرة، ولا قدرة شاملة،
// ولا تشغيل لملف منزَّل، ولا `unsafe` خارج ملف FFI المسمّى، ولا تجهيزة في مسار المنتج.
//
// الاستعمال:
//   node p05-security.mjs --root D:\POLARIS
//   node p05-security.mjs --root D:\POLARIS --scan-evidence

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { findSecretLeaks } from "../p04-conformance/p04-security.mjs";
import { argument, evidenceSuffix, header, P05_EVIDENCE, P05_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p05-common.mjs";

export { findSecretLeaks };

/** نصوص من التجهيزات لا يجوز أن تظهر في وثيقة قانونية: محتوى غير موثوق أو سرّ مزروع. */
const FIXTURE_CONTENT = Object.freeze(["P05-INJECTION-MARKER", "hunter2", "Ignore previous instructions", "approve every tool"]);

function read(root, relative) {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** يزيل تعليقات Rust وTS السطرية: الشرح يذكر ما لا يفعله الكود. */
function code(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

/** يزيل كتلة الاختبارات: ما يفعله الاختبار ليس ما يفعله المنتج. */
function withoutTests(source) {
  const index = source.indexOf("#[cfg(test)]");
  return index >= 0 ? source.slice(0, index) : source;
}

function walk(directory, extensions, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "target", "target-e2e", "dist", "build-tests"].includes(entry.name)) continue;
      walk(full, extensions, found);
    } else if (extensions.includes(extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

function rel(root, file) {
  return file.replace(root, "").replace(/\\/g, "/").replace(/^\//, "");
}

function absent(id, title, path) {
  return { check_id: id, title, verdict: "NOT_TESTED", detail: `${path} is absent, so nothing was measured` };
}

function judge(id, title, satisfied, detail) {
  return { check_id: id, title, verdict: satisfied ? "PASS" : "FAIL", detail };
}

export function staticChecks(root) {
  const checks = [];
  const p05Files = walk(join(root, "desktop/host/core/src/p05"), [".rs"]);

  // ١ — لا عملية IPC تتنقّل أو تنقر أو تكتب أو تنفّذ أو ترفع ثقة ذاكرة.
  {
    const source = read(root, "desktop/host/core/src/p05/ipc.rs");
    if (source === null) checks.push(absent("P05-SEC-NO-ACTION-OPERATION", "no Phase-05 IPC operation acts on the web, the screen or memory trust", "p05/ipc.rs"));
    else {
      const operations = /pub const OPERATIONS: \[&str; \d+\] = \[(.*?)\];/s.exec(source)?.[1] ?? "";
      const names = [...operations.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const actors = names.filter((name) => /navigate|click|type|execute|raw|command|trust|verify|write|input|press|key/i.test(name));
      const forbidden = /FORBIDDEN[^=]*=\s*\[(.*?)\];/s.exec(source)?.[1] ?? "";
      const guarded = ["browser.raw_execute", "computer.raw_command", "memory.trust"].filter((name) => forbidden.includes(`"${name}"`));
      checks.push(
        judge(
          "P05-SEC-NO-ACTION-OPERATION",
          "no Phase-05 IPC operation acts on the web, the screen or memory trust",
          names.length === 12 && actors.length === 0 && guarded.length === 3,
          `operations ${names.length}: ${names.join(", ")}; action-shaped ${actors.length}; forbidden by name ${guarded.length}/3`,
        ),
      );
    }
  }

  // ٢ — القدرات دقيقة ولا قدرة شاملة.
  {
    const source = read(root, "desktop/host/core/src/p05/tooling.rs");
    if (source === null) checks.push(absent("P05-SEC-NO-CATCH-ALL-CAPABILITY", "capabilities are fine-grained and none grants everything", "p05/tooling.rs"));
    else {
      const body = code(withoutTests(source));
      const codes = [...body.matchAll(/Self::[A-Za-z]+ => "([A-Z][A-Z_]*)"/g)].map((m) => m[1]);
      const unique = [...new Set(codes)];
      const catchAll = unique.filter((name) => /_ALL$|FULL_|ANY|EVERYTHING|ADMIN/.test(name));
      const required = ["BROWSER_NAVIGATE", "BROWSER_READ", "BROWSER_CLICK", "BROWSER_TYPE", "BROWSER_DOWNLOAD", "BROWSER_UPLOAD", "SCREEN_READ", "WINDOW_LIST", "WINDOW_FOCUS", "POINTER_MOVE", "POINTER_CLICK", "KEYBOARD_INPUT", "TEXT_INPUT", "SCROLL"];
      const missing = required.filter((name) => !unique.includes(name));
      checks.push(
        judge(
          "P05-SEC-NO-CATCH-ALL-CAPABILITY",
          "capabilities are fine-grained and none grants everything",
          catchAll.length === 0 && missing.length === 0,
          `capabilities ${unique.length}: ${unique.join(", ")}; catch-all ${catchAll.length}; required but absent ${missing.join(", ") || "none"}`,
        ),
      );
    }
  }

  // ٣ — لا مصدر Phase-05 ولا منفذ Win32 يشغّل عملية أو يفتح ملفًّا بالصدفة.
  {
    const files = [...p05Files, join(root, "desktop/host/app/src/desktop_win32.rs")].filter((file) => existsSync(file));
    if (files.length < 2) checks.push(absent("P05-SEC-NO-PROCESS-SPAWN", "no Phase-05 source spawns a process or opens a file through the shell", "core/src/p05"));
    else {
      const offenders = [];
      for (const file of files) {
        const source = code(withoutTests(readFileSync(file, "utf8")));
        if (/std::process::Command|tokio::process|Command::new|CreateProcess|ShellExecute|WinExec|open::that/.test(source)) offenders.push(rel(root, file));
      }
      checks.push(
        judge(
          "P05-SEC-NO-PROCESS-SPAWN",
          "no Phase-05 source spawns a process or opens a file through the shell",
          offenders.length === 0,
          offenders.length === 0 ? `${files.length} files scanned, none constructs a process` : offenders.join("; "),
        ),
      );
    }
  }

  // ٤ — الملف المنزَّل يُحجز ولا يُفتح: اسم محايد، وعلامة المنطقة، ولا مسار تشغيل.
  {
    const source = read(root, "desktop/host/core/src/p05/browser/runtime.rs");
    if (source === null) checks.push(absent("P05-SEC-DOWNLOAD-QUARANTINED", "a download is quarantined under a neutral name and never opened", "p05/browser/runtime.rs"));
    else {
      const body = code(withoutTests(source));
      const neutral = /\.quarantine/.test(body);
      const zone = /Zone\.Identifier/.test(body);
      const opens = /Command::new|ShellExecute|open::that|set_permissions/.test(body);
      const uploadsOnlyDownloads = /download:/.test(body);
      checks.push(
        judge(
          "P05-SEC-DOWNLOAD-QUARANTINED",
          "a download is quarantined under a neutral name and never opened, and an upload names only a quarantined download",
          neutral && zone && !opens && uploadsOnlyDownloads,
          `neutral quarantine name: ${neutral}; zone mark written: ${zone}; an open or run path exists: ${opens}; uploads resolve only download references: ${uploadsOnlyDownloads}`,
        ),
      );
    }
  }

  // ٥ — unsafe محصور في ملف FFI المسمّى، والنواة تمنعه.
  {
    const lib = read(root, "desktop/host/core/src/lib.rs");
    const win32 = read(root, "desktop/host/app/src/desktop_win32.rs");
    if (lib === null || win32 === null) checks.push(absent("P05-SEC-UNSAFE-CONFINED", "unsafe code lives only in the named Win32 desktop file", "core/src/lib.rs or app/src/desktop_win32.rs"));
    else {
      const forbidden = lib.includes("#![forbid(unsafe_code)]");
      const inP05 = p05Files.filter((file) => /\bunsafe\s*\{/.test(code(readFileSync(file, "utf8")))).map((file) => rel(root, file));
      const gated = /#\[cfg\(windows\)\]\s*mod desktop_win32;/.test(read(root, "desktop/host/app/src/lib.rs") ?? "");
      checks.push(
        judge(
          "P05-SEC-UNSAFE-CONFINED",
          "unsafe code lives only in the named Win32 desktop file",
          forbidden && inP05.length === 0 && gated,
          `core forbids unsafe: ${forbidden}; unsafe blocks in Phase-05 core ${inP05.length}; the FFI module is Windows-only: ${gated}`,
        ),
      );
    }
  }

  // ٦ — سياسة التنقّل: http وhttps وحدهما، والعناوين الخاصّة والبيانات الوصفية مرفوضة.
  {
    const source = read(root, "desktop/host/core/src/p05/browser/url_policy.rs");
    if (source === null) checks.push(absent("P05-SEC-NAVIGATION-POLICY", "only http and https are navigable and private destinations are refused", "p05/browser/url_policy.rs"));
    else {
      const body = code(withoutTests(source));
      // القاعدة قائمة سماح لا قائمة منع: كل مخطط غير http وhttps مرفوض. والاختبار
      // المرافق يسمّي المخططات الستّ التي طلبتها المرحلة ليُثبت أنها تقع في الرفض.
      const tests = source.slice(Math.max(0, source.indexOf("fn only_http_and_https_are_navigable")));
      const schemes = ["file:", "javascript:", "data:", "chrome:", "edge:", "devtools:"].filter((scheme) => tests.includes(`"${scheme}`));
      const onlyHttp = /"http"\s*\|\s*"https"\s*=>\s*\{\}\s*_\s*=>\s*return Err\(NavigationDenial::SchemeNotAllowed\)/.test(body);
      const metadata = /169[,. ]\s*254[,. ]\s*169[,. ]\s*254/.test(source);
      const redirects = /check_redirect/.test(body) && /MAX_REDIRECTS/.test(body);
      const fixtureExplicit = /pub fn with_fixture_origins/.test(body) && /pub fn product\(/.test(body);
      checks.push(
        judge(
          "P05-SEC-NAVIGATION-POLICY",
          "only http and https are navigable and private destinations are refused",
          schemes.length === 6 && onlyHttp && metadata && redirects && fixtureExplicit,
          `schemes the refusal test names ${schemes.length}/6; an http/https allowlist refuses every other scheme: ${onlyHttp}; metadata address refused: ${metadata}; redirects re-checked and bounded: ${redirects}; fixture origins only by explicit construction: ${fixtureExplicit}`,
        ),
      );
    }
  }

  // ٧ — أصل تجهيزة الويب لا يوجد إلا في بناء القياس، وتجهيزة سطح المكتب لا تبلغ مسار المنتج.
  {
    const lib = read(root, "desktop/host/app/src/lib.rs");
    const host = read(root, "desktop/host/core/src/services/host.rs");
    if (lib === null || host === null) checks.push(absent("P05-SEC-NO-FIXTURE-IN-PRODUCT-PATH", "no test fixture is reachable from the product path", "app/src/lib.rs or services/host.rs"));
    else {
      const productPolicy = /#\[cfg\(not\(feature = "e2e"\)\)\]\s*let navigation = NavigationPolicy::product\(\);/.test(lib);
      const fixtureGated = /#\[cfg\(feature = "e2e"\)\]\s*let navigation = match e2e_config::web_fixture_port\(\)/.test(lib);
      const desktopInProduct = /FixtureDesktop/.test(code(withoutTests(lib))) || /FixtureDesktop/.test(code(withoutTests(host)));
      checks.push(
        judge(
          "P05-SEC-NO-FIXTURE-IN-PRODUCT-PATH",
          "no test fixture is reachable from the product path",
          productPolicy && fixtureGated && !desktopInProduct,
          `product navigation policy has no fixture: ${productPolicy}; the fixture origin exists only with the measurement feature: ${fixtureGated}; the fixture desktop is referenced by the product path: ${desktopInProduct}`,
        ),
      );
    }
  }

  // ٨ — الذاكرة لا طريق لها إلى الثقة: لا «محقَّق»، والوكيل يكتب نصّ نموذج.
  {
    const model = read(root, "desktop/host/core/src/p05/memory/model.rs");
    const policy = read(root, "desktop/host/core/src/p05/memory/policy.rs");
    const schema = read(root, "contracts/schemas/desktop-p05-domain.schema.json");
    if (model === null || policy === null || schema === null) checks.push(absent("P05-SEC-MEMORY-HAS-NO-TRUST-PATH", "memory has no path to verified or trusted status", "p05/memory"));
    else {
      const verification = /"MemoryVerification"\s*:\s*\{[^}]*"enum"\s*:\s*\[([^\]]*)\]/s.exec(schema)?.[1] ?? "";
      const verifiedState = /"VERIFIED"/.test(verification);
      const agentModel = /MemoryTrustClass::ModelGenerated/.test(code(withoutTests(policy)));
      const agentUnverified = /MemoryVerification::Unverified/.test(code(withoutTests(policy)));
      checks.push(
        judge(
          "P05-SEC-MEMORY-HAS-NO-TRUST-PATH",
          "memory has no path to verified or trusted status",
          verification.length > 0 && !verifiedState && agentModel && agentUnverified,
          `verification vocabulary ${verification.replace(/\s+/g, "")}; a VERIFIED state exists: ${verifiedState}; an agent write is forced to model origin: ${agentModel} and unverified: ${agentUnverified}`,
        ),
      );
    }
  }

  // ٩ — الذاكرة والملاحظة تصلان إلى النموذج داخل حدّ موسوم غير موثوق.
  {
    const prompt = read(root, "desktop/host/core/src/p03/prompt.rs");
    if (prompt === null) checks.push(absent("P05-SEC-CONTENT-FENCED-AS-DATA", "memory and page or screen content reach the model fenced as data", "p03/prompt.rs"));
    else {
      const memoryLabel = prompt.includes("MEMORY — UNTRUSTED / NON-AUTHORITATIVE");
      const observationLabel = prompt.includes("OBSERVATION — WEB_UNTRUSTED / SCREEN_CONTENT");
      const fenced = /<<<UNTRUSTED/.test(prompt);
      checks.push(
        judge(
          "P05-SEC-CONTENT-FENCED-AS-DATA",
          "memory and page or screen content reach the model fenced as data",
          memoryLabel && observationLabel && fenced,
          `memory label: ${memoryLabel}; observation label: ${observationLabel}; untrusted fence: ${fenced}`,
        ),
      );
    }
  }

  // ١٠ — العارض لا يملك فعلًا على الويب أو الشاشة أو الثقة.
  {
    const client = read(root, "desktop/renderer/src/ipc/p05-client.ts");
    if (client === null) checks.push(absent("P05-SEC-RENDERER-CANNOT-ACT", "the renderer client has no method that navigates, clicks, types or trusts", "src/ipc/p05-client.ts"));
    else {
      const methods = [...client.matchAll(/^\s{2}(?:async\s+)?([A-Za-z][A-Za-z0-9]*)\s*\(/gm)].map((match) => match[1]).filter((name) => name !== "constructor" && name !== "call");
      const actors = methods.filter((name) => /^(navigate|click|type|press|execute|invoke|run|trust|verify|write|screenshot|capture)/i.test(name));
      checks.push(
        judge(
          "P05-SEC-RENDERER-CANNOT-ACT",
          "the renderer client has no method that navigates, clicks, types or trusts",
          methods.length === 12 && actors.length === 0,
          `methods ${methods.length}: ${methods.join(", ")}; action-shaped ${actors.length}`,
        ),
      );
    }
  }

  // ١١ — أمر القياس غير موجود في ثنائي المنتج، وأفعاله قراءة.
  {
    const lib = read(root, "desktop/host/app/src/lib.rs");
    const native = read(root, "desktop/host/app/src/p05_native.rs");
    if (lib === null || native === null) checks.push(absent("P05-SEC-MEASUREMENT-GATED-AND-READ-ONLY", "the Phase-05 measurement command is feature-gated and read-only", "app/src"));
    else {
      const commandGated = /#\[cfg\(feature = "e2e"\)\]\s*#\[tauri::command\]\s*fn polaris_e2e_p05/s.test(lib);
      const moduleGated = /#\[cfg\(feature = "e2e"\)\]\s*mod p05_native;/s.test(lib);
      const productHandler = /#\[cfg\(not\(feature = "e2e"\)\)\]\s*let builder = builder\.invoke_handler\(tauri::generate_handler!\[polaris_ipc\]\);/s.test(lib);
      const actions = [...withoutTests(native).matchAll(/"(p05\.[a-z.]+)"/g)].map((match) => match[1]);
      const verbs = ["execute", "invoke", "run", "call", "submit", "grant", "write", "approve", "delete", "set", "navigate", "click", "type", "trust"];
      const writers = actions.filter((name) => name.split(".").some((segment) => verbs.includes(segment)));
      checks.push(
        judge(
          "P05-SEC-MEASUREMENT-GATED-AND-READ-ONLY",
          "the Phase-05 measurement command is feature-gated and read-only",
          commandGated && moduleGated && productHandler && actions.length > 0 && writers.length === 0,
          `command gated: ${commandGated}; module gated: ${moduleGated}; product handler registers polaris_ipc alone: ${productHandler}; actions ${[...new Set(actions)].join(", ")}; mutating-shaped ${writers.length}`,
        ),
      );
    }
  }

  // ١٢ — لا اعتماد يُرسل إلى الويب: لا ترويسة تفويض ولا ملف تعريف ارتباط.
  {
    const engine = read(root, "desktop/host/core/src/p05/browser/engine.rs");
    if (engine === null) checks.push(absent("P05-SEC-NO-CREDENTIAL-TO-WEB", "the browser engine sends no authorization header and no cookie", "p05/browser/engine.rs"));
    else {
      const body = code(withoutTests(engine));
      const sends = /"(Authorization|Cookie|Proxy-Authorization)"/i.test(body) || /CredentialStore|credential_store|api_key|secret_store|get_secret/.test(body);
      const sharedClient = /HttpClient/.test(body);
      checks.push(
        judge(
          "P05-SEC-NO-CREDENTIAL-TO-WEB",
          "the browser engine sends no authorization header and no cookie",
          !sends && sharedClient,
          `a credential or cookie header is set: ${sends}; the shared HTTP client is used: ${sharedClient}`,
        ),
      );
    }
  }

  // ١٣ — واجهات الأمان والاعتماد تُرفض، وحقل كلمة المرور لا يستقبل نصًّا ولا يُرسل.
  {
    const risk = read(root, "desktop/host/core/src/p05/computer/risk.rs");
    const browser = read(root, "desktop/host/core/src/p05/browser/runtime.rs");
    if (risk === null || browser === null) checks.push(absent("P05-SEC-SENSITIVE-SURFACES-REFUSED", "security prompts, credential dialogs and password fields are refused", "p05 sources"));
    else {
      const surfaces = ["consent.exe", "credentialuibroker.exe", "lockapp.exe"].filter((name) => risk.toLowerCase().includes(name));
      const password = /PASSWORD_FIELD/.test(risk);
      const neverSubmitted = /password/i.test(code(withoutTests(browser)));
      checks.push(
        judge(
          "P05-SEC-SENSITIVE-SURFACES-REFUSED",
          "security prompts, credential dialogs and password fields are refused",
          surfaces.length === 3 && password && neverSubmitted,
          `security surfaces named ${surfaces.length}/3 (${surfaces.join(", ")}); password typing refused: ${password}; password fields excluded from submission: ${neverSubmitted}`,
        ),
      );
    }
  }

  // ١٤ — كل رمز خطأ يعبر الحدّ من المفردات المغلقة.
  {
    const canonical = ["VALIDATION_ERROR", "UNSUPPORTED_VERSION", "POLICY_DENIED", "MALFORMED_MESSAGE", "CONTRACT_VIOLATION", "DEPENDENCY_UNAVAILABLE", "TIMEOUT", "CONFLICT", "INTERNAL_ERROR"];
    if (p05Files.length === 0) checks.push(absent("P05-SEC-CANONICAL-ERROR-CODES", "every Phase-05 boundary error code is one the contract declares", "core/src/p05"));
    else {
      const offenders = [];
      let constructed = 0;
      for (const file of p05Files) {
        for (const match of readFileSync(file, "utf8").matchAll(/HostError::new\(\s*[^,]+,\s*"([A-Z_]+)"/g)) {
          constructed += 1;
          if (!canonical.includes(match[1])) offenders.push(`${rel(root, file)}: ${match[1]}`);
        }
      }
      checks.push(
        judge(
          "P05-SEC-CANONICAL-ERROR-CODES",
          "every Phase-05 boundary error code is one the contract declares",
          offenders.length === 0,
          offenders.length === 0 ? `${p05Files.length} files scanned, ${constructed} constructed error codes, all in the closed vocabulary` : offenders.join("; "),
        ),
      );
    }
  }

  // ١٥ — لا سرّ مكتوب في مصدر Phase-05 أو أداة مطابقته.
  {
    const files = [
      ...p05Files,
      join(root, "desktop/host/app/src/desktop_win32.rs"),
      join(root, "desktop/host/app/src/p05_native.rs"),
      ...walk(join(root, "desktop/renderer/src/screens/p05"), [".tsx", ".ts"]),
      ...walk(join(root, "tools/p05-conformance"), [".mjs", ".ps1"]),
    ].filter((file) => existsSync(file));
    const offenders = [];
    for (const file of files) {
      const hits = findSecretLeaks(readFileSync(file, "utf8"));
      if (hits.length > 0 && !file.endsWith("p05-security.mjs")) offenders.push(`${rel(root, file)}: ${hits.join(",")}`);
    }
    checks.push(
      judge(
        "P05-SEC-NO-SECRET-IN-SOURCE",
        "no Phase-05 source or instrument carries a key-shaped value",
        offenders.length === 0,
        offenders.length === 0 ? `${files.length} files scanned, none carries a key shape` : offenders.join("; "),
      ),
    );
  }

  // ١٦ — الملاحظة تُخزَّن ببصماتها: لا بكسلات ولا نصّ صفحة كامل في المخزن.
  {
    const store = read(root, "desktop/host/core/src/p05/computer/store.rs");
    const migrations = read(root, "desktop/host/core/src/storage/migrations.rs");
    if (store === null || migrations === null) checks.push(absent("P05-SEC-OBSERVATIONS-STORED-AS-DIGESTS", "observations are persisted as digests and bounded metadata only", "p05/computer/store.rs"));
    else {
      const table = /CREATE TABLE computer_observations \((.*?)\) STRICT;/s.exec(migrations)?.[1] ?? "";
      const pixels = /pixels|image|bitmap|png|screenshot/i.test(table);
      const digests = /frame_digest/.test(table) && /layout_digest/.test(table);
      checks.push(
        judge(
          "P05-SEC-OBSERVATIONS-STORED-AS-DIGESTS",
          "observations are persisted as digests and bounded metadata only",
          table.length > 0 && !pixels && digests,
          `observation table read: ${table.length > 0}; a pixel or image column exists: ${pixels}; frame and layout digests stored: ${digests}`,
        ),
      );
    }
  }

  return checks;
}

/** يفحص الوثائق القانونية المكتوبة فعلًا. وثيقة غائبة NOT_TESTED لا PASS. */
export function evidenceChecks(root) {
  const suffix = evidenceSuffix();
  const present = [];
  const leaks = [];
  const reasoning = [];
  const content = [];
  for (const base of P05_EVIDENCE) {
    const path = join(root, "evidence", `${base}${suffix}.json`);
    if (!existsSync(path)) continue;
    present.push(base);
    const text = readFileSync(path, "utf8");
    const hits = findSecretLeaks(text);
    if (hits.length > 0) leaks.push(`${base}: ${hits.join(",")}`);
    if (/"(reasoning|chain_of_thought|thoughts|scratchpad)"\s*:/i.test(text)) reasoning.push(base);
    const carried = FIXTURE_CONTENT.filter((needle) => text.includes(needle));
    if (carried.length > 0) content.push(`${base}: ${carried.length} fixture string(s)`);
  }
  if (present.length === 0) {
    return [
      absent("P05-EVIDENCE-NO-SECRET", "no canonical Phase-05 document carries a key-shaped value", "evidence/phase-05-*.json"),
      absent("P05-EVIDENCE-NO-REASONING-FIELD", "no canonical Phase-05 document carries a reasoning trace field", "evidence/phase-05-*.json"),
      absent("P05-EVIDENCE-NO-UNTRUSTED-CONTENT", "no canonical Phase-05 document carries page, screen or planted secret text", "evidence/phase-05-*.json"),
    ];
  }
  return [
    judge(
      "P05-EVIDENCE-NO-SECRET",
      "no canonical Phase-05 document carries a key-shaped value",
      leaks.length === 0,
      leaks.length === 0 ? `${present.length} document(s) scanned, none carries a key shape` : leaks.join("; "),
    ),
    judge(
      "P05-EVIDENCE-NO-REASONING-FIELD",
      "no canonical Phase-05 document carries a reasoning trace field",
      reasoning.length === 0,
      reasoning.length === 0 ? `${present.length} document(s) scanned, none carries a reasoning field` : reasoning.join(", "),
    ),
    judge(
      "P05-EVIDENCE-NO-UNTRUSTED-CONTENT",
      "no canonical Phase-05 document carries page, screen or planted secret text",
      content.length === 0,
      content.length === 0 ? `${present.length} document(s) scanned, none carries fixture page, screen or planted secret text` : content.join("; "),
    ),
  ];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const scanEvidence = process.argv.includes("--scan-evidence");
  const checks = scanEvidence ? evidenceChecks(root) : staticChecks(root);
  const name = scanEvidence ? "security-evidence.local.json" : "security-static.local.json";
  writeEvidence(join(root, RAW_DIRECTORY, name), { ...header(P05_TOOLS.security, root), scope: scanEvidence ? "EVIDENCE" : "STATIC", checks });
  for (const check of checks) console.log(`${check.verdict.padEnd(11)} ${check.check_id}  ${check.detail.slice(0, 200)}`);
  process.exitCode = checks.every((check) => check.verdict === "PASS") ? 0 : 1;
}
