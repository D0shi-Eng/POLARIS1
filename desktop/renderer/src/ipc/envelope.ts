// بناء ظرف الطلب.
//
// المعرّفات تُولَّد هنا لأن السلسلة السببية تبدأ من العارض: `correlation_id` يعيش
// لكل استدعاء منطقي، و`message_id` لكل رسالة. الهوية تُكتب بالشكل الذي يقبله
// العقد، ومع ذلك يكتب المضيف فوقها: ما يرسله العارض ادّعاء، والختم من النقل.

import type { AnyOperation } from "./operations";
import { CONTRACT_VERSION, ENVELOPE_VERSION } from "./operations";

export interface SessionIdentity {
  readonly principalId: string;
  readonly sessionId: string;
}

/** مولّد معرّفات. يُحقن ليكون الاختبار حتميًا. */
export type IdFactory = () => string;

/** طابع زمني بصيغة العقد: UTC، وينتهي بـZ. */
export function nowTimestamp(clock: () => number = Date.now): string {
  return new Date(clock()).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** معرّف UUID v4. يستعمل `crypto.randomUUID` حيث وُجد، ويتراجع إلى عشوائية المنصة. */
export function createId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView>(a: T) => T } | undefined;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface RequestEnvelope {
  readonly contract_version: string;
  readonly protocol_version: string;
  readonly message_type: "REQUEST";
  readonly message_id: string;
  readonly correlation_id: string;
  readonly session_id: string;
  readonly caller_identity: {
    readonly caller_type: "CORE_UI";
    readonly principal_id: string;
    readonly trust_tier: "TIER_2_UNTRUSTED";
    readonly session_id: string;
  };
  readonly timestamp: string;
  readonly operation: AnyOperation;
  readonly payload: Record<string, unknown>;
  readonly idempotency_key?: string;
}

export interface RequestOptions {
  readonly newId?: IdFactory;
  readonly clock?: () => number;
  readonly correlationId?: string;
  /** إصدار الظرف الذي يعلنه السجل لهذه العملية. غيابه يعني إصدار Phase-01. */
  readonly version?: string;
  /** مفتاح ثابت عبر إعادة المحاولة. للعمليات ذات الأثر الجانبي وحدها. */
  readonly idempotencyKey?: string;
}

export function buildRequest(
  operation: AnyOperation,
  payload: Record<string, unknown>,
  identity: SessionIdentity,
  options: RequestOptions = {},
): RequestEnvelope {
  const newId = options.newId ?? createId;
  const version = options.version ?? ENVELOPE_VERSION;
  return {
    contract_version: options.version ?? CONTRACT_VERSION,
    protocol_version: version,
    message_type: "REQUEST",
    message_id: newId(),
    correlation_id: options.correlationId ?? newId(),
    session_id: identity.sessionId,
    caller_identity: {
      caller_type: "CORE_UI",
      principal_id: identity.principalId,
      // العارض لا يرفع درجته أبدًا. المضيف يرفض الادّعاء ويكتب فوق الهوية،
      // وهذا السطر يجعل الادّعاء الصادق هو الافتراضي لا الاستثناء.
      trust_tier: "TIER_2_UNTRUSTED",
      session_id: identity.sessionId,
    },
    timestamp: nowTimestamp(options.clock),
    operation,
    payload,
    ...(options.idempotencyKey === undefined ? {} : { idempotency_key: options.idempotencyKey }),
  };
}

/** مفتاح Idempotency جديد بصيغة العقد (16..128 من [A-Za-z0-9._:-]). */
export function createIdempotencyKey(newId: IdFactory = createId): string {
  return `ui:${newId()}`;
}
