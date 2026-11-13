// أدوات اختبارات W4.
//
// كل اختبار يعمل في مساحة عمل حقيقية معزولة خارج المستودع، فتقع الآثار فعلًا
// على نظام ملفات حقيقي ولا يتراكم أثرها في شجرة المشروع.
//
// الجذر المنطقي على ويندوز هو مساحة العمل نفسها (ربط هوية)، وعلى مضيف آخر
// جذر منطقي بصيغة ويندوز مربوط بمساحة العمل. الفرق مُعلن، ولا يُدّعى أن
// تشغيلًا على لينكس يثبت دلالات ويندوز.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigService } from "../src/config/service.js";
import { MountTable } from "../src/platform/mount-table.js";
import { PolarisRuntime, agentCallerIdentity, type MissionAuthorization } from "../src/runtime.js";
import { newId } from "../src/ids.js";
import type { ModelPort } from "../src/model/model-port.js";
import type { SafetyBudget } from "../src/agent/budget.js";
import type { Mission } from "../src/agent/types.js";
import type { ExtractionSchema } from "../src/trust/d1.js";
import type { ExecutionHost } from "../src/pep/execution-host.js";

function repositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "tests", "walking-skeleton", "project"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("POLARIS repository root not found: tests/walking-skeleton is missing");
}

export const FIXTURE_PROJECT = join(repositoryRoot(), "tests", "walking-skeleton", "project");

export interface Workspace {
  /** الجذر الحقيقي على المضيف. */
  readonly host: string;
  /** الجذر المنطقي بصيغة POLARIS. */
  readonly logical: string;
  readonly mounts: MountTable;
  dispose(): void;
  /** يبني مسارًا منطقيًا داخل مساحة العمل. */
  path(...segments: readonly string[]): string;
  hostPath(...segments: readonly string[]): string;
}

const LOGICAL_TEST_ROOT = "T:\\POLARIS-W4";

/**
 * سجل مساحات العمل التي أنشأتها هذه العملية ولم يثبت زوالها بعد.
 *
 * المجلد المؤقت للنظام مشترك بين ملفات الاختبار التي يشغّلها `node --test`
 * بالتوازي في عمليات منفصلة؛ عدُّ البادئة فيه يخلط مساحات عمل عمليات أخرى
 * بمساحات هذه العملية. هذا السجل هو دليل الملكية: يُضاف المسار عند الإنشاء،
 * ولا يُحذف منه إلا بعد أن يثبت من نظام الملفات أنه زال فعلًا.
 */
const ownedLiveWorkspaces = new Set<string>();

/** مساحات العمل المملوكة لهذه العملية والموجودة فعلًا على القرص الآن. */
export function ownedWorkspacesOnDisk(): readonly string[] {
  return [...ownedLiveWorkspaces].filter((host) => existsSync(host));
}

/** ينشئ مساحة عمل معزولة ويملؤها بعينات المشروع. */
export function makeWorkspace(): Workspace {
  const host = mkdtempSync(join(tmpdir(), "polaris-w4-"));
  ownedLiveWorkspaces.add(host);
  cpSync(FIXTURE_PROJECT, join(host, "project"), { recursive: true });
  mkdirSync(join(host, "out"), { recursive: true });

  const onWindows = process.platform === "win32";
  const logical = onWindows ? host : LOGICAL_TEST_ROOT;
  const mounts = onWindows
    ? MountTable.identity([logical])
    : new MountTable([{ logical_root: logical, host_root: host }], "/");

  return {
    host,
    logical,
    mounts,
    dispose(): void {
      rmSync(host, { recursive: true, force: true });
      // لا يُشطب من السجل إلا ما ثبت زواله؛ حذفٌ فاشل يبقى مرئيًا للقياس.
      if (!existsSync(host)) ownedLiveWorkspaces.delete(host);
    },
    path(...segments: readonly string[]): string {
      return [logical.replace(/[\\/]+$/, ""), ...segments].join("\\");
    },
    hostPath(...segments: readonly string[]): string {
      return join(host, ...segments);
    },
  };
}

export interface RuntimeSetup {
  readonly workspace: Workspace;
  readonly model: ModelPort;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
  readonly budget?: SafetyBudget;
  readonly extractionSchemas?: readonly ExtractionSchema[];
  readonly executionHost?: ExecutionHost;
  readonly configOverrides?: ReadonlyArray<{ key: string; scope: "DEFAULT" | "USER"; value: unknown }>;
}

export interface BuiltRuntime {
  readonly runtime: PolarisRuntime;
  readonly config: ConfigService;
  readonly workspace: Workspace;
}

export function buildRuntime(setup: RuntimeSetup): BuiltRuntime {
  const config = new ConfigService();
  const changes = [
    { key: "polaris.filesystem.allowed_read_roots", scope: "USER" as const, value: setup.readRoots ?? [setup.workspace.logical] },
    { key: "polaris.filesystem.allowed_write_roots", scope: "USER" as const, value: setup.writeRoots ?? [] },
    { key: "polaris.filesystem.allow_write", scope: "USER" as const, value: (setup.writeRoots ?? []).length > 0 },
    ...(setup.configOverrides ?? []),
  ];
  const applied = config.apply({ changeset_id: "w4-test", origin: "CORE", changes: changes as never });
  if (!applied.applied) throw new Error(`test config did not apply: ${JSON.stringify(applied.errors)}`);

  const runtime = new PolarisRuntime({
    config,
    mounts: setup.workspace.mounts,
    model: setup.model,
    working_directory: setup.workspace.host,
    ...(setup.budget === undefined ? {} : { budget: setup.budget }),
    ...(setup.extractionSchemas === undefined ? {} : { extraction_schemas: setup.extractionSchemas }),
    ...(setup.executionHost === undefined ? {} : { execution_host: setup.executionHost }),
  });

  return { runtime, config, workspace: setup.workspace };
}

export interface MissionSetup {
  readonly title: string;
  readonly instruction: string;
  readonly authorization: MissionAuthorization;
}

export function startMission(runtime: PolarisRuntime, setup: MissionSetup): Mission {
  const mission: Mission = {
    mission_id: newId(),
    title: setup.title,
    instruction: setup.instruction,
    correlation_id: newId(),
    agent_id: newId(),
    caller_identity: agentCallerIdentity(),
  };
  runtime.authorize(mission.mission_id, setup.authorization);
  return mission;
}

export function writeWorkspaceFile(workspace: Workspace, relative: string, content: string): void {
  writeFileSync(workspace.hostPath(relative), content, "utf8");
}
