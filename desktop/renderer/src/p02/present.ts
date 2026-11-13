// تحويلات عرض نقية لبيانات Phase-02. لا JSX ولا نصّ: مفاتيح ولهجات.

import type { Translator } from "../localization/translate";

export type Tone = "POSITIVE" | "NEUTRAL" | "MUTED" | "WARNING";

export function healthTone(state: string): Tone {
  switch (state) {
    case "HEALTHY":
      return "POSITIVE";
    case "UNKNOWN":
      return "MUTED";
    case "DEGRADED":
      return "NEUTRAL";
    default:
      return "WARNING";
  }
}

/** عمر قياس الصحّة الذي لا تُقال بعده «سليم» (E-4، تدقيق 2026-10-19): قياس أقدم يُعرض «لم يُفحص مؤخرًا» مع وقته. */
export const HEALTH_FRESH_MS = 15 * 60 * 1000;

/**
 * الصحّة كما تُعرض: «سليم» من قياس قديم أو بلا وقت لا يُقال، بل «غير معروف — لم يُفحص» ووقت آخر فحص بجانبه. بقية الحالات
 * تُعرض كما قيست: الانقطاع القديم يبقى تحذيرًا حتى يقيس فحص أو نداء غيره.
 */
export function shownHealth(health: { readonly state: string; readonly reason_code: string; readonly checked_at?: string | undefined }, now: number = Date.now()): { readonly state: string; readonly reason_code: string; readonly stale: boolean } {
  const at = health.checked_at === undefined ? Number.NaN : Date.parse(health.checked_at);
  const stale = health.state === "HEALTHY" && (Number.isNaN(at) || now - at > HEALTH_FRESH_MS);
  return stale ? { state: "UNKNOWN", reason_code: "NOT_CHECKED", stale } : { state: health.state, reason_code: health.reason_code, stale };
}

export function availabilityTone(state: string): Tone {
  if (state === "AVAILABLE") return "POSITIVE";
  if (state === "UNKNOWN") return "MUTED";
  return "WARNING";
}

/**
 * اسم المزوّد. الأسماء العلم تأتي من المضيف ولا تُترجم؛ المزوّد العام وحده له
 * مفتاح ترجمة. لا اسم مزوّد مكتوب في العارض.
 */
export function providerName(translator: Translator, view: { readonly display_name: string; readonly display_name_key: string }): string {
  return translator.has(view.display_name_key) ? translator.t(view.display_name_key) : view.display_name;
}

/** نصّ حقيقة نصية، أو «غير معروف». */
export function factText(translator: Translator, fact: { readonly value?: string | undefined } | undefined): string {
  return fact?.value ?? translator.t("p02.value.unknown");
}

/** مدة مقيسة على المضيف. */
export function measured(translator: Translator, fact: { readonly value: number } | undefined): string {
  if (fact === undefined) return translator.t("p02.value.not_measured");
  return translator.t("p02.duration.ms", { value: fact.value });
}
