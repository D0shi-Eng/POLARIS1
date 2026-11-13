// صفّ نموذج واحد (بتصميم مانوس): الاسم وشارة «الافتراضي»، وسطر حقائق (المزوّد، المحلّية، الحجم، السياق،
// التكميم)، وحالة التوفّر، ومفتاح تشغيل، و«اجعله الافتراضي». المكتشف والمفعّل والمتاح والمحمَّل حقائق منفصلة،
// والتفاصيل (القدرات وأصل كل حقيقة) مطويّة.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { ModelView } from "../../generated/types/desktop-p02-result-v1";
import { formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { availabilityTone, factText } from "../../p02/present";
import { ClaimBadge } from "../../ui/components/ClaimBadge";

export interface ModelRowProps {
  readonly model: ModelView;
  readonly providerLabel: string;
  readonly busy: boolean;
  onToggle(model: ModelView): void;
  onMakeDefault(model: ModelView): void;
}

export function ModelRow({ model, providerLabel, busy, onToggle, onMakeDefault }: ModelRowProps) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [open, setOpen] = useState(false);
  const contextWindow = model.context_window.value;
  const name = model.display_name.value ?? model.provider_model_id;
  const facts = [
    providerLabel,
    translator.t(`p02.locality.${model.locality}`),
    translator.t(`models.kind.${model.kind}`),
    model.parameter_count.value,
    contextWindow === undefined ? undefined : translator.t("ui.model.context", { count: formatNumber(locale, Math.round(contextWindow / 1000)) }),
    model.quantization.value,
    model.loaded_state.value === "LOADED" ? translator.t(`models.loaded.${model.loaded_state.value}`) : undefined,
  ].filter((f): f is string => f !== undefined && f !== "");
  return (
    <li className={model.enabled ? "model-row" : "model-row is-off"}>
      <div className="model-row__main">
        <div className="model-row__text">
          <p className="model-row__name">
            <span className="mono" dir="ltr">
              {name}
            </span>
            {model.is_default ? <span className="pill pill--POSITIVE">{translator.t("models.default")}</span> : null}
            {model.stale ? <span className="row__hint">{translator.t("models.stale")}</span> : null}
          </p>
          <p className="model-row__facts">{facts.join(" · ")}</p>
        </div>
        <span className={`pill pill--${availabilityTone(model.availability)}`}>{translator.t(`models.availability.${model.availability}`)}</span>
        <button
          type="button"
          className="button button--ghost model-row__default"
          disabled={busy || model.is_default || !model.enabled}
          aria-label={translator.t("models.action.make_default_named", { name })}
          onClick={() => onMakeDefault(model)}
        >
          {translator.t("models.action.make_default")}
        </button>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={model.enabled}
          disabled={busy}
          aria-label={translator.t(model.enabled ? "models.action.disable_named" : "models.action.enable_named", { name })}
          title={translator.t(model.enabled ? "models.action.disable" : "models.action.enable")}
          onClick={() => onToggle(model)}
        >
          <span className="switch__knob" aria-hidden="true" />
        </button>
        <button type="button" className="link-button model-row__more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {translator.t("models.details")}
        </button>
      </div>
      {open ? (
        <div className="model-row__details">
          <dl className="facts">
            <div>
              <dt className="fact__label">{translator.t("models.fact.model_id")}</dt>
              <dd className="fact__value mono">{model.model_id}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("models.fact.family")}</dt>
              <dd className="fact__value">{factText(translator, model.family)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("models.fact.parameters")}</dt>
              <dd className="fact__value">{factText(translator, model.parameter_count)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("models.fact.quantization")}</dt>
              <dd className="fact__value">{factText(translator, model.quantization)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("models.col.context")}</dt>
              <dd className="fact__value">
                {contextWindow === undefined
                  ? translator.t("p02.value.unknown")
                  : translator.t("p02.value.with_provenance", { value: formatNumber(locale, contextWindow), provenance: translator.t(`p02.provenance.${model.context_window.provenance}`) })}
              </dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("models.fact.max_output")}</dt>
              <dd className="fact__value">{model.max_output_tokens.value === undefined ? translator.t("p02.value.unknown") : formatNumber(locale, model.max_output_tokens.value)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("models.col.loaded")}</dt>
              <dd className="fact__value">{translator.t(`models.loaded.${model.loaded_state.value}`)}</dd>
            </div>
            {model.pricing === undefined ? null : (
              <div>
                <dt className="fact__label">{translator.t("models.fact.pricing")}</dt>
                <dd className="fact__value mono">{translator.t("models.pricing", { input: model.pricing.input_price_usd, output: model.pricing.output_price_usd })}</dd>
              </div>
            )}
          </dl>
          <ul className="rows">
            {model.capabilities.map((claim) => (
              <li className="row" key={claim.capability}>
                <span className="row__label">{translator.t(`p02.capability.${claim.capability}`)}</span>
                <span className="row__value">
                  <ClaimBadge support={claim.support} provenance={claim.provenance} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
