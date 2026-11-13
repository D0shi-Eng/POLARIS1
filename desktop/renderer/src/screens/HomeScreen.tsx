// الصفحة الرئيسية.
//
// كل رقم هنا حقيقة وصلت من المضيف. لا وفر رموز، ولا وكلاء يعملون، ولا مهام، ولا
// درجة إنتاجية، ولا درجة أمان. حين لا يوجد شيء يُقال، تقول الشاشة ذلك.

import { present } from "../app/availability";
import { useNavigation, useTranslator } from "../app/context";
import type { BootstrapSnapshot, CapabilityAvailability } from "../generated/types/desktop-result-v1";
import { formatNumber } from "../localization/format";
import type { LocaleCode } from "../localization/types";
import { Facts } from "../ui/components/Facts";
import { AvailabilityPill } from "../ui/components/Pill";

export interface HomeScreenProps {
  readonly snapshot: BootstrapSnapshot;
  /**
   * عدد النماذج المضبوطة كما قرأه المضيف، أو `null` إن تعذّرت القراءة.
   * لا قيمة افتراضية: صفرٌ مخترع لا يختلف عن أي رقم آخر مخترع.
   */
  readonly configuredModelCount: number | null;
  /** وجهة «إدارة النماذج»: صفحة النماذج حين تكون متاحة، وإلا الإعدادات. */
  readonly managePath?: string;
  /** مساحة العمل (Phase-08): المُنشئ والمهامّ والمخرجات الحديثة. غيابها يترك الرئيسية كما كانت. */
  readonly workspace?: React.ReactNode;
}

export function HomeScreen({ snapshot, configuredModelCount, managePath = "/settings", workspace = null }: HomeScreenProps) {
  const translator = useTranslator();

  // مساحة العمل هي الرئيسية حين توجد؛ حقائق الجهاز والبناء مكانها «الإعدادات ← حول» لا هنا.
  // من دون مساحة عمل (غلاف Phase-01) تبقى الرئيسية كما كانت: حقائق المضيف وحدها.
  return (
    <>
      <h1 className={workspace === null ? "page-title" : "page-title visually-hidden-title"}>{translator.t("home.title")}</h1>
      {workspace === null ? <p className="page-subtitle">{translator.t("home.subtitle")}</p> : workspace}
      {workspace === null ? <SystemSections snapshot={snapshot} configuredModelCount={configuredModelCount} managePath={managePath} /> : null}
    </>
  );
}

/** حقائق هذا الجهاز وPOLARIS كما قالها المضيف: البناء، ووقت التشغيل، والنماذج، والقدرات. */
export function SystemSections({ snapshot, configuredModelCount, managePath = "/settings", showModels = true }: { readonly snapshot: BootstrapSnapshot; readonly configuredModelCount: number | null; readonly managePath?: string; readonly showModels?: boolean }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const runtime = present(snapshot.runtime_status.availability);
  return (
    <>

      <section className="section" aria-labelledby="home-system">
        <h2 className="section__title" id="home-system">
          {translator.t("home.section.system")}
        </h2>
        <div className="card">
          <Facts
            facts={[
              { labelKey: "home.fact.app_version", value: snapshot.app_version },
              { labelKey: "home.fact.build_channel", value: snapshot.build_channel },
              { labelKey: "home.fact.platform", value: snapshot.platform },
              { labelKey: "home.fact.architecture", value: snapshot.architecture },
              { labelKey: "home.fact.locale", value: snapshot.locale, valueKey: `locale.name.${snapshot.locale}` },
              { labelKey: "home.fact.direction", value: snapshot.direction },
              { labelKey: "home.fact.appearance", value: snapshot.appearance, valueKey: `appearance.${snapshot.appearance}` },
              { labelKey: "home.fact.ipc_protocol", value: snapshot.ipc_protocol_version },
              { labelKey: "home.fact.settings_schema", value: snapshot.settings_schema_version },
            ]}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="home-runtime">
        <h2 className="section__title" id="home-runtime">
          {translator.t("home.section.runtime")}
        </h2>
        <div className="card">
          <ul className="rows">
            <li className="row">
              <span className="row__label">
                {translator.t(`home.runtime.reachability.${snapshot.runtime_status.reachability}`)}
                <span className="row__hint">{translator.t("home.runtime.note")}</span>
              </span>
              <span className="row__value">
                <AvailabilityPill presentation={runtime} />
              </span>
            </li>
          </ul>
        </div>
      </section>

      {showModels ? (
      <section className="section" aria-labelledby="home-models">
        <h2 className="section__title" id="home-models">
          {translator.t("home.section.models")}
        </h2>
        <div className="card">
          {configuredModelCount === null || configuredModelCount === 0 ? (
            <ul className="rows">
              <li className="row">
                <span className="row__label">
                  {translator.t("home.models.none")}
                  <span className="row__hint">{translator.t("home.models.note")}</span>
                </span>
                <span className="row__value">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => navigation.navigate(managePath)}
                  >
                    {translator.t("home.models.manage")}
                  </button>
                </span>
              </li>
            </ul>
          ) : (
            <ul className="rows">
              <li className="row">
                <span className="row__label">
                  {translator.t("home.models.configured")}
                  <span className="fact__value">{formatNumber(locale, configuredModelCount)}</span>
                </span>
                <span className="row__value">
                  <button type="button" className="button button--secondary" onClick={() => navigation.navigate(managePath)}>
                    {translator.t("home.models.manage")}
                  </button>
                </span>
              </li>
            </ul>
          )}
        </div>
      </section>
      ) : null}

      <section className="section" aria-labelledby="home-capabilities">
        <h2 className="section__title" id="home-capabilities">
          {translator.t("home.section.capabilities")}
        </h2>
        <div className="card">
          <h3 className="fact__label">{translator.t("home.capabilities.enabled")}</h3>
          {snapshot.enabled_capabilities.length === 0 ? (
            <p className="row__hint">{translator.t("home.capabilities.empty")}</p>
          ) : (
            <ul className="rows">
              {snapshot.enabled_capabilities.map((id) => (
                <li className="row" key={id}>
                  <span className="row__label">{id}</span>
                  <span className="row__value">
                    <AvailabilityPill presentation={present({ state: "AVAILABLE" })} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="fact__label" style={{ marginTop: "1rem" }}>
            {translator.t("home.capabilities.unavailable")}
          </h3>
          <ul className="rows">
            {snapshot.unavailable_capabilities.map((entry: CapabilityAvailability) => (
              <li className="row" key={entry.capability_id}>
                <span className="row__label">{entry.capability_id}</span>
                <span className="row__value">
                  <AvailabilityPill presentation={present(entry.availability)} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
