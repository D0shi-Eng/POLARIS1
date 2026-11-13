// بوابة الإصدارات. تعمل قبل التحقق من المخطط حتى ينتج الإصدار غير المدعوم خطأ UNSUPPORTED_VERSION
// وليس خطأ تحقق عامًا، ولتُرفض الإصدارات الأعلى بأمان بدل تجاهل حقول غير معروفة.

import { ErrorCode, type ContractError } from "./errors.js";

/** أسماء العقود الستة. مغلقة عمدًا. */
export const CONTRACT_NAMES = [
  "IPCEnvelopeV1",
  "CapabilityDescriptorV1",
  "CapabilityInvocationV1",
  "PolicyDecisionV1",
  "AuditEventV1",
  "ModelOutputContractV1",
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

/** الإصدار المدعوم حاليًا لكل عقد: أعلى MAJOR.MINOR يفهمه هذا البناء. */
export const SUPPORTED_VERSIONS: Readonly<Record<ContractName, { major: number; minor: number }>> = {
  // 1.1 أضاف مفردات عمليات سطح المكتب لـP01 (ADR-017): خمس عمليات desktop.* للقراءة فقط.
  // إضافة قيم enum تغيير إضافي: مستندات 1.0 تبقى صالحة تحت هذا البناء. والاتجاه المعاكس
  // ليس مضمونًا ولا يُدّعى: مستقبِل 1.0 يرفض وثيقة 1.1 بـUNSUPPORTED_VERSION، وهو السلوك
  // المُصرَّح به هنا لا مفاجأة.
  // 1.2 أضاف تسع عشرة عملية لـPhase-02 (ADR-019): provider.* وmodel.* وproject.* وcontext.*.
  // إضافة بحتة كذلك: مستندات 1.0 و1.1 تبقى صالحة.
  // 1.3 أضاف عشر عمليات لـPhase-03 (ADR-021)، و1.4 أضاف اثنتي عشرة لـPhase-04 (ADR-023):
  // skill.* وtool.* وmcp.* وapproval.*. كلها إضافة قيم enum، فوثائق 1.0 إلى 1.3 تبقى صالحة.
  // 1.5 أضاف اثنتي عشرة لـPhase-05 (ADR-025): memory.* وbrowser.session.* وcomputer.*.
  // إضافة بحتة كذلك: وثائق 1.0 إلى 1.4 تبقى صالحة.
  // 1.6 أضاف ثمانيًا وعشرين لـPhase-06 (ADR-026): connector.* وusage.* وbudget.* وpricing.*
  // وobservability.* وdiagnostics.* وconfig.*. إضافة بحتة: وثائق 1.0 إلى 1.5 تبقى صالحة.
  // 1.7 أضاف اثنتين وثلاثين لـPhase-08 (ADR-028): workspace.* وattachment.* وartifact.* وexecution.*
  // وschedule.* وoauth.* وshare.* وpublish.* وskill.package.* وdevice.* وغيرها. إضافة بحتة:
  // وثائق 1.0 إلى 1.6 تبقى صالحة. Phase-07 لم يضف عمليات.
  IPCEnvelopeV1: { major: 1, minor: 7 },
  CapabilityDescriptorV1: { major: 1, minor: 0 },
  CapabilityInvocationV1: { major: 1, minor: 0 },
  // 1.1 أضاف رموز أسباب لـW3 (CONFIG_DEGRADED, EVALUATION_ERROR, RESOURCE_OUT_OF_SCOPE).
  // إضافة قيم enum تغيير إضافي: مستندات 1.0 تبقى صالحة تحت هذا البناء.
  PolicyDecisionV1: { major: 1, minor: 1 },
  // 1.1 أضاف مفردات أحداث W5 (دورة حياة المهمة، الموافقة، المنحة، إيقاف الطوارئ،
  // إثبات الإنجاز). إضافة قيم enum تغيير إضافي: مستندات 1.0 تبقى صالحة تحت هذا البناء.
  AuditEventV1: { major: 1, minor: 1 },
  ModelOutputContractV1: { major: 1, minor: 0 },
};

const VERSION_PATTERN = /^([1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
}

/** يحلل سلسلة الإصدار، ويعيد null إذا كانت الصيغة غير صالحة. */
export function parseContractVersion(raw: unknown): ParsedVersion | null {
  if (typeof raw !== "string") return null;
  const match = VERSION_PATTERN.exec(raw);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export type VersionGateResult =
  | { readonly ok: true; readonly version: ParsedVersion }
  | { readonly ok: false; readonly error: ContractError };

/**
 * قاعدة التوافق:
 * - MAJOR مختلف  → رفض. لا نحاول تفسير عقد من جيل آخر.
 * - MINOR أعلى   → رفض. الأعلى قد يحمل حقولًا إلزامية لا نعرفها، وقبولها يعني تجاهلها بصمت.
 * - MINOR أدنى   → قبول. التوافق الخلفي داخل نفس MAJOR مضمون بالإضافة فقط.
 */
export function checkContractVersion(contract: ContractName, rawVersion: unknown): VersionGateResult {
  const supported = SUPPORTED_VERSIONS[contract];
  const parsed = parseContractVersion(rawVersion);

  if (parsed === null) {
    return {
      ok: false,
      error: {
        code: ErrorCode.MALFORMED_MESSAGE,
        display_message: `Missing or malformed contract_version for ${contract}.`,
        internal_detail: `received=${JSON.stringify(rawVersion)} expected=MAJOR.MINOR`,
        pointer: "/contract_version",
        retryable: false,
      },
    };
  }

  if (parsed.major !== supported.major || parsed.minor > supported.minor) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNSUPPORTED_VERSION,
        display_message: `Unsupported ${contract} version ${parsed.major}.${parsed.minor}.`,
        internal_detail: `supported=${supported.major}.${supported.minor}`,
        pointer: "/contract_version",
        retryable: false,
      },
    };
  }

  return { ok: true, version: parsed };
}
