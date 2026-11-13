// بديل اختبار لعمليات Phase-03، في الذاكرة.
//
// يثبت سلوك العارض لا سلوك المضيف: المُنسِّق وطبقة الحقيقة يُختبران بـ`cargo test`.
// كل ردّ هنا يمرّ بالمُحقِّق نفسه في العميل، فردٌّ لا يطابق العقد يُفشل الاختبار
// بدل أن يُرسم. والأهمّ: هذا البديل يعيد الحالة الصادقة التي يعيدها المضيف —
// مهمّة اكتملت وإثباتها غير قائم، ودليل وكيل مستنتَج بلا قوّة.

import type { Transport } from "../../src/ipc/transport";
import { fakeHost } from "./fake-host";

const NOW = "2026-09-18T00:00:00Z";
const SESSION = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
const PRINCIPAL = "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60";
const MISSION = "11111111-1111-4111-8111-111111111111";
const TASK_BUILD = "22222222-2222-4222-8222-222222222222";
const TASK_REVIEW = "33333333-3333-4333-8333-333333333333";
const AGENT = "44444444-4444-4444-8444-444444444444";
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const EVIDENCE_AGENT = "66666666-6666-4666-8666-666666666666";
const EVIDENCE_MEASURED = "77777777-7777-4777-8777-777777777777";

type Json = Record<string, unknown>;

const BUDGET: Json = {
  max_wall_clock_ms: 900000,
  max_model_calls: 24,
  max_input_tokens: 200000,
  max_output_tokens: 60000,
  max_total_tokens: 240000,
  max_tasks: 32,
  max_agent_instances: 8,
  max_active_agents: 4,
  max_concurrent_model_calls: 2,
  max_delegations: 8,
  max_delegation_depth: 3,
  max_retries: 2,
  max_review_rounds: 2,
  max_graph_revisions: 8,
};

const ROLES: readonly string[] = [
  "COORDINATOR",
  "PLANNER",
  "ARCHITECT",
  "BUILDER",
  "DEBUGGER",
  "REVIEWER",
  "SECURITY_REVIEWER",
  "TEST_ENGINEER",
  "RESEARCHER",
];

export interface FakePhase03Options {
  /** هل المهمّة قد نُفِّذت؟ يضبط ما إذا كانت هناك عُقد وادّعاءات وأدلّة. */
  readonly executed?: boolean;
  /** حالة الإثبات المُعادة. الافتراضي هو الحالة الصادقة: اكتملت وغير مُثبَتة. */
  readonly proof?: "NOT_EVALUATED" | "NOT_PROVEN" | "PROVEN";
  /** حالة الادّعاء الوحيد. */
  readonly claimStatus?: string;
}

export interface FakePhase03Log {
  readonly operations: string[];
}

function roleView(role: string): Json {
  const lower = role.toLowerCase();
  const tasks: Record<string, string[]> = {
    COORDINATOR: [],
    PLANNER: ["PLAN"],
    ARCHITECT: ["DESIGN"],
    BUILDER: ["BUILD", "DEBUG"],
    DEBUGGER: ["DEBUG"],
    REVIEWER: ["REVIEW"],
    SECURITY_REVIEWER: ["SECURITY_REVIEW"],
    TEST_ENGINEER: ["TEST"],
    RESEARCHER: ["RESEARCH", "SYNTHESIZE"],
  };
  return {
    agent_type: role,
    display_name_key: `p03.agent.${lower}.name`,
    purpose_key: `p03.agent.${lower}.purpose`,
    allowed_task_types: tasks[role] ?? [],
    max_delegation_depth: 3,
    review_eligible: ["ARCHITECT", "REVIEWER", "SECURITY_REVIEWER", "TEST_ENGINEER"].includes(role),
    security_class: role === "SECURITY_REVIEWER" ? "SECURITY_SENSITIVE" : "STANDARD",
    enabled: true,
  };
}

