// تفاصيل مشروع: نظرة عامة، والسياق، والنموذج، والإعدادات.
//
// كل تبويب يقرأ من نفس نتيجة `project.get` ويعيد تحميلها بعد أي تغيير. الإصدار
// المتوقَّع يُرسل مع كل تعديل، والتعارض يُعرض خطأً قابلًا للإعادة لا كتابةً فوق
// تغيير أحدث.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { Phase02Client } from "../../ipc/p02-client";
import { ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { ProjectContextTab } from "./ProjectContextTab";
import { ProjectModelTab } from "./ProjectModelTab";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectSettingsTab } from "./ProjectSettingsTab";

const TABS = ["overview", "context", "model", "settings"] as const;
type Tab = (typeof TABS)[number];

export function ProjectDetailScreen({ client, projectId }: { readonly client: Phase02Client; readonly projectId: string }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const [tab, setTab] = useState<Tab>("overview");
  const query = useHostQuery(() => client.getProject(projectId), [client, projectId]);
  const detail = query.value;

  return (
    <>
      <h1 className="page-title" dir="auto">
        {detail?.project.name ?? translator.t("project.detail.title")}
      </h1>
      <div className="toolbar">
        <button type="button" className="button button--secondary" onClick={() => navigation.navigate("/projects")}>
          {translator.t("project.back")}
        </button>
      </div>

      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {query.loading && detail === null ? <StateBlock kind="loading" /> : null}

      {detail === null ? null : (
        <>
          {detail.project.status === "ARCHIVED" ? <p className="note">{translator.t("project.archived.note")}</p> : null}
          <div className="tabs" role="tablist" aria-label={translator.t("project.tabs")}>
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`project-tab-${id}`}
                className="tabs__tab"
                aria-selected={tab === id}
                aria-controls={`project-panel-${id}`}
                onClick={() => setTab(id)}
              >
                {translator.t(`project.tab.${id}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`project-panel-${tab}`} aria-labelledby={`project-tab-${tab}`}>
            {tab === "overview" ? <ProjectOverviewTab client={client} detail={detail} onChanged={query.reload} /> : null}
            {tab === "context" ? <ProjectContextTab client={client} detail={detail} onChanged={query.reload} /> : null}
            {tab === "model" ? <ProjectModelTab client={client} detail={detail} onChanged={query.reload} /> : null}
            {tab === "settings" ? <ProjectSettingsTab client={client} detail={detail} onChanged={query.reload} /> : null}
          </div>
          {/* لوحات التبويبات غير المختارة موجودة مخفية فارغة، فيبقى مرجع aria-controls لكل تبويب سليمًا. */}
          {TABS.filter((id) => id !== tab).map((id) => (
            <div key={id} role="tabpanel" id={`project-panel-${id}`} aria-labelledby={`project-tab-${id}`} hidden />
          ))}
        </>
      )}
    </>
  );
}
