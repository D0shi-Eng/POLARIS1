// W6 / D — إيقاف الطوارئ فوق النظام المُركَّب.
//
// W5-C قاس دلالات الملكية والإيقاف على مكوّناتها. المقيس هنا أعلى منها بدرجة:
// أن `PolarisRuntime` نفسه — الجذر الذي يملك القبول والسجل ودفتر المنح والدفتر —
// يوقف عملًا حيًّا، ثم يرفض عملًا جديدًا، ولا يستشير نموذجًا في أي من الحالتين.
//
// حصر ويندوز ليس محل هذا الملف. ادعاء «ابن محصور داخل AppContainer وJob يموت
// بإغلاق الـJob» يقيسه مسبار W5 الأصلي (W5-P01) على ويندوز، ولا يُقرأ من هنا.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

import { ScriptedModel } from "../src/model/fixture-model.js";
import { childProcessHandle } from "../src/control/execution-registry.js";
import { W5ErrorCode } from "../src/errors.js";
import { newId } from "../src/ids.js";
import type { ModelPort, ModelRawOutput } from "../src/model/model-port.js";
import type { PolarisRuntime } from "../src/runtime.js";
import {
  buildDogfoodRuntime,
  eventTypes,
  ledgerIsSound,
  makeWorkspace,
  startMission,
  writeThenFinish,
  type Workspace,
} from "./w6-helpers.js";

/** نموذج يرمي عند كل استدعاء. وجوده يثبت أن مسار الإيقاف لا يمرّ به. */
class ThrowingModel implements ModelPort {
  public readonly id = "polaris.w6.throwing";
  public readonly deterministic = true;
  public calls = 0;
  public complete(): Promise<ModelRawOutput> {
    this.calls += 1;
    throw new Error("the model must never be consulted on the stop path");
  }
}

/** ابن حيّ مملوك ومسجَّل في سجل التنفيذات نفسه الذي يستعمله الإنتاج. */
function registerLiveChild(runtime: PolarisRuntime): { readonly child: ChildProcess; readonly executionId: string } {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 3600000);"], { stdio: "ignore" });
  const executionId = newId();
  runtime.controls.executions.register(
    childProcessHandle({
      execution_id: executionId,
      pid: child.pid ?? 0,
      grant_id: newId(),
      kill: (signal) => child.kill(signal),
      hasExited: () => child.exitCode !== null || child.signalCode !== null,
    }),
  );
  return { child, executionId };
}

function stoppableRuntime(workspace: Workspace, model: ModelPort): PolarisRuntime {
  return buildDogfoodRuntime({
    workspace,
    writeRoots: [workspace.path("out")],
    model,
  }).runtime;
}

test("W6-D06 a live owned execution is dead after the stop, with zero survivors", async () => {
  const workspace = makeWorkspace();
  const model = new ScriptedModel(writeThenFinish(workspace.path("out", "never.txt"), "x") as string[]);
  const runtime = stoppableRuntime(workspace, model);
  const live = registerLiveChild(runtime);
  try {
    assert.equal(live.child.exitCode, null, "the owned child was not alive before the stop");

    const report = await runtime.panicStop("W6 dogfood: owner pressed stop");

    assert.equal(report.complete, true, `stop did not complete: ${String(report.reason_code)}`);
    assert.equal(report.state, "STOPPED");
    assert.deepEqual(report.survivors, [], "an owned execution survived the stop");
    assert.equal(report.alive_before, 1);
    assert.equal(report.terminations.length, 1);
    assert.equal(report.terminations[0]?.alive_before, true);
    assert.equal(report.terminations[0]?.alive_after, false);
    assert.equal(report.terminations[0]?.terminate_called, true);

    // الملكية تسجيل لا اسم: السجل هو ما عرّف ما يُنهى.
    assert.equal(report.owned_executions, 1);
    assert.equal(runtime.controls.executions.live().length, 0);

    // والدفتر يحمل القوس كاملًا ويظل متماسكًا بعد الإيقاف.
    const sound = ledgerIsSound(runtime);
    assert.equal(sound.ok, true, sound.detail);
  } finally {
    live.child.kill("SIGKILL");
    workspace.dispose();
  }
});

