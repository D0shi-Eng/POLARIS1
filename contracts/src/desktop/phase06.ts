// مفردات عمليات Phase-06 (ADR-026)، بوصفها قيمًا.
//
// الحارس نفسه: اختبار تكافؤ يقارن هذه القائمة بـenum المخطط `Phase06DesktopOperation`
// وبـenum الظرف، وآخر يقارنها بسجل Phase-06.
//
// ما ليس في هذه القائمة، ولن يكون: `connector.invoke`، و`connector.execute`، و`connector.call`،
// ولا عملية تكشف قيمة سرّ. العارض يسجّل الموصلات ويضبطها ويفحصها ويقرأ الاستعمال والكلفة
// والرصد والإعدادات ويكتبها؛ ولا يملك مسارًا ينفّذ عملية موصل على خدمة. عملية الموصل لها
// مستدعٍ واحد هو زمن تشغيل المهمّة الموثوق، ومسار واحد هو بوابة الأدوات ثم بوابة الموصلات.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import type { ParsedVersion } from "../version.js";
import type { DesktopOperationRecord } from "./ipc-registry.js";

export const PHASE06_OPERATIONS = [
  "connector.list",
  "connector.get",
  "connector.register",
  "connector.configure",
  "connector.remove",
  "connector.test",
  "connector.credential.set",
  "connector.credential.clear",
  "connector.openapi.import",
  "connector.openapi.approve",
  "connector.preset.list",
  "connector.preset.register",
  "usage.summary",
  "usage.list",
  "budget.list",
  "budget.set",
  "budget.remove",
  "pricing.list",
  "pricing.set",
  "pricing.remove",
  "observability.health",
  "observability.events",
  "observability.metrics",
  "observability.errors",
  "observability.alerts",
  "diagnostics.export",
  "config.describe",
  "config.effective",
  "config.set",
  "config.reset",
] as const;

export type Phase06Operation = (typeof PHASE06_OPERATIONS)[number];

/** أول MINOR من الظرف يعرف عمليات Phase-06. */
export const PHASE06_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 6 };

/** العمليات ذات الأثر الجانبي. تتطلب مفتاح Idempotency في الظرف. */
export const PHASE06_SIDE_EFFECTING: readonly Phase06Operation[] = [
  "connector.register",
  "connector.configure",
  "connector.remove",
  "connector.test",
  "connector.credential.set",
  "connector.credential.clear",
  "connector.openapi.import",
  "connector.openapi.approve",
  "connector.preset.register",
  "budget.set",
  "budget.remove",
  "pricing.set",
  "pricing.remove",
  "diagnostics.export",
  "config.set",
  "config.reset",
];

/**
 * أسماء يحرسها العقد بالاسم: لو ظهر أحدها لصار للعارض مسار ينفّذ عملية موصل على خدمة
 * خارجية، أو يكشف قيمة سرّ، أو يتجاوز ميزانية أو حدّ أمان — وهو بالضبط الالتفاف الذي
 * تمنعه هذه المرحلة.
 */
export const FORBIDDEN_PHASE06_OPERATIONS = [
  "connector.invoke",
  "connector.execute",
  "connector.call",
  "connector.request",
  "connector.secret.get",
  "connector.credential.get",
  "config.raw_set",
  "budget.override",
  "http.request",
] as const;

export function isPhase06Operation(value: unknown): value is Phase06Operation {
  return typeof value === "string" && (PHASE06_OPERATIONS as readonly string[]).includes(value);
}

export function isPhase06SideEffecting(operation: Phase06Operation): boolean {
  return PHASE06_SIDE_EFFECTING.includes(operation);
}

export const PHASE06_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-06-ipc.registry.json");

export interface Phase06OperationRecord extends Omit<DesktopOperationRecord, "operation"> {
  readonly operation: Phase06Operation;
  readonly effect_class: string;
}

export interface Phase06IpcRegistry {
  readonly contract_version: string;
  readonly phase: "PHASE-06";
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly Phase06OperationRecord[];
}

let cached: Phase06IpcRegistry | null = null;

/** يقرأ سجل Phase-06 ويتحقق منه بمخطط السجل نفسه. */
export function loadPhase06IpcRegistry(): Phase06IpcRegistry {
  if (cached !== null) return cached;
  const raw = JSON.parse(readFileSync(PHASE06_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<Phase06IpcRegistry>("desktop-ipc-registry.v1.schema.json", raw);
  if (!validated.ok) {
    throw new Error(
      `phase-06 IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }
  cached = validated.value;
  return cached;
}

export function phase06OperationRecord(operation: string): Phase06OperationRecord | undefined {
  return loadPhase06IpcRegistry().operations.find((record) => record.operation === operation);
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

function recordFor(operation: Phase06Operation): Phase06OperationRecord {
  const record = phase06OperationRecord(operation);
  if (record === undefined) throw new Error(`phase-06 operation ${operation} has no registry record`);
  return record;
}

/** يتحقق من حمولة طلب عملية Phase-06 مقابل المخطط الذي يسمّيه سجلها. */
export function validatePhase06RequestPayload<T = unknown>(operation: Phase06Operation, payload: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).request_schema, payload);
  if (!structural.ok) return structural;
  const secrets = secretViolations(payload, "/payload");
  return secrets.length > 0 ? fail(secrets) : structural;
}

/** يتحقق من حمولة نتيجة عملية Phase-06. */
export function validatePhase06ResultPayload<T = unknown>(operation: Phase06Operation, result: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).response_schema, result);
  if (!structural.ok) return structural;
  const secrets = secretViolations(result, "/result");
  return secrets.length > 0 ? fail(secrets) : structural;
}
