// الموصلات (Phase-06): التسجيل، والاستيراد من OpenAPI، والتفعيل، والفحص، والمفتاح، والإزالة.
//
// ثلاث حقائق تُعرض هنا لأنها ليست بديهية: الموصل يُسجَّل معطَّلًا والتفعيل قرار ثانٍ،
// والمفتاح لا يُكتب في هذه الشاشة أبدًا — المضيف يفتح نافذته الخاصّة، والشاشة لا ترى
// إلا «مُعَدّ أم لا» ومصدره ومرجعه وآخر تحديث. والصحّة «مجهولة» حتى تُقاس في هذا
// الإقلاع؛ قياس من إقلاع سابق لا يُعرض كحالة حاضرة.

import { NumberField } from "../../ui/components/NumberField";
import { useEffect, useRef, useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type {
  AuthMode,
  ConnectorCategory,
  ConnectorOperationV1,
  EgressClass,
  HttpMethod,
  KeySource,
  RestInputV1,
} from "../../generated/types/desktop-p06-request-v1";
import type { ConnectorOpenapiImportResultV1, ConnectorViewV1 } from "../../generated/types/desktop-p06-result-v1";
import type { Phase06Client } from "../../ipc/p06-client";
import { formatInstant, formatNumber } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { healthStateTone, invocationTone } from "../../p06/present";
import { shortDigest } from "../../p04/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { P06Pill } from "./P06Pill";

const CATEGORIES: readonly ConnectorCategory[] = [
  "CUSTOM_API",
  "EMAIL",
  "CALENDAR",
  "FILES",
  "MESSAGING",
  "PROJECT_MANAGEMENT",
  "CODE_HOSTING",
  "DATABASE",
];
const EGRESS: readonly EgressClass[] = ["PUBLIC_HTTPS", "LOOPBACK"];
const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/// ‏OAUTH2 من المفردات ولا يُعرض اختيارًا: لا تدفّق رسميًّا له في هذا البناء.
const AUTH_MODES: readonly AuthMode[] = ["NONE", "API_KEY", "BEARER_TOKEN", "BASIC"];
const KEY_SOURCES: readonly KeySource[] = ["NONE", "CREDENTIAL_STORE", "ENVIRONMENT"];
const KEY_HEADERS = ["X-API-Key", "Api-Key", "X-Auth-Token", "X-Access-Token", "Ocp-Apim-Subscription-Key"] as const;

/** مسودّة حقول REST كما يكتبها المستخدم. الأرقام نصوص حتى الإرسال. */
interface RestDraft {
  readonly base_url: string;
  readonly egress_class: EgressClass;
  readonly allowed_paths: string;
  readonly allowed_methods: readonly HttpMethod[];
  readonly auth_mode: AuthMode;
  readonly key_source: KeySource;
  readonly environment_variable: string;
  readonly key_header: string;
  readonly basic_username: string;
  readonly timeout_ms: string;
  readonly max_response_bytes: string;
  readonly requests_per_minute: string;
  readonly max_concurrent: string;
}

const EMPTY_REST: RestDraft = {
  base_url: "",
  egress_class: "PUBLIC_HTTPS",
  allowed_paths: "",
  allowed_methods: ["GET"],
  auth_mode: "NONE",
  key_source: "NONE",
  environment_variable: "",
  key_header: "X-API-Key",
  basic_username: "",
  timeout_ms: "10000",
  max_response_bytes: "1048576",
  requests_per_minute: "60",
  max_concurrent: "2",
};

function integerOrUndefined(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** يحوّل المسودّة إلى حمولة العقد. ما لا يُقرأ يبقى غائبًا، والمضيف يرفض الناقص بسببه. */
function restInput(draft: RestDraft): RestInputV1 {
  const paths = draft.allowed_paths
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const input: Record<string, unknown> = {
    base_url: draft.base_url.trim(),
    egress_class: draft.egress_class,
    allowed_paths: paths,
    allowed_methods: [...draft.allowed_methods],
    auth_mode: draft.auth_mode,
    key_source: draft.auth_mode === "NONE" ? "NONE" : draft.key_source,
    timeout_ms: integerOrUndefined(draft.timeout_ms),
    max_response_bytes: integerOrUndefined(draft.max_response_bytes),
    requests_per_minute: integerOrUndefined(draft.requests_per_minute),
    max_concurrent: integerOrUndefined(draft.max_concurrent),
  };
  if (draft.auth_mode !== "NONE" && draft.key_source === "ENVIRONMENT") input["environment_variable"] = draft.environment_variable.trim();
  if (draft.auth_mode === "API_KEY") input["key_header"] = draft.key_header;
  if (draft.auth_mode === "BASIC") input["basic_username"] = draft.basic_username.trim();
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== "")) as unknown as RestInputV1;
}

