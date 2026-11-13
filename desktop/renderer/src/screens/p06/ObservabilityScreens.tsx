// الرصد (Phase-06): صحّة النظام، والأحداث المُهيكلة، والاستعمال والكلفة، والتشخيص.
//
// أربع حدود تُعرض ولا تُطمس: الأحداث تشخيص لا تدقيق — سجلّ التدقيق في النشاط؛ والمقاييس
// «منذ هذا الإقلاع» فقط؛ والصحّة «مجهولة» حتى تُقاس؛ والكلفة تبقى في عملتها ومصدرها،
// فلا يُجمع تقدير مع تقرير ولا تُحوَّل عملة.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Component, Severity } from "../../generated/types/desktop-p06-request-v1";
import type { UsageTotalsV1 } from "../../generated/types/desktop-p06-result-v1";
import type { Phase06Client } from "../../ipc/p06-client";
import { formatInstant, formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { bucketKey, formatMicros, healthStateTone, severityTone } from "../../p06/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { P06Pill, ProvenancePill } from "./P06Pill";

const COMPONENTS: readonly Component[] = [
  "CONNECTOR_GATEWAY",
  "CONNECTOR",
  "MODEL",
  "TOOL",
  "BROWSER",
  "COMPUTER",
  "MEMORY",
  "MISSION",
  "BUDGET",
  "COST",
  "CONFIG",
  "STORAGE",
  "HEALTH",
  "DIAGNOSTICS",
];
const SEVERITIES: readonly Severity[] = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

const OBSERVABILITY_LINKS = [
  { path: "/health", labelKey: "nav.health" },
  { path: "/events", labelKey: "nav.events" },
  { path: "/usage", labelKey: "nav.usage" },
  { path: "/diagnostics", labelKey: "nav.diagnostics" },
] as const;

/** روابط الرصد من شاشة النشاط: وجهات ثانوية لا بنود في الشريط الجانبي. */
export function ObservabilityLinks() {
  const translator = useTranslator();
  const navigation = useNavigation();
  return (
    <nav className="p06-observability-links" aria-label={translator.t("obs.links")}>
      {OBSERVABILITY_LINKS.map((link) => (
        <a
          key={link.path}
          href={`#${link.path}`}
          className={`link obs-link-${link.path.slice(1)}`}
          aria-current={navigation.requestedPath === link.path ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigation.navigate(link.path);
          }}
        >
          {translator.t(link.labelKey)}
        </a>
      ))}
    </nav>
  );
}

