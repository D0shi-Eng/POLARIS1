// P08-CT — عقود Phase-08: المفردات، والسجل، والحمولات، والنتائج، والظرف 1.7.
//
// الادّعاء: اثنتان وثلاثون عملية مغلقة، تسافر في الظرف الوحيد بإصدار 1.7، كلٌّ بحمولة مقيّدة
// ومالك واحد وصنف أثر صريح. لا واحدة منها تشغّل أمرًا أو Python أو تتصفّح أو تكتب في مساحة
// مهمّة أو تعيد رمز OAuth أو ترسل رسالة، ولا واحدة تعبر بمسار مطلق من جهاز المستخدم.

import test from "node:test";
import assert from "node:assert/strict";

import { findSecretsDeep } from "../src/secret-hygiene.js";
import { schemaReferenceExists, validateAgainstSchemaReference, validateContract } from "../src/validator.js";
import {
  FORBIDDEN_PHASE08_OPERATIONS,
  PHASE06_OPERATIONS,
  PHASE08_OPERATIONS,
  PHASE08_SIDE_EFFECTING,
  isPhase08Operation,
  isPhase08SideEffecting,
  loadDesktopErrorMapping,
  loadPhase08IpcRegistry,
  validatePhase08RequestPayload,
  validatePhase08ResultPayload,
  type Phase08Operation,
} from "../src/desktop/index.js";
import { clone, fixture } from "./helpers.js";
import { schemaEnum } from "./p01-helpers.js";

const registry = loadPhase08IpcRegistry();

const MISSION = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT = "33333333-3333-4333-8333-333333333333";
const ARTIFACT = "44444444-4444-4444-8444-444444444444";
const SCHEDULE = "55555555-5555-4555-8555-555555555555";
const CONNECTION = "66666666-6666-4666-8666-666666666666";
const PUBLICATION = "77777777-7777-4777-8777-777777777777";
const RUN = "88888888-8888-4888-8888-888888888888";
const DIGEST = "a".repeat(64);
const STAMP = "2026-09-25T00:00:00Z";
/** عرض مزوّد كما في عيّنة Phase-02 المعتمدة: المزوّد المخصّص يعود بالشكل نفسه. */
const PROVIDER_VIEW = (fixture("positive", "../phase-02/positive/provider-configure.result.json") as { provider: unknown }).provider;

function envelopeFor(operation: string, payload: unknown, version = "1.7"): Record<string, unknown> {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json")) as Record<string, unknown>;
  doc["contract_version"] = version;
  doc["protocol_version"] = version;
  doc["operation"] = operation;
  doc["payload"] = payload;
  if (isPhase08Operation(operation) && isPhase08SideEffecting(operation)) {
    doc["idempotency_key"] = "p08-idem-0001-0002-0003";
  }
  return doc;
}

const TEMPLATE = { title: "Digest", objective: "summarise the inputs", project_id: null, model_id: "ollama:qwen2.5:7b" };
const ATTACH = { attachment_id: ATTACHMENT, mission_id: MISSION, file_name: "notes.txt", workspace_ref: "inputs/notes.txt", file_kind: "TEXT", size_bytes: 10, sha256: DIGEST, classification: "USER_PROVIDED_UNTRUSTED", imported_at: STAMP };
const ART = {
  artifact_id: ARTIFACT, mission_id: MISSION, type: "DOCX", title: "Summary", file_ref: "outputs/summary.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 4096, sha256: DIGEST, created_at: STAMP, source_task: null,
  verification: { status: "VERIFIED", checks: [{ name: "reopens", passed: true, detail: "" }], facts: [["paragraphs", 3]] },
  preview: { excerpt: "Summary", facts: { paragraphs: 3 } },
  provenance: { producer: "polaris.artifact.document", authority: "RUNTIME_MEASURED_FILE", content_trust: "MODEL_GENERATED_UNTRUSTED" },
};
const SCHED = {
  schedule_id: SCHEDULE, name: "Morning digest", mission_template: TEMPLATE, timezone: "UTC+03:00", schedule: { kind: "DAILY", time: "07:30" },
  enabled: true, next_run: STAMP, last_run: null, last_mission_id: null, last_status: null, budget: {}, approval_policy: "WAIT_FOR_APPROVAL",
  created_at: STAMP, updated_at: STAMP, end_at: null, run_target: "SEPARATE_TASK", recent_runs: [{ run_id: RUN, schedule_id: SCHEDULE, mission_id: MISSION, trigger_kind: "RUN_NOW", status: "WAITING_FOR_APPROVAL", detail: "", triggered_at: STAMP }],
};
const CONN = { connection_id: CONNECTION, provider_id: "google", display_name: "Google", client_id: "user-client", scopes: "openid", status: "PENDING", stored_in_vault: false, expires_at: null, created_at: STAMP, updated_at: STAMP };
const PUB = { publication_id: PUBLICATION, artifact_id: ARTIFACT, publisher: "local-folder", status: "AWAITING_APPROVAL", target: "", created_at: STAMP, updated_at: STAMP };
const PKG = { package_id: "com.example.summary", name: "Summary", version: "1.0.0", author: "Example", manifest_sha256: DIGEST, signature_state: "UNSIGNED", source: "local-file", trust_state: "UNTRUSTED", rejection: null, imported_at: STAMP, grants_authority: false };

