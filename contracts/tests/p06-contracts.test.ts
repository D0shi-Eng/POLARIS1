// P06-CT — عقود Phase-06: المفردات، والسجل، والحمولات، والنتائج، والظرف 1.6.
//
// الادّعاء: ثمانٍ وعشرون عملية مغلقة، تسافر في الظرف الوحيد بإصدار 1.6، كلٌّ بحمولة
// مقيّدة ومالك واحد وصنف أثر صريح. لا واحدة منها تنفّذ عملية موصل على خدمة، ولا تكشف
// قيمة سرّ، ولا تسمّي عنوانًا حرًّا لوكيل، ولا تحمل كلفةً بلا مصدر.

import test from "node:test";
import assert from "node:assert/strict";

import { findSecretsDeep } from "../src/secret-hygiene.js";
import { schemaReferenceExists, validateAgainstSchemaReference, validateContract } from "../src/validator.js";
import {
  FORBIDDEN_PHASE06_OPERATIONS,
  PHASE05_OPERATIONS,
  PHASE06_OPERATIONS,
  PHASE06_SIDE_EFFECTING,
  isPhase06Operation,
  isPhase06SideEffecting,
  loadDesktopErrorMapping,
  loadPhase06IpcRegistry,
  validatePhase06RequestPayload,
  validatePhase06ResultPayload,
  type Phase06Operation,
} from "../src/desktop/index.js";
import { clone, fixture } from "./helpers.js";
import { schemaEnum } from "./p01-helpers.js";

const registry = loadPhase06IpcRegistry();

const CONNECTOR_ID = "11111111-1111-4111-8111-111111111111";
const MISSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const INVOCATION_ID = "44444444-4444-4444-8444-444444444444";
const BUDGET_ID = "55555555-5555-4555-8555-555555555555";
const PRICING_ID = "66666666-6666-4666-8666-666666666666";
const IMPORT_ID = "77777777-7777-4777-8777-777777777777";
const EVENT_ID = "88888888-8888-4888-8888-888888888888";
const DIGEST = "a".repeat(64);
const STAMP = "2026-09-23T00:00:00Z";

function envelopeFor(operation: string, payload: unknown, version = "1.6"): Record<string, unknown> {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json")) as Record<string, unknown>;
  doc["contract_version"] = version;
  doc["protocol_version"] = version;
  doc["operation"] = operation;
  doc["payload"] = payload;
  if (isPhase06Operation(operation) && isPhase06SideEffecting(operation)) {
    doc["idempotency_key"] = "p06-idem-0001-0002-0003";
  }
  return doc;
}

const REST = {
  base_url: "http://127.0.0.1:4700/api",
  egress_class: "LOOPBACK",
  allowed_paths: ["/items", "/items/{item_id}"],
  allowed_methods: ["GET", "POST"],
  auth_mode: "BEARER_TOKEN",
  key_source: "ENVIRONMENT",
  environment_variable: "POLARIS_CONNECTOR_TEST_TOKEN",
  timeout_ms: 5000,
  max_response_bytes: 65536,
};

const OPERATION = {
  operation_id: "items.get",
  title: "Get an item",
  action: "READ",
  method: "GET",
  path: "/items/{item_id}",
  params: [{ name: "item_id", location: "PATH", kind: "STRING", required: true, max_length: 64, minimum: null, maximum: null, allowed: [] }],
  idempotency: { mode: "NONE" },
  resource_id_pointer: null,
  result_fields: ["/name"],
  cost_pointer: null,
  cost_currency: null,
};

