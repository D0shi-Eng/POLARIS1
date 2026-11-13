// شروط البوابة النهائية لـPhase-06، وكل شرط مربوط بقياسه.
//
// أنواع الربط (كما في Phase-05):
//   test   : اسم اختبار (أو بادئة) في مجموعة؛ غيابه NOT_TESTED، وفشله FAIL.
//   e2e    : سيناريو من مجموعة النافذة الأصلية، أو ممّا يقيسه المشغّل من خارجها.
//   check  : فحص ساكن، أو حقيقة من سجلّ التجهيزتين أو فحص الكناري أو الإطلاق.
//   gate   : حكم وثيقة مرحلة سابقة بعد إعادة تشغيلها في هذا التشغيل.
//   group  : حكم مجموعة اختبار كاملة.
// لا يُكتب PASS بيد في أي مكان: كل شرط يأخذ أسوأ أحكام قياساته.

const t = (group, ...names) => names.map((name) => ({ type: "test", group, name }));
const tp = (group, ...prefixes) => prefixes.map((name) => ({ type: "test", group, name, prefix: true }));
const e = (...ids) => ids.map((id) => ({ type: "e2e", id }));
const c = (...ids) => ids.map((id) => ({ type: "check", id }));
const g = (...ids) => ids.map((id) => ({ type: "group", id }));

const CONTRACTS = "P06-CONTRACTS";
const CONN = "P06-CONNECTORS";
const CSEC = "P06-CONNECTOR-SECURITY";
const AUTH = "P06-CONNECTOR-AUTH";
const GW = "P06-CONNECTOR-GATEWAY";
const COST = "P06-COST";
const BUDGETS = "P06-BUDGETS";
const OBS = "P06-OBSERVABILITY";
const HEALTH = "P06-HEALTH";
const SETTINGS = "P06-SETTINGS";
const EFFECTIVE = "P06-EFFECTIVE-CONFIG";
const PRIVACY = "P06-PRIVACY";
const AGENT = "P06-AGENT-INTEGRATION";
const PERSIST = "P06-PERSISTENCE";
const SECURITY = "P06-SECURITY";
const UI = "P06-RENDERER";

/** المجموعات الحاملة للأمن. تخطٍّ غير مفسَّر فيها يُسقط P06-Q5. */
export const SECURITY_GROUPS = Object.freeze([CSEC, AUTH, GW, PRIVACY, SECURITY, EFFECTIVE, CONTRACTS, "P06-HOST-BINDING", "P06-HOST-LINT"]);

const cn = (name) => `p06::connector::${name}`;
const co = (name) => `p06::cost::${name}`;
const ob = (name) => `p06::observe::${name}`;
const cf = (name) => `p06::config::${name}`;

