// شروط البوابة النهائية لـPhase-04، وكل شرط مربوط بقياسه.
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

const CONTRACTS = "P04-CONTRACTS";
const SKILLS = "P04-SKILLS";
const TOOLS = "P04-TOOLS";
const GATEWAY = "P04-TOOL-GATEWAY";
const MCP = "P04-MCP";
const AGENT = "P04-AGENT-TOOLS";
const APPROVAL = "P04-APPROVAL";
const EVIDENCE = "P04-EVIDENCE";
const CANCEL = "P04-CANCELLATION";
const DELEGATE = "P04-DELEGATION";
const TRUST = "P04-TRUST";
const PERSIST = "P04-PERSISTENCE";
const UI = "P04-RENDERER-UI";
const BINDING = "P04-HOST-BINDING";

/**
 * المجموعات الحاملة للأمن. أي تخطّي غير مفسَّر فيها يُسقط الشرط P04-Q5، ولا
 * يُبتلع خلف حكم أخضر.
 */
export const SECURITY_GROUPS = Object.freeze([GATEWAY, MCP, APPROVAL, TRUST, EVIDENCE, CONTRACTS, BINDING, "P04-HOST-LINT"]);

export const P04_CLAIMS = Object.freeze([
  // ── المهارات ───────────────────────────────────────────────────────────────
  {
    id: "P04-K1",
    document: "phase-04-skills",
    condition: "a skill is a typed descriptor with a closed source, and it names its tools rather than carrying prose",
    requires: [...tp(SKILLS, "p04::skill::tests::"), ...t(GATEWAY, "the_builtin_skills_and_their_registered_tools_are_read_together"), ...e("P04-E2E-02")],
  },
  {
    id: "P04-K2",
    document: "phase-04-skills",
    condition: "a skill holds no authority: it cannot widen an effect, grant a capability or waive an approval",
    requires: [
      ...t(SKILLS, "p04::skill::tests::a_skill_names_its_tools_and_nothing_else"),
      ...t(CANCEL, "p04::broker::tests::a_skill_that_does_not_name_a_tool_cannot_reach_it"),
      ...t(GATEWAY, "only_the_enabled_flag_of_a_skill_can_be_changed_from_the_boundary"),
      ...t(UI, "P04-UI-011 the Skills screen offers only enable and disable, no tool or effect widening"),
      ...e("P04-E2E-13"),
    ],
  },
  {
    id: "P04-K3",
    document: "phase-04-skills",
    condition: "a disabled skill runs nothing, and a skill offers the model only tools that actually exist",
    requires: [...t(AGENT, "a_disabled_skill_runs_nothing", "a_skill_offers_the_model_only_the_tools_that_exist"), ...e("P04-E2E-08", "P04-E2E-13")],
  },

  // ── سجل الأدوات ────────────────────────────────────────────────────────────
  {
    id: "P04-T1",
    document: "phase-04-tools",
    condition: "the registry is closed: a tool exists only as a registered descriptor, and no free name can be executed",
    requires: [
      ...tp(TOOLS, "p04::tool::tests::"),
      ...t(GATEWAY, "there_is_no_operation_that_executes_a_tool"),
      ...c("P04-SEC-NO-EXECUTION-OPERATION"),
      ...e("P04-E2E-11", "P04-E2E-25"),
    ],
  },
  {
    id: "P04-T2",
    document: "phase-04-tools",
    condition: "every tool declares its effects, and its risk, approval and network policy are derived from them",
    requires: [
      ...tp(TOOLS, "p04::effect::tests::"),
      ...t(TOOLS, "p04::tool::tests::a_descriptor_cannot_lower_the_risk_its_effects_imply", "p04::tool::tests::a_descriptor_cannot_declare_a_write_and_escape_approval", "p04::tool::tests::a_tool_with_no_declared_effect_is_refused_rather_than_treated_as_harmless"),
      ...c("P04-SEC-DESCRIPTOR-IS-SEALED"),
      ...e("P04-E2E-03"),
    ],
  },
  {
    id: "P04-T3",
    document: "phase-04-tools",
    condition: "process execution and secret access have no capability in this build, so they are impossible rather than denied",
    requires: [
      ...t(TOOLS, "p04::effect::tests::process_execution_and_secret_access_have_no_capability_in_this_build", "p04::tool::tests::a_tool_that_wants_to_run_a_process_or_read_a_secret_cannot_be_registered"),
      ...c("P04-SEC-NO-PROCESS-OR-SECRET-CAPABILITY", "P04-SEC-NO-PROCESS-SPAWN"),
      ...e("P04-E2E-04"),
    ],
  },
  {
    id: "P04-T4",
    document: "phase-04-tools",
    condition: "a tool that can change something indirectly is not treated as read-only",
    requires: [
      ...t(TOOLS, "p04::effect::tests::a_read_is_not_a_mutation_and_a_write_is", "p04::effect::tests::a_mutating_effect_always_requires_approval_whatever_a_descriptor_says"),
      ...tp(TOOLS, "p04::builtin::tests::"),
      ...e("P04-E2E-14"),
    ],
  },

  // ── البوابة ────────────────────────────────────────────────────────────────
  {
    id: "P04-G1",
    document: "phase-04-tool-gateway",
    condition: "every side effect passes one path: request, schema, capability, budget, policy, approval, adapter, result, audit, evidence",
    requires: [...g(GATEWAY), ...tp(CANCEL, "p04::gateway::tests::"), ...e("P04-E2E-09")],
  },
  {
    id: "P04-G2",
    document: "phase-04-tool-gateway",
    condition: "an unknown tool, a disabled tool, invalid arguments and a missing capability are each refused before any effect",
    requires: [
      ...t(AGENT, "an_agent_can_neither_invent_a_tool_nor_reach_one_its_skill_does_not_name", "arguments_that_fail_the_tool_contract_are_refused_before_any_effect"),
      ...t(GATEWAY, "an_unknown_skill_tool_or_server_is_refused_rather_than_answered_empty"),
      ...e("P04-E2E-11", "P04-E2E-12"),
    ],
  },
  {
    id: "P04-G3",
    document: "phase-04-tool-gateway",
    condition: "the tool budget is checked before execution and stops further calls instead of overspending",
    requires: [
      ...tp(APPROVAL, "p04::budget::tests::"),
      ...t(AGENT, "the_tool_budget_is_reserved_before_spending_and_stops_the_rest", "a_zero_tool_budget_prevents_every_call"),
      ...c("P04-SEC-BUDGET-BEFORE-EFFECT"),
      ...e("P04-E2E-21"),
    ],
  },
  {
    id: "P04-G4",
    document: "phase-04-tool-gateway",
    condition: "a refusal is recorded exactly like a success, with its own reason, and is visible in the interface",
    requires: [
      ...tp(EVIDENCE, "p04::activity::tests::"),
      ...t(EVIDENCE, "p04::activity::tests::a_denied_attempt_is_recorded_exactly_like_a_successful_one"),
      ...t(UI, "P04-UI-040 the Activity screen shows the denied attempt with its reason", "P04-UI-041 a refused attempt is not shown as having had an effect"),
      ...e("P04-E2E-28"),
    ],
  },
  {
    id: "P04-G5",
    document: "phase-04-tool-gateway",
    condition: "a request naming another mission's resource is refused, and no invocation crosses a mission boundary",
    requires: [
      ...t(CANCEL, "p04::broker::tests::a_request_naming_another_mission_is_refused"),
      ...t(AGENT, "tool_evidence_cannot_reach_another_mission_or_another_task"),
      ...e("P04-E2E-25"),
    ],
  },

  // ── MCP ────────────────────────────────────────────────────────────────────
  {
    id: "P04-M1",
    document: "phase-04-mcp",
    condition: "a tool server is registered, enabled, disabled, discovered and invoked over a justified loopback transport only",
    requires: [
      ...t(GATEWAY, "a_tool_server_can_only_be_registered_on_the_loopback_interface"),
      ...t(MCP, "a_destination_outside_the_loopback_interface_is_never_registered"),
      ...c("P04-SEC-MCP-LOOPBACK-ONLY", "P04-SEC-NO-STDIO-TRANSPORT"),
      ...e("P04-E2E-06", "P04-E2E-07"),
    ],
  },
  {
    id: "P04-M2",
    document: "phase-04-mcp",
    condition: "every MCP tool enters the registry as an untrusted source, inside the grant the user gave that server",
    requires: [
      ...tp(TRUST, "p04::mcp::discovery::tests::"),
      ...t(GATEWAY, "a_grant_that_asks_for_an_ungranted_effect_is_narrowed_not_honoured"),
      ...c("P04-SEC-MCP-TOOLS-ARE-UNTRUSTED"),
      ...t(UI, "P04-UI-021 an MCP tool is shown untrusted, and what its server asked for is shown as a request"),
      ...e("P04-E2E-17"),
    ],
  },
  {
    id: "P04-M3",
    document: "phase-04-mcp",
    condition: "a server can add no tool without validation: a malicious description, an injected instruction or a widened scope is refused or kept as data",
    requires: [
      ...t(MCP, "discovery_accepts_what_passes_and_reports_every_refusal_with_its_reason", "a_hostile_tool_description_stays_data_and_grants_nothing"),
      ...t(TRUST, "p04::mcp::discovery::tests::a_malicious_description_survives_as_data_and_never_as_an_instruction", "p04::mcp::discovery::tests::a_tool_that_asks_for_a_secret_or_a_process_is_refused_whatever_the_server_was_granted", "p04::mcp::discovery::tests::a_tool_that_declares_an_effect_the_server_was_not_granted_is_refused"),
      ...t(UI, "P04-UI-022 a hostile tool description is displayed as text and changes nothing"),
      ...e("P04-E2E-07", "P04-E2E-18"),
    ],
  },
  {
    id: "P04-M4",
    document: "phase-04-mcp",
    condition: "a fake approval, a policy claim or a secret request from a server changes nothing",
    requires: [
      ...t(MCP, "a_result_claiming_an_approval_or_a_policy_change_alters_nothing"),
      ...t(TRUST, "p04::mcp::sanitize::tests::a_result_claiming_an_approval_is_counted_and_never_obeyed"),
      ...e("P04-E2E-18"),
    ],
  },
  {
    id: "P04-M5",
    document: "phase-04-mcp",
    condition: "a malformed, oversized, slow, disconnected or drifting answer each fails with its own reason instead of being read",
    requires: [
      ...t(MCP, "an_oversized_or_malformed_result_fails_with_its_own_reason", "a_server_that_never_answers_ends_in_a_timeout", "a_server_that_redefines_a_tool_after_discovery_is_reported_and_revalidated", "a_disabled_server_runs_none_of_its_tools_and_is_not_asked_for_more"),
      ...tp(TRUST, "p04::mcp::client::tests::"),
      ...e("P04-E2E-19", "P04-E2E-20"),
    ],
  },
  {
    id: "P04-M6",
    document: "phase-04-mcp",
    condition: "an untrusted schema is never fetched from: an external reference is refused before anything is compiled",
    requires: [
      ...tp(TRUST, "p04::mcp::sanitize::tests::"),
      ...t(TRUST, "p04::mcp::adapter::tests::a_schema_that_points_at_a_remote_reference_fails_closed_rather_than_fetching_it", "p04::mcp::sanitize::tests::a_schema_that_points_outside_itself_is_refused_before_anything_is_fetched"),
      ...c("P04-SEC-NO-EXTERNAL-SCHEMA-REFERENCE"),
    ],
  },
  {
    id: "P04-M7",
    document: "phase-04-mcp",
    condition: "duplicate names and schema drift are reported, and rediscovery replaces a server's tools rather than accumulating them",
    requires: [
      ...t(MCP, "rediscovery_replaces_a_servers_tools_rather_than_accumulating_them", "arguments_that_fail_the_servers_schema_never_reach_the_network"),
      ...t(SKILLS, "p04::skill::tests::binding_mcp_tools_is_deterministic_and_replaces_the_previous_binding"),
      ...t(TRUST, "p04::mcp::adapter::tests::arguments_are_measured_against_the_schema_stored_at_discovery"),
      ...e("P04-E2E-07"),
    ],
  },

  // ── مسار الوكيل الحقيقي ────────────────────────────────────────────────────
  {
    id: "P04-A1",
    document: "phase-04-agent-tools",
    condition: "a real agent inside a mission proposed a tool and it was executed through the whole path",
    requires: [
      ...t(AGENT, "an_agent_proposal_runs_through_the_gateway_and_its_result_verifies_a_claim"),
      ...tp(CANCEL, "p04::broker::tests::"),
      ...c("FIXTURE-RECEIVED-AGENT-CALLS", "FIXTURE-LABELLED-TEST-FIXTURE"),
      ...e("P04-E2E-09"),
    ],
  },
  {
    id: "P04-A2",
    document: "phase-04-agent-tools",
    condition: "the model only proposes: the proposal is a typed object, and the trusted runtime decides",
    requires: [
      ...tp(TOOLS, "p04::proposal::tests::"),
      ...t(TOOLS, "p04::proposal::tests::a_proposal_cannot_carry_its_own_identifier", "p04::proposal::tests::an_undeclared_field_in_a_proposal_is_refused_rather_than_ignored"),
      ...t(AGENT, "without_a_tool_layer_every_proposal_is_refused_explicitly"),
      ...e("P04-E2E-11"),
    ],
  },
  {
    id: "P04-A3",
    document: "phase-04-agent-tools",
    condition: "project context reaches the agent through assembly, keeps its provenance, and grants no tool authority",
    requires: [...c("P04-FIXTURE-HOSTILE-CONTEXT-CHANGED-NOTHING"), ...e("P04-E2E-22")],
  },
  {
    id: "P04-A4",
    document: "phase-04-agent-tools",
    condition: "the model cannot register a tool, name a server, or raise its own budget at run time",
    requires: [
      ...t(GATEWAY, "no_operation_can_submit_evidence_or_a_tool_result"),
      ...t(TOOLS, "p04::tool::tests::a_tool_that_wants_to_run_a_process_or_read_a_secret_cannot_be_registered"),
      ...c("P04-SEC-TOOL-OUTPUT-IS-NOT-AN-INSTRUCTION"),
      ...e("P04-E2E-18", "P04-E2E-25"),
    ],
  },

  // ── الموافقة ───────────────────────────────────────────────────────────────
  {
    id: "P04-P1",
    document: "phase-04-approval",
    condition: "a tool that changes state waits for a human decision and changes nothing while it waits",
    requires: [
      ...t(AGENT, "a_tool_that_changes_state_waits_for_a_human_decision_and_writes_nothing"),
      ...t(CANCEL, "p04::broker::tests::a_tool_that_changes_state_waits_for_a_human_decision"),
      ...t(UI, "P04-UI-050 a pending approval is shown with its binding and offers grant and deny"),
      ...e("P04-E2E-14"),
    ],
  },
  {
    id: "P04-P2",
    document: "phase-04-approval",
    condition: "an approval is bound to mission, task, tool, an arguments digest, an effect set and an expiry",
    requires: [
      ...tp(APPROVAL, "p04::approval::tests::"),
      ...c("P04-SEC-APPROVAL-IS-BOUND"),
      ...tp(CONTRACTS, "P04-CT-014"),
      ...e("P04-E2E-16"),
    ],
  },
  {
    id: "P04-P3",
    document: "phase-04-approval",
    condition: "an approval runs exactly one call and cannot be replayed, moved or answered twice",
    requires: [
      ...t(AGENT, "a_granted_approval_runs_exactly_one_call_and_cannot_be_replayed", "a_denied_approval_never_runs_the_tool"),
      ...t(APPROVAL, "p04::approval::tests::a_granted_approval_is_consumed_once_and_never_again", "p04::approval::tests::an_approval_cannot_be_moved_to_another_tool_or_other_arguments", "p04::approval::tests::an_approval_cannot_be_moved_to_another_mission_or_a_wider_effect", "p04::approval::tests::an_expired_approval_is_not_a_valid_one"),
      ...t(UI, "P04-UI-051 answering an approval sends only the identifier and the decision", "P04-UI-052 an already-consumed approval offers no decision button"),
      ...e("P04-E2E-15", "P04-E2E-16"),
    ],
  },
  {
    id: "P04-P4",
    document: "phase-04-approval",
    condition: "no agent and no server can approve on the user's behalf, and a restart does not leave a live decision behind",
    requires: [
      ...t(MCP, "a_result_claiming_an_approval_or_a_policy_change_alters_nothing"),
      ...t(PERSIST, "p04::repository::tests::a_restart_ends_every_approval_that_was_waiting_or_granted"),
      ...e("P04-E2E-18", "P04-E2E-29"),
    ],
  },

  // ── الدليل ─────────────────────────────────────────────────────────────────
  {
    id: "P04-E1",
    document: "phase-04-evidence",
    condition: "a tool result is recorded as its own measured evidence type, with the tool, the invocation and both digests",
    requires: [
      ...tp(EVIDENCE, "p04::evidence::tests::"),
      ...t(EVIDENCE, "p04::evidence::tests::a_recorded_tool_result_is_measured_evidence_of_its_own_type"),
      ...e("P04-E2E-09", "P04-E2E-17"),
    ],
  },
  {
    id: "P04-E2",
    document: "phase-04-evidence",
    condition: "a tool result is not automatically verified: it satisfies a fact rule and never a rule that requires a test artefact",
    requires: [
      ...t(EVIDENCE, "p04::evidence::tests::a_tool_result_does_not_satisfy_a_rule_that_requires_a_test_artefact", "p04::evidence::tests::a_failing_measurement_counters_instead_of_supporting"),
      ...t(AGENT, "an_agent_proposal_runs_through_the_gateway_and_its_result_verifies_a_claim"),
      ...e("P04-E2E-10"),
    ],
  },
  {
    id: "P04-E3",
    document: "phase-04-evidence",
    condition: "agent prose never becomes tool evidence, and evidence measured for one mission or task cannot reach another",
    requires: [
      ...t(EVIDENCE, "p04::evidence::tests::evidence_measured_for_one_task_or_mission_cannot_reach_another"),
      ...t(AGENT, "tool_evidence_cannot_reach_another_mission_or_another_task"),
      ...t(GATEWAY, "no_operation_can_submit_evidence_or_a_tool_result"),
      ...e("P04-E2E-10"),
    ],
  },
  {
    id: "P04-E4",
    document: "phase-04-evidence",
    condition: "an invocation view carries digests and never a raw argument body or a secret-shaped field",
    requires: [
      ...t(EVIDENCE, "p04::view::tests::an_invocation_view_carries_digests_and_never_a_raw_body"),
      ...t(GATEWAY, "no_phase04_result_carries_a_secret_shaped_field"),
      ...t(UI, "P04-UI-042 arguments are shown by digest, never as text"),
      ...c("P04-EVIDENCE-NO-RAW-ARGUMENTS"),
    ],
  },

  // ── الإلغاء ────────────────────────────────────────────────────────────────
  {
    id: "P04-C1",
    document: "phase-04-cancellation",
    condition: "cancelling a mission stops the active model call, the active tool call and any further scheduling",
    requires: [
      ...t(TOOLS, "p04::builtin::tests::a_cancelled_mission_stops_a_tool_before_it_does_anything"),
      ...t(CANCEL, "p04::broker::tests::a_cancelled_mission_denies_the_next_tool_before_it_runs"),
      ...t(AGENT, "a_cancelled_mission_runs_no_further_tool"),
      ...e("P04-E2E-24"),
    ],
  },
  {
    id: "P04-C2",
    document: "phase-04-cancellation",
    condition: "a cancelled call opens no connection, is not recorded as a tool failure, and leaves no orphan operation",
    requires: [
      ...t(TRUST, "p04::mcp::client::tests::a_cancelled_call_does_not_open_a_connection"),
      ...t(CANCEL, "p04::gateway::tests::a_cancelled_tool_is_not_recorded_as_a_failure_of_the_tool"),
      ...c("NATIVE-NOTHING-IN-FLIGHT-AFTER-CANCEL"),
      ...e("P04-E2E-24"),
    ],
  },
  {
    id: "P04-C3",
    document: "phase-04-cancellation",
    condition: "a timed-out tool counts as executed because its effect may already have happened",
    requires: [...t(CANCEL, "p04::gateway::tests::a_timed_out_tool_counts_as_executed_because_its_effect_may_have_happened"), ...e("P04-E2E-19")],
  },

  // ── التفويض ────────────────────────────────────────────────────────────────
  {
    id: "P04-D1",
    document: "phase-04-delegation",
    condition: "delegation is a real measured mission path: agent A requests, the coordinator creates agent B, and the result comes back",
    requires: [
      ...t(AGENT, "delegation_creates_a_second_agent_and_carries_the_result_back"),
      ...tp(DELEGATE, "p03::delegation::tests::", "p03::message::tests::"),
      ...e("P04-E2E-23"),
    ],
  },
  {
    id: "P04-D2",
    document: "phase-04-delegation",
    condition: "delegation is bounded: above the depth limit no agent is created, and no message crosses a mission",
    requires: [...t(AGENT, "a_delegation_above_the_depth_limit_creates_no_agent"), ...e("P04-E2E-23")],
  },

  // ── النافذة الأصلية ────────────────────────────────────────────────────────
  {
    id: "P04-N1",
    document: "phase-04-native-e2e",
    condition: "the whole Phase-04 path was measured inside the real Windows window against a labelled TEST FIXTURE",
    requires: [...c("NATIVE-PERFORMED", "FIXTURE-LABELLED-TEST-FIXTURE", "NATIVE-SCENARIOS-COMPLETE")],
  },
  {
    id: "P04-N2",
    document: "phase-04-native-e2e",
    condition: "the window rendered the Phase-04 screens in Arabic right to left and in English left to right",
    requires: [...e("P04-E2E-26", "P04-E2E-27")],
  },
  {
    id: "P04-N3",
    document: "phase-04-native-e2e",
    condition: "servers, tools, activity and approvals survive a real restart with honest state and no repeated effect",
    requires: [...e("P04-E2E-29", "P04-E2E-29a"), ...c("RESTART-LAUNCH-CLEAN"), ...tp(PERSIST, "p04::repository::tests::")],
  },
  {
    id: "P04-N4",
    document: "phase-04-native-e2e",
    condition: "the application exits cleanly with exit code zero and no process it started survives",
    requires: [...e("P04-E2E-30")],
  },
  {
    id: "P04-N5",
    document: "phase-04-native-e2e",
    condition: "no credential reached the local tool server and no key shape reached the window",
    requires: [...c("FIXTURE-NO-AUTHORIZATION-HEADER", "MCP-FIXTURE-NO-AUTHORIZATION-HEADER", "E2E-REPORT-NO-SECRET")],
  },

  // ── الأمن ──────────────────────────────────────────────────────────────────
  {
    id: "P04-S1",
    document: "phase-04-security",
    condition: "no generic execution path exists in any layer: not the renderer, not IPC, not the agent",
    requires: [...c("P04-SEC-NO-EXECUTION-OPERATION", "P04-SEC-RENDERER-CANNOT-EXECUTE"), ...e("P04-E2E-25")],
  },
  {
    id: "P04-S2",
    document: "phase-04-security",
    condition: "no shell passthrough, no filesystem passthrough and no unrestricted network exist in this build",
    requires: [...c("P04-SEC-NO-PROCESS-SPAWN", "P04-SEC-NO-PROCESS-OR-SECRET-CAPABILITY", "P04-SEC-MCP-LOOPBACK-ONLY", "P04-SEC-NO-STDIO-TRANSPORT")],
  },
  {
    id: "P04-S3",
    document: "phase-04-security",
    condition: "no secret is carried in an agent or tool payload, and no endpoint is named on the gateway path",
    requires: [...c("P04-SEC-NO-SECRET-IN-GATEWAY-PATH", "P04-SEC-NO-ENDPOINT-IN-GATEWAY-PATH", "P04-SEC-NO-SECRET-IN-SOURCE")],
  },
  {
    id: "P04-S4",
    document: "phase-04-security",
    condition: "no canonical Phase-04 document carries a key shape, a reasoning trace or raw tool arguments",
    requires: [...c("P04-EVIDENCE-NO-SECRET", "P04-EVIDENCE-NO-REASONING-FIELD", "P04-EVIDENCE-NO-RAW-ARGUMENTS")],
  },
  {
    id: "P04-S5",
    document: "phase-04-security",
    condition: "the measurement surface is feature-gated and read-only, so it cannot be a bypass",
    requires: [...c("P04-SEC-MEASUREMENT-COMMAND-IS-FEATURE-GATED", "P04-SEC-MEASUREMENT-IS-READ-ONLY")],
  },
  {
    id: "P04-S6",
    document: "phase-04-security",
    condition: "every boundary error code is one the contract declares, and a refusal leaks no internal detail",
    requires: [
      ...c("P04-SEC-CANONICAL-ERROR-CODES"),
      ...t(GATEWAY, "a_refusal_uses_the_closed_error_vocabulary_and_leaks_no_internal_detail", "every_declared_error_category_has_a_mapping_entry"),
    ],
  },

  // ── الانحدار ───────────────────────────────────────────────────────────────
  {
    id: "P04-R1",
    document: "phase-04-regression",
    condition: "the Phase-00 gate was re-run inside this run and is still PASS",
    requires: [{ type: "gate", phase: "PHASE-00" }],
  },
  {
    id: "P04-R2",
    document: "phase-04-regression",
    condition: "the Phase-01 gate was re-run inside this run, is still PASS, and still opens Phase-02",
    requires: [{ type: "gate", phase: "PHASE-01" }],
  },
  {
    id: "P04-R3",
    document: "phase-04-regression",
    condition: "the Phase-02 gate was re-run inside this run, is still PASS, and still opens Phase-03",
    requires: [{ type: "gate", phase: "PHASE-02" }],
  },
  {
    id: "P04-R4",
    document: "phase-04-regression",
    condition: "the Phase-03 gate was re-run inside this run, is still PASS, and still opens Phase-04",
    requires: [{ type: "gate", phase: "PHASE-03" }],
  },

  // ── شروط تعيش في البوابة نفسها ────────────────────────────────────────────
  {
    id: "P04-Q1",
    document: "phase-04-final-gate",
    condition: "the contract layer carries the Phase-04 vocabulary additively, with no new major version and no execution operation",
    requires: [...g(CONTRACTS), ...tp(CONTRACTS, "P04-CT-012")],
  },
  {
    id: "P04-Q2",
    document: "phase-04-run",
    condition: "the whole host workspace and the whole renderer pass their own suites and their lint",
    requires: [...g("P04-HOST-CORE", "P04-HOST-BINDING", "P04-HOST-LINT", "P04-RENDERER", "P04-RENDERER-UI")],
  },
  {
    id: "P04-Q3",
    document: "phase-04-run",
    condition: "the Phase-04 instruments are themselves tested, so the measurement is not trusted on faith",
    requires: [...g("P04-TOOLING")],
  },
  {
    id: "P04-Q4",
    document: "phase-04-final-gate",
    condition: "every canonical Phase-04 document is UTF-8 with no BOM, LF only, valid JSON and exactly one final newline",
    requires: [{ type: "bytes" }],
  },
  {
    id: "P04-Q5",
    document: "phase-04-final-gate",
    condition: "no security-bearing group hid a skip, and both security scans actually ran",
    requires: [{ type: "no-skip" }],
  },
  {
    id: "P04-Q6",
    document: "phase-04-performance",
    condition: "performance numbers are locally measured and say whether they include provider inference time",
    requires: [...c("PERFORMANCE-MEASURED", "PERFORMANCE-EXCLUDES-PROVIDER-TIME")],
  },
]);
