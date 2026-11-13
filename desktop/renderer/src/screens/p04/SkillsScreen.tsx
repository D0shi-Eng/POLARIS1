// المهارات: ما يجوز اقتراحه، ومن يسمح به، وما لا تستطيع المهارة فعله.
//
// ما لا يوجد هنا مقصود: لا زرّ يضيف أداةً إلى مهارة، ولا حقل يوسّع أثرًا، ولا
// مفتاح يُسقط موافقة. التفعيل وحده قابل للتغيير، لأن ذلك وحده ما لا يمنح سلطة.

import { useTranslator } from "../../app/context";
import { useAction, useHostQuery } from "../../app/useHostQuery";
import { useNavigation } from "../../app/context";
import type { Phase04Client } from "../../ipc/p04-client";
import { formatInstant } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { riskTone } from "../../p04/present";
import { ActionNote, ErrorNote } from "../../ui/components/Notes";
import { StateBlock } from "../../ui/components/StateBlock";
import { P04Pill } from "./P04Pill";

/** `embedded`: داخل صفحة المهارات الجديدة («العرض التقني»)، بلا عنوان صفحة ثانٍ. */
export function SkillsScreen({ client, embedded = false }: { readonly client: Phase04Client; readonly embedded?: boolean }) {
  const translator = useTranslator();
  const navigation = useNavigation();
  const locale = translator.locale as LocaleCode;
  const query = useHostQuery(() => client.listSkills(), [client]);
  const action = useAction();
  const skills = query.value?.skills ?? [];

  return (
    <>
      {embedded ? null : <h1 className="page-title">{translator.t("nav.skills")}</h1>}
      {embedded ? null : <p className="page-subtitle">{translator.t("skills.subtitle")}</p>}
      <p className="note">{translator.t("skills.note.no_authority")}</p>

      {query.loading ? <StateBlock kind="loading" /> : null}
      {query.error !== null ? <ErrorNote error={query.error} onRetry={query.reload} /> : null}
      <ActionNote state={action.state} />

      <section className="section" aria-labelledby="skills-list">
        <h2 className="section__title" id="skills-list">
          {translator.t("nav.skills")}
        </h2>
        {skills.length === 0 && !query.loading ? (
          <StateBlock kind="empty" bodyKey="skills.empty" />
        ) : (
          <table className="table table--cards skills-cards">
            <caption className="sr-only">{translator.t("nav.skills")}</caption>
            <thead>
              <tr>
                <th scope="col">{translator.t("skills.column.name")}</th>
                <th scope="col">{translator.t("skills.column.source")}</th>
                <th scope="col">{translator.t("skills.column.risk")}</th>
                <th scope="col">{translator.t("skills.column.tools")}</th>
                <th scope="col">{translator.t("skill.field.updated")}</th>
                <th scope="col">{translator.t("skills.column.state")}</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.skill_id}>
                  <th scope="row" id={`skill-${skill.skill_id}-title`}>
                    {skill.name}
                    <span className="muted"> — {skill.description}</span>
                  </th>
                  <td>
                    <P04Pill namespace="source" member={skill.source} tone="MUTED" />
                  </td>
                  <td>
                    <P04Pill namespace="risk" member={skill.risk_class} tone={riskTone(skill.risk_class)} />
                  </td>
                  <td>
                    {skill.allowed_tools.length === 0
                      ? translator.t("skills.tools.none")
                      : translator.t("skills.tools.count", { count: skill.allowed_tools.length })}
                  </td>
                  <td>{formatInstant(locale, skill.updated_at)}</td>
                  <td>
                    <span className={`pill pill--${skill.enabled ? "POSITIVE" : "MUTED"}`}>
                      {translator.t(skill.enabled ? "skills.enabled" : "skills.disabled")}
                    </span>{" "}
                    <button
                      type="button"
                      className="button button--secondary"
                      aria-label={`${translator.t(skill.enabled ? "skills.action.disable" : "skills.action.enable")} ${skill.name}`}
                      onClick={() =>
                        void action.run(
                          () => client.configureSkill(skill.skill_id, !skill.enabled),
                          () => ({ phase: "DONE", messageKey: "p04.action.saved" }),
                          query.reload,
                        )
                      }
                    >
                      {translator.t(skill.enabled ? "skills.action.disable" : "skills.action.enable")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>
          <button type="button" className="button button--secondary" onClick={() => navigation.navigate("/tools")}>
            {translator.t("skills.link.tools")}
          </button>
        </p>
      </section>
    </>
  );
}
