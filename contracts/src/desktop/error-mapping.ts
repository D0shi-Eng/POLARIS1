// خريطة الأخطاء المعروضة: من مفردات POLARIS المجمَّدة إلى فئة واجهة، ومعها
// قرار الحجب.
//
// ليست كونًا ثانيًا للأخطاء. كل فئة هنا مشتقة من ErrorCode قائم، واختبار
// الاكتمال يمنع بقاء رمز قانوني بلا فئة — وهو الشكل الذي تتسرّب منه رسالة
// داخلية إلى شاشة، لأن أحدًا لم يقرّر ما تعنيه.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, type ContractError } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { validateAgainstSchemaReference } from "../validator.js";

export const DESKTOP_ERROR_MAPPING_FILE = join(REGISTRY_ROOT, "phase-01-error-mapping.json");
const ERROR_MAPPING_SCHEMA_ID = "desktop-error-mapping.v1.schema.json";

export type DesktopErrorCategory =
  | "IPC_UNAVAILABLE"
  | "IPC_TIMEOUT"
  | "UNSUPPORTED_OPERATION"
  | "INVALID_RESPONSE"
  | "NATIVE_SERVICE_UNAVAILABLE"
  | "CONFIG_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "FEATURE_NOT_AVAILABLE"
  | "INTERNAL_ERROR";

export interface DesktopErrorMappingEntry {
  readonly category: DesktopErrorCategory;
  readonly canonical_codes: readonly ErrorCode[];
  readonly retryable: boolean;
  readonly detail_may_cross_boundary: boolean;
  readonly default_redaction: "STRIP_INTERNAL_DETAIL" | "STRIP_ALL_DETAIL";
  readonly display_key: string;
}

export interface DesktopErrorMapping {
  readonly contract_version: string;
  readonly phase: string;
  readonly entries: readonly DesktopErrorMappingEntry[];
}

/** ما يعبر الحدّ فعلًا. لا internal_detail هنا ولا أثر مكدّس: غيابهما بنيوي لا اتفاقي. */
export interface DesktopErrorView {
  readonly category: DesktopErrorCategory;
  readonly code: ErrorCode;
  readonly display_message: string;
  readonly retryable: boolean;
  readonly correlation_id?: string;
  readonly pointer?: string;
}

let cached: DesktopErrorMapping | null = null;

export function loadDesktopErrorMapping(): DesktopErrorMapping {
  if (cached !== null) return cached;

  const raw = JSON.parse(readFileSync(DESKTOP_ERROR_MAPPING_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<DesktopErrorMapping>(ERROR_MAPPING_SCHEMA_ID, raw);
  if (!validated.ok) {
    throw new Error(
      `desktop error mapping is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }

  cached = validated.value;
  return cached;
}

/**
 * الفئة المُصرَّح بها لرمز قانوني.
 *
 * رمز واحد قد يظهر في أكثر من فئة (INTERNAL_ERROR مثلًا يظهر كخطأ داخلي وكردّ
 * غير صالح)، فالترتيب في الوثيقة هو الترتيب الحاكم، وأول تطابق هو الافتراضي.
 * الفئة الأدق تأتي من سياق الاستدعاء عبر `preferred`.
 */
export function desktopCategoryFor(code: ErrorCode, preferred?: DesktopErrorCategory): DesktopErrorCategory {
  const entries = loadDesktopErrorMapping().entries;
  if (preferred !== undefined) {
    const chosen = entries.find((entry) => entry.category === preferred && entry.canonical_codes.includes(code));
    if (chosen !== undefined) return chosen.category;
  }
  const first = entries.find((entry) => entry.canonical_codes.includes(code));
  // الاكتمال مُثبَت باختبار؛ هذا المسار موجود حتى لا يكون النوع كاذبًا، لا كتساهل.
  return first === undefined ? "INTERNAL_ERROR" : first.category;
}

export function desktopErrorEntry(category: DesktopErrorCategory): DesktopErrorMappingEntry {
  const entry = loadDesktopErrorMapping().entries.find((candidate) => candidate.category === category);
  if (entry === undefined) throw new Error(`desktop error category ${category} has no mapping entry`);
  return entry;
}

/**
 * يحوّل خطأ عقد إلى ما يراه العارض، بعد تطبيق الحجب المُصرَّح به.
 *
 * الحجب هنا افتراضي وليس اختياريًا: لا يوجد وسيط يمرّر internal_detail. تمريره
 * يحتاج مسار تشخيص موثوقًا لا وجود له في Phase-01، وإضافته تغيير مرئي في
 * detail_may_cross_boundary لا سطر شرطي في دالة.
 */
export function toDesktopErrorView(
  error: ContractError,
  options: { readonly category?: DesktopErrorCategory; readonly correlationId?: string } = {},
): DesktopErrorView {
  const category = desktopCategoryFor(error.code, options.category);
  const entry = desktopErrorEntry(category);

  const view: {
    category: DesktopErrorCategory;
    code: ErrorCode;
    display_message: string;
    retryable: boolean;
    correlation_id?: string;
    pointer?: string;
  } = {
    category,
    code: error.code,
    display_message: error.display_message,
    retryable: entry.retryable,
  };

  if (options.correlationId !== undefined) view.correlation_id = options.correlationId;
  if (entry.default_redaction === "STRIP_INTERNAL_DETAIL" && error.pointer !== undefined) {
    view.pointer = error.pointer;
  }

  return view;
}
