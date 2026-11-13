// سجل الدفتر: الغلاف الذي يربط حدث تدقيق واحدًا بالسلسلة.
//
// الحدث نفسه يبقى مستند AuditEventV1 صالحًا كما هو. الغلاف لا يعدّله ولا يضيف
// إليه حقولًا خارج العقد؛ يحمل الربط حوله. هذا يعني أن أي مستهلك للعقد يقرأ
// الحدث دون أن يعرف شيئًا عن الدفتر.

import type { Doc } from "../../policy/types.js";

/** تجزئة «ما قبل الأول». ثابت صريح: غيابه ليس صفرًا ضمنيًا. */
export const GENESIS_PREVIOUS_HASH = "0".repeat(64);

/**
 * اسم الرابط المستعمل لتكامل السلسلة.
 *
 * HASH_CHAIN_ONLY يعني بالضبط: تجزئة SHA-256 فوق التمثيل القانوني، بلا مفتاح.
 * هذا يكشف تعديل سجل مخزَّن، ولا يوقّع شيئًا ولا يمنع من يستطيع إعادة بناء
 * السلسلة كاملة. الاسم يسافر مع كل سجل حتى لا يُقرأ الادعاء أوسع مما هو.
 */
export type IntegrityBinderName = "HASH_CHAIN_ONLY";

export interface AuditLedgerRecord {
  /** هوية الدفتر. سجل من دفتر آخر لا يُقبل في هذه السلسلة. */
  readonly ledger_id: string;
  /** الترتيب الكلي داخل الدفتر، يبدأ من صفر ولا يقفز. */
  readonly seq: number;
  /** أول سجل في السلسلة، ولا أول غيره. */
  readonly genesis: boolean;
  readonly binder: IntegrityBinderName;
  readonly canonicalization: "POLARIS-CJSON-1";
  readonly hash_alg: "SHA-256";
  /** الحدث كما اجتاز AuditEventV1. */
  readonly event: Doc;
  /** معرّف الحدث، مرفوعًا إلى الغلاف حتى يمكن كشف التكرار بلا فتح الحدث. */
  readonly event_id: string;
  /** تجزئة محتوى الحدث المقنَّن. هي نفسها ما يضعه العقد في event.integrity.hash. */
  readonly event_hash: string;
  /** تجزئة سلسلة السجل السابق. للسجل الأول: GENESIS_PREVIOUS_HASH. */
  readonly prev_hash: string;
  /** الحلقة: تجزئة فوق (الدفتر، الترتيب، السابق، تجزئة الحدث). */
  readonly chain_hash: string;
}

/** الشكل الذي تُحسب عليه تجزئة الحلقة. مفصول حتى يُحسب بنفس الطريقة في كل موضع. */
export interface ChainLinkInput {
  readonly ledger_id: string;
  readonly seq: number;
  readonly prev_hash: string;
  readonly event_hash: string;
  readonly binder: IntegrityBinderName;
  readonly canonicalization: "POLARIS-CJSON-1";
  readonly hash_alg: "SHA-256";
}

export function linkInputOf(record: AuditLedgerRecord): ChainLinkInput {
  return {
    ledger_id: record.ledger_id,
    seq: record.seq,
    prev_hash: record.prev_hash,
    event_hash: record.event_hash,
    binder: record.binder,
    canonicalization: record.canonicalization,
    hash_alg: record.hash_alg,
  };
}
