// تنسيق واعٍ باللغة: التواريخ والأرقام وأول أيام الأسبوع.
//
// لا تنسيق يدوي. رقم يُكتب بالضمّ يفقد فاصلة الآلاف الصحيحة في لغة ويكسب واحدة
// خاطئة في أخرى، وتاريخ يُركَّب من أجزاء يخرج بترتيب خاطئ في نصف اللغات.

import type { LocaleCode } from "./types";

/** أول أيام الأسبوع: ١ الاثنين … ٧ الأحد، بترتيب ISO-8601. */
export type WeekDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * جدول تراجع لأول أيام الأسبوع.
 *
 * `Intl.Locale.prototype.getWeekInfo` غير موجود في كل المحركات، ولذلك يوجد
 * الجدول. وهو تراجع مُعلَن لا مصدر حقيقة: حين يوجد المحرك الذي يعرف، يُسأل هو.
 */
const FIRST_DAY_FALLBACK: Readonly<Record<LocaleCode, WeekDay>> = {
  ar: 7,
  en: 7,
  de: 1,
  fr: 1,
  ru: 1,
  zh: 1,
  ko: 7,
  ja: 7,
  es: 1,
};

interface WeekInfoCapable {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
}

export function firstDayOfWeek(locale: LocaleCode): WeekDay {
  try {
    const info = new Intl.Locale(locale) as unknown as WeekInfoCapable;
    const firstDay = typeof info.getWeekInfo === "function" ? info.getWeekInfo().firstDay : info.weekInfo?.firstDay;
    if (typeof firstDay === "number" && firstDay >= 1 && firstDay <= 7) return firstDay as WeekDay;
  } catch {
    // محرك لا يعرف Intl.Locale. التراجع أدناه هو الجواب، لا الانهيار.
  }
  return FIRST_DAY_FALLBACK[locale];
}

export function formatNumber(locale: LocaleCode, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatInstant(locale: LocaleCode, isoInstant: string): string {
  const parsed = new Date(isoInstant);
  if (Number.isNaN(parsed.getTime())) return isoInstant;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

/**
 * يعزل مقطعًا ثنائي الاتجاه.
 *
 * الحالة الحقيقية: إصدار مثل `0.1.0` داخل جملة عربية. خوارزمية bidi تعيد ترتيب
 * ما حوله إن تُرك حرًّا، فيظهر الإصدار مقلوبًا أو ملتصقًا بالكلمة الخطأ. العلامتان
 * تحصرانه كوحدة واحدة دون تغيير اتجاه الفقرة.
 */
export function isolate(value: string): string {
  return `⁦${value}⁩`;
}

/**
 * يصل عناصر قائمة بقواعد اللغة نفسها.
 *
 * الوصل النحوي ليس نصًّا يُترجم: العربية تصل بـ«،» والإنجليزية بـ"," و"and"،
 * وكتابة أيٍّ منهما في شاشة أو في فهرس لغة يثبّت لغة واحدة في مكان لا يخصّها.
 * `Intl.ListFormat` يعرف القاعدة لكل لغة من اللغات التسع.
 */
export function formatList(locale: LocaleCode, items: readonly string[]): string {
  if (items.length === 0) return "";
  return new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(items);
}
