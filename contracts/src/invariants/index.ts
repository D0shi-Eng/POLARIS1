// الثوابت العابرة للعقود. هذه القواعد لا يمكن التعبير عنها في مخطط مستند واحد
// لأنها تقارن مستندين أو أكثر على طول السلسلة:
//   IPC → Invocation → Decision → Audit،  و  ModelOutput → Invocation.

import { canonicalize } from "../canonical.js";
import { ErrorCode, type ContractError } from "../errors.js";
import { findSecrets } from "../secret-hygiene.js";
import { widenedAxes } from "./lattice.js";

export type Doc = Record<string, unknown>;

/** مجموعة المستندات المتاحة عند نقطة فحص. كلها اختيارية: كل ثابت يفحص ما يعنيه فقط. */
export interface ContractFlow {
  readonly envelope?: Doc;
  readonly descriptor?: Doc;
  readonly invocation?: Doc;
  readonly decision?: Doc;
  readonly audit?: Doc;
  readonly modelOutput?: Doc;
}

export interface InvariantResult {
  readonly id: InvariantId;
  readonly title: string;
  readonly applicable: boolean;
  readonly violations: readonly ContractError[];
}

export type InvariantId =
  | "INV-001"
  | "INV-002"
  | "INV-003"
  | "INV-004"
  | "INV-005"
  | "INV-006"
  | "INV-007";

function breach(id: InvariantId, display: string, pointer: string, detail: string): ContractError {
  return {
    code: ErrorCode.CONTRACT_VIOLATION,
    display_message: display,
    internal_detail: `${id}: ${detail}`,
    pointer,
    retryable: false,
  };
}

function record(value: unknown): Doc | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Doc) : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ── INV-001 ──────────────────────────────────────────────────────────────────
// قدرة تعلن أنها بلا شبكة لا يجوز أن تُنفَّذ بشبكة أوسع. الاختبار على الشبكة الترتيبية،
// فيشمل تلقائيًا القفزة من NONE إلى BROKERED_EGRESS وإلى UNRESTRICTED.

function inv001(flow: ContractFlow): InvariantResult {
  const descriptor = record(flow.descriptor?.["execution_requirements"]);
  const invocation = record(flow.invocation?.["execution_constraints"]);
  const applicable = descriptor !== undefined && invocation !== undefined;
  const violations: ContractError[] = [];

  if (applicable) {
    for (const axis of widenedAxes(descriptor, invocation)) {
      if (axis.axis !== "network") continue;
      violations.push(
        breach(
          "INV-001",
          "Execution requests wider network access than the capability declared.",
          "/execution_constraints/network",
          `descriptor=${String(axis.from)} invocation=${String(axis.to)}`,
        ),
      );
    }
  }

  return { id: "INV-001", title: "Network requirement cannot widen from descriptor to execution", applicable, violations };
}

// ── INV-002 ──────────────────────────────────────────────────────────────────
// كل أثر في الاستدعاء يجب أن يكون معلنًا في الواصف. المقارنة على الفعل والوجهة معًا:
// إعلان network.fetch إلى مضيف واحد لا يمنح الوصول إلى مضيف آخر.

function effectKey(effect: Doc): string {
  return canonicalize({ action: effect["action"], destination: effect["destination"] ?? null });
}

function inv002(flow: ContractFlow): InvariantResult {
  const declared = list(flow.descriptor?.["requested_effects"]).map(record).filter((e): e is Doc => e !== undefined);
  const requested = list(flow.invocation?.["requested_effects"]).map(record).filter((e): e is Doc => e !== undefined);
  const applicable = flow.descriptor !== undefined && flow.invocation !== undefined;
  const violations: ContractError[] = [];

  if (applicable) {
    const allowed = new Set(declared.map(effectKey));
    requested.forEach((effect, index) => {
      if (!allowed.has(effectKey(effect))) {
        violations.push(
          breach(
            "INV-002",
            "Invocation exercises an effect the capability never declared.",
            `/requested_effects/${index}`,
            `undeclared effect ${String(effect["action"])}`,
          ),
        );
      }
    });
  }

  return { id: "INV-002", title: "Invocation effects must be a subset of declared effects", applicable, violations };
}

// ── INV-003 ──────────────────────────────────────────────────────────────────
// الالتزام يُضيّق فقط. التزام REQUIRE_CONFINEMENT الذي يوسّع أي محور هو تصعيد امتياز
// عبر قناة السياسة، وهو أخطر من الطلب الصريح لأنه يبدو كأنه قيد.

