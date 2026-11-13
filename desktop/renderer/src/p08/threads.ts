// حالة المحادثات في العارض: ما قرّره المستخدم من قائمة «⋯» كما أعاده المضيف، وإشعار بالتغيير.
//
// الشريط الجانبي وصفحة المشروع وترويسة المهمة تعرض القائمة نفسها؛ أيّها غيّر محادثة يُشعر الباقين فيعيدون
// القراءة من المضيف. لا نسخة محلية تُعدَّل قبل جواب المضيف.

import { useCallback, useEffect, useState } from "react";

import type { ConversationThreadV1 } from "../generated/types/desktop-p08-result-v1";
import type { DisplayError } from "../ipc/errors";
import type { Phase08Client } from "../ipc/p08-client";

export type ThreadState = ConversationThreadV1;

/** قناة إشعار داخل الوحدة: لا تعتمد على أحداث نافذة (غير موجودة خارج المتصفّح). */
export function changeChannel(): { notify(): void; use(onChange: () => void): void } {
  const listeners = new Set<() => void>();
  return {
    notify() {
      for (const listener of [...listeners]) listener();
    },
    use(onChange) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      }, [onChange]);
    },
  };
}

const threadsChannel = changeChannel();

export function notifyThreadsChanged(): void {
  threadsChannel.notify();
}

export function useThreadsChanged(onChange: () => void): void {
  threadsChannel.use(onChange);
}

/** نصّ فشل نداء من قائمة «⋯»: التعارض (دورٌ يعمل) بجملة واضحة، وغيره بمفتاح المضيف ورمزه. */
export function errorText(translator: { t(key: string, values?: Record<string, string | number>): string }, error: DisplayError): string {
  if (error.code === "CONFLICT") return translator.t("ui.thread.delete_running");
  return translator.t("ui.thread.failed", { detail: `${translator.t(error.displayKey)} (${error.code})` });
}

/** المحادثة بلا صفّ عند المضيف: غير مثبّتة ولا مفضّلة ولا مؤرشفة. */
export function stateOf(states: readonly ThreadState[], threadId: string, title: string, projectId: string | undefined): ThreadState {
  const found = states.find((s) => s.thread_id === threadId);
  if (found !== undefined) return { ...found, title, ...(projectId === undefined ? {} : { project_id: projectId }) };
  return { thread_id: threadId, title, pinned: false, favorite: false, archived: false, ...(projectId === undefined ? {} : { project_id: projectId }) };
}

/** حالات المحادثات من المضيف، تُعاد قراءتها عند كل تغيير من قائمة «⋯». */
export function useThreadStates(phase08: Phase08Client | undefined): readonly ThreadState[] {
  const [states, setStates] = useState<readonly ThreadState[]>([]);
  const [tick, setTick] = useState(0);
  useThreadsChanged(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    if (phase08 === undefined) return;
    let alive = true;
    void phase08.conversationIndex().then((result) => {
      if (alive && result.ok) setStates(result.value.threads ?? []);
    });
    return () => {
      alive = false;
    };
  }, [phase08, tick]);
  return states;
}
