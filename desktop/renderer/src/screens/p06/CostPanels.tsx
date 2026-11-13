// الميزانيات والأسعار: ما يحدّه المستخدم، وما يدخله من أسعار مع مصدرها.
//
// POLARIS لا يشحن سعرًا من عنده. كل كلفة تُحسب من سعر أدخله المستخدم «مُقدَّرة» وتُعرض
// كذلك، ولا تُجمع مع كلفة أبلغ بها المزوّد، ولا تُحوَّل بين العملات.

import { NumberField } from "../../ui/components/NumberField";
import { useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type {
  BudgetDimension,
  BudgetMode,
  BudgetScope,
  PricingTarget,
  PricingUnit,
} from "../../generated/types/desktop-p06-request-v1";
import type { Phase06Client } from "../../ipc/p06-client";
import type { LocaleCode } from "../../localization/types";
import { formatInstant } from "../../localization/format";
import { budgetTone } from "../../p06/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { P06Pill } from "./P06Pill";

const SCOPES: readonly BudgetScope[] = ["MISSION", "PROJECT", "DAY", "PROVIDER", "CONNECTOR"];
const DIMENSIONS: readonly BudgetDimension[] = ["COST_MICROS", "MODEL_TOKENS", "EXTERNAL_CALLS"];
const MODES: readonly BudgetMode[] = ["HARD", "SOFT"];
const TARGETS: readonly PricingTarget[] = ["MODEL", "CONNECTOR"];
const UNITS: readonly PricingUnit[] = ["PER_MILLION_INPUT_TOKENS", "PER_MILLION_OUTPUT_TOKENS", "PER_CALL"];

export function BudgetsPanel({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const query = useHostQuery(() => client.listBudgets(), [client]);
  const action = useAction();
  const [scope, setScope] = useState<BudgetScope>("DAY");
  const [scopeKey, setScopeKey] = useState("");
  const [dimension, setDimension] = useState<BudgetDimension>("EXTERNAL_CALLS");
  const [limit, setLimit] = useState("");
  const [currency, setCurrency] = useState("");
  const [mode, setMode] = useState<BudgetMode | "">("");
  const [warn, setWarn] = useState("");
  const budgets = query.value?.budgets ?? [];

  const save = () => {
    const trimmed = limit.trim();
    // حدّ الكلفة نصّ عشري بوحدة العملة؛ حدود العدّ أعداد صحيحة.
    const parsedLimit: number | string = dimension === "COST_MICROS" ? trimmed : /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
    const warnPct = /^\d+$/.test(warn.trim()) ? Number(warn.trim()) : undefined;
    void action.run(
      () =>
        client.setBudget({
          scope,
          ...(scope === "DAY" ? {} : { scope_key: scopeKey.trim() }),
          dimension,
          limit: parsedLimit,
          ...(dimension === "COST_MICROS" && currency.trim() !== "" ? { currency: currency.trim().toUpperCase() } : {}),
          ...(mode === "" ? {} : { mode }),
          ...(warnPct === undefined ? {} : { warn_ratio_pct: warnPct }),
        }),
      (value) => ({ phase: "DONE", messageKey: "budget.saved", values: { limit: value.limit_display } }),
      query.reload,
    );
  };

  return (
    <section className="section p06-budgets" aria-labelledby="budget-title">
      <h3 className="section__title" id="budget-title">
        {translator.t("budget.title")}
      </h3>
      <p className="note">{translator.t("budget.note")}</p>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />
      {budgets.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="budget.empty" />
      ) : (
        <table className="table p06-budget-table">
          <caption className="sr-only">{translator.t("budget.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("budget.column.scope")}</th>
              <th scope="col">{translator.t("budget.column.dimension")}</th>
              <th scope="col">{translator.t("budget.column.mode")}</th>
              <th scope="col">{translator.t("budget.column.used")}</th>
              <th scope="col">{translator.t("budget.column.state")}</th>
              <th scope="col">{translator.t("budget.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((status) => (
              <tr key={status.budget.budget_id} data-budget-id={status.budget.budget_id} data-budget-state={status.usage.state}>
                <th scope="row">
                  {translator.t(`p06.budget_scope.${status.budget.scope}`)}
                  <br />
                  <code className="muted">{status.budget.scope_key}</code>
                  <br />
                  <span className="muted">{translator.t(`p06.window.${status.window}`)}</span>
                </th>
                <td>{translator.t(`p06.dimension.${status.budget.dimension}`)}</td>
                <td>
                  <P06Pill namespace="budget_mode" member={status.budget.mode} tone={status.budget.mode === "HARD" ? "WARNING" : "MUTED"} />
                </td>
                <td>
                  {translator.t("budget.used_of", { used: status.used_display, limit: status.limit_display })}
                  {status.usage.reserved > 0 ? (
                    <>
                      <br />
                      <span className="muted">{translator.t("budget.reserved", { count: status.usage.reserved })}</span>
                    </>
                  ) : null}
                  {status.usage.unmetered_calls > 0 ? (
                    <>
                      <br />
                      <span className="muted">{translator.t("budget.unmetered", { count: status.usage.unmetered_calls })}</span>
                    </>
                  ) : null}
                </td>
                <td>
                  <P06Pill namespace="budget_state" member={status.usage.state} tone={budgetTone(status.usage.state)} />
                </td>
                <td>
                  <button
                    type="button"
                    className="button button--secondary budget-remove"
                    aria-label={`${translator.t("budget.action.remove")} ${translator.t(`p06.dimension.${status.budget.dimension}`)}`}
                    onClick={() =>
                      void action.run(
                        () => client.removeBudget(status.budget.budget_id),
                        () => ({ phase: "DONE", messageKey: "budget.removed" }),
                        query.reload,
                      )
                    }
                  >
                    {translator.t("budget.action.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <fieldset className="fieldset">
        <legend>{translator.t("budget.form.legend")}</legend>
        <div className="row">
          <label htmlFor="budget-scope">{translator.t("budget.column.scope")}</label>
          <select id="budget-scope" value={scope} onChange={(event) => setScope(event.target.value as BudgetScope)}>
            {SCOPES.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.budget_scope.${value}`)}
              </option>
            ))}
          </select>
        </div>
        {scope === "DAY" ? null : (
          <div className="row">
            <label htmlFor="budget-key">{translator.t("budget.field.scope_key")}</label>
            <input id="budget-key" type="text" maxLength={200} value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} />
          </div>
        )}
        <div className="row">
          <label htmlFor="budget-dimension">{translator.t("budget.column.dimension")}</label>
          <select id="budget-dimension" value={dimension} onChange={(event) => setDimension(event.target.value as BudgetDimension)}>
            {DIMENSIONS.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.dimension.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="budget-limit">{translator.t("budget.field.limit")}</label>
          <input id="budget-limit" type="text" inputMode="decimal" maxLength={24} value={limit} onChange={(event) => setLimit(event.target.value)} />
        </div>
        {dimension !== "COST_MICROS" ? null : (
          <div className="row">
            <label htmlFor="budget-currency">{translator.t("budget.field.currency")}</label>
            <input id="budget-currency" type="text" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} />
          </div>
        )}
        <div className="row">
          <label htmlFor="budget-mode">{translator.t("budget.column.mode")}</label>
          <select id="budget-mode" value={mode} onChange={(event) => setMode(event.target.value as BudgetMode | "")}>
            <option value="">{translator.t("budget.mode.default")}</option>
            {MODES.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.budget_mode.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="budget-warn">{translator.t("budget.field.warn")}</label>
          <NumberField id="budget-warn" min={1} max={100} value={warn} onChange={setWarn} />
        </div>
        <button type="button" className="button button--primary budget-save" onClick={save}>
          {translator.t("budget.action.save")}
        </button>
      </fieldset>
    </section>
  );
}

export function PricingPanel({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listPricing(), [client]);
  const action = useAction();
  const [target, setTarget] = useState<PricingTarget>("MODEL");
  const [targetId, setTargetId] = useState("");
  const [unit, setUnit] = useState<PricingUnit>("PER_MILLION_INPUT_TOKENS");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [source, setSource] = useState("");
  const entries = query.value?.entries ?? [];

  return (
    <section className="section p06-pricing" aria-labelledby="pricing-title">
      <h3 className="section__title" id="pricing-title">
        {translator.t("pricing.title")}
      </h3>
      <p className="note">{translator.t("pricing.note")}</p>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />
      {entries.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="pricing.empty" />
      ) : (
        <table className="table p06-pricing-table">
          <caption className="sr-only">{translator.t("pricing.title")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("pricing.column.target")}</th>
              <th scope="col">{translator.t("pricing.column.unit")}</th>
              <th scope="col">{translator.t("pricing.column.amount")}</th>
              <th scope="col">{translator.t("pricing.column.source")}</th>
              <th scope="col">{translator.t("pricing.column.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((view) => (
              <tr key={view.entry.pricing_id} data-pricing-id={view.entry.pricing_id}>
                <th scope="row">
                  {translator.t(`p06.pricing_target.${view.entry.target_kind}`)}
                  <br />
                  <code className="muted">{view.entry.target_id}</code>
                </th>
                <td>{translator.t(`p06.pricing_unit.${view.entry.unit}`)}</td>
                <td>
                  <code>
                    {view.amount} {view.entry.currency}
                  </code>{" "}
                  <P06Pill namespace="provenance" member={view.provenance} tone="WARNING" />
                </td>
                <td>
                  {view.entry.source_note}
                  <br />
                  <span className="muted">{formatInstant(locale, view.entry.created_at)}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className="button button--secondary pricing-remove"
                    aria-label={`${translator.t("pricing.action.remove")} ${view.entry.target_id}`}
                    onClick={() =>
                      void action.run(
                        () => client.removePricing(view.entry.pricing_id),
                        () => ({ phase: "DONE", messageKey: "pricing.removed" }),
                        query.reload,
                      )
                    }
                  >
                    {translator.t("pricing.action.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <fieldset className="fieldset">
        <legend>{translator.t("pricing.form.legend")}</legend>
        <div className="row">
          <label htmlFor="pricing-target-kind">{translator.t("pricing.column.target")}</label>
          <select id="pricing-target-kind" value={target} onChange={(event) => setTarget(event.target.value as PricingTarget)}>
            {TARGETS.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.pricing_target.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="pricing-target-id">{translator.t("pricing.field.target_id")}</label>
          <input id="pricing-target-id" type="text" maxLength={200} value={targetId} onChange={(event) => setTargetId(event.target.value)} />
        </div>
        <div className="row">
          <label htmlFor="pricing-unit">{translator.t("pricing.column.unit")}</label>
          <select id="pricing-unit" value={unit} onChange={(event) => setUnit(event.target.value as PricingUnit)}>
            {UNITS.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.pricing_unit.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label htmlFor="pricing-amount">{translator.t("pricing.column.amount")}</label>
          <input id="pricing-amount" type="text" inputMode="decimal" maxLength={24} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div className="row">
          <label htmlFor="pricing-currency">{translator.t("budget.field.currency")}</label>
          <input id="pricing-currency" type="text" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} />
        </div>
        <div className="row">
          <label htmlFor="pricing-source">{translator.t("pricing.column.source")}</label>
          <input id="pricing-source" type="text" maxLength={200} value={source} onChange={(event) => setSource(event.target.value)} />
          <span className="row__hint">{translator.t("pricing.hint.source")}</span>
        </div>
        <button
          type="button"
          className="button button--primary pricing-save"
          onClick={() =>
            void action.run(
              () =>
                client.setPricing({
                  target_kind: target,
                  target_id: targetId.trim(),
                  unit,
                  amount: amount.trim(),
                  currency: currency.trim().toUpperCase(),
                  source_note: source.trim(),
                }),
              () => ({ phase: "DONE", messageKey: "pricing.saved" }),
              query.reload,
            )
          }
        >
          {translator.t("pricing.action.save")}
        </button>
      </fieldset>
    </section>
  );
}
