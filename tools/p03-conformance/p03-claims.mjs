// شروط البوابة النهائية لـPhase-03، وكل شرط مربوط بقياسه.
//
// أنواع الربط:
//   test   : اسم اختبار (أو بادئة تنتهي بـ::) في مجموعة؛ غيابه NOT_TESTED، وفشله FAIL.
//   e2e    : سيناريو من مجموعة النافذة الأصلية.
//   check  : فحص ساكن، أو حقيقة من سجل التجهيزة، أو من الإطلاق الأصلي.
//   gate   : حكم وثيقة مرحلة سابقة بعد إعادة تشغيلها في هذا التشغيل.
//   group  : حكم مجموعة اختبار كاملة.
// لا يُكتب PASS بيد في أي مكان: كل شرط يأخذ أسوأ أحكام قياساته.

const t = (group, ...names) => names.map((name) => ({ type: "test", group, name }));
/** مطابقة ببادئة: كل اختبار يبدأ بهذا الاسم. تُستعمل لوحدة كاملة. */
const tp = (group, ...prefixes) => prefixes.map((name) => ({ type: "test", group, name, prefix: true }));
const e = (...ids) => ids.map((id) => ({ type: "e2e", id }));
const c = (...ids) => ids.map((id) => ({ type: "check", id }));
const g = (...ids) => ids.map((id) => ({ type: "group", id }));

const AGENTS = "P03-AGENTS";
const MISSIONS = "P03-MISSIONS";
const GRAPH = "P03-TASK-GRAPH";
const ORCH = "P03-ORCHESTRATION";
const BUDGETS = "P03-BUDGETS";
const TRUST = "P03-TRUST";
const TRUTH = "P03-TRUTH";
const EVIDENCE = "P03-EVIDENCE";
const VERIFY = "P03-VERIFICATION";
const PERSIST = "P03-PERSISTENCE";
const CONTRACTS = "P03-CONTRACTS";
const UI = "P03-RENDERER-UI";
const BINDING = "P03-HOST-BINDING";

/**
 * المجموعات الحاملة للأمن. أي تخطّي غير مفسَّر فيها يُسقط الشرط P03-Q5، ولا
 * يُبتلع خلف حكم أخضر.
 */
export const SECURITY_GROUPS = Object.freeze([TRUST, TRUTH, EVIDENCE, VERIFY, CONTRACTS, BINDING, "P03-HOST-LINT"]);

