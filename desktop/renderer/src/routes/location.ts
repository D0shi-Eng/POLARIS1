// الموضع الحالي، مقروءًا من جزء العنوان.
//
// لماذا `#/...` لا حالة داخلية فقط: التنقّل يصير حقيقيًا — رجوع المتصفح يعمل،
// والوجهة قابلة للتعبير من خارج الشجرة، فيستطيع اختبار E2E أن يطلب مسارًا غير
// معروف ويرى الفشل الآمن بدل أن يحتاج بابًا خلفيًا في المنتج.

import { normalisePath } from "./registry";

export interface LocationPort {
  read(): string;
  write(path: string): void;
  subscribe(listener: () => void): () => void;
}

interface HashHost {
  location?: { hash?: string };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** الموضع الحقيقي فوق `location.hash`. */
export function hashLocation(host: HashHost = globalThis as HashHost): LocationPort {
  return {
    read() {
      const hash = host.location?.hash ?? "";
      return normalisePath(hash.startsWith("#") ? hash.slice(1) : hash);
    },
    write(path: string) {
      if (host.location === undefined) return;
      host.location.hash = `#${normalisePath(path)}`;
    },
    subscribe(listener) {
      if (typeof host.addEventListener !== "function") return () => undefined;
      host.addEventListener("hashchange", listener);
      return () => host.removeEventListener?.("hashchange", listener);
    },
  };
}

/** موضع في الذاكرة. يُستعمل في الاختبارات التي لا تريد عنوانًا مشتركًا. */
export function memoryLocation(initial = "/"): LocationPort {
  let current = normalisePath(initial);
  const listeners = new Set<() => void>();
  return {
    read: () => current,
    write(path: string) {
      const next = normalisePath(path);
      if (next === current) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
