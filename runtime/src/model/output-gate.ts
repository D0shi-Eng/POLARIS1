// بوابة مخرج النموذج.
//
// المسار إلزامي وبهذا الترتيب:
//   نص خام → تحليل → مخطط المقترح → تحقق دلالي → ModelOutputContractV1
// ولا يوجد طريق آخر يصل إلى بوابة القدرات. مخرج يُحلَّل كـJSON ليس مخرجًا صالحًا.

import { validateContract } from "@polaris/contracts";

import { newId, nowTimestamp, sha256 } from "../ids.js";
import type { Doc } from "../policy/types.js";
import type { ModelRawOutput } from "./model-port.js";

export type ProposalAction = "invoke_tool" | "finish";

export interface ToolProposalPayload {
  readonly action: "invoke_tool";
  readonly capability_id: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface FinishPayload {
  readonly action: "finish";
  readonly summary: string;
}

export type ProposalPayload = ToolProposalPayload | FinishPayload;

export type ViolationCode =
  | "SCHEMA_MISMATCH"
  | "MISSING_FIELD"
  | "UNKNOWN_ACTION"
  | "UNPARSEABLE"
  | "TRUNCATED"
  | "DISALLOWED_CONTENT"
  | "BUDGET_EXCEEDED";

export interface Violation {
  readonly code: ViolationCode;
  readonly detail: string;
  readonly pointer?: string;
}

export interface LoopState {
  readonly attempt: number;
  readonly max_retries: number;
  readonly iteration: number;
  readonly max_iterations: number;
}

export interface GateInput {
  readonly raw: ModelRawOutput;
  readonly correlation_id: string;
  readonly causation_id: string;
  readonly mission_id: string;
  readonly agent_id: string;
  readonly available_capabilities: readonly string[];
  readonly loop: LoopState;
  readonly declared_schema_ref: string;
}

export interface GateResult {
  /** مستند ModelOutputContractV1 صالح دائمًا، سواء كان المخرج مقبولًا أو مرفوضًا. */
  readonly document: Doc;
  readonly valid: boolean;
  readonly payload?: ProposalPayload;
  readonly violations: readonly Violation[];
  /** أخطاء بناء المستند نفسه. وجودها عيب داخلي يجب أن يظهر. */
  readonly contract_errors: readonly string[];
}

const ALLOWED_TOOL_FIELDS = new Set(["action", "capability_id", "arguments"]);
const ALLOWED_FINISH_FIELDS = new Set(["action", "summary"]);
const MAX_RAW_LENGTH = 65536;

function violation(code: ViolationCode, detail: string, pointer?: string): Violation {
  return pointer === undefined ? { code, detail } : { code, detail, pointer };
}

/** المرحلة الثانية: مخطط المقترح. مجموعة حقول مغلقة، وأفعال مغلقة. */
function checkProposalSchema(parsed: unknown, capabilities: readonly string[]): { payload?: ProposalPayload; violations: Violation[] } {
  const violations: Violation[] = [];
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { violations: [violation("SCHEMA_MISMATCH", "model output must be a JSON object", "/")] };
  }
  const doc = parsed as Record<string, unknown>;
  const action = doc["action"];
  if (typeof action !== "string") {
    return { violations: [violation("MISSING_FIELD", "action is absent or not a string", "/action")] };
  }
  if (action !== "invoke_tool" && action !== "finish") {
    return { violations: [violation("UNKNOWN_ACTION", `action "${action}" is not part of the closed set`, "/action")] };
  }

  const allowed = action === "invoke_tool" ? ALLOWED_TOOL_FIELDS : ALLOWED_FINISH_FIELDS;
  for (const key of Object.keys(doc)) {
    if (!allowed.has(key)) violations.push(violation("SCHEMA_MISMATCH", `field "${key}" is not declared`, `/${key}`));
  }
  if (violations.length > 0) return { violations };

  if (action === "finish") {
    const summary = doc["summary"];
    if (typeof summary !== "string" || summary.length === 0) {
      return { violations: [violation("MISSING_FIELD", "summary is absent or empty", "/summary")] };
    }
    return { payload: { action: "finish", summary }, violations: [] };
  }

  const capabilityId = doc["capability_id"];
  if (typeof capabilityId !== "string") {
    return { violations: [violation("MISSING_FIELD", "capability_id is absent", "/capability_id")] };
  }
  if (!capabilities.includes(capabilityId)) {
    return {
      violations: [violation("UNKNOWN_ACTION", `capability "${capabilityId}" is not available`, "/capability_id")],
    };
  }
  const args = doc["arguments"];
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { violations: [violation("SCHEMA_MISMATCH", "arguments must be an object", "/arguments")] };
  }
  return {
    payload: { action: "invoke_tool", capability_id: capabilityId, arguments: args as Record<string, unknown> },
    violations: [],
  };
}

