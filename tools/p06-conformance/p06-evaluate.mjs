// تقييم شروط Phase-06 من القياسات الخام.
//
// دالّة نقية فوق مدخلات مقروءة: مجموعات الاختبار، والفحص الساكن، والإطلاقين الأصليين،
// وسجلّ التجهيزتين، وفحص الكناري، ووثائق بوابات المراحل السابقة. لا شبكة ولا قرص هنا،
// فتُختبر كما هي.

import { P06_CLAIMS, SECURITY_GROUPS } from "./p06-claims.mjs";
import { findSecretLeaks } from "./p06-security.mjs";
import { VERDICTS, worst } from "./p06-common.mjs";

/** السيناريوهات التي يجب أن يحملها التقرير. مغلقة. */
export const E2E_IDS = Object.freeze(Array.from({ length: 26 }, (_, index) => `P06-E2E-${String(index).padStart(2, "0")}`));

/** تُقاس في طور إعادة التشغيل. */
const RESTART_IDS = Object.freeze(["P06-E2E-19", "P06-E2E-20"]);

/** يقيسها المشغّل من خارج النافذة: الخروج النظيف، وغياب الناجين. */
const RUNNER_IDS = Object.freeze(["P06-E2E-24", "P06-E2E-25"]);

/** القياسات العشرة التي طلبتها المرحلة، بأسماء صفوف الأداء التي تحملها. */
export const REQUIRED_TIMINGS = Object.freeze([
  "connector_registry_load_us",
  "connector_invocation_overhead_us",
  "auth_resolution_us",
  "cost_write_us",
  "budget_check_us",
  "metrics_event_write_us",
  "settings_read_us",
  "effective_config_resolution_us",
  "health_overview_load_us",
  "diagnostics_generation_ms",
]);

/** المسارات التي يجوز أن يستقبلها موصل الاختبار: ما سجّلته الشاشة من عمليات، لا غير. */
export const ALLOWED_CONNECTOR_PATHS = Object.freeze([
  "/api/items",
  "/api/items/item-1",
  "/api/items/inject",
  "/api/limited",
  "/api/throttled",
  "/api/slow",
  "/api/redirect",
  "/api/huge",
  "/api/malformed",
  "/api/fake-approval",
  "/api/fake-cost",
  "/api/flaky",
  "/api/send",
]);

function groupOf(inputs, id) {
  return (inputs.groups ?? []).find((group) => group.group_id === id);
}

export function testVerdict(inputs, groupId, name, prefix = false) {
  const group = groupOf(inputs, groupId);
  if (group === undefined) return { verdict: "NOT_TESTED", detail: `${groupId} did not run` };
  if (group.verdict === "BLOCKED") return { verdict: "BLOCKED", detail: `${groupId} could not start` };
  const tests = Array.isArray(group.tests) ? group.tests : [];
  const byPrefix = prefix || name.endsWith("::");
  const matched = byPrefix ? tests.filter((test) => test.name.startsWith(name) || test.name.includes(`::${name}`)) : tests.filter((test) => test.name === name);
  if (matched.length === 0) return { verdict: "NOT_TESTED", detail: `${name} not found in ${groupId}` };
  if (matched.some((test) => test.status === "FAIL")) return { verdict: "FAIL", detail: `${name} failed` };
  if (matched.some((test) => test.status !== "PASS")) return { verdict: "INCONCLUSIVE", detail: `${name} skipped` };
  return { verdict: "PASS", detail: `${matched.length} test(s)` };
}

function scenarios(report) {
  return report !== null && report !== undefined && Array.isArray(report.scenarios) ? report.scenarios : [];
}

export function windowReport(inputs, stage = "first") {
  const launch = inputs.native?.[stage] ?? null;
  return launch?.e2e_report?.renderer ?? launch?.e2e_report ?? null;
}

