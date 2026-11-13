// D1 — الاستخراج المقيّد بمخطط.
//
// الفكرة: قيمة مشتقة من محتوى غير موثوق يمكن أن تصير قيمة محددة الاستعمال
// إذا كان المخطط صريحًا، والمخرج مطابقًا له تمامًا، والحدود مضبوطة،
// ولم يحدث أي توسّع حر في الامتياز.
//
// D1 لا يجعل المصدر موثوقًا. يرفع تصنيف القيمة المحددة للغرض المحدد فقط.

import { newId, nowTimestamp, sha256 } from "../ids.js";
import { parseWindowsPath } from "../platform/windows-path-rules.js";
import type {
  DeclassificationAttempt,
  DeclassificationPurpose,
  DeclassificationScope,
  D1FailureCode,
} from "./record.js";
import type { TaintLabel } from "./taint.js";

export const D1_VALIDATOR_ID = "polaris.declassifier.d1.schema-constrained-extraction";
export const D1_VALIDATOR_VERSION = "1.0.0";

/**
 * مخطط الاستخراج. مغلق عمدًا: حقول معلنة، حقل واحد يُستخرج، نمط مرساة،
 * سقف طول، ومجال قيم اختياري مغلق. لا يوجد استخراج حر.
 */
export interface ExtractionSchema {
  readonly schema_id: string;
  readonly schema_version: string;
  /** الحقول المسموح بوجودها. أي حقل زائد يُبطل الاستخراج كله. */
  readonly allowed_fields: readonly string[];
  readonly required_fields: readonly string[];
  /** الحقل الذي تُؤخذ قيمته. */
  readonly extract_field: string;
  readonly max_length: number;
  /** نمط مرساة يُطبَّق على القيمة المستخرجة. */
  readonly pattern: string;
  /** مجال مغلق اختياري. وجوده يجعل القيم خارجه مرفوضة حتى لو طابقت النمط. */
  readonly allowed_domain?: readonly string[];
}

export interface D1Input {
  readonly correlation_id: string;
  readonly mission_id: string;
  /** المحتوى غير الموثوق كما وصل، بلا أي تفسير مسبق. */
  readonly content: string;
  readonly schema: ExtractionSchema;
  readonly purpose: DeclassificationPurpose;
  readonly scope: DeclassificationScope;
  readonly input_taint: readonly TaintLabel[];
  readonly input_provenance: readonly string[];
}

function reject(code: D1FailureCode, detail: string): DeclassificationAttempt {
  return { ok: false, failure: { method: "D1", code, detail } };
}

/**
 * فحص محارف التحكم بالرمز العددي بدل نمط نصي: يبقى الملف نصًا آمنًا للنقل
 * ولا يعتمد الفحص على تمثيل هروب داخل تعبير نمطي.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * ينفّذ الاستخراج. المحتوى يُعامَل كبيانات دائمًا: يُحلَّل، ولا يُنفَّذ،
 * ولا يُقرأ منه أي توجيه. أي تعليمة مدسوسة داخله تفشل عند المخطط،
 * إما كحقل زائد وإما كقيمة لا تطابق النمط.
 */
export function runD1(input: D1Input): DeclassificationAttempt {
  const schema = input.schema;
  const checks: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    return reject("UNPARSEABLE", "content is not a JSON document");
  }
  checks.push("content parsed as JSON");

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return reject("SCHEMA_MISMATCH", "extraction document must be a JSON object");
  }
  const document = parsed as Record<string, unknown>;

  const allowed = new Set(schema.allowed_fields);
  for (const field of Object.keys(document)) {
    if (!allowed.has(field)) return reject("EXTRA_FIELD", `field "${field}" is not declared by the schema`);
  }
  checks.push(`no field outside {${schema.allowed_fields.join(", ")}}`);

  for (const field of schema.required_fields) {
    if (!(field in document)) return reject("MISSING_FIELD", `required field "${field}" is absent`);
  }
  checks.push(`required fields present: {${schema.required_fields.join(", ")}}`);

  const raw = document[schema.extract_field];
  if (typeof raw !== "string") {
    return reject("WRONG_TYPE", `field "${schema.extract_field}" is ${typeof raw}, expected string`);
  }
  if (raw.length > schema.max_length) {
    return reject("VALUE_TOO_LONG", `length ${String(raw.length)} exceeds ${String(schema.max_length)}`);
  }
  checks.push(`value length is within ${String(schema.max_length)}`);

  if (hasControlCharacter(raw)) {
    return reject("CONTROL_CHARACTERS", "extracted value carries control characters");
  }
  checks.push("value carries no control characters");

  let anchored: RegExp;
  try {
    anchored = new RegExp(schema.pattern);
  } catch {
    return reject("SCHEMA_MISMATCH", "schema pattern is not a valid expression");
  }
  if (!anchored.test(raw)) {
    return reject("PATTERN_MISMATCH", `value does not match ${schema.pattern}`);
  }
  checks.push(`value matches ${schema.pattern}`);

  if (schema.allowed_domain !== undefined && !schema.allowed_domain.includes(raw)) {
    return reject("OUT_OF_DOMAIN", "value is outside the closed domain declared by the schema");
  }
  if (schema.allowed_domain !== undefined) checks.push("value is inside the closed domain");

  // قيمة المسار تُخزَّن بشكلها القانوني الوحيد. لولا ذلك لَصار شكل الفاصل
  // أو حالة الأحرف بابًا لتفويت السجل، والتفويت رفضٌ صامت لا أمان.
  let value = raw;
  if (input.purpose.value_kind === "FILESYSTEM_PATH") {
    const parsed = parseWindowsPath(raw);
    if (!parsed.ok) {
      return reject("PATTERN_MISMATCH", `extracted value is not a canonical path: ${parsed.rejection}`);
    }
    value = parsed.parts.normalised;
    checks.push(`value canonicalised to ${value}`);
  }

  return {
    ok: true,
    record: {
      record_id: newId(),
      method: "D1",
      correlation_id: input.correlation_id,
      mission_id: input.mission_id,
      input_provenance: input.input_provenance,
      input_taint: input.input_taint,
      output_value: value,
      purpose: input.purpose,
      scope: input.scope,
      validator_id: D1_VALIDATOR_ID,
      validator_version: `${D1_VALIDATOR_VERSION}+${schema.schema_id}@${schema.schema_version}`,
      evidence: { checks, input_sha256: sha256(input.content) },
      issued_at: nowTimestamp(),
    },
  };
}
