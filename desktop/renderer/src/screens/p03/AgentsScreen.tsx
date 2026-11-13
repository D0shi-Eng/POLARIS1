// الوكلاء: أوصاف الأدوار المدمجة، وأمثلة الوكلاء العاملة حين تُسمّى مهمّة.
//
// لا مقياس إنتاجية ولا تقييم أداء: لا قياس يسنده. ما يُعرض هو ما يعرفه المضيف —
// الدور، وما يُسمح له من أنواع العُقد، وحدّ التفويض، وهل هو مُفعَّل. والصنف
// الأمني توثيقي: يُعرض ولا يمنح شيئًا.

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { Phase03Client } from "../../ipc/p03-client";
import { formatInstant, formatList } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { agentStateTone } from "../../p03/present";
import { ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { StatusPill } from "./StatusPill";

export function AgentsScreen({ client, missionId }: { readonly client: Phase03Client; readonly missionId?: string }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(
    () => client.listAgents(missionId === undefined ? {} : { mission_id: missionId }),
    [client, missionId],
  );
  const roles = query.value?.roles ?? [];
  const instances = query.value?.instances ?? [];

  return (
    <>
      {missionId === undefined ? (
        <>
          <h1 className="page-title">{translator.t("nav.agents")}</h1>
          <p className="page-subtitle">{translator.t("agents.subtitle")}</p>
        </>
      ) : null}

      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}

      <section className="section" aria-labelledby="agents-instances">
        <h2 className="section__title" id="agents-instances">
          {translator.t("agents.instances.title")}
        </h2>
        {instances.length === 0 ? (
          <StateBlock kind="empty" bodyKey="agents.instances.empty" />
        ) : (
          <table className="table">
            <caption className="sr-only">{translator.t("agents.instances.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("agents.column.role")}</th>
                <th scope="col">{translator.t("agents.column.status")}</th>
                <th scope="col">{translator.t("agents.column.model")}</th>
                <th scope="col">{translator.t("agents.column.depth")}</th>
                <th scope="col">{translator.t("missions.column.activity")}</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((agent) => (
                <tr key={agent.agent_id}>
                  <th scope="row">{translator.t(`p03.role.${agent.role}`)}</th>
                  <td>
                    <StatusPill namespace="agent_state" member={agent.state} tone={agentStateTone(agent.state)} />
                  </td>
                  <td>{agent.model_id ?? translator.t("agents.model.none")}</td>
                  <td>{agent.delegation_depth}</td>
                  <td>{formatInstant(locale, agent.last_active_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section" aria-labelledby="agents-roles">
        <h2 className="section__title" id="agents-roles">
          {translator.t("agents.roles.title")}
        </h2>
        {roles.length === 0 && !query.loading ? <StateBlock kind="empty" bodyKey="agents.instances.empty" /> : null}
        {roles.length === 0 ? null : (
          <table className="table">
            <caption className="sr-only">{translator.t("agents.roles.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("agents.column.role")}</th>
                <th scope="col">{translator.t("agents.column.tasks")}</th>
                <th scope="col">{translator.t("agents.column.review")}</th>
                <th scope="col">{translator.t("agents.column.depth")}</th>
                <th scope="col">{translator.t("agents.column.security")}</th>
                <th scope="col">{translator.t("agents.column.enabled")}</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.agent_type}>
                  <th scope="row">
                    {translator.t(`p03.role.${role.agent_type}`)}
                    <span className="muted"> — {translator.t(role.purpose_key)}</span>
                  </th>
                  <td>
                    {role.allowed_task_types.length === 0
                      ? translator.t("agents.task.none")
                      : formatList(locale, role.allowed_task_types.map((type) => translator.t(`p03.task_type.${type}`)))}
                  </td>
                  <td>{translator.t(role.review_eligible ? "agents.enabled.yes" : "agents.enabled.no")}</td>
                  <td>{translator.t("agents.budget.depth", { max: role.max_delegation_depth })}</td>
                  <td>{translator.t(`p03.security_class.${role.security_class}`)}</td>
                  <td>{translator.t(role.enabled ? "agents.enabled.yes" : "agents.enabled.no")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
