// نقطة قرار السياسة المحلية. تستقبل عقود W2 وتُعيد PolicyDecisionV1.
// لا تنفّذ شيئًا، ولا تلمس نظام الملفات ولا الشبكة، ولا تسأل نموذجًا لغويًا عن قرار أمني.
//
// قاعدة الفشل المغلق: كل مسار لا ينتهي بسماح صريح مُثبَت ينتهي برفض.
//
// W4: يقرأ دفتر رفع التصنيف قراءةً فقط. لا يستطيع أحد أن يمرّر "سجلًا" داخل الاستدعاء:
// السجلات تُطلب من الدفتر الذي تملكه خدمة الـDeclassifier، لا من المستند القادم من الوكيل.

import { randomUUID } from "node:crypto";

import { validateContract, type ContractError } from "@polaris/contracts";

import { FILESYSTEM_WRITE_ACTIONS, NETWORK_ACTIONS, isEffectAction } from "../effects.js";
import type { DeclassificationReader } from "../trust/ledger.js";
import type { ConfigService } from "../config/service.js";
import { buildContext, destinationKey, type CedarContext } from "./context.js";
import { evaluate, policySetParses } from "./cedar-engine.js";
import { policyFor, POLICIES } from "./policy-set.js";
import {
  POLICY_EPOCH,
  POLICY_SET_VERSION,
  SUPPORTED_POLICY_MAJOR,
  type Doc,
  type EffectVerdict,
  type PdpRequest,
} from "./types.js";

export interface PdpOutcome {
  readonly decision: Doc;
  readonly verdicts: readonly EffectVerdict[];
  /** السياق المُقيَّم لكل أثر، بنفس ترتيب verdicts. هو أساس إسناد سبب الرفض. */
  readonly contexts: readonly CedarContext[];
  /** أخطاء منعت التقييم أصلًا. وجودها يعني أن الرفض كان فشلًا مغلقًا، لا حكمًا. */
  readonly gate_errors: readonly ContractError[];
}

type ReasonCode =
  | "EXPLICIT_ALLOW_RULE"
  | "APPROVAL_REQUIRED"
  | "NO_MATCHING_RULE"
  | "DEFAULT_DENY"
  | "EFFECT_NOT_GRANTED"
  | "NETWORK_NOT_BROKERED"
  | "RESOURCE_OUT_OF_SCOPE"
  | "TAINTED_INPUT"
  | "CONFIG_DEGRADED"
  | "EVALUATION_ERROR"
  | "UNTRUSTED_CALLER";

function asRecord(value: unknown): Doc | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : undefined;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface PdpOptions {
  /**
   * إصدار مجموعة السياسات المستخدَم. يُحقن بدل قراءته من ثابت مباشرة، لأن السياسات
   * ستُحمَّل لاحقًا من ملفات لها إصدارها الخاص، ولأن سلوك الإصدار غير المدعوم
   * يجب أن يكون قابلًا للإثبات لا موصوفًا فقط.
   */
  readonly policySetVersion?: string;
  /**
   * دفتر رفع التصنيف، قراءةً فقط. غيابه ليس خطأً: يعني ببساطة أن أي قيمة ملوّثة
   * لن تجد سجلًا، فتُرفض. هذا هو السلوك المغلق الصحيح.
   */
  readonly declassification?: DeclassificationReader;
}

export class LocalPdp {
  readonly #config: ConfigService;
  readonly #policySetVersion: string;
  readonly #declassification: DeclassificationReader | undefined;

  public constructor(config: ConfigService, options: PdpOptions = {}) {
    this.#config = config;
    this.#policySetVersion = options.policySetVersion ?? POLICY_SET_VERSION;
    this.#declassification = options.declassification;
  }

