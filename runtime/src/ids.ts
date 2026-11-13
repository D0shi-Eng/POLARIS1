// مولّدات المعرفات والوقت. مركزية حتى يكون شكل المعرف والطابع الزمني
// مطابقًا لعقود W2 في كل موضع، ولا يُعاد بناء الصيغة يدويًا في كل ملف.

import { randomUUID, createHash } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** الطابع الزمني بصيغة العقد: UTC، بلا كسور مللي ثانية، بلاحقة Z. */
export function nowTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * مفتاح تكرار مستقر: يشتق من القدرة ومن بصمة الوسيطات، لا من رقم المحاولة.
 * الشكل مقيّد بنمط IdempotencyKey في العقود.
 */
export function idempotencyKey(capabilityId: string, argumentDigest: string): string {
  const key = `${capabilityId}:${argumentDigest.slice(0, 32)}`;
  return key.length >= 16 ? key.slice(0, 128) : key.padEnd(16, "0");
}
