// P02-CT — عقود Phase-02: المفردات، والسجل، والحمولات، والظرف 1.2.
//
// الادعاء: تسع عشرة عملية مغلقة، تسافر في الظرف الوحيد بإصدار 1.2، كلٌّ بحمولة
// مقيّدة ومالك واحد وصنف أثر صريح، ولا حقل فيها يستطيع حمل سرّ أو وجهة حرّة.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ErrorCode } from "../src/errors.js";
import { findSecretsDeep } from "../src/secret-hygiene.js";
import { schemaReferenceExists, validateAgainstSchemaReference, validateContract } from "../src/validator.js";
import {
  PHASE02_OPERATIONS,
  PHASE02_SIDE_EFFECTING,
  isPhase02Operation,
  loadDesktopErrorMapping,
  loadPhase02IpcRegistry,
  validatePhase02RequestPayload,
  validatePhase02ResultPayload,
  type Phase02Operation,
} from "../src/desktop/index.js";
import { clone, fixture } from "./helpers.js";
import { schemaEnum } from "./p01-helpers.js";

const ROOT = fileURLToPath(new URL("../../fixtures/phase-02/", import.meta.url));

interface Entry {
  readonly file: string;
  readonly operation: Phase02Operation;
  readonly direction: "REQUEST" | "RESULT";
  readonly claim?: string;
  readonly reason?: string;
  readonly expect_code?: string;
  readonly expect_pointer?: string;
}

const manifest = JSON.parse(readFileSync(join(ROOT, "_manifest.json"), "utf8")) as { positive: Entry[]; negative: Entry[] };
const load = (kind: string, file: string): unknown => JSON.parse(readFileSync(join(ROOT, kind, file), "utf8")) as unknown;
const registry = loadPhase02IpcRegistry();

function envelopeFor(operation: string, payload: unknown, version = "1.2"): Record<string, unknown> {
  const doc = clone(fixture("positive", "ipc-envelope.desktop-bootstrap.json")) as Record<string, unknown>;
  doc["contract_version"] = version;
  doc["protocol_version"] = version;
  doc["operation"] = operation;
  doc["payload"] = payload;
  if (isPhase02Operation(operation) && PHASE02_SIDE_EFFECTING.includes(operation)) {
    doc["idempotency_key"] = "idem-0001-0002-0003";
  }
  return doc;
}

function positiveRequest(operation: Phase02Operation): unknown {
  const entry = manifest.positive.find((e) => e.operation === operation && e.direction === "REQUEST");
  assert.ok(entry !== undefined, `no positive request for ${operation}`);
  return load("positive", entry.file);
}

test("P02-CT-001 the Phase-02 vocabulary in code, schema, envelope and registry is one list", () => {
  assert.equal(PHASE02_OPERATIONS.length, 19);
  assert.deepEqual([...schemaEnum("desktop-operation.schema.json", "Phase02DesktopOperation")], [...PHASE02_OPERATIONS]);
  assert.deepEqual([...schemaEnum("ipc-envelope.v1.schema.json", "Operation")].slice(11, 30), [...PHASE02_OPERATIONS]);
  assert.deepEqual(registry.operations.map((r) => r.operation), [...PHASE02_OPERATIONS]);
});

test("P02-CT-002 the Phase-02 registry is valid, complete, routed and owned", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
  assert.equal(registry.phase, "PHASE-02");
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.equal(record.routing_status, "ROUTED");
    assert.equal(record.envelope_version, "1.2");
    assert.equal(record.phase_introduced, "PHASE-02");
    assert.equal(record.caller_identity_authority, "NATIVE_TRANSPORT");
    assert.equal(record.trust_boundary, "RENDERER_TO_NATIVE_HOST");
    owners.add(record.owner);
  }
  assert.ok(owners.size >= 7, "a few services own everything");
  assert.equal(owners.has("DesktopService"), false);
  assert.equal(new Set(registry.operations.map((r) => r.operation)).size, 19);
});

