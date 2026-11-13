// النماذج: ما اكتشفه المضيف فعلًا، وما فعّله المستخدم، والنموذج الافتراضي، ونموذج المراجعة إن اختاره.
//
// لا خيار «محلي/بعيد» (ADR-040): كل نموذج مفعَّل يُختار، محليًّا كان أو عبر API. موقع النموذج يظهر وصفًا في صفّه فقط.
//
// لا نموذج يظهر هنا ما لم يُكتشف من مزوّد حقيقي. القائمة الفارغة تقول ذلك وتدلّ
// على صفحة المزوّدين، ولا تعرض أمثلة.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery, type HostCall } from "../../app/useHostQuery";
import type { ModelView } from "../../generated/types/desktop-p02-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import { providerName } from "../../p02/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { Icon } from "../../ui/components/Icon";
import { InvokePanel } from "./InvokePanel";
import { ModelRow } from "./ModelRow";

/** حدّ العرض. المضيف قد يعيد آلافًا من مزوّد بعيد؛ الشاشة تعرض أول دفعة وتقول ذلك. */
const RENDER_LIMIT = 300;

export function ModelsScreen({ client }: { readonly client: Phase02Client }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const [providerFilter, setProviderFilter] = useState("");
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"ALL" | "ENABLED">("ALL");
  const actions = useAction();
  const action = actions.state;
  const providers = useHostQuery(() => client.listProviders(), [client]);
  const models = useHostQuery(
    () => client.listModels(providerFilter === "" ? {} : { provider_id: providerFilter }),
    [client, providerFilter],
  );

  const labels = new Map((providers.value?.providers ?? []).map((provider) => [provider.provider_id, providerName(translator, provider)]));
  const all = models.value?.models ?? [];
  const visible = all.filter((model) => !onlyEnabled || model.enabled);
  const preferences = models.value?.preferences;
  const busy = action.phase === "RUNNING";

  const run = (call: HostCall, messageKey: string) =>
    actions.run(call, () => ({ phase: "DONE", messageKey }), models.reload);

  const toggle = (model: ModelView) =>
    void run(() => client.configureModel(model.model_id, !model.enabled), model.enabled ? "models.action.disabled" : "models.action.enabled");
  const makeDefault = (model: ModelView) =>
    void run(() => client.setModelPreferences({ default_model_id: model.model_id }), "models.action.default_set");
  const clearDefault = () => void run(() => client.setModelPreferences({ default_model_id: null }), "models.action.default_cleared");
  const setReviewer = (value: string) =>
    void run(() => client.setModelPreferences({ review_model_id: value === "" ? null : value }), value === "" ? "models.action.review_cleared" : "models.action.review_set");

  const needle = search.trim().toLowerCase();
  const shown = visible
    .filter((m) => scope === "ALL" || m.enabled)
    .filter((m) => needle === "" || [m.display_name.value ?? "", m.provider_model_id, labels.get(m.provider_id) ?? ""].join(" ").toLowerCase().includes(needle));
  const groups = [...new Set(shown.map((m) => m.provider_id))].map((id) => ({ id, models: shown.filter((m) => m.provider_id === id) }));
  const usableModels = all.filter((m) => m.enabled && m.provider_enabled && m.kind !== "EMBEDDING");
  const reviewer = usableModels.find((m) => m.model_id === preferences?.review_model_id);
  const executor = usableModels.find((m) => m.model_id === preferences?.default_model_id);
  // قيد العتاد: نموذجان محليّان مختلفان قد يحمّلهما الخادم معًا. يُنبَّه إليه، ولا يُمنع (الاختيار للمستخدم).
  const twoLocal = reviewer !== undefined && executor !== undefined && reviewer.model_id !== executor.model_id && reviewer.locality === "LOCAL" && executor.locality === "LOCAL";

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">{translator.t("models.title")}</h1>
          <p className="page-subtitle">{translator.t("models.subtitle")}</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => navigation.navigate("/providers")}>
          {translator.t("models.action.open_providers")}
        </button>
      </header>

      <section className="panel" aria-labelledby="models-preferences">
        <h2 className="panel__title" id="models-preferences">
          {translator.t("models.preferences")}
        </h2>
        <div className="panel__row">
          <label className="panel__label" htmlFor="models-default">
            {translator.t("models.default_model")}
          </label>
          <select
            id="models-default"
            className="select"
            value={preferences?.default_model_id ?? ""}
            disabled={busy || preferences === undefined}
            onChange={(event) => (event.target.value === "" ? clearDefault() : void run(() => client.setModelPreferences({ default_model_id: event.target.value }), "models.action.default_set"))}
          >
            <option value="">{translator.t("p02.value.none")}</option>
            {usableModels.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {(m.display_name.value ?? m.provider_model_id) + " — " + (labels.get(m.provider_id) ?? m.provider_id)}
              </option>
            ))}
          </select>
          <button type="button" className="button button--ghost" disabled={busy || preferences?.default_model_id === undefined} onClick={clearDefault}>
            {translator.t("models.action.clear_default")}
          </button>
        </div>
        <div className="panel__row">
          <label className="panel__label" htmlFor="models-reviewer">
            {translator.t("models.review_model")}
          </label>
          <select
            id="models-reviewer"
            className="select"
            value={preferences?.review_model_id ?? ""}
            disabled={busy || preferences === undefined}
            aria-describedby="models-reviewer-hint"
            onChange={(event) => setReviewer(event.target.value)}
          >
            <option value="">{translator.t("models.review_model.none")}</option>
            {usableModels.map((m) => (
              <option key={m.model_id} value={m.model_id}>
                {(m.display_name.value ?? m.provider_model_id) + " — " + (labels.get(m.provider_id) ?? m.provider_id)}
              </option>
            ))}
          </select>
        </div>
        <p className="row__hint" id="models-reviewer-hint">
          {translator.t(twoLocal ? "models.review_model.two_local" : "models.review_model.hint")}
        </p>
      </section>
      <ActionNote state={action} />

      <div className="list-tools">
        <div className="search-box">
          <Icon name="search" size={15} />
          <label className="visually-hidden" htmlFor="models-search">
            {translator.t("ui.models.search")}
          </label>
          <input id="models-search" type="search" placeholder={translator.t("ui.models.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="segmented" role="tablist" aria-label={translator.t("models.filter.provider")}>
          {(["ALL", "ENABLED"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={scope === value} className={"segmented__item" + (scope === value ? " is-current" : "")} onClick={() => setScope(value)}>
              {translator.t("ui.models.scope." + value)}
            </button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="models-provider">
          {translator.t("models.filter.provider")}
        </label>
        <select id="models-provider" className="select" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
          <option value="">{translator.t("models.filter.all")}</option>
          {(providers.value?.providers ?? []).map((provider) => (
            <option key={provider.provider_id} value={provider.provider_id}>
              {providerName(translator, provider)}
            </option>
          ))}
        </select>
        <label className="check visually-hidden" htmlFor="models-only-enabled">
          <input id="models-only-enabled" type="checkbox" checked={onlyEnabled} onChange={(event) => setOnlyEnabled(event.target.checked)} />
          {translator.t("models.filter.only_enabled")}
        </label>
      </div>

      {models.error !== null ? <ErrorNote error={models.error} onRetry={models.reload} /> : null}
      {models.loading && models.value === null ? <StateBlock kind="loading" /> : null}
      {models.value !== null && all.length === 0 ? (
        <StateBlock
          kind="empty"
          titleKey="models.empty.title"
          bodyKey="models.empty.body"
          action={{ labelKey: "models.action.open_providers", onSelect: () => navigation.navigate("/providers") }}
        />
      ) : null}

      {groups.map((g) => (
        <section key={g.id} className="model-group" aria-label={labels.get(g.id) ?? g.id}>
          <h2 className="model-group__title">
            <span>{labels.get(g.id) ?? g.id}</span>
            <span className="model-group__count">{g.models.length}</span>
          </h2>
          {Math.max(0, g.models.length - RENDER_LIMIT) === 0 ? null : <p className="note">{translator.t("models.truncated", { shown: RENDER_LIMIT, total: g.models.length })}</p>}
          <ul className="model-list" aria-label={translator.t("models.list")}>
            {g.models.slice(0, RENDER_LIMIT).map((model) => (
              <ModelRow key={model.model_id} model={model} providerLabel={labels.get(model.provider_id) ?? model.provider_id} busy={busy} onToggle={toggle} onMakeDefault={makeDefault} />
            ))}
          </ul>
        </section>
      ))}

      {all.length === 0 ? null : (
        <details className="panel panel--fold">
          <summary className="panel__title">{translator.t("ui.models.try")}</summary>
          <InvokePanel client={client} models={all} idBase="models-invoke" />
        </details>
      )}
    </div>
  );
}
