// إعدادات المشروع: الاسم، والوصف، واللغة، وجذر مساحة العمل.
//
// كل حفظ يرسل الإصدار الذي رآه المستخدم. إن تغيّر المشروع في مكان آخر، يرفض
// المضيف الحفظ ويُطلب تحديث الصفحة، بدل أن يُكتب فوق التغيير الأحدث.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { ActionState } from "../../app/useHostQuery";
import type { Language } from "../../generated/types/desktop-p02-request-v1";
import { LOCALES } from "../../localization/types";
import { ActionNote } from "../../ui/components/Notes";
import type { ProjectTabProps } from "./ProjectOverviewTab";

export function ProjectSettingsTab({ client, detail, onChanged }: ProjectTabProps) {
  const translator = useTranslator();
  const project = detail.project;
  const readOnly = project.status === "ARCHIVED";
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [language, setLanguage] = useState<Language>(project.language);
  const [workspace, setWorkspace] = useState(project.workspace_root ?? "");
  const [action, setAction] = useState<ActionState>({ phase: "IDLE" });

  const change: Record<string, unknown> = {};
  if (name.trim() !== project.name) change["name"] = name.trim();
  if (description.trim() !== project.description) change["description"] = description.trim();
  if (language !== project.language) change["language"] = language;
  if (workspace.trim() !== (project.workspace_root ?? "")) change["workspace_root"] = workspace.trim() === "" ? null : workspace.trim();
  const dirty = Object.keys(change).length > 0 && name.trim() !== "";

  async function save(): Promise<void> {
    setAction({ phase: "RUNNING" });
    const result = await client.updateProject({ project_id: project.project_id, expected_version: project.version, ...change });
    setAction(result.ok ? { phase: "DONE", messageKey: "project.action.saved" } : { phase: "FAILED", error: result.error });
    onChanged();
  }

  return (
    <section className="card">
      <div className="form">
        <label className="form__row" htmlFor="settings-name">
          {translator.t("projects.field.name")}
          <input id="settings-name" className="input" value={name} maxLength={120} disabled={readOnly} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="form__row" htmlFor="settings-description">
          {translator.t("projects.field.description")}
          <textarea
            id="settings-description"
            className="textarea"
            value={description}
            maxLength={2000}
            disabled={readOnly}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="form__row" htmlFor="settings-language">
          {translator.t("projects.field.language")}
          <select
            id="settings-language"
            className="select"
            value={language}
            disabled={readOnly}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {translator.t(`locale.name.${code}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="form__row" htmlFor="settings-workspace">
          {translator.t("projects.field.workspace")}
          <input
            id="settings-workspace"
            className="input input--mono"
            value={workspace}
            spellCheck={false}
            disabled={readOnly}
            aria-describedby="settings-workspace-hint"
            onChange={(event) => setWorkspace(event.target.value)}
          />
        </label>
        <p className="row__hint" id="settings-workspace-hint">
          {translator.t("projects.field.workspace.hint")}
        </p>
        <div className="toolbar">
          <button type="button" className="button button--primary" disabled={readOnly || !dirty || action.phase === "RUNNING"} onClick={() => void save()}>
            {translator.t("project.action.save")}
          </button>
        </div>
        <ActionNote state={action} />
      </div>
    </section>
  );
}
