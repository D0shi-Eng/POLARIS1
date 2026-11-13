// تهيئة DOM للاختبارات غير الأصلية.
//
// jsdom يثبت ما يمكن إثباته بلا نافذة: البنية الدلالية، والتسميات، والاتجاه،
// والحالات. وما لا يُثبَت هنا — WebView2 الحقيقي، وتحجيم Windows، والإقلاع البارد —
// يبقى في المسار الأصلي ولا يُدَّعى هنا.
//
// يجب أن يُستورَد هذا الملف أولًا في أي اختبار يرسم: تهيئة العوالم تسبق تحميل React.

import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const globals = globalThis as unknown as Record<string, unknown>;
globals["window"] = dom.window;
globals["document"] = dom.window.document;
// `navigator` عالميّ للقراءة فقط في Node، فيُعرَّف لا يُسنَد.
Object.defineProperty(globals, "navigator", { value: dom.window.navigator, configurable: true });
globals["HTMLElement"] = dom.window.HTMLElement;
globals["HTMLButtonElement"] = dom.window.HTMLButtonElement;
globals["HTMLSelectElement"] = dom.window.HTMLSelectElement;
globals["HTMLInputElement"] = dom.window.HTMLInputElement;
globals["HTMLTextAreaElement"] = dom.window.HTMLTextAreaElement;
globals["Event"] = dom.window.Event;
globals["MouseEvent"] = dom.window.MouseEvent;
globals["Node"] = dom.window.Node;
globals["getComputedStyle"] = dom.window.getComputedStyle;
// React 18 يطلب هذا العلم صراحةً قبل استعمال act.
globals["IS_REACT_ACT_ENVIRONMENT"] = true;

/**
 * `matchMedia` غير موجود في jsdom. الدالة هنا تعيد جوابًا قابلًا للضبط حتى يكون
 * اختبار السمة «اتبع النظام» قياسًا لا تخمينًا.
 */
let prefersDark = false;

export function setSystemPrefersDark(value: boolean): void {
  prefersDark = value;
}

globals["matchMedia"] = (query: string) => ({
  matches: query.includes("dark") ? prefersDark : false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});
(dom.window as unknown as Record<string, unknown>)["matchMedia"] = globals["matchMedia"];

export { dom };

/** يعيد المستند إلى حالة نظيفة بين الاختبارات. */
export function resetDocument(): HTMLElement {
  dom.window.document.documentElement.removeAttribute("dir");
  dom.window.document.documentElement.removeAttribute("lang");
  dom.window.document.documentElement.removeAttribute("data-theme");
  dom.window.document.body.innerHTML = '<div id="root"></div>';
  return dom.window.document.getElementById("root") as unknown as HTMLElement;
}
