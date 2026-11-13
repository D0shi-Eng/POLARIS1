// اشتقاق أدلة Phase-03 القانونية من القياسات الخام.
//
// لا يقيس هذا الملف شيئًا: يقرأ ما قاسه غيره ويكتب الوثائق. كل وثيقة تحمل
// شروطها وأحكامها ومصادرها، والحكم يأتي من التقييم لا من يد كاتب.
//
// الاستعمال: node p03-derive.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P03_CLAIMS } from "./p03-claims.mjs";
import {
  argument,
  evidenceSuffix,
  header,
  P03_EVIDENCE,
  P03_TOOLS,
  RAW_DIRECTORY,
  readJson,
  worst,
  writeEvidence,
} from "./p03-common.mjs";
import { E2E_IDS, evaluateAll, performanceRows } from "./p03-evaluate.mjs";

/** يقرأ كل ما قاسه المشغّل. غياب ملف ليس خطأً هنا: الشرط الذي يقرؤه يحكم بغيابه. */
export function loadInputs(root) {
  const raw = (name) => readJson(join(root, RAW_DIRECTORY, name));
  const run = raw("run.local.json");
  return {
    run,
    runStarted: run?.run_started ?? null,
    groups: raw("groups.local.json")?.groups ?? [],
    native: raw("native.local.json"),
    securityStatic: raw("security-static.local.json"),
    securityEvidence: raw("security-evidence.local.json"),
    bytes: raw("evidence-bytes.local.json"),
    phase00Gate: readJson(join(root, "evidence", "phase-00-final-gate.json")),
    phase01Gate: readJson(join(root, "evidence", "phase-01-final-gate.json")),
    phase02Gate: readJson(join(root, "evidence", "phase-02-final-gate.json")),
  };
}

function scenarioRows(inputs) {
  const native = inputs.native;
  const first = native?.first?.e2e_report?.renderer ?? native?.first?.e2e_report ?? null;
  const restart = native?.restart?.e2e_report?.renderer ?? native?.restart?.e2e_report ?? null;
  const byId = new Map();
  for (const [stage, report] of [["first", first], ["restart", restart]]) {
    for (const scenario of report?.scenarios ?? []) {
      byId.set(scenario.id, { ...scenario, stage });
    }
  }
  return E2E_IDS.map(
    (id) =>
      byId.get(id) ?? {
        id,
        title: "",
        status: "NOT_TESTED",
        detail: "absent from the native report",
        stage: null,
      },
  ).concat([...byId.values()].filter((scenario) => !E2E_IDS.includes(scenario.id)));
}

/** الحقائق التي تُثبت مسار التوجيه، مقروءة من الطبقة الأصلية وسجل التجهيزة. */
function routingFacts(inputs) {
  const native = inputs.native;
  const report = native?.first?.e2e_report?.renderer ?? native?.first?.e2e_report ?? null;
  const trace = report?.facts?.routing_trace ?? null;
  const requests = Array.isArray(native?.fixture_log?.requests) ? native.fixture_log.requests : [];
  const completions = requests.filter((entry) => entry.kind === "completion");
  return {
    path: [
      "renderer mission.start over IPCEnvelopeV1",
      "Phase-03 gateway and MissionService",
      "Phase02AgentModel, the production adapter",
      "Phase-02 InvocationService",
      "Phase-02 routing and the locality policy",
      "the Phase-02 egress gate",
      "the OpenAI-compatible provider adapter",
      "HTTP over loopback to the TEST FIXTURE",
    ],
    audit_trace: trace,
    fixture: {
      label: native?.fixture_log?.label ?? null,
      endpoint: native?.fixture_state?.endpoint ?? null,
      completion_calls: completions.length,
      models: [...new Set(completions.map((entry) => entry.model))],
      contracts: [...new Set(completions.map((entry) => entry.contract))],
      scenarios: [...new Set(completions.map((entry) => entry.scenario))],
      calls_carrying_an_authorization_header: completions.filter((entry) => entry.carried_authorization === true).length,
      calls_carrying_the_hostile_marker: completions.filter((entry) => entry.hostile_marker === true).length,
    },
  };
}

