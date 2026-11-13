// بناء سياق Cedar من عقود W2، والإعدادات الفعّالة، ودفتر رفع التصنيف.
// كل سمة تُملأ من مصدر حقيقي؛ لا تُختلق قيمة لملء حقل.

import { isEffectAction, type EffectAction } from "../effects.js";
import { parseWindowsPath } from "../platform/windows-path-rules.js";
import type { DeclassificationReader } from "../trust/ledger.js";
import { carriesUntrustedTaint, readTaint } from "../trust/taint.js";
import type { EffectiveConfig } from "../config/types.js";
import type { Doc } from "./types.js";

export interface CedarContext {
  readonly caller_type: string;
  readonly trust_tier: string;
  readonly effect_declared_by_descriptor: boolean;
  readonly path_in_allowed_root: boolean;
  readonly path_in_allowed_write_root: boolean;
  readonly write_enabled: boolean;
  readonly confined: boolean;
  readonly config_healthy: boolean;
  readonly brokered_egress_enabled: boolean;
  readonly destination_authorized: boolean;
  readonly invocation_requests_brokered_egress: boolean;
  /** وسيطة الفعل مشتقة من مصدر غير موثوق (نموذج، ملف، ويب، بريد). */
  readonly parameter_tainted: boolean;
  /** يوجد سجل رفع تصنيف صالح لهذه القيمة بعينها ولهذا الأثر بعينه. */
  readonly parameter_declassified_for_effect: boolean;
}

function asRecord(value: unknown): Doc | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * احتواء المسار داخل جذر مسموح — على المستوى المنطقي فقط.
 * التطبيع محافظ عمدًا: توحيد الفواصل ورفع حالة الأحرف (مسارات ويندوز غير حسّاسة للحالة)،
 * ثم اشتراط أن يكون الجذر متبوعًا بفاصل أو نهاية، حتى لا يمرّ "D:\POLARIS-EVIL" كأنه داخل "D:\POLARIS".
 * أي مسار يحتوي ".." يُرفض بدل محاولة حلّه: حلّ المسارات وظيفة محوّل المنصة، لا وظيفة السياسة.
 */