function launchClean(launch) {
  if (launch === null || launch === undefined) return { verdict: "NOT_TESTED", detail: "launch not performed" };
  const problems = [];
  if (launch.started !== true) problems.push("not started");
  if (launch.startup_report === null || launch.startup_report === undefined) problems.push("no startup report");
  if (launch.closed_gracefully !== true) problems.push("window close did not end the process");
  if (launch.process_exited !== true) problems.push("process did not exit");
  if (launch.exit_code !== 0) problems.push(`exit code ${String(launch.exit_code)}`);
  return problems.length === 0 ? { verdict: "PASS", detail: "graceful exit, code 0" } : { verdict: "FAIL", detail: problems.join("; ") };
}

function survivors(native) {
  const problems = [];
  for (const stage of ["first", "restart"]) {
    const launch = native?.[stage];
    if (launch === null || launch === undefined) {
      problems.push(`${stage} launch not performed`);
      continue;
    }
    if (launch.orphan_processes !== 0) problems.push(`${stage}: ${String(launch.orphan_processes)} surviving process(es)`);
  }
  // التجهيزة ملك المشغّل كذلك: يجب أن تنتهي بانتهاء التشغيل.
  if (native?.fixture_exited !== true) problems.push("the loopback fixture process did not end");
  return problems.length === 0 ? { verdict: "PASS", detail: "no product, WebView2 or fixture process survived" } : { verdict: "FAIL", detail: problems.join("; ") };
}

export function e2eVerdict(inputs, id) {
  const native = inputs.native;
  if (native === null || native === undefined || native.performed !== true) {
    return { verdict: "NOT_TESTED", detail: native?.reason ?? "the native stage did not run" };
  }
  if (id === "P06-E2E-24") {
    const first = launchClean(native.first);
    const restart = launchClean(native.restart);
    return { verdict: worst([first.verdict, restart.verdict]), detail: `first: ${first.detail}; restart: ${restart.detail}` };
  }
  if (id === "P06-E2E-25") return survivors(native);
  const stage = RESTART_IDS.includes(id) ? "restart" : "first";
  const report = windowReport(inputs, stage);
  if (report === null) return { verdict: "FAIL", detail: `${stage} launch produced no E2E report` };
  if (typeof report.fatal === "string") return { verdict: "FAIL", detail: `suite aborted: ${report.fatal}` };
  const found = scenarios(report).find((scenario) => scenario.id === id);
  if (found === undefined) return { verdict: "NOT_TESTED", detail: `${id} absent from the report` };
  return { verdict: found.status === "PASS" ? "PASS" : found.status === "FAIL" ? "FAIL" : "NOT_TESTED", detail: found.detail };
}

function completions(inputs) {
  const log = inputs.native?.fixture_log;
  if (log === null || log === undefined || !Array.isArray(log.requests)) return null;
  return log.requests.filter((entry) => entry.kind === "completion");
}

function connectorRequests(inputs) {
  const log = inputs.native?.fixture_log;
  return log !== null && log !== undefined && Array.isArray(log.connector_requests) ? log.connector_requests : null;
}

