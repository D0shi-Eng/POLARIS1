// مخزن صغير جدًّا، ومحلّي بحكم التعريف.
//
// لا مخزن عام يجمع كل شيء. هذا الملف يعطي اشتراكًا بسيطًا يستعمله شأنان محليان
// فقط: التنقّل وتفضيلات العرض. قيم الإعدادات وحالة القدرات لا تمرّ من هنا أبدًا،
// لأن مصدر حقيقتها المضيف، ونسخها إلى حالة قابلة للتعديل هو أول خطوة نحو
// واجهة تخترع أجوبتها.

export type Listener = () => void;

export class Store<T> {
  private value: T;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): T => this.value;
}
