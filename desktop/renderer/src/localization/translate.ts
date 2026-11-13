// المترجم.
//
// ثلاث قواعد تفسّر كل ما تحت: لا نصّ مُوطَّن داخل مكوّن، ولا جملة تُركَّب بالضمّ،
// ولا مفتاح مفقود يُكتشف عند المستخدم. الثالثة هي سبب وجود `MissingKeyRecorder`:
// الغياب يُجمَع ويُفحص في الاختبار بدل أن يظهر كنصّ غريب على الشاشة.

import { CATALOGS } from "./catalog/index";
import { FALLBACK_LOCALE, type Catalog, type LocaleCode } from "./types";

export type Interpolations = Readonly<Record<string, string | number>>;

export interface Translator {
  readonly locale: LocaleCode;
  /** نصّ مفتاحٍ واحد. الغياب يُسجَّل ويُعاد المفتاح نفسه بدل نصّ مخترع. */
  t(key: string, values?: Interpolations): string;
  /** صيغة العدد الصحيحة حسب قواعد الجمع في اللغة، لا بضمّ «(s)». */
  plural(key: string, count: number, values?: Interpolations): string;
  /** هل يعرف هذا المترجم المفتاح، في لغته أو في لغة التراجع؟ */
  has(key: string): boolean;
}

/** يجمع المفاتيح المفقودة أثناء التشغيل. الاختبار يقرؤه، والمنتج لا يعرضه. */
export class MissingKeyRecorder {
  private readonly keys = new Set<string>();

  record(locale: LocaleCode, key: string): void {
    this.keys.add(`${locale}:${key}`);
  }

  list(): readonly string[] {
    return [...this.keys].sort();
  }

  get size(): number {
    return this.keys.size;
  }
}

export const missingKeys = new MissingKeyRecorder();

function interpolate(template: string, values: Interpolations | undefined): string {
  if (values === undefined) return template;
  return template.replace(/\{([a-z0-9_]+)\}/gi, (match, name: string) => {
    const replacement = values[name];
    return replacement === undefined ? match : String(replacement);
  });
}

function lookup(locale: LocaleCode, key: string, fallback: LocaleCode = FALLBACK_LOCALE): string | undefined {
  const primary: Catalog | undefined = CATALOGS[locale];
  const direct = primary?.[key];
  if (direct !== undefined) return direct;
  // لغة التراجع يختارها المستخدم (Phase-06)؛ والإنجليزية الكاملة هي السند الأخير دائمًا.
  if (fallback !== locale) {
    const chosen = CATALOGS[fallback]?.[key];
    if (chosen !== undefined) return chosen;
  }
  if (locale === FALLBACK_LOCALE || fallback === FALLBACK_LOCALE) return undefined;
  return CATALOGS[FALLBACK_LOCALE]?.[key];
}

export function createTranslator(
  locale: LocaleCode,
  recorder: MissingKeyRecorder = missingKeys,
  fallback: LocaleCode = FALLBACK_LOCALE,
): Translator {
  return {
    locale,
    t(key, values) {
      const template = lookup(locale, key, fallback);
      if (template === undefined) {
        recorder.record(locale, key);
        // المفتاح نفسه هو الجواب الصادق: نصّ مخترع يبدو سليمًا ويخفي العيب.
        return key;
      }
      return interpolate(template, values);
    },
    plural(key, count, values) {
      const category = new Intl.PluralRules(locale).select(count);
      const candidates = [`${key}.${category}`, `${key}.other`];
      for (const candidate of candidates) {
        const template = lookup(locale, candidate, fallback);
        if (template !== undefined) return interpolate(template, { count, ...(values ?? {}) });
      }
      recorder.record(locale, `${key}.${category}`);
      return `${key}.${category}`;
    },
    has(key) {
      return lookup(locale, key, fallback) !== undefined;
    },
  };
}

/** كل المفاتيح المُعلَنة في لغة. يُستعمل في اختبار تكافؤ المفاتيح. */
export function keysOf(locale: LocaleCode): readonly string[] {
  return Object.keys(CATALOGS[locale] ?? {}).sort();
}
