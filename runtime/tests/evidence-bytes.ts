// عقد بايتات دليل POLARIS — الجانب المستهلِك داخل طبقة التشغيل.
//
// نفس العقد الذي يفرضه tools/evidence-contract/json-evidence.ps1 عند الكتابة،
// و tools/evidence-contract/evidence-bytes.mjs عند القراءة من الأدوات:
//
//     UTF-8، بلا BOM، وثيقة JSON صالحة، نهايات LF.
//
// ولماذا لا يُقشَّر الـBOM هنا: text.replace(/^﻿/, "") يجعل دليلًا فاسدًا
// مقبولًا، ويُبقي الكاتب المنحرف حيًّا بلا أثر. القارئ يُشخّص ويرفض؛ الإصلاح
// المعتمد في الكاتب.
//
// التطابق بين هذا الملف وتطبيق الأدوات ليس افتراضًا: اختبار E9 يُشغّل الاثنين
// على نفس العيّنات ويقارن الحكمين.

import { readFileSync } from "node:fs";

export const EVIDENCE_UTF8_NO_BOM = "EVIDENCE_UTF8_NO_BOM";
export const EVIDENCE_UTF8_BOM_PRESENT = "EVIDENCE_UTF8_BOM_PRESENT";
export const EVIDENCE_UTF16_BOM_PRESENT = "EVIDENCE_UTF16_BOM_PRESENT";
export const EVIDENCE_FILE_EMPTY = "EVIDENCE_FILE_EMPTY";
export const EVIDENCE_FILE_MISSING = "EVIDENCE_FILE_MISSING";

export interface EvidenceEncoding {
  readonly ok: boolean;
  readonly reason_code: string;
  readonly first_bytes: string;
  readonly length: number;
  readonly path: string;
}

export function hexPrefix(buffer: Buffer, count = 4): string {
  return Array.from(buffer.subarray(0, count))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

/** التصنيف يقع على البايتات، قبل أي فكّ ترميز. */
export function classifyEvidenceBytes(buffer: Buffer, path = ""): EvidenceEncoding {
  const first = hexPrefix(buffer, 4);
  if (buffer.length === 0) {
    return { ok: false, reason_code: EVIDENCE_FILE_EMPTY, first_bytes: "", length: 0, path };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { ok: false, reason_code: EVIDENCE_UTF8_BOM_PRESENT, first_bytes: first, length: buffer.length, path };
  }
  if (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  ) {
    return { ok: false, reason_code: EVIDENCE_UTF16_BOM_PRESENT, first_bytes: first, length: buffer.length, path };
  }
  return { ok: true, reason_code: EVIDENCE_UTF8_NO_BOM, first_bytes: first, length: buffer.length, path };
}

export function classifyEvidenceFile(path: string): EvidenceEncoding {
  let buffer: Buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    return { ok: false, reason_code: EVIDENCE_FILE_MISSING, first_bytes: "", length: 0, path };
  }
  return classifyEvidenceBytes(buffer, path);
}

export class EvidenceEncodingError extends Error {
  readonly reasonCode: string;
  readonly classification: EvidenceEncoding;
  constructor(classification: EvidenceEncoding) {
    super(`${classification.reason_code}: ${classification.path} (first bytes: ${classification.first_bytes})`);
    this.name = "EvidenceEncodingError";
    this.reasonCode = classification.reason_code;
    this.classification = classification;
  }
}

/** يقرأ دليلًا قانونيًا: البايتات تُثبت أولًا، ثم يُفكّ الترميز ويُحلَّل. */
export function readCanonicalEvidence(path: string): Record<string, unknown> {
  const classification = classifyEvidenceFile(path);
  if (!classification.ok) throw new EvidenceEncodingError(classification);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}
