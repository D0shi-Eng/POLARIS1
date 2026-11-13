// اشتقاق أدلة Phase-05 القانونية من القياسات الخام.
//
// لا يقيس هذا الملف شيئًا: يقرأ ما قاسه غيره ويكتب الوثائق. كل وثيقة تحمل شروطها
// وأحكامها ومصادرها، والحكم يأتي من التقييم لا من يد كاتب.
//
// الاستعمال: node p05-derive.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P05_CLAIMS } from "./p05-claims.mjs";
import { argument, evidenceSuffix, header, P05_EVIDENCE, P05_TOOLS, RAW_DIRECTORY, readJson, worst, writeEvidence } from "./p05-common.mjs";
import { E2E_IDS, evaluateAll, performanceRows, REQUIRED_TIMINGS, windowReport } from "./p05-evaluate.mjs";

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
  };
}

function scenarioRows(inputs) {
  const byId = new Map();
  for (const stage of ["first", "restart"]) {
    for (const scenario of windowReport(inputs, stage)?.scenarios ?? []) {
      // E2E-01 يُقاس في الطورين؛ الطور الأول هو المرجع وما بعده تأكيد.
      if (!byId.has(scenario.id) || scenario.status !== "NOT_TESTED") byId.set(scenario.id, { ...scenario, stage });
    }
  }
  return E2E_IDS.map((id) => byId.get(id) ?? { id, title: "", status: "NOT_TESTED", detail: "absent from the native report", stage: null }).concat(
    [...byId.values()].filter((scenario) => !E2E_IDS.includes(scenario.id)),
  );
}

function fixtureFacts(inputs) {
  const native = inputs.native;
  const requests = Array.isArray(native?.fixture_log?.requests) ? native.fixture_log.requests : [];
  const completions = requests.filter((entry) => entry.kind === "completion");
  const web = Array.isArray(native?.fixture_log?.web_requests) ? native.fixture_log.web_requests : [];
  const paths = {};
  for (const entry of web) paths[`${entry.method} ${entry.path}`] = (paths[`${entry.method} ${entry.path}`] ?? 0) + 1;
  const state = native?.desktop?.state ?? null;
  return {
    model_fixture: {
      label: native?.fixture_log?.label ?? null,
      endpoint: native?.fixture_state?.endpoint ?? null,
      completion_calls: completions.length,
      contracts: [...new Set(completions.map((entry) => entry.contract))],
      scenarios: [...new Set(completions.map((entry) => entry.scenario))],
      calls_carrying_an_authorization_header: completions.filter((entry) => entry.carried_authorization === true).length,
      calls_with_a_memory_block: completions.filter((entry) => entry.has_memory_block === true).length,
      calls_with_a_web_observation: completions.filter((entry) => entry.has_web_observation === true).length,
      calls_with_a_screen_observation: completions.filter((entry) => entry.has_screen_observation === true).length,
      calls_carrying_the_injected_text_fenced: completions.filter((entry) => entry.injection_marker_fenced === true).length,
      calls_carrying_the_injected_text_unfenced: completions.filter((entry) => entry.injection_marker_fenced === false).length,
    },
    web_fixture: {
      label: native?.fixture_log?.label ?? null,
      endpoint: native?.fixture_state?.web_endpoint ?? null,
      requests: web.length,
      by_path: paths,
      requests_with_credentials_or_cookies: web.filter((entry) => entry.carried_authorization === true || entry.carried_cookie === true).length,
      password_values_posted: web.filter((entry) => entry.body_has_password_field === true).length,
    },
    desktop_fixture: {
      label: state?.label ?? null,
      pid: state?.pid ?? null,
      hwnd: state?.hwnd ?? null,
      counter: state?.counter ?? null,
      delete_presses: state?.delete_count ?? null,
      shuffled: state?.shuffled ?? null,
      typed_length: typeof state?.typed === "string" ? state.typed.length : null,
      password_length: state?.password_len ?? null,
      events: state?.events ?? [],
      closed_gracefully: native?.desktop?.closed_gracefully ?? null,
      exited: native?.desktop?.exited ?? null,
    },
  };
}

