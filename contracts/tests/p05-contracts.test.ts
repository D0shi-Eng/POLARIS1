// P05-CT — عقود Phase-05: المفردات، والسجل، والحمولات، والنتائج، والظرف 1.5.
//
// الادعاء: اثنتا عشرة عملية مغلقة، تسافر في الظرف الوحيد بإصدار 1.5، كلٌّ بحمولة
// مقيّدة ومالك واحد وصنف أثر صريح. لا واحدة منها تتنقّل أو تنقر أو تكتب أو ترفع ثقة
// ذاكرة، ولا مفردة في المخطط تسمّي ذاكرة «محقَّقة»: الذاكرة ليست حقيقة.

import test from "node:test";
import assert from "node:assert/strict";

import { findSecretsDeep } from "../src/secret-hygiene.js";
import { schemaReferenceExists, validateAgainstSchemaReference, validateContract } from "../src/validator.js";
import {
  FORBIDDEN_PHASE05_OPERATIONS,
  PHASE04_OPERATIONS,
  PHASE05_OPERATIONS,
  PHASE05_SIDE_EFFECTING,
  isPhase05Operation,
  isPhase05SideEffecting,
  loadDesktopErrorMapping,
  loadPhase05IpcRegistry,
  validatePhase05RequestPayload,
  validatePhase05ResultPayload,
  type Phase05Operation,
} from "../src/desktop/index.js";
import { clone, fixture } from "./helpers.js";
import { schemaEnum } from "./p01-helpers.js";

const registry = loadPhase05IpcRegistry();

const MISSION_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const AGENT_ID = "55555555-5555-4555-8555-555555555555";
const TASK_ID = "66666666-6666-4666-8666-666666666666";
const DIGEST = "a".repeat(64);
const STAMP = "2026-09-23T00:00:00Z";
const LABEL = "MEMORY — UNTRUSTED / NON-AUTHORITATIVE";

function envelopeFor(operation: string, payload: unknown, version = "1.5"): Record<string, unknown> {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json")) as Record<string, unknown>;
  doc["contract_version"] = version;
  doc["protocol_version"] = version;
  doc["operation"] = operation;
  doc["payload"] = payload;
  if (isPhase05Operation(operation) && isPhase05SideEffecting(operation)) {
    doc["idempotency_key"] = "p05-idem-0001-0002-0003";
  }
  return doc;
}

const REQUESTS: Readonly<Record<Phase05Operation, unknown>> = {
  "memory.list": {},
  "memory.get": { memory_id: MEMORY_ID },
  "memory.delete": { memory_id: MEMORY_ID },
  "browser.session.list": {},
  "browser.session.get": { session_id: SESSION_ID },
  "browser.session.cancel": { session_id: SESSION_ID },
  "computer.session.list": {},
  "computer.session.get": { session_id: SESSION_ID },
  "computer.session.cancel": { session_id: SESSION_ID },
  "computer.window.list": {},
  "computer.target.grant": { mission_id: MISSION_ID, hwnd: "0x1a2b" },
  "computer.target.revoke": { grant_id: GRANT_ID },
};

const MEMORY_VIEW = {
  memory_id: MEMORY_ID,
  memory_type: "SEMANTIC",
  scope: "PROJECT",
  project_id: MISSION_ID,
  subject: "fixture page title",
  summary: "fixture page title is POLARIS Fixture Normal",
  trust_class: "MODEL_GENERATED",
  verification: "EVIDENCE_LINKED",
  taint: ["MODEL_GENERATED"],
  confidence_source: "RUNTIME_EVIDENCE",
  importance: 4,
  status: "ACTIVE",
  version: 1,
  source: "mission",
  source_ref_count: 1,
  created_at: STAMP,
  updated_at: STAMP,
};

const BROWSER_SESSION = {
  session_id: SESSION_ID,
  mission_id: MISSION_ID,
  owner_agent_id: AGENT_ID,
  state: "CLOSED",
  navigation_count: 1,
  action_count: 2,
  download_count: 0,
  upload_count: 0,
  trust: "WEB_UNTRUSTED",
  created_at: STAMP,
  last_activity_at: STAMP,
  closed_reason: "MISSION_ENDED",
};

const TARGET = {
  grant_id: GRANT_ID,
  mission_id: MISSION_ID,
  title: "POLARIS TEST FIXTURE - Computer Use",
  executable: "powershell.exe",
  pid: 4242,
  hwnd: "0x1a2b",
  process_created_at: "133700000000000000",
  granted_at: STAMP,
};

const OBSERVATION = {
  observation_id: TASK_ID,
  observed_at: STAMP,
  width: 640,
  height: 480,
  frame_digest: DIGEST,
  layout_digest: DIGEST,
  element_count: 9,
  capture_scope: "WINDOW",
  trust: "UNTRUSTED_CONTENT",
};

