// مفردة الآثار كما في common/effect.schema.json. تُكرَّر هنا كنوع TypeScript
// لأن طبقة التشغيل تحتاجها في زمن الترجمة، ويحرس التطابقَ اختبارُ انجراف
// يقرأ المخطط من مصدر الحقيقة ويقارنه بهذه القائمة.

export const EFFECT_ACTIONS = [
  "read.filesystem",
  "write.filesystem",
  "create.filesystem",
  "delete.filesystem",
  "execute.process",
  "install.package",
  "network.fetch",
  "network.send",
  "network.publish",
  "browser.navigate",
  "browser.submit",
  "email.read",
  "email.send",
  "secret.reference",
  "secret.deref",
  "memory.read",
  "memory.write",
  "system.read",
  "system.modify",
  "payment.prepare",
  "payment.commit",
] as const;

export type EffectAction = (typeof EFFECT_ACTIONS)[number];

export const NETWORK_ACTIONS: ReadonlySet<EffectAction> = new Set<EffectAction>([
  "network.fetch",
  "network.send",
  "network.publish",
]);

export const FILESYSTEM_WRITE_ACTIONS: ReadonlySet<EffectAction> = new Set<EffectAction>([
  "write.filesystem",
  "create.filesystem",
  "delete.filesystem",
]);

export function isEffectAction(value: unknown): value is EffectAction {
  return typeof value === "string" && (EFFECT_ACTIONS as readonly string[]).includes(value);
}
