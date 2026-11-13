// السياق المشترك: المترجم والتنقّل.
//
// المكوّنات لا تستورد مترجمًا عالميًا: تأخذه من السياق، فيبقى الاختبار قادرًا على
// تركيب لغة بعينها دون حالة عامة تتسرّب بين الاختبارات.

import { createContext, useContext, type ReactNode } from "react";

import type { Translator } from "../localization/translate";
import type { RouteDefinition } from "../routes/registry";

export interface Navigation {
  readonly current: RouteDefinition | undefined;
  readonly requestedPath: string;
  navigate(path: string): void;
}

const TranslatorContext = createContext<Translator | null>(null);
const NavigationContext = createContext<Navigation | null>(null);

export function TranslatorProvider({
  translator,
  children,
}: {
  readonly translator: Translator;
  readonly children: ReactNode;
}) {
  return <TranslatorContext.Provider value={translator}>{children}</TranslatorContext.Provider>;
}

export function NavigationProvider({
  navigation,
  children,
}: {
  readonly navigation: Navigation;
  readonly children: ReactNode;
}) {
  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>;
}

/** المترجم. غيابه عيب تركيب لا حالة تشغيل، فيُرمى بوضوح بدل الرسم بلا نصوص. */
export function useTranslator(): Translator {
  const translator = useContext(TranslatorContext);
  if (translator === null) throw new Error("a translator must be provided above this component");
  return translator;
}

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (navigation === null) throw new Error("navigation must be provided above this component");
  return navigation;
}
