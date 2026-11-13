// وجهة موجودة وغير مبنيّة.
//
// هذه هي الشاشة التي تمنع الشاشات الوهمية. لا هيكل تحميل، ولا بيانات نموذجية،
// ولا زر يبدو قابلًا للضغط: حالة معلنة، وسبب مصنَّف، وانتهى.

import { present } from "../app/availability";
import { useTranslator } from "../app/context";
import type { Availability } from "../generated/types/desktop-result-v1";
import type { RouteDefinition } from "../routes/registry";
import { AvailabilityPill } from "../ui/components/Pill";
import { StateBlock } from "../ui/components/StateBlock";

export function UnavailableScreen({
  route,
  availability,
}: {
  readonly route: RouteDefinition;
  readonly availability: Availability | undefined;
}) {
  const translator = useTranslator();
  const presentation = present(availability);
  return (
    <>
      <h1 className="page-title">{translator.t(route.labelKey)}</h1>
      <p className="page-subtitle">{translator.t("unavailable.body")}</p>
      <StateBlock kind="unavailable" titleKey={presentation.stateKey}>
        <AvailabilityPill presentation={presentation} />
      </StateBlock>
    </>
  );
}
