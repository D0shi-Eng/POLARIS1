// P03-CT — عقود Phase-03: المفردات، والسجل، والحمولات، والظرف 1.3.
//
// الادعاء: عشر عمليات مغلقة، تسافر في الظرف الوحيد بإصدار 1.3، كلٌّ بحمولة مقيّدة
// ومالك واحد وصنف أثر صريح، ولا حقل فيها يستطيع حمل سرّ أو وجهة حرّة أو اسم فعل.

import test from "node:test";
import assert from "node:assert/strict";

import { findSecretsDeep } from "../src/secret-hygiene.js";
import { schemaReferenceExists, validateAgainstSchemaReference, validateContract } from "../src/validator.js";
import {
  PHASE02_OPERATIONS,
  PHASE03_OPERATIONS,
  PHASE03_SIDE_EFFECTING,
  isPhase03Operation,
  isPhase03SideEffecting,
  loadDesktopErrorMapping,
  loadPhase03IpcRegistry,
  validatePhase03RequestPayload,
  validatePhase03ResultPayload,
  type Phase03Operation,
} from "../src/desktop/index.js";
import { clone, fixture } from "./helpers.js";
import { schemaEnum } from "./p01-helpers.js";

const registry = loadPhase03IpcRegistry();

const MISSION_ID = "11111111-1111-4111-8111-111111111111";

function envelopeFor(operation: string, payload: unknown, version = "1.3"): Record<string, unknown> {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json")) as Record<string, unknown>;
  doc["contract_version"] = version;
  doc["protocol_version"] = version;
  doc["operation"] = operation;
  doc["payload"] = payload;
  if (isPhase03Operation(operation) && isPhase03SideEffecting(operation)) {
    doc["idempotency_key"] = "p03-idem-0001-0002-0003";
  }
  return doc;
}

/** حمولة طلب صالحة لكل عملية، بأصغر شكل يقبله مخططها. */
const REQUESTS: Readonly<Record<Phase03Operation, unknown>> = {
  "mission.list": {},
  "mission.get": { mission_id: MISSION_ID },
  "mission.create": { title: "a mission", objective: "an objective" },
  "mission.start": { mission_id: MISSION_ID },
  "mission.cancel": { mission_id: MISSION_ID },
  "mission.resume": { mission_id: MISSION_ID },
  "task.list": { mission_id: MISSION_ID },
  "agent.list": {},
  "claim.list": { mission_id: MISSION_ID },
  "evidence.list": { mission_id: MISSION_ID },
};

test("P03-CT-001 the Phase-03 vocabulary in code, schema, envelope and registry is one list", () => {
  assert.equal(PHASE03_OPERATIONS.length, 10);
  assert.deepEqual([...schemaEnum("desktop-operation.schema.json", "Phase03DesktopOperation")], [...PHASE03_OPERATIONS]);
  // الظرف: أحد عشر عضوًا قديمًا، ثم تسعة عشر لـPhase-02، ثم عشرة لـPhase-03، ثم ما
  // تضيفه المراحل التالية إضافةً بحتة بعدها. الادعاء المقيس هنا هو موضع عمليات
  // Phase-03 وتتابعها، لا طول القائمة كلها: تثبيت الطول يجعل أي إضافة لاحقة تكسر
  // اختبار مرحلة مغلقة بلا تغيّر في ادعائها.
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  const start = 11 + PHASE02_OPERATIONS.length;
  assert.ok(envelope.length >= start + PHASE03_OPERATIONS.length);
  assert.deepEqual(envelope.slice(start, start + PHASE03_OPERATIONS.length), [...PHASE03_OPERATIONS]);
  assert.deepEqual(registry.operations.map((r) => r.operation), [...PHASE03_OPERATIONS]);
});

