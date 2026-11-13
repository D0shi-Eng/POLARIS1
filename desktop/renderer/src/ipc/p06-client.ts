// العميل المُصنَّف لـPhase-06: ثمانٍ وعشرون دالّة، واحدة لكل عملية في السجل.
//
// وما لا يوجد في هذا الملف هو الخاصيّة الأمنية: لا `invoke` لموصل، ولا دالّة تقرأ قيمة
// سرّ أو تكتبه. العارض يسجّل الموصلات ويضبطها ويفحصها، ويطلب من المضيف أن يفتح نافذة
// إدخال المفتاح الخاصّة به؛ والقيمة تُكتب هناك، لا هنا. تنفيذ عملية موصل يبدأ من زمن
// تشغيل المهمّة الموثوق وحده، عبر بوابة الأدوات ثم بوابة الموصلات.

import type {
  BudgetListResultV1,
  BudgetRemoveResultV1,
  BudgetSetResultV1,
  ConfigDescribeResultV1,
  ConfigEffectiveResultV1,
  ConfigResetResultV1,
  ConfigSetResultV1,
  ConnectorCredentialResultV1,
  ConnectorGetResultV1,
  ConnectorListResultV1,
  ConnectorOpenapiImportResultV1,
  ConnectorPresetListResultV1,
  ConnectorRemoveResultV1,
  ConnectorResultV1,
  ConnectorTestResultV1,
  DiagnosticsExportResultV1,
  ObservabilityAlertsResultV1,
  ObservabilityErrorsResultV1,
  ObservabilityEventsResultV1,
  ObservabilityHealthResultV1,
  ObservabilityMetricsResultV1,
  PricingListResultV1,
  PricingRemoveResultV1,
  PricingSetResultV1,
  UsageListResultV1,
  UsageSummaryResultV1,
} from "../generated/types/desktop-p06-result-v1";
import type {
  BudgetSetRequestV1,
  ConfigLayer,
  ConnectorConfigureRequestV1,
  ConnectorOpenapiApproveRequestV1,
  ConnectorRegisterRequestV1,
  ObservabilityEventsRequestV1,
  PricingSetRequestV1,
  SettingValue,
  UsageListRequestV1,
} from "../generated/types/desktop-p06-request-v1";
import { callOperation, type CallContext, type CallResult } from "./call";
import type { IdFactory, SessionIdentity } from "./envelope";
import type { Phase06Operation } from "./operations";
import type { Transport } from "./transport";

const READ_TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 12_000;
// فحص الصحّة نداء حقيقي عبر البوابة، وقد ينتظر مهلة الموصل كاملة.
const TEST_TIMEOUT_MS = 45_000;
// نافذة إدخال المفتاح ينتظرها المستخدم نفسه.
const PROMPT_TIMEOUT_MS = 300_000;

export interface Phase06ClientOptions {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory;
  readonly clock?: () => number;
}

/** نطاق طبقة إعداد: لا نطاق للمستخدم والأمن، ومعرّف مشروع أو مهمّة لما عداهما. */
export interface ConfigTarget {
  readonly layer: ConfigLayer;
  readonly scope_id?: string;
}

export interface ConfigScope {
  readonly project_id?: string;
  readonly mission_id?: string;
}