/** ما تحمله كل وثيقة فوق شروطها. */
function extrasFor(document, inputs, claims) {
  switch (document) {
    case "phase-03-run":
      return {
        run: {
          started: inputs.run?.run_started ?? null,
          environment: inputs.run?.environment ?? null,
          builds: inputs.run?.builds ?? null,
          stages: inputs.run?.stages ?? [],
        },
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
    case "phase-03-native-e2e":
      return {
        fixture_label: "TEST FIXTURE",
        note: "the loopback provider is a deterministic test fixture; it emulates a provider and replaces no part of the product runtime",
        launches: ["first", "restart"].map((stage) => {
          const launch = inputs.native?.[stage] ?? null;
          return {
            stage,
            started: launch?.started ?? false,
            window_appeared: launch?.window_appeared ?? false,
            renderer_origin: launch?.startup_report?.renderer_origin ?? null,
            closed_gracefully: launch?.closed_gracefully ?? false,
            exit_code: launch?.exit_code ?? null,
            surviving_processes: launch?.orphan_processes ?? null,
            reason_codes: launch?.reason_codes ?? [],
          };
        }),
        real_path_traversed: routingFacts(inputs),
        scenarios: scenarioRows(inputs),
      };
    case "phase-03-performance": {
      const rows = performanceRows(inputs);
      return {
        provenance: "LOCALLY_MEASURED",
        note: "orchestration timings exclude provider inference time; any timing that includes a model call is categorised END_TO_END and says so",
        measurements: rows,
        summary: {
          recorded: rows.length,
          orchestration: rows.filter((row) => row.category === "ORCHESTRATION").length,
          end_to_end: rows.filter((row) => row.category === "END_TO_END").length,
        },
      };
    }
    case "phase-03-security":
      return {
        static_checks: inputs.securityStatic?.checks ?? [],
        evidence_checks: inputs.securityEvidence?.checks ?? [],
      };
    case "phase-03-regression":
      return {
        note: "a stale prior gate does not count: each regression condition compares the gate's own timestamp with the start of this run",
        run_started: inputs.native?.run_started ?? inputs.runStarted ?? null,
        gates: [
          { phase: "PHASE-00", verdict: inputs.phase00Gate?.verdict ?? null, decided_at: inputs.phase00Gate?.decided_at ?? inputs.phase00Gate?.measured_at ?? null },
          { phase: "PHASE-01", verdict: inputs.phase01Gate?.verdict ?? null, decided_at: inputs.phase01Gate?.measured_at ?? null, opens: inputs.phase01Gate?.phase_02_gate ?? null },
          { phase: "PHASE-02", verdict: inputs.phase02Gate?.verdict ?? null, decided_at: inputs.phase02Gate?.measured_at ?? null, opens: inputs.phase02Gate?.phase_03_gate ?? null },
        ],
      };
    case "phase-03-truth":
      return {
        boundary: [
          "a model may state anything; nothing it states becomes measured evidence",
          "the only path to MEASURED is an execution POLARIS owns, through the trusted source",
          "a measured failing result counters the positive claim; it never satisfies it",
          "one derivation lineage is one source, however many agents repeat it",
        ],
        claims_observed: claims.flatMap((claim) => claim.measured_by ?? []).filter((entry) => entry.requirement?.startsWith?.("P03-E2E")).length,
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

  for (const document of P03_EVIDENCE) {
    const claims = evaluated.filter((claim) => claim.document === document);
    const verdict = claims.length === 0 ? "NOT_TESTED" : worst(claims.map((claim) => claim.verdict));
    const path = join(root, "evidence", `${document}${suffix}.json`);
    writeEvidence(path, {
      ...header(P03_TOOLS.derive, root, { document }),
      verdict,
      conditions: claims.length,
      claims,
      ...extrasFor(document, inputs, claims),
    });
    written.push({ document, verdict, conditions: claims.length, path: `evidence/${document}${suffix}.json` });
  }

  // الشروط التي تعيش في وثيقة البوابة لا تُكتب هنا: البوابة تكتبها بنفسها.
  const gateOnly = P03_CLAIMS.filter((claim) => !P03_EVIDENCE.includes(claim.document)).map((claim) => claim.id);
  return { written, gate_only_conditions: gateOnly };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = derive(root);
  for (const entry of result.written) console.log(`${entry.verdict.padEnd(13)} ${entry.path} (${entry.conditions} condition(s))`);
  console.log(`gate-only conditions: ${result.gate_only_conditions.join(", ")}`);
  process.exitCode = 0;
}
