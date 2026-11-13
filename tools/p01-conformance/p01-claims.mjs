// مصفوفة بوابة Phase-01 كبيانات.
//
// الجدول في `PHASE-01-GATE-MATRIX.md` هو العقد، وهذا هو تمثيله الذي يُنفَّذ. وجود
// نسختين — واحدة تُقرأ وواحدة تُشغَّل — هو ما يجعل حذف ادعاء صعبًا: حذفه من هنا
// يُظهره ناقصًا هناك، وحذفه من هناك لا يُسكته هنا.
//
// كل ادعاء يُعلن ما يقيسه، لا ما يتمناه. `requires` قائمة شروط، وكلها يجب أن
// تكون PASS. والتجميع لا يرقّي أبدًا: أي شرط FAIL يجعل الادعاء FAIL، وأي شرط
// NOT_TESTED يجعله NOT_TESTED.

/**
 * أنواع الشروط:
 *  - `group`   : مجموعة اختبار في `phase-01-test-groups`
 *  - `native`  : قسم في `phase-01-desktop-e2e` (launch | window | scaling | exit)
 *  - `scenario`: سيناريو في `phase-01-desktop-e2e.scenarios`
 *  - `document`: حكم وثيقة دليل أخرى
 *  - `fact`    : حقيقة بنيوية تحسبها أداة الاشتقاق
 */
/**
 * `document` هو المكان الذي يُكتب فيه سجل الادعاء، و`cites` هو المستند الذي يعيش
 * فيه قياسه حين يكون غير ذلك. الفصل ضروري لأن مستندات القياس تكتبها أدوات القياس
 * نفسها، وكاتبٌ ثانٍ يُلحق بها سجلات ادعاءات كان سينقض ملكيتها الواحدة.
 */
