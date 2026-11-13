// أنواع الترجمة. التسع لغات معمارية، واثنتان مُثبَتتان في هذه المرحلة.

export const LOCALES = ["ar", "en", "de", "fr", "ru", "zh", "ko", "ja", "es"] as const;

/**
 * لغات الواجهة المكتملة. البقية تعرّف 15 مفتاحًا من نحو 1650 (أقل من 1%)، فاختيارها يعرض إنجليزية تقريبًا
 * (قِيس 2026-10-05). لا تُعرض في محدّد لغة الواجهة حتى تكتمل (95% فأكثر). لغة عمل المشروع شيء آخر: النموذج
 * يكتب بها، فتبقى قائمتها كاملة.
 */
export const COMPLETE_UI_LOCALES: readonly string[] = ["ar", "en"];

/** ما يُعرض في محدّد لغة الواجهة: المكتملة، واللغة المختارة الآن إن لم تكن منها (كي لا يفقد المحدّد قيمته). */
export function uiLocaleChoices(current: string): readonly string[] {
  return LOCALES.filter((code) => COMPLETE_UI_LOCALES.includes(code) || code === current);
}

export type LocaleCode = (typeof LOCALES)[number];

/** اللغة التي يتراجع إليها كل شيء. */
export const FALLBACK_LOCALE: LocaleCode = "en";

/** اللغات التي تدّعي Phase-01 إثباتها فعلًا. */
export const PROVEN_LOCALES: readonly LocaleCode[] = ["ar", "en"];

export type Catalog = Readonly<Record<string, string>>;

export type Direction = "rtl" | "ltr";

/** الاتجاه يُشتق من اللغة. لا مفتاح يدوي يقلبه. */
export function directionOf(locale: LocaleCode): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
