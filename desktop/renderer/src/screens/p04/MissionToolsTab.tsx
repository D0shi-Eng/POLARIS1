// لسان الأدوات داخل تفاصيل المهمّة: ما استُعمل، وما مُنع، وما ينتظر قرارًا.
//
// الملاحظة الأخيرة هنا ليست تجميلًا: نتيجة الأداة دليل مقيس، ومع ذلك لا تفي
// بقاعدة تطلب أثر اختبار. من لا يقرأ هذا الفارق يقرأ «شُغِّلت أداة» على أنها
// «نجحت الاختبارات»، وذلك بالضبط ما تمنعه طبقة الحقيقة.

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { Phase04Client } from "../../ipc/p04-client";
import { formatList } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { StateBlock } from "../../ui/components/StateBlock";
import { Approvals, ToolActivity } from "./ActivityScreen";

export function MissionToolsTab({
  client,
  missionId,
}: {
  readonly client: Phase04Client;
  readonly missionId: string;
}) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listActivity({ mission_id: missionId }), [client, missionId]);
  const summary = query.value?.summary;

  return (
    <>
      <p className="note">{translator.t("mission.tools.note")}</p>

      {summary === undefined ? (
        query.loading ? (
          <StateBlock kind="loading" />
        ) : null
      ) : (
        <section className="section" aria-labelledby="mission-tools-summary">
          <h2 className="section__title" id="mission-tools-summary">
            {translator.t("mission.tab.tools")}
          </h2>
          <dl className="facts">
            <dt>{translator.t("mission.tools.skills_used")}</dt>
            <dd>
              {summary.skills_used.length === 0 ? translator.t("activity.evidence.none") : formatList(locale, summary.skills_used)}
            </dd>
            <dt>{translator.t("mission.tools.tools_used")}</dt>
            <dd>
              {summary.tools_used.length === 0 ? translator.t("activity.evidence.none") : formatList(locale, summary.tools_used)}
            </dd>
            <dt>{translator.t("mission.budget.tool_calls")}</dt>
            <dd>
              {summary.usage.tool_calls} / {summary.budget.max_tool_calls}
            </dd>
            <dt>{translator.t("mission.budget.network_tool_calls")}</dt>
            <dd>
              {summary.usage.network_tool_calls} / {summary.budget.max_network_tool_calls}
            </dd>
            <dt>{translator.t("mission.budget.tool_runtime")}</dt>
            <dd>
              {summary.usage.tool_runtime_ms} / {summary.budget.max_tool_runtime_ms}
            </dd>
            <dt>{translator.t("mission.tools.pending")}</dt>
            <dd>{summary.pending_approvals ?? 0}</dd>
          </dl>
        </section>
      )}

      <section className="section" aria-labelledby="mission-tools-activity">
        <h2 className="section__title" id="mission-tools-activity">
          {translator.t("activity.tab.tools")}
        </h2>
        <ToolActivity client={client} missionId={missionId} />
      </section>

      <section className="section" aria-labelledby="mission-tools-approvals">
        <h2 className="section__title" id="mission-tools-approvals">
          {translator.t("activity.tab.approvals")}
        </h2>
        <Approvals client={client} missionId={missionId} />
      </section>
    </>
  );
}