export function isPathInAllowedRoot(locator: string, roots: readonly string[]): boolean {
  if (locator.includes("..")) return false;
  const normalise = (p: string): string => p.replace(/\//g, "\\").replace(/\\+$/, "").toUpperCase();
  const path = normalise(locator);
  return roots.some((root) => {
    const base = normalise(root);
    if (base.length === 0) return false;
    return path === base || path.startsWith(`${base}\\`);
  });
}

/** يحوّل وجهة شبكية من العقد إلى الصيغة المستخدمة في قائمة السماح: host:port. */
export function destinationKey(destination: Doc | undefined): string | undefined {
  if (destination === undefined) return undefined;
  const host = destination["host"];
  const port = destination["port"];
  if (typeof host !== "string" || typeof port !== "number") return undefined;
  return `${host}:${String(port)}`;
}

/** يقارن أثر الاستدعاء بما أعلنه الواصف: الفعل والوجهة معًا، كما في INV-002. */
function isDeclared(effect: Doc, descriptor: Doc): boolean {
  const key = (e: Doc): string => JSON.stringify([e["action"] ?? null, destinationKey(asRecord(e["destination"])) ?? null]);
  return asList(descriptor["requested_effects"])
    .map(asRecord)
    .filter((e): e is Doc => e !== undefined)
    .some((declared) => key(declared) === key(effect));
}

/**
 * القيمة التي يجري رفع تصنيفها فعلًا: مسار المورد لأثر نظام الملفات،
 * أو مفتاح الوجهة لأثر شبكي. هي نفسها القيمة التي يبحث عنها الدفتر.
 */
export function declassifiableValue(effect: Doc, invocation: Doc): string | undefined {
  const destination = destinationKey(asRecord(effect["destination"]));
  if (destination !== undefined) return destination;
  const resource = asRecord(effect["resource"]) ?? asRecord(invocation["resource"]);
  const locator = resource?.["locator"];
  return typeof locator === "string" ? locator : undefined;
}

/**
 * البحث في الدفتر يجري على القيمة كما وردت وعلى شكلها القانوني معًا.
 * لا يوسّع هذا البحثَ: كلا الشكلين يشير إلى نفس القيمة، والغرض يبقى مقيدًا بالفعل.
 */
function hasDeclassification(
  reader: DeclassificationReader | undefined,
  correlationId: unknown,
  action: EffectAction,
  value: string | undefined,
): boolean {
  if (reader === undefined || value === undefined || typeof correlationId !== "string") return false;
  const candidates = new Set<string>([value]);
  const parsed = parseWindowsPath(value);
  if (parsed.ok) candidates.add(parsed.parts.normalised);
  for (const candidate of candidates) {
    if (reader.find({ correlation_id: correlationId, action, value: candidate }) !== undefined) return true;
  }
  return false;
}

export function buildContext(
  effect: Doc,
  invocation: Doc,
  descriptor: Doc,
  config: EffectiveConfig,
  declassification?: DeclassificationReader,
): CedarContext {
  const caller = asRecord(invocation["caller_identity"]);
  const constraints = asRecord(invocation["execution_constraints"]);
  const resource = asRecord(effect["resource"]) ?? asRecord(invocation["resource"]);
  const locator = typeof resource?.["locator"] === "string" ? (resource["locator"] as string) : "";
  const rawAction = effect["action"];
  const action: EffectAction | undefined = isEffectAction(rawAction) ? rawAction : undefined;

  const readRoots = (config.settings["polaris.filesystem.allowed_read_roots"]?.value ?? []) as readonly string[];
  const writeRoots = (config.settings["polaris.filesystem.allowed_write_roots"]?.value ?? []) as readonly string[];
  const writeEnabled = config.settings["polaris.filesystem.allow_write"]?.value === true;
  const egressEnabled = config.settings["polaris.network.brokered_egress.enabled"]?.value === true;
  const allowedDestinations = (config.settings["polaris.network.brokered_egress.allowed_destinations"]?.value ??
    []) as readonly string[];

  const destination = destinationKey(asRecord(effect["destination"]));
  const invocationDestinations = new Set(
    asList(constraints?.["allowed_destinations"])
      .map(asRecord)
      .map((d) => destinationKey(d))
      .filter((d): d is string => d !== undefined),
  );

  // التلوث يُقرأ من وسوم الاستدعاء نفسه. الوسيطة المشتقة من النموذج تصل هنا
  // وهي تحمل MODEL_GENERATED دائمًا، فالسؤال ليس "هل هي معقولة" بل "هل رُفع تصنيفها".
  const taint = readTaint(invocation["taint_labels"]);
  const tainted = carriesUntrustedTaint(taint);
  const declassified =
    action !== undefined &&
    hasDeclassification(declassification, invocation["correlation_id"], action, declassifiableValue(effect, invocation));

  return {
    caller_type: typeof caller?.["caller_type"] === "string" ? (caller["caller_type"] as string) : "UNKNOWN",
    trust_tier: typeof caller?.["trust_tier"] === "string" ? (caller["trust_tier"] as string) : "UNKNOWN",
    effect_declared_by_descriptor: isDeclared(effect, descriptor),
    path_in_allowed_root: locator.length > 0 && isPathInAllowedRoot(locator, readRoots),
    path_in_allowed_write_root: locator.length > 0 && isPathInAllowedRoot(locator, writeRoots),
    write_enabled: writeEnabled,
    confined: constraints?.["confinement"] === "CONFINED",
    config_healthy: config.integrity === "HEALTHY",
    brokered_egress_enabled: egressEnabled,
    // الوجهة مصرّح بها فقط إذا كانت في إعدادات النظام وفي قيود الاستدعاء معًا.
    destination_authorized:
      destination !== undefined && allowedDestinations.includes(destination) && invocationDestinations.has(destination),
    invocation_requests_brokered_egress: constraints?.["network"] === "BROKERED_EGRESS",
    parameter_tainted: tainted,
    parameter_declassified_for_effect: declassified,
  };
}

