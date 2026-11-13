// تحويل الأرقام في حقول الإدخال (E-1 / T-9، تدقيق 2026-10-19). دوالّ نقيّة بلا JSX، يستعملها `NumberField` وتُختبر وحدها.

const ARABIC_INDIC = 0x0660;
const EXTENDED_ARABIC_INDIC = 0x06f0;

/** يحوّل الأرقام العربية-الهندية والفارسية إلى لاتينية، ويُسقط ما ليس رقمًا (وإشارة السالب في أوّله إن سُمح بها). */
export function normalizeDigits(raw: string, allowNegative = false): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC && code <= ARABIC_INDIC + 9) out += String(code - ARABIC_INDIC);
    else if (code >= EXTENDED_ARABIC_INDIC && code <= EXTENDED_ARABIC_INDIC + 9) out += String(code - EXTENDED_ARABIC_INDIC);
    else if (ch >= "0" && ch <= "9") out += ch;
    else if (allowNegative && (ch === "-" || ch === "−") && out === "") out += "-";
  }
  return out;
}

/** هل النصّ عدد صحيح ضمن الحدّين؟ الفارغ ليس صالحًا. */
export function inRange(text: string, min?: number | null, max?: number | null): boolean {
  if (text === "" || text === "-") return false;
  const value = Number(text);
  if (!Number.isFinite(value)) return false;
  if (min !== undefined && min !== null && value < min) return false;
  if (max !== undefined && max !== null && value > max) return false;
  return true;
}
