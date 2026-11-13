// خوادم الأدوات (MCP): التسجيل، والسقف، والاكتشاف، وما رُفض ولماذا.
//
// ثلاث حقائق تُعرض هنا لأنها ليست بديهية: النقل واحد ولا يشغّل عملية، والسقف من
// المستخدم لا من الخادم، وكل ما يعلنه الخادم بيانات تُعرض ولا تُطاع. والمرفوض
// يُعرض باسمه وسببه، لأن إسقاطه صامتًا يجعل المستخدم يظنّ أن الخادم لم يعلنه.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase04Client } from "../../ipc/p04-client";
import type { McpRefreshResultV1, ToolEffect } from "../../generated/types/desktop-p04-result-v1";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { canRefresh, serverTone } from "../../p04/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import type { Phase08Client } from "../../ipc/p08-client";
import { EffectList, P04Pill } from "./P04Pill";
import { RedefinitionNotice } from "./RedefinitionNotice";

/// الآثار التي يجوز للمستخدم منحها لخادم. تنفيذ العملية والوصول إلى السرّ ليسا
/// منها: لا قدرة لهما في هذا البناء، فعرضهما اختيارًا يكون كذبًا على المستخدم.
const GRANTABLE: readonly ToolEffect[] = ["LOCAL_COMPUTE", "NETWORK_EGRESS", "READ_LOCAL", "DATABASE_READ"];

/**
 * `embedded`: الشاشة جزء من صفحة الموصلات في Phase-06، فعنوانها قسم لا عنوان صفحة.
 * السلوك نفسه، والمعرّفات نفسها.
 */
