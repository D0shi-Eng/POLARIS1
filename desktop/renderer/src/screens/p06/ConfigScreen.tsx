// لوحة التحكّم بالإعدادات (Phase-06): تسعة عشر قسمًا، وقيمة فعّالة لكل إعداد ومصدرها.
//
// الشاشة لا تحسب قيمة فعّالة ولا تقيّد ولا تحكم على توسيع: هذا كلّه عند المضيف، والشاشة
// تعرض ما قاله — القيمة، ومن أين جاءت (افتراضي، مستخدم، مشروع، مهمّة، قيد أمني)، وأيّ
// طبقة حاولت أن توسّع فتُجوهلت. والإعداد الحسّاس يُعرض «مُعَدّ أم لا» ومصدره وآخر
// تحديث، ولا طريق هنا لكشف قيمته.

import { NumberField } from "../../ui/components/NumberField";
import { useEffect, useMemo, useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type {
  ConfigEffectiveResultV1,
  ConfigLayer,
  ConfigSection,
  ResolvedValueV1,
  SettingDescriptorV1,
  SettingValue,
} from "../../generated/types/desktop-p06-result-v1";
import type { ConfigScope, ConfigTarget, Phase06Client } from "../../ipc/p06-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { Phase02Client } from "../../ipc/p02-client";
import { ModelsSettings } from "../p02/oc/ModelsSettings";
import { ProvidersSettings } from "../p02/oc/ProvidersSettings";
import { P08_SETTINGS_SECTIONS, Phase08SettingsSection, type P08Section } from "../p08/SettingsPanels";
import { SemanticMemoryPanel } from "../p08/SemanticMemoryPanel";
import { formatInstant, formatNumber } from "../../localization/format";
import { type LocaleCode, uiLocaleChoices } from "../../localization/types";
import { inputToValue, sameValue, sourceTone, valueToInput } from "../../p06/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { BudgetsPanel, PricingPanel } from "./CostPanels";
import { P06Pill } from "./P06Pill";
import type { BootstrapSnapshot } from "../../generated/types/desktop-result-v1";
import type { ExecutionStatusResultV1 } from "../../generated/types/desktop-p08-result-v1";
import { SystemSections } from "../HomeScreen";
import { Icon, type IconName } from "../../ui/components/Icon";

type Page = "ACCOUNT" | "SHORTCUTS" | "ABOUT";

/** ترتيب بطاقات السمة كما في مانوس: فاتح، داكن، ثم النظام. */
const THEME_ORDER: readonly string[] = ["LIGHT", "DARK", "SYSTEM"];

/** الاختصارات التي يستجيب لها التطبيق فعلًا (AppRoot وComposer والحوارات)؛ للعرض، لا للتعديل بعد. */
const SHORTCUTS: readonly { readonly id: string; readonly keys: readonly string[] }[] = [
  { id: "new_task", keys: ["Ctrl", "Shift", "O"] },
  { id: "search", keys: ["Ctrl", "K"] },
  { id: "send", keys: ["Enter"] },
  { id: "newline", keys: ["Shift", "Enter"] },
  { id: "close", keys: ["Esc"] },
];

/** الطبقة التي يُكتب فيها الإعداد: طبقتك إن قبلها، وإلا طبقة الأمن (حدود الأمن لا تُكتب إلا هناك). */
function targetFor(descriptor: SettingDescriptorV1): ConfigTarget {
  const layers = descriptor.layers as readonly ConfigLayer[];
  return { layer: layers.includes("USER") || !layers.includes("SECURITY") ? "USER" : "SECURITY" };
}

/** فهرس الإعدادات مجموعاتٍ كما في مانوس (عام، النماذج، القدرات…)، ولكل قسم أيقونته. */
const SECTION_GROUPS: readonly { readonly key: string; readonly sections: readonly ConfigSection[] }[] = [
  { key: "general", sections: ["GENERAL", "APPEARANCE", "LANGUAGE"] },
  { key: "models", sections: ["MODELS", "PROVIDERS", "AGENTS"] },
  { key: "capabilities", sections: ["SKILLS", "TOOLS", "MCP", "CONNECTORS", "MEMORY", "BROWSER", "COMPUTER"] },
  { key: "privacy", sections: ["PRIVACY", "SECURITY"] },
  { key: "usage", sections: ["BUDGETS", "COST", "OBSERVABILITY"] },
  { key: "advanced", sections: ["ADVANCED"] },
];
const SECTION_ICONS: Partial<Record<string, IconName>> = {
  GENERAL: "sliders",
  APPEARANCE: "sun",
  LANGUAGE: "globe",
  MODELS: "chip",
  PROVIDERS: "connectors",
  AGENTS: "agents",
  SKILLS: "skills",
  TOOLS: "code",
  MCP: "connectors",
  CONNECTORS: "connectors",
  MEMORY: "memory",
  BROWSER: "browser",
  COMPUTER: "browser",
  PRIVACY: "shield",
  SECURITY: "shield",
  BUDGETS: "data",
  COST: "data",
  OBSERVABILITY: "activity",
  ADVANCED: "settings",
  EXECUTION: "code",
  BROWSER_ENGINE: "globe",
  VOICE: "mic",
  ACCOUNTS: "user",
  PUBLISHING: "web",
  PACKAGES: "library",
  DEVICES: "chip",
  SCHEDULES: "schedule",
};

/** روابط الأقسام إلى شاشاتها القائمة: الإعداد هنا، والإدارة هناك. */
const SECTION_LINKS: Partial<Record<ConfigSection, readonly { readonly path: string; readonly labelKey: string }[]>> = {
  MODELS: [{ path: "/models", labelKey: "nav.models" }],
  PROVIDERS: [{ path: "/providers", labelKey: "nav.providers" }],
  SKILLS: [{ path: "/skills", labelKey: "nav.skills" }],
  TOOLS: [{ path: "/tools", labelKey: "nav.tools" }],
  MCP: [{ path: "/connectors", labelKey: "nav.connectors" }],
  MEMORY: [{ path: "/memory", labelKey: "nav.memory" }],
  BROWSER: [{ path: "/browser-computer", labelKey: "nav.browser-computer" }],
  COMPUTER: [{ path: "/browser-computer", labelKey: "nav.browser-computer" }],
  CONNECTORS: [{ path: "/connectors", labelKey: "nav.connectors" }],
  COST: [{ path: "/usage", labelKey: "nav.usage" }],
  OBSERVABILITY: [
    { path: "/health", labelKey: "nav.health" },
    { path: "/events", labelKey: "nav.events" },
    { path: "/diagnostics", labelKey: "nav.diagnostics" },
  ],
  ADVANCED: [{ path: "/settings/host", labelKey: "nav.settings-host" }],
};

export interface ConfigScreenProps {
  readonly client: Phase06Client;
  /** يُستدعى بالقيم الفعّالة بعد كل قراءة وكتابة، لتطبيق السمة واللغة والكثافة فورًا. */
  onEffective?(values: readonly ResolvedValueV1[]): void;
  /** عميل Phase-08: يضيف أقسام بيئة التنفيذ والمتصفّح والصوت والحسابات والنشر والحزم والأجهزة. */
  readonly phase08?: Phase08Client | undefined;
  /** حقائق الإقلاع لقسم «حول»: البناء والمنصّة ووقت التشغيل والقدرات، كما قالها المضيف. */
  readonly snapshot?: BootstrapSnapshot;
  /** عميل Phase-02: صفحتا «المزوّدون» و«النماذج» على نمط OpenCode (ADR-037). */
  readonly phase02?: Phase02Client | undefined;
  /** القسم المفتوح أوّلًا: `/providers` و`/models` يفتحان الإعدادات عليهما. */
  readonly initialSection?: ConfigSection | undefined;
}

/** القسمان اللذان صارت لهما صفحة كاملة داخل الإعدادات. */
const OC_SECTIONS: readonly ConfigSection[] = ["PROVIDERS", "MODELS"];

export function ConfigScreen({ client, onEffective, phase08, snapshot, phase02, initialSection }: ConfigScreenProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const [extra, setExtra] = useState<P08Section | null>(null);
  // صفحات لا تأتي من وصف المضيف: الحساب المحلي، والاختصارات، وحول.
  const [page, setPage] = useState<Page | null>(null);
  const about = page === "ABOUT";
  const [query, setQuery] = useState("");
  const described = useHostQuery(() => client.describeConfig(), [client]);
  const [section, setSection] = useState<ConfigSection>(initialSection ?? "GENERAL");
  useEffect(() => {
    if (initialSection === undefined) return;
    setSection(initialSection);
    setPage(null);
    setExtra(null);
  }, [initialSection]);
  const ocPage = phase02 !== undefined && OC_SECTIONS.includes(section);
  // قرار المالك 2026-10-06: لا محدّد «تُكتب القيم في». القيم تُكتب في طبقتك، والإعداد الأمني وحده في طبقة الأمن.
  const scope: ConfigScope = {};
  const effective = useHostQuery(() => client.effectiveConfig(scope), [client]);

  useEffect(() => {
    if (effective.value !== null) onEffective?.(effective.value.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective.value]);

  const needle = query.trim().toLowerCase();
  // البحث يطابق اسم القسم ومفاتيح إعداداته وأسماءها كما تُعرض في اللغة الحالية.
  const matches = (labelKey: string, words: readonly string[]) =>
    needle === "" || translator.t(labelKey).toLowerCase().includes(needle) || words.some((w) => w.toLowerCase().includes(needle));
  const sections = (described.value?.sections ?? []).filter((entry) => matches(entry.label_key, needle === "" ? [] : entry.settings.flatMap((d) => [d.key, translator.t(d.label_key)])));
  const extras = phase08 === undefined ? [] : P08_SETTINGS_SECTIONS.filter((id) => matches(`p08.section.${id}`, needle === "" ? [] : [translator.t(`p08.section.${id}.hint`)]));
  const current = sections.find((entry) => entry.section === section) ?? sections[0];
  const values = useMemo(() => {
    const map = new Map<string, ResolvedValueV1>();
    for (const value of effective.value?.values ?? []) map.set(value.key, value);
    return map;
  }, [effective.value]);
  const status = described.value?.status ?? effective.value?.status;

  return (
    <>
      {described.loading ? <StateBlock kind="loading" /> : null}
      {described.error !== null ? <ErrorNote error={described.error} onRetry={described.reload} /> : null}
      {effective.error !== null ? <ErrorNote error={effective.error} onRetry={effective.reload} /> : null}
      {status === undefined || status.state === "OK" ? null : (
        <p className="alert p06-config-status" role="alert" data-config-state={status.state}>
          {translator.t(`cfg.status.${status.state}`, { found: status.found_version, supported: status.schema_version })}
        </p>
      )}

      <div className="p06-config-layout settings-panel">
        <nav className="p06-config-nav" aria-label={translator.t("cfg.sections")}>
          {/* العنوان لقارئ الشاشة؛ في رأس الفهرس بطاقة الحساب المحلي كما في مانوس. */}
          <h1 className="page-title visually-hidden">{translator.t("nav.settings")}</h1>
          <button
            type="button"
            className={`settings-account cfg-page${page === "ACCOUNT" ? " is-current" : ""}`}
            data-page="ACCOUNT"
            aria-current={page === "ACCOUNT" ? "page" : undefined}
            onClick={() => {
              setExtra(null);
              setPage("ACCOUNT");
            }}
          >
            <span className="settings-account__avatar" aria-hidden="true">
              {translator.t("ui.account.initial")}
            </span>
            <span className="settings-account__text">
              <span className="settings-account__name">{translator.t("app.name")}</span>
              <span className="settings-account__sub">{translator.t("ui.account.local")}</span>
            </span>
          </button>
          <div className="settings-search">
            <label className="visually-hidden" htmlFor="cfg-search">
              {translator.t("p08.settings.search")}
            </label>
            <Icon name="search" size={15} className="settings-search__icon" />
            <input id="cfg-search" type="search" className="settings-search__input" placeholder={translator.t("p08.settings.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {[...SECTION_GROUPS, { key: "other", sections: [] as readonly ConfigSection[] }].map((group) => {
            const grouped = new Set<ConfigSection>(SECTION_GROUPS.flatMap((g) => g.sections));
            const members = group.key === "other" ? sections.filter((entry) => !grouped.has(entry.section)) : sections.filter((entry) => group.sections.includes(entry.section));
            if (members.length === 0) return null;
            return (
              <div key={group.key} className="settings-nav__group">
                <h2 className="p06-config-nav__group">{translator.t(`ui.settings.group.${group.key}`)}</h2>
                <ul>
                  {members.map((entry) => (
                    <li key={entry.section}>
                      <button
                        type="button"
                        className={`button button--secondary cfg-section${page === null && extra === null && entry.section === current?.section ? " is-current" : ""}`}
                        data-section={entry.section}
                        aria-current={page === null && extra === null && entry.section === current?.section ? "page" : undefined}
                        onClick={() => {
                          setPage(null);
                          setExtra(null);
                          setSection(entry.section);
                        }}
                      >
                        <Icon name={SECTION_ICONS[entry.section] ?? "settings"} size={16} />
                        <span>{translator.t(entry.label_key)}</span>
                      </button>
                    </li>
                  ))}
                  {group.key === "general" && matches("ui.shortcuts.title", []) ? (
                    <li>
                      <button
                        type="button"
                        className={`button button--secondary cfg-page${page === "SHORTCUTS" ? " is-current" : ""}`}
                        data-page="SHORTCUTS"
                        aria-current={page === "SHORTCUTS" ? "page" : undefined}
                        onClick={() => {
                          setExtra(null);
                          setPage("SHORTCUTS");
                        }}
                      >
                        <Icon name="keyboard" size={16} />
                        <span>{translator.t("ui.shortcuts.title")}</span>
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
          {extras.length === 0 ? null : (
            <div className="settings-nav__group">
              <h2 className="p06-config-nav__group">{translator.t("p08.settings.group")}</h2>
              <ul>
                {extras.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className={`button button--secondary cfg-extra${page === null && extra === id ? " is-current" : ""}`}
                      data-extra={id}
                      aria-current={page === null && extra === id ? "page" : undefined}
                      onClick={() => {
                        setPage(null);
                        setExtra(id);
                      }}
                    >
                      <Icon name={SECTION_ICONS[id] ?? "settings"} size={16} />
                      <span>{translator.t(`p08.section.${id}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {snapshot === undefined || !matches("ui.about.title", []) ? null : (
            <ul className="p06-config-nav__about">
              <li>
                <button
                  type="button"
                  className={`button button--secondary cfg-about${about ? " is-current" : ""}`}
                  aria-current={about ? "page" : undefined}
                  onClick={() => {
                    setExtra(null);
                    setPage("ABOUT");
                  }}
                >
                  <Icon name="info" size={16} />
                  <span>{translator.t("ui.about.title")}</span>
                </button>
              </li>
            </ul>
          )}
        </nav>

        {about && snapshot !== undefined ? (
          <div className="p06-config-body">
            <section className="section" aria-labelledby="cfg-about-title">
              <h2 className="section__title" id="cfg-about-title">
                {translator.t("ui.about.title")}
              </h2>
              <p className="muted">{translator.t("ui.about.body")}</p>
              <p className="muted">{translator.t("ui.about.license")}</p>
            </section>
            <SystemSections snapshot={snapshot} configuredModelCount={null} showModels={false} />
          </div>
        ) : page === "ACCOUNT" ? (
          <div className="p06-config-body">
            <AccountPage phase08={phase08} snapshot={snapshot} onOpen={(id) => {
              setPage(null);
              setExtra(id);
            }} />
          </div>
        ) : page === "SHORTCUTS" ? (
          <div className="p06-config-body">
            <section className="section" aria-labelledby="cfg-shortcuts-title">
              <h2 className="section__title" id="cfg-shortcuts-title">
                {translator.t("ui.shortcuts.title")}
              </h2>
              <p className="muted">{translator.t("ui.shortcuts.hint")}</p>
              <div className="rows">
                {SHORTCUTS.map((entry) => (
                  <div key={entry.id} className="row settings-shortcut">
                    <span className="row__label">{translator.t(`ui.shortcuts.${entry.id}`)}</span>
                    <span className="row__value">
                      {entry.keys.map((key) => (
                        <kbd key={key} className="kbd">
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : extra !== null && phase08 !== undefined ? (
          <div className="p06-config-body">
            <Phase08SettingsSection client={phase08} section={extra} config={client} onOpen={(path) => navigation.navigate(path)} />
          </div>
        ) : (
        <div className="p06-config-body">
          {current === undefined ? null : (
            <section className="section p06-config-section" aria-labelledby="cfg-section-title" data-section={current.section}>
              <h2 className="section__title" id="cfg-section-title">
                {translator.t(current.label_key)}
              </h2>
              {ocPage && current.section === section ? (
                current.section === "PROVIDERS" ? (
                  <ProvidersSettings client={phase02} />
                ) : (
                  <ModelsSettings client={phase02} onOpenProviders={() => setSection("PROVIDERS")} />
                )
              ) : (
                <>
                  <p className="muted">{translator.t(`cfg.section_hint.${current.section}`)}</p>
                  <SectionLinks section={current.section} />
                </>
              )}
              {/* حالة ملف الإعدادات ورقم المخطّط تفصيل تقني: مكانه «متقدّم»، لا «عام». */}
              {current.section === "ADVANCED" && status !== undefined ? (
                <dl className="facts p06-config-facts">
                  <div>
                    <dt className="fact__label">{translator.t("cfg.fact.state")}</dt>
                    <dd className="fact__value">{translator.t(`p06.config_state.${status.state}`)}</dd>
                  </div>
                  <div>
                    <dt className="fact__label">{translator.t("cfg.fact.schema")}</dt>
                    <dd className="fact__value">{status.schema_version}</dd>
                  </div>
                  <div>
                    <dt className="fact__label">{translator.t("cfg.fact.version")}</dt>
                    <dd className="fact__value">{status.config_version}</dd>
                  </div>
                </dl>
              ) : null}
              <div className="rows">
                {current.settings.map((descriptor) => (
                  <SettingRow
                    key={descriptor.key}
                    client={client}
                    descriptor={descriptor}
                    resolved={values.get(descriptor.key)}
                    target={targetFor(descriptor)}
                    writable
                    onChanged={effective.reload}
                  />
                ))}
              </div>
              {current.section === "PRIVACY" || current.section === "SECURITY" ? <SensitiveList effective={effective.value} /> : null}
              {current.section === "BUDGETS" ? <BudgetsPanel client={client} /> : null}
              {current.section === "MEMORY" && phase08 !== undefined ? <SemanticMemoryPanel client={phase08} /> : null}
              {current.section === "COST" ? <PricingPanel client={client} /> : null}
            </section>
          )}
        </div>
        )}
      </div>
    </>
  );
}

/** الحساب: POLARIS محلي، لا حساب سحابي ولا تسجيل دخول؛ يعرض ما هو صحيح عن هذا الجهاز فقط. */
function AccountPage({ phase08, snapshot, onOpen }: { readonly phase08: Phase08Client | undefined; readonly snapshot: BootstrapSnapshot | undefined; onOpen(section: P08Section): void }) {
  const translator = useTranslator();
  const status = useHostQuery<ExecutionStatusResultV1 | null>(() => (phase08 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase08.executionStatus()), [phase08]);
  return (
    <section className="section" aria-labelledby="cfg-account-title">
      <h2 className="section__title" id="cfg-account-title">
        {translator.t("ui.account.title")}
      </h2>
      <div className="account-card">
        <span className="settings-account__avatar account-card__avatar" aria-hidden="true">
          {translator.t("ui.account.initial")}
        </span>
        <span className="settings-account__text">
          <strong className="account-card__name">{translator.t("app.name")}</strong>
          <span className="muted">{translator.t("ui.account.local_long")}</span>
        </span>
      </div>
      <div className="rows">
        {status.value?.device_id === undefined ? null : (
          <div className="row">
            <span className="row__label">
              {translator.t("p08.devices.id")}
              <span className="row__hint">{translator.t("ui.account.device_hint")}</span>
            </span>
            <span className="row__value">
              <code dir="ltr">{status.value.device_id}</code>
            </span>
          </div>
        )}
        {snapshot === undefined ? null : (
          <div className="row">
            <span className="row__label">{translator.t("ui.account.version")}</span>
            <span className="row__value" dir="ltr">
              {snapshot.app_version}
            </span>
          </div>
        )}
        {phase08 === undefined
          ? null
          : (["ACCOUNTS", "DEVICES"] as const).map((id) => (
              <div className="row" key={id}>
                <span className="row__label">
                  {translator.t(`p08.section.${id}`)}
                  <span className="row__hint">{translator.t(`p08.section.${id}.hint`)}</span>
                </span>
                <span className="row__value">
                  <button type="button" className="button button--secondary" onClick={() => onOpen(id)}>
                    {translator.t("ui.account.manage")}
                  </button>
                </span>
              </div>
            ))}
      </div>
    </section>
  );
}

function SectionLinks({ section }: { readonly section: ConfigSection }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const links = SECTION_LINKS[section];
  if (links === undefined) return null;
  return (
    <p className="p06-config-links">
      {links.map((link) => (
        <a
          key={link.path}
          href={`#${link.path}`}
          className="link"
          onClick={(event) => {
            event.preventDefault();
            navigation.navigate(link.path);
          }}
        >
          {translator.t(link.labelKey)}
        </a>
      ))}
    </p>
  );
}

function SettingRow({
  client,
  descriptor,
  resolved,
  target,
  writable,
  onChanged,
}: {
  readonly client: Phase06Client;
  readonly descriptor: SettingDescriptorV1;
  readonly resolved: ResolvedValueV1 | undefined;
  readonly target: ConfigTarget;
  readonly writable: boolean;
  onChanged(): void;
}) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const action = useAction();
  const effectiveValue = resolved?.value ?? descriptor.default;
  const [draft, setDraft] = useState(valueToInput(effectiveValue));
  useEffect(() => setDraft(valueToInput(effectiveValue)), [effectiveValue]);
  const inputId = `cfg-input-${descriptor.key.replace(/[._]/g, "-")}`;
  const hintId = `${inputId}-hint`;
  const layerAllowed = (descriptor.layers as readonly string[]).includes(target.layer);
  const editable = descriptor.state === "EDITABLE" && layerAllowed && writable;
  const parsed = inputToValue(descriptor, draft);

  const save = () => {
    if (parsed === null) {
      action.set({ phase: "DONE", messageKey: "cfg.value.unreadable" });
      return;
    }
    void action.run(
      () => client.setConfig(target, descriptor.key, parsed),
      (value) => ({
        phase: "DONE",
        messageKey: value.value.source === "SECURITY_CLAMP" ? "cfg.saved.clamped" : "cfg.saved",
        values: { value: display(translator, locale, descriptor, value.value.value) },
      }),
      onChanged,
    );
  };

  const presentHere = (resolved?.present_layers as readonly string[] | undefined)?.includes(target.layer) === true;
  // «حفظ» يظهر حين يوجد ما يُحفظ فقط، و«إعادة» حين تحمل الطبقة المختارة قيمة تُزال.
  const canSave = !(sameValue(parsed, effectiveValue) && presentHere);
  const source = resolved?.source ?? "DEFAULT";
  const theme = descriptor.key === "appearance.theme" && editable;

  return (
    <div
      className="row p06-setting"
      data-setting-key={descriptor.key}
      data-source={source}
      data-value={JSON.stringify(effectiveValue)}
      data-state={descriptor.state}
      data-dirty={parsed !== null && !sameValue(parsed, effectiveValue) ? "true" : undefined}
    >
      <div className="row__label">
        <label htmlFor={inputId}>{translator.t(descriptor.label_key)}</label>
        <p className="row__hint" id={hintId}>
          {translator.t(descriptor.hint_key)}
        </p>
        <p className="row__meta">
          {translator.t(`p06.applies.${descriptor.applies}`)}
          {descriptor.security_bearing ? (
            <>
              {" "}
              <P06Pill namespace="security" member="BEARING" tone="WARNING" />
            </>
          ) : null}
          {descriptor.ceiling === null ? null : (
            <>
              {" "}
              <span>{translator.t("cfg.ceiling", { value: display(translator, locale, descriptor, descriptor.ceiling) })}</span>
            </>
          )}
          {/* مصدر كل قيمة ظاهر دائمًا، والافتراضي منها (P06-UI-020). */}{" "}
          <P06Pill namespace="source" member={source} tone={sourceTone(source)} />
          {resolved?.clamped === true ? (
            <>
              {" "}
              <P06Pill namespace="clamp" member="CLAMPED" tone="WARNING" />
            </>
          ) : null}
        </p>
        {resolved === undefined || resolved.ignored_layers.length === 0 ? null : (
          <p className="muted p06-ignored">
            {translator.t("cfg.ignored", { layers: resolved.ignored_layers.map((value) => translator.t(`p06.layer.${value}`)).join(", ") })}
          </p>
        )}
      </div>
      <div className="row__value">
        {editable ? null : (
          <p className="p06-effective">
            <strong className="p06-effective-value">{display(translator, locale, descriptor, effectiveValue)}</strong>
          </p>
        )}
        {descriptor.state === "LOCKED" ? <p className="muted">{translator.t("cfg.state.LOCKED")}</p> : null}
        {descriptor.state === "UNAVAILABLE_THIS_PHASE" ? <p className="muted">{translator.t("cfg.state.UNAVAILABLE_THIS_PHASE")}</p> : null}
        {descriptor.state === "EDITABLE" && !layerAllowed ? (
          <p className="muted">{translator.t("cfg.layer_not_allowed", { layer: translator.t(`p06.layer.${target.layer}`) })}</p>
        ) : null}
        {theme ? (
          // السمة بطاقات كما في مانوس: الاختيار يُحفظ ويُطبَّق فورًا، بلا زرّ «حفظ».
          <div className="theme-cards" role="radiogroup" aria-labelledby={inputId} id={inputId} aria-describedby={hintId}>
            {[...descriptor.bounds.allowed].sort((a, b) => THEME_ORDER.indexOf(a) - THEME_ORDER.indexOf(b)).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                className="theme-card cfg-theme"
                data-option={option}
                aria-checked={String(effectiveValue) === option}
                onClick={() => {
                  setDraft(option);
                  void action.run(
                    () => client.setConfig(target, descriptor.key, option),
                    (value) => ({ phase: "DONE", messageKey: "cfg.saved", values: { value: display(translator, locale, descriptor, value.value.value) } }),
                    onChanged,
                  );
                }}
              >
                <span className={`theme-card__preview theme-card__preview--${option.toLowerCase()}`} aria-hidden="true">
                  <span />
                  <span />
                </span>
                <span className="theme-card__label">{translator.t(optionKey(descriptor.key, option))}</span>
              </button>
            ))}
          </div>
        ) : editable ? (
          <div className="row__controls">
            <Editor descriptor={descriptor} id={inputId} hintId={hintId} draft={draft} onDraft={setDraft} />
            {canSave ? (
              <button
                type="button"
                className="button button--primary cfg-save"
                aria-label={`${translator.t("cfg.action.save")} ${translator.t(descriptor.label_key)}`}
                onClick={save}
              >
                {translator.t("cfg.action.save")}
              </button>
            ) : null}
            {presentHere ? (
              <button
                type="button"
                className="icon-button cfg-reset"
                aria-label={`${translator.t("cfg.action.reset")} ${translator.t(descriptor.label_key)}`}
                title={translator.t("cfg.action.reset")}
                onClick={() =>
                  void action.run(
                    () => client.resetConfig(target, descriptor.key),
                    (value) => ({ phase: "DONE", messageKey: value.removed ? "cfg.reset" : "cfg.reset.nothing" }),
                    onChanged,
                  )
                }
              >
                <Icon name="undo" size={15} />
              </button>
            ) : null}
          </div>
        ) : null}
        <ActionNote state={action.state} />
      </div>
    </div>
  );
}

function Editor({
  descriptor,
  id,
  hintId,
  draft,
  onDraft,
}: {
  readonly descriptor: SettingDescriptorV1;
  readonly id: string;
  readonly hintId: string;
  readonly draft: string;
  onDraft(next: string): void;
}) {
  const translator = useTranslator();
  switch (descriptor.kind) {
    case "BOOLEAN":
      return (
        <input
          id={id}
          type="checkbox"
          className="cfg-input"
          aria-describedby={hintId}
          checked={draft === "true"}
          onChange={(event) => onDraft(event.target.checked ? "true" : "false")}
        />
      );
    case "ENUM":
      return (
        <select id={id} className="select cfg-input" aria-describedby={hintId} value={draft} onChange={(event) => onDraft(event.target.value)}>
          {descriptor.bounds.allowed.filter((option) => !isIncompleteUiLocale(descriptor.key, option, draft)).map((option) => (
            <option key={option} value={option}>
              {translator.t(optionKey(descriptor.key, option))}
            </option>
          ))}
        </select>
      );
    case "INTEGER":
    case "DURATION":
    case "BYTES":
      return (
        <NumberField id={id} className="cfg-input" describedBy={hintId} min={descriptor.bounds.min} max={descriptor.bounds.max} value={draft} onChange={onDraft} />
      );
    default:
      return (
        <input
          id={id}
          type="text"
          className="cfg-input"
          aria-describedby={hintId}
          maxLength={descriptor.bounds.max_length ?? 400}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
        />
      );
  }
}

/** لغة واجهة غير مكتملة لا تُعرض خيارًا، إلا إن كانت المختارة الآن. */
function isIncompleteUiLocale(key: string, option: string, current: string): boolean {
  return key.startsWith("language.") && option !== "SYSTEM" && option !== current && !uiLocaleChoices(current).includes(option);
}

function optionKey(key: string, option: string): string {
  if (key.startsWith("language.") && option !== "SYSTEM") return `locale.name.${option}`;
  return `cfg.option.${option}`;
}

function display(
  translator: ReturnType<typeof useTranslator>,
  locale: LocaleCode,
  descriptor: SettingDescriptorV1,
  value: SettingValue,
): string {
  switch (descriptor.kind) {
    case "BOOLEAN":
      return translator.t(value === true ? "cfg.bool.true" : "cfg.bool.false");
    case "ENUM":
      return translator.t(optionKey(descriptor.key, String(value)));
    case "DURATION":
      return translator.t("cfg.unit.ms", { value: formatNumber(locale, Number(value)) });
    case "BYTES":
      return translator.t("cfg.unit.bytes", { value: formatNumber(locale, Number(value)) });
    case "INTEGER":
      return formatNumber(locale, Number(value));
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}

function SensitiveList({ effective }: { readonly effective: ConfigEffectiveResultV1 | null }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const items = effective?.sensitive ?? [];
  return (
    <section className="section p06-sensitive" aria-labelledby="cfg-sensitive-title">
      <h3 className="section__title" id="cfg-sensitive-title">
        {translator.t("cfg.sensitive.title")}
      </h3>
      <p className="note">{translator.t("cfg.sensitive.note")}</p>
      {items.length === 0 ? (
        <StateBlock kind="empty" bodyKey="cfg.sensitive.empty" />
      ) : (
        <table className="table">
          <caption className="sr-only">{translator.t("cfg.sensitive.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("cfg.sensitive.subject")}</th>
              <th scope="col">{translator.t("cfg.sensitive.configured")}</th>
              <th scope="col">{translator.t("cfg.sensitive.source")}</th>
              <th scope="col">{translator.t("cfg.sensitive.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.subject} data-sensitive-subject={item.subject}>
                <th scope="row">
                  <code>{item.subject}</code>
                  {item.reference === null ? null : (
                    <>
                      <br />
                      <code className="muted">{item.reference}</code>
                    </>
                  )}
                </th>
                <td>
                  <P06Pill namespace="configured" member={item.configured ? "YES" : "NO"} tone={item.configured ? "NEUTRAL" : "MUTED"} />
                </td>
                <td>{translator.t(`p06.key_source.${item.source}`)}</td>
                <td>{item.last_updated === undefined || item.last_updated === null ? <span className="muted">—</span> : formatInstant(locale, item.last_updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
