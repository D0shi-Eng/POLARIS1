// المهام: قائمة حقيقية من مخزن المضيف، وإنشاء مهمّة جديدة.
//
// كل عمود هنا حقيقة يعيدها المضيف. لا شريط تقدّم ولا نسبة مئوية: التقدّم يُعرض
// عدًّا صريحًا («نجحت س من ص»)، لأن ذلك ما يمكن اشتقاقه من حالات العُقد. وحالة
// المهمّة لا تُعرض وحدها أبدًا: الإثبات بجوارها في كل صفّ.

import { useState } from "react";

import { useNavigation, useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import type { BudgetPreset, ExecutionMode, MissionPriority } from "../../generated/types/desktop-p03-request-v1";
import type { Phase03Client } from "../../ipc/p03-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { missionStateTone, proofTone } from "../../p03/present";
import { missionPath } from "../../routes/registry";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { StateAndProof } from "./StatusPill";

const MODES: readonly ExecutionMode[] = ["SINGLE_AGENT", "COORDINATED_MULTI_AGENT"];
const PRIORITIES: readonly MissionPriority[] = ["LOW", "NORMAL", "HIGH"];
const PRESETS: readonly BudgetPreset[] = ["CONSERVATIVE", "BALANCED", "EXTENDED"];

export function MissionsScreen({ client }: { readonly client: Phase03Client }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const action = useAction();

  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [mode, setMode] = useState<ExecutionMode>("SINGLE_AGENT");
  const [priority, setPriority] = useState<MissionPriority>("NORMAL");
  const [preset, setPreset] = useState<BudgetPreset>("CONSERVATIVE");

  const query = useHostQuery(() => client.listMissions(), [client, action.state]);
  const missions = query.value?.missions ?? [];

  async function create(): Promise<void> {
    await action.run(
      () =>
        client.createMission({
          title: title.trim(),
          objective: objective.trim(),
          execution_mode: mode,
          priority,
          budget_preset: preset,
        }),
      (value) => {
        navigation.navigate(missionPath(value.mission_id));
        return { phase: "DONE", messageKey: "missions.created" };
      },
      () => {
        setTitle("");
        setObjective("");
      },
    );
  }

  const canCreate = title.trim().length > 0 && objective.trim().length > 0;
  const [createOpen, setCreateOpen] = useState<boolean | null>(null);

  return (
    <>
      <h1 className="page-title">{translator.t("nav.missions")}</h1>
      <p className="page-subtitle">{translator.t("missions.subtitle")}</p>

      <section className="section" aria-labelledby="missions-list">
        <h2 className="section__title" id="missions-list">
          {translator.t("nav.missions")}
        </h2>
        {query.loading ? <StateBlock kind="loading" /> : null}
        {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
        {!query.loading && query.error === null && missions.length === 0 ? (
          <StateBlock kind="empty" bodyKey="missions.empty" />
        ) : null}
        {missions.length === 0 ? null : (
          <table className="table">
            <caption className="sr-only">{translator.t("nav.missions")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("missions.column.title")}</th>
                <th scope="col">{translator.t("missions.column.state")}</th>
                <th scope="col">{translator.t("missions.column.tasks")}</th>
                <th scope="col">{translator.t("missions.column.activity")}</th>
              </tr>
            </thead>
            <tbody>
              {missions.map((mission) => (
                <tr key={mission.mission_id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="link"
                      onClick={() => navigation.navigate(missionPath(mission.mission_id))}
                      aria-label={`${translator.t("missions.open")}: ${mission.title}`}
                    >
                      {mission.title}
                    </button>
                  </th>
                  <td>
                    <StateAndProof
                      state={mission.state}
                      proof={mission.completion_proof_status}
                      stateTone={missionStateTone(mission.state)}
                      proofToneValue={proofTone(mission.completion_proof_status)}
                    />
                  </td>
                  <td>
                    {translator.t("missions.tasks.count", {
                      succeeded: mission.tasks_succeeded,
                      total: mission.task_count,
                    })}
                  </td>
                  <td>{formatInstant(locale, mission.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* إنشاء مهمّة من هنا يبقى (الشكل الكامل بحقوله)، لكنه مطويّ حين توجد مهامّ: المُنشئ في الرئيسية هو الطريق المعتاد */}
      <details
        className="section card missions-create"
        open={createOpen ?? (!query.loading && missions.length === 0)}
        onToggle={(event) => setCreateOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="missions-create__summary">
          <h2 className="section__title" id="missions-create">
            {translator.t("missions.create.title")}
          </h2>
        </summary>
        <div className="form">
          <label className="form__row" htmlFor="mission-title">
            {translator.t("missions.field.title")}
            <input
              id="mission-title"
              className="input"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="form__row" htmlFor="mission-objective">
            {translator.t("missions.field.objective")}
            <textarea
              id="mission-objective"
              className="input"
              rows={3}
              value={objective}
              maxLength={8000}
              onChange={(event) => setObjective(event.target.value)}
            />
          </label>
          <label className="form__row" htmlFor="mission-mode">
            {translator.t("missions.field.mode")}
            <select
              id="mission-mode"
              className="input"
              value={mode}
              onChange={(event) => setMode(event.target.value as ExecutionMode)}
            >
              {MODES.map((value) => (
                <option key={value} value={value}>
                  {translator.t(`p03.mode.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="form__row" htmlFor="mission-priority">
            {translator.t("missions.field.priority")}
            <select
              id="mission-priority"
              className="input"
              value={priority}
              onChange={(event) => setPriority(event.target.value as MissionPriority)}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {translator.t(`p03.priority.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="form__row" htmlFor="mission-budget">
            {translator.t("missions.field.budget")}
            <select
              id="mission-budget"
              className="input"
              value={preset}
              onChange={(event) => setPreset(event.target.value as BudgetPreset)}
            >
              {PRESETS.map((value) => (
                <option key={value} value={value}>
                  {translator.t(`p03.preset.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button" disabled={!canCreate} onClick={() => void create()}>
            {translator.t("missions.create.submit")}
          </button>
          <ActionNote state={action.state} />
        </div>
      </details>
    </>
  );
}
