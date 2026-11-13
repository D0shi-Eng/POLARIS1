// ميزانيات الأمان الصلبة.
//
// كل حدّ هنا مفروض لا موصوف: تجاوزه يعيد فشلًا نهائيًا يوقف المهمة.
// لا يوجد حدّ "تحذيري"، ولا حدّ يُقرأ من مقترح النموذج.
//
// هذا ليس دفتر اقتصاد. لا تكلفة ولا تسعير ولا حصص؛ حدود سلامة فقط.

import { W4ErrorCode, w4Error, type W4Error } from "../errors.js";

export interface SafetyBudget {
  readonly max_iterations: number;
  readonly max_model_calls: number;
  readonly max_tool_calls: number;
  /** عدد إعادات المحاولة لمخرج نموذج غير صالح، لكل تكرار. */
  readonly max_model_retries: number;
  readonly mission_timeout_ms: number;
  /** سقوف بايتات دقيقة. تُقاس فعليًا لا تُقدَّر. */
  readonly max_context_bytes: number;
  readonly max_tool_result_bytes: number;
  /** سقوف رموز تقريبية. التقريب معلن، ولا يُقدَّم كقياس دقيق. */
  readonly max_input_tokens: number;
  readonly max_output_tokens: number;
}

export const DEFAULT_BUDGET: SafetyBudget = {
  max_iterations: 8,
  max_model_calls: 12,
  max_tool_calls: 6,
  max_model_retries: 2,
  mission_timeout_ms: 60000,
  max_context_bytes: 65536,
  max_tool_result_bytes: 262144,
  max_input_tokens: 16384,
  max_output_tokens: 4096,
};

export type BudgetKind =
  | "ITERATIONS"
  | "MODEL_CALLS"
  | "TOOL_CALLS"
  | "MODEL_RETRIES"
  | "MISSION_TIMEOUT"
  | "CONTEXT_BYTES"
  | "TOOL_RESULT_BYTES"
  | "INPUT_TOKENS"
  | "OUTPUT_TOKENS";

export interface BudgetSnapshot {
  readonly iterations: number;
  readonly model_calls: number;
  readonly tool_calls: number;
  readonly model_retries: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly elapsed_ms: number;
  readonly exhausted: BudgetKind | null;
}

