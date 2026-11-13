// بطاقة مزوّد واحد (بتصميم مانوس): اسمه وحالته المقيسة في سطر، ومفتاح تشغيل، ثم ما يحتاجه ليعمل —
// نقطة النهاية (للمحلي) أو المفتاح (للبعيد) — وعدد نماذجه، وفحص الاتصال. التفاصيل الفنية مطويّة.
//
// المفتاح لا يُكتب هنا: زر «ضبط المفتاح» يطلب من المضيف نافذة النظام، والعارض يستلم حالة فقط. نقطة
// النهاية تُحرَّر للمحلي وحده، والمضيف يرفض غير الحلقة المحلية.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction } from "../../app/useHostQuery";
import type { ProviderDescriptorView } from "../../generated/types/desktop-p02-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import { healthTone, measured, providerName, shownHealth } from "../../p02/present";
import { ClaimBadge } from "../../ui/components/ClaimBadge";
import { Icon } from "../../ui/components/Icon";
import { ActionNote } from "../../ui/components/Notes";

const CAPABILITY_KEYS = [
  "supports_chat",
  "supports_streaming",
  "supports_model_listing",
  "supports_health_check",
  "supports_system_prompt",
  "supports_embeddings",
  "supports_vision",
  "supports_audio_input",
  "supports_audio_output",
  "supports_tools",
  "supports_json_schema",
  "supports_reasoning_control",
] as const;

export interface ProviderCardProps {
  readonly client: Phase02Client;
  readonly provider: ProviderDescriptorView;
  onChanged(): void;
}

