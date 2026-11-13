// اختبارات المعمارية. الغرض إثبات الثابت المطلق:
// لا يوجد مسار تنفيذ يتجاوز بوابة القدرات ثم نقطة الفرض.
//
// الإثبات ببنية الوحدات لا بالعُرف: تُقرأ عبارات الاستيراد الحقيقية،
// لا التعليقات، ويُقارن الرسم البياني بقائمة معلنة.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { AgentLoop } from "../src/agent/loop.js";
import { CapabilityGateway } from "../src/gateway/gateway.js";
import { newId } from "../src/ids.js";
import type { ExecutionGrant, ExecutionOutcome } from "../src/pep/grant.js";
import { makeWorkspace } from "./w4-helpers.js";
import { runtimeSrcPath } from "./helpers.js";

const IMPORT_LINE = /^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"\s*;?\s*$/gm;
const BARE_IMPORT = /^\s*import\s+"([^"]+)"\s*;?\s*$/gm;

function sourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) found.push(full);
    }
  };
  walk(root);
  return found.sort();
}

function importsOf(file: string): readonly string[] {
  const text = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const pattern of [IMPORT_LINE, BARE_IMPORT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
      specifiers.push(match[1] as string);
      match = pattern.exec(text);
    }
  }
  return specifiers;
}

