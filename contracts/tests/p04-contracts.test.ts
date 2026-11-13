// P04-CT — عقود Phase-04: المفردات، والسجل، والحمولات، والنتائج، والظرف 1.4.
//
// الادعاء: اثنتا عشرة عملية مغلقة، تسافر في الظرف الوحيد بإصدار 1.4، كلٌّ بحمولة
// مقيّدة ومالك واحد وصنف أثر صريح، ولا واحدة منها تستطيع تنفيذ أداة ولا نداء خادم
// MCP نداءً حرًّا ولا حمل سرّ.

import test from "node:test";
import assert from "node:assert/strict";

import { findSecretsDeep } from "../src/secret-hygiene.js";
import { schemaReferenceExists, validateAgainstSchemaReference, validateContract } from "../src/validator.js";
import {
  FORBIDDEN_TOOL_OPERATIONS,
  PHASE03_OPERATIONS,
  PHASE04_OPERATIONS,
  PHASE04_SIDE_EFFECTING,
  isPhase04Operation,
  isPhase04SideEffecting,
  loadDesktopErrorMapping,
  loadPhase04IpcRegistry,
  validatePhase04RequestPayload,
  validatePhase04ResultPayload,
  type Phase04Operation,
} from "../src/desktop/index.js";
import { clone, fixture } from "./helpers.js";
import { schemaEnum } from "./p01-helpers.js";

const registry = loadPhase04IpcRegistry();

const MISSION_ID = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "22222222-2222-4222-8222-222222222222";
const APPROVAL_ID = "33333333-3333-4333-8333-333333333333";
const DIGEST = "a".repeat(64);
const STAMP = "2026-09-22T00:00:00Z";

function envelopeFor(operation: string, payload: unknown, version = "1.4"): Record<string, unknown> {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json")) as Record<string, unknown>;
  doc["contract_version"] = version;
  doc["protocol_version"] = version;
  doc["operation"] = operation;
  doc["payload"] = payload;
  if (isPhase04Operation(operation) && isPhase04SideEffecting(operation)) {
    doc["idempotency_key"] = "p04-idem-0001-0002-0003";
  }
  return doc;
}

/** حمولة طلب صالحة لكل عملية، بأصغر شكل يقبله مخططها. */
const REQUESTS: Readonly<Record<Phase04Operation, unknown>> = {
  "skill.list": {},
  "skill.get": { skill_id: "polaris.skill.local-analysis" },
  "skill.configure": { skill_id: "polaris.skill.local-analysis", enabled: true },
  "tool.list": {},
  "tool.get": { tool_id: "polaris.tool.audit.chain.verify" },
  "tool.activity.list": { mission_id: MISSION_ID },
  "mcp.list": {},
  "mcp.register": { name: "fixture", endpoint: "http://127.0.0.1:4200" },
  "mcp.configure": { server_id: SERVER_ID, enabled: true },
  "mcp.refresh": { server_id: SERVER_ID },
  "approval.list": {},
  "tool.approval.respond": { approval_id: APPROVAL_ID, decision: "GRANT" },
};

const SKILL_VIEW = {
  skill_id: "polaris.skill.local-analysis",
  name: "Local analysis",
  description: "Reads registered project context and reports what it found.",
  version: "1.0.0",
  enabled: true,
  required_capabilities: ["polaris.capability.tool.read_local"],
  allowed_tools: ["polaris.tool.audit.chain.verify"],
  input_schema_ref: "p04.skill.analysis.input.v1",
  output_schema_ref: "p04.skill.analysis.output.v1",
  risk_class: "LOW",
  source: "BUILT_IN",
  created_at: STAMP,
  updated_at: STAMP,
};

