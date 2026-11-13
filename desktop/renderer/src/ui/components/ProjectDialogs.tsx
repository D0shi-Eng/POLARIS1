// حوارات المشروع كما في مانوس: إنشاء مشروع أو تعديله (الاسم ومساحة العمل المحلية)، وتعليمات المشروع،
// وملاحظة سياق، وتأكيد الحذف.
//
// التعليمات مصدر سياق من نوع USER_INSTRUCTION: يضعه مُجمِّع Phase-02 في كل نداء نموذج لمهامّ المشروع بين
// حدَّي «تعليمات المشروع من المستخدم»، والملاحظة TEXT_NOTE تدخل بيانات غير موثوقة. تغيير التعليمات يضيف
// المصدر الجديد أولًا ثم يزيل القديم، فلا يبقى المشروع بلا تعليماته إن فشلت الخطوة الثانية.

import { useState } from "react";

import { useTranslator } from "../../app/context";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { ProjectView } from "../../generated/types/desktop-p02-result-v1";
import { changeChannel, errorText, notifyThreadsChanged } from "../../p08/threads";
import { ClearableInput, Dialog } from "./Dialog";

const projectsChannel = changeChannel();

export function notifyProjectsChanged(): void {
  projectsChannel.notify();
}

export function useProjectsChanged(onChange: () => void): void {
  projectsChannel.use(onChange);
}

/** إنشاء مشروع (بلا `project`) أو تعديل اسمه ومجلّده. */
export function ProjectDialog({ phase02, project, onSaved, onClose }: { readonly phase02: Phase02Client; readonly project?: ProjectView | undefined; onSaved(projectId: string): void; onClose(): void }) {
  const translator = useTranslator();
  const [name, setName] = useState(project?.name ?? "");
  const [folder, setFolder] = useState(project?.workspace_root ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const trimmedFolder = folder.trim();
    const result =
      project === undefined
        ? await phase02.createProject({ name: name.trim(), ...(trimmedFolder === "" ? {} : { workspace_root: trimmedFolder }) })
        : await phase02.updateProject({
            project_id: project.project_id,
            expected_version: project.version,
            ...(name.trim() === project.name ? {} : { name: name.trim() }),
            ...(trimmedFolder === (project.workspace_root ?? "") ? {} : { workspace_root: trimmedFolder === "" ? null : trimmedFolder }),
          });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(translator, result.error));
      return;
    }
    notifyProjectsChanged();
    onSaved(result.value.project.project_id);
  }

  const unchanged = project !== undefined && name.trim() === project.name && folder.trim() === (project.workspace_root ?? "");
  return (
    <Dialog
      title={translator.t(project === undefined ? "ui.project.create_title" : "ui.project.edit")}
      icon="projects"
      confirmLabel={translator.t(project === undefined ? "ui.project.create" : "ui.project.save")}
      canConfirm={name.trim() !== "" && !unchanged}
      busy={busy}
      error={error}
      wide
      className="mdialog--project"
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <label className="mfield__label" htmlFor="project-dialog-name">
        {translator.t("ui.project.name")}
      </label>
      <ClearableInput id="project-dialog-name" value={name} maxLength={120} placeholder={translator.t("ui.project.name_placeholder")} onChange={setName} onEnter={() => name.trim() !== "" && void save()} />
      <label className="mfield__label" htmlFor="project-dialog-folder">
        {translator.t("ui.project.folder")} <span className="mfield__optional">{translator.t("ui.project.optional")}</span>
      </label>
      <ClearableInput id="project-dialog-folder" value={folder} maxLength={1000} placeholder={translator.t("ui.project.folder_placeholder")} onChange={setFolder} />
      <p className="mfield__note">{translator.t("ui.project.folder_note")}</p>
    </Dialog>
  );
}

