// مفردات عمليات Phase-08 (ADR-028)، بوصفها قيمًا.
//
// الحارس نفسه: اختبار تكافؤ يقارن هذه القائمة بـenum المخطط `Phase08DesktopOperation`
// وبـenum الظرف، وآخر يقارنها بسجل Phase-08.
//
// ما ليس في هذه القائمة، ولن يكون: `execution.command`، و`execution.python`، و`workspace.write`،
// و`browser.execute`، و`oauth.token.get`، و`email.send`. العارض يرفق الملفات ويقرأ المساحات
// والمخرجات والتشغيلات ويضبط الجداول والاتصالات والإعدادات ويقرّر ما ينتظر قراره؛ ولا يملك
// مسارًا يشغّل أمرًا أو Python أو يتصفّح أو يكتب في مساحة مهمّة. لذلك مستدعٍ واحد هو زمن تشغيل
// المهمّة الموثوق، ومسار واحد هو بوابة الأدوات.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ErrorCode, fail, type ContractError, type Result } from "../errors.js";
import { REGISTRY_ROOT } from "../registry.js";
import { findSecretsDeep } from "../secret-hygiene.js";
import { validateAgainstSchemaReference } from "../validator.js";
import type { ParsedVersion } from "../version.js";
import type { DesktopOperationRecord } from "./ipc-registry.js";

export const PHASE08_OPERATIONS = [
  "workspace.list",
  "workspace.preview",
  "workspace.export",
  "attachment.stage",
  "attachment.discard",
  "attachment.artifact.stage",
  "attachment.list",
  "attachment.bind",
  "artifact.list",
  "artifact.get",
  "execution.status",
  "execution.runs",
  "execution.runtime.prepare",
  "mission.model.set",
  "schedule.list",
  "schedule.save",
  "schedule.enable",
  "schedule.delete",
  "schedule.run_now",
  "oauth.list",
  "oauth.connect",
  "oauth.disconnect",
  "voice.transcribe",
  "share.list",
  "share.set",
  "publish.list",
  "publish.propose",
  "publish.decide",
  "skill.package.list",
  "skill.package.import",
  "device.export",
  "device.import",
  "integration.settings.set",
  "conversation.begin",
  "conversation.continue",
  "conversation.get",
  "conversation.index",
  "agent.catalog",
  "mission.specialist.set",
  "conversation.update",
  "conversation.delete",
  "project.delete",
  "memory.remember",
  "conversation.search",
  // خطة 2026-10-07 (ADR-041): عارض التتبّع لكل رسالة، وقبول تعريف أداة MCP أُعيد تعريفها.
  "mission.trace",
  "mcp.tool.accept_redefinition",
  // ADR-037: إدارة المزوّدين كما في OpenCode. مالكها طبقة المزوّدين في المضيف.
  "provider.catalog",
  "provider.credential.put",
  "provider.custom.save",
  "provider.custom.delete",
  // ADR-042 (الإغلاق الوظيفي 2026-10-19): بحث الويب بمزوّد يختاره المستخدم، وتقييم الدور، ورسالة أثناء التشغيل، والموافقة
  // لهذه المهمّة، وموصل GitHub للقراءة. لا عملية منها تنفّذ أداة: التنفيذ يبقى للوكيل عبر البوابة.
  "web.search.status",
  "web.search.credential.put",
  "web.search.test",
  "mission.rating.set",
  "mission.note.add",
  "tool.approval.grants",
  "tool.approval.grant.revoke",
  "github.status",
  "github.connect",
  "github.disconnect",
  // PHASE-12 (قرار المالك): إعداد الاسترجاع الدلالي للذاكرة.
  "memory.semantic.status",
  "memory.semantic.set",
  "memory.semantic.test",
] as const;

export type Phase08Operation = (typeof PHASE08_OPERATIONS)[number];

/** أول MINOR من الظرف يعرف عمليات Phase-08. */
export const PHASE08_OPERATIONS_INTRODUCED_IN: ParsedVersion = { major: 1, minor: 7 };

/** العمليات ذات الأثر الجانبي. تتطلب مفتاح Idempotency في الظرف. */
export const PHASE08_SIDE_EFFECTING: readonly Phase08Operation[] = [
  "workspace.export",
  "attachment.stage",
  "attachment.discard",
  "attachment.artifact.stage",
  "attachment.bind",
  "execution.runtime.prepare",
  "mission.model.set",
  "schedule.save",
  "schedule.enable",
  "schedule.delete",
  "schedule.run_now",
  "oauth.connect",
  "oauth.disconnect",
  "voice.transcribe",
  "share.set",
  "publish.propose",
  "publish.decide",
  "skill.package.import",
  "device.export",
  "device.import",
  "integration.settings.set",
  "conversation.begin",
  "conversation.continue",
  "mission.specialist.set",
  "conversation.update",
  "conversation.delete",
  "project.delete",
  "memory.remember",
  "mcp.tool.accept_redefinition",
  "provider.credential.put",
  "provider.custom.save",
  "provider.custom.delete",
  "web.search.credential.put",
  "web.search.test",
  "mission.rating.set",
  "mission.note.add",
  "tool.approval.grant.revoke",
  "github.connect",
  "github.disconnect",
  "memory.semantic.set",
  "memory.semantic.test",
];

