// اختبارات انحدار لعيب انجراف التوليد في P01-W2 (GEN-001..GEN-008).
//
// العيب: نقطة دخول المولّد كانت تقارن import.meta.url بـ`file://${argv[1]}`،
// وهي مقارنة لا تتطابق على Windows، فكان `npm run generate` داخل verify عملية
// صامتة لا تكتب شيئًا، وبقي ipc-envelope-v1.ts بنسخة 1.0 ذات العمليات الست.
// هذه الاختبارات تثبت أن المولّد يعمل فعلًا عند استدعائه كسكربت على نظام التشغيل
// الحالي، وأنه يقرأ نفس المخططات التي يقرأها المُحقِّق، وأن ناتجه حتمي وكامل.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SCHEMA_ROOT, loadAllSchemas } from "../src/registry.js";
import { validateContract } from "../src/validator.js";
import { fixture } from "./helpers.js";

interface GeneratedModule {
  readonly file: string;
  readonly content: string;
}

interface GeneratorModule {
  readonly SCHEMAS_DIR: string;
  readonly OUT_DIR: string;
  generate(options: { check: boolean }): Promise<GeneratedModule[]>;
  checkDrift(): Promise<{ modules: number; drift: string[] }>;
}

interface EntrypointModule {
  isDirectInvocation(moduleUrl: string, argvPath?: string): boolean;
}

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GENERATOR_URL = new URL("../../scripts/generate-types.mjs", import.meta.url);
const ENTRYPOINT_URL = new URL("../../scripts/entrypoint.mjs", import.meta.url);
const ENVELOPE_SCHEMA = "ipc-envelope.v1.schema.json";

const AUTHORITATIVE_OPERATIONS = [
  "capability.describe",
  "capability.invoke",
  "policy.evaluate",
  "audit.append",
  "model.complete",
  "system.ping",
  "desktop.bootstrap",
  "desktop.runtime.status",
  "desktop.capability.availability",
  "desktop.settings.describe",
  "desktop.settings.read",
  // ‏1.2 (ADR-019 D2): القائمة المرجعية تتبع المصدر بإضافة صريحة، لا بقراءته.
  "provider.list",
  "provider.configure",
  "provider.credential.set",
  "provider.credential.clear",
  "provider.refresh",
  "model.list",
  "model.configure",
  "model.preferences.set",
  "model.invoke",
  "model.cancel",
  "project.list",
  "project.get",
  "project.create",
  "project.update",
  "project.archive",
  "context.add",
  "context.remove",
  "context.preview",
  "context.assemble",
  // ‏1.3 (ADR-021): عمليات Phase-03 العشر، بالإضافة الصريحة نفسها.
  "mission.list",
  "mission.get",
  "mission.create",
  "mission.start",
  "mission.cancel",
  "mission.resume",
  "task.list",
  "agent.list",
  "claim.list",
  "evidence.list",
  "skill.list",
  "skill.get",
  "skill.configure",
  "tool.list",
  "tool.get",
  "tool.activity.list",
  "mcp.list",
  "mcp.register",
  "mcp.configure",
  "mcp.refresh",
  "approval.list",
  "tool.approval.respond",
  "memory.list",
  "memory.get",
  "memory.delete",
  "browser.session.list",
  "browser.session.get",
  "browser.session.cancel",
  "computer.session.list",
  "computer.session.get",
  "computer.session.cancel",
  "computer.window.list",
  "computer.target.grant",
  "computer.target.revoke",
  "connector.list",
  "connector.get",
  "connector.register",
  "connector.configure",
  "connector.remove",
  "connector.test",
  "connector.credential.set",
  "connector.credential.clear",
  "connector.openapi.import",
  "connector.openapi.approve",
  "connector.preset.list",
  "connector.preset.register",
  "usage.summary",
  "usage.list",
  "budget.list",
  "budget.set",
  "budget.remove",
  "pricing.list",
  "pricing.set",
  "pricing.remove",
  "observability.health",
  "observability.events",
  "observability.metrics",
  "observability.errors",
  "observability.alerts",
  "diagnostics.export",
  "config.describe",
  "config.effective",
  "config.set",
  "config.reset",
  "workspace.list",
  "workspace.preview",
  "workspace.export",
  "attachment.stage",
  "attachment.discard",
  "attachment.artifact.stage",
  "attachment.list",
  "attachment.bind",
  "artifact.list",
  "artifact.get",
  "execution.status",
  "execution.runs",
  "execution.runtime.prepare",
  "mission.model.set",
  "schedule.list",
  "schedule.save",
  "schedule.enable",
  "schedule.delete",
  "schedule.run_now",
  "oauth.list",
  "oauth.connect",
  "oauth.disconnect",
  "voice.transcribe",
  "share.list",
  "share.set",
  "publish.list",
  "publish.propose",
  "publish.decide",
  "skill.package.list",
  "skill.package.import",
  "device.export",
  "device.import",
  "integration.settings.set",
  "conversation.begin",
  "conversation.continue",
  "conversation.get",
  "conversation.index",
  "agent.catalog",
  "mission.specialist.set",
  "conversation.update",
  "conversation.delete",
  "project.delete",
  "memory.remember",
  "conversation.search",
  "mission.trace",
  "mcp.tool.accept_redefinition",
  "provider.catalog",
  "provider.credential.put",
  "provider.custom.save",
  "provider.custom.delete",
  "web.search.status",
  "web.search.credential.put",
  "web.search.test",
  "mission.rating.set",
  "mission.note.add",
  "tool.approval.grants",
  "tool.approval.grant.revoke",
  "github.status",
  "github.connect",
  "github.disconnect",
  "memory.semantic.status",
  "memory.semantic.set",
  "memory.semantic.test",
] as const;

