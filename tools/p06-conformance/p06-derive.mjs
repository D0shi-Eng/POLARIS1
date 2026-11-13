// اشتقاق أدلة Phase-06 القانونية من القياسات الخام.
//
// لا يقيس هذا الملف شيئًا: يقرأ ما قاسه غيره ويكتب الوثائق. كل وثيقة تحمل شروطها
// وأحكامها ومصادرها، والحكم يأتي من التقييم لا من يد كاتب. ولا ينسخ نصّ خدمة ولا مفتاحًا:
// من سجلّ التجهيزة تُنقل أعداد ومسارات فقط.
//
// الاستعمال: node p06-derive.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P06_CLAIMS } from "./p06-claims.mjs";
import { argument, evidenceSuffix, header, P06_EVIDENCE, P06_TOOLS, RAW_DIRECTORY, readJson, worst, writeEvidence } from "./p06-common.mjs";
import { E2E_IDS, e2eVerdict, evaluateAll, performanceRows, REQUIRED_TIMINGS, windowReport } from "./p06-evaluate.mjs";

/** يقرأ كل ما قاسه المشغّل. غياب ملف ليس خطأً هنا: الشرط الذي يقرؤه يحكم بغيابه. */
export function loadInputs(root) {
  const raw = (name) => readJson(join(root, RAW_DIRECTORY, name));
  const run = raw("run.local.json");
  return {
    run,
    runStarted: run?.run_started ?? null,
    regressionMode: run?.regression_mode ?? "RERUN",
    groups: raw("groups.local.json")?.groups ?? [],
    native: raw("native.local.json"),
    securityStatic: raw("security-static.local.json"),
    securityEvidence: raw("security-evidence.local.json"),
    bytes: raw("evidence-bytes.local.json"),
    phase00Gate: readJson(join(root, "evidence", "phase-00-final-gate.json")),
    phase01Gate: readJson(join(root, "evidence", "phase-01-final-gate.json")),
    phase02Gate: readJson(join(root, "evidence", "phase-02-final-gate.json")),
    phase03Gate: readJson(join(root, "evidence", "phase-03-final-gate.json")),
    phase04Gate: readJson(join(root, "evidence", "phase-04-final-gate.json")),
    phase05Gate: readJson(join(root, "evidence", "phase-05-final-gate.json")),
  };
}

function scenarioRows(inputs) {
  const byId = new Map();
  for (const stage of ["first", "restart"]) {
    for (const scenario of windowReport(inputs, stage)?.scenarios ?? []) {
      // E2E-01 يُقاس في الطورين؛ الطور الأول هو المرجع وما بعده تأكيد.
      if (!byId.has(scenario.id) || scenario.status !== "NOT_TESTED") {
        if (!byId.has(scenario.id) || byId.get(scenario.id).status === "NOT_TESTED") byId.set(scenario.id, { ...scenario, stage });
      }
    }
  }
  // ما يقيسه المشغّل من خارج النافذة يُكتب بحكمه المقيس من سجلّ الإطلاق، لا بعلامة النافذة.
  for (const id of ["P06-E2E-24", "P06-E2E-25"]) {
    const measured = e2eVerdict(inputs, id);
    byId.set(id, { id, title: byId.get(id)?.title ?? "", status: measured.verdict, detail: measured.detail, stage: "runner" });
  }
  return E2E_IDS.map((id) => byId.get(id) ?? { id, title: "", status: "NOT_TESTED", detail: "absent from the native report", stage: null }).concat(
    [...byId.values()].filter((scenario) => !E2E_IDS.includes(scenario.id)),
  );
}