const REQUESTS: Readonly<Record<Phase06Operation, unknown>> = {
  "connector.list": {},
  "connector.get": { connector_id: CONNECTOR_ID },
  "connector.register": { provider: "polaris.rest", category: "CUSTOM_API", display_name: "Fixture items", rest: REST, operations: [OPERATION] },
  "connector.configure": { connector_id: CONNECTOR_ID, enabled: true },
  "connector.remove": { connector_id: CONNECTOR_ID },
  "connector.test": { connector_id: CONNECTOR_ID },
  "connector.credential.set": { connector_id: CONNECTOR_ID },
  "connector.credential.clear": { connector_id: CONNECTOR_ID },
  "connector.openapi.import": { spec: '{"openapi":"3.0.3","paths":{}}' },
  "connector.openapi.approve": { import_id: IMPORT_ID, operation_ids: ["list_items"], display_name: "Imported", category: "CUSTOM_API", rest: REST },
  "connector.preset.list": {},
  "connector.preset.register": { preset_id: "slack.read", display_name: "Team Slack" },
  "usage.summary": {},
  "usage.list": { mission_id: MISSION_ID, limit: 20 },
  "budget.list": {},
  "budget.set": { scope: "CONNECTOR", scope_key: CONNECTOR_ID, dimension: "EXTERNAL_CALLS", limit: 3, mode: "HARD" },
  "budget.remove": { budget_id: BUDGET_ID },
  "pricing.list": {},
  "pricing.set": { target_kind: "MODEL", target_id: "local-openai-compatible:fixture-chat", unit: "PER_MILLION_INPUT_TOKENS", amount: "2.5", currency: "USD", source_note: "TEST FIXTURE price" },
  "pricing.remove": { pricing_id: PRICING_ID },
  "observability.health": {},
  "observability.events": { limit: 50, component: "CONNECTOR_GATEWAY", min_severity: "WARNING" },
  "observability.metrics": {},
  "observability.errors": {},
  "observability.alerts": { include_resolved: true },
  "diagnostics.export": {},
  "config.describe": {},
  "config.effective": { project_id: PROJECT_ID },
  "config.set": { layer: "PROJECT", scope_id: PROJECT_ID, key: "connectors.max_external_calls_per_mission", value: 3 },
  "config.reset": { layer: "USER", key: "privacy.persist_memory" },
};