const TOOL_VIEW = {
  tool_id: "polaris.tool.audit.chain.verify",
  provider: "BUILT_IN",
  name: "Verify the audit chain",
  description: "Verifies the local audit chain and reports what it measured.",
  effects: ["DATABASE_READ"],
  required_capabilities: ["polaris.capability.tool.read_local"],
  risk: "LOW",
  requires_approval: false,
  network_policy: "NONE",
  enabled: true,
  trust_class: "TRUSTED_RUNTIME",
  input_schema_ref: "p04.tool.audit.chain.verify.input.v1",
  output_schema_ref: "p04.tool.audit.chain.verify.output.v1",
  provenance: { origin: "polaris.builtin", registered_at: STAMP },
};

const SERVER_VIEW = {
  server_id: SERVER_ID,
  name: "fixture",
  endpoint: "http://127.0.0.1:4200",
  transport: "LOOPBACK_HTTP",
  state: "ENABLED",
  granted_effects: ["NETWORK_EGRESS", "LOCAL_COMPUTE"],
  tool_count: 2,
  registered_at: STAMP,
};

const RESULTS: Readonly<Record<Phase04Operation, unknown>> = {
  "skill.list": { skills: [SKILL_VIEW] },
  "skill.get": { skill: SKILL_VIEW, tools: [TOOL_VIEW] },
  "skill.configure": { skill: SKILL_VIEW },
  "tool.list": { tools: [TOOL_VIEW] },
  "tool.get": { tool: TOOL_VIEW, allowed_by_skills: [SKILL_VIEW.skill_id] },
  "tool.activity.list": {
    mission_id: MISSION_ID,
    invocations: [
      {
        invocation_id: "44444444-4444-4444-8444-444444444444",
        mission_id: MISSION_ID,
        tool_id: TOOL_VIEW.tool_id,
        status: "SUCCEEDED",
        effects: ["DATABASE_READ"],
        arguments_digest: DIGEST,
        result_digest: DIGEST,
        started_at: STAMP,
        duration_ms: 3,
      },
    ],
  },
  "mcp.list": { servers: [SERVER_VIEW] },
  "mcp.register": { server: SERVER_VIEW },
  "mcp.configure": { server: SERVER_VIEW },
  "mcp.refresh": {
    server: SERVER_VIEW,
    accepted: [TOOL_VIEW],
    rejected: [{ declared_name: "shell", reason: "EFFECT_NOT_PERMITTED" }],
  },
  "approval.list": {
    approvals: [
      {
        approval_id: APPROVAL_ID,
        mission_id: MISSION_ID,
        tool_id: TOOL_VIEW.tool_id,
        effects: ["WRITE_LOCAL"],
        arguments_digest: DIGEST,
        status: "PENDING",
        requested_at: STAMP,
        expires_at: STAMP,
      },
    ],
  },
  "tool.approval.respond": {
    approval: {
      approval_id: APPROVAL_ID,
      mission_id: MISSION_ID,
      tool_id: TOOL_VIEW.tool_id,
      effects: ["WRITE_LOCAL"],
      arguments_digest: DIGEST,
      status: "GRANTED",
      requested_at: STAMP,
      decided_at: STAMP,
      expires_at: STAMP,
    },
  },
};

test("P04-CT-001 the Phase-04 vocabulary in code, schema, envelope and registry is one list", () => {
  assert.equal(PHASE04_OPERATIONS.length, 12);
  assert.deepEqual([...schemaEnum("desktop-operation.schema.json", "Phase04DesktopOperation")], [...PHASE04_OPERATIONS]);
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  // عمليات Phase-04 تقع بعد عمليات Phase-03 مباشرةً، بالترتيب نفسه.
  const start = envelope.indexOf(PHASE03_OPERATIONS[0] as string) + PHASE03_OPERATIONS.length;
  // مقطع محدود لا ذيل مفتوح: مرحلة لاحقة تضيف بعده عملياتها (Phase-05 في 1.5)،
  // والادّعاء هو ترتيب عمليات Phase-04 وتجاورها، لا أنها آخر ما في الظرف.
  assert.deepEqual(envelope.slice(start, start + PHASE04_OPERATIONS.length), [...PHASE04_OPERATIONS]);
  assert.deepEqual(registry.operations.map((r) => r.operation), [...PHASE04_OPERATIONS]);
});

