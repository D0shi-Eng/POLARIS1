// قشرة الإعدادات.
//
// كل إعداد يعلن وضعه: قابل للتعديل، أو للقراءة فقط، أو ليس في هذه المرحلة. ولأن
// عمليات هذه المرحلة كلها للقراءة، لا يوجد إعداد واحد قابل للتعديل — وهذا مكتوب
// في أعلى الصفحة بدل أن يُكتشف بالضغط على مفتاح لا يفعل شيئًا.

import { useTranslator } from "../app/context";
import type { DisplayError } from "../ipc/errors";
import type {
  ResolvedSetting,
  SettingDescriptor,
  SettingSectionDescriptor,
} from "../generated/types/desktop-result-v1";
import { formatNumber } from "../localization/format";
import type { LocaleCode } from "../localization/types";
import { groupSections } from "../settings/groups";
import { ModePill } from "../ui/components/Pill";
import { StateBlock } from "../ui/components/StateBlock";

export interface SettingsScreenProps {
  readonly sections: readonly SettingSectionDescriptor[];
  readonly selectedSectionId: string;
  readonly values: readonly ResolvedSetting[] | null;
  readonly loading: boolean;
  readonly error: DisplayError | null;
  onSelectSection(sectionId: string): void;
  onRetry(): void;
}

function valueText(
  locale: LocaleCode,
  translate: (key: string) => string,
  setting: ResolvedSetting | undefined,
): string {
  if (setting === undefined) return translate("settings.value.absent");
  if (setting.value_withheld === true) return translate("settings.value.withheld");
  const value = setting.value;
  if (value === undefined) return translate("settings.value.absent");
  if (value.boolean_value !== undefined) {
    return translate(value.boolean_value ? "settings.value.true" : "settings.value.false");
  }
  if (value.integer_value !== undefined) return formatNumber(locale, value.integer_value);
  if (value.code_value !== undefined) return value.code_value;
  if (value.text_value !== undefined) return value.text_value;
  return translate("settings.value.absent");
}

export function SettingsScreen(props: SettingsScreenProps) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const groups = groupSections(props.sections);
  const selected = props.sections.find((section) => section.section_id === props.selectedSectionId);

  return (
    <>
      <h1 className="page-title">{translator.t("settings.title")}</h1>
      <p className="page-subtitle">{translator.t("settings.subtitle")}</p>
      <p className="note">{translator.t("settings.note.read_only_phase")}</p>

      <div className="settings">
        <nav className="settings__index" aria-label={translator.t("settings.landmark")}>
          {groups.map((group) => (
            <div className="settings__group" key={group.id}>
              <h2 className="settings__group-title">{translator.t(group.labelKey)}</h2>
              <ul className="nav__list">
                {group.sections.map((section) => (
                  <li key={section.section_id}>
                    <button
                      type="button"
                      className="nav__item"
                      onClick={() => props.onSelectSection(section.section_id)}
                      {...(section.section_id === props.selectedSectionId
                        ? { "aria-current": "true" as const }
                        : {})}
                    >
                      <span>{translator.t(section.label_key)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section aria-live="polite">
          {selected === undefined ? (
            <StateBlock kind="empty" />
          ) : (
            <SettingsSection
              section={selected}
              values={props.values}
              loading={props.loading}
              error={props.error}
              onRetry={props.onRetry}
              displayValue={(setting) =>
                valueText(
                  locale,
                  (key) => translator.t(key),
                  props.values?.find((value) => value.setting_id === setting.setting_id),
                )
              }
            />
          )}
        </section>
      </div>
    </>
  );
}

function SettingsSection({
  section,
  values,
  loading,
  error,
  onRetry,
  displayValue,
}: {
  readonly section: SettingSectionDescriptor;
  readonly values: readonly ResolvedSetting[] | null;
  readonly loading: boolean;
  readonly error: DisplayError | null;
  onRetry(): void;
  // لا يُسمّى `valueOf`: خاصية JSX باسم عضو من `Object.prototype` ترمي تحت
  // `freezePrototype` في WebView وتُسقط الشجرة كلها.
  displayValue(setting: SettingDescriptor): string;
}) {
  const translator = useTranslator();
  return (
    <>
      <div className="section">
        <h2 className="section__title">{translator.t(section.label_key)}</h2>
        <ModePill mode={section.mode} />
      </div>

      {error !== null ? (
        <StateBlock
          kind="error"
          titleKey="state.error"
          bodyKey={error.displayKey}
          code={error.code}
          {...(error.retryable ? { action: { labelKey: "state.retry", onSelect: onRetry } } : {})}
        />
      ) : loading ? (
        <StateBlock kind="loading" />
      ) : section.settings.length === 0 ? (
        <StateBlock kind="empty" titleKey="settings.empty_section" />
      ) : (
        <div className="card">
          <ul className="rows">
            {section.settings.map((setting) => (
              <li className="row" key={setting.setting_id}>
                <span className="row__label">
                  {translator.t(setting.label_key)}
                  <span className="row__hint">
                    {setting.availability_reason === undefined
                      ? null
                      : translator.t(`availability.reason.${setting.availability_reason}`)}
                  </span>
                </span>
                <span className="row__value">
                  {values === null ? translator.t("settings.value.absent") : displayValue(setting)}{" "}
                  <ModePill mode={setting.mode} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