export function ConnectorsScreen({ client, phase08, embedded = false }: { readonly client: Phase04Client; readonly phase08?: Phase08Client; readonly embedded?: boolean }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listServers(), [client]);
  const action = useAction();
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [grant, setGrant] = useState<readonly ToolEffect[]>(["LOCAL_COMPUTE", "NETWORK_EGRESS"]);
  const [refresh, setRefresh] = useState<McpRefreshResultV1 | null>(null);
  const servers = query.value?.servers ?? [];

  return (
    <>
      {embedded ? (
        <h2 className="section__title">{translator.t("mcp.embedded.title")}</h2>
      ) : (
        <h1 className="page-title">{translator.t("nav.connectors")}</h1>
      )}
      <p className="page-subtitle">{translator.t("mcp.subtitle")}</p>
      <p className="note">{translator.t("mcp.note.transport")}</p>
      <p className="note">{translator.t("mcp.note.grant")}</p>

      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />

      <section className="section" aria-labelledby="mcp-register">
        <h2 className="section__title" id="mcp-register">
          {translator.t("mcp.register.title")}
        </h2>
        <div className="row">
          <label htmlFor="mcp-name">{translator.t("mcp.field.name")}</label>
          <input id="mcp-name" type="text" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="row">
          <label htmlFor="mcp-endpoint">{translator.t("mcp.field.endpoint")}</label>
          <input
            id="mcp-endpoint"
            type="text"
            value={endpoint}
            maxLength={300}
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <p className="muted">{translator.t("mcp.field.endpoint_hint")}</p>
        </div>
        <fieldset className="row">
          <legend>{translator.t("mcp.field.grant")}</legend>
          {GRANTABLE.map((effect) => (
            <label key={effect} htmlFor={`mcp-grant-${effect}`}>
              <input
                id={`mcp-grant-${effect}`}
                type="checkbox"
                checked={grant.includes(effect)}
                onChange={(event) =>
                  setGrant((current) =>
                    event.target.checked ? [...current, effect] : current.filter((entry) => entry !== effect),
                  )
                }
              />
              {translator.t(`p04.effect.${effect}`)}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className="button button--primary"
          disabled={name.trim() === "" || endpoint.trim() === ""}
          onClick={() =>
            void action.run(
              () => client.registerServer({ name, endpoint, granted_effects: grant }),
              () => ({ phase: "DONE", messageKey: "mcp.registered" }),
              () => {
                setName("");
                setEndpoint("");
                query.reload();
              },
            )
          }
        >
          {translator.t("mcp.register.submit")}
        </button>
      </section>

      <section className="section" aria-labelledby="mcp-list">
        <h2 className="section__title" id="mcp-list">
          {translator.t("nav.connectors")}
        </h2>
        {servers.length === 0 && !query.loading ? (
          <StateBlock kind="empty" bodyKey="mcp.empty" />
        ) : (
          <table className="table">
            <caption className="sr-only">{translator.t("nav.connectors")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("mcp.column.name")}</th>
                <th scope="col">{translator.t("mcp.column.endpoint")}</th>
                <th scope="col">{translator.t("mcp.column.state")}</th>
                <th scope="col">{translator.t("mcp.column.grant")}</th>
                <th scope="col">{translator.t("mcp.column.tools")}</th>
                <th scope="col">{translator.t("mcp.column.refreshed")}</th>
                <th scope="col">{translator.t("skills.column.state")}</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.server_id}>
                  <th scope="row">{server.name}</th>
                  <td>
                    <code>{server.endpoint}</code>
                    <p className="muted">{translator.t(`p04.transport.${server.transport}`)}</p>
                  </td>
                  <td>
                    <P04Pill namespace="server" member={server.state} tone={serverTone(server.state)} />
                    {server.last_error === undefined ? null : (
                      <p className="muted">
                        {translator.t("mcp.last_error")}: {translator.t(`p04.denial.${server.last_error}`)}
                      </p>
                    )}
                  </td>
                  <td>
                    <EffectList effects={server.granted_effects} />
                  </td>
                  <td>
                    {server.tool_count}
                    {server.rejected_tool_count === undefined || server.rejected_tool_count === 0 ? null : (
                      <span className="muted"> (+{server.rejected_tool_count})</span>
                    )}
                  </td>
                  <td>
                    {server.last_refresh_at === undefined
                      ? translator.t("mcp.never_refreshed")
                      : formatInstant(locale, server.last_refresh_at)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--secondary"
                      aria-label={`${translator.t(server.state === "DISABLED" ? "mcp.action.enable" : "mcp.action.disable")} ${server.name}`}
                      onClick={() =>
                        void action.run(
                          () => client.configureServer(server.server_id, server.state === "DISABLED"),
                          () => ({ phase: "DONE", messageKey: "p04.action.saved" }),
                          query.reload,
                        )
                      }
                    >
                      {translator.t(server.state === "DISABLED" ? "mcp.action.enable" : "mcp.action.disable")}
                    </button>{" "}
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={!canRefresh(server.state)}
                      aria-label={`${translator.t("mcp.action.refresh")} ${server.name}`}
                      onClick={() =>
                        void action.run(
                          () => client.refreshServer(server.server_id),
                          (value) => {
                            setRefresh(value);
                            return {
                              phase: "DONE",
                              messageKey: "mcp.refreshed",
                              values: { accepted: value.accepted.length, rejected: value.rejected.length },
                            };
                          },
                          query.reload,
                        )
                      }
                    >
                      {translator.t("mcp.action.refresh")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RedefinitionNotice
        pending={refresh?.pending_redefinitions ?? []}
        client={phase08}
        onAccepted={(toolId) => setRefresh((current) => (current === null ? current : { ...current, pending_redefinitions: (current.pending_redefinitions ?? []).filter((t) => t !== toolId) }))}
      />

      {refresh === null || refresh.rejected.length === 0 ? null : (
        <section className="section" aria-labelledby="mcp-rejected">
          <h2 className="section__title" id="mcp-rejected">
            {translator.t("mcp.refresh.rejected")}
          </h2>
          <p className="note">{translator.t("mcp.note.untrusted")}</p>
          <table className="table">
            <caption className="sr-only">{translator.t("mcp.refresh.rejected")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("tools.column.name")}</th>
                <th scope="col">{translator.t("mcp.refresh.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {refresh.rejected.map((rejected, index) => (
                <tr key={`${rejected.declared_name}-${index}`}>
                  <th scope="row">{rejected.declared_name}</th>
                  <td>{translator.t(`p04.denial.${rejected.reason}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
