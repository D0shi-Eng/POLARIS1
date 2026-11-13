// تفضيلات العرض، محدودة بالجلسة.
//
// ليست إعدادات. الفرق جوهري ومعلن في الواجهة: مجموعة عمليات هذه المرحلة كلها
// للقراءة، فلا يستطيع أحد حفظ تفضيل في المضيف. ما يستطيعه العارض هو تغيير عرضه
// الآن، وهو تغيير حقيقي يراه المستخدم فورًا ولا يدّعي أكثر مما يفعل.
//
// القيم الابتدائية تأتي من لقطة الإقلاع، لا من تخمين ولا من تخزين محلي.

import type { Appearance, Locale } from "../generated/types/desktop-result-v1";
import { Store } from "../state/store";

export interface ViewPreferences {
  readonly locale: Locale;
  readonly appearance: Appearance;
}

export type EffectiveTheme = "light" | "dark";

export function createPreferences(initial: ViewPreferences): Store<ViewPreferences> {
  return new Store<ViewPreferences>(initial);
}

/**
 * يحلّ `SYSTEM` إلى سمة فعلية.
 *
 * السؤال يُطرح على المتصفح لا على المضيف: المضيف يقول «اتبع النظام» مرة واحدة عند
 * الإقلاع، والاستعلام هنا يتابع تغيّر النظام أثناء التشغيل.
 */
export function resolveTheme(appearance: Appearance, prefersDark: boolean): EffectiveTheme {
  if (appearance === "LIGHT") return "light";
  if (appearance === "DARK") return "dark";
  return prefersDark ? "dark" : "light";
}

/** هل يفضّل النظام الداكن الآن؟ بيئة بلا `matchMedia` تُجيب «لا» بدل أن تنهار. */
export function systemPrefersDark(): boolean {
  const media = (globalThis as { matchMedia?: (query: string) => { matches: boolean } }).matchMedia;
  if (typeof media !== "function") return false;
  try {
    return media("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * اشتراك في تفضيل النظام.
 *
 * بلا اشتراك يبقى `SYSTEM` مجمّدًا عند لحظة أول رسم، فيصير «اتبع النظام» اسمًا
 * لا سلوكًا. الاشتراك يجعله يتابع فعلًا.
 */
export function subscribeToSystemTheme(listener: () => void): () => void {
  const media = (globalThis as {
    matchMedia?: (query: string) => {
      matches: boolean;
      addEventListener?: (type: string, handler: () => void) => void;
      removeEventListener?: (type: string, handler: () => void) => void;
    };
  }).matchMedia;
  if (typeof media !== "function") return () => undefined;
  try {
    const query = media("(prefers-color-scheme: dark)");
    if (typeof query.addEventListener !== "function") return () => undefined;
    query.addEventListener("change", listener);
    return () => query.removeEventListener?.("change", listener);
  } catch {
    return () => undefined;
  }
}
