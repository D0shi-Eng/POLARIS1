// الحالات السالبة. كل واحدة تثبت أن المنع وقع في الطبقة الصحيحة وبالسبب الصحيح.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { W4ErrorCode } from "../src/errors.js";
import { ProgrammableModel } from "../src/model/fixture-model.js";
import type { ModelRequest } from "../src/model/model-port.js";
import { buildRuntime, makeWorkspace, startMission, type Workspace } from "./w4-helpers.js";

function proposes(capability: string, args: Record<string, unknown>): ProgrammableModel {
  return new ProgrammableModel(() => JSON.stringify({ action: "invoke_tool", capability_id: capability, arguments: args }));
}

function readThenWrite(workspace: Workspace, target: string): ProgrammableModel {
  return new ProgrammableModel((request: ModelRequest): string => {
    const results = request.blocks.filter((b) => b.label.startsWith("TOOL RESULT"));
    if (results.length === 0) {
      return JSON.stringify({
        action: "invoke_tool",
        capability_id: "polaris.fs.read_file",
        arguments: { path: workspace.path("project", "README.md") },
      });
    }
    return JSON.stringify({
      action: "invoke_tool",
      capability_id: "polaris.fs.write_file",
      arguments: { path: target, content: "derived from the file" },
    });
  });
}

test("a model-proposed path inside the allowed root is still denied when nothing declassified it", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({ workspace, model: proposes("polaris.fs.read_file", { path: workspace.path("project", "README.md") }) });
    // لا مراسي مسجَّلة: المهمة لم تُصرَّح.
    const mission = startMission(runtime, {
      title: "read without authorisation",
      instruction: "read the readme",
      authorization: { authorized_read_roots: [], authorized_write_roots: [] },
    });

    const result = await runtime.runMission(mission);
    const denied = result.steps.at(-1);

    assert.equal(result.termination, "TOOL_DENIED");
    assert.equal(denied?.error_layer, "PDP");
    // المسار داخل النطاق تمامًا. المانع هو التلوث وحده، والسبب يجب أن يقول ذلك.
    assert.deepEqual(denied?.reason_codes, ["TAINTED_INPUT"]);
    assert.equal(denied?.error_code, W4ErrorCode.TAINT_NOT_DECLASSIFIED);
    assert.equal(denied?.declassifications[0]?.failure_code, "NO_ANCHOR");
  } finally {
    workspace.dispose();
  }
});

test("a declassification for reading does not authorise writing the same path", async () => {
  const workspace = makeWorkspace();
  try {
    const target = `${workspace.logical}\\out\\summary.txt`;
    const { runtime } = buildRuntime({
      workspace,
      model: readThenWrite(workspace, target),
      writeRoots: [`${workspace.logical}\\out`],
    });
    // المستخدم صرّح بالقراءة فقط. الكتابة مفعّلة في الإعدادات، لكن لا مرساة لغرض الكتابة.
    const mission = startMission(runtime, {
      title: "read then write",
      instruction: "read the readme and write a summary",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [] },
    });

    const result = await runtime.runMission(mission);
    const denied = result.steps.at(-1);

    assert.equal(result.termination, "TOOL_DENIED");
    assert.equal(result.steps[0]?.gateway_ok, true, "the read itself was authorised");
    assert.deepEqual(denied?.reason_codes, ["TAINTED_INPUT"]);
    assert.deepEqual(
      denied?.declassifications.map((d) => [d.action, d.succeeded, d.failure_code]),
      [
        ["create.filesystem", false, "ANCHOR_MISMATCH"],
        ["write.filesystem", false, "ANCHOR_MISMATCH"],
      ],
    );
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});

test("a declassification of one value does not carry over to a different value", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({
      workspace,
      model: proposes("polaris.fs.read_file", { path: workspace.path("project", "README-injected-path.md") }),
    });
    const mission = startMission(runtime, {
      title: "read a different file",
      instruction: "read something",
      authorization: {
        authorized_read_roots: [],
        authorized_write_roots: [],
        // المستخدم صرّح بملف واحد بعينه، لا بجذر.
        user_supplied_values: [workspace.path("project", "README.md")],
      },
    });

    const result = await runtime.runMission(mission);
    const denied = result.steps.at(-1);
    assert.equal(result.termination, "TOOL_DENIED");
    assert.deepEqual(denied?.reason_codes, ["TAINTED_INPUT"]);
    assert.equal(denied?.declassifications[0]?.failure_code, "ANCHOR_MISMATCH");
  } finally {
    workspace.dispose();
  }
});

