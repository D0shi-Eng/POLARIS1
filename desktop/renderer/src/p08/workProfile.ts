// ملف «العمل» (ADR-028، مُعدَّل): حدود أوسع من الافتراض المحافظ تتّسع لمهمّة حقيقية (نموذج محلي
// بطيء، Python، تصفّح). يختاره المستخدم صراحةً من الإعدادات فيُكتب في طبقة USER وحدها؛ طبقة
// المهمّة لا توسّع حدًّا أمنيًّا أبدًا (ثابت Phase-06)، فلا يُكتب منها. المضيف يقصّه إلى سقوفه.

export const WORK_PROFILE: ReadonlyArray<readonly [string, number]> = [
  ["agents.max_tool_calls_per_mission", 64],
  ["tools.max_runtime_per_mission", 1_200_000],
  ["tools.max_network_calls_per_mission", 48],
  ["agents.max_external_side_effects_per_mission", 6],
];
