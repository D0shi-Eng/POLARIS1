// نافذة «الاتصال بمزوّد» (ADR-037، على نمط OpenCode): بحث وقائمة (شائع، محلي، أخرى)، ثم خطوة المزوّد الواحد.
//
// المزوّد بمفتاح: حقل المفتاح داخل التطبيق (قرار المالك 2026-10-06)، يُرسل مرة في عمليته وحدها، ويُخزَّن في مخزن
// بيانات الاعتماد في النظام، ثم يُمسح من الحقل. بعده يُفعَّل المزوّد ويُفحص فعلًا: النجاح يُغلق النافذة، والرفض يبقى فيها
// بسببه المقيس (رفض المفتاح، أو تعذّر الوصول). المحلي: عنوانه على هذا الحاسوب. المخصّص: معرّف واسم وعنوان ونماذج.

import { useMemo, useState } from "react";

import { useTranslator } from "../../../app/context";
import type { ProviderDescriptorView } from "../../../generated/types/desktop-p02-result-v1";
import type { ProviderCatalogResultV1 } from "../../../generated/types/desktop-p08-result-v1";
import type { Phase02Client } from "../../../ipc/p02-client";
import { providerName } from "../../../p02/present";
import { Icon } from "../../../ui/components/Icon";
import { ProviderGlyph, Sheet } from "./shared";

export type CatalogEntry = ProviderCatalogResultV1["entries"][number];

export type ConnectStart = { readonly step: "list" } | { readonly step: "provider"; readonly providerId: string } | { readonly step: "custom" };

export interface ConnectProviderDialogProps {
  readonly client: Phase02Client;
  readonly entries: readonly CatalogEntry[];
  readonly providers: readonly ProviderDescriptorView[];
  readonly start: ConnectStart;
  onClose(): void;
  /** نجح الاتصال والفحص: الاسم وعدد النماذج المكتشفة. */
  onConnected(name: string, discovered: number): void;
}

type Step = { readonly step: "list" } | { readonly step: "provider"; readonly entry: CatalogEntry } | { readonly step: "custom" };

export function ConnectProviderDialog({ client, entries, providers, start, onClose, onConnected }: ConnectProviderDialogProps) {
  const [step, setStep] = useState<Step>(() => {
    if (start.step === "provider") {
      const entry = entries.find((e) => e.provider_id === start.providerId);
      if (entry !== undefined) return { step: "provider", entry };
    }
    return start.step === "custom" ? { step: "custom" } : { step: "list" };
  });
  const back = start.step === "list" && step.step !== "list" ? () => setStep({ step: "list" }) : undefined;
  return (
    <Sheet labelledBy="oc-connect-title" onClose={onClose} onBack={back}>
      {step.step === "list" ? (
        <ProviderList entries={entries} onPick={(entry) => setStep({ step: "provider", entry })} onCustom={() => setStep({ step: "custom" })} />
      ) : step.step === "provider" ? (
        <ProviderStep client={client} entry={step.entry} view={providers.find((p) => p.provider_id === step.entry.provider_id)} onConnected={onConnected} />
      ) : (
        <CustomStep client={client} taken={entries.map((e) => e.provider_id)} onConnected={onConnected} />
      )}
    </Sheet>
  );
}

