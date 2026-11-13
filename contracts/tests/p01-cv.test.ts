// P01-CV — إصدار العقد.
//
// الادعاء: IPCEnvelopeV1 صار 1.1 بإضافة فقط، ومستندات 1.0 ما تزال صالحة، و
// الإصدارات غير المدعومة ترفض فشلًا مغلقًا. هذه هي V-001 … V-010 من خطة W2،
// مكتوبة هنا واحدة واحدة حتى يكون سقوط أيٍّ منها مرئيًا باسمه.

import test from "node:test";
import assert from "node:assert/strict";

import { validateContract } from "../src/validator.js";
import { SUPPORTED_VERSIONS, checkContractVersion } from "../src/version.js";
import { ErrorCode } from "../src/errors.js";
import { DESKTOP_OPERATIONS } from "../src/desktop/index.js";
import { fixture, clone } from "./helpers.js";

const RENDERER_REQUEST = "ipc-envelope.desktop-bootstrap.json";

test("P01-CV-001 a 1.0 document carrying a 1.0 operation is still valid under the 1.1 build", () => {
  const doc = fixture("positive", "ipc-envelope.request.json");
  assert.equal(doc["contract_version"], "1.0", "the frozen fixture must still declare 1.0");
  const result = validateContract("IPCEnvelopeV1", doc);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
});

test("P01-CV-002 IPCEnvelopeV1 1.1 documents are supported by this build", () => {
  // ADR-019 D2 ثم ADR-021 ثم ADR-023: البناء صار 1.4 بإضافات بحتة. الادعاء الذي
  // يحميه هذا الاختبار — أن مستندات MINOR أدنى مقبولة وأن MINOR أعلى مرفوض — يبقى
  // كما هو. الرقم نفسه لم يعد مُثبَّتًا هنا: تثبيته جعل كل مرحلة تالية تكسر اختبار
  // مرحلة سابقة دون أن يتغيّر الادعاء، وهي بالضبط المصيدة التي كشفتها Phase-03.
  assert.equal(SUPPORTED_VERSIONS.IPCEnvelopeV1.major, 1);
  const supported = SUPPORTED_VERSIONS.IPCEnvelopeV1.minor;
  assert.ok(supported >= 3, "the build must still understand the Phase-03 minor");
  for (let minor = 0; minor <= supported; minor += 1) {
    assert.equal(checkContractVersion("IPCEnvelopeV1", `1.${minor}`).ok, true, `1.${minor} must be accepted`);
  }
  assert.equal(checkContractVersion("IPCEnvelopeV1", `1.${supported + 1}`).ok, false);
});

test("P01-CV-003 desktop.bootstrap validates under 1.1", () => {
  const result = validateContract("IPCEnvelopeV1", fixture("positive", RENDERER_REQUEST));
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
});

test("P01-CV-004 all five desktop operations validate under 1.1", () => {
  const base = fixture("positive", RENDERER_REQUEST) as Record<string, unknown>;
  const payloads: Record<string, unknown> = {
    "desktop.bootstrap": {},
    "desktop.runtime.status": {},
    "desktop.capability.availability": { capability_ids: ["polaris.desktop.missions"] },
    "desktop.settings.describe": {},
    "desktop.settings.read": { section_id: "general" },
  };
  for (const operation of DESKTOP_OPERATIONS) {
    const doc = clone(base);
    doc["operation"] = operation;
    doc["payload"] = payloads[operation];
    const result = validateContract("IPCEnvelopeV1", doc);
    assert.ok(result.ok, `${operation}: ${result.ok ? "" : JSON.stringify(result.errors, null, 2)}`);
  }
});

test("P01-CV-005 an unknown desktop.* operation is rejected at the enum", () => {
  const result = validateContract("IPCEnvelopeV1", fixture("negative", "ipc-envelope.desktop-unknown-operation.json"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, ErrorCode.VALIDATION_ERROR);
  assert.equal(result.errors[0]!.pointer, "/operation");
});

test("P01-CV-006 an arbitrary operation string is still rejected", () => {
  const result = validateContract("IPCEnvelopeV1", fixture("negative", "ipc-envelope.arbitrary-operation.json"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, ErrorCode.VALIDATION_ERROR);
  assert.equal(result.errors[0]!.pointer, "/operation");
});

test("P01-CV-007 a higher unsupported minor is rejected, not tolerated", () => {
  // أعلى من البناء (1.2، ADR-019 D2) يُرفض؛ القائمة تبدأ فوق المدعوم لا عند رقم ثابت.
  for (const version of [`1.${SUPPORTED_VERSIONS.IPCEnvelopeV1.minor + 1}`, "1.8", "1.99"]) {
    const gate = checkContractVersion("IPCEnvelopeV1", version);
    assert.equal(gate.ok, false, `${version} was accepted`);
    assert.equal(gate.ok === false ? gate.error.code : "", ErrorCode.UNSUPPORTED_VERSION);
  }
});

test("P01-CV-008 a future major is rejected", () => {
  const gate = checkContractVersion("IPCEnvelopeV1", "2.0");
  assert.equal(gate.ok, false);
  assert.equal(gate.ok === false ? gate.error.code : "", ErrorCode.UNSUPPORTED_VERSION);
});

test("P01-CV-009 a malformed version is MALFORMED_MESSAGE, not UNSUPPORTED_VERSION", () => {
  for (const bad of ["1", "1.1.0", "v1.1", "", null, 1.1, "01.1"]) {
    const gate = checkContractVersion("IPCEnvelopeV1", bad);
    assert.equal(gate.ok, false, `${String(bad)} was accepted`);
    assert.equal(gate.ok === false ? gate.error.code : "", ErrorCode.MALFORMED_MESSAGE);
  }
});

test("P01-CV-010 a 1.0 document cannot carry an operation introduced at 1.1", () => {
  // بوابة الإصدار وحدها تقبل MINOR أدنى، فهذا الادعاء تفرضه قاعدة دلالية لا البوابة.
  // بلا القاعدة يصير الإصدار المُعلن كذبًا مقبولًا، ويعجز مستقبِل 1.0 عن التشخيص.
  const result = validateContract(
    "IPCEnvelopeV1",
    fixture("negative", "ipc-envelope.desktop-operation-below-introduced-version.json"),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, ErrorCode.CONTRACT_VIOLATION);
  assert.equal(result.errors[0]!.pointer, "/operation");
});

test("P01-CV-011 the 1.1 bump did not disturb any other contract's supported version", () => {
  assert.deepEqual(SUPPORTED_VERSIONS.CapabilityDescriptorV1, { major: 1, minor: 0 });
  assert.deepEqual(SUPPORTED_VERSIONS.CapabilityInvocationV1, { major: 1, minor: 0 });
  assert.deepEqual(SUPPORTED_VERSIONS.PolicyDecisionV1, { major: 1, minor: 1 });
  assert.deepEqual(SUPPORTED_VERSIONS.AuditEventV1, { major: 1, minor: 1 });
  assert.deepEqual(SUPPORTED_VERSIONS.ModelOutputContractV1, { major: 1, minor: 0 });
});
