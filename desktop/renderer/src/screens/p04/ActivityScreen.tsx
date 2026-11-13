// النشاط: كل محاولة لاستعمال أداة، والموافقات المعلّقة.
//
// الرفض يُعرض تمامًا كما يُعرض النجاح، وبسببه. شاشةٌ تُظهر النجاحات وحدها تجعل
// «لم يحدث شيء» و«مُنع شيء» متطابقين، وهما ليسا كذلك.
//
// والحجج لا تُعرض: تُعرض بصمتها ومعاينة محدودة عند الموافقة. محتوى وصل من طرف
// غير موثوق لا يتحوّل إلى نصّ كامل على الشاشة.

import { useState, type ReactNode } from "react";

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { Phase04Client } from "../../ipc/p04-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { approvalTone, invocationTone, shortDigest, tallyActivity } from "../../p04/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { ConnectorActionNote } from "../p06/ConnectorApproval";
import { EffectList, P04Pill } from "./P04Pill";

type Tab = "tools" | "approvals";

/** `links`: روابط الرصد من Phase-06 حين تكون متاحة. الشاشة لا تعرف عنها غير أنها عقدة تُرسم. */
export function ActivityScreen({ client, links }: { readonly client: Phase04Client; readonly links?: ReactNode }) {
  const translator = useTranslator();
  const [tab, setTab] = useState<Tab>("tools");

  return (
    <>
      <h1 className="page-title">{translator.t("nav.activity")}</h1>
      <p className="page-subtitle">{translator.t("activity.subtitle")}</p>
      {links ?? null}

      <div role="tablist" aria-label={translator.t("nav.activity")}>
        {(["tools", "approvals"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`activity-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`activity-panel-${id}`}
            className={`tab${tab === id ? " tab--active" : ""}`}
            onClick={() => setTab(id)}
          >
            {translator.t(`activity.tab.${id}`)}
          </button>
        ))}
      </div>

      {/* كل تبويب يسمّي لوحته، فاللوحات كلها موجودة: المختارة بمحتواها، والباقية مخفية فارغة.
          مرجع aria-controls إلى لوحة غير مرسومة مرجع مكسور (تدقيق Phase-07). */}
      {(["tools", "approvals"] as const).map((id) => (
        <div key={id} role="tabpanel" id={`activity-panel-${id}`} aria-labelledby={`activity-tab-${id}`} hidden={tab !== id}>
          {tab !== id ? null : id === "tools" ? <ToolActivity client={client} /> : <Approvals client={client} />}
        </div>
      ))}
    </>
  );
}

export function ToolActivity({ client, missionId }: { readonly client: Phase04Client; readonly missionId?: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(
    () => client.listActivity(missionId === undefined ? {} : { mission_id: missionId }),
    [client, missionId],
  );
  const records = query.value?.invocations ?? [];
  const tally = tallyActivity(records);

  return (
    <>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <p className="note">{translator.t("activity.note.digest")}</p>
      <p role="status">{translator.t("activity.tally", { ...tally })}</p>

      {records.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey={missionId === undefined ? "activity.empty" : "mission.tools.empty"} />
      ) : (
        <table className="table">
          <caption className="sr-only">{translator.t("activity.tab.tools")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("activity.column.tool")}</th>
              <th scope="col">{translator.t("activity.column.status")}</th>
              <th scope="col">{translator.t("activity.column.effects")}</th>
              <th scope="col">{translator.t("activity.column.started")}</th>
              <th scope="col">{translator.t("activity.column.duration")}</th>
              <th scope="col">{translator.t("activity.column.evidence")}</th>
              <th scope="col">{translator.t("activity.digest.arguments")}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.invocation_id}>
                <th scope="row">
                  <code>{record.tool_id}</code>
                  <br />
                  <span className="muted">{record.skill_id}</span>
                </th>
                <td>
                  <P04Pill namespace="invocation" member={record.status} tone={invocationTone(record.status)} />
                  {record.denial_reason === undefined ? null : (
                    <p className="muted">
                      {translator.t("activity.denial")} {translator.t(`p04.denial.${record.denial_reason}`)}
                    </p>
                  )}
                </td>
                <td>
                  <EffectList effects={record.effects} />
                </td>
                <td>{formatInstant(locale, record.started_at)}</td>
                <td>{record.duration_ms}</td>
                <td>
                  {translator.t(record.evidence_id === undefined ? "activity.evidence.none" : "activity.evidence.recorded")}
                  {record.result_digest === undefined ? null : (
                    <>
                      <br />
                      <code title={record.result_digest}>{shortDigest(record.result_digest)}</code>
                    </>
                  )}
                </td>
                <td>
                  <code title={record.arguments_digest}>{shortDigest(record.arguments_digest)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function Approvals({ client, missionId }: { readonly client: Phase04Client; readonly missionId?: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(
    () => client.listApprovals(missionId === undefined ? {} : { mission_id: missionId }),
    [client, missionId],
  );
  const action = useAction();
  const approvals = query.value?.approvals ?? [];

  return (
    <>
      <p className="page-subtitle">{translator.t("approvals.subtitle")}</p>
      <p className="note">{translator.t("approvals.note.binding")}</p>
      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />

      {approvals.length === 0 && !query.loading ? (
        <StateBlock kind="empty" bodyKey="approvals.empty" />
      ) : (
        <table className="table">
          <caption className="sr-only">{translator.t("activity.tab.approvals")}</caption>
          <thead>
            <tr>
              <th scope="col">{translator.t("approvals.column.tool")}</th>
              <th scope="col">{translator.t("approvals.column.effects")}</th>
              <th scope="col">{translator.t("approvals.column.requested")}</th>
              <th scope="col">{translator.t("approvals.column.expires")}</th>
              <th scope="col">{translator.t("approvals.column.status")}</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((approval) => (
              <tr key={approval.approval_id} data-approval-id={approval.approval_id}>
                <th scope="row">
                  <code>{approval.tool_id}</code>
                  <br />
                  <span className="muted">{approval.reason ?? ""}</span>
                  <br />
                  <code className="muted" title={approval.arguments_digest}>
                    {shortDigest(approval.arguments_digest)}
                  </code>
                  {approval.context === undefined ? null : (
                    <div className="approval-context" role="group" aria-label={translator.t("approvals.context.title")}>
                      <p className="note">{translator.t("approvals.context.note")}</p>
                      <dl className="facts">
                        <dt>{translator.t("approvals.context.agent")}</dt>
                        <dd>
                          <code>{approval.context.agent_id}</code>
                        </dd>
                        <dt>{translator.t("approvals.context.mission")}</dt>
                        <dd>
                          <code>{approval.mission_id}</code>
                        </dd>
                        <dt>{translator.t("approvals.context.action")}</dt>
                        <dd>
                          <code>{approval.context.action}</code>
                          <ConnectorActionNote action={approval.context.action} />
                        </dd>
                        <dt>{translator.t("approvals.context.target")}</dt>
                        <dd>{approval.context.target}</dd>
                        <dt>{translator.t("approvals.context.effect")}</dt>
                        <dd>{approval.context.expected_effect}</dd>
                        <dt>{translator.t("approvals.context.risk")}</dt>
                        <dd>
                          <P04Pill namespace="risk" member={approval.context.risk} tone={approval.context.risk === "LOW" ? "MUTED" : "WARNING"} />
                        </dd>
                        <dt>{translator.t("approvals.context.arguments")}</dt>
                        <dd>
                          <code>{approval.context.arguments_summary}</code>
                        </dd>
                      </dl>
                    </div>
                  )}
                </th>
                <td>
                  <EffectList effects={approval.effects} />
                </td>
                <td>{formatInstant(locale, approval.requested_at)}</td>
                <td>{formatInstant(locale, approval.expires_at)}</td>
                <td>
                  <P04Pill namespace="approval" member={approval.status} tone={approvalTone(approval.status)} />
                  {approval.status !== "PENDING" ? null : (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="button button--primary"
                        aria-label={`${translator.t("approvals.action.grant")} ${approval.tool_id}`}
                        onClick={() =>
                          void action.run(
                            () => client.respondToApproval(approval.approval_id, "GRANT"),
                            () => ({ phase: "DONE", messageKey: "approvals.granted" }),
                            query.reload,
                          )
                        }
                      >
                        {translator.t("approvals.action.grant")}
                      </button>{" "}
                      <button
                        type="button"
                        className="button button--secondary"
                        aria-label={`${translator.t("approvals.action.deny")} ${approval.tool_id}`}
                        onClick={() =>
                          void action.run(
                            () => client.respondToApproval(approval.approval_id, "DENY"),
                            () => ({ phase: "DONE", messageKey: "approvals.denied" }),
                            query.reload,
                          )
                        }
                      >
                        {translator.t("approvals.action.deny")}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
