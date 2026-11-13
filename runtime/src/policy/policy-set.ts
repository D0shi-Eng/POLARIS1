// مجموعة سياسات W4. ثلاث سياسات POLARIS منطقية.
//
// سياسة POLARIS واحدة قد تُترجم إلى أكثر من عبارة Cedar: العبارة الأمنية (forbid)
// والمسار الوحيد الذي يمكن أن يرضيها (permit). الوحدة المنطقية والمسؤولية
// والتوثيق واحدة، والمعرّفات تحمل نفس البادئة.
//
// نموذج Cedar هنا default-deny: غياب permit مطابق يعني رفضًا، و forbid يغلب permit دائمًا.

export interface PolicyMetadata {
  readonly policy_id: string;
  readonly title: string;
  readonly cedar_ids: readonly string[];
  readonly rationale: string;
}

export const POLICY_001: PolicyMetadata = {
  policy_id: "POLICY-001",
  title: "Allow explicitly scoped local filesystem read",
  cedar_ids: ["POLICY-001.permit"],
  rationale:
    "A read is permitted only when the capability declared the effect, the path lies under a configured allowed root, execution is confined, the effective configuration is healthy, and any tainted action parameter carries a declassification bound to this very effect.",
};

export const POLICY_002: PolicyMetadata = {
  policy_id: "POLICY-002",
  title: "Deny network effects without brokered-egress authorization",
  cedar_ids: ["POLICY-002.forbid", "POLICY-002.permit"],
  rationale:
    "W1 proved an AppContainer network capability is not destination-controlled egress. A network effect is therefore denied unless brokered egress is enabled in configuration AND the destination is on the configured allow-list AND the invocation itself requests BROKERED_EGRESS. The forbid overrides any permit, so this cannot be bypassed by adding a rule.",
};

export const POLICY_003: PolicyMetadata = {
  policy_id: "POLICY-003",
  title: "Allow scoped local filesystem write, and forbid deletion outright",
  cedar_ids: ["POLICY-003.permit", "POLICY-003.forbid-delete"],
  rationale:
    "A write is permitted only when writing is enabled in configuration, the target lies under a configured WRITE root (never inherited from the read roots), execution is confined, configuration is healthy, and any tainted target carries a declassification bound to the write effect. Deletion has no capability in W4 and is forbidden unconditionally, so no write capability can acquire delete semantics by widening its request.",
};

export const POLICIES: readonly PolicyMetadata[] = [POLICY_001, POLICY_002, POLICY_003];

/**
 * نص السياسات مفهرسًا بالمعرّف، حتى تعود معرّفات مقروءة في تشخيص Cedar
 * بدل policy0/policy1، فيصبح "لماذا رُفض" قابلًا للإسناد.
 *
 * شرط التلوث مكتوب صراحة في كل permit: القيمة الملوّثة لا تمر لأنها معقولة،
 * بل لأن سجل رفع تصنيف مربوطًا بهذا الأثر بعينه موجود فعلًا.
 */
export const CEDAR_POLICIES: Readonly<Record<string, string>> = {
  "POLICY-001.permit": `
permit (
  principal,
  action == Polaris::Action::"read.filesystem",
  resource
)
when {
  context.effect_declared_by_descriptor == true &&
  context.path_in_allowed_root == true &&
  context.confined == true &&
  context.config_healthy == true &&
  (context.parameter_tainted == false || context.parameter_declassified_for_effect == true)
};`.trim(),

  "POLICY-002.forbid": `
forbid (
  principal,
  action in [
    Polaris::Action::"network.fetch",
    Polaris::Action::"network.send",
    Polaris::Action::"network.publish"
  ],
  resource
)
unless {
  context.brokered_egress_enabled == true &&
  context.destination_authorized == true &&
  context.invocation_requests_brokered_egress == true
};`.trim(),

  "POLICY-002.permit": `
permit (
  principal,
  action in [
    Polaris::Action::"network.fetch",
    Polaris::Action::"network.send",
    Polaris::Action::"network.publish"
  ],
  resource
)
when {
  context.effect_declared_by_descriptor == true &&
  context.brokered_egress_enabled == true &&
  context.destination_authorized == true &&
  context.invocation_requests_brokered_egress == true &&
  context.config_healthy == true &&
  (context.parameter_tainted == false || context.parameter_declassified_for_effect == true)
};`.trim(),

  "POLICY-003.permit": `
permit (
  principal,
  action in [
    Polaris::Action::"write.filesystem",
    Polaris::Action::"create.filesystem"
  ],
  resource
)
when {
  context.effect_declared_by_descriptor == true &&
  context.write_enabled == true &&
  context.path_in_allowed_write_root == true &&
  context.confined == true &&
  context.config_healthy == true &&
  (context.parameter_tainted == false || context.parameter_declassified_for_effect == true)
};`.trim(),

  "POLICY-003.forbid-delete": `
forbid (
  principal,
  action == Polaris::Action::"delete.filesystem",
  resource
);`.trim(),
};

/** ربط معرّف Cedar بسياسة POLARIS المنطقية. */
export function policyFor(cedarId: string): PolicyMetadata | undefined {
  return POLICIES.find((p) => p.cedar_ids.includes(cedarId));
}