const REQUESTS: Readonly<Record<Phase08Operation, unknown>> = {
  "workspace.list": { mission_id: MISSION, depth: 3 },
  "workspace.preview": { mission_id: MISSION, path: "inputs/notes.txt" },
  "workspace.export": { mission_id: MISSION, path: "outputs/summary.docx" },
  "attachment.stage": { file_name: "notes.txt", content_base64: "YWxwaGE=" },
  "attachment.discard": { attachment_id: ATTACHMENT },
  "attachment.artifact.stage": { artifact_id: ATTACHMENT },
  "attachment.list": { mission_id: MISSION },
  "attachment.bind": { mission_id: MISSION, attachment_ids: [ATTACHMENT] },
  "artifact.list": { mission_id: MISSION },
  "artifact.get": { artifact_id: ARTIFACT },
  "execution.status": {},
  "execution.runs": { mission_id: MISSION },
  "execution.runtime.prepare": { runtime: "PYTHON" },
  "mission.model.set": { mission_id: MISSION, model_id: "ollama:qwen2.5:7b" },
  "schedule.list": {},
  "schedule.save": { name: "Morning digest", mission_template: TEMPLATE, timezone: "UTC+03:00", schedule: { kind: "WEEKLY", days: ["SUN", "WED"], time: "07:30" }, enabled: true, budget: {}, approval_policy: "WAIT_FOR_APPROVAL" },
  "schedule.enable": { schedule_id: SCHEDULE, enabled: false },
  "schedule.delete": { schedule_id: SCHEDULE },
  "schedule.run_now": { schedule_id: SCHEDULE },
  "oauth.list": {},
  "oauth.connect": { provider_id: "google", client_id: "user-client.apps.example", scopes: ["openid"] },
  "oauth.disconnect": { connection_id: CONNECTION },
  "voice.transcribe": { audio_base64: "UklGRg==", language: "ar" },
  "share.list": { object_type: "ARTIFACT", object_id: ARTIFACT },
  "share.set": { object_type: "ARTIFACT", object_id: ARTIFACT, member: "sara@example.test", role: "VIEWER" },
  "publish.list": {},
  "publish.propose": { artifact_id: ARTIFACT, publisher_id: "local-folder" },
  "publish.decide": { publication_id: PUBLICATION, decision: "GRANT" },
  "skill.package.list": {},
  "skill.package.import": { manifest_json: '{"package_id":"com.example.summary"}' },
  "device.export": { mission_id: MISSION },
  "device.import": { bundle_base64: "UEsDBA==" },
  "integration.settings.set": { key: "voice.transcription_endpoint", value: "http://127.0.0.1:8178" },
  "conversation.begin": { mission_id: MISSION },
  "conversation.continue": { mission_id: MISSION, message: "اكمل" },
  "conversation.get": { mission_id: MISSION },
  "conversation.index": {},
  "agent.catalog": {},
  "mission.specialist.set": { mission_id: MISSION, specialist_id: "finance.financial-analyst" },
  "conversation.update": { thread_id: MISSION, title: "تحية قصيرة", pinned: true, project_id: null },
  "conversation.delete": { thread_id: MISSION },
  "project.delete": { project_id: RUN },
  "memory.remember": { text: "أعمل في الرياض وأفضّل الردود المختصرة", scope: "USER", mission_id: MISSION },
  "conversation.search": { query: "اليابان", limit: 20 },
  "mission.trace": { mission_id: MISSION, include_otlp: true, after: 0, limit: 500 },
  "mcp.tool.accept_redefinition": { tool_id: "mcp.fixture:drift" },
  "provider.catalog": {},
  "provider.credential.put": { provider_id: "anthropic", api_key: "test-key-value-0001" },
  "provider.custom.save": { provider_id: "my-gateway", display_name: "My gateway", base_url: "https://api.example.com/v1", models: [{ model_id: "fixture-a", display_name: "Fixture A" }] },
  "provider.custom.delete": { provider_id: "my-gateway" },
  "web.search.status": {},
  "web.search.credential.put": { provider: "BRAVE", api_key: "test-search-key-0001" },
  "web.search.test": {},
  "mission.rating.set": { mission_id: MISSION, rating: 4 },
  "mission.note.add": { mission_id: MISSION, text: "also cover the second file" },
  "tool.approval.grants": { mission_id: MISSION },
  "tool.approval.grant.revoke": { mission_id: MISSION },
  "github.status": {},
  "github.connect": { token: "github_pat_test0000000000000000" },
  "github.disconnect": {},
  "memory.semantic.status": {},
  "memory.semantic.set": { enabled: true, endpoint: "http://127.0.0.1:8090/v1", model: "nomic-embed-text-v1.5", min_similarity: 0.6, query_prefix: "search_query: ", document_prefix: "search_document: " },
  "memory.semantic.test": {},
};

