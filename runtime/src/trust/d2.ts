// D2 — مطابقة الأصل المُتحقَّق منه.
//
// D2 لا يقبل قيمة لأنها معقولة، بل لأنها تطابق مرساة ثقة حقيقية.
// المراسي المسموح بها محدودة ومغلقة. وممنوع صراحةً:
//   - الذاكرة مرساةَ ثقة.
//   - قول النموذج "المستخدم اختار هذا" أصلًا.
// كلاهما يفشل بـ FORBIDDEN_ANCHOR، لا بتجاهل صامت.

import type { EffectAction } from "../effects.js";
import { newId, nowTimestamp, sha256 } from "../ids.js";
import { foldWindowsPath, parseWindowsPath } from "../platform/windows-path-rules.js";
import type { PathAuthority } from "../platform/path-authority.js";
import type {
  DeclassificationAttempt,
  DeclassificationPurpose,
  DeclassificationScope,
  DeclassifiedValueKind,
  D2FailureCode,
} from "./record.js";
import type { TaintLabel } from "./taint.js";

export const D2_VALIDATOR_ID = "polaris.declassifier.d2.verified-provenance-match";
export const D2_VALIDATOR_VERSION = "1.0.0";

/** المراسي المسموح بها. توسيع هذه القائمة قرار معماري، لا تفصيل تنفيذ. */
export const ALLOWED_ANCHOR_KINDS = [
  "DIRECT_USER_VALUE",
  "USER_AUTHORIZED_FS_ROOT",
  "POLARIS_SYSTEM_STATE",
] as const;

export type AllowedAnchorKind = (typeof ALLOWED_ANCHOR_KINDS)[number];

/**
 * مراسٍ ممنوعة صراحة. تُذكر بالاسم حتى يكون المنع قابلًا للاختبار،
 * ولا يعتمد على غياب حالة من switch.
 */
export const FORBIDDEN_ANCHOR_KINDS = [
  "MEMORY",
  "MODEL_ASSERTION",
  "AGENT_CLAIM",
  "TOOL_OUTPUT",
  "REMOTE_CONTENT",
] as const;

export interface TrustAnchor {
  readonly anchor_id: string;
  /**
   * النوع نصّ عمدًا: المرساة الممنوعة يجب أن تكون قابلة للتمثيل حتى يمكن
   * إثبات رفضها في اختبار، بدل أن يمنعها النوع فتصير الحماية غير مُختبَرة.
   */
  readonly kind: string;
  readonly value_kind: DeclassifiedValueKind;
  /** القيم التي تثبتها المرساة. جذر واحد لنطاق الملفات، أو قائمة مغلقة لحالة النظام. */
  readonly values: readonly string[];
  readonly established_by: "USER_ACTION" | "SYSTEM_STATE";
  readonly established_at: string;
  /**
   * الأغراض التي يجوز أن تخدمها هذه المرساة. غيابها يعني "أي غرض من نوع القيمة".
   * وجودها يجعل ربط الغرض ماديًا: مرساة جذر قراءة لا تثبت شيئًا لأثر كتابة.
   */
  readonly purpose_actions?: readonly EffectAction[];
}

export interface D2Input {
  readonly correlation_id: string;
  readonly mission_id: string;
  /** القيمة المرشّحة، عادةً مقترحة من النموذج ومن ثم ملوّثة. */
  readonly candidate: string;
  readonly anchors: readonly TrustAnchor[];
  readonly purpose: DeclassificationPurpose;
  readonly scope: DeclassificationScope;
  readonly input_taint: readonly TaintLabel[];
  readonly input_provenance: readonly string[];
  /** مطلوبة لمرساة نطاق الملفات: التطبيع الحقيقي ملك المنصة لا ملك هذه الطبقة. */
  readonly path_authority?: PathAuthority;
}

function reject(code: D2FailureCode, detail: string): DeclassificationAttempt {
  return { ok: false, failure: { method: "D2", code, detail } };
}

export function isForbiddenAnchorKind(kind: string): boolean {
  return (FORBIDDEN_ANCHOR_KINDS as readonly string[]).includes(kind);
}

export function isAllowedAnchorKind(kind: string): kind is AllowedAnchorKind {
  return (ALLOWED_ANCHOR_KINDS as readonly string[]).includes(kind);
}

interface Match {
  readonly value: string;
  readonly anchor: TrustAnchor;
  readonly checks: readonly string[];
}