function inv003(flow: ContractFlow): InvariantResult {
  const constraints = record(flow.invocation?.["execution_constraints"]);
  const obligations = list(flow.decision?.["obligations"]).map(record).filter((o): o is Doc => o !== undefined);
  const applicable = constraints !== undefined && flow.decision !== undefined;
  const violations: ContractError[] = [];

  if (applicable) {
    obligations.forEach((obligation, index) => {
      if (obligation["type"] === "REQUIRE_CONFINEMENT") {
        for (const axis of widenedAxes(constraints, record(obligation["requirements"]))) {
          violations.push(
            breach(
              "INV-003",
              "Policy obligation widens privileges beyond the invocation.",
              `/obligations/${index}/requirements/${axis.axis}`,
              `${axis.axis}: invocation=${String(axis.from)} obligation=${String(axis.to)}`,
            ),
          );
        }
      }

      if (obligation["type"] === "REQUIRE_BROKERED_EGRESS") {
        const permitted = new Set(list(constraints["allowed_destinations"]).map((d) => canonicalize(d)));
        list(obligation["allowed_destinations"]).forEach((destination, di) => {
          if (!permitted.has(canonicalize(destination))) {
            violations.push(
              breach(
                "INV-003",
                "Policy obligation adds a network destination the invocation did not carry.",
                `/obligations/${index}/allowed_destinations/${di}`,
                "obligation destination absent from invocation allow-list",
              ),
            );
          }
        });
      }

      if (obligation["type"] === "MAX_BYTES") {
        const ceiling = constraints["max_output_bytes"];
        if (typeof ceiling === "number" && Number(obligation["max_bytes"]) > ceiling) {
          violations.push(
            breach(
              "INV-003",
              "Policy obligation raises the output ceiling.",
              `/obligations/${index}/max_bytes`,
              `invocation=${ceiling} obligation=${String(obligation["max_bytes"])}`,
            ),
          );
        }
      }
    });
  }

  return { id: "INV-003", title: "Obligations may narrow privileges, never widen them", applicable, violations };
}

// ── INV-004 ──────────────────────────────────────────────────────────────────
// هوية المستدعي تنتقل كما هي. أي اختلاف يعني ضياع الإسناد بين حد الثقة والتنفيذ.

function inv004(flow: ContractFlow): InvariantResult {
  const fromIpc = flow.envelope?.["caller_identity"];
  const atInvocation = flow.invocation?.["caller_identity"];
  const applicable = fromIpc !== undefined && atInvocation !== undefined;
  const violations: ContractError[] = [];

  if (applicable && canonicalize(fromIpc) !== canonicalize(atInvocation)) {
    violations.push(
      breach(
        "INV-004",
        "Caller identity changed between the IPC boundary and the invocation.",
        "/caller_identity",
        "identity is not preserved across the boundary",
      ),
    );
  }

  return { id: "INV-004", title: "Caller identity propagates from IPC to invocation without loss", applicable, violations };
}

// ── INV-005 ──────────────────────────────────────────────────────────────────
// correlation_id واحد للسلسلة كلها، وكل حلقة تشير سببيًا إلى سابقتها.

function inv005(flow: ContractFlow): InvariantResult {
  const stages: ReadonlyArray<readonly [string, Doc | undefined]> = [
    ["envelope", flow.envelope],
    ["invocation", flow.invocation],
    ["decision", flow.decision],
    ["audit", flow.audit],
  ];
  const present = stages.filter((s): s is readonly [string, Doc] => s[1] !== undefined);
  const applicable = present.length >= 2;
  const violations: ContractError[] = [];

  if (applicable) {
    const [firstName, firstDoc] = present[0] as readonly [string, Doc];
    const expected = firstDoc["correlation_id"];
    for (const [name, doc] of present.slice(1)) {
      if (doc["correlation_id"] !== expected) {
        violations.push(
          breach("INV-005", "Correlation chain is broken.", "/correlation_id", `${name} correlation_id differs from ${firstName}`),
        );
      }
    }

    // روابط السببية بين الحلقات المتجاورة عندما تكون كلتاهما حاضرة.
    if (flow.envelope !== undefined && flow.invocation !== undefined) {
      if (flow.invocation["causation_id"] !== flow.envelope["message_id"]) {
        violations.push(
          breach("INV-005", "Invocation does not name the IPC message that caused it.", "/causation_id", "invocation.causation_id !== envelope.message_id"),
        );
      }
    }
    if (flow.invocation !== undefined && flow.decision !== undefined) {
      if (flow.decision["invocation_id"] !== flow.invocation["invocation_id"]) {
        violations.push(
          breach("INV-005", "Decision does not name the invocation it judged.", "/invocation_id", "decision.invocation_id !== invocation.invocation_id"),
        );
      }
    }
    if (flow.decision !== undefined && flow.audit !== undefined && flow.audit["event_type"] === "POLICY_EVALUATED") {
      if (flow.audit["decision_id"] !== flow.decision["decision_id"]) {
        violations.push(
          breach("INV-005", "Audit event does not name the decision it records.", "/decision_id", "audit.decision_id !== decision.decision_id"),
        );
      }
    }
  }

  return { id: "INV-005", title: "correlation_id and causation links survive the whole chain", applicable, violations };
}

