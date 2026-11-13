// الوكلاء: كتالوج الوكلاء المتخصّصين بمجالاتهم، وبحث وتصفية، وتفاصيل وكيل مع «ابدأ مهمّة معه».
//
// ما يُعرض صادق عن قدرته: الوكيل منهج مجال ومعايير تحقّق تدخل موجّه الخطوة، وذكاؤه من النموذج الذي
// يختاره المستخدم. لا تقييم أداء ولا «نسبة نجاح» لكل وكيل: لا قياس يسندها.
// وأدوار سير العمل التسعة (المخطّط، والبانِي، والمراجع…) تبقى تحت قسم مطويّ: هي موقع الوكيل في
// الخطة، والمتخصّص خبرته.

import { useEffect, useMemo, useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase08Client } from "../../ipc/p08-client";
import { formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { type Specialist, specialistName, specialistSummary, storeSpecialist, useAgentCatalog } from "../../p08/specialists";
import { Icon, type IconName } from "../../ui/components/Icon";
import { StateBlock } from "../../ui/components/StateBlock";
import { AgentsScreen } from "../p03/AgentsScreen";

/** أيقونة كل مجال. مجال لا أيقونة له يأخذ النجمة. */
export const DOMAIN_ICONS: Readonly<Record<string, IconName>> = {
  software: "code",
  "web-mobile": "web",
  "data-ai": "data",
  security: "shield",
  infrastructure: "settings",
  finance: "report",
  business: "projects",
  "marketing-sales": "sparkle",
  legal: "file",
  health: "activity",
  education: "library",
  writing: "copy",
  "design-media": "slides",
  research: "research",
  engineering: "grid",
  "science-math": "chip",
  "people-operations": "user",
  "product-project": "list",
  languages: "globe",
  everyday: "home",
};

/** تطبيع بسيط للبحث: حروف صغيرة، وتوحيد الألف والياء والتاء المربوطة، بلا تشكيل. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647");
}

export function AgentsCatalogScreen({ phase03, phase08 }: { readonly phase03: Phase03Client; readonly phase08: Phase08Client }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const catalog = useAgentCatalog(phase08);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [open, setOpen] = useState<Specialist | null>(null);

  const domains = catalog?.domains ?? [];
  const domainName = (id: string) => {
    const d = domains.find((x) => x.domain_id === id);
    return d === undefined ? id : specialistName(d, locale);
  };
  const needle = fold(query.trim());
  const shown = useMemo(
    () =>
      (catalog?.specialists ?? []).filter(
        (s) => (domain === null || s.domain_id === domain) && (needle === "" || fold(`${s.name_ar} ${s.name_en} ${s.summary_ar} ${s.summary_en}`).includes(needle)),
      ),
    [catalog, domain, needle],
  );
  const total = catalog?.specialists.length ?? 0;

  function start(s: Specialist): void {
    storeSpecialist(s.specialist_id);
    setOpen(null);
    navigation.navigate("/");
  }

  return (
    <div className="page agents-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{translator.t("nav.agents")}</h1>
          <p className="page-subtitle">{translator.t("ui.agents.subtitle", { count: formatNumber(locale, total), domains: formatNumber(locale, domains.length) })}</p>
        </div>
      </header>

      <ul className="agents-how" aria-label={translator.t("ui.agents.how")}>
        {(["auto", "pin", "method"] as const).map((k) => (
          <li key={k} className="agents-how__item">
            <Icon name={k === "auto" ? "sparkle" : k === "pin" ? "user" : "check"} size={18} />
            <span>
              <strong>{translator.t(`ui.agents.how.${k}.title`)}</strong>
              <span className="agents-how__body">{translator.t(`ui.agents.how.${k}.body`)}</span>
            </span>
          </li>
        ))}
      </ul>

      {catalog === null ? <StateBlock kind="loading" /> : null}

      {catalog === null ? null : (
        <>
          <div className="list-tools">
            <label className="search-box">
              <Icon name="search" size={16} />
              <span className="visually-hidden">{translator.t("ui.agents.search")}</span>
              <input type="search" value={query} placeholder={translator.t("ui.agents.search")} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <span className="agents-count" role="status">
              {translator.t("ui.agents.shown", { count: formatNumber(locale, shown.length) })}
            </span>
          </div>

          <div className="agents-domains" role="group" aria-label={translator.t("ui.agents.domains")}>
            <button type="button" className="agents-domain" aria-pressed={domain === null} onClick={() => setDomain(null)}>
              <span>{translator.t("ui.agents.all")}</span>
              <span className="agents-domain__count">{formatNumber(locale, total)}</span>
            </button>
            {domains.map((d) => (
              <button key={d.domain_id} type="button" className="agents-domain" aria-pressed={domain === d.domain_id} onClick={() => setDomain(domain === d.domain_id ? null : d.domain_id)}>
                <Icon name={DOMAIN_ICONS[d.domain_id] ?? "sparkle"} size={15} />
                <span>{specialistName(d, locale)}</span>
                <span className="agents-domain__count">{formatNumber(locale, d.count)}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="agents-empty">{translator.t("ui.agents.none")}</p>
          ) : (
            <ul className="agents-grid">
              {shown.map((s) => (
                <li key={s.specialist_id}>
                  <button type="button" className="agent-card" onClick={() => setOpen(s)}>
                    <span className={`agent-card__avatar hue-${hueOf(s.domain_id)}`} aria-hidden="true">
                      <Icon name={DOMAIN_ICONS[s.domain_id] ?? "sparkle"} size={18} />
                    </span>
                    <span className="agent-card__text">
                      <span className="agent-card__name">{specialistName(s, locale)}</span>
                      <span className="agent-card__summary">{specialistSummary(s, locale)}</span>
                      <span className="agent-card__domain">{domainName(s.domain_id)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <details className="agents-roles">
        <summary>
          <span className="agents-roles__title">{translator.t("ui.agents.roles.title")}</span>
          <span className="agents-roles__body">{translator.t("ui.agents.roles.body")}</span>
        </summary>
        <AgentsScreen client={phase03} />
      </details>

      {open === null ? null : <SpecialistDialog specialist={open} domain={domainName(open.domain_id)} onStart={() => start(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** لون ثابت لكل مجال من ستة ألوان: يميّز البطاقات بصريًا دون أن يحمل معنى وحده. */
function hueOf(domainId: string): number {
  let h = 0;
  for (const c of domainId) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h % 6;
}

function SpecialistDialog({ specialist, domain, onStart, onClose }: { readonly specialist: Specialist; readonly domain: string; onStart(): void; onClose(): void }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.document?.addEventListener("keydown", onKey);
    return () => globalThis.document?.removeEventListener("keydown", onKey);
  }, [onClose]);
  const other = locale === "ar" ? specialist.name_en : specialist.name_ar;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title">
        <header className="dialog__head">
          <span className={`agent-card__avatar agent-card__avatar--lg hue-${hueOf(specialist.domain_id)}`} aria-hidden="true">
            <Icon name={DOMAIN_ICONS[specialist.domain_id] ?? "sparkle"} size={22} />
          </span>
          <div className="agent-dialog__heading">
            <h2 className="dialog__title" id="agent-dialog-title">
              {specialistName(specialist, locale)}
            </h2>
            <p className="agent-dialog__sub">
              <span dir="auto">{other}</span>
              <span aria-hidden="true">{" · "}</span>
              <span>{domain}</span>
            </p>
          </div>
          <button type="button" className="icon-button" aria-label={translator.t("ui.close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <p className="agent-dialog__summary">{specialistSummary(specialist, locale)}</p>
        <section className="agent-dialog__section">
          <h3>{translator.t("ui.agents.dialog.work")}</h3>
          <ul className="agent-dialog__types">
            {specialist.task_types.map((t) => (
              <li key={t}>{translator.t(`p03.task_type.${t}`)}</li>
            ))}
          </ul>
        </section>
        {specialist.agent === undefined ? null : (
          <section className="agent-dialog__section" aria-labelledby="agent-dialog-definition">
            {/* تعريف الوكيل كما يفرضه المضيف (القسم 6): الهوية والإصدار والأدوات والميزانية ومكان التقرير. وقبول النموذج الحقيقي
                يُقال كما هو: غير مقيس في هذا البناء. */}
            <h3 id="agent-dialog-definition">{translator.t("ui.agents.dialog.definition")}</h3>
            <dl className="agent-dialog__facts">
              <dt>{translator.t("ui.agents.dialog.identity")}</dt>
              <dd dir="ltr">
                <code>{specialist.agent.agent_id}</code> v{specialist.agent.version}
              </dd>
              <dt>{translator.t("ui.agents.dialog.tools")}</dt>
              <dd dir="ltr">{specialist.agent.tools.join(", ")}</dd>
              <dt>{translator.t("ui.agents.dialog.limits")}</dt>
              <dd>{translator.t("ui.agents.dialog.limits_value", { turns: specialist.agent.max_turns, tools: specialist.agent.max_tool_calls })}</dd>
              <dt>{translator.t("ui.agents.dialog.report")}</dt>
              <dd dir="ltr">
                <code>{specialist.agent.report_path}</code>
              </dd>
              <dt>{translator.t("ui.agents.dialog.acceptance")}</dt>
              <dd>{translator.t(`ui.agents.acceptance.${specialist.agent.real_model_acceptance}`)}</dd>
            </dl>
          </section>
        )}
        <p className="agent-dialog__note">{translator.t("ui.agents.dialog.note")}</p>
        <footer className="agent-dialog__foot">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {translator.t("ui.close")}
          </button>
          <button type="button" className="button button--primary" onClick={onStart}>
            <Icon name="arrow-up" size={15} />
            {translator.t("ui.agents.start")}
          </button>
        </footer>
      </div>
    </div>
  );
}
