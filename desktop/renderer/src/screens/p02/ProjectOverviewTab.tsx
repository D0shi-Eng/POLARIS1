// نظرة عامة على مشروع: حقائقه، والنموذج الفعلي ومصدره، والأرشفة.
//
// الأرشفة لا تحذف شيئًا: المشروع يصير للقراءة فقط، ويمكن إرجاعه.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { ActionState } from "../../app/useHostQuery";
import type { ProjectGetResultV1 } from "../../generated/types/desktop-p02-result-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { ActionNote } from "../../ui/components/Notes";

export interface ProjectTabProps {
  readonly client: Phase02Client;
  readonly detail: ProjectGetResultV1;
  onChanged(): void;
}

export function ProjectOverviewTab({ client, detail, onChanged }: ProjectTabProps) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const [action, setAction] = useState<ActionState>({ phase: "IDLE" });
  const project = detail.project;
  const archived = project.status === "ARCHIVED";

  async function toggleArchive(): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.archiveProject(project.project_id, project.version, !archived);
    setAction(
      result.ok
        ? { phase: "DONE", messageKey: archived ? "project.action.restored" : "project.action.archived" }
        : { phase: "FAILED", error: result.error },
    );
    onChanged();
  }

  return (
    <section className="card">
      {project.description === "" ? null : (
        <p className="row__hint" dir="auto">
          {project.description}
        </p>
      )}
      <dl className="facts">
        <div>
          <dt className="fact__label">{translator.t("project.fact.status")}</dt>
          <dd className="fact__value">{translator.t(`projects.status.${project.status}`)}</dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.language")}</dt>
          <dd className="fact__value">{translator.t(`locale.name.${project.language}`)}</dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.workspace")}</dt>
          <dd className="fact__value mono">{project.workspace_root ?? translator.t("p02.value.none")}</dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.sources")}</dt>
          <dd className="fact__value">{translator.plural("projects.sources", project.context_source_count)}</dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.effective_model")}</dt>
          <dd className="fact__value">
            <span className="mono">{detail.effective_model_id ?? translator.t("p02.value.none")}</span>
            <span className="row__hint">{translator.t(`project.model_origin.${detail.effective_model_origin}`)}</span>
          </dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.created")}</dt>
          <dd className="fact__value">{formatInstant(locale, project.created_at)}</dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.updated")}</dt>
          <dd className="fact__value">{formatInstant(locale, project.updated_at)}</dd>
        </div>
        <div>
          <dt className="fact__label">{translator.t("project.fact.version")}</dt>
          <dd className="fact__value">{project.version}</dd>
        </div>
      </dl>
      <div className="toolbar" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="button button--secondary"
          disabled={action.phase === "RUNNING"}
          onClick={() => void toggleArchive()}
        >
          {translator.t(archived ? "project.action.restore" : "project.action.archive")}
        </button>
      </div>
      <p className="row__hint">{translator.t("project.archive.hint")}</p>
      <ActionNote state={action} />
    </section>
  );
}
