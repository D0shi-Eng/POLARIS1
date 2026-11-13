// قارئ سجل IPC لمرحلة Phase-01.
//
// السجل وثيقة بيانات، لا شيفرة: يُقرأ من القرص ويُتحقق منه مقابل مخططه قبل أن
// يُسلَّم لأي مستهلك. هذا هو ما تبنيه P01-W3 بوابتها منه، وليس وصفًا ثانيًا لها.
//
// وأهم ما يعبّر عنه: routing_status. صحة المخطط ليست إذنًا بالتوجيه. عملية
// موجودة في enum ومعروفة للمخطط قد تكون NOT_ROUTED، وحينها تُرفض بـ
// UNSUPPORTED_OPERATION. بلا هذا الفصل يصير «عضو enum صالح» مساويًا لـ«مأذون».

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, type ContractError } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { validateAgainstSchemaReference } from "../validator.js";
import { DESKTOP_OPERATIONS, isDesktopOperation, type DesktopOperation } from "./operations.js";

export const DESKTOP_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-01-ipc.registry.json");
const REGISTRY_SCHEMA_ID = "desktop-ipc-registry.v1.schema.json";

export interface DesktopOperationRecord {
  readonly operation: DesktopOperation;
  readonly envelope_version: string;
  readonly request_schema: string;
  readonly response_schema: string;
  readonly owner: string;
  readonly effect: "READ_ONLY" | "SIDE_EFFECTING";
  readonly idempotency: "NOT_REQUIRED" | "REQUIRED";
  readonly trust_boundary: string;
  readonly caller_class: string;
  readonly caller_identity_authority: string;
  readonly error_categories: readonly string[];
  readonly availability: { readonly state: string; readonly reason?: string };
  readonly routing_status: "ROUTED" | "NOT_ROUTED";
  readonly phase_introduced: string;
}

export interface DesktopIpcRegistry {
  readonly contract_version: string;
  readonly phase: string;
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly DesktopOperationRecord[];
}

let cached: DesktopIpcRegistry | null = null;

/**
 * يقرأ السجل ويتحقق منه. الفشل يرمي: سجل غير صالح ليس حالة تشغيل يمكن
 * الاستمرار معها بنصف معرفة، بل عيب بناء.
 */
export function loadDesktopIpcRegistry(): DesktopIpcRegistry {
  if (cached !== null) return cached;

  const raw = JSON.parse(readFileSync(DESKTOP_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<DesktopIpcRegistry>(REGISTRY_SCHEMA_ID, raw);
  if (!validated.ok) {
    throw new Error(
      `desktop IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }

  cached = validated.value;
  return cached;
}

/** السجل الخاص بعملية واحدة، أو undefined إن لم تُسجَّل أصلًا. */
export function desktopOperationRecord(operation: string): DesktopOperationRecord | undefined {
  return loadDesktopIpcRegistry().operations.find((record) => record.operation === operation);
}

/**
 * هل تُوجَّه هذه العملية؟
 *
 * ثلاث إجابات مختلفة تُختزل عمدًا إلى "لا" واحدة عند الحدّ: غير معروفة للمخطط،
 * معروفة وغير مسجَّلة، ومسجَّلة وغير موجَّهة. التمييز بينها معلومة عن الداخل،
 * والعارض لا يحتاجها؛ البوابة تسجّلها في سجلّها الخاص.
 */
export function isRoutableDesktopOperation(operation: unknown): operation is DesktopOperation {
  if (!isDesktopOperation(operation)) return false;
  const record = desktopOperationRecord(operation);
  return record !== undefined && record.routing_status === "ROUTED";
}

/** الخطأ القانوني لعملية صالحة المخطط وغير موجَّهة. */
export function unsupportedOperationError(operation: string): ContractError {
  return {
    code: ErrorCode.CONTRACT_VIOLATION,
    display_message: "Operation is not routed by this host.",
    internal_detail: `schema-valid but unrouted operation ${operation}`,
    pointer: "/operation",
    retryable: false,
  };
}

/** كل عملية معلنة في المفردات ولها سجل. يُستعمل في اختبار الاتساق. */
export function registeredDesktopOperations(): readonly DesktopOperation[] {
  const registry = loadDesktopIpcRegistry();
  return DESKTOP_OPERATIONS.filter((operation) =>
    registry.operations.some((record) => record.operation === operation),
  );
}