export const P01_CLAIMS = Object.freeze([
  {
    id: "P01-B1",
    condition: "the Phase-01 build toolchain exists on the Windows host",
    work_package: "W1",
    tier: "Windows",
    document: "phase-01-baseline",
    requires: [{ kind: "document", name: "phase-01-baseline", field: "verdict" }],
  },
  {
    id: "P01-C1",
    condition: "IPCEnvelopeV1 1.1 verifies and 1.0 documents remain valid",
    work_package: "W2",
    tier: "any",
    document: "phase-01-ipc",
    requires: [
      { kind: "document", name: "phase-01-ipc", field: "verdict" },
      { kind: "group", id: "P01-CONTRACTS" },
    ],
  },
  {
    id: "P01-C2",
    condition:
      "every Phase-01 operation has request schema, response schema, error behaviour, trust boundary and owning service",
    work_package: "W2",
    tier: "any",
    document: "phase-01-ipc",
    requires: [
      { kind: "document", name: "phase-01-ipc", field: "verdict" },
      { kind: "group", id: "P01-HOST-CORE" },
      { kind: "fact", id: "every_routed_operation_has_an_owning_service" },
    ],
  },
  {
    id: "P01-C3",
    condition: "no generic dispatch endpoint exists in the host",
    work_package: "W2/W3",
    tier: "any",
    document: "phase-01-security",
    requires: [
      { kind: "group", id: "P01-HOST-GATEWAY" },
      { kind: "fact", id: "host_exposes_one_command_only" },
      { kind: "fact", id: "no_shell_or_filesystem_permission_granted" },
    ],
  },
  {
    id: "P01-H1",
    condition: "the native host builds",
    work_package: "W3",
    tier: "Windows",
    document: "phase-01-run",
    requires: [{ kind: "fact", id: "host_release_build_succeeded" }],
  },
  {
    id: "P01-H2",
    condition: "the renderer builds",
    work_package: "W3",
    tier: "any",
    document: "phase-01-run",
    requires: [{ kind: "fact", id: "renderer_build_succeeded" }],
  },
  {
    id: "P01-H3",
    condition: "the desktop application launches natively on Windows",
    work_package: "W3/W9",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-desktop-e2e",
    requires: [{ kind: "native", path: "launch" }],
  },
  {
    id: "P01-H4",
    condition: "bootstrap completes and the renderer hydrates from the host",
    work_package: "W3",
    tier: "any + Windows",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-HOST-GATEWAY" },
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "scenario", id: "D1" },
      { kind: "scenario", id: "H4" },
    ],
  },
  {
    id: "P01-H5",
    condition: "bootstrap failure produces an honest recoverable error, not invented defaults",
    work_package: "W3/W8",
    tier: "any",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-HOST-GATEWAY" },
    ],
  },
  {
    id: "P01-S1",
    condition: "an unknown IPC operation is denied",
    work_package: "W3/W10",
    tier: "any + Windows",
    document: "phase-01-security",
    requires: [
      { kind: "group", id: "P01-HOST-GATEWAY" },
      { kind: "scenario", id: "D9" },
    ],
  },
  {
    id: "P01-S2",
    condition: "a malformed envelope is rejected",
    work_package: "W3/W10",
    tier: "any",
    document: "phase-01-security",
    requires: [
      { kind: "group", id: "P01-HOST-GATEWAY" },
      { kind: "scenario", id: "D10" },
    ],
  },
  {
    id: "P01-S3",
    condition: "a schema-valid but unrouted operation is refused by the gateway",
    work_package: "W3/W10",
    tier: "any",
    document: "phase-01-security",
    requires: [{ kind: "group", id: "P01-HOST-GATEWAY" }],
  },
  {
    id: "P01-S4",
    condition: "no secret-like value appears in the bootstrap snapshot",
    work_package: "W3/W10",
    tier: "any",
    document: "phase-01-security",
    requires: [
      { kind: "group", id: "P01-HOST-GATEWAY" },
      { kind: "group", id: "P01-HOST-CORE" },
    ],
  },
  {
    id: "P01-S5",
    condition: "error detail reaching the renderer is redacted; no stack trace by default",
    work_package: "W8/W10",
    tier: "any",
    document: "phase-01-security",
    requires: [
      { kind: "group", id: "P01-HOST-GATEWAY" },
      { kind: "group", id: "P01-RENDERER-IPC" },
      { kind: "scenario", id: "S5" },
      { kind: "fact", id: "no_boundary_error_type_carries_internal_detail" },
    ],
  },
  {
    id: "P01-S6",
    condition: "a later-phase unavailable action cannot be executed from the UI",
    work_package: "W5/W10",
    tier: "any + Windows",
    document: "phase-01-security",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "scenario", id: "S6" },
    ],
  },
  {
    id: "P01-S7",
    condition: "the STRIDE review covers all seven Phase-01 surfaces with a finding disposition each",
    work_package: "W10",
    tier: "n/a",
    document: "phase-01-security",
    requires: [{ kind: "fact", id: "stride_review_covers_seven_surfaces" }],
  },
  {
    id: "P01-N1",
    condition: "navigation works across all ten sections",
    work_package: "W4/W9",
    tier: "any + Windows",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-RENDERER-ROUTES" },
      { kind: "scenario", id: "D2" },
    ],
  },
  {
    id: "P01-N2",
    condition: "unknown routes are handled safely",
    work_package: "W4",
    tier: "any",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-ROUTES" },
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "scenario", id: "D8" },
    ],
  },
  {
    id: "P01-U1",
    condition: "Home renders with no fake operational data",
    work_package: "W5",
    tier: "any",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "fact", id: "no_invented_metric_in_the_renderer_source" },
    ],
  },
  {
    id: "P01-U2",
    condition: "every unavailable feature is classified with a state and a reason",
    work_package: "W5",
    tier: "any",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-HOST-CORE" },
      { kind: "scenario", id: "D6" },
    ],
  },
  {
    id: "P01-U3",
    condition: 'the model entry point lists only real configured models, else "no models configured"',
    work_package: "W5",
    tier: "any",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "fact", id: "no_model_name_is_hard_coded" },
    ],
  },
  {
    id: "P01-U4",
    condition: "the Settings shell opens and every setting declares ACTIVE, READ_ONLY or UNAVAILABLE_THIS_PHASE",
    work_package: "W6",
    tier: "any + Windows",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-HOST-CORE" },
      { kind: "scenario", id: "D7" },
    ],
  },
  {
    id: "P01-U5",
    condition: "no control appears to work while doing nothing",
    work_package: "W6",
    tier: "any",
    document: "phase-01-run",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-HOST-CORE" },
    ],
  },
  {
    id: "P01-U6",
    condition: "theme switching works for light, dark and system",
    work_package: "W4/W9",
    tier: "any + Windows",
    document: "phase-01-run",
    cites: "phase-01-desktop-e2e",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "scenario", id: "D5" },
    ],
  },
  {
    id: "P01-L1",
    condition: "Arabic renders RTL",
    work_package: "W7/W9",
    tier: "any + Windows",
    document: "phase-01-localization",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-RENDERER-L10N" },
      { kind: "scenario", id: "D4" },
    ],
  },
  {
    id: "P01-L2",
    condition: "English renders LTR",
    work_package: "W7/W9",
    tier: "any + Windows",
    document: "phase-01-localization",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "group", id: "P01-RENDERER-L10N" },
      { kind: "scenario", id: "D4" },
    ],
  },
  {
    id: "P01-L3",
    condition: "no hard-coded user-facing string in any component",
    work_package: "W7",
    tier: "any",
    document: "phase-01-localization",
    requires: [{ kind: "group", id: "P01-RENDERER-STRINGS" }],
  },
  {
    id: "P01-L4",
    condition: "no missing key in ar or en; the nine-locale structure resolves with fallback",
    work_package: "W7",
    tier: "any",
    document: "phase-01-localization",
    requires: [
      { kind: "group", id: "P01-RENDERER-L10N" },
      { kind: "fact", id: "nine_locale_catalogs_exist" },
    ],
  },
  {
    id: "P01-A1",
    condition: "keyboard navigation reaches every interactive element with visible focus",
    work_package: "W8/W9",
    tier: "any + Windows",
    document: "phase-01-accessibility",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "fact", id: "focus_visible_rule_exists" },
      { kind: "scenario", id: "D2" },
    ],
  },
  {
    id: "P01-A2",
    condition: "landmarks, semantic controls, form labels and dialog semantics are correct",
    work_package: "W8",
    tier: "any",
    document: "phase-01-accessibility",
    requires: [{ kind: "group", id: "P01-RENDERER-UI" }],
  },
  {
    id: "P01-A3",
    condition: "no icon-only action lacks an accessible name",
    work_package: "W8",
    tier: "any",
    document: "phase-01-accessibility",
    requires: [
      { kind: "group", id: "P01-RENDERER-UI" },
      { kind: "fact", id: "decorative_graphics_are_hidden_from_assistive_technology" },
    ],
  },
  {
    id: "P01-W1x",
    condition: "layout holds at 100%, 125% and 150% Windows scaling",
    work_package: "W9",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-desktop-e2e",
    requires: [{ kind: "native", path: "scaling" }],
  },
  {
    id: "P01-W2x",
    condition: "window minimum size, restore and maximize behave; no off-screen restore",
    work_package: "W9",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-desktop-e2e",
    requires: [{ kind: "native", path: "window" }],
  },
  {
    id: "P01-P1",
    condition:
      "cold startup, renderer ready, bootstrap latency, navigation latency and settings render are measured, each labelled measured / estimated / unknown",
    work_package: "W9",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-performance",
    requires: [{ kind: "document", name: "phase-01-performance", field: "verdict" }],
  },
  {
    id: "P01-E1",
    condition: "the app exits cleanly with no survivor process",
    work_package: "W9",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-desktop-e2e",
    requires: [{ kind: "native", path: "exit" }],
  },
  {
    id: "P01-R1",
    condition: "the Phase-00 canonical gate re-runs clean after Phase-01 changes",
    work_package: "W10",
    tier: "Windows",
    document: "phase-01-regression",
    requires: [{ kind: "fact", id: "phase_00_gate_passes_after_phase_01" }],
  },
  {
    id: "P01-R2",
    condition: "no Phase-00 security invariant weakened and no accepted ADR changed",
    work_package: "W10",
    tier: "any",
    document: "phase-01-regression",
    requires: [
      { kind: "fact", id: "phase_00_claim_set_unchanged" },
      { kind: "fact", id: "no_phase_00_verdict_weakened" },
    ],
  },
  {
    id: "P01-T1",
    condition: "every Phase-01 test group reports with exact counts and no unexplained skip",
    work_package: "W9/W12",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-test-groups",
    requires: [{ kind: "fact", id: "every_group_reported_exact_counts" }],
  },
  {
    id: "P01-T2",
    condition: "no security-critical test is skipped",
    work_package: "W12",
    tier: "Windows",
    document: "phase-01-run",
    cites: "phase-01-test-groups",
    requires: [{ kind: "fact", id: "no_security_critical_test_skipped" }],
  },
  {
    id: "P01-V1",
    condition: "every canonical Phase-01 evidence document satisfies the byte contract",
    work_package: "W12",
    tier: "any",
    document: "phase-01-final-gate",
    requires: [{ kind: "fact", id: "evidence_byte_contract_clean" }],
  },
  {
    id: "P01-V2",
    condition: "the dogfood scenarios pass",
    work_package: "W11",
    tier: "Windows",
    document: "phase-01-run",
    requires: [{ kind: "fact", id: "every_dogfood_scenario_accounted_for" }],
  },
]);

/** الادعاءات التي تعيش في وثيقة بعينها. */
export function claimsForDocument(name) {
  return P01_CLAIMS.filter((claim) => claim.document === name);
}

/** تجميع لا يرقّي: الأسوأ يفوز، وترتيب السوء معلن. */
export function aggregate(verdicts) {
  if (verdicts.length === 0) return "NOT_TESTED";
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("BLOCKED")) return "BLOCKED";
  if (verdicts.includes("NOT_TESTED")) return "NOT_TESTED";
  if (verdicts.includes("INCONCLUSIVE")) return "INCONCLUSIVE";
  return "PASS";
}
