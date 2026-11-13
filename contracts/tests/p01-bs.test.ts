// P01-BS — عقد BootstrapSnapshot.
//
// الادعاء: اللقطة تحمل حقائق القشرة المطلوبة للرسم، بحدود مغلقة، ولا تحمل شيئًا
// من داخل المضيف. الاختبار الحاسم هنا سلبي: ما لا يجوز أن يوجد يُثبَت بأنه
// غير قابل للتمثيل، لا بأنه غائب عن هذه العيّنة.

import test from "node:test";
import assert from "node:assert/strict";

import { validateDesktopResultPayload } from "../src/desktop/index.js";
import { payloadFixture, clonePayload, schemaDocument } from "./p01-helpers.js";

type Snapshot = Record<string, unknown>;

const REQUIRED_FACTS = [
  "app_version",
  "build_channel",
  "platform",
  "architecture",
  "locale",
  "direction",
  "appearance",
  "runtime_status",
  "enabled_capabilities",
  "unavailable_capabilities",
  "settings_schema_version",
  "ipc_protocol_version",
];

function snapshot(): Snapshot {
  return payloadFixture("positive", "bootstrap.result.json") as Snapshot;
}

test("P01-BS-001 the reference snapshot validates", () => {
  const result = validateDesktopResultPayload("desktop.bootstrap", snapshot());
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
});

test("P01-BS-002 the snapshot carries exactly the twelve declared facts and no thirteenth", () => {
  const schema = schemaDocument("desktop-bootstrap.schema.json");
  const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
  const bootstrap = defs["BootstrapSnapshot"]!;
  assert.equal(bootstrap["additionalProperties"], false);
  assert.deepEqual([...(bootstrap["required"] as string[])].sort(), [...REQUIRED_FACTS].sort());
  assert.deepEqual(Object.keys(bootstrap["properties"] as object).sort(), [...REQUIRED_FACTS].sort());
});

test("P01-BS-003 dropping any single required fact invalidates the snapshot", () => {
  for (const field of REQUIRED_FACTS) {
    const doc = clonePayload(snapshot());
    delete doc[field];
    assert.equal(
      validateDesktopResultPayload("desktop.bootstrap", doc).ok,
      false,
      `a snapshot without ${field} was accepted`,
    );
  }
});

test("P01-BS-004 host internals are unrepresentable, not merely absent", () => {
  // كل واحد من هذه كان سيسرّب داخل المضيف إلى العارض لو كان الكائن مفتوحًا.
  for (const field of [
    "process_id",
    "executable_path",
    "environment",
    "stack_trace",
    "policy_set",
    "native_handles",
    "config",
  ]) {
    const doc = clonePayload(snapshot());
    doc[field] = "x";
    assert.equal(
      validateDesktopResultPayload("desktop.bootstrap", doc).ok,
      false,
      `the snapshot accepted ${field}`,
    );
  }
});

test("P01-BS-005 every bounded fact refuses a value outside its set", () => {
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["build_channel", "NIGHTLY"],
    ["platform", "LINUX"],
    ["architecture", "X86"],
    ["locale", "tr"],
    ["direction", "AUTO"],
    ["appearance", "HIGH_CONTRAST"],
    ["app_version", "0.1"],
    ["settings_schema_version", "1.0.0"],
    ["ipc_protocol_version", "one.one"],
  ];
  for (const [field, value] of cases) {
    const doc = clonePayload(snapshot());
    doc[field] = value;
    assert.equal(
      validateDesktopResultPayload("desktop.bootstrap", doc).ok,
      false,
      `${field} accepted ${String(value)}`,
    );
  }
});

test("P01-BS-006 an empty capability list is a valid and honest answer", () => {
  const doc = clonePayload(snapshot());
  doc["enabled_capabilities"] = [];
  doc["unavailable_capabilities"] = [];
  assert.equal(validateDesktopResultPayload("desktop.bootstrap", doc).ok, true);
});

test("P01-BS-007 a duplicated enabled capability is refused", () => {
  const doc = clonePayload(snapshot());
  doc["enabled_capabilities"] = ["polaris.desktop.settings", "polaris.desktop.settings"];
  assert.equal(validateDesktopResultPayload("desktop.bootstrap", doc).ok, false);
});

test("P01-BS-008 runtime status cannot claim a contract version it does not have, and cannot omit its availability", () => {
  const doc = clonePayload(snapshot());
  const status = doc["runtime_status"] as Record<string, unknown>;
  status["runtime_contract_version"] = "not-a-version";
  assert.equal(validateDesktopResultPayload("desktop.bootstrap", doc).ok, false);

  const missing = clonePayload(snapshot());
  delete (missing["runtime_status"] as Record<string, unknown>)["availability"];
  assert.equal(validateDesktopResultPayload("desktop.bootstrap", missing).ok, false);
});

test("P01-BS-009 the Phase-01 reference snapshot does not claim an attached runtime", () => {
  // ادعاء نواة موصولة في مرحلة لا تصلها هو بالضبط «شاشة تكذب على المستخدم».
  const status = snapshot()["runtime_status"] as Record<string, unknown>;
  assert.equal(status["reachability"], "NOT_ATTACHED");
  assert.deepEqual(status["availability"], { state: "UNAVAILABLE", reason: "PHASE_NOT_IMPLEMENTED" });
});
