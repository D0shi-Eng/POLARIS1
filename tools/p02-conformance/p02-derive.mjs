// اشتقاق وثائق Phase-02 القانونية من القياسات الخام.
//
// لا قياس هنا: يقرأ ما كتبته المراحل السابقة ويكتب تسع وثائق. تشغيل بلا علامة
// المشغّل يكتب أسماء `.adhoc` ويقول في متنه إنه ليس قانونيًا.
//
// الاستعمال: node p02-derive.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, header, P02_TOOLS, RAW_DIRECTORY, readJson, worst, writeEvidence } from "./p02-common.mjs";
import { E2E_IDS, e2eVerdict, evaluateAll } from "./p02-evaluate.mjs";

// المضيف يكتب تقرير E2E مركّبًا: { kind, startup, renderer: { scenarios, facts, ... } }
// (انظر desktop/host/app/src/startup.rs). المقيّمون هنا يقرؤون حقول العارض عند جذر
// `e2e_report`، فنرفعها مرة واحدة عند التحميل مع الإبقاء على `startup` و`kind`. بلا
// هذا الرفع تظهر كل السيناريوهات «غائبة عن التقرير» رغم قياسها.
function normalizeLaunch(launch) {
  const composite = launch?.e2e_report;
  if (composite && typeof composite === "object" && composite.renderer && typeof composite.renderer === "object") {
    launch.e2e_report = { ...composite.renderer, startup: composite.startup, kind: composite.kind };
  }
  return launch;
}

export function loadInputs(root) {
  const raw = (name) => readJson(join(root, RAW_DIRECTORY, name));
  const groupsDocument = raw("groups.local.json");
  const native = raw("native.local.json");
  if (native !== null && native !== undefined) {
    normalizeLaunch(native.first);
    normalizeLaunch(native.restart);
  }
  return {
    groups: groupsDocument?.groups ?? [],
    groupsDocument,
    securityStatic: raw("security-static.local.json"),
    securityEvidence: raw("security-evidence.local.json"),
    native,
    run: raw("run.local.json"),
    bytes: raw("evidence-bytes.local.json"),
    phase00Gate: readJson(join(root, "evidence", "phase-00-final-gate.json")),
    phase01Gate: readJson(join(root, "evidence", "phase-01-final-gate.json")),
    runStarted: raw("run.local.json")?.run_started ?? null,
  };
}

function groupSummary(inputs) {
  return inputs.groups.map((group) => ({
    group_id: group.group_id,
    stage: group.stage,
    title: group.title,
    command: group.command,
    verdict: group.verdict,
    reason: group.reason,
    counts: group.counts,
    // تصنيف التخطّي يُنقل إلى الوثيقة القانونية كما هو: العدد وحده لا يقول أي
    // اختبار تُخطّي ولا من يحمل ادعاءه، وهو ما لا يجوز أن يبقى في الخام فقط.
    ...(group.skip_classification === undefined ? {} : { skip_classification: group.skip_classification }),
    duration_ms: group.duration_ms,
  }));
}

function totals(inputs) {
  const counted = inputs.groups.filter((group) => group.counts !== null && group.counts !== undefined);
  const sum = (key) => counted.reduce((total, group) => total + (group.counts[key] ?? 0), 0);
  return { groups: inputs.groups.length, tests: sum("tests"), passed: sum("passed"), failed: sum("failed"), skipped: sum("skipped") };
}

function claimsFor(evaluated, document) {
  return evaluated.filter((claim) => claim.document === document).map(({ document: _unused, ...claim }) => claim);
}

function documentVerdict(claims) {
  return worst(claims.map((claim) => claim.verdict));
}

const DOGFOOD = [
  ["launch POLARIS", ["E2E-01"]],
  ["open Providers", ["E2E-02"]],
  ["detect LM Studio / Ollama if present", ["E2E-03"]],
  ["configure a provider (TEST FIXTURE)", ["E2E-05"]],
  ["discover models", ["E2E-06"]],
  ["choose a model", ["E2E-07", "E2E-08"]],
  ["create a project", ["E2E-09"]],
  ["attach a workspace", ["E2E-09", "E2E-12"]],
  ["inspect context", ["E2E-13", "E2E-14"]],
  ["send a simple prompt through ModelInvocationService (TEST FIXTURE)", ["E2E-15"]],
  ["receive the result", ["E2E-15"]],
  ["restart the application", ["E2E-22"]],
  ["confirm project and model configuration persisted", ["E2E-20"]],
];

function dogfood(inputs) {
  const steps = DOGFOOD.map(([step, ids], index) => {
    const verdicts = ids.map((id) => e2eVerdict(inputs, id).verdict);
    return { step: index + 1, action: step, measured_by: ids, verdict: worst(verdicts) };
  });
  const live = inputs.native?.first?.e2e_report?.scenarios?.find?.((scenario) => scenario.id === "LIVE-01") ?? null;
  return {
    provider_label: "TEST FIXTURE — a deterministic loopback server owned by the runner; not a production provider",
    live_local_model_server: live === null ? { status: "NOT_TESTED", detail: "the native stage did not run" } : live,
    steps,
    verdict: worst(steps.map((step) => step.verdict)),
  };
}

