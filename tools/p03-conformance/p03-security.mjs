// الفحص الساكن لأمن Phase-03، وفحص الأدلة المكتوبة بحثًا عن سرّ.
//
// كل فحص هنا يقرأ مصدرًا حقيقيًّا في هذا المستودع ويحكم على ما وجده. لا فحص
// يعيد PASS من غياب: غياب الملف الذي يُفترض فحصه هو NOT_TESTED، لا نجاح.
//
// الاستعمال:
//   node p03-security.mjs --root D:\POLARIS
//   node p03-security.mjs --root D:\POLARIS --scan-evidence

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, header, P03_EVIDENCE, P03_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p03-common.mjs";

/** أشكال المفاتيح المعروفة. القيمة الحقيقية لا تُكتب هنا، الشكل وحده. */
const SECRET_SHAPES = Object.freeze([
  { id: "openai", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: "anthropic", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: "google", pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  { id: "openrouter", pattern: /\bsk-or-[A-Za-z0-9-]{20,}\b/ },
  { id: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  { id: "authorization-header", pattern: /"authorization"\s*:\s*"[^"]{12,}"/i },
]);

/** يعيد أسماء الأشكال الموجودة في نصّ. لا يعيد القيمة نفسها أبدًا. */
export function findSecretLeaks(text) {
  return SECRET_SHAPES.filter((shape) => shape.pattern.test(text)).map((shape) => shape.id);
}

function read(root, relative) {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
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

const AGENT_PATH = [
  "desktop/host/core/src/p03/model_adapter.rs",
  "desktop/host/core/src/p03/runtime.rs",
  "desktop/host/core/src/p03/service.rs",
  "desktop/host/core/src/p03/prompt.rs",
  "desktop/host/core/src/p03/port.rs",
];

function absent(id, title, path) {
  return { check_id: id, title, verdict: "NOT_TESTED", detail: `${path} is absent, so nothing was measured` };
}

function judge(id, title, satisfied, detail) {
  return { check_id: id, title, verdict: satisfied ? "PASS" : "FAIL", detail };
}

export function staticChecks(root) {
  const checks = [];

  // ١ — لا عقد مخرجات يقبل نوع دليل من النموذج.
  {
    const source = read(root, "desktop/host/core/src/p03/model_adapter.rs");
    if (source === null) checks.push(absent("P03-SEC-NO-MODEL-EVIDENCE-TYPE", "no output contract accepts a model-declared evidence type", "model_adapter.rs"));
    else {
      // عقد الدليل المُعلن في DTO لا يحوي حقل النوع، والتسجيل يفرض AGENT_OUTPUT.
      const dto = /struct EvidenceProposalDto\s*\{[^}]*\}/s.exec(source)?.[0] ?? "";
      const declaresType = dto.includes("evidence_type");
      const closed = source.includes("deny_unknown_fields");
      const forced = source.includes("evidence_type: EvidenceType::AgentOutput");
      checks.push(
        judge(
          "P03-SEC-NO-MODEL-EVIDENCE-TYPE",
          "no output contract accepts a model-declared evidence type",
          !declaresType && closed && forced,
          `evidence DTO declares a type field: ${declaresType}; payload closed: ${closed}; adapter forces AGENT_OUTPUT: ${forced}`,
        ),
      );
    }
  }

  // ٢ — لا عملية IPC تقبل دليلًا.
  {
    const source = read(root, "desktop/host/core/src/p03/ipc.rs");
    if (source === null) checks.push(absent("P03-SEC-NO-EVIDENCE-OPERATION", "no Phase-03 IPC operation accepts evidence", "p03/ipc.rs"));
    else {
      const operations = /OPERATIONS: \[&str; \d+\] = \[(.*?)\];/s.exec(source)?.[1] ?? "";
      const names = [...operations.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      const submitters = names.filter((name) => /submit|ingest|record|attach|verify|approve/i.test(name));
      const readsOnly = names.includes("evidence.list");
      checks.push(
        judge(
          "P03-SEC-NO-EVIDENCE-OPERATION",
          "no Phase-03 IPC operation accepts evidence",
          submitters.length === 0 && readsOnly,
          `operations ${names.length}: ${names.join(", ")}; evidence-submitting names ${submitters.length}`,
        ),
      );
    }
  }

  // ٣ — أمر القياس الأصلي غير موجود في ثنائي المنتج.
  {
    const source = read(root, "desktop/host/app/src/lib.rs");
    if (source === null) checks.push(absent("P03-SEC-MEASUREMENT-COMMAND-IS-FEATURE-GATED", "the native measurement command is not compiled into the product binary", "app/src/lib.rs"));
    else {
      const gated = /#\[cfg\(feature = "e2e"\)\]\s*#\[tauri::command\]\s*fn polaris_e2e_native/s.test(source);
      const moduleGated = /#\[cfg\(feature = "e2e"\)\]\s*mod p03_native;/s.test(source);
      const productHandler = /#\[cfg\(not\(feature = "e2e"\)\)\]\s*let builder = builder\.invoke_handler\(tauri::generate_handler!\[polaris_ipc\]\);/s.test(source);
      checks.push(
        judge(
          "P03-SEC-MEASUREMENT-COMMAND-IS-FEATURE-GATED",
          "the native measurement command is not compiled into the product binary",
          gated && moduleGated && productHandler,
          `command gated: ${gated}; module gated: ${moduleGated}; product handler registers polaris_ipc alone: ${productHandler}`,
        ),
      );
    }
  }

  // ٤ — نداء الوكيل يمرّ بخدمة استدعاء Phase-02 وحدها.
  {
    const source = read(root, "desktop/host/core/src/p03/model_adapter.rs");
    if (source === null) checks.push(absent("P03-SEC-AGENT-USES-INVOCATION-SERVICE", "every agent model call goes through the Phase-02 invocation service", "model_adapter.rs"));
    else {
      // الاستدعاء قد يمتدّ على أسطر، فالمطابقة على المُعرِّفات لا على سطر بعينه.
      const usesService =
        /Arc<InvocationService>/.test(source) && /\binvocations\b/.test(source) && /\.invoke\(\s*input\s*,/.test(source);
      const buildsRequest = /reqwest|hyper|TcpStream|http:\/\//.test(source);
      checks.push(
        judge(
          "P03-SEC-AGENT-USES-INVOCATION-SERVICE",
          "every agent model call goes through the Phase-02 invocation service",
          usesService && !buildsRequest,
          `invocation service used: ${usesService}; direct transport in the adapter: ${buildsRequest}`,
        ),
      );
    }
  }

  // ٥ — لا نقطة نهاية ولا سرّ في مسار الوكيل.
  {
    const missing = AGENT_PATH.filter((relative) => read(root, relative) === null);
    if (missing.length > 0) {
      checks.push(absent("P03-SEC-NO-ENDPOINT-IN-AGENT-PATH", "no agent-path file names an endpoint", missing.join(", ")));
      checks.push(absent("P03-SEC-NO-SECRET-IN-AGENT-PATH", "no agent-path file reads or carries a credential", missing.join(", ")));
    } else {
      const endpointHits = [];
      const secretHits = [];
      for (const relative of AGENT_PATH) {
        const source = read(root, relative) ?? "";
        // التعليقات تُستثنى: الشرح يذكر ما لا يفعله الكود.
        const code = source
          .split("\n")
          .filter((line) => !line.trim().startsWith("//"))
          .join("\n");
        if (/https?:\/\/[a-z0-9]/i.test(code)) endpointHits.push(relative);
        if (/api_key|apikey|credential_value|authorization|bearer/i.test(code)) secretHits.push(relative);
      }
      checks.push(
        judge("P03-SEC-NO-ENDPOINT-IN-AGENT-PATH", "no agent-path file names an endpoint", endpointHits.length === 0, endpointHits.length === 0 ? `${AGENT_PATH.length} files carry no endpoint literal` : endpointHits.join(", ")),
      );
      checks.push(
        judge("P03-SEC-NO-SECRET-IN-AGENT-PATH", "no agent-path file reads or carries a credential", secretHits.length === 0, secretHits.length === 0 ? `${AGENT_PATH.length} files carry no credential reference` : secretHits.join(", ")),
      );
    }
  }

  // ٦ — لا مُرسِل عامّ للوكلاء.
  {
    const ipc = read(root, "desktop/host/core/src/p03/ipc.rs");
    const registry = read(root, "contracts/registry/phase-03-ipc.registry.json");
    if (ipc === null) checks.push(absent("P03-SEC-NO-GENERIC-DISPATCH", "no generic agent command path exists", "p03/ipc.rs"));
    else {
      const names = [...(ipc.match(/"[a-z]+\.[a-z]+"/g) ?? [])].map((value) => value.replace(/"/g, ""));
      const generic = names.filter((name) => /agent\.(execute|run|invoke|command|dispatch|call)/.test(name));
      const registryGeneric = registry === null ? [] : [...(registry.match(/"agent\.(execute|run|invoke|command|dispatch|call)"/g) ?? [])];
      const takesActionName = /payload\.get\("(action|command|method|operation)"\)/.test(ipc);
      checks.push(
        judge(
          "P03-SEC-NO-GENERIC-DISPATCH",
          "no generic agent command path exists",
          generic.length === 0 && registryGeneric.length === 0 && !takesActionName,
          `generic operation names ${generic.length}; registry entries ${registryGeneric.length}; a payload field names a verb: ${takesActionName}`,
        ),
      );
    }
  }

  // ٧ — لا أثر استدلال مخفيّ يُطلب أو يُخزَّن.
  {
    const adapter = read(root, "desktop/host/core/src/p03/model_adapter.rs");
    const evidence = read(root, "desktop/host/core/src/p03/evidence.rs");
    const claim = read(root, "desktop/host/core/src/p03/claim.rs");
    if (adapter === null || evidence === null || claim === null) {
      checks.push(absent("P03-SEC-NO-REASONING-TRACE", "no hidden reasoning trace is requested or stored", "p03 sources"));
    } else {
      const asksAgainst = adapter.includes("Do not include a reasoning trace");
      const fields = /reasoning|chain_of_thought|thoughts|scratchpad|deliberation/i;
      const storedInEvidence = fields.test(
        evidence
          .split("\n")
          .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
          .join("\n"),
      );
      const storedInClaim = fields.test(
        claim
          .split("\n")
          .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("///"))
          .join("\n"),
      );
      checks.push(
        judge(
          "P03-SEC-NO-REASONING-TRACE",
          "no hidden reasoning trace is requested or stored",
          asksAgainst && !storedInEvidence && !storedInClaim,
          `the output contract forbids a trace: ${asksAgainst}; a reasoning field exists in evidence: ${storedInEvidence}; in claims: ${storedInClaim}`,
        ),
      );
    }
  }

  // ٨ — كل رمز خطأ يعبر الحدّ من المفردات المغلقة التسع.
  {
    const canonical = ["VALIDATION_ERROR", "UNSUPPORTED_VERSION", "POLICY_DENIED", "MALFORMED_MESSAGE", "CONTRACT_VIOLATION", "DEPENDENCY_UNAVAILABLE", "TIMEOUT", "CONFLICT", "INTERNAL_ERROR"];
    const files = walk(join(root, "desktop/host/core/src/p03"), [".rs"]);
    if (files.length === 0) {
      checks.push(absent("P03-SEC-CANONICAL-ERROR-CODES", "every Phase-03 boundary error code is one the contract declares", "core/src/p03"));
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
          "P03-SEC-CANONICAL-ERROR-CODES",
          "every Phase-03 boundary error code is one the contract declares",
          offenders.length === 0,
          offenders.length === 0
            ? `${files.length} files scanned; every constructed error code is in the closed vocabulary of ${canonical.length}`
            : offenders.join("; "),
        ),
      );
    }
  }

  // ٩ — لا سرّ مكتوب في أي مصدر Phase-03 أو أداة مطابقة.
  {
    const files = [...walk(join(root, "desktop/host/core/src/p03"), [".rs"]), ...walk(join(root, "tools/p03-conformance"), [".mjs", ".ps1"])];
    const offenders = [];
    for (const file of files) {
      const hits = findSecretLeaks(readFileSync(file, "utf8"));
      // ملف الفحص نفسه يحمل الأشكال تعريفًا لا قيمة.
      if (hits.length > 0 && !file.endsWith("p03-security.mjs")) offenders.push(`${file.replace(root, "").replace(/\\/g, "/")}: ${hits.join(",")}`);
    }
    checks.push(judge("P03-SEC-NO-SECRET-IN-SOURCE", "no Phase-03 source or instrument carries a key-shaped value", offenders.length === 0, offenders.length === 0 ? `${files.length} files scanned, none carries a key shape` : offenders.join("; ")));
  }

  return checks;
}

/** يفحص الوثائق القانونية المكتوبة فعلًا. وثيقة غائبة NOT_TESTED لا PASS. */
export function evidenceChecks(root) {
  const suffix = evidenceSuffix();
  const present = [];
  const leaks = [];
  const reasoning = [];
  for (const base of P03_EVIDENCE) {
    const path = join(root, "evidence", `${base}${suffix}.json`);
    if (!existsSync(path)) continue;
    present.push(base);
    const text = readFileSync(path, "utf8");
    const hits = findSecretLeaks(text);
    if (hits.length > 0) leaks.push(`${base}: ${hits.join(",")}`);
    if (/"(reasoning|chain_of_thought|thoughts|scratchpad)"\s*:/i.test(text)) reasoning.push(base);
  }
  if (present.length === 0) {
    return [
      absent("P03-EVIDENCE-NO-SECRET", "no canonical Phase-03 document carries a key-shaped value", "evidence/phase-03-*.json"),
      absent("P03-EVIDENCE-NO-REASONING-FIELD", "no canonical Phase-03 document carries a reasoning trace field", "evidence/phase-03-*.json"),
    ];
  }
  return [
    judge("P03-EVIDENCE-NO-SECRET", "no canonical Phase-03 document carries a key-shaped value", leaks.length === 0, leaks.length === 0 ? `${present.length} document(s) scanned, none carries a key shape` : leaks.join("; ")),
    judge("P03-EVIDENCE-NO-REASONING-FIELD", "no canonical Phase-03 document carries a reasoning trace field", reasoning.length === 0, reasoning.length === 0 ? `${present.length} document(s) scanned, none carries a reasoning field` : reasoning.join(", ")),
  ];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const scanEvidence = process.argv.includes("--scan-evidence");
  const checks = scanEvidence ? evidenceChecks(root) : staticChecks(root);
  const name = scanEvidence ? "security-evidence.local.json" : "security-static.local.json";
  writeEvidence(join(root, RAW_DIRECTORY, name), { ...header(P03_TOOLS.security, root), scope: scanEvidence ? "EVIDENCE" : "STATIC", checks });
  for (const check of checks) console.log(`${check.verdict.padEnd(11)} ${check.check_id}  ${check.detail.slice(0, 160)}`);
  process.exitCode = checks.every((check) => check.verdict === "PASS") ? 0 : 1;
}
