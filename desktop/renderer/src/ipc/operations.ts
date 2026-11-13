// مفردات العمليات في جانب العارض، مقروءة من السجل لا مكتوبة مرة ثانية.
//
// لو كُتبت القائمة هنا بيد لصار في المستودع مصدران يمكن أن ينجرفا. السجل هو
// المصدر، والاختبار يثبت أن ما يعرفه العارض هو بالضبط ما يوجّهه المضيف.

import {
  ERROR_MAPPING,
  IPC_REGISTRY,
  PHASE02_IPC_REGISTRY,
  PHASE03_IPC_REGISTRY,
  PHASE04_IPC_REGISTRY,
  PHASE05_IPC_REGISTRY,
  PHASE06_IPC_REGISTRY,
  PHASE08_IPC_REGISTRY,
} from "../generated/contract-bundle";

export type DesktopOperation =
  | "desktop.bootstrap"
  | "desktop.runtime.status"
  | "desktop.capability.availability"
  | "desktop.settings.describe"
  | "desktop.settings.read";

/** عمليات Phase-02 التسع عشرة (ADR-019). المجموعة مغلقة كما في السجل. */
export type Phase02Operation =
  | "provider.list"
  | "provider.configure"
  | "provider.credential.set"
  | "provider.credential.clear"
  | "provider.refresh"
  | "model.list"
  | "model.configure"
  | "model.preferences.set"
  | "model.invoke"
  | "model.cancel"
  | "project.list"
  | "project.get"
  | "project.create"
  | "project.update"
  | "project.archive"
  | "context.add"
  | "context.remove"
  | "context.preview"
  | "context.assemble";

/** عمليات Phase-03 العشر (ADR-021). المجموعة مغلقة كما في السجل. */
export type Phase03Operation =
  | "mission.list"
  | "mission.get"
  | "mission.create"
  | "mission.start"
  | "mission.cancel"
  | "mission.resume"
  | "task.list"
  | "agent.list"
  | "claim.list"
  | "evidence.list";

/**
 * عمليات Phase-04 الاثنتا عشرة (ADR-023). المجموعة مغلقة كما في السجل.
 *
 * ولا يوجد فيها اسم ينفّذ أداة: لا `tool.execute` ولا `mcp.call`. العارض يقرأ
 * السجل ويجيب موافقة، ولا يملك مسارًا إلى التنفيذ.
 */
export type Phase04Operation =
  | "skill.list"
  | "skill.get"
  | "skill.configure"
  | "tool.list"
  | "tool.get"
  | "tool.activity.list"
  | "mcp.list"
  | "mcp.register"
  | "mcp.configure"
  | "mcp.refresh"
  | "approval.list"
  | "tool.approval.respond";

/**
 * عمليات Phase-05 الاثنتا عشرة (ADR-025). المجموعة مغلقة كما في السجل.
 *
 * ولا يوجد فيها اسم يتنقّل أو ينقر أو يكتب أو يرفع ثقة ذاكرة: العارض يقرأ الجلسات
 * والذاكرة، ويحذف ذاكرة، ويمنح نافذة لمهمّة، ويوقف جلسة.
 */
export type Phase05Operation =
  | "memory.list"
  | "memory.get"
  | "memory.delete"
  | "browser.session.list"
  | "browser.session.get"
  | "browser.session.cancel"
  | "computer.session.list"
  | "computer.session.get"
  | "computer.session.cancel"
  | "computer.window.list"
  | "computer.target.grant"
  | "computer.target.revoke";

/**
 * عمليات Phase-06 الثلاثون (ADR-026، والإعدادات الجاهزة PHASE-05 2026-10-20). المجموعة مغلقة كما في السجل.
 *
 * ولا يوجد فيها اسم ينفّذ عملية موصل على خدمة، ولا اسم يكشف قيمة سرّ: العارض يسجّل
 * الموصلات ويضبطها ويفحصها، ويقرأ الاستعمال والرصد، ويكتب الإعدادات المُصنَّفة.
 */
