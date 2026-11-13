// تحويلات عرض نقية لبيانات Phase-05. لا JSX ولا نصّ: مفاتيح ولهجات.
//
// ما لا يوجد هنا مقصود: لا لهجة «إيجابية» لذاكرة لأنها «مربوطة بدليل» — الذاكرة ليست
// حقيقة، وأقوى ما تُعرض به محايد. ولا لهجة نجاح لفعل أُرسل: الإرسال ليس نتيجة.

import type { Tone } from "../p02/present";

export function vocabularyKey(namespace: string, member: string): string {
  return `p05.${namespace}.${member}`;
}

export function verificationTone(verification: string): Tone {
  switch (verification) {
    case "EVIDENCE_LINKED":
      return "NEUTRAL";
    case "CONFLICTED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function memoryStatusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
      return "NEUTRAL";
    case "SUPERSEDED":
    case "EXPIRED":
      return "MUTED";
    case "DELETED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function originTone(trustClass: string): Tone {
  return trustClass === "MODEL_GENERATED" ? "WARNING" : "MUTED";
}

export function sessionTone(state: string): Tone {
  switch (state) {
    case "ACTIVE":
      return "POSITIVE";
    case "WAITING":
    case "CREATED":
      return "NEUTRAL";
    case "FAILED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/** الفعل المُنفَّذ محايد لا إيجابي: التنفيذ ليس تحقّقًا من النتيجة. */
export function actionStatusTone(status: string): Tone {
  switch (status) {
    case "EXECUTED":
      return "NEUTRAL";
    case "DENIED":
    case "FAILED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function isTerminalSession(state: string): boolean {
  return state === "CLOSED" || state === "FAILED" || state === "CANCELLED";
}
