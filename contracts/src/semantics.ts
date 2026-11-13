// قواعد دلالية داخل مستند واحد، لا يستطيع JSON Schema التعبير عنها
// (مقارنة حقلين ببعضهما، تجزئة، أنماط مركّبة). القواعد عبر عدة عقود تعيش في invariants/.

import { canonicalize, withoutTopLevelKey } from "./canonical.js";
import { ErrorCode, type ContractError } from "./errors.js";
import { findSecrets, findSecretsDeep } from "./secret-hygiene.js";
import { sha256Hex } from "./hash.js";
import { parseContractVersion, type ContractName } from "./version.js";
import {
  DESKTOP_OPERATIONS_INTRODUCED_IN,
  claimsDesktopNamespace,
  isDesktopOperation,
} from "./desktop/operations.js";
import {
  PHASE02_OPERATIONS_INTRODUCED_IN,
  isPhase02Operation,
  isPhase02SideEffecting,
} from "./desktop/phase02.js";

function violation(display: string, pointer: string, detail: string): ContractError {
  return {
    code: ErrorCode.CONTRACT_VIOLATION,
    display_message: display,
    internal_detail: detail,
    pointer,
    retryable: false,
  };
}

type Doc = Record<string, unknown>;

function asRecord(value: unknown): Doc | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ── IPCEnvelopeV1 ────────────────────────────────────────────────────────────

function checkIpcEnvelope(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];

  // رسالة تسبب نفسها تكسر تتبع السببية.
  if (doc["causation_id"] !== undefined && doc["causation_id"] === doc["message_id"]) {
    errors.push(violation("Message cannot be its own cause.", "/causation_id", "causation_id === message_id"));
  }

  if (doc["message_type"] === "RESPONSE" && doc["request_id"] === doc["message_id"]) {
    errors.push(violation("Response cannot answer itself.", "/request_id", "request_id === message_id"));
  }

  errors.push(...checkDesktopOperationRules(doc));
  errors.push(...checkPhase02OperationRules(doc));

  return errors;
}

/**
 * قواعد عمليات Phase-02 المضافة في 1.2 (ADR-019).
 *
 * القواعد نفسها التي تحكم عمليات سطح المكتب، بفرقين: إصدار الإدخال 1.2، ومفتاح
 * Idempotency مطلوب على ذات الأثر الجانبي (يفرضه المخطط) ومرفوض على القراءة (هنا).
 */
function checkPhase02OperationRules(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];
  const operation = doc["operation"];
  if (!isPhase02Operation(operation)) return errors;

  const declared = parseContractVersion(doc["contract_version"]);
  if (
    declared !== null &&
    declared.major === PHASE02_OPERATIONS_INTRODUCED_IN.major &&
    declared.minor < PHASE02_OPERATIONS_INTRODUCED_IN.minor
  ) {
    errors.push(
      violation(
        "This operation was introduced in a later minor version than the document declares.",
        "/operation",
        `operation=${operation} declared=${declared.major}.${declared.minor} introduced=${PHASE02_OPERATIONS_INTRODUCED_IN.major}.${PHASE02_OPERATIONS_INTRODUCED_IN.minor}`,
      ),
    );
  }

  if (doc["message_type"] === "REQUEST" && doc["idempotency_key"] !== undefined && !isPhase02SideEffecting(operation)) {
    errors.push(
      violation(
        "A read-only operation must not carry an idempotency key.",
        "/idempotency_key",
        `operation=${operation} is classified READ_ONLY`,
      ),
    );
  }

  const caller = asRecord(doc["caller_identity"]);
  if (caller?.["trust_tier"] === "TIER_0_TRUSTED") {
    errors.push(
      violation(
        "A desktop operation cannot be issued at the trusted tier.",
        "/caller_identity/trust_tier",
        "renderer-originated operations are never TIER_0_TRUSTED",
      ),
    );
  }

  if (doc["message_type"] === "REQUEST") {
    for (const finding of findSecretsDeep(doc["payload"], "/payload")) {
      errors.push(
        violation("Desktop payload must not carry credentials.", finding.pointer, `${finding.reason}: ${finding.detail}`),
      );
    }
  }

  return errors;
}

