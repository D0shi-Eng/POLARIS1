// W6 / C — قوس الموافقة داخل مهمة حقيقية.
//
// W5-B أثبت العقد: الالتزام، والربط، والاستهلاك مرة واحدة، ورفض الإعادة. هنا
// يُقاس شيء آخر: أن ذلك العقد هو ما يحكم مهمةً كاملة — أن الأثر ينتظر الإنسان
// فعلًا، وأن ترتيب الأحداث في الدفتر يقول ذلك، وأن رفض الإنسان لا يترك خلفه
// أثرًا ولا إثباتًا ولا ادعاء نجاح.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { ScriptedModel } from "../src/model/fixture-model.js";
import { W5ErrorCode } from "../src/errors.js";
import type { Doc } from "../src/policy/types.js";
import {
  buildDogfoodRuntime,
  eventTypes,
  ledgerIsSound,
  makeWorkspace,
  missionEvents,
  ownerAnswers,
  requireArtefact,
  startMission,
  writeThenFinish,
} from "./w6-helpers.js";

const APPROVAL_EFFECTS = ["write.filesystem", "create.filesystem"];
const CONTENT = "the approved artefact";

test("W6-D04 the effect waits for the human, then happens once and is proven", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "approved-artifact.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      approvalRequiredEffects: APPROVAL_EFFECTS,
      model: new ScriptedModel(writeThenFinish(target, CONTENT) as string[]),
    });
    const owner = ownerAnswers(runtime, () => "GRANT");
    const mission = startMission(runtime, {
      title: "produce a controlled artefact",
      instruction: "Create the controlled artefact.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    // لقطة قبل الإثبات: الرصد المؤكِّد يمرّ بالبوابة ويُصدر منحته، فخلطه بأحداث
    // المهمة يجعل «منحة واحدة لهذا الأثر» تعني شيئًا آخر.
    const events = [...missionEvents(runtime, mission.correlation_id)];
    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);

    assert.equal(result.status, "COMPLETED", JSON.stringify(result.errors));
    assert.equal(owner.seen.length, 1, "exactly one approval should have been presented");
    assert.equal(owner.seen[0]?.single_use, true, "the receipt must be single-use");
    assert.equal(owner.seen[0]?.summary.target_logical, target, "the human was shown a different target than the effect");

    // الأثر وقع مرة واحدة، بمحتواه المُوافَق عليه.
    assert.equal(existsSync(workspace.hostPath("out", "approved-artifact.txt")), true);
    assert.equal(readFileSync(workspace.hostPath("out", "approved-artifact.txt"), "utf8"), CONTENT);

    const types = eventTypes(events);
    for (const required of ["APPROVAL_REQUIRED", "APPROVAL_PRESENTED", "APPROVAL_GRANTED", "EXECUTION_GRANT_ISSUED"]) {
      assert.ok(types.includes(required), `the approval arc is missing ${required}`);
    }
    assert.equal(types.includes("APPROVAL_REJECTED"), false);
    assert.equal(types.includes("APPROVAL_EXPIRED"), false);

    // الترتيب هو الادعاء: لا منحة تنفيذ قبل أن يُمنح الإيصال.
    assert.ok(
      types.indexOf("APPROVAL_GRANTED") < types.indexOf("EXECUTION_GRANT_ISSUED"),
      "an execution grant was issued before the approval that authorises it",
    );

    // ومرة واحدة تعني واحدة: منحة تنفيذ واحدة لهذا الأثر.
    assert.equal(
      types.filter((type) => type === "EXECUTION_GRANT_ISSUED").length,
      1,
      "an approved effect ran more than once",
    );

    const sound = ledgerIsSound(runtime);
    assert.equal(sound.ok, true, sound.detail);
    assert.equal(proof.status, "PROVEN", `${String(proof.reason_code)}: ${proof.detail}`);
  } finally {
    workspace.dispose();
  }
});

test("W6-D04 approval is an obligation on ALLOW, never a third decision result", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "approved-artifact.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      approvalRequiredEffects: APPROVAL_EFFECTS,
      model: new ScriptedModel(writeThenFinish(target, CONTENT) as string[]),
    });
    ownerAnswers(runtime, () => "GRANT");
    const mission = startMission(runtime, {
      title: "produce a controlled artefact",
      instruction: "Create the controlled artefact.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    const decisions = missionEvents(runtime, mission.correlation_id).filter(
      (event) => event["event_type"] === "POLICY_EVALUATED",
    );
    assert.ok(decisions.length > 0, "no policy decision was recorded");
    const declared = ["SUCCESS", "DENIED", "FAILED", "TIMEOUT", "CANCELLED"];
    for (const decision of decisions) {
      const status = String((decision["outcome"] as Doc | undefined)?.["status"] ?? "");
      assert.ok(
        declared.includes(status),
        `a policy decision reported '${status}': approval must never become a third decision result`,
      );
    }

    // والالتزام يظهر بوصفه حدثًا مستقلًا، لا بوصفه حالة قرار ثالثة.
    assert.ok(
      eventTypes(missionEvents(runtime, mission.correlation_id)).includes("APPROVAL_REQUIRED"),
      "the obligation must be recorded as its own event",
    );
  } finally {
    workspace.dispose();
  }
});

test("W6-D05 a refused approval leaves no artefact, no grant and no proof", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "approved-artifact.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      approvalRequiredEffects: APPROVAL_EFFECTS,
      model: new ScriptedModel(writeThenFinish(target, "should never exist") as string[]),
    });
    ownerAnswers(runtime, () => "REJECT");
    const mission = startMission(runtime, {
      title: "produce a controlled artefact",
      instruction: "Create the controlled artefact.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);

    assert.equal(existsSync(workspace.hostPath("out", "approved-artifact.txt")), false);
    assert.ok(result.errors.some((error) => error.code === W5ErrorCode.APPROVAL_REJECTED));
    assert.equal(result.summary, undefined, "a refused mission must not carry the model's success claim");
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_TARGET_MISSING);

    const types = eventTypes(missionEvents(runtime, mission.correlation_id));
    assert.ok(types.includes("APPROVAL_REJECTED"));
    assert.equal(types.includes("EXECUTION_GRANT_ISSUED"), false, "no grant may be issued for a refused approval");

    const sound = ledgerIsSound(runtime);
    assert.equal(sound.ok, true, sound.detail);
  } finally {
    workspace.dispose();
  }
});

test("W6-D05 an approval nobody answers expires, and expiry means no effect", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "approved-artifact.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      approvalRequiredEffects: APPROVAL_EFFECTS,
      approvalExpirySeconds: 1,
      model: new ScriptedModel(writeThenFinish(target, "should never exist") as string[]),
    });
    ownerAnswers(runtime, () => "IGNORE");
    const mission = startMission(runtime, {
      title: "produce a controlled artefact",
      instruction: "Create the controlled artefact.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(existsSync(workspace.hostPath("out", "approved-artifact.txt")), false);
    assert.equal(result.status, "TERMINATED");
    const codes = result.errors.map((error) => error.code);
    assert.ok(
      codes.includes(W5ErrorCode.APPROVAL_EXPIRED) || codes.includes(W5ErrorCode.APPROVAL_REQUIRED),
      `an unanswered approval must end the mission without an effect, saw ${codes.join(", ")}`,
    );
    assert.equal(
      eventTypes(missionEvents(runtime, mission.correlation_id)).includes("EXECUTION_GRANT_ISSUED"),
      false,
    );
  } finally {
    workspace.dispose();
  }
});
