// وسم حالة. اللون يأتي من اللهجة، واللهجة تأتي من حالة الإتاحة، والنصّ من مفتاح.
//
// `role="status"` مقصود: قارئ الشاشة يعلن الحالة حين تتغيّر بدل أن يمرّ عليها
// كنصّ عابر.

import type { AvailabilityPresentation } from "../../app/availability";
import { explain } from "../../app/availability";
import { useTranslator } from "../../app/context";

export function AvailabilityPill({
  presentation,
  labelledBy,
}: {
  readonly presentation: AvailabilityPresentation;
  readonly labelledBy?: string;
}) {
  const translator = useTranslator();
  return (
    <span
      className={`pill pill--${presentation.tone}`}
      role="status"
      {...(labelledBy === undefined ? {} : { "aria-describedby": labelledBy })}
    >
      {explain(translator, presentation)}
    </span>
  );
}

export function ModePill({ mode }: { readonly mode: string }) {
  const translator = useTranslator();
  const tone = mode === "ACTIVE" ? "POSITIVE" : mode === "READ_ONLY" ? "NEUTRAL" : "MUTED";
  return (
    <span className={`pill pill--${tone}`}>{translator.t(`settings.mode.${mode}`)}</span>
  );
}