export function ConnectorsPanel({ client }: { readonly client: Phase06Client }) {
  const translator = useTranslator();
  const query = useHostQuery(() => client.listConnectors(), [client]);
  const action = useAction();
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const connectors = query.value?.connectors ?? [];

  return (
    <section className="section p06-connectors" aria-labelledby="conn-title">
      <h2 className="section__title" id="conn-title">
        {translator.t("conn.title")}
      </h2>
      <p className="note">{translator.t("conn.note.disabled")}</p>
      <p className="note">{translator.t("conn.note.secret")}</p>
      <p className="note">{translator.t("conn.note.untrusted")}</p>

      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />
      {query.value !== null && query.value.unreadable > 0 ? (
        <p className="alert" role="alert">
          {translator.t("conn.unreadable", { count: query.value.unreadable })}
        </p>
      ) : null}

      {connectors.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="conn.empty" />
      ) : (
        <div className="table-wrap">
          <table className="table table--cards p06-connector-table">
            <caption className="sr-only">{translator.t("conn.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("conn.column.name")}</th>
                <th scope="col">{translator.t("conn.column.status")}</th>
                <th scope="col">{translator.t("conn.column.auth")}</th>
                <th scope="col">{translator.t("conn.column.health")}</th>
                <th scope="col">{translator.t("conn.column.activity")}</th>
                <th scope="col">{translator.t("conn.column.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((connector) => (
                <ConnectorRow
                  key={connector.descriptor.connector_id}
                  client={client}
                  connector={connector}
                  action={action}
                  reload={query.reload}
                  onView={() => setViewing((current) => (current === connector.descriptor.connector_id ? null : connector.descriptor.connector_id))}
                  onRemove={() => setConfirming(connector.descriptor.connector_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming === null ? null : (
        <ConfirmRemove
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const id = confirming;
            setConfirming(null);
            if (viewing === id) setViewing(null);
            void action.run(
              () => client.removeConnector(id),
              (value) => ({ phase: "DONE", messageKey: "conn.removed", values: { tools: value.tools_removed } }),
              query.reload,
            );
          }}
        />
      )}

      {viewing === null ? null : <ConnectorDetail key={viewing} client={client} connectorId={viewing} />}

      <RegisterConnector client={client} onDone={query.reload} />
      <ImportOpenapi client={client} onDone={query.reload} />
    </section>
  );
}

function ConnectorRow({
  client,
  connector,
  action,
  reload,
  onView,
  onRemove,
}: {
  readonly client: Phase06Client;
  readonly connector: ConnectorViewV1;
  readonly action: ReturnType<typeof useAction>;
  reload(): void;
  onView(): void;
  onRemove(): void;
}) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const { descriptor, auth, health } = connector;
  const id = descriptor.connector_id;
  const name = descriptor.display_name;
  const canPrompt = auth.mode !== "NONE" && auth.source === "CREDENTIAL_STORE";
  return (
    <tr data-connector-id={id} data-health={health.state} data-enabled={descriptor.enabled ? "true" : "false"}>
      <th scope="row">
        <span className="p06-connector-name">{name}</span>
        <br />
        <span className="muted">
          {translator.t(`p06.provider.${descriptor.provider}`)} · {translator.t(`p06.category.${descriptor.category}`)}
        </span>
        <br />
        <span className="muted">{translator.t("conn.operations", { count: connector.operation_count })}</span>
      </th>
      <td>
        <P06Pill namespace="connector_status" member={descriptor.status} tone={descriptor.enabled ? "NEUTRAL" : "MUTED"} />
        <br />
        <P06Pill namespace="egress" member={descriptor.egress_class} tone="MUTED" />
      </td>
      <td className="p06-auth">
        <P06Pill namespace="auth_mode" member={auth.mode} tone="MUTED" />
        {auth.required ? (
          <>
            <br />
            <P06Pill namespace="configured" member={auth.configured ? "YES" : "NO"} tone={auth.configured ? "NEUTRAL" : "WARNING"} />{" "}
            <P06Pill namespace="key_source" member={auth.source} tone="MUTED" />
            {auth.reference === undefined ? null : (
              <>
                <br />
                <code className="muted">{auth.reference}</code>
              </>
            )}
            {auth.environment_variable === undefined ? null : (
              <>
                <br />
                <code className="muted">{auth.environment_variable}</code>
              </>
            )}
            {auth.last_updated === undefined ? null : (
              <>
                <br />
                <span className="muted">{translator.t("conn.auth.updated", { at: formatInstant(locale, auth.last_updated) })}</span>
              </>
            )}
            {auth.store_available ? null : (
              <>
                <br />
                <span className="muted">{translator.t("conn.auth.store_unavailable")}</span>
              </>
            )}
          </>
        ) : null}
      </td>
      <td className="p06-health">
        <P06Pill namespace="health" member={health.state} tone={healthStateTone(health.state)} />
        <br />
        <code className="muted">{health.reason_code}</code>
        {health.measured_at === undefined ? null : (
          <>
            <br />
            <span className="muted">{formatInstant(locale, health.measured_at)}</span>
          </>
        )}
        {health.latency_ms === undefined ? null : (
          <>
            <br />
            <span className="muted">{translator.t("obs.latency_ms", { ms: formatNumber(locale, health.latency_ms) })}</span>
          </>
        )}
        {health.measured_this_session ? null : (
          <>
            <br />
            <span className="muted">{translator.t("conn.health.not_measured")}</span>
          </>
        )}
      </td>
      <td>{connector.last_activity_at === undefined ? <span className="muted">—</span> : formatInstant(locale, connector.last_activity_at)}</td>
      <td>
        <button
          type="button"
          className="button button--secondary conn-enable"
          aria-label={`${translator.t(descriptor.enabled ? "conn.action.disable" : "conn.action.enable")} ${name}`}
          onClick={() =>
            void action.run(
              () => client.configureConnector({ connector_id: id, enabled: !descriptor.enabled }),
              () => ({ phase: "DONE", messageKey: descriptor.enabled ? "conn.disabled" : "conn.enabled" }),
              reload,
            )
          }
        >
          {translator.t(descriptor.enabled ? "conn.action.disable" : "conn.action.enable")}
        </button>{" "}
        <button
          type="button"
          className="button button--secondary conn-test"
          aria-label={`${translator.t("conn.action.test")} ${name}`}
          onClick={() =>
            void action.run(
              () => client.testConnector(id),
              (value) => ({ phase: "DONE", messageKey: "conn.tested", values: { state: translator.t(`p06.health.${value.health.state}`) } }),
              reload,
            )
          }
        >
          {translator.t("conn.action.test")}
        </button>{" "}
        {canPrompt ? (
          <>
            <button
              type="button"
              className="button button--secondary conn-credential-set"
              aria-label={`${translator.t("conn.action.credential_set")} ${name}`}
              onClick={() =>
                void action.run(
                  () => client.setConnectorCredential(id),
                  (value) => ({ phase: "DONE", messageKey: `conn.credential.${value.outcome}` }),
                  reload,
                )
              }
            >
              {translator.t("conn.action.credential_set")}
            </button>{" "}
            {auth.configured ? (
              <>
                <button
                  type="button"
                  className="button button--secondary conn-credential-clear"
                  aria-label={`${translator.t("conn.action.credential_clear")} ${name}`}
                  onClick={() =>
                    void action.run(
                      () => client.clearConnectorCredential(id),
                      (value) => ({ phase: "DONE", messageKey: `conn.credential.${value.outcome}` }),
                      reload,
                    )
                  }
                >
                  {translator.t("conn.action.credential_clear")}
                </button>{" "}
              </>
            ) : null}
          </>
        ) : null}
        <button type="button" className="button button--secondary conn-details" aria-label={`${translator.t("conn.action.details")} ${name}`} onClick={onView}>
          {translator.t("conn.action.details")}
        </button>{" "}
        <button type="button" className="button button--secondary conn-remove" aria-label={`${translator.t("conn.action.remove")} ${name}`} onClick={onRemove}>
          {translator.t("conn.action.remove")}
        </button>
      </td>
    </tr>
  );
}

function ConnectorDetail({ client, connectorId }: { readonly client: Phase06Client; readonly connectorId: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.getConnector(connectorId), [client, connectorId]);
  const detail = query.value;
  return (
    <section className="section p06-connector-detail" aria-labelledby="conn-detail-title" data-connector-id={connectorId}>
      <h3 className="section__title" id="conn-detail-title">
        {detail === null ? translator.t("conn.detail.title") : detail.connector.descriptor.display_name}
      </h3>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {detail === null ? null : (
        <>
          <dl className="facts">
            <div>
              <dt className="fact__label">{translator.t("conn.detail.version")}</dt>
              <dd className="fact__value">{detail.connector.descriptor.version}</dd>
            </div>
            <div>
              <dt className="fact__label">{translator.t("conn.detail.origin")}</dt>
              <dd className="fact__value">{translator.t(`p06.origin.${detail.connector.descriptor.provenance.origin}`)}</dd>
            </div>
            {detail.connector.descriptor.provenance.spec_digest === null ? null : (
              <div>
                <dt className="fact__label">{translator.t("conn.detail.spec_digest")}</dt>
                <dd className="fact__value">
                  <code>{shortDigest(detail.connector.descriptor.provenance.spec_digest)}</code>
                </dd>
              </div>
            )}
            <div>
              <dt className="fact__label">{translator.t("conn.detail.risk")}</dt>
              <dd className="fact__value">{translator.t(`p06.risk.${detail.connector.descriptor.risk_class}`)}</dd>
            </div>
            {detail.connector.rest === undefined ? null : (
              <>
                <div>
                  <dt className="fact__label">{translator.t("conn.field.base_url")}</dt>
                  <dd className="fact__value">
                    <code>{detail.connector.rest.base_url}</code>
                  </dd>
                </div>
                <div>
                  <dt className="fact__label">{translator.t("conn.field.allowed_paths")}</dt>
                  <dd className="fact__value">
                    <code>{detail.connector.rest.allowed_paths.join(" ")}</code>
                  </dd>
                </div>
                <div>
                  <dt className="fact__label">{translator.t("conn.field.limits")}</dt>
                  <dd className="fact__value">
                    {translator.t("conn.detail.limits", {
                      rpm: detail.connector.rest.requests_per_minute,
                      concurrent: detail.connector.rest.max_concurrent,
                      timeout: formatNumber(locale, detail.connector.rest.timeout_ms),
                      bytes: formatNumber(locale, detail.connector.rest.max_response_bytes),
                    })}
                  </dd>
                </div>
              </>
            )}
            {detail.connector.workspace === undefined ? null : (
              <div>
                <dt className="fact__label">{translator.t("conn.field.project")}</dt>
                <dd className="fact__value">
                  <code>{detail.connector.workspace.project_id}</code>
                </dd>
              </div>
            )}
          </dl>

          <h4 className="section__subtitle">{translator.t("conn.detail.operations")}</h4>
          <table className="table p06-operations">
            <caption className="sr-only">{translator.t("conn.detail.operations")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("conn.column.operation")}</th>
                <th scope="col">{translator.t("conn.column.action")}</th>
                <th scope="col">{translator.t("conn.column.request")}</th>
                <th scope="col">{translator.t("conn.column.safety")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.operations.map((view) => (
                <tr key={view.operation.operation_id} data-operation-id={view.operation.operation_id}>
                  <th scope="row">
                    {view.operation.title}
                    <br />
                    <code className="muted">{view.tool_id}</code>
                  </th>
                  <td>
                    <P06Pill namespace="action" member={view.operation.action} tone={view.side_effect ? "WARNING" : "MUTED"} />
                  </td>
                  <td>
                    <code>
                      {view.operation.method} {view.operation.path}
                    </code>
                  </td>
                  <td>
                    {view.side_effect ? <span>{translator.t("conn.operation.side_effect")}</span> : <span>{translator.t("conn.operation.read_only")}</span>}
                    <br />
                    <span className="muted">{translator.t(view.retry_safe ? "conn.operation.retry_safe" : "conn.operation.no_retry")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="section__subtitle">{translator.t("conn.detail.invocations")}</h4>
          <p className="note">{translator.t("conn.note.invocation")}</p>
          {detail.invocations.length === 0 ? (
            <StateBlock kind="empty" bodyKey="conn.invocations.empty" />
          ) : (
            <table className="table p06-invocations">
              <caption className="sr-only">{translator.t("conn.detail.invocations")}</caption>
              <thead>
                <tr>
                  <th scope="col">{translator.t("conn.column.operation")}</th>
                  <th scope="col">{translator.t("conn.column.outcome")}</th>
                  <th scope="col">{translator.t("conn.column.attempts")}</th>
                  <th scope="col">{translator.t("conn.column.summary")}</th>
                  <th scope="col">{translator.t("conn.column.started")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.invocations.map((invocation) => (
                  <tr key={invocation.invocation_id} data-invocation-status={invocation.status}>
                    <th scope="row">
                      <code>{invocation.operation_id}</code>
                    </th>
                    <td>
                      <P06Pill namespace="outcome" member={invocation.status} tone={invocationTone(invocation.status)} />
                      {invocation.reason_code === undefined ? null : (
                        <>
                          <br />
                          <code className="muted">{invocation.reason_code}</code>
                        </>
                      )}
                      {invocation.http_status === undefined ? null : (
                        <>
                          <br />
                          <span className="muted">{translator.t("conn.http_status", { status: invocation.http_status })}</span>
                        </>
                      )}
                    </td>
                    <td>{invocation.attempts}</td>
                    <td>
                      <span className="untrusted">{invocation.summary}</span>
                    </td>
                    <td>{formatInstant(locale, invocation.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

/** حقول REST المشتركة بين التسجيل اليدوي والموافقة على استيراد OpenAPI. */
function RestFields({ prefix, draft, onChange }: { readonly prefix: string; readonly draft: RestDraft; onChange(next: RestDraft): void }) {
  const translator = useTranslator();
  const set = <K extends keyof RestDraft>(key: K, value: RestDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <fieldset className="fieldset">
      <legend>{translator.t("conn.rest.legend")}</legend>
      <div className="row">
        <label htmlFor={`${prefix}-base-url`}>{translator.t("conn.field.base_url")}</label>
        <input id={`${prefix}-base-url`} type="url" maxLength={300} value={draft.base_url} onChange={(event) => set("base_url", event.target.value)} />
      </div>
      <div className="row">
        <label htmlFor={`${prefix}-egress`}>{translator.t("conn.field.egress")}</label>
        <select id={`${prefix}-egress`} value={draft.egress_class} onChange={(event) => set("egress_class", event.target.value as EgressClass)}>
          {EGRESS.map((value) => (
            <option key={value} value={value}>
              {translator.t(`p06.egress.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label htmlFor={`${prefix}-paths`}>{translator.t("conn.field.allowed_paths")}</label>
        <textarea id={`${prefix}-paths`} rows={3} maxLength={4000} value={draft.allowed_paths} onChange={(event) => set("allowed_paths", event.target.value)} />
      </div>
      <fieldset className="fieldset">
        <legend>{translator.t("conn.field.methods")}</legend>
        {METHODS.map((method) => (
          <label key={method} className="checkbox">
            <input
              type="checkbox"
              id={`${prefix}-method-${method}`}
              checked={draft.allowed_methods.includes(method)}
              onChange={(event) =>
                set(
                  "allowed_methods",
                  event.target.checked ? [...draft.allowed_methods, method] : draft.allowed_methods.filter((value) => value !== method),
                )
              }
            />{" "}
            <code>{method}</code>
          </label>
        ))}
      </fieldset>
      <div className="row">
        <label htmlFor={`${prefix}-auth`}>{translator.t("conn.field.auth_mode")}</label>
        <select id={`${prefix}-auth`} value={draft.auth_mode} onChange={(event) => set("auth_mode", event.target.value as AuthMode)}>
          {AUTH_MODES.map((value) => (
            <option key={value} value={value}>
              {translator.t(`p06.auth_mode.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="muted">{translator.t("conn.note.oauth2")}</p>
      {draft.auth_mode === "NONE" ? null : (
        <>
          <div className="row">
            <label htmlFor={`${prefix}-key-source`}>{translator.t("conn.field.key_source")}</label>
            <select id={`${prefix}-key-source`} value={draft.key_source} onChange={(event) => set("key_source", event.target.value as KeySource)}>
              {KEY_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {translator.t(`p06.key_source.${value}`)}
                </option>
              ))}
            </select>
          </div>
          {draft.key_source !== "ENVIRONMENT" ? null : (
            <div className="row">
              <label htmlFor={`${prefix}-env`}>{translator.t("conn.field.environment_variable")}</label>
              <input id={`${prefix}-env`} type="text" maxLength={64} value={draft.environment_variable} onChange={(event) => set("environment_variable", event.target.value)} />
              <span className="row__hint">{translator.t("conn.hint.environment_variable")}</span>
            </div>
          )}
          {draft.auth_mode !== "API_KEY" ? null : (
            <div className="row">
              <label htmlFor={`${prefix}-key-header`}>{translator.t("conn.field.key_header")}</label>
              <select id={`${prefix}-key-header`} value={draft.key_header} onChange={(event) => set("key_header", event.target.value)}>
                {KEY_HEADERS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}
          {draft.auth_mode !== "BASIC" ? null : (
            <div className="row">
              <label htmlFor={`${prefix}-basic-user`}>{translator.t("conn.field.basic_username")}</label>
              <input id={`${prefix}-basic-user`} type="text" maxLength={128} value={draft.basic_username} onChange={(event) => set("basic_username", event.target.value)} />
            </div>
          )}
        </>
      )}
      <div className="row">
        <label htmlFor={`${prefix}-timeout`}>{translator.t("conn.field.timeout_ms")}</label>
        <NumberField id={`${prefix}-timeout`} min={100} value={draft.timeout_ms} onChange={(v) => set("timeout_ms", v)} />
      </div>
      <div className="row">
        <label htmlFor={`${prefix}-max-bytes`}>{translator.t("conn.field.max_response_bytes")}</label>
        <NumberField id={`${prefix}-max-bytes`} min={1024} value={draft.max_response_bytes} onChange={(v) => set("max_response_bytes", v)} />
      </div>
      <div className="row">
        <label htmlFor={`${prefix}-rpm`}>{translator.t("conn.field.requests_per_minute")}</label>
        <NumberField id={`${prefix}-rpm`} min={1} value={draft.requests_per_minute} onChange={(v) => set("requests_per_minute", v)} />
      </div>
      <div className="row">
        <label htmlFor={`${prefix}-concurrent`}>{translator.t("conn.field.max_concurrent")}</label>
        <NumberField id={`${prefix}-concurrent`} min={1} value={draft.max_concurrent} onChange={(v) => set("max_concurrent", v)} />
      </div>
    </fieldset>
  );
}

function RegisterConnector({ client, onDone }: { readonly client: Phase06Client; onDone(): void }) {
  const translator = useTranslator();
  const action = useAction();
  const [provider, setProvider] = useState<"polaris.rest" | "polaris.workspace">("polaris.rest");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConnectorCategory>("CUSTOM_API");
  const [rest, setRest] = useState<RestDraft>(EMPTY_REST);
  const [projectId, setProjectId] = useState("");
  const [operations, setOperations] = useState("");

  const submit = () => {
    let parsed: ConnectorOperationV1[] | undefined;
    if (provider === "polaris.rest" && operations.trim() !== "") {
      try {
        const value: unknown = JSON.parse(operations);
        if (!Array.isArray(value)) throw new Error("not a list");
        parsed = value as ConnectorOperationV1[];
      } catch {
        action.set({ phase: "DONE", messageKey: "conn.register.operations_unreadable" });
        return;
      }
    }
    void action.run(
      () =>
        client.registerConnector({
          provider,
          category: provider === "polaris.workspace" ? "FILES" : category,
          display_name: name.trim(),
          ...(provider === "polaris.rest" ? { rest: restInput(rest) } : { workspace: { project_id: projectId.trim() } }),
          ...(parsed === undefined ? {} : { operations: parsed }),
        }),
      (value) => ({ phase: "DONE", messageKey: "conn.registered", values: { name: value.connector.descriptor.display_name } }),
      onDone,
    );
  };

  return (
    <details className="section fold" aria-labelledby="conn-register-title">
      <summary className="fold__summary">
        <h3 className="section__title" id="conn-register-title">
          {translator.t("conn.register.title")}
        </h3>
      </summary>
      <ActionNote state={action.state} />
      <div className="row">
        <label htmlFor="conn-provider">{translator.t("conn.field.provider")}</label>
        <select id="conn-provider" value={provider} onChange={(event) => setProvider(event.target.value as "polaris.rest" | "polaris.workspace")}>
          <option value="polaris.rest">{translator.t("p06.provider.polaris.rest")}</option>
          <option value="polaris.workspace">{translator.t("p06.provider.polaris.workspace")}</option>
        </select>
      </div>
      <div className="row">
        <label htmlFor="conn-name">{translator.t("conn.field.name")}</label>
        <input id="conn-name" type="text" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      {provider === "polaris.workspace" ? (
        <div className="row">
          <label htmlFor="conn-project">{translator.t("conn.field.project")}</label>
          <input id="conn-project" type="text" maxLength={36} value={projectId} onChange={(event) => setProjectId(event.target.value)} />
          <span className="row__hint">{translator.t("conn.hint.workspace")}</span>
        </div>
      ) : (
        <>
          <div className="row">
            <label htmlFor="conn-category">{translator.t("conn.field.category")}</label>
            <select id="conn-category" value={category} onChange={(event) => setCategory(event.target.value as ConnectorCategory)}>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {translator.t(`p06.category.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <RestFields prefix="conn" draft={rest} onChange={setRest} />
          <div className="row">
            <label htmlFor="conn-operations">{translator.t("conn.field.operations")}</label>
            <textarea id="conn-operations" rows={6} maxLength={60000} value={operations} onChange={(event) => setOperations(event.target.value)} />
            <span className="row__hint">{translator.t("conn.hint.operations")}</span>
          </div>
        </>
      )}
      <button type="button" className="button button--primary conn-register" onClick={submit}>
        {translator.t("conn.action.register")}
      </button>
    </details>
  );
}

function ImportOpenapi({ client, onDone }: { readonly client: Phase06Client; onDone(): void }) {
  const translator = useTranslator();
  const action = useAction();
  const [spec, setSpec] = useState("");
  const [proposal, setProposal] = useState<ConnectorOpenapiImportResultV1 | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConnectorCategory>("CUSTOM_API");
  const [rest, setRest] = useState<RestDraft>(EMPTY_REST);

  const propose = () =>
    void action.run(
      () => client.importOpenapi(spec),
      (value) => {
        setProposal(value);
        // لا عملية مختارة سلفًا: المستخدم يختار ما يوافق عليه واحدةً واحدة.
        setChosen([]);
        setName(value.title);
        setRest({
          ...EMPTY_REST,
          base_url: value.suggested_base_url ?? "",
          allowed_paths: [...new Set(value.operations.map((operation) => operation.path))].join("\n"),
          allowed_methods: [...new Set(value.operations.map((operation) => operation.method))],
        });
        return { phase: "DONE", messageKey: "conn.import.proposed", values: { count: value.operations.length, rejected: value.rejected.length } };
      },
    );

  const approve = () => {
    if (proposal === null) return;
    const [first, ...others] = chosen;
    if (first === undefined) {
      action.set({ phase: "DONE", messageKey: "conn.import.choose" });
      return;
    }
    void action.run(
      () =>
        client.approveOpenapi({
          import_id: proposal.import_id,
          operation_ids: [first, ...others],
          display_name: name.trim(),
          category,
          rest: restInput(rest),
        }),
      (value) => {
        setProposal(null);
        setSpec("");
        return { phase: "DONE", messageKey: "conn.registered", values: { name: value.connector.descriptor.display_name } };
      },
      onDone,
    );
  };

  return (
    <details className="section fold" aria-labelledby="conn-import-title">
      <summary className="fold__summary">
        <h3 className="section__title" id="conn-import-title">
          {translator.t("conn.import.title")}
        </h3>
      </summary>
      <p className="note">{translator.t("conn.import.note")}</p>
      <ActionNote state={action.state} />
      <div className="row">
        <label htmlFor="conn-import-spec">{translator.t("conn.import.spec")}</label>
        <textarea id="conn-import-spec" rows={6} maxLength={1000000} value={spec} onChange={(event) => setSpec(event.target.value)} />
      </div>
      <button type="button" className="button button--secondary conn-import-propose" onClick={propose}>
        {translator.t("conn.import.propose")}
      </button>

      {proposal === null ? null : (
        <div className="p06-import-proposal" data-import-id={proposal.import_id}>
          <p className="muted">
            {translator.t("conn.import.document")} <span className="untrusted">{proposal.title}</span> · <code>{shortDigest(proposal.spec_digest)}</code>
          </p>
          <table className="table p06-proposed">
            <caption className="sr-only">{translator.t("conn.import.proposed")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("conn.column.approve")}</th>
                <th scope="col">{translator.t("conn.column.operation")}</th>
                <th scope="col">{translator.t("conn.column.action")}</th>
                <th scope="col">{translator.t("conn.column.request")}</th>
              </tr>
            </thead>
            <tbody>
              {proposal.operations.map((operation) => (
                <tr key={operation.operation_id} data-operation-id={operation.operation_id}>
                  <td>
                    <input
                      type="checkbox"
                      className="conn-import-choose"
                      aria-label={`${translator.t("conn.column.approve")} ${operation.operation_id}`}
                      checked={chosen.includes(operation.operation_id)}
                      onChange={(event) =>
                        setChosen((current) =>
                          event.target.checked ? [...current, operation.operation_id] : current.filter((value) => value !== operation.operation_id),
                        )
                      }
                    />
                  </td>
                  <th scope="row">
                    <code>{operation.operation_id}</code>
                    <br />
                    <span className="untrusted">{operation.title}</span>
                  </th>
                  <td>
                    <P06Pill namespace="action" member={operation.action} tone={operation.action === "READ" ? "MUTED" : "WARNING"} />
                  </td>
                  <td>
                    <code>
                      {operation.method} {operation.path}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {proposal.rejected.length === 0 ? null : (
            <>
              <h4 className="section__subtitle">{translator.t("conn.import.rejected")}</h4>
              <ul className="p06-rejected">
                {proposal.rejected.map((rejected) => (
                  <li key={`${rejected.method} ${rejected.path}`}>
                    <code>
                      {rejected.method} {rejected.path}
                    </code>{" "}
                    <code className="muted">{rejected.reason}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row">
            <label htmlFor="conn-import-name">{translator.t("conn.field.name")}</label>
            <input id="conn-import-name" type="text" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="row">
            <label htmlFor="conn-import-category">{translator.t("conn.field.category")}</label>
            <select id="conn-import-category" value={category} onChange={(event) => setCategory(event.target.value as ConnectorCategory)}>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {translator.t(`p06.category.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <RestFields prefix="conn-import" draft={rest} onChange={setRest} />
          <button type="button" className="button button--primary conn-import-approve" onClick={approve}>
            {translator.t("conn.import.approve")}
          </button>
        </div>
      )}
    </details>
  );
}

function ConfirmRemove({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const translator = useTranslator();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      className="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conn-remove-title"
      aria-describedby="conn-remove-body"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <h2 id="conn-remove-title" className="section__title">
        {translator.t("conn.remove.title")}
      </h2>
      <p id="conn-remove-body">{translator.t("conn.remove.body")}</p>
      <button type="button" className="button button--secondary" ref={cancelRef} onClick={onCancel}>
        {translator.t("conn.remove.cancel")}
      </button>{" "}
      <button type="button" className="button button--primary conn-remove-confirm" onClick={onConfirm}>
        {translator.t("conn.remove.confirm")}
      </button>
    </div>
  );
}