export const P03_CLAIMS = Object.freeze([
  // ── الوكلاء ────────────────────────────────────────────────────────────────
  {
    id: "P03-A1",
    document: "phase-03-agents",
    condition: "the nine agent roles are fixed, described by the host, and no role grants authority of its own",
    requires: [...tp(AGENTS, "p03::agent::tests::"), ...t(UI, "P03-UI-005 agent evidence is shown as inferred and powerless, measured evidence as measured"), ...e("P03-E2E-03")],
  },
  {
    id: "P03-A2",
    document: "phase-03-agents",
    condition: "an agent instance is bound to one mission and its work never crosses into another",
    requires: [...tp(TRUST, "p03::message::tests::"), ...t(VERIFY, "te_07_evidence_from_one_mission_cannot_verify_another"), ...e("P03-E2E-09", "P03-E2E-10", "P03-E2E-18")],
  },
  {
    id: "P03-A3",
    document: "phase-03-agents",
    condition: "an agent cannot approve its own work nor raise its own authority",
    requires: [
      ...tp(TRUST, "p03::trust::tests::"),
      ...t(VERIFY, "te_01_a_model_saying_tests_passed_is_agent_output_and_cannot_satisfy_requires_tests"),
      ...t(ORCH, "an_agent_cannot_verify_its_own_claim_by_naming_its_evidence_a_measurement"),
      ...e("P03-E2E-13"),
    ],
  },

  // ── المهامّ ────────────────────────────────────────────────────────────────
  {
    id: "P03-M1",
    document: "phase-03-missions",
    condition: "a mission is created from the interface, persisted, and starts with no completion proof",
    requires: [...tp(MISSIONS, "p03::mission::tests::"), ...t(PERSIST, "a_mission_can_be_created_and_read_back_through_the_gateway"), ...e("P03-E2E-02", "P03-E2E-04")],
  },
  {
    id: "P03-M2",
    document: "phase-03-missions",
    condition: "the mission state machine is closed and an illegal transition is refused rather than silently taken",
    requires: [...tp(MISSIONS, "p03::mission::tests::"), ...tp(CONTRACTS, "P03-CT-0"), ...e("P03-E2E-25")],
  },
  {
    id: "P03-M3",
    document: "phase-03-missions",
    condition: "a mission starts only through a routed model; with none routed the start is refused, not faked",
    requires: [...t(PERSIST, "starting_a_mission_without_a_routed_model_fails_honestly"), ...e("P03-E2E-05", "P03-E2E-06")],
  },
  {
    id: "P03-M4",
    document: "phase-03-missions",
    condition: "cancellation is terminal, schedules nothing further, leaves no running model request, and never becomes proven",
    requires: [...t(ORCH, "a_cancelled_mission_stops_scheduling"), ...e("P03-E2E-25")],
  },
  {
    id: "P03-M5",
    document: "phase-03-missions",
    condition: "missions, tasks, claims and evidence survive a real restart with honest state and no repeated side effect",
    requires: [
      ...t(PERSIST, "a_mission_survives_a_save_and_load_round_trip", "a_crash_never_invents_success", "claim_status_and_evidence_lineage_survive_the_round_trip"),
      ...e("P03-E2E-27", "P03-E2E-27a", "P03-E2E-27b"),
      ...c("RESTART-LAUNCH-CLEAN"),
    ],
  },

  // ── التنسيق ────────────────────────────────────────────────────────────────
  {
    id: "P03-O1",
    document: "phase-03-orchestration",
    condition: "the planner's structured output is validated against a closed contract, and prose is refused",
    requires: [...tp(TRUST, "p03::model_adapter::tests::"), ...t(ORCH, "a_malformed_plan_fails_closed"), ...e("P03-E2E-07")],
  },
  {
    id: "P03-O2",
    document: "phase-03-orchestration",
    condition: "the task graph is acyclic and bounded, and its ready set is deterministic",
    requires: [...tp(GRAPH, "p03::graph::tests::", "p03::task::tests::"), ...t(ORCH, "the_same_mission_runs_identically_twice"), ...e("P03-E2E-08")],
  },
  {
    id: "P03-O3",
    document: "phase-03-orchestration",
    condition: "two ready tasks are assigned to distinct agents in dependency order",
    requires: [...t(ORCH, "dogfood_multi_agent_runs_distinct_roles_in_dependency_order"), ...e("P03-E2E-09")],
  },
  {
    id: "P03-O4",
    document: "phase-03-orchestration",
    condition: "review returns a structured verdict; a revision reopens the producing task and is then accepted",
    requires: [...t(ORCH, "a_review_cycle_revises_once_then_accepts"), ...e("P03-E2E-11", "P03-E2E-12")],
  },
  {
    id: "P03-O5",
    document: "phase-03-orchestration",
    condition: "budgets are enforced in every dimension and stop the work rather than overspend",
    requires: [...tp(BUDGETS, "p03::budget::tests::"), ...t(ORCH, "an_exhausted_model_call_budget_halts_before_unauthorised_work"), ...e("P03-E2E-22")],
  },
  {
    id: "P03-O6",
    document: "phase-03-orchestration",
    condition: "a run that makes no progress terminates by a bound rather than spinning",
    requires: [...tp(BUDGETS, "p03::loopguard::tests::"), ...e("P03-E2E-23")],
  },

  // ── الثقة والتلوّث ─────────────────────────────────────────────────────────
  {
    id: "P03-T1",
    document: "phase-03-trust",
    condition: "prompt parts carry their authority class and untrusted content is fenced as data, never merged into one anonymous string",
    requires: [...tp(TRUST, "p03::prompt::tests::"), ...c("P03-FIXTURE-PROMPT-BOUNDARY")],
  },
  {
    id: "P03-T2",
    document: "phase-03-trust",
    condition: "model output is tainted, carries no authority, and never becomes a command however it is phrased",
    requires: [...tp(TRUST, "p03::trust::tests::", "p03::model_adapter::tests::"), ...t(ORCH, "dogfood_adversarial_output_changes_no_policy_and_proves_nothing"), ...e("P03-E2E-24")],
  },
  {
    id: "P03-T3",
    document: "phase-03-trust",
    condition: "an agent message stays inside its mission, names a known recipient, and cannot escalate its authority",
    requires: [...tp(TRUST, "p03::message::tests::"), ...t(BINDING, "p03_native::tests::the_message_bus_component_keeps_a_message_inside_its_mission"), ...e("P03-E2E-10")],
  },
  {
    id: "P03-T4",
    document: "phase-03-trust",
    condition: "delegation is bounded by an explicit depth limit and refuses a literal repeat",
    requires: [...tp(BUDGETS, "p03::delegation::tests::"), ...t(BINDING, "p03_native::tests::the_delegation_component_refuses_the_depth_above_the_limit"), ...e("P03-E2E-21")],
  },
  {
    id: "P03-T5",
    document: "phase-03-trust",
    condition: "hostile project content changes no model, no provider, no policy and no approval, and proves nothing",
    requires: [...t(ORCH, "dogfood_adversarial_output_changes_no_policy_and_proves_nothing"), ...e("P03-E2E-24"), ...c("P03-FIXTURE-NO-POLICY-DRIFT")],
  },

  // ── الحقيقة والأدلّة ───────────────────────────────────────────────────────
  {
    id: "P03-R1",
    document: "phase-03-truth",
    condition: "a claim carries its own status, and agreement between agents never verifies anything on its own",
    requires: [...tp(TRUTH, "p03::claim::tests::", "p03::verification::tests::"), ...e("P03-E2E-20")],
  },
  {
    id: "P03-R2",
    document: "phase-03-truth",
    condition: "two structured claims that contradict each other become CONFLICTED rather than one being chosen",
    requires: [...tp(TRUTH, "p03::conflict::tests::"), ...e("P03-E2E-19")],
  },
  {
    id: "P03-R3",
    document: "phase-03-truth",
    condition: "COMPLETED and PROVEN stay separate in the store and on the screen",
    requires: [...tp(TRUTH, "p03::completion::tests::"), ...t(UI, "P03-UI-003 a completed mission never shows its state without its proof"), ...t(ORCH, "dogfood_false_completion_stays_not_proven"), ...e("P03-E2E-26")],
  },
  {
    id: "P03-R4",
    document: "phase-03-truth",
    condition: "model-generated evidence is recorded as AGENT_OUTPUT and Inferred, and satisfies no rule that requires measurement",
    requires: [
      ...tp(EVIDENCE, "p03::evidence::tests::"),
      ...t(VERIFY, "te_01_a_model_saying_tests_passed_is_agent_output_and_cannot_satisfy_requires_tests", "te_02_a_model_declaring_an_evidence_type_field_is_rejected_by_the_output_contract"),
      ...e("P03-E2E-13"),
    ],
  },
  {
    id: "P03-R5",
    document: "phase-03-truth",
    condition: "a trusted native probe produces TEST_RESULT evidence that is Measured, and that evidence verifies the linked claim",
    requires: [
      ...tp(EVIDENCE, "p03::trusted_test_evidence::tests::", "p03::probe_runner::tests::"),
      ...t(VERIFY, "te_04_a_real_probe_result_becomes_measured_test_evidence_and_verifies", "te_05_the_producers_digest_and_source_identity_are_preserved"),
      ...t(ORCH, "a_trusted_measurement_is_what_makes_the_same_claim_verifiable"),
      ...e("P03-E2E-14", "P03-E2E-15"),
    ],
  },
  {
    id: "P03-R6",
    document: "phase-03-truth",
    condition: "a measured failing result counters the positive claim instead of satisfying it",
    requires: [...t(VERIFY, "te_10_a_failing_test_result_cannot_satisfy_a_positive_rule"), ...e("P03-E2E-16")],
  },
  {
    id: "P03-R7",
    document: "phase-03-truth",
    condition: "one derivation lineage is one source: the same lineage is never counted twice",
    requires: [...t(VERIFY, "te_09_duplicate_evidence_lineage_is_not_counted_twice"), ...t(PERSIST, "claim_status_and_evidence_lineage_survive_the_round_trip"), ...e("P03-E2E-17")],
  },
  {
    id: "P03-R8",
    document: "phase-03-truth",
    condition: "evidence measured for one mission or one task cannot verify another",
    requires: [
      ...t(VERIFY, "te_06_evidence_measured_for_another_task_cannot_verify_this_one", "te_07_evidence_from_one_mission_cannot_verify_another"),
      ...e("P03-E2E-18"),
    ],
  },

  // ── الـE2E الأصلي ─────────────────────────────────────────────────────────
  {
    id: "P03-E1",
    document: "phase-03-native-e2e",
    condition: "the native suite ran on Windows against the built product binaries with a loopback TEST FIXTURE provider",
    requires: [...c("NATIVE-PERFORMED", "FIXTURE-LABELLED-TEST-FIXTURE"), ...e("P03-E2E-01")],
  },
  {
    id: "P03-E2",
    document: "phase-03-native-e2e",
    condition: "mission.start traverses Phase-03, the production adapter, Phase-02 invocation and routing, the locality policy and the provider adapter, and reaches the fixture over loopback",
    requires: [...e("P03-E2E-05", "P03-E2E-06"), ...c("FIXTURE-RECEIVED-AGENT-CALLS", "FIXTURE-NO-AUTHORIZATION-HEADER")],
  },
  {
    id: "P03-E3",
    document: "phase-03-native-e2e",
    condition: "every required native scenario was measured, and none is missing from the report",
    requires: [...c("NATIVE-SCENARIOS-COMPLETE")],
  },
  {
    id: "P03-E4",
    document: "phase-03-native-e2e",
    condition: "both launches exited on the window close with code zero and no process the run started survived",
    requires: [...e("P03-E2E-30")],
  },
  {
    id: "P03-E5",
    document: "phase-03-native-e2e",
    condition: "the Phase-03 screens render right to left in Arabic and left to right in English in the real window",
    requires: [...e("P03-E2E-28", "P03-E2E-29"), ...tp(UI, "P03-UI-0")],
  },

  // ── الأمن ──────────────────────────────────────────────────────────────────
  {
    id: "P03-S1",
    document: "phase-03-security",
    condition: "model output cannot manufacture trusted evidence: no output contract accepts an evidence type, and the runtime overrides any claimed one",
    requires: [
      ...t(VERIFY, "te_02_a_model_declaring_an_evidence_type_field_is_rejected_by_the_output_contract", "te_11_the_probe_vocabulary_can_only_produce_measured_evidence_types"),
      ...c("P03-SEC-NO-MODEL-EVIDENCE-TYPE"),
      ...e("P03-E2E-13"),
    ],
  },
  {
    id: "P03-S2",
    document: "phase-03-security",
    condition: "the renderer cannot manufacture measured evidence: no IPC operation accepts evidence, and the product binary carries no measurement command",
    requires: [
      ...t(VERIFY, "te_03_the_renderer_has_no_operation_that_can_submit_evidence"),
      ...t(PERSIST, "there_is_no_generic_agent_dispatch_operation"),
      ...c("P03-SEC-NO-EVIDENCE-OPERATION", "P03-SEC-MEASUREMENT-COMMAND-IS-FEATURE-GATED"),
    ],
  },
  {
    id: "P03-S3",
    document: "phase-03-security",
    condition: "an agent cannot bypass Phase-02 routing, name an arbitrary endpoint, or reach a provider directly",
    requires: [...c("P03-SEC-AGENT-USES-INVOCATION-SERVICE", "P03-SEC-NO-ENDPOINT-IN-AGENT-PATH"), ...e("P03-E2E-06")],
  },
  {
    id: "P03-S4",
    document: "phase-03-security",
    condition: "agents never see a provider secret, and no credential appears in evidence, audit detail or the Phase-03 result surface",
    requires: [
      ...t(PERSIST, "no_phase03_result_carries_a_secret_shaped_field"),
      ...c("P03-SEC-NO-SECRET-IN-AGENT-PATH", "P03-EVIDENCE-NO-SECRET", "FIXTURE-NO-AUTHORIZATION-HEADER"),
    ],
  },
  {
    id: "P03-S5",
    document: "phase-03-security",
    condition: "there is no generic agent command path: every Phase-03 operation is named, routed and owned",
    requires: [...t(PERSIST, "there_is_no_generic_agent_dispatch_operation", "every_phase03_operation_is_routed_and_answers_its_contract"), ...c("P03-SEC-NO-GENERIC-DISPATCH")],
  },
  {
    id: "P03-S6",
    document: "phase-03-security",
    condition: "no hidden reasoning trace is requested from the model, recorded in evidence, or persisted anywhere",
    requires: [...c("P03-SEC-NO-REASONING-TRACE", "FIXTURE-ASKED-FOR-NO-REASONING-TRACE", "P03-EVIDENCE-NO-REASONING-FIELD")],
  },

  // ── الأداء ─────────────────────────────────────────────────────────────────
  {
    id: "P03-F1",
    document: "phase-03-performance",
    condition: "every Phase-03 timing is locally measured with its method recorded, and provider inference time is excluded from orchestration overhead",
    requires: [...c("PERFORMANCE-MEASURED", "PERFORMANCE-EXCLUDES-PROVIDER-TIME")],
  },

  // ── الانحدار والبوابة ──────────────────────────────────────────────────────
  {
    id: "P03-Q1",
    document: "phase-03-regression",
    condition: "the Phase-00 final gate was re-run in this run and is PASS",
    requires: [{ type: "gate", phase: "PHASE-00" }],
  },
  {
    id: "P03-Q2",
    document: "phase-03-regression",
    condition: "the Phase-01 final gate was re-run in this run and is PASS",
    requires: [{ type: "gate", phase: "PHASE-01" }],
  },
  {
    id: "P03-Q3",
    document: "phase-03-regression",
    condition: "the Phase-02 final gate was re-run in this run, is PASS, and opens Phase-03",
    requires: [{ type: "gate", phase: "PHASE-02" }],
  },
  {
    id: "P03-Q4",
    document: "phase-03-final-gate",
    condition: "every canonical Phase-03 document is UTF-8 without a BOM, LF only, one final newline, and valid JSON",
    requires: [{ type: "bytes" }],
  },
  {
    id: "P03-Q5",
    document: "phase-03-final-gate",
    condition: "no mandatory security-bearing group hides an unexplained skip, and both security scans ran",
    requires: [{ type: "no-skip" }],
  },
  {
    id: "P03-Z1",
    document: "phase-03-run",
    condition: "the canonical run built both binaries on Windows and performed the native stage",
    requires: [...c("NATIVE-PERFORMED")],
  },
  {
    id: "P03-Z2",
    document: "phase-03-run",
    condition: "every measured conformance group is PASS",
    requires: [
      ...g(
        "P03-CONTRACTS",
        "P03-RUNTIME",
        AGENTS,
        MISSIONS,
        GRAPH,
        ORCH,
        BUDGETS,
        TRUST,
        TRUTH,
        EVIDENCE,
        VERIFY,
        PERSIST,
        "P03-HOST-CORE",
        BINDING,
        "P03-HOST-LINT",
        "P03-RENDERER",
        UI,
        "P03-TOOLS",
      ),
    ],
  },
]);