function matchDirectUserValue(input: D2Input, anchor: TrustAnchor): Match | D2FailureCode {
  if (anchor.value_kind === "FILESYSTEM_PATH") {
    const candidate = parseWindowsPath(input.candidate);
    if (!candidate.ok) return candidate.rejection === "TRAVERSAL_SEGMENT" ? "TRAVERSAL_REJECTED" : "CANONICALIZATION_FAILED";
    for (const value of anchor.values) {
      const anchored = parseWindowsPath(value);
      if (!anchored.ok) continue;
      if (foldWindowsPath(anchored.parts.normalised) === foldWindowsPath(candidate.parts.normalised)) {
        return {
          value: candidate.parts.normalised,
          anchor,
          checks: ["candidate equals a canonical value the user supplied directly"],
        };
      }
    }
    return "ANCHOR_MISMATCH";
  }
  return anchor.values.includes(input.candidate)
    ? { value: input.candidate, anchor, checks: ["candidate equals a value the user supplied directly"] }
    : "ANCHOR_MISMATCH";
}

function matchAuthorizedRoot(input: D2Input, anchor: TrustAnchor): Match | D2FailureCode {
  const authority = input.path_authority;
  if (authority === undefined) return "CANONICALIZATION_FAILED";

  let lastFailure: D2FailureCode = "ANCHOR_MISMATCH";
  for (const root of anchor.values) {
    const contained = authority.containedIn(root, input.candidate, { mustExist: false });
    if (contained.ok) {
      return {
        value: contained.value.logical,
        anchor,
        checks: [
          `candidate canonicalised to ${contained.value.logical}`,
          `canonical target resolves inside the user-authorised root ${root}`,
          "no traversal segment survived canonicalisation",
          authority.nativeWindowsSemantics
            ? "canonicalisation performed with native Windows semantics"
            : "canonicalisation performed on a non-Windows host: Windows link semantics are NOT proven here",
        ],
      };
    }
    switch (contained.failure.rejection) {
      case "TRAVERSAL_SEGMENT":
        lastFailure = "TRAVERSAL_REJECTED";
        break;
      case "ESCAPES_ROOT":
        lastFailure = "OUT_OF_ANCHOR_SCOPE";
        break;
      case "SYMLINK_ESCAPE":
        lastFailure = "SYMLINK_ESCAPE";
        break;
      default:
        lastFailure = "CANONICALIZATION_FAILED";
        break;
    }
  }
  return lastFailure;
}

function matchSystemState(input: D2Input, anchor: TrustAnchor): Match | D2FailureCode {
  return anchor.values.includes(input.candidate)
    ? { value: input.candidate, anchor, checks: ["candidate equals a value held in POLARIS-owned state"] }
    : "ANCHOR_MISMATCH";
}

/**
 * يثبت أن المرشّح يطابق مرساة حقيقية. المرساة الممنوعة تُفشل المحاولة كلها فورًا:
 * وجودها في الطلب أصلًا مؤشر خطر، لا خيارًا يُتجاوَز إلى مرساة أخرى.
 */
export function runD2(input: D2Input): DeclassificationAttempt {
  if (input.anchors.length === 0) return reject("NO_ANCHOR", "no trust anchor was presented");

  for (const anchor of input.anchors) {
    if (isForbiddenAnchorKind(anchor.kind)) {
      return reject("FORBIDDEN_ANCHOR", `anchor kind ${anchor.kind} can never establish provenance`);
    }
    if (!isAllowedAnchorKind(anchor.kind)) {
      return reject("FORBIDDEN_ANCHOR", `anchor kind ${anchor.kind} is not an allowed anchor`);
    }
  }

  let lastFailure: D2FailureCode = "ANCHOR_MISMATCH";
  for (const anchor of input.anchors) {
    if (anchor.value_kind !== input.purpose.value_kind) continue;
    if (anchor.purpose_actions !== undefined && !anchor.purpose_actions.includes(input.purpose.action)) continue;
    const result =
      anchor.kind === "DIRECT_USER_VALUE"
        ? matchDirectUserValue(input, anchor)
        : anchor.kind === "USER_AUTHORIZED_FS_ROOT"
          ? matchAuthorizedRoot(input, anchor)
          : matchSystemState(input, anchor);

    if (typeof result === "string") {
      lastFailure = result;
      continue;
    }

    return {
      ok: true,
      record: {
        record_id: newId(),
        method: "D2",
        correlation_id: input.correlation_id,
        mission_id: input.mission_id,
        input_provenance: input.input_provenance,
        input_taint: input.input_taint,
        output_value: result.value,
        purpose: input.purpose,
        scope: input.scope,
        validator_id: D2_VALIDATOR_ID,
        validator_version: D2_VALIDATOR_VERSION,
        evidence: {
          checks: [...result.checks, `anchor kind ${result.anchor.kind} established by ${result.anchor.established_by}`],
          input_sha256: sha256(input.candidate),
          anchor_id: result.anchor.anchor_id,
        },
        issued_at: nowTimestamp(),
      },
    };
  }

  return reject(lastFailure, `no allowed anchor established provenance for the candidate value`);
}
