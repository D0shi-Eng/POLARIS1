// اشتقاق أدلة Phase-04 القانونية من القياسات الخام.
//
// لا يقيس هذا الملف شيئًا: يقرأ ما قاسه غيره ويكتب الوثائق. كل وثيقة تحمل
// شروطها وأحكامها ومصادرها، والحكم يأتي من التقييم لا من يد كاتب.
//
// الاستعمال: node p04-derive.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { P04_CLAIMS } from "./p04-claims.mjs";
import {
  argument,
  evidenceSuffix,
  header,
  P04_EVIDENCE,
  P04_TOOLS,
  RAW_DIRECTORY,
  readJson,
  worst,
  writeEvidence,
} from "./p04-common.mjs";
import { E2E_IDS, evaluateAll, performanceRows } from "./p04-evaluate.mjs";

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
    phase03Gate: readJson(join(root, "evidence", "phase-03-final-gate.json")),
  };
}

function scenarioRows(inputs) {
  const native = inputs.native;
  const first = native?.first?.e2e_report?.renderer ?? native?.first?.e2e_report ?? null;
  const restart = native?.restart?.e2e_report?.renderer ?? native?.restart?.e2e_report ?? null;
  const byId = new Map();
  for (const [stage, report] of [
    ["first", first],
    ["restart", restart],
  ]) {
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

/** الحقائق التي تُثبت المسار الحقيقي، مقروءة من الطبقة الأصلية وسجلّي التجهيزة. */
function toolPathFacts(inputs) {
  const native = inputs.native;
  const report = native?.first?.e2e_report?.renderer ?? native?.first?.e2e_report ?? null;
  const requests = Array.isArray(native?.fixture_log?.requests) ? native.fixture_log.requests : [];
  const completions = requests.filter((entry) => entry.kind === "completion");
  const rpc = Array.isArray(native?.fixture_log?.mcp_requests) ? native.fixture_log.mcp_requests : [];
  return {
    path: [
      "a mission created from the window over IPCEnvelopeV1",
      "the Phase-03 mission runtime and its task graph",
      "an agent instance with a skill and the tools that skill names",
      "a typed ToolProposalV1 returned by the model, which decides nothing",
      "the Phase-04 tool gateway: schema, capability, budget, policy, approval",
      "the adapter, built in or MCP over loopback",
      "a normalised ToolResult, an audit record and a ToolEvidenceSource entry",
      "claim verification against the recorded evidence",
    ],
    model_fixture: {
      label: native?.fixture_log?.label ?? null,
      endpoint: native?.fixture_state?.endpoint ?? null,
      completion_calls: completions.length,
      models: [...new Set(completions.map((entry) => entry.model))],
      contracts: [...new Set(completions.map((entry) => entry.contract))],
      scenarios: [...new Set(completions.map((entry) => entry.scenario))],
      calls_offered_a_tool_list: completions.filter((entry) => entry.offers_tools === true).length,
      calls_carrying_an_authorization_header: completions.filter((entry) => entry.carried_authorization === true).length,
      calls_carrying_the_hostile_marker: completions.filter((entry) => entry.hostile_marker === true).length,
    },
    tool_server_fixture: {
      label: native?.fixture_state?.label ?? null,
      endpoint: native?.fixture_state?.mcp_endpoint ?? null,
      silent_endpoint: native?.fixture_state?.slow_endpoint ?? null,
      jsonrpc_calls: rpc.length,
      methods: [...new Set(rpc.map((entry) => entry.method))],
      calls_carrying_an_authorization_header: rpc.filter((entry) => entry.carried_authorization === true).length,
    },
    window_facts: {
      builtin_tools: report?.facts?.builtin_tools ?? null,
      runtime_capabilities: report?.facts?.runtime_capabilities ?? null,
      discovery: report?.facts?.discovery ?? null,
      gateway_state_final: report?.facts?.gateway_state_final ?? null,
      tool_evidence_total: report?.facts?.tool_evidence_total ?? null,
      cancellation: report?.facts?.cancellation ?? null,
      delegation_report: report?.facts?.delegation_report ?? null,
    },
  };
}

/** ما تحمله كل وثيقة فوق شروطها. */
function extrasFor(document, inputs, claims) {
  switch (document) {
    case "phase-04-run":
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
    case "phase-04-tool-gateway":
      return {
        pipeline: [
          "ToolInvocationRequest, typed and bound to one mission and one task",
          "schema validation of the arguments against the registered contract",
          "capability validation against the fixed runtime grant",
          "budget reservation, before any effect is attempted",
          "policy decision at the Phase-00 PDP, enforced here",
          "approval obligation, bound and single use, when the effects require one",
          "adapter execution, and nothing else in the process may execute a tool",
          "a normalised ToolResult, an audit record, and typed evidence",
        ],
        note: "a refusal is recorded with the same shape as a success, because nothing happening and something being prevented are different facts",
      };
    case "phase-04-mcp":
      return {
        grant_narrowing: [
          "what the server declares for a tool",
          "intersected with what the user granted that server",
          "intersected with what this build's runtime capability grant holds",
        ],
        note: "a server grants itself nothing; its description and its output are data and are classified MCP_UNTRUSTED",
        discovery: inputs.native?.first?.e2e_report?.renderer?.facts?.discovery ?? null,
      };
    case "phase-04-native-e2e":
      return {
        fixture_label: "TEST FIXTURE",
        note: "the loopback provider and the loopback tool server are deterministic test fixtures; they emulate a provider and an MCP server and replace no part of the product runtime",
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
        real_path_traversed: toolPathFacts(inputs),
        scenarios: scenarioRows(inputs),
      };
    case "phase-04-performance": {
      const rows = performanceRows(inputs);
      return {
        provenance: "LOCALLY_MEASURED",
        note: "gateway timings exclude provider inference time; any timing that includes a model call is categorised END_TO_END and says so",
        measurements: rows,
        summary: {
          recorded: rows.length,
          tool_gateway: rows.filter((row) => row.category === "TOOL_GATEWAY").length,
          end_to_end: rows.filter((row) => row.category === "END_TO_END").length,
        },
      };
    }
    case "phase-04-security":
      return {
        static_checks: inputs.securityStatic?.checks ?? [],
        evidence_checks: inputs.securityEvidence?.checks ?? [],
      };
    case "phase-04-regression":
      return {
        note: "a stale prior gate does not count: each regression condition compares the gate's own timestamp with the start of this run",
        run_started: inputs.native?.run_started ?? inputs.runStarted ?? null,
        gates: [
          {
            phase: "PHASE-00",
            verdict: inputs.phase00Gate?.verdict ?? null,
            decided_at: inputs.phase00Gate?.decided_at ?? inputs.phase00Gate?.measured_at ?? null,
          },
          { phase: "PHASE-01", verdict: inputs.phase01Gate?.verdict ?? null, decided_at: inputs.phase01Gate?.measured_at ?? null, opens: inputs.phase01Gate?.phase_02_gate ?? null },
          { phase: "PHASE-02", verdict: inputs.phase02Gate?.verdict ?? null, decided_at: inputs.phase02Gate?.measured_at ?? null, opens: inputs.phase02Gate?.phase_03_gate ?? null },
          { phase: "PHASE-03", verdict: inputs.phase03Gate?.verdict ?? null, decided_at: inputs.phase03Gate?.measured_at ?? null, opens: inputs.phase03Gate?.phase_04_gate ?? null },
        ],
      };
    case "phase-04-evidence":
      return {
        boundary: [
          "a ToolResult is measured because POLARIS executed it, and it is not verified for that reason alone",
          "a tool result satisfies a fact rule; it never satisfies a rule that requires a test artefact",
          "agent prose never becomes tool evidence, whatever the agent calls it",
          "evidence measured for one mission or one task cannot reach another",
        ],
        tool_evidence_observed: inputs.native?.first?.e2e_report?.renderer?.facts?.tool_evidence_total ?? null,
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

  for (const document of P04_EVIDENCE) {
    const claims = evaluated.filter((claim) => claim.document === document);
    const verdict = claims.length === 0 ? "NOT_TESTED" : worst(claims.map((claim) => claim.verdict));
    const path = join(root, "evidence", `${document}${suffix}.json`);
    writeEvidence(path, {
      ...header(P04_TOOLS.derive, root, { document }),
      verdict,
      conditions: claims.length,
      claims,
      ...extrasFor(document, inputs, claims),
    });
    written.push({ document, verdict, conditions: claims.length, path: `evidence/${document}${suffix}.json` });
  }

  // الشروط التي تعيش في وثيقة البوابة لا تُكتب هنا: البوابة تكتبها بنفسها.
  const gateOnly = P04_CLAIMS.filter((claim) => !P04_EVIDENCE.includes(claim.document)).map((claim) => claim.id);
  return { written, gate_only_conditions: gateOnly };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = derive(root);
  for (const entry of result.written) console.log(`${entry.verdict.padEnd(13)} ${entry.path} (${entry.conditions} condition(s))`);
  console.log(`gate-only conditions: ${result.gate_only_conditions.join(", ")}`);
  process.exitCode = 0;
}
