// المشاريع: قائمة حقيقية من مخزن المضيف، وإنشاء مشروع جديد.
//
// جذر مساحة العمل مرجعُ نطاقٍ للسياق، لا إذنٌ بنظام الملفات. المضيف يتحقق منه
// (مسار مطلق، مجلد موجود، ليس نقطة إعادة توجيه) ويرفضه إن لم يصلح.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery, type ActionState } from "../../app/useHostQuery";
import type { Language } from "../../generated/types/desktop-p02-request-v1";
import type { Phase02Client } from "../../ipc/p02-client";
import { formatInstant } from "../../localization/format";
import { LOCALES, type LocaleCode } from "../../localization/types";
import { projectPath } from "../../routes/registry";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";

export function ProjectsScreen({ client }: { readonly client: Phase02Client }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState<Language>(locale);
  const [workspace, setWorkspace] = useState("");
  const [action, setAction] = useState<ActionState>({ phase: "IDLE" });

  const query = useHostQuery(
    () => client.listProjects({ include_archived: includeArchived, ...(search.trim() === "" ? {} : { query: search.trim() }) }),
    [client, includeArchived, search],
  );
  const projects = query.value?.projects ?? [];

  async function create(): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.createProject({
      name: name.trim(),
      language,
      ...(description.trim() === "" ? {} : { description: description.trim() }),
      ...(workspace.trim() === "" ? {} : { workspace_root: workspace.trim() }),
    });
    if (!result.ok) {
      setAction({ phase: "FAILED", error: result.error });
      return;
    }
    setAction({ phase: "DONE", messageKey: "projects.created" });
    setName("");
    setDescription("");
    setWorkspace("");
    navigation.navigate(projectPath(result.value.project.project_id));
  }

  return (
    <>
      <h1 className="page-title">{translator.t("nav.projects")}</h1>
      <p className="page-subtitle">{translator.t("projects.subtitle")}</p>

      <section className="section card" aria-labelledby="projects-create">
        <h2 className="section__title" id="projects-create">
          {translator.t("projects.create.title")}
        </h2>
        <div className="form">
          <label className="form__row" htmlFor="project-name">
            {translator.t("projects.field.name")}
            <input id="project-name" className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="form__row" htmlFor="project-description">
            {translator.t("projects.field.description")}
            <textarea
              id="project-description"
              className="textarea"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="form__row" htmlFor="project-language">
            {translator.t("projects.field.language")}
            <select id="project-language" className="select" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {translator.t(`locale.name.${code}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="form__row" htmlFor="project-workspace">
            {translator.t("projects.field.workspace")}
            <input
              id="project-workspace"
              className="input input--mono"
              value={workspace}
              spellCheck={false}
              aria-describedby="project-workspace-hint"
              onChange={(event) => setWorkspace(event.target.value)}
            />
          </label>
          <p className="row__hint" id="project-workspace-hint">
            {translator.t("projects.field.workspace.hint")}
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="button button--primary"
              disabled={name.trim() === "" || action.phase === "RUNNING"}
              onClick={() => void create()}
            >
              {translator.t("projects.create.submit")}
            </button>
          </div>
          <ActionNote state={action} />
        </div>
      </section>

      <div className="toolbar">
        <label className="field" htmlFor="projects-search">
          {translator.t("projects.search")}
          <input id="projects-search" className="input" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="check" htmlFor="projects-archived">
          <input
            id="projects-archived"
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          {translator.t("projects.include_archived")}
        </label>
      </div>

      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      {query.loading && query.value === null ? <StateBlock kind="loading" /> : null}
      {query.value !== null && projects.length === 0 ? <StateBlock kind="empty" bodyKey="projects.empty" /> : null}

      <section className="list-card" aria-label={translator.t("projects.list")}>
        {projects.map((project) => (
          <article className="item" key={project.project_id} aria-labelledby={`project-${project.project_id}`}>
            <div className="item__head">
              <h2 className="item__title" id={`project-${project.project_id}`} dir="auto">
                {project.name}
              </h2>
              <span className={`pill pill--${project.status === "ACTIVE" ? "POSITIVE" : "MUTED"}`}>
                {translator.t(`projects.status.${project.status}`)}
              </span>
            </div>
            {project.description === "" ? null : (
              <p className="row__hint" dir="auto">
                {project.description}
              </p>
            )}
            <p className="item__meta">
              <span>{translator.plural("projects.sources", project.context_source_count)}</span>
              <span>{translator.t("projects.updated", { at: formatInstant(locale, project.updated_at) })}</span>
            </p>
            <div className="toolbar" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="button button--secondary"
                aria-label={translator.t("projects.open_named", { name: project.name })}
                onClick={() => navigation.navigate(projectPath(project.project_id))}
              >
                {translator.t("projects.open")}
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
