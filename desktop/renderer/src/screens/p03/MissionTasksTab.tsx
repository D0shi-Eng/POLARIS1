// عُقد المهمّة: رسم المهام كقائمة هرمية مقروءة، لا رسمًا بصريًّا متحرّكًا.
//
// التبعيات تُعرض بالاسم، والجاهزية تأتي من المضيف لا من ترتيب الصفوف. «جاهزة
// للتنفيذ التالي» وسمٌ على ما تقوله المجموعة الجاهزة الحتمية، لا تخمينًا هنا.

import { useTranslator } from "../../app/context";
import { formatList } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import type { TaskListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import { taskStateTone } from "../../p03/present";
import { StateBlock } from "../../ui/components/StateBlock";
import { StatusPill } from "./StatusPill";

export function MissionTasksTab({ tasks }: { readonly tasks: TaskListResultV1 }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const ready = new Set(tasks.ready);
  const titleOf = (id: string): string => tasks.tasks.find((task) => task.task_id === id)?.title ?? id;

  if (tasks.tasks.length === 0) {
    return <StateBlock kind="empty" bodyKey="mission.tasks.empty" />;
  }

  return (
    <section className="section" aria-labelledby="mission-tasks">
      <h3 className="section__title" id="mission-tasks">
        {translator.t("mission.tab.tasks")}
      </h3>
      <table className="table">
        <caption className="sr-only">{translator.t("mission.tab.tasks")}</caption>
        <thead>
          <tr>
            <th scope="col">{translator.t("mission.tasks.column.title")}</th>
            <th scope="col">{translator.t("mission.tasks.column.type")}</th>
            <th scope="col">{translator.t("mission.tasks.column.state")}</th>
            <th scope="col">{translator.t("mission.tasks.column.depends")}</th>
            <th scope="col">{translator.t("mission.tasks.column.attempt")}</th>
          </tr>
        </thead>
        <tbody>
          {tasks.tasks.map((task) => (
            <tr key={task.task_id}>
              <th scope="row">
                {task.title}
                {ready.has(task.task_id) ? <span className="muted"> — {translator.t("mission.tasks.ready")}</span> : null}
              </th>
              <td>{translator.t(`p03.task_type.${task.task_type}`)}</td>
              <td>
                <StatusPill namespace="task_state" member={task.state} tone={taskStateTone(task.state)} />
              </td>
              <td>
                {task.dependencies.length === 0
                  ? translator.t("mission.tasks.depends.none")
                  : formatList(locale, task.dependencies.map((dependency) => titleOf(dependency.depends_on)))}
              </td>
              <td>{translator.t("mission.tasks.attempt", { attempt: task.attempt + 1, max: task.max_attempts })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
