// W5 / C — إيقاف الطوارئ.
//
// الادعاءات المقاسة هنا ثلاثة: القبول يُغلق، والسلطة المعلّقة تُبطل، والتنفيذ
// المملوك الحيّ يموت ولا ينجو منه شيء. وكلها تقع بلا نموذج ولا مزوّد ولا شبكة.
//
// حصر ويندوز ليس محل هذا الملف: هذه الاختبارات تقيس دلالات الملكية والإيقاف
// على المضيف الحالي. ادعاء «ابن محصور داخل AppContainer وJob يموت بإغلاق
// الـJob» يقيسه مسبار W5 الأصلي على ويندوز، ولا يُقرأ من هنا.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditEmitter } from "../src/audit/emitter.js";
import { ConfigService } from "../src/config/service.js";
import { PanicStopAdmission } from "../src/control/admission.js";
import { childProcessHandle, OwnedExecutionRegistry } from "../src/control/execution-registry.js";
import { IssuedGrantLedger } from "../src/control/grant-ledger.js";
import { PanicStopMachine } from "../src/control/panic-stop.js";
import { PanicStopController } from "../src/control/stop-controller.js";
import { W5ErrorCode } from "../src/errors.js";
import { materializeDescriptor, WRITE_FILE, executionRequirements } from "../src/gateway/catalog.js";
import { newId, nowTimestamp, sha256 } from "../src/ids.js";
import { buildExecutionEnvironment, ChildProcessExecutionHost } from "../src/pep/child-execution-host.js";
import { FilesystemPep } from "../src/pep/filesystem-pep.js";
import type { ExecutionAdmission } from "../src/control/admission.js";
import { HostPathAuthority } from "../src/platform/host-path-authority.js";
import { LocalPdp } from "../src/policy/pdp.js";
import { POLICY_EPOCH, POLICY_SET_VERSION, type Doc } from "../src/policy/types.js";
import { agentCallerIdentity } from "../src/runtime.js";
import { ScriptedModel } from "../src/model/fixture-model.js";
import { makeWorkspace } from "./w4-helpers.js";
import { buildW5Runtime, startMission, writeThenFinish } from "./w5-helpers.js";

function systemIdentity(): Doc {
  return { caller_type: "SYSTEM", principal_id: newId(), trust_tier: "TIER_0_TRUSTED", session_id: newId() };
}

interface StopHarness {
  readonly machine: PanicStopMachine;
  readonly admission: PanicStopAdmission;
  readonly executions: OwnedExecutionRegistry;
  readonly grants: IssuedGrantLedger;
  readonly audit: AuditEmitter;
  readonly controller: PanicStopController;
}

function stopHarness(): StopHarness {
  const machine = new PanicStopMachine();
  const executions = new OwnedExecutionRegistry();
  const grants = new IssuedGrantLedger();
  const audit = new AuditEmitter();
  return {
    machine,
    executions,
    grants,
    audit,
    admission: new PanicStopAdmission(machine),
    controller: new PanicStopController({
      machine,
      executions,
      grants,
      audit,
      core_actor_id: newId(),
      system_identity: systemIdentity(),
      termination_timeout_ms: 4000,
    }),
  };
}

/**
 * ابن مملوك يبقى حيًّا عمدًا، مُطلَق بنفس البيئة المبنية التي يستعملها منفّذ
 * W4 — لا بيئة موروثة، ولا shell، وثلاثة أنابيب صريحة.
 *
 * الغرض من وجوده: أن يكون هناك شيء حيّ فعلًا وقت الإيقاف. اختبار إيقاف بلا
 * عملية حيّة لا يثبت شيئًا عن الإيقاف.
 */
function liveOwnedChild(registry: OwnedExecutionRegistry): { readonly executionId: string; readonly pid: number } {
  const environment = buildExecutionEnvironment(join(tmpdir(), "polaris-w5-panic"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 3600000);"], {
    env: environment.variables,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: false,
    windowsHide: true,
  });
  assert.ok(typeof child.pid === "number", "the controlled fixture did not start");
  const executionId = newId();
  registry.register(
    childProcessHandle({
      execution_id: executionId,
      pid: child.pid,
      kill: (signal) => child.kill(signal),
      hasExited: () => child.exitCode !== null || child.signalCode !== null,
    }),
  );
  return { executionId, pid: child.pid };
}

// ── آلة الحالة ──────────────────────────────────────────────────────────────

