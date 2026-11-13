// P01-AV — نموذج الإتاحة.
//
// الادعاء: حالة وسبب، كلاهما رمز مغلق، ومقترنان بقاعدة: المتاح بلا سبب، وغير
// المتاح بسبب دائمًا. النموذج واحد لكل السطوح، فلا يخترع كل شاشة تصنيفها.

import test from "node:test";
import assert from "node:assert/strict";

import { validateAgainstSchemaReference } from "../src/validator.js";
import { schemaEnum } from "./p01-helpers.js";

const AVAILABILITY = "desktop-availability.schema.json#/$defs/Availability";
const CAPABILITY = "desktop-availability.schema.json#/$defs/CapabilityAvailability";

const STATES = ["AVAILABLE", "READ_ONLY", "UNAVAILABLE", "BLOCKED", "ERROR"];
const REASONS = [
  "PHASE_NOT_IMPLEMENTED",
  "PROVIDER_NOT_CONFIGURED",
  "PLATFORM_UNSUPPORTED",
  "POLICY_DISABLED",
  "RUNTIME_UNAVAILABLE",
];

test("P01-AV-001 the state set is exactly the five the architecture declares", () => {
  assert.deepEqual([...schemaEnum("desktop-availability.schema.json", "AvailabilityState")], STATES);
});

test("P01-AV-002 the reason set is exactly the five the architecture declares", () => {
  assert.deepEqual([...schemaEnum("desktop-availability.schema.json", "AvailabilityReason")], REASONS);
});

test("P01-AV-003 AVAILABLE validates without a reason", () => {
  assert.equal(validateAgainstSchemaReference(AVAILABILITY, { state: "AVAILABLE" }).ok, true);
});

test("P01-AV-004 AVAILABLE with a reason is refused", () => {
  for (const reason of REASONS) {
    assert.equal(
      validateAgainstSchemaReference(AVAILABILITY, { state: "AVAILABLE", reason }).ok,
      false,
      `AVAILABLE accepted the reason ${reason}`,
    );
  }
});

test("P01-AV-005 every non-available state requires a reason", () => {
  for (const state of STATES.filter((s) => s !== "AVAILABLE")) {
    assert.equal(validateAgainstSchemaReference(AVAILABILITY, { state }).ok, false, `${state} passed with no reason`);
    assert.equal(
      validateAgainstSchemaReference(AVAILABILITY, { state, reason: "PHASE_NOT_IMPLEMENTED" }).ok,
      true,
      `${state} with a reason was refused`,
    );
  }
});

test("P01-AV-006 an unknown state or an unknown reason is refused", () => {
  assert.equal(validateAgainstSchemaReference(AVAILABILITY, { state: "DEGRADED", reason: "POLICY_DISABLED" }).ok, false);
  assert.equal(validateAgainstSchemaReference(AVAILABILITY, { state: "UNAVAILABLE", reason: "SOON" }).ok, false);
});

test("P01-AV-007 free text cannot become the reason", () => {
  assert.equal(
    validateAgainstSchemaReference(AVAILABILITY, { state: "UNAVAILABLE", reason: "we have not built it yet" }).ok,
    false,
  );
  assert.equal(
    validateAgainstSchemaReference(AVAILABILITY, {
      state: "UNAVAILABLE",
      reason: "PHASE_NOT_IMPLEMENTED",
      message: "we have not built it yet",
    }).ok,
    false,
    "a prose member was accepted alongside the classified reason",
  );
});

test("P01-AV-008 a capability entry needs both an identifier and an availability", () => {
  assert.equal(
    validateAgainstSchemaReference(CAPABILITY, {
      capability_id: "polaris.desktop.missions",
      availability: { state: "UNAVAILABLE", reason: "PHASE_NOT_IMPLEMENTED" },
    }).ok,
    true,
  );
  assert.equal(validateAgainstSchemaReference(CAPABILITY, { capability_id: "polaris.desktop.missions" }).ok, false);
  assert.equal(validateAgainstSchemaReference(CAPABILITY, { availability: { state: "AVAILABLE" } }).ok, false);
  assert.equal(
    validateAgainstSchemaReference(CAPABILITY, {
      capability_id: "Polaris Desktop Missions",
      availability: { state: "AVAILABLE" },
    }).ok,
    false,
    "an unbounded identifier was accepted",
  );
});