/** يحذف الحقول غير المُعرَّفة والنصوص الفارغة: الحمولة مغلقة. */
function defined<T extends object>(input: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

export class Phase06Client {
  private readonly context: CallContext;

  constructor(options: Phase06ClientOptions) {
    this.context = { transport: options.transport, identity: options.identity, newId: options.newId, clock: options.clock };
  }

  // ── الموصلات ──────────────────────────────────────────────────────────────

  listConnectors(): Promise<CallResult<ConnectorListResultV1>> {
    return this.call("connector.list", {}, READ_TIMEOUT_MS);
  }

  getConnector(connectorId: string): Promise<CallResult<ConnectorGetResultV1>> {
    return this.call("connector.get", { connector_id: connectorId }, READ_TIMEOUT_MS);
  }

  /** يُسجَّل الموصل معطَّلًا دائمًا؛ التفعيل قرار منفصل يراه المستخدم. */
  registerConnector(input: ConnectorRegisterRequestV1, idempotencyKey?: string): Promise<CallResult<ConnectorResultV1>> {
    return this.call("connector.register", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  configureConnector(input: ConnectorConfigureRequestV1, idempotencyKey?: string): Promise<CallResult<ConnectorResultV1>> {
    return this.call("connector.configure", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  removeConnector(connectorId: string, idempotencyKey?: string): Promise<CallResult<ConnectorRemoveResultV1>> {
    return this.call("connector.remove", { connector_id: connectorId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  testConnector(connectorId: string, idempotencyKey?: string): Promise<CallResult<ConnectorTestResultV1>> {
    return this.call("connector.test", { connector_id: connectorId }, TEST_TIMEOUT_MS, idempotencyKey);
  }

  /** يفتح نافذة المضيف لإدخال المفتاح. لا قيمة تمرّ في هذا النداء ولا في ردّه. */
  setConnectorCredential(connectorId: string, idempotencyKey?: string): Promise<CallResult<ConnectorCredentialResultV1>> {
    return this.call("connector.credential.set", { connector_id: connectorId }, PROMPT_TIMEOUT_MS, idempotencyKey);
  }

  clearConnectorCredential(connectorId: string, idempotencyKey?: string): Promise<CallResult<ConnectorCredentialResultV1>> {
    return this.call("connector.credential.clear", { connector_id: connectorId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  /** يحلّل وثيقة OpenAPI إلى عمليات مقترحة. لا يُسجَّل شيء. */
  importOpenapi(spec: string, idempotencyKey?: string): Promise<CallResult<ConnectorOpenapiImportResultV1>> {
    return this.call("connector.openapi.import", { spec }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  approveOpenapi(input: ConnectorOpenapiApproveRequestV1, idempotencyKey?: string): Promise<CallResult<ConnectorResultV1>> {
    return this.call("connector.openapi.approve", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  /** الإعدادات الجاهزة المدمجة (PHASE-05): عنوان الخدمة الرسمي وعمليات قراءة موثّقة. لا اعتماد ولا حالة اتصال. */
  listPresets(): Promise<CallResult<ConnectorPresetListResultV1>> {
    return this.call("connector.preset.list", {}, READ_TIMEOUT_MS);
  }

  /** يسجّل إعدادًا جاهزًا موصلًا معطّلًا بلا اعتماد. العنوان والمسارات والترويسات من المضيف، لا من هذا النداء. */
  registerPreset(presetId: string, displayName?: string, idempotencyKey?: string): Promise<CallResult<ConnectorResultV1>> {
    return this.call("connector.preset.register", displayName === undefined ? { preset_id: presetId } : { preset_id: presetId, display_name: displayName }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── الاستعمال والكلفة ─────────────────────────────────────────────────────

  usageSummary(scope: ConfigScope = {}): Promise<CallResult<UsageSummaryResultV1>> {
    return this.call("usage.summary", defined(scope), READ_TIMEOUT_MS);
  }

  listUsage(input: UsageListRequestV1 = {}): Promise<CallResult<UsageListResultV1>> {
    return this.call("usage.list", defined(input), READ_TIMEOUT_MS);
  }

  listBudgets(scope: ConfigScope = {}): Promise<CallResult<BudgetListResultV1>> {
    return this.call("budget.list", defined(scope), READ_TIMEOUT_MS);
  }

  setBudget(input: BudgetSetRequestV1, idempotencyKey?: string): Promise<CallResult<BudgetSetResultV1>> {
    return this.call("budget.set", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  removeBudget(budgetId: string, idempotencyKey?: string): Promise<CallResult<BudgetRemoveResultV1>> {
    return this.call("budget.remove", { budget_id: budgetId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  listPricing(): Promise<CallResult<PricingListResultV1>> {
    return this.call("pricing.list", {}, READ_TIMEOUT_MS);
  }

  /** سعر يدخله المستخدم مع مصدره. كل كلفة تُحسب منه تقدير، لا فاتورة. */
  setPricing(input: PricingSetRequestV1, idempotencyKey?: string): Promise<CallResult<PricingSetResultV1>> {
    return this.call("pricing.set", defined(input), WRITE_TIMEOUT_MS, idempotencyKey);
  }

  removePricing(pricingId: string, idempotencyKey?: string): Promise<CallResult<PricingRemoveResultV1>> {
    return this.call("pricing.remove", { pricing_id: pricingId }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── الرصد ─────────────────────────────────────────────────────────────────

  health(): Promise<CallResult<ObservabilityHealthResultV1>> {
    return this.call("observability.health", {}, READ_TIMEOUT_MS);
  }

  events(input: ObservabilityEventsRequestV1 = {}): Promise<CallResult<ObservabilityEventsResultV1>> {
    return this.call("observability.events", defined(input), READ_TIMEOUT_MS);
  }

  metrics(): Promise<CallResult<ObservabilityMetricsResultV1>> {
    return this.call("observability.metrics", {}, READ_TIMEOUT_MS);
  }

  errors(): Promise<CallResult<ObservabilityErrorsResultV1>> {
    return this.call("observability.errors", {}, READ_TIMEOUT_MS);
  }

  alerts(includeResolved = false): Promise<CallResult<ObservabilityAlertsResultV1>> {
    return this.call("observability.alerts", includeResolved ? { include_resolved: true } : {}, READ_TIMEOUT_MS);
  }

  /** يكتب وثيقة تشخيص محلّية محجوبة. لا يُرسل شيء إلى أي مكان. */
  exportDiagnostics(idempotencyKey?: string): Promise<CallResult<DiagnosticsExportResultV1>> {
    return this.call("diagnostics.export", {}, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  // ── الإعدادات ─────────────────────────────────────────────────────────────

  describeConfig(): Promise<CallResult<ConfigDescribeResultV1>> {
    return this.call("config.describe", {}, READ_TIMEOUT_MS);
  }

  effectiveConfig(scope: ConfigScope = {}): Promise<CallResult<ConfigEffectiveResultV1>> {
    return this.call("config.effective", defined(scope), READ_TIMEOUT_MS);
  }

  /** يكتب قيمة مُصنَّفة في طبقة واحدة. المضيف يتحقّق ويقيّد ويرفض التوسيع. */
  setConfig(target: ConfigTarget, key: string, value: SettingValue, idempotencyKey?: string): Promise<CallResult<ConfigSetResultV1>> {
    return this.call("config.set", { ...defined(target), key, value }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  resetConfig(target: ConfigTarget, key: string, idempotencyKey?: string): Promise<CallResult<ConfigResetResultV1>> {
    return this.call("config.reset", { ...defined(target), key }, WRITE_TIMEOUT_MS, idempotencyKey);
  }

  private call<T>(operation: Phase06Operation, payload: Record<string, unknown>, timeoutMs: number, idempotencyKey?: string): Promise<CallResult<T>> {
    return callOperation<T>(this.context, operation, payload, { timeoutMs, ...(idempotencyKey !== undefined ? { idempotencyKey } : {}) });
  }
}