test("the state machine moves only along the declared transitions", () => {
  const machine = new PanicStopMachine();
  assert.equal(machine.state(), "RUNNING");
  assert.equal(machine.admits(), true);

  assert.equal(machine.completeStop(nowTimestamp()), false, "STOPPED cannot be reached from RUNNING");
  assert.equal(machine.resume(nowTimestamp()), false, "RUNNING cannot be resumed");

  assert.equal(machine.beginStop(nowTimestamp()), true);
  assert.equal(machine.state(), "STOPPING");
  assert.equal(machine.admits(), false);
  assert.equal(machine.beginStop(nowTimestamp()), false, "a second stop request does not restart the sequence");

  assert.equal(machine.completeStop(nowTimestamp()), true);
  assert.equal(machine.state(), "STOPPED");
  assert.equal(machine.admits(), false);

  assert.equal(machine.resume(nowTimestamp()), true);
  assert.equal(machine.state(), "RUNNING");
  assert.deepEqual(
    machine.transitions().map((t) => `${t.from}->${t.to}`),
    ["RUNNING->STOPPING", "STOPPING->STOPPED", "STOPPED->RUNNING"],
  );
});

test("there is no implicit path back to RUNNING: only an explicit owner action resumes", async () => {
  const h = stopHarness();
  await h.controller.stop("test");
  assert.equal(h.controller.state(), "STOPPED");

  // انتظار حقيقي: لا مؤقّت ولا إعادة محاولة تُعيد النظام إلى العمل.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(h.controller.state(), "STOPPED");

  assert.equal(h.controller.resume(), true);
  assert.equal(h.controller.state(), "RUNNING");
});

// ── الإيقاف نفسه ────────────────────────────────────────────────────────────

test("a live owned child is alive before the stop and dead after it, with zero survivors", async () => {
  const h = stopHarness();
  const child = liveOwnedChild(h.executions);

  const handle = h.executions.all()[0]?.handle;
  assert.ok(handle !== undefined);
  assert.equal(handle.isAlive(), true, "the fixture must be alive before the stop, or the test proves nothing");

  const report = await h.controller.stop("owner pressed stop");

  assert.equal(report.complete, true, JSON.stringify(report));
  assert.equal(report.state, "STOPPED");
  assert.equal(report.reason_code, null);
  assert.deepEqual(report.survivors, []);
  assert.equal(report.alive_before, 1);
  assert.equal(handle.isAlive(), false, "the owned child survived the stop");

  const record = report.terminations.find((t) => t.execution_id === child.executionId);
  assert.ok(record !== undefined);
  assert.equal(record.alive_before, true);
  assert.equal(record.terminate_called, true);
  assert.equal(record.alive_after, false);
});

test("the stop transition is fully audited, and the chain still verifies", async () => {
  const h = stopHarness();
  liveOwnedChild(h.executions);
  const report = await h.controller.stop("owner pressed stop");

  const types = h.audit.forCorrelation(h.controller.correlationId()).map((e) => String(e["event_type"]));
  for (const required of [
    "PANIC_STOP_REQUESTED",
    "PANIC_STOP_ENTERED",
    "EXECUTOR_TERMINATED_BY_STOP",
    "PANIC_STOP_COMPLETED",
  ]) {
    assert.ok(types.includes(required), `the stop arc is missing ${required}`);
  }
  assert.equal(h.audit.rejected().length, 0, JSON.stringify(h.audit.rejected()));
  assert.equal(report.complete, true);

  h.controller.resume();
  assert.ok(
    h.audit
      .forCorrelation(h.controller.correlationId())
      .some((e) => e["event_type"] === "SYSTEM_RESUMED"),
  );
});

test("stopping twice does not restart the sequence and does not claim a second completion", async () => {
  const h = stopHarness();
  liveOwnedChild(h.executions);

  const first = await h.controller.stop("first");
  const second = await h.controller.stop("second");

  assert.equal(first.complete, true);
  assert.equal(second.complete, false);
  assert.equal(second.reason_code, W5ErrorCode.PANIC_STOP_ACTIVE);
  assert.equal(h.controller.state(), "STOPPED");
});

