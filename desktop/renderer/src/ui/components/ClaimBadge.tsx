// حقيقة مع مصدرها: «مدعوم (أبلغ به المزوّد)». المجهول يُقال مجهولًا.

import { useTranslator } from "../../app/context";

export function ClaimBadge({ support, provenance }: { readonly support: string; readonly provenance: string }) {
  const translator = useTranslator();
  const tone = support === "SUPPORTED" ? "POSITIVE" : support === "UNSUPPORTED" ? "NEUTRAL" : "MUTED";
  return (
    <span className={`pill pill--${tone}`}>
      {translator.t("p02.claim", {
        support: translator.t(`p02.support.${support}`),
        provenance: translator.t(`p02.provenance.${provenance}`),
      })}
    </span>
  );
}

export function ProvenanceText({ value, provenance }: { readonly value: string | undefined; readonly provenance: string }) {
  const translator = useTranslator();
  if (value === undefined) return <span>{translator.t("p02.value.unknown")}</span>;
  return (
    <span>
      {translator.t("p02.value.with_provenance", {
        value,
        provenance: translator.t(`p02.provenance.${provenance}`),
      })}
    </span>
  );
}
