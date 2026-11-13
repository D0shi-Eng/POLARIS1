// شروط البوابة النهائية لـPhase-02، وكل شرط مربوط بقياسه.
//
// أنواع الربط:
//   test   : اسم اختبار (أو بادئة تنتهي بـ::) في مجموعة؛ غيابه NOT_TESTED، وفشله FAIL.
//   e2e    : سيناريو من مجموعة النافذة الأصلية.
//   check  : فحص ساكن من p02-security أو من سجل التجهيزة أو من الإطلاق الأصلي.
//   gate   : حكم وثيقة مرحلة سابقة بعد إعادة تشغيلها.
// لا يُكتب PASS بيد في أي مكان: كل شرط يأخذ أسوأ أحكام قياساته.

const t = (group, ...names) => names.map((name) => ({ type: "test", group, name }));
const e = (...ids) => ids.map((id) => ({ type: "e2e", id }));
const c = (...ids) => ids.map((id) => ({ type: "check", id }));

const PROVIDERS = "P02-PROVIDERS";
const CORE = "P02-HOST-CORE";
const UI = "P02-RENDERER-UI";
const CONTRACTS = "P02-CONTRACTS-P02";

export const P02_CLAIMS = Object.freeze([
  // ── المزوّدون ──────────────────────────────────────────────────────────────
  { id: "P02-P1", document: "phase-02-providers", condition: "the provider registry is complete: seven documented providers with fixed facts, listed with health and no secret", requires: [
    ...t(PROVIDERS, "catalog::tests::"),
    ...t(CORE, "p02_providers_are_listed_with_facts_and_no_secret", "p02::providers::registry::tests::defaults_come_from_the_descriptor"),
    ...t(CONTRACTS, "P02-CT-002 the Phase-02 registry is valid, complete, routed and owned"),
    ...e("E2E-02"),
  ] },
  { id: "P02-P2", document: "phase-02-providers", condition: "provider health is measured, classified and never guessed", requires: [
    ...t(
      PROVIDERS,
      "a_failed_local_connection_is_measured_as_unreachable_and_not_running",
      "a_real_local_response_is_measured_as_healthy_and_running",
      "a_silent_server_times_out_and_health_does_not_call_it_offline",
      "adapters::common::tests::connection_refused_is_unreachable_and_not_running_locally",
      "adapters::common::tests::a_local_connect_timeout_is_unreachable_not_unknown",
      "adapters::common::tests::a_read_timeout_stays_unknown_after_a_successful_connect",
      "adapters::common::tests::remote_timeout_semantics_are_preserved",
    ),
    ...t(CORE, "p02::providers::registry::tests::a_disabled_provider_is_reported_as_disabled_not_offline", "p02::providers::registry::tests::the_generic_local_server_is_misconfigured_until_an_endpoint_is_set", "p02_an_unreachable_local_provider_is_stated_and_its_models_kept"),
    ...e("E2E-04", "E2E-05"),
  ] },
  { id: "P02-P3", document: "phase-02-providers", condition: "local discovery works for LM Studio, Ollama and a generic OpenAI-compatible server, on loopback only", requires: [
    ...t(PROVIDERS, "lm_studio_falls_back_to_the_compatible_listing", "ollama_discovery_combines_tags_ps_and_show", "openai_compatible_discovery_handles_duplicates_and_unexpected_fields", "an_empty_model_list_is_an_empty_result_not_an_error", "installation::tests::", "net::endpoint::tests::loopback_accepts_only_the_local_host"),
    ...e("E2E-03", "E2E-05"),
  ] },
  { id: "P02-P4", document: "phase-02-providers", condition: "secrets are isolated: native store or official environment variable, referenced by id, never serialised", requires: [
    ...t(PROVIDERS, "secret::tests::", "a_remote_provider_without_a_credential_never_sends", "anthropic_and_google_send_their_official_headers_only"),
    ...t(CORE, "p02::providers::secrets::tests::", "p02_providers_are_listed_with_facts_and_no_secret", "p02_locality_and_project_policy_keep_content_local"),
    ...t(UI, "P02-UI-007 Providers lists real host facts, measures on request and never shows a key"),
    ...c("P02-SEC-UNSAFE-CONFINED"),
  ] },
  { id: "P02-P5", document: "phase-02-providers", condition: "provider errors are normalised to a closed set and redacted", requires: [
    ...t(PROVIDERS, "error::tests::", "redact::tests::", "auth_failure_and_rate_limit_are_normalised_and_redacted", "malformed_json_is_a_provider_response_error", "a_stream_cut_mid_way_is_not_presented_as_complete", "a_disconnect_before_any_response_is_an_invalid_response_not_success"),
    ...t(CORE, "p02::errors::tests::", "p02_timeout_and_malformed_responses_fail_closed"),
  ] },

  // ── النماذج والتوجيه ───────────────────────────────────────────────────────
  { id: "P02-M1", document: "phase-02-models", condition: "the model registry merges discovery, keeps user choices and marks what vanished", requires: [
    ...t(CORE, "p02::models::registry::tests::", "p02::models::preferences::tests::"),
    ...e("E2E-06"),
  ] },
  { id: "P02-M2", document: "phase-02-models", condition: "real model discovery works where the provider supports it", requires: [
    ...t(PROVIDERS, "adapters::ollama::tests::tags_are_parsed_with_reported_details_only", "adapters::openai_compat::tests::listing_deduplicates_and_skips_unsafe_ids", "adapters::anthropic::tests::pages_are_parsed_and_the_cursor_followed", "adapters::google::tests::models_are_parsed_from_generation_methods", "adapters::openrouter::tests::rich_metadata_is_reported_with_provenance", "ollama_discovery_combines_tags_ps_and_show"),
    ...t(CORE, "p02_discovery_selection_and_invocation_work_end_to_end"),
    ...e("E2E-06"),
  ] },
  { id: "P02-M3", document: "phase-02-models", condition: "the model selector is honest: discovered, enabled, available and loaded are separate, and unknown is never true", requires: [
    ...t(PROVIDERS, "domain::model::tests::a_bare_model_claims_nothing", "domain::facts::tests::unknown_is_never_proven", "adapters::ollama::tests::without_show_the_capabilities_stay_unknown"),
    ...t(UI, "P02-UI-009 Models shows only discovered models, enables one and sets the default"),
    ...e("E2E-07", "E2E-08"),
  ] },
  { id: "P02-M4", document: "phase-02-models", condition: "every model capability and metric carries its provenance", requires: [
    ...t(PROVIDERS, "adapters::lmstudio::tests::rest_metadata_is_reported_not_guessed", "adapters::ollama::tests::show_reports_capabilities_and_context_length", "domain::facts::tests::an_unknown_fact_serialises_without_a_value", "adapters::openrouter::tests::prices_must_be_plain_decimals"),
    ...t(UI, "P02-UI-014 every value a Phase-02 contract enum can take has an English and an Arabic label"),
  ] },
  { id: "P02-M5", document: "phase-02-models", condition: "model invocation works through ModelInvocationService with typed results", requires: [
    ...t(PROVIDERS, "a_streamed_completion_is_assembled_with_usage", "adapters::anthropic::tests::a_message_is_parsed_into_text_and_usage"),
    ...t(CORE, "p02_discovery_selection_and_invocation_work_end_to_end", "p02_idempotency_replays_and_refuses_reuse"),
    ...e("E2E-15"),
  ] },
  { id: "P02-M6", document: "phase-02-models", condition: "cancellation aborts the request at the provider and binds to one invocation and one session", requires: [
    // `net::sliced::tests::` يحمل الضمان نفسه بعد ADR-020: الإلغاء يُلاحَظ خلال
    // شريحة على أي منصّة. ربطه هنا يجعل الادعاء مقيسًا حيث يعيش القياس فعلًا.
    ...t(PROVIDERS, "cancelling_during_a_stream_aborts_the_request_at_the_server", "cancelling_before_the_request_sends_nothing", "net::cancel::tests::", "net::sliced::tests::"),
    ...t(CORE, "p02::invocation::inflight::tests::", "p02_cancellation_aborts_the_request_and_discards_late_output", "p02_cancel_before_request_sends_nothing"),
    ...e("E2E-16"),
    ...c("FIXTURE-SLOW-REQUEST-ABORTED"),
  ] },
  { id: "P02-R1", document: "phase-02-models", condition: "manual and default routing are deterministic and follow project, then user, then nothing", requires: [
    ...t(CORE, "p02::routing::tests::manual_selection_picks_exactly_the_named_model", "p02::routing::tests::the_default_chain_is_project_then_user_then_nothing", "p02::routing::tests::the_decision_is_deterministic", "p02_project_model_binding_follows_the_declared_chain"),
  ] },
  { id: "P02-R2", document: "phase-02-models", condition: "a capability mismatch is denied, and an unproven capability is not a match", requires: [
    ...t(CORE, "p02::routing::tests::a_required_capability_must_be_proven", "p02::routing::tests::disabled_unhealthy_and_embedding_candidates_are_excluded", "p02_routing_denials_are_explicit"),
  ] },
  { id: "P02-R3", document: "phase-02-models", condition: "the locality preference and the project content policy are enforced before any byte leaves", requires: [
    ...t(CORE, "p02::routing::tests::locality_is_enforced_and_preferred", "p02::egress::tests::", "p02_locality_and_project_policy_keep_content_local"),
    ...e("E2E-17"),
    ...c("FIXTURE-NO-REMOTE-CHAT"),
  ] },

  // ── المشاريع ───────────────────────────────────────────────────────────────
  { id: "P02-J1", document: "phase-02-projects", condition: "project creation validates input and workspace roots and is audited", requires: [
    ...t(CORE, "p02::projects::service::tests::", "p02::projects::workspace::tests::", "p02::projects::model::tests::", "p02::projects::repository::tests::create_read_update_archive_list"),
    ...e("E2E-09"),
  ] },
  { id: "P02-J2", document: "phase-02-projects", condition: "state persists in a versioned store across a restart; a newer schema fails closed", requires: [
    ...t(CORE, "storage::db::tests::", "storage::migrations::tests::", "p02_state_survives_a_host_restart", "p02::projects::repository::tests::a_failed_write_rolls_back"),
    ...e("E2E-20"),
  ] },
  { id: "P02-J3", document: "phase-02-projects", condition: "archiving keeps everything and makes the project read only; stale writes conflict", requires: [
    ...t(CORE, "p02::projects::service::tests::archived_projects_are_read_only_until_restored", "p02::projects::repository::tests::a_stale_version_is_a_conflict_and_writes_nothing", "p02::projects::repository::tests::concurrent_updates_with_the_same_version_leave_exactly_one_winner", "p02_projects_persist_update_conflict_and_archive"),
    ...t(UI, "P02-UI-012 a stale version is refused as a conflict, not written over"),
    ...e("E2E-21"),
  ] },
  { id: "P02-J4", document: "phase-02-projects", condition: "a project binds its own model, and an unusable binding is denied rather than replaced", requires: [
    ...t(CORE, "p02::routing::tests::an_unusable_project_default_is_denied_not_silently_replaced", "p02_project_model_binding_follows_the_declared_chain"),
    ...e("E2E-11"),
  ] },

  // ── السياق ─────────────────────────────────────────────────────────────────
  { id: "P02-C1", document: "phase-02-context", condition: "context sources are added inside the workspace scope only, with traversal, links and sensitive files refused", requires: [
    ...t("P02-CONTEXT", "p02::context::sources::tests::", "p02::context::paths::tests::", "p02::context::classify::tests::"),
    ...t(CORE, "p02_context_scope_is_enforced_at_the_host"),
    ...e("E2E-12", "E2E-13"),
  ] },
  { id: "P02-C2", document: "phase-02-context", condition: "every context item carries source, digest, size, trust and the reason it was included or left out", requires: [
    ...t("P02-CONTEXT", "p02::context::reader::tests::a_text_file_is_read_and_digested", "p02::context::assembler::tests::the_same_inputs_give_the_same_bundle", "p02::context::assembler::tests::unknown_removed_and_deleted_sources_are_named_not_hidden", "p02::context::assembler::tests::the_workspace_expansion_skips_sensitive_binary_and_invalid_files"),
    ...e("E2E-14"),
  ] },
  { id: "P02-C3", document: "phase-02-context", condition: "hard budgets for sources, files, bytes and tokens are enforced before a request is built", requires: [
    ...t("P02-CONTEXT", "p02::context::assembler::tests::the_token_budget_truncates_then_omits", "p02::context::assembler::tests::the_file_limit_is_enforced", "p02::context::assembler::tests::a_single_source_never_exceeds_its_cap", "p02::context::reader::tests::a_huge_file_is_not_digested_partially"),
    ...t(CORE, "p02_context_too_large_is_denied_before_sending"),
    ...e("E2E-14"),
  ] },
  { id: "P02-C4", document: "phase-02-context", condition: "taint is preserved: file content and model output stay untrusted data", requires: [
    ...t("P02-CONTEXT", "p02::context::model::tests::only_a_user_instruction_is_a_direct_instruction", "p02::context::preview::tests::a_file_preview_is_bounded_and_labelled_untrusted"),
    ...t(UI, "P02-UI-010 model output is rendered as labelled untrusted text, never as markup"),
    ...e("E2E-13", "E2E-15"),
  ] },
  { id: "P02-C5", document: "phase-02-context", condition: "malicious content cannot elevate authority, change settings or escape its delimiter", requires: [
    ...t("P02-CONTEXT", "p02::context::prompt::tests::"),
    ...t(CORE, "p02_hostile_context_stays_data_and_elevates_nothing"),
    ...e("E2E-15"),
  ] },

  // ── الواجهة ────────────────────────────────────────────────────────────────
  { id: "P02-U1", document: "phase-02-native-e2e", condition: "the Providers screen works with real host data", requires: [
    ...t(UI, "P02-UI-007 Providers lists real host facts, measures on request and never shows a key", "P02-UI-008 an endpoint outside loopback is refused and the refusal is shown"),
    ...e("E2E-02", "E2E-03", "E2E-04", "E2E-05"),
  ] },
  { id: "P02-U2", document: "phase-02-native-e2e", condition: "the Models screen works with real host data", requires: [
    ...t(UI, "P02-UI-009 Models shows only discovered models, enables one and sets the default", "P02-UI-010 model output is rendered as labelled untrusted text, never as markup"),
    ...e("E2E-06", "E2E-07", "E2E-08", "E2E-16"),
  ] },
  { id: "P02-U3", document: "phase-02-native-e2e", condition: "the Projects screen creates, lists and opens projects", requires: [
    ...t(UI, "P02-UI-011 create a project, open it, bind a model, add context, preview, assemble and archive"),
    ...e("E2E-09", "E2E-10"),
  ] },
  { id: "P02-U4", document: "phase-02-native-e2e", condition: "project detail covers overview, context, model and settings", requires: [
    ...t(UI, "P02-UI-011 create a project, open it, bind a model, add context, preview, assemble and archive", "P02-UI-016 every Phase-02 form control has an accessible name"),
    ...e("E2E-11", "E2E-12", "E2E-13", "E2E-14", "E2E-21"),
  ] },
  { id: "P02-U5", document: "phase-02-native-e2e", condition: "Arabic and English are complete, with RTL and LTR on every Phase-02 screen", requires: [
    ...t(UI, "P02-UI-013 every Phase-02 screen renders in Arabic, right to left, with no missing key", "P02-UI-014 every value a Phase-02 contract enum can take has an English and an Arabic label", "P02-UI-015 Arabic and English declare the same Phase-02 keys"),
    ...t("P02-RENDERER", "Arabic and English declare exactly the same keys", "no component renders literal text between JSX tags"),
    ...e("E2E-18", "E2E-19"),
  ] },

  // ── الأمن ──────────────────────────────────────────────────────────────────
  { id: "P02-S1", document: "phase-02-security", condition: "secrets never cross to the renderer", requires: [
    ...t(CONTRACTS, "P02-CT-016 no Phase-02 field name looks like a credential to the hygiene scanner", "P02-CT-013 a credential-shaped value in free text is refused"),
    ...t(CORE, "p02_providers_are_listed_with_facts_and_no_secret", "p02::providers::secrets::tests::a_stored_key_is_reported_as_a_reference_only"),
    ...t(UI, "P02-UI-007 Providers lists real host facts, measures on request and never shows a key"),
    ...c("E2E-REPORT-NO-SECRET", "P02-SEC-UNSAFE-CONFINED"),
  ] },
  { id: "P02-S2", document: "phase-02-security", condition: "no raw arbitrary endpoint, no redirect, no generic dispatch", requires: [
    ...t(PROVIDERS, "net::endpoint::tests::", "redirects_are_never_followed"),
    ...t(CORE, "p02_arbitrary_endpoints_are_refused", "p02::providers::registry::tests::a_remote_endpoint_cannot_be_changed_at_all", "p02::providers::registry::tests::a_local_endpoint_can_move_only_within_loopback", "p02_a_phase02_operation_cannot_travel_in_a_1_1_document"),
    ...t(CONTRACTS, "P02-CT-012 generic dispatch names are unrepresentable", "P02-CT-011 a payload bound to one operation is refused under another"),
    ...t(UI, "P02-UI-003 a request the contract refuses is never sent", "P02-UI-001 the Phase-02 client exposes exactly the nineteen routed operations and no generic call"),
    ...c("P02-SEC-CLOSED-OPERATION-SET", "P02-SEC-NO-NEW-WINDOW-PERMISSION", "P01-FACT:host_exposes_one_command_only"),
  ] },
  { id: "P02-S3", document: "phase-02-security", condition: "every egress path is classified and controlled", requires: [
    ...t(PROVIDERS, "net::endpoint::tests::private_and_special_addresses_are_not_public", "net::endpoint::tests::remote_requires_https_and_the_descriptor_host", "a_remote_provider_without_a_credential_never_sends"),
    ...t(CORE, "p02::egress::tests::", "p02_locality_and_project_policy_keep_content_local"),
    ...e("E2E-17"),
    ...c("FIXTURE-NO-REMOTE-CHAT", "P02-SEC-NO-HTTP-SDK"),
  ] },
  { id: "P02-S4", document: "phase-02-security", condition: "provider responses fail closed: malformed, oversized, truncated or unexpected is never success", requires: [
    ...t(PROVIDERS, "net::body::tests::", "an_oversized_body_is_refused", "malformed_json_is_a_provider_response_error", "adapters::openai_compat::tests::a_listing_without_data_is_invalid", "adapters::openai_compat::tests::a_completion_without_text_is_invalid", "adapters::common::tests::"),
    ...t(CORE, "p02_timeout_and_malformed_responses_fail_closed"),
  ] },
  { id: "P02-S5", document: "phase-02-security", condition: "no secret in logs, audit or evidence", requires: [
    ...t(PROVIDERS, "redact::tests::", "error::tests::the_raw_auth_body_is_redacted", "secret::tests::debug_never_prints_the_value"),
    ...t("P02-PROJECT-DB", "audit::ledger::tests::"),
    ...c("P02-SEC-EVIDENCE-NO-SECRET", "P02-SEC-NO-CONTENT-LOGGING", "P02-SEC-SOURCE-NO-SECRET"),
  ] },

  // ── الأصلي ─────────────────────────────────────────────────────────────────
  { id: "P02-E1", document: "phase-02-native-e2e", condition: "the Windows native E2E set is clean", requires: [
    ...e("E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05", "E2E-06", "E2E-07", "E2E-08", "E2E-09", "E2E-10", "E2E-11", "E2E-12", "E2E-13", "E2E-14", "E2E-15", "E2E-16", "E2E-17", "E2E-18", "E2E-19", "E2E-20", "E2E-21", "E2E-22"),
    ...c("E2E-NO-MISSING-KEY"),
  ] },
  { id: "P02-E2", document: "phase-02-native-e2e", condition: "state survives a real restart of the application", requires: [...e("E2E-20"), ...c("RESTART-LAUNCH-CLEAN")] },
  { id: "P02-E3", document: "phase-02-native-e2e", condition: "the application exits cleanly and leaves no process behind", requires: [...e("E2E-22"), ...c("P02-SEC-NO-KILL-BY-NAME")] },

  // ── الانحدار والأدلة ───────────────────────────────────────────────────────
  { id: "P02-Q1", document: "phase-02-regression", condition: "the Phase-00 final gate still passes after Phase-02", requires: [{ type: "gate", phase: "PHASE-00" }] },
  { id: "P02-Q2", document: "phase-02-regression", condition: "the Phase-01 final gate still passes after Phase-02", requires: [{ type: "gate", phase: "PHASE-01" }, ...c("P01-FACT:no_model_name_is_hard_coded", "P01-FACT:every_routed_operation_has_an_owning_service")] },
  { id: "P02-Q3", document: "phase-02-final-gate", condition: "every canonical Phase-02 document passes the byte gate", requires: [{ type: "bytes" }] },
  { id: "P02-Q4", document: "phase-02-final-gate", condition: "no mandatory security test or check was skipped", requires: [{ type: "no-skip" }] },
]);

/** مجموعات يُعدّ أي تخطٍّ فيها تخطيًا أمنيًا إلزاميًا. */
export const SECURITY_GROUPS = Object.freeze(["P02-PROVIDERS", "P02-HOST-CORE", "P02-CONTEXT", "P02-PROJECT-DB", "P02-CONTRACTS-P02", "P02-RENDERER-UI"]);
