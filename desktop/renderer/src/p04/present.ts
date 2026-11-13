// تحويلات عرض نقية لبيانات Phase-04. لا JSX ولا نصّ: مفاتيح ولهجات.
//
// ما لا يوجد هنا مقصود: لا دالّة تُخفي رفضًا، ولا دالّة تقول «آمن» عن أداة. الأثر
// يُعرض بأسمائه، وصنف ثقة الأداة يُعرض كما هو، ورفضُ البوابة يُعرض برمزه — لأن
// «لم يحدث شيء» و«مُنع شيء» ليسا واحدًا.

import type { Tone } from "../p02/present";

/// لهجة أثر الأداة. القراءة والحساب خافتان، والتغيير محذّر، والأثر الخارجي أشدّ.
export function effectTone(effect: string): Tone {
  switch (effect) {
    case "LOCAL_COMPUTE":
    case "READ_LOCAL":
    case "DATABASE_READ":
      return "MUTED";
    case "WRITE_LOCAL":
    case "DATABASE_WRITE":
    case "NETWORK_EGRESS":
      return "NEUTRAL";
    case "EXTERNAL_SIDE_EFFECT":
    case "PROCESS_EXECUTION":
    case "SECRET_ACCESS":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// لهجة صنف الخطر.
export function riskTone(risk: string): Tone {
  switch (risk) {
    case "LOW":
      return "MUTED";
    case "MODERATE":
      return "NEUTRAL";
    case "HIGH":
    case "CRITICAL":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// لهجة صنف ثقة الأداة. ما جاء من خادم يبقى مُعلَّمًا، ولا يُعرض «موثوقًا».
export function trustTone(trustClass: string): Tone {
  return trustClass === "TRUSTED_RUNTIME" ? "NEUTRAL" : "WARNING";
}

/// لهجة حالة استدعاء. النجاح إيجابي، والرفض محذّر، والانتظار محايد.
export function invocationTone(status: string): Tone {
  switch (status) {
    case "SUCCEEDED":
      return "POSITIVE";
    case "AWAITING_APPROVAL":
      return "NEUTRAL";
    case "DENIED":
    case "FAILED":
    case "TIMED_OUT":
      return "WARNING";
    case "CANCELLED":
      return "MUTED";
    default:
      return "MUTED";
  }
}

/// لهجة حالة موافقة. المنح إيجابي، والمنع محذّر، والانقضاء خافت.
export function approvalTone(status: string): Tone {
  switch (status) {
    case "GRANTED":
      return "POSITIVE";
    case "PENDING":
      return "NEUTRAL";
    case "DENIED":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// لهجة حالة خادم.
export function serverTone(state: string): Tone {
  switch (state) {
    case "ENABLED":
      return "POSITIVE";
    case "REGISTERED":
      return "NEUTRAL";
    case "UNREACHABLE":
      return "WARNING";
    default:
      return "MUTED";
  }
}

/// مفتاح ترجمة عضوٍ في مفردة مغلقة. عضو مجهول يُعرض كما هو بدل أن يُخمَّن.
export function vocabularyKey(namespace: string, member: string): string {
  return `p04.${namespace}.${member}`;
}

/// هل تحتاج هذه الأداة قرارًا بشريًّا؟ يُقرأ من الواصف لا من نيّة المستدعي.
export function needsApproval(tool: { readonly requires_approval: boolean; readonly effects: readonly string[] }): boolean {
  const mutating = ["WRITE_LOCAL", "DATABASE_WRITE", "EXTERNAL_SIDE_EFFECT", "PROCESS_EXECUTION", "SECRET_ACCESS"];
  return tool.requires_approval || tool.effects.some((effect) => mutating.includes(effect));
}

/// هل يجوز طلب اكتشاف أدوات هذا الخادم الآن؟ الخادم المعطّل لا يُسأل.
export function canRefresh(state: string): boolean {
  return state !== "DISABLED";
}

/// عدّ صريح للنشاط: نُفِّذ، ومُنع، وينتظر قرارًا. لا نسبة نجاح مُختلقة.
export interface ActivityTally {
  readonly executed: number;
  readonly denied: number;
  readonly awaiting: number;
}

export function tallyActivity(records: readonly { readonly status: string }[]): ActivityTally {
  return {
    executed: records.filter((record) => ["SUCCEEDED", "FAILED", "TIMED_OUT"].includes(record.status)).length,
    denied: records.filter((record) => record.status === "DENIED").length,
    awaiting: records.filter((record) => record.status === "AWAITING_APPROVAL").length,
  };
}

/// يختصر بصمة للعرض. الهوية تبقى كاملة في العنوان، والمختصر للقراءة فقط.
export function shortDigest(digest: string): string {
  return digest.length <= 16 ? digest : `${digest.slice(0, 8)}…${digest.slice(-8)}`;
}

/// المفعولات تصل من المخطط اتحادًا لمجموعاتٍ محدودة الطول، لأن الحدّ معلن هناك.
/// القراءة تحتاج قائمة واحدة، والتوسيع هنا لا يُسقط تحقُّقًا: الحدّ يُفرض في المضيف
/// وفي المخطط، لا في نوع العارض. فحص «القائمة فارغة» يبقى نافعًا رغم أن المخطط
/// يمنعه، لأن ما يصل من الحدود يُقاس ولا يُفترَض.
export function effectsOf(effects: readonly string[]): readonly string[] {
  return effects;
}