/** حقائق التجهيزتين: أعداد ومسارات وأعلام، بلا جسم ولا ترويسة ولا مفتاح. */
export function fixtureFacts(inputs) {
  const native = inputs.native;
  const requests = Array.isArray(native?.fixture_log?.requests) ? native.fixture_log.requests : [];
  const completions = requests.filter((entry) => entry.kind === "completion");
  const connector = Array.isArray(native?.fixture_log?.connector_requests) ? native.fixture_log.connector_requests : [];
  const paths = {};
  for (const entry of connector) paths[`${entry.method} ${entry.path}`] = (paths[`${entry.method} ${entry.path}`] ?? 0) + 1;
  const state = native?.fixture_log?.connector_state ?? null;
  return {
    model_fixture: {
      label: native?.fixture_log?.label ?? null,
      endpoint: native?.fixture_state?.endpoint ?? null,
      completion_calls: completions.length,
      contracts: [...new Set(completions.map((entry) => entry.contract))],
      scenarios: [...new Set(completions.map((entry) => entry.scenario))],
      calls_carrying_an_authorization_header: completions.filter((entry) => entry.carried_authorization === true).length,
      calls_with_a_connector_label: completions.filter((entry) => entry.has_connector_label === true).length,
      calls_carrying_the_injected_text_fenced: completions.filter((entry) => entry.injection_marker_fenced === true).length,
      calls_carrying_the_injected_text_unfenced: completions.filter((entry) => entry.injection_marker_fenced === false).length,
    },
    connector_fixture: {
      label: native?.fixture_log?.label ?? null,
      base: native?.fixture_state?.connector_base ?? null,
      requests: connector.length,
      by_path: paths,
      requests_with_the_expected_credential: connector.filter((entry) => entry.authorised === true).length,
      requests_without_it: connector.filter((entry) => entry.authorised !== true).length,
      creates_with_an_idempotency_key: connector.filter((entry) => entry.method === "POST" && entry.path === "/api/items" && entry.carried_idempotency_key === true).length,
      state:
        state === null
          ? null
          : {
              created: state.created,
              notes: state.notes,
              unprotected_sends: state.unsafe_hits,
              limited_hits: state.limited_hits,
              flaky_hits: state.flaky_hits,
              idempotency_keys_seen: state.idempotency_keys_seen,
            },
    },
    credential_canary: {
      note: "a random credential made for this run; only its SHA-256 and length are recorded",
      sha256: native?.canary_sha256 ?? null,
      length: native?.canary_length ?? null,
      data_directory_scan: native?.canary_scan ?? null,
      probe_report_scan: native?.report_canary ?? null,
      in_process_scan_first: windowReport(inputs, "first")?.facts?.canary_scan_first ?? null,
      in_process_scan_restart: windowReport(inputs, "restart")?.facts?.canary_scan_restart ?? null,
    },
  };
}

function groupsSummary(inputs) {
  return (inputs.groups ?? []).map((group) => ({
    group_id: group.group_id,
    verdict: group.verdict,
    tests: group.counts?.tests ?? null,
    passed: group.counts?.passed ?? null,
    failed: group.counts?.failed ?? null,
    skipped: group.counts?.skipped ?? null,
    duration_ms: group.duration_ms ?? null,
    reason: group.reason ?? "",
  }));
}

