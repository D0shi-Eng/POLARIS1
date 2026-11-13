// P01-IPC — المظروف وعمليات سطح المكتب.
//
// الادعاء: العمليات الخمس تُحمَل في المظروف الواحد، بحمولة مقيَّدة لكل عملية،
// وبقواعد الحدّ التي أضافها 1.1: لا مفتاح Idempotency على قراءة، ولا ادعاء
// Tier-0 من العارض، وحمولة مشوَّهة تُرفض قبل أي توجيه.

import test from "node:test";
import assert from "node:assert/strict";

import { validateContract } from "../src/validator.js";
import { ErrorCode } from "../src/errors.js";
import {
  DESKTOP_OPERATIONS,
  claimsDesktopNamespace,
  isDesktopOperation,
  validateDesktopRequestPayload,
  validateDesktopResultPayload,
} from "../src/desktop/index.js";
import { fixture, clone } from "./helpers.js";
import { payloadManifest, payloadFixture, schemaEnum } from "./p01-helpers.js";

const ENVELOPE_POSITIVES = [
  "ipc-envelope.desktop-bootstrap.json",
  "ipc-envelope.desktop-runtime-status.json",
  "ipc-envelope.desktop-capability-availability.json",
  "ipc-envelope.desktop-settings-describe.json",
  "ipc-envelope.desktop-settings-read.json",
  "ipc-envelope.desktop-bootstrap-response.json",
];