export function checkVerdict(inputs, id) {
  if (id.startsWith("P06-SEC-") || id.startsWith("P06-EVIDENCE-")) {
    const pool = [...(inputs.securityStatic?.checks ?? []), ...(inputs.securityEvidence?.checks ?? [])];
    const found = pool.find((entry) => entry.check_id === id);
    return found === undefined ? { verdict: "NOT_TESTED", detail: `${id} was not run` } : { verdict: found.verdict, detail: found.detail };
  }
  const native = inputs.native;
  if (native === null || native === undefined || native.performed !== true) {
    return { verdict: "NOT_TESTED", detail: native?.reason ?? "the native stage did not run" };
  }

  switch (id) {
    case "NATIVE-PERFORMED": {
      const windows = inputs.run?.environment?.is_windows === true;
      const product = inputs.run?.builds?.product?.ok === true;
      const measurement = inputs.run?.builds?.measurement?.ok === true;
      return windows && product && measurement
        ? { verdict: "PASS", detail: "the native stage ran on Windows against freshly built product and measurement binaries" }
        : { verdict: "FAIL", detail: `windows ${windows}, product build ${product}, measurement build ${measurement}` };
    }
    case "FIXTURE-LABELLED-TEST-FIXTURE": {
      const labelled = native.fixture_state?.label === "TEST FIXTURE" && native.fixture_log?.label === "TEST FIXTURE";
      const reported = windowReport(inputs, "first")?.fixture_label === "TEST FIXTURE" && windowReport(inputs, "restart")?.fixture_label === "TEST FIXTURE";
      return labelled && reported
        ? { verdict: "PASS", detail: "the model and connector fixtures are labelled TEST FIXTURE in their state, their log and both window reports" }
        : { verdict: "FAIL", detail: `state ${String(native.fixture_state?.label)}, log ${String(native.fixture_log?.label)}, window reports ${reported}` };
    }
    case "FIXTURE-RECEIVED-AGENT-CALLS": {
      const calls = completions(inputs);
      const requests = connectorRequests(inputs);
      if (calls === null || requests === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const contracts = new Set(calls.map((entry) => entry.contract));
      const scenarioSet = new Set(calls.map((entry) => entry.scenario));
      return calls.length > 0 && contracts.has("plan") && contracts.has("execute") && requests.length > 0
        ? { verdict: "PASS", detail: `${calls.length} agent call(s) and ${requests.length} connector request(s) over loopback; contracts ${[...contracts].join(",")}; scenarios ${[...scenarioSet].join(",")}` }
        : { verdict: "FAIL", detail: `${calls.length} call(s), contracts ${[...contracts].join(",")}; connector requests ${requests.length}` };
    }
    case "FIXTURE-NO-AUTHORIZATION-HEADER": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      if (calls.length === 0) return { verdict: "NOT_TESTED", detail: "the fixture received no call, so its silence proves nothing" };
      const carried = calls.filter((entry) => entry.carried_authorization === true);
      return carried.length === 0
        ? { verdict: "PASS", detail: `${calls.length} call(s) reached the local model provider and none carried an authorization header: the connector key went only to the connector` }
        : { verdict: "FAIL", detail: `${carried.length} model call(s) carried an authorization header` };
    }
    case "CONNECTOR-FIXTURE-ONLY-LOOPBACK": {
      const base = String(native.fixture_state?.connector_base ?? "");
      const requests = connectorRequests(inputs);
      if (requests === null) return { verdict: "NOT_TESTED", detail: "no connector log" };
      return /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(base) && requests.length > 0
        ? { verdict: "PASS", detail: `every connector scenario targeted the loopback TEST FIXTURE at ${base}; no internet service is a condition of PASS` }
        : { verdict: "FAIL", detail: `connector base ${base}; requests ${requests.length}` };
    }
    case "CONNECTOR-FIXTURE-AUTHORISED": {
      const requests = connectorRequests(inputs);
      const state = native.fixture_log?.connector_state;
      if (requests === null || state === null || state === undefined) return { verdict: "NOT_TESTED", detail: "no connector log" };
      const api = requests.filter((entry) => String(entry.path).startsWith("/api/"));
      if (api.length === 0) return { verdict: "NOT_TESTED", detail: "the connector received no request" };
      const refused = api.filter((entry) => entry.authorised !== true);
      return refused.length === 0 && state.unauthorised === 0
        ? { verdict: "PASS", detail: `${api.length} connector request(s), every one carried the bearer credential the fixture expected; the value was resolved by the host from its environment and never passed through the window` }
        : { verdict: "FAIL", detail: `requests without the expected credential ${refused.length}; fixture count of unauthorised requests ${state.unauthorised}` };
    }
    case "CONNECTOR-EXACTLY-ONCE": {
      const requests = connectorRequests(inputs);
      const state = native.fixture_log?.connector_state;
      if (requests === null || state === null || state === undefined) return { verdict: "NOT_TESTED", detail: "no connector log" };
      const creates = requests.filter((entry) => entry.method === "POST" && entry.path === "/api/items");
      const withKey = creates.filter((entry) => entry.carried_idempotency_key === true);
      const sends = requests.filter((entry) => entry.method === "POST" && entry.path === "/api/send");
      const ok = state.created.length === 2 && creates.length === 2 && withKey.length === 2 && state.unsafe_hits === 1 && sends.length === 1 && state.notes === 0;
      return ok
        ? { verdict: "PASS", detail: `measured by the service itself: two approved creates reached it once each (${state.created.join(", ")}), each with an idempotency key; the identical repeat and the refused write never arrived; the unprotected send arrived exactly once and was not retried` }
        : { verdict: "FAIL", detail: `created ${JSON.stringify(state.created)}, create requests ${creates.length} (${withKey.length} with a key), unprotected sends ${sends.length} (fixture count ${state.unsafe_hits}), notes ${state.notes}` };
    }
    case "CONNECTOR-NO-FORBIDDEN-PATH": {
      const requests = connectorRequests(inputs);
      if (requests === null) return { verdict: "NOT_TESTED", detail: "no connector log" };
      if (requests.length === 0) return { verdict: "NOT_TESTED", detail: "the connector received nothing" };
      const outside = requests.filter((entry) => !ALLOWED_CONNECTOR_PATHS.includes(String(entry.path)));
      return outside.length === 0
        ? { verdict: "PASS", detail: `${requests.length} request(s), all on registered operation paths; nothing the injected text or a redirect named was ever requested` }
        : { verdict: "FAIL", detail: `requests outside the registered paths: ${outside.map((entry) => `${entry.method} ${entry.path}`).join(", ")}` };
    }
    case "INJECTION-FENCED": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const carrying = calls.filter((entry) => entry.injection_marker_fenced !== null && entry.injection_marker_fenced !== undefined);
      if (carrying.length === 0) return { verdict: "NOT_TESTED", detail: "no agent call carried the injected service text, so nothing hostile was measured" };
      const unfenced = carrying.filter((entry) => entry.injection_marker_fenced !== true);
      const inSystem = calls.filter((entry) => entry.injection_in_system === true);
      return unfenced.length === 0 && inSystem.length === 0
        ? { verdict: "PASS", detail: `${carrying.length} agent call(s) carried the injected service text, every occurrence inside an untrusted fence and none in a system instruction` }
        : { verdict: "FAIL", detail: `unfenced ${unfenced.length}, in a system instruction ${inSystem.length}` };
    }
    case "CONNECTOR-LABELLED-IN-PROMPT": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const follow = calls.filter((entry) => entry.contract === "execute" && entry.scenario === "CREAD" && entry.step === "follow");
      if (follow.length === 0) return { verdict: "NOT_TESTED", detail: "no follow-up agent call after a connector read" };
      return follow.every((entry) => entry.has_connector_label === true)
        ? { verdict: "PASS", detail: `${follow.length} follow-up call(s) received the connector result labelled [CONNECTOR_UNTRUSTED]` }
        : { verdict: "FAIL", detail: "a connector result reached the next agent without its label" };
    }
    case "CANARY-ABSENT-DATA": {
      const scan = native.canary_scan;
      if (scan === null || scan === undefined || scan.directory_scanned !== true) return { verdict: "NOT_TESTED", detail: "the product data directory was not scanned" };
      if (scan.files === 0) return { verdict: "NOT_TESTED", detail: "the data directory held no file, so its silence proves nothing" };
      return scan.files_with_canary === 0 && scan.unreadable === 0
        ? { verdict: "PASS", detail: `${scan.files} file(s), ${scan.bytes} byte(s) the product wrote in both launches (store, write-ahead log, diagnostics) scanned as UTF-8 and UTF-16: none holds the credential` }
        : { verdict: "FAIL", detail: `files with the credential ${scan.files_with_canary} (${(scan.names_with_canary ?? []).join(", ")}); unreadable ${scan.unreadable}` };
    }
    case "CANARY-ABSENT-REPORTS": {
      const scan = native.report_canary;
      if (scan === null || scan === undefined || scan.directory_scanned !== true) return { verdict: "NOT_TESTED", detail: "the probe reports were not scanned" };
      return scan.files_with_canary === 0
        ? { verdict: "PASS", detail: `${scan.files} probe record(s) (startup and window reports, fixture log) scanned: none holds the credential` }
        : { verdict: "FAIL", detail: `records with the credential: ${(scan.names_with_canary ?? []).join(", ")}` };
    }
    case "NATIVE-SCENARIOS-COMPLETE": {
      const first = windowReport(inputs, "first");
      const restart = windowReport(inputs, "restart");
      if (first === null) return { verdict: "NOT_TESTED", detail: "the first launch produced no report" };
      const seen = new Set([...scenarios(first).map((s) => s.id), ...scenarios(restart).map((s) => s.id)]);
      const missing = E2E_IDS.filter((entry) => !seen.has(entry) && !RUNNER_IDS.includes(entry));
      const undeclared = [...scenarios(first), ...scenarios(restart)].filter((s) => s.status === "NOT_TESTED" && (s.detail ?? "") === "");
      return missing.length === 0 && undeclared.length === 0
        ? { verdict: "PASS", detail: `${seen.size} scenario(s) recorded; every NOT_TESTED entry names where it is measured` }
        : { verdict: "FAIL", detail: `absent from the report: ${missing.join(", ") || "none"}; NOT_TESTED without a reason ${undeclared.length}` };
    }
    case "E2E-REPORT-NO-SECRET": {
      if (native.first?.e2e_report === undefined || native.first?.e2e_report === null) return { verdict: "NOT_TESTED", detail: "no E2E report" };
      const hits = findSecretLeaks(JSON.stringify([native.first?.e2e_report ?? null, native.restart?.e2e_report ?? null]));
      return hits.length === 0 ? { verdict: "PASS", detail: "no key shape in what the renderer received" } : { verdict: "FAIL", detail: hits.join(",") };
    }
    case "PERFORMANCE-MEASURED": {
      const rows = performanceRows(inputs);
      return rows.length > 0 ? { verdict: "PASS", detail: `${rows.length} timing(s) recorded, every one LOCALLY_MEASURED with its method` } : { verdict: "NOT_TESTED", detail: "no timing was recorded by the native run" };
    }
    case "PERFORMANCE-COVERS-REQUIRED": {
      const names = new Set(performanceRows(inputs).map((row) => row.name));
      const missing = REQUIRED_TIMINGS.filter((name) => !names.has(name));
      return missing.length === 0
        ? { verdict: "PASS", detail: `all ${REQUIRED_TIMINGS.length} required timings measured` }
        : { verdict: missing.length === REQUIRED_TIMINGS.length ? "NOT_TESTED" : "FAIL", detail: `not measured: ${missing.join(", ")}` };
    }
    case "PERFORMANCE-EXCLUDES-PROVIDER-TIME": {
      const rows = performanceRows(inputs);
      if (rows.length === 0) return { verdict: "NOT_TESTED", detail: "no timing was recorded" };
      const undeclared = rows.filter((row) => typeof row.excludes_provider_time !== "boolean");
      const mislabelled = rows.filter((row) => row.category === "END_TO_END" && row.excludes_provider_time !== false);
      return undeclared.length === 0 && mislabelled.length === 0
        ? { verdict: "PASS", detail: `${rows.filter((row) => row.excludes_provider_time).length} timing(s) exclude provider and service time; ${rows.filter((row) => !row.excludes_provider_time).length} declare that they include it` }
        : { verdict: "FAIL", detail: `undeclared ${undeclared.map((row) => row.name).join(",")}; end-to-end rows claiming exclusion ${mislabelled.map((row) => row.name).join(",")}` };
    }
    default:
      return { verdict: "NOT_TESTED", detail: `unknown check ${id}` };
  }
}

