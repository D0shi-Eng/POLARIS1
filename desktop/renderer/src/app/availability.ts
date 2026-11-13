// تحويل الإتاحة إلى وصف قابل للعرض.
//
// دالة نقية، بلا JSX وبلا نصّ: تأخذ حالةً وسببًا وتعيد مفاتيح. الشاشة تترجم.
// لو رجعت نصًّا لصار في العارض نصّ مكتوب بيد خارج ملفات اللغة.

import type { Availability, AvailabilityReason, AvailabilityState } from "../generated/types/desktop-result-v1";
import type { Translator } from "../localization/translate";

export interface AvailabilityPresentation {
  readonly state: AvailabilityState;
  readonly reason: AvailabilityReason | null;
  readonly stateKey: string;
  readonly reasonKey: string | null;
  /** هل يُسمح بالتفاعل مع هذه الوجهة أصلًا؟ */
  readonly actionable: boolean;
  /** درجة اللهجة البصرية. لا لون هنا: الشاشة تختار من الرموز. */
  readonly tone: "POSITIVE" | "NEUTRAL" | "MUTED" | "WARNING";
}

export function present(availability: Availability | undefined): AvailabilityPresentation {
  const state: AvailabilityState = availability?.state ?? "ERROR";
  const reason = (availability?.reason ?? null) as AvailabilityReason | null;
  return {
    state,
    reason,
    stateKey: `availability.state.${state}`,
    reasonKey: reason === null ? null : `availability.reason.${reason}`,
    actionable: state === "AVAILABLE",
    tone: toneOf(state),
  };
}

function toneOf(state: AvailabilityState): AvailabilityPresentation["tone"] {
  switch (state) {
    case "AVAILABLE":
      return "POSITIVE";
    case "READ_ONLY":
      return "NEUTRAL";
    case "UNAVAILABLE":
      return "MUTED";
    case "BLOCKED":
    case "ERROR":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/**
 * جملة واحدة تشرح الحالة والسبب.
 *
 * مبنيّة من مفتاح واحد فيه موضعان، لا من ضمّ «غير متاح» + « — » + السبب: الضمّ
 * يكسر الترتيب في اللغات التي تضع السبب أولًا، ويكسر الاتجاه في العربية.
 */
export function explain(translator: Translator, presentation: AvailabilityPresentation): string {
  const state = translator.t(presentation.stateKey);
  if (presentation.reasonKey === null) return state;
  return translator.t("availability.explained", {
    state,
    reason: translator.t(presentation.reasonKey),
  });
}
