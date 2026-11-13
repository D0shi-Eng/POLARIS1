// نقطة الفرض والمنفّذ. الاختبار على الفرض الحقيقي: أثر يقع فعلًا على قرص حقيقي،
// وشرط تنفيذ غير مدعوم يغلق المسار بدل أن يسقط إلى نظام ملفات خام.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { ConfigService } from "../src/config/service.js";
import { W4ErrorCode } from "../src/errors.js";
import { materializeDescriptor, READ_FILE, WRITE_FILE, executionRequirements } from "../src/gateway/catalog.js";
import { newId, nowTimestamp } from "../src/ids.js";
import {
  ChildProcessExecutionHost,
  LIBUV_REQUIRED_WINDOWS_VARIABLES,
} from "../src/pep/child-execution-host.js";
import { FilesystemPep } from "../src/pep/filesystem-pep.js";
import { HostPathAuthority } from "../src/platform/host-path-authority.js";
import { LocalPdp } from "../src/policy/pdp.js";
import { POLICY_EPOCH, POLICY_SET_VERSION, type Doc } from "../src/policy/types.js";
import { agentCallerIdentity } from "../src/runtime.js";
import { makeWorkspace, type Workspace } from "./w4-helpers.js";

interface Harness {
  readonly workspace: Workspace;
  readonly pep: FilesystemPep;
  readonly pdp: LocalPdp;
  readonly config: ConfigService;
}

function harness(workspace: Workspace, writeRoots: readonly string[] = []): Harness {
  const config = new ConfigService();
  const applied = config.apply({
    changeset_id: "pep-test",
    origin: "CORE",
    changes: [
      { key: "polaris.filesystem.allowed_read_roots", scope: "USER", value: [workspace.logical] },
      { key: "polaris.filesystem.allowed_write_roots", scope: "USER", value: writeRoots },
      { key: "polaris.filesystem.allow_write", scope: "USER", value: writeRoots.length > 0 },
    ] as never,
  });
  assert.equal(applied.applied, true);
  const paths = new HostPathAuthority(workspace.mounts, process.platform);
  return {
    workspace,
    config,
    pdp: new LocalPdp(config),
    pep: new FilesystemPep({
      path_authority: paths,
      execution_host: new ChildProcessExecutionHost({ workingDirectory: workspace.host }),
      config,
    }),
  };
}

/** استدعاء موسوم USER_SUPPLIED: هذه الاختبارات تخص الفرض لا التلوث. */
function invocationFor(template: typeof READ_FILE, path: string, extra: Doc = {}): Doc {
  const resource = { kind: "FILESYSTEM_PATH", locator: path, scope: "EXACT" };
  return {
    contract_version: "1.0",
    invocation_id: newId(),
    correlation_id: newId(),
    causation_id: newId(),
    idempotency_key: `polaris.pep.test:${newId()}`,
    mission_id: newId(),
    agent_id: newId(),
    caller_identity: agentCallerIdentity(),
    capability_id: template.capability_id,
    capability_version: template.capability_version,
    requested_effects: template.effects.map((action) => ({ action, resource: { ...resource }, data_classification: "INTERNAL" })),
    resource,
    arguments: { path, encoding: "utf-8" },
    taint_labels: ["USER_SUPPLIED"],
    attempt: 1,
    execution_constraints: executionRequirements(template, path),
    policy_ref: { policy_version: POLICY_SET_VERSION, policy_epoch: POLICY_EPOCH },
    created_at: nowTimestamp(),
    ...extra,
  };
}

function allowDecision(h: Harness, invocation: Doc, descriptor: Doc): Doc {
  const outcome = h.pdp.decide({ invocation, descriptor });
  assert.equal(outcome.decision["result"], "ALLOW", JSON.stringify(outcome.decision["internal_reason"]));
  return outcome.decision;
}

