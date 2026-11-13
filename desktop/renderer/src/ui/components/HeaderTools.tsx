// أدوات الجلسة في قائمة الحساب: المظهر واللغة، صفّين بعنوانين كاملين.
//
// ليستا إعدادين. هذا مُعلَن في الواجهة نفسها بملاحظة نطاق الجلسة، لأن التلميح
// بأن التبديل يُحفَظ هو نفسه نوع الكذب الذي تمنعه هذه المرحلة. الحفظ في الإعدادات ← المظهر/اللغة.
//
// المظهر ثلاثة أزرار أيقونات (فاتح، داكن، النظام) كما في التطبيقات الحديثة، بدل قائمة منسدلة
// كانت تُقصّ إلى «دا». اللغة قائمة منسدلة بعرض صفّها، فاسم اللغة يظهر كاملًا.

import type { Appearance, Locale } from "../../generated/types/desktop-result-v1";
import { useTranslator } from "../../app/context";
import { uiLocaleChoices } from "../../localization/types";
import { Icon, type IconName } from "./Icon";

const APPEARANCES: readonly { readonly value: Appearance; readonly icon: IconName }[] = [
  { value: "LIGHT", icon: "sun" },
  { value: "DARK", icon: "moon" },
  { value: "SYSTEM", icon: "monitor" },
];

export interface HeaderToolsProps {
  readonly locale: Locale;
  readonly appearance: Appearance;
  onLocaleChange(locale: Locale): void;
  onAppearanceChange(appearance: Appearance): void;
}

export function HeaderTools({ locale, appearance, onLocaleChange, onAppearanceChange }: HeaderToolsProps) {
  const translator = useTranslator();
  return (
    <div className="header-tools">
      <p className="field sr-only" id="session-scope-note">
        {translator.t("session.scope_note")}
      </p>
      <div className="header-tools__row" title={translator.t("session.scope_note")}>
        <span className="header-tools__label" id="session-appearance-label">
          <Icon name={appearance === "DARK" ? "moon" : "sun"} size={16} />
          {translator.t("session.appearance")}
        </span>
        <div className="segmented" role="radiogroup" id="session-appearance" aria-labelledby="session-appearance-label" aria-describedby="session-scope-note">
          {APPEARANCES.map(({ value, icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              className="segmented__item"
              data-appearance={value}
              aria-checked={appearance === value}
              aria-label={translator.t(`appearance.${value}`)}
              title={translator.t(`appearance.${value}`)}
              onClick={(event) => {
                // اختيار المظهر لا يغلق القائمة: يرى المستخدم الأثر ويقارن.
                event.stopPropagation();
                onAppearanceChange(value);
              }}
            >
              <Icon name={icon} size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="header-tools__row" title={translator.t("session.scope_note")}>
        <label className="header-tools__label" htmlFor="session-locale">
          <Icon name="globe" size={16} />
          {translator.t("session.language")}
        </label>
        <select
          id="session-locale"
          className="select header-tools__select"
          value={locale}
          aria-describedby="session-scope-note"
          onChange={(event) => onLocaleChange(event.target.value as Locale)}
        >
          {uiLocaleChoices(locale).map((code) => (
            <option key={code} value={code}>
              {translator.t(`locale.name.${code}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
