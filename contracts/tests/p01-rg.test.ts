// P01-RG — اتساق سجل IPC.
//
// السجل هو ما تبني منه P01-W3 بوابتها. فإن كان ناقصًا أو متناقضًا، فما يُبنى
// منه ناقص أو متناقض. هذه المجموعة تفرض اكتماله قبل أن يُبنى عليه شيء.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_ROOT } from "../src/registry.js";
import { schemaReferenceExists, validateAgainstSchemaReference } from "../src/validator.js";
import {
  DESKTOP_ERROR_MAPPING_FILE,
  DESKTOP_IPC_REGISTRY_FILE,
  DESKTOP_OPERATIONS,
  DESKTOP_REQUEST_SCHEMA,
  DESKTOP_RESULT_SCHEMA,
  desktopOperationRecord,
  isRoutableDesktopOperation,
  loadDesktopErrorMapping,
  loadDesktopIpcRegistry,
  registeredDesktopOperations,
  unsupportedOperationError,
} from "../src/desktop/index.js";

const registry = loadDesktopIpcRegistry();

test("P01-RG-001 the registry is valid against its own schema", () => {
  assert.equal(validateAgainstSchemaReference("desktop-ipc-registry.v1.schema.json", registry).ok, true);
});

test("P01-RG-002 the registry covers every declared operation and nothing else", () => {
  assert.deepEqual(
    registry.operations.map((record) => record.operation).sort(),
    [...DESKTOP_OPERATIONS].sort(),
  );
  assert.equal(registeredDesktopOperations().length, DESKTOP_OPERATIONS.length);
});

test("P01-RG-003 no operation is recorded twice, so there is exactly one owner per operation", () => {
  const seen = registry.operations.map((record) => record.operation);
  assert.equal(new Set(seen).size, seen.length);
});

test("P01-RG-004 every record names a request schema and a response schema that actually resolve", () => {
  for (const record of registry.operations) {
    assert.equal(
      schemaReferenceExists(record.request_schema),
      true,
      `${record.operation} names an unresolvable request schema ${record.request_schema}`,
    );
    assert.equal(
      schemaReferenceExists(record.response_schema),
      true,
      `${record.operation} names an unresolvable response schema ${record.response_schema}`,
    );
  }
});

test("P01-RG-005 the registry's schema references agree with the ones the validator uses", () => {
  for (const record of registry.operations) {
    assert.equal(record.request_schema, DESKTOP_REQUEST_SCHEMA[record.operation]);
    assert.equal(record.response_schema, DESKTOP_RESULT_SCHEMA[record.operation]);
  }
});

test("P01-RG-006 every Phase-01 operation is read-only and requires no idempotency key", () => {
  for (const record of registry.operations) {
    assert.equal(record.effect, "READ_ONLY", `${record.operation} is not read-only`);
    assert.equal(record.idempotency, "NOT_REQUIRED", `${record.operation} demands an idempotency key`);
  }
});

test("P01-RG-007 every record names one owning native service, and none owns the whole set", () => {
  const owners = new Set<string>();
  for (const record of registry.operations) {
    assert.ok(record.owner.length > 0, `${record.operation} has no owner`);
    owners.add(record.owner);
  }
  assert.ok(owners.size >= 2, "a single service owns every operation, which is a dispatcher by another name");
  assert.equal(owners.has("DesktopService"), false, "a catch-all desktop service appeared");
});

test("P01-RG-008 every record declares the same single trust boundary and caller class", () => {
  for (const record of registry.operations) {
    assert.equal(record.trust_boundary, "RENDERER_TO_NATIVE_HOST");
    assert.equal(record.caller_class, "DESKTOP_RENDERER");
  }
});

test("P01-RG-009 caller identity authority is the native transport for every operation", () => {
  for (const record of registry.operations) {
    assert.equal(
      record.caller_identity_authority,
      "NATIVE_TRANSPORT",
      `${record.operation} would let the renderer decide who it is`,
    );
  }
});

test("P01-RG-010 every error category a record names exists in the error mapping", () => {
  const known = new Set(loadDesktopErrorMapping().entries.map((entry) => entry.category));
  for (const record of registry.operations) {
    assert.ok(record.error_categories.length > 0, `${record.operation} declares no error behaviour`);
    for (const category of record.error_categories) {
      assert.ok(known.has(category as never), `${record.operation} names the unmapped category ${category}`);
    }
  }
});

test("P01-RG-011 every record was introduced by the envelope version that actually carries it", () => {
  for (const record of registry.operations) {
    assert.equal(record.envelope_version, "1.1");
    assert.equal(record.phase_introduced, "PHASE-01");
  }
});

test("P01-RG-012 schema validity is not routing authorisation", () => {
  // نفس العملية: صالحة عند المخطط، ومسجَّلة، ومع ذلك التوجيه قرار منفصل. لو كان
  // العضو في enum يكفي للإذن، لصار كل توسيع مستقبلي للمظروف توسيعًا للسلطة.
  for (const operation of DESKTOP_OPERATIONS) {
    const record = desktopOperationRecord(operation);
    assert.ok(record !== undefined);
    assert.equal(isRoutableDesktopOperation(operation), record!.routing_status === "ROUTED");
  }

  assert.equal(isRoutableDesktopOperation("desktop.foo"), false);
  assert.equal(isRoutableDesktopOperation("desktop.settings.write"), false);
  assert.equal(isRoutableDesktopOperation("capability.invoke"), false, "a frozen core operation is not a desktop route");

  const error = unsupportedOperationError("desktop.settings.write");
  assert.equal(error.pointer, "/operation");
  assert.equal(error.code, "CONTRACT_VIOLATION");
});

test("P01-RG-013 the registry declares itself a specification, not a measurement", () => {
  // لا يوجد مضيف في W2. وثيقة تقول IMPLEMENTED هنا تكون ادعاء عن شيء لم يُبنَ.
  assert.equal(registry.implementation_status, "SPECIFIED");
  assert.equal(registry.envelope_contract, "IPCEnvelopeV1");
  assert.equal(registry.phase, "PHASE-01");
});

test("P01-RG-015 the registry documents actually ship inside the package", () => {
  // العقد يُحزَّم ويُثبَّت داخل runtime حزمةً مُحزَّمة (ADR-005). وثيقة سجل لا
  // يشملها حقل files تختفي عند التثبيت، فينجح البناء ويسقط القارئ وقت التشغيل
  // — وهو الفشل المتأخر الذي يجعل السبب بعيدًا عن العَرَض.
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    files: readonly string[];
  };
  assert.ok(manifest.files.includes("registry"), "the package does not publish its registry documents");
  for (const path of [DESKTOP_IPC_REGISTRY_FILE, DESKTOP_ERROR_MAPPING_FILE]) {
    assert.equal(existsSync(path), true, `${path} does not exist`);
  }
});

test("P01-RG-014 no record introduces a second envelope contract", () => {
  const references = registry.operations.flatMap((record) => [record.request_schema, record.response_schema]);
  for (const reference of references) {
    assert.equal(
      reference.startsWith("desktop-request.v1.schema.json#") || reference.startsWith("desktop-result.v1.schema.json#"),
      true,
      `${reference} points outside the Phase-01 payload contracts`,
    );
  }
});