/** حرفان من اسم المزوّد لشعاره الدائري. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
}

export function ProviderCard({ client, provider, onChanged }: ProviderCardProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const actions = useAction();
  const action = actions.state;
  const [endpoint, setEndpoint] = useState(provider.endpoint ?? "");
  const [open, setOpen] = useState(false);
  const name = providerName(translator, provider);
  const idBase = `provider-${provider.provider_id}`;
  const busy = action.phase === "RUNNING";
  const health = shownHealth(provider.health);
  const tone = healthTone(health.state);

  const toggle = () =>
    actions.run(
      () => client.configureProvider({ provider_id: provider.provider_id, enabled: !provider.enabled }),
      (value) => ({ phase: "DONE", messageKey: value.provider.enabled ? "providers.action.enabled" : "providers.action.disabled" }),
      onChanged,
    );

  const saveEndpoint = () =>
    actions.run(
      () => client.configureProvider({ provider_id: provider.provider_id, endpoint: endpoint.trim() }),
      () => ({ phase: "DONE", messageKey: "providers.action.endpoint_saved" }),
      onChanged,
    );

  const check = () =>
    actions.run(
      () => client.refreshProviders([provider.provider_id]),
      (value) => {
        const entry = value.results[0];
        return {
          phase: "DONE",
          messageKey: "providers.action.checked",
          values: { state: translator.t(`p02.health.${entry?.health.state ?? "UNKNOWN"}`), count: entry?.models.discovered ?? 0 },
        };
      },
      onChanged,
    );

  const setKey = () =>
    actions.run(
      () => client.setProviderKey(provider.provider_id),
      (value) => ({ phase: "DONE", messageKey: `providers.key.outcome.${value.outcome}` }),
      onChanged,
    );

  const clearKey = () =>
    actions.run(
      () => client.clearProviderKey(provider.provider_id),
      (value) => ({ phase: "DONE", messageKey: `providers.key.outcome.${value.outcome}` }),
      onChanged,
    );

  const key = provider.key_status;

  return (
    <article className={provider.enabled ? "item provider" : "item provider is-off"} aria-labelledby={`${idBase}-title`}>
      <header className="item__head provider__head">
        <span className={`provider__logo tone-${tone}`} aria-hidden="true">
          {initials(name)}
        </span>
        <div className="provider__title">
          <h2 className="item__title" id={`${idBase}-title`}>
            {name}
          </h2>
          <p className="provider__sub">
            <span>{translator.t(`p02.locality.${provider.locality}`)}</span>
            {provider.endpoint === undefined ? null : (
              <span className="mono" dir="ltr">
                {provider.endpoint}
              </span>
            )}
          </p>
        </div>
        <span className={`pill pill--${tone} provider__status tone-${tone}`} role="status">
          <span className="provider__dot" aria-hidden="true" />
          {translator.t("providers.health", {
            state: translator.t(`p02.health.${health.state}`),
            reason: translator.t(`p02.health_reason.${health.reason_code}`),
          })}
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={provider.enabled}
          aria-label={translator.t(provider.enabled ? "providers.action.disable" : "providers.action.enable")}
          title={translator.t(provider.enabled ? "providers.action.disable" : "providers.action.enable")}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <span className="switch__knob" aria-hidden="true" />
        </button>
      </header>

      {provider.locality === "REMOTE" ? <p className="provider__note">{translator.t("providers.remote.note")}</p> : null}

      <div className="provider__body">
        <button type="button" className="provider__models" onClick={() => navigation.navigate("/models")}>
          <Icon name="chip" size={15} />
          <span>
            {translator.t("providers.models.counts", { discovered: provider.models.discovered, enabled: provider.models.enabled, available: provider.models.available })}
          </span>
          <Icon name="chevron" size={13} />
        </button>

        {key.required ? (
          <div className="provider__key">
            <span className={key.configured ? "provider__key-state is-set" : "provider__key-state"}>
              <Icon name={key.configured ? "check" : "shield"} size={14} />
              {translator.t(key.configured ? `providers.key.source.${key.source}` : "providers.key.missing")}
            </span>
            {key.environment_variable === undefined ? null : <span className="row__hint">{translator.t("providers.key.env_hint", { name: key.environment_variable })}</span>}
            {key.store_available ? null : <span className="row__hint">{translator.t("providers.key.store_unavailable")}</span>}
            <span className="provider__spacer" />
            <button type="button" className="button button--secondary" disabled={busy || !key.store_available} onClick={() => void setKey()}>
              {translator.t("providers.action.set_key")}
            </button>
            {key.source === "CREDENTIAL_STORE" ? (
              <button type="button" className="button button--ghost" disabled={busy} onClick={() => void clearKey()}>
                {translator.t("providers.action.clear_key")}
              </button>
            ) : null}
          </div>
        ) : null}

        {provider.endpoint_configurable ? (
          <div className="provider__endpoint">
            <label className="visually-hidden" htmlFor={`${idBase}-endpoint`}>
              {translator.t("providers.endpoint.label")}
            </label>
            <input
              id={`${idBase}-endpoint`}
              className="input input--mono"
              dir="ltr"
              value={endpoint}
              inputMode="url"
              spellCheck={false}
              placeholder={translator.t("providers.endpoint.label")}
              aria-describedby={`${idBase}-endpoint-hint`}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <button type="button" className="button button--secondary" disabled={busy || endpoint.trim() === "" || endpoint.trim() === (provider.endpoint ?? "")} onClick={() => void saveEndpoint()}>
              {translator.t("providers.endpoint.save")}
            </button>
            <p className="row__hint" id={`${idBase}-endpoint-hint`}>
              {translator.t("providers.endpoint.hint")}
            </p>
          </div>
        ) : null}
      </div>

      <footer className="provider__foot">
        <button type="button" className="button button--secondary" disabled={busy || !provider.enabled} onClick={() => void check()}>
          <Icon name="activity" size={14} />
          <span>{translator.t("providers.action.check")}</span>
        </button>
        <span className="provider__checked">
          {translator.t("providers.fact.checked_at")}: {provider.health.checked_at === undefined ? translator.t("p02.value.never") : new Date(provider.health.checked_at).toLocaleString(translator.locale)}
        </span>
        <span className="provider__spacer" />
        <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {translator.t("providers.capabilities.title")}
        </button>
      </footer>

      <ActionNote state={action} />

      {open ? (
        <div className="provider__details">
          <dl className="facts">
            <div>
              <dt className="fact__label">{translator.t("providers.fact.installation")}</dt>
              <dd className="fact__value">{translator.t(`p02.installation.${provider.health.installation}`)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("providers.fact.runtime")}</dt>
              <dd className="fact__value">{translator.t(`p02.runtime.${provider.health.runtime}`)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("providers.fact.latency")}</dt>
              <dd className="fact__value">{measured(translator, provider.health.latency)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("providers.fact.endpoint")}</dt>
              <dd className="fact__value mono">{provider.endpoint ?? translator.t("providers.endpoint.none")}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("ui.provider.network")}</dt>
              <dd className="fact__value">{translator.t(`p02.network_class.${provider.network_class}`)}</dd>
            </div>
          </dl>
          <ul className="rows">
            {CAPABILITY_KEYS.map((capability) => (
              <li className="row" key={capability}>
                <span className="row__label">{translator.t(`providers.capability.${capability}`)}</span>
                <span className="row__value">
                  <ClaimBadge support={provider.capabilities[capability].support} provenance={provider.capabilities[capability].provenance} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
