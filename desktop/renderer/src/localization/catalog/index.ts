// فهرس اللغات التسع. إضافة لغة عاشرة تغييرُ مورد لا تغييرُ عقد: ملف، وسطر هنا،
// وعضو في تعداد `Locale` داخل المخطط — ولا شيء في الشاشات.

import { AR } from "./ar";
import { DE } from "./de";
import { EN } from "./en";
import { ES } from "./es";
import { FR } from "./fr";
import { JA } from "./ja";
import { KO } from "./ko";
import { RU } from "./ru";
import { ZH } from "./zh";
import type { Catalog, LocaleCode } from "../types";

export const CATALOGS: Readonly<Record<LocaleCode, Catalog>> = {
  ar: AR,
  en: EN,
  de: DE,
  fr: FR,
  ru: RU,
  zh: ZH,
  ko: KO,
  ja: JA,
  es: ES,
};
