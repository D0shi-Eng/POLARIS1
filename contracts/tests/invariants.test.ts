// اختبارات الثوابت العابرة للعقود. لكل ثابت حالة سليمة تمر، وحالة انتهاك تُرصد.
// السلسلة الكاملة تُبنى من العينات الإيجابية نفسها، فلا يوجد "مسار سعيد" مصطنع.

import test from "node:test";
import assert from "node:assert/strict";

import { checkInvariants, invariantViolations, type ContractFlow, type InvariantId } from "../src/invariants/index.js";
import { fixture, clone } from "./helpers.js";

const envelope = fixture("positive", "ipc-envelope.request.json");
const descriptor = fixture("positive", "capability-descriptor.read-file.json");
const invocation = fixture("positive", "capability-invocation.read-file.json");
const decision = fixture("positive", "policy-decision.allow.json");
const audit = fixture("positive", "audit-event.policy-evaluated.json");
const modelOutput = fixture("positive", "model-output.tool-proposal.json");
const modelDerived = fixture("positive", "capability-invocation.model-derived.json");

const CHAIN: ContractFlow = { envelope, descriptor, invocation, decision, audit };

function violationsOf(flow: ContractFlow, id: InvariantId): number {
  return checkInvariants(flow).filter((r) => r.id === id).flatMap((r) => r.violations).length;
}

function assertApplicable(flow: ContractFlow, id: InvariantId): void {
  const result = checkInvariants(flow).find((r) => r.id === id);
  assert.ok(result !== undefined && result.applicable, `${id} did not apply to this flow`);
}

test("the reference chain satisfies every invariant", () => {
  assert.deepEqual(invariantViolations(CHAIN), []);
});

test("the model-derived chain satisfies every invariant", () => {
  assert.deepEqual(invariantViolations({ descriptor, modelOutput, invocation: modelDerived }), []);
});

test("INV-001 rejects execution widening network beyond the descriptor", () => {
  assertApplicable(CHAIN, "INV-001");
  const widened = clone(invocation);
  (widened["execution_constraints"] as Record<string, unknown>)["network"] = "UNRESTRICTED";
  assert.equal(violationsOf({ ...CHAIN, invocation: widened }, "INV-001"), 1);
});

test("INV-001 also rejects the NONE to BROKERED_EGRESS step", () => {
  const widened = clone(invocation);
  (widened["execution_constraints"] as Record<string, unknown>)["network"] = "BROKERED_EGRESS";
  assert.equal(violationsOf({ ...CHAIN, invocation: widened }, "INV-001"), 1);
});

test("INV-002 rejects an effect the descriptor never declared", () => {
  assertApplicable(CHAIN, "INV-002");
  const extra = clone(invocation);
  (extra["requested_effects"] as unknown[]).push({
    action: "write.filesystem",
    resource: { kind: "FILESYSTEM_PATH", locator: "D:\\POLARIS\\README.md", scope: "EXACT" },
  });
  assert.equal(violationsOf({ ...CHAIN, invocation: extra }, "INV-002"), 1);
});

test("INV-002 treats a different network destination as a different effect", () => {
  const brokered = fixture("positive", "capability-descriptor.brokered-fetch.json");
  const elsewhere = clone(invocation);
  elsewhere["requested_effects"] = [
    { action: "network.fetch", destination: { host: "8.8.8.8", port: 443, protocol: "HTTPS" }, data_classification: "INTERNAL" },
  ];
  assert.equal(violationsOf({ descriptor: brokered, invocation: elsewhere }, "INV-002"), 1);
});

test("INV-003 rejects an obligation that widens confinement", () => {
  assertApplicable(CHAIN, "INV-003");
  const escalating = clone(decision);
  const obligations = escalating["obligations"] as Array<Record<string, unknown>>;
  const confinement = obligations.find((o) => o["type"] === "REQUIRE_CONFINEMENT")!;
  (confinement["requirements"] as Record<string, unknown>)["handle_inheritance"] = "EXPLICIT_ONLY";
  (confinement["requirements"] as Record<string, unknown>)["environment"] = "INHERITED";
  assert.ok(violationsOf({ ...CHAIN, decision: escalating }, "INV-003") >= 1);
});

test("INV-003 rejects an obligation adding an unlisted egress destination", () => {
  const added = clone(decision);
  (added["obligations"] as unknown[]).push({
    type: "REQUIRE_BROKERED_EGRESS",
    allowed_destinations: [{ host: "exfil.example", port: 443, protocol: "HTTPS" }],
  });
  assert.equal(violationsOf({ ...CHAIN, decision: added }, "INV-003"), 1);
});

test("INV-003 rejects an obligation raising the output ceiling", () => {
  const raised = clone(decision);
  const obligations = raised["obligations"] as Array<Record<string, unknown>>;
  obligations.find((o) => o["type"] === "MAX_BYTES")!["max_bytes"] = 1073741824;
  assert.equal(violationsOf({ ...CHAIN, decision: raised }, "INV-003"), 1);
});