export function HealthScreen({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const health = useHostQuery(() => client.health(), [client]);
  const metrics = useHostQuery(() => client.metrics(), [client]);
  const alerts = useHostQuery(() => client.alerts(), [client]);
  const reload = () => {
    health.reload();
    metrics.reload();
    alerts.reload();
  };
  const overview = health.value;
  const snapshot = metrics.value;

  return (
    <>
      <h1 className="page-title">{translator.t("nav.health")}</h1>
      <p className="page-subtitle">{translator.t("obs.health.subtitle")}</p>
      <ObservabilityLinks />
      <p className="note">{translator.t("obs.health.note")}</p>
      <button type="button" className="button button--secondary obs-refresh" onClick={reload}>
        {translator.t("obs.refresh")}
      </button>
      {health.loading ? <StateBlock kind="loading" /> : null}
      {health.error !== null ? <ErrorNote error={health.error} onRetry={health.reload} /> : null}

      {overview === null ? null : (
        <section className="section p06-health" aria-labelledby="obs-health-title" data-overall={overview.overall}>
          <h2 className="section__title" id="obs-health-title">
            {translator.t("obs.health.overall")} <P06Pill namespace="health" member={overview.overall} tone={healthStateTone(overview.overall)} />
          </h2>
          <p className="muted">{translator.t("obs.measured_at", { at: formatInstant(locale, overview.measured_at) })}</p>
          <table className="table p06-health-table">
            <caption className="sr-only">{translator.t("obs.health.overall")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("obs.column.subject")}</th>
                <th scope="col">{translator.t("obs.column.state")}</th>
                <th scope="col">{translator.t("obs.column.reason")}</th>
                <th scope="col">{translator.t("obs.column.measured")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.components.map((record) => (
                <tr key={`${record.subject}:${record.subject_id}`} data-subject={record.subject} data-subject-id={record.subject_id} data-health={record.state}>
                  <th scope="row">
                    {translator.t(`p06.subject.${record.subject}`)}
                    <br />
                    <code className="muted">{record.subject_id}</code>
                  </th>
                  <td>
                    <P06Pill namespace="health" member={record.state} tone={healthStateTone(record.state)} />
                  </td>
                  <td>
                    <code>{record.reason_code}</code>
                  </td>
                  <td>
                    {record.measured_this_session && record.measured_at !== undefined ? (
                      formatInstant(locale, record.measured_at)
                    ) : (
                      <span className="muted">{translator.t("conn.health.not_measured")}</span>
                    )}
                    {record.latency_ms === undefined ? null : (
                      <>
                        <br />
                        <span className="muted">{translator.t("obs.latency_ms", { ms: formatNumber(locale, record.latency_ms) })}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="section p06-alerts" aria-labelledby="obs-alerts-title">
        <h2 className="section__title" id="obs-alerts-title">
          {translator.t("obs.alerts.title")}
        </h2>
        <p className="note">{translator.t("obs.alerts.note")}</p>
        {alerts.error !== null ? <ErrorNote error={alerts.error} onRetry={alerts.reload} /> : null}
        {(alerts.value?.alerts.length ?? 0) === 0 && !alerts.loading ? (
          <StateBlock kind="empty" bodyKey="obs.alerts.empty" />
        ) : (
          <ul className="p06-alert-list">
            {(alerts.value?.alerts ?? []).map((alert) => (
              <li key={alert.alert_id} data-alert-kind={alert.kind} data-alert-state={alert.state}>
                <P06Pill namespace="severity" member={alert.severity} tone={severityTone(alert.severity)} /> {translator.t(`p06.alert.${alert.kind}`)}{" "}
                <code className="muted">{alert.subject}</code> <code className="muted">{alert.reason_code}</code>{" "}
                <span className="muted">
                  {translator.t("obs.alerts.occurrences", { count: alert.occurrences, at: formatInstant(locale, alert.last_at) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {snapshot === null ? null : (
        <section className="section p06-metrics" aria-labelledby="obs-metrics-title">
          <h2 className="section__title" id="obs-metrics-title">
            {translator.t("obs.metrics.title")}
          </h2>
          <p className="note">{translator.t("obs.metrics.note")}</p>
          <dl className="facts">
            {Object.entries(snapshot.metrics.counters).map(([name, value]) => (
              <div key={name} data-counter={name}>
                <dt className="fact__label">{translator.t(`obs.counter.${name}`)}</dt>
                <dd className="fact__value">{formatNumber(locale, value)}</dd>
              </div>
            ))}
            {Object.entries(snapshot.queue_depths).map(([name, value]) => (
              <div key={name} data-queue={name}>
                <dt className="fact__label">{translator.t(`obs.queue.${name}`)}</dt>
                <dd className="fact__value">{formatNumber(locale, value)}</dd>
              </div>
            ))}
          </dl>
          {snapshot.metrics.latency.length === 0 ? null : (
            <table className="table p06-latency">
              <caption className="sr-only">{translator.t("obs.latency.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{translator.t("obs.column.component")}</th>
                  <th scope="col">{translator.t("obs.latency.count")}</th>
                  <th scope="col">{translator.t("obs.latency.mean")}</th>
                  <th scope="col">{translator.t("obs.latency.max")}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.metrics.latency.map((view) => (
                  <tr key={view.component}>
                    <th scope="row">{translator.t(`p06.component.${view.component}`)}</th>
                    <td>{formatNumber(locale, view.histogram.count)}</td>
                    <td>{view.mean_ms === undefined ? "—" : translator.t("obs.latency_ms", { ms: formatNumber(locale, view.mean_ms) })}</td>
                    <td>{translator.t("obs.latency_ms", { ms: formatNumber(locale, view.histogram.max_ms) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="section__subtitle">{translator.t("obs.errors.title")}</h3>
          {snapshot.metrics.errors_by_code.length === 0 ? (
            <StateBlock kind="empty" bodyKey="obs.errors.empty" />
          ) : (
            <table className="table p06-errors">
              <caption className="sr-only">{translator.t("obs.errors.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{translator.t("obs.column.component")}</th>
                  <th scope="col">{translator.t("obs.column.reason")}</th>
                  <th scope="col">{translator.t("obs.column.count")}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.metrics.errors_by_code.map((group) => (
                  <tr key={`${group.component}:${group.reason_code}`} data-error-code={group.reason_code}>
                    <th scope="row">{translator.t(`p06.component.${group.component}`)}</th>
                    <td>
                      <code>{group.reason_code}</code>
                    </td>
                    <td>{formatNumber(locale, group.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {snapshot.metrics.error_overflow > 0 ? <p className="muted">{translator.t("obs.errors.overflow", { count: snapshot.metrics.error_overflow })}</p> : null}
        </section>
      )}
    </>
  );
}

export function EventsScreen({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [component, setComponent] = useState<Component | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const query = useHostQuery(
    () => client.events({ ...(component === "" ? {} : { component }), ...(severity === "" ? {} : { min_severity: severity }) }),
    [client, component, severity],
  );
  const events = query.value?.events ?? [];
  return (
    <>
      <h1 className="page-title">{translator.t("nav.events")}</h1>
      <p className="page-subtitle">{translator.t("obs.events.subtitle")}</p>
      <ObservabilityLinks />
      <p className="note">{translator.t("obs.events.note")}</p>
      <div className="filters">
        <label>
          {translator.t("obs.column.component")}{" "}
          <select id="obs-events-component" value={component} onChange={(event) => setComponent(event.target.value as Component | "")}>
            <option value="">{translator.t("obs.filter.any")}</option>
            {COMPONENTS.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.component.${value}`)}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {translator.t("obs.filter.severity")}{" "}
          <select id="obs-events-severity" value={severity} onChange={(event) => setSeverity(event.target.value as Severity | "")}>
            <option value="">{translator.t("obs.filter.any")}</option>
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {translator.t(`p06.severity.${value}`)}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="button" className="button button--secondary obs-refresh" onClick={query.reload}>
          {translator.t("obs.refresh")}
        </button>
      </div>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {events.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="obs.events.empty" />
      ) : (
        <table className="table p06-events">
          <caption className="sr-only">{translator.t("nav.events")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("obs.column.time")}</th>
              <th scope="col">{translator.t("obs.column.component")}</th>
              <th scope="col">{translator.t("obs.column.operation")}</th>
              <th scope="col">{translator.t("obs.column.result")}</th>
              <th scope="col">{translator.t("obs.column.severity")}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.event_id} data-event-component={event.component} data-event-operation={event.operation}>
                <td>{formatInstant(locale, event.timestamp)}</td>
                <th scope="row">
                  {translator.t(`p06.component.${event.component}`)}
                  <br />
                  <span className="muted">{translator.t(`p06.category.event.${event.category}`)}</span>
                </th>
                <td>
                  <code>{event.operation}</code>
                  {event.duration_ms === undefined ? null : (
                    <>
                      <br />
                      <span className="muted">{translator.t("obs.latency_ms", { ms: formatNumber(locale, event.duration_ms) })}</span>
                    </>
                  )}
                </td>
                <td>
                  <code>{event.result}</code>
                  {event.reason_code === undefined ? null : (
                    <>
                      <br />
                      <code className="muted">{event.reason_code}</code>
                    </>
                  )}
                </td>
                <td>
                  <P06Pill namespace="severity" member={event.severity} tone={severityTone(event.severity)} />
                  <br />
                  <span className="muted">{translator.t(`p06.event_provenance.${event.provenance}`)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function TotalsTable({ caption, rows, showEstimated, className }: { readonly caption: string; readonly rows: readonly UsageTotalsV1[]; readonly showEstimated: boolean; readonly className: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  if (rows.length === 0) return null;
  return (
    <table className={`table ${className}`}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{translator.t("usage.column.key")}</th>
          <th scope="col">{translator.t("usage.column.calls")}</th>
          <th scope="col">{translator.t("usage.column.tokens")}</th>
          <th scope="col">{translator.t("usage.column.external")}</th>
          <th scope="col">{translator.t("usage.column.cost")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-usage-key={row.key}>
            <th scope="row">
              <code>{row.key}</code>
            </th>
            <td>{formatNumber(locale, row.calls)}</td>
            <td>
              {translator.t("usage.tokens", {
                input: formatNumber(locale, row.input_tokens_reported),
                output: formatNumber(locale, row.output_tokens_reported),
              })}
              {row.calls_without_reported_tokens > 0 ? (
                <>
                  <br />
                  <span className="muted">{translator.t("usage.tokens_unreported", { count: row.calls_without_reported_tokens })}</span>
                </>
              ) : null}
            </td>
            <td>{formatNumber(locale, row.external_requests)}</td>
            <td className="p06-costs">
              {row.costs.length === 0 ? <span className="muted">{translator.t("usage.cost.none")}</span> : null}
              {row.costs.map((bucket) => (
                <div key={bucketKey(bucket)} data-provenance={bucket.provenance} data-currency={bucket.currency}>
                  <span className="p06-amount">{formatMicros(bucket.micros, bucket.currency, locale)}</span> <ProvenancePill provenance={bucket.provenance} />
                </div>
              ))}
              {row.calls_with_unknown_cost > 0 ? (
                <div data-provenance="UNKNOWN">
                  <span className="muted">{translator.t("usage.cost.unknown_calls", { count: row.calls_with_unknown_cost })}</span> <ProvenancePill provenance="UNKNOWN" />
                </div>
              ) : null}
              {showEstimated ? null : <span className="muted">{translator.t("usage.cost.estimates_hidden")}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsageScreen({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const summary = useHostQuery(() => client.usageSummary(), [client]);
  const records = useHostQuery(() => client.listUsage({ limit: 50 }), [client]);
  const value = summary.value;
  return (
    <>
      <h1 className="page-title">{translator.t("nav.usage")}</h1>
      <p className="page-subtitle">{translator.t("usage.subtitle")}</p>
      <ObservabilityLinks />
      <p className="note">{translator.t("usage.note.provenance")}</p>
      <p className="note">{translator.t("usage.note.no_conversion")}</p>
      <ul className="p06-provenance-legend">
        {(value?.provenance_vocabulary ?? ["PROVIDER_REPORTED", "LOCALLY_MEASURED", "ESTIMATED", "UNKNOWN"]).map((provenance) => (
          <li key={provenance}>
            <ProvenancePill provenance={provenance} /> {translator.t(`usage.provenance_hint.${provenance}`)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button--secondary obs-refresh"
        onClick={() => {
          summary.reload();
          records.reload();
        }}
      >
        {translator.t("obs.refresh")}
      </button>
      {summary.loading ? <StateBlock kind="loading" /> : null}
      {summary.error !== null ? <ErrorNote error={summary.error} onRetry={summary.reload} /> : null}
      {value === null ? null : (
        <section className="section p06-usage" aria-labelledby="usage-today">
          <h2 className="section__title" id="usage-today">
            {translator.t("usage.today", { day: value.day })}
          </h2>
          <TotalsTable caption={translator.t("usage.today", { day: value.day })} rows={[value.today]} showEstimated={value.show_estimated} className="p06-usage-today" />
          <TotalsTable caption={translator.t("usage.by_category")} rows={value.by_category} showEstimated={value.show_estimated} className="p06-usage-category" />
          <TotalsTable caption={translator.t("usage.by_provider")} rows={value.by_provider} showEstimated={value.show_estimated} className="p06-usage-provider" />
          <TotalsTable caption={translator.t("usage.by_model")} rows={value.by_model} showEstimated={value.show_estimated} className="p06-usage-model" />
          <TotalsTable caption={translator.t("usage.by_connector")} rows={value.by_connector} showEstimated={value.show_estimated} className="p06-usage-connector" />
        </section>
      )}
      <section className="section p06-usage-records" aria-labelledby="usage-records">
        <h2 className="section__title" id="usage-records">
          {translator.t("usage.records")}
        </h2>
        {records.error !== null ? <ErrorNote error={records.error} onRetry={records.reload} /> : null}
        {(records.value?.records.length ?? 0) === 0 && !records.loading ? (
          <StateBlock kind="empty" bodyKey="usage.records.empty" />
        ) : (
          <table className="table p06-usage-record-table">
            <caption className="sr-only">{translator.t("usage.records")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("obs.column.time")}</th>
                <th scope="col">{translator.t("usage.column.subject")}</th>
                <th scope="col">{translator.t("usage.column.tokens")}</th>
                <th scope="col">{translator.t("usage.column.cost")}</th>
              </tr>
            </thead>
            <tbody>
              {(records.value?.records ?? []).map((record) => (
                <tr key={record.record_id} data-usage-category={record.category} data-cost-provenance={record.cost.provenance}>
                  <td>{formatInstant(locale, record.recorded_at)}</td>
                  <th scope="row">
                    {translator.t(`p06.usage_category.${record.category}`)}
                    <br />
                    <code className="muted">{record.subject_id}</code>
                  </th>
                  <td>
                    {record.input_tokens === null && record.output_tokens === null ? (
                      <span className="muted">{translator.t("usage.tokens_none")}</span>
                    ) : (
                      translator.t("usage.tokens", {
                        input: formatNumber(locale, record.input_tokens ?? 0),
                        output: formatNumber(locale, record.output_tokens ?? 0),
                      })
                    )}{" "}
                    <ProvenancePill provenance={record.tokens_provenance} />
                  </td>
                  <td>
                    {record.cost.micros === null || record.cost.currency === null ? (
                      <span className="muted">{translator.t("usage.cost.unknown")}</span>
                    ) : (
                      <span className="p06-amount">{formatMicros(record.cost.micros, record.cost.currency, locale)}</span>
                    )}{" "}
                    <ProvenancePill provenance={record.cost.provenance} />
                    {record.cost.pricing_source === null ? null : (
                      <>
                        <br />
                        <span className="muted">{record.cost.pricing_source}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function DiagnosticsScreen({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const action = useAction();
  const [result, setResult] = useState<{ readonly file: string | null; readonly bytes: number; readonly level: string; readonly redactions: number; readonly sections: readonly string[] } | null>(null);
  return (
    <>
      <h1 className="page-title">{translator.t("nav.diagnostics")}</h1>
      <p className="page-subtitle">{translator.t("diag.subtitle")}</p>
      <ObservabilityLinks />
      <p className="note">{translator.t("diag.note.local")}</p>
      <p className="note">{translator.t("diag.note.redacted")}</p>
      <ActionNote state={action.state} />
      <button
        type="button"
        className="button button--primary diag-export"
        onClick={() =>
          void action.run(
            () => client.exportDiagnostics(),
            (value) => {
              setResult({ file: value.file_name, bytes: value.bytes, level: value.level, redactions: value.redactions, sections: value.sections as readonly string[] });
              return { phase: "DONE", messageKey: "diag.exported" };
            },
          )
        }
      >
        {translator.t("diag.action.export")}
      </button>
      {result === null ? null : (
        <dl className="facts p06-diagnostics" data-level={result.level} data-redactions={result.redactions}>
          <div>
            <dt className="fact__label">{translator.t("diag.fact.file")}</dt>
            <dd className="fact__value">
              <code className="diag-file">{result.file ?? "—"}</code>
            </dd>
          </div>
          <div>
            <dt className="fact__label">{translator.t("diag.fact.level")}</dt>
            <dd className="fact__value">{translator.t(`cfg.option.${result.level}`)}</dd>
          </div>
          <div>
            <dt className="fact__label">{translator.t("diag.fact.bytes")}</dt>
            <dd className="fact__value">{formatNumber(locale, result.bytes)}</dd>
          </div>
          <div>
            <dt className="fact__label">{translator.t("diag.fact.redactions")}</dt>
            <dd className="fact__value">{formatNumber(locale, result.redactions)}</dd>
          </div>
          <div>
            <dt className="fact__label">{translator.t("diag.fact.sections")}</dt>
            <dd className="fact__value">
              <code>{result.sections.join(", ")}</code>
            </dd>
          </div>
        </dl>
      )}
    </>
  );
}
