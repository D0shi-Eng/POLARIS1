// تحويلات عرض نقية لبيانات Phase-06. لا JSX ولا نصّ: مفاتيح ولهجات وأرقام مُنسَّقة.
//
// ما لا يوجد هنا مقصود: لا لهجة «إيجابية» لنداء موصل نجح — ردّ HTTP ليس تحقّقًا من
// أن الأثر وقع. ولا جمع لكلفة مُبلَّغة مع كلفة مُقدَّرة، ولا تحويل عملة: كل مبلغ يبقى
// في عملته ومصدره.

import type { Tone } from "../p02/present";
import type {
  CostBucketV1,
  CostProvenance,
  HealthState,
  SettingDescriptorV1,
  SettingValue,
} from "../generated/types/desktop-p06-result-v1";

export function vocabularyKey(namespace: string, member: string): string {
  return `p06.${namespace}.${member}`;
}

export function healthStateTone(state: HealthState | string): Tone {
  switch (state) {
    case "HEALTHY":
      return "POSITIVE";
    case "DEGRADED":
      return "WARNING";
    case "UNHEALTHY":
    case "UNAVAILABLE":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/** النجاح محايد: الموصل ردّ، ولا يعني ذلك أن الأثر في الخدمة تحقّق. */
export function invocationTone(status: string): Tone {
  switch (status) {
    case "SUCCEEDED":
    case "REPLAYED":
      return "NEUTRAL";
    case "OUTCOME_UNKNOWN":
    case "FAILED":
    case "DENIED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function provenanceTone(provenance: CostProvenance | string): Tone {
  switch (provenance) {
    case "PROVIDER_REPORTED":
    case "LOCALLY_MEASURED":
      return "NEUTRAL";
    case "ESTIMATED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function budgetTone(state: string): Tone {
  switch (state) {
    case "WITHIN":
      return "NEUTRAL";
    case "NEAR_LIMIT":
    case "AT_LIMIT":
    case "EXCEEDED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function severityTone(severity: string): Tone {
  switch (severity) {
    case "ERROR":
    case "CRITICAL":
    case "WARNING":
      return "WARNING";
    case "INFO":
      return "NEUTRAL";
    default:
      return "MUTED";
  }
}

export function sourceTone(source: string): Tone {
  switch (source) {
    case "SECURITY_CLAMP":
      return "WARNING";
    case "DEFAULT":
      return "MUTED";
    default:
      return "NEUTRAL";
  }
}

/** المبلغ بالملايين من وحدة العملة، يُنسَّق بلغة المستخدم مع رمز العملة كما هو. */
export function formatMicros(micros: number, currency: string, locale: string): string {
  const units = micros / 1_000_000;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 6 }).format(units);
  } catch {
    // رمز عملة لا يعرفه المتصفّح يُعرض كما أدخله المستخدم، بلا تخمين.
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(units)} ${currency}`;
  }
}

/** مفتاح ثابت لكل حوض كلفة: عملة ومصدر معًا، فلا يختلط تقدير بتقرير. */
export function bucketKey(bucket: CostBucketV1): string {
  return `${bucket.currency}:${bucket.provenance}`;
}

/** قيمة إعداد في شكلها المقروء في حقل الإدخال. */
export function valueToInput(value: SettingValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * يحوّل نصّ حقل الإدخال إلى قيمة مُصنَّفة حسب نوع الإعداد. لا يتحقّق من الحدود: المضيف
 * يفعل ذلك ويرفض، والعارض يعرض الرفض كما جاء. `null` يعني أن النصّ لا يُقرأ بهذا النوع.
 */
export function inputToValue(descriptor: SettingDescriptorV1, text: string): SettingValue | null {
  const trimmed = text.trim();
  switch (descriptor.kind) {
    case "BOOLEAN":
      return trimmed === "true" ? true : trimmed === "false" ? false : null;
    case "INTEGER":
    case "DURATION":
    case "BYTES": {
      if (!/^-?\d+$/.test(trimmed)) return null;
      const parsed = Number(trimmed);
      return Number.isSafeInteger(parsed) ? parsed : null;
    }
    case "DECIMAL":
      return /^-?\d+(\.\d{1,6})?$/.test(trimmed) ? trimmed : null;
    case "LIST":
      return trimmed === "" ? [] : trimmed.split(",").map((item) => item.trim()).filter((item) => item !== "");
    default:
      return trimmed;
  }
}

export function sameValue(left: SettingValue | null | undefined, right: SettingValue | null | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
