// الفحص الساكن لأمن Phase-04، وفحص الأدلة المكتوبة بحثًا عن سرّ.
//
// كل فحص هنا يقرأ مصدرًا حقيقيًّا في هذا المستودع ويحكم على ما وجده. لا فحص
// يعيد PASS من غياب: غياب الملف الذي يُفترض فحصه هو NOT_TESTED، لا نجاح.
//
// وما تفحصه هذه الملفّة هي الخصائص التي لا يكفي اختبار وحدة لإثباتها، لأنها
// خصائص عن غياب شيء: لا مسار تنفيذ عامّ، ولا قدرة لتشغيل عملية أو قراءة سرّ،
// ولا مرجع خارجي في مخطط غير موثوق، ولا نقطة نهاية خارج الحلقة المحلية.
//
// الاستعمال:
//   node p04-security.mjs --root D:\POLARIS
//   node p04-security.mjs --root D:\POLARIS --scan-evidence

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, header, P04_EVIDENCE, P04_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p04-common.mjs";

/** أشكال المفاتيح المعروفة. القيمة الحقيقية لا تُكتب هنا، الشكل وحده. */
const SECRET_SHAPES = Object.freeze([
  { id: "openai", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: "anthropic", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: "google", pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  { id: "openrouter", pattern: /\bsk-or-[A-Za-z0-9-]{20,}\b/ },
  { id: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  { id: "authorization-header", pattern: /"authorization"\s*:\s*"[^"]{12,}"/i },
]);

/** قدرات التشغيل المعزول المعلنة (ADR-028). القائمة مغلقة: إضافة اسم تعني قرارًا مسمّى. */
export const DECLARED_SANDBOXED_CAPABILITIES = Object.freeze(["polaris.capability.tool.sandboxed_process"]);

/** يعيد أسماء الأشكال الموجودة في نصّ. لا يعيد القيمة نفسها أبدًا. */
export function findSecretLeaks(text) {
  return SECRET_SHAPES.filter((shape) => shape.pattern.test(text)).map((shape) => shape.id);
}

function read(root, relative) {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** يزيل تعليقات Rust السطرية: الشرح يذكر ما لا يفعله الكود. */
function code(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("//") && !trimmed.startsWith("///") && !trimmed.startsWith("//!");
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
      if (["node_modules", "target", "target-e2e", "dist", "build-tests", "_to_delete", "_transfer"].includes(entry.name)) continue;
      walk(full, extensions, found);
    } else if (extensions.includes(extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

function absent(id, title, path) {
  return { check_id: id, title, verdict: "NOT_TESTED", detail: `${path} is absent, so nothing was measured` };
}

function judge(id, title, satisfied, detail) {
  return { check_id: id, title, verdict: satisfied ? "PASS" : "FAIL", detail };
}

/** الملفّات التي يمرّ فيها كل أثر أداة. */
const GATEWAY_PATH = [
  "desktop/host/core/src/p04/gateway.rs",
  "desktop/host/core/src/p04/tool.rs",
  "desktop/host/core/src/p04/skill.rs",
  "desktop/host/core/src/p04/approval.rs",
  "desktop/host/core/src/p04/budget.rs",
  "desktop/host/core/src/p04/effect.rs",
];

export function staticChecks(root) {
  const checks = [];

  // ١ — لا عملية IPC تنفّذ أداة أو تنادي خادمًا نداءً حرًّا.
  {
    const source = read(root, "desktop/host/core/src/p04/ipc.rs");
    if (source === null) checks.push(absent("P04-SEC-NO-EXECUTION-OPERATION", "no Phase-04 IPC operation executes a tool", "p04/ipc.rs"));
    else {
      const operations = /OPERATIONS: \[&str; \d+\] = \[(.*?)\];/s.exec(source)?.[1] ?? "";
      const names = [...operations.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const executors = names.filter((name) => /execute|invoke|run|call|dispatch|command/i.test(name));
      const takesVerb = /payload\.get\("(action|command|method|verb|operation|tool_name)"\)/.test(source);
      checks.push(
        judge(
          "P04-SEC-NO-EXECUTION-OPERATION",
          "no Phase-04 IPC operation executes a tool",
          names.length > 0 && executors.length === 0 && !takesVerb,
          `operations ${names.length}: ${names.join(", ")}; execution-shaped names ${executors.length}; a payload field names a verb: ${takesVerb}`,
        ),
      );
    }
  }

  // ٢ — القدرتان الخطرتان غير ممنوحتين في هذا البناء، لا مرفوضتين بسياسة.
  {
    const source = read(root, "desktop/host/core/src/p04/effect.rs");
    if (source === null) checks.push(absent("P04-SEC-NO-PROCESS-OR-SECRET-CAPABILITY", "this build holds no capability for process execution or secret access", "p04/effect.rs"));
    else {
      const grant = /RUNTIME_CAPABILITY_GRANT: &\[&str\] = &\[(.*?)\];/s.exec(source)?.[1] ?? "";
      const granted = [...grant.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      // Phase-08 (ADR-028): التشغيل داخل صندوق AppContainer وكائن مهمّة قدرةٌ مسمّاة واحدة معلنة؛ قدرة
      // العملية غير المعزولة (`tool.process`) وقدرة السرّ تبقيان غير ممنوحتين، وأي اسم آخر بشكلهما يُرفض.
      const forbidden = granted.filter((capability) => /process|secret|shell|exec/i.test(capability) && !DECLARED_SANDBOXED_CAPABILITIES.includes(capability));
      checks.push(
        judge(
          "P04-SEC-NO-PROCESS-OR-SECRET-CAPABILITY",
          "this build holds no capability for unconfined process execution or secret access (sandboxed execution only as declared by ADR-028)",
          granted.length > 0 && forbidden.length === 0,
          granted.length === 0
            ? "the runtime grant could not be read"
            : `${granted.length} capabilities granted: ${granted.join(", ")}; process or secret shaped ${forbidden.length}`,
        ),
      );
    }
  }

  // ٣ — لا ممرّ عامّ إلى صدفة ولا إلى نظام الملفّات: لا أداة مدمجة تشغّل عملية.
  {
    const files = walk(join(root, "desktop/host/core/src/p04"), [".rs"]);
    if (files.length === 0) checks.push(absent("P04-SEC-NO-PROCESS-SPAWN", "no Phase-04 source can spawn a process", "core/src/p04"));
    else {
      const offenders = [];
      for (const file of files) {
        const source = code(withoutTests(readFileSync(file, "utf8")));
        if (/std::process::Command|tokio::process|Command::new|CreateProcess/.test(source)) {
          offenders.push(file.replace(root, "").replace(/\\/g, "/"));
        }
      }
      checks.push(
        judge(
          "P04-SEC-NO-PROCESS-SPAWN",
          "no Phase-04 source can spawn a process",
          offenders.length === 0,
          offenders.length === 0 ? `${files.length} files scanned, none constructs a process` : offenders.join("; "),
        ),
      );
    }
  }

  // ٤ — النقل إلى خادم أدوات يمرّ بعميل HTTP المشترك وحده، على الحلقة المحلية.
  {
    const client = read(root, "desktop/host/core/src/p04/mcp/client.rs");
    if (client === null) checks.push(absent("P04-SEC-MCP-LOOPBACK-ONLY", "the tool-server transport is loopback HTTP through the shared client", "p04/mcp/client.rs"));
    else {
      const usesPort = /HttpClient/.test(client) && /polaris_host_providers::net/.test(client);
      const raw = /reqwest|TcpStream|std::net::TcpStream|hyper::/.test(code(withoutTests(client)));
      const resolves = /pub fn resolve\(/.test(client);
      const loopbackGuard = /is_loopback|loopback/i.test(client);
      checks.push(
        judge(
          "P04-SEC-MCP-LOOPBACK-ONLY",
          "the tool-server transport is loopback HTTP through the shared client",
          usesPort && !raw && resolves && loopbackGuard,
          `shared client used: ${usesPort}; raw transport in the adapter: ${raw}; destination resolved here: ${resolves}; loopback refusal present: ${loopbackGuard}`,
        ),
      );
    }
  }

  // ٥ — لا نقل يشغّل عملية: مفردة النقل واحدة ولا تحوي stdio.
  {
    const registry = read(root, "contracts/schemas/desktop-p04-domain.schema.json");
    if (registry === null) checks.push(absent("P04-SEC-NO-STDIO-TRANSPORT", "no declared MCP transport starts a process", "desktop-p04-domain.schema.json"));
    else {
      const transports = /"McpTransport"\s*:\s*\{[^}]*"enum"\s*:\s*\[([^\]]*)\]/s.exec(registry)?.[1] ?? "";
      const names = [...transports.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const spawning = names.filter((name) => /STDIO|PROCESS|SUBPROCESS|EXEC/i.test(name));
      checks.push(
        judge(
          "P04-SEC-NO-STDIO-TRANSPORT",
          "no declared MCP transport starts a process",
          names.length > 0 && spawning.length === 0,
          `transports ${names.join(", ") || "unreadable"}; process-spawning ${spawning.length}`,
        ),
      );
    }
  }

  // ٦ — مخطط غير موثوق لا يُجلب منه شيء: المرجع الخارجي يُرفض قبل أي ترجمة.
  {
    const sanitize = read(root, "desktop/host/core/src/p04/mcp/sanitize.rs");
    const adapter = read(root, "desktop/host/core/src/p04/mcp/adapter.rs");
    if (sanitize === null || adapter === null) {
      checks.push(absent("P04-SEC-NO-EXTERNAL-SCHEMA-REFERENCE", "an untrusted schema carrying an external reference is refused before compilation", "p04/mcp"));
    } else {
      const detects = /pub fn external_reference\(/.test(sanitize);
      const keywords = ["$ref", "$id", "$schema", "$dynamicRef", "$anchor"].filter((key) => sanitize.includes(key));
      const guardedAtDiscovery = /external_reference/.test(sanitize) && /schema_is_admissible/.test(sanitize);
      const guardedAtCall = /external_reference/.test(adapter);
      checks.push(
        judge(
          "P04-SEC-NO-EXTERNAL-SCHEMA-REFERENCE",
          "an untrusted schema carrying an external reference is refused before compilation",
          detects && keywords.length === 5 && guardedAtDiscovery && guardedAtCall,
          `detector present: ${detects}; reference keywords covered ${keywords.length}/5; refused at discovery: ${guardedAtDiscovery}; re-checked at call time: ${guardedAtCall}`,
        ),
      );
    }
  }

  // ٧ — الواصف مُحكَم: الخطر والموافقة وسياسة الشبكة تُشتقّ من الأثر لا تُعلَن.
  {
    const source = read(root, "desktop/host/core/src/p04/tool.rs");
    if (source === null) checks.push(absent("P04-SEC-DESCRIPTOR-IS-SEALED", "risk, approval and network policy are derived from the effects, never declared freely", "p04/tool.rs"));
    else {
      const seals = /pub fn sealed\(mut self\) -> Self/.test(source);
      // الموافقة تُرفع من الأثر نفسه: `always_requires_approval` تُسأل داخل
      // `sealed`، فلا يستطيع واصف أن يُعلن كتابةً ثم يقول إنه لا يحتاج قرارًا.
      const forcesApproval = /always_requires_approval\(\)\)\s*\{\s*self\.requires_approval = true/s.test(source);
      const forcesNetwork = /NetworkPolicy::LoopbackOnly/.test(source);
      const registerRefuses = /RegistrationRefusal/.test(source);
      checks.push(
        judge(
          "P04-SEC-DESCRIPTOR-IS-SEALED",
          "risk, approval and network policy are derived from the effects, never declared freely",
          seals && forcesApproval && forcesNetwork && registerRefuses,
          `sealed constructor: ${seals}; approval forced from effects: ${forcesApproval}; network policy forced: ${forcesNetwork}; registration can refuse: ${registerRefuses}`,
        ),
      );
    }
  }

  // ٨ — الميزانية تُحجز قبل الأثر، والموافقة تُستهلك قبل التنفيذ.
  {
    const source = read(root, "desktop/host/core/src/p04/gateway.rs");
    if (source === null) checks.push(absent("P04-SEC-BUDGET-BEFORE-EFFECT", "the budget is reserved and the approval consumed before the adapter runs", "p04/gateway.rs"));
    else {
      const body = code(withoutTests(source));
      const reserveAt = body.indexOf(".reserve(");
      const approvalAt = body.search(/consume\(|ApprovalBinding::new\(/);
      const executeAt = body.indexOf("adapter.execute(");
      const ordered = reserveAt >= 0 && approvalAt >= 0 && executeAt >= 0 && reserveAt < executeAt && approvalAt < executeAt;
      checks.push(
        judge(
          "P04-SEC-BUDGET-BEFORE-EFFECT",
          "the budget is reserved and the approval consumed before the adapter runs",
          ordered,
          `budget reserved at ${reserveAt}, approval evaluated at ${approvalAt}, adapter invoked at ${executeAt}`,
        ),
      );
    }
  }

  // ٩ — أداة MCP تدخل السجل غير موثوقة، ولا خادم يمنح نفسه أثرًا.
  {
    const source = read(root, "desktop/host/core/src/p04/mcp/discovery.rs");
    if (source === null) checks.push(absent("P04-SEC-MCP-TOOLS-ARE-UNTRUSTED", "every MCP tool enters the registry untrusted and inside the user grant", "p04/mcp/discovery.rs"));
    else {
      const untrusted = /trust_class: ToolTrustClass::McpUntrusted/.test(source);
      const narrows = /granted/.test(source) && /EffectNotPermitted|EFFECT_NOT_PERMITTED/.test(source);
      const refusesSecret = /SecretRequested|SECRET_REQUESTED/.test(source);
      const defaultsNarrow = /LocalCompute/.test(source);
      checks.push(
        judge(
          "P04-SEC-MCP-TOOLS-ARE-UNTRUSTED",
          "every MCP tool enters the registry untrusted and inside the user grant",
          untrusted && narrows && refusesSecret && defaultsNarrow,
          `marked untrusted: ${untrusted}; narrowed to the user grant: ${narrows}; a secret request is refused: ${refusesSecret}; an undeclared effect defaults narrow: ${defaultsNarrow}`,
        ),
      );
    }
  }

  // ١٠ — الموافقة مربوطة بكل ما يجعلها غير قابلة لإعادة الاستعمال.
  {
    const source = read(root, "desktop/host/core/src/p04/approval.rs");
    if (source === null) checks.push(absent("P04-SEC-APPROVAL-IS-BOUND", "an approval binds mission, task, tool, arguments and effects, and expires", "p04/approval.rs"));
    else {
      const digest = /fn digest\(&self\)/.test(source);
      const parts = ["mission_id", "task_id", "tool_id", "arguments_digest", "effects"].filter((field) =>
        new RegExp(`self\\.${field}`).test(source),
      );
      const expires = /expires_at|Expired/.test(source);
      const singleUse = /AlreadyUsed|Consumed/.test(source);
      checks.push(
        judge(
          "P04-SEC-APPROVAL-IS-BOUND",
          "an approval binds mission, task, tool, arguments and effects, and expires",
          digest && parts.length === 5 && expires && singleUse,
          `binding digest: ${digest}; bound parts ${parts.length}/5 (${parts.join(", ")}); expiry: ${expires}; single use: ${singleUse}`,
        ),
      );
    }
  }

  // ١١ — ناتج أداة دليل من نوعه، ولا يصير تعليمة ولا يغيّر سياسة.
  {
    const evidence = read(root, "desktop/host/core/src/p04/evidence.rs");
    const gateway = read(root, "desktop/host/core/src/p04/gateway.rs");
    if (evidence === null || gateway === null) {
      checks.push(absent("P04-SEC-TOOL-OUTPUT-IS-NOT-AN-INSTRUCTION", "a tool result becomes typed evidence and never an instruction or a policy change", "p04 sources"));
    } else {
      const typed = /EvidenceType::ToolResult/.test(evidence);
      const digestOnly = /result_digest/.test(gateway);
      // لا مسار يقرأ نصّ الناتج ليغيّر به قرارًا: لا إسناد إلى سياسة ولا إلى منحة.
      const body = code(withoutTests(gateway));
      const mutatesPolicy = /(policy|grant|capabilit\w*)\s*=\s*[^=]*produced|produced[\w.]*\s*=>\s*(policy|grant)/i.test(body);
      checks.push(
        judge(
          "P04-SEC-TOOL-OUTPUT-IS-NOT-AN-INSTRUCTION",
          "a tool result becomes typed evidence and never an instruction or a policy change",
          typed && digestOnly && !mutatesPolicy,
          `evidence is typed TOOL_RESULT: ${typed}; the result is digested: ${digestOnly}; a result assigns to policy or a grant: ${mutatesPolicy}`,
        ),
      );
    }
  }

  // ١٢ — العارض لا يملك مسار تنفيذ ولا نداءً حرًّا.
  {
    const client = read(root, "desktop/renderer/src/ipc/p04-client.ts");
    if (client === null) checks.push(absent("P04-SEC-RENDERER-CANNOT-EXECUTE", "the renderer client has no method that executes a tool", "src/ipc/p04-client.ts"));
    else {
      const methods = [...client.matchAll(/^\s{2}(?:async\s+)?([A-Za-z][A-Za-z0-9]*)\s*\(/gm)].map((match) => match[1]);
      const executors = methods.filter((name) => /^(execute|invoke|run|call)/.test(name) && name !== "call");
      const forbidden = ["executeTool", "callTool", "callMcp", "runTool", "invokeTool"].filter((name) => client.includes(`${name}(`));
      checks.push(
        judge(
          "P04-SEC-RENDERER-CANNOT-EXECUTE",
          "the renderer client has no method that executes a tool",
          executors.length === 0 && forbidden.length === 0,
          `methods ${methods.length}; execution-shaped ${executors.length}${executors.length === 0 ? "" : `: ${executors.join(", ")}`}; forbidden names present ${forbidden.length}`,
        ),
      );
    }
  }

  // ١٣ — لا نقطة نهاية ولا سرّ في مسار البوابة.
  {
    const missing = GATEWAY_PATH.filter((relative) => read(root, relative) === null);
    if (missing.length > 0) {
      checks.push(absent("P04-SEC-NO-ENDPOINT-IN-GATEWAY-PATH", "no gateway-path file names an endpoint", missing.join(", ")));
      checks.push(absent("P04-SEC-NO-SECRET-IN-GATEWAY-PATH", "no gateway-path file reads or carries a credential", missing.join(", ")));
    } else {
      const endpointHits = [];
      const secretHits = [];
      for (const relative of GATEWAY_PATH) {
        const source = code(withoutTests(read(root, relative) ?? ""));
        if (/https?:\/\/[a-z0-9]/i.test(source)) endpointHits.push(relative);
        if (/api_key|apikey|credential_value|authorization|bearer/i.test(source)) secretHits.push(relative);
      }
      checks.push(
        judge(
          "P04-SEC-NO-ENDPOINT-IN-GATEWAY-PATH",
          "no gateway-path file names an endpoint",
          endpointHits.length === 0,
          endpointHits.length === 0 ? `${GATEWAY_PATH.length} files carry no endpoint literal` : endpointHits.join(", "),
        ),
      );
      checks.push(
        judge(
          "P04-SEC-NO-SECRET-IN-GATEWAY-PATH",
          "no gateway-path file reads or carries a credential",
          secretHits.length === 0,
          secretHits.length === 0 ? `${GATEWAY_PATH.length} files carry no credential reference` : secretHits.join(", "),
        ),
      );
    }
  }

  // ١٤ — أمر القياس الأصلي لـPhase-04 غير موجود في ثنائي المنتج.
  {
    const source = read(root, "desktop/host/app/src/lib.rs");
    if (source === null) checks.push(absent("P04-SEC-MEASUREMENT-COMMAND-IS-FEATURE-GATED", "the Phase-04 measurement command is not compiled into the product binary", "app/src/lib.rs"));
    else {
      const commandGated = /#\[cfg\(feature = "e2e"\)\]\s*#\[tauri::command\]\s*fn polaris_e2e_p04/s.test(source);
      const moduleGated = /#\[cfg\(feature = "e2e"\)\]\s*mod p04_native;/s.test(source);
      const productHandler = /#\[cfg\(not\(feature = "e2e"\)\)\]\s*let builder = builder\.invoke_handler\(tauri::generate_handler!\[polaris_ipc\]\);/s.test(source);
      checks.push(
        judge(
          "P04-SEC-MEASUREMENT-COMMAND-IS-FEATURE-GATED",
          "the Phase-04 measurement command is not compiled into the product binary",
          commandGated && moduleGated && productHandler,
          `command gated: ${commandGated}; module gated: ${moduleGated}; product handler registers polaris_ipc alone: ${productHandler}`,
        ),
      );
    }
  }

  // ١٥ — أوامر القياس قراءة فقط: لا فعل يكتب أو ينفّذ.
  {
    const source = read(root, "desktop/host/app/src/p04_native.rs");
    if (source === null) checks.push(absent("P04-SEC-MEASUREMENT-IS-READ-ONLY", "every Phase-04 measurement action is read-only", "app/src/p04_native.rs"));
    else {
      // كتلة الاختبارات تذكر الأسماء الممنوعة لتتأكّد من غيابها، فقراءتها هنا
      // تجعل الفحص يُبلغ عن العيب الذي يحرسه الاختبار نفسه.
      const actions = [...withoutTests(source).matchAll(/"(p04\.[a-z.]+)"/g)].map((match) => match[1]);
      // المطابقة على مقاطع الاسم لا على النصّ كلّه: «runtime» تحوي «run» وليست فعلًا.
      const verbs = ["execute", "invoke", "run", "call", "submit", "grant", "write", "register", "approve", "delete", "set"];
      const writers = actions.filter((name) => name.split(".").some((segment) => verbs.includes(segment)));
      checks.push(
        judge(
          "P04-SEC-MEASUREMENT-IS-READ-ONLY",
          "every Phase-04 measurement action is read-only",
          actions.length > 0 && writers.length === 0,
          `actions ${actions.length}: ${[...new Set(actions)].join(", ")}; mutating-shaped ${writers.length}`,
        ),
      );
    }
  }

  // ١٦ — كل رمز خطأ يعبر الحدّ من المفردات المغلقة التسع.
  {
    const canonical = [
      "VALIDATION_ERROR",
      "UNSUPPORTED_VERSION",
      "POLICY_DENIED",
      "MALFORMED_MESSAGE",
      "CONTRACT_VIOLATION",
      "DEPENDENCY_UNAVAILABLE",
      "TIMEOUT",
      "CONFLICT",
      "INTERNAL_ERROR",
    ];
    const files = walk(join(root, "desktop/host/core/src/p04"), [".rs"]);
    if (files.length === 0) {
      checks.push(absent("P04-SEC-CANONICAL-ERROR-CODES", "every Phase-04 boundary error code is one the contract declares", "core/src/p04"));
    } else {
      const offenders = [];
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(/HostError::new\(\s*[^,]+,\s*"([A-Z_]+)"/g)) {
          if (!canonical.includes(match[1])) offenders.push(`${file.replace(root, "").replace(/\\/g, "/")}: ${match[1]}`);
        }
      }
      checks.push(
        judge(
          "P04-SEC-CANONICAL-ERROR-CODES",
          "every Phase-04 boundary error code is one the contract declares",
          offenders.length === 0,
          offenders.length === 0
            ? `${files.length} files scanned; every constructed error code is in the closed vocabulary of ${canonical.length}`
            : offenders.join("; "),
        ),
      );
    }
  }

  // ١٧ — لا سرّ مكتوب في أي مصدر Phase-04 أو أداة مطابقة.
  {
    const files = [...walk(join(root, "desktop/host/core/src/p04"), [".rs"]), ...walk(join(root, "tools/p04-conformance"), [".mjs", ".ps1"])];
    const offenders = [];
    for (const file of files) {
      const hits = findSecretLeaks(readFileSync(file, "utf8"));
      // ملف الفحص نفسه يحمل الأشكال تعريفًا لا قيمة.
      if (hits.length > 0 && !file.endsWith("p04-security.mjs")) offenders.push(`${file.replace(root, "").replace(/\\/g, "/")}: ${hits.join(",")}`);
    }
    checks.push(
      judge(
        "P04-SEC-NO-SECRET-IN-SOURCE",
        "no Phase-04 source or instrument carries a key-shaped value",
        offenders.length === 0,
        offenders.length === 0 ? `${files.length} files scanned, none carries a key shape` : offenders.join("; "),
      ),
    );
  }

  return checks;
}

/** يفحص الوثائق القانونية المكتوبة فعلًا. وثيقة غائبة NOT_TESTED لا PASS. */
export function evidenceChecks(root) {
  const suffix = evidenceSuffix();
  const present = [];
  const leaks = [];
  const reasoning = [];
  const rawArguments = [];
  for (const base of P04_EVIDENCE) {
    const path = join(root, "evidence", `${base}${suffix}.json`);
    if (!existsSync(path)) continue;
    present.push(base);
    const text = readFileSync(path, "utf8");
    const hits = findSecretLeaks(text);
    if (hits.length > 0) leaks.push(`${base}: ${hits.join(",")}`);
    if (/"(reasoning|chain_of_thought|thoughts|scratchpad)"\s*:/i.test(text)) reasoning.push(base);
    // حجج الأداة تُنقل ببصمتها. حقل `arguments` كامل في وثيقة قانونية يعني أن
    // محتوى غير موثوق صار نصًّا مخزَّنًا، وهو ما تمنعه المرحلة.
    if (/"arguments"\s*:\s*[{"[]/.test(text)) rawArguments.push(base);
  }
  if (present.length === 0) {
    return [
      absent("P04-EVIDENCE-NO-SECRET", "no canonical Phase-04 document carries a key-shaped value", "evidence/phase-04-*.json"),
      absent("P04-EVIDENCE-NO-REASONING-FIELD", "no canonical Phase-04 document carries a reasoning trace field", "evidence/phase-04-*.json"),
      absent("P04-EVIDENCE-NO-RAW-ARGUMENTS", "no canonical Phase-04 document carries raw tool arguments", "evidence/phase-04-*.json"),
    ];
  }
  return [
    judge(
      "P04-EVIDENCE-NO-SECRET",
      "no canonical Phase-04 document carries a key-shaped value",
      leaks.length === 0,
      leaks.length === 0 ? `${present.length} document(s) scanned, none carries a key shape` : leaks.join("; "),
    ),
    judge(
      "P04-EVIDENCE-NO-REASONING-FIELD",
      "no canonical Phase-04 document carries a reasoning trace field",
      reasoning.length === 0,
      reasoning.length === 0 ? `${present.length} document(s) scanned, none carries a reasoning field` : reasoning.join(", "),
    ),
    judge(
      "P04-EVIDENCE-NO-RAW-ARGUMENTS",
      "no canonical Phase-04 document carries raw tool arguments",
      rawArguments.length === 0,
      rawArguments.length === 0 ? `${present.length} document(s) scanned, each carries argument digests only` : rawArguments.join(", "),
    ),
  ];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const scanEvidence = process.argv.includes("--scan-evidence");
  const checks = scanEvidence ? evidenceChecks(root) : staticChecks(root);
  const name = scanEvidence ? "security-evidence.local.json" : "security-static.local.json";
  writeEvidence(join(root, RAW_DIRECTORY, name), { ...header(P04_TOOLS.security, root), scope: scanEvidence ? "EVIDENCE" : "STATIC", checks });
  for (const check of checks) console.log(`${check.verdict.padEnd(11)} ${check.check_id}  ${check.detail.slice(0, 160)}`);
  process.exitCode = checks.every((check) => check.verdict === "PASS") ? 0 : 1;
}
