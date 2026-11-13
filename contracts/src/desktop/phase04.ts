// مفردات عمليات Phase-04 (ADR-023)، بوصفها قيمًا.
//
// الحارس هو نفسه حارس المراحل السابقة: اختبار تكافؤ يقارن هذه القائمة بـenum
// المخطط `Phase04DesktopOperation` وبـenum الظرف، وآخر يقارنها بسجل Phase-04.
//
// ما ليس في هذه القائمة، ولن يكون: `tool.execute`، و`tool.invoke`، و`mcp.call`.
// العارض يقرأ السجل ويجيب موافقة؛ ولا يملك مسارًا ينفّذ أداة. تنفيذ الأداة له
// مستدعٍ واحد هو زمن تشغيل المهمّة الموثوق، ومسار واحد هو بوابة الأدوات.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import type { ParsedVersion } from "../version.js";
import type { DesktopOperationRecord } from "./ipc-registry.js";

export const PHASE04_OPERATIONS = [
  "skill.list",
  "skill.get",
  "skill.configure",
  "tool.list",
  "tool.get",
  "tool.activity.list",
  "mcp.list",
  "mcp.register",
  "mcp.configure",
  "mcp.refresh",
  "approval.list",
  "tool.approval.respond",
] as const;

export type Phase04Operation = (typeof PHASE04_OPERATIONS)[number];

/** أول MINOR من الظرف يعرف عمليات Phase-04. */
export const PHASE04_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 4 };

/** العمليات ذات الأثر الجانبي. تتطلب مفتاح Idempotency في الظرف. */
export const PHASE04_SIDE_EFFECTING: readonly Phase04Operation[] = [
  "skill.configure",
  "mcp.register",
  "mcp.configure",
  "mcp.refresh",
  "tool.approval.respond",
];

/**
 * أسماء عمليات يحرسها العقد بالاسم: لو ظهر أحدها في المفردات لصار للعارض مسار
 * ينفّذ أداة بحجّة أنها «مسجَّلة»، وهو بالضبط الالتفاف الذي تمنعه هذه المرحلة.
 */
export const FORBIDDEN_TOOL_OPERATIONS = [
  "tool.execute",
  "tool.invoke",
  "tool.run",
  "tool.call",
  "mcp.call",
  "mcp.invoke",
  "skill.execute",
  "skill.run",
  "approval.grant.self",
] as const;

export function isPhase04Operation(value: unknown): value is Phase04Operation {
  return typeof value === "string" && (PHASE04_OPERATIONS as readonly string[]).includes(value);
}

export function isPhase04SideEffecting(operation: Phase04Operation): boolean {
  return PHASE04_SIDE_EFFECTING.includes(operation);
}

export const PHASE04_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-04-ipc.registry.json");

export interface Phase04OperationRecord extends Omit<DesktopOperationRecord, "operation"> {
  readonly operation: Phase04Operation;
  readonly effect_class: string;
}

export interface Phase04IpcRegistry {
  readonly contract_version: string;
  readonly phase: "PHASE-04";
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly Phase04OperationRecord[];
}

let cached: Phase04IpcRegistry | null = null;

/** يقرأ سجل Phase-04 ويتحقق منه بمخطط السجل نفسه. */
export function loadPhase04IpcRegistry(): Phase04IpcRegistry {
  if (cached !== null) return cached;
  const raw = JSON.parse(readFileSync(PHASE04_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<Phase04IpcRegistry>("desktop-ipc-registry.v1.schema.json", raw);
  if (!validated.ok) {
    throw new Error(
      `phase-04 IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }
  cached = validated.value;
  return cached;
}

export function phase04OperationRecord(operation: string): Phase04OperationRecord | undefined {
  return loadPhase04IpcRegistry().operations.find((record) => record.operation === operation);
}

function secretViolations(value: unknown, basePointer: string): ContractError[] {
  return findSecretsDeep(value, basePointer).map((finding) => ({
    code: ErrorCode.CONTRACT_VIOLATION,
    display_message: "Desktop payload must not carry credentials.",
    internal_detail: `${finding.reason}: ${finding.detail}`,
    pointer: finding.pointer,
    retryable: false,
  }));
}

function recordFor(operation: Phase04Operation): Phase04OperationRecord {
  const record = phase04OperationRecord(operation);
  if (record === undefined) throw new Error(`phase-04 operation ${operation} has no registry record`);
  return record;
}

/** يتحقق من حمولة طلب عملية Phase-04 مقابل المخطط الذي يسمّيه سجلها. */
export function validatePhase04RequestPayload<T = unknown>(operation: Phase04Operation, payload: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).request_schema, payload);
  if (!structural.ok) return structural;
  const secrets = secretViolations(payload, "/payload");
  return secrets.length > 0 ? fail(secrets) : structural;
}

/** يتحقق من حمولة نتيجة عملية Phase-04. */
export function validatePhase04ResultPayload<T = unknown>(operation: Phase04Operation, result: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).response_schema, result);
  if (!structural.ok) return structural;
  const secrets = secretViolations(result, "/result");
  return secrets.length > 0 ? fail(secrets) : structural;
}