function ProviderList({ entries, onPick, onCustom }: { readonly entries: readonly CatalogEntry[]; onPick(entry: CatalogEntry): void; onCustom(): void }) {
  const translator = useTranslator();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const name = (e: CatalogEntry) => providerName(translator, e);
  const hit = (e: CatalogEntry) => needle === "" || name(e).toLowerCase().includes(needle) || e.provider_id.includes(needle);
  const popular = entries.filter((e) => e.popular_rank !== undefined && hit(e)).sort((a, b) => (a.popular_rank ?? 0) - (b.popular_rank ?? 0));
  const local = entries.filter((e) => e.locality === "LOCAL" && e.kind !== "CUSTOM_OPENAI_COMPATIBLE" && hit(e));
  const others = entries
    .filter((e) => e.popular_rank === undefined && !(e.locality === "LOCAL" && e.kind !== "CUSTOM_OPENAI_COMPATIBLE") && hit(e))
    .sort((a, b) => name(a).localeCompare(name(b), translator.locale));
  const customHit = needle === "" || translator.t("providers.oc.custom.title").toLowerCase().includes(needle);

  const row = (e: CatalogEntry) => (
    <li key={e.provider_id}>
      <button type="button" className="oc-pick" onClick={() => onPick(e)}>
        <ProviderGlyph name={name(e)} custom={e.kind === "CUSTOM_OPENAI_COMPATIBLE"} />
        <span className="oc-pick__name">{name(e)}</span>
        {e.enabled ? <span className="oc-tag">{translator.t("providers.oc.tag.connected")}</span> : null}
        {e.kind === "CUSTOM_OPENAI_COMPATIBLE" ? <span className="oc-tag">{translator.t("providers.oc.tag.custom")}</span> : null}
      </button>
    </li>
  );

  return (
    <div className="oc-connect">
      <h2 className="oc-sheet__title" id="oc-connect-title">
        {translator.t("providers.oc.connect.title")}
      </h2>
      <div className="oc-search">
        <Icon name="search" size={14} />
        <input type="search" value={query} placeholder={translator.t("providers.oc.connect.search")} aria-label={translator.t("providers.oc.connect.search")} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="oc-connect__lists">
        {popular.length === 0 ? null : (
          <section aria-label={translator.t("providers.oc.connect.popular")}>
            <h3 className="oc-connect__group">{translator.t("providers.oc.connect.popular")}</h3>
            <ul className="oc-picks">{popular.map(row)}</ul>
          </section>
        )}
        {local.length === 0 ? null : (
          <section aria-label={translator.t("providers.oc.connect.local")}>
            <h3 className="oc-connect__group">{translator.t("providers.oc.connect.local")}</h3>
            <ul className="oc-picks">{local.map(row)}</ul>
          </section>
        )}
        <section aria-label={translator.t("providers.oc.connect.other")}>
          <h3 className="oc-connect__group">{translator.t("providers.oc.connect.other")}</h3>
          <ul className="oc-picks">
            {customHit ? (
              <li>
                <button type="button" className="oc-pick" onClick={onCustom}>
                  <ProviderGlyph name="" custom />
                  <span className="oc-pick__name">{translator.t("providers.oc.custom.title")}</span>
                  <span className="oc-tag">{translator.t("providers.oc.tag.custom")}</span>
                </button>
              </li>
            ) : null}
            {others.map(row)}
          </ul>
        </section>
        {popular.length + local.length + others.length === 0 && !customHit ? <p className="oc-empty">{translator.t("providers.oc.connect.none")}</p> : null}
      </div>
    </div>
  );
}

/** نصّ سبب فشل الاتصال من الفحص المقيس. */
function failure(translator: ReturnType<typeof useTranslator>, state: string, reason: string): string {
  return translator.t("providers.oc.connect.failed", { state: translator.t(`p02.health.${state}`), reason: translator.t(`p02.health_reason.${reason}`) });
}