// ── INV-006 ──────────────────────────────────────────────────────────────────
// البوابة الحاسمة: مخرج نموذج غير صالح لا يصبح استدعاء قدرة.
// السماح مشروط بثلاثة أمور معًا: النوع اقتراح أداة، والحالة VALID، ووجود حمولة مفسَّرة.

function inv006(flow: ContractFlow): InvariantResult {
  const output = flow.modelOutput;
  const invocation = flow.invocation;
  const applicable =
    output !== undefined && invocation !== undefined && invocation["causation_id"] === output["output_id"];
  const violations: ContractError[] = [];

  if (applicable && output !== undefined) {
    if (output["validation_status"] !== "VALID") {
      violations.push(
        breach(
          "INV-006",
          "An invalid model output was turned into a capability invocation.",
          "/causation_id",
          `validation_status=${String(output["validation_status"])}`,
        ),
      );
    }
    if (output["output_type"] !== "TOOL_INVOCATION_PROPOSAL") {
      violations.push(
        breach(
          "INV-006",
          "Model output of this type cannot become a capability invocation.",
          "/causation_id",
          `output_type=${String(output["output_type"])}`,
        ),
      );
    }
    if (record(output["parsed_payload"]) === undefined) {
      violations.push(
        breach("INV-006", "Model output without a validated payload cannot become an invocation.", "/causation_id", "parsed_payload absent"),
      );
    }
    // التلوث ينتقل: استدعاء ناتج عن نموذج يجب أن يحمل وسم MODEL_GENERATED.
    if (!list(invocation["taint_labels"]).includes("MODEL_GENERATED")) {
      violations.push(
        breach("INV-006", "Model-derived invocation lost its taint label.", "/taint_labels", "MODEL_GENERATED not propagated"),
      );
    }
  }

  return { id: "INV-006", title: "Only a VALID tool-invocation proposal may become an invocation", applicable, violations };
}

// ── INV-007 ──────────────────────────────────────────────────────────────────
// نظافة سجل التدقيق. الادعاء محدود ومُثبَت: الحقول الحرة المحدودة في AuditEvent
// تُرفض إذا حملت مفاتيح أو قيمًا مطابقة لأنماط اعتماد معروفة.

function inv007(flow: ContractFlow): InvariantResult {
  const audit = flow.audit;
  const applicable = audit !== undefined;
  const violations: ContractError[] = [];

  if (applicable && audit !== undefined) {
    for (const finding of findSecrets(record(audit["metadata"]), "/metadata")) {
      violations.push(breach("INV-007", "Audit event carries credential-shaped data.", finding.pointer, `${finding.reason}: ${finding.detail}`));
    }

    // قيمة السر لا تُسجَّل أبدًا؛ يُسجَّل أنها أُخرجت فقط.
    list(audit["effects"]).map(record).forEach((effect, index) => {
      if (effect?.["action"] === "secret.deref" && effect["data_classification"] !== "SECRET") {
        violations.push(
          breach("INV-007", "Secret dereference recorded without SECRET classification.", `/effects/${index}/data_classification`, "misclassified secret effect"),
        );
      }
    });
  }

  return { id: "INV-007", title: "Audit events carry no credential-shaped data", applicable, violations };
}

const INVARIANTS: ReadonlyArray<(flow: ContractFlow) => InvariantResult> = [
  inv001,
  inv002,
  inv003,
  inv004,
  inv005,
  inv006,
  inv007,
];

/** يشغّل كل الثوابت المنطبقة على ما هو متاح من المستندات. */
export function checkInvariants(flow: ContractFlow): readonly InvariantResult[] {
  return INVARIANTS.map((check) => check(flow));
}

/** كل الانتهاكات مسطّحة، للاستخدام في نقاط الفرض. */
export function invariantViolations(flow: ContractFlow): readonly ContractError[] {
  return checkInvariants(flow).flatMap((result) => result.violations);
}