test("P03-CT-002 the Phase-03 registry is valid, complete, routed and owned", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
  assert.equal(registry.phase, "PHASE-03");
  assert.equal(registry.envelope_contract, "IPCEnvelopeV1");
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.equal(record.routing_status, "ROUTED");
    assert.equal(record.envelope_version, "1.3");
    assert.equal(record.phase_introduced, "PHASE-03");
    assert.equal(record.caller_identity_authority, "NATIVE_TRANSPORT");
    assert.equal(record.trust_boundary, "RENDERER_TO_NATIVE_HOST");
    owners.add(record.owner);
  }
  // لا خدمة واحدة تملك كل شيء: ذلك مُرسِل عام بثياب أخرى.
  assert.ok(owners.size >= 5, "a single service owns everything");
  assert.equal(owners.has("DesktopService"), false);
  assert.equal(new Set(registry.operations.map((r) => r.operation)).size, 10);
});

test("P03-CT-003 effects are declared, not hidden", () => {
  for (const record of registry.operations) {
    const side = record.effect === "SIDE_EFFECTING";
    assert.equal(record.idempotency, side ? "REQUIRED" : "NOT_REQUIRED", record.operation);
    assert.equal(PHASE03_SIDE_EFFECTING.includes(record.operation), side, record.operation);
    if (!side) assert.ok(["READ", "READ_RESOURCE"].includes(record.effect_class), record.operation);
    else assert.ok(!["READ", "READ_RESOURCE"].includes(record.effect_class), record.operation);
  }
  const effect = (op: string): string | undefined => registry.operations.find((r) => r.operation === op)?.effect_class;
  assert.equal(effect("mission.list"), "READ");
  assert.equal(effect("mission.create"), "CREATE_LOCAL_DATA");
  // بدء مهمّة وإلغاؤها واستئنافها تحكّمٌ في التنفيذ، لا قراءة.
  assert.equal(effect("mission.start"), "CONTROL");
  assert.equal(effect("mission.cancel"), "CONTROL");
  assert.equal(effect("mission.resume"), "CONTROL");
});

test("P03-CT-004 every registry schema reference resolves", () => {
  for (const record of registry.operations) {
    assert.ok(schemaReferenceExists(record.request_schema), record.request_schema);
    assert.ok(schemaReferenceExists(record.response_schema), record.response_schema);
  }
});