function ProviderStep({ client, entry, view, onConnected }: { readonly client: Phase02Client; readonly entry: CatalogEntry; readonly view: ProviderDescriptorView | undefined; onConnected(name: string, discovered: number): void }) {
  const translator = useTranslator();
  const name = providerName(translator, entry);
  const local = entry.locality === "LOCAL";
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState(view?.endpoint ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stored = view?.key_status.source === "CREDENTIAL_STORE";
  const fromEnvironment = entry.environment_key_present;
  // أداة سطر أوامر تحمل تسجيل دخولها بنفسها: لا مفتاح ولا عنوان يُدخلان.
  const cli = entry.auth_mode === "CLI_LOGIN";
  // المفتاح مطلوب ما لم يكن مخزّنًا أو في متغيّر البيئة.
  const canContinue = !busy && (cli || (local ? endpoint.trim() !== "" : key.trim() !== "" || stored || fromEnvironment));

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (!local && key.trim() !== "") {
        const put = await client.putProviderKey(entry.provider_id, key.trim());
        // الحقل يُفرَّغ فور الإرسال، نجح أم لا: لا تبقى القيمة في حالة الواجهة.
        setKey("");
        if (!put.ok) return setError(translator.t("providers.oc.connect.store_failed"));
        if (put.value.outcome !== "STORED") return setError(translator.t(`providers.key.outcome.${put.value.outcome}`));
      }
      const configured = await client.configureProvider(local ? { provider_id: entry.provider_id, enabled: true, endpoint: endpoint.trim() } : { provider_id: entry.provider_id, enabled: true });
      if (!configured.ok) return setError(translator.t(configured.error.displayKey));
      const refreshed = await client.refreshProviders([entry.provider_id]);
      if (!refreshed.ok) return setError(translator.t(refreshed.error.displayKey));
      const result = refreshed.value.results[0];
      if (result === undefined || result.health.state !== "HEALTHY") {
        return setError(failure(translator, result?.health.state ?? "UNKNOWN", result?.health.reason_code ?? "NOT_CHECKED"));
      }
      onConnected(name, result.models.discovered);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="oc-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canContinue) void connect();
      }}
    >
      <h2 className="oc-sheet__title oc-sheet__title--brand" id="oc-connect-title">
        <ProviderGlyph name={name} />
        <span>{translator.t("providers.oc.connect.to", { name })}</span>
      </h2>
      <p className="oc-form__lead">{translator.t(cli ? "providers.oc.connect.cli_lead" : local ? "providers.oc.connect.local_lead" : "providers.oc.connect.key_lead", { name })}</p>
      {cli ? null : local ? (
        <label className="oc-field">
          <span className="oc-field__label">{translator.t("providers.oc.connect.endpoint")}</span>
          <input className="oc-input" dir="ltr" value={endpoint} inputMode="url" spellCheck={false} placeholder={translator.t("providers.oc.placeholder.endpoint")} onChange={(event) => setEndpoint(event.target.value)} />
          <span className="oc-field__hint">{translator.t("providers.endpoint.hint")}</span>
        </label>
      ) : (
        <label className="oc-field">
          <span className="oc-field__label">{translator.t("providers.oc.connect.key_label", { name })}</span>
          <input
            className="oc-input"
            dir="ltr"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={translator.t("providers.oc.connect.key_placeholder")}
            onChange={(event) => setKey(event.target.value)}
          />
          {stored ? <span className="oc-field__hint">{translator.t("providers.oc.connect.key_stored")}</span> : null}
          {!stored && fromEnvironment ? <span className="oc-field__hint">{translator.t("providers.oc.connect.key_env", { name: entry.environment_variable ?? "" })}</span> : null}
        </label>
      )}
      {error === null ? null : (
        <p className="oc-form__error" role="alert">
          {error}
        </p>
      )}
      <div className="oc-form__actions">
        <button type="submit" className="button button--secondary oc-continue" disabled={!canContinue}>
          {busy ? translator.t("providers.oc.connect.checking") : translator.t("providers.oc.connect.continue")}
        </button>
      </div>
    </form>
  );
}

interface DraftModel {
  readonly id: number;
  readonly model_id: string;
  readonly display_name: string;
}

const ID_SHAPE = /^[a-z][a-z0-9-]{1,47}$/;

