// سجل المخططات: يحمّل ملفات JSON Schema من مصدر الحقيقة الوحيد ويسجلها في Ajv
// بمعرّفات مسارية نسبية، حتى تُحلّ المراجع النسبية بين الملفات كما هي مكتوبة على القرص.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// يُبحث عن جذر الحزمة صعودًا بدل تثبيت مسار نسبي، حتى يعمل التحميل من المصدر ومن dist معًا
// دون نسختين من نفس الثابت تنجرفان عن بعضهما.
function findPackageRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "schemas"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("contracts package root not found from " + start);
}

/** جذر الحزمة. يُصدَّر لأن وثائق البيانات (السجل، خريطة الأخطاء) تعيش بجواره لا داخل schemas. */
export const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** جذر مخططات المصدر. مصدر الحقيقة الوحيد للعقود. */
export const SCHEMA_ROOT = join(PACKAGE_ROOT, "schemas") + sep;

/** جذر وثائق البيانات المحكومة بمخطط: سجل IPC وخريطة الأخطاء. ليست مخططات، ولا تُحمَّل في Ajv. */
export const REGISTRY_ROOT = join(PACKAGE_ROOT, "registry") + sep;

/** معرّف المخطط داخل السجل: مسار نسبي بأسلوب POSIX من جذر المخططات. */
export type SchemaId = string;

export interface LoadedSchema {
  readonly id: SchemaId;
  readonly absolutePath: string;
  readonly schema: Record<string, unknown>;
}

function walk(directory: string, found: string[]): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    } else if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      found.push(full);
    }
  }
  return found;
}

/** يقرأ كل ملفات المخططات مرة واحدة. الترتيب مُثبَّت حتى يكون التحميل حتميًا. */
export function loadAllSchemas(): readonly LoadedSchema[] {
  const files = walk(SCHEMA_ROOT, []).sort();
  return files.map((absolutePath) => {
    const id = relative(SCHEMA_ROOT, absolutePath).split(sep).join(posix.sep);
    const schema = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
    return { id, absolutePath, schema };
  });
}

/** ربط اسم العقد بملف مخططه الجذري. */
export const CONTRACT_SCHEMA_IDS = {
  IPCEnvelopeV1: "ipc-envelope.v1.schema.json",
  CapabilityDescriptorV1: "capability-descriptor.v1.schema.json",
  CapabilityInvocationV1: "capability-invocation.v1.schema.json",
  PolicyDecisionV1: "policy-decision.v1.schema.json",
  AuditEventV1: "audit-event.v1.schema.json",
  ModelOutputContractV1: "model-output.v1.schema.json",
} as const;
