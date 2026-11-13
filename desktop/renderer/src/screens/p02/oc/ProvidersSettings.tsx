// «المزوّدون» في الإعدادات (ADR-037، على نمط OpenCode): المتصلون في بطاقة، ثم الشائعون بزرّ «اتصال»، ثم «عرض المزيد».
//
// «متصل» يعني مزوّدًا مفعّلًا: بعيد بمفتاحه، أو محلي بعنوانه، أو مخصّص. قطع الاتصال يحذف المفتاح المخزّن ويوقف المزوّد؛
// المخصّص يُحذف بتأكيد ثانٍ. لا فحص عند فتح الصفحة: الفحص يحدث عند الاتصال، ونتيجته تُقال.

import { useState } from "react";

import { useTranslator } from "../../../app/context";
import { useHostQuery } from "../../../app/useHostQuery";
import type { ProviderDescriptorView } from "../../../generated/types/desktop-p02-result-v1";
import type { Phase02Client } from "../../../ipc/p02-client";
import { providerName } from "../../../p02/present";
import { Icon } from "../../../ui/components/Icon";
import { ErrorNote } from "../../../ui/components/Notes";
import { StateBlock } from "../../../ui/components/StateBlock";
import { ConnectProviderDialog, type CatalogEntry, type ConnectStart } from "./ConnectProviderDialog";
import { ProviderGlyph } from "./shared";

/** كم شائعًا غير متصل يُعرض في الصفحة. البقية في «عرض المزيد». */
const POPULAR_SHOWN = 6;
/** حالات تستحقّ سطرًا تحت الاسم: المزوّد متصل لكنه لا يعمل. */
const BROKEN = new Set(["AUTH_FAILED", "AUTH_REQUIRED", "UNREACHABLE", "MISCONFIGURED", "RATE_LIMITED"]);

