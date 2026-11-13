// W5 / A — سلسلة تدقيق قابلة لكشف العبث.
//
// كل اختبار هنا يجيب سؤالًا واحدًا: هل يُكتشف هذا الصنف من العبث بعينه؟
// الادعاء المُثبَت محدود ومكتوب صراحة: كشف تعديل/حذف/إدراج/إعادة ترتيب في
// سجلات مخزَّنة في فضاء المستخدم. ولا يُدّعى شيء عن مدير نظام ولا نواة.

import test from "node:test";
import assert from "node:assert/strict";

import { AuditChain } from "../src/audit/ledger/chain.js";
import { verifyChain } from "../src/audit/ledger/verify.js";
import { GENESIS_PREVIOUS_HASH, type AuditLedgerRecord } from "../src/audit/ledger/record.js";
import { MemoryLedgerStore } from "../src/audit/ledger/store.js";
import { HashChainOnlyBinder } from "../src/audit/ledger/integrity.js";
import { AuditEmitter } from "../src/audit/emitter.js";
import { W5_EMITTED_EVENT_TYPES, SUPERSEDED_EVENT_TYPES } from "../src/audit/event-types.js";
import { newId, nowTimestamp } from "../src/ids.js";
import type { Doc } from "../src/policy/types.js";

function identity(): Doc {
  return { caller_type: "SYSTEM", principal_id: newId(), trust_tier: "TIER_0_TRUSTED", session_id: newId() };
}

function emitter(): AuditEmitter {
  return new AuditEmitter({ chain: new AuditChain({ store: new MemoryLedgerStore(), ledger_id: newId() }) });
}

function fill(audit: AuditEmitter, correlationId: string, count: number): void {
  const caller = identity();
  for (let i = 0; i < count; i += 1) {
    audit.emit({
      event_type: "MISSION_STARTED",
      correlation_id: correlationId,
      caller_identity: caller,
      actor: { kind: "SYSTEM", id: newId() },
      mission_id: newId(),
      status: "SUCCESS",
      metadata: { step: String(i) },
    });
  }
}

function clone(records: readonly AuditLedgerRecord[]): AuditLedgerRecord[] {
  return JSON.parse(JSON.stringify(records)) as AuditLedgerRecord[];
}

test("a chain built by the emitter verifies, and every record is contract-valid", () => {
  const audit = emitter();
  fill(audit, newId(), 6);

  assert.equal(audit.rejected().length, 0, JSON.stringify(audit.rejected()));
  const result = verifyChain(audit.chain.records(), { expected_ledger_id: audit.chain.ledgerId });
  assert.equal(result.ok, true, JSON.stringify(result.defects));
  assert.equal(result.records, 6);
  assert.equal(result.head, audit.chain.head());
});

test("genesis is explicit: the first record declares it and carries the genesis previous hash", () => {
  const audit = emitter();
  fill(audit, newId(), 3);
  const records = audit.chain.records();

  assert.equal(records[0]?.genesis, true);
  assert.equal(records[0]?.prev_hash, GENESIS_PREVIOUS_HASH);
  assert.equal(records[0]?.seq, 0);
  for (const record of records.slice(1)) assert.equal(record.genesis, false);

  // سلسلة تبدأ من غير البداية تُرفض.
  const beheaded = clone(records).slice(1);
  const result = verifyChain(beheaded);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "GENESIS_MISSING" || d.kind === "SEQUENCE_BROKEN"));
});

test("a modified record is detected, and the defect names the event digest", () => {
  const audit = emitter();
  fill(audit, newId(), 5);
  const tampered = clone(audit.chain.records());
  const target = tampered[2];
  assert.ok(target !== undefined);
  (target.event as Doc)["metadata"] = { step: "tampered" };

  const result = verifyChain(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "EVENT_HASH_MISMATCH" && d.index === 2));
  assert.ok(result.defects.some((d) => d.code === "AUDIT_EVENT_HASH_MISMATCH"));
});

test("a deleted middle record is detected", () => {
  const audit = emitter();
  fill(audit, newId(), 5);
  const records = clone(audit.chain.records());
  records.splice(2, 1);

  const result = verifyChain(records);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "SEQUENCE_BROKEN"));
  assert.ok(result.defects.some((d) => d.kind === "PREVIOUS_HASH_MISMATCH"));
});

test("an inserted fake record is detected", () => {
  const audit = emitter();
  fill(audit, newId(), 4);
  const records = clone(audit.chain.records());
  const forged = JSON.parse(JSON.stringify(records[1])) as AuditLedgerRecord;
  records.splice(2, 0, forged);

  const result = verifyChain(records);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "SEQUENCE_BROKEN" || d.kind === "PREVIOUS_HASH_MISMATCH"));
  assert.ok(result.defects.some((d) => d.kind === "DUPLICATE_EVENT_ID"));
});