const HEALTH = { subject: "CONNECTOR", subject_id: CONNECTOR_ID, state: "UNKNOWN", reason_code: "NOT_MEASURED_SINCE_START", measured_this_session: false };
const VIEW = {
  descriptor: {
    connector_id: CONNECTOR_ID,
    provider: "polaris.rest",
    display_name_key: "connector.provider.polaris.rest",
    display_name: "Fixture items",
    description_key: "connector.category.CUSTOM_API",
    version: "1",
    category: "CUSTOM_API",
    capabilities: [{ operation_id: "items.get", action: "READ", title: "Get an item" }],
    auth_mode: "BEARER_TOKEN",
    effects: ["NETWORK_EGRESS"],
    risk_class: "MODERATE",
    supports_read: true,
    supports_write: false,
    supports_webhook: false,
    supports_polling: false,
    supports_search: false,
    supports_files: false,
    enabled: false,
    status: "DISABLED",
    provenance: { origin: "USER_REGISTERED", import_id: null, spec_digest: null, registered_at: STAMP },
    egress_class: "LOOPBACK",
  },
  auth: { mode: "BEARER_TOKEN", required: true, configured: true, source: "ENVIRONMENT", reference: `secret://connectors/${CONNECTOR_ID}/default`, environment_variable: "POLARIS_CONNECTOR_TEST_TOKEN", store_available: true },
  health: HEALTH,
  operation_count: 1,
  rest: { base_url: "http://127.0.0.1:4700/api", egress_class: "LOOPBACK", allowed_paths: ["/items/{item_id}"], allowed_methods: ["GET"], timeout_ms: 5000, max_response_bytes: 65536, requests_per_minute: 60, max_concurrent: 2 },
  registered_at: STAMP,
};
const TOTALS = { key: "ALL", calls: 2, input_tokens_reported: 150, output_tokens_reported: 60, calls_without_reported_tokens: 0, wall_ms: 40, external_requests: 1, costs: [{ currency: "USD", provenance: "ESTIMATED", micros: 540, calls: 1 }], calls_with_unknown_cost: 1 };
const COST_UNKNOWN = { micros: null, currency: null, provenance: "UNKNOWN", pricing_source: null };
const RECORD = {
  record_id: INVOCATION_ID,
  recorded_at: STAMP,
  category: "CONNECTOR",
  subject_id: INVOCATION_ID,
  mission_id: MISSION_ID,
  project_id: null,
  provider_id: null,
  model_id: null,
  connector_id: CONNECTOR_ID,
  tool_id: `connector:${CONNECTOR_ID}:items.get`,
  input_tokens: null,
  output_tokens: null,
  cached_tokens: null,
  tokens_provenance: "UNKNOWN",
  wall_ms: 12,
  external_requests: 1,
  cost: COST_UNKNOWN,
};
const BUDGET = { budget_id: BUDGET_ID, scope: "CONNECTOR", scope_key: CONNECTOR_ID, dimension: "EXTERNAL_CALLS", limit: 3, currency: null, mode: "HARD", warn_ratio_pct: 80, created_at: STAMP, updated_at: STAMP };
const PRICE = { entry: { pricing_id: PRICING_ID, target_kind: "MODEL", target_id: "local-openai-compatible:fixture-chat", unit: "PER_MILLION_INPUT_TOKENS", amount_micros: 2500000, currency: "USD", source_note: "TEST FIXTURE price", created_at: STAMP }, amount: "2.5", provenance: "ESTIMATED" };
const COUNTERS = Object.fromEntries(
  ["mission_count", "mission_success_count", "mission_failed_count", "model_calls", "tool_calls", "connector_calls", "approval_requests", "approval_denials", "browser_actions", "computer_actions", "memory_writes", "errors"].map((k) => [k, 0]),
);
const METRICS = { scope: "SINCE_START", counters: COUNTERS, latency: [], errors_by_code: [{ component: "CONNECTOR_GATEWAY", reason_code: "RATE_LIMITED", count: 1 }], error_overflow: 0, distinct_error_keys: 1 };
const OVERVIEW = { measured_at: STAMP, overall: "HEALTHY", components: [{ ...HEALTH, subject: "STORAGE", subject_id: "polaris.db", state: "HEALTHY", reason_code: "QUICK_CHECK_OK", measured_at: STAMP, latency_ms: 1, measured_this_session: true }] };
const RESOLVED = { key: "connectors.max_external_calls_per_mission", value: 3, source: "PROJECT", clamped: false, present_layers: ["PROJECT"], ignored_layers: [] };
const STATUS = { state: "OK", schema_version: 1, found_version: 1, unreadable_rows: 0, config_version: 3 };
const SETTING = {
  key: "privacy.persist_memory",
  kind: "BOOLEAN",
  state: "EDITABLE",
  default: false,
  layers: ["USER", "PROJECT", "MISSION", "SECURITY"],
  security_bearing: true,
  ceiling: null,
  applies: "NEXT_OPERATION",
  consumer: "p06 invocation guard and connector gateway: nothing leaves the device",
  label_key: "config.setting.privacy.persist_memory",
  hint_key: "config.hint.privacy.persist_memory",
  bounds: { min: null, max: null, min_decimal: null, max_decimal: null, allowed: [], max_length: null, max_items: null },
};
const SECTIONS = ["GENERAL", "APPEARANCE", "LANGUAGE", "MODELS", "PROVIDERS", "AGENTS", "SKILLS", "TOOLS", "MCP", "MEMORY", "BROWSER", "COMPUTER", "CONNECTORS", "PRIVACY", "SECURITY", "BUDGETS", "COST", "OBSERVABILITY", "ADVANCED"].map((section) => ({
  section,
  label_key: `config.section.${section}`,
  settings: [SETTING],
}));

