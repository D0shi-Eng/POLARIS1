// لوحة استدعاء نموذج: توجيه صريح، وإلغاء حقيقي، ونتيجة موسومة بغير الموثوقة.
//
// المخرجات تُعرض نصًّا خامًا في إطار «بيانات من النموذج، بلا سلطة». لا تُحلَّل
// كـHTML، ولا تُنفَّذ، ولا تغيّر أي إعداد.

import { useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import type { ModelInvokeResultV1, ModelView } from "../../generated/types/desktop-p02-result-v1";
import { createId, createIdempotencyKey } from "../../ipc/envelope";
import type { DisplayError } from "../../ipc/errors";
import type { Phase02Client } from "../../ipc/p02-client";
import { formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { measured } from "../../p02/present";
import { ErrorNote } from "../../ui/components/Notes";

export interface InvokePanelProps {
  readonly client: Phase02Client;
  readonly models: readonly ModelView[];
  readonly idBase: string;
  readonly projectId?: string;
  readonly contextSourceIds?: readonly string[];
}

type Mode = "DEFAULT_MODEL" | "MANUAL";

export function InvokePanel({ client, models, idBase, projectId, contextSourceIds }: InvokePanelProps) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [mode, setMode] = useState<Mode>("DEFAULT_MODEL");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<ModelInvokeResultV1 | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const cancelled = useRef(false);

  const selectable = models.filter((model) => model.enabled && model.availability === "AVAILABLE" && model.kind !== "EMBEDDING");
  const chosen = mode === "MANUAL" ? modelId || selectable[0]?.model_id || "" : "";
  const canSend = running === null && prompt.trim() !== "" && (mode === "DEFAULT_MODEL" || chosen !== "");

  async function send(): Promise<void> {
    const invocationId = createId();
    cancelled.current = false;
    setRunning(invocationId);
    setResult(null);
    setError(null);
    const outcome = await client.invokeModel(
      {
        invocation_id: invocationId,
        routing_mode: mode,
        ...(mode === "MANUAL" ? { model_id: chosen } : {}),
        ...(projectId === undefined ? {} : { project_id: projectId }),
        ...(contextSourceIds === undefined || contextSourceIds.length === 0 ? {} : { context_source_ids: contextSourceIds }),
        messages: [{ role: "USER", text: prompt.trim() }],
      },
      createIdempotencyKey(),
    );
    setRunning(null);
    if (outcome.ok) setResult(outcome.value);
    else setError(outcome.error);
  }

  async function cancel(): Promise<void> {
    if (running === null) return;
    cancelled.current = true;
    const outcome = await client.cancelInvocation(running);
    if (!outcome.ok) setError(outcome.error);
  }

  return (
    <section className="card" aria-labelledby={`${idBase}-title`}>
      <h2 className="section__title" id={`${idBase}-title`}>
        {translator.t("invoke.title")}
      </h2>
      <p className="row__hint">{translator.t(projectId === undefined ? "invoke.note" : "invoke.note.project")}</p>
      <div className="form">
        <label className="form__row" htmlFor={`${idBase}-mode`}>
          {translator.t("invoke.mode")}
          <select id={`${idBase}-mode`} className="select" value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
            <option value="DEFAULT_MODEL">{translator.t("invoke.mode.DEFAULT_MODEL")}</option>
            <option value="MANUAL">{translator.t("invoke.mode.MANUAL")}</option>
          </select>
        </label>
        {mode === "MANUAL" ? (
          <label className="form__row" htmlFor={`${idBase}-model`}>
            {translator.t("invoke.model")}
            <select id={`${idBase}-model`} className="select" value={chosen} onChange={(event) => setModelId(event.target.value)}>
              {selectable.length === 0 ? <option value="">{translator.t("invoke.no_models")}</option> : null}
              {selectable.map((model) => (
                <option key={model.model_id} value={model.model_id}>
                  {model.display_name.value ?? model.provider_model_id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="form__row" htmlFor={`${idBase}-prompt`}>
          {translator.t("invoke.prompt")}
          <textarea
            id={`${idBase}-prompt`}
            className="textarea"
            value={prompt}
            maxLength={32000}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="toolbar">
          <button type="button" className="button button--primary" disabled={!canSend} onClick={() => void send()}>
            {translator.t("invoke.send")}
          </button>
          <button type="button" className="button button--secondary" disabled={running === null} onClick={() => void cancel()}>
            {translator.t("invoke.cancel")}
          </button>
        </div>
      </div>

      {running === null ? null : (
        <p className="note" role="status" aria-live="polite" aria-busy="true">
          {translator.t(cancelled.current ? "invoke.cancelling" : "invoke.running")}
        </p>
      )}
      {error === null ? null : <ErrorNote error={error} />}
      {result === null ? null : (
        <div role="status" aria-live="polite">
          <p className={result.status === "COMPLETED" ? "success" : "alert"}>
            {translator.t(`invoke.status.${result.status}`)}
          </p>
          <dl className="facts">
            <div>
              <dt className="fact__label">{translator.t("invoke.fact.routing")}</dt>
              <dd className="fact__value">
                {result.routing.reason_codes.map((code) => translator.t(`invoke.routing.${code}`)).join(" · ")}
              </dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("invoke.fact.model")}</dt>
              <dd className="fact__value mono">{result.routing.model_id ?? translator.t("p02.value.none")}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("invoke.fact.egress")}</dt>
              <dd className="fact__value">{translator.t(`invoke.egress.${result.egress.reason}`)}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("invoke.fact.duration")}</dt>
              <dd className="fact__value">{measured(translator, result.timing.total)}</dd>
            </div>
            {result.usage === undefined ? null : (
              <div>
                <dt className="fact__label">{translator.t("invoke.fact.usage")}</dt>
                <dd className="fact__value">
                  {translator.t("invoke.usage", {
                    input: result.usage.input_tokens.value === undefined ? "?" : formatNumber(locale, result.usage.input_tokens.value),
                    output: result.usage.output_tokens.value === undefined ? "?" : formatNumber(locale, result.usage.output_tokens.value),
                    provenance: translator.t(`p02.provenance.${result.usage.output_tokens.provenance}`),
                  })}
                </dd>
              </div>
            )}
            {result.context === undefined ? null : (
              <div>
                <dt className="fact__label">{translator.t("invoke.fact.context")}</dt>
                <dd className="fact__value">
                  {translator.t("invoke.context", {
                    items: result.context.items,
                    omitted: result.context.omitted,
                    tokens: formatNumber(locale, result.context.estimated_tokens.value),
                  })}
                </dd>
              </div>
            )}
            {result.error === undefined ? null : (
              <div>
                <dt className="fact__label">{translator.t("invoke.fact.error")}</dt>
                <dd className="fact__value">{translator.t(`p02.outcome.${result.error.code}`)}</dd>
              </div>
            )}
          </dl>
          {result.output === undefined ? null : (
            <>
              <p className="untrusted__label">{translator.t("invoke.output.label")}</p>
              <pre className="untrusted" dir="auto">
                {result.output.text}
              </pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}
