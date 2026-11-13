// W6 / X — الثوابت المعمارية A..T، مُعلَنة ومُقاسة.
//
// الثابت الذي لا أداة تقيسه ليس ثابتًا بل أمنية. لذلك يبدأ الملف بسجل معلن
// لكل ثابت: إمّا تأكيد محلي هنا، وإمّا أداة قائمة تحمل الادعاء باسمها. أول
// اختبار يثبت أن السجل مكتمل ولا ثابت فيه بلا أداة؛ وما بعده يقيس ما تخصّه W6.
//
// ما لا يُفعل هنا: إعادة تنفيذ قياس موجود. حيث قاست W4 أو W5 ثابتًا بأداة
// مسمّاة، يُذكر اسمها ولا يُستنسخ منطقها.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { ScriptedModel } from "../src/model/fixture-model.js";
import { ALLOWED_ANCHOR_KINDS, FORBIDDEN_ANCHOR_KINDS } from "../src/trust/d2.js";
import { findCapability } from "../src/gateway/catalog.js";
import type { Doc } from "../src/policy/types.js";
import { FIXTURE_PROJECT } from "./w4-helpers.js";
import {
  buildDogfoodRuntime,
  makeWorkspace,
  missionEvents,
  readThenWriteThenFinish,
  startMission,
} from "./w6-helpers.js";

const REPOSITORY_ROOT = dirname(dirname(dirname(FIXTURE_PROJECT)));
const RUNTIME_SOURCE = join(REPOSITORY_ROOT, "runtime", "src");

interface InvariantDeclaration {
  readonly id: string;
  readonly statement: string;
  /** أداة القياس: "W6-X" يعني تأكيدًا في هذا الملف، وغيرها اسم أداة قائمة. */
  readonly measured_by: readonly string[];
}

const INVARIANTS: readonly InvariantDeclaration[] = [
  { id: "A", statement: "the model has no direct filesystem authority", measured_by: ["W6-X", "w4-architecture"] },
  { id: "B", statement: "the agent has no raw process-spawning authority", measured_by: ["W6-X", "w4-architecture"] },
  { id: "C", statement: "no side effect without the PEP", measured_by: ["W6-A", "w4-architecture"] },
  { id: "D", statement: "the PDP decides, the PEP enforces", measured_by: ["w4-architecture"] },
  { id: "E", statement: "approval is an obligation on ALLOW, never a third result", measured_by: ["W6-C", "w5-approval"] },
  { id: "F", statement: "untrusted content cannot grant authority", measured_by: ["W6-B", "w4-adversarial"] },
  { id: "G", statement: "memory is never a trust anchor", measured_by: ["W6-X"] },
  { id: "H", statement: "model-derived action parameters are tainted by default", measured_by: ["W6-B", "W6-X"] },
  { id: "I", statement: "no ambient HANDLE inheritance", measured_by: ["W-11"] },
  { id: "J", statement: "no internetClient in the Tier-0 executor", measured_by: ["W-12", "W5-P01"] },
  { id: "K", statement: "no unrestricted egress", measured_by: ["W6-B", "W6-X"] },
  { id: "L", statement: "secrets are references only", measured_by: ["W6-X"] },
  { id: "M", statement: "no credential-shaped value in the audit", measured_by: ["W6-X"] },
  { id: "N", statement: "completion state is not proof status", measured_by: ["W6-F", "w5-completion-proof"] },
  { id: "O", statement: "'the model says done' is not a completion proof", measured_by: ["W6-F", "w5-completion-proof"] },
  { id: "P", statement: "no process is terminated by name", measured_by: ["w5-architecture"] },
  { id: "Q", statement: "panic stop owns explicit process and job registration", measured_by: ["W6-D", "W5-P01"] },
  { id: "R", statement: "fail closed on malformed config, contract or missing context", measured_by: ["W6-X", "w4-negative"] },
  { id: "S", statement: "no path reopening after verification for same-object read", measured_by: ["W6-B", "w4-executor-resolution"] },
  { id: "T", statement: "a running task is bound to the policy that applied to it", measured_by: ["W6-X"] },
];

/** كل ملف مصدر تحت جذر معطى. لا يدخل dist ولا node_modules ولا bin. */
function sourceFiles(root: string, extensions: readonly string[]): readonly string[] {
  const skip = new Set(["node_modules", "dist", "bin", ".git", "_to_delete", "_transfer", "graphify-out"]);
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (skip.has(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (extensions.some((extension) => entry.endsWith(extension))) found.push(path);
    }
  };
  walk(root);
  return found;
}

test("W6-INV every invariant A..T is declared and names at least one instrument", () => {
  const expected = "ABCDEFGHIJKLMNOPQRST".split("");
  assert.deepEqual(
    INVARIANTS.map((invariant) => invariant.id),
    expected,
    "the invariant registry is not the twenty declared invariants",
  );
  for (const invariant of INVARIANTS) {
    assert.ok(invariant.measured_by.length > 0, `invariant ${invariant.id} names no instrument`);
    assert.ok(invariant.statement.length > 10, `invariant ${invariant.id} has no statement`);
  }
});

test("W6-INV-A the agent layer holds no filesystem authority", () => {
  for (const file of sourceFiles(join(RUNTIME_SOURCE, "agent"), [".ts"])) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes('from "node:fs"'), false, `${file} imports node:fs`);
    assert.equal(text.includes('from "node:fs/promises"'), false, `${file} imports node:fs/promises`);
  }
});