const RESULTS: Readonly<Record<Phase06Operation, unknown>> = {
  "connector.list": { connectors: [VIEW], unreadable: 0 },
  "connector.get": {
    connector: VIEW,
    operations: [{ operation: OPERATION, tool_id: `connector:${CONNECTOR_ID}:items.get`, side_effect: false, retry_safe: true }],
    invocations: [{ invocation_id: INVOCATION_ID, connector_id: CONNECTOR_ID, operation_id: "items.get", mission_id: MISSION_ID, action: "READ", status: "SUCCEEDED", attempts: 1, http_status: 200, result_digest: DIGEST, resource_refs: [], summary: "name=blue", latency_ms: 4, started_at: STAMP }],
  },
  "connector.register": { connector: VIEW },
  "connector.configure": { connector: VIEW },
  "connector.remove": { connector_id: CONNECTOR_ID, removed: true, tools_removed: 1 },
  "connector.test": { connector_id: CONNECTOR_ID, probe_operation: "items.list", health: { ...HEALTH, state: "HEALTHY", reason_code: "CALL_SUCCEEDED", measured_at: STAMP, latency_ms: 3, measured_this_session: true } },
  "connector.credential.set": { connector_id: CONNECTOR_ID, outcome: "STORED", auth: VIEW.auth },
  "connector.credential.clear": { connector_id: CONNECTOR_ID, outcome: "NOTHING_TO_CLEAR", auth: VIEW.auth },
  "connector.openapi.import": { import_id: IMPORT_ID, title: "Fixture items API", suggested_base_url: "http://127.0.0.1:4700/api", operations: [OPERATION], rejected: [{ method: "DELETE", path: "/items/{item_id}", reason: "HEADER_OR_COOKIE_PARAM" }], spec_digest: DIGEST, status: "PROPOSED" },
  "connector.openapi.approve": { connector: VIEW },
  "connector.preset.list": {
    presets: [
      {
        preset_id: "slack.read",
        display_name: "Slack",
        category: "MESSAGING",
        description: "Read channel lists and recent messages from a Slack workspace with a bot token.",
        base_url: "https://slack.com",
        auth_mode: "BEARER_TOKEN",
        setup_hint: "Create a Slack app, add channels:read and channels:history, install it and paste its bot token.",
        docs_url: "https://api.slack.com/methods/conversations.history",
        operations: [{ operation_id: "conversations.list", title: "List channels", action: "READ" }],
      },
    ],
  },
  "connector.preset.register": { connector: VIEW },
  "usage.summary": { day: "2026-09-23", today: TOTALS, mission: null, project: null, by_provider: [], by_model: [TOTALS], by_connector: [], by_category: [], show_estimated: true, provenance_vocabulary: ["PROVIDER_REPORTED", "LOCALLY_MEASURED", "ESTIMATED", "UNKNOWN"], note: "amounts of different provenance and currency are never summed together; no currency is converted" },
  "usage.list": { records: [RECORD] },
  "budget.list": { budgets: [{ budget: BUDGET, window: "UTC_DAY", usage: { budget_id: BUDGET_ID, scope: "CONNECTOR", scope_key: CONNECTOR_ID, dimension: "EXTERNAL_CALLS", mode: "HARD", limit: 3, used: 1, reserved: 0, unmetered_calls: 0, state: "WITHIN" }, limit_display: "3", used_display: "1" }] },
  "budget.set": { budget: BUDGET, limit_display: "3" },
  "budget.remove": { budget_id: BUDGET_ID, removed: true },
  "pricing.list": { entries: [PRICE] },
  "pricing.set": { entry: PRICE },
  "pricing.remove": { pricing_id: PRICING_ID, removed: true },
  "observability.health": OVERVIEW,
  "observability.events": { events: [{ event_id: EVENT_ID, timestamp: STAMP, component: "CONNECTOR_GATEWAY", category: "INVOCATION", severity: "INFO", mission_id: MISSION_ID, operation: "connector.invoke", result: "SUCCEEDED", duration_ms: 4, reason_code: "OUTCOME_CONFIRMED", provenance: "LOCALLY_MEASURED" }], label: "STRUCTURED EVENTS — DIAGNOSTIC, NOT AUDIT" },
  "observability.metrics": { metrics: METRICS, queue_depths: { running_missions: 0, running_model_requests: 0, pending_approvals: 1, connector_requests_in_flight: 0 } },
  "observability.errors": { errors_by_code: METRICS.errors_by_code, overflow: 0, distinct_keys: 1, scope: "SINCE_START" },
  "observability.alerts": { alerts: [{ alert_id: EVENT_ID, kind: "BUDGET_NEAR_LIMIT", severity: "WARNING", subject: `budget:${BUDGET_ID}`, reason_code: "NEAR_LIMIT", first_at: STAMP, last_at: STAMP, occurrences: 2, state: "OPEN" }] },
  "diagnostics.export": {
    file_name: "polaris-diagnostics-20260923000000.json",
    bytes: 2048,
    level: "STANDARD",
    sections: ["versions", "health", "recent_reason_codes", "config_summary", "sensitive", "metrics", "queue_depths"],
    redactions: 0,
    document: {
      schema: "polaris.diagnostics.v1",
      generated_at: STAMP,
      level: "STANDARD",
      label: "LOCAL DIAGNOSTICS — REDACTED, NO SECRETS",
      versions: { app: "0.1.0", ipc_protocol: "1.6", contract: "1.6", storage_schema: 5, config_schema: 1 },
      health: OVERVIEW,
      recent_reason_codes: [{ component: "CONNECTOR_GATEWAY", reason_code: "OUTCOME_CONFIRMED", count: 1 }],
      config_summary: [{ key: "privacy.persist_memory", value: false, source: "DEFAULT" }],
      sensitive: [{ subject: `connector:${CONNECTOR_ID}`, configured: true, source: "ENVIRONMENT", reference: `secret://connectors/${CONNECTOR_ID}/default`, last_updated: null }],
      metrics: METRICS,
      queue_depths: { running_missions: 0, running_model_requests: 0, pending_approvals: 0, connector_requests_in_flight: 0 },
      redactions: 0,
    },
  },
  "config.describe": { sections: SECTIONS, status: STATUS, layers: ["USER", "PROJECT", "MISSION", "SECURITY"] },
  "config.effective": { scope: { project_id: PROJECT_ID, mission_id: null }, values: [RESOLVED], status: STATUS, sensitive: [] },
  "config.set": { key: RESOLVED.key, layer: "PROJECT", value: RESOLVED },
  "config.reset": { key: "privacy.persist_memory", layer: "USER", removed: true, value: { key: "privacy.persist_memory", value: false, source: "DEFAULT", clamped: false, present_layers: [], ignored_layers: [] } },
};