function e2eTable(inputs) {
  const titles = new Map(
    [...(inputs.native?.first?.e2e_report?.scenarios ?? []), ...(inputs.native?.restart?.e2e_report?.scenarios ?? [])].map((scenario) => [scenario.id, scenario.title]),
  );
  return E2E_IDS.map((id) => ({
    scenario_id: id,
    title: id === "E2E-22" ? "clean exit and no orphan process, for both launches" : titles.get(id) ?? "",
    ...e2eVerdict(inputs, id),
  }));
}

function launchSummary(launch) {
  if (launch === null || launch === undefined) return null;
  return {
    started: launch.started,
    window_appeared: launch.window_appeared,
    startup: launch.startup_report ?? null,
    memory_after_startup: launch.memory_after_startup ?? null,
    memory_after_suite: launch.memory_after_suite ?? null,
    closed_gracefully: launch.closed_gracefully,
    process_exited: launch.process_exited,
    exit_code: launch.exit_code,
    child_processes_seen: Array.isArray(launch.started_children) ? launch.started_children.length : 0,
    surviving_processes: launch.orphan_processes,
    measurements: launch.measurements ?? {},
    reason_codes: launch.reason_codes ?? [],
    viewport: launch.e2e_report?.viewport ?? null,
  };
}

function performance(inputs) {
  const report = inputs.native?.first?.e2e_report ?? null;
  const measured = report?.measurements ?? {};
  const facts = report?.facts ?? {};
  const timing = facts.host_invocation_timing ?? null;
  const entry = (name, value, provenance, method) => ({ metric: name, value, unit: value === null ? null : "ms", provenance: value === null ? "UNKNOWN" : provenance, method });
  const discovery = Object.entries(measured).filter(([name]) => name.startsWith("discovery_"));
  const memoryStart = inputs.native?.first?.memory_after_startup ?? null;
  const memoryEnd = inputs.native?.first?.memory_after_suite ?? null;
  const delta =
    memoryStart !== null && memoryEnd !== null
      ? memoryEnd.host_working_set_bytes + memoryEnd.child_working_set_bytes - (memoryStart.host_working_set_bytes + memoryStart.child_working_set_bytes)
      : null;
  return [
    ...discovery.map(([name, value]) => entry(`provider discovery latency (${name.replace("discovery_", "")})`, value.value, "LOCALLY_MEASURED", value.method)),
    entry("model listing latency", measured.model_list?.value ?? null, "LOCALLY_MEASURED", measured.model_list?.method ?? "not measured"),
    entry("project list latency", measured.project_list?.value ?? null, "LOCALLY_MEASURED", measured.project_list?.method ?? "not measured"),
    entry("project open latency", measured.project_open?.value ?? null, "LOCALLY_MEASURED", measured.project_open?.method ?? "not measured"),
    entry("context assembly latency", measured.context_assembly?.value ?? null, "LOCALLY_MEASURED", measured.context_assembly?.method ?? "not measured"),
    entry("model invocation first byte (host, TEST FIXTURE)", timing?.first_byte?.value ?? null, "LOCALLY_MEASURED", "ModelInvocationService timing.first_byte"),
    entry("model invocation total (host, TEST FIXTURE)", timing?.total?.value ?? null, "LOCALLY_MEASURED", "ModelInvocationService timing.total"),
    entry("invocation UI round trip (TEST FIXTURE)", measured.invocation_ui_round_trip?.value ?? null, "LOCALLY_MEASURED", measured.invocation_ui_round_trip?.method ?? "not measured"),
    entry("cancel to rendered result", measured.cancel_to_result?.value ?? null, "LOCALLY_MEASURED", measured.cancel_to_result?.method ?? "not measured"),
    entry("live local invocation round trip", measured.live_invocation_round_trip?.value ?? null, "LOCALLY_MEASURED", measured.live_invocation_round_trip?.method ?? "no live local model server with a loaded model"),
    entry("cold start to bootstrap", inputs.native?.first?.measurements?.cold_start_to_bootstrap_ms ?? null, "LOCALLY_MEASURED", "process start to host startup report"),
    {
      metric: "memory footprint change across the Phase-02 suite (host + WebView2 working sets)",
      value: delta,
      unit: delta === null ? null : "bytes",
      provenance: delta === null ? "UNKNOWN" : "LOCALLY_MEASURED",
      method: "working sets sampled after bootstrap and after the suite; a single sample pair, not a leak test",
      samples: { after_startup: memoryStart, after_suite: memoryEnd },
    },
  ];
}

