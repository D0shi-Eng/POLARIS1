// طبقة ثقة المدخلات. كل ما يدخل الوكيل يحصل على مصدر وتصنيف ثقة ووسوم تلوث ومرجع أصل.
// المفردة صغيرة عمدًا: هذه ليست منظومة تصنيف بيانات مؤسسية.

import { newId, nowTimestamp, sha256 } from "../ids.js";
import { mergeTaint, type TaintLabel } from "./taint.js";

/** مصدر المدخل. مجموعة مغلقة: مصدر غير معروف ليس نقطة توسعة بل خطأ. */
export type IngressSource =
  | "DIRECT_USER"
  | "TRUSTED_LOCAL_RESOURCE"
  | "UNTRUSTED_LOCAL_CONTENT"
  | "UNTRUSTED_REMOTE_CONTENT"
  | "MODEL_DERIVED"
  | "TOOL_DERIVED"
  | "POLARIS_SYSTEM_STATE";

export type ContentTrust = "TRUSTED" | "UNTRUSTED";

/**
 * سلطة التعليمات: هل يجوز أن يُعامَل نص هذا المدخل كأمر يوجّه الوكيل.
 * USER للمستخدم المباشر فقط. كل ما عداه NONE، بما فيه محتوى ملف مصرّح بقراءته.
 */
export type InstructionAuthority = "USER" | "NONE";

/**
 * تصريح المورد منفصل عن ثقة المحتوى، وهذا الفصل مقصود:
 * أن يكون الملف داخل نطاق مصرّح به لا يجعل ما بداخله تعليمات موثوقة.
 */
export type ResourceAuthorization = "AUTHORIZED" | "UNAUTHORIZED" | "NOT_APPLICABLE";

export interface IngressRecord {
  readonly ingress_id: string;
  readonly source: IngressSource;
  readonly resource_authorization: ResourceAuthorization;
  readonly content_trust: ContentTrust;
  readonly instruction_authority: InstructionAuthority;
  readonly taint_labels: readonly TaintLabel[];
  readonly byte_length: number;
  readonly content_sha256: string;
  readonly captured_at: string;
  /** وصف الموقع الذي جاء منه المدخل. لا يحمل محتوى. */
  readonly locator?: string;
}

interface SourceProfile {
  readonly content_trust: ContentTrust;
  readonly instruction_authority: InstructionAuthority;
  readonly taint: readonly TaintLabel[];
}

/**
 * جدول التصنيف. TRUSTED_LOCAL_RESOURCE يعني أن المورد مصرّح به،
 * ومع ذلك محتواه UNTRUSTED_FILE: التصريح ملكية، والمحتوى قد يكون معاديًا.
 */
const PROFILES: Readonly<Record<IngressSource, SourceProfile>> = {
  DIRECT_USER: { content_trust: "TRUSTED", instruction_authority: "USER", taint: ["USER_SUPPLIED"] },
  TRUSTED_LOCAL_RESOURCE: { content_trust: "UNTRUSTED", instruction_authority: "NONE", taint: ["UNTRUSTED_FILE"] },
  UNTRUSTED_LOCAL_CONTENT: { content_trust: "UNTRUSTED", instruction_authority: "NONE", taint: ["UNTRUSTED_FILE"] },
  UNTRUSTED_REMOTE_CONTENT: { content_trust: "UNTRUSTED", instruction_authority: "NONE", taint: ["UNTRUSTED_WEB"] },
  MODEL_DERIVED: { content_trust: "UNTRUSTED", instruction_authority: "NONE", taint: ["MODEL_GENERATED"] },
  TOOL_DERIVED: { content_trust: "UNTRUSTED", instruction_authority: "NONE", taint: [] },
  POLARIS_SYSTEM_STATE: { content_trust: "TRUSTED", instruction_authority: "NONE", taint: ["SYSTEM_DERIVED"] },
};

export interface ClassifyInput {
  readonly source: IngressSource;
  readonly content: string;
  readonly resource_authorization?: ResourceAuthorization;
  /** وسوم موروثة من المصدر الذي أنتج هذا المدخل. تُدمج ولا تُستبدل. */
  readonly inherited_taint?: readonly TaintLabel[];
  readonly locator?: string;
}

/** يصنّف مدخلًا واحدًا. الوسوم الموروثة تُضاف دائمًا، فلا يمسح عبورُ الحدّ تلوثًا. */
export function classifyIngress(input: ClassifyInput): IngressRecord {
  const profile = PROFILES[input.source];
  const record: IngressRecord = {
    ingress_id: newId(),
    source: input.source,
    resource_authorization: input.resource_authorization ?? "NOT_APPLICABLE",
    content_trust: profile.content_trust,
    instruction_authority: profile.instruction_authority,
    taint_labels: mergeTaint(profile.taint, input.inherited_taint ?? []),
    byte_length: Buffer.byteLength(input.content, "utf8"),
    content_sha256: sha256(input.content),
    captured_at: nowTimestamp(),
  };
  return input.locator === undefined ? record : { ...record, locator: input.locator };
}

/** المدخلات التي يجوز أن توجّه الوكيل. تُستعمل عند بناء السياق، لا عند العرض. */
export function carriesInstructionAuthority(record: IngressRecord): boolean {
  return record.instruction_authority === "USER";
}
