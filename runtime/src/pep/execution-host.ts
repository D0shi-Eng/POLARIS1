// منفذ التنفيذ: الحد بين نقطة الفرض والعملية التي تُحدث الأثر فعلًا.
//
// وجود هذا الحد هو الفرق بين "PDP سمح فنادِ fs.readFile" وبين فرض حقيقي:
// نقطة الفرض تُصدر منحة، والتنفيذ يقع في مكان لا يملك الاستدعاء ولا القرار.

import type { ExecutionGrant, ExecutionOutcome } from "./grant.js";

export interface ExecutionHost {
  /** معرّف قابل للتسجيل، يُذكر في الدليل حتى يُعرف أي محوّل نفّذ. */
  readonly id: string;
  /** هل ينفّذ هذا المضيف داخل حصر ويندوز المُثبَت في W1. */
  readonly windowsConfinement: boolean;
  execute(grant: ExecutionGrant): Promise<ExecutionOutcome>;
}
