// العميل المُصنَّف لـPhase-02: تسع عشرة دالة، واحدة لكل عملية في السجل.
//
// نفس قاعدة عميل Phase-01: لا دالة عامة تقبل اسم عملية. كل دالة تحدد اسمها،
// وشكل حمولتها، ومهلتها. المفتاح نفسه لا يمرّ من هنا أبدًا: `setProviderKey`
// تطلب من المضيف أن يفتح نافذة النظام، والنتيجة حالة لا قيمة.

import type {
  ContextAssembleResultV1,
  ContextPreviewResultV1,
  ContextSourceResultV1,
  ModelCancelResultV1,
  ModelConfigureResultV1,
  ModelInvokeResultV1,
  ModelListResultV1,
  ModelPreferencesSetResultV1,
  ProjectGetResultV1,
  ProjectListResultV1,
  ProjectMutationResultV1,
  ProviderConfigureResultV1,
  ProviderCredentialResultV1,
  ProviderListResultV1,
  ProviderRefreshResultV1,
} from "../generated/types/desktop-p02-result-v1";
import type {
  AddableSourceType,
  Language,
  ModelCapability,
  RoutingMode,
} from "../generated/types/desktop-p02-request-v1";
import { callOperation, type CallContext, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { ProviderCatalogResultV1, ProviderCustomDeleteResultV1 } from "../generated/types/desktop-p08-result-v1";
import type { Phase02Operation, ProviderCatalogOperation } from "./operations";
import type { Transport } from "./transport";

/** مهلة القراءة العادية. */
const READ_TIMEOUT_MS = 8_000;
/** قراءة ملف أو مجلد في المضيف قد تطول قليلًا. */
const CONTEXT_TIMEOUT_MS = 20_000;
/** نافذة إدخال المفتاح تنتظر المستخدم. */
const PROMPT_TIMEOUT_MS = 300_000;
/** ميزانية الاكتشاف لكل مزوّد في المضيف أقل من هذا، والهامش للتسلسل. */
const REFRESH_PER_PROVIDER_MS = 20_000;
/** مهلة الاستدعاء الافتراضية في المضيف، وهامش النقل فوقها. */
const HOST_INVOKE_DEFAULT_MS = 120_000;
const INVOKE_MARGIN_MS = 15_000;

export interface Phase02ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

export interface InvokeRequest {
  readonly invocation_id: string;
  readonly routing_mode: RoutingMode;
  readonly model_id?: string;
  readonly required_capabilities?: readonly ModelCapability[];
  readonly project_id?: string;
  readonly context_source_ids?: readonly string[];
  readonly messages: readonly { readonly role: "USER" | "ASSISTANT"; readonly text: string }[];
  readonly system_instruction?: string;
  readonly temperature?: number;
  readonly max_output_tokens?: number;
  readonly response_format?: "TEXT" | "JSON";
  readonly timeout_ms?: number;
}

export interface ProjectCreateInput {
  readonly name: string;
  readonly description?: string;
  readonly language?: Language;
  readonly workspace_root?: string;
}

export interface ProjectUpdateInput {
  readonly project_id: string;
  readonly expected_version: number;
  readonly name?: string;
  readonly description?: string;
  readonly language?: Language;
  readonly workspace_root?: string | null;
  readonly default_model_id?: string | null;
}

export interface ContextAddInput {
  readonly project_id: string;
  readonly source_type: AddableSourceType;
  readonly reference?: string;
  readonly text?: string;
  readonly display_name?: string;
}

export interface ContextAssembleInput {
  readonly project_id: string;
  readonly source_ids: readonly string[];
  readonly instruction: string;
  readonly model_id?: string;
  readonly max_tokens?: number;
  readonly max_files?: number;
}

/** يحذف المفاتيح غير المعرّفة: الحمولة مغلقة، و`undefined` ليس قيمة JSON. */
function defined(input: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

/**
 * إشعار داخل الوحدة بعد كل تغيير ناجح في المزوّدين أو النماذج: ما بقي مركّبًا من شاشات (محدّد النموذج تحت نافذة
 * الإعدادات مثلًا) يعيد القراءة من المضيف. لا نسخة محلية: الإشعار يطلب قراءة، ولا يحمل قيمة.
 */
const modelListeners = new Set<() => void>();

export function onModelsChanged(listener: () => void): () => void {
  modelListeners.add(listener);
  return () => {
    modelListeners.delete(listener);
  };
}

function notifyModelsChanged<T>(result: CallResult<T>): CallResult<T> {
  if (result.ok) for (const listener of [...modelListeners]) listener();
  return result;
}

export class Phase02Client {
  private readonly context: CallContext;

  constructor(options: Phase02ClientOptions) {
    this.context = {
      transport: options.transport,
      identity: options.identity,
      newId: options.newId,
      clock: options.clock,
    };
  }

  // ── المزوّدون ─────────────────────────────────────────────────────────────

  listProviders(): Promise<CallResult<ProviderListResultV1>> {
    return this.call("provider.list", {}, READ_TIMEOUT_MS);
  }

  configureProvider(input: { readonly provider_id: string; readonly enabled?: boolean; readonly endpoint?: string }): Promise<CallResult<ProviderConfigureResultV1>> {
    return this.call<ProviderConfigureResultV1>("provider.configure", defined(input), READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  setProviderKey(providerId: string): Promise<CallResult<ProviderCredentialResultV1>> {
    return this.call<ProviderCredentialResultV1>("provider.credential.set", { provider_id: providerId }, PROMPT_TIMEOUT_MS).then(notifyModelsChanged);
  }

  /** فهرس المزوّدين كاملًا لنافذة «الاتصال بمزوّد» (ADR-037). لا حالة مفتاح ولا قيمة. */
  providerCatalog(): Promise<CallResult<ProviderCatalogResultV1>> {
    return this.call("provider.catalog", {}, READ_TIMEOUT_MS);
  }

  /**
   * المفتاح الذي كتبه المستخدم في نافذة الاتصال (ADR-037، قرار المالك 2026-10-06). الحقل الوحيد في العارض الذي يحمل
   * سرًّا، ولعملية واحدة: يُرسل مرة، ويُخزَّن في مخزن بيانات الاعتماد في النظام، ولا يعود في أي ردّ.
   */
  putProviderKey(providerId: string, apiKey: string): Promise<CallResult<ProviderCredentialResultV1>> {
    return this.call<ProviderCredentialResultV1>("provider.credential.put", { provider_id: providerId, api_key: apiKey }, READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  /** ينشئ مزوّدًا مخصّصًا متوافقًا مع OpenAI أو يعدّله. المفتاح لا يسافر هنا. */
  saveCustomProvider(input: {
    readonly provider_id: string;
    readonly display_name: string;
    readonly base_url: string;
    readonly models: readonly { readonly model_id: string; readonly display_name?: string }[];
  }): Promise<CallResult<ProviderConfigureResultV1>> {
    return this.call<ProviderConfigureResultV1>("provider.custom.save", { ...input, models: [...input.models] }, READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  deleteCustomProvider(providerId: string): Promise<CallResult<ProviderCustomDeleteResultV1>> {
    return this.call<ProviderCustomDeleteResultV1>("provider.custom.delete", { provider_id: providerId }, READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  clearProviderKey(providerId: string): Promise<CallResult<ProviderCredentialResultV1>> {
    return this.call<ProviderCredentialResultV1>("provider.credential.clear", { provider_id: providerId }, READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  refreshProviders(providerIds: readonly string[]): Promise<CallResult<ProviderRefreshResultV1>> {
    const timeout = REFRESH_PER_PROVIDER_MS * Math.max(1, providerIds.length) + 5_000;
    return this.call<ProviderRefreshResultV1>("provider.refresh", { provider_ids: [...providerIds] }, timeout).then(notifyModelsChanged);
  }

  // ── النماذج ───────────────────────────────────────────────────────────────

  listModels(input: { readonly provider_id?: string; readonly only_selectable?: boolean } = {}): Promise<CallResult<ModelListResultV1>> {
    return this.call("model.list", defined(input), READ_TIMEOUT_MS);
  }

  configureModel(modelId: string, enabled: boolean): Promise<CallResult<ModelConfigureResultV1>> {
    return this.call<ModelConfigureResultV1>("model.configure", { model_id: modelId, enabled }, READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  setModelPreferences(input: {
    readonly default_model_id?: string | null;
    /** المراجِع (ADR-040): نموذج يختاره المستخدم صراحةً من أيّ صنف. `null` = لا مراجعة مستقلّة. */
    readonly review_model_id?: string | null;
    /** مراقب الأفعال (ADR-041؛ R-11): نموذج يختاره المستخدم صراحةً. `null` = بلا مراقب، فتنتظر أفعال الحدود موافقة بشرية. */
    readonly monitor_model_id?: string | null;
    /** جهد الاستدلال لكل المزوّدين والنماذج (2026-11-12). `null` = افتراضي كل مزوّد. */
    readonly reasoning_effort?: "LOW" | "MEDIUM" | "HIGH" | "MAX" | null;
  }): Promise<CallResult<ModelPreferencesSetResultV1>> {
    return this.call<ModelPreferencesSetResultV1>("model.preferences.set", defined(input), READ_TIMEOUT_MS).then(notifyModelsChanged);
  }

  /** المفتاح يثبت عبر إعادة المحاولة: المستدعي يمرّره نفسه لنفس الاستدعاء المنطقي. */
  invokeModel(request: InvokeRequest, idempotencyKey?: string): Promise<CallResult<ModelInvokeResultV1>> {
    const timeout = (request.timeout_ms ?? HOST_INVOKE_DEFAULT_MS) + INVOKE_MARGIN_MS;
    return this.call("model.invoke", defined(request), timeout, idempotencyKey);
  }

  cancelInvocation(invocationId: string): Promise<CallResult<ModelCancelResultV1>> {
    return this.call("model.cancel", { invocation_id: invocationId }, READ_TIMEOUT_MS);
  }

  // ── المشاريع ──────────────────────────────────────────────────────────────

  listProjects(input: { readonly include_archived?: boolean; readonly query?: string } = {}): Promise<CallResult<ProjectListResultV1>> {
    return this.call("project.list", defined(input), READ_TIMEOUT_MS);
  }

  getProject(projectId: string): Promise<CallResult<ProjectGetResultV1>> {
    return this.call("project.get", { project_id: projectId }, CONTEXT_TIMEOUT_MS);
  }

  createProject(input: ProjectCreateInput): Promise<CallResult<ProjectMutationResultV1>> {
    return this.call("project.create", defined(input), CONTEXT_TIMEOUT_MS);
  }

  updateProject(input: ProjectUpdateInput): Promise<CallResult<ProjectMutationResultV1>> {
    return this.call("project.update", defined(input), CONTEXT_TIMEOUT_MS);
  }

  archiveProject(projectId: string, expectedVersion: number, archived: boolean): Promise<CallResult<ProjectMutationResultV1>> {
    return this.call(
      "project.archive",
      { project_id: projectId, expected_version: expectedVersion, archived },
      READ_TIMEOUT_MS,
    );
  }

  // ── السياق ────────────────────────────────────────────────────────────────

  addContext(input: ContextAddInput): Promise<CallResult<ContextSourceResultV1>> {
    return this.call("context.add", defined(input), CONTEXT_TIMEOUT_MS);
  }

  removeContext(projectId: string, sourceId: string): Promise<CallResult<ContextSourceResultV1>> {
    return this.call("context.remove", { project_id: projectId, source_id: sourceId }, READ_TIMEOUT_MS);
  }

  previewContext(projectId: string, sourceId: string): Promise<CallResult<ContextPreviewResultV1>> {
    return this.call("context.preview", { project_id: projectId, source_id: sourceId }, CONTEXT_TIMEOUT_MS);
  }

  assembleContext(input: ContextAssembleInput): Promise<CallResult<ContextAssembleResultV1>> {
    return this.call("context.assemble", defined(input), CONTEXT_TIMEOUT_MS);
  }

  /** خاصّة: الآلة المشتركة. الاسم مقيّد بنوع المجموعة المغلقة. */
  private call<T>(
    operation: Phase02Operation | ProviderCatalogOperation,
    payload: Record<string, unknown>,
    timeoutMs: number,
    idempotencyKey?: string,
  ): Promise<CallResult<T>> {
    return callOperation<T>(this.context, operation, payload, {
      timeoutMs,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  }
}
