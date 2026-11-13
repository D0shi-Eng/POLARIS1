// «النماذج» في الإعدادات (ADR-037، على نمط OpenCode): بحث، ثم مجموعة قابلة للطيّ لكل مزوّد متصل، وفي كل مجموعة نماذجه
// بمفتاح يظهرها في منتقي النماذج أو يخفيها. لا قيد «محلي أو بعيد» (ADR-040): ما يفعّله المستخدم هنا (نموذج محلي، أو خادم
// نماذج على الجهاز، أو عبر API) هو ما يظهر في منتقي النموذج ويُستعمل. والإعداد الوحيد هنا نموذج المراجعة الاختياري: كان مخزّنًا
// بلا واجهة فأرسل عملًا إلى مزوّد لم يره المستخدم (قِيس 2026-10-06)، فصار مرئيًّا هنا وفارغًا حتى يختاره المستخدم.
//
// لا نموذج يظهر ما لم يُكتشف من مزوّد حقيقي أو يعلنه المستخدم لمزوّده المخصّص. الاسم من المزوّد أو من الفهرس الموثّق.

import { useMemo, useState } from "react";

import { useTranslator } from "../../../app/context";
import { useHostQuery } from "../../../app/useHostQuery";
import type { ModelView } from "../../../generated/types/desktop-p02-result-v1";
import type { Phase02Client } from "../../../ipc/p02-client";
import { providerName } from "../../../p02/present";
import { Icon } from "../../../ui/components/Icon";
import { ErrorNote } from "../../../ui/components/Notes";
import { StateBlock } from "../../../ui/components/StateBlock";
import { ProviderGlyph, Toggle } from "./shared";

/** حدّ العرض لمزوّد واحد. المضيف قد يعيد مئات من موجّه بعيد؛ الشاشة تقول ذلك. */
const RENDER_LIMIT = 300;