/**
 * أسماء يحرسها العقد بالاسم: لو ظهر أحدها لصار للعارض مسار ينفّذ أمرًا أو Python أو يتصفّح أو
 * يكتب في مساحة مهمّة أو يقرأ رمز OAuth أو يرسل رسالة — وهو بالضبط الالتفاف الذي تمنعه هذه المرحلة.
 */
export const FORBIDDEN_PHASE08_OPERATIONS = [
  "execution.command",
  "execution.python",
  "execution.run",
  "workspace.write",
  "workspace.delete",
  "browser.execute",
  "browser.navigate",
  "oauth.token.get",
  "oauth.token",
  "email.send",
  "schedule.approve",
  "skill.package.trust",
] as const;

export function isPhase08Operation(value: unknown): value is Phase08Operation {
  return typeof value === "string" && (PHASE08_OPERATIONS as readonly string[]).includes(value);
}

export function isPhase08SideEffecting(operation: Phase08Operation): boolean {
  return PHASE08_SIDE_EFFECTING.includes(operation);
}

export const PHASE08_IPC_REGISTRY_FILE = join(REGISTRY_ROOT, "phase-08-ipc.registry.json");

export interface Phase08OperationRecord extends Omit<DesktopOperationRecord, "operation"> {
  readonly operation: Phase08Operation;
  readonly effect_class: string;
}

export interface Phase08IpcRegistry {
  readonly contract_version: string;
  readonly phase: "PHASE-08";
  readonly envelope_contract: string;
  readonly implementation_status: "SPECIFIED" | "IMPLEMENTED";
  readonly operations: readonly Phase08OperationRecord[];
}

let cached: Phase08IpcRegistry | null = null;

/** يقرأ سجل Phase-08 ويتحقق منه بمخطط السجل نفسه. */
export function loadPhase08IpcRegistry(): Phase08IpcRegistry {
  if (cached !== null) return cached;
  const raw = JSON.parse(readFileSync(PHASE08_IPC_REGISTRY_FILE, "utf8")) as unknown;
  const validated = validateAgainstSchemaReference<Phase08IpcRegistry>("desktop-ipc-registry.v1.schema.json", raw);
  if (!validated.ok) {
    throw new Error(
      `phase-08 IPC registry is invalid: ${validated.errors.map((e) => `${e.pointer ?? "/"} ${e.internal_detail ?? e.display_message}`).join("; ")}`,
    );
  }
  cached = validated.value;
  return cached;
}

export function phase08OperationRecord(operation: string): Phase08OperationRecord | undefined {
  return loadPhase08IpcRegistry().operations.find((record) => record.operation === operation);
}

function secretViolations(value: unknown, basePointer: string): ContractError[] {
  return findSecretsDeep(value, basePointer).map((finding) => ({
    code: ErrorCode.CONTRACT_VIOLATION,
    display_message: "Desktop payload must not carry credentials.",
    internal_detail: `${finding.reason}: ${finding.detail}`,
    pointer: finding.pointer,
    retryable: false,
  }));
}

function recordFor(operation: Phase08Operation): Phase08OperationRecord {
  const record = phase08OperationRecord(operation);
  if (record === undefined) throw new Error(`phase-08 operation ${operation} has no registry record`);
  return record;
}

/**
 * الحقل الوحيد في كل حمولات سطح المكتب المسموح له بحمل سرّ (ADR-037، قرار المالك 2026-10-06): المفتاح الذي يكتبه المستخدم
 * في نافذة «الاتصال بمزوّد» داخل التطبيق. الاستثناء بالعملية وبالمؤشّر معًا؛ أي حقل آخر في هذه الحمولة نفسها، وأي حمولة
 * أخرى، يبقى تحت الفحص كما كان.
 */
const CREDENTIAL_FIELD: Readonly<Partial<Record<Phase08Operation, string>>> = {
  "provider.credential.put": "/payload/api_key",
  // ADR-042: مفتاح مزوّد البحث ورمز GitHub يكتبهما المستخدم في الإعدادات، بالقاعدة نفسها: هذا المؤشّر وحده في هذه العملية وحدها.
  "web.search.credential.put": "/payload/api_key",
  "github.connect": "/payload/token",
};

/** يتحقق من حمولة طلب عملية Phase-08 مقابل المخطط الذي يسمّيه سجلها. */
export function validatePhase08RequestPayload<T = unknown>(operation: Phase08Operation, payload: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).request_schema, payload);
  if (!structural.ok) return structural;
  const allowed = CREDENTIAL_FIELD[operation];
  const secrets = secretViolations(payload, "/payload").filter((finding) => finding.pointer !== allowed);
  return secrets.length > 0 ? fail(secrets) : structural;
}

/** يتحقق من حمولة نتيجة عملية Phase-08. */
export function validatePhase08ResultPayload<T = unknown>(operation: Phase08Operation, result: unknown): Result<T> {
  const structural = validateAgainstSchemaReference<T>(recordFor(operation).response_schema, result);
  if (!structural.ok) return structural;
  const secrets = secretViolations(result, "/result");
  return secrets.length > 0 ? fail(secrets) : structural;
}
