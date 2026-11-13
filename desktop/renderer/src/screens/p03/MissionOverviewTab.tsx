// نظرة عامة على المهمّة: الحالة، والإثبات، والمتطلَّبات، والميزانية.
//
// الإثبات ليس شارة صغيرة بجانب الحالة: له قسمه، وخلاصته، وقائمة ما يمنعه. مهمّة
// «اكتملت» و«غير مُثبَتة» تعرض هنا سبب كل حاجز بالاسم، لأن إخفاءه يجعل الانتهاء
// يُقرأ نجاحًا.

import { useTranslator } from "../../app/context";
import type { MissionGetResultV1 } from "../../generated/types/desktop-p03-result-v1";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { missionStateTone, proofTone } from "../../p03/present";
import { StatusPill } from "./StatusPill";

export function MissionOverviewTab({ detail }: { readonly detail: MissionGetResultV1 }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;
  const mission = detail.mission;
  const proof = detail.completion_proof;

  return (
    <>
      <section className="section card" aria-labelledby="mission-overview">
        <h3 className="section__title" id="mission-overview">
          {translator.t("mission.tab.overview")}
        </h3>
        <dl className="facts">
          <dt>{translator.t("mission.overview.objective")}</dt>
          <dd>{mission.objective}</dd>

          <dt>{translator.t("mission.overview.state")}</dt>
          <dd>
            <StatusPill namespace="mission_state" member={mission.state} tone={missionStateTone(mission.state)} />
          </dd>

          <dt>{translator.t("mission.overview.title_authority")}</dt>
          <dd>{translator.t(`p03.authority.${mission.title_authority ?? "DIRECT_USER_INSTRUCTION"}`)}</dd>

          <dt>{translator.t("missions.field.mode")}</dt>
          <dd>{translator.t(`p03.mode.${mission.execution_mode}`)}</dd>

          <dt>{translator.t("missions.field.priority")}</dt>
          <dd>{translator.t(`p03.priority.${mission.priority}`)}</dd>

          <dt>{translator.t("mission.overview.revision")}</dt>
          <dd>{mission.current_revision}</dd>

          <dt>{translator.t("mission.overview.created")}</dt>
          <dd>{formatInstant(locale, mission.created_at)}</dd>

          {mission.started_at === undefined ? null : (
            <>
              <dt>{translator.t("mission.overview.started")}</dt>
              <dd>{formatInstant(locale, mission.started_at)}</dd>
            </>
          )}
          {mission.completed_at === undefined ? null : (
            <>
              <dt>{translator.t("mission.overview.completed")}</dt>
              <dd>{formatInstant(locale, mission.completed_at)}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="section card" aria-labelledby="mission-proof">
        <h3 className="section__title" id="mission-proof">
          {translator.t("mission.overview.proof")}
        </h3>
        <p>
          <StatusPill
            namespace="proof"
            member={proof.status}
            tone={proofTone(proof.status)}
            hint={`p03.proof.hint.${proof.status}`}
          />
        </p>
        <p className="note">{translator.t(`p03.proof.hint.${proof.status}`)}</p>
        <dl className="facts">
          <dt>{translator.t("mission.proof.summary")}</dt>
          <dd>{proof.proof_summary}</dd>
        </dl>
        <h4 className="section__subtitle">{translator.t("mission.proof.blockers")}</h4>
        {proof.remaining_blockers.length === 0 ? (
          <p className="note">{translator.t("mission.proof.none")}</p>
        ) : (
          <ul className="list">
            {proof.remaining_blockers.map((blocker, index) => (
              <li key={`${blocker.kind}-${index}`}>
                {translator.t(`p03.blocker.${blocker.kind}`, { detail: blocker.detail ?? "" })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section card" aria-labelledby="mission-requirements">
        <h3 className="section__title" id="mission-requirements">
          {translator.t("mission.overview.requirements")}
        </h3>
        {mission.requirements.length === 0 ? (
          <p className="note">{translator.t("p03.blocker.NO_MANDATORY_REQUIREMENT")}</p>
        ) : (
          <table className="table">
            <caption className="sr-only">{translator.t("mission.overview.requirements")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("mission.claims.column.statement")}</th>
                <th scope="col">{translator.t("mission.claims.column.status")}</th>
                <th scope="col">{translator.t("mission.requirement.rule")}</th>
              </tr>
            </thead>
            <tbody>
              {mission.requirements.map((requirement) => (
                <tr key={requirement.requirement_id}>
                  <th scope="row">
                    {requirement.text}
                    <span className="muted">
                      {" "}
                      —{" "}
                      {translator.t(
                        requirement.mandatory ? "mission.requirement.mandatory" : "mission.requirement.optional",
                      )}
                    </span>
                  </th>
                  <td>{translator.t(`p03.requirement_status.${requirement.status}`)}</td>
                  <td className="mono">{requirement.verification_rule_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section card" aria-labelledby="mission-budget">
        <h3 className="section__title" id="mission-budget">
          {translator.t("mission.overview.budget")}
        </h3>
        <dl className="facts">
          <dt>{translator.t("p03.budget.calls")}</dt>
          <dd>{translator.t("p03.budget.limit", { value: mission.budget.max_model_calls })}</dd>
          <dt>{translator.t("p03.budget.tokens")}</dt>
          <dd>{translator.t("p03.budget.limit", { value: mission.budget.max_total_tokens })}</dd>
          <dt>{translator.t("p03.budget.tasks")}</dt>
          <dd>{translator.t("p03.budget.limit", { value: mission.budget.max_tasks })}</dd>
          <dt>{translator.t("p03.budget.active")}</dt>
          <dd>{translator.t("p03.budget.limit", { value: mission.budget.max_active_agents })}</dd>
          <dt>{translator.t("p03.budget.depth")}</dt>
          <dd>{translator.t("p03.budget.limit", { value: mission.budget.max_delegation_depth })}</dd>
          <dt>{translator.t("p03.budget.reviews")}</dt>
          <dd>{translator.t("p03.budget.limit", { value: mission.budget.max_review_rounds })}</dd>
        </dl>
      </section>
    </>
  );
}
