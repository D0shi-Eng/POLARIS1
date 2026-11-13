// شروط البوابة النهائية لـPhase-05، وكل شرط مربوط بقياسه.
//
// أنواع الربط (كما في Phase-04):
//   test   : اسم اختبار (أو بادئة تنتهي بـ::) في مجموعة؛ غيابه NOT_TESTED، وفشله FAIL.
//   e2e    : سيناريو من مجموعة النافذة الأصلية، أو ممّا يقيسه المشغّل من خارجها.
//   check  : فحص ساكن، أو حقيقة من سجلّ التجهيزتين أو حالة نافذة التجهيزة أو الإطلاق.
//   gate   : حكم وثيقة مرحلة سابقة بعد إعادة تشغيلها في هذا التشغيل.
//   group  : حكم مجموعة اختبار كاملة.
// لا يُكتب PASS بيد في أي مكان: كل شرط يأخذ أسوأ أحكام قياساته.

const t = (group, ...names) => names.map((name) => ({ type: "test", group, name }));
const tp = (group, ...prefixes) => prefixes.map((name) => ({ type: "test", group, name, prefix: true }));
const e = (...ids) => ids.map((id) => ({ type: "e2e", id }));
const c = (...ids) => ids.map((id) => ({ type: "check", id }));
const g = (...ids) => ids.map((id) => ({ type: "group", id }));

const CONTRACTS = "P05-CONTRACTS";
const MEMORY = "P05-MEMORY";
const TRUST = "P05-MEMORY-TRUST";
const BROWSER = "P05-BROWSER";
const BSEC = "P05-BROWSER-SECURITY";
const COMPUTER = "P05-COMPUTER";
const CSEC = "P05-COMPUTER-SECURITY";
const AGENT = "P05-AGENT-INTEGRATION";
const SKILL = "P05-SKILL-INTEGRATION";
const EVIDENCE = "P05-EVIDENCE";
const CANCEL = "P05-CANCELLATION";
const APPROVAL = "P05-APPROVAL";
const PERSIST = "P05-PERSISTENCE";
const UI = "P05-RENDERER-UI";

/** المجموعات الحاملة للأمن. تخطٍّ غير مفسَّر فيها يُسقط P05-Q5. */
export const SECURITY_GROUPS = Object.freeze([TRUST, BSEC, CSEC, APPROVAL, EVIDENCE, CONTRACTS, "P05-HOST-BINDING", "P05-HOST-LINT"]);

const mem = (name) => `p05::memory::${name}`;
const br = (name) => `p05::browser::${name}`;
const pc = (name) => `p05::computer::${name}`;

