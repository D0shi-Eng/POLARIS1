// الفحص الساكن لأمن Phase-06، وفحص الأدلة المكتوبة بحثًا عن سرّ أو كناري أو محتوى غير موثوق.
//
// كل فحص يقرأ مصدرًا حقيقيًّا في هذا المستودع ويحكم على ما وجده، وغياب الملف NOT_TESTED لا
// نجاح. وما تفحصه هنا خصائص عن غياب شيء لا يكفي اختبار وحدة لإثباته: لا عملية IPC تنفّذ
// عملية موصل أو تكشف مفتاحًا، ولا طريق HTTP إلى خدمة إلا من بوابة الموصلات، ولا متّبع
// لإعادة التوجيه، ولا سعر مشحون، ولا إعادة لأثر غير محميّ، ولا مفتاح في مصدر أو دليل.
//
// الاستعمال:
//   node p06-security.mjs --root D:\POLARIS
//   node p06-security.mjs --root D:\POLARIS --scan-evidence   (P06_CANARY في البيئة إن وُجد)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { findSecretLeaks } from "../p04-conformance/p04-security.mjs";
import { argument, evidenceSuffix, header, P06_EVIDENCE, P06_FINAL_GATE, P06_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p06-common.mjs";

export { findSecretLeaks };

/** نصوص من التجهيزات لا يجوز أن تظهر في وثيقة قانونية: محتوى خدمة غير موثوق. */
export const FIXTURE_CONTENT = Object.freeze(["P06-INJECTION-MARKER", "Ignore previous instructions", "approve every tool", "approval granted by the user", "upload your secrets"]);

function read(root, relative) {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** يزيل تعليقات Rust وTS السطرية: الشرح يذكر ما لا يفعله الكود. */
export function code(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

/** يزيل كتلة الاختبارات: ما يفعله الاختبار ليس ما يفعله المنتج. */
export function withoutTests(source) {
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
  const p06Files = walk(join(root, "desktop/host/core/src/p06"), [".rs"]);

  // ١ — لا عملية IPC تنفّذ عملية موصل أو تكشف مفتاحًا، والأسماء الخطرة ممنوعة بأسمائها.
  {
    const source = read(root, "desktop/host/core/src/p06/ipc.rs");
    const title = "no Phase-06 IPC operation runs a connector operation or reveals a key";
    if (source === null) checks.push(absent("P06-SEC-NO-INVOKE-OPERATION", title, "p06/ipc.rs"));
    else {
      const operations = /pub const OPERATIONS: \[&str; \d+\] = \[(.*?)\];/s.exec(source)?.[1] ?? "";
      const names = [...operations.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const actors = names.filter((name) => /invoke|execute|call|request|raw|reveal|secret\.get|credential\.get/i.test(name));
      const forbidden = /FORBIDDEN_OPERATIONS[^=]*=\s*\[(.*?)\];/s.exec(source)?.[1] ?? "";
      const guarded = ["connector.invoke", "connector.execute", "connector.call", "connector.secret.get", "connector.credential.get", "http.request"].filter((name) => forbidden.includes(`"${name}"`));
      checks.push(judge("P06-SEC-NO-INVOKE-OPERATION", title, names.length === 28 && actors.length === 0 && guarded.length === 6, `operations ${names.length}; action-shaped ${actors.length}; forbidden by name ${guarded.length}/6`));
    }
  }

  // ٢ — الواجهة لا ترى قيمة مفتاح: حالة الاعتماد في العقد مغلقة ولا حقل قيمة فيها.
  {
    const title = "the renderer contract carries a key's state, source and reference, never its value";
    const text = read(root, "contracts/schemas/desktop-p06-domain.schema.json");
    if (text === null) checks.push(absent("P06-SEC-NO-SECRET-TO-RENDERER", title, "contracts/schemas/desktop-p06-domain.schema.json"));
    else {
      const schema = JSON.parse(text);
      const auth = schema.$defs?.ConnectorAuthStateV1 ?? {};
      const properties = Object.keys(auth.properties ?? {}).sort();
      const allowed = ["configured", "environment_variable", "last_updated", "mode", "reference", "required", "source", "store_available"];
      const extra = properties.filter((name) => !allowed.includes(name));
      const closed = auth.additionalProperties === false;
      const sensitive = schema.$defs?.SensitiveStatusV1 ?? {};
      const sensitiveProps = Object.keys(sensitive.properties ?? {});
      const valueShaped = [...properties, ...sensitiveProps].filter((name) => /value|secret|token|password|key$/i.test(name));
      checks.push(
        judge(
          "P06-SEC-NO-SECRET-TO-RENDERER",
          title,
          closed && extra.length === 0 && valueShaped.length === 0 && sensitive.additionalProperties === false,
          `auth state closed ${closed} with ${properties.join(", ")}; unexpected ${extra.join(", ") || "none"}; value-shaped fields ${valueShaped.join(", ") || "none"}`,
        ),
      );
    }
  }

  // ٣ — لا طريق HTTP إلى خدمة إلا من بوابة الموصلات، والبوابة تُنادى من نقطتين معروفتين.
  {
    const title = "no Phase-06 code reaches a service except through the connector gateway";
    if (p06Files.length === 0) checks.push(absent("P06-SEC-NO-GATEWAY-BYPASS", title, "core/src/p06"));
    else {
      const senders = [];
      const invokers = [];
      for (const file of p06Files) {
        const body = code(withoutTests(readFileSync(file, "utf8")));
        const name = rel(root, file);
        if (/send_once\(|\.send\(\s*endpoint|\.send\(&endpoint|http\.send\(/.test(body) && !name.endsWith("connector/rest.rs") && !name.endsWith("connector/gateway.rs")) senders.push(name);
        if (/gateway\.invoke\(/.test(body)) invokers.push(name);
      }
      const expected = ["desktop/host/core/src/p06/connector/service.rs", "desktop/host/core/src/p06/connector/tool.rs"];
      const unexpected = invokers.filter((name) => !expected.includes(name));
      checks.push(
        judge(
          "P06-SEC-NO-GATEWAY-BYPASS",
          title,
          senders.length === 0 && unexpected.length === 0 && invokers.length === 2,
          `files that send HTTP outside the gateway ${senders.join(", ") || "none"}; gateway callers ${invokers.join(", ")} (expected the tool adapter and the health probe)`,
        ),
      );
    }
  }

  // ٤ — إعادة التوجيه لا تُتّبع: كل 3xx رفض.
  {
    const title = "a redirect is never followed: every 3xx ends the call as refused";
    const source = read(root, "desktop/host/core/src/p06/connector/gateway.rs");
    if (source === null) checks.push(absent("P06-SEC-NO-REDIRECT", title, "p06/connector/gateway.rs"));
    else {
      const body = code(withoutTests(source));
      const refused = /\(300\.\.400\)\.contains\(&status\)\s*\{\s*break Err\(ConnectorFailure::RedirectRefused\)/.test(body);
      const follows = /Location|location/.test(body);
      checks.push(judge("P06-SEC-NO-REDIRECT", title, refused && !follows, `3xx refused: ${refused}; the gateway reads a Location header: ${follows}`));
    }
  }

  // ٥ — لا إعادة لأثر غير محميّ: قابلية الإعادة تُحسب من الفعل ومفتاح التكرار.
  {
    const title = "an unsafe side effect is never retried silently";
    const rest = read(root, "desktop/host/core/src/p06/connector/rest.rs");
    const gateway = read(root, "desktop/host/core/src/p06/connector/gateway.rs");
    if (rest === null || gateway === null) checks.push(absent("P06-SEC-NO-UNSAFE-RETRY", title, "p06/connector"));
    else {
      const r = code(withoutTests(rest));
      const g = code(withoutTests(gateway));
      const rule = /pub fn side_effect_safe\(op: &ConnectorOperation\) -> bool/.test(r);
      const serverErrorOnlyWhenSafe = /matches!\(status, 500 \| 502 \| 503 \| 504\) && side_effect_safe/.test(r);
      const timeoutOnlyWhenSafe = /TimedOutAfterSend => side_effect_safe/.test(r);
      const used = /rest::side_effect_safe\(op\)/.test(g) && /retryable_status\(status, safe\)/.test(g);
      const unknown = /OutcomeUnknown/.test(g);
      checks.push(
        judge(
          "P06-SEC-NO-UNSAFE-RETRY",
          title,
          rule && serverErrorOnlyWhenSafe && timeoutOnlyWhenSafe && used && unknown,
          `rule declared ${rule}; 5xx retried only when safe ${serverErrorOnlyWhenSafe}; a timeout after send retried only when safe ${timeoutOnlyWhenSafe}; the gateway applies it ${used}; an unconfirmed write ends as outcome unknown ${unknown}`,
        ),
      );
    }
  }

  // ٦ — لا سعر مشحون: لا صفّ أسعار يُزرع في الترحيل ولا في الشيفرة، وكتابة السعر واحدة.
  {
    const title = "no price ships with the build: prices exist only when a user enters them";
    const migrations = read(root, "desktop/host/core/src/storage/migrations.rs");
    if (migrations === null || p06Files.length === 0) checks.push(absent("P06-SEC-NO-BUILTIN-PRICE", title, "storage/migrations.rs"));
    else {
      const seeded = /INSERT\s+INTO\s+pricing_entries/i.test(migrations);
      let writers = 0;
      for (const file of p06Files) writers += (code(withoutTests(readFileSync(file, "utf8"))).match(/INSERT (OR REPLACE )?INTO pricing_entries/g) ?? []).length;
      checks.push(judge("P06-SEC-NO-BUILTIN-PRICE", title, !seeded && writers === 1, `the migration seeds prices ${seeded}; statements that write a price ${writers} (expected the one behind pricing.set)`));
    }
  }

  // ٧ — مفتاح البيئة بسابقة ثابتة، وOAuth 2 مرفوض بلا تدفّق رسمي.
  {
    const title = "an environment key must carry the POLARIS_CONNECTOR_ prefix, and OAuth 2 is refused without an official flow";
    const model = read(root, "desktop/host/core/src/p06/connector/model.rs");
    if (model === null) checks.push(absent("P06-SEC-AUTH-BOUNDARIES", title, "p06/connector/model.rs"));
    else {
      const body = code(withoutTests(model));
      const prefix = /strip_prefix\("POLARIS_CONNECTOR_"\)/.test(body);
      const oauth = /AuthMode::Oauth2, _\) => return Err\(ConfigRefusal::at\("OAUTH2_NOT_SUPPORTED"/.test(body);
      checks.push(judge("P06-SEC-AUTH-BOUNDARIES", title, prefix && oauth, `environment prefix enforced ${prefix}; OAuth 2 refused ${oauth}`));
    }
  }

  // ٨ — لا مصدر Phase-06 يشغّل عملية، والنواة تمنع unsafe ولا unsafe في Phase-06.
  {
    const title = "no Phase-06 source spawns a process or uses unsafe code";
    const lib = read(root, "desktop/host/core/src/lib.rs");
    if (lib === null || p06Files.length === 0) checks.push(absent("P06-SEC-NO-SPAWN-NO-UNSAFE", title, "core/src"));
    else {
      const spawn = p06Files.filter((file) => /std::process::Command|Command::new|CreateProcess|ShellExecute/.test(code(withoutTests(readFileSync(file, "utf8"))))).map((file) => rel(root, file));
      const unsafe = p06Files.filter((file) => /\bunsafe\s*\{/.test(code(readFileSync(file, "utf8")))).map((file) => rel(root, file));
      const forbidden = lib.includes("#![forbid(unsafe_code)]");
      checks.push(judge("P06-SEC-NO-SPAWN-NO-UNSAFE", title, spawn.length === 0 && unsafe.length === 0 && forbidden, `${p06Files.length} files; spawning ${spawn.join(", ") || "none"}; unsafe ${unsafe.join(", ") || "none"}; core forbids unsafe ${forbidden}`));
    }
  }

  // ٩ — لا عنوان خارجي مكتوب في شيفرة المنتج: لا قياس عن بُعد ولا مزامنة.
  {
    const title = "no outbound address is written into Phase-06 product code: no telemetry and no sync endpoint";
    if (p06Files.length === 0) checks.push(absent("P06-SEC-NO-TELEMETRY-ENDPOINT", title, "core/src/p06"));
    else {
      const offenders = [];
      for (const file of p06Files) {
        for (const match of code(withoutTests(readFileSync(file, "utf8"))).matchAll(/"(https?:\/\/[^"]+)"/g)) {
          if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(match[1])) offenders.push(`${rel(root, file)}: ${match[1]}`);
        }
      }
      checks.push(judge("P06-SEC-NO-TELEMETRY-ENDPOINT", title, offenders.length === 0, offenders.length === 0 ? `${p06Files.length} files scanned, no outbound address literal` : offenders.join("; ")));
    }
  }

  // ١٠ — كل رمز خطأ يعبر الحدّ من المفردات المغلقة.
  {
    const title = "every Phase-06 boundary error code is one the contract declares";
    const canonical = ["VALIDATION_ERROR", "UNSUPPORTED_VERSION", "POLICY_DENIED", "MALFORMED_MESSAGE", "CONTRACT_VIOLATION", "DEPENDENCY_UNAVAILABLE", "TIMEOUT", "CONFLICT", "INTERNAL_ERROR", "NOT_FOUND", "CANCELLED"];
    if (p06Files.length === 0) checks.push(absent("P06-SEC-CANONICAL-ERROR-CODES", title, "core/src/p06"));
    else {
      const offenders = [];
      let constructed = 0;
      for (const file of p06Files) {
        for (const match of readFileSync(file, "utf8").matchAll(/HostError::new\(\s*[^,]+,\s*"([A-Z_]+)"/g)) {
          constructed += 1;
          if (!canonical.includes(match[1])) offenders.push(`${rel(root, file)}: ${match[1]}`);
        }
      }
      checks.push(judge("P06-SEC-CANONICAL-ERROR-CODES", title, offenders.length === 0, offenders.length === 0 ? `${p06Files.length} files, ${constructed} constructed codes, all in the closed vocabulary` : offenders.join("; ")));
    }
  }

  // ١١ — العارض لا يملك حقل مفتاح ولا دالّة تنفيذ.
  {
    const title = "the renderer has no key field and no method that runs a connector operation";
    const client = read(root, "desktop/renderer/src/ipc/p06-client.ts");
    const screens = walk(join(root, "desktop/renderer/src/screens/p06"), [".tsx", ".ts"]);
    if (client === null || screens.length === 0) checks.push(absent("P06-SEC-RENDERER-NO-KEY-PATH", title, "desktop/renderer/src/ipc/p06-client.ts"));
    else {
      const methods = [...code(client).matchAll(/^\s{2}([a-zA-Z]+)\(/gm)].map((m) => m[1]).filter((name) => name !== "constructor" && name !== "call");
      const actors = methods.filter((name) => /invoke|execute|reveal|secret|password/i.test(name));
      const fields = screens.filter((file) => /type="password"|autoComplete="current-password"/.test(readFileSync(file, "utf8"))).map((file) => rel(root, file));
      checks.push(judge("P06-SEC-RENDERER-NO-KEY-PATH", title, methods.length === 28 && actors.length === 0 && fields.length === 0, `client methods ${methods.length}; action- or secret-shaped ${actors.join(", ") || "none"}; key input fields ${fields.join(", ") || "none"}`));
    }
  }

  // ١٢ — لا سرّ مكتوب في مصدر Phase-06 أو أداة مطابقته.
  {
    const files = [
      ...p06Files,
      join(root, "desktop/host/app/src/p06_native.rs"),
      join(root, "desktop/host/app/src/e2e_config.rs"),
      ...walk(join(root, "desktop/renderer/src/screens/p06"), [".tsx", ".ts"]),
      join(root, "desktop/renderer/src/e2e/p06-suite.ts"),
      ...walk(join(root, "tools/p06-conformance"), [".mjs", ".ps1", ".json"]),
    ].filter((file) => existsSync(file));
    const offenders = [];
    for (const file of files) {
      const hits = findSecretLeaks(readFileSync(file, "utf8"));
      if (hits.length > 0 && !file.endsWith("p06-security.mjs")) offenders.push(`${rel(root, file)}: ${hits.join(",")}`);
    }
    checks.push(judge("P06-SEC-NO-SECRET-IN-SOURCE", "no Phase-06 source or instrument carries a key-shaped value", offenders.length === 0, offenders.length === 0 ? `${files.length} files scanned, none carries a key shape` : offenders.join("; ")));
  }

  // ١٣ — الإعدادان الأمنيان الثابتان مقفلان في هذا البناء.
  {
    const title = "the fixed security settings are locked: external effects need approval, the browser's private network stays refused";
    const registry = read(root, "desktop/host/core/src/p06/config/registry.rs");
    if (registry === null) checks.push(absent("P06-SEC-LOCKED-SETTINGS", title, "p06/config/registry.rs"));
    else {
      const body = code(withoutTests(registry));
      const lockedApproval = /locked\(def\(\s*"security\.external_effects_require_approval"/.test(body);
      const lockedPrivate = /locked\(def\(\s*"browser\.private_network_allowed"/.test(body);
      checks.push(judge("P06-SEC-LOCKED-SETTINGS", title, lockedApproval && lockedPrivate, `approval locked ${lockedApproval}; private network locked ${lockedPrivate}`));
    }
  }

  return checks;
}

/** نصّ الوثيقة وما يُفحص فيه: السرّ، والكناري، وحقل التفكير، ونصّ الخدمة غير الموثوق. */
export function scanText(text, canary) {
  return {
    secrets: findSecretLeaks(text),
    canary: canary !== "" && text.includes(canary),
    reasoning: /"(reasoning|chain_of_thought|thoughts|scratchpad)"\s*:/i.test(text),
    content: FIXTURE_CONTENT.filter((needle) => text.includes(needle)),
  };
}

/** يفحص الوثائق القانونية المكتوبة فعلًا، والسجلّات الخام. وثيقة غائبة NOT_TESTED لا PASS. */
export function evidenceChecks(root, canary = process.env.P06_CANARY ?? "") {
  const suffix = evidenceSuffix();
  const present = [];
  const leaks = [];
  const reasoning = [];
  const content = [];
  const canaryHits = [];
  for (const base of [...P06_EVIDENCE, P06_FINAL_GATE]) {
    const path = join(root, "evidence", `${base}${suffix}.json`);
    if (!existsSync(path)) continue;
    present.push(base);
    const found = scanText(readFileSync(path, "utf8"), canary);
    if (found.secrets.length > 0) leaks.push(`${base}: ${found.secrets.join(",")}`);
    if (found.reasoning) reasoning.push(base);
    if (found.content.length > 0) content.push(`${base}: ${found.content.length} fixture string(s)`);
    if (found.canary) canaryHits.push(base);
  }
  // السجلّات الخام ليست قانونية، لكنها على القرص: الكناري لا يجوز أن يظهر فيها أيضًا.
  const raw = walk(join(root, RAW_DIRECTORY), [".json"]);
  const rawHits = canary === "" ? [] : raw.filter((file) => readFileSync(file, "utf8").includes(canary)).map((file) => rel(root, file));
  const noDocs = present.length === 0;
  const checks = [];
  if (noDocs) {
    checks.push(absent("P06-EVIDENCE-NO-SECRET", "no canonical Phase-06 document carries a key-shaped value", "evidence/phase-06-*.json"));
    checks.push(absent("P06-EVIDENCE-NO-REASONING-FIELD", "no canonical Phase-06 document carries a reasoning trace field", "evidence/phase-06-*.json"));
    checks.push(absent("P06-EVIDENCE-NO-UNTRUSTED-CONTENT", "no canonical Phase-06 document carries connector response text", "evidence/phase-06-*.json"));
  } else {
    checks.push(judge("P06-EVIDENCE-NO-SECRET", "no canonical Phase-06 document carries a key-shaped value", leaks.length === 0, leaks.length === 0 ? `${present.length} document(s) scanned, none carries a key shape` : leaks.join("; ")));
    checks.push(judge("P06-EVIDENCE-NO-REASONING-FIELD", "no canonical Phase-06 document carries a reasoning trace field", reasoning.length === 0, reasoning.length === 0 ? `${present.length} document(s) scanned` : reasoning.join(", ")));
    checks.push(judge("P06-EVIDENCE-NO-UNTRUSTED-CONTENT", "no canonical Phase-06 document carries connector response text", content.length === 0, content.length === 0 ? `${present.length} document(s) scanned, none carries fixture service text` : content.join("; ")));
  }
  if (canary === "") {
    checks.push({ check_id: "P06-EVIDENCE-NO-CANARY", title: "the per-run credential canary appears in no evidence document and no raw record", verdict: "NOT_TESTED", detail: "no canary was supplied: only the canonical runner knows it" });
  } else {
    checks.push(
      judge(
        "P06-EVIDENCE-NO-CANARY",
        "the per-run credential canary appears in no evidence document and no raw record",
        !noDocs && canaryHits.length === 0 && rawHits.length === 0,
        `${present.length} canonical document(s) and ${raw.length} raw record(s) scanned; with the canary: ${[...canaryHits, ...rawHits].join(", ") || "none"}`,
      ),
    );
  }
  return checks;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const scanEvidence = process.argv.includes("--scan-evidence");
  const checks = scanEvidence ? evidenceChecks(root) : staticChecks(root);
  const name = scanEvidence ? "security-evidence.local.json" : "security-static.local.json";
  writeEvidence(join(root, RAW_DIRECTORY, name), { ...header(P06_TOOLS.security, root), scope: scanEvidence ? "EVIDENCE" : "STATIC", checks });
  for (const check of checks) console.log(`${check.verdict.padEnd(11)} ${check.check_id}  ${check.detail.slice(0, 220)}`);
  process.exitCode = checks.every((check) => check.verdict === "PASS") ? 0 : 1;
}
