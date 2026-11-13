// صفحة المشروع كما في مانوس 2.0 (قِيس 2026-10-06 في Manus Studio): شريط علوي بمحدّد النموذج وقائمة «⋯»؛ عمود رئيسي فيه
// رأس بأيقونة المجلد والاسم وسطر «أنشأته · حُدّث في …»، ثم «الأخيرة» صفوفًا (العنوان بأيقونته، والتاريخ في الطرف الآخر)،
// والمُنشئ ملتصق بأسفل الصفحة؛ وعمود جانبي ببطاقات: التعليمات (ومعها الموصلات)، والملفات والمصادر، والمهارات، والمهام
// التشغيلية.
//
// ما يظهر هنا يعمل فعلًا في المضيف: التعليمات مصدر USER_INSTRUCTION يدخل كل نداء نموذج لمهامّ المشروع، والملاحظات
// والملفات مصادر سياق تدخله بيانات غير موثوقة، والمهام التشغيلية مجدولة تُنشأ في المشروع. الموصلات والمهارات في POLARIS
// عامّة لا تخصّ مشروعًا، فبطاقتاهما تفتحان صفحتيهما ولا تدّعيان ربطًا بالمشروع. بطاقة «موقع إلكتروني» لا تُعرض: لا نشر
// مواقع في POLARIS. الإعدادات التفصيلية (النموذج، وسياسة السياق، وإدارة الملفات بالمسار) في «إعدادات متقدمة».

import { useCallback, useEffect, useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { Phase02Client } from "../../ipc/p02-client";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase08Client } from "../../ipc/p08-client";
import type { LocaleCode } from "../../localization/types";
import { useThreadStates, useThreadsChanged } from "../../p08/threads";
import { missionPath } from "../../routes/registry";
import { Icon } from "../../ui/components/Icon";
import { ErrorNote } from "../../ui/components/Notes";
import { MenuItem, MenuSeparator, Popover } from "../../ui/components/Popover";
import { DeleteProjectDialog, InstructionsDialog, NoteDialog, ProjectDialog, useProjectsChanged } from "../../ui/components/ProjectDialogs";
import { threadEntries } from "../../ui/components/RailMissions";
import { StateBlock } from "../../ui/components/StateBlock";
import { ThreadMenu } from "../../ui/components/ThreadMenu";
import { ProjectContextTab } from "../p02/ProjectContextTab";
import { ProjectModelTab } from "../p02/ProjectModelTab";
import { ProjectSettingsTab } from "../p02/ProjectSettingsTab";
import { ModelPicker, readStoredModel, storeModel } from "../../ui/components/ModelPicker";
import { Composer } from "./Composer";
import { newScheduleIn } from "./SchedulesScreen";