const RESULTS: Readonly<Record<Phase08Operation, unknown>> = {
  "workspace.list": { mission_id: MISSION, entries: [{ path: "inputs", is_dir: true, size_bytes: 0 }, { path: "inputs/notes.txt", is_dir: false, size_bytes: 10 }], used_bytes: 10 },
  "workspace.preview": { path: "inputs/notes.txt", kind: "TEXT", mime_type: "text/plain", size_bytes: 10, text: "alpha", truncated: false },
  "workspace.export": { file_label: "summary.docx", size_bytes: 4096, sha256: DIGEST },
  "attachment.stage": { attachment: { ...ATTACH, mission_id: null, workspace_ref: "" } },
  "attachment.discard": { attachment_id: ATTACHMENT, discarded: true },
  "attachment.artifact.stage": { attachment: { ...ATTACH, mission_id: null, workspace_ref: "" } },
  "attachment.list": { attachments: [ATTACH] },
  "attachment.bind": { mission_id: MISSION, attachments: [ATTACH] },
  "artifact.list": { artifacts: [ART] },
  "artifact.get": { artifact: ART, publications: [PUB] },
  "execution.status": {
    isolation: "APPCONTAINER+JOB", powershell: { available: true, detail: "" }, python: { available: false, detail: "the Python runtime has not been prepared" }, python_version: null,
    python_source_found: true, pdf_font_available: true, export_folder_configured: true, voice_configured: false, device_id: MISSION,
    setting_keys: ["voice.transcription_endpoint", "voice.transcription_model", "workspace.export_folder_label", "browser.engine_enabled"], settings: {},
  },
  "execution.runs": { mission_id: MISSION, runs: [{ run_id: RUN, task_id: "t1", tool_id: "polaris.execution.python", runtime: "PYTHON", command_preview: "print(1)", status: "SUCCEEDED", exit_code: 0, duration_ms: 40, output_truncated: false, network: false, processes_total: 1, survivors: 0, output_excerpt: "1", started_at: STAMP, finished_at: STAMP }] },
  "execution.runtime.prepare": { runtime: "PYTHON", available: true, version: "3.12", files: 4000, bytes: 60000000, reused: false },
  "mission.model.set": { mission_id: MISSION, model_id: null },
  "schedule.list": { schedules: [SCHED] },
  "schedule.save": { schedule: SCHED },
  "schedule.enable": { schedule: { ...SCHED, enabled: false, next_run: null } },
  "schedule.delete": { schedule_id: SCHEDULE, deleted: true },
  "schedule.run_now": { schedule_id: SCHEDULE, started: true },
  "oauth.list": { providers: [{ provider_id: "google", display_name: "Google", default_scopes: ["openid"] }], connections: [CONN] },
  "oauth.connect": { connection_id: CONNECTION, consent_url: "https://accounts.google.com/o/oauth2/v2/auth?response_type=code", redirect_uri: "http://127.0.0.1:53682/oauth/callback", opened_in_browser: true },
  "oauth.disconnect": { connection_id: CONNECTION, revoked: true },
  "voice.transcribe": { text: "مرحبا", seconds: 2 },
  "share.list": { grants: [{ grant_id: RUN, object_type: "ARTIFACT", object_id: ARTIFACT, member: "sara@example.test", role: "VIEWER", created_at: STAMP }] },
  "share.set": { grants: [] },
  "publish.list": { publishers: [{ publisher_id: "local-folder", leaves_device: false }], publications: [PUB] },
  "publish.propose": { publication: PUB },
  "publish.decide": { publication: { ...PUB, status: "PUBLISHED", target: `publications/${PUBLICATION}/summary.docx` } },
  "skill.package.list": { packages: [PKG] },
  "skill.package.import": { package: PKG },
  "device.export": { file_label: "POLARIS-workspace-22222222.zip", size_bytes: 2048, sha256: DIGEST },
  "device.import": { import_folder: `imports/${RUN}`, files: 3, source_device_id: MISSION, source_mission_id: MISSION },
  "integration.settings.set": { settings: { "voice.transcription_endpoint": "http://127.0.0.1:8178" } },
  "conversation.begin": { thread_id: MISSION, mission_id: MISSION },
  "conversation.continue": { thread_id: MISSION, mission_id: RUN, seq: 1 },
  "conversation.get": {
    conversation: {
      thread_id: MISSION, title: "هلا", thinking: false,
      turns: [{ mission_id: MISSION, seq: 0, message: "هلا", created_at: STAMP, state: "COMPLETED", completion_proof_status: "NOT_PROVEN", answer: "أهلًا! كيف أقدر أساعدك؟" }],
      entries: [{ entry_id: 1, mission_id: MISSION, kind: "STEP", text: "الترحيب", created_at: STAMP }, { entry_id: 2, mission_id: MISSION, kind: "ACTION", text: "polaris.workspace.list {}", detail: "SUCCEEDED", created_at: STAMP }],
    },
  },
  "conversation.index": { follow_ups: [{ mission_id: RUN, thread_id: MISSION }], threads: [{ thread_id: MISSION, title: "هلا", project_id: RUN, pinned: false, favorite: true, archived: true }] },
  "agent.catalog": {
    domains: [{ domain_id: "finance", name_ar: "المالية والمحاسبة", name_en: "Finance and accounting", count: 15 }],
    specialists: [
      {
        specialist_id: "finance.financial-analyst",
        domain_id: "finance",
        name_ar: "المحلل المالي",
        name_en: "Financial analyst",
        summary_ar: "يحلّل القوائم المالية والنسب والاتجاهات.",
        summary_en: "Analyses financial statements, ratios and trends.",
        task_types: ["RESEARCH", "SYNTHESIZE"],
      },
    ],
  },
  "mission.specialist.set": { mission_id: MISSION, specialist_id: null },
  "conversation.update": { thread: { thread_id: MISSION, title: "تحية قصيرة", pinned: true, favorite: false, archived: false } },
  "conversation.delete": { thread_id: MISSION, deleted: true, turns: 2 },
  "project.delete": { project_id: RUN, deleted: true, detached_missions: 3 },
  "memory.remember": { decision: "PROMOTED", memory_id: RUN, reason: "PROMOTED" },
  "conversation.search": { results: [{ thread_id: MISSION, title: "تحية", snippet: "…عاصمة اليابان هي طوكيو.", updated_at: STAMP }] },
  "mission.trace": {
    mission_id: MISSION,
    semconv: "gen_ai/1.37-development",
    spans: [
      { span_id: "0123456789abcdef", trace_id: "0123456789abcdef0123456789abcdef", parent_span_id: null, name: "invoke_agent", agent_id: "a1", task_id: "t1", model_id: null, provider_id: null, tool_id: null, input_tokens: null, output_tokens: null, latency_ms: 5000, cost_micros: null, status: "OK", gate_decision: null, started_at: STAMP, semconv: "gen_ai/1.37-development" },
      { span_id: "fedcba9876543210", trace_id: "0123456789abcdef0123456789abcdef", parent_span_id: "0123456789abcdef", name: "chat", agent_id: "a1", task_id: null, model_id: "groq:openai/gpt-oss-120b", provider_id: "groq", tool_id: null, input_tokens: 812, output_tokens: 40, latency_ms: 900, cost_micros: null, status: "OK", gate_decision: null, started_at: STAMP, semconv: "gen_ai/1.37-development" },
    ],
    spans_total: 2,
    next_after: null,
    totals: { agents: 1, model_calls: 1, tool_calls: 0, input_tokens: 812, output_tokens: 40, unreported: 0, denied: 0 },
    security_events: [{ seq: 4, kind: "INJECTION_FLAGGED", detail: "polaris.workspace.read: INSTRUCTION_OVERRIDE", created_at: STAMP }],
    session_events: 6,
    session_chain: { state: "INTACT", events: 6 },
    otlp: { resourceSpans: [] },
  },
  "mcp.tool.accept_redefinition": { tool_id: "mcp.fixture:drift", accepted: true, pending: [] },
  "provider.catalog": {
    source: "https://models.dev/api.json",
    retrieved: "2026-10-06",
    entries: [
      { provider_id: "anthropic", kind: "ANTHROPIC", display_name: "Anthropic", display_name_key: "provider.name.anthropic", locality: "REMOTE", auth_mode: "API_KEY", enabled: false, documented_models: 16, environment_key_present: false, environment_variable: "ANTHROPIC_API_KEY", popular_rank: 1 },
      { provider_id: "my-gateway", kind: "CUSTOM_OPENAI_COMPATIBLE", display_name: "My gateway", display_name_key: "provider.name.my-gateway", locality: "REMOTE", auth_mode: "OPTIONAL_API_KEY", enabled: true, documented_models: 0, environment_key_present: false },
    ],
  },
  "provider.credential.put": {
    provider_id: "anthropic",
    outcome: "STORED",
    key_status: { required: true, configured: true, source: "CREDENTIAL_STORE", reference: "secret://providers/anthropic/default", store_available: true, environment_variable: "ANTHROPIC_API_KEY" },
  },
  "provider.custom.save": { provider: PROVIDER_VIEW },
  "provider.custom.delete": { provider_id: "my-gateway", removed: true },
  "web.search.status": { provider: "BRAVE", ready: true, searxng_endpoint_configured: false, brave_key_configured: true, secure_store_available: true },
  "web.search.credential.put": { provider: "BRAVE", ready: true, searxng_endpoint_configured: false, brave_key_configured: true, secure_store_available: true },
  "web.search.test": { provider: "BRAVE", outcome: "OK", results: 5, duration_ms: 412 },
  "mission.rating.set": { mission_id: MISSION, rating: 4, rated_at: "2026-10-19T12:00:00Z" },
  "mission.note.add": { note: { note_id: "33333333-3333-4333-8333-333333333333", mission_id: MISSION, seq: 1, text: "also cover the second file", state: "QUEUED", created_at: "2026-10-19T12:00:00Z" } },
  "tool.approval.grants": { mission_id: MISSION, grants: [{ grant_id: "44444444-4444-4444-8444-444444444444", tool_id: "polaris.workspace.write", resource: "outputs/", effects: ["WORKSPACE_WRITE"], created_at: "2026-10-19T12:00:00Z", expires_at: "2026-10-19T13:00:00Z" }] },
  "tool.approval.grant.revoke": { mission_id: MISSION, revoked: 1 },
  "github.status": { connected: true, secure_store_available: true, login: "octocat", grant_kind: "FINE_GRAINED", scopes: [], checked_at: "2026-10-19T12:00:00Z" },
  "github.connect": { connected: true, secure_store_available: true, login: "octocat", grant_kind: "FINE_GRAINED", scopes: [], checked_at: "2026-10-19T12:00:00Z" },
  "github.disconnect": { connected: false, secure_store_available: true },
  "memory.semantic.status": { enabled: true, endpoint: "http://127.0.0.1:8090/v1", model: "nomic-embed-text-v1.5", min_similarity: 0.6, query_prefix: "search_query: ", document_prefix: "search_document: ", active: true, retrievals: 3, failures: 0 },
  "memory.semantic.set": { enabled: false, endpoint: null, model: null, min_similarity: 0.6, query_prefix: "", document_prefix: "", active: false, retrievals: 0, failures: 0 },
  "memory.semantic.test": { outcome: "OK", dimensions: 768, duration_ms: 14 },
};

