// حلقة الوكيل الأدنى.
//
// ليست ذكاءً عامًا مستقلًا. دورة محدودة: مهمة → سياق محدود → مخرج نموذج →
// بوابة العقد → اقتراح → رفع تصنيف → بوابة القدرات → PDP → PEP → نتيجة → تكرار أو توقف.
//
// ما لا تملكه هذه الطبقة، عمدًا وبحراسة اختبار معمارية:
//   - لا تستورد node:fs ولا أي منفّذ.
//   - لا تبني قرار سياسة ولا تقرأ الدفتر لتقرر.
//   - لا تصدر سجل رفع تصنيف؛ تطلبه فقط.
//   - لا تستطيع تخفيف حصر: متطلبات التنفيذ غير قابلة للتمثيل في اقتراحها.

import type { AuditEmitter } from "../audit/emitter.js";
import { W4ErrorCode, w4Error, type W4Error } from "../errors.js";
import type { EffectAction } from "../effects.js";
import type { CapabilityGatewayPort, CapabilityProposal } from "../gateway/types.js";
import type { ModelPort } from "../model/model-port.js";
import { renderRequest } from "../model/model-port.js";
import { gateModelOutput, type ProposalPayload } from "../model/output-gate.js";
import type { DeclassificationRequestPort } from "../trust/declassifier.js";
import { classifyIngress, type IngressRecord } from "../trust/ingress.js";
import { MODEL_PARAMETER_DEFAULT_TAINT, mergeTaint, type TaintLabel } from "../trust/taint.js";
import { BudgetLedger, DEFAULT_BUDGET, type SafetyBudget } from "./budget.js";
import { buildBlocks, DEFAULT_CONTEXT_LIMITS, type ContextLimits, type ContextSource } from "./context.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentStep, DeclassificationStep, Mission, MissionResult, Termination } from "./types.js";

const PROPOSAL_SCHEMA_REF = "model/tool_proposal.v1.json";

export interface AgentLoopDependencies {
  readonly model: ModelPort;
  readonly gateway: CapabilityGatewayPort;
  /** منفذ ضيّق: طلب رفع تصنيف فقط، بلا تسجيل مراسٍ ولا إصدار سجلات. */
  readonly declassifier: DeclassificationRequestPort;
  readonly audit: AuditEmitter;
  readonly budget?: SafetyBudget;
  readonly context_limits?: ContextLimits;
  readonly now?: () => number;
}

interface StepOutcome {
  readonly step: AgentStep;
  readonly stop?: Termination;
  readonly summary?: string;
  readonly error?: W4Error;
  readonly toolBlock?: ContextSource;
}

export class AgentLoop {
  readonly #model: ModelPort;
  readonly #gateway: CapabilityGatewayPort;
  readonly #declassifier: DeclassificationRequestPort;
  readonly #audit: AuditEmitter;
  readonly #budget: SafetyBudget;
  readonly #limits: ContextLimits;
  readonly #now: () => number;

  public constructor(dependencies: AgentLoopDependencies) {
    this.#model = dependencies.model;
    this.#gateway = dependencies.gateway;
    this.#declassifier = dependencies.declassifier;
    this.#audit = dependencies.audit;
    this.#budget = dependencies.budget ?? DEFAULT_BUDGET;
    this.#limits = dependencies.context_limits ?? DEFAULT_CONTEXT_LIMITS;
    this.#now = dependencies.now ?? ((): number => Date.now());
  }

  public async run(mission: Mission): Promise<MissionResult> {
    const ledger = new BudgetLedger(this.#budget, this.#now);
    const steps: AgentStep[] = [];
    const errors: W4Error[] = [];

    // تعليمة المستخدم هي المصدر الوحيد صاحب سلطة التعليمات في هذه المهمة.
    const missionIngress = classifyIngress({ source: "DIRECT_USER", content: mission.instruction });
    const sources: ContextSource[] = [
      { label: "USER MISSION", body: mission.instruction, ingress: missionIngress },
    ];

    const system = buildSystemPrompt({
      mission_title: mission.title,
      capabilities: this.#gateway.availableCapabilities(),
      max_iterations: this.#budget.max_iterations,
      max_tool_calls: this.#budget.max_tool_calls,
    });

    let termination: Termination = "BUDGET_EXHAUSTED";
    let summary: string | undefined;

    // بداية المهمة تُسجَّل قبل أن يُستشار النموذج. لو سُجّلت بعده لَما وُجد في
    // السجل أثر لمهمة مات النموذج في أول نداء فيها.
    this.#audit.emit({
      event_type: "MISSION_STARTED",
      correlation_id: mission.correlation_id,
      caller_identity: mission.caller_identity,
      actor: { kind: "AGENT", id: mission.agent_id },
      mission_id: mission.mission_id,
      agent_id: mission.agent_id,
      status: "SUCCESS",
      metadata: { mission_title: mission.title.slice(0, 512) },
    });