test("outstanding grants are invalidated by the stop", async () => {
  const h = stopHarness();
  h.grants.issued("grant-a", newId(), newId());
  h.grants.issued("grant-b", newId(), newId());
  h.grants.consumed("grant-b");

  const report = await h.controller.stop("owner pressed stop");

  assert.deepEqual([...report.invalidated_grants], ["grant-a"]);
  assert.equal(h.grants.state("grant-a"), "INVALIDATED");
  assert.equal(h.grants.state("grant-b"), "CONSUMED");
});

test("a stop that cannot prove termination stays in STOPPING and says why", async () => {
  const machine = new PanicStopMachine();
  const executions = new OwnedExecutionRegistry();
  const controller = new PanicStopController({
    machine,
    executions,
    grants: new IssuedGrantLedger(),
    audit: new AuditEmitter(),
    core_actor_id: newId(),
    system_identity: systemIdentity(),
    termination_timeout_ms: 150,
    poll_interval_ms: 20,
  });

  // تنفيذ مملوك يرفض أن يموت. الحكم يجب أن يكون فشلًا مُسمّى لا «موقوف رغم ذلك».
  executions.register({
    execution_id: "stubborn",
    kind: "CONTROLLED_FIXTURE",
    isAlive: () => true,
    terminate: () => undefined,
  });

  const report = await controller.stop("owner pressed stop");
  assert.equal(report.complete, false);
  assert.equal(report.reason_code, W5ErrorCode.PANIC_STOP_SURVIVORS_FOUND);
  assert.deepEqual([...report.survivors], ["stubborn"]);
  assert.equal(controller.state(), "STOPPING", "STOPPED must be earned, not announced");
});

// ── القبول ──────────────────────────────────────────────────────────────────

test("admission names the subject it refused, and distinguishes STOPPING from STOPPED", async () => {
  const h = stopHarness();
  assert.equal(h.admission.admit("MISSION").ok, true);

  h.machine.beginStop(nowTimestamp());
  const duringStop = h.admission.admit("INVOCATION");
  assert.equal(duringStop.ok, false);
  assert.equal(duringStop.ok ? "" : duringStop.error.code, W5ErrorCode.PANIC_STOP_IN_PROGRESS);

  h.machine.completeStop(nowTimestamp());
  const afterStop = h.admission.admit("EXECUTION_GRANT");
  assert.equal(afterStop.ok, false);
  assert.equal(afterStop.ok ? "" : afterStop.error.code, W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED);
  assert.equal(afterStop.ok ? "" : afterStop.error.layer, "PANIC_STOP");
  await Promise.resolve();
});

// ── التكامل مع مسار الأثر ───────────────────────────────────────────────────

test("no new mission is admitted while stopped, and the model is never consulted", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    let modelCalls = 0;
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: {
        id: "counting",
        deterministic: true,
        complete: () => {
          modelCalls += 1;
          return Promise.resolve({ model_id: "counting", raw: writeThenFinish(target, "x")[0] as string });
        },
      },
    });

    const report = await runtime.panicStop("owner pressed stop");
    assert.equal(report.complete, true);

    const mission = startMission(runtime, {
      title: "should not run",
      instruction: "write something",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(result.status, "TERMINATED");
    assert.equal(result.errors[0]?.code, W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED);
    assert.equal(modelCalls, 0, "the model was consulted for work that could never run");
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});

test("stop does not depend on the model: it completes while every model call throws", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: {
        id: "hostile",
        deterministic: true,
        complete: () => Promise.reject(new Error("the provider is unreachable")),
      },
    });
    liveOwnedChild(runtime.controls.executions);

    const report = await runtime.panicStop("owner pressed stop");
    assert.equal(report.complete, true);
    assert.deepEqual(report.survivors, []);
    assert.equal(runtime.controls.panicStop.state(), "STOPPED");
  } finally {
    workspace.dispose();
  }
});

test("an approval pending when the stop arrives resolves to no effect", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      approvalRequiredEffects: ["write.filesystem", "create.filesystem"],
      approvalExpirySeconds: 3600,
      model: new ScriptedModel(writeThenFinish(target, "never written") as string[]),
    });

    // ما إن يُعرض الطلب حتى يُطلب الإيقاف. لا أحد يوافق.
    runtime.controls.approvalSurface.onPresented(() => {
      setImmediate(() => {
        void runtime.panicStop("owner pressed stop while an approval was pending");
      });
    });

    const mission = startMission(runtime, {
      title: "needs approval",
      instruction: "write the file",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);

    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
    assert.ok(
      result.errors.some(
        (e) => e.code === W5ErrorCode.APPROVAL_EXPIRED || e.code === W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED,
      ),
      JSON.stringify(result.errors),
    );
    assert.deepEqual(runtime.controls.approvalSurface.pending(), []);
  } finally {
    workspace.dispose();
  }
});

