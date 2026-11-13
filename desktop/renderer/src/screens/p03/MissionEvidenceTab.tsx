// أدلّة المهمّة: مصدرها، ومن أنتجها، وهل قِيست أم استُنتجت، وبصمتها.
//
// أهمّ عمود هنا هو «القياس». دليل مخرجات وكيل يُعرض مستنتَجًا ومعه سطر صريح بأنه
// لا يحقّق شيئًا بمفرده؛ ودليل مقيس يُعرض مع مَن أنتجه خارج النموذج. الفرق بينهما
// هو كل ما تعنيه طبقة الحقيقة، فلا يُخفى خلف لون.

import { useTranslator } from "../../app/context";
import type { EvidenceListResultV1 } from "../../generated/types/desktop-p03-result-v1";
import { formatInstant, formatList } from "../../localization/format";
import type { LocaleCode } from "../../localization/types";
import { evidenceTone, shortDigest } from "../../p03/present";
import { StateBlock } from "../../ui/components/StateBlock";
import { StatusPill } from "./StatusPill";

export function MissionEvidenceTab({ evidence }: { readonly evidence: EvidenceListResultV1 }) {
  const translator = useTranslator();
  const locale = translator.locale as LocaleCode;

  if (evidence.evidence.length === 0) {
    return <StateBlock kind="empty" bodyKey="mission.evidence.empty" />;
  }

  return (
    <section className="section" aria-labelledby="mission-evidence">
      <h3 className="section__title" id="mission-evidence">
        {translator.t("mission.tab.evidence")}
      </h3>
      <table className="table">
        <caption className="sr-only">{translator.t("mission.tab.evidence")}</caption>
        <thead>
          <tr>
            <th scope="col">{translator.t("mission.evidence.column.type")}</th>
            <th scope="col">{translator.t("mission.evidence.column.measurement")}</th>
            <th scope="col">{translator.t("mission.evidence.column.producer")}</th>
            <th scope="col">{translator.t("mission.evidence.column.source")}</th>
            <th scope="col">{translator.t("mission.evidence.column.digest")}</th>
            <th scope="col">{translator.t("mission.evidence.column.created")}</th>
          </tr>
        </thead>
        <tbody>
          {evidence.evidence.map((item) => (
            <tr key={item.evidence_id}>
              <th scope="row">
                <StatusPill
                  namespace="evidence_type"
                  member={item.evidence_type}
                  tone={evidenceTone(item.evidence_type, item.measurement_kind)}
                />
                <p className="note">
                  {translator.t(
                    item.evidence_type === "AGENT_OUTPUT"
                      ? "mission.evidence.agent_output_note"
                      : "mission.evidence.measured_note",
                  )}
                </p>
              </th>
              <td>{translator.t(`p03.measurement.${item.measurement_kind}`)}</td>
              <td>
                {item.producer}
                <span className="muted"> — {translator.t(`p03.authority.${item.authority}`)}</span>
              </td>
              <td className="mono">
                {item.source_ref}
                <p className="note">
                  {translator.t("mission.evidence.lineage")}:{" "}
                  {item.lineage === undefined || item.lineage.length === 0
                    ? translator.t("mission.evidence.lineage.none")
                    : formatList(locale, item.lineage)}
                </p>
              </td>
              <td className="mono" title={item.digest}>
                {shortDigest(item.digest)}
              </td>
              <td>{formatInstant(locale, item.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