function extrasFor(document, inputs) {
  const facts = windowReport(inputs, "first")?.facts ?? {};
  switch (document) {
    case "phase-05-run":
      return {
        run: { started: inputs.run?.run_started ?? null, environment: inputs.run?.environment ?? null, builds: inputs.run?.builds ?? null, stages: inputs.run?.stages ?? [] },
        groups: (inputs.groups ?? []).map((group) => ({
          group_id: group.group_id,
          verdict: group.verdict,
          tests: group.counts?.tests ?? null,
          passed: group.counts?.passed ?? null,
          failed: group.counts?.failed ?? null,
          skipped: group.counts?.skipped ?? null,
          duration_ms: group.duration_ms ?? null,
          reason: group.reason ?? "",
        })),
      };
    case "phase-05-memory":
      return {
        boundary: [
          "memory is not truth: no memory state is VERIFIED, and memory alone never verifies a claim",
          "an agent writes model text: MODEL_GENERATED, UNVERIFIED, and only after a human decision",
          "a runtime fact links to measured evidence and keeps its model origin",
          "memory reaches a model only inside the MEMORY — UNTRUSTED / NON-AUTHORITATIVE block",
          "deletion erases content, subject, summary and sources; only the fact of deletion remains",
        ],
        observed: { scope: facts.scope ?? null, deletion: facts.deletion ?? null, remember: facts.remember ?? null, restart: windowReport(inputs, "restart")?.facts?.restart ?? null },
      };
    case "phase-05-browser":
      return {
        engine: {
          kind: "POLARIS-owned HTTP/HTML engine over the Phase-02 HTTP client",
          declared_limits: [
            "no JavaScript execution",
            "no subresources (images, scripts, stylesheets) are fetched",
            "no cookies are stored or sent",
            "HTML is parsed tolerantly and bounded; hidden elements do not become text",
          ],
          note: "this is a deliberate reduction of attack surface for this phase; pages that need scripts are outside what it can read",
        },
        observed: { first_web_mission: facts.w1 ?? null, web_refusals: facts.web_refusals ?? null, download: facts.download ?? null, submit: facts.submit ?? null },
      };
    case "phase-05-computer":
      return {
        port: "Win32 through user32/gdi32: EnumWindows, PrintWindow, WindowFromPoint, SetForegroundWindow, SetCursorPos, SendInput",
        declared_limits: [
          "one granted top-level window per mission; POLARIS's own windows are never grantable",
          "controls are read from the window's child windows; controls drawn without child windows are not enumerated",
          "a cancel stops the next input and splits typing into checked chunks; a single click already sent cannot be recalled",
        ],
        observed: { desktop: facts.desktop ?? null, stale: facts.stale ?? null, risky: facts.risky ?? null, type_and_cross: facts.type_and_cross ?? null },
      };
    case "phase-05-agent-integration":
      return {
        path: [
          "a mission created from the window over IPCEnvelopeV1 1.5",
          "the Phase-03 runtime; each agent call receives labelled memory and earlier observations",
          "an agent proposes a typed ToolProposalV1 naming a Phase-05 skill and tool",
          "the Phase-04 Tool Gateway, with the Phase-05 policy assessment widening effects before capability, budget and approval",
          "the browser engine or the Win32 desktop port, bound to the mission's session and grant",
          "a bounded observation, persisted as digests, and a typed tool evidence note",
          "claim verification: an observed value verifies; an executed action alone does not",
        ],
        approval_summaries: { memory: facts.remember?.context ?? null, submit: facts.submit?.context ?? null, destructive: facts.risky?.context ?? null },
      };
    case "phase-05-native-e2e":
      return {
        fixture_label: "TEST FIXTURE",
        note: "the loopback model provider, the loopback web pages and the desktop window are deterministic test fixtures owned by the runner; no real website, account, file or program of the user is touched",
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
    case "phase-05-performance": {
      const rows = performanceRows(inputs);
      return {
        provenance: "LOCALLY_MEASURED",
        note: "means over the samples of this run on this machine; no comparison with any other product is made or implied",
        required: REQUIRED_TIMINGS,
        measurements: rows,
      };
    }
    case "phase-05-security":
      return { static_checks: inputs.securityStatic?.checks ?? [], evidence_checks: inputs.securityEvidence?.checks ?? [] };
    case "phase-05-regression":
      return {
        note: "a stale prior gate does not count: each regression condition compares the gate's own timestamp with the start of this run",
        run_started: inputs.runStarted ?? null,
        gates: [
          { phase: "PHASE-00", verdict: inputs.phase00Gate?.verdict ?? null, decided_at: inputs.phase00Gate?.decided_at ?? inputs.phase00Gate?.measured_at ?? null },
          { phase: "PHASE-01", verdict: inputs.phase01Gate?.verdict ?? null, decided_at: inputs.phase01Gate?.measured_at ?? null, opens: inputs.phase01Gate?.phase_02_gate ?? null },
          { phase: "PHASE-02", verdict: inputs.phase02Gate?.verdict ?? null, decided_at: inputs.phase02Gate?.measured_at ?? null, opens: inputs.phase02Gate?.phase_03_gate ?? null },
          { phase: "PHASE-03", verdict: inputs.phase03Gate?.verdict ?? null, decided_at: inputs.phase03Gate?.measured_at ?? null, opens: inputs.phase03Gate?.phase_04_gate ?? null },
          { phase: "PHASE-04", verdict: inputs.phase04Gate?.verdict ?? null, decided_at: inputs.phase04Gate?.measured_at ?? null, opens: inputs.phase04Gate?.phase_05_gate ?? null },
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
  for (const document of P05_EVIDENCE) {
    const claims = evaluated.filter((claim) => claim.document === document);
    const verdict = claims.length === 0 ? "NOT_TESTED" : worst(claims.map((claim) => claim.verdict));
    const path = join(root, "evidence", `${document}${suffix}.json`);
    writeEvidence(path, { ...header(P05_TOOLS.derive, root, { document }), verdict, conditions: claims.length, claims, ...extrasFor(document, inputs) });
    written.push({ document, verdict, conditions: claims.length, path: `evidence/${document}${suffix}.json` });
  }
  const gateOnly = P05_CLAIMS.filter((claim) => !P05_EVIDENCE.includes(claim.document)).map((claim) => claim.id);
  return { written, gate_only_conditions: gateOnly };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = derive(root);
  for (const entry of result.written) console.log(`${entry.verdict.padEnd(13)} ${entry.path} (${entry.conditions} condition(s))`);
  console.log(`gate-only conditions: ${result.gate_only_conditions.join(", ")}`);
  process.exitCode = 0;
}