/**
 * قياسات الأداء، مصنّفة. متوسّطات عدّادات البوابة مقيسة داخل المنتج في التشغيل الأصلي نفسه،
 * وقياس الإعدادات والصحّة داخل العملية على المضيف الحقيقي، وما يمرّ بالعارض يُعلن ذلك.
 */
export function performanceRows(inputs) {
  const native = inputs.native;
  const rows = [];
  const push = (name, value, unit, category, method, excludes, samples = null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    rows.push({ name, value: Math.round(value * 100) / 100, unit, category, provenance: "LOCALLY_MEASURED", method, excludes_provider_time: excludes, samples });
  };

  const facts = windowReport(inputs, "first")?.facts ?? {};
  const gateway = facts.timings?.ok === true ? facts.timings.gateway ?? {} : {};
  push("connector_registry_load_us", gateway.registry_load_mean_micros, "us", "CONNECTOR", "mean time to load the connector registry from the store and rebuild the gateway's instance list", true, gateway.registry_loads ?? null);
  push("connector_invocation_overhead_us", gateway.overhead_mean_micros, "us", "CONNECTOR", "mean wall time of ConnectorGateway::invoke minus time waiting for the service and deliberate waits (rate limit, Retry-After, backoff)", true, gateway.invocations ?? null);
  push("auth_resolution_us", gateway.auth_mean_micros, "us", "CONNECTOR", "mean time to resolve a connector credential from the environment or the credential store and build its header", true, gateway.auth_resolutions ?? null);
  push("cost_write_us", gateway.cost_write_mean_micros, "us", "COST", "mean time to write one usage record with its cost and provenance to the ledger", true, gateway.cost_writes ?? null);
  push("budget_check_us", gateway.budget_mean_micros, "us", "BUDGET", "mean time to evaluate every applicable budget and reserve the planned use before a call", true, gateway.budget_checks ?? null);
  push("metrics_event_write_us", gateway.event_write_mean_micros, "us", "OBSERVABILITY", "mean time to seal, store and count one structured event (ring buffer, store row, metrics)", true, gateway.event_writes ?? null);

  const inProcess = facts.in_process?.ok === true ? facts.in_process : {};
  push("settings_read_us", inProcess.settings_read?.mean_micros, "us", "SETTINGS", "mean time to resolve one setting with its source, in process on the real host (500 reads)", true, inProcess.settings_read?.rounds ?? null);
  push("settings_reload_from_store_us", inProcess.settings_reload_from_store?.mean_micros, "us", "SETTINGS", "mean time to reload every stored setting value from SQLite (20 reloads)", true, inProcess.settings_reload_from_store?.rounds ?? null);
  push("effective_config_resolution_us", inProcess.effective_config_resolution?.mean_micros, "us", "SETTINGS", "mean time to resolve the whole effective configuration for a project and mission scope (200 resolutions)", true, inProcess.effective_config_resolution?.rounds ?? null);
  push("health_overview_load_us", inProcess.health_overview?.mean_micros, "us", "OBSERVABILITY", "mean time to build the health overview, including the storage quick check (20 builds)", true, inProcess.health_overview?.rounds ?? null);
  push("budget_list_us", inProcess.budget_list?.mean_micros, "us", "BUDGET", "mean time to list the stored budgets (50 reads)", true, inProcess.budget_list?.rounds ?? null);

  const window = windowReport(inputs, "first")?.measurements ?? {};
  for (const [name, entry] of Object.entries(window)) {
    if (entry === null || typeof entry !== "object" || typeof entry.value !== "number") continue;
    // ما يمرّ بمهمّة كاملة يشمل نداءات النموذج والخدمة: يُعلن ذلك.
    const endToEnd = /mission|round_trip|cancel_to_stop/.test(name);
    const rowName = name === "diagnostics_generation_ms" ? "diagnostics_generation_ms" : name;
    push(rowName, entry.value, entry.unit ?? "ms", endToEnd ? "END_TO_END" : "RENDERER_IPC", entry.method ?? "measured inside the real window", !endToEnd);
  }

  for (const [stage, launch] of [
    ["first", native?.first],
    ["restart", native?.restart],
  ]) {
    const m = launch?.measurements;
    if (m === undefined || m === null) continue;
    push(`${stage}_window_visible_ms`, m.window_visible_ms, "ms", "STARTUP", "process start to the first main window handle", true);
    push(`${stage}_cold_start_to_bootstrap_ms`, m.cold_start_to_bootstrap_ms, "ms", "STARTUP", "process start to the host writing the bootstrap report", true);
    push(`${stage}_suite_complete_ms`, m.suite_complete_ms, "ms", "END_TO_END", "process start to the window writing its E2E report; includes every fixture model and connector call", false);
    push(`${stage}_exit_ms`, m.exit_ms, "ms", "SHUTDOWN", "process start to process exit after the window close", true);
    const memory = launch?.memory_after_suite;
    if (memory !== undefined && memory !== null) {
      push(`${stage}_working_set_bytes`, memory.host_working_set_bytes + memory.child_working_set_bytes, "bytes", "MEMORY_FOOTPRINT", memory.method, true);
    }
  }
  return rows;
}

