// أنواع طبقة الوكيل.

import type { EffectAction } from "../effects.js";
import type { W4Error } from "../errors.js";
import type { BudgetSnapshot } from "./budget.js";
import type { Doc } from "../policy/types.js";
import type { DeclassificationMethod } from "../trust/record.js";

export interface Mission {
  readonly mission_id: string;
  readonly title: string;
  /** تعليمة المستخدم المباشرة. هي المصدر الوحيد الذي يحمل سلطة تعليمات. */
  readonly instruction: string;
  readonly correlation_id: string;
  readonly agent_id: string;
  readonly caller_identity: Doc;
  /**
   * خطوة استخراج مُعلنة على مستوى المهمة. المخطط والأغراض يأتيان من جذر التركيب،
   * لا من مقترح النموذج: لو اختارهما النموذج لصار الاستخراج تحصيل حاصل.
   */
  readonly extraction?: {
    readonly schema_id: string;
    readonly purposes: readonly EffectAction[];
  };
}

export interface DeclassificationStep {
  readonly method: DeclassificationMethod;
  readonly action: string;
  readonly value: string;
  readonly succeeded: boolean;
  readonly failure_code?: string;
}

export interface AgentStep {
  readonly iteration: number;
  readonly attempt: number;
  readonly model_output_id: string;
  readonly validation_status: string;
  readonly proposed_capability?: string;
  readonly proposed_path?: string;
  readonly declassifications: readonly DeclassificationStep[];
  readonly gateway_ok?: boolean;
  readonly error_code?: string;
  readonly error_layer?: string;
  readonly reason_codes?: readonly string[];
  readonly tool_result_bytes?: number;
}

export type MissionStatus = "COMPLETED" | "TERMINATED";

export type Termination =
  | "FINISHED"
  | "BUDGET_EXHAUSTED"
  | "MODEL_CONTRACT_VIOLATION"
  | "TOOL_DENIED"
  | "TOOL_FAILED";

export interface MissionResult {
  readonly mission_id: string;
  readonly correlation_id: string;
  readonly status: MissionStatus;
  readonly termination: Termination;
  readonly summary?: string;
  readonly steps: readonly AgentStep[];
  readonly budget: BudgetSnapshot;
  readonly errors: readonly W4Error[];
}
