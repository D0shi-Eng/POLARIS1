// مفردات عمليات Phase-03 (ADR-021)، بوصفها قيمًا.
//
// الحارس هو نفسه حارس Phase-01 وPhase-02: اختبار تكافؤ يقارن هذه القائمة بـenum
// المخطط `Phase03DesktopOperation` وبـenum الظرف، وآخر يقارنها بسجل Phase-03. لا
// يُضاف عنصر هنا دون أن يُضاف هناك. ولا اسم فعل عام في هذه القائمة: لا
// `agent.execute` ولا `orchestrator.command`، لأن حمولة تُسمّي فعلًا اختياريًّا
// تُعيد فتح ما أُغلق (البند 77).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import type { ParsedVersion } from "../version.js";
import type { DesktopOperationRecord } from "./ipc-registry.js";

export const PHASE03_OPERATIONS = [
  "mission.list",
  "mission.get",
  "mission.create",
  "mission.start",
  "mission.cancel",
  "mission.resume",
  "task.list",
  "agent.list",
  "claim.list",
  "evidence.list",
] as const;

export type Phase03Operation = (typeof PHASE03_OPERATIONS)[number];

/** أول MINOR من الظرف يعرف عمليات Phase-03. */
export const PHASE03_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 3 };

/** العمليات ذات الأثر الجانبي. تتطلب مفتاح Idempotency في الظرف. */
export const PHASE03_SIDE_EFFECTING: readonly Phase03Operation[] = [
  "mission.create",
  "mission.start",
  "mission.cancel",
  "mission.resume",
];

export function isPhase03Operation(value: unknown): value is Phase03Operation {
  return typeof value === "string" && (PHASE03_OPERATIONS as readonly string[]).includes(value);
}

export function isPhase03SideEffecting(operation: Phase03Operation): boolean {
  return PHASE03_SIDE_EFFECTING.includes(operation);
}

export const PHASE03_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-03-ipc.registry.json");

export interface Phase03OperationRecord extends Omit<DesktopOperationRecord, "operation"> {
  readonly operation: Phase03Operation;
  readonly effect_class: string;
}

export interface Phase03IpcRegistry {
  readonly contract_version: string;
  readonly phase: "PHASE-03";
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly Phase03OperationRecord[];
}

let cached: Phase03IpcRegistry | null = null;

/** يقرأ سجل Phase-03 ويتحقق منه بمخطط السجل نفسه. */
export function loadPhase03IpcRegistry(): Phase03IpcRegistry {
  if (cached !== null) return cached;
  const raw = JSON.parse(readFileSync(PHASE03_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<Phase03IpcRegistry>("desktop-ipc-registry.v1.schema.json", raw);
  if (!validated.ok) {
    throw new Error(
      `phase-03 IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }
  cached = validated.value;
  return cached;
}

export function phase03OperationRecord(operation: string): Phase03OperationRecord | undefined {
  return loadPhase03IpcRegistry().operations.find((record) => record.operation === operation);
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

function recordFor(operation: Phase03Operation): Phase03OperationRecord {
  const record = phase03OperationRecord(operation);
  if (record === undefined) throw new Error(`phase-03 operation ${operation} has no registry record`);
  return record;
}

/** يتحقق من حمولة طلب عملية Phase-03 مقابل المخطط الذي يسمّيه سجلها. */
export function validatePhase03RequestPayload<T = unknown>(operation: Phase03Operation, payload: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).request_schema, payload);
  if (!structural.ok) return structural;
  const secrets = secretViolations(payload, "/payload");
  return secrets.length > 0 ? fail(secrets) : structural;
}

/** يتحقق من حمولة نتيجة عملية Phase-03. */
export function validatePhase03ResultPayload<T = unknown>(operation: Phase03Operation, result: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).response_schema, result);
  if (!structural.ok) return structural;
  const secrets = secretViolations(result, "/result");
  return secrets.length > 0 ? fail(secrets) : structural;
}