test("P02-CT-003 effects are declared, not hidden", () => {
  for (const record of registry.operations) {
    const side = record.effect === "SIDE_EFFECTING";
    assert.equal(record.idempotency, side ? "REQUIRED" : "NOT_REQUIRED", record.operation);
    assert.equal(PHASE02_SIDE_EFFECTING.includes(record.operation), side, record.operation);
    if (!side) assert.ok(["READ", "READ_RESOURCE"].includes(record.effect_class), record.operation);
    else assert.ok(!["READ", "READ_RESOURCE"].includes(record.effect_class), record.operation);
  }
  const effect = (op: string) => registry.operations.find((r) => r.operation === op)?.effect_class;
  assert.equal(effect("model.invoke"), "MODEL_INVOCATION");
  assert.equal(effect("provider.refresh"), "NETWORK_PROBE");
  assert.equal(effect("provider.credential.set"), "SECRET_WRITE");
  assert.equal(effect("context.preview"), "READ_RESOURCE");
  assert.equal(effect("provider.list"), "READ");
});

test("P02-CT-004 every schema reference resolves and every error category is mapped", () => {
  const known = new Set(loadDesktopErrorMapping().entries.map((e) => e.category as string));
  for (const record of registry.operations) {
    assert.ok(schemaReferenceExists(record.request_schema), record.request_schema);
    assert.ok(schemaReferenceExists(record.response_schema), record.response_schema);
    for (const category of record.error_categories) assert.ok(known.has(category), category);
  }
});

for (const entry of manifest.positive) {
  test(`P02-CT-005 positive ${entry.file} validates for ${entry.operation}`, () => {
    const doc = load("positive", entry.file);
    const result = entry.direction === "REQUEST" ? validatePhase02RequestPayload(entry.operation, doc) : validatePhase02ResultPayload(entry.operation, doc);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
    assert.ok((entry.claim ?? "").length > 0);
  });
}

for (const entry of manifest.negative) {
  test(`P02-CT-006 negative ${entry.file} is rejected for its defect`, () => {
    const doc = load("negative", entry.file);
    const result = entry.direction === "REQUEST" ? validatePhase02RequestPayload(entry.operation, doc) : validatePhase02ResultPayload(entry.operation, doc);
    assert.ok((entry.reason ?? "").length > 0);
    assert.equal(result.ok, false, `${entry.file} was accepted`);
    if (result.ok) return;
    assert.equal(result.errors[0]!.code, entry.expect_code);
    assert.equal(result.errors[0]!.pointer ?? "/", entry.expect_pointer);
  });
}

test("P02-CT-007 every operation has a positive request, and every result schema a positive result", () => {
  for (const record of registry.operations) {
    assert.ok(manifest.positive.some((e) => e.operation === record.operation && e.direction === "REQUEST"), record.operation);
    const covered = manifest.positive.some((e) => {
      if (e.direction !== "RESULT") return false;
      const other = registry.operations.find((r) => r.operation === e.operation);
      return other?.response_schema === record.response_schema;
    });
    assert.ok(covered, `no positive result for ${record.response_schema}`);
  }
});

test("P02-CT-008 each operation travels in a 1.2 envelope with its own payload", () => {
  for (const operation of PHASE02_OPERATIONS) {
    const result = validateContract("IPCEnvelopeV1", envelopeFor(operation, positiveRequest(operation)));
    assert.ok(result.ok, `${operation}: ${result.ok ? "" : JSON.stringify(result.errors)}`);
  }
});

test("P02-CT-009 a 1.1 document cannot carry a 1.2 operation", () => {
  for (const operation of ["provider.list", "model.invoke", "project.create"] as const) {
    const result = validateContract("IPCEnvelopeV1", envelopeFor(operation, positiveRequest(operation), "1.1"));
    assert.equal(result.ok, false, operation);
    if (result.ok) continue;
    assert.equal(result.errors[0]!.code, ErrorCode.CONTRACT_VIOLATION);
    assert.equal(result.errors[0]!.pointer, "/operation");
  }
});