test("P04-CT-002 the Phase-04 registry is valid, complete, routed and owned", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
  assert.equal(registry.phase, "PHASE-04");
  assert.equal(registry.envelope_contract, "IPCEnvelopeV1");
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.equal(record.routing_status, "ROUTED");
    assert.equal(record.envelope_version, "1.4");
    assert.equal(record.phase_introduced, "PHASE-04");
    assert.equal(record.caller_identity_authority, "NATIVE_TRANSPORT");
    assert.equal(record.trust_boundary, "RENDERER_TO_NATIVE_HOST");
    owners.add(record.owner);
  }
  assert.ok(owners.size >= 5, "a single service owns everything");
  assert.equal(owners.has("DesktopService"), false);
  // بوابة الأدوات ليست مالكة لأي عملية IPC: لا يوجد باب يصل إليها من العارض.
  assert.equal(owners.has("ToolGatewayService"), false);
  assert.equal(new Set(registry.operations.map((r) => r.operation)).size, 12);
});

test("P04-CT-003 effects are declared, not hidden", () => {
  for (const record of registry.operations) {
    const side = record.effect === "SIDE_EFFECTING";
    assert.equal(record.idempotency, side ? "REQUIRED" : "NOT_REQUIRED", record.operation);
    assert.equal(PHASE04_SIDE_EFFECTING.includes(record.operation), side, record.operation);
    if (!side) assert.ok(["READ", "READ_RESOURCE"].includes(record.effect_class), record.operation);
    else assert.ok(!["READ", "READ_RESOURCE"].includes(record.effect_class), record.operation);
  }
  const effect = (op: string): string | undefined => registry.operations.find((r) => r.operation === op)?.effect_class;
  assert.equal(effect("skill.list"), "READ");
  assert.equal(effect("tool.list"), "READ");
  // التحديث من الخادم يلمس الشبكة فعلًا، فيُصنَّف فحص شبكة لا قراءة.
  assert.equal(effect("mcp.refresh"), "NETWORK_PROBE");
  // الجواب على موافقة تحكّمٌ في تنفيذ معلّق، لا قراءة ولا كتابة إعداد.
  assert.equal(effect("tool.approval.respond"), "CONTROL");
});

test("P04-CT-004 every registry schema reference resolves", () => {
  for (const record of registry.operations) {
    assert.ok(schemaReferenceExists(record.request_schema), record.request_schema);
    assert.ok(schemaReferenceExists(record.response_schema), record.response_schema);
  }
});