    for (;;) {
      const iterationCharge = ledger.chargeIteration();
      if (!iterationCharge.ok) {
        errors.push(iterationCharge.error);
        termination = "BUDGET_EXHAUSTED";
        break;
      }
      const iteration = ledger.snapshot().iterations;

      const outcome = await this.#runIteration(mission, system, sources, ledger, iteration);
      steps.push(outcome.step);
      if (outcome.error !== undefined) errors.push(outcome.error);
      if (outcome.toolBlock !== undefined) sources.push(outcome.toolBlock);
      if (outcome.stop !== undefined) {
        termination = outcome.stop;
        summary = outcome.summary;
        break;
      }
    }

    const status = termination === "FINISHED" ? "COMPLETED" : "TERMINATED";

    // نهاية المهمة كما وقعت. حالة المهمة ليست إثبات إنجاز، ولا تُقرأ كذلك:
    // MISSION_COMPLETED يعني «انتهت الحلقة»، لا «وقع الأثر المطلوب».
    this.#audit.emit({
      event_type: status === "COMPLETED" ? "MISSION_COMPLETED" : "MISSION_FAILED",
      correlation_id: mission.correlation_id,
      causation_id: mission.mission_id,
      caller_identity: mission.caller_identity,
      actor: { kind: "AGENT", id: mission.agent_id },
      mission_id: mission.mission_id,
      agent_id: mission.agent_id,
      status: status === "COMPLETED" ? "SUCCESS" : "FAILED",
      ...(status === "COMPLETED"
        ? {}
        : {
            error: {
              code: "INTERNAL_ERROR" as const,
              display_message: "The mission did not run to completion.",
              internal_detail: `termination=${termination}; errors=${errors.map((e) => e.code).join(", ")}`,
              retryable: false,
            },
          }),
      metadata: {
        termination,
        steps: String(steps.length),
        tool_calls: String(ledger.snapshot().tool_calls),
      },
    });

    return {
      mission_id: mission.mission_id,
      correlation_id: mission.correlation_id,
      status,
      termination,
      ...(summary === undefined ? {} : { summary }),
      steps,
      budget: ledger.snapshot(),
      errors,
    };
  }

  async #runIteration(
    mission: Mission,
    system: string,
    sources: readonly ContextSource[],
    ledger: BudgetLedger,
    iteration: number,
  ): Promise<StepOutcome> {
    const blocks = buildBlocks(sources, this.#limits);
    const violations: string[] = [];

    // حلقة إعادة المحاولة على مخرج غير صالح. محدودة، ونهايتها فشل نهائي لا حلقة لا نهائية.
    for (let attempt = 1; ; attempt += 1) {
      const modelCharge = ledger.chargeModelCall();
      if (!modelCharge.ok) {
        return this.#terminalStep(iteration, attempt, "BUDGET_EXHAUSTED", modelCharge.error);
      }

      const request = {
        system,
        mission: mission.instruction,
        blocks,
        iteration,
        attempt,
        violations: [...violations],
      };
      const rendered = renderRequest(request);
      const contextCharge = ledger.chargeContext(rendered);
      if (!contextCharge.ok) {
        return this.#terminalStep(iteration, attempt, "BUDGET_EXHAUSTED", contextCharge.error);
      }

      const raw = await this.#model.complete(request);
      const outputCharge = ledger.chargeModelOutput(raw.raw);
      if (!outputCharge.ok) {
        return this.#terminalStep(iteration, attempt, "BUDGET_EXHAUSTED", outputCharge.error);
      }

      const gated = gateModelOutput({
        raw,
        correlation_id: mission.correlation_id,
        causation_id: mission.mission_id,
        mission_id: mission.mission_id,
        agent_id: mission.agent_id,
        available_capabilities: this.#gateway.availableCapabilities(),
        loop: {
          attempt,
          max_retries: this.#budget.max_model_retries,
          iteration,
          max_iterations: this.#budget.max_iterations,
        },
        declared_schema_ref: PROPOSAL_SCHEMA_REF,
      });

      this.#audit.emit({
        event_type: "MODEL_OUTPUT_VALIDATED",
        correlation_id: mission.correlation_id,
        causation_id: mission.mission_id,
        caller_identity: mission.caller_identity,
        actor: { kind: "AGENT", id: mission.agent_id },
        mission_id: mission.mission_id,
        agent_id: mission.agent_id,
        status: gated.valid ? "SUCCESS" : "FAILED",
        ...(gated.valid
          ? {}
          : {
              error: {
                code: "CONTRACT_VIOLATION",
                display_message: "The model output did not satisfy its contract.",
                internal_detail: `${String(gated.document["validation_status"])}: ${gated.violations.map((v) => `${v.code} ${v.detail}`).join("; ")}`,
                retryable: true,
              },
            }),
      });

      if (gated.valid && gated.payload !== undefined) {
        return this.#actOnProposal(mission, ledger, iteration, attempt, gated.payload, String(gated.document["output_id"]), sources);
      }

      violations.push(...gated.violations.map((v) => `${v.code}: ${v.detail}`));
      const retry = ledger.chargeModelRetry();
      const terminal = gated.document["loop_control"] as Record<string, unknown>;
      if (!retry.ok || terminal["terminal"] === true) {
        return {
          step: {
            iteration,
            attempt,
            model_output_id: String(gated.document["output_id"]),
            validation_status: String(gated.document["validation_status"]),
            declassifications: [],
            error_code: W4ErrorCode.MODEL_CONTRACT_VIOLATION,
            error_layer: "MODEL_OUTPUT_GATE",
          },
          stop: "MODEL_CONTRACT_VIOLATION",
          error: w4Error(
            W4ErrorCode.MODEL_CONTRACT_VIOLATION,
            "MODEL_OUTPUT_GATE",
            "The model could not produce a usable instruction.",
            violations.join(" | "),
          ),
        };
      }
    }
  }

  async #actOnProposal(
    mission: Mission,
    ledger: BudgetLedger,
    iteration: number,
    attempt: number,
    payload: ProposalPayload,
    outputId: string,
    sources: readonly ContextSource[],
  ): Promise<StepOutcome> {
    if (payload.action === "finish") {
      return {
        step: {
          iteration,
          attempt,
          model_output_id: outputId,
          validation_status: "VALID",
          declassifications: [],
        },
        stop: "FINISHED",
        summary: payload.summary,
      };
    }

    const toolCharge = ledger.chargeToolCall();
    if (!toolCharge.ok) return this.#terminalStep(iteration, attempt, "BUDGET_EXHAUSTED", toolCharge.error);

    const path = typeof payload.arguments["path"] === "string" ? (payload.arguments["path"] as string) : "";
    // القاعدة الثابتة: وسيطة اقترحها النموذج ملوّثة افتراضًا، ويُدمج معها
    // تلوث كل مصدر غير موثوق أسهم في السياق. لا يُطرح شيء هنا أبدًا.
    const inherited: readonly TaintLabel[] = mergeTaint(
      ...sources.filter((s) => s.ingress.content_trust === "UNTRUSTED").map((s) => s.ingress.taint_labels),
    );
    const taint = mergeTaint(MODEL_PARAMETER_DEFAULT_TAINT, inherited);

    // طلب رفع التصنيف لكل أثر على حدة. الفشل هنا لا يوقف المسار:
    // الرفض قرار PDP، لا قرار الـDeclassifier.
    const effects = this.#gateway.effectsOf(payload.capability_id) ?? [];
    const declassifications = this.#requestDeclassification(mission, effects, path, taint, outputId);

    const proposal: CapabilityProposal = {
      capability_id: payload.capability_id,
      arguments: payload.arguments,
      taint_labels: taint,
      provenance_refs: [{ kind: "MODEL_OUTPUT", ref: outputId }],
      causation_id: outputId,
    };

    const result = await this.#gateway.invoke(proposal, {
      correlation_id: mission.correlation_id,
      mission_id: mission.mission_id,
      agent_id: mission.agent_id,
      caller_identity: mission.caller_identity,
      attempt: 1,
    });

    if (!result.ok) {
      const reasons = result.decision?.["reason_codes"];
      return {
        step: {
          iteration,
          attempt,
          model_output_id: outputId,
          validation_status: "VALID",
          proposed_capability: payload.capability_id,
          proposed_path: path,
          declassifications,
          gateway_ok: false,
          error_code: result.error.code,
          error_layer: result.error.layer,
          ...(Array.isArray(reasons) ? { reason_codes: reasons.map(String) } : {}),
        },
        stop: result.error.layer === "PDP" ? "TOOL_DENIED" : "TOOL_FAILED",
        error: result.error,
      };
    }

    const resultCharge = ledger.chargeToolResult(result.result.bytes);
    if (!resultCharge.ok) return this.#terminalStep(iteration, attempt, "BUDGET_EXHAUSTED", resultCharge.error);

    // نتيجة الأداة تدخل السياق بوصفها بيانات: مصرّح بالمورد، غير موثوق المحتوى.
    const body = result.result.content ?? `[${result.result.wrote ?? "DONE"}] ${result.result.resource_logical}`;
    const ingress: IngressRecord = classifyIngress({
      source: "TOOL_DERIVED",
      content: body,
      resource_authorization: "AUTHORIZED",
      inherited_taint: result.result.taint_labels,
      locator: result.result.resource_logical,
    });

    // D1: استخراج مقيّد بمخطط من نتيجة الأداة، إن أعلنت المهمة خطوة استخراج.
    // المحتوى غير موثوق، والمخطط هو الحاجز الوحيد.
    const extracted = this.#requestExtraction(mission, body, result.result.taint_labels, result.result.invocation_id);

    return {
      step: {
        iteration,
        attempt,
        model_output_id: outputId,
        validation_status: "VALID",
        proposed_capability: payload.capability_id,
        proposed_path: path,
        declassifications: [...declassifications, ...extracted],
        gateway_ok: true,
        tool_result_bytes: result.result.bytes,
      },
      toolBlock: { label: `TOOL RESULT ${result.result.capability_id}`, body, ingress },
    };
  }

  #requestExtraction(
    mission: Mission,
    content: string,
    taint: readonly TaintLabel[],
    provenance: string,
  ): readonly DeclassificationStep[] {
    const extraction = mission.extraction;
    if (extraction === undefined) return [];
    const steps: DeclassificationStep[] = [];
    for (const action of extraction.purposes) {
      const attempt = this.#declassifier.byExtraction({
        correlation_id: mission.correlation_id,
        mission_id: mission.mission_id,
        content,
        schema_id: extraction.schema_id,
        purpose: { action, value_kind: "FILESYSTEM_PATH" },
        scope: "SINGLE_MISSION",
        input_taint: taint,
        input_provenance: [provenance],
      });
      steps.push(
        attempt.ok
          ? { method: "D1", action, value: attempt.record.output_value, succeeded: true }
          : { method: "D1", action, value: "", succeeded: false, failure_code: attempt.failure.code },
      );
    }
    return steps;
  }

  #requestDeclassification(
    mission: Mission,
    effects: readonly EffectAction[],
    path: string,
    taint: readonly TaintLabel[],
    outputId: string,
  ): readonly DeclassificationStep[] {
    const steps: DeclassificationStep[] = [];
    for (const action of effects) {
      const attempt = this.#declassifier.byProvenance({
        correlation_id: mission.correlation_id,
        mission_id: mission.mission_id,
        candidate: path,
        purpose: { action, value_kind: "FILESYSTEM_PATH" },
        scope: "SINGLE_MISSION",
        input_taint: taint,
        input_provenance: [outputId],
      });
      steps.push(
        attempt.ok
          ? { method: "D2", action, value: attempt.record.output_value, succeeded: true }
          : { method: "D2", action, value: path, succeeded: false, failure_code: attempt.failure.code },
      );
    }
    return steps;
  }

  #terminalStep(iteration: number, attempt: number, stop: Termination, error: W4Error): StepOutcome {
    return {
      step: {
        iteration,
        attempt,
        model_output_id: "",
        validation_status: "NOT_PRODUCED",
        declassifications: [],
        error_code: error.code,
        error_layer: error.layer,
      },
      stop,
      error,
    };
  }
}