export function ProvidersSettings({ client }: { readonly client: Phase02Client }) {
  const translator = useTranslator();
  const providers = useHostQuery(() => client.listProviders(), [client]);
  const catalog = useHostQuery(() => client.providerCatalog(), [client]);
  const [dialog, setDialog] = useState<ConnectStart | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const views = providers.value?.providers ?? [];
  const entries = catalog.value?.entries ?? [];
  const connected = views
    .filter((p) => p.enabled)
    .sort((a, b) => rank(entries, a.provider_id) - rank(entries, b.provider_id) || providerName(translator, a).localeCompare(providerName(translator, b), translator.locale));
  const popular = entries
    .filter((e) => e.popular_rank !== undefined && !e.enabled && !connected.some((p) => p.provider_id === e.provider_id))
    .sort((a, b) => (a.popular_rank ?? 0) - (b.popular_rank ?? 0))
    .slice(0, POPULAR_SHOWN);

  const reload = () => {
    providers.reload();
    catalog.reload();
  };

  async function disconnect(view: ProviderDescriptorView): Promise<void> {
    const custom = view.kind === "CUSTOM_OPENAI_COMPATIBLE";
    if (custom && confirm !== view.provider_id) {
      setConfirm(view.provider_id);
      return;
    }
    setBusy(view.provider_id);
    setConfirm(null);
    setNote(null);
    try {
      const name = providerName(translator, view);
      if (custom) {
        const removed = await client.deleteCustomProvider(view.provider_id);
        setNote(removed.ok ? translator.t("providers.oc.deleted", { name }) : translator.t(removed.error.displayKey));
      } else {
        // الرسالة تقول ما حدث فعلًا (D-4): «أُزيل المفتاح» فقط حين أعاد المضيف CLEARED.
        let keyCleared = false;
        if (view.key_status.source === "CREDENTIAL_STORE") {
          const cleared = await client.clearProviderKey(view.provider_id);
          if (!cleared.ok) {
            setNote(translator.t(cleared.error.displayKey));
            return;
          }
          keyCleared = cleared.value.outcome === "CLEARED";
        }
        const off = await client.configureProvider({ provider_id: view.provider_id, enabled: false });
        setNote(off.ok ? translator.t(keyCleared ? "providers.oc.disconnected" : "providers.oc.disconnected_no_key", { name }) : translator.t(off.error.displayKey));
      }
    } finally {
      setBusy(null);
      reload();
    }
  }

  const tag = (view: ProviderDescriptorView): string => {
    if (view.kind === "CUSTOM_OPENAI_COMPATIBLE") return translator.t("providers.oc.tag.custom");
    if (view.locality === "LOCAL") return translator.t("providers.oc.tag.local");
    // أداة سطر أوامر: لا مفتاح؛ الدخول ملك الأداة.
    if (view.auth_mode === "CLI_LOGIN") return translator.t("providers.oc.tag.cli");
    if (view.key_status.source === "ENVIRONMENT") return translator.t("providers.oc.tag.env");
    return translator.t("providers.oc.tag.key");
  };

  const description = (entry: CatalogEntry): string => {
    const key = `providers.oc.description.${entry.provider_id}`;
    if (translator.has(key)) return translator.t(key);
    if (entry.documented_models > 0) return translator.t("providers.oc.description.models", { count: entry.documented_models });
    return translator.t("providers.oc.description.compatible");
  };

  return (
    <div className="oc-page">
      {note === null ? null : (
        <p className="oc-note" role="status">
          {note}
        </p>
      )}
      {providers.error !== null ? <ErrorNote error={providers.error} onRetry={reload} /> : null}
      {providers.loading && providers.value === null ? <StateBlock kind="loading" /> : null}

      <section className="oc-block" aria-labelledby="oc-connected-title">
        <h3 className="oc-block__title" id="oc-connected-title">
          {translator.t("providers.oc.connected")}
        </h3>
        {connected.length === 0 ? (
          <p className="oc-empty">{translator.t("providers.oc.connected.none")}</p>
        ) : (
          <ul className="oc-card">
            {connected.map((view) => {
              const name = providerName(translator, view);
              const broken = BROKEN.has(view.health.state);
              return (
                <li className="oc-row" key={view.provider_id}>
                  <ProviderGlyph name={name} custom={view.kind === "CUSTOM_OPENAI_COMPATIBLE"} />
                  <div className="oc-row__text">
                    <span className="oc-row__name">
                      {name}
                      <span className="oc-tag">{tag(view)}</span>
                    </span>
                    {broken ? (
                      <span className="oc-row__warn">
                        {translator.t(`p02.health.${view.health.state}`)} — {translator.t(`p02.health_reason.${view.health.reason_code}`)}
                      </span>
                    ) : null}
                  </div>
                  <button type="button" className={confirm === view.provider_id ? "oc-link-button is-danger" : "oc-link-button"} disabled={busy !== null} onClick={() => void disconnect(view)}>
                    {confirm === view.provider_id ? translator.t("providers.oc.delete_confirm") : translator.t(view.kind === "CUSTOM_OPENAI_COMPATIBLE" ? "providers.oc.delete" : "providers.oc.disconnect")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="oc-block" aria-labelledby="oc-popular-title">
        <h3 className="oc-block__title" id="oc-popular-title">
          {translator.t("providers.oc.popular")}
        </h3>
        {catalog.error !== null ? <ErrorNote error={catalog.error} onRetry={catalog.reload} /> : null}
        <ul className="oc-card">
          {popular.map((entry) => {
            const name = providerName(translator, entry);
            return (
              <li className="oc-row" key={entry.provider_id}>
                <ProviderGlyph name={name} />
                <div className="oc-row__text">
                  <span className="oc-row__name">{name}</span>
                  <span className="oc-row__desc">{description(entry)}</span>
                </div>
                <button type="button" className="button button--secondary oc-connect-button" onClick={() => setDialog({ step: "provider", providerId: entry.provider_id })}>
                  <Icon name="plus" size={13} />
                  <span>{translator.t("providers.oc.connect")}</span>
                </button>
              </li>
            );
          })}
          <li className="oc-row">
            <ProviderGlyph name="" custom />
            <div className="oc-row__text">
              <span className="oc-row__name">
                {translator.t("providers.oc.custom.short")}
                <span className="oc-tag">{translator.t("providers.oc.tag.custom")}</span>
              </span>
              <span className="oc-row__desc">{translator.t("providers.oc.custom.description")}</span>
            </div>
            <button type="button" className="button button--secondary oc-connect-button" onClick={() => setDialog({ step: "custom" })}>
              <Icon name="plus" size={13} />
              <span>{translator.t("providers.oc.connect")}</span>
            </button>
          </li>
        </ul>
        <button type="button" className="oc-more" onClick={() => setDialog({ step: "list" })}>
          {translator.t("providers.oc.more")}
        </button>
        {catalog.value === null ? null : (
          <p className="oc-source">{translator.t("providers.oc.source", { count: entries.length, date: catalog.value.retrieved })}</p>
        )}
      </section>

      {dialog === null ? null : (
        <ConnectProviderDialog
          client={client}
          entries={entries}
          providers={views}
          start={dialog}
          onClose={() => {
            setDialog(null);
            reload();
          }}
          onConnected={(name, discovered) => {
            setDialog(null);
            setNote(translator.plural("providers.oc.connected_note", discovered, { name }));
            reload();
          }}
        />
      )}
    </div>
  );
}

/** ترتيب المتصلين: الشائع بترتيبه، ثم البقية. */
function rank(entries: readonly CatalogEntry[], id: string): number {
  return entries.find((e) => e.provider_id === id)?.popular_rank ?? 10_000;
}