function extrasFor(document, inputs) {
  const facts = windowReport(inputs, "first")?.facts ?? {};
  const restartFacts = windowReport(inputs, "restart")?.facts ?? {};
  switch (document) {
    case "phase-06-run":
      return {
        run: { started: inputs.run?.run_started ?? null, environment: inputs.run?.environment ?? null, builds: inputs.run?.builds ?? null, stages: inputs.run?.stages ?? [] },
        groups: groupsSummary(inputs),
      };
    case "phase-06-connectors":
      return {
        framework: {
          providers: ["polaris.rest (generic REST, typed operations, OpenAPI 3 import proposing operations for approval)", "polaris.workspace (project sources, read only)"],
          auth_modes: { supported: ["NONE", "API_KEY", "BEARER_TOKEN", "BASIC"], declared_not_supported: ["OAUTH2"], reason: "no official OAuth 2 flow is implemented in this build; a registration naming it is refused" },
          secret_sources: ["the Windows credential store, referenced as secret://connectors/<id>/default", "a POLARIS_CONNECTOR_ environment variable, when security settings allow it"],
          path: [
            "an agent proposes a tool connector:<id>:<operation> with typed arguments; it never names a URL, a path or a header",
            "the Phase-04 tool gateway: registry, skill binding, arguments, Phase-06 policy overlay, adapter assessment, effects, capability, budget, approval",
            "the connector gateway: enabled, arguments, privacy and egress, side-effect policy, credential, mission call limit, idempotency, budget reservation, rate limit, bounded retries, normalisation",
            "a bounded, labelled summary as untrusted data; a usage record with provenance; an invocation row; an audit record; structured events; health",
          ],
          declared_limits: [
            "connectors are measured against a deterministic loopback TEST FIXTURE; no real external service or credential is a condition of this phase",
            "memory from connector reads is WORKING memory tagged UNTRUSTED_CONTENT with trust class MODEL_GENERATED: the Phase-05 V4 vocabulary has no EXTERNAL trust class",
            "webhooks and polling are declared false on every connector in this build",
          ],
        },
        observed: {
          connector: facts.connector ?? null,
          openapi: facts.openapi ?? null,
          write: facts.write ?? null,
          replay: facts.replay ?? null,
          retries: facts.retries ?? null,
          rate_limit: facts.rate_limit ?? null,
          malicious: facts.malicious ?? null,
        },
      };
    case "phase-06-cost":
      return {
        provenance_vocabulary: ["PROVIDER_REPORTED", "LOCALLY_MEASURED", "ESTIMATED", "UNKNOWN"],
        pricing: "POLARIS ships no price. A price exists only when the user enters it with its source; every cost computed from it is ESTIMATED.",
        budgets: { scopes: ["MISSION", "PROJECT", "DAY", "PROVIDER", "CONNECTOR"], dimensions: ["COST_MICROS", "MODEL_TOKENS", "EXTERNAL_CALLS"], modes: ["SOFT", "HARD"] },
        declared_limits: ["no currency is converted", "this is usage accounting, not billing: no invoice is produced or implied"],
        observed: { records: facts.cost_records ?? null, hard_budget: facts.hard_budget ?? null },
      };
    case "phase-06-observability":
      return {
        separation: {
          audit: "the hash-chained audit ledger: who did what, including every connector invocation, denial and budget event",
          events: "structured diagnostic events: codes, components and timings only; labelled diagnostic, not audit",
          metrics: "bounded counters and latency histograms since this start",
          evidence: "mission evidence that verifies or leaves unverified a claim",
        },
        declared_limits: ["metrics reset at every start", "alerts are local only; nothing is sent anywhere", "no cloud telemetry exists in this build"],
        observed: { restart: restartFacts.restart ?? null },
      };
    case "phase-06-settings":
      return {
        resolution_order: ["DEFAULT", "USER", "PROJECT", "MISSION", "SECURITY_CLAMP"],
        rules: [
          "a project or mission value that would widen a security-bearing setting is ignored and reported",
          "the security layer applies last and cannot raise the build ceiling",
          "a newer config schema fails closed: defaults apply and writes are refused",
          "a sensitive value is shown as configured, source and last update only",
        ],
        observed: { clamp: facts.clamp ?? null, diagnostics_level: facts.diagnostics_level_saved ?? null, restart: restartFacts.restart ?? null },
      };
    case "phase-06-native-e2e":
      return {
        fixture_label: "TEST FIXTURE",
        note: "the loopback model provider and the loopback REST connector are deterministic test fixtures owned by the runner; no real service, account or credential of the user is touched",
        launches: ["first", "restart"].map((stage) => {
          const launch = inputs.native?.[stage] ?? null;
          return {
            stage,
            started: launch?.started ?? false,
            window_appeared: launch?.window_appeared ?? false,
            closed_gracefully: launch?.closed_gracefully ?? false,
            exit_code: launch?.exit_code ?? null,
            surviving_processes: launch?.orphan_processes ?? null,
            reason_codes: launch?.reason_codes ?? [],
          };
        }),
        fixtures: fixtureFacts(inputs),
        scenarios: scenarioRows(inputs),
      };
    case "phase-06-performance":
      return {
        provenance: "LOCALLY_MEASURED",
        note: "means over the samples of this run on this machine; no comparison with any other product is made or implied",
        required: REQUIRED_TIMINGS,
        measurements: performanceRows(inputs),
      };
    case "phase-06-security":
      return { static_checks: inputs.securityStatic?.checks ?? [], evidence_checks: inputs.securityEvidence?.checks ?? [], credential_canary: fixtureFacts(inputs).credential_canary };
    case "phase-06-regression":
      return {
        note: inputs.regressionMode === "PRIOR_GATES" ? "each phase is tested separately (owner policy 2026-09-30): every lower gate is read as its own runner decided it, and must be canonical, PASS and open the next phase; nothing below is re-run" : "a stale prior gate does not count: each regression condition compares the gate's own timestamp with the start of this run",
        regression_mode: inputs.regressionMode,
        run_started: inputs.runStarted ?? null,
        gates: [
          { phase: "PHASE-00", verdict: inputs.phase00Gate?.verdict ?? null, decided_at: inputs.phase00Gate?.decided_at ?? inputs.phase00Gate?.measured_at ?? null },
          { phase: "PHASE-01", verdict: inputs.phase01Gate?.verdict ?? null, decided_at: inputs.phase01Gate?.measured_at ?? null, opens: inputs.phase01Gate?.phase_02_gate ?? null },
          { phase: "PHASE-02", verdict: inputs.phase02Gate?.verdict ?? null, decided_at: inputs.phase02Gate?.measured_at ?? null, opens: inputs.phase02Gate?.phase_03_gate ?? null },
          { phase: "PHASE-03", verdict: inputs.phase03Gate?.verdict ?? null, decided_at: inputs.phase03Gate?.measured_at ?? null, opens: inputs.phase03Gate?.phase_04_gate ?? null },
          { phase: "PHASE-04", verdict: inputs.phase04Gate?.verdict ?? null, decided_at: inputs.phase04Gate?.measured_at ?? null, opens: inputs.phase04Gate?.phase_05_gate ?? null },
          { phase: "PHASE-05", verdict: inputs.phase05Gate?.verdict ?? null, decided_at: inputs.phase05Gate?.measured_at ?? null, opens: inputs.phase05Gate?.phase_06_gate ?? null },
        ],
      };
    default:
      return {};
  }
}

export function derive(root) {
  const inputs = loadInputs(root);
  const evaluated = evaluateAll(inputs);
  const suffix = evidenceSuffix();
  const written = [];
  for (const document of P06_EVIDENCE) {
    const claims = evaluated.filter((claim) => claim.document === document);
    const verdict = claims.length === 0 ? "NOT_TESTED" : worst(claims.map((claim) => claim.verdict));
    const path = join(root, "evidence", `${document}${suffix}.json`);
    writeEvidence(path, { ...header(P06_TOOLS.derive, root, { document }), verdict, conditions: claims.length, claims, ...extrasFor(document, inputs) });
    written.push({ document, verdict, conditions: claims.length, path: `evidence/${document}${suffix}.json` });
  }
  const gateOnly = P06_CLAIMS.filter((claim) => !P06_EVIDENCE.includes(claim.document)).map((claim) => claim.id);
  return { written, gate_only_conditions: gateOnly };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = derive(root);
  for (const entry of result.written) console.log(`${entry.verdict.padEnd(13)} ${entry.path} (${entry.conditions} condition(s))`);
  console.log(`gate-only conditions: ${result.gate_only_conditions.join(", ")}`);
  process.exitCode = 0;
}