export const P05_CLAIMS = Object.freeze([
  // ── الذاكرة ────────────────────────────────────────────────────────────────
  {
    id: "P05-MEM1",
    document: "phase-05-memory",
    condition: "memory has five types, four scopes and a closed vocabulary; every entry carries origin, trust, verification, taint, lineage and lifecycle",
    requires: [...tp(MEMORY, `${mem("model")}::tests::`), ...tp(CONTRACTS, "P05-CT-011 "), ...e("P05-E2E-01")],
  },
  {
    id: "P05-MEM2",
    document: "phase-05-memory",
    condition: "every write passes the candidate pipeline: validated, deduplicated, coalesced by lineage, checked for conflict, and recorded even when rejected",
    requires: [
      ...t(
        MEMORY,
        `${mem("service")}::tests::a_duplicate_is_not_stored_twice`,
        `${mem("service")}::tests::the_same_fact_from_the_same_lineage_is_coalesced_not_duplicated`,
        `${mem("service")}::tests::a_rejected_candidate_leaves_a_decision_but_no_content`,
        `${mem("service")}::tests::a_conflict_keeps_both_sides_visible_and_picks_neither`,
      ),
      ...e("P05-E2E-02", "P05-E2E-04"),
      ...t(AGENT, "p05_memory_a_mission_creates_episodic_memory_and_promotes_a_verified_fact_to_its_project"),
    ],
  },
  {
    id: "P05-MEM3",
    document: "phase-05-memory",
    condition: "retrieval obeys mission and project scope, and what an agent actually received is measured, not assumed",
    requires: [
      ...tp(MEMORY, `${mem("retriever")}::tests::`),
      ...t(AGENT, "p05_memory_retrieval_obeys_scope_and_memory_never_verifies_a_claim"),
      ...e("P05-E2E-05"),
      ...c("MEMORY-SCOPE-IN-PROMPT"),
    ],
  },
  {
    id: "P05-MEM4",
    document: "phase-05-memory",
    condition: "memory reaches a model inside a bounded block labelled MEMORY — UNTRUSTED / NON-AUTHORITATIVE and fenced as data",
    requires: [
      ...tp(MEMORY, `${mem("context")}::tests::`),
      ...t(TRUST, "p03::prompt::tests::memory_and_observations_are_fenced_as_untrusted_data"),
      ...c("MEMORY-LABELLED-IN-PROMPT", "P05-SEC-CONTENT-FENCED-AS-DATA"),
    ],
  },
  {
    id: "P05-MEM5",
    document: "phase-05-memory",
    condition: "deletion is real: content, subject, summary and sources are erased from the store, the entry is never retrieved again, and the tombstone stays contract-valid",
    requires: [
      ...t(MEMORY, `${mem("service")}::tests::a_deleted_memory_is_gone_from_the_store_and_from_retrieval`),
      ...t(TRUST, "storage::migrations::tests::the_v4_schema_refuses_a_deleted_memory_that_still_holds_content_and_unscoped_memory"),
      ...t(AGENT, "p05_memory_a_deleted_fact_is_no_longer_retrieved"),
      ...tp(CONTRACTS, "P05-CT-011a "),
      ...tp(UI, "P05-UI-012 "),
      ...e("P05-E2E-06"),
    ],
  },
  {
    id: "P05-MEM6",
    document: "phase-05-memory",
    condition: "working memory ends with its mission and a mission leaves an episodic record of what it did",
    requires: [...t(MEMORY, `${mem("service")}::tests::working_memory_expires_with_its_mission`), ...e("P05-E2E-02")],
  },
  {
    id: "P05-MEM7",
    document: "phase-05-memory",
    condition: "memory survives a real restart in a versioned schema, and a deleted entry stays deleted",
    requires: [
      ...t(TRUST, "storage::migrations::tests::migrations_are_ordered_and_end_at_the_supported_version"),
      ...t(AGENT, "p05_restart_keeps_memory_and_closes_open_sessions_honestly"),
      ...e("P05-E2E-24"),
    ],
  },
  {
    id: "P05-MT1",
    document: "phase-05-memory",
    condition: "memory is not truth: it has no verified state, and the same value held in memory leaves a claim unverified without measured evidence",
    requires: [
      ...t(AGENT, "p05_memory_retrieval_obeys_scope_and_memory_never_verifies_a_claim"),
      ...tp(CONTRACTS, "P05-CT-011 "),
      ...e("P05-E2E-03b"),
      ...c("P05-SEC-MEMORY-HAS-NO-TRUST-PATH"),
    ],
  },
  {
    id: "P05-MT2",
    document: "phase-05-memory",
    condition: "an agent's memory proposal waits for a human decision and is stored as unverified model text, never as trusted memory",
    requires: [
      ...t(TRUST, `${mem("policy")}::tests::a_model_cannot_persist_trusted_memory_whatever_it_claims`, `${mem("policy")}::tests::runtime_evidence_links_only_with_an_evidence_reference`),
      ...t(AGENT, "p05_memory_an_agent_proposal_waits_for_approval_and_stays_unverified"),
      ...e("P05-E2E-03"),
    ],
  },
  {
    id: "P05-MT3",
    document: "phase-05-memory",
    condition: "secrets, raw reasoning, page dumps and oversized outputs are refused before storage",
    requires: [
      ...t(TRUST, `${mem("policy")}::tests::secrets_reasoning_pages_and_huge_outputs_are_refused`, `${mem("policy")}::tests::scope_rules_hold_for_every_source`),
      ...tp(TRUST, "p05::secret::tests::"),
      ...e("P05-E2E-03a"),
    ],
  },
  {
    id: "P05-MT4",
    document: "phase-05-memory",
    condition: "conflicting memories surface as conflicts, and a verified source supersedes an unverified one visibly",
    requires: [
      ...t(MEMORY, `${mem("service")}::tests::a_verified_fact_supersedes_an_unverified_one_visibly`, `${mem("retriever")}::tests::two_visible_values_for_one_subject_surface_as_a_conflict`),
    ],
  },

  // ── المتصفّح ───────────────────────────────────────────────────────────────
  {
    id: "P05-B1",
    document: "phase-05-browser",
    condition: "a browser session is created per mission, bound to it and its agent, and moves through a closed set of states",
    requires: [...t(BROWSER, `${br("runtime")}::tests::sessions_are_mission_bound_and_a_closed_session_is_not_reused`), ...tp(PERSIST, "p05::session::tests::"), ...e("P05-E2E-07")],
  },
  {
    id: "P05-B2",
    document: "phase-05-browser",
    condition: "the browser navigates, reads and clicks through the Tool Gateway and records each action and observation",
    requires: [
      ...t(BROWSER, `${br("engine")}::tests::a_fixture_page_is_fetched_and_a_redirect_is_followed_after_a_recheck`, `${br("runtime")}::tests::navigate_type_and_submit_record_an_executed_action_and_an_observation`),
      ...t(AGENT, "p05_browser_a_real_mission_navigates_clicks_and_its_observation_verifies_a_claim"),
      ...e("P05-E2E-08", "P05-E2E-11"),
    ],
  },
  {
    id: "P05-B3",
    document: "phase-05-browser",
    condition: "page content enters as WEB_UNTRUSTED: bounded, hidden text excluded, and fenced as an observation when it reaches a model",
    requires: [
      ...tp(BROWSER, `${br("observation")}::tests::`),
      ...t(BROWSER, `${br("html")}::tests::hidden_content_does_not_become_visible_text`, `${br("html")}::tests::numeric_entities_cannot_smuggle_control_or_bidi_characters`),
      ...e("P05-E2E-09"),
      ...c("OBSERVATION-LABELLED-IN-PROMPT"),
    ],
  },
  {
    id: "P05-B4",
    document: "phase-05-browser",
    condition: "a prompt-injection page reaches the next agent fenced, and changes no policy, skill, model or approval",
    requires: [...t(AGENT, "p05_browser_a_prompt_injection_page_changes_nothing"), ...e("P05-E2E-10"), ...c("INJECTION-FENCED")],
  },
  {
    id: "P05-B5",
    document: "phase-05-browser",
    condition: "only http and https are navigable; loopback, private, link-local, metadata, script and file destinations and redirects to them are refused",
    requires: [
      ...tp(BSEC, `${br("url_policy")}::tests::`),
      ...t(BSEC, "net::endpoint::tests::a_web_destination_refuses_private_literals_and_keeps_names_for_connect_time_checks"),
      ...t(BROWSER, `${br("engine")}::tests::a_redirect_to_a_private_or_unlisted_address_is_refused_before_connecting`, `${br("engine")}::tests::the_product_policy_refuses_the_same_loopback_page`, `${br("runtime")}::tests::a_javascript_or_private_destination_is_refused_and_recorded`),
      ...t(AGENT, "p05_browser_a_metadata_destination_is_refused_by_policy"),
      ...e("P05-E2E-13a"),
      ...c("P05-SEC-NAVIGATION-POLICY"),
    ],
  },
  {
    id: "P05-B6",
    document: "phase-05-browser",
    condition: "a click that submits or has a side effect is an external side effect that waits for a human decision",
    requires: [
      ...tp(BSEC, `${br("classify")}::tests::`),
      ...t(AGENT, "p05_browser_a_submission_waits_for_approval_and_execution_is_not_outcome_verification"),
      ...e("P05-E2E-12"),
    ],
  },
  {
    id: "P05-B7",
    document: "phase-05-browser",
    condition: "a download is approved, bounded, quarantined, flagged and never run; an upload can name only a quarantined download",
    requires: [
      ...t(BROWSER, `${br("runtime")}::tests::an_executable_download_is_quarantined_flagged_and_never_run`, `${br("html")}::tests::executable_links_are_flagged_as_downloads`),
      ...e("P05-E2E-12a"),
      ...c("P05-SEC-DOWNLOAD-QUARANTINED"),
    ],
  },
  {
    id: "P05-B8",
    document: "phase-05-browser",
    condition: "an oversized page is refused, a malformed page is still read, and the navigation budget holds before any fetch",
    requires: [
      ...t(BROWSER, `${br("engine")}::tests::an_oversized_body_is_refused_not_truncated_silently`, `${br("html")}::tests::a_malformed_page_is_read_without_failing`, `${br("runtime")}::tests::the_navigation_budget_is_enforced_before_the_fetch`),
      ...e("P05-E2E-13a"),
    ],
  },
  {
    id: "P05-B9",
    document: "phase-05-browser",
    condition: "no credential, cookie or password value reaches a web page",
    requires: [...c("WEB-FIXTURE-NO-CREDENTIAL", "P05-SEC-NO-CREDENTIAL-TO-WEB")],
  },

  // ── الحاسوب ────────────────────────────────────────────────────────────────
  {
    id: "P05-C1",
    document: "phase-05-computer",
    condition: "a computer session exists only on a window the user granted to that mission, and the grant ends with the mission",
    requires: [
      ...t(
        COMPUTER,
        `${pc("runtime")}::tests::no_grant_means_no_observation_and_no_action`,
        `${pc("runtime")}::tests::a_window_granted_to_another_mission_cannot_be_targeted`,
        `${pc("runtime")}::tests::a_finished_mission_releases_its_window_but_a_waiting_one_keeps_it`,
        `${pc("runtime")}::tests::polaris_own_window_is_never_grantable`,
      ),
      ...t(AGENT, "p05_computer_a_window_granted_to_another_mission_is_not_reachable"),
      ...tp(UI, "P05-UI-021 ", "P05-UI-021a "),
      ...e("P05-E2E-14", "P05-E2E-18b"),
    ],
  },
  {
    id: "P05-C2",
    document: "phase-05-computer",
    condition: "window identity is strong: handle, process id, process start time and executable, so a reused process id is a different window",
    requires: [...tp(CSEC, `${pc("port")}::tests::`), ...t(COMPUTER, `${pc("runtime")}::tests::a_reused_process_id_breaks_the_grant`), ...e("P05-E2E-15"), ...c("DESKTOP-ONLY-FIXTURE-TOUCHED")],
  },
  {
    id: "P05-C3",
    document: "phase-05-computer",
    condition: "screen observations are window-scoped, tainted UNTRUSTED_CONTENT, stored as digests and fenced when they reach a model",
    requires: [...e("P05-E2E-16"), ...c("SCREEN-OBSERVATION-IN-PROMPT", "P05-SEC-OBSERVATIONS-STORED-AS-DIGESTS")],
  },
  {
    id: "P05-C4",
    document: "phase-05-computer",
    condition: "a safe click runs through the Tool Gateway, bound to the observation it was planned on, and a new observation shows its effect",
    requires: [
      ...t(COMPUTER, `${pc("runtime")}::tests::a_safe_click_executes_and_the_new_observation_shows_its_effect`, `${pc("runtime")}::tests::an_obscured_point_receives_no_click`),
      ...t(AGENT, "p05_computer_a_real_mission_observes_and_clicks_through_the_gateway"),
      ...e("P05-E2E-17"),
      ...c("DESKTOP-FIXTURE-STATE"),
    ],
  },
  {
    id: "P05-C5",
    document: "phase-05-computer",
    condition: "an action planned on a stale observation is rejected and nothing is clicked at its coordinates",
    requires: [...t(COMPUTER, `${pc("runtime")}::tests::a_stale_observation_is_rejected_and_nothing_is_clicked`), ...t(AGENT, "p05_computer_a_stale_observation_is_rejected"), ...e("P05-E2E-18")],
  },
  {
    id: "P05-C6",
    document: "phase-05-computer",
    condition: "security prompts and credential dialogs are refused, a password field never receives text, and a destructive control waits for a decision",
    requires: [
      ...tp(CSEC, `${pc("risk")}::tests::`),
      ...t(COMPUTER, `${pc("runtime")}::tests::a_password_field_is_refused_and_a_destructive_button_needs_approval`),
      ...t(AGENT, "p05_computer_a_destructive_button_waits_for_approval_and_a_denial_sends_nothing"),
      ...e("P05-E2E-18a", "P05-E2E-18b"),
      ...c("P05-SEC-SENSITIVE-SURFACES-REFUSED"),
    ],
  },
  {
    id: "P05-C7",
    document: "phase-05-computer",
    condition: "cancelling a mission stops its computer actions and releases its window",
    requires: [...t(COMPUTER, `${pc("runtime")}::tests::after_a_cancel_no_input_is_sent`), ...e("P05-E2E-19")],
  },
  {
    id: "P05-C8",
    document: "phase-05-computer",
    condition: "capabilities are fine-grained, keys come from a closed list, and there is no full desktop control",
    requires: [...tp(SKILL, "p05::tooling::tests::"), ...t(CSEC, `${pc("port")}::tests::keys_come_from_a_closed_list`), ...c("P05-SEC-NO-CATCH-ALL-CAPABILITY")],
  },

  // ── تكامل الوكيل ───────────────────────────────────────────────────────────
  {
    id: "P05-AI1",
    document: "phase-05-agent-integration",
    condition: "an agent uses memory and the browser within one real mission",
    requires: [...e("P05-E2E-20"), ...t(AGENT, "p05_memory_retrieval_obeys_scope_and_memory_never_verifies_a_claim")],
  },
  {
    id: "P05-AI2",
    document: "phase-05-agent-integration",
    condition: "an agent reaches the computer only through a skill that names the tool and the Tool Gateway",
    requires: [...e("P05-E2E-21"), ...t(AGENT, "p05_computer_a_real_mission_observes_and_clicks_through_the_gateway")],
  },
  {
    id: "P05-AI3",
    document: "phase-05-agent-integration",
    condition: "the Phase-05 skills and tools register in the Phase-04 registry without refusal, and the web policy stays with trusted built-in tools",
    requires: [
      ...t(SKILL, "services::host::tests::phase05_registers_its_tools_and_skills_in_the_phase04_registry_without_refusal", "p05::skill::tests::no_phase05_skill_is_open_ended", "p04::tool::tests::only_a_trusted_builtin_network_tool_keeps_the_web_navigation_policy"),
      ...t(BROWSER, `${br("tools")}::tests::only_network_tools_carry_the_web_policy_and_writes_need_approval`),
      ...e("P05-E2E-01"),
    ],
  },
  {
    id: "P05-AI4",
    document: "phase-05-agent-integration",
    condition: "browser and computer evidence reaches the truth layer and verifies claims about what was observed",
    requires: [...e("P05-E2E-22"), ...t(AGENT, "p05_browser_a_real_mission_navigates_clicks_and_its_observation_verifies_a_claim")],
  },
  {
    id: "P05-AI5",
    document: "phase-05-agent-integration",
    condition: "an executed action is not a verified outcome: only a value actually observed verifies a claim",
    requires: [
      ...t(EVIDENCE, "p03::runtime::tests::an_observed_value_matches_only_what_was_actually_shown", "p04::gateway::tests::an_assessment_can_widen_the_effects_but_never_narrow_them"),
      ...t(AGENT, "p05_browser_a_submission_waits_for_approval_and_execution_is_not_outcome_verification"),
      ...e("P05-E2E-23"),
    ],
  },
  {
    id: "P05-AI6",
    document: "phase-05-agent-integration",
    condition: "an approval shows a host-written summary — agent, mission, action, target, effect, risk, arguments — and no agent can approve itself",
    requires: [...tp(UI, "P05-UI-030 "), ...tp(CONTRACTS, "P05-CT-016 "), ...tp(APPROVAL, "p04::approval::tests::"), ...e("P05-E2E-12", "P05-E2E-03")],
  },
  {
    id: "P05-AI7",
    document: "phase-05-agent-integration",
    condition: "cancellation stops an in-flight navigation and the next desktop action, leaving nothing in flight",
    requires: [
      ...t(BROWSER, `${br("engine")}::tests::a_slow_page_times_out_and_a_cancel_stops_it_in_flight`),
      ...t(AGENT, "p05_browser_cancellation_stops_an_in_flight_navigation"),
      ...g(CANCEL),
      ...e("P05-E2E-13", "P05-E2E-19"),
    ],
  },
  {
    id: "P05-AI8",
    document: "phase-05-agent-integration",
    condition: "the Memory, Browser & Computer and Mission Detail screens show host state honestly, in Arabic right to left and English left to right",
    requires: [
      ...tp(UI, "P05-UI-010 ", "P05-UI-011 ", "P05-UI-020 ", "P05-UI-022 ", "P05-UI-023 ", "P05-UI-040 ", "P05-UI-041 ", "P05-UI-042 ", "P05-UI-043 "),
      ...e("P05-E2E-20a", "P05-E2E-25", "P05-E2E-26"),
    ],
  },

  // ── الأمن ──────────────────────────────────────────────────────────────────
  {
    id: "P05-S1",
    document: "phase-05-security",
    condition: "no IPC operation or renderer method navigates, clicks, types, executes or raises memory trust",
    requires: [...c("P05-SEC-NO-ACTION-OPERATION", "P05-SEC-RENDERER-CANNOT-ACT"), ...tp(CONTRACTS, "P05-CT-010 "), ...tp(UI, "P05-UI-001 ", "P05-UI-002 ")],
  },
  {
    id: "P05-S2",
    document: "phase-05-security",
    condition: "no Phase-05 source spawns a process, and unsafe code lives only in the named Win32 file",
    requires: [...c("P05-SEC-NO-PROCESS-SPAWN", "P05-SEC-UNSAFE-CONFINED")],
  },
  {
    id: "P05-S3",
    document: "phase-05-security",
    condition: "no test fixture is reachable from the product path, and the measurement command is feature-gated and read-only",
    requires: [...c("P05-SEC-NO-FIXTURE-IN-PRODUCT-PATH", "P05-SEC-MEASUREMENT-GATED-AND-READ-ONLY")],
  },
  {
    id: "P05-S4",
    document: "phase-05-security",
    condition: "no secret appears in Phase-05 source, in what the renderer received, or in canonical evidence",
    requires: [...c("P05-SEC-NO-SECRET-IN-SOURCE", "E2E-REPORT-NO-SECRET", "P05-EVIDENCE-NO-SECRET"), ...tp(CONTRACTS, "P05-CT-014 ")],
  },
  {
    id: "P05-S5",
    document: "phase-05-security",
    condition: "canonical evidence carries no reasoning trace and no page, screen or planted secret text",
    requires: [...c("P05-EVIDENCE-NO-REASONING-FIELD", "P05-EVIDENCE-NO-UNTRUSTED-CONTENT"), ...tp(CONTRACTS, "P05-CT-013 ")],
  },
  {
    id: "P05-S6",
    document: "phase-05-security",
    condition: "every Phase-05 boundary error code is one the contract declares",
    requires: [...c("P05-SEC-CANONICAL-ERROR-CODES"), ...tp(CONTRACTS, "P05-CT-015 ")],
  },

  // ── التشغيل الأصلي ─────────────────────────────────────────────────────────
  {
    id: "P05-N1",
    document: "phase-05-native-e2e",
    condition: "the native E2E ran on Windows against freshly built binaries, with every fixture labelled TEST FIXTURE",
    requires: [...c("NATIVE-PERFORMED", "FIXTURE-LABELLED-TEST-FIXTURE", "FIXTURE-RECEIVED-AGENT-CALLS", "FIXTURE-NO-AUTHORIZATION-HEADER")],
  },
  {
    id: "P05-N2",
    document: "phase-05-native-e2e",
    condition: "every required scenario is recorded, and each one that is not measured in the window says where it is measured",
    requires: [...c("NATIVE-SCENARIOS-COMPLETE")],
  },
  {
    id: "P05-N3",
    document: "phase-05-native-e2e",
    condition: "the product restarts with honest state, exits cleanly, and leaves zero owned survivor processes",
    requires: [...e("P05-E2E-24", "P05-E2E-24a", "P05-E2E-27", "P05-E2E-28")],
  },
  {
    id: "P05-N4",
    document: "phase-05-native-e2e",
    condition: "the canonical E2E touched only the harness-owned fixture window and the loopback fixtures, nothing of the user's",
    requires: [...c("DESKTOP-ONLY-FIXTURE-TOUCHED", "DESKTOP-FIXTURE-STATE", "WEB-FIXTURE-ONLY-LOOPBACK")],
  },

  // ── الانحدار ───────────────────────────────────────────────────────────────
  { id: "P05-R0", document: "phase-05-regression", condition: "the Phase-00 gate was re-run inside this run and is still PASS", requires: [{ type: "gate", phase: "PHASE-00" }] },
  { id: "P05-R1", document: "phase-05-regression", condition: "the Phase-01 gate was re-run inside this run, is still PASS, and still opens Phase-02", requires: [{ type: "gate", phase: "PHASE-01" }] },
  { id: "P05-R2", document: "phase-05-regression", condition: "the Phase-02 gate was re-run inside this run, is still PASS, and still opens Phase-03", requires: [{ type: "gate", phase: "PHASE-02" }] },
  { id: "P05-R3", document: "phase-05-regression", condition: "the Phase-03 gate was re-run inside this run, is still PASS, and still opens Phase-04", requires: [{ type: "gate", phase: "PHASE-03" }] },
  { id: "P05-R4", document: "phase-05-regression", condition: "the Phase-04 gate was re-run inside this run, is still PASS, and still opens Phase-05", requires: [{ type: "gate", phase: "PHASE-04" }] },

  // ── الأداء والتشغيل والبوابة ───────────────────────────────────────────────
  {
    id: "P05-P1",
    document: "phase-05-performance",
    condition: "the nine required timings are locally measured, each with its method, and each says whether it includes provider or server time",
    requires: [...c("PERFORMANCE-MEASURED", "PERFORMANCE-COVERS-REQUIRED", "PERFORMANCE-EXCLUDES-PROVIDER-TIME")],
  },
  {
    id: "P05-Q1",
    document: "phase-05-final-gate",
    condition: "the contract layer carries the Phase-05 vocabulary additively on envelope 1.5, with no new major version and no action operation",
    requires: [...g(CONTRACTS), ...tp(CONTRACTS, "P05-CT-001 ", "P05-CT-009 ", "P05-CT-010 ")],
  },
  {
    id: "P05-Q2",
    document: "phase-05-run",
    condition: "the whole host workspace and the whole renderer pass their own suites and their lint, and every Phase-05 group passes",
    requires: [
      ...g("P05-HOST-CORE", "P05-HOST-BINDING", "P05-HOST-LINT", "P05-RENDERER", "P05-RENDERER-UI"),
      ...g(MEMORY, TRUST, BROWSER, BSEC, COMPUTER, CSEC, AGENT, SKILL, EVIDENCE, CANCEL, APPROVAL, PERSIST),
    ],
  },
  {
    id: "P05-Q3",
    document: "phase-05-run",
    condition: "the Phase-05 instruments are themselves tested, so the measurement is not trusted on faith",
    requires: [...g("P05-TOOLS")],
  },
  {
    id: "P05-Q4",
    document: "phase-05-final-gate",
    condition: "every canonical Phase-05 document is UTF-8 with no BOM, LF only, valid JSON and exactly one final newline",
    requires: [{ type: "bytes" }],
  },
  {
    id: "P05-Q5",
    document: "phase-05-final-gate",
    condition: "no security-bearing group hid a skip, and both security scans actually ran",
    requires: [{ type: "no-skip" }],
  },
]);
