// التحقق من سلسلة التدقيق. يقرأ ولا يكتب، ولا يملك مرجعًا إلى الكاتب.
//
// كل عطب له اسمه. «السلسلة تالفة» وحدها ليست تشخيصًا، ولا تكفي لتقرير أمني:
// الفرق بين تعديل سجل وبين إعادة ترتيب سجلين هو الفرق بين نوعي مهاجم.

import { validateContract } from "@polaris/contracts";

import { W5ErrorCode, type W5ErrorCode as W5Code } from "../../errors.js";
import { HashChainOnlyBinder, type IntegrityBinder } from "./integrity.js";
import { GENESIS_PREVIOUS_HASH, linkInputOf, type AuditLedgerRecord } from "./record.js";

export type ChainDefectKind =
  | "RECORD_MALFORMED"
  | "EVENT_CONTRACT_INVALID"
  | "GENESIS_MISSING"
  | "GENESIS_UNEXPECTED"
  | "SEQUENCE_BROKEN"
  | "LEDGER_ID_MISMATCH"
  | "BINDER_MISMATCH"
  | "EVENT_HASH_MISMATCH"
  | "PREVIOUS_HASH_MISMATCH"
  | "CHAIN_HASH_MISMATCH"
  | "DUPLICATE_EVENT_ID";

export interface ChainDefect {
  readonly kind: ChainDefectKind;
  readonly code: W5Code;
  readonly index: number;
  readonly detail: string;
}

export interface ChainVerification {
  readonly ok: boolean;
  readonly ledger_id: string;
  readonly records: number;
  readonly head: string;
  readonly binder: string;
  readonly keyed: boolean;
  readonly defects: readonly ChainDefect[];
}

function defect(kind: ChainDefectKind, code: W5Code, index: number, detail: string): ChainDefect {
  return { kind, code, index, detail };
}

function isRecordShaped(value: unknown): value is AuditLedgerRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r["ledger_id"] === "string" &&
    typeof r["seq"] === "number" &&
    typeof r["genesis"] === "boolean" &&
    typeof r["binder"] === "string" &&
    typeof r["event_id"] === "string" &&
    typeof r["event_hash"] === "string" &&
    typeof r["prev_hash"] === "string" &&
    typeof r["chain_hash"] === "string" &&
    typeof r["event"] === "object" &&
    r["event"] !== null
  );
}

/**
 * يتحقق من سلسلة كاملة.
 *
 * الفحص لا يتوقف عند أول عطب: مهاجم يعدّل سجلًا واحدًا ومهاجم يعيد بناء نصف
 * الدفتر يظهران مختلفين فقط إذا رأينا كل الأعطاب. لكن سجلًا مشوَّهًا بنيويًا
 * يوقف الفحص عنده، لأن ما بعده لا يمكن ربطه بشيء موثوق.
 */
export function verifyChain(
  input: readonly unknown[],
  options: { readonly binder?: IntegrityBinder; readonly expected_ledger_id?: string } = {},
): ChainVerification {
  const binder = options.binder ?? new HashChainOnlyBinder();
  const defects: ChainDefect[] = [];
  const seen = new Set<string>();

  let ledgerId = options.expected_ledger_id ?? "";
  let previousChainHash = GENESIS_PREVIOUS_HASH;
  let head = GENESIS_PREVIOUS_HASH;

  for (let index = 0; index < input.length; index += 1) {
    const raw = input[index];
    if (!isRecordShaped(raw)) {
      defects.push(
        defect("RECORD_MALFORMED", W5ErrorCode.AUDIT_RECORD_MALFORMED, index, "record does not have the ledger shape"),
      );
      break;
    }
    const record = raw;

    if (ledgerId.length === 0) ledgerId = record.ledger_id;
    if (record.ledger_id !== ledgerId) {
      defects.push(
        defect(
          "LEDGER_ID_MISMATCH",
          W5ErrorCode.AUDIT_CHAIN_CORRUPTED,
          index,
          `record belongs to ledger ${record.ledger_id}, not ${ledgerId}`,
        ),
      );
    }

    if (record.binder !== binder.name) {
      defects.push(
        defect(
          "BINDER_MISMATCH",
          W5ErrorCode.AUDIT_CHAIN_CORRUPTED,
          index,
          `record was bound by ${record.binder}, verified with ${binder.name}`,
        ),
      );
    }

    if (record.seq !== index) {
      defects.push(
        defect(
          "SEQUENCE_BROKEN",
          W5ErrorCode.AUDIT_CHAIN_CORRUPTED,
          index,
          `record carries seq ${String(record.seq)} at position ${String(index)}`,
        ),
      );
    }

    if (index === 0 && (!record.genesis || record.prev_hash !== GENESIS_PREVIOUS_HASH)) {
      defects.push(
        defect(
          "GENESIS_MISSING",
          W5ErrorCode.AUDIT_CHAIN_CORRUPTED,
          index,
          "the first record does not declare itself genesis with the genesis previous hash",
        ),
      );
    }
    if (index > 0 && record.genesis) {
      defects.push(
        defect("GENESIS_UNEXPECTED", W5ErrorCode.AUDIT_CHAIN_CORRUPTED, index, "a second record claims to be genesis"),
      );
    }

    const contract = validateContract("AuditEventV1", record.event);
    if (!contract.ok) {
      defects.push(
        defect(
          "EVENT_CONTRACT_INVALID",
          W5ErrorCode.AUDIT_RECORD_MALFORMED,
          index,
          contract.errors.map((e) => e.internal_detail ?? e.display_message).join("; "),
        ),
      );
    }

    const recomputedEvent = binder.eventHash(record.event);
    if (recomputedEvent !== record.event_hash) {
      defects.push(
        defect(
          "EVENT_HASH_MISMATCH",
          W5ErrorCode.AUDIT_EVENT_HASH_MISMATCH,
          index,
          `event content digest ${recomputedEvent} does not match the recorded ${record.event_hash}`,
        ),
      );
    }

    if (record.prev_hash !== previousChainHash) {
      defects.push(
        defect(
          "PREVIOUS_HASH_MISMATCH",
          W5ErrorCode.AUDIT_PREVIOUS_HASH_MISMATCH,
          index,
          `previous hash ${record.prev_hash} does not link to ${previousChainHash}`,
        ),
      );
    }

    const recomputedLink = binder.linkHash(linkInputOf(record));
    if (recomputedLink !== record.chain_hash) {
      defects.push(
        defect(
          "CHAIN_HASH_MISMATCH",
          W5ErrorCode.AUDIT_CHAIN_CORRUPTED,
          index,
          `link digest ${recomputedLink} does not match the recorded ${record.chain_hash}`,
        ),
      );
    }

    if (seen.has(record.event_id)) {
      defects.push(
        defect("DUPLICATE_EVENT_ID", W5ErrorCode.AUDIT_CHAIN_CORRUPTED, index, `event_id ${record.event_id} repeats`),
      );
    }
    seen.add(record.event_id);

    previousChainHash = record.chain_hash;
    head = record.chain_hash;
  }

  return {
    ok: defects.length === 0,
    ledger_id: ledgerId,
    records: input.length,
    head,
    binder: binder.name,
    keyed: binder.keyed,
    defects,
  };
}