test("P06-CT-001 the Phase-06 vocabulary in code, schema, envelope and registry is one list", () => {
  // 28 + connector.preset.list و connector.preset.register (PHASE-05، 2026-10-20).
  assert.equal(PHASE06_OPERATIONS.length, 30);
  assert.deepEqual([...schemaEnum("desktop-operation.schema.json", "Phase06DesktopOperation")], [...PHASE06_OPERATIONS]);
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  const start = envelope.indexOf(PHASE05_OPERATIONS[PHASE05_OPERATIONS.length - 1] as string) + 1;
  assert.deepEqual(envelope.slice(start, start + PHASE06_OPERATIONS.length), [...PHASE06_OPERATIONS]);
  assert.deepEqual(registry.operations.map((r) => r.operation), [...PHASE06_OPERATIONS]);
});

test("P06-CT-002 the Phase-06 registry is valid, complete, routed and owned by named services", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
  assert.equal(registry.phase, "PHASE-06");
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.equal(record.routing_status, "ROUTED");
    assert.equal(record.envelope_version, "1.6");
    assert.equal(record.phase_introduced, "PHASE-06");
    assert.equal(record.caller_identity_authority, "NATIVE_TRANSPORT");
    owners.add(record.owner);
  }
  assert.ok(owners.size >= 5, "a single service owns everything");
  // البوابتان والمحوّلات ليست مالكة لأي عملية IPC: لا مسار من العارض إليها.
  for (const unreachable of ["ToolGatewayService", "ConnectorGateway", "RestAdapter", "HttpClient"]) {
    assert.equal(owners.has(unreachable), false, `${unreachable} owns an IPC operation`);
  }
});

test("P06-CT-003 effects are declared: reads are reads, and every change needs a key", () => {
  for (const record of registry.operations) {
    const side = record.effect === "SIDE_EFFECTING";
    assert.equal(record.idempotency, side ? "REQUIRED" : "NOT_REQUIRED", record.operation);
    assert.equal(PHASE06_SIDE_EFFECTING.includes(record.operation), side, record.operation);
  }
  const effect = (op: string): string | undefined => registry.operations.find((r) => r.operation === op)?.effect_class;
  assert.equal(effect("connector.test"), "NETWORK_PROBE");
  assert.equal(effect("connector.credential.set"), "SECRET_WRITE");
  assert.equal(effect("config.set"), "WRITE_CONFIG");
  assert.equal(effect("diagnostics.export"), "CREATE_LOCAL_DATA");
  for (const read of ["usage.summary", "observability.health", "config.effective", "connector.list"]) assert.equal(effect(read), "READ", read);
});

