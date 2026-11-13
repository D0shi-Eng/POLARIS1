// W6 / F — مخرج النموذج، وإثبات الإنجاز، في المسار المُركَّب.
//
// ادعاء واحد يجمع الملف: مخرجٌ غير صالح لا يصير استدعاءً، وادعاءُ نموذجٍ
// بالإنجاز ليس إنجازًا. الأول يُقاس بغياب أحداث كان يجب ألا تقع، والثاني
// باجتماع حالتين صادقتين في وقت واحد: المهمة اكتملت، والإثبات لم يقع.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { ScriptedModel } from "../src/model/fixture-model.js";
import { W5ErrorCode } from "../src/errors.js";
import type { Doc } from "../src/policy/types.js";
import type { PolarisRuntime } from "../src/runtime.js";
import {
  buildDogfoodRuntime,
  eventTypes,
  ledgerIsSound,
  makeWorkspace,
  missionEvents,
  requireArtefact,
  startMission,
  type Workspace,
} from "./w6-helpers.js";

interface Attempted {
  readonly runtime: PolarisRuntime;
  readonly correlationId: string;
  readonly events: readonly Doc[];
  readonly workspace: Workspace;
}

async function attempt(outputs: readonly string[]): Promise<Attempted> {
  const workspace = makeWorkspace();
  const { runtime } = buildDogfoodRuntime({
    workspace,
    writeRoots: [workspace.path("out")],
    model: new ScriptedModel(outputs as string[]),
  });
  const mission = startMission(runtime, {
    title: "structured output only",
    instruction: "Do the work.",
    authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
  });
  await runtime.runMission(mission);
  return {
    runtime,
    workspace,
    correlationId: mission.correlation_id,
    events: missionEvents(runtime, mission.correlation_id),
  };
}

/**
 * لا شيء صار استدعاءً: لا قرار سياسة، ولا منحة، ولا أثر — والرفض مُسجَّل.
 *
 * الحدّ المقصود هنا هو الاستدعاء لا الاقتراح. مخرَجٌ يخالف مخطط المقترح يُردّ
 * عند بوابة المخرج، ومقترحٌ يحمل وسيطةً لم تعلنها القدرة يُردّ عند البوابة
 * بعد أن يُسجَّل اقتراحًا. الحالتان تقفان قبل السياسة والفرض، والفارق بينهما
 * حقيقة عن أي طبقة منعت — لا تساهل في أيّهما.
 */
function assertNeverBecameAnInvocation(run: Attempted): void {
  const types = eventTypes(run.events);
  const refusedAtOutputGate = types.some(
    (type, index) => type === "MODEL_OUTPUT_VALIDATED" && (run.events[index]?.["outcome"] as Doc)["status"] === "FAILED",
  );
  const refusedAtGateway = types.includes("CONTRACT_VIOLATION_DETECTED");
  assert.ok(refusedAtOutputGate || refusedAtGateway, `the refusal was not recorded: ${types.join(", ")}`);
  assert.equal(types.includes("POLICY_EVALUATED"), false, "an invalid model output reached the policy layer");
  assert.equal(types.includes("EXECUTION_GRANT_ISSUED"), false, "an invalid model output produced an execution grant");
  assert.equal(existsSync(run.workspace.hostPath("out", "summary.txt")), false);
  const sound = ledgerIsSound(run.runtime);
  assert.equal(sound.ok, true, sound.detail);
}

const CASES: ReadonlyArray<{ readonly name: string; readonly output: string }> = [
  { name: "prose", output: "Sure! I'll read the file for you." },
  { name: "malformed JSON", output: '{"action": "invoke_tool", "capability_id": ' },
  { name: "schema-invalid JSON", output: JSON.stringify({ hello: "world" }) },
  {
    name: "an undeclared extra field",
    output: JSON.stringify({
      action: "invoke_tool",
      capability_id: "polaris.fs.read_file",
      arguments: { path: "T:\\POLARIS-W4\\project\\README.md" },
      confinement: "NONE",
    }),
  },
  {
    name: "an unknown capability",
    output: JSON.stringify({ action: "invoke_tool", capability_id: "polaris.shell.exec", arguments: { path: "x" } }),
  },
  {
    name: "an argument the capability never declared",
    output: JSON.stringify({
      action: "invoke_tool",
      capability_id: "polaris.fs.read_file",
      arguments: { path: "T:\\POLARIS-W4\\project\\README.md", follow_symlinks: true },
    }),
  },
];

for (const testCase of CASES) {
  test(`W6-D08 ${testCase.name} never becomes an invocation`, async () => {
    const run = await attempt([testCase.output]);
    try {
      assertNeverBecameAnInvocation(run);
    } finally {
      run.workspace.dispose();
    }
  });
}

test("W6-D08 an exhausted retry budget makes invalid output terminal, never a loop", async () => {
  const run = await attempt(["still prose"]);
  try {
    assertNeverBecameAnInvocation(run);
    assert.ok(
      eventTypes(run.events).includes("MISSION_FAILED"),
      "a permanently malformed model must end the mission, and the ledger must say so",
    );
  } finally {
    run.workspace.dispose();
  }
});

test("W6-D08 'the model says done' with no artefact is COMPLETED and NOT_PROVEN at once", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel([JSON.stringify({ action: "finish", summary: "I wrote the summary." })]),
    });
    const mission = startMission(runtime, {
      title: "claim without doing",
      instruction: "Write the summary.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);

    // الحالتان صادقتان معًا، ولا واحدة منهما تُشتق من الأخرى.
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.summary, "I wrote the summary.");
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_TARGET_MISSING);
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});