/**
 * قواعد عمليات سطح المكتب المضافة في 1.1 (ADR-017).
 *
 * لماذا هنا لا في المخطط: الثلاث تقارن حقلين ببعضهما — العملية بالإصدار،
 * والعملية بمفتاح Idempotency، والعملية بمستوى ثقة المستدعي — وJSON Schema
 * يعبّر عن اثنتين منها بصعوبة وعن الأولى لا يعبّر أصلًا لأن دلالة الإصدار
 * تعيش في بوابة الإصدار لا في المستند.
 */
function checkDesktopOperationRules(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];
  const operation = doc["operation"];

  if (!claimsDesktopNamespace(operation)) return errors;
  // اسم يدّعي النطاق وليس من الخمس يرفضه المخطط عند enum قبل الوصول إلى هنا.
  if (!isDesktopOperation(operation)) return errors;

  // 1) عملية عرّفها 1.1 لا تُحمَل في مستند يعلن 1.0.
  //
  // بوابة الإصدار تقبل MINOR أدنى — وهذا صحيح ومقصود للتوافق الخلفي — لكنها
  // بذلك تقبل أيضًا وثيقة تعلن 1.0 وتحمل عملية لم تكن موجودة في 1.0. عندئذ
  // يصير الإصدار المُعلن كذبًا مقبولًا، ويستحيل على مستقبِل 1.0 أن يشخّص لماذا
  // لم يفهمها. القاعدة تجعل الإعلان مطابقًا للمحتوى.
  const declared = parseContractVersion(doc["contract_version"]);
  if (
    declared !== null &&
    declared.major === DESKTOP_OPERATIONS_INTRODUCED_IN.major &&
    declared.minor < DESKTOP_OPERATIONS_INTRODUCED_IN.minor
  ) {
    errors.push(
      violation(
        "This operation was introduced in a later minor version than the document declares.",
        "/operation",
        `operation=${operation} declared=${declared.major}.${declared.minor} introduced=${DESKTOP_OPERATIONS_INTRODUCED_IN.major}.${DESKTOP_OPERATIONS_INTRODUCED_IN.minor}`,
      ),
    );
  }

  // 2) العمليات الخمس للقراءة فقط، فمفتاح Idempotency عليها ليس زائدًا بل مؤشر
  //    تصنيف خاطئ: إما أن العملية ذات أثر جانبي ولم تُصنَّف، أو أن المرسِل يظنّ
  //    ذلك. كلاهما يستحق الرفض لا التجاهل.
  if (doc["message_type"] === "REQUEST" && doc["idempotency_key"] !== undefined) {
    errors.push(
      violation(
        "A read-only desktop operation must not carry an idempotency key.",
        "/idempotency_key",
        `operation=${operation} is classified READ_ONLY`,
      ),
    );
  }

  // 3) العارض ليس Tier-0 أبدًا. المظروف يسمح لـCORE_UI بأي مستوى ثقة لأن
  //    Phase-00 لم يكن له عارض؛ هنا يصير للحدّ عارض، فيُمنع ادعاؤه أعلى مستوى.
  //    وهذا لا يجعل هوية العارض موثوقة: البوابة تختمها من النقل. القاعدة تمنع
  //    الادعاء، والبوابة تُسقط الادعاء أصلًا.
  const caller = asRecord(doc["caller_identity"]);
  if (caller?.["trust_tier"] === "TIER_0_TRUSTED") {
    errors.push(
      violation(
        "A desktop operation cannot be issued at the trusted tier.",
        "/caller_identity/trust_tier",
        "renderer-originated desktop operations are never TIER_0_TRUSTED",
      ),
    );
  }

  // 4) نظافة أمنية على حمولة الطلب. الحمولة كائن مفتوح في المظروف الأصلي،
  //    ومقيَّدة الآن بمخطط لكل عملية؛ هذا الفحص يمسك ما يمرّ عبر حقل نصّي مسموح.
  if (doc["message_type"] === "REQUEST") {
    for (const finding of findSecretsDeep(doc["payload"], "/payload")) {
      errors.push(
        violation("Desktop payload must not carry credentials.", finding.pointer, `${finding.reason}: ${finding.detail}`),
      );
    }
  }

  return errors;
}

