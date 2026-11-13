// مفردات عمليات سطح المكتب في Phase-01، بوصفها قيمًا لا أنواعًا فقط.
//
// المخطط هو مصدر الحقيقة (ADR-002)، وهذا الملف تكرار واحد لا مفرّ منه: قائمة
// العمليات مطلوبة كقيمة TypeScript وقت التشغيل، تمامًا كما كان ErrorCode. وكما
// هناك، الحارس هو اختبار تكافؤ يقارن هذه القائمة بـenum المخطط، فينكسر البناء
// إن انحرفا. لا يُضاف عنصر هنا دون أن يُضاف هناك.

import type { ParsedVersion } from "../version.js";

/** العمليات الخمس، بترتيب المخطط نفسه. */
export const DESKTOP_OPERATIONS = [
  "desktop.bootstrap",
  "desktop.runtime.status",
  "desktop.capability.availability",
  "desktop.settings.describe",
  "desktop.settings.read",
] as const;

export type DesktopOperation = (typeof DESKTOP_OPERATIONS)[number];

/** البادئة التي تُميّز نطاق سطح المكتب. تُستعمل للتصنيف، لا لقبول أي اسم يبدأ بها. */
export const DESKTOP_OPERATION_PREFIX = "desktop.";

/**
 * أول إصدار MINOR من IPCEnvelopeV1 يعرف عمليات سطح المكتب.
 *
 * بوابة الإصدار وحدها لا تفرض هذا: مستند يعلن 1.0 ويحمل عملية 1.1 يمر بها لأن
 * البوابة تقبل MINOR أدنى. القاعدة الدلالية أدناه هي ما يجعل «عملية 1.1 تلزمها
 * 1.1» صحيحًا فعلًا، لا مجرد نية مكتوبة في ADR.
 */
export const DESKTOP_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 1 };

/** هل هذه القيمة واحدة من الخمس بالضبط؟ الاسم الذي يبدأ بـ"desktop." وليس منها ليس منها. */
export function isDesktopOperation(value: unknown): value is DesktopOperation {
  return typeof value === "string" && (DESKTOP_OPERATIONS as readonly string[]).includes(value);
}

/** هل يدّعي هذا الاسم نطاق سطح المكتب دون أن يكون عملية معروفة؟ */
export function claimsDesktopNamespace(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(DESKTOP_OPERATION_PREFIX);
}

/** مرجع مخطط حمولة الطلب لكل عملية. الصيغة نفسها التي يستعملها السجل. */
export const DESKTOP_REQUEST_SCHEMA: Readonly<Record<DesktopOperation, string>> = {
  "desktop.bootstrap": "desktop-request.v1.schema.json#/$defs/DesktopBootstrapRequestV1",
  "desktop.runtime.status": "desktop-request.v1.schema.json#/$defs/DesktopRuntimeStatusRequestV1",
  "desktop.capability.availability":
    "desktop-request.v1.schema.json#/$defs/DesktopCapabilityAvailabilityRequestV1",
  "desktop.settings.describe": "desktop-request.v1.schema.json#/$defs/DesktopSettingsDescribeRequestV1",
  "desktop.settings.read": "desktop-request.v1.schema.json#/$defs/DesktopSettingsReadRequestV1",
};

/** مرجع مخطط حمولة النتيجة لكل عملية. */
export const DESKTOP_RESULT_SCHEMA: Readonly<Record<DesktopOperation, string>> = {
  "desktop.bootstrap": "desktop-result.v1.schema.json#/$defs/DesktopBootstrapResultV1",
  "desktop.runtime.status": "desktop-result.v1.schema.json#/$defs/DesktopRuntimeStatusResultV1",
  "desktop.capability.availability":
    "desktop-result.v1.schema.json#/$defs/DesktopCapabilityAvailabilityResultV1",
  "desktop.settings.describe": "desktop-result.v1.schema.json#/$defs/DesktopSettingsDescribeResultV1",
  "desktop.settings.read": "desktop-result.v1.schema.json#/$defs/DesktopSettingsReadResultV1",
};
