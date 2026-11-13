// قياس مجموعة الـ20 مهمة تحت W4.
//
// كل رقم في هذا الملف يخرج من تشغيل حقيقي في هذه اللحظة. لا رقم مكتوب مسبقًا،
// ولا عيّنة مُعدّلة لتخفيض العبء. المهام غير القابلة للتنفيذ تُصنَّف ولا تُحسب.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runCorpus, type CorpusReport } from "../src/corpus/runner.js";
import { PLANS } from "../src/corpus/plan.js";
import { corpusPath } from "./helpers.js";
import { makeWorkspace } from "./w4-helpers.js";
import { runtimeSrcPath } from "./helpers.js";

let report: CorpusReport | undefined;

async function measured(): Promise<CorpusReport> {
  report ??= await runCorpus({ corpusPath: corpusPath(), makeWorkspace });
  return report;
}

test("every mission in the corpus has a declared W4 execution class", async () => {
  const result = await measured();
  assert.equal(result.missions_total, 20);
  assert.equal(Object.keys(PLANS).length, 20);
  for (const mission of result.missions) {
    assert.ok(["FULL_LOOP", "POLICY_ONLY", "NOT_EXECUTABLE_IN_W4"].includes(mission.execution_class));
    if (mission.execution_class === "NOT_EXECUTABLE_IN_W4") {
      assert.ok((mission.not_executable_reason ?? "").length > 40, `${mission.mission_id} has no honest reason`);
      assert.equal(mission.matches_corpus_expectation, null, "an unrunnable mission is neither a pass nor a fail");
      assert.equal(mission.declassification_attempts, 0);
    }
  }
});

test("the missions that run end to end really executed effects, and the denials name their layer", async () => {
  const result = await measured();
  const fullLoop = result.missions.filter((m) => m.execution_class === "FULL_LOOP");
  assert.ok(fullLoop.length >= 12, `only ${String(fullLoop.length)} missions run end to end`);

  for (const mission of fullLoop) {
    if (mission.policy_result === "ALLOW") {
      assert.ok(mission.effects_executed > 0, `${mission.mission_id} claims ALLOW but executed nothing`);
    } else {
      assert.ok(mission.reason_codes.length > 0, `${mission.mission_id} was denied with no reason code`);
      assert.equal(mission.denied_layer, "PDP", `${mission.mission_id} was denied outside the policy layer`);
    }
  }
});

test("D1 and D2 were both exercised for real, and both failed for real", async () => {
  const result = await measured();
  assert.ok(result.d2_attempts > 0, "D2 was never exercised");
  assert.ok(result.d2_successes > 0, "D2 never succeeded");
  assert.ok(result.d2_failures > 0, "D2 never failed, so the failure path is unmeasured");
  assert.ok(result.d1_attempts > 0, "D1 was never exercised");
  assert.ok(result.d1_successes > 0, "D1 never succeeded");
});

test("M08 needs two declassifications, and the second read is carried by D1 alone", async () => {
  const result = await measured();
  const m08 = result.missions.find((m) => m.mission_id === "M08");
  assert.ok(m08 !== undefined);
  assert.equal(m08.execution_class, "FULL_LOOP");

  // الخطوة الأولى: ملف البيان نفسه، مصرّح به كقيمة مستخدم مباشرة.
  assert.equal(m08.d2_successes, 1, "the user-pointed manifest should have been declassified by provenance");
  // الخطوة الثانية: المسار المستخرَج من محتوى غير موثوق. لا مرساة تغطيه.
  assert.equal(m08.d1_successes, 1, "the schema-constrained extraction did not carry the second read");
  assert.ok(m08.d2_failures >= 1, "the second read must have had no provenance anchor to lean on");
  assert.equal(m08.policy_result, "ALLOW");
  assert.equal(m08.effects_executed, 2);
  assert.ok(m08.declassification_attempts >= 2);
});

test("network missions were decided but never executed", async () => {
  const result = await measured();
  const network = result.missions.filter((m) => m.execution_class === "POLICY_ONLY");
  assert.ok(network.length > 0);
  for (const mission of network) {
    assert.equal(mission.effects_executed, 0, "a network effect must never be executed in W4");
    assert.notEqual(mission.policy_result, "NOT_EVALUATED");
    assert.ok(mission.reason_codes.length > 0);
  }
});

test("the burden metrics are computed only from missions that actually ran", async () => {
  const result = await measured();
  const fullLoop = result.metrics.find((m) => m.population === "FULL_LOOP");
  assert.ok(fullLoop !== undefined);
  assert.equal(
    fullLoop.missions,
    result.missions.filter((m) => m.execution_class === "FULL_LOOP").length,
  );
  const total = result.missions
    .filter((m) => m.execution_class === "FULL_LOOP")
    .reduce((sum, m) => sum + m.declassification_attempts, 0);
  assert.equal(fullLoop.declassification_attempts_total, total);
  assert.equal(fullLoop.mean_per_mission, Math.round((total / fullLoop.missions) * 1000) / 1000);
  assert.ok(fullLoop.p50 >= 0 && fullLoop.p95 >= fullLoop.p50);
});

test("no approval is ever claimed to have happened", async () => {
  const result = await measured();
  assert.ok(result.caveats.some((c) => c.includes("No approval flow exists in W4")));
  for (const mission of result.missions) {
    assert.ok(["NONE", "WOULD_REQUIRE_APPROVAL", "UNRESOLVED", "NOT_APPLICABLE"].includes(mission.manual_intervention));
  }
});

test("the measured report is written to the evidence directory", async () => {
  const result = await measured();
  const target = join(runtimeSrcPath(), "..", "..", "evidence", "w4-corpus-results.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  assert.ok(result.measured_at.endsWith("Z"));
});
