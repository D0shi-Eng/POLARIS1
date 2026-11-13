// عميل IPC: ماذا يقبل، وماذا يرفض، وماذا لا يعرضه أبدًا.

import assert from "node:assert/strict";
import { test } from "node:test";

import { DesktopIpcClient } from "../src/ipc/client";
import { buildRequest, createId, nowTimestamp } from "../src/ipc/envelope";
import { carriesForbiddenDetail, translateBoundaryError } from "../src/ipc/errors";
import { ROUTED_OPERATIONS } from "../src/ipc/operations";
import { TransportTimeout, TransportUnavailable, withTimeout, type Transport } from "../src/ipc/transport";
import { schemaReferenceExists, validateAgainstSchemaReference } from "../src/ipc/validator";
import { CONTRACT_VALIDATORS } from "../src/generated/contract-validators";
import { assertFakeHostIsContractValid, fakeHost, IDENTITY } from "./support/fake-host";

function client(transport: Transport): DesktopIpcClient {
  return new DesktopIpcClient({ transport, identity: IDENTITY });
}

test("the test double itself satisfies the contract", () => {
  assertFakeHostIsContractValid();
});

test("a built request satisfies the request envelope", () => {
  const envelope = buildRequest("desktop.bootstrap", {}, IDENTITY);
  const check = validateAgainstSchemaReference("ipc-envelope.v1.schema.json#/$defs/RequestEnvelope", envelope);
  assert.equal(check.ok, true, JSON.stringify(check));
});

test("the renderer never claims a trust tier it does not have", () => {
  const envelope = buildRequest("desktop.bootstrap", {}, IDENTITY);
  assert.equal(envelope.caller_identity.trust_tier, "TIER_2_UNTRUSTED");
  assert.equal(envelope.caller_identity.caller_type, "CORE_UI");
});

test("generated identifiers and timestamps match the contract patterns", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (let index = 0; index < 32; index += 1) assert.match(createId(), uuid);
  assert.match(nowTimestamp(() => 0), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("all five operations round-trip and validate", async () => {
  const api = client(fakeHost());
  assert.equal((await api.bootstrap()).ok, true);
  assert.equal((await api.runtimeStatus()).ok, true);
  assert.equal((await api.capabilityAvailability(["polaris.desktop.home"])).ok, true);
  assert.equal((await api.settingsDescribe()).ok, true);
  assert.equal((await api.settingsRead("general.appearance")).ok, true);
});

test("the client exposes exactly the five routed operations and no generic call", () => {
  const surface = Object.getOwnPropertyNames(DesktopIpcClient.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(surface.sort(), [
    "bootstrap",
    "call",
    "capabilityAvailability",
    "runtimeStatus",
    "settingsDescribe",
    "settingsRead",
  ]);
  // `call` خاصّة في TypeScript؛ الحارس الحقيقي هو أنها ليست جزءًا من الواجهة
  // المُصدَّرة ولا تقبل اسمًا حرًّا: نوعها يقيّد الاسم بالمجموعة المغلقة.
  assert.equal(ROUTED_OPERATIONS.length, 5);
});

test("a response for another request is refused", async () => {
  const wrong: Transport = {
    async send(envelope: unknown) {
      const request = envelope as Record<string, unknown>;
      return {
        contract_version: "1.1",
        protocol_version: "1.1",
        message_type: "RESPONSE",
        message_id: "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a",
        request_id: "00000000-0000-4000-8000-000000000000",
        correlation_id: request["correlation_id"],
        session_id: IDENTITY.sessionId,
        caller_identity: {
          caller_type: "CORE_UI",
          principal_id: IDENTITY.principalId,
          trust_tier: "TIER_2_UNTRUSTED",
          session_id: IDENTITY.sessionId,
        },
        timestamp: "2026-09-15T00:00:00Z",
        result: {},
      };
    },
  };
  const outcome = await client(wrong).bootstrap();
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.category, "INVALID_RESPONSE");
});

test("a malformed response is refused rather than rendered", async () => {
  const broken: Transport = { async send() { return { message_type: "RESPONSE" }; } };
  const outcome = await client(broken).bootstrap();
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.error.category, "INVALID_RESPONSE");
});

test("a result that violates its schema is refused", async () => {
  const wrongShape: Transport = {
    async send(envelope: unknown) {
      const request = envelope as Record<string, unknown>;
      return {
        contract_version: "1.1",
        protocol_version: "1.1",
        message_type: "RESPONSE",
        message_id: "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a",
        request_id: request["message_id"],
        correlation_id: request["correlation_id"],
        session_id: IDENTITY.sessionId,
        caller_identity: {
          caller_type: "CORE_UI",
          principal_id: IDENTITY.principalId,
          trust_tier: "TIER_2_UNTRUSTED",
          session_id: IDENTITY.sessionId,
        },
        timestamp: "2026-09-15T00:00:00Z",
        result: { app_version: "not-a-version" },
      };
    },
  };
  const outcome = await client(wrongShape).bootstrap();
  assert.equal(outcome.ok, false);
});

test("an absent transport becomes a classified error, not an exception", async () => {
  const outcome = await client({ async send() { throw new TransportUnavailable(); } }).bootstrap();
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error.category, "IPC_UNAVAILABLE");
    assert.equal(outcome.error.retryable, true);
  }
});