test("W6-D06 after the stop no new mission is admitted, and the model is never consulted", async () => {
  const workspace = makeWorkspace();
  const model = new ThrowingModel();
  const runtime = stoppableRuntime(workspace, model);
  try {
    const report = await runtime.panicStop("W6 dogfood: stop before any mission");
    assert.equal(report.complete, true);
    assert.equal(model.calls, 0, "the stop path consulted the model");

    const mission = startMission(runtime, {
      title: "work after the stop",
      instruction: "Do something.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(result.status, "TERMINATED");
    assert.equal(result.termination, "TOOL_DENIED");
    assert.equal(model.calls, 0, "a mission refused by admission still reached the model");
    // الرمز يقول أي بوابة رفضت: بوابة القبول عند حالة STOPPED تُصدر
    // EXECUTION_REFUSED_WHILE_STOPPED، ونقطة الفرض تُصدر PANIC_STOP_ACTIVE.
    // كلاهما صادق، والمطلوب أن يُسمّى الموضوع المرفوض لا أن يُعمَّم الرفض.
    const refusal = result.errors.find(
      (error) =>
        error.code === W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED || error.code === W5ErrorCode.PANIC_STOP_ACTIVE,
    );
    assert.ok(refusal !== undefined, `expected a stop refusal, saw ${result.errors.map((e) => e.code).join(", ")}`);
    assert.equal(refusal.layer, "PANIC_STOP");
    assert.ok(refusal.internal_detail.includes("MISSION"), "the refusal did not name the subject it refused");
    // ميزانية لم تُصرف: المهمة لم تبدأ أصلًا.
    assert.equal(result.budget.iterations, 0);
    assert.equal(result.budget.model_calls, 0);
  } finally {
    workspace.dispose();
  }
});

test("W6-D06 outstanding authority issued before the stop is invalidated by it", async () => {
  const workspace = makeWorkspace();
  const runtime = stoppableRuntime(workspace, new ThrowingModel());
  try {
    const grantId = newId();
    runtime.controls.grants.issued(grantId, newId(), newId());
    assert.equal(runtime.controls.grants.state(grantId), "ISSUED");

    const report = await runtime.panicStop("W6 dogfood: invalidate outstanding authority");

    assert.ok(report.invalidated_grants.includes(grantId), "an outstanding grant survived the stop");
    assert.equal(runtime.controls.grants.state(grantId), "INVALIDATED");
    assert.equal(runtime.controls.grants.outstanding().length, 0);
  } finally {
    workspace.dispose();
  }
});

test("W6-D06 the stop is fully audited and entering STOPPED is not a claim about the future", async () => {
  const workspace = makeWorkspace();
  const runtime = stoppableRuntime(workspace, new ThrowingModel());
  const live = registerLiveChild(runtime);
  try {
    const report = await runtime.panicStop("W6 dogfood: audited stop");
    const recorded = eventTypes(runtime.audit.events());

    for (const required of [
      "PANIC_STOP_REQUESTED",
      "EXECUTOR_TERMINATED_BY_STOP",
      "PANIC_STOP_ENTERED",
      "PANIC_STOP_COMPLETED",
    ]) {
      assert.ok(recorded.includes(required), `the stop arc is missing ${required}: ${recorded.join(", ")}`);
    }
    assert.equal(report.complete, true);

    // إيقاف ثانٍ لا يعيد التسلسل ولا يدّعي اكتمالًا ثانيًا.
    const again = await runtime.panicStop("W6 dogfood: second stop");
    assert.equal(again.state, "STOPPED");
    assert.deepEqual(again.survivors, []);

    const sound = ledgerIsSound(runtime);
    assert.equal(sound.ok, true, sound.detail);
  } finally {
    live.child.kill("SIGKILL");
    workspace.dispose();
  }
});