// ── CapabilityDescriptorV1 ───────────────────────────────────────────────────

function checkCapabilityDescriptor(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];

  // تكامل الواصف: التجزئة محسوبة على التمثيل القانوني بعد حذف حقل integrity نفسه.
  const integrity = asRecord(doc["integrity"]);
  if (integrity !== undefined) {
    const expected = sha256Hex(canonicalize(withoutTopLevelKey(doc, "integrity")));
    if (integrity["hash"] !== expected) {
      errors.push(
        violation(
          "Descriptor integrity digest does not match its content.",
          "/integrity/hash",
          `expected=${expected}`,
        ),
      );
    }
  }

  // الوجهات المسموح بها في متطلبات التنفيذ يجب أن تغطي كل أثر شبكي مطلوب.
  const execution = asRecord(doc["execution_requirements"]);
  if (execution?.["network"] === "BROKERED_EGRESS") {
    const allowed = new Set(asArray(execution["allowed_destinations"]).map((d) => canonicalize(d)));
    asArray(doc["requested_effects"]).forEach((raw, index) => {
      const effect = asRecord(raw);
      const destination = effect?.["destination"];
      if (destination !== undefined && !allowed.has(canonicalize(destination))) {
        errors.push(
          violation(
            "Requested network effect targets a destination outside the brokered allow-list.",
            `/requested_effects/${index}/destination`,
            "effect destination not in execution_requirements.allowed_destinations",
          ),
        );
      }
    });
  }

  return errors;
}

// ── CapabilityInvocationV1 ───────────────────────────────────────────────────

function checkCapabilityInvocation(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];

  // إعادة المحاولة تشير إلى استدعاء آخر، لا إلى نفسها.
  if (doc["retry_of"] !== undefined && doc["retry_of"] === doc["invocation_id"]) {
    errors.push(violation("Retry cannot reference itself.", "/retry_of", "retry_of === invocation_id"));
  }

  const execution = asRecord(doc["execution_constraints"]);
  if (execution?.["network"] === "BROKERED_EGRESS") {
    const allowed = new Set(asArray(execution["allowed_destinations"]).map((d) => canonicalize(d)));
    asArray(doc["requested_effects"]).forEach((raw, index) => {
      const destination = asRecord(raw)?.["destination"];
      if (destination !== undefined && !allowed.has(canonicalize(destination))) {
        errors.push(
          violation(
            "Invocation targets a destination the broker was not told to allow.",
            `/requested_effects/${index}/destination`,
            "destination not in execution_constraints.allowed_destinations",
          ),
        );
      }
    });
  }

  return errors;
}

// ── PolicyDecisionV1 ─────────────────────────────────────────────────────────

const CONTRADICTORY_OBLIGATIONS: ReadonlyArray<readonly [string, string]> = [
  ["PROHIBIT_NETWORK", "REQUIRE_BROKERED_EGRESS"],
];