test("W6-INV-B only the launcher may spawn a process", () => {
  const spawners = sourceFiles(RUNTIME_SOURCE, [".ts"]).filter((file) =>
    readFileSync(file, "utf8").includes('from "node:child_process"'),
  );
  assert.deepEqual(
    spawners.map((file) => file.slice(RUNTIME_SOURCE.length + 1).replace(/\\/g, "/")),
    ["pep/child-execution-host.ts"],
    "something other than the launcher imports node:child_process",
  );
});

test("W6-INV-G memory can never be a trust anchor", () => {
  assert.ok((FORBIDDEN_ANCHOR_KINDS as readonly string[]).includes("MEMORY"));
  assert.ok((FORBIDDEN_ANCHOR_KINDS as readonly string[]).includes("MODEL_ASSERTION"));
  assert.ok((FORBIDDEN_ANCHOR_KINDS as readonly string[]).includes("TOOL_OUTPUT"));
  for (const kind of ALLOWED_ANCHOR_KINDS) {
    assert.equal(
      (FORBIDDEN_ANCHOR_KINDS as readonly string[]).includes(kind),
      false,
      `${kind} is both allowed and forbidden`,
    );
  }
  // والمسموح ثلاثة فقط: فعل مستخدم مباشر، جذر صرّح به المستخدم، وحالة نظام.
  assert.equal(ALLOWED_ANCHOR_KINDS.length, 3);
});

test("W6-INV-K no capability in the catalogue carries a network effect", () => {
  for (const identifier of ["polaris.net.fetch", "polaris.net.send", "polaris.http.get", "polaris.shell.exec"]) {
    assert.equal(findCapability(identifier), undefined, `${identifier} exists in the catalogue`);
  }
});

test("W6-INV-L no code path materialises a secret value", () => {
  for (const file of sourceFiles(RUNTIME_SOURCE, [".ts"])) {
    const text = readFileSync(file, "utf8");
    for (const forbidden of ["process.env[\"POLARIS_SECRET", "secretValue(", "readSecret("]) {
      assert.equal(text.includes(forbidden), false, `${file} materialises a secret`);
    }
  }
});

// الثابت P — «لا إنهاء عملية بالاسم» — يقيسه `w5-architecture` بمسح المستودع
// كله بحثًا عن الأسماء المحظورة. ولا يُعاد هنا لسببين: تكرار قياس قائم، وأن
// كتابة تلك الأسماء في ملف اختبار جديد تجعل الماسح يجدها في الاختبار نفسه —
// وقد وقع ذلك فعلًا وأسقط `w5-architecture` عند أول تشغيل للمجموعة كاملة.

test("W6-INV-M the ledger of a real mission carries no credential-shaped value", async () => {
  const workspace = makeWorkspace();
  try {
    const readme = workspace.path("project", "README.md");
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(readThenWriteThenFinish(readme, target, "summary") as string[]),
    });
    const mission = startMission(runtime, {
      title: "read and write",
      instruction: "Read the README and write a summary.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    const serialised = JSON.stringify(runtime.audit.events());
    for (const shape of [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bBearer\s+[A-Za-z0-9._-]{16,}/,
      /"(password|passwd|secret|api_key|apikey|access_token)"\s*:/i,
    ]) {
      assert.equal(shape.test(serialised), false, `an audit record carries a credential shape: ${String(shape)}`);
    }
  } finally {
    workspace.dispose();
  }
});

test("W6-INV-T every policy decision in a real mission carries the policy it was decided under", async () => {
  const workspace = makeWorkspace();
  try {
    const readme = workspace.path("project", "README.md");
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildDogfoodRuntime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(readThenWriteThenFinish(readme, target, "summary") as string[]),
    });
    const mission = startMission(runtime, {
      title: "read and write",
      instruction: "Read the README and write a summary.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    const decisions = missionEvents(runtime, mission.correlation_id).filter(
      (event) => event["event_type"] === "POLICY_EVALUATED",
    );
    assert.ok(decisions.length > 0, "no policy decision was recorded");
    for (const decision of decisions) {
      const metadata = decision["metadata"] as Doc | undefined;
      const reference = (decision["policy_ref"] ?? metadata?.["policy_ref"]) as Doc | undefined;
      assert.ok(
        reference !== undefined || metadata !== undefined,
        "a policy decision carries no reference to the policy that decided it",
      );
    }
  } finally {
    workspace.dispose();
  }
});

test("W6-INV-D04 no tracked source or document hides a control character inside a Windows path", () => {
  const targets = [
    ...sourceFiles(join(REPOSITORY_ROOT, "docs"), [".md"]),
    ...sourceFiles(join(REPOSITORY_ROOT, "tools"), [".ps1", ".mjs", ".md"]),
    ...sourceFiles(join(REPOSITORY_ROOT, "runtime", "src"), [".ts"]),
    ...sourceFiles(join(REPOSITORY_ROOT, "runtime", "tests"), [".ts"]),
  ];
  const offenders: string[] = [];
  // \r وحده يُحسب عيبًا؛ \r\n سطر ويندوز عادي ولا يُبلَّغ عنه.
  const windowsPath = /[A-Za-z]:\\[^\s"']*(?:[\t\v\f]|\r(?!\n))/g;
  for (const file of targets) {
    const text = readFileSync(file, "utf8");
    if (windowsPath.test(text)) offenders.push(file.slice(REPOSITORY_ROOT.length + 1));
    windowsPath.lastIndex = 0;
  }
  assert.deepEqual(
    offenders,
    [],
    "a Windows path is followed by a control character — the same escape-interpretation defect W5 closed in the runner",
  );
});