  /**
   * يقيّم استدعاءً واحدًا. كل أثر يُقيَّم على حدة، والتركيب تحفّظي:
   * السماح لا يصدر إلا إذا سُمح لكل أثر. أثر واحد مرفوض يرفض الاستدعاء كله.
   */
  public decide(request: PdpRequest): PdpOutcome {
    const gate: ContractError[] = [];
    const invocation = request.invocation;
    const config = this.#config.effective();

    // 1) بوابات ما قبل التقييم. كل واحدة منها تعني: لا نستطيع أن نعرف، إذن نرفض.
    const invocationCheck = validateContract("CapabilityInvocationV1", invocation);
    if (!invocationCheck.ok) gate.push(...invocationCheck.errors);

    const descriptorCheck = validateContract("CapabilityDescriptorV1", request.descriptor);
    if (!descriptorCheck.ok) gate.push(...descriptorCheck.errors);

    const [major] = this.#policySetVersion.split(".");
    if (!/^\d+$/.test(major ?? "") || Number(major) !== SUPPORTED_POLICY_MAJOR) {
      gate.push(
        this.#error("EVALUATION_ERROR", `policy set version ${this.#policySetVersion} is not supported by this build`),
      );
    }

    const parse = policySetParses();
    if (!parse.ok) gate.push(this.#error("EVALUATION_ERROR", `policy set does not parse: ${parse.detail}`));

    // الوضع الوحيد المدعوم هو الفشل المغلق. إعداد يقول غير ذلك ليس وضع تشغيل، بل خلل.
    if (this.#config.get("polaris.security.fail_closed") !== true) {
      gate.push(this.#error("CONFIG_DEGRADED", "fail_closed is not true; this is not a supported operating posture"));
    }

    if (config.integrity !== "HEALTHY") {
      gate.push(
        this.#error(
          "CONFIG_DEGRADED",
          `effective configuration is DEGRADED: ${config.degradations.map((d) => d.code).join(", ")}`,
        ),
      );
    }

    if (gate.length > 0) {
      return {
        decision: this.#denyDocument(invocation, this.#gateReasons(gate), gate),
        verdicts: [],
        contexts: [],
        gate_errors: gate,
      };
    }

    // 2) التقييم الفعلي، أثرًا أثرًا.
    const effects = asList(invocation["requested_effects"]).map(asRecord).filter((e): e is Doc => e !== undefined);
    if (effects.length === 0) {
      const err = [this.#error("EVALUATION_ERROR", "invocation carries no effects to evaluate")];
      return {
        decision: this.#denyDocument(invocation, ["EVALUATION_ERROR"], err),
        verdicts: [],
        contexts: [],
        gate_errors: err,
      };
    }

    const caller = asRecord(invocation["caller_identity"]);
    const principalId = typeof caller?.["principal_id"] === "string" ? (caller["principal_id"] as string) : "unknown";

    const contexts: CedarContext[] = [];
    const verdicts: EffectVerdict[] = effects.map((effect, index) => {
      const context = buildContext(effect, invocation, request.descriptor, config, this.#declassification);
      contexts.push(context);
      const resource = asRecord(effect["resource"]) ?? asRecord(invocation["resource"]);
      const resourceId =
        typeof resource?.["locator"] === "string"
          ? (resource["locator"] as string)
          : (destinationKey(asRecord(effect["destination"])) ?? "unspecified");
      const action = typeof effect["action"] === "string" ? (effect["action"] as string) : "unknown";
      const verdict = evaluate(principalId, action, resourceId, context);
      return {
        effect_index: index,
        action,
        decision: verdict.decision,
        matched_policy_ids: verdict.matched_policy_ids,
        evaluation_errors: verdict.errors,
      };
    });

    const denied = verdicts.filter((v) => v.decision === "deny");
    if (denied.length > 0) {
      return {
        decision: this.#denyDocument(invocation, this.#denyReasons(denied, contexts), []),
        verdicts,
        contexts,
        gate_errors: [],
      };
    }

    return { decision: this.#allowDocument(invocation, verdicts), verdicts, contexts, gate_errors: [] };
  }

  #error(code: ReasonCode, detail: string): ContractError {
    return {
      code: code === "CONFIG_DEGRADED" ? "DEPENDENCY_UNAVAILABLE" : "INTERNAL_ERROR",
      display_message: "The request could not be evaluated and was denied.",
      internal_detail: `${code}: ${detail}`,
      retryable: false,
    } as ContractError;
  }

  #gateReasons(errors: readonly ContractError[]): ReasonCode[] {
    const codes = new Set<ReasonCode>();
    for (const error of errors) {
      if ((error.internal_detail ?? "").startsWith("CONFIG_DEGRADED")) codes.add("CONFIG_DEGRADED");
      else codes.add("EVALUATION_ERROR");
    }
    return [...codes];
  }

  /**
   * يترجم سبب الرفض التقني إلى رمز سبب من مفردات PolicyDecisionV1، مستندًا إلى
   * السياق الذي قُيّم فعلًا لا إلى تخمين من الفعل وحده.
   *
   * الترتيب مقصود: الاحتواء يُفحص قبل التلوث. مسار خارج النطاق يُنسب إلى النطاق
   * حتى لو كان ملوّثًا أيضًا، فالطبقة التي منعته فعلًا هي طبقة الموارد.
   *
   * ملاحظة صريحة: مفردة PolicyDecisionV1 لا تملك رمزًا لـ"منعٌ صريح"، لذلك يُنسب
   * الحذف المحظور إلى DEFAULT_DENY ويبقى السبب الدقيق في internal_reason.
   */
  #denyReasons(denied: readonly EffectVerdict[], contexts: readonly CedarContext[]): ReasonCode[] {
    const codes = new Set<ReasonCode>();

    for (const verdict of denied) {
      const context = contexts[verdict.effect_index];
      if (verdict.evaluation_errors.length > 0 || context === undefined) {
        codes.add("EVALUATION_ERROR");
        continue;
      }
      if (!context.effect_declared_by_descriptor) {
        codes.add("EFFECT_NOT_GRANTED");
        continue;
      }
      const action = isEffectAction(verdict.action) ? verdict.action : undefined;
      if (action !== undefined && NETWORK_ACTIONS.has(action)) {
        // الترتيب داخل الأثر الشبكي مقصود: غياب الوساطة يسبق التلوث، لأن غياب
        // نقطة فرض الخروج هو المانع الأول. أما إذا كانت الوساطة والوجهة مصرّحًا
        // بهما فعلًا، فالمانع الباقي هو التلوث، ويجب أن يُنسب إليه لا إلى الشبكة.
        const brokered =
          context.brokered_egress_enabled &&
          context.destination_authorized &&
          context.invocation_requests_brokered_egress;
        if (!brokered) {
          codes.add("NETWORK_NOT_BROKERED");
        } else if (context.parameter_tainted && !context.parameter_declassified_for_effect) {
          codes.add("TAINTED_INPUT");
        } else {
          codes.add("NO_MATCHING_RULE");
        }
        continue;
      }
      if (action === "delete.filesystem") {
        codes.add("DEFAULT_DENY");
        continue;
      }
      if (action === "read.filesystem" && !context.path_in_allowed_root) {
        codes.add("RESOURCE_OUT_OF_SCOPE");
        continue;
      }
      if (action !== undefined && FILESYSTEM_WRITE_ACTIONS.has(action)) {
        if (!context.write_enabled) {
          codes.add("NO_MATCHING_RULE");
          continue;
        }
        if (!context.path_in_allowed_write_root) {
          codes.add("RESOURCE_OUT_OF_SCOPE");
          continue;
        }
      }
      if (!context.confined) {
        codes.add("NO_MATCHING_RULE");
        continue;
      }
      if (context.parameter_tainted && !context.parameter_declassified_for_effect) {
        codes.add("TAINTED_INPUT");
        continue;
      }
      codes.add("DEFAULT_DENY");
    }

    if (codes.size === 0) codes.add("DEFAULT_DENY");
    return [...codes];
  }

  /**
   * القرار يجب أن يكون مستند PolicyDecisionV1 صالحًا حتى حين يكون سبب الرفض هو
   * أن إصدار السياسات نفسه غير مفهوم. لذلك يُكتب إصدار غير صالح الشكل بوصفه
   * 0.0.0 (علامة "غير معروف")، ويبقى الإصدار الحرفي في السبب الداخلي.
   */
  /**
   * يبني التزام الموافقة إن كان أحد الآثار المسموح بها معلنًا في الإعدادات
   * بوصفه أثرًا يشترط موافقة إنسان.
   *
   * المصدر هو الإعدادات لا مقترح النموذج، والقائمة الافتراضية فارغة: اشتراط
   * الموافقة يُعلَن، ولا يُستنتج من خطورة مزعومة.
   */
  #approvalObligationFor(verdicts: readonly EffectVerdict[]): Doc | undefined {
    const required = (this.#config.get("polaris.approval.required_effects") ?? []) as readonly string[];
    if (required.length === 0) return undefined;
    if (!verdicts.some((v) => required.includes(v.action))) return undefined;

    const expiry = Number(this.#config.get("polaris.approval.expires_in_seconds") ?? 0);
    const approver = this.#config.get("polaris.approval.approver") === "OPERATOR" ? "OPERATOR" : "END_USER";
    return expiry > 0
      ? { type: "REQUIRE_APPROVAL", approver, expires_in_seconds: expiry }
      : { type: "REQUIRE_APPROVAL", approver };
  }

  #policyRef(): Doc {
    const isSemVer = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(this.#policySetVersion);
    return { policy_version: isSemVer ? this.#policySetVersion : "0.0.0", policy_epoch: POLICY_EPOCH };
  }

  #denyDocument(invocation: Doc, reasons: readonly ReasonCode[], gate: readonly ContractError[]): Doc {
    const level = this.#config.get("polaris.audit.detail_level") === "DETAILED" ? "DETAILED" : "STANDARD";
    const internal =
      gate.length > 0
        ? gate.map((e) => e.internal_detail ?? e.display_message).join(" | ")
        : `denied by policy set ${this.#policySetVersion}; reasons: ${reasons.join(", ")}`;

    return {
      contract_version: "1.1",
      decision_id: randomUUID(),
      invocation_id: invocation["invocation_id"],
      correlation_id: invocation["correlation_id"],
      causation_id: invocation["invocation_id"],
      result: "DENY",
      // على الرفض لا يُسمح إلا بالتزام التدقيق. الرفض لا يمنح امتيازًا.
      obligations: [{ type: "AUDIT", level }],
      reason_codes: [...reasons],
      display_reason: "This action was not permitted.",
      internal_reason: internal,
      policy_ref: this.#policyRef(),
      // القرار يعتمد على قيم وسيطات الاستدعاء (المسار، الوجهة)، فهو غير قابل للتخزين المؤقت.
      cacheability: { cacheable: false },
      decided_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }

  #allowDocument(invocation: Doc, verdicts: readonly EffectVerdict[]): Doc {
    const constraints = asRecord(invocation["execution_constraints"]);
    const level = this.#config.get("polaris.audit.detail_level") === "DETAILED" ? "DETAILED" : "STANDARD";
    const configCeiling = Number(this.#config.get("polaris.execution.max_output_bytes") ?? 0);
    const invocationCeiling =
      typeof constraints?.["max_output_bytes"] === "number" ? (constraints["max_output_bytes"] as number) : undefined;

    const obligations: Doc[] = [];
    if (constraints !== undefined) obligations.push({ type: "REQUIRE_CONFINEMENT", requirements: constraints });
    obligations.push({ type: "AUDIT", level });

    // السقف لا يُرفع أبدًا: الالتزام يأخذ الأصغر بين إعداد النظام وقيد الاستدعاء (INV-003).
    const ceiling = invocationCeiling === undefined ? configCeiling : Math.min(configCeiling, invocationCeiling);
    if (ceiling > 0) obligations.push({ type: "MAX_BYTES", max_bytes: ceiling });

    // بوابة الخروج المتوسَّط تُذكر كالتزام فقط عندما يطلبها الاستدعاء أصلًا،
    // وبالوجهات التي يحملها الاستدعاء نفسه — لا تُضاف وجهة جديدة أبدًا.
    if (constraints?.["network"] === "BROKERED_EGRESS") {
      const destinations = asList(constraints["allowed_destinations"]);
      if (destinations.length > 0) {
        obligations.push({ type: "REQUIRE_BROKERED_EGRESS", allowed_destinations: destinations });
      }
    }

    // التزام الموافقة. الالتزام لا يوسّع شيئًا: هو شرط إضافي على سماح قائم،
    // ولا يمكن أن يحوّل رفضًا إلى سماح لأنه لا يُبنى إلا داخل مستند السماح.
    // النتيجة تبقى ثنائية: الموافقة ليست نتيجة ثالثة، ولا تُمثَّل كذلك في أي موضع.
    const approvalObligation = this.#approvalObligationFor(verdicts);
    if (approvalObligation !== undefined) obligations.push(approvalObligation);

    const matched = [...new Set(verdicts.flatMap((v) => v.matched_policy_ids))].sort();
    const logical = [...new Set(matched.map((id) => policyFor(id)?.policy_id ?? id))];

    return {
      contract_version: "1.1",
      decision_id: randomUUID(),
      invocation_id: invocation["invocation_id"],
      correlation_id: invocation["correlation_id"],
      causation_id: invocation["invocation_id"],
      result: "ALLOW",
      obligations,
      reason_codes:
        approvalObligation === undefined
          ? ["EXPLICIT_ALLOW_RULE"]
          : ["EXPLICIT_ALLOW_RULE", "APPROVAL_REQUIRED"],
      display_reason: "This action is permitted by the current policy.",
      internal_reason: `allowed by ${logical.join(", ")} (cedar: ${matched.join(", ")})`,
      policy_ref: this.#policyRef(),
      cacheability: { cacheable: false },
      decided_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
  }
}

export { POLICIES };