test("P08-CT-001 the Phase-08 vocabulary in code, schema, envelope and registry is one list", () => {
  // 32 عند إغلاق Phase-08، و4 عمليات محادثة أُضيفت بعده إضافةً بحتة (ADR-029)، ثم كتالوج الوكلاء وتثبيت المتخصّص (ADR-030)، ثم إدارة المحادثات والمشاريع (ADR-031)، ثم «تذكّر هذا» (ADR-032)، ثم البحث في المحادثات.
  // ثم عارض التتبّع وقبول إعادة تعريف أداة MCP (ADR-041)، ثم إرفاق مخرَج سابق من «المكتبة» (attachment.artifact.stage، مكافأة Manus 2026-10-20).
  // ثم إعداد الاسترجاع الدلالي للذاكرة (PHASE-12 بقرار المالك: status وset وtest).
  assert.equal(PHASE08_OPERATIONS.length, 63);
  assert.deepEqual([...schemaEnum("desktop-operation.schema.json", "Phase08DesktopOperation")], [...PHASE08_OPERATIONS]);
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  const start = envelope.indexOf(PHASE06_OPERATIONS[PHASE06_OPERATIONS.length - 1] as string) + 1;
  assert.deepEqual(envelope.slice(start, start + PHASE08_OPERATIONS.length), [...PHASE08_OPERATIONS]);
  assert.deepEqual(registry.operations.map((r) => r.operation), [...PHASE08_OPERATIONS]);
});

