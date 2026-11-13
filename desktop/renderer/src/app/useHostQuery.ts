// قراءة من المضيف مع حالاتها الثلاث: تحميل، ونتيجة، وخطأ مصنَّف.
//
// لا تخزين مؤقت ولا نسخة محلية قابلة للتعديل: كل إعادة تحميل تسأل المضيف، لأن
// الحقيقة هناك. الشاشة ترسم ما وصل، أو تقول لماذا لم يصل.

import { useCallback, useEffect, useState } from "react";

import type { CallResult } from "../ipc/call";
import type { DisplayError } from "../ipc/errors";

export interface HostQuery<T> {
  readonly loading: boolean;
  readonly value: T | null;
  readonly error: DisplayError | null;
  reload(): void;
}

export function useHostQuery<T>(load: () => Promise<CallResult<T>>, dependencies: readonly unknown[]): HostQuery<T> {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const result = await load();
      if (cancelled) return;
      if (result.ok) {
        setValue(result.value);
        setError(null);
      } else {
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // الاعتماديات يحددها المستدعي صراحةً؛ دالة التحميل تُبنى في كل رسم.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);
  return { loading, value, error, reload };
}

/** نتيجة فعل: ما زال يعمل، أو انتهى بنجاح، أو بخطأ مصنَّف. */
export type ActionState =
  | { readonly phase: "IDLE" }
  | { readonly phase: "RUNNING" }
  | { readonly phase: "DONE"; readonly messageKey: string; readonly values?: Readonly<Record<string, string | number>> }
  | { readonly phase: "FAILED"; readonly error: DisplayError };

/** نداء لا تُقرأ نتيجته، فقط نجاحه أو خطؤه. */
export type HostCall = () => Promise<CallResult<unknown>>;

export interface ActionRunner {
  readonly state: ActionState;
  set(state: ActionState): void;
  /** ينفّذ نداءً واحدًا ويحوّل نتيجته إلى حالة عرض، ثم يستدعي `after` في الحالتين. */
  run<T>(call: () => Promise<CallResult<T>>, done: (value: T) => ActionState, after?: () => void): Promise<void>;
}

export function useAction(): ActionRunner {
  const [state, setState] = useState<ActionState>({ phase: "IDLE" });
  const run = useCallback(
    async <T,>(call: () => Promise<CallResult<T>>, done: (value: T) => ActionState, after?: () => void): Promise<void> => {
      setState({ phase: "RUNNING" });
      const result = await call();
      setState(result.ok ? done(result.value) : { phase: "FAILED", error: result.error });
      after?.();
    },
    [],
  );
  return { state, set: setState, run };
}