const COMPUTER_SESSION = {
  session_id: SESSION_ID,
  mission_id: MISSION_ID,
  agent_id: AGENT_ID,
  state: "ACTIVE",
  target: TARGET,
  created_at: STAMP,
  action_count: 2,
  click_count: 1,
  keyboard_count: 0,
  capture_count: 2,
  last_observation: OBSERVATION,
};

const RESULTS: Readonly<Record<Phase05Operation, unknown>> = {
  "memory.list": { memories: [MEMORY_VIEW], label: LABEL },
  "memory.get": {
    memory: {
      ...MEMORY_VIEW,
      content: "fixture page title is POLARIS Fixture Normal.",
      label: LABEL,
      source_refs: [{ kind: "EVIDENCE", reference: "evidence:1" }],
      lineage: [],
    },
    conflicts: [],
  },
  "memory.delete": { memory_id: MEMORY_ID, deleted: true, status: "DELETED" },
  "browser.session.list": { sessions: [BROWSER_SESSION] },
  "browser.session.get": {
    session: BROWSER_SESSION,
    actions: [
      {
        action_id: TASK_ID,
        task_id: TASK_ID,
        action: "NAVIGATE",
        target: "http://127.0.0.1:4500/normal",
        status: "EXECUTED",
        url: "http://127.0.0.1:4500/normal",
        http_status: 200,
        content_digest: DIGEST,
        outcome: "ACTION_EXECUTED",
        occurred_at: STAMP,
        duration_ms: 12,
      },
    ],
    downloads: [],
  },
  "browser.session.cancel": { session_id: SESSION_ID, state: "CANCELLED" },
  "computer.session.list": { sessions: [COMPUTER_SESSION] },
  "computer.session.get": {
    session: COMPUTER_SESSION,
    actions: [{ action_id: TASK_ID, task_id: TASK_ID, action: "CLICK", target: "c3", status: "EXECUTED", observation_digest: DIGEST, occurred_at: STAMP, duration_ms: 40 }],
    observations: [OBSERVATION],
  },
  "computer.session.cancel": { session_id: SESSION_ID, state: "CANCELLED" },
  "computer.window.list": {
    available: true,
    windows: [{ hwnd: "0x1a2b", title: "POLARIS TEST FIXTURE - Computer Use", executable: "powershell.exe", pid: 4242, grantable: true }],
    grants: [TARGET],
  },
  "computer.target.grant": { grant: TARGET },
  "computer.target.revoke": { grant_id: GRANT_ID, revoked: true },
};

test("P05-CT-001 the Phase-05 vocabulary in code, schema, envelope and registry is one list", () => {
  assert.equal(PHASE05_OPERATIONS.length, 12);
  assert.deepEqual([...schemaEnum("desktop-operation.schema.json", "Phase05DesktopOperation")], [...PHASE05_OPERATIONS]);
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  const start = envelope.indexOf(PHASE04_OPERATIONS[PHASE04_OPERATIONS.length - 1] as string) + 1;
  assert.deepEqual(envelope.slice(start, start + PHASE05_OPERATIONS.length), [...PHASE05_OPERATIONS]);
  assert.deepEqual(registry.operations.map((r) => r.operation), [...PHASE05_OPERATIONS]);
});

test("P05-CT-002 the Phase-05 registry is valid, complete, routed and owned", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
  assert.equal(registry.phase, "PHASE-05");
  assert.equal(registry.envelope_contract, "IPCEnvelopeV1");
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.equal(record.routing_status, "ROUTED");
    assert.equal(record.envelope_version, "1.5");
    assert.equal(record.phase_introduced, "PHASE-05");
    assert.equal(record.caller_identity_authority, "NATIVE_TRANSPORT");
    assert.equal(record.trust_boundary, "RENDERER_TO_NATIVE_HOST");
    owners.add(record.owner);
  }
  assert.ok(owners.size >= 3, "a single service owns everything");
  // بوابة الأدوات ومحرّك المتصفّح ومنفذ سطح المكتب ليست مالكة لأي عملية IPC.
  for (const unreachable of ["ToolGatewayService", "BrowserEngine", "DesktopPort", "DesktopService"]) {
    assert.equal(owners.has(unreachable), false, `${unreachable} owns an IPC operation`);
  }
});

test("P05-CT-003 effects are declared: reads are reads, and every change needs a key", () => {
  for (const record of registry.operations) {
    const side = record.effect === "SIDE_EFFECTING";
    assert.equal(record.idempotency, side ? "REQUIRED" : "NOT_REQUIRED", record.operation);
    assert.equal(PHASE05_SIDE_EFFECTING.includes(record.operation), side, record.operation);
  }
  const effect = (op: string): string | undefined => registry.operations.find((r) => r.operation === op)?.effect_class;
  assert.equal(effect("memory.list"), "READ");
  assert.equal(effect("computer.window.list"), "READ");
  assert.equal(effect("memory.delete"), "WRITE_LOCAL_DATA");
  assert.equal(effect("computer.target.grant"), "WRITE_LOCAL_DATA");
  assert.equal(effect("browser.session.cancel"), "CONTROL");
  assert.equal(effect("computer.session.cancel"), "CONTROL");
});

