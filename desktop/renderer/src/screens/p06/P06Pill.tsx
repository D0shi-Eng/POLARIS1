// وسم حالة لمفردة مغلقة من Phase-06. النصّ المقروء يحمل المعنى، واللون لهجة فقط.

import { useTranslator } from "../../app/context";
import type { Tone } from "../../p02/present";
import { vocabularyKey } from "../../p06/present";

export function P06Pill({ namespace, member, tone }: { readonly namespace: string; readonly member: string; readonly tone: Tone }) {
  const translator = useTranslator();
  return <span className={`pill pill--${tone}`}>{translator.t(vocabularyKey(namespace, member))}</span>;
}

/** علامة المصدر لكل مبلغ أو عدد: مُبلَّغ، أو مقيس محليًّا، أو مُقدَّر، أو مجهول. */
export function ProvenancePill({ provenance }: { readonly provenance: string }) {
  const tone: Tone = provenance === "ESTIMATED" ? "WARNING" : provenance === "UNKNOWN" ? "MUTED" : "NEUTRAL";
  return <P06Pill namespace="provenance" member={provenance} tone={tone} />;
}