test("P08-CT-002 the Phase-08 registry is valid, complete, routed and owned by named services", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
  assert.equal(registry.phase, "PHASE-08");
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.equal(record.routing_status, "ROUTED");
    assert.equal(record.envelope_version, "1.7");
    assert.equal(record.phase_introduced, "PHASE-08");
    owners.add(record.owner);
  }
  assert.ok(owners.size >= 8, "a single service owns everything");
  for (const unreachable of ["ToolGatewayService", "SandboxPort", "BrowserEngine", "HttpClient"]) {
    assert.equal(owners.has(unreachable), false, `${unreachable} owns an IPC operation`);
  }
});

test("P08-CT-003 effects are declared: reads are reads, and every change needs a key", () => {
  for (const record of registry.operations) {
    const side = record.effect === "SIDE_EFFECTING";
    assert.equal(record.idempotency, side ? "REQUIRED" : "NOT_REQUIRED", record.operation);
    assert.equal(PHASE08_SIDE_EFFECTING.includes(record.operation), side, record.operation);
  }
  const effect = (op: string): string | undefined => registry.operations.find((r) => r.operation === op)?.effect_class;
  assert.equal(effect("oauth.connect"), "SECRET_WRITE");
  assert.equal(effect("voice.transcribe"), "MODEL_INVOCATION");
  assert.equal(effect("publish.decide"), "CONTROL");
  assert.equal(effect("workspace.preview"), "READ_RESOURCE");
});