function relativeName(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

test("the agent runtime imports no filesystem, no process spawning, and no execution path", () => {
  const root = runtimeSrcPath();
  const forbidden = [
    "node:fs",
    "node:fs/promises",
    "node:child_process",
    "node:net",
    "node:http",
    "node:https",
    "node:dgram",
  ];
  const forbiddenModules = [
    "../pep/",
    "../exec/",
    "../platform/host-path-authority.js",
    "../trust/ledger.js",
    "../trust/d1.js",
    "../trust/d2.js",
    "../policy/pdp.js",
    "../policy/cedar-engine.js",
    "../gateway/gateway.js",
    "../gateway/catalog.js",
  ];

  for (const file of sourceFiles(join(root, "agent"))) {
    for (const specifier of importsOf(file)) {
      assert.equal(forbidden.includes(specifier), false, `${relativeName(root, file)} imports ${specifier}`);
      for (const module of forbiddenModules) {
        assert.equal(
          specifier.startsWith(module),
          false,
          `${relativeName(root, file)} reaches past the gateway via ${specifier}`,
        );
      }
    }
  }
});

test("only the declared modules may touch node:fs, and exactly one of them performs tool effects", () => {
  const root = runtimeSrcPath();
  // أربعة فقط، ولكل واحد سبب مختلف:
  //   exec/fs-executor.ts            المنفّذ الوحيد للأثر، خلف منحة، في عملية منفصلة.
  //   exec/target-object.ts          ميكانيكا «الفتح مرة واحدة» وحدها: لا تعرف المنحة،
  //                                  فلا تستطيع أن تُحدث أثرًا تحت سلطة قرار.
  //   platform/host-path-authority.ts  تطبيع وحلّ روابط فقط. لا يقرأ محتوى ولا يكتب.
  //   corpus/runner.ts               مشغّل قياس عند جذر التركيب. ليس مسار تنفيذ،
  //                                  ولا يُصدَّر من سطح طبقة التشغيل.
  const allowed = [
    "corpus/runner.ts",
    "exec/fs-executor.ts",
    "exec/target-object.ts",
    "platform/host-path-authority.ts",
  ];
  const actual = new Set<string>();
  for (const file of sourceFiles(root)) {
    if (importsOf(file).some((s) => s === "node:fs" || s === "node:fs/promises")) actual.add(relativeName(root, file));
  }
  assert.deepEqual([...actual].sort(), [...allowed].sort());

  // الحكم الحقيقي: وحدة واحدة فقط تجمع بين نظام الملفات ونوع المنحة،
  // أي وحدة واحدة فقط تستطيع أن تُحدث أثرًا تحت سلطة قرار.
  const effectful = [...actual].filter((name) =>
    importsOf(join(root, ...name.split("/"))).some((s) => s.endsWith("pep/grant.js")),
  );
  assert.deepEqual(effectful, ["exec/fs-executor.ts"]);

  // ومشغّل القياس ليس جزءًا من سطح طبقة التشغيل المُصدَّر.
  const surface = importsOf(join(root, "index.ts"));
  assert.equal(surface.some((s) => s.includes("corpus")), false, "the measurement harness must not be part of the runtime surface");
});
test("only the launcher may spawn a process", () => {
  const root = runtimeSrcPath();
  const actual: string[] = [];
  for (const file of sourceFiles(root)) {
    if (importsOf(file).includes("node:child_process")) actual.push(relativeName(root, file));
  }
  assert.deepEqual(actual, ["pep/child-execution-host.ts"]);
});

test("the execution host never imports policy, configuration or the invocation layer", () => {
  const root = runtimeSrcPath();
  for (const file of sourceFiles(join(root, "exec"))) {
    for (const specifier of importsOf(file)) {
      // المنفّذ يعرف شكل المنحة فقط. لا سياسة، ولا إعدادات، ولا عقود.
      const allowed =
        specifier.startsWith("node:") ||
        specifier === "../pep/grant.js" ||
        specifier === "./fs-executor.js" ||
        specifier === "./target-object.js";
      assert.equal(allowed, true, `${relativeName(root, file)} imports ${specifier}`);
    }
  }
});

test("the agent loop exposes exactly one operation, and holds no enforcement object", () => {
  const surface = Object.getOwnPropertyNames(AgentLoop.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(surface, ["run"]);

  // الحقول الخاصة غير قابلة للوصول من الخارج أصلًا؛ يُتحقق من أن لا شيء مسرَّب علنًا.
  const workspace = makeWorkspace();
  try {
    const publicNames = Object.keys(new AgentLoop({
      model: { id: "x", deterministic: true, complete: () => Promise.resolve({ model_id: "x", raw: "{}" }) },
      gateway: { invoke: () => Promise.reject(new Error("unused")), availableCapabilities: () => [], effectsOf: () => undefined },
      declassifier: { byExtraction: () => ({ ok: false, failure: { method: "D1", code: "UNPARSEABLE", detail: "" } }), byProvenance: () => ({ ok: false, failure: { method: "D2", code: "NO_ANCHOR", detail: "" } }) },
      audit: new (class { emit(): Record<string, unknown> { return {}; } })() as never,
    }));
    assert.deepEqual(publicNames, []);
  } finally {
    workspace.dispose();
  }
});

test("the gateway is not the policy decision point and not the tool", () => {
  const surface = Object.getOwnPropertyNames(CapabilityGateway.prototype).filter((name) => name !== "constructor");
  assert.deepEqual(surface.sort(), ["availableCapabilities", "effectsOf", "invoke"]);
});

test("the invocation's confinement comes from the capability catalog, never from the proposal", async () => {
  const workspace = makeWorkspace();
  try {
    const { buildRuntime, startMission } = await import("./w4-helpers.js");
    const { ProgrammableModel } = await import("../src/model/fixture-model.js");
    const path = workspace.path("project", "README.md");
    const { runtime } = buildRuntime({
      workspace,
      model: new ProgrammableModel(() =>
        JSON.stringify({ action: "invoke_tool", capability_id: "polaris.fs.read_file", arguments: { path } }),
      ),
    });
    const mission = startMission(runtime, {
      title: "check constraints",
      instruction: "read it",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [] },
    });
    await runtime.runMission(mission);

    const requested = runtime.audit
      .forCorrelation(mission.correlation_id)
      .find((e) => e["event_type"] === "INVOCATION_REQUESTED");
    assert.ok(requested !== undefined);

    // القرار المسجَّل يحمل التزام الحصر، وقيمه هي قيم الفهرس الثابتة.
    const evaluated = runtime.audit
      .forCorrelation(mission.correlation_id)
      .find((e) => e["event_type"] === "POLICY_EVALUATED");
    assert.ok(evaluated !== undefined);
  } finally {
    workspace.dispose();
  }
});

// ── انحدار X03: نظافة المقابض ────────────────────────────────────────────────

const HOST_ENTRY = join(runtimeSrcPath(), "..", "dist", "src", "exec", "host-main.js");

function runHost(grant: ExecutionGrant, extraDescriptor?: number): Promise<ExecutionOutcome> {
  return new Promise((resolve, reject) => {
    const stdio: Array<"pipe" | number> = ["pipe", "pipe", "pipe"];
    if (extraDescriptor !== undefined) stdio.push(extraDescriptor);
    const child = spawn(process.execPath, [HOST_ENTRY], { stdio, env: { POLARIS_EXECUTION_HOST: "1" } });
    const chunks: Buffer[] = [];
    if (child.stdout === null) {
      reject(new Error("execution host produced no stdout pipe"));
      return;
    }
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ExecutionOutcome);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("host produced no result"));
      }
    });
    child.stdin?.end(JSON.stringify(grant));
  });
}

