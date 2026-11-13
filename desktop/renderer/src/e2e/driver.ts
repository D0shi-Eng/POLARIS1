// سائق DOM صغير لمجموعة E2E الأصلية: انتظار، وضغط، وكتابة في حقل تتحكم به React.
//
// لا يُحمَّل إلا حين يضع المضيفُ علمَ القياس، والمضيف لا يضعه إلا في ثنائي `e2e`.

export function doc(): Document {
  return globalThis.document;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** ينتظر حتى تعيد الدالة قيمة صادقة، أو تنقضي المهلة فيعيد `null`. */
export async function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs = 10_000, stepMs = 100): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

export async function go(path: string): Promise<void> {
  globalThis.location.hash = `#${path}`;
  await sleep(150);
}

export function text(selector: string, root: ParentNode = doc()): string {
  return root.querySelector(selector)?.textContent?.trim() ?? "";
}

/** زرّ بنصّه الظاهر أو باسمه الوصولي، داخل جذر اختياري. */
export function button(label: string, root: ParentNode = doc()): HTMLButtonElement | null {
  const all = [...root.querySelectorAll<HTMLButtonElement>("button")];
  return (
    all.find((candidate) => candidate.getAttribute("aria-label") === label) ??
    all.find((candidate) => (candidate.textContent ?? "").trim() === label) ??
    null
  );
}

export function enabled(element: HTMLButtonElement | null): HTMLButtonElement | null {
  return element !== null && !element.disabled ? element : null;
}

/**
 * يكتب قيمة في حقل تتحكم به React. الإسناد المباشر إلى `value` لا يطلق حدث
 * React؛ الضابط الأصلي من النموذج الأولي ثم حدث `input` أو `change` يفعل.
 */
export function setField(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter !== undefined) setter.call(element, value);
  else element.value = value;
  const kind = element instanceof HTMLSelectElement ? "change" : "input";
  element.dispatchEvent(new Event(kind, { bubbles: true }));
}

export function field<T extends HTMLElement>(id: string): T | null {
  return doc().getElementById(id) as T | null;
}

/** بطاقة مزوّد بمعرّفه كما أعاده المضيف. */
export function providerCard(providerId: string): HTMLElement | null {
  return doc().getElementById(`provider-${providerId}-title`)?.closest("article") ?? null;
}

export function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

/** عنصر إدخال باسمه الوصولي. */
export function labelled<T extends HTMLElement>(selector: string, name: string): T | null {
  return [...doc().querySelectorAll<T>(selector)].find((element) => element.getAttribute("aria-label") === name) ?? null;
}

/** قائمة التبويبات الحالية، حتى لا يُخلط زر تبويب بزر في الشريط الجانبي يحمل النص نفسه. */
export function tablist(): ParentNode {
  return doc().querySelector("[role=tablist]") ?? doc();
}