export type Phase06Operation =
  | "connector.list"
  | "connector.get"
  | "connector.register"
  | "connector.configure"
  | "connector.remove"
  | "connector.test"
  | "connector.credential.set"
  | "connector.credential.clear"
  | "connector.openapi.import"
  | "connector.openapi.approve"
  | "connector.preset.list"
  | "connector.preset.register"
  | "usage.summary"
  | "usage.list"
  | "budget.list"
  | "budget.set"
  | "budget.remove"
  | "pricing.list"
  | "pricing.set"
  | "pricing.remove"
  | "observability.health"
  | "observability.events"
  | "observability.metrics"
  | "observability.errors"
  | "observability.alerts"
  | "diagnostics.export"
  | "config.describe"
  | "config.effective"
  | "config.set"
  | "config.reset";

/**
 * عمليات Phase-08 الاثنتان والثلاثون (ADR-028). المجموعة مغلقة كما في السجل.
 *
 * ولا يوجد فيها اسم يشغّل أمرًا أو Python أو يتصفّح أو يكتب في مساحة مهمّة أو يقرأ رمزًا:
 * العارض يرفق ويقرأ ويضبط ويقرّر، والتنفيذ للوكيل عبر بوابة الأدوات وحدها.
 */
export type Phase08Operation =
  | "workspace.list"
  | "workspace.preview"
  | "workspace.export"
  | "attachment.stage"
  | "attachment.discard"
  | "attachment.artifact.stage"
  | "attachment.list"
  | "attachment.bind"
  | "artifact.list"
  | "artifact.get"
  | "execution.status"
  | "execution.runs"
  | "execution.runtime.prepare"
  | "mission.model.set"
  | "schedule.list"
  | "schedule.save"
  | "schedule.enable"
  | "schedule.delete"
  | "schedule.run_now"
  | "oauth.list"
  | "oauth.connect"
  | "oauth.disconnect"
  | "voice.transcribe"
  | "share.list"
  | "share.set"
  | "publish.list"
  | "publish.propose"
  | "publish.decide"
  | "skill.package.list"
  | "skill.package.import"
  | "device.export"
  | "device.import"
  | "integration.settings.set"
  | "conversation.begin"
  | "conversation.continue"
  | "conversation.get"
  | "conversation.index"
  | "agent.catalog"
  | "mission.specialist.set"
  | "conversation.update"
  | "conversation.delete"
  | "project.delete"
  | "memory.remember"
  | "conversation.search"
  // R-11 (2026-10-12): عمليتان سجّلهما المضيف والعقد ولم يكن للعارض طريق إليهما.
  | "mission.trace"
  | "mcp.tool.accept_redefinition"
  | ProviderCatalogOperation
  | ClosureOperation;

/**
 * عمليات الإغلاق الوظيفي (ADR-042، 2026-10-19): بحث الويب بمزوّد يختاره المستخدم، وتقييم الدور، ورسالة أثناء التشغيل، ومنح «اسمح
 * لهذه المهمّة»، وموصل GitHub للقراءة. لا عملية منها تنفّذ أداة.
 */
export type ClosureOperation =
  | "web.search.status"
  | "web.search.credential.put"
  | "web.search.test"
  | "mission.rating.set"
  | "mission.note.add"
  | "tool.approval.grants"
  | "tool.approval.grant.revoke"
  | "github.status"
  | "github.connect"
  | "github.disconnect"
  // PHASE-12 (قرار المالك): إعداد الاسترجاع الدلالي للذاكرة. لا عملية تقرأ ذاكرة ولا ترسلها.
  | "memory.semantic.status"
  | "memory.semantic.set"
  | "memory.semantic.test";