function CustomStep({ client, taken, onConnected }: { readonly client: Phase02Client; readonly taken: readonly string[]; onConnected(name: string, discovered: number): void }) {
  const translator = useTranslator();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<readonly DraftModel[]>([{ id: 1, model_id: "", display_name: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idOk = ID_SHAPE.test(id) && !taken.includes(id);
  const filled = useMemo(() => models.filter((m) => m.model_id.trim() !== ""), [models]);
  const canSubmit = !busy && idOk && name.trim() !== "" && /^https?:\/\/\S+$/.test(base.trim());

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const saved = await client.saveCustomProvider({
        provider_id: id,
        display_name: name.trim(),
        base_url: base.trim(),
        models: filled.map((m) => (m.display_name.trim() === "" ? { model_id: m.model_id.trim() } : { model_id: m.model_id.trim(), display_name: m.display_name.trim() })),
      });
      if (!saved.ok) return setError(translator.t(saved.error.displayKey));
      if (key.trim() !== "") {
        const put = await client.putProviderKey(id, key.trim());
        setKey("");
        if (!put.ok || put.value.outcome !== "STORED") return setError(translator.t("providers.oc.connect.store_failed"));
      }
      const refreshed = await client.refreshProviders([id]);
      const result = refreshed.ok ? refreshed.value.results[0] : undefined;
      if (result === undefined || result.health.state !== "HEALTHY") {
        // المزوّد حُفظ؛ الفحص هو ما فشل، ويُقال سببه. الإغلاق يبقيه في «المتصلين» بحالته.
        return setError(failure(translator, result?.health.state ?? "UNKNOWN", result?.health.reason_code ?? "NOT_CHECKED"));
      }
      onConnected(name.trim(), result.models.discovered);
    } finally {
      setBusy(false);
    }
  }

  const setModel = (row: number, patch: Partial<DraftModel>) => setModels((list) => list.map((m) => (m.id === row ? { ...m, ...patch } : m)));

  return (
    <form
      className="oc-form oc-form--custom"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <h2 className="oc-sheet__title oc-sheet__title--brand" id="oc-connect-title">
        <ProviderGlyph name="" custom />
        <span>{translator.t("providers.oc.custom.title")}</span>
      </h2>
      <p className="oc-form__lead">{translator.t("providers.oc.custom.lead")}</p>
      <label className="oc-field">
        <span className="oc-field__label">{translator.t("providers.oc.custom.id")}</span>
        <input className="oc-input" dir="ltr" value={id} spellCheck={false} placeholder={translator.t("providers.oc.placeholder.id")} onChange={(event) => setId(event.target.value.toLowerCase())} />
        <span className={id !== "" && !idOk ? "oc-field__hint is-error" : "oc-field__hint"}>
          {id !== "" && taken.includes(id) ? translator.t("providers.oc.custom.id_taken") : translator.t("providers.oc.custom.id_hint")}
        </span>
      </label>
      <label className="oc-field">
        <span className="oc-field__label">{translator.t("providers.oc.custom.name")}</span>
        <input className="oc-input" value={name} maxLength={64} placeholder={translator.t("providers.oc.custom.name_placeholder")} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="oc-field">
        <span className="oc-field__label">{translator.t("providers.oc.custom.base")}</span>
        <input className="oc-input" dir="ltr" value={base} inputMode="url" spellCheck={false} placeholder={translator.t("providers.oc.placeholder.base")} onChange={(event) => setBase(event.target.value)} />
        <span className="oc-field__hint">{translator.t("providers.oc.custom.base_hint")}</span>
      </label>
      <label className="oc-field">
        <span className="oc-field__label">{translator.t("providers.oc.custom.key")}</span>
        <input className="oc-input" dir="ltr" type="password" autoComplete="off" spellCheck={false} value={key} placeholder={translator.t("providers.oc.connect.key_placeholder")} onChange={(event) => setKey(event.target.value)} />
        <span className="oc-field__hint">{translator.t("providers.oc.custom.key_hint")}</span>
      </label>
      <fieldset className="oc-field oc-models">
        <legend className="oc-field__label">{translator.t("providers.oc.custom.models")}</legend>
        {models.map((m) => (
          <div className="oc-models__row" key={m.id}>
            <input className="oc-input" dir="ltr" spellCheck={false} value={m.model_id} placeholder={translator.t("providers.oc.placeholder.model")} aria-label={translator.t("providers.oc.custom.model_id")} onChange={(event) => setModel(m.id, { model_id: event.target.value.replace(/\s/g, "") })} />
            <input className="oc-input" value={m.display_name} placeholder={translator.t("providers.oc.custom.model_name")} aria-label={translator.t("providers.oc.custom.model_name")} onChange={(event) => setModel(m.id, { display_name: event.target.value })} />
            <button type="button" className="icon-button" aria-label={translator.t("providers.oc.custom.remove_model")} title={translator.t("providers.oc.custom.remove_model")} disabled={models.length === 1} onClick={() => setModels((list) => list.filter((x) => x.id !== m.id))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="oc-add" disabled={models.length >= 64} onClick={() => setModels((list) => [...list, { id: Math.max(...list.map((x) => x.id)) + 1, model_id: "", display_name: "" }])}>
          <Icon name="plus" size={13} />
          <span>{translator.t("providers.oc.custom.add_model")}</span>
        </button>
      </fieldset>
      {error === null ? null : (
        <p className="oc-form__error" role="alert">
          {error}
        </p>
      )}
      <div className="oc-form__actions">
        <button type="submit" className="button button--secondary oc-continue" disabled={!canSubmit}>
          {busy ? translator.t("providers.oc.connect.checking") : translator.t("providers.oc.custom.submit")}
        </button>
      </div>
    </form>
  );
}
