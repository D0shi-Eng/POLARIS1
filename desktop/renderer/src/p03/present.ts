// تحويلات عرض نقية لبيانات Phase-03. لا JSX ولا نصّ: مفاتيح ولهجات.
//
// ما لا يوجد هنا مقصود: لا دالة تحسب نسبة ثقة، ولا دالة تحوّل حالة إلى نسبة
// تقدّم. كلتاهما رقم غير مقيس، وعرضه يجعل الواجهة تدّعي ما لا تعرفه. التقدّم
// يُعرض عدًّا صريحًا (نجحت س من ص)، والحقيقة تُعرض بحالتها المُسمّاة وحدها.

import type { Tone } from "../p02/present";

/// لهجة حالة المهمّة. الاكتمال «محايد» لا «إيجابي»: الإيجابية للإثبات لا للانتهاء.
export function missionStateTone(state: string): Tone {
  switch (state) {
    case "RUNNING":
    case "PLANNING":
    case "VERIFYING":
      return "NEUTRAL";
    case "COMPLETED":
      return "NEUTRAL";
    case "FAILED":
    case "BLOCKED":
      return "WARNING";
    case "CANCELLED":
    case "STOPPED":
      return "MUTED";
    default:
      return "MUTED";
  }
}

/// لهجة الإثبات. هنا وحدها تكون الإيجابية: شيء أُثبت فعلًا.
export function proofTone(status: string): Tone {
  switch (status) {
    case "PROVEN":
      return "POSITIVE";
    case "NOT_PROVEN":
      return "WARNING";
    default:
      return "MUTED";
  }
}

export function taskStateTone(state: string): Tone {
  switch (state) {
    case "SUCCEEDED":
      return "POSITIVE";
    case "RUNNING":
    case "ASSIGNED":
    case "REVIEW":
      return "NEUTRAL";
    case "FAILED":
    case "BLOCKED":
    case "INTERRUPTED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// لهجة حالة الادّعاء. «مدعوم» ليس إيجابيًّا: الدليل موجود والقاعدة لم تنجح.
export function claimStatusTone(status: string): Tone {
  switch (status) {
    case "VERIFIED":
      return "POSITIVE";
    case "SUPPORTED":
      return "NEUTRAL";
    case "REFUTED":
    case "CONFLICTED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// لهجة الدليل: المقيس وحده إيجابي، ومخرجات الوكيل خافتة مهما بدت واثقة.
export function evidenceTone(evidenceType: string, measurement: string): Tone {
  if (evidenceType === "AGENT_OUTPUT") return "MUTED";
  return measurement === "MEASURED" ? "POSITIVE" : "NEUTRAL";
}

export function agentStateTone(state: string): Tone {
  switch (state) {
    case "WORKING":
    case "REVIEWING":
      return "NEUTRAL";
    case "COMPLETED":
      return "POSITIVE";
    case "FAILED":
    case "BLOCKED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// مفتاح ترجمة عضوٍ في مفردة مغلقة. عضو مجهول يُعرض كما هو بدل أن يُخمَّن.
export function vocabularyKey(namespace: string, member: string): string {
  return `p03.${namespace}.${member}`;
}

/// يختصر بصمة للعرض. الهوية تبقى كاملة في العنوان، والمختصر للقراءة فقط.
export function shortDigest(digest: string): string {
  return digest.length <= 16 ? digest : `${digest.slice(0, 8)}…${digest.slice(-8)}`;
}

/// عدّ العُقد الناجحة من مجموعها. عدد صريح، لا نسبة مئوية مُختلقة.
export interface TaskTally {
  readonly total: number;
  readonly succeeded: number;
}

export function tallyOf(total: number, succeeded: number): TaskTally {
  return { total, succeeded };
}

/// هل يجوز بدء هذه المهمّة الآن؟ الحالات النهائية لا تُستأنف.
export function canStart(state: string): boolean {
  return state === "CREATED" || state === "READY" || state === "BLOCKED";
}

export function canCancel(state: string): boolean {
  return !["COMPLETED", "FAILED", "CANCELLED", "STOPPED"].includes(state);
}

export function canResume(state: string): boolean {
  return state === "BLOCKED" || state === "STOPPED";
}