test("P06-CT-004 every registry schema reference resolves", () => {
  for (const record of registry.operations) {
    assert.ok(schemaReferenceExists(record.request_schema), record.request_schema);
    assert.ok(schemaReferenceExists(record.response_schema), record.response_schema);
  }
});

for (const operation of PHASE06_OPERATIONS) {
  test(`P06-CT-005 ${operation} accepts its valid request`, () => {
    const result = validatePhase06RequestPayload(operation, REQUESTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

for (const operation of PHASE06_OPERATIONS) {
  test(`P06-CT-006 ${operation} returns a result its schema accepts`, () => {
    const result = validatePhase06ResultPayload(operation, RESULTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

test("P06-CT-007 an undeclared field is refused: an agent-free, URL-free, value-free payload", () => {
  for (const [operation, payload] of [
    ["connector.test", { connector_id: CONNECTOR_ID, url: "http://169.254.169.254/" }],
    ["connector.configure", { connector_id: CONNECTOR_ID, base_url: "https://evil.example" }],
    ["connector.get", { connector_id: CONNECTOR_ID, operation: "items.get", arguments: {} }],
    ["config.set", { layer: "USER", key: "privacy.persist_memory", value: true, force: true }],
    ["budget.set", { scope: "DAY", dimension: "EXTERNAL_CALLS", limit: 1, bypass: true }],
    ["connector.register", { ...(REQUESTS["connector.register"] as object), headers: { Host: "evil" } }],
  ] as const) {
    assert.equal(validatePhase06RequestPayload(operation, payload).ok, false, `${operation} accepted an undeclared field`);
  }
});

test("P06-CT-008 a side-effecting Phase-06 operation needs an idempotency key and version 1.6", () => {
  const ok = validateContract("IPCEnvelopeV1", envelopeFor("config.set", REQUESTS["config.set"]));
  assert.ok(ok.ok, ok.ok ? "" : JSON.stringify(ok.errors));
  const keyless = envelopeFor("config.set", REQUESTS["config.set"]);
  delete keyless["idempotency_key"];
  assert.equal(validateContract("IPCEnvelopeV1", keyless).ok, false, "a keyless config.set was accepted");
  const read = validateContract("IPCEnvelopeV1", envelopeFor("usage.summary", {}));
  assert.ok(read.ok, read.ok ? "" : JSON.stringify(read.errors));
});

test("P06-CT-009 no operation performs a connector call, reveals a secret or overrides a limit", () => {
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  for (const forbidden of FORBIDDEN_PHASE06_OPERATIONS) {
    assert.equal(envelope.includes(forbidden), false, `${forbidden} is in the envelope`);
    assert.equal((PHASE06_OPERATIONS as readonly string[]).includes(forbidden), false);
  }
  for (const operation of PHASE06_OPERATIONS) {
    assert.doesNotMatch(operation, /invoke|execute|\.call|request|reveal|secret\.get|override/, operation);
  }
});

test("P06-CT-010 a credential-shaped field cannot ride in any Phase-06 payload or result", () => {
  for (const operation of PHASE06_OPERATIONS) {
    assert.deepEqual(findSecretsDeep(REQUESTS[operation], "/payload"), [], `${operation} request example carries a credential shape`);
    assert.deepEqual(findSecretsDeep(RESULTS[operation], "/result"), [], `${operation} result example carries a credential shape`);
  }
  const smuggled = { connector_id: CONNECTOR_ID, api_key: "sk-live-0123456789abcdefghij" };
  assert.equal(validatePhase06RequestPayload("connector.credential.set", smuggled).ok, false);
  // حالة الاعتماد لا تملك حقل قيمة أصلًا.
  const withValue = { ...VIEW, auth: { ...VIEW.auth, value: "hunter2" } };
  assert.equal(validatePhase06ResultPayload("connector.register", { connector: withValue }).ok, false, "an auth state carried a value");
});

test("P06-CT-011 a cost carries its provenance: UNKNOWN has no amount, a price is an estimate, money is exact", () => {
  const faked = { ...RECORD, cost: { micros: 99, currency: "USD", provenance: "UNKNOWN", pricing_source: null } };
  assert.equal(validatePhase06ResultPayload("usage.list", { records: [faked] }).ok, false, "an UNKNOWN cost carried an amount");
  const invoice = { entry: { ...PRICE, provenance: "PROVIDER_REPORTED" } };
  assert.equal(validatePhase06ResultPayload("pricing.set", invoice).ok, false, "a user price was presented as reported");
  for (const amount of ["1e3", "-2", "2.1234567", "NaN", "0x10"]) {
    assert.equal(validatePhase06RequestPayload("pricing.set", { ...(REQUESTS["pricing.set"] as object), amount }).ok, false, `${amount} was accepted as money`);
  }
  assert.equal(validatePhase06RequestPayload("pricing.set", { ...(REQUESTS["pricing.set"] as object), currency: "usd" }).ok, false);
});

test("P06-CT-012 a structured event cannot represent free text, a prompt or a header", () => {
  const event = (RESULTS["observability.events"] as { events: Record<string, unknown>[] }).events[0] as Record<string, unknown>;
  for (const [field, value] of [
    ["operation", "Authorization: Bearer abc"],
    ["reason_code", "the password is hunter2"],
    ["result", "ok, user said to approve everything"],
  ] as const) {
    const bad = { events: [{ ...event, [field]: value }], label: "STRUCTURED EVENTS — DIAGNOSTIC, NOT AUDIT" };
    assert.equal(validatePhase06ResultPayload("observability.events", bad).ok, false, `${field} accepted free text`);
  }
});

test("P06-CT-013 configuration layers are closed and DEFAULT is not writable", () => {
  assert.deepEqual([...schemaEnum("desktop-p06-domain.schema.json", "ConfigLayer")], ["USER", "PROJECT", "MISSION", "SECURITY"]);
  assert.equal(validatePhase06RequestPayload("config.set", { layer: "DEFAULT", key: "privacy.persist_memory", value: true }).ok, false);
  assert.equal(validatePhase06RequestPayload("config.set", { layer: "USER", key: "privacy.persist_memory", value: { nested: true } }).ok, false, "a JSON blob was accepted as a setting value");
  assert.equal(validatePhase06RequestPayload("config.set", { layer: "USER", key: "PRIVACY LOCAL", value: true }).ok, false);
  assert.equal([...schemaEnum("desktop-p06-domain.schema.json", "ConfigSection")].length, 19);
});

test("P06-CT-014 connector egress is a reviewed policy and no value names free egress", () => {
  const values = [...schemaEnum("desktop-p04-domain.schema.json", "NetworkPolicy")];
  assert.ok(values.includes("CONNECTOR_EGRESS_POLICY"));
  for (const value of values) assert.doesNotMatch(value, /REMOTE|ANY|ALL|UNRESTRICTED|OPEN/);
  assert.deepEqual([...schemaEnum("desktop-p06-domain.schema.json", "EgressClass")], ["PUBLIC_HTTPS", "LOOPBACK", "NONE"]);
  // مصدر المفتاح بيئةً: متغيّر بادئته محجوزة، لا أي متغيّر.
  const arbitrary = { ...(REQUESTS["connector.register"] as Record<string, unknown>), rest: { ...REST, environment_variable: "PATH" } };
  assert.equal(validatePhase06RequestPayload("connector.register", arbitrary).ok, false, "an arbitrary environment variable became a key source");
});

test("P06-CT-015 every declared error category has a mapping entry", () => {
  const mapping = loadDesktopErrorMapping();
  const categories = new Set<string>(mapping.entries.map((e) => e.category as string));
  for (const record of registry.operations) {
    for (const category of record.error_categories) assert.ok(categories.has(category), `${record.operation}: ${category}`);
  }
});
