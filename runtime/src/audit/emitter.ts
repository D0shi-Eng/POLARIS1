// إصدار أحداث التدقيق، والكاتب الوحيد للدفتر.
//
// W4 كان يصدر أحداثًا فقط: لا سلسلة، ولا ادعاء مقاومة عبث. W5 يربط كل حدث
// بسلسلة تجزئة قبل أن يستقر، ويبقى الحدث نفسه مستند AuditEventV1 صالحًا.
//
// الثابت: هذا هو المكوّن الوحيد الذي يلحق بالدفتر. النموذج والوكيل والإضافات
// والأدوات والمنفّذ لا يملكون مرجعًا إلى السلسلة، ولا تُصدَّر واجهة اللحاق إليهم.
// الحدث الذي لا يجتاز عقده لا يدخل السلسلة ولا يحرّك ترتيبها؛ يُسجَّل مرفوضًا،
// ووجود مرفوض واحد عيب يجب أن يكسر اختبارًا، لا أن يُبتلع.

import type { ContractError } from "@polaris/contracts";

import { newId, nowTimestamp } from "../ids.js";
import type { Doc } from "../policy/types.js";
import type { AuditEventType, AuditOutcomeStatus } from "./event-types.js";
import { AuditChain } from "./ledger/chain.js";
import type { AuditLedgerRecord } from "./ledger/record.js";

export type { AuditEventType, AuditOutcomeStatus } from "./event-types.js";

export interface AuditInput {
  readonly event_type: AuditEventType;
  readonly correlation_id: string;
  readonly causation_id?: string;
  readonly caller_identity: Doc;
  readonly actor: { readonly kind: "CORE" | "AGENT" | "USER" | "PLUGIN" | "SYSTEM"; readonly id: string };
  readonly mission_id?: string;
  readonly agent_id?: string;
  readonly capability_ref?: { readonly capability_id: string; readonly capability_version: string };
  readonly invocation_id?: string;
  readonly decision_id?: string;
  readonly effects?: readonly Doc[];
  readonly resource?: Doc;
  readonly status: AuditOutcomeStatus;
  readonly error?: ContractError;
  readonly duration_ms?: number;
  readonly policy_ref?: Doc;
  /**
   * ربط W5 الإضافي: معرّف الموافقة، معرّف المنحة، بصمة الخطة، معرّف إثبات
   * الإنجاز، رمز السبب. خريطة محدودة نصية بمفاتيح slug، وتخضع لقاعدة نظافة
   * الأسرار INV-007 كما هي — لا استثناء لـW5.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface RejectedAuditEvent {
  readonly event: Doc;
  readonly errors: readonly ContractError[];
}

export interface AuditEmitterOptions {
  /** السلسلة التي يلحق بها هذا المُصدِر. الافتراضي سلسلة جديدة في الذاكرة. */
  readonly chain?: AuditChain;
}

export class AuditEmitter {
  readonly #events: Doc[] = [];
  readonly #rejected: RejectedAuditEvent[] = [];
  readonly #sequence = new Map<string, number>();
  readonly #chain: AuditChain;

  public constructor(options: AuditEmitterOptions = {}) {
    this.#chain = options.chain ?? new AuditChain();
  }

  /** السلسلة، للقراءة والتحقق. لا يُصدَّر منها مسار لحاق إلى من ليس مُصدِرًا. */
  public get chain(): AuditChain {
    return this.#chain;
  }

  /**
   * التسلسل رتيب داخل كل سلسلة ارتباط، فيكسر تعادل الطوابع الزمنية
   * ويجعل الترتيب كليًا — وهو ما تستند إليه سلسلة التجزئة.
   */
  #next(correlationId: string): number {
    const current = this.#sequence.get(correlationId) ?? 0;
    this.#sequence.set(correlationId, current + 1);
    return current;
  }

  public emit(input: AuditInput): Doc {
    const event: Doc = {
      contract_version: "1.1",
      event_id: newId(),
      event_type: input.event_type,
      correlation_id: input.correlation_id,
      occurred_at: nowTimestamp(),
      sequence: this.#next(input.correlation_id),
      actor: { kind: input.actor.kind, id: input.actor.id },
      caller_identity: input.caller_identity,
      outcome:
        input.error === undefined
          ? input.duration_ms === undefined
            ? { status: input.status }
            : { status: input.status, duration_ms: input.duration_ms }
          : input.duration_ms === undefined
            ? { status: input.status, error: input.error }
            : { status: input.status, error: input.error, duration_ms: input.duration_ms },
    };

    if (input.causation_id !== undefined) event["causation_id"] = input.causation_id;
    if (input.mission_id !== undefined) event["mission_id"] = input.mission_id;
    if (input.agent_id !== undefined) event["agent_id"] = input.agent_id;
    if (input.capability_ref !== undefined) event["capability_ref"] = { ...input.capability_ref };
    if (input.invocation_id !== undefined) event["invocation_id"] = input.invocation_id;
    if (input.decision_id !== undefined) event["decision_id"] = input.decision_id;
    if (input.effects !== undefined) event["effects"] = input.effects;
    if (input.resource !== undefined) event["resource"] = input.resource;
    if (input.policy_ref !== undefined) event["policy_ref"] = input.policy_ref;
    if (input.metadata !== undefined) event["metadata"] = { ...input.metadata };

    // اللحاق يتحقق من العقد ويختم التكامل. الحدث المرفوض لا يستقر في الدفتر.
    const appended = this.#chain.append(event);
    if (appended.ok) {
      this.#events.push(appended.record.event);
      return appended.record.event;
    }
    this.#rejected.push({ event, errors: appended.errors });
    return event;
  }

  public events(): readonly Doc[] {
    return this.#events;
  }

  /** الأحداث التي لم تجتز العقد. وجودها عيب يجب أن يظهر في اختبار، لا أن يُبتلع. */
  public rejected(): readonly RejectedAuditEvent[] {
    return this.#rejected;
  }

  public forCorrelation(correlationId: string): readonly Doc[] {
    return this.#events.filter((e) => e["correlation_id"] === correlationId);
  }

  /** سجلات الدفتر لسلسلة ارتباط. الغلاف لا الحدث، لأن الربط هو محل السؤال. */
  public recordsFor(correlationId: string): readonly AuditLedgerRecord[] {
    return this.#chain.forCorrelation(correlationId);
  }
}
