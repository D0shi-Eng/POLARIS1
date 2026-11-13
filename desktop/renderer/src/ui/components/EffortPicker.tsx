// مربع جهد الاستدلال بجانب محدّد النموذج (طلب المالك 2026-11-12): افتراضي، منخفض، متوسط، عالٍ، أقصى.
// تفضيل واحد يحفظه المضيف ويطبّقه على كل المزوّدين والنماذج عند كل نداء؛ «افتراضي» يعيد كل مزوّد إلى سلوكه.
// المزوّد الذي لا يعرف «أقصى» (الواجهة المتوافقة مع OpenAI) يصله «عالٍ»، ولا يُرسل الجهد إلى نموذج لا يعلن الاستدلال.

import { useTranslator } from "../../app/context";
import type { Phase02Client } from "../../ipc/p02-client";
import { Icon } from "./Icon";
import { MenuItem, Popover } from "./Popover";

export type EffortLevel = "LOW" | "MEDIUM" | "HIGH" | "MAX";

const LEVELS: readonly EffortLevel[] = ["LOW", "MEDIUM", "HIGH", "MAX"];

export interface EffortPickerProps {
  readonly phase02: Phase02Client | undefined;
  /** القيمة المحفوظة عند المضيف؛ غيابها = افتراضي. */
  readonly effort: EffortLevel | undefined;
}

export function EffortPicker({ phase02, effort }: EffortPickerProps) {
  const translator = useTranslator();
  // الحفظ عند المضيف يُطلق «تغيّرت النماذج»، فيعيد المحدّد قراءة التفضيلات ويعرض القيمة الجديدة.
  const choose = (level: EffortLevel | null) => {
    if (phase02 !== undefined) void phase02.setModelPreferences({ reasoning_effort: level });
  };
  const name = (level: EffortLevel | undefined) => translator.t(level === undefined ? "ui.effort.default" : `ui.effort.${level.toLowerCase()}`);
  return (
    <Popover
      label={translator.t("ui.effort.label")}
      className="model-picker__popover effort-picker__popover"
      triggerClassName="model-picker__button effort-picker__button"
      disabled={phase02 === undefined}
      trigger={
        <>
          <Icon name="chevron" size={14} className="model-picker__chevron" />
          <span className="model-picker__name">{name(effort)}</span>
        </>
      }
    >
      <div className="model-menu">
        <MenuItem label={name(undefined)} detail={translator.t("ui.effort.default_detail")} trailing={effort === undefined ? <Icon name="check" size={15} /> : undefined} onSelect={() => choose(null)} />
        {LEVELS.map((level) => (
          <MenuItem key={level} label={name(level)} trailing={effort === level ? <Icon name="check" size={15} /> : undefined} onSelect={() => choose(level)} />
        ))}
      </div>
    </Popover>
  );
}
