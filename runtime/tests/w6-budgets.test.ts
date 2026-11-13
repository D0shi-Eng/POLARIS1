// W6 / E — الميزانيات الصلبة كما تُفرض على مهمة كاملة.
//
// W4-BUDGET قاس الدفتر نفسه. المقيس هنا أن الحدّ يُنهي مهمةً حقيقية إنهاءً
// آمنًا: بالاسم الصحيح للحدّ الذي نفد، وبلا حلقة لا تنتهي، وبلا أثر يقع بعد
// نفاد الحدّ الذي كان يفترض أن يمنعه.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { DEFAULT_BUDGET, type BudgetKind, type SafetyBudget } from "../src/agent/budget.js";
import { W4ErrorCode } from "../src/errors.js";
import { ProgrammableModel, ScriptedModel } from "../src/model/fixture-model.js";
import type { MissionResult } from "../src/agent/types.js";
import type { ModelPort } from "../src/model/model-port.js";
import {
  buildDogfoodRuntime,
  makeWorkspace,
  proposeThenFinish,
  startMission,
  type Workspace,
} from "./w6-helpers.js";

function budget(overrides: Partial<SafetyBudget>): SafetyBudget {
  return { ...DEFAULT_BUDGET, ...overrides };
}

async function runWithBudget(
  workspace: Workspace,
  model: ModelPort,
  limits: SafetyBudget,
): Promise<MissionResult> {
  const { runtime } = buildDogfoodRuntime({
    workspace,
    writeRoots: [workspace.path("out")],
    budget: limits,
    model,
  });
  const mission = startMission(runtime, {
    title: "bounded work",
    instruction: "Do the work.",
    authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
  });
  return runtime.runMission(mission);
}

/** كل حدّ يُنهي المهمة إنهاءً آمنًا، ويسمّي نفسه. */
function assertFailSafe(result: MissionResult, kind: BudgetKind): void {
  assert.equal(result.status, "TERMINATED", `mission ended as ${result.status}/${result.termination}`);
  assert.equal(result.termination, "BUDGET_EXHAUSTED");
  assert.equal(result.budget.exhausted, kind, `the exhausted budget was reported as ${String(result.budget.exhausted)}`);
  const error = result.errors.find((candidate) => candidate.code === W4ErrorCode.EXECUTION_BUDGET_EXCEEDED);
  assert.ok(error !== undefined, `no budget error was raised: ${result.errors.map((e) => e.code).join(", ")}`);
  assert.equal(error.layer, "AGENT_BUDGET");
}

test("W6-D07 a model that never finishes exhausts the iteration budget and stops", async () => {
  const workspace = makeWorkspace();
  try {
    const readme = workspace.path("project", "README.md");
    const model = new ProgrammableModel(() =>
      JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: readme } }),
    );
    const result = await runWithBudget(workspace, model, budget({ max_iterations: 2, max_tool_calls: 99 }));
    assertFailSafe(result, "ITERATIONS");
    assert.ok(result.budget.iterations <= 2, "more iterations ran than the budget allows");
  } finally {
    workspace.dispose();
  }
});

test("W6-D07 the tool budget stops the mission before the extra tool call happens", async () => {
  const workspace = makeWorkspace();
  try {
    const readme = workspace.path("project", "README.md");
    const model = new ProgrammableModel(() =>
      JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: readme } }),
    );
    const result = await runWithBudget(workspace, model, budget({ max_tool_calls: 1, max_iterations: 8 }));
    assertFailSafe(result, "TOOL_CALLS");
    assert.equal(result.budget.tool_calls, 1, "the tool budget was overspent");
  } finally {
    workspace.dispose();
  }
});

test("W6-D07 repeatedly malformed output exhausts the retry budget and is terminal", async () => {
  const workspace = makeWorkspace();
  try {
    const model = new ScriptedModel(["this is prose, not a proposal"]);
    const result = await runWithBudget(workspace, model, budget({ max_model_retries: 1 }));
    assert.equal(result.status, "TERMINATED");
    assert.ok(
      ["BUDGET_EXHAUSTED", "MODEL_CONTRACT_VIOLATION"].includes(result.termination),
      `a permanently malformed model must be terminal, saw ${result.termination}`,
    );
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});

test("W6-D07 the mission deadline is enforced and the mission does not run past it", async () => {
  const workspace = makeWorkspace();
  try {
    const readme = workspace.path("project", "README.md");
    const slow: ModelPort = {
      id: "polaris.w6.slow",
      deterministic: true,
      complete: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          model_id: "polaris.w6.slow",
          revision: "fixture",
          raw: JSON.stringify({
            action: "invoke_tool",
            capability_id: "polaris.fs.read_file",
            arguments: { path: readme },
          }),
        };
      },
    };
    const result = await runWithBudget(workspace, slow, budget({ mission_timeout_ms: 10, max_iterations: 8 }));
    assertFailSafe(result, "MISSION_TIMEOUT");
  } finally {
    workspace.dispose();
  }
});

test("W6-D07 an oversized completion is refused by the output ceiling", async () => {
  const workspace = makeWorkspace();
  try {
    const model = new ScriptedModel([JSON.stringify({ action: "finish", summary: "x".repeat(64 * 1024) })]);
    const result = await runWithBudget(workspace, model, budget({ max_output_tokens: 8 }));
    assertFailSafe(result, "OUTPUT_TOKENS");
  } finally {
    workspace.dispose();
  }
});

test("W6-D07 an oversized context is refused before the model is asked to work with it", async () => {
  const workspace = makeWorkspace();
  try {
    const model = new ScriptedModel([JSON.stringify({ action: "finish", summary: "done" })]);
    const result = await runWithBudget(workspace, model, budget({ max_context_bytes: 16 }));
    assertFailSafe(result, "CONTEXT_BYTES");
  } finally {
    workspace.dispose();
  }
});

test("W6-D07 an oversized tool result is refused by the byte ceiling, and no effect follows it", async () => {
  const workspace = makeWorkspace();
  try {
    const readme = workspace.path("project", "README.md");
    const result = await runWithBudget(
      workspace,
      new ScriptedModel(proposeThenFinish("polaris.fs.read_file", { path: readme }) as string[]),
      budget({ max_tool_result_bytes: 8 }),
    );
    assertFailSafe(result, "TOOL_RESULT_BYTES");
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});