function normalise(value) {
  return VERDICTS.includes(value) ? value : "INCONCLUSIVE";
}

const NEXT_GATE = Object.freeze({
  "PHASE-01": "phase_02_gate",
  "PHASE-02": "phase_03_gate",
  "PHASE-03": "phase_04_gate",
  "PHASE-04": "phase_05_gate",
  "PHASE-05": "phase_06_gate",
});

export function gateRegressionVerdict(inputs, phase) {
  const document = {
    "PHASE-00": inputs.phase00Gate,
    "PHASE-01": inputs.phase01Gate,
    "PHASE-02": inputs.phase02Gate,
    "PHASE-03": inputs.phase03Gate,
    "PHASE-04": inputs.phase04Gate,
    "PHASE-05": inputs.phase05Gate,
  }[phase];
  const started = inputs.runStarted ?? null;
  if (document === null || document === undefined) return { verdict: "NOT_TESTED", detail: `${phase} final gate document absent` };
  if (document.__unreadable !== undefined) return { verdict: "INCONCLUSIVE", detail: `${phase} gate unreadable` };
  if (started === null) return { verdict: "NOT_TESTED", detail: "the run start is unknown, so a fresh re-run cannot be told from an old document" };
  const at = typeof document.measured_at === "string" ? document.measured_at : document.decided_at;
  // سياسة المالك (2026-09-30): كل مرحلة تُختبر منفصلة. في وضع PRIOR_GATES تُقرأ بوابة المرحلة الأدنى كما حكم
  // بها مشغّلها (قانونية، PASS، تفتح التالية) ولا يُعاد تشغيلها؛ في وضع RERUN تُشترط حداثتها كما كانت.
  const priorGates = inputs.regressionMode === "PRIOR_GATES";
  const fresh = typeof at === "string" && (priorGates || at >= started);
  if (!fresh) return { verdict: "NOT_TESTED", detail: `${phase} gate was not re-run in this run (decided ${String(at)}, run started ${started})` };
  const canonical = phase === "PHASE-00" ? document.native === true && document.platform === "win32" : document.canonical === true;
  if (!canonical) return { verdict: "INCONCLUSIVE", detail: `${phase} gate re-run is not canonical` };
  const field = NEXT_GATE[phase];
  const opensNext = field === undefined ? true : document[field] === "ALLOWED";
  const passed = document.verdict === "PASS" && opensNext;
  return {
    verdict: passed ? "PASS" : document.verdict === "PASS" ? "FAIL" : normalise(document.verdict),
    detail: `${phase} = ${document.verdict}${field === undefined ? "" : `, ${field} ${document[field]}`}, decided ${String(at)}${priorGates ? " (prior gate read, not re-run: each phase is tested separately)" : ""}`,
  };
}

