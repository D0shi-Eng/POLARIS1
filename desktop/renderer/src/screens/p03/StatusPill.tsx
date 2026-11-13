// وسم حالة لمفردة مغلقة من Phase-03.
//
// اللون لهجة، والنصّ مفتاح، والمعنى لا يُحمل باللون وحده: كل وسم يحمل نصّه
// المقروء، فلا يضيع المعنى على من لا يميّز الألوان (البند 91).

import { useTranslator } from "../../app/context";
import type { Tone } from "../../p02/present";
import { vocabularyKey } from "../../p03/present";

export function StatusPill({
  namespace,
  member,
  tone,
  hint,
}: {
  readonly namespace: string;
  readonly member: string;
  readonly tone: Tone;
  /** مفتاح شرح يظهر كعنوان مساعد، لا كنصّ بديل عن الوسم. */
  readonly hint?: string;
}) {
  const translator = useTranslator();
  const label = translator.t(vocabularyKey(namespace, member));
  return (
    <span className={`pill pill--${tone}`} {...(hint === undefined ? {} : { title: translator.t(hint) })}>
      {label}
    </span>
  );
}

/// الحالة والإثبات جنبًا إلى جنب. لا يُعرض أحدهما وحده في قائمة أو ترويسة:
/// «اكتملت» دون «غير مُثبَت» تُقرأ نجاحًا، وهي ليست كذلك.
export function StateAndProof({
  state,
  proof,
  stateTone,
  proofToneValue,
}: {
  readonly state: string;
  readonly proof: string;
  readonly stateTone: Tone;
  readonly proofToneValue: Tone;
}) {
  return (
    <span className="p03-state-pair">
      <StatusPill namespace="mission_state" member={state} tone={stateTone} />
      <StatusPill namespace="proof" member={proof} tone={proofToneValue} hint={`p03.proof.hint.${proof}`} />
    </span>
  );
}