test("a permitted read really reads the file, through a separate execution host", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    const path = workspace.path("project", "README.md");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const result = await h.pep.enforce({
      invocation,
      descriptor,
      decision: allowDecision(h, invocation, descriptor),
      operation: "READ_FILE",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.outcome.status, "SUCCESS");
    assert.equal(result.value.host_id, "polaris.exec.child-process.v1");
    // ادعاء صريح ومحدود: هذا المحوّل ليس حصر ويندوز.
    assert.equal(result.value.windows_confinement, false);
    const content = Buffer.from(result.value.outcome.content_base64 ?? "", "base64").toString("utf8");
    assert.match(content, /# Sample Project/);
  } finally {
    workspace.dispose();
  }
});

test("the execution host inherits no descriptor beyond the three explicit pipes", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    const path = workspace.path("project", "README.md");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const result = await h.pep.enforce({
      invocation,
      descriptor,
      decision: allowDecision(h, invocation, descriptor),
      operation: "READ_FILE",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const probe = result.value.outcome.handle_probe;
    if (probe.method === "NONE") {
      // لا قياس على هذه المنصة، فلا ادعاء. ويندوز يحتاج استعلامًا أصليًا عن المقابض.
      assert.equal(probe.supported, false);
      assert.equal(process.platform === "linux", false, "the probe must be supported on linux");
    } else {
      assert.equal(probe.supported, true);
      const escaping = probe.filesystem_descriptors.filter((d) => !d.inside_grant);
      assert.deepEqual(escaping, [], "the launcher leaked a filesystem handle outside the grant");
    }
  } finally {
    workspace.dispose();
  }
});

test("a read outside every configured root is refused by the filesystem scope, before any effect", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    const path = "C:\\Windows\\System32\\drivers\\etc\\hosts";
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    // القرار يُصنع يدويًا هنا لأن PDP سيرفض أصلًا: الهدف اختبار الفرض بمعزل.
    const decision = allowDecision(harness(workspace, []).workspace === workspace ? h : h, invocationFor(READ_FILE, workspace.path("project", "README.md")), materializeDescriptor(READ_FILE, workspace.path("project", "README.md")));
    const forged: Doc = { ...decision, invocation_id: invocation["invocation_id"], correlation_id: invocation["correlation_id"] };
    const result = await h.pep.enforce({ invocation, descriptor, decision: forged, operation: "READ_FILE" });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, W4ErrorCode.FILESYSTEM_SCOPE_DENIED);
    assert.equal(result.error.layer, "PEP");
  } finally {
    workspace.dispose();
  }
});

test("an unsupported execution requirement fails closed: there is no fallback to raw filesystem", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    const path = workspace.path("project", "README.md");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const decision = allowDecision(h, invocation, descriptor);

    for (const [axis, value, expected] of [
      ["confinement", "NONE", W4ErrorCode.PEP_ENFORCEMENT_FAILED],
      ["handle_inheritance", "NONE", W4ErrorCode.PEP_ENFORCEMENT_FAILED],
      ["environment", "INHERITED", W4ErrorCode.PEP_ENFORCEMENT_FAILED],
      ["process_tree", "UNCONSTRAINED", W4ErrorCode.PEP_ENFORCEMENT_FAILED],
      ["filesystem_scope", "UNRESTRICTED", W4ErrorCode.PEP_ENFORCEMENT_FAILED],
      ["network", "UNRESTRICTED", W4ErrorCode.NETWORK_EFFECT_UNAVAILABLE],
    ] as const) {
      const obligations = (decision["obligations"] as Doc[]).map((o) =>
        o["type"] === "REQUIRE_CONFINEMENT"
          ? { ...o, requirements: { ...(o["requirements"] as Doc), [axis]: value } }
          : o,
      );
      const result = await h.pep.enforce({
        invocation,
        descriptor,
        decision: { ...decision, obligations },
        operation: "READ_FILE",
      });
      assert.equal(result.ok, false, `${axis}=${value} was enforced anyway`);
      if (!result.ok) assert.equal(result.error.code, expected, `${axis}=${value}`);
    }
  } finally {
    workspace.dispose();
  }
});

test("a decision that does not bind to this invocation is refused", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    const path = workspace.path("project", "README.md");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const decision = allowDecision(h, invocation, descriptor);
    const result = await h.pep.enforce({
      invocation,
      descriptor,
      decision: { ...decision, invocation_id: newId() },
      operation: "READ_FILE",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, W4ErrorCode.PEP_ENFORCEMENT_FAILED);
  } finally {
    workspace.dispose();
  }
});

