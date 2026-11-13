// أدوات مشتركة لمجموعات اختبار P01-W2.
//
// عيّنات المرحلة الأولى تعيش في fixtures/phase-01/ ولا تُخلَط بعيّنات العقود
// الستة: تلك مستندات عقود كاملة تمر ببوابة الإصدار، وهذه حمولات تسافر داخل
// مظروف. خلطهما يجعل مُحمِّل العيّنات يخمّن أيّ الأمرين أمامه.
//
// والربط هنا صريح في بيان (manifest) لا مستنبط من اسم الملف: كل عيّنة تُصرّح
// بعمليتها واتجاهها، وكل عيّنة سالبة تُصرّح بالعيب المقصود وبالرمز والمؤشر
// المتوقعين. عيّنة تبطل لسبب غير المقصود تبدو ناجحة، وهي أخطر أشكال الاختبار
// الكاذب؛ البيان هو ما يمنع ذلك.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DesktopOperation, PayloadDirection } from "../src/desktop/index.js";

const PHASE_01_FIXTURES = fileURLToPath(new URL("../../fixtures/phase-01/", import.meta.url));

export interface PositivePayloadFixture {
  readonly file: string;
  readonly operation: DesktopOperation;
  readonly direction: PayloadDirection;
  readonly claim: string;
}

export interface NegativePayloadFixture {
  readonly file: string;
  readonly operation: DesktopOperation;
  readonly direction: PayloadDirection;
  readonly reason: string;
  readonly expect_code: string;
  readonly expect_pointer: string;
}

interface Manifest {
  readonly positive: readonly PositivePayloadFixture[];
  readonly negative: readonly NegativePayloadFixture[];
}

export function payloadManifest(): Manifest {
  return JSON.parse(readFileSync(join(PHASE_01_FIXTURES, "_manifest.json"), "utf8")) as Manifest;
}

export function payloadFixture(kind: "positive" | "negative", file: string): unknown {
  return JSON.parse(readFileSync(join(PHASE_01_FIXTURES, kind, file), "utf8")) as unknown;
}

/** نسخة عميقة، حتى لا يسرّب اختبارٌ تعديلًا إلى اختبار آخر. */
export function clonePayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SCHEMA_ROOT = fileURLToPath(new URL("../../schemas/", import.meta.url));

/** يقرأ ملف مخطط من مصدر الحقيقة، لاختبارات التكافؤ بين المخطط والشيفرة. */
export function schemaDocument(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_ROOT, relativePath), "utf8")) as Record<string, unknown>;
}

/** يقرأ enum من داخل $defs. الفشل صريح: مخطط تغيّر شكله لا يُقرأ كقائمة فارغة. */
export function schemaEnum(relativePath: string, definition: string): readonly string[] {
  const document = schemaDocument(relativePath);
  const defs = document["$defs"] as Record<string, { enum?: readonly string[] }> | undefined;
  const values = defs?.[definition]?.enum;
  if (values === undefined) {
    throw new Error(`${relativePath} has no enum at $defs/${definition}`);
  }
  return values;
}