for (const operation of PHASE04_OPERATIONS) {
  test(`P04-CT-005 ${operation} accepts its minimal valid request`, () => {
    const result = validatePhase04RequestPayload(operation, REQUESTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

for (const operation of PHASE04_OPERATIONS) {
  test(`P04-CT-006 ${operation} returns a result its schema accepts`, () => {
    const result = validatePhase04ResultPayload(operation, RESULTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

test("P04-CT-007 an undeclared field is refused: the payload is closed", () => {
  for (const [operation, payload] of [
    ["mcp.register", { name: "x", endpoint: "http://127.0.0.1:4200", command: "cmd.exe" }],
    ["tool.approval.respond", { approval_id: APPROVAL_ID, decision: "GRANT", tool_id: "anything" }],
    ["skill.configure", { skill_id: "polaris.skill.local-analysis", enabled: true, allowed_tools: ["x"] }],
  ] as const) {
    const result = validatePhase04RequestPayload(operation as Phase04Operation, payload);
    assert.equal(result.ok, false, `${operation} accepted an undeclared field`);
  }
});

// تغيير عقد معلن (PHASE-06، 2026-10-21): عنوان https عامّ يُقبل نقلًا بعيدًا؛ ما عداه خارج الحلقة المحلية يبقى مرفوضًا.
test("P04-CT-008 an MCP registration cannot name a destination outside the loopback interface", () => {
  for (const endpoint of [
    "http://example.invalid/mcp",
    "https://user:pw@example.invalid/mcp",
    "https://example.invalid/mcp?key=1",
    "http://10.0.0.5:4200",
    "http://127.0.0.1.evil.example/mcp",
    "http://[2001:db8::1]:4200",
    "file:///C:/tools/server",
  ]) {
    const result = validatePhase04RequestPayload("mcp.register", { name: "x", endpoint });
    assert.equal(result.ok, false, `${endpoint} was accepted`);
  }
  assert.equal(validatePhase04RequestPayload("mcp.register", { name: "x", endpoint: "http://127.0.0.1:4200" }).ok, true);
  assert.equal(validatePhase04RequestPayload("mcp.register", { name: "x", endpoint: "http://localhost:4200/mcp" }).ok, true);
  assert.equal(validatePhase04RequestPayload("mcp.register", { name: "x", endpoint: "https://learn.microsoft.com/api/mcp", transport: "REMOTE_HTTPS" }).ok, true);
});

test("P04-CT-009 a credential-shaped field cannot ride in a Phase-04 payload", () => {
  const result = validatePhase04RequestPayload("mcp.register", {
    name: "x",
    endpoint: "http://127.0.0.1:4200",
    api_key: "sk-secret",
  });
  assert.equal(result.ok, false);
  const hits = findSecretsDeep({ api_key: "sk-secret" }, "/payload");
  assert.ok(hits.length > 0, "the hygiene scanner missed a credential key");
});

test("P04-CT-010 a side-effecting Phase-04 operation needs an idempotency key in the envelope", () => {
  for (const operation of PHASE04_SIDE_EFFECTING) {
    const doc = envelopeFor(operation, REQUESTS[operation]);
    delete doc["idempotency_key"];
    const result = validateContract("IPCEnvelopeV1", doc);
    assert.equal(result.ok, false, `${operation} validated without an idempotency key`);
  }
});

test("P04-CT-011 a read-only Phase-04 operation is not forced to carry a key", () => {
  for (const operation of PHASE04_OPERATIONS.filter((op) => !isPhase04SideEffecting(op))) {
    const result = validateContract("IPCEnvelopeV1", envelopeFor(operation, REQUESTS[operation]));
    assert.ok(result.ok, `${operation}: ${result.ok ? "" : JSON.stringify(result.errors)}`);
  }
});

test("P04-CT-012 there is no operation that can execute a tool or call an MCP server freely", () => {
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  for (const forbidden of FORBIDDEN_TOOL_OPERATIONS) {
    assert.equal(isPhase04Operation(forbidden), false, `${forbidden} is in the vocabulary`);
    assert.equal(envelope.includes(forbidden), false, `${forbidden} is in the envelope enum`);
  }
  // ولا حمولة مسجَّلة تحمل حقل حجج أداة أو اسم أداة حرًّا.
  const text = JSON.stringify(registry);
  for (const field of ["arguments", "command", "argv", "script"]) {
    assert.equal(text.includes(`"${field}"`), false, `${field} appears in the Phase-04 registry`);
  }
});

test("P04-CT-013 a tool descriptor must declare at least one effect and cannot be silently read-only", () => {
  const withoutEffects = { ...TOOL_VIEW, effects: [] as string[] };
  assert.equal(validateAgainstSchemaReference("desktop-p04-domain.schema.json#/$defs/ToolViewV1", withoutEffects).ok, false);
  const unknownEffect = { ...TOOL_VIEW, effects: ["ANYTHING_GOES"] };
  assert.equal(validateAgainstSchemaReference("desktop-p04-domain.schema.json#/$defs/ToolViewV1", unknownEffect).ok, false);
});

test("P04-CT-014 an approval view always carries its binding: mission, tool, arguments digest, effects and expiry", () => {
  const complete = RESULTS["approval.list"] as { approvals: Record<string, unknown>[] };
  const approval = complete.approvals[0] as Record<string, unknown>;
  for (const field of ["mission_id", "tool_id", "arguments_digest", "effects", "expires_at"]) {
    const partial = { ...approval };
    delete partial[field];
    assert.equal(
      validateAgainstSchemaReference("desktop-p04-domain.schema.json#/$defs/ApprovalViewV1", partial).ok,
      false,
      `an approval without ${field} validated`,
    );
  }
});

test("P04-CT-015 a network policy cannot declare remote egress for a tool", () => {
  // الادّعاء: لا سياسة شبكة تمنح خروجًا حرًّا. Phase-04 أعلن NONE وLOOPBACK_ONLY، وPhase-05
  // أضاف WEB_NAVIGATION_POLICY لأدوات المتصفّح المدمجة وحدها (تُختم في المضيف ولا تحملها
  // أداة MCP)، وPhase-06 أضاف CONNECTOR_EGRESS_POLICY لأدوات الموصلات المدمجة وحدها (المضيف
  // والقالب والأسلوب من الموصل الذي سجّله المستخدم، وبوابة الموصلات تفرضها). لا قيمة تسمّي
  // خروجًا عامًّا، والقيمة العامّة ما زالت مرفوضة بالمخطط.
  const values = [...schemaEnum("desktop-p04-domain.schema.json", "NetworkPolicy")];
  assert.deepEqual(values.slice(0, 2), ["NONE", "LOOPBACK_ONLY"]);
  for (const value of values) {
    // PHASE-06: MCP_REGISTERED_HTTPS لأداة MCP غير موثوقة من خادم https سجّله المستخدم، وأثرها الخارجي يوجب الموافقة في كل نداء.
    assert.ok(["NONE", "LOOPBACK_ONLY", "WEB_NAVIGATION_POLICY", "CONNECTOR_EGRESS_POLICY", "MCP_REGISTERED_HTTPS"].includes(value), `${value} is an unreviewed network policy`);
    assert.doesNotMatch(value, /REMOTE|ANY|ALL|UNRESTRICTED|OPEN/, `${value} names free egress`);
  }
  const remote = { ...TOOL_VIEW, network_policy: "REMOTE_ALLOWED" };
  assert.equal(validateAgainstSchemaReference("desktop-p04-domain.schema.json#/$defs/ToolViewV1", remote).ok, false);
});

test("P04-CT-016 MCP transports are loopback HTTP and registered public HTTPS; no process-spawning transport", () => {
  assert.deepEqual([...schemaEnum("desktop-p04-domain.schema.json", "McpTransport")], ["LOOPBACK_HTTP", "REMOTE_HTTPS"]);
  const spawned = { ...SERVER_VIEW, transport: "STDIO" };
  assert.equal(validateAgainstSchemaReference("desktop-p04-domain.schema.json#/$defs/McpServerViewV1", spawned).ok, false);
});

test("P04-CT-017 every declared error category has a mapping entry", () => {
  const mapping = loadDesktopErrorMapping();
  for (const record of registry.operations) {
    for (const category of record.error_categories) {
      assert.ok(mapping.entries.some((entry) => entry.category === category), `${category} has no mapping entry`);
    }
  }
});

test("P04-CT-018 a tool result surface cannot carry a raw body or a reasoning trace", () => {
  const text = JSON.stringify(RESULTS);
  for (const forbidden of ["reasoning", "chain_of_thought", "raw_body", "stdout"]) {
    assert.equal(text.includes(forbidden), false, `${forbidden} appears in a Phase-04 result`);
  }
  // والنتيجة تعبر ببصمتها وملخّصها فقط: لا حقل محتوى خام في المخطط.
  const invocation = { ...(RESULTS["tool.activity.list"] as { invocations: Record<string, unknown>[] }).invocations[0], raw_result: "x" };
  assert.equal(
    validateAgainstSchemaReference("desktop-p04-domain.schema.json#/$defs/ToolInvocationViewV1", invocation).ok,
    false,
  );
});