test("a missing byte ceiling fails closed rather than reading without a limit", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    const path = workspace.path("project", "README.md");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const decision = allowDecision(h, invocation, descriptor);
    const obligations = (decision["obligations"] as Doc[]).filter((o) => o["type"] !== "MAX_BYTES");
    const result = await h.pep.enforce({ invocation, descriptor, decision: { ...decision, obligations }, operation: "READ_FILE" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.internal_detail, /MAX_BYTES/);
  } finally {
    workspace.dispose();
  }
});

test("a file larger than the ceiling is refused by the executor, not truncated silently", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace);
    writeFileSync(workspace.hostPath("project", "big.txt"), "x".repeat(300000), "utf8");
    const path = workspace.path("project", "big.txt");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const result = await h.pep.enforce({
      invocation,
      descriptor,
      decision: allowDecision(h, invocation, descriptor),
      operation: "READ_FILE",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.internal_detail, /TOO_LARGE/);
  } finally {
    workspace.dispose();
  }
});

test("a permitted write creates the file, and an unauthorised overwrite is refused", async () => {
  const workspace = makeWorkspace();
  try {
    const writeRoot = `${workspace.logical}\\out`;
    const h = harness(workspace, [writeRoot]);
    const path = `${writeRoot}\\note.txt`;
    const invocation = invocationFor(WRITE_FILE, path);
    const descriptor = materializeDescriptor(WRITE_FILE, path);
    const decision = allowDecision(h, invocation, descriptor);

    const created = await h.pep.enforce({ invocation, descriptor, decision, operation: "WRITE_FILE", payload: "hello" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.outcome.wrote, "CREATE");
    assert.equal(readFileSync(workspace.hostPath("out", "note.txt"), "utf8"), "hello");

    const second = invocationFor(WRITE_FILE, path);
    const overwrite = await h.pep.enforce({
      invocation: second,
      descriptor,
      decision: allowDecision(h, second, descriptor),
      operation: "WRITE_FILE",
      payload: "replaced",
    });
    assert.equal(overwrite.ok, false, "an existing file was overwritten without authorisation");
    assert.equal(readFileSync(workspace.hostPath("out", "note.txt"), "utf8"), "hello");
  } finally {
    workspace.dispose();
  }
});

test("a write outside the configured write root is refused even when the read root would allow it", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace, [`${workspace.logical}\\out`]);
    const path = workspace.path("project", "planted.txt");
    const invocation = invocationFor(WRITE_FILE, path);
    const descriptor = materializeDescriptor(WRITE_FILE, path);
    const decision = allowDecision(harness(workspace, [`${workspace.logical}\\project`]), invocation, descriptor);
    const result = await h.pep.enforce({
      invocation,
      descriptor,
      decision,
      operation: "WRITE_FILE",
      payload: "should not land",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, W4ErrorCode.FILESYSTEM_SCOPE_DENIED);
    assert.equal(existsSync(workspace.hostPath("project", "planted.txt")), false);
  } finally {
    workspace.dispose();
  }
});

