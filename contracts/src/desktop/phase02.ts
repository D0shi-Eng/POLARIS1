// مفردات عمليات Phase-02 (ADR-019)، بوصفها قيمًا.
//
// الحارس هو نفسه حارس Phase-01: اختبار تكافؤ يقارن هذه القائمة بـenum المخطط
// `Phase02DesktopOperation` وبـenum الظرف، وآخر يقارنها بسجل Phase-02. لا يُضاف
// عنصر هنا دون أن يُضاف هناك.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import type { ParsedVersion } from "../version.js";
import type { DesktopOperationRecord } from "./ipc-registry.js";

export const PHASE02_OPERATIONS = [
  "provider.list",
  "provider.configure",
  "provider.credential.set",
  "provider.credential.clear",
  "provider.refresh",
  "model.list",
  "model.configure",
  "model.preferences.set",
  "model.invoke",
  "model.cancel",
  "project.list",
  "project.get",
  "project.create",
  "project.update",
  "project.archive",
  "context.add",
  "context.remove",
  "context.preview",
  "context.assemble",
] as const;

export type Phase02Operation = (typeof PHASE02_OPERATIONS)[number];

/** أول MINOR من الظرف يعرف عمليات Phase-02. */
export const PHASE02_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 2 };

/** العمليات ذات الأثر الجانبي. تتطلب مفتاح Idempotency في الظرف. */
export const PHASE02_SIDE_EFFECTING: readonly Phase02Operation[] = [
  "provider.configure",
  "provider.credential.set",
  "provider.credential.clear",
  "provider.refresh",
  "model.configure",
  "model.preferences.set",
  "model.invoke",
  "model.cancel",
  "project.create",
  "project.update",
  "project.archive",
  "context.add",
  "context.remove",
];

export function isPhase02Operation(value: unknown): value is Phase02Operation {
  return typeof value === "string" && (PHASE02_OPERATIONS as readonly string[]).includes(value);
}

export function isPhase02SideEffecting(operation: Phase02Operation): boolean {
  return PHASE02_SIDE_EFFECTING.includes(operation);
}

export const PHASE02_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-02-ipc.registry.json");

export interface Phase02OperationRecord extends Omit<DesktopOperationRecord, "operation"> {
  readonly operation: Phase02Operation;
  readonly effect_class: string;
}

export interface Phase02IpcRegistry {
  readonly contract_version: string;
  readonly phase: "PHASE-02";
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly Phase02OperationRecord[];
}

let cached: Phase02IpcRegistry | null = null;

/** يقرأ سجل Phase-02 ويتحقق منه بمخطط السجل نفسه. */
export function loadPhase02IpcRegistry(): Phase02IpcRegistry {
  if (cached !== null) return cached;
  const raw = JSON.parse(readFileSync(PHASE02_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<Phase02IpcRegistry>("desktop-ipc-registry.v1.schema.json", raw);
  if (!validated.ok) {
    throw new Error(
      `phase-02 IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }
  cached = validated.value;
  return cached;
}

export function phase02OperationRecord(operation: string): Phase02OperationRecord | undefined {
  return loadPhase02IpcRegistry().operations.find((record) => record.operation === operation);
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

function recordFor(operation: Phase02Operation): Phase02OperationRecord {
  const record = phase02OperationRecord(operation);
  if (record === undefined) throw new Error(`phase-02 operation ${operation} has no registry record`);
  return record;
}

/** يتحقق من حمولة طلب عملية Phase-02 مقابل المخطط الذي يسمّيه سجلها. */
export function validatePhase02RequestPayload<T = unknown>(operation: Phase02Operation, payload: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).request_schema, payload);
  if (!structural.ok) return structural;
  const secrets = secretViolations(payload, "/payload");
  return secrets.length > 0 ? fail(secrets) : structural;
}

/** يتحقق من حمولة نتيجة عملية Phase-02. */
export function validatePhase02ResultPayload<T = unknown>(operation: Phase02Operation, result: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).response_schema, result);
  if (!structural.ok) return structural;
  const secrets = secretViolations(result, "/result");
  return secrets.length > 0 ? fail(secrets) : structural;
}