export function noSkipVerdict(inputs) {
  const problems = [];
  for (const id of SECURITY_GROUPS) {
    const group = groupOf(inputs, id);
    if (group === undefined) {
      problems.push(`${id} did not run`);
      continue;
    }
    const skipped = (group.tests ?? []).filter((test) => test.status === "SKIPPED").length;
    if (skipped > 0 || (group.counts?.skipped ?? 0) > 0) problems.push(`${id} skipped ${skipped}`);
    if (group.verdict !== "PASS") problems.push(`${id} is ${group.verdict}`);
  }
  if ((inputs.securityStatic?.checks ?? []).length === 0) problems.push("the static security scan did not run");
  if ((inputs.securityEvidence?.checks ?? []).length === 0) problems.push("the evidence secret scan did not run");
  return problems.length === 0
    ? { verdict: "PASS", detail: `${SECURITY_GROUPS.length} security-bearing groups ran with no skip; static and evidence scans ran` }
    : { verdict: problems.some((problem) => problem.includes("did not run")) ? "NOT_TESTED" : "FAIL", detail: problems.join("; ") };
}

export function groupVerdict(inputs, id) {
  const group = groupOf(inputs, id);
  if (group === undefined) return { verdict: "NOT_TESTED", detail: `${id} did not run` };
  const counts = group.counts === null || group.counts === undefined ? "" : ` (${group.counts.passed ?? "?"}/${group.counts.tests ?? "?"})`;
  return { verdict: normalise(group.verdict), detail: `${id} ${group.verdict}${counts} ${group.reason ?? ""}`.trim() };
}