test("P08-CT-004 every registry schema reference resolves", () => {
  for (const record of registry.operations) {
    assert.ok(schemaReferenceExists(record.request_schema), record.request_schema);
    assert.ok(schemaReferenceExists(record.response_schema), record.response_schema);
  }
});

for (const operation of PHASE08_OPERATIONS) {
  test(`P08-CT-005 ${operation} accepts its valid request`, () => {
    const result = validatePhase08RequestPayload(operation, REQUESTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
  test(`P08-CT-006 ${operation} returns a result its schema accepts`, () => {
    const result = validatePhase08ResultPayload(operation, RESULTS[operation]);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

test("P08-CT-006b mission.trace refuses a page larger than 1000 and a negative offset (CP-10-1)", () => {
  assert.equal(validatePhase08RequestPayload("mission.trace", { mission_id: MISSION, limit: 1001 }).ok, false);
  assert.equal(validatePhase08RequestPayload("mission.trace", { mission_id: MISSION, limit: 0 }).ok, false);
  assert.equal(validatePhase08RequestPayload("mission.trace", { mission_id: MISSION, after: -1 }).ok, false);
  const page = { ...(RESULTS["mission.trace"] as Record<string, unknown>), spans: Array.from({ length: 1001 }, () => (RESULTS["mission.trace"] as { spans: unknown[] }).spans[0]) };
  assert.equal(validatePhase08ResultPayload("mission.trace", page).ok, false, "a result with more than one page of spans was accepted");
});

test("P08-CT-SEM the semantic memory setting accepts only a server on this computer and a bounded threshold", () => {
  for (const endpoint of ["https://api.example.com/v1", "http://10.0.0.5:8090", "http://127.0.0.1:8090/?key=x", "http://user@127.0.0.1:8090"]) {
    assert.equal(validatePhase08RequestPayload("memory.semantic.set", { enabled: true, endpoint, model: "m" }).ok, false, `${endpoint} was accepted`);
  }
  assert.equal(validatePhase08RequestPayload("memory.semantic.set", { enabled: true, endpoint: "http://localhost:1234/v1", model: "m" }).ok, true);
  assert.equal(validatePhase08RequestPayload("memory.semantic.set", { enabled: true, min_similarity: 0.2 }).ok, false);
  assert.equal(validatePhase08RequestPayload("memory.semantic.set", { enabled: true, min_similarity: 0.99 }).ok, false);
  assert.equal(validatePhase08RequestPayload("memory.semantic.set", {}).ok, false, "enabled is required");
  assert.equal(validatePhase08ResultPayload("memory.semantic.test", { outcome: "CONNECTED", dimensions: null, duration_ms: 1 }).ok, false);
});

test("P08-CT-007 a path cannot leave the workspace and no field names a command, a URL for the agent or a token", () => {
  for (const [operation, payload] of [
    ["workspace.preview", { mission_id: MISSION, path: "C:\\Windows\\win.ini" }],
    ["workspace.preview", { mission_id: MISSION, path: "C:/Windows/win.ini" }],
    ["workspace.preview", { mission_id: MISSION, path: "file.txt:stream" }],
    ["attachment.stage", { file_name: "../evil.txt", content_base64: "eA==" }],
    ["attachment.stage", { file_name: "a/b.txt", content_base64: "eA==" }],
    ["workspace.list", { mission_id: MISSION, command: "whoami" }],
    ["execution.runtime.prepare", { runtime: "PYTHON", source: "C:/Python312" }],
    ["execution.runtime.prepare", { runtime: "NODE" }],
    ["oauth.connect", { provider_id: "google", client_id: "x", token_url: "https://evil.example/token" }],
    ["schedule.save", { ...(REQUESTS["schedule.save"] as object), approval_policy: "AUTO_APPROVE" }],
    ["schedule.save", { ...(REQUESTS["schedule.save"] as object), schedule: { kind: "INTERVAL", minutes: 1 } }],
    ["schedule.save", { ...(REQUESTS["schedule.save"] as object), timezone: "Asia/Riyadh" }],
    // مكافأة الأتمتة مع Manus: يوم شهر خارج 1..31، ومكان تشغيل غير معروف، وتاريخ انتهاء ليس لحظة.
    ["schedule.save", { ...(REQUESTS["schedule.save"] as object), schedule: { kind: "MONTHLY", days: [32], time: "09:00" } }],
    ["schedule.save", { ...(REQUESTS["schedule.save"] as object), run_target: "BACKGROUND" }],
    ["schedule.save", { ...(REQUESTS["schedule.save"] as object), end_at: "next month" }],
    ["integration.settings.set", { key: "privacy.persist_memory", value: false }],
    ["publish.decide", { publication_id: PUBLICATION, decision: "AUTO" }],
  ] as const) {
    assert.equal(validatePhase08RequestPayload(operation, payload).ok, false, `${operation} accepted ${JSON.stringify(payload)}`);
  }
});

test("P08-CT-008 a side-effecting Phase-08 operation needs an idempotency key and version 1.7", () => {
  const ok = validateContract("IPCEnvelopeV1", envelopeFor("attachment.stage", REQUESTS["attachment.stage"]));
  assert.ok(ok.ok, ok.ok ? "" : JSON.stringify(ok.errors));
  const keyless = envelopeFor("attachment.stage", REQUESTS["attachment.stage"]);
  delete keyless["idempotency_key"];
  assert.equal(validateContract("IPCEnvelopeV1", keyless).ok, false, "a keyless attachment.stage was accepted");
  const read = validateContract("IPCEnvelopeV1", envelopeFor("execution.status", {}));
  assert.ok(read.ok, read.ok ? "" : JSON.stringify(read.errors));
});

test("P08-CT-009 no operation runs a process, drives the browser, writes a workspace, reads a token or sends a message", () => {
  const envelope = [...schemaEnum("ipc-envelope.v1.schema.json", "Operation")];
  for (const forbidden of FORBIDDEN_PHASE08_OPERATIONS) {
    assert.equal(envelope.includes(forbidden), false, `${forbidden} is in the envelope`);
    assert.equal((PHASE08_OPERATIONS as readonly string[]).includes(forbidden), false);
  }
  for (const operation of PHASE08_OPERATIONS) {
    assert.doesNotMatch(operation, /command|python|execute|navigate|\.write|token|send|approve/, operation);
  }
});

test("ADR-042 every Phase-08 envelope needs an idempotency key exactly when its operation is side-effecting", () => {
  // N-4 (2026-10-19): ثلاث عمليات قراءة دخلت قائمة «ذات الأثر» في الظرف فطُلب لها مفتاح. الحارس هنا لكل عملية، لا لعيّنة.
  for (const operation of PHASE08_OPERATIONS) {
    const keyless = envelopeFor(operation, REQUESTS[operation]);
    delete keyless["idempotency_key"];
    const accepted = validateContract("IPCEnvelopeV1", keyless).ok;
    assert.equal(accepted, !isPhase08SideEffecting(operation), `${operation}: a keyless envelope was ${accepted ? "accepted" : "refused"}`);
  }
});

test("ADR-042 a search key or a GitHub token is accepted only in its own field of its own operation", () => {
  const token = "ghp_" + "a".repeat(36);
  assert.equal(validatePhase08RequestPayload("github.connect", { token }).ok, true);
  assert.equal(validatePhase08RequestPayload("mission.note.add", { mission_id: MISSION, text: token }).ok, false, "a token rode in a note");
  assert.equal(validatePhase08RequestPayload("web.search.credential.put", { provider: "BRAVE", api_key: null }).ok, true, "clearing the key must be possible");
  assert.equal(validatePhase08RequestPayload("web.search.credential.put", { provider: "SEARXNG", api_key: "x".repeat(20) }).ok, false, "a key for a provider that takes none");
  assert.equal(validatePhase08RequestPayload("mission.rating.set", { mission_id: MISSION, rating: 6 }).ok, false);
  assert.equal(validatePhase08ResultPayload("github.status", { connected: true, secure_store_available: true, token }).ok, false, "a token crossed back");
});

test("P08-CT-010 no credential shape, token reference or SVG preview can ride in a Phase-08 result", () => {
  for (const operation of PHASE08_OPERATIONS) {
    // ADR-037 وADR-042: حقل المفتاح في نافذة الاتصال، ومفتاح البحث، ورمز GitHub — كلٌّ باسم عمليته وموضعه وحده.
    const allowed = ({ "provider.credential.put": "/payload/api_key", "web.search.credential.put": "/payload/api_key", "github.connect": "/payload/token" } as Partial<Record<string, string>>)[operation];
    assert.deepEqual(findSecretsDeep(REQUESTS[operation], "/payload").filter((f) => f.pointer !== allowed), [], `${operation} request example carries a credential shape`);
    assert.deepEqual(findSecretsDeep(RESULTS[operation], "/result"), [], `${operation} result example carries a credential shape`);
  }
  const withRef = { connections: [{ ...CONN, token_ref: "secret://oauth/x" }], providers: [] };
  assert.equal(validatePhase08ResultPayload("oauth.list", withRef).ok, false, "a token reference crossed");
  const svg = { path: "outputs/a.svg", kind: "IMAGE", mime_type: "image/svg+xml", size_bytes: 10, data_url: "data:image/svg+xml;base64,PHN2Zz4=", truncated: false };
  assert.equal(validatePhase08ResultPayload("workspace.preview", svg).ok, false, "an SVG preview was accepted");
  const trusted = { package: { ...PKG, grants_authority: true } };
  assert.equal(validatePhase08ResultPayload("skill.package.import", trusted).ok, false, "a package granted authority");
  const remote = { ...(RESULTS["oauth.connect"] as object), redirect_uri: "https://evil.example/cb" };
  assert.equal(validatePhase08ResultPayload("oauth.connect", remote).ok, false, "a non-loopback redirect was accepted");
});

test("P08-CT-011 every declared error category has a mapping entry", () => {
  const mapping = loadDesktopErrorMapping();
  const categories = new Set<string>(mapping.entries.map((e) => e.category as string));
  for (const record of registry.operations) {
    for (const category of record.error_categories) assert.ok(categories.has(category), `${record.operation}: ${category}`);
  }
});

test("P08-CT-040 only the in-app key field may carry a credential, and only in provider.credential.put (ADR-037)", () => {
  const key = "sk-" + "a".repeat(40);
  assert.equal(validatePhase08RequestPayload("provider.credential.put", { provider_id: "openai", api_key: key }).ok, true);
  // الشكل نفسه في أي حقل آخر، أو في أي عملية أخرى، يبقى مرفوضًا.
  assert.equal(validatePhase08RequestPayload("provider.custom.save", { provider_id: "my-gateway", display_name: key, base_url: "https://api.example.com/v1" }).ok, false);
  assert.equal(validatePhase08RequestPayload("provider.custom.save", { provider_id: "my-gateway", display_name: "x", base_url: "https://api.example.com/v1", models: [{ model_id: key }] }).ok, false);
  assert.equal(validatePhase08ResultPayload("provider.credential.put", { ...(RESULTS["provider.credential.put"] as object), provider_id: "openai", leaked: key }).ok, false);
  // لا حقل مفتاح في طلب المزوّد المخصّص: المفتاح يسافر في عمليته وحدها.
  assert.equal(validatePhase08RequestPayload("provider.custom.save", { ...(REQUESTS["provider.custom.save"] as object), api_key: "x" }).ok, false);
  assert.equal(validatePhase08RequestPayload("provider.credential.put", { provider_id: "openai", api_key: "" }).ok, false);
  assert.equal(validatePhase08RequestPayload("provider.custom.save", { ...(REQUESTS["provider.custom.save"] as object), base_url: "https://api.example.com/v1?key=x" }).ok, false);
});

test("a monthly schedule that runs in the same task until an end date is a valid save and a valid schedule", () => {
  const save = { ...(REQUESTS["schedule.save"] as object), schedule: { kind: "MONTHLY", days: [1, 15], time: "09:00" }, run_target: "SAME_TASK", end_at: STAMP };
  assert.equal(validatePhase08RequestPayload("schedule.save", save).ok, true);
  const view = validatePhase08ResultPayload("schedule.save", { schedule: { ...SCHED, schedule: { kind: "MONTHLY", days: [31], time: "09:00" }, run_target: "SAME_TASK", end_at: STAMP } });
  assert.equal(view.ok, true, JSON.stringify(view));
});
