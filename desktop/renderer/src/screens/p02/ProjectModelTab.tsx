// نموذج المشروع: الافتراضي الخاص به، وتجربة استدعاء.
//
// سلسلة الاختيار صريحة: افتراضي المشروع، ثم افتراضي المستخدم، ثم لا شيء. لا
// اختيار تلقائي آخر. ولا قيد «محلي/بعيد» (ADR-040): النموذج المختار يستلم سياق المشروع.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import { useHostQuery, type ActionState } from "../../app/useHostQuery";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { InvokePanel } from "./InvokePanel";
import type { ProjectTabProps } from "./ProjectOverviewTab";

export function ProjectModelTab({ client, detail, onChanged }: ProjectTabProps) {
  const translator = useTranslator();
  const project = detail.project;
  const readOnly = project.status === "ARCHIVED";
  const models = useHostQuery(() => client.listModels({ only_selectable: true }), [client]);
  const [action, setAction] = useState<ActionState>({ phase: "IDLE" });
  const [attachContext, setAttachContext] = useState(true);
  const selectable = models.value?.models ?? [];
  const sourceIds = detail.sources.filter((source) => source.availability === "AVAILABLE").map((source) => source.source_id);

  async function update(change: { readonly default_model_id?: string | null }): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.updateProject({ project_id: project.project_id, expected_version: project.version, ...change });
    setAction(result.ok ? { phase: "DONE", messageKey: "project.action.saved" } : { phase: "FAILED", error: result.error });
    onChanged();
  }

  return (
    <>
      <section className="section card" aria-labelledby="project-model-settings">
        <h2 className="section__title" id="project-model-settings">
          {translator.t("project.model.title")}
        </h2>
        <div className="form">
          <label className="form__row" htmlFor="project-default-model">
            {translator.t("project.model.default")}
            <select
              id="project-default-model"
              className="select"
              value={project.default_model_id ?? ""}
              disabled={readOnly || action.phase === "RUNNING"}
              onChange={(event) => void update({ default_model_id: event.target.value === "" ? null : event.target.value })}
            >
              <option value="">{translator.t("project.model.inherit")}</option>
              {project.default_model_id !== undefined && !selectable.some((model) => model.model_id === project.default_model_id) ? (
                <option value={project.default_model_id}>{project.default_model_id}</option>
              ) : null}
              {selectable.map((model) => (
                <option key={model.model_id} value={model.model_id}>
                  {model.display_name.value ?? model.provider_model_id}
                </option>
              ))}
            </select>
          </label>
          <p className="row__hint">{translator.t(`project.model_origin.${detail.effective_model_origin}`)}</p>
        </div>
        <ActionNote state={action} />
      </section>

      {models.error !== null ? <ErrorNote error={models.error} onRetry={models.reload} /> : null}

      {readOnly ? null : (
        <div className="section">
          <label className="check" htmlFor="project-use-context">
            <input
              id="project-use-context"
              type="checkbox"
              checked={attachContext}
              disabled={sourceIds.length === 0}
              onChange={(event) => setAttachContext(event.target.checked)}
            />
            {translator.t("project.model.use_context", { count: sourceIds.length })}
          </label>
          <InvokePanel
            client={client}
            models={selectable}
            idBase="project-invoke"
            projectId={project.project_id}
            contextSourceIds={attachContext ? sourceIds.slice(0, 32) : []}
          />
        </div>
      )}
    </>
  );
}
