// الحالات السبع، بمكوّن واحد.
//
// كل حالة تقول ما حدث ولماذا، ولها فعل واحد حين يكون هناك فعل معقول. لا شاشة
// فارغة، ولا دوّامة تحميل بلا نهاية، ولا أثر مكدّس يُعرض لمستخدم.

import type { ReactNode } from "react";

import { useTranslator } from "../../app/context";

export type StateKind =
  | "loading"
  | "empty"
  | "offline"
  | "unavailable"
  | "blocked"
  | "error"
  | "retrying";

export interface StateBlockProps {
  readonly kind: StateKind;
  readonly titleKey?: string;
  readonly bodyKey?: string;
  readonly bodyValues?: Readonly<Record<string, string | number>>;
  /** رمز الخطأ كما وصل من الحدّ. رمز، لا تفصيل داخلي. */
  readonly code?: string;
  readonly action?: { readonly labelKey: string; readonly onSelect: () => void };
  readonly children?: ReactNode;
}

export function StateBlock({ kind, titleKey, bodyKey, bodyValues, code, action, children }: StateBlockProps) {
  const translator = useTranslator();
  const busy = kind === "loading" || kind === "retrying";
  return (
    <section
      className="state"
      role={busy ? "status" : "region"}
      {...(busy ? { "aria-live": "polite" as const, "aria-busy": true } : {})}
      aria-label={translator.t(titleKey ?? `state.${kind}`)}
    >
      <h2 className="state__title">{translator.t(titleKey ?? `state.${kind}`)}</h2>
      {bodyKey === undefined ? null : (
        <p className="state__body">{translator.t(bodyKey, bodyValues)}</p>
      )}
      {code === undefined ? null : (
        <p className="state__code">{translator.t("bootstrap.error.code", { code })}</p>
      )}
      {children}
      {action === undefined ? null : (
        <button type="button" className="button button--primary" onClick={action.onSelect}>
          {translator.t(action.labelKey)}
        </button>
      )}
    </section>
  );
}
