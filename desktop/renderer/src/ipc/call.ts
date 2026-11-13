// الآلة المشتركة لكل استدعاء: بناء، تحقق قبل الإرسال، إرسال بمهلة، تحقق من
// الظرف، ربط الرد بطلبه، ترجمة الخطأ، تحقق من النتيجة.
//
// ليست عامة للواجهة: العميلان المُصنَّفان وحدهما يستدعيانها، ونوع اسم العملية
// مغلق. لا دالة هنا تقبل اسمًا حرًّا من شاشة.

import { buildRequest, createIdempotencyKey, type IdFactory, type SessionIdentity } from "./envelope";
import { localError, translateBoundaryError, type DisplayError } from "./errors";
import { operationRecord, type AnyOperation } from "./operations";
import { TransportTimeout, TransportUnavailable, type Transport } from "./transport";
import { validateAgainstSchemaReference } from "./validator";

export type CallResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DisplayError };

export interface CallContext {
  readonly transport: Transport;
  readonly identity: SessionIdentity;
  readonly newId?: IdFactory | undefined;
  readonly clock?: (() => number) | undefined;
}

export interface CallOptions {
  readonly timeoutMs?: number;
  /** مفتاح ثابت يعيده المستدعي عند إعادة المحاولة. غيابه يولّد مفتاحًا جديدًا. */
  readonly idempotencyKey?: string;
}

const REQUEST_SCHEMA = "ipc-envelope.v1.schema.json#/$defs/RequestEnvelope";
const RESPONSE_SCHEMA = "ipc-envelope.v1.schema.json#/$defs/ResponseEnvelope";

export async function callOperation<T>(
  context: CallContext,
  operation: AnyOperation,
  payload: Record<string, unknown>,
  options: CallOptions = {},
): Promise<CallResult<T>> {
  const record = operationRecord(operation);
  if (record === undefined) {
    return { ok: false, error: localError("UNSUPPORTED_OPERATION", "CONTRACT_VIOLATION") };
  }

  // المفتاح يُرسل فقط حين يطلبه السجل؛ العملية القارئة ترفضه في المضيف.
  const needsKey = record.idempotency === "REQUIRED";
  const envelope = buildRequest(operation, payload, context.identity, {
    ...(context.newId !== undefined ? { newId: context.newId } : {}),
    ...(context.clock !== undefined ? { clock: context.clock } : {}),
    version: record.envelope_version,
    ...(needsKey ? { idempotencyKey: options.idempotencyKey ?? createIdempotencyKey(context.newId) } : {}),
  });

  // ١ — التحقق قبل الإرسال. طلب لا يطابق العقد لا يُرسل أصلًا.
  const requestCheck = validateAgainstSchemaReference(REQUEST_SCHEMA, envelope);
  if (!requestCheck.ok) {
    return { ok: false, error: localError("INVALID_RESPONSE", "VALIDATION_ERROR") };
  }

  let raw: unknown;
  try {
    raw = await context.transport.send(envelope, options.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs });
  } catch (error) {
    if (error instanceof TransportTimeout) {
      return { ok: false, error: localError("IPC_TIMEOUT", "TIMEOUT") };
    }
    if (error instanceof TransportUnavailable) {
      return { ok: false, error: localError("IPC_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE") };
    }
    return { ok: false, error: localError("IPC_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE") };
  }

  // ٢ — التحقق من الظرف الوارد قبل قراءة أي حقل منه.
  const responseCheck = validateAgainstSchemaReference(RESPONSE_SCHEMA, raw);
  if (!responseCheck.ok) {
    return { ok: false, error: localError("INVALID_RESPONSE", "MALFORMED_MESSAGE") };
  }

  const response = raw as { error?: Record<string, unknown>; result?: unknown; request_id?: unknown };

  // ٣ — الرد يخصّ الطلب. ظرف الرد لا يحمل اسم العملية، فالربط هنا.
  if (response.request_id !== envelope.message_id) {
    return { ok: false, error: localError("INVALID_RESPONSE", "CONTRACT_VIOLATION") };
  }

  if (response.error !== undefined) {
    return { ok: false, error: translateBoundaryError(response.error) };
  }

  // ٤ — الحمولة، مقابل مخطط النتيجة الذي يسمّيه السجل لهذه العملية.
  const resultCheck = validateAgainstSchemaReference(record.response_schema, response.result);
  if (!resultCheck.ok) {
    return { ok: false, error: localError("INVALID_RESPONSE", "VALIDATION_ERROR") };
  }

  return { ok: true, value: response.result as T };
}