/** تعليمات المشروع: نصّ واحد يدخل كل مهمة في المشروع. فارغ يزيلها. */
export function InstructionsDialog({ phase02, projectId, current, sourceId, onSaved, onClose }: { readonly phase02: Phase02Client; readonly projectId: string; readonly current: string; readonly sourceId: string | undefined; onSaved(): void; onClose(): void }) {
  const translator = useTranslator();
  const [text, setText] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const body = text.trim();
    if (body !== "") {
      const added = await phase02.addContext({ project_id: projectId, source_type: "USER_INSTRUCTION", text: body, display_name: translator.t("ui.project.instruction_name") });
      if (!added.ok) {
        setBusy(false);
        setError(errorText(translator, added.error));
        return;
      }
    }
    if (sourceId !== undefined) {
      const removed = await phase02.removeContext(projectId, sourceId);
      if (!removed.ok) {
        setBusy(false);
        setError(errorText(translator, removed.error));
        return;
      }
    }
    setBusy(false);
    notifyProjectsChanged();
    onSaved();
  }

  return (
    <Dialog
      title={translator.t("ui.project.instructions_title")}
      hint={translator.t("ui.project.instructions_hint")}
      confirmLabel={translator.t("ui.project.save")}
      canConfirm={text.trim() !== current.trim()}
      busy={busy}
      error={error}
      className="mdialog--instructions"
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <textarea className="mtextarea" value={text} maxLength={16000} rows={12} dir="auto" placeholder={translator.t("ui.project.instructions_placeholder")} aria-label={translator.t("ui.project.instructions_title")} onChange={(event) => setText(event.target.value)} />
    </Dialog>
  );
}

/** ملاحظة سياق: عنوان ونصّ يدخلان مهامّ المشروع بيانات مرجعية (لا تعليمات). */
export function NoteDialog({ phase02, projectId, onSaved, onClose }: { readonly phase02: Phase02Client; readonly projectId: string; onSaved(): void; onClose(): void }) {
  const translator = useTranslator();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    const result = await phase02.addContext({ project_id: projectId, source_type: "TEXT_NOTE", text: text.trim(), display_name: name.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(translator, result.error));
      return;
    }
    notifyProjectsChanged();
    onSaved();
  }

  return (
    <Dialog
      title={translator.t("ui.project.note_title")}
      confirmLabel={translator.t("ui.project.save")}
      canConfirm={name.trim() !== "" && text.trim() !== ""}
      busy={busy}
      error={error}
      className="mdialog--instructions"
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <label className="mfield__label" htmlFor="note-dialog-name">
        {translator.t("ui.project.note_name")}
      </label>
      <ClearableInput id="note-dialog-name" value={name} maxLength={120} onChange={setName} />
      <label className="mfield__label" htmlFor="note-dialog-text">
        {translator.t("ui.project.note_text")}
      </label>
      <textarea id="note-dialog-text" className="mtextarea" value={text} maxLength={16000} rows={8} dir="auto" onChange={(event) => setText(event.target.value)} />
    </Dialog>
  );
}

/** تأكيد حذف المشروع. المحادثات لا تُحذف: تخرج منه (يقوله النصّ ويضمنه المضيف). */
export function DeleteProjectDialog({ phase08, project, onDeleted, onClose }: { readonly phase08: Phase08Client; readonly project: { readonly project_id: string; readonly name: string }; onDeleted(): void; onClose(): void }) {
  const translator = useTranslator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={translator.t("ui.project.delete_title")}
      hint={translator.t("ui.project.delete_body", { name: project.name })}
      confirmLabel={translator.t("ui.thread.delete")}
      danger
      busy={busy}
      error={error}
      className="mdialog--small"
      onConfirm={() => {
        setBusy(true);
        void phase08.deleteProject(project.project_id).then((result) => {
          setBusy(false);
          if (!result.ok) {
            setError(errorText(translator, result.error));
            return;
          }
          notifyProjectsChanged();
          notifyThreadsChanged();
          onDeleted();
        });
      }}
      onClose={onClose}
    />
  );
}
