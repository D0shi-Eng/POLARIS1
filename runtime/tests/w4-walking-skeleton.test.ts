// المسار السعيد الكامل: مهمة → حلقة وكيل → read_file → استدلال النموذج → write_file.
// الاختبار لا يكتفي بأن الملف ظهر: يتحقق من الطبقة والسبب والأثر والهدف والدليل.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { ProgrammableModel } from "../src/model/fixture-model.js";
import type { ModelRequest } from "../src/model/model-port.js";
import { buildRuntime, makeWorkspace, startMission, type Workspace } from "./w4-helpers.js";

function walkingSkeletonModel(workspace: Workspace): ProgrammableModel {
  const source = workspace.path("project", "README.md");
  const target = workspace.path("out", "summary.txt");

  return new ProgrammableModel((request: ModelRequest): string => {
    const results = request.blocks.filter((b) => b.label.startsWith("TOOL RESULT"));
    if (results.length === 0) {
      return JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: source } });
    }
    if (results.length === 1) {
      // الاستدلال حتمي ومشتق فعلًا من محتوى الأداة، لا نص ثابت.
      const body = results[0]?.body ?? "";
      const heading = body.split("\n").find((line) => line.startsWith("# ")) ?? "# Untitled";
      const bullets = body.split("\n").filter((line) => line.startsWith("- ")).length;
      const summary = `SUMMARY OF ${heading.slice(2).trim()}\nfacts: ${String(bullets)}\nbytes: ${String(Buffer.byteLength(body, "utf8"))}\n`;
      return JSON.stringify({
        action: "invoke_tool",
        capability_id: "polaris.fs.write_file",
        arguments: { path: target, content: summary },
      });
    }
    return JSON.stringify({ action: "finish", summary: "read the README and wrote the summary" });
  });
}

test("the walking skeleton reads a file, reasons over it, and writes a summary", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({
      workspace,
      model: walkingSkeletonModel(workspace),
      readRoots: [workspace.logical],
      writeRoots: [`${workspace.logical}\\out`],
    });

    const mission = startMission(runtime, {
      title: "Summarise the project README",
      instruction: `Read ${workspace.path("project", "README.md")} and write a summary to ${workspace.path("out", "summary.txt")}.`,
      authorization: {
        authorized_read_roots: [workspace.logical],
        authorized_write_roots: [`${workspace.logical}\\out`],
      },
    });

    const result = await runtime.runMission(mission);

    assert.equal(result.status, "COMPLETED", JSON.stringify(result.errors));
    assert.equal(result.termination, "FINISHED");
    assert.equal(result.budget.tool_calls, 2);

    // الأثر وقع فعلًا على نظام ملفات حقيقي.
    const produced = workspace.hostPath("out", "summary.txt");
    assert.equal(existsSync(produced), true, "summary.txt was not created");
    const content = readFileSync(produced, "utf8");
    assert.match(content, /^SUMMARY OF Sample Project/);
    assert.match(content, /facts: 3/);

    // كل استدعاء أداة مرّ برفع تصنيف ناجح مربوط بأثره.
    const toolSteps = result.steps.filter((s) => s.proposed_capability !== undefined);
    assert.equal(toolSteps.length, 2);
    assert.deepEqual(
      toolSteps[0]?.declassifications.map((d) => [d.method, d.action, d.succeeded]),
      [["D2", "read.filesystem", true]],
    );
    assert.deepEqual(
      toolSteps[1]?.declassifications.map((d) => [d.method, d.action, d.succeeded]),
      [
        ["D2", "create.filesystem", true],
        ["D2", "write.filesystem", true],
      ],
    );
    for (const step of toolSteps) assert.equal(step.gateway_ok, true);
  } finally {
    workspace.dispose();
  }
});

test("the happy path leaves an auditable, unbroken causal chain and no network effect", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({
      workspace,
      model: walkingSkeletonModel(workspace),
      writeRoots: [`${workspace.logical}\\out`],
    });
    const mission = startMission(runtime, {
      title: "Summarise the project README",
      instruction: "Read the README and write a summary.",
      authorization: {
        authorized_read_roots: [workspace.logical],
        authorized_write_roots: [`${workspace.logical}\\out`],
      },
    });

    await runtime.runMission(mission);

    const events = runtime.audit.forCorrelation(mission.correlation_id);
    assert.equal(runtime.audit.rejected().length, 0, JSON.stringify(runtime.audit.rejected()));
    assert.ok(events.length >= 8, `expected a full event chain, saw ${String(events.length)}`);

    // معرّف الارتباط ثابت، والتسلسل رتيب داخل السلسلة.
    for (const event of events) assert.equal(event["correlation_id"], mission.correlation_id);
    const sequences = events.map((e) => Number(e["sequence"]));
    assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
    assert.equal(new Set(sequences).size, sequences.length);

    const types = events.map((e) => String(e["event_type"]));
    for (const required of [
      "MODEL_OUTPUT_VALIDATED",
      "INVOCATION_REQUESTED",
      "POLICY_EVALUATED",
      "EXECUTION_STARTED",
      "EXECUTION_COMPLETED",
    ]) {
      assert.ok(types.includes(required), `audit chain is missing ${required}`);
    }

    // كل حدث تقييم سياسة يسمّي الاستدعاء والقرار معًا.
    for (const event of events.filter((e) => e["event_type"] === "POLICY_EVALUATED")) {
      assert.equal(typeof event["invocation_id"], "string");
      assert.equal(typeof event["decision_id"], "string");
    }

    // لا أثر شبكي في أي مكان من السلسلة.
    for (const event of events) {
      const effects = (event["effects"] ?? []) as Array<Record<string, unknown>>;
      for (const effect of effects) assert.ok(!String(effect["action"]).startsWith("network."));
    }
  } finally {
    workspace.dispose();
  }
});