test("a timeout is classified and retryable", async () => {
  const slow: Transport = { send: () => new Promise(() => undefined) };
  const outcome = await client(withTimeout(slow, 10)).bootstrap();
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error.category, "IPC_TIMEOUT");
    assert.equal(outcome.error.retryable, true);
  }
});

test("the timeout wrapper raises the declared error type", async () => {
  const slow: Transport = { send: () => new Promise(() => undefined) };
  await assert.rejects(() => withTimeout(slow, 5).send({}), TransportTimeout);
});

test("a host error is translated to a localization key and a code", async () => {
  const outcome = await client(
    fakeHost({ failWith: { code: "CONTRACT_VIOLATION", display_message: "desktop.error.unsupported_operation", retryable: false } }),
  ).bootstrap();
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error.category, "UNSUPPORTED_OPERATION");
    assert.equal(outcome.error.displayKey, "desktop.error.unsupported_operation");
    assert.equal(outcome.error.code, "CONTRACT_VIOLATION");
  }
});

test("an unrecognised display key falls back to an internal error rather than rendering prose", () => {
  const translated = translateBoundaryError({ code: "INTERNAL_ERROR", display_message: "Something exploded at line 42" });
  assert.equal(translated.category, "INTERNAL_ERROR");
  assert.equal(translated.displayKey, "desktop.error.internal_error");
});

test("the boundary error shape carries no internal detail", () => {
  assert.equal(carriesForbiddenDetail({ code: "X", display_message: "y" }), false);
  assert.equal(carriesForbiddenDetail({ code: "X", internal_detail: "path" }), true);
  assert.equal(carriesForbiddenDetail({ code: "X", stack: "at ..." }), true);
});

test("every registered response schema is known to the renderer's validator", () => {
  for (const record of ROUTED_OPERATIONS) {
    const check = validateAgainstSchemaReference(record.response_schema, {});
    // القيمة الفارغة قد تفشل التحقق، لكن المرجع نفسه يجب أن يكون معروفًا.
    assert.notEqual(
      check.ok === false && check.findings[0]?.detail.startsWith("unresolved schema reference"),
      true,
      `${record.response_schema} is unknown to the renderer`,
    );
  }
});

// P01_STARTUP_REPORT_ABSENT: تحت CSP المنتج (`script-src 'self'`) يُمنع تقييم
// النصوص. Ajv وقت التشغيل كان يترجم المخطط عبر `new Function` فيرمي قبل إرسال
// طلب الإقلاع. هذا الاختبار يعيد إنتاج ذلك القيد داخل Node: يُعطَّل مُنشئ الدوال
// و`eval` أثناء كل تحقق، فأي ترجمة وقت التشغيل تفشل هنا كما فشلت في WebView.
test("validation never evaluates code at run time, as the product CSP requires", () => {
  const scope = globalThis as unknown as { Function: FunctionConstructor; eval: (source: string) => unknown };
  const originalFunction = scope.Function;
  const originalEval = scope.eval;
  const refused = (): never => {
    throw new EvalError("refused: the product CSP forbids evaluating strings as code");
  };
  scope.Function = new Proxy(originalFunction, { construct: refused, apply: refused });
  scope.eval = refused;
  const envelope = buildRequest("desktop.bootstrap", {}, IDENTITY);
  try {
    const references = Object.keys(CONTRACT_VALIDATORS);
    assert.ok(references.length >= ROUTED_OPERATIONS.length * 2 + 2, "the compiled validator table is incomplete");
    for (const record of ROUTED_OPERATIONS) {
      assert.equal(schemaReferenceExists(record.request_schema), true, `${record.request_schema} is not precompiled`);
      assert.equal(schemaReferenceExists(record.response_schema), true, `${record.response_schema} is not precompiled`);
    }
    for (const reference of references) {
      assert.doesNotThrow(() => validateAgainstSchemaReference(reference, {}), `${reference} evaluated code`);
    }
    const accepted = validateAgainstSchemaReference("ipc-envelope.v1.schema.json#/$defs/RequestEnvelope", envelope);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const rejected = validateAgainstSchemaReference("ipc-envelope.v1.schema.json#/$defs/RequestEnvelope", {
      ...envelope,
      unexpected: true,
    });
    assert.equal(rejected.ok, false, "a precompiled validator accepted an unknown envelope field");
  } finally {
    scope.Function = originalFunction;
    scope.eval = originalEval;
  }
});