/** تاريخ صفّ المهمة كما في مانوس: يوم الأسبوع والساعة لما في الأسبوع الأخير، وإلا اليوم والشهر. */
export function listDate(locale: LocaleCode, iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  const withinWeek = 0 <= days && days < 6;
  if (withinWeek) return new Intl.DateTimeFormat(locale, { weekday: "long", hour: "numeric", minute: "2-digit" }).format(d);
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export interface ProjectWorkspaceProps {
  readonly projectId: string;
  readonly phase02: Phase02Client;
  readonly phase03: Phase03Client;
  readonly phase08: Phase08Client;
}

type Dialogs = "edit" | "instructions" | "note" | "delete" | null;

export function ProjectWorkspace({ projectId, phase02, phase03, phase08 }: ProjectWorkspaceProps) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useProjectsChanged(bump);
  useThreadsChanged(bump);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [modelId, setModelId] = useState<string>(() => readStoredModel());

  const project = useHostQuery(() => phase02.getProject(projectId), [phase02, projectId, tick]);
  const missions = useHostQuery(() => phase03.listMissions(), [phase03, tick]);
  const index = useHostQuery(() => phase08.conversationIndex(), [phase08, tick]);
  const schedules = useHostQuery(() => phase08.listSchedules(), [phase08, tick]);
  const allProjects = useHostQuery(() => phase02.listProjects(), [phase02, tick]);
  const states = useThreadStates(phase08);

  const detail = project.value;
  const instruction = detail?.sources.find((s) => s.source_type === "USER_INSTRUCTION");
  const [instructionText, setInstructionText] = useState("");
  useEffect(() => {
    if (instruction === undefined) {
      setInstructionText("");
      return;
    }
    let alive = true;
    void phase02.previewContext(projectId, instruction.source_id).then((result) => {
      if (alive && result.ok) setInstructionText(result.value.preview ?? "");
    });
    return () => {
      alive = false;
    };
  }, [phase02, projectId, instruction?.source_id, instruction]);

  if (project.error !== null && detail === null) return <ErrorNote error={project.error} onRetry={project.reload} />;
  if (detail === null) return <StateBlock kind="loading" />;
  const p = detail.project;
  const entries = threadEntries(missions.value?.missions ?? [], index.value?.follow_ups ?? [], states).filter((e) => e.thread.project_id === projectId && !e.thread.archived);
  const notes = detail.sources.filter((s) => s.source_type === "TEXT_NOTE" || s.source_type === "FILE" || s.source_type === "FOLDER");
  const projectSchedules = (schedules.value?.schedules ?? []).filter((s) => s.mission_template.project_id === projectId);

  return (
    <div className="project-page project-page--m">
      <div className="topbar project-page__bar">
        <ModelPicker
          phase02={phase02}
          value={modelId}
          onChange={(id) => {
            setModelId(id);
            storeModel(id);
          }}
        />
        <span className="topbar__spacer" />
        <Popover label={translator.t("ui.project.menu")} trigger={<Icon name="more" size={18} />} align="end" floating>
          <MenuItem icon={<Icon name="edit" size={16} />} label={translator.t("ui.project.edit")} onSelect={() => setDialog("edit")} />
          <MenuItem icon={<Icon name="report" size={16} />} label={translator.t("ui.project.edit_instructions")} onSelect={() => setDialog("instructions")} />
          <MenuSeparator />
          <MenuItem icon={<Icon name="trash" size={16} />} label={translator.t("ui.project.delete")} danger onSelect={() => setDialog("delete")} />
        </Popover>
      </div>
      <div className="project-page__cols">
        <div className="project-page__main">
          <header className="project-page__head">
            <span className="project-page__icon" aria-hidden="true">
              <Icon name="folder" size={22} />
            </span>
            <div className="project-page__heading">
              <h1 className="project-page__title" dir="auto">
                {p.name}
              </h1>
              <p className="project-page__meta">
                {translator.t("ui.project.created_by_you")}
                <span aria-hidden="true">{" · "}</span>
                {translator.t("ui.project.updated", { date: listDate(locale, p.updated_at) })}
              </p>
            </div>
          </header>

          {p.status === "ARCHIVED" ? <p className="note">{translator.t("project.archived.note")}</p> : null}

          <section className="project-tasks" aria-labelledby="project-tasks-title">
            <h2 className="project-tasks__title" id="project-tasks-title">
              {translator.t("ui.project.recent")}
            </h2>
            {entries.length === 0 ? (
              <p className="project-tasks__empty">{translator.t("ui.project.tasks_empty")}</p>
            ) : (
              <ul className="project-tasks__list">
                {entries.map(({ row, last, thread }) => (
                  <li key={row.mission_id} className="project-task">
                    <button type="button" className="project-task__open" onClick={() => navigation.navigate(missionPath(row.mission_id))}>
                      <Icon name={last.state === "FAILED" || last.state === "BLOCKED" ? "shield" : "report"} size={16} className="project-task__icon" />
                      <span className="project-task__name" dir="auto">
                        {thread.title}
                      </span>
                      <span className="project-task__date">{listDate(locale, last.created_at)}</span>
                    </button>
                    <ThreadMenu thread={thread} phase08={phase08} phase02={phase02} projects={allProjects.value?.projects ?? []} triggerClassName="icon-button project-task__more" onDeleted={bump} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="project-advanced">
            <summary>{translator.t("ui.project.advanced")}</summary>
            <ProjectModelTab client={phase02} detail={detail} onChanged={project.reload} />
            <ProjectSettingsTab client={phase02} detail={detail} onChanged={project.reload} />
            <ProjectContextTab client={phase02} detail={detail} onChanged={project.reload} />
          </details>

          <div className="project-page__composer">
            <Composer phase02={phase02} phase03={phase03} phase08={phase08} fixedProject={{ id: projectId, name: p.name }} modelId={modelId} />
          </div>
        </div>

        <aside className="project-cards" aria-label={translator.t("ui.project.menu")}>
          <section className="project-card">
            <button type="button" className="project-card__head" onClick={() => setDialog("instructions")}>
              <h2>{translator.t("ui.project.card.instructions")}</h2>
              <Icon name="chevron" size={14} className="project-card__chevron" />
            </button>
            {instructionText === "" ? (
              <p className="project-card__hint">{translator.t("ui.project.card.instructions_hint")}</p>
            ) : (
              <p className="project-card__quote" dir="auto">
                {instructionText}
              </p>
            )}
            <button type="button" className="project-card__add" onClick={() => setDialog("instructions")}>
              <Icon name={instructionText === "" ? "plus" : "edit"} size={14} />
              {translator.t(instructionText === "" ? "ui.project.card.add" : "ui.project.card.edit")}
            </button>
            <div className="project-card__sub">
              <span className="project-card__sub-name">
                <Icon name="connectors" size={15} />
                {translator.t("ui.project.card.connectors")}
              </span>
              <button type="button" className="project-card__add project-card__add--bare" title={translator.t("ui.project.card.connectors_hint")} onClick={() => navigation.navigate("/connectors")}>
                <Icon name="plus" size={14} />
                {translator.t("ui.project.card.add")}
              </button>
            </div>
          </section>

          <section className="project-card">
            <div className="project-card__head is-static">
              <h2>{translator.t("ui.project.card.files")}</h2>
              <Icon name="chevron" size={14} className="project-card__chevron" />
            </div>
            {notes.length === 0 ? (
              <p className="project-card__hint">{translator.t("ui.project.card.files_hint")}</p>
            ) : (
              <ul className="project-card__list">
                {notes.slice(0, 6).map((s) => (
                  <li key={s.source_id} dir="auto">
                    <Icon name={s.source_type === "TEXT_NOTE" ? "report" : s.source_type === "FOLDER" ? "projects" : "file"} size={14} />
                    <span>{s.display_name}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="project-card__actions">
              <button
                type="button"
                className="project-card__add"
                onClick={() => {
                  const fold = globalThis.document?.querySelector<HTMLDetailsElement>(".project-advanced");
                  if (fold !== null && fold !== undefined) {
                    fold.open = true;
                    fold.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
              >
                <Icon name="upload" size={14} />
                {translator.t("ui.project.card.upload")}
              </button>
              <button type="button" className="project-card__add" onClick={() => setDialog("note")}>
                <Icon name="report" size={14} />
                {translator.t("ui.project.card.note")}
              </button>
            </div>
          </section>

          <section className="project-card project-card--art">
            <button type="button" className="project-card__head" onClick={() => navigation.navigate("/skills")}>
              <h2>{translator.t("ui.project.card.skills")}</h2>
              <Icon name="chevron" size={14} className="project-card__chevron" />
            </button>
            <p className="project-card__hint">{translator.t("ui.project.card.skills_hint")}</p>
            <span className="project-card__art" aria-hidden="true">
              <Icon name="puzzle" size={26} />
            </span>
            <button type="button" className="project-card__add" onClick={() => navigation.navigate("/skills")}>
              <Icon name="plus" size={14} />
              {translator.t("ui.project.card.add")}
            </button>
          </section>

          <section className="project-card project-card--art">
            <button type="button" className="project-card__head" onClick={() => navigation.navigate("/schedules")}>
              <h2>{translator.t("ui.project.card.schedules")}</h2>
              <Icon name="chevron" size={14} className="project-card__chevron" />
            </button>
            <p className="project-card__hint">{projectSchedules.length === 0 ? translator.t("ui.project.card.schedules_hint") : translator.t("ui.project.card.schedules_count", { count: projectSchedules.length })}</p>
            <span className="project-card__art" aria-hidden="true">
              <Icon name="automation" size={26} />
            </span>
            <button
              type="button"
              className="project-card__add"
              onClick={() => {
                newScheduleIn(projectId);
                navigation.navigate("/schedules");
              }}
            >
              <Icon name="plus" size={14} />
              {translator.t("ui.project.card.add")}
            </button>
          </section>
        </aside>
      </div>

      {dialog === "edit" ? <ProjectDialog phase02={phase02} project={p} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} /> : null}
      {dialog === "instructions" ? (
        <InstructionsDialog phase02={phase02} projectId={projectId} current={instructionText} sourceId={instruction?.source_id} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />
      ) : null}
      {dialog === "note" ? <NoteDialog phase02={phase02} projectId={projectId} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} /> : null}
      {dialog === "delete" ? <DeleteProjectDialog phase08={phase08} project={p} onClose={() => setDialog(null)} onDeleted={() => navigation.navigate("/")} /> : null}
    </div>
  );
}