test("a degraded configuration denies everything, and says the configuration is why", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime, config } = buildRuntime({
      workspace,
      model: proposes("polaris.fs.read_file", { path: workspace.path("project", "README.md") }),
    });
    // مفتاح مجهول داخل مساحة النواة: قد يكون حسّاسًا أمنيًا، فلا يُتجاهل بصمت.
    const applied = config.apply({
      changeset_id: "degrade",
      origin: "CORE",
      changes: [{ key: "polaris.future.privileged_mode", scope: "USER", value: true }] as never,
    });
    assert.equal(applied.applied, false, "an unknown core key must not be writable");

    const degraded = buildRuntime({
      workspace,
      model: proposes("polaris.fs.read_file", { path: workspace.path("project", "README.md") }),
      configOverrides: [],
    });
    // التدهور يُحقن عبر طبقة مخزَّنة مباشرة، كما في اختبارات W3.
    const { ConfigService } = await import("../src/config/service.js");
    const service = ConfigService.fromLayers([
      { schema_version: "1.0", scope: "DEFAULT", values: {} },
      { schema_version: "1.0", scope: "USER", values: { "polaris.future.privileged_mode": true } },
    ]);
    assert.equal(service.effective().integrity, "DEGRADED");

    const { LocalPdp } = await import("../src/policy/pdp.js");
    const pdp = new LocalPdp(service, { declassification: degraded.runtime.declassifier.reader() });
    const outcome = pdp.decide({
      invocation: { contract_version: "1.0" },
      descriptor: { contract_version: "1.0" },
    });
    assert.equal(outcome.decision["result"], "DENY");
    assert.ok((outcome.decision["reason_codes"] as string[]).includes("CONFIG_DEGRADED"));
    assert.ok(runtime.gateway.availableCapabilities().length === 2);
  } finally {
    workspace.dispose();
  }
});

test("an argument the capability never declared invalidates the whole proposal at the gateway", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({
      workspace,
      model: proposes("polaris.fs.read_file", { path: workspace.path("project", "README.md"), elevate: true }),
    });
    const mission = startMission(runtime, {
      title: "smuggle an argument",
      instruction: "read the readme",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [] },
    });
    const result = await runtime.runMission(mission);
    const step = result.steps.at(-1);
    assert.equal(step?.error_layer, "GATEWAY");
    assert.equal(step?.error_code, W4ErrorCode.EFFECT_MISMATCH);
  } finally {
    workspace.dispose();
  }
});

test("a proposal missing its required argument never reaches the policy layer", async () => {
  const workspace = makeWorkspace();
  try {
    const { runtime } = buildRuntime({ workspace, model: proposes("polaris.fs.write_file", { path: `${workspace.logical}\\out\\x.txt` }) });
    const mission = startMission(runtime, {
      title: "write without content",
      instruction: "write something",
      authorization: { authorized_read_roots: [], authorized_write_roots: [workspace.logical] },
    });
    const result = await runtime.runMission(mission);
    const step = result.steps.at(-1);
    assert.equal(step?.error_layer, "GATEWAY");
    assert.equal(step?.error_code, W4ErrorCode.EFFECT_MISMATCH);
    assert.equal(step?.gateway_ok, false);
  } finally {
    workspace.dispose();
  }
});

test("writing is refused when the configuration does not enable it, whatever the user authorised", async () => {
  const workspace = makeWorkspace();
  try {
    const target = `${workspace.logical}\\out\\summary.txt`;
    const { runtime } = buildRuntime({ workspace, model: readThenWrite(workspace, target), writeRoots: [] });
    const mission = startMission(runtime, {
      title: "write with writing disabled",
      instruction: "read then write",
      authorization: {
        authorized_read_roots: [workspace.logical],
        authorized_write_roots: [`${workspace.logical}\\out`],
      },
    });
    const result = await runtime.runMission(mission);
    const denied = result.steps.at(-1);
    assert.equal(result.termination, "TOOL_DENIED");
    assert.deepEqual(denied?.reason_codes, ["NO_MATCHING_RULE"]);
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});