/**
 * يبني مستند العقد. النهائية تُحسب من الميزانية لا من رغبة النموذج:
 * إن لم يبق تكرار ولا إعادة محاولة فالمخرج غير الصالح نهائي بالضرورة.
 */
function loopControl(loop: LoopState, valid: boolean): Doc {
  if (valid) {
    return {
      attempt: loop.attempt,
      max_retries: loop.max_retries,
      iteration: loop.iteration,
      max_iterations: loop.max_iterations,
      terminal: false,
    };
  }
  const retriesExhausted = loop.attempt > loop.max_retries;
  const iterationsExhausted = loop.iteration >= loop.max_iterations;
  const terminal = retriesExhausted || iterationsExhausted;
  const base: Doc = {
    attempt: loop.attempt,
    max_retries: loop.max_retries,
    iteration: loop.iteration,
    max_iterations: loop.max_iterations,
    terminal,
  };
  if (terminal) {
    base["failure_reason"] = retriesExhausted ? "RETRY_BUDGET_EXHAUSTED" : "ITERATION_BUDGET_EXHAUSTED";
  }
  return base;
}

export function gateModelOutput(input: GateInput): GateResult {
  const raw = input.raw.raw;
  const violations: Violation[] = [];
  let payload: ProposalPayload | undefined;

  if (raw.length > MAX_RAW_LENGTH) {
    violations.push(violation("TRUNCATED", `raw completion of ${String(raw.length)} characters exceeds the ceiling`));
  } else {
    let parsed: unknown;
    let parseFailed = false;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parseFailed = true;
    }
    if (parseFailed) {
      violations.push(violation("UNPARSEABLE", "raw completion is not JSON", "/"));
    } else {
      const checked = checkProposalSchema(parsed, input.available_capabilities);
      violations.push(...checked.violations);
      payload = checked.payload;
    }
  }

  const valid = violations.length === 0 && payload !== undefined;
  // مخرج مرفوض يُصنَّف اقتراح أداة أيضًا: هذا ما كان النموذج يحاول إنتاجه،
  // وإخفاء ذلك يجعل سجل التدقيق أقل صدقًا لا أكثر أمانًا.
  const outputType = valid && payload?.action === "finish" ? "STRUCTURED" : "TOOL_INVOCATION_PROPOSAL";

  const document: Doc = {
    contract_version: "1.0",
    output_id: newId(),
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    mission_id: input.mission_id,
    agent_id: input.agent_id,
    model_ref:
      input.raw.revision === undefined
        ? { model_id: input.raw.model_id }
        : { model_id: input.raw.model_id, revision: input.raw.revision },
    output_type: outputType,
    declared_schema_ref: input.declared_schema_ref,
    declared_schema_version: "1.0",
    raw_length: raw.length,
    raw_hash: sha256(raw),
    validation_status: valid ? "VALID" : classify(violations),
    violations: violations.map((v) => (v.pointer === undefined ? { code: v.code, detail: v.detail } : { code: v.code, pointer: v.pointer, detail: v.detail })),
    // التلوث يُوضع هنا ولا يُنتظر من طبقة أخرى أن تضيفه: مخرج النموذج ملوّث بحكم مصدره.
    taint_labels: ["MODEL_GENERATED"],
    loop_control: loopControl(input.loop, valid),
    produced_at: nowTimestamp(),
  };
  if (valid && payload !== undefined) document["parsed_payload"] = { ...payload } as Doc;

  const validated = validateContract("ModelOutputContractV1", document);
  const contractErrors = validated.ok ? [] : validated.errors.map((e) => e.internal_detail ?? e.display_message);

  return {
    document,
    // مستند لا يجتاز عقده لا يُعتبر صالحًا مهما بدا محتواه سليمًا.
    valid: valid && validated.ok,
    ...(valid && payload !== undefined && validated.ok ? { payload } : {}),
    violations,
    contract_errors: contractErrors,
  };
}

function classify(violations: readonly Violation[]): string {
  const first = violations[0];
  if (first === undefined) return "MODEL_CONTRACT_VIOLATION";
  switch (first.code) {
    case "UNPARSEABLE":
    case "TRUNCATED":
      return "MALFORMED_OUTPUT";
    case "MISSING_FIELD":
      return "MISSING_REQUIRED_FIELD";
    case "UNKNOWN_ACTION":
      return "UNSUPPORTED_ACTION";
    case "SCHEMA_MISMATCH":
      return "INVALID_SCHEMA";
    default:
      return "MODEL_CONTRACT_VIOLATION";
  }
}