test("a stop landing between the grant and the launch stops the effect, not just the next one", async () => {
  const workspace = makeWorkspace();
  try {
    const config = new ConfigService();
    config.apply({
      changeset_id: "w5-window",
      origin: "CORE",
      changes: [
        { key: "polaris.filesystem.allowed_read_roots", scope: "USER", value: [workspace.logical] },
        { key: "polaris.filesystem.allowed_write_roots", scope: "USER", value: [workspace.path("out")] },
        { key: "polaris.filesystem.allow_write", scope: "USER", value: true },
      ] as never,
    });

    // بوابة تسمح بإصدار المنحة ثم تمنع الإطلاق: هذه بالضبط النافذة بين
    // «صدرت السلطة» و«وُلدت العملية»، وهي النافذة التي يجب ألا ينجو منها أثر.
    const windowed: ExecutionAdmission = {
      admits: () => true,
      admit: (subject) =>
        subject === "PROCESS_LAUNCH"
          ? {
              ok: false,
              error: {
                code: W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED,
                display_message: "POLARIS is stopped.",
                internal_detail: "the stop landed after the grant was issued and before the process was launched",
                layer: "PANIC_STOP",
              },
            }
          : { ok: true, value: undefined },
    };

    const paths = new HostPathAuthority(workspace.mounts, process.platform);
    const grants = new IssuedGrantLedger();
    const pep = new FilesystemPep({
      path_authority: paths,
      execution_host: new ChildProcessExecutionHost({ workingDirectory: workspace.host }),
      config,
      admission: windowed,
      grants,
      audit: new AuditEmitter(),
      core_actor_id: newId(),
    });

    const path = workspace.path("out", "summary.txt");
    const resource = { kind: "FILESYSTEM_PATH", locator: path, scope: "EXACT" };
    const content = "must never reach the disk";
    const invocation: Doc = {
      contract_version: "1.0",
      invocation_id: newId(),
      correlation_id: newId(),
      causation_id: newId(),
      idempotency_key: `polaris.w5.window:${newId()}`,
      mission_id: newId(),
      agent_id: newId(),
      caller_identity: agentCallerIdentity(),
      capability_id: WRITE_FILE.capability_id,
      capability_version: WRITE_FILE.capability_version,
      requested_effects: WRITE_FILE.effects.map((action) => ({
        action,
        resource: { ...resource },
        data_classification: "INTERNAL",
      })),
      resource,
      arguments: { path, encoding: "utf-8", content_sha256: sha256(content), content_bytes: content.length },
      taint_labels: ["USER_SUPPLIED"],
      attempt: 1,
      execution_constraints: executionRequirements(WRITE_FILE, path),
      policy_ref: { policy_version: POLICY_SET_VERSION, policy_epoch: POLICY_EPOCH },
      created_at: nowTimestamp(),
    };
    const descriptor = materializeDescriptor(WRITE_FILE, path);
    const decision = new LocalPdp(config).decide({ invocation, descriptor }).decision;
    assert.equal(decision["result"], "ALLOW");

    const enforced = await pep.enforce({
      invocation,
      descriptor,
      decision,
      operation: "WRITE_FILE",
      payload: content,
      callerIdentity: invocation["caller_identity"] as Doc,
    });

    assert.equal(enforced.ok, false);
    assert.equal(enforced.ok ? "" : enforced.error.code, W5ErrorCode.EXECUTION_REFUSED_WHILE_STOPPED);
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});

test("ownership is a registration, never a process name", () => {
  const registry = new OwnedExecutionRegistry();
  assert.equal(registry.count(), 0);
  assert.deepEqual(registry.live(), []);

  const child = liveOwnedChild(registry);
  assert.equal(registry.count(), 1);
  assert.equal(registry.live().length, 1);
  assert.equal(registry.live()[0]?.pid, child.pid);

  // رفع القيد لا يقتل شيئًا: الملكية تنتهي، والعملية تبقى كما هي.
  registry.unregister(child.executionId);
  assert.equal(registry.count(), 0);

  // تنظيف الاختبار لنفسه: ما أطلقه الاختبار يُنهيه الاختبار.
  process.kill(child.pid, "SIGKILL");
});