function checkPolicyDecision(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];
  const obligations = asArray(doc["obligations"]).map(asRecord);
  const types = obligations.map((o) => o?.["type"]).filter((t): t is string => typeof t === "string");

  // التزام واحد من كل نوع: تكراره يجعل التنفيذ غير محدد.
  const seen = new Set<string>();
  types.forEach((type, index) => {
    if (seen.has(type)) {
      errors.push(violation("Duplicate obligation type.", `/obligations/${index}/type`, `duplicate ${type}`));
    }
    seen.add(type);
  });

  for (const [a, b] of CONTRADICTORY_OBLIGATIONS) {
    if (seen.has(a) && seen.has(b)) {
      errors.push(violation("Contradictory obligations.", "/obligations", `${a} together with ${b}`));
    }
  }

  // الموافقة التزام على السماح فقط. على الرفض لا معنى لطلب موافقة.
  if (doc["result"] === "DENY" && seen.has("REQUIRE_APPROVAL")) {
    errors.push(violation("A denial cannot carry an approval obligation.", "/obligations", "REQUIRE_APPROVAL on DENY"));
  }

  // إن كان سبب الرفض/السماح هو الموافقة، فالالتزام يجب أن يكون موجودًا فعلًا.
  const reasons = asArray(doc["reason_codes"]);
  if (reasons.includes("APPROVAL_REQUIRED") && !seen.has("REQUIRE_APPROVAL")) {
    errors.push(
      violation(
        "Reason code APPROVAL_REQUIRED without a REQUIRE_APPROVAL obligation.",
        "/reason_codes",
        "approval asserted in reason but not represented as an obligation",
      ),
    );
  }

  return errors;
}

// ── AuditEventV1 ─────────────────────────────────────────────────────────────

function checkAuditEvent(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];

  for (const finding of findSecrets(asRecord(doc["metadata"]), "/metadata")) {
    errors.push(violation("Audit metadata must not carry credentials.", finding.pointer, `${finding.reason}: ${finding.detail}`));
  }

  const integrity = asRecord(doc["integrity"]);
  if (integrity !== undefined) {
    const expected = sha256Hex(canonicalize(withoutTopLevelKey(doc, "integrity")));
    if (integrity["hash"] !== expected) {
      errors.push(violation("Audit event digest does not match its content.", "/integrity/hash", `expected=${expected}`));
    }
  }

  if (doc["causation_id"] !== undefined && doc["causation_id"] === doc["event_id"]) {
    errors.push(violation("Event cannot be its own cause.", "/causation_id", "causation_id === event_id"));
  }

  return errors;
}

// ── ModelOutputContractV1 ────────────────────────────────────────────────────

function checkModelOutput(doc: Doc): ContractError[] {
  const errors: ContractError[] = [];
  const loop = asRecord(doc["loop_control"]);
  if (loop === undefined) return errors;

  const attempt = Number(loop["attempt"]);
  const maxRetries = Number(loop["max_retries"]);
  const iteration = Number(loop["iteration"]);
  const maxIterations = Number(loop["max_iterations"]);

  // المحاولة الأولى ليست إعادة محاولة، فالسقف هو max_retries + 1.
  if (attempt > maxRetries + 1) {
    errors.push(
      violation("Attempt exceeds the retry budget.", "/loop_control/attempt", `attempt=${attempt} max_retries=${maxRetries}`),
    );
  }

  if (iteration > maxIterations) {
    errors.push(
      violation("Iteration exceeds the loop budget.", "/loop_control/iteration", `iteration=${iteration} max_iterations=${maxIterations}`),
    );
  }

  // نفاد الميزانية يجب أن يُعلن نهائيًا، وإلا صار الاستمرار ممكنًا بلا حد.
  const exhausted = attempt > maxRetries || iteration >= maxIterations;
  if (exhausted && doc["validation_status"] !== "VALID" && loop["terminal"] !== true) {
    errors.push(
      violation(
        "Exhausted budget must be terminal.",
        "/loop_control/terminal",
        "budget exhausted but terminal=false permits unbounded retry",
      ),
    );
  }

  return errors;
}

const RULES: Readonly<Record<ContractName, (doc: Doc) => ContractError[]>> = {
  IPCEnvelopeV1: checkIpcEnvelope,
  CapabilityDescriptorV1: checkCapabilityDescriptor,
  CapabilityInvocationV1: checkCapabilityInvocation,
  PolicyDecisionV1: checkPolicyDecision,
  AuditEventV1: checkAuditEvent,
  ModelOutputContractV1: checkModelOutput,
};

export function checkSemanticRules(contract: ContractName, doc: Doc): ContractError[] {
  return RULES[contract](doc);
}