for (const file of ENVELOPE_POSITIVES) {
  test(`P01-IPC-001 ${file} is a valid 1.1 envelope`, () => {
    const result = validateContract("IPCEnvelopeV1", fixture("positive", file));
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

test("P01-IPC-002 the operation enum is closed: the six frozen members, the five desktop ones, the nineteen Phase-02 ones, the ten Phase-03 ones, the twelve Phase-04 ones, then exactly the twelve Phase-05 ones", () => {
  // ADR-019 D2: الأحد عشر عضوًا بادئة مرتّبة لا تتغيّر، وما بعدها مُعلَن بالاسم.
  // كل عضو يُضاف يُكتب هنا بالاسم: هذا هو الحارس الذي يمنع توسيع المفردات صامتًا.
  const operations = schemaEnum("ipc-envelope.v1.schema.json", "Operation");
  assert.deepEqual(
    [...operations],
    [
      "capability.describe",
      "capability.invoke",
      "policy.evaluate",
      "audit.append",
      "model.complete",
      "system.ping",
      "desktop.bootstrap",
      "desktop.runtime.status",
      "desktop.capability.availability",
      "desktop.settings.describe",
      "desktop.settings.read",
      "provider.list",
      "provider.configure",
      "provider.credential.set",
      "provider.credential.clear",
      "provider.refresh",
      "model.list",
      "model.configure",
      "model.preferences.set",
      "model.invoke",
      "model.cancel",
      "project.list",
      "project.get",
      "project.create",
      "project.update",
      "project.archive",
      "context.add",
      "context.remove",
      "context.preview",
      "context.assemble",
      "mission.list",
      "mission.get",
      "mission.create",
      "mission.start",
      "mission.cancel",
      "mission.resume",
      "task.list",
      "agent.list",
      "claim.list",
      "evidence.list",
      "skill.list",
      "skill.get",
      "skill.configure",
      "tool.list",
      "tool.get",
      "tool.activity.list",
      "mcp.list",
      "mcp.register",
      "mcp.configure",
      "mcp.refresh",
      "approval.list",
      "tool.approval.respond",
      "memory.list",
      "memory.get",
      "memory.delete",
      "browser.session.list",
      "browser.session.get",
      "browser.session.cancel",
      "computer.session.list",
      "computer.session.get",
      "computer.session.cancel",
      "computer.window.list",
      "computer.target.grant",
      "computer.target.revoke",
      "connector.list",
      "connector.get",
      "connector.register",
      "connector.configure",
      "connector.remove",
      "connector.test",
      "connector.credential.set",
      "connector.credential.clear",
      "connector.openapi.import",
      "connector.openapi.approve",
      "connector.preset.list",
      "connector.preset.register",
      "usage.summary",
      "usage.list",
      "budget.list",
      "budget.set",
      "budget.remove",
      "pricing.list",
      "pricing.set",
      "pricing.remove",
      "observability.health",
      "observability.events",
      "observability.metrics",
      "observability.errors",
      "observability.alerts",
      "diagnostics.export",
      "config.describe",
      "config.effective",
      "config.set",
      "config.reset",
      "workspace.list",
      "workspace.preview",
      "workspace.export",
      "attachment.stage",
      "attachment.discard",
      "attachment.artifact.stage",
      "attachment.list",
      "attachment.bind",
      "artifact.list",
      "artifact.get",
      "execution.status",
      "execution.runs",
      "execution.runtime.prepare",
      "mission.model.set",
      "schedule.list",
      "schedule.save",
      "schedule.enable",
      "schedule.delete",
      "schedule.run_now",
      "oauth.list",
      "oauth.connect",
      "oauth.disconnect",
      "voice.transcribe",
      "share.list",
      "share.set",
      "publish.list",
      "publish.propose",
      "publish.decide",
      "skill.package.list",
      "skill.package.import",
      "device.export",
      "device.import",
      "integration.settings.set",
      "conversation.begin",
      "conversation.continue",
      "conversation.get",
      "conversation.index",
      "agent.catalog",
      "mission.specialist.set",
      "conversation.update",
      "conversation.delete",
      "project.delete",
      "memory.remember",
      "conversation.search",
      "mission.trace",
      "mcp.tool.accept_redefinition",
      "provider.catalog",
      "provider.credential.put",
      "provider.custom.save",
      "provider.custom.delete",
      "web.search.status",
      "web.search.credential.put",
      "web.search.test",
      "mission.rating.set",
      "mission.note.add",
      "tool.approval.grants",
      "tool.approval.grant.revoke",
      "github.status",
      "github.connect",
      "github.disconnect",
      "memory.semantic.status",
      "memory.semantic.set",
      "memory.semantic.test",
    ],
  );
});

test("P01-IPC-003 the desktop operation vocabulary in code matches the schema subset exactly", () => {
  // نفس صنف الحارس الذي يحمي ErrorCode: تكرار واحد لا مفرّ منه، ومقارنة تمنع انحرافه.
  const declared = schemaEnum("desktop-operation.schema.json", "Phase01DesktopOperation");
  assert.deepEqual([...DESKTOP_OPERATIONS], [...declared]);

  const envelopeOperations = schemaEnum("ipc-envelope.v1.schema.json", "Operation");
  for (const operation of declared) {
    assert.ok(envelopeOperations.includes(operation), `${operation} is not a member of the envelope enum`);
  }
});

test("P01-IPC-004 a name that merely claims the desktop namespace is not a desktop operation", () => {
  for (const name of ["desktop.foo", "desktop.", "desktop.settings.write", "desktop.shell"]) {
    assert.equal(claimsDesktopNamespace(name), true);
    assert.equal(isDesktopOperation(name), false, `${name} was accepted as a known operation`);
  }
});

test("P01-IPC-005 a read-only desktop operation carrying an idempotency key is rejected", () => {
  const result = validateContract(
    "IPCEnvelopeV1",
    fixture("negative", "ipc-envelope.desktop-read-only-with-idempotency-key.json"),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, ErrorCode.CONTRACT_VIOLATION);
  assert.equal(result.errors[0]!.pointer, "/idempotency_key");
});

test("P01-IPC-006 the idempotency conditional still binds the two side-effecting operations and no others", () => {
  const base = fixture("positive", "ipc-envelope.request.json") as Record<string, unknown>;
  for (const operation of ["capability.invoke", "audit.append"]) {
    const doc = clone(base);
    doc["operation"] = operation;
    delete doc["idempotency_key"];
    assert.equal(
      validateContract("IPCEnvelopeV1", doc).ok,
      false,
      `${operation} was accepted without an idempotency key`,
    );
  }
  for (const operation of ["capability.describe", "policy.evaluate", "model.complete", "system.ping"]) {
    const doc = clone(base);
    doc["operation"] = operation;
    delete doc["idempotency_key"];
    assert.equal(validateContract("IPCEnvelopeV1", doc).ok, true, `${operation} was refused a missing key`);
  }
});

test("P01-IPC-007 a desktop request cannot assert the trusted tier", () => {
  const result = validateContract(
    "IPCEnvelopeV1",
    fixture("negative", "ipc-envelope.desktop-renderer-claiming-tier0.json"),
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, ErrorCode.CONTRACT_VIOLATION);
  assert.equal(result.errors[0]!.pointer, "/caller_identity/trust_tier");
});

test("P01-IPC-008 a malformed desktop payload is rejected at the envelope, before routing could occur", () => {
  const result = validateContract("IPCEnvelopeV1", fixture("negative", "ipc-envelope.desktop-malformed-payload.json"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, ErrorCode.VALIDATION_ERROR);
  assert.equal(result.errors[0]!.pointer, "/payload");
});

test("P01-IPC-009 each operation's payload binding refuses another operation's payload", () => {
  const base = fixture("positive", "ipc-envelope.desktop-settings-read.json") as Record<string, unknown>;
  const doc = clone(base);
  doc["operation"] = "desktop.capability.availability";
  assert.equal(
    validateContract("IPCEnvelopeV1", doc).ok,
    false,
    "a settings-read payload was accepted under the availability operation",
  );
});

test("P01-IPC-010 the envelope still refuses result and error together", () => {
  const result = validateContract(
    "IPCEnvelopeV1",
    fixture("negative", "ipc-envelope.response-with-result-and-error.json"),
  );
  assert.equal(result.ok, false);
});

const manifest = payloadManifest();

for (const entry of manifest.positive) {
  test(`P01-IPC-011 payload ${entry.file} validates for ${entry.operation}`, () => {
    const doc = payloadFixture("positive", entry.file);
    const result =
      entry.direction === "REQUEST"
        ? validateDesktopRequestPayload(entry.operation, doc)
        : validateDesktopResultPayload(entry.operation, doc);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
    assert.ok(entry.claim.length > 0, `${entry.file} has no recorded claim`);
  });
}

for (const entry of manifest.negative) {
  test(`P01-IPC-012 payload ${entry.file} is rejected for the intended defect`, () => {
    const doc = payloadFixture("negative", entry.file);
    const result =
      entry.direction === "REQUEST"
        ? validateDesktopRequestPayload(entry.operation, doc)
        : validateDesktopResultPayload(entry.operation, doc);
    assert.ok(entry.reason.length > 0, `${entry.file} has no documented reason`);
    assert.equal(result.ok, false, `${entry.file} was accepted but must be rejected`);
    if (result.ok) return;
    assert.equal(result.errors[0]!.code, entry.expect_code, `${entry.file} rejected with the wrong error class`);
    assert.equal(
      result.errors[0]!.pointer ?? "/",
      entry.expect_pointer,
      `${entry.file} rejected at the wrong location`,
    );
  });
}

test("P01-IPC-013 every operation has at least one positive and one negative payload fixture in each direction it defines", () => {
  for (const operation of DESKTOP_OPERATIONS) {
    assert.ok(
      manifest.positive.some((e) => e.operation === operation && e.direction === "REQUEST"),
      `no positive request fixture for ${operation}`,
    );
    assert.ok(
      manifest.positive.some((e) => e.operation === operation && e.direction === "RESULT"),
      `no positive result fixture for ${operation}`,
    );
    assert.ok(
      manifest.negative.some((e) => e.operation === operation),
      `no negative fixture for ${operation}`,
    );
  }
});