export function ModelsSettings({ client, onOpenProviders }: { readonly client: Phase02Client; onOpenProviders(): void }) {
  const translator = useTranslator();
  const providers = useHostQuery(() => client.listProviders(), [client]);
  const models = useHostQuery(() => client.listModels({}), [client]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string> | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const views = providers.value?.providers ?? [];
  const all = models.value?.models ?? [];
  const needle = search.trim().toLowerCase();
  const label = (m: ModelView) => m.display_name.value ?? m.provider_model_id;

  const groups = useMemo(() => {
    return views
      .filter((p) => p.enabled)
      .map((p) => ({
        view: p,
        models: all
          .filter((m) => m.provider_id === p.provider_id && m.availability !== "MISSING")
          .filter((m) => needle === "" || label(m).toLowerCase().includes(needle) || m.provider_model_id.toLowerCase().includes(needle))
          .sort((a, b) => label(a).localeCompare(label(b), translator.locale)),
      }))
      .filter((g) => g.models.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, all, needle, translator.locale]);

  // المفتوح افتراضيًّا: كل مزوّد له نموذج مفعّل، أو الأول إن لم يكن.
  const initiallyOpen = useMemo(() => {
    const set = new Set(groups.filter((g) => g.models.some((m) => m.enabled)).map((g) => g.view.provider_id));
    if (set.size === 0 && groups[0] !== undefined) set.add(groups[0].view.provider_id);
    return set;
  }, [groups]);
  const expanded = (id: string) => needle !== "" || (open ?? initiallyOpen).has(id);
  const flip = (id: string) => {
    const next = new Set(open ?? initiallyOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  const preferences = models.value?.preferences;
  const usable = all.filter((m) => m.enabled && m.provider_enabled && m.kind !== "EMBEDDING");
  const reviewer = usable.find((m) => m.model_id === preferences?.review_model_id);
  const executor = usable.find((m) => m.model_id === preferences?.default_model_id);
  // قيد العتاد: نموذجان محليّان مختلفان قد يحمّلهما الخادم معًا. يُنبَّه إليه، والاختيار للمستخدم.
  const twoLocal = reviewer !== undefined && executor !== undefined && reviewer.model_id !== executor.model_id && reviewer.locality === "LOCAL" && executor.locality === "LOCAL";
  const [savingReviewer, setSavingReviewer] = useState(false);
  const [savingMonitor, setSavingMonitor] = useState(false);

  // مراقب الأفعال (R-11): يختاره المستخدم صراحةً، ولا مراقب افتراضيًّا.
  async function chooseMonitor(value: string): Promise<void> {
    setSavingMonitor(true);
    try {
      await client.setModelPreferences({ monitor_model_id: value === "" ? null : value });
    } finally {
      setSavingMonitor(false);
      models.reload();
    }
  }

  async function chooseReviewer(value: string): Promise<void> {
    setSavingReviewer(true);
    try {
      await client.setModelPreferences({ review_model_id: value === "" ? null : value });
    } finally {
      setSavingReviewer(false);
      models.reload();
    }
  }

  async function toggle(model: ModelView, enabled: boolean): Promise<void> {
    setPending((s) => new Set(s).add(model.model_id));
    try {
      await client.configureModel(model.model_id, enabled);
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(model.model_id);
        return next;
      });
      models.reload();
    }
  }


  return (
    <div className="oc-page">
      <div className="oc-search oc-search--wide">
        <Icon name="search" size={14} />
        <input type="search" value={search} placeholder={translator.t("models.oc.search")} aria-label={translator.t("models.oc.search")} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {models.error !== null ? <ErrorNote error={models.error} onRetry={models.reload} /> : null}
      {models.loading && models.value === null ? <StateBlock kind="loading" /> : null}
      {models.value !== null && groups.length === 0 && needle === "" ? (
        <div className="oc-empty oc-empty--block">
          <p>{translator.t("models.oc.empty")}</p>
          <button type="button" className="oc-more" onClick={onOpenProviders}>
            {translator.t("models.oc.open_providers")}
          </button>
        </div>
      ) : null}
      {models.value !== null && groups.length === 0 && needle !== "" ? <p className="oc-empty">{translator.t("models.oc.no_match")}</p> : null}

      {groups.map(({ view, models: list }) => {
        const name = providerName(translator, view);
        const isOpen = expanded(view.provider_id);
        const panel = `oc-models-${view.provider_id}`;
        const truncated = list.length > RENDER_LIMIT;
        return (
          <section className="oc-group" key={view.provider_id} aria-label={name}>
            <button type="button" className="oc-group__head" aria-expanded={isOpen} aria-controls={panel} onClick={() => flip(view.provider_id)}>
              <ProviderGlyph name={name} custom={view.kind === "CUSTOM_OPENAI_COMPATIBLE"} />
              <span className="oc-group__name">{name}</span>
              <span className={isOpen ? "oc-caret is-open" : "oc-caret"} aria-hidden="true">
                ▸
              </span>
            </button>
            {isOpen ? (
              <>
                {truncated ? <p className="oc-source">{translator.t("models.truncated", { shown: RENDER_LIMIT, total: list.length })}</p> : null}
                <ul className="oc-card" id={panel}>
                  {list.slice(0, RENDER_LIMIT).map((m) => (
                    <li className="oc-row oc-row--model" key={m.model_id} title={m.provider_model_id}>
                      <span className="oc-row__name">{label(m)}</span>
                      <Toggle on={m.enabled} label={translator.t(m.enabled ? "models.oc.hide" : "models.oc.show", { name: label(m) })} disabled={pending.has(m.model_id)} onChange={(next) => void toggle(m, next)} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        );
      })}

      {models.value === null || usable.length === 0 ? null : (
        <section className="oc-group" aria-labelledby="oc-reviewer-title">
          <h3 className="oc-group__name" id="oc-reviewer-title">
            {translator.t("models.review_model")}
          </h3>
          <div className="oc-card">
            <div className="oc-row">
              <label className="visually-hidden" htmlFor="oc-reviewer">
                {translator.t("models.review_model")}
              </label>
              <select id="oc-reviewer" className="select" value={preferences?.review_model_id ?? ""} disabled={savingReviewer} aria-describedby="oc-reviewer-hint" onChange={(event) => void chooseReviewer(event.target.value)}>
                <option value="">{translator.t("models.review_model.none")}</option>
                {usable.map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {label(m) + " — " + providerName(translator, views.find((p) => p.provider_id === m.provider_id) ?? { display_name: m.provider_id, display_name_key: "" })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="oc-source" id="oc-reviewer-hint">
            {translator.t(twoLocal ? "models.review_model.two_local" : "models.review_model.hint")}
          </p>
        </section>
      )}

      {models.value === null || usable.length === 0 ? null : (
        <section className="oc-group" aria-labelledby="oc-monitor-title">
          <h3 className="oc-group__name" id="oc-monitor-title">
            {translator.t("models.monitor_model")}
          </h3>
          <div className="oc-card">
            <div className="oc-row">
              <label className="visually-hidden" htmlFor="oc-monitor">
                {translator.t("models.monitor_model")}
              </label>
              <select id="oc-monitor" className="select" value={preferences?.monitor_model_id ?? ""} disabled={savingMonitor} aria-describedby="oc-monitor-hint" onChange={(event) => void chooseMonitor(event.target.value)}>
                <option value="">{translator.t("models.monitor_model.none")}</option>
                {usable.map((m) => (
                  <option key={m.model_id} value={m.model_id}>
                    {label(m) + " — " + providerName(translator, views.find((p) => p.provider_id === m.provider_id) ?? { display_name: m.provider_id, display_name_key: "" })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="oc-source" id="oc-monitor-hint">
            {translator.t("models.monitor_model.hint")}
          </p>
        </section>
      )}
    </div>
  );
}