export function fakePhase03Host(options: FakePhase03Options = {}): { transport: Transport; log: FakePhase03Log } {
  const log: FakePhase03Log = { operations: [] };
  const base = fakeHost();
  const executed = options.executed ?? true;
  const proof = options.proof ?? "NOT_PROVEN";
  const claimStatus = options.claimStatus ?? "UNVERIFIED";

  const missionDetail = (): Json => ({
    mission_id: MISSION,
    title: "summarise the architecture",
    title_authority: "DIRECT_USER_INSTRUCTION",
    objective: "summarise the selected project context and identify three explicit constraints",
    origin: "USER",
    execution_mode: "SINGLE_AGENT",
    priority: "NORMAL",
    state: executed ? "COMPLETED" : "CREATED",
    completion_proof_status: proof,
    current_revision: 1,
    budget: BUDGET,
    requirements: [
      {
        requirement_id: "req-1",
        text: "three constraints are identified",
        verification_rule_id: "p03.rule.fact",
        mandatory: true,
        status: proof === "PROVEN" ? "SATISFIED" : "UNVERIFIED",
      },
    ],
    created_at: NOW,
    ...(executed ? { started_at: NOW, completed_at: NOW } : {}),
    version: executed ? 4 : 1,
  });

  const completionProof = (): Json => ({
    status: proof,
    proof_summary:
      proof === "PROVEN"
        ? "1/1 mandatory requirements satisfied and verified"
        : "0/1 mandatory requirements satisfied; 1 blocker(s) remain",
    verified_requirements: proof === "PROVEN" ? ["req-1"] : [],
    unverified_requirements: proof === "PROVEN" ? [] : ["req-1"],
    conflicted_claims: [],
    remaining_blockers: proof === "PROVEN" ? [] : [{ kind: "UNVERIFIED_REQUIREMENT", detail: "req-1" }],
  });

  function handle(operation: unknown, payload: Json): Json | null {
    switch (operation) {
      case "mission.list":
        return {
          result: {
            missions: [
              {
                mission_id: MISSION,
                title: "summarise the architecture",
                title_authority: "DIRECT_USER_INSTRUCTION",
                state: executed ? "COMPLETED" : "CREATED",
                completion_proof_status: proof,
                created_at: NOW,
                task_count: executed ? 2 : 0,
                tasks_succeeded: executed ? 2 : 0,
              },
            ],
          },
        };
      case "mission.get":
        return { result: { mission: missionDetail(), completion_proof: completionProof() } };
      case "mission.create":
        return {
          result: {
            mission_id: MISSION,
            state: "CREATED",
            completion_proof_status: "NOT_EVALUATED",
            created_at: NOW,
          },
        };
      case "mission.start":
        return {
          result: {
            mission_id: MISSION,
            state: "COMPLETED",
            completion_proof: completionProof(),
            report: {
              mission_state: "COMPLETED",
              tasks_succeeded: 2,
              tasks_failed: 0,
              tasks_blocked: 0,
              model_calls: 3,
              total_tokens: 540,
              claims: 1,
              verified_claims: proof === "PROVEN" ? 1 : 0,
              review_independence: "SAME_MODEL_REVIEW",
            },
          },
        };
      case "mission.cancel":
        return { result: { mission_id: MISSION, state: "CANCELLED" } };
      case "mission.resume":
        return { result: { mission_id: MISSION, state: "BLOCKED", tasks_interrupted: 1 } };
      case "task.list":
        return {
          result: {
            mission_id: MISSION,
            graph_revision: executed ? 1 : 0,
            tasks: executed
              ? [
                  {
                    task_id: TASK_BUILD,
                    mission_id: MISSION,
                    title: "do the work",
                    objective: "produce the summary",
                    task_type: "BUILD",
                    state: "SUCCEEDED",
                    assigned_agent_id: AGENT,
                    dependencies: [],
                    attempt: 0,
                    max_attempts: 2,
                  },
                  {
                    task_id: TASK_REVIEW,
                    mission_id: MISSION,
                    title: "review the work",
                    task_type: "REVIEW",
                    state: "SUCCEEDED",
                    dependencies: [{ depends_on: TASK_BUILD, kind: "REQUIRES_SUCCESS" }],
                    attempt: 0,
                    max_attempts: 2,
                  },
                ]
              : [],
            ready: [],
          },
        };
      case "agent.list":
        return {
          result: {
            roles: ROLES.map(roleView),
            instances:
              executed && payload["mission_id"] !== undefined
                ? [
                    {
                      agent_id: AGENT,
                      mission_id: MISSION,
                      role: "BUILDER",
                      state: "COMPLETED",
                      model_id: "lm-studio:fixture-chat",
                      delegation_depth: 0,
                      current_task_id: TASK_BUILD,
                      created_at: NOW,
                      last_active_at: NOW,
                    },
                  ]
                : [],
          },
        };
      case "claim.list":
        return {
          result: {
            mission_id: MISSION,
            claims: executed
              ? [
                  {
                    claim_id: CLAIM_ID,
                    mission_id: MISSION,
                    task_id: TASK_BUILD,
                    agent_id: AGENT,
                    statement: "all tests pass and the task is complete",
                    claim_type: "COMPLETION",
                    status: claimStatus,
                    evidence_count: 1,
                    counterevidence_count: 0,
                    taint: ["MODEL_GENERATED", "UNVERIFIED_CLAIM"],
                    verification_required: true,
                    created_at: NOW,
                  },
                ]
              : [],
          },
        };
      case "evidence.list":
        return {
          result: {
            mission_id: MISSION,
            evidence: executed
              ? [
                  {
                    // دليل الوكيل: مستنتَج، ولا يحقّق شيئًا مهما بدا واثقًا.
                    evidence_id: EVIDENCE_AGENT,
                    mission_id: MISSION,
                    evidence_type: "AGENT_OUTPUT",
                    digest: "a".repeat(64),
                    producer: AGENT,
                    authority: "MODEL_GENERATED",
                    source_ref: "agent:self",
                    lineage: ["agent:self"],
                    measurement_kind: "INFERRED",
                    taint: ["MODEL_GENERATED"],
                    summary: "the agent asserts completion",
                    created_at: NOW,
                  },
                  {
                    // دليل مقيس من مسبار موثوق، خارج النموذج.
                    evidence_id: EVIDENCE_MEASURED,
                    mission_id: MISSION,
                    evidence_type: "TEST_RESULT",
                    digest: "b".repeat(64),
                    producer: "polaris.probe/case-1",
                    authority: "TRUSTED_RUNTIME_FACT",
                    source_ref: "test:run-1#case-1",
                    lineage: ["test:run-1#case-1"],
                    measurement_kind: "MEASURED",
                    taint: [],
                    summary: "PASSED — the case ran",
                    created_at: NOW,
                  },
                ]
              : [],
          },
        };
      default:
        return null;
    }
  }

  const transport: Transport = {
    async send(envelope: unknown): Promise<unknown> {
      const request = envelope as Json;
      const operation = request["operation"];
      log.operations.push(String(operation));
      const payload = (request["payload"] ?? {}) as Json;
      const handled = handle(operation, payload);
      if (handled !== null) {
        // شكل ظرف الردّ مُغلق: حقل زائد يُسقط التحقق كما يُسقطه في المضيف الحقيقي.
        return {
          contract_version: "1.3",
          protocol_version: "1.3",
          message_type: "RESPONSE",
          message_id: "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a",
          request_id: request["message_id"],
          causation_id: request["message_id"],
          correlation_id: request["correlation_id"],
          session_id: SESSION,
          caller_identity: {
            caller_type: "CORE_UI",
            principal_id: PRINCIPAL,
            trust_tier: "TIER_2_UNTRUSTED",
            session_id: SESSION,
          },
          timestamp: NOW,
          ...handled,
        };
      }
      const fallback = await base.send(envelope);
      if (operation === "desktop.bootstrap") {
        const document = fallback as Json;
        const snapshot = document["result"] as Json | undefined;
        if (snapshot !== undefined) document["result"] = { ...snapshot, ipc_protocol_version: "1.3" };
        return document;
      }
      if (operation === "desktop.capability.availability") {
        // Phase-03 متاح في هذا البديل: المهام والوكلاء يتبعان المخزن.
        const document = fallback as Json;
        const result = document["result"] as Json | undefined;
        const capabilities = (result?.["capabilities"] ?? []) as Json[];
        for (const capability of capabilities) {
          const id = String(capability["capability_id"]);
          if (id === "polaris.desktop.missions" || id === "polaris.desktop.agents") {
            capability["availability"] = { state: "AVAILABLE" };
          }
        }
        return document;
      }
      return fallback;
    },
  };
  return { transport, log };
}

export const P03_IDS = { MISSION, TASK_BUILD, TASK_REVIEW, AGENT, CLAIM_ID, EVIDENCE_AGENT, EVIDENCE_MEASURED };
