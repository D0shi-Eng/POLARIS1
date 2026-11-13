// الأدوات: السجل المغلق، بأثر كل أداة وقدرتها وصنف ثقتها.
//
// ما لا يوجد هنا مقصود: لا زرّ ينفّذ أداة. العارض لا يملك عملية تنفيذ، فلا يمكن
// للشاشة أن تعرض زرًّا يقود إلى واحدة. والتنفيذ يبدأ من مهمّة، عبر البوابة وحدها.

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { Phase04Client } from "../../ipc/p04-client";
import { formatList } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { riskTone, shortDigest, trustTone } from "../../p04/present";
import { ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { EffectList, P04Pill } from "./P04Pill";

/// ما أعلنه المصدر عن أثر الأداة، إن أعلن. غيابه ليس صفرًا ولا خطأ: أداة مدمجة
/// لا مصدر خارجي لها لا تُعلن شيئًا، وأثرها المُنفَذ هو ما تعرضه البوابة.
function declaredEffects(tool: { readonly provenance: { readonly declared_effects?: readonly string[] } }): readonly string[] {
  return tool.provenance.declared_effects ?? [];
}

export function ToolsScreen({ client }: { readonly client: Phase04Client }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listTools(), [client]);
  const tools = query.value?.tools ?? [];

  return (
    <>
      <h1 className="page-title">{translator.t("tools.title")}</h1>
      <p className="page-subtitle">{translator.t("tools.subtitle")}</p>
      <p className="note">{translator.t("tools.note.closed")}</p>

      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}

      <section className="section" aria-labelledby="tools-list">
        <h2 className="section__title" id="tools-list">
          {translator.t("tools.title")}
        </h2>
        {tools.length === 0 && !query.loading ? (
          <StateBlock kind="empty" bodyKey="tools.empty" />
        ) : (
          <table className="table">
            <caption className="sr-only">{translator.t("tools.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("tools.column.name")}</th>
                <th scope="col">{translator.t("tools.column.provider")}</th>
                <th scope="col">{translator.t("tools.column.effects")}</th>
                <th scope="col">{translator.t("tools.column.risk")}</th>
                <th scope="col">{translator.t("tools.column.approval")}</th>
                <th scope="col">{translator.t("tools.column.network")}</th>
                <th scope="col">{translator.t("tools.column.trust")}</th>
                <th scope="col">{translator.t("tools.field.digest")}</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.tool_id}>
                  <th scope="row">
                    {tool.name}
                    <span className="muted"> — {tool.description}</span>
                    <br />
                    <code className="muted">{tool.tool_id}</code>
                  </th>
                  <td>
                    <P04Pill namespace="provider" member={tool.provider} tone="MUTED" />
                  </td>
                  <td>
                    <EffectList effects={tool.effects} />
                    {declaredEffects(tool).length > 0 ? (
                      <p className="muted">
                        {translator.t("tools.note.declared", {
                          effects: formatList(
                            locale,
                            declaredEffects(tool).map((effect) => translator.t(`p04.effect.${effect}`)),
                          ),
                        })}
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <P04Pill namespace="risk" member={tool.risk} tone={riskTone(tool.risk)} />
                  </td>
                  <td>
                    {translator.t(tool.requires_approval ? "tools.approval.required" : "tools.approval.not_required")}
                  </td>
                  <td>
                    <P04Pill namespace="network" member={tool.network_policy} tone="MUTED" />
                  </td>
                  <td>
                    <P04Pill namespace="trust" member={tool.trust_class} tone={trustTone(tool.trust_class)} />
                  </td>
                  <td>
                    <code title={tool.provenance.schema_digest ?? ""}>{shortDigest(tool.provenance.schema_digest ?? "")}</code>
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
