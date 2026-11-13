// أدوات مشتركة للاختبارات: تحميل العينات وربط كل عينة بالعقد الذي تخصه.
// الربط بالاسم مقصود: إضافة عينة جديدة تدخل الاختبارات تلقائيًا بلا تسجيل يدوي.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ContractName } from "../src/version.js";

const FIXTURE_ROOT = fileURLToPath(new URL("../../fixtures/", import.meta.url));

export interface Fixture {
  readonly file: string;
  readonly contract: ContractName;
  readonly doc: Record<string, unknown>;
}

// البادئة في اسم الملف تحدد العقد. مغلقة عمدًا حتى لا تمر عينة بلا عقد معروف.
const PREFIX_TO_CONTRACT: ReadonlyArray<readonly [string, ContractName]> = [
  ["ipc-envelope.", "IPCEnvelopeV1"],
  ["capability-descriptor.", "CapabilityDescriptorV1"],
  ["capability-invocation.", "CapabilityInvocationV1"],
  ["policy-decision.", "PolicyDecisionV1"],
  ["audit-event.", "AuditEventV1"],
  ["model-output.", "ModelOutputContractV1"],
];

function contractFor(file: string): ContractName {
  for (const [prefix, contract] of PREFIX_TO_CONTRACT) {
    if (file.startsWith(prefix)) return contract;
  }
  throw new Error(`fixture "${file}" does not name a known contract`);
}

export function loadFixtures(kind: "positive" | "negative"): readonly Fixture[] {
  const directory = join(FIXTURE_ROOT, kind);
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
    .sort()
    .map((file) => ({
      file,
      contract: contractFor(file),
      doc: JSON.parse(readFileSync(join(directory, file), "utf8")) as Record<string, unknown>,
    }));
}

export function fixture(kind: "positive" | "negative", file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, kind, file), "utf8")) as Record<string, unknown>;
}

/** نسخة عميقة، حتى لا يسرّب اختبارٌ تعديلًا إلى اختبار آخر. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** التوقع المسجَّل لكل عينة سلبية: لماذا هي باطلة، وبأي رمز ومؤشر يجب أن تُرفض. */
export interface NegativeExpectation {
  readonly reason: string;
  readonly expect_code: string;
  readonly expect_pointer: string;
}

/**
 * فهرس العينات السلبية. ربط كل عينة برمز ومؤشر متوقعين يمنع أن "تنجح" العينة
 * لأنها بطلت لسبب آخر غير المقصود، وهو أخطر أشكال الاختبار الكاذب.
 */
export function negativeIndex(): Record<string, NegativeExpectation> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "negative", "_index.json"), "utf8")) as Record<
    string,
    NegativeExpectation
  >;
}