export function requirementVerdict(inputs, requirement) {
  switch (requirement.type) {
    case "test":
      return { ...testVerdict(inputs, requirement.group, requirement.name, requirement.prefix === true), requirement: `${requirement.group} :: ${requirement.name}` };
    case "e2e":
      return { ...e2eVerdict(inputs, requirement.id), requirement: requirement.id };
    case "check":
      return { ...checkVerdict(inputs, requirement.id), requirement: requirement.id };
    case "gate":
      return { ...gateRegressionVerdict(inputs, requirement.phase), requirement: `${requirement.phase} final gate` };
    case "group":
      return { ...groupVerdict(inputs, requirement.id), requirement: `group ${requirement.id}` };
    case "no-skip":
      return { ...noSkipVerdict(inputs), requirement: "no mandatory security skip" };
    case "bytes": {
      const bytes = inputs.bytes;
      if (bytes === null || bytes === undefined) return { verdict: "NOT_TESTED", detail: "byte gate not run", requirement: "byte gate" };
      return { verdict: bytes.verdict === "PASS" ? "PASS" : "FAIL", detail: `${bytes.summary?.clean ?? 0}/${bytes.summary?.checked ?? 0} clean`, requirement: "byte gate" };
    }
    default:
      return { verdict: "INCONCLUSIVE", detail: `unknown requirement ${requirement.type}`, requirement: String(requirement.type) };
  }
}

export function evaluateClaim(inputs, claim) {
  const measurements = claim.requires.map((requirement) => requirementVerdict(inputs, requirement));
  const verdict = worst(measurements.map((entry) => entry.verdict));
  const failing = measurements.filter((entry) => entry.verdict !== "PASS");
  return {
    claim_id: claim.id,
    condition: claim.condition,
    verdict,
    reason_code: failing.length === 0 ? "" : failing.slice(0, 6).map((entry) => `${entry.requirement}: ${entry.verdict} (${entry.detail})`).join(" | "),
    measured_by: measurements,
  };
}

export function evaluateAll(inputs) {
  return P06_CLAIMS.map((claim) => ({ document: claim.document, ...evaluateClaim(inputs, claim) }));
}
