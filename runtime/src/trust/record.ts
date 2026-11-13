// سجل رفع التصنيف. وثيقة صغيرة ومحددة الغرض: تقول أي قيمة بعينها،
// مشتقة من أي أصل، صارت صالحة لأي أثر بعينه، وبأي دليل.
//
// ما لا يفعله هذا السجل، عمدًا:
//   - لا يجعل المصدر موثوقًا.
//   - لا يمنح "safe=true" عامًا.
//   - لا يسمح بالتنفيذ. السماح قرار PDP وحده.

import type { EffectAction } from "../effects.js";
import type { TaintLabel } from "./taint.js";

export type DeclassificationMethod = "D1" | "D2";

export type DeclassifiedValueKind = "FILESYSTEM_PATH" | "NETWORK_DESTINATION" | "SCALAR";

/** الغرض المربوط. رفع التصنيف لقراءة لا يعني كتابة، ولا حذفًا، ولا إرسالًا. */
export interface DeclassificationPurpose {
  readonly action: EffectAction;
  readonly value_kind: DeclassifiedValueKind;
}

/** نطاق صلاحية السجل. لا يوجد نطاق دائم في W4. */
export type DeclassificationScope = "SINGLE_INVOCATION" | "SINGLE_MISSION";

export interface DeclassificationEvidence {
  /** ما فحصه المُصادِق فعلًا، بصياغة قابلة للمراجعة. */
  readonly checks: readonly string[];
  /** بصمة المدخل الذي جرى الفحص عليه. لا يحمل المحتوى نفسه. */
  readonly input_sha256: string;
  /** المرساة المستعملة في D2. غائبة في D1. */
  readonly anchor_id?: string;
}

export interface DeclassificationRecord {
  readonly record_id: string;
  readonly method: DeclassificationMethod;
  readonly correlation_id: string;
  readonly mission_id: string;
  /** أصل المدخل الذي اشتُقت منه القيمة. */
  readonly input_provenance: readonly string[];
  /** التلوث الذي كان على المدخل. يبقى مسجَّلًا: السجل لا يمحو التاريخ. */
  readonly input_taint: readonly TaintLabel[];
  readonly output_value: string;
  readonly purpose: DeclassificationPurpose;
  readonly scope: DeclassificationScope;
  readonly validator_id: string;
  readonly validator_version: string;
  readonly evidence: DeclassificationEvidence;
  readonly issued_at: string;
}

export type D1FailureCode =
  | "UNPARSEABLE"
  | "SCHEMA_MISMATCH"
  | "EXTRA_FIELD"
  | "MISSING_FIELD"
  | "WRONG_TYPE"
  | "VALUE_TOO_LONG"
  | "PATTERN_MISMATCH"
  | "OUT_OF_DOMAIN"
  | "CONTROL_CHARACTERS";

export type D2FailureCode =
  | "NO_ANCHOR"
  | "FORBIDDEN_ANCHOR"
  | "ANCHOR_MISMATCH"
  | "OUT_OF_ANCHOR_SCOPE"
  | "CANONICALIZATION_FAILED"
  | "TRAVERSAL_REJECTED"
  | "SYMLINK_ESCAPE";

export interface DeclassificationFailure {
  readonly method: DeclassificationMethod;
  readonly code: D1FailureCode | D2FailureCode;
  readonly detail: string;
}

export type DeclassificationAttempt =
  | { readonly ok: true; readonly record: DeclassificationRecord }
  | { readonly ok: false; readonly failure: DeclassificationFailure };