test("INV-003 accepts an obligation that narrows privileges", () => {
  const narrowed = clone(decision);
  const obligations = narrowed["obligations"] as Array<Record<string, unknown>>;
  obligations.find((o) => o["type"] === "MAX_BYTES")!["max_bytes"] = 1024;
  assert.equal(violationsOf({ ...CHAIN, decision: narrowed }, "INV-003"), 0);
});

test("INV-004 rejects any change of caller identity across the boundary", () => {
  assertApplicable(CHAIN, "INV-004");
  const swapped = clone(invocation);
  (swapped["caller_identity"] as Record<string, unknown>)["trust_tier"] = "TIER_0_TRUSTED";
  assert.equal(violationsOf({ ...CHAIN, invocation: swapped }, "INV-004"), 1);
});

test("INV-004 rejects a dropped delegation hop", () => {
  const dropped = clone(invocation);
  delete (dropped["caller_identity"] as Record<string, unknown>)["on_behalf_of"];
  assert.equal(violationsOf({ ...CHAIN, invocation: dropped }, "INV-004"), 1);
});

test("INV-005 rejects a broken correlation chain", () => {
  assertApplicable(CHAIN, "INV-005");
  const drifted = clone(audit);
  drifted["correlation_id"] = "00000000-0000-4000-8000-000000000000";
  assert.ok(violationsOf({ ...CHAIN, audit: drifted }, "INV-005") >= 1);
});

test("INV-005 rejects a lost causation link at each hop", () => {
  const orphanInvocation = clone(invocation);
  orphanInvocation["causation_id"] = "00000000-0000-4000-8000-000000000000";
  assert.ok(violationsOf({ ...CHAIN, invocation: orphanInvocation }, "INV-005") >= 1);

  const orphanDecision = clone(decision);
  orphanDecision["invocation_id"] = "00000000-0000-4000-8000-000000000000";
  assert.ok(violationsOf({ ...CHAIN, decision: orphanDecision }, "INV-005") >= 1);

  const orphanAudit = clone(audit);
  orphanAudit["decision_id"] = "00000000-0000-4000-8000-000000000000";
  assert.ok(violationsOf({ ...CHAIN, audit: orphanAudit }, "INV-005") >= 1);
});

test("INV-006 blocks an invalid model output from becoming an invocation", () => {
  const rejected = fixture("positive", "model-output.rejected.json");
  const derived = clone(modelDerived);
  derived["causation_id"] = rejected["output_id"];
  const flow: ContractFlow = { descriptor, modelOutput: rejected, invocation: derived };
  assertApplicable(flow, "INV-006");
  assert.ok(violationsOf(flow, "INV-006") >= 1);
});

test("INV-006 blocks a valid output of the wrong type", () => {
  const prose = clone(modelOutput);
  prose["output_type"] = "TEXT";
  assert.equal(violationsOf({ modelOutput: prose, invocation: modelDerived }, "INV-006"), 1);
});

test("INV-006 blocks a model-derived invocation that dropped its taint label", () => {
  const untainted = clone(modelDerived);
  untainted["taint_labels"] = ["USER_SUPPLIED"];
  assert.equal(violationsOf({ modelOutput, invocation: untainted }, "INV-006"), 1);
});

test("INV-006 does not apply to an invocation the model did not cause", () => {
  const result = checkInvariants({ modelOutput, invocation }).find((r) => r.id === "INV-006")!;
  assert.equal(result.applicable, false);
});

test("INV-007 rejects credential-shaped audit metadata", () => {
  assertApplicable(CHAIN, "INV-007");
  for (const file of ["audit-event.secret-like-key.json", "audit-event.secret-like-value.json"]) {
    const tainted = fixture("negative", file);
    assert.ok(violationsOf({ audit: tainted }, "INV-007") >= 1, `${file} passed INV-007`);
  }
});

test("INV-007 rejects a misclassified secret dereference", () => {
  const tainted = fixture("negative", "audit-event.misclassified-secret-effect.json");
  assert.ok(violationsOf({ audit: tainted }, "INV-007") >= 1);
});

test("INV-007 does not report a secret that is not there", () => {
  assert.equal(violationsOf({ audit }, "INV-007"), 0);
});

test("every invariant is exercised by at least one applicable flow", () => {
  const ids: InvariantId[] = ["INV-001", "INV-002", "INV-003", "INV-004", "INV-005", "INV-006", "INV-007"];
  const applicableSomewhere = new Set<string>();
  for (const flow of [CHAIN, { descriptor, modelOutput, invocation: modelDerived }]) {
    for (const result of checkInvariants(flow)) {
      if (result.applicable) applicableSomewhere.add(result.id);
    }
  }
  assert.deepEqual([...applicableSomewhere].sort(), ids);
});