test("P05-CT-004 every registry schema reference resolves", () => {
  for (const record of registry.operations) {
    assert.ok(schemaReferenceExists(record.request_schema), record.request_schema);
    assert.ok(schemaReferenceExists(record.response_schema), record.response_schema);
  }
});

for (const operation of PHASE05_OPERATIONS) {
  test(`P05-CT-005 ${operation} accepts its minimal valid request`, () => {
    const result = validatePhase05RequestPayload(operation, REQUESTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

for (const operation of PHASE05_OPERATIONS) {
  test(`P05-CT-006 ${operation} returns a result its schema accepts`, () => {
    const result = validatePhase05ResultPayload(operation, RESULTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

test("P05-CT-007 an undeclared field is refused: the payload is closed", () => {
  for (const [operation, payload] of [
    ["memory.delete", { memory_id: MEMORY_ID, content: "x" }],
    ["computer.target.grant", { mission_id: MISSION_ID, hwnd: "0x1a2b", pid: 4242 }],
    ["computer.target.grant", { mission_id: MISSION_ID, hwnd: "0x1a2b", executable: "anything.exe" }],
    ["browser.session.cancel", { session_id: SESSION_ID, url: "http://example.invalid" }],
    ["memory.list", { trust_class: "SYSTEM_GENERATED", verification: "VERIFIED" }],
  ] as const) {
    assert.equal(validatePhase05RequestPayload(operation as Phase05Operation, payload).ok, false, `${operation} accepted ${JSON.stringify(payload)}`);
  }
});

test("P05-CT-008 a window handle is a hex handle and nothing else", () => {
  for (const hwnd of ["1234", "0X1A2B", "0x", "0x1a2b; calc.exe", "desktop", "0x12345678901234567"]) {
    assert.equal(validatePhase05RequestPayload("computer.target.grant", { mission_id: MISSION_ID, hwnd }).ok, false, `${hwnd} was accepted`);
  }
});

test("P05-CT-009 a side-effecting Phase-05 operation needs an idempotency key and version 1.5", () => {
  for (const operation of PHASE05_SIDE_EFFECTING) {
    const doc = envelopeFor(operation, REQUESTS[operation]);
    assert.ok(validateContract("IPCEnvelopeV1", doc).ok, `${operation} with a key failed`);
    delete doc["idempotency_key"];
    assert.equal(validateContract("IPCEnvelopeV1", doc).ok, false, `${operation} validated without an idempotency key`);
  }
  for (const operation of PHASE05_OPERATIONS.filter((op) => !isPhase05SideEffecting(op))) {
    const result = validateContract("IPCEnvelopeV1", envelopeFor(operation, REQUESTS[operation]));
    assert.ok(result.ok, `${operation}: ${result.ok ? "" : JSON.stringify(result.errors)}`);
  }
});

test("P05-CT-010 no operation navigates, clicks, types, executes or raises memory trust", () => {
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  for (const forbidden of FORBIDDEN_PHASE05_OPERATIONS) {
    assert.equal(isPhase05Operation(forbidden), false, `${forbidden} is in the vocabulary`);
    assert.equal(envelope.includes(forbidden), false, `${forbidden} is in the envelope enum`);
  }
  for (const named of ["browser.raw_execute", "computer.raw_command", "memory.trust"]) {
    assert.ok((FORBIDDEN_PHASE05_OPERATIONS as readonly string[]).includes(named), `${named} is not guarded by name`);
  }
  const text = JSON.stringify(registry);
  for (const field of ["arguments", "command", "argv", "script", "url", "coordinates"]) {
    assert.equal(text.includes(`"${field}"`), false, `${field} appears in the Phase-05 registry`);
  }
});

test("P05-CT-011 memory has no verified state and always carries its untrusted label", () => {
  const verification = [...schemaEnum("desktop-p05-domain.schema.json", "MemoryVerification")];
  assert.equal(verification.includes("VERIFIED"), false, "a memory can be marked verified");
  assert.equal(verification.includes("TRUSTED"), false);
  const trust = [...schemaEnum("desktop-p05-domain.schema.json", "MemoryTrustClass")];
  for (const value of trust) assert.doesNotMatch(value, /TRUSTED|VERIFIED|AUTHORITATIVE/, `${value} reads like authority`);
  const relabelled = { ...(RESULTS["memory.list"] as Record<string, unknown>), label: "MEMORY" };
  assert.equal(validatePhase05ResultPayload("memory.list", relabelled).ok, false, "a memory list travelled without its label");
  const detail = clone(RESULTS["memory.get"]) as { memory: Record<string, unknown> };
  detail.memory["verification"] = "VERIFIED";
  assert.equal(validatePhase05ResultPayload("memory.get", detail).ok, false);
});

test("P05-CT-011a a deleted entry travels as a valid tombstone: no content, no subject, no sources", () => {
  const tombstone = {
    memory: {
      ...MEMORY_VIEW,
      status: "DELETED",
      subject: "",
      summary: "",
      source: "erased",
      source_ref_count: 0,
      taint: [],
      version: 2,
      content: "",
      label: LABEL,
      source_refs: [],
      lineage: [],
    },
    conflicts: [],
  };
  const result = validatePhase05ResultPayload("memory.get", tombstone);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors));
  // مصدر فارغ ليس «محوًا»: العقد يرفضه، فالمضيف يسمّي المحو باسمه.
  const blank = clone(tombstone) as { memory: Record<string, unknown> };
  blank.memory["source"] = "";
  assert.equal(validatePhase05ResultPayload("memory.get", blank).ok, false);
});

test("P05-CT-012 web and screen content are labelled untrusted in every view that carries them", () => {
  const session = { ...BROWSER_SESSION, trust: "TRUSTED" };
  assert.equal(validateAgainstSchemaReference("desktop-p05-domain.schema.json#/$defs/BrowserSessionViewV1", session).ok, false);
  const observation = { ...OBSERVATION, trust: "SYSTEM" };
  assert.equal(validateAgainstSchemaReference("desktop-p05-domain.schema.json#/$defs/ObservationViewV1", observation).ok, false);
  const fullScreen = { ...OBSERVATION, capture_scope: "FULL_DESKTOP" };
  assert.equal(validateAgainstSchemaReference("desktop-p05-domain.schema.json#/$defs/ObservationViewV1", fullScreen).ok, false);
});

test("P05-CT-013 no result surface carries page text, pixels, typed text or a reasoning trace", () => {
  const text = JSON.stringify(RESULTS);
  for (const forbidden of ["reasoning", "chain_of_thought", "raw_body", "html", "pixels", "screenshot", "typed_text", "password"]) {
    assert.equal(text.includes(forbidden), false, `${forbidden} appears in a Phase-05 result`);
  }
  const withPixels = { ...OBSERVATION, pixels: "AAAA" };
  assert.equal(validateAgainstSchemaReference("desktop-p05-domain.schema.json#/$defs/ObservationViewV1", withPixels).ok, false);
  const withBody = { ...(RESULTS["browser.session.get"] as { actions: Record<string, unknown>[] }).actions[0], body: "<html>" };
  assert.equal(validateAgainstSchemaReference("desktop-p05-domain.schema.json#/$defs/BrowserActionViewV1", withBody).ok, false);
});

test("P05-CT-014 a credential-shaped field cannot ride in a Phase-05 payload", () => {
  assert.equal(validatePhase05RequestPayload("memory.list", { text: "x", api_key: "sk-secret" }).ok, false);
  assert.ok(findSecretsDeep({ password: "hunter2" }, "/payload").length > 0, "the hygiene scanner missed a credential key");
});

test("P05-CT-015 every declared error category has a mapping entry", () => {
  const mapping = loadDesktopErrorMapping();
  for (const record of registry.operations) {
    for (const category of record.error_categories) {
      assert.ok(mapping.entries.some((entry) => entry.category === category), `${category} has no mapping entry`);
    }
  }
});

test("P05-CT-016 the P04 approval view carries an optional trusted context without breaking 1.4 results", () => {
  const base = {
    approval_id: MEMORY_ID,
    mission_id: MISSION_ID,
    tool_id: "polaris.web.click",
    effects: ["NETWORK_EGRESS", "EXTERNAL_SIDE_EFFECT"],
    arguments_digest: DIGEST,
    status: "PENDING",
    requested_at: STAMP,
    expires_at: STAMP,
  };
  const ref = "desktop-p04-domain.schema.json#/$defs/ApprovalViewV1";
  assert.ok(validateAgainstSchemaReference(ref, base).ok, "a Phase-04 approval without context no longer validates");
  const context = { agent_id: AGENT_ID, action: "WEB_CLICK", target: "#send", expected_effect: "sends the form", risk: "HIGH", arguments_summary: "element=#send" };
  assert.ok(validateAgainstSchemaReference(ref, { ...base, context }).ok);
  assert.equal(validateAgainstSchemaReference(ref, { ...base, context: { ...context, risk: "NONE_AT_ALL" } }).ok, false);
  assert.equal(validateAgainstSchemaReference(ref, { ...base, context: { ...context, approved_by: "agent" } }).ok, false);
});