/**
 * تقدير الرموز. مُعلن بوصفه تقديرًا: أربعة بايتات لكل رمز تقريبًا.
 * الحدود الدقيقة الحقيقية هي حدود البايتات؛ هذه تكميلية وليست ادعاء دقة.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

export type BudgetCharge = { readonly ok: true } | { readonly ok: false; readonly error: W4Error };

function exceeded(kind: BudgetKind, detail: string): BudgetCharge {
  return {
    ok: false,
    error: w4Error(
      W4ErrorCode.EXECUTION_BUDGET_EXCEEDED,
      "AGENT_BUDGET",
      "This task reached a safety limit and was stopped.",
      `${kind} budget exhausted: ${detail}`,
    ),
  };
}

export class BudgetLedger {
  readonly #budget: SafetyBudget;
  readonly #startedAt: number;
  readonly #now: () => number;

  #iterations = 0;
  #modelCalls = 0;
  #toolCalls = 0;
  #modelRetries = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #exhausted: BudgetKind | null = null;

  public constructor(budget: SafetyBudget, now: () => number = () => Date.now()) {
    this.#budget = budget;
    this.#now = now;
    this.#startedAt = now();
  }

  public budget(): SafetyBudget {
    return this.#budget;
  }

  public remainingIterations(): number {
    return Math.max(0, this.#budget.max_iterations - this.#iterations);
  }

  public remainingRetries(): number {
    return Math.max(0, this.#budget.max_model_retries - this.#modelRetries);
  }

  /** المهلة تُفحص قبل كل خطوة، فلا تمتد مهمة إلى ما لا نهاية بين خطوتين. */
  public checkDeadline(): BudgetCharge {
    const elapsed = this.#now() - this.#startedAt;
    if (elapsed > this.#budget.mission_timeout_ms) {
      this.#exhausted = "MISSION_TIMEOUT";
      return exceeded("MISSION_TIMEOUT", `${String(elapsed)}ms elapsed`);
    }
    return { ok: true };
  }

  public chargeIteration(): BudgetCharge {
    const deadline = this.checkDeadline();
    if (!deadline.ok) return deadline;
    if (this.#iterations >= this.#budget.max_iterations) {
      this.#exhausted = "ITERATIONS";
      return exceeded("ITERATIONS", `limit ${String(this.#budget.max_iterations)}`);
    }
    this.#iterations += 1;
    return { ok: true };
  }

  public chargeModelCall(): BudgetCharge {
    const deadline = this.checkDeadline();
    if (!deadline.ok) return deadline;
    if (this.#modelCalls >= this.#budget.max_model_calls) {
      this.#exhausted = "MODEL_CALLS";
      return exceeded("MODEL_CALLS", `limit ${String(this.#budget.max_model_calls)}`);
    }
    this.#modelCalls += 1;
    return { ok: true };
  }

  public chargeModelRetry(): BudgetCharge {
    if (this.#modelRetries >= this.#budget.max_model_retries) {
      this.#exhausted = "MODEL_RETRIES";
      return exceeded("MODEL_RETRIES", `limit ${String(this.#budget.max_model_retries)}`);
    }
    this.#modelRetries += 1;
    return { ok: true };
  }

  public chargeToolCall(): BudgetCharge {
    const deadline = this.checkDeadline();
    if (!deadline.ok) return deadline;
    if (this.#toolCalls >= this.#budget.max_tool_calls) {
      this.#exhausted = "TOOL_CALLS";
      return exceeded("TOOL_CALLS", `limit ${String(this.#budget.max_tool_calls)}`);
    }
    this.#toolCalls += 1;
    return { ok: true };
  }

  public chargeContext(text: string): BudgetCharge {
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > this.#budget.max_context_bytes) {
      this.#exhausted = "CONTEXT_BYTES";
      return exceeded("CONTEXT_BYTES", `${String(bytes)} bytes exceeds ${String(this.#budget.max_context_bytes)}`);
    }
    const tokens = estimateTokens(text);
    if (this.#inputTokens + tokens > this.#budget.max_input_tokens) {
      this.#exhausted = "INPUT_TOKENS";
      return exceeded("INPUT_TOKENS", `estimated ${String(this.#inputTokens + tokens)} exceeds ${String(this.#budget.max_input_tokens)}`);
    }
    this.#inputTokens += tokens;
    return { ok: true };
  }

  public chargeModelOutput(text: string): BudgetCharge {
    const tokens = estimateTokens(text);
    if (tokens > this.#budget.max_output_tokens) {
      this.#exhausted = "OUTPUT_TOKENS";
      return exceeded("OUTPUT_TOKENS", `estimated ${String(tokens)} exceeds ${String(this.#budget.max_output_tokens)}`);
    }
    this.#outputTokens += tokens;
    return { ok: true };
  }

  public chargeToolResult(bytes: number): BudgetCharge {
    if (bytes > this.#budget.max_tool_result_bytes) {
      this.#exhausted = "TOOL_RESULT_BYTES";
      return exceeded("TOOL_RESULT_BYTES", `${String(bytes)} exceeds ${String(this.#budget.max_tool_result_bytes)}`);
    }
    return { ok: true };
  }

  public snapshot(): BudgetSnapshot {
    return {
      iterations: this.#iterations,
      model_calls: this.#modelCalls,
      tool_calls: this.#toolCalls,
      model_retries: this.#modelRetries,
      input_tokens: this.#inputTokens,
      output_tokens: this.#outputTokens,
      elapsed_ms: this.#now() - this.#startedAt,
      exhausted: this.#exhausted,
    };
  }
}
