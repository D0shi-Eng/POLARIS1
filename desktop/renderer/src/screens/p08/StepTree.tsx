// شجرة خطوات المهمّة (خطة 2026-10-05، F1): الخطة الحيّة كما في «الخطوة 5/5» عند مانوس. كل خطوة من رسم المهمّة بحالتها
// المقيسة، وتحتها نداءات الأدوات التي نُسبت إليها عند البوابة (A2)، وخطوة المراجعة ظاهرة باسمها «تحقّق».
//
// لا شيء هنا من سرد النموذج: الحالة من رسم المهمّة، والأدوات من سجلّ البوابة. نداءات النموذج لكل خطوة تُسجَّل أحداثًا
// في المضيف (A2) ولا تُعرض هنا بعد: لا عملية تقرأ الأحداث بمهمّتها.

import { useTranslator } from "../../app/context";
import { useHostQuery } from "../../app/useHostQuery";
import type { TaskListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import type { ToolActivityListResultV1 } from "../../generated/types/desktop-p04-result-v1";
import type { Phase03Client } from "../../ipc/p03-client";
import type { Phase04Client } from "../../ipc/p04-client";
import { activityKey, formatDuration } from "../../p08/present";
import { Icon, type IconName } from "../../ui/components/Icon";

type Task = TaskListResultV1["tasks"][number];

const DONE = new Set(["SUCCEEDED"]);
const BAD = new Set(["FAILED", "BLOCKED", "CANCELLED", "INTERRUPTED"]);
const ACTIVE = new Set(["RUNNING", "ASSIGNED", "WAITING", "REVIEW"]);
/** حالة نهائية ليست نجاحًا (ADR-041؛ R-11، 2026-10-12): قال الوكيل «تمّت» ولا قياس يخصّها. تنتهي بها الخطوة فلا تُعدّ «الحالية»
 * في العدّاد، ولا تُرسم علامة نجاح. */
const UNVERIFIED = new Set(["UNVERIFIED_DONE"]);

/** هل انتهت الخطوة (بنجاح أو بغيره)؟ */
export function isFinished(state: string): boolean {
  return DONE.has(state) || BAD.has(state) || UNVERIFIED.has(state);
}

function stateIcon(state: string): IconName {
  if (DONE.has(state)) return "check";
  if (BAD.has(state)) return "close";
  if (UNVERIFIED.has(state)) return "shield";
  if (ACTIVE.has(state)) return "activity";
  return "schedule";
}

/** خطوات المهمّة مرتّبة كما يعيدها المضيف. في حلقة الوكيل (ADR-039) الجذر هو الطلب نفسه، وخطّته خطواتٌ تحته: حين توجد خطة
 * تُعرض خطواتها وحدها، وإلا فالجذر وحده خطوة واحدة. */
export function useMissionSteps(phase03: Phase03Client, missionId: string, refreshKey: string): readonly Task[] {
  const tasks = useHostQuery(() => phase03.listTasks(missionId), [phase03, missionId, refreshKey]);
  return planSteps(tasks.value?.tasks ?? []);
}

/** خطوات الخطة تحت الجذر إن وُجدت، وإلا كل الخطوات كما هي (مسار الرسم القديم). */
export function planSteps(tasks: readonly Task[]): readonly Task[] {
  const root = tasks.find((t) => t.parent_task_id === undefined);
  const plan = root === undefined ? [] : tasks.filter((t) => t.parent_task_id === root.task_id);
  return plan.length > 0 ? plan : tasks;
}

/** «الخطوة الحالية/الكل»: الحالية أوّل خطوة لم تنتهِ، وإلا الأخيرة. */
export function stepCounter(steps: readonly Task[]): { readonly current: number; readonly total: number } | null {
  if (steps.length === 0) return null;
  const open = steps.findIndex((s) => !isFinished(s.state));
  return { current: open < 0 ? steps.length : open + 1, total: steps.length };
}

export function StepTree({ steps, phase04, missionId, refreshKey, onClose }: { readonly steps: readonly Task[]; readonly phase04: Phase04Client | undefined; readonly missionId: string; readonly refreshKey: string; onClose(): void }) {
  const translator = useTranslator();
  const activity = useHostQuery<ToolActivityListResultV1 | null>(
    () => (phase04 === undefined ? Promise.resolve({ ok: true as const, value: null }) : phase04.listActivity({ mission_id: missionId, limit: 500 })),
    [phase04, missionId, refreshKey],
  );
  const calls = activity.value?.invocations ?? [];
  return (
    <section className="steptree" aria-labelledby="steptree-title">
      <header className="steptree__head">
        <h2 className="steptree__title" id="steptree-title">
          {translator.t("p08.steps.title")}
        </h2>
        <button type="button" className="icon-button" aria-label={translator.t("ui.close")} title={translator.t("ui.close")} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>
      <ol className="steptree__list">
        {steps.map((step, index) => {
          const own = calls.filter((c) => c.task_id === step.task_id);
          const verify = step.task_type === "REVIEW" || step.task_type === "SECURITY_REVIEW";
          return (
            <li key={step.task_id} className={`steptree__step is-${step.state.toLowerCase()}`}>
              <div className="steptree__row">
                <span className="steptree__icon" aria-hidden="true">
                  <Icon name={stateIcon(step.state)} size={13} />
                </span>
                <span className="steptree__index">{index + 1}</span>
                <span className="steptree__name" dir="auto">
                  {step.title}
                </span>
                {verify ? <span className="oc-tag">{translator.t("p08.steps.verify")}</span> : null}
                {step.attempt > 0 ? <span className="oc-tag">{translator.t("p08.steps.attempt", { n: step.attempt + 1 })}</span> : null}
                <span className="steptree__state">{translator.t(`p03.task_state.${step.state}`)}</span>
              </div>
              {own.length === 0 ? null : (
                <ul className="steptree__calls">
                  {own.map((call) => (
                    <li key={call.invocation_id} className={`steptree__call is-${call.status.toLowerCase()}`}>
                      <span className="steptree__verb">{translator.t(activityKey(call.tool_id), { tool: call.tool_id })}</span>
                      <span className="steptree__status">{translator.t(`p04.invocation.${call.status}`)}</span>
                      {call.duration_ms === undefined ? null : <span className="steptree__time">{formatDuration(call.duration_ms)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
