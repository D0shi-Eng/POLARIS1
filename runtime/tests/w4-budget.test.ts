// ميزانيات الأمان. الاختبار ليس "هل الحدود موثّقة" بل "هل تُنهي المهمة فعلًا".

import test from "node:test";
import assert from "node:assert/strict";

import { BudgetLedger, DEFAULT_BUDGET, estimateTokens, type SafetyBudget } from "../src/agent/budget.js";
import { W4ErrorCode } from "../src/errors.js";
import { ProgrammableModel, ScriptedModel } from "../src/model/fixture-model.js";
import { buildRuntime, makeWorkspace, startMission } from "./w4-helpers.js";

const TINY: SafetyBudget = {
  ...DEFAULT_BUDGET,
  max_iterations: 2,
  max_model_calls: 3,
  max_tool_calls: 1,
  max_model_retries: 1,
  mission_timeout_ms: 30000,
};

test("every hard limit is charged and refuses once spent", () => {
  const ledger = new BudgetLedger({ ...DEFAULT_BUDGET, max_iterations: 1, max_model_calls: 1, max_tool_calls: 1, max_model_retries: 1 });
  assert.equal(ledger.chargeIteration().ok, true);
  const secondIteration = ledger.chargeIteration();
  assert.equal(secondIteration.ok, false);
  if (!secondIteration.ok) assert.equal(secondIteration.error.code, W4ErrorCode.EXECUTION_BUDGET_EXCEEDED);

  assert.equal(ledger.chargeModelCall().ok, true);
  assert.equal(ledger.chargeModelCall().ok, false);
  assert.equal(ledger.chargeToolCall().ok, true);
  assert.equal(ledger.chargeToolCall().ok, false);
  assert.equal(ledger.chargeModelRetry().ok, true);
  assert.equal(ledger.chargeModelRetry().ok, false);
});

test("the mission timeout is enforced from a controllable clock, not from wishful waiting", () => {
  let clock = 0;
  const ledger = new BudgetLedger({ ...DEFAULT_BUDGET, mission_timeout_ms: 100 }, () => clock);
  assert.equal(ledger.chargeIteration().ok, true);
  clock = 101;
  const charge = ledger.chargeIteration();
  assert.equal(charge.ok, false);
  assert.equal(ledger.snapshot().exhausted, "MISSION_TIMEOUT");
});

test("byte and token ceilings refuse oversized context and oversized completions", () => {
  const ledger = new BudgetLedger({ ...DEFAULT_BUDGET, max_context_bytes: 64, max_output_tokens: 4 });
  assert.equal(ledger.chargeContext("x".repeat(65)).ok, false);
  assert.equal(ledger.chargeModelOutput("y".repeat(64)).ok, false);
  assert.ok(estimateTokens("abcd") >= 1);
});

test("a model that never finishes exhausts the iteration budget and terminates fail-safe", async () => {
  const workspace = makeWorkspace();
  try {
    const source = workspace.path("project", "README.md");
    const { runtime } = buildRuntime({
      workspace,
      budget: { ...TINY, max_tool_calls: 8 },
      model: new ProgrammableModel(() =>
        JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: source } }),
      ),
    });
    const mission = startMission(runtime, {
      title: "loop forever",
      instruction: "keep reading",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(result.status, "TERMINATED");
    assert.equal(result.termination, "BUDGET_EXHAUSTED");
    assert.ok(result.budget.iterations <= TINY.max_iterations);
    assert.equal(result.errors.at(-1)?.code, W4ErrorCode.EXECUTION_BUDGET_EXCEEDED);
  } finally {
    workspace.dispose();
  }
});

test("the tool budget stops the mission before the extra tool call happens", async () => {
  const workspace = makeWorkspace();
  try {
    const source = workspace.path("project", "README.md");
    const { runtime } = buildRuntime({
      workspace,
      budget: { ...TINY, max_iterations: 6, max_model_calls: 8, max_tool_calls: 1 },
      model: new ProgrammableModel(() =>
        JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: source } }),
      ),
    });
    const mission = startMission(runtime, {
      title: "read twice",
      instruction: "read the readme repeatedly",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(result.termination, "BUDGET_EXHAUSTED");
    assert.equal(result.budget.tool_calls, 1);
    assert.equal(result.budget.exhausted, "TOOL_CALLS");
  } finally {
    workspace.dispose();
  }
});

test("repeated malformed model output exhausts the retry budget and is terminal, never an infinite loop", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({
      workspace,
      budget: TINY,
      model: new ScriptedModel(["this is not json at all"]),
    });
    const mission = startMission(runtime, {
      title: "malformed",
      instruction: "do something",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(result.status, "TERMINATED");
    assert.equal(result.termination, "MODEL_CONTRACT_VIOLATION");
    assert.equal(result.errors.at(-1)?.code, W4ErrorCode.MODEL_CONTRACT_VIOLATION);
    assert.equal(result.errors.at(-1)?.layer, "MODEL_OUTPUT_GATE");
    assert.equal(result.budget.tool_calls, 0);
    assert.ok(result.budget.model_calls <= TINY.max_model_calls);
  } finally {
    workspace.dispose();
  }
});
