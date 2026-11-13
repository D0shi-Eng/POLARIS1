// مفردات عمليات Phase-05 (ADR-025)، بوصفها قيمًا.
//
// الحارس نفسه: اختبار تكافؤ يقارن هذه القائمة بـenum المخطط `Phase05DesktopOperation`
// وبـenum الظرف، وآخر يقارنها بسجل Phase-05.
//
// ما ليس في هذه القائمة، ولن يكون: `browser.raw_execute`، و`computer.raw_command`،
// و`memory.trust`. العارض يقرأ الجلسات والذاكرة، ويحذف ذاكرة، ويمنح نافذة لمهمّة،
// ويوقف جلسة؛ ولا يملك مسارًا يتنقّل أو ينقر أو يكتب أو يرفع ثقة ذاكرة. الفعل على الويب
// أو الشاشة له مستدعٍ واحد هو زمن تشغيل المهمّة الموثوق، ومسار واحد هو بوابة الأدوات.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import type { ParsedVersion } from "../version.js";
import type { DesktopOperationRecord } from "./ipc-registry.js";

export const PHASE05_OPERATIONS = [
  "memory.list",
  "memory.get",
  "memory.delete",
  "browser.session.list",
  "browser.session.get",
  "browser.session.cancel",
  "computer.session.list",
  "computer.session.get",
  "computer.session.cancel",
  "computer.window.list",
  "computer.target.grant",
  "computer.target.revoke",
] as const;

export type Phase05Operation = (typeof PHASE05_OPERATIONS)[number];

/** أول MINOR من الظرف يعرف عمليات Phase-05. */
export const PHASE05_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 5 };

/** العمليات ذات الأثر الجانبي. تتطلب مفتاح Idempotency في الظرف. */
export const PHASE05_SIDE_EFFECTING: readonly Phase05Operation[] = [
  "memory.delete",
  "browser.session.cancel",
  "computer.session.cancel",
  "computer.target.grant",
  "computer.target.revoke",
];

/**
 * أسماء يحرسها العقد بالاسم: لو ظهر أحدها لصار للعارض مسار يتنقّل أو ينقر أو يكتب
 * أو يرفع ثقة ذاكرة، وهو بالضبط الالتفاف الذي تمنعه هذه المرحلة.
 */
export const FORBIDDEN_PHASE05_OPERATIONS = [
  "browser.raw_execute",
  "browser.execute",
  "browser.navigate",
  "browser.click",
  "computer.raw_command",
  "computer.execute",
  "computer.click",
  "computer.type",
  "memory.trust",
  "memory.verify",
  "memory.write",
  "action.execute",
] as const;

export function isPhase05Operation(value: unknown): value is Phase05Operation {
  return typeof value === "string" && (PHASE05_OPERATIONS as readonly string[]).includes(value);
}

export function isPhase05SideEffecting(operation: Phase05Operation): boolean {
  return PHASE05_SIDE_EFFECTING.includes(operation);
}

export const PHASE05_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-05-ipc.registry.json");

export interface Phase05OperationRecord extends Omit<DesktopOperationRecord, "operation"> {
  readonly operation: Phase05Operation;
  readonly effect_class: string;
}

export interface Phase05IpcRegistry {
  readonly contract_version: string;
  readonly phase: "PHASE-05";
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly Phase05OperationRecord[];
}

let cached: Phase05IpcRegistry | null = null;

/** يقرأ سجل Phase-05 ويتحقق منه بمخطط السجل نفسه. */
export function loadPhase05IpcRegistry(): Phase05IpcRegistry {
  if (cached !== null) return cached;
  const raw = JSON.parse(readFileSync(PHASE05_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<Phase05IpcRegistry>("desktop-ipc-registry.v1.schema.json", raw);
  if (!validated.ok) {
    throw new Error(
      `phase-05 IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }
  cached = validated.value;
  return cached;
}

export function phase05OperationRecord(operation: string): Phase05OperationRecord | undefined {
  return loadPhase05IpcRegistry().operations.find((record) => record.operation === operation);
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

function recordFor(operation: Phase05Operation): Phase05OperationRecord {
  const record = phase05OperationRecord(operation);
  if (record === undefined) throw new Error(`phase-05 operation ${operation} has no registry record`);
  return record;
}

/** يتحقق من حمولة طلب عملية Phase-05 مقابل المخطط الذي يسمّيه سجلها. */
export function validatePhase05RequestPayload<T = unknown>(operation: Phase05Operation, payload: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).request_schema, payload);
  if (!structural.ok) return structural;
  const secrets = secretViolations(payload, "/payload");
  return secrets.length > 0 ? fail(secrets) : structural;
}

/** يتحقق من حمولة نتيجة عملية Phase-05. */
export function validatePhase05ResultPayload<T = unknown>(operation: Phase05Operation, result: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).response_schema, result);
  if (!structural.ok) return structural;
  const secrets = secretViolations(result, "/result");
  return secrets.length > 0 ? fail(secrets) : structural;
}
