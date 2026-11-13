// المرحلة الثانية من «بناء» و«إنشاء» كما في مانوس 2.0 (قِيس 2026-10-06): اختيار نوع يفتح لوحة «أنشئ …» فوق المُنشئ
// فيها قوالب (لبعض الأنواع) و«استكشف الأفكار» (ثلاث بطاقات يبدّلها زرّ التحديث)، ويظهر في المُنشئ شريحة النوع.
//
// القالب والأفكار نصّ يُضاف إلى الطلب نفسه؛ لا قالب هنا يعني ملفًّا جاهزًا مخبّأً. الوكيل يبني من الوصف.

import type { IconName } from "../../ui/components/Icon";

export interface HomeKind {
  readonly id: string;
  readonly icon: IconName;
  /** القوالب: مفاتيحها `ui.kind.<id>.tpl.<t>` ووصفها للوكيل `…tpl.<t>.brief`. */
  readonly templates: readonly string[];
  /** عدد الأفكار العامة لهذا النوع: `ui.kind.<id>.idea.<n>` من 1. */
  readonly ideas: number;
  /** أفكار خاصة بقالب: `ui.kind.<id>.tpl.<t>.idea.<n>` من 1 إلى 3. */
  readonly templateIdeas?: boolean;
  /** شريحة عدد الشرائح في المُنشئ (العروض وحدها، كما في مانوس). */
  readonly slideCount?: boolean;
}

export const KINDS: Readonly<Record<string, HomeKind>> = {
  website: { id: "website", icon: "web", templates: ["ecommerce", "landing", "dashboard", "company", "portfolio", "blog", "restaurant", "event"], ideas: 6, templateIdeas: true },
  chatbot: { id: "chatbot", icon: "chat", templates: [], ideas: 6 },
  desktop: { id: "desktop", icon: "monitor", templates: [], ideas: 6 },
  dashboard: { id: "dashboard", icon: "data", templates: [], ideas: 6 },
  webapp: { id: "webapp", icon: "web", templates: [], ideas: 6 },
  extension: { id: "extension", icon: "globe", templates: [], ideas: 6 },
  game: { id: "game", icon: "sparkle", templates: [], ideas: 6 },
  script: { id: "script", icon: "code", templates: [], ideas: 6 },
  notebook: { id: "notebook", icon: "report", templates: [], ideas: 6 },
  slides: { id: "slides", icon: "slides", templates: ["royal", "pulse", "gazette", "meadow", "slate", "sunrise", "ocean", "mono"], ideas: 6, slideCount: true },
  document: { id: "document", icon: "report", templates: [], ideas: 6 },
  sheet: { id: "sheet", icon: "data", templates: [], ideas: 6 },
  analysis: { id: "analysis", icon: "data", templates: [], ideas: 6 },
  pdf: { id: "pdf", icon: "file", templates: [], ideas: 6 },
  research: { id: "research", icon: "research", templates: [], ideas: 6 },
};

/** أعداد الشرائح كما في مانوس («8–12» افتراضيًّا). */
export const SLIDE_COUNTS: readonly string[] = ["4-7", "8-12", "13-20"];

/** عدد القوالب الظاهرة في الصفّ الواحد قبل سهمي التمرير. */
export const TEMPLATES_PER_PAGE = 4;