/**
 * عمليات المزوّدين التي أُضيفت في الظرف 1.7 (ADR-037): الفهرس، والمفتاح داخل التطبيق، والمزوّد المخصّص. مسجّلة في سجلّ
 * Phase-08 ومالكها طبقة المزوّدين، فيناديها عميل Phase-02.
 */
export type ProviderCatalogOperation = "provider.catalog" | "provider.credential.put" | "provider.custom.save" | "provider.custom.delete";

/** كل عملية يستطيع العارض أن يسمّيها. لا اسم حرّ. */
export type AnyOperation = DesktopOperation | Phase02Operation | Phase03Operation | Phase04Operation | Phase05Operation | Phase06Operation | Phase08Operation;

export interface OperationRecord {
  readonly operation: string;
  readonly request_schema: string;
  readonly response_schema: string;
  readonly owner: string;
  readonly effect: string;
  readonly routing_status: string;
  readonly error_categories: readonly string[];
  readonly envelope_version: string;
  readonly idempotency: string;
}

/** العمليات الموجَّهة بترتيب السجل. */
export const ROUTED_OPERATIONS: readonly OperationRecord[] = IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

/** عمليات Phase-02 الموجَّهة بترتيب سجلها. */
export const PHASE02_OPERATIONS: readonly OperationRecord[] = PHASE02_IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

/** عمليات Phase-03 الموجَّهة بترتيب سجلها. */
export const PHASE03_OPERATIONS: readonly OperationRecord[] = PHASE03_IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

/** عمليات Phase-04 الموجَّهة بترتيب سجلها. */
export const PHASE04_OPERATIONS: readonly OperationRecord[] = PHASE04_IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

/** عمليات Phase-05 الموجَّهة بترتيب سجلها. */
export const PHASE05_OPERATIONS: readonly OperationRecord[] = PHASE05_IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

/** عمليات Phase-06 الموجَّهة بترتيب سجلها. */
export const PHASE06_OPERATIONS: readonly OperationRecord[] = PHASE06_IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

/** عمليات Phase-08 الموجَّهة بترتيب سجلها. */
export const PHASE08_OPERATIONS: readonly OperationRecord[] = PHASE08_IPC_REGISTRY.operations.filter(
  (record) => record.routing_status === "ROUTED",
);

export function operationRecord(operation: string): OperationRecord | undefined {
  return (
    ROUTED_OPERATIONS.find((record) => record.operation === operation) ??
    PHASE02_OPERATIONS.find((record) => record.operation === operation) ??
    PHASE03_OPERATIONS.find((record) => record.operation === operation) ??
    PHASE04_OPERATIONS.find((record) => record.operation === operation) ??
    PHASE05_OPERATIONS.find((record) => record.operation === operation) ??
    PHASE06_OPERATIONS.find((record) => record.operation === operation) ??
    PHASE08_OPERATIONS.find((record) => record.operation === operation)
  );
}

/** إصدار الظرف الذي يعلنه السجل لعمليات سطح المكتب. */
export const ENVELOPE_VERSION: string = IPC_REGISTRY.operations[0]?.envelope_version ?? "1.1";

/** إصدار عقد النواة الذي يسافر على الظرف. */
export const CONTRACT_VERSION = ENVELOPE_VERSION;

export interface ErrorCategoryRecord {
  readonly category: string;
  readonly retryable: boolean;
  readonly detail_may_cross_boundary: boolean;
  readonly display_key: string;
}

export const ERROR_CATEGORIES: readonly ErrorCategoryRecord[] = ERROR_MAPPING.entries;

export function errorCategory(category: string): ErrorCategoryRecord | undefined {
  return ERROR_CATEGORIES.find((entry) => entry.category === category);
}

/** مفتاح العرض لتصنيف خطأ، أو مفتاح الخطأ الداخلي إن كان التصنيف غير معروف. */
export function displayKeyForCategory(category: string): string {
  return errorCategory(category)?.display_key ?? "desktop.error.internal_error";
}
