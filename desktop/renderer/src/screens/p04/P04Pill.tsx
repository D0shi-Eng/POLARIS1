// وسم حالة لمفردة مغلقة من Phase-04.
//
// اللون لهجة، والنصّ مفتاح، والمعنى لا يُحمل باللون وحده: كل وسم يحمل نصّه
// المقروء، فلا يضيع المعنى على من لا يميّز الألوان (البند 91).

import { useTranslator } from "../../app/context";
import type { Tone } from "../../p02/present";
import { effectTone, vocabularyKey } from "../../p04/present";

export function P04Pill({
  namespace,
  member,
  tone,
  hint,
}: {
  readonly namespace: string;
  readonly member: string;
  readonly tone: Tone;
  readonly hint?: string;
}) {
  const translator = useTranslator();
  return (
    <span className={`pill pill--${tone}`} {...(hint === undefined ? {} : { title: translator.t(hint) })}>
      {translator.t(vocabularyKey(namespace, member))}
    </span>
  );
}

/// قائمة آثار أداة. كل أثر باسمه ولهجته، فلا يُخفى أثرٌ خلف كلمة «آمن».
export function EffectList({ effects }: { readonly effects: readonly string[] }) {
  const translator = useTranslator();
  if (effects.length === 0) {
    // قائمة فارغة تعني أن شيئًا لم يقع: محاولة مُنعت قبل أي أثر. تسمية ذلك
    // «حسابًا محليًّا» تنسب أثرًا لم يحدث، فالحالة تُعرض باسمها.
    return <span className="muted">{translator.t("p04.effect.none")}</span>;
  }
  return (
    <span className="p04-effects">
      {effects.map((effect) => (
        <P04Pill key={effect} namespace="effect" member={effect} tone={effectTone(effect)} />
      ))}
    </span>
  );
}
