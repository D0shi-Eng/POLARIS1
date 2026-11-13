// ادّعاءات المهمّة بحالاتها الستّ.
//
// لا نسبة ثقة هنا: لا تعريف مقيس لها. ولا شارة «محقَّق» تُمنح لأن الوكيل بدا
// واثقًا — الحالة تأتي من المحرّك، ومعها شرحٌ يقول لماذا هي كذلك.

import { useTranslator } from "../../app/context";
import { formatList } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import type { ClaimListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import { claimStatusTone } from "../../p03/present";
import { StateBlock } from "../../ui/components/StateBlock";
import { StatusPill } from "./StatusPill";

export function MissionClaimsTab({ claims }: { readonly claims: ClaimListResultV1 }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;

  if (claims.claims.length === 0) {
    return <StateBlock kind="empty" bodyKey="mission.claims.empty" />;
  }

  return (
    <section className="section" aria-labelledby="mission-claims">
      <h3 className="section__title" id="mission-claims">
        {translator.t("mission.tab.claims")}
      </h3>
      <table className="table">
        <caption className="sr-only">{translator.t("mission.tab.claims")}</caption>
        <thead>
          <tr>
            <th scope="col">{translator.t("mission.claims.column.statement")}</th>
            <th scope="col">{translator.t("mission.claims.column.status")}</th>
            <th scope="col">{translator.t("mission.claims.column.type")}</th>
            <th scope="col">{translator.t("mission.claims.column.evidence")}</th>
            <th scope="col">{translator.t("mission.claims.taint")}</th>
          </tr>
        </thead>
        <tbody>
          {claims.claims.map((claim) => (
            <tr key={claim.claim_id}>
              <th scope="row">
                {claim.statement}
                {claim.subject === undefined || claim.property === undefined || claim.value === undefined ? null : (
                  <span className="muted">
                    {" "}
                    —{" "}
                    {translator.t("mission.claims.subject", {
                      subject: claim.subject,
                      property: claim.property,
                      value: claim.value,
                    })}
                  </span>
                )}
              </th>
              <td>
                <StatusPill
                  namespace="claim_status"
                  member={claim.status}
                  tone={claimStatusTone(claim.status)}
                  hint={`p03.claim_status.hint.${claim.status}`}
                />
                <p className="note">{translator.t(`p03.claim_status.hint.${claim.status}`)}</p>
              </td>
              <td>{translator.t(`p03.claim_type.${claim.claim_type}`)}</td>
              <td>
                {translator.t("mission.claims.evidence.count", {
                  supporting: claim.evidence_count,
                  countering: claim.counterevidence_count,
                })}
              </td>
              <td>
                {claim.taint.length === 0
                  ? translator.t("p03.taint.none")
                  : formatList(locale, claim.taint.map((flag) => translator.t(`p03.taint.${flag}`)))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
