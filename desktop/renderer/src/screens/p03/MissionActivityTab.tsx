// نشاط المهمّة: انتقالات الحالة والقرارات المهيكلة.
//
// ما لا يظهر هنا مقصود: لا سلسلة تفكير، ولا أثر استدلال نموذج. المخزَّن أصلًا هو
// النتيجة وسببها المُرمَّز (البند 86)، فلا شيء يمكن عرضه حتى لو أراد أحد ذلك.

import { useTranslator } from "../../app/context";
import type { MissionGetResultV1, TaskListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { taskStateTone } from "../../p03/present";
import { StatusPill } from "./StatusPill";

export function MissionActivityTab({
  detail,
  tasks,
}: {
  readonly detail: MissionGetResultV1;
  readonly tasks: TaskListResultV1;
}) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const mission = detail.mission;

  const entries: { readonly at: string; readonly labelKey: string }[] = [
    { at: mission.created_at, labelKey: "mission.overview.created" },
    ...(mission.started_at === undefined ? [] : [{ at: mission.started_at, labelKey: "mission.overview.started" }]),
    ...(mission.completed_at === undefined ? [] : [{ at: mission.completed_at, labelKey: "mission.overview.completed" }]),
  ];

  return (
    <section className="section" aria-labelledby="mission-activity">
      <h3 className="section__title" id="mission-activity">
        {translator.t("mission.tab.activity")}
      </h3>
      <p className="note">{translator.t("mission.activity.note")}</p>
      <ul className="list" aria-live="polite">
        {entries.map((entry) => (
          <li key={entry.labelKey}>
            {translator.t(entry.labelKey)} — {formatInstant(locale, entry.at)}
          </li>
        ))}
      </ul>
      {tasks.tasks.length === 0 ? null : (
        <ul className="list">
          {tasks.tasks.map((task) => (
            <li key={task.task_id}>
              {task.title} —{" "}
              <StatusPill namespace="task_state" member={task.state} tone={taskStateTone(task.state)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
