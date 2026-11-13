// أدوات الاختبار: تُبنى وثائق W3 من عينات W2 الحقيقية بدل اختراع JSON مواز،
// فأي انجراف في العقود يكسر اختبارات W3 أيضًا، وهو ما نريده.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SettingValue, StoredLayer } from "../src/config/types.js";
import { CONFIG_SCHEMA_VERSION } from "../src/config/schema.js";

// يُبحث عن جذر المستودع صعودًا بدل تثبيت عدد المستويات، حتى لا ينكسر المسار
// عند تغيير مخطط الإخراج أو تشغيل الاختبارات من مكان آخر.
function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "contracts", "fixtures", "positive"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("POLARIS repository root not found: contracts/fixtures/positive is missing");
}

const CONTRACT_FIXTURES = join(repositoryRoot(), "contracts", "fixtures", "positive");

export type Doc = Record<string, unknown>;

export function contractFixture(name: string): Doc {
  return JSON.parse(readFileSync(join(CONTRACT_FIXTURES, name), "utf8")) as Doc;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * الواصف يحمل حقل تكامل محسوبًا على محتواه. أي تعديل في اختبار يُبطله،
 * فتُحذف البصمة عند الاشتقاق؛ الحقل اختياري في العقد وحذفه صالح.
 */
export function descriptorReadFile(overrides: Doc = {}): Doc {
  const base = contractFixture("capability-descriptor.read-file.json");
  delete base["integrity"];
  return { ...base, ...overrides };
}

export function descriptorBrokeredFetch(overrides: Doc = {}): Doc {
  return { ...contractFixture("capability-descriptor.brokered-fetch.json"), ...overrides };
}

export function invocationReadFile(overrides: Doc = {}): Doc {
  return { ...contractFixture("capability-invocation.read-file.json"), ...overrides };
}

const BROKERED_DESTINATION = { host: "api.polaris.example", port: 443, protocol: "HTTPS" } as const;

/** استدعاء شبكي مبني على واصف الجلب المتوسَّط، بنفس سلسلة الارتباط. */
export function invocationNetworkFetch(overrides: Doc = {}): Doc {
  const read = contractFixture("capability-invocation.read-file.json");
  return {
    contract_version: "1.0",
    invocation_id: "21212121-2121-4121-8121-212121212121",
    correlation_id: read["correlation_id"],
    causation_id: read["causation_id"],
    idempotency_key: "polaris.net.fetch_document:doc:001",
    mission_id: read["mission_id"],
    agent_id: read["agent_id"],
    caller_identity: read["caller_identity"],
    capability_id: "polaris.net.fetch_document",
    capability_version: "0.1.0",
    requested_effects: [
      { action: "network.fetch", destination: { ...BROKERED_DESTINATION }, data_classification: "INTERNAL" },
    ],
    arguments: { url: "https://api.polaris.example/doc/1" },
    taint_labels: ["USER_SUPPLIED"],
    attempt: 1,
    execution_constraints: {
      confinement: "CONFINED",
      filesystem_scope: "NONE",
      process_tree: "CONFINED_KILL_ON_CLOSE",
      network: "BROKERED_EGRESS",
      handle_inheritance: "EXPLICIT_ONLY",
      environment: "EXPLICIT_ONLY",
      allowed_destinations: [{ ...BROKERED_DESTINATION }],
      max_wall_clock_ms: 10000,
    },
    created_at: "2026-09-01T09:00:10Z",
    ...overrides,
  };
}

export const BROKERED_DESTINATION_KEY = `${BROKERED_DESTINATION.host}:${String(BROKERED_DESTINATION.port)}`;

export function layer(scope: "DEFAULT" | "USER", values: Record<string, unknown>, version = CONFIG_SCHEMA_VERSION): StoredLayer {
  return { schema_version: version, scope, values };
}

// ── دعم مجموعة المهام ────────────────────────────────────────────────────────
// المهام تُوصَف بشكل تصريحي في corpus/missions.json، وتُبنى منها وثائق عقود حقيقية
// هنا، حتى لا يكون "الناتج المتوقع" في المجموعة رأيًا بل ادعاءً يمر على PDP فعلي.

export function corpusPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "corpus");
}

export interface CorpusCase {
  kind: "read" | "network";
  path?: string;
  host?: string;
  port?: number;
  declared: boolean;
  confined?: boolean;
  config?: Record<string, SettingValue>;
}

export function configForCase(testCase: CorpusCase): Array<{ key: string; scope: "USER"; value: SettingValue }> {
  return Object.entries(testCase.config ?? {}).map(([key, value]) => ({
    key,
    scope: "USER" as const,
    value: value as SettingValue,
  }));
}

export function buildCaseInvocation(testCase: CorpusCase): Doc {
  if (testCase.kind === "network") {
    const destination = { host: testCase.host!, port: testCase.port!, protocol: "HTTPS" };
    const invocation = invocationNetworkFetch();
    (invocation["requested_effects"] as Doc[])[0]!["destination"] = { ...destination };
    (invocation["execution_constraints"] as Doc)["allowed_destinations"] = [{ ...destination }];
    return invocation;
  }

  const invocation = invocationReadFile();
  const resource = { kind: "FILESYSTEM_PATH", locator: testCase.path!, scope: "EXACT" };
  invocation["resource"] = resource;
  (invocation["requested_effects"] as Doc[])[0]!["resource"] = { ...resource };
  const constraints = invocation["execution_constraints"] as Doc;
  constraints["granted_paths"] = [{ ...resource }];
  if (testCase.confined === false) {
    constraints["confinement"] = "NONE";
    constraints["filesystem_scope"] = "USER_SCOPE";
    delete constraints["granted_paths"];
  }
  return invocation;
}

export function buildCaseDescriptor(testCase: CorpusCase): Doc {
  if (testCase.kind === "network") {
    const descriptor = descriptorBrokeredFetch();
    const destination = { host: testCase.host!, port: testCase.port!, protocol: "HTTPS" };
    if (testCase.declared) {
      (descriptor["requested_effects"] as Doc[])[0]!["destination"] = { ...destination };
      (descriptor["execution_requirements"] as Doc)["allowed_destinations"] = [{ ...destination }];
    }
    return descriptor;
  }

  const descriptor = descriptorReadFile();
  const resource = { kind: "FILESYSTEM_PATH", locator: testCase.path!, scope: "EXACT" };
  if (testCase.declared) {
    (descriptor["requested_effects"] as Doc[])[0]!["resource"] = { ...resource };
    (descriptor["execution_requirements"] as Doc)["granted_paths"] = [{ ...resource }];
  }
  return descriptor;
}

export function runtimeSrcPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
}