test("a read operation may not carry a write effect, and the reverse", async () => {
  const workspace = makeWorkspace();
  try {
    const h = harness(workspace, [`${workspace.logical}\\out`]);
    const path = `${workspace.logical}\\out\\x.txt`;
    const invocation = invocationFor(WRITE_FILE, path);
    const descriptor = materializeDescriptor(WRITE_FILE, path);
    const decision = allowDecision(h, invocation, descriptor);
    const result = await h.pep.enforce({ invocation, descriptor, decision, operation: "READ_FILE" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, W4ErrorCode.EFFECT_MISMATCH);
  } finally {
    workspace.dispose();
  }
});

test("the execution host environment is constructed by value, and no ambient variable is inherited", async () => {
  const workspace = makeWorkspace();
  // ضابط موجب حقيقي: متغيّران في بيئة الأب — أحدهما باسم لا يعلنه POLARIS،
  // والآخر باسم يعلنه POLARIS ولكن بقيمة المستخدم. الأول يجب ألا يصل أبدًا،
  // والثاني يجب أن يصل بقيمة POLARIS لا بقيمة الأب. الاسم وحده لا يكفي دليلًا.
  const canary = `polaris-ambient-canary-${newId()}`;
  const usernameCanary = `polaris-username-canary-${newId()}`;
  const previousCanary = process.env["POLARIS_AMBIENT_CANARY"];
  const previousUsername = process.env["USERNAME"];
  process.env["POLARIS_AMBIENT_CANARY"] = canary;
  process.env["USERNAME"] = usernameCanary;

  try {
    const h = harness(workspace);
    const path = workspace.path("project", "README.md");
    const invocation = invocationFor(READ_FILE, path);
    const descriptor = materializeDescriptor(READ_FILE, path);
    const result = await h.pep.enforce({
      invocation,
      descriptor,
      decision: allowDecision(h, invocation, descriptor),
      operation: "READ_FILE",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const diagnostics = result.value.outcome.host_diagnostics;
    assert.equal(diagnostics.environment_contract_present, true, "the executor received no environment contract");

    // 1) لا متغيّر لم يعلنه POLARIS.
    const inherited = diagnostics.environment_findings.filter((f) => f.classification === "AMBIENTLY_INHERITED");
    assert.deepEqual(inherited, [], `ambient variables reached the execution host: ${inherited.map((f) => f.name).join(", ")}`);

    // 2) الكناري لم يصل، لا بالاسم ولا بأي تصنيف.
    assert.equal(
      diagnostics.environment_keys.includes("POLARIS_AMBIENT_CANARY"),
      false,
      "the ambient canary was inherited by the execution host",
    );

    // 3) ولا متغيّر معلن حمل قيمة غير القيمة المبنية.
    const overridden = diagnostics.environment_findings.filter((f) => f.classification === "AMBIENTLY_OVERRIDDEN");
    assert.deepEqual(overridden, [], `declared names carried inherited values: ${overridden.map((f) => f.name).join(", ")}`);

    assert.equal(diagnostics.environment_exactly_as_constructed, true);
    assert.ok(diagnostics.environment_keys.includes("POLARIS_EXECUTION_HOST"));

    // أسطح الشبكة العامة محجوبة داخل العملية: تخفيف حقيقي، وليس حصرًا على مستوى النظام.
    assert.deepEqual(diagnostics.network_globals_present, []);
    assert.equal(diagnostics.working_directory.length > 0, true);
  } finally {
    if (previousCanary === undefined) delete process.env["POLARIS_AMBIENT_CANARY"];
    else process.env["POLARIS_AMBIENT_CANARY"] = previousCanary;
    if (previousUsername === undefined) delete process.env["USERNAME"];
    else process.env["USERNAME"] = previousUsername;
    workspace.dispose();
  }
});

test("every variable libuv copies on Windows when absent is declared by POLARIS, so nothing is left to copy", () => {
  // جذر عيب التسرب: libuv تنسخ هذه الأسماء من الأب إذا لم تجدها في البيئة
  // الممرَّرة. الدليل من تشغيل ويندوز الحقيقي: الثلاثة التي مُرّرت لم تُنسخ،
  // والثمانية التي لم تُمرّر نُسخت. الحارس هنا يمنع عودة أي اسم إلى الغياب.
  const contract = new ChildProcessExecutionHost({ workingDirectory: "." }).environmentContract();
  const declared = new Set(Object.keys(contract).map((name) => name.toUpperCase()));
  for (const required of LIBUV_REQUIRED_WINDOWS_VARIABLES) {
    assert.ok(declared.has(required), `${required} is not declared, so libuv would copy the parent's value`);
  }
  // ولا تحمل أي قيمة هوية للمستخدم الحقيقي.
  assert.equal(contract["USERNAME"], "polaris-execution-host");
  assert.equal(contract["USERDOMAIN"], "POLARIS");
  assert.equal((contract["PATH"] ?? "").split(process.platform === "win32" ? ";" : ":").length <= 3, true);
});
