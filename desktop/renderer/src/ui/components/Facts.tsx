// قائمة حقائق. `dl` لأنها أزواج مصطلح ووصف فعلًا، لا شبكة من `div`.
//
// كل قيمة معزولة ثنائية الاتجاه: رقم إصدار داخل جملة عربية يُعاد ترتيبه بلا عزل.

import { isolate } from "../../localization/format";
import { useTranslator } from "../../app/context";

export interface Fact {
  readonly labelKey: string;
  readonly value: string;
  /** حين تكون القيمة رمزًا مُعلَنًا في العقد، يُترجَم بمفتاحه بدل عرض الرمز خامًا. */
  readonly valueKey?: string;
}

export function Facts({ facts }: { readonly facts: readonly Fact[] }) {
  const translator = useTranslator();
  return (
    <dl className="facts">
      {facts.map((fact) => (
        <div key={fact.labelKey}>
          <dt className="fact__label">{translator.t(fact.labelKey)}</dt>
          <dd className="fact__value">
            {fact.valueKey === undefined ? isolate(fact.value) : translator.t(fact.valueKey)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