test(
  "X03 regression: a leaked handle IS detected, and the POLARIS launcher leaks none",
  { skip: process.platform === "linux" ? false : "the /proc handle probe is a Linux-native check" },
  async () => {
    const workspace = makeWorkspace();
    try {
      // مورد خارج المنحة تمامًا.
      const denied = join(workspace.host, "denied.txt");
      writeFileSync(denied, "out of scope", "utf8");

      // المنحة تحمل هوية الكائن كما ترصدها نقطة الفرض، لأن المنفّذ يطابقها
      // على مقبضه هو ولا يعيد حلّ الاسم (SAME_OBJECT_VERIFY_AND_USE).
      const readme = join(workspace.host, "project", "README.md");
      const readmeStat = statSync(readme, { bigint: true });

      const grant: ExecutionGrant = {
        grant_id: newId(),
        correlation_id: newId(),
        invocation_id: newId(),
        decision_id: newId(),
        operation: "READ_FILE",
        target: {
          logical: workspace.path("project", "README.md"),
          host: readme,
          mode: "READ",
          identity: { volume: readmeStat.dev.toString(), file: readmeStat.ino.toString() },
        },
        allowed_host_roots: [join(workspace.host, "project")],
        max_bytes: 65536,
        deadline_ms: 5000,
        encoding: "utf-8",
        allow_overwrite: false,
      };

      // 1) ضابط موجب: مقبض مسرَّب عمدًا يجب أن يُكتشف ويُصنَّف خارج المنحة.
      //    بدون هذا، فراغُ الفحص في الحالة السليمة لا يثبت شيئًا.
      const leaked = openSync(denied, "r");
      let withLeak: ExecutionOutcome;
      try {
        withLeak = await runHost(grant, leaked);
      } finally {
        closeSync(leaked);
      }
      assert.equal(withLeak.handle_probe.method, "PROC_FD_LINKS");
      const escaping = withLeak.handle_probe.filesystem_descriptors.filter((d) => !d.inside_grant);
      assert.equal(escaping.length, 1, "the probe failed to detect a deliberately leaked handle");
      assert.match(escaping[0]?.target ?? "", /denied\.txt$/);
      assert.equal(escaping[0]?.kind, "FILE");

      // 2) الحالة السليمة: المُطلِق نفسه لا يورّث أي مقبض نظام ملفات.
      const { ChildProcessExecutionHost } = await import("../src/pep/child-execution-host.js");
      const clean = await new ChildProcessExecutionHost({ workingDirectory: workspace.host }).execute(grant);
      assert.equal(clean.status, "SUCCESS");
      assert.equal(clean.handle_probe.method, "PROC_FD_LINKS");
      assert.deepEqual(
        clean.handle_probe.filesystem_descriptors.filter((d) => !d.inside_grant),
        [],
        "the POLARIS launcher leaked a filesystem handle into the execution host",
      );
    } finally {
      workspace.dispose();
    }
  },
);
