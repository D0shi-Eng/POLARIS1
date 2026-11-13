// علامة بناء القياس، في ملف صغير وحده: المنتج يقرؤها عند الإقلاع دون أن يحمّل مجموعات القياس.
// المجموعات نفسها تُحمَّل عند الحاجة فقط (استيراد ديناميكي)، فلا تدخل حزمة الإقلاع.

export function isE2EEnabled(): boolean {
  return (globalThis as { __POLARIS_E2E__?: boolean }).__POLARIS_E2E__ === true;
}
