// المزوّدون: كل مزوّد مسجّل في المضيف، بصحته المقيسة لا المفترضة.
//
// لا فحص تلقائي عند فتح الصفحة: القائمة تُقرأ من المخزن بلا شبكة، والفحص فعلٌ
// يطلبه المستخدم. لا مسح لمنافذ، ولا بحث في الشبكة المحلية.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery, type ActionState } from "../../app/useHostQuery";
import type { Phase02Client } from "../../ipc/p02-client";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { ProviderCard } from "./ProviderCard";

export function ProvidersScreen({ client }: { readonly client: Phase02Client }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const query = useHostQuery(() => client.listProviders(), [client]);
  const [action, setAction] = useState<ActionState>({ phase: "IDLE" });
  const providers = query.value?.providers ?? [];
  const enabled = providers.filter((provider) => provider.enabled).map((provider) => provider.provider_id);

  async function checkAll(): Promise<void> {
    if (enabled.length === 0) return;
    setAction({ phase: "RUNNING" });
    const result = await client.refreshProviders(enabled);
    if (result.ok) {
      const healthy = result.value.results.filter((entry) => entry.health.state === "HEALTHY").length;
      setAction({ phase: "DONE", messageKey: "providers.action.checked_all", values: { healthy, total: result.value.results.length } });
    } else {
      setAction({ phase: "FAILED", error: result.error });
    }
    query.reload();
  }

  const local = providers.filter((p) => p.locality === "LOCAL");
  const remote = providers.filter((p) => p.locality !== "LOCAL");

  return (
    <div className="page page--narrow">
      <header className="page-head">
        <div>
          <h1 className="page-title">{translator.t("providers.title")}</h1>
          <p className="page-subtitle">{translator.t("providers.subtitle")}</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="button button--secondary" onClick={() => navigation.navigate("/models")}>
            {translator.t("providers.action.open_models")}
          </button>
          <button type="button" className="button button--primary" disabled={action.phase === "RUNNING" || enabled.length === 0} onClick={() => void checkAll()}>
            {translator.t("providers.action.check_all")}
          </button>
        </div>
      </header>
      <ActionNote state={action} />

      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {query.loading && query.value === null ? <StateBlock kind="loading" /> : null}
      {!query.loading && query.value !== null && providers.length === 0 ? <StateBlock kind="empty" bodyKey="providers.empty" /> : null}

      {[
        { id: "providers-local", key: "ui.providers.local", list: local },
        { id: "providers-remote", key: "ui.providers.remote", list: remote },
      ].map((group) =>
        group.list.length === 0 ? null : (
          <section key={group.id} className="provider-group" aria-labelledby={group.id}>
            <h2 className="model-group__title" id={group.id}>
              <span>{translator.t(group.key)}</span>
              <span className="model-group__count">{group.list.length}</span>
            </h2>
            <div className="list-card" aria-label={translator.t("providers.list")}>
              {group.list.map((provider) => (
                <ProviderCard key={provider.provider_id} client={client} provider={provider} onChanged={query.reload} />
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