export function derive(root) {
  const inputs = loadInputs(root);
  const suffix = evidenceSuffix();
  const evaluated = evaluateAll(inputs);
  const write = (base, body) => writeEvidence(join(root, "evidence", `${base}${suffix}.json`), { ...header(P02_TOOLS.derive, root), ...body });
  const written = [];

  const byDocument = (name, extra = {}) => {
    const claims = claimsFor(evaluated, name);
    const path = write(name, { claims, ...extra, verdict: documentVerdict(claims), reason_codes: claims.filter((claim) => claim.verdict !== "PASS").map((claim) => `${claim.claim_id}_${claim.verdict}`) });
    written.push(path);
  };

  const live = inputs.native?.first?.e2e_report?.facts ?? {};
  byDocument("phase-02-providers", {
    provider_list_snapshot: live.provider_list_snapshot ?? null,
    local_discovery_through_the_host: live.local_discovery ?? null,
    optional_live_local_providers: live.live_local_providers ?? null,
    optional_live_invocation: live.live_invocation ?? null,
    supply_chain: inputs.securityStatic?.supply_chain ?? null,
  });
  byDocument("phase-02-models", { host_invocation_routing: live.host_invocation_routing ?? null });
  byDocument("phase-02-projects", { restart_checks: inputs.native?.restart?.e2e_report?.facts?.restart_checks ?? null });
  byDocument("phase-02-context", {
    workspace_bundle_omissions: live.workspace_bundle_omissions ?? null,
    host_invocation_context: live.host_invocation_context ?? null,
    fixture_workspace: inputs.native?.workspace_files ?? null,
  });
  byDocument("phase-02-security", {
    static_checks: inputs.securityStatic?.checks ?? [],
    evidence_scan: inputs.securityEvidence?.checks ?? [],
    supply_chain: inputs.securityStatic?.supply_chain ?? [],
    fixture_requests: (inputs.native?.fixture_log?.requests ?? []).map((entry) => ({ port: entry.port, path: entry.path, model: entry.model ?? null, authorization_present: entry.authorization_present, context_marker: entry.context_marker ?? null, hostile_marker: entry.hostile_marker ?? null, aborted: entry.aborted, completed: entry.completed })),
  });
  byDocument("phase-02-native-e2e", {
    performed: inputs.native?.performed === true,
    not_performed_reason: inputs.native?.performed === true ? null : inputs.native?.reason ?? "the native stage did not run",
    scenarios: e2eTable(inputs),
    optional_live: inputs.native?.first?.e2e_report?.scenarios?.find?.((scenario) => scenario.id === "LIVE-01") ?? null,
    first_launch: launchSummary(inputs.native?.first),
    restart_launch: launchSummary(inputs.native?.restart),
    fixture_label: "TEST FIXTURE",
  });

  const perf = performance(inputs);
  written.push(write("phase-02-performance", {
    rule: "no service-level target is claimed; every number carries its provenance, and an absent number is UNKNOWN",
    measurements: perf,
    verdict: inputs.native?.performed === true ? "PASS" : "NOT_TESTED",
    reason_codes: inputs.native?.performed === true ? [] : ["NATIVE_STAGE_NOT_RUN"],
  }));

  byDocument("phase-02-regression", {
    phase_00_gate: inputs.phase00Gate === null ? null : { verdict: inputs.phase00Gate.verdict, decided_at: inputs.phase00Gate.decided_at ?? null, platform: inputs.phase00Gate.platform ?? null, native: inputs.phase00Gate.native ?? null },
    phase_01_gate: inputs.phase01Gate === null ? null : { verdict: inputs.phase01Gate.verdict, phase_02_gate: inputs.phase01Gate.phase_02_gate, measured_at: inputs.phase01Gate.measured_at, canonical: inputs.phase01Gate.canonical },
    phase_01_runner_exit: inputs.run?.phase01_runner_exit ?? null,
  });

  const stages = inputs.run?.stages ?? [];
  const failedStages = stages.filter((stage) => stage.exit_code !== 0);
  const run = {
    run_started: inputs.run?.run_started ?? null,
    environment: inputs.run?.environment ?? null,
    builds: inputs.run?.builds ?? null,
    stages,
    test_groups: groupSummary(inputs),
    test_totals: totals(inputs),
    dogfood: dogfood(inputs),
    claims_overview: evaluated.map((claim) => ({ claim_id: claim.claim_id, document: claim.document, verdict: claim.verdict })),
  };
  const runVerdict = worst([
    ...inputs.groups.map((group) => group.verdict),
    ...(failedStages.length > 0 ? ["FAIL"] : []),
    run.dogfood.verdict,
  ]);
  written.push(write("phase-02-run", { ...run, verdict: inputs.groups.length === 0 ? "NOT_TESTED" : runVerdict, reason_codes: [...inputs.groups.filter((g) => g.verdict !== "PASS").map((g) => `${g.group_id}_${g.verdict}`), ...failedStages.map((s) => `STAGE_FAILED:${s.name}`)] }));
  return { written, evaluated };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { written, evaluated } = derive(root);
  for (const claim of evaluated) console.log(`${claim.verdict.padEnd(13)} ${claim.claim_id}  ${claim.reason_code.slice(0, 160)}`);
  for (const path of written) console.log(`wrote ${path}`);
  process.exitCode = 0;
}