for (const operation of PHASE03_OPERATIONS) {
  test(`P03-CT-005 ${operation} accepts its minimal valid request`, () => {
    const result = validatePhase03RequestPayload(operation, REQUESTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

test("P03-CT-006 an undeclared field is refused: the payload is closed", () => {
  const result = validatePhase03RequestPayload("mission.create", {
    title: "t",
    objective: "o",
    endpoint: "https://example.invalid/api",
  });
  assert.equal(result.ok, false);
});

test("P03-CT-007 a credential-shaped field cannot ride in a Phase-03 payload", () => {
  const result = validatePhase03RequestPayload("mission.create", { title: "t", objective: "o", api_key: "sk-secret" });
  assert.equal(result.ok, false);
  const hits = findSecretsDeep({ api_key: "sk-secret" }, "/payload");
  assert.ok(hits.length > 0, "the hygiene scanner missed a credential key");
});

test("P03-CT-008 a Phase-03 operation declares the envelope version that will be enforced", () => {
  const ok13 = validateContract("IPCEnvelopeV1", envelopeFor("mission.list", {}, "1.3"));
  assert.ok(ok13.ok, ok13.ok ? "" : JSON.stringify(ok13.errors, null, 2));
  // الظرف نفسه لا يمنع MINOR الأدنى؛ القاعدة الدلالية عند المضيف هي التي ترفض.
  // ما يُثبَت هنا أن إصدار الإدخال مُعلن في السجل ليُفرَض هناك.
  const record = registry.operations.find((r) => r.operation === "mission.list");
  assert.equal(record?.envelope_version, "1.3");
});

test("P03-CT-009 a side-effecting Phase-03 operation needs an idempotency key in the envelope", () => {
  for (const operation of PHASE03_SIDE_EFFECTING) {
    const doc = envelopeFor(operation, REQUESTS[operation]);
    delete doc["idempotency_key"];
    const result = validateContract("IPCEnvelopeV1", doc);
    assert.equal(result.ok, false, `${operation} validated without an idempotency key`);
  }
});

test("P03-CT-010 a read-only Phase-03 operation is not forced to carry a key", () => {
  for (const operation of PHASE03_OPERATIONS.filter((op) => !isPhase03SideEffecting(op))) {
    const result = validateContract("IPCEnvelopeV1", envelopeFor(operation, REQUESTS[operation]));
    assert.ok(result.ok, `${operation}: ${result.ok ? "" : JSON.stringify(result.errors)}`);
  }
});

test("P03-CT-011 there is no generic agent dispatch operation in the vocabulary", () => {
  for (const forbidden of ["agent.execute", "agent.raw", "agent.call", "orchestrator.command", "mission.run"]) {
    assert.equal(isPhase03Operation(forbidden), false, `${forbidden} is in the vocabulary`);
    assert.equal(
      [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")].includes(forbidden),
      false,
      `${forbidden} is in the envelope enum`,
    );
  }
});

test("P03-CT-012 every declared error category has a mapping entry", () => {
  const mapping = loadDesktopErrorMapping();
  for (const record of registry.operations) {
    for (const category of record.error_categories) {
      assert.ok(
        mapping.entries.some((e) => e.category === category),
        `${category} has no mapping entry`,
      );
    }
  }
});

test("P03-CT-013 a result that claims proof without the shape is refused", () => {
  // نتيجة mission.get يجب أن تحمل الحالة والإثبات معًا؛ إسقاط الإثبات يُرفض.
  const result = validatePhase03ResultPayload("mission.get", {
    mission: {
      mission_id: MISSION_ID,
      title: "t",
      objective: "o",
      origin: "USER",
      execution_mode: "SINGLE_AGENT",
      priority: "NORMAL",
      state: "COMPLETED",
      completion_proof_status: "NOT_PROVEN",
      current_revision: 1,
      budget: {
        max_wall_clock_ms: 1000,
        max_model_calls: 1,
        max_input_tokens: 1,
        max_output_tokens: 1,
        max_total_tokens: 1,
        max_tasks: 1,
        max_agent_instances: 1,
        max_active_agents: 1,
        max_concurrent_model_calls: 1,
        max_delegations: 0,
        max_delegation_depth: 0,
        max_retries: 0,
        max_review_rounds: 0,
        max_graph_revisions: 0,
      },
      requirements: [],
      created_at: "2026-01-01T00:00:00Z",
      version: 1,
    },
  });
  assert.equal(result.ok, false, "a mission was returned without its completion proof");
});

test("P03-CT-014 no Phase-03 field name looks like a credential to the hygiene scanner", () => {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "properties" && value !== null && typeof value === "object") {
        names.push(...Object.keys(value as Record<string, unknown>));
      }
      walk(value);
    }
  };
  for (const reference of ["desktop-p03-request.v1.schema.json", "desktop-p03-result.v1.schema.json"]) {
    const record = registry.operations.find((r) => r.request_schema.startsWith(reference) || r.response_schema.startsWith(reference));
    assert.ok(record !== undefined, `${reference} is unused`);
  }
  const probe: Record<string, string> = {};
  for (const name of ["api_key", "secret", "password", "raw_token"]) probe[name] = "x";
  assert.ok(findSecretsDeep(probe, "/probe").length > 0);
  // ولا اسم من أسماء حقولنا يقع في الفخّ نفسه.
  walk(REQUESTS);
  for (const name of names) {
    assert.equal(findSecretsDeep({ [name]: "value" }, "/p").length, 0, `${name} looks like a credential`);
  }
});