test("P02-CT-010 side effects need an idempotency key and reads refuse one", () => {
  const invoke = envelopeFor("model.invoke", positiveRequest("model.invoke"));
  delete invoke["idempotency_key"];
  assert.equal(validateContract("IPCEnvelopeV1", invoke).ok, false, "an invocation without an idempotency key passed");
  const list = envelopeFor("project.list", positiveRequest("project.list"));
  list["idempotency_key"] = "idem-0001-0002-0003";
  const result = validateContract("IPCEnvelopeV1", list);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors[0]!.pointer, "/idempotency_key");
});

test("P02-CT-011 a payload bound to one operation is refused under another", () => {
  const doc = envelopeFor("project.create", positiveRequest("project.create"));
  doc["operation"] = "context.add";
  assert.equal(validateContract("IPCEnvelopeV1", doc).ok, false);
});

test("P02-CT-012 generic dispatch names are unrepresentable", () => {
  for (const name of ["provider.call", "model.call", "project.execute", "context.read", "provider.fetch", "model.raw"]) {
    const result = validateContract("IPCEnvelopeV1", envelopeFor(name, {}));
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.errors[0]!.pointer, "/operation");
  }
});

test("P02-CT-013 a credential-shaped value in free text is refused", () => {
  const request = { name: "leak", description: "my key is sk-abcdefghijklmnopqrstuvwxyz123456" };
  const payload = validatePhase02RequestPayload("project.create", request);
  assert.equal(payload.ok, false);
  const envelope = validateContract("IPCEnvelopeV1", envelopeFor("project.create", request));
  assert.equal(envelope.ok, false);
  if (!envelope.ok) assert.equal(envelope.errors[0]!.code, ErrorCode.CONTRACT_VIOLATION);
});

test("P02-CT-014 a Phase-02 request cannot claim the trusted tier", () => {
  const doc = envelopeFor("provider.list", {});
  (doc["caller_identity"] as Record<string, unknown>)["trust_tier"] = "TIER_0_TRUSTED";
  const result = validateContract("IPCEnvelopeV1", doc);
  assert.equal(result.ok, false);
});

test("P02-CT-015 the registry schema refuses a record that hides or mislabels its effect", () => {
  const base = clone(registry) as unknown as { operations: Record<string, unknown>[] };
  const cases: Array<(r: Record<string, unknown>) => void> = [
    (r) => delete r["effect_class"],
    (r) => (r["effect_class"] = "WRITE_CONFIG"),
    (r) => (r["envelope_version"] = "1.1"),
    (r) => (r["operation"] = "desktop.bootstrap"),
  ];
  for (const mutate of cases) {
    const doc = clone(base);
    mutate(doc.operations[0]!);
    assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", doc).ok, false);
  }
  const side = clone(base);
  const invoke = side.operations.find((r) => r["operation"] === "model.invoke")!;
  invoke["idempotency"] = "NOT_REQUIRED";
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", side).ok, false);
});

test("P02-CT-016 no Phase-02 field name looks like a credential to the hygiene scanner", () => {
  const names = new Set<string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "properties" && value !== null && typeof value === "object") {
          for (const name of Object.keys(value as object)) names.add(name);
        }
        collect(value);
      }
    }
  };
  for (const file of ["desktop-p02-domain.schema.json", "desktop-p02-request.v1.schema.json", "desktop-p02-result.v1.schema.json"]) {
    collect(JSON.parse(readFileSync(fileURLToPath(new URL(`../../schemas/${file}`, import.meta.url)), "utf8")));
  }
  assert.ok(names.size > 50);
  const probe = Object.fromEntries([...names].map((n) => [n, 1]));
  assert.deepEqual(findSecretsDeep(probe, ""), []);
});