async function loadGenerator(): Promise<GeneratorModule> {
  return (await import(GENERATOR_URL.href)) as GeneratorModule;
}

function schemaOperationEnum(): string[] {
  const schema = JSON.parse(readFileSync(join(SCHEMA_ROOT, ENVELOPE_SCHEMA), "utf8")) as {
    $defs: { Operation: { enum: string[] } };
  };
  return schema.$defs.Operation.enum;
}

/** يستخرج أعضاء الاتحاد Operation من نص TypeScript مولَّد. */
function generatedOperationUnion(source: string): string[] {
  const match = /export type Operation =([\s\S]*?);/.exec(source);
  assert.ok(match !== null, "generated ipc-envelope-v1.ts has no Operation type");
  return [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function freshEnvelopeModule(): Promise<string> {
  const { generate } = await loadGenerator();
  const found = (await generate({ check: true })).find((m) => m.file === "ipc-envelope-v1.ts");
  assert.ok(found !== undefined, "generator produced no ipc-envelope-v1.ts");
  return found.content;
}

test("GEN-001 the generator reads the authoritative schema root the validator reads", async () => {
  const { SCHEMAS_DIR, OUT_DIR } = await loadGenerator();
  assert.equal(resolve(SCHEMAS_DIR), resolve(SCHEMA_ROOT));
  assert.equal(resolve(SCHEMAS_DIR), resolve(PACKAGE_ROOT, "schemas"));
  assert.equal(resolve(OUT_DIR), resolve(PACKAGE_ROOT, "generated", "types"));
});

test("GEN-002 the generated Operation union equals the authoritative schema enum exactly", async () => {
  const union = generatedOperationUnion(await freshEnvelopeModule());
  assert.deepEqual(union, schemaOperationEnum());
  assert.deepEqual(union, [...AUTHORITATIVE_OPERATIONS]);
});

test("GEN-003 all five desktop operations and the nineteen Phase-02 operations survive generation", async () => {
  const union = generatedOperationUnion(await freshEnvelopeModule());
  for (const op of AUTHORITATIVE_OPERATIONS.slice(6)) {
    assert.ok(union.includes(op), `${op} was lost by the generator`);
  }
});

test("GEN-004 no extra operation appears and no open string type is emitted", async () => {
  const source = await freshEnvelopeModule();
  const union = generatedOperationUnion(source);
  assert.equal(union.length, AUTHORITATIVE_OPERATIONS.length);
  assert.equal(new Set(union).size, AUTHORITATIVE_OPERATIONS.length);
  assert.doesNotMatch(/export type Operation =([\s\S]*?);/.exec(source)?.[1] ?? "", /\bstring\b/);
});

test("GEN-005 two consecutive generations are byte-identical", async () => {
  const { generate } = await loadGenerator();
  const first = await generate({ check: true });
  const second = await generate({ check: true });
  assert.deepEqual(
    second.map((m) => [m.file, sha256(m.content)]),
    first.map((m) => [m.file, sha256(m.content)]),
  );
});

test("GEN-006 the checked-in generated artifact matches a fresh generation", async () => {
  const { checkDrift } = await loadGenerator();
  const { modules, drift } = await checkDrift();
  assert.ok(modules > 0);
  assert.deepEqual(drift, []);
  const onDisk = readFileSync(join(PACKAGE_ROOT, "generated", "types", "ipc-envelope-v1.ts"), "utf8");
  assert.deepEqual(generatedOperationUnion(onDisk), [...AUTHORITATIVE_OPERATIONS]);
});

test("GEN-006b the generator CLI entry point actually runs on this operating system", () => {
  // هذا هو اختبار السبب الجذري: قبل الإصلاح كانت العملية تنتهي بالرمز 0 دون أي مخرجات على Windows.
  const scriptPath = fileURLToPath(GENERATOR_URL);
  const run = spawnSync(process.execPath, [scriptPath, "--check"], { cwd: PACKAGE_ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^checked \d+ type modules: no drift/m);
});

test("GEN-006c direct-invocation detection accepts this platform's native script path", async () => {
  const { isDirectInvocation } = (await import(ENTRYPOINT_URL.href)) as EntrypointModule;
  const nativePath = fileURLToPath(GENERATOR_URL);
  assert.equal(isDirectInvocation(GENERATOR_URL.href, nativePath), true);
  assert.equal(isDirectInvocation(GENERATOR_URL.href, fileURLToPath(ENTRYPOINT_URL)), false);
  assert.equal(isDirectInvocation(GENERATOR_URL.href, undefined), false);
  assert.equal(isDirectInvocation(GENERATOR_URL.href, ""), false);
});

test("GEN-007 validator and generator observe the same envelope schema identity", async () => {
  const { SCHEMAS_DIR } = await loadGenerator();
  const generatorView = readFileSync(join(SCHEMAS_DIR, ENVELOPE_SCHEMA), "utf8");
  const validatorView = loadAllSchemas().find((s) => s.id === ENVELOPE_SCHEMA);
  assert.ok(validatorView !== undefined, "validator did not load the envelope schema");
  assert.equal(sha256(readFileSync(validatorView.absolutePath, "utf8")), sha256(generatorView));
  assert.deepEqual(
    ((validatorView.schema["$defs"] as Record<string, { enum: string[] }>)["Operation"] ?? { enum: [] }).enum,
    [...AUTHORITATIVE_OPERATIONS],
  );
});

test("GEN-008 desktop request payload bindings still validate after regeneration", () => {
  for (const file of [
    "ipc-envelope.desktop-bootstrap.json",
    "ipc-envelope.desktop-runtime-status.json",
    "ipc-envelope.desktop-capability-availability.json",
    "ipc-envelope.desktop-settings-describe.json",
    "ipc-envelope.desktop-settings-read.json",
  ]) {
    const result = validateContract("IPCEnvelopeV1", fixture("positive", file));
    assert.ok(result.ok, `${file}: ${result.ok ? "" : JSON.stringify(result.errors)}`);
  }
  // الاستبدال بين العمليات مغطّى تفصيلًا في P01-IPC-009؛ هنا فحص واحد مرتبط بالعيب.
  const swapped = fixture("positive", "ipc-envelope.desktop-settings-read.json") as Record<string, unknown>;
  const cross = { ...swapped, operation: "desktop.capability.availability" };
  assert.equal(validateContract("IPCEnvelopeV1", cross).ok, false);
});
