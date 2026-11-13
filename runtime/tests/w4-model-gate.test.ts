// بوابة مخرج النموذج. القاعدة المُختبَرة: مخرج يُحلَّل كـJSON ليس مخرجًا صالحًا،
// ولا يصل مخرج غير صالح إلى بوابة القدرات إطلاقًا.

import test from "node:test";
import assert from "node:assert/strict";

import { validateContract } from "@polaris/contracts";

import { gateModelOutput, type GateInput } from "../src/model/output-gate.js";
import { newId } from "../src/ids.js";

const CAPABILITIES = ["polaris.fs.read_file", "polaris.fs.write_file"];

function gate(raw: string, overrides: Partial<GateInput> = {}): ReturnType<typeof gateModelOutput> {
  return gateModelOutput({
    raw: { model_id: "polaris.fixture", revision: "test", raw },
    correlation_id: newId(),
    causation_id: newId(),
    mission_id: newId(),
    agent_id: newId(),
    available_capabilities: CAPABILITIES,
    loop: { attempt: 1, max_retries: 2, iteration: 1, max_iterations: 8 },
    declared_schema_ref: "model/tool_proposal.v1.json",
    ...overrides,
  });
}

test("a valid tool proposal passes and carries the model taint label", () => {
  const result = gate(JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: "D:\\A\\b.txt" } }));
  assert.equal(result.valid, true);
  assert.equal(result.document["validation_status"], "VALID");
  assert.equal(result.document["output_type"], "TOOL_INVOCATION_PROPOSAL");
  assert.deepEqual(result.document["taint_labels"], ["MODEL_GENERATED"]);
  assert.equal((result.document["loop_control"] as Record<string, unknown>)["terminal"], false);
  assert.equal(validateContract("ModelOutputContractV1", result.document).ok, true);
});

test("prose is rejected as MALFORMED_OUTPUT and carries no parsed payload", () => {
  const result = gate("Sure! I will read the file for you.");
  assert.equal(result.valid, false);
  assert.equal(result.document["validation_status"], "MALFORMED_OUTPUT");
  assert.equal(result.document["parsed_payload"], undefined);
  assert.equal(result.payload, undefined);
  assert.equal(validateContract("ModelOutputContractV1", result.document).ok, true);
});

test("JSON that merely parses is still rejected when it does not match the proposal schema", () => {
  const result = gate(JSON.stringify({ tool: "read", file: "D:\\A\\b.txt" }));
  assert.equal(result.valid, false);
  assert.equal(result.document["validation_status"], "MISSING_REQUIRED_FIELD");
  assert.ok(result.violations.some((v) => v.code === "MISSING_FIELD"));
});

test("an unknown capability is UNSUPPORTED_ACTION, not a silent pass-through", () => {
  const result = gate(JSON.stringify({ action: "invoke_tool", capability_id: "polaris.net.exfiltrate", arguments: {} }));
  assert.equal(result.valid, false);
  assert.equal(result.document["validation_status"], "UNSUPPORTED_ACTION");
  assert.ok(result.violations.some((v) => v.code === "UNKNOWN_ACTION"));
});

test("an undeclared extra field invalidates the whole proposal", () => {
  const result = gate(
    JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: {}, elevate: true }),
  );
  assert.equal(result.valid, false);
  assert.equal(result.document["validation_status"], "INVALID_SCHEMA");
  assert.ok(result.violations.some((v) => v.pointer === "/elevate"));
});

test("an exhausted retry budget makes an invalid output terminal with a stated reason", () => {
  const result = gate("not json", { loop: { attempt: 3, max_retries: 2, iteration: 1, max_iterations: 8 } });
  const loop = result.document["loop_control"] as Record<string, unknown>;
  assert.equal(loop["terminal"], true);
  assert.equal(loop["failure_reason"], "RETRY_BUDGET_EXHAUSTED");
  assert.equal(validateContract("ModelOutputContractV1", result.document).ok, true);
});

test("an exhausted iteration budget is terminal for the iteration reason", () => {
  const result = gate("not json", { loop: { attempt: 1, max_retries: 2, iteration: 8, max_iterations: 8 } });
  const loop = result.document["loop_control"] as Record<string, unknown>;
  assert.equal(loop["terminal"], true);
  assert.equal(loop["failure_reason"], "ITERATION_BUDGET_EXHAUSTED");
});

test("a finish proposal is STRUCTURED and never a tool proposal", () => {
  const result = gate(JSON.stringify({ action: "finish", summary: "done" }));
  assert.equal(result.valid, true);
  assert.equal(result.document["output_type"], "STRUCTURED");
  assert.equal(result.payload?.action, "finish");
});
