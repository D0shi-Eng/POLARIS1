// أدوات اختبارات W5. تبني فوق أدوات W4 ولا تستنسخها.
//
// الفارق الوحيد عن W4: إعدادات الموافقة، وطرف مالك يستطيع أن يحسم طلبًا
// معروضًا. الطرف المالك هنا اختبار، وفي المنتج واجهة — كلاهما خارج مسار
// النموذج، وهو ما يجعل الاختبار ممثلًا للحالة الحقيقية لا محاكيًا لها.

import { newId } from "../src/ids.js";
import type { ApprovalRequest } from "../src/approval/types.js";
import type { PolarisRuntime } from "../src/runtime.js";
import type { CompletionRequirement } from "../src/proof/types.js";
import type { EffectAction } from "../src/effects.js";
import { buildRuntime, makeWorkspace, type BuiltRuntime, type RuntimeSetup, type Workspace } from "./w4-helpers.js";

export { makeWorkspace, startMission, writeWorkspaceFile } from "./w4-helpers.js";
export type { Workspace } from "./w4-helpers.js";

export interface W5RuntimeSetup extends RuntimeSetup {
  /** الآثار التي تشترط موافقة إنسان. فارغة تعني: لا موافقة مطلوبة. */
  readonly approvalRequiredEffects?: readonly string[];
  readonly approvalExpirySeconds?: number;
  readonly approver?: "END_USER" | "OPERATOR";
}

export function buildW5Runtime(setup: W5RuntimeSetup): BuiltRuntime {
  return buildRuntime({
    ...setup,
    configOverrides: [
      ...(setup.configOverrides ?? []),
      {
        key: "polaris.approval.required_effects",
        scope: "USER" as const,
        value: [...(setup.approvalRequiredEffects ?? [])],
      },
      ...(setup.approvalExpirySeconds === undefined
        ? []
        : [
            {
              key: "polaris.approval.expires_in_seconds",
              scope: "USER" as const,
              value: setup.approvalExpirySeconds,
            },
          ]),
      ...(setup.approver === undefined
        ? []
        : [{ key: "polaris.approval.approver", scope: "USER" as const, value: setup.approver }]),
    ],
  });
}

/**
 * يجعل الطرف المالك يحسم كل طلب يُعرض عليه بالطريقة المُعطاة.
 *
 * هذا ليس «موافقة تلقائية» في المنتج: هو فعل الطرف المالك في الاختبار، ويمر
 * بنفس الدالة العامة التي ستستدعيها الواجهة. المسار الوحيد إلى GRANTED يبقى
 * استدعاءً صريحًا من خارج مسار النموذج.
 */
export function ownerAnswers(
  runtime: PolarisRuntime,
  answer: (request: ApprovalRequest) => "GRANT" | "REJECT" | "IGNORE",
): { readonly seen: ApprovalRequest[] } {
  const seen: ApprovalRequest[] = [];
  runtime.controls.approvalSurface.onPresented((request) => {
    seen.push(request);
    const decision = answer(request);
    // التأجيل بخطوة حدث: العرض يقع داخل بناء الوعد، والحسم يجب أن يليه.
    if (decision === "GRANT") setImmediate(() => runtime.controls.approvalSurface.grant(request.approval_id));
    if (decision === "REJECT") setImmediate(() => runtime.controls.approvalSurface.reject(request.approval_id));
  });
  return { seen };
}

/** متطلب إنجاز مُعلَن عند جذر التركيب، لا في مقترح نموذج. */
export function requireArtefact(
  missionId: string,
  expectedTarget: string,
  effect: EffectAction = "write.filesystem",
): CompletionRequirement {
  return {
    requirement_id: newId(),
    mission_id: missionId,
    effect,
    expected_target: expectedTarget,
    description: `an artefact must exist at ${expectedTarget} and be attributable to an authorised grant`,
  };
}

/** نموذج يقترح كتابة ثم ينهي. الأبسط الذي يكفي لسيناريو أثر واحد. */
export function writeThenFinish(path: string, content: string): readonly string[] {
  return [
    JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.write_file", arguments: { path, content } }),
    JSON.stringify({ action: "finish", summary: "done" }),
  ];
}

export function readThenWriteThenFinish(readPath: string, writePath: string, content: string): readonly string[] {
  return [
    JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: readPath } }),
    JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.write_file", arguments: { path: writePath, content } }),
    JSON.stringify({ action: "finish", summary: "read the README and wrote a summary" }),
  ];
}

export interface W5Workspace extends Workspace {
  readonly outLogical: string;
}

export function w5Workspace(): W5Workspace {
  const workspace = makeWorkspace();
  return Object.assign(workspace, { outLogical: workspace.path("out", "summary.txt") });
}