export const P06_CLAIMS = Object.freeze([
  // ── الموصلات ───────────────────────────────────────────────────────────────
  {
    id: "P06-C1",
    document: "phase-06-connectors",
    condition: "a connector is a typed descriptor, instance, capability set, auth state, health record, invocation and result; its effects follow its actions, so every write carries an external side effect",
    requires: [
      ...t(CONN, `${cn("model")}::tests::a_well_formed_rest_connector_validates`, `${cn("model")}::tests::effects_follow_the_action_so_every_write_carries_an_external_side_effect`, `${cn("model")}::tests::a_tool_identifier_round_trips`),
      ...t(CONN, `${cn("store")}::tests::an_instance_round_trips_and_a_tampered_operation_is_not_read`),
      ...tp(CONTRACTS, "P06-CT-001 ", "P06-CT-003 "),
    ],
  },
  {
    id: "P06-C2",
    document: "phase-06-connectors",
    condition: "a connector is registered disabled, enabling is a separate decision, and its operations become tools of the tool gateway under one connector skill",
    requires: [...t(CONN, "p06_connectors_registration_is_disabled_first_and_its_operations_become_gateway_tools"), ...tp(UI, "P06-UI-012 "), ...e("P06-E2E-02")],
  },
  {
    id: "P06-C3",
    document: "phase-06-connectors",
    condition: "the generic REST connector fixes base address, paths and methods at registration; an OpenAPI document is read as data, proposes operations, names what it rejects, and registers nothing until approved",
    requires: [
      ...tp(CONN, `${cn("openapi")}::tests::`),
      ...t(CONN, `${cn("model")}::tests::an_operation_must_stay_inside_the_allowed_paths_and_methods_and_fit_its_action`, `${cn("model")}::tests::a_path_template_cannot_traverse_or_carry_a_query`),
      ...tp(UI, "P06-UI-015 ", "P06-UI-016 "),
      ...e("P06-E2E-02"),
    ],
  },
  {
    id: "P06-C4",
    document: "phase-06-connectors",
    condition: "the local workspace connector reads only its own project's sources inside the workspace root",
    requires: [...t(CONN, "p06_connectors_the_workspace_connector_reads_only_its_own_project_within_the_workspace_root")],
  },
  {
    id: "P06-C5",
    document: "phase-06-connectors",
    condition: "authentication modes NONE, API_KEY, BEARER_TOKEN and BASIC work; OAUTH2 is declared and refused because this build has no official flow",
    requires: [
      ...t(CONN, `${cn("model")}::tests::oauth2_is_declared_but_not_accepted_and_a_secret_needs_a_bounded_source`),
      ...t(AUTH, `${cn("secrets")}::tests::base64_matches_the_standard_alphabet`, `${cn("secrets")}::tests::a_stored_secret_is_resolved_for_a_call_and_its_status_carries_no_value`),
      ...c("P06-SEC-AUTH-BOUNDARIES", "CONNECTOR-FIXTURE-AUTHORISED"),
    ],
  },
  {
    id: "P06-C6",
    document: "phase-06-connectors",
    condition: "a secret is held by the trusted broker and referenced by secret_ref or a reserved environment name; it never reaches the renderer, a prompt, the store, an event, evidence or diagnostics",
    requires: [
      ...t(AUTH, "p06_connector_auth_the_renderer_sees_a_reference_and_a_state_never_the_value", `${cn("secrets")}::tests::only_a_reserved_environment_variable_can_be_a_secret_source`),
      ...t(SECURITY, "p06_connector_security_the_credential_never_reaches_the_store_events_or_evidence"),
      ...tp(CONTRACTS, "P06-CT-010 "),
      ...tp(UI, "P06-UI-011 ", "P06-UI-027 "),
      ...c("P06-SEC-NO-SECRET-TO-RENDERER", "P06-SEC-RENDERER-NO-KEY-PATH", "CANARY-ABSENT-DATA", "CANARY-ABSENT-REPORTS", "P06-EVIDENCE-NO-CANARY"),
      ...e("P06-E2E-21"),
    ],
  },
  {
    id: "P06-C7",
    document: "phase-06-connectors",
    condition: "authorization is per action: a read runs within policy; WRITE, DELETE, SEND, PUBLISH, CREATE and MODIFY are external side effects that wait for a bound approval with a host-written summary",
    requires: [
      ...t(AGENT, "p06_agent_integration_a_write_waits_for_a_bound_approval_with_a_host_written_summary_and_executes_exactly_once"),
      ...tp(UI, "P06-UI-018 "),
      ...e("P06-E2E-06"),
    ],
  },
  {
    id: "P06-C8",
    document: "phase-06-connectors",
    condition: "an approved external action happens exactly once, and an identical repeat replays the stored result instead of reaching the service again",
    requires: [
      ...t(AGENT, "p06_agent_integration_an_identical_second_write_is_a_replay_and_never_a_second_external_effect"),
      ...tp(GW, `${cn("idempotency")}::tests::`),
      ...t(GW, "p06_connector_gateway_the_same_key_and_payload_replays_and_a_different_payload_conflicts", "p06_connector_gateway_a_header_idempotent_write_always_sends_the_key_its_ledger_uses"),
      ...e("P06-E2E-07", "P06-E2E-08"),
      ...c("CONNECTOR-EXACTLY-ONCE"),
    ],
  },
  {
    id: "P06-C9",
    document: "phase-06-connectors",
    condition: "the rate limiter bounds requests per minute and concurrency per connector, and refuses locally rather than flooding the service",
    requires: [...tp(GW, `${cn("ratelimit")}::tests::`), ...t(GW, "p06_connector_gateway_the_local_rate_limit_refuses_rather_than_storms"), ...e("P06-E2E-10")],
  },
  {
    id: "P06-C10",
    document: "phase-06-connectors",
    condition: "429 and Retry-After are honoured within a bound; a safe read is retried with bounded backoff; an unprotected side effect is never retried and ends as outcome unknown",
    requires: [
      ...t(CSEC, `${cn("rest")}::tests::backoff_is_bounded_and_honours_retry_after`, `${cn("rest")}::tests::an_unsafe_side_effect_is_never_retried_and_a_rate_limit_always_may_be`),
      ...t(GW, "p06_connector_gateway_a_429_with_a_short_retry_after_is_retried_once_and_a_long_one_is_not_retried", "p06_connector_gateway_a_safe_read_is_retried_and_an_unprotected_write_is_never_retried"),
      ...c("P06-SEC-NO-UNSAFE-RETRY"),
      ...e("P06-E2E-11"),
    ],
  },
  {
    id: "P06-C11",
    document: "phase-06-connectors",
    condition: "connector evidence is honest: an HTTP success is not a verified outcome; a returned resource id verifies a claim, and what the service did not show stays unverified",
    requires: [...t(AGENT, "p06_agent_integration_a_read_goes_through_the_real_agent_path_and_its_observed_value_verifies_a_claim"), ...tp(UI, "P06-UI-014 ", "P06-UI-040 "), ...e("P06-E2E-04", "P06-E2E-07")],
  },
  {
    id: "P06-C12",
    document: "phase-06-connectors",
    condition: "cancelling a mission stops an in-flight connector call and its retries and frees its seat",
    requires: [...t(GW, "p06_connector_gateway_cancellation_stops_an_in_flight_call_and_its_retries"), ...t(AGENT, "p06_agent_integration_cancelling_the_mission_stops_an_in_flight_connector_call"), ...e("P06-E2E-09")],
  },
  {
    id: "P06-C13",
    document: "phase-06-connectors",
    condition: "connector content is untrusted data: fenced in the prompt, labelled into memory, and unable to grant an approval, add a tool, name a URL or change a policy",
    requires: [
      ...t(AGENT, "p06_agent_integration_injected_connector_content_stays_fenced_and_what_the_agent_obeyed_is_refused"),
      ...t(CSEC, "p06_connector_security_injected_content_stays_data_and_cannot_grant_approval_or_change_policy", "p06_connector_security_an_agent_cannot_name_a_url_a_path_or_a_header"),
      ...t(CSEC, `${cn("rest")}::tests::an_agent_cannot_add_a_url_a_header_or_a_path`, `${cn("rest")}::tests::a_path_argument_cannot_escape_its_segment`),
      ...c("INJECTION-FENCED", "CONNECTOR-LABELLED-IN-PROMPT", "CONNECTOR-NO-FORBIDDEN-PATH"),
      ...e("P06-E2E-05"),
    ],
  },
  {
    id: "P06-C14",
    document: "phase-06-connectors",
    condition: "a malicious service cannot redirect the call, flood it, corrupt it, fake an approval or fake a cost",
    requires: [
      ...t(CSEC, "p06_connector_security_a_redirect_is_never_followed_and_an_oversized_or_malformed_body_is_refused", "p06_connector_security_a_fake_cost_report_is_rejected_and_no_invented_price_appears"),
      ...c("P06-SEC-NO-REDIRECT"),
      ...e("P06-E2E-12"),
    ],
  },
  {
    id: "P06-C15",
    document: "phase-06-connectors",
    condition: "no connector call bypasses the gateways: every service request comes from the connector gateway, reached only through the tool gateway or the health probe, and no IPC operation runs a connector operation",
    requires: [
      ...t(CONN, "p06_every_phase06_operation_answers_through_the_real_gateway_with_a_schema_valid_result"),
      ...t(SETTINGS, "p06::ipc::tests::the_operation_list_is_closed_and_carries_no_path_to_a_service"),
      ...tp(CONTRACTS, "P06-CT-009 "),
      ...tp(UI, "P06-UI-001 ", "P06-UI-002 "),
      ...c("P06-SEC-NO-GATEWAY-BYPASS", "P06-SEC-NO-INVOKE-OPERATION"),
    ],
  },
  {
    id: "P06-C16",
    document: "phase-06-connectors",
    condition: "a registration that reaches a private network, carries credentials in its address or names an arbitrary secret is refused, and connector egress is a reviewed network policy",
    requires: [
      ...t(CSEC, "p06_connector_security_a_registration_that_reaches_a_private_network_or_an_arbitrary_secret_is_refused"),
      ...t(CONN, `${cn("model")}::tests::an_endpoint_that_reaches_a_private_network_or_carries_credentials_is_refused`),
      ...tp(CONTRACTS, "P06-CT-014 "),
    ],
  },
  {
    id: "P06-C17",
    document: "phase-06-connectors",
    condition: "connector health is Unknown until measured in this session, measured by one read through the gateway, and a measurement from a previous start is never shown as present",
    requires: [...t(HEALTH, "p06_health_a_connector_is_unknown_until_measured_and_measured_after_a_test"), ...tp(UI, "P06-UI-013 "), ...e("P06-E2E-03", "P06-E2E-20")],
  },

  // ── الكلفة والاستعمال والميزانيات ──────────────────────────────────────────
  {
    id: "P06-K1",
    document: "phase-06-cost",
    condition: "every cost and token count carries PROVIDER_REPORTED, LOCALLY_MEASURED, ESTIMATED or UNKNOWN; UNKNOWN has no amount and an estimate needs its source",
    requires: [...tp(COST, `${co("model")}::tests::`), ...tp(CONTRACTS, "P06-CT-011 "), ...e("P06-E2E-13")],
  },
  {
    id: "P06-K2",
    document: "phase-06-cost",
    condition: "no price is invented: with no price entered every cost is unknown; a price the user enters, with its source, makes the cost an estimate and is never an invoice",
    requires: [
      ...t(COST, `${co("pricing")}::tests::with_no_price_entered_every_cost_is_unknown`, `${co("pricing")}::tests::a_price_without_a_source_or_with_a_foreign_unit_is_refused`, `${co("pricing")}::tests::half_a_price_is_not_a_price_and_two_currencies_do_not_mix`),
      ...t(COST, "p06_cost_a_user_price_makes_model_cost_estimated_with_its_source_and_no_price_leaves_it_unknown"),
      ...t(BUDGETS, "p06_budgets_and_pricing_are_validated_and_no_price_ships_with_the_build"),
      ...c("P06-SEC-NO-BUILTIN-PRICE"),
      ...e("P06-E2E-14"),
    ],
  },
  {
    id: "P06-K3",
    document: "phase-06-cost",
    condition: "the ledger keeps each currency and provenance apart, never sums an estimate into a report, converts no currency, and refuses a fake cost before it is stored",
    requires: [...tp(COST, `${co("ledger")}::tests::`), ...tp(UI, "P06-UI-030 "), ...e("P06-E2E-12")],
  },
  {
    id: "P06-K4",
    document: "phase-06-cost",
    condition: "budgets per mission, project, day, provider and connector are validated and persist; a hard budget blocks the next call before it is sent, and a hard cost budget blocks a call it cannot price",
    requires: [
      ...tp(BUDGETS, `${co("budget")}::tests::`),
      ...t(BUDGETS, "p06_budgets_a_hard_budget_blocks_the_next_call_and_a_soft_budget_warns_but_permits", "p06_budgets_a_hard_model_token_budget_blocks_the_mission_before_any_model_call"),
      ...e("P06-E2E-15"),
    ],
  },
  {
    id: "P06-K5",
    document: "phase-06-cost",
    condition: "a soft budget warns and permits, and the overrun is visible as a state, an event and a local alert",
    requires: [...t(BUDGETS, `${co("budget")}::tests::a_hard_budget_blocks_the_next_call_and_a_soft_one_warns_but_permits`), ...e("P06-E2E-16")],
  },
  {
    id: "P06-K6",
    document: "phase-06-cost",
    condition: "every model call passes the invocation guard: input limit, locality and budget are checked before the call, and usage is recorded after it",
    requires: [...tp(BUDGETS, `${co("guard")}::tests::`), ...e("P06-E2E-13")],
  },
  {
    id: "P06-K7",
    document: "phase-06-cost",
    condition: "the Usage & Cost screen shows each amount with its provenance label, keeps currencies apart, and says what is unknown",
    requires: [...tp(UI, "P06-UI-030 ", "P06-UI-028 "), ...e("P06-E2E-14")],
  },

  // ── الرصد والصحّة ───────────────────────────────────────────────────────────
  {
    id: "P06-O1",
    document: "phase-06-observability",
    condition: "structured events carry codes, components and timings only; free text, prompts, headers and payloads cannot be represented; the store is bounded",
    requires: [...tp(OBS, `${ob("event")}::tests::`), ...tp(CONTRACTS, "P06-CT-012 "), ...t(OBS, "p06_observability_events_are_structured_codes_and_errors_group_by_code")],
  },
  {
    id: "P06-O2",
    document: "phase-06-observability",
    condition: "metrics are bounded and since this start: every required counter, latency histograms, and errors aggregated by component and code with a bounded key space",
    requires: [...tp(OBS, `${ob("metrics")}::tests::`, `${ob("tests")}::`), ...tp(UI, "P06-UI-031 ")],
  },
  {
    id: "P06-O3",
    document: "phase-06-observability",
    condition: "audit, events, metrics and evidence stay separate: events are labelled diagnostic, not audit, and the audit ledger records connector actions on its own",
    requires: [...tp(UI, "P06-UI-032 ", "P06-UI-034 "), ...t(SECURITY, "p06_connector_security_the_credential_never_reaches_the_store_events_or_evidence")],
  },
  {
    id: "P06-O4",
    document: "phase-06-observability",
    condition: "health is Unknown until measured, the overall state is the worst measured one, and a restart starts from Unknown",
    requires: [...tp(HEALTH, `${ob("health")}::tests::`), ...t(PERSIST, "p06_persistence_connectors_settings_budgets_prices_and_usage_survive_a_restart_and_health_starts_unknown"), ...e("P06-E2E-20")],
  },
  {
    id: "P06-O5",
    document: "phase-06-observability",
    condition: "local alerts count repeats rather than duplicate, need a threshold inside a window for an error spike, and take no free text",
    requires: [...tp(OBS, `${ob("alerts")}::tests::`)],
  },
  {
    id: "P06-O6",
    document: "phase-06-observability",
    condition: "the diagnostics export is local, bounded, redacted and valid, its detail follows the privacy setting, and the credential canary never appears in it",
    requires: [
      ...t(OBS, "p06_diagnostics_export_is_bounded_and_redacted_and_names_its_sections"),
      ...tp(OBS, `${ob("redact")}::tests::`),
      ...t(PRIVACY, "p06_privacy_the_diagnostics_detail_level_changes_what_the_document_carries"),
      ...tp(UI, "P06-UI-033 "),
      ...e("P06-E2E-21"),
    ],
  },

  // ── الإعدادات ───────────────────────────────────────────────────────────────
  {
    id: "P06-S1",
    document: "phase-06-settings",
    condition: "nineteen sections of typed settings (boolean, integer, decimal, enum, string, duration, bytes, list), each naming the host component that reads it",
    requires: [...tp(SETTINGS, `${cf("registry")}::tests::`, `${cf("model")}::tests::`), ...tp(UI, "P06-UI-020 ")],
  },
  {
    id: "P06-S2",
    document: "phase-06-settings",
    condition: "the effective value resolves defaults, then user, project and mission, then security clamps last, and every value names its source",
    requires: [...tp(EFFECTIVE, `${cf("resolver")}::tests::`), ...t(EFFECTIVE, "p06_effective_config_a_project_override_cannot_widen_a_security_clamp_and_every_value_names_its_source"), ...tp(CONTRACTS, "P06-CT-013 ")],
  },
  {
    id: "P06-S3",
    document: "phase-06-settings",
    condition: "a project or mission can narrow a security-bearing setting but never widen it, and the security clamp bounds even the user and the default",
    requires: [
      ...t(SETTINGS, `${cf("service")}::tests::a_project_or_mission_override_cannot_widen_a_security_setting`, `${cf("service")}::tests::a_security_clamp_bounds_the_user_and_a_security_value_cannot_exceed_the_build_ceiling`),
      ...t(SETTINGS, "p06_settings_a_mission_override_takes_effect_and_cannot_widen_the_security_clamp", "p06_settings_a_refused_widening_crosses_the_boundary_as_a_policy_denial_not_a_malformed_request"),
      ...tp(UI, "P06-UI-023 "),
      ...e("P06-E2E-18"),
    ],
  },
  {
    id: "P06-S4",
    document: "phase-06-settings",
    condition: "a setting takes effect: a change applies on the next read or mission, the concurrent-mission clamp refuses a start beyond it, and the side-effect policy stops a write before approval",
    requires: [
      ...t(SETTINGS, `${cf("service")}::tests::a_setting_change_takes_effect_on_the_next_read_and_survives_a_reload`, "p06_settings_the_concurrent_mission_clamp_refuses_a_start_beyond_it"),
      ...tp(UI, "P06-UI-022 ", "P06-UI-026 "),
      ...e("P06-E2E-17"),
    ],
  },
  {
    id: "P06-S5",
    document: "phase-06-settings",
    condition: "persistence is versioned: values survive a restart, and a newer config schema fails closed to defaults and refuses writes",
    requires: [
      ...tp(SETTINGS, `${cf("store")}::tests::`),
      ...t(SETTINGS, `${cf("service")}::tests::a_newer_config_schema_fails_closed_to_defaults_and_refuses_writes`),
      ...t(PERSIST, "p06_persistence_a_newer_config_schema_fails_closed_after_a_restart", "p06_persistence_the_store_is_at_schema_five_after_a_real_open"),
      ...tp(UI, "P06-UI-024 "),
      ...e("P06-E2E-19"),
    ],
  },
  {
    id: "P06-S6",
    document: "phase-06-settings",
    condition: "every privacy setting is effective: local only, remote models, connector egress, browser internet, browser history, screen observations, memory and diagnostics detail",
    requires: [
      ...t(SETTINGS, `${cf("registry")}::tests::the_privacy_section_carries_the_eight_privacy_controls`),
      ...t(
        PRIVACY,
        "p06_privacy_turning_off_browser_internet_computer_use_and_memory_persistence_is_effective",
        "p06_privacy_browser_history_is_erased_at_the_end_of_a_mission_when_it_is_not_kept",
        "p06_privacy_screen_observations_are_erased_at_the_end_of_a_mission_when_they_are_not_kept",
        "p06_privacy_a_connector_result_does_not_become_memory_when_that_is_turned_off",
        "p06_privacy_the_diagnostics_detail_level_changes_what_the_document_carries",
        "p06_connector_policy_privacy_and_the_side_effect_policy_refuse_before_any_request",
        `${co("guard")}::tests::a_model_call_is_never_refused_for_its_locality`,
      ),
    ],
  },
  {
    id: "P06-S7",
    document: "phase-06-settings",
    condition: "a sensitive setting shows configured, source and last update only; there is no way to reveal its value",
    requires: [...tp(UI, "P06-UI-011 ", "P06-UI-027 "), ...c("P06-SEC-NO-SECRET-TO-RENDERER"), ...t(AUTH, "p06_connector_auth_the_renderer_sees_a_reference_and_a_state_never_the_value")],
  },
  {
    id: "P06-S8",
    document: "phase-06-settings",
    condition: "nine languages resolve structurally with a user-chosen fallback; Arabic renders right to left and English left to right on every Phase-06 screen with no missing key",
    requires: [...tp(UI, "P06-UI-041 ", "P06-UI-042 ", "P06-UI-043 ", "P06-UI-044 "), ...e("P06-E2E-22", "P06-E2E-23")],
  },
  {
    id: "P06-S9",
    document: "phase-06-settings",
    condition: "the settings screen is the control plane: sections, layer and scope, typed editors, provenance, locked and unavailable states, budgets and prices; the frozen host view remains reachable",
    requires: [...tp(UI, "P06-UI-020 ", "P06-UI-021 ", "P06-UI-025 ", "P06-UI-026 ", "P06-UI-028 ")],
  },

  // ── الأمن ───────────────────────────────────────────────────────────────────
  {
    id: "P06-SEC1",
    document: "phase-06-security",
    condition: "the static security scan passes: no invoke operation, no key to the renderer, no gateway bypass, no redirect, no unsafe retry, no built-in price, bounded auth, no spawn or unsafe, no telemetry endpoint, canonical errors, no key path in the renderer, no secret in source, locked fixed settings",
    requires: [
      ...c(
        "P06-SEC-NO-INVOKE-OPERATION",
        "P06-SEC-NO-SECRET-TO-RENDERER",
        "P06-SEC-NO-GATEWAY-BYPASS",
        "P06-SEC-NO-REDIRECT",
        "P06-SEC-NO-UNSAFE-RETRY",
        "P06-SEC-NO-BUILTIN-PRICE",
        "P06-SEC-AUTH-BOUNDARIES",
        "P06-SEC-NO-SPAWN-NO-UNSAFE",
        "P06-SEC-NO-TELEMETRY-ENDPOINT",
        "P06-SEC-CANONICAL-ERROR-CODES",
        "P06-SEC-RENDERER-NO-KEY-PATH",
        "P06-SEC-NO-SECRET-IN-SOURCE",
        "P06-SEC-LOCKED-SETTINGS",
      ),
    ],
  },
  {
    id: "P06-SEC2",
    document: "phase-06-security",
    condition: "the evidence carries no key shape, no reasoning trace, no connector response text and no credential canary",
    requires: [...c("P06-EVIDENCE-NO-SECRET", "P06-EVIDENCE-NO-REASONING-FIELD", "P06-EVIDENCE-NO-UNTRUSTED-CONTENT", "P06-EVIDENCE-NO-CANARY")],
  },
  {
    id: "P06-SEC3",
    document: "phase-06-security",
    condition: "the per-run credential canary reached the service only as the header the gateway built: it is absent from every file the product wrote, from every probe report, and from the store in both launches",
    requires: [...c("CANARY-ABSENT-DATA", "CANARY-ABSENT-REPORTS", "CONNECTOR-FIXTURE-AUTHORISED", "E2E-REPORT-NO-SECRET"), ...e("P06-E2E-20", "P06-E2E-21")],
  },
  {
    id: "P06-SEC4",
    document: "phase-06-security",
    condition: "the security-bearing test groups pass in full: connector security, auth, gateway, privacy, security and effective config",
    requires: [...g(CSEC, AUTH, GW, PRIVACY, SECURITY, EFFECTIVE)],
  },

  // ── التشغيل الأصلي ─────────────────────────────────────────────────────────
  {
    id: "P06-N1",
    document: "phase-06-native-e2e",
    condition: "the native suite ran on Windows against freshly built binaries, with TEST FIXTURES only, on loopback only, and the fixtures received real agent calls and connector requests",
    requires: [...c("NATIVE-PERFORMED", "FIXTURE-LABELLED-TEST-FIXTURE", "FIXTURE-RECEIVED-AGENT-CALLS", "FIXTURE-NO-AUTHORIZATION-HEADER", "CONNECTOR-FIXTURE-ONLY-LOOPBACK")],
  },
  {
    id: "P06-N2",
    document: "phase-06-native-e2e",
    condition: "every one of the twenty-five native scenarios passes in the real window or from the runner, with a local model routed first",
    requires: [
      ...e(
        "P06-E2E-00",
        "P06-E2E-01",
        "P06-E2E-02",
        "P06-E2E-03",
        "P06-E2E-04",
        "P06-E2E-05",
        "P06-E2E-06",
        "P06-E2E-07",
        "P06-E2E-08",
        "P06-E2E-09",
        "P06-E2E-10",
        "P06-E2E-11",
        "P06-E2E-12",
        "P06-E2E-13",
        "P06-E2E-14",
        "P06-E2E-15",
        "P06-E2E-16",
        "P06-E2E-17",
        "P06-E2E-18",
        "P06-E2E-19",
        "P06-E2E-20",
        "P06-E2E-21",
        "P06-E2E-22",
        "P06-E2E-23",
        "P06-E2E-24",
        "P06-E2E-25",
      ),
    ],
  },
  {
    id: "P06-N3",
    document: "phase-06-native-e2e",
    condition: "the report is complete and every NOT_TESTED entry names where it is measured; the application exits cleanly and no owned process survives",
    requires: [...c("NATIVE-SCENARIOS-COMPLETE"), ...e("P06-E2E-24", "P06-E2E-25")],
  },

  // ── الأداء ─────────────────────────────────────────────────────────────────
  {
    id: "P06-P1",
    document: "phase-06-performance",
    condition: "the ten required timings are locally measured, each with its method, and each says whether it includes provider or service time",
    requires: [
      ...c("PERFORMANCE-MEASURED", "PERFORMANCE-COVERS-REQUIRED", "PERFORMANCE-EXCLUDES-PROVIDER-TIME"),
      ...t(GW, "p06_connector_gateway_timings_count_each_call_and_exclude_the_wait_for_the_service"),
    ],
  },

  // ── الانحدار ───────────────────────────────────────────────────────────────
  {
    id: "P06-R0",
    document: "phase-06-regression",
    condition: "the frozen Phase-00 gate was re-run in this run and passes",
    requires: [{ type: "gate", phase: "PHASE-00" }],
  },
  {
    id: "P06-R1",
    document: "phase-06-regression",
    condition: "the Phase-01 gate was re-run in this run and passes",
    requires: [{ type: "gate", phase: "PHASE-01" }],
  },
  {
    id: "P06-R2",
    document: "phase-06-regression",
    condition: "the Phase-02 gate was re-run in this run and passes",
    requires: [{ type: "gate", phase: "PHASE-02" }],
  },
  {
    id: "P06-R3",
    document: "phase-06-regression",
    condition: "the Phase-03 gate was re-run in this run and passes",
    requires: [{ type: "gate", phase: "PHASE-03" }],
  },
  {
    id: "P06-R4",
    document: "phase-06-regression",
    condition: "the Phase-04 gate was re-run in this run and passes",
    requires: [{ type: "gate", phase: "PHASE-04" }],
  },
  {
    id: "P06-R5",
    document: "phase-06-regression",
    condition: "the Phase-05 gate was re-run in this run and passes",
    requires: [{ type: "gate", phase: "PHASE-05" }],
  },

  // ── التشغيل والجودة ─────────────────────────────────────────────────────────
  {
    id: "P06-Q1",
    document: "phase-06-final-gate",
    condition: "the contract layer carries the Phase-06 vocabulary additively on envelope 1.6, with no new major version and no connector-execution operation",
    requires: [...g(CONTRACTS), ...tp(CONTRACTS, "P06-CT-001 ", "P06-CT-002 ", "P06-CT-008 ", "P06-CT-009 ")],
  },
  {
    id: "P06-Q2",
    document: "phase-06-run",
    condition: "the whole host workspace and the whole renderer pass their own suites and their lint, and every Phase-06 group passes",
    requires: [
      ...g("P06-HOST-CORE", "P06-HOST-BINDING", "P06-HOST-LINT", "P06-RENDERER-ALL", UI),
      ...g(CONN, CSEC, AUTH, GW, COST, BUDGETS, OBS, HEALTH, SETTINGS, EFFECTIVE, PRIVACY, AGENT, PERSIST, SECURITY),
    ],
  },
  {
    id: "P06-Q3",
    document: "phase-06-run",
    condition: "the Phase-06 instruments are themselves tested, so the measurement is not trusted on faith",
    requires: [...g("P06-TOOLS")],
  },
  {
    id: "P06-Q4",
    document: "phase-06-final-gate",
    condition: "every canonical Phase-06 document is UTF-8 with no BOM, LF only, valid JSON and exactly one final newline",
    requires: [{ type: "bytes" }],
  },
  {
    id: "P06-Q5",
    document: "phase-06-final-gate",
    condition: "no security-bearing group hid a skip, and both security scans actually ran",
    requires: [{ type: "no-skip" }],
  },
]);
