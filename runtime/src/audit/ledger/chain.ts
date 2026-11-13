// سلسلة التدقيق. الكاتب الوحيد للدفتر.
//
// المسؤولية الواحدة: أن تحوّل حدثًا اجتاز عقده إلى حلقة مربوطة بما قبلها، وأن
// تلحقها. ما ليست هي: ليست مُصدِر الأحداث (لا تعرف ما يستحق التسجيل)، وليست
// المتحقق (التحقق يقرأ ولا يكتب، ويعيش في ملف آخر لأن من يبني لا يصلح أن يكون
// الحكَم الوحيد على ما بناه).
//
// لا يوجد في هذا الملف مسار «إصلاح». سلسلة تالفة تبقى تالفة ويُقال ذلك.

import { validateContract, type ContractError } from "@polaris/contracts";

import { newId } from "../../ids.js";
import type { Doc } from "../../policy/types.js";
import { HashChainOnlyBinder, type IntegrityBinder } from "./integrity.js";
import { GENESIS_PREVIOUS_HASH, type AuditLedgerRecord } from "./record.js";
import { MemoryLedgerStore, type LedgerStore } from "./store.js";

export interface AuditChainOptions {
  readonly store?: LedgerStore;
  readonly binder?: IntegrityBinder;
  readonly ledger_id?: string;
}

export type AppendResult =
  | { readonly ok: true; readonly record: AuditLedgerRecord }
  | { readonly ok: false; readonly errors: readonly ContractError[] };

/**
 * سلسلة تجزئة فوق أحداث التدقيق.
 *
 * الترتيب داخل append مقصود: التحقق من العقد أولًا، فلا يدخل السلسلة حدث لا
 * يصمد أمام AuditEventV1. حدث مرفوض لا يُلحق ولا يحرّك الترتيب — وإلا صارت
 * فجوة في العدّ دليلًا كاذبًا على حذف.
 */
export class AuditChain {
  public readonly ledgerId: string;

  readonly #store: LedgerStore;
  readonly #binder: IntegrityBinder;
  readonly #eventIds = new Set<string>();

  public constructor(options: AuditChainOptions = {}) {
    this.#store = options.store ?? new MemoryLedgerStore();
    this.#binder = options.binder ?? new HashChainOnlyBinder();
    this.ledgerId = options.ledger_id ?? newId();
  }

  public get store(): LedgerStore {
    return this.#store;
  }

  public get binderName(): string {
    return this.#binder.name;
  }

  public get keyed(): boolean {
    return this.#binder.keyed;
  }

  /**
   * يلحق حدثًا. الحدث يُختم بحقل تكامل مطابق لقاعدة العقود، ثم يُتحقق منه،
   * ثم يُربط. الختم قبل التحقق عمدًا: العقد نفسه يفحص التجزئة، فيصير الختم
   * الخاطئ خطأ عقد لا خطأ دفتر.
   */
  public append(event: Doc): AppendResult {
    const previous = this.#store.last();
    const prevHash = previous === undefined ? GENESIS_PREVIOUS_HASH : previous.chain_hash;
    const seq = this.#store.count();

    const eventHash = this.#binder.eventHash(event);
    const sealed: Doc = {
      ...event,
      integrity: {
        canonicalization: "POLARIS-CJSON-1",
        hash_alg: "SHA-256",
        hash: eventHash,
        prev_hash: prevHash,
      },
    };

    const validated = validateContract("AuditEventV1", sealed);
    if (!validated.ok) return { ok: false, errors: validated.errors };

    const eventId = typeof sealed["event_id"] === "string" ? (sealed["event_id"] as string) : "";
    if (eventId.length === 0) {
      return {
        ok: false,
        errors: [
          {
            code: "CONTRACT_VIOLATION",
            display_message: "The audit event carries no identifier.",
            internal_detail: "event_id is absent or not a string",
            pointer: "/event_id",
            retryable: false,
          },
        ],
      };
    }
    if (this.#eventIds.has(eventId)) {
      return {
        ok: false,
        errors: [
          {
            code: "CONTRACT_VIOLATION",
            display_message: "This audit event was already recorded.",
            internal_detail: `duplicate event_id ${eventId}`,
            pointer: "/event_id",
            retryable: false,
          },
        ],
      };
    }

    const record: AuditLedgerRecord = {
      ledger_id: this.ledgerId,
      seq,
      genesis: seq === 0,
      binder: this.#binder.name,
      canonicalization: "POLARIS-CJSON-1",
      hash_alg: "SHA-256",
      event: sealed,
      event_id: eventId,
      event_hash: eventHash,
      prev_hash: prevHash,
      chain_hash: this.#binder.linkHash({
        ledger_id: this.ledgerId,
        seq,
        prev_hash: prevHash,
        event_hash: eventHash,
        binder: this.#binder.name,
        canonicalization: "POLARIS-CJSON-1",
        hash_alg: "SHA-256",
      }),
    };

    this.#store.append(record);
    this.#eventIds.add(eventId);
    return { ok: true, record };
  }

  public records(): readonly AuditLedgerRecord[] {
    return this.#store.all();
  }

  /** سجلات سلسلة ارتباط واحدة، بترتيب الدفتر. */
  public forCorrelation(correlationId: string): readonly AuditLedgerRecord[] {
    return this.#store.all().filter((r) => r.event["correlation_id"] === correlationId);
  }

  /** آخر تجزئة حلقة. رأس السلسلة، ويصلح مرجعًا في إثبات إنجاز. */
  public head(): string {
    return this.#store.last()?.chain_hash ?? GENESIS_PREVIOUS_HASH;
  }
}