test("reordered records are detected", () => {
  const audit = emitter();
  fill(audit, newId(), 5);
  const records = clone(audit.chain.records());
  const a = records[1];
  const b = records[3];
  assert.ok(a !== undefined && b !== undefined);
  records[1] = b;
  records[3] = a;

  const result = verifyChain(records);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "SEQUENCE_BROKEN"));
});

test("a broken previous hash is detected on its own", () => {
  const audit = emitter();
  fill(audit, newId(), 4);
  const records = clone(audit.chain.records());
  const third = records[2];
  assert.ok(third !== undefined);
  records[2] = { ...third, prev_hash: "f".repeat(64) };

  const result = verifyChain(records);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "PREVIOUS_HASH_MISMATCH" && d.index === 2));
  assert.ok(result.defects.some((d) => d.kind === "CHAIN_HASH_MISMATCH" && d.index === 2));
});

test("a rewritten link digest is detected", () => {
  const audit = emitter();
  fill(audit, newId(), 3);
  const records = clone(audit.chain.records());
  const first = records[0];
  assert.ok(first !== undefined);
  records[0] = { ...first, chain_hash: "a".repeat(64) };

  const result = verifyChain(records);
  assert.equal(result.ok, false);
  assert.ok(result.defects.some((d) => d.kind === "CHAIN_HASH_MISMATCH"));
});

test("a malformed record stops verification and is named as malformed", () => {
  const audit = emitter();
  fill(audit, newId(), 3);
  const records: unknown[] = clone(audit.chain.records());
  records[1] = { not: "a record" };

  const result = verifyChain(records);
  assert.equal(result.ok, false);
  assert.equal(result.defects[0]?.kind, "RECORD_MALFORMED");
  assert.equal(result.defects[0]?.code, "AUDIT_RECORD_MALFORMED");
});

test("an event that fails its contract never enters the chain, and is reported as rejected", () => {
  const audit = emitter();
  // MISSION_STARTED يشترط mission_id في المخطط. حذفه يجعل الحدث غير صالح.
  audit.emit({
    event_type: "MISSION_STARTED",
    correlation_id: newId(),
    caller_identity: identity(),
    actor: { kind: "SYSTEM", id: newId() },
    status: "SUCCESS",
  });

  assert.equal(audit.chain.records().length, 0);
  assert.equal(audit.rejected().length, 1);
  assert.equal(audit.events().length, 0);
});

test("audit metadata carrying a credential shape is refused before it can be chained", () => {
  const audit = emitter();
  audit.emit({
    event_type: "MISSION_STARTED",
    correlation_id: newId(),
    caller_identity: identity(),
    actor: { kind: "SYSTEM", id: newId() },
    mission_id: newId(),
    status: "SUCCESS",
    metadata: { api_key: "value-does-not-matter" },
  });

  assert.equal(audit.chain.records().length, 0);
  assert.equal(audit.rejected().length, 1);
});

test("a duplicate event identity is refused at append time", () => {
  const chain = new AuditChain({ store: new MemoryLedgerStore(), ledger_id: newId() });
  const caller = identity();
  const event: Doc = {
    contract_version: "1.1",
    event_id: newId(),
    event_type: "MISSION_STARTED",
    correlation_id: newId(),
    occurred_at: nowTimestamp(),
    sequence: 0,
    actor: { kind: "SYSTEM", id: newId() },
    caller_identity: caller,
    mission_id: newId(),
    outcome: { status: "SUCCESS" },
  };

  assert.equal(chain.append(event).ok, true);
  const second = chain.append({ ...event, sequence: 1 });
  assert.equal(second.ok, false);
  assert.equal(chain.records().length, 1);
});

test("the integrity binder names itself honestly and claims no key", () => {
  const binder = new HashChainOnlyBinder();
  assert.equal(binder.name, "HASH_CHAIN_ONLY");
  assert.equal(binder.keyed, false);

  const audit = emitter();
  fill(audit, newId(), 2);
  for (const record of audit.chain.records()) {
    assert.equal(record.binder, "HASH_CHAIN_ONLY");
    assert.equal(record.canonicalization, "POLARIS-CJSON-1");
    assert.equal(record.hash_alg, "SHA-256");
  }
  const verification = verifyChain(audit.chain.records());
  assert.equal(verification.binder, "HASH_CHAIN_ONLY");
  assert.equal(verification.keyed, false);
});

test("the Tier-0 store declares that it is not durable rather than implying that it is", () => {
  const store = new MemoryLedgerStore();
  assert.equal(store.durable, false);
});

test("every declared W5 event type is distinct from the W2 vocabulary it supersedes", () => {
  for (const superseded of SUPERSEDED_EVENT_TYPES) {
    assert.equal(
      (W5_EMITTED_EVENT_TYPES as readonly string[]).includes(superseded),
      false,
      `${superseded} appears in both vocabularies`,
    );
  }
  assert.equal(new Set(W5_EMITTED_EVENT_TYPES).size, W5_EMITTED_EVENT_TYPES.length);
});
