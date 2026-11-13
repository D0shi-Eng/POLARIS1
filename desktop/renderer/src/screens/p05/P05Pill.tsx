// وسم حالة لمفردة مغلقة من Phase-05. النصّ المقروء يحمل المعنى، واللون لهجة فقط.

import { useTranslator } from "../../app/context";
import type { Tone } from "../../p02/present";
import { vocabularyKey } from "../../p05/present";

export function P05Pill({ namespace, member, tone }: { readonly namespace: string; readonly member: string; readonly tone: Tone }) {
  const translator = useTranslator();
  return <span className={`pill pill--${tone}`}>{translator.t(vocabularyKey(namespace, member))}</span>;
}
