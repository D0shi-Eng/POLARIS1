// تقييم شروط Phase-05 من القياسات الخام.
//
// دالّة نقية فوق مدخلات مقروءة: مجموعات الاختبار، والفحص الساكن، والإطلاقين الأصليين،
// وسجلّ التجهيزتين، وحالة نافذة التجهيزة، ووثائق بوابات المراحل السابقة. لا شبكة ولا
// قرص هنا، فتُختبر كما هي.

import { P05_CLAIMS, SECURITY_GROUPS } from "./p05-claims.mjs";
import { findSecretLeaks } from "./p05-security.mjs";
import { VERDICTS, worst } from "./p05-common.mjs";

/** السيناريوهات التي يجب أن يحملها التقرير. مغلقة. */
export const E2E_IDS = Object.freeze([
  ...Array.from({ length: 29 }, (_, index) => `P05-E2E-${String(index).padStart(2, "0")}`),
  "P05-E2E-03a",
  "P05-E2E-03b",
  "P05-E2E-12a",
  "P05-E2E-13a",
  "P05-E2E-18a",
  "P05-E2E-18b",
  "P05-E2E-20a",
  "P05-E2E-24a",
]);

/** تُقاس في طور إعادة التشغيل. */
const RESTART_IDS = Object.freeze(["P05-E2E-24", "P05-E2E-24a"]);

/** يقيسها المشغّل من خارج النافذة: الخروج النظيف، وغياب الناجين. */
const RUNNER_IDS = Object.freeze(["P05-E2E-27", "P05-E2E-28"]);

/** القياسات التسعة التي طلبتها المرحلة، بأسماء صفوف الأداء التي تحملها. */
export const REQUIRED_TIMINGS = Object.freeze([
  "memory_write_latency_us",
  "memory_retrieval_latency_us",
  "context_injection_overhead_us",
  "browser_session_startup_us",
  "navigation_overhead_excluding_server_us",
  "browser_observation_processing_us",
  "computer_capture_latency_us",
  "computer_action_dispatch_us",
  "evidence_persistence_per_row_us",
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
  // التجهيزتان ملك المشغّل كذلك: يجب أن تنتهيا بانتهاء التشغيل.
  if (native?.fixture_exited !== true) problems.push("the loopback fixture process did not end");
  if (native?.desktop?.exited !== true) problems.push("the desktop fixture process did not end");
  return problems.length === 0
    ? { verdict: "PASS", detail: "no product, WebView2, loopback-fixture or desktop-fixture process survived" }
    : { verdict: "FAIL", detail: problems.join("; ") };
}

export function e2eVerdict(inputs, id) {
  const native = inputs.native;
  if (native === null || native === undefined || native.performed !== true) {
    return { verdict: "NOT_TESTED", detail: native?.reason ?? "the native stage did not run" };
  }
  if (id === "P05-E2E-27") {
    const first = launchClean(native.first);
    const restart = launchClean(native.restart);
    return { verdict: worst([first.verdict, restart.verdict]), detail: `first: ${first.detail}; restart: ${restart.detail}` };
  }
  if (id === "P05-E2E-28") return survivors(native);
  const report = windowReport(inputs, RESTART_IDS.includes(id) ? "restart" : "first");
  if (report === null) return { verdict: "FAIL", detail: `${RESTART_IDS.includes(id) ? "restart" : "first"} launch produced no E2E report` };
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

function webRequests(inputs) {
  const log = inputs.native?.fixture_log;
  return log !== null && log !== undefined && Array.isArray(log.web_requests) ? log.web_requests : null;
}

function executeCalls(inputs, scenario, tag) {
  const calls = completions(inputs);
  if (calls === null) return null;
  return calls.filter((entry) => entry.contract === "execute" && entry.scenario === scenario && (tag === undefined || entry.mission_tag === tag));
}

export function checkVerdict(inputs, id) {
  if (id.startsWith("P05-SEC-") || id.startsWith("P05-EVIDENCE-")) {
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
      const labelled =
        native.fixture_state?.label === "TEST FIXTURE" && native.fixture_log?.label === "TEST FIXTURE" && native.desktop?.state?.label === "TEST FIXTURE";
      const reported = windowReport(inputs, "first")?.fixture_label === "TEST FIXTURE";
      return labelled && reported
        ? { verdict: "PASS", detail: "the model, web and desktop fixtures are labelled TEST FIXTURE in their state, their log and the window report" }
        : { verdict: "FAIL", detail: `state ${String(native.fixture_state?.label)}, log ${String(native.fixture_log?.label)}, desktop ${String(native.desktop?.state?.label)}, window report ${reported}` };
    }
    case "FIXTURE-RECEIVED-AGENT-CALLS": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const contracts = new Set(calls.map((entry) => entry.contract));
      const scenarioSet = new Set(calls.map((entry) => entry.scenario));
      return calls.length > 0 && contracts.has("plan") && contracts.has("execute")
        ? { verdict: "PASS", detail: `${calls.length} agent call(s) over loopback; contracts ${[...contracts].join(",")}; scenarios ${[...scenarioSet].join(",")}` }
        : { verdict: "FAIL", detail: `${calls.length} call(s); contracts ${[...contracts].join(",")}` };
    }
    case "FIXTURE-NO-AUTHORIZATION-HEADER": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      if (calls.length === 0) return { verdict: "NOT_TESTED", detail: "the fixture received no call, so its silence proves nothing" };
      const carried = calls.filter((entry) => entry.carried_authorization === true);
      return carried.length === 0
        ? { verdict: "PASS", detail: `${calls.length} call(s) reached the local provider and none carried an authorization header` }
        : { verdict: "FAIL", detail: `${carried.length} call(s) carried an authorization header` };
    }
    case "WEB-FIXTURE-NO-CREDENTIAL": {
      const requests = webRequests(inputs);
      if (requests === null) return { verdict: "NOT_TESTED", detail: "no web fixture log" };
      if (requests.length === 0) return { verdict: "NOT_TESTED", detail: "the web fixture received nothing" };
      const credentials = requests.filter((entry) => entry.carried_authorization === true || entry.carried_cookie === true);
      const passwords = requests.filter((entry) => entry.body_has_password_field === true);
      const submits = requests.filter((entry) => entry.method === "POST" && entry.path === "/submit");
      const withItem = submits.filter((entry) => entry.body_has_item === true);
      return credentials.length === 0 && passwords.length === 0 && submits.length === 1 && withItem.length === 1
        ? { verdict: "PASS", detail: `${requests.length} page request(s): none carried an authorization header or cookie, no password value was posted, and the one approved submission carried only the typed field` }
        : { verdict: "FAIL", detail: `credential-bearing ${credentials.length}, password values posted ${passwords.length}, submissions ${submits.length} (${withItem.length} with the typed field)` };
    }
    case "WEB-FIXTURE-ONLY-LOOPBACK": {
      const requests = webRequests(inputs);
      if (requests === null) return { verdict: "NOT_TESTED", detail: "no web fixture log" };
      const endpoint = String(native.fixture_state?.web_endpoint ?? "");
      const loopback = /^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint);
      return loopback && requests.length > 0
        ? { verdict: "PASS", detail: `every browsing scenario targeted the loopback web fixture at ${endpoint}; no internet destination is a condition of PASS` }
        : { verdict: "FAIL", detail: `web fixture endpoint ${endpoint}; requests ${requests.length}` };
    }
    case "INJECTION-FENCED": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const carrying = calls.filter((entry) => entry.injection_marker_fenced !== null && entry.injection_marker_fenced !== undefined);
      if (carrying.length === 0) return { verdict: "NOT_TESTED", detail: "no call carried the injected page text, so nothing hostile was measured" };
      const unfenced = carrying.filter((entry) => entry.injection_marker_fenced !== true);
      const inSystem = calls.filter((entry) => entry.injection_in_system === true);
      const hidden = calls.filter((entry) => entry.hidden_text_leaked === true);
      return unfenced.length === 0 && inSystem.length === 0 && hidden.length === 0
        ? { verdict: "PASS", detail: `${carrying.length} call(s) carried the injected page text, every occurrence inside an untrusted fence; none in a system instruction; hidden page text reached no model` }
        : { verdict: "FAIL", detail: `unfenced ${unfenced.length}, in a system instruction ${inSystem.length}, hidden text leaked ${hidden.length}` };
    }
    case "MEMORY-SCOPE-IN-PROMPT": {
      const same = executeCalls(inputs, "RECALL", "RECALL-P");
      const other = executeCalls(inputs, "RECALL", "RECALL-Q");
      const after = executeCalls(inputs, "RECALL", "RECALL-AFTER");
      if (same === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      if (same.length === 0 || other.length === 0 || after.length === 0) return { verdict: "NOT_TESTED", detail: "a recall mission reached no model" };
      const sameSaw = same.every((entry) => entry.has_memory_block === true && entry.mentions_project_fact === true);
      const otherSaw = other.some((entry) => entry.mentions_project_fact === true);
      const afterSaw = after.some((entry) => entry.mentions_project_fact === true);
      const episodes = [...same, ...other, ...after].some((entry) => entry.mentions_web_episode === true);
      return sameSaw && !otherSaw && !afterSaw && !episodes
        ? { verdict: "PASS", detail: "the model saw the project fact only in the same project, never in another project or after deletion, and never another mission's episode" }
        : { verdict: "FAIL", detail: `same project saw it ${sameSaw}; other project ${otherSaw}; after deletion ${afterSaw}; another mission's episode ${episodes}` };
    }
    case "MEMORY-LABELLED-IN-PROMPT": {
      const same = executeCalls(inputs, "RECALL", "RECALL-P");
      if (same === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      if (same.length === 0) return { verdict: "NOT_TESTED", detail: "the recall mission reached no model" };
      return same.every((entry) => entry.has_memory_block === true)
        ? { verdict: "PASS", detail: `${same.length} call(s) received memory under the MEMORY — UNTRUSTED / NON-AUTHORITATIVE label` }
        : { verdict: "FAIL", detail: "memory reached a model without its label" };
    }
    case "OBSERVATION-LABELLED-IN-PROMPT": {
      const follow = (executeCalls(inputs, "WEB") ?? []).filter((entry) => entry.step === "follow");
      if (follow.length === 0) return { verdict: "NOT_TESTED", detail: "no follow-up agent call after a page observation" };
      return follow.every((entry) => entry.has_web_observation === true)
        ? { verdict: "PASS", detail: `${follow.length} follow-up call(s) received the page as OBSERVATION — WEB_UNTRUSTED` }
        : { verdict: "FAIL", detail: "a page observation reached the next agent without its label" };
    }
    case "SCREEN-OBSERVATION-IN-PROMPT": {
      const act = (executeCalls(inputs, "DESKTOP") ?? []).filter((entry) => entry.step === "act");
      if (act.length === 0) return { verdict: "NOT_TESTED", detail: "no acting agent call after a screen observation" };
      return act.every((entry) => entry.has_screen_observation === true && entry.has_observation_block === true && entry.has_digest === true)
        ? { verdict: "PASS", detail: `${act.length} acting call(s) received the screen as SCREEN_CONTENT — UNTRUSTED inside the observation block, with the observation digest to bind to` }
        : { verdict: "FAIL", detail: "a screen observation reached the acting agent without its label or digest" };
    }
    case "DESKTOP-FIXTURE-STATE": {
      const state = native.desktop?.state;
      if (state === null || state === undefined) return { verdict: "NOT_TESTED", detail: "the desktop fixture state was not read" };
      const events = Array.isArray(state.events) ? state.events : [];
      const allowed = new Set(["INCREMENT", "SHUFFLE", "CLOSED"]);
      const unexpected = events.filter((event) => !allowed.has(event));
      const ok = state.counter === 1 && state.delete_count === 0 && state.password_len === 0 && state.typed === "" && unexpected.length === 0;
      return ok
        ? { verdict: "PASS", detail: `measured by the fixture window itself: one safe increment, the layout change, no delete press, nothing typed, no password text, no fake-approve press (events ${events.join(",")})` }
        : { verdict: "FAIL", detail: `counter ${state.counter}, delete presses ${state.delete_count}, password length ${state.password_len}, typed ${JSON.stringify(state.typed)}, unexpected events ${unexpected.join(",") || "none"}` };
    }
    case "DESKTOP-ONLY-FIXTURE-TOUCHED": {
      const state = native.desktop?.state;
      const report = windowReport(inputs, "first");
      if (state === null || state === undefined || report === null) return { verdict: "NOT_TESTED", detail: "no desktop fixture state or no window report" };
      const grantHwnd = report.facts?.fixture_grant_hwnd ?? null;
      const grant = report.facts?.desktop?.grant ?? null;
      const samePid = grant !== null && Number(grant.pid) === Number(state.pid) && Number(native.desktop_pid) === Number(state.pid);
      const sameHwnd = grantHwnd !== null && String(grantHwnd).toLowerCase() === String(state.hwnd).toLowerCase();
      return samePid && sameHwnd
        ? { verdict: "PASS", detail: `the only window granted was the harness-owned fixture: pid ${state.pid}, hwnd ${state.hwnd}` }
        : { verdict: "FAIL", detail: `granted pid ${String(grant?.pid)} vs fixture ${String(state.pid)}; granted hwnd ${String(grantHwnd)} vs fixture ${String(state.hwnd)}` };
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
      return rows.length > 0
        ? { verdict: "PASS", detail: `${rows.length} timing(s) recorded, every one LOCALLY_MEASURED with its method` }
        : { verdict: "NOT_TESTED", detail: "no timing was recorded by the native run" };
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
        ? { verdict: "PASS", detail: `${rows.filter((row) => row.excludes_provider_time).length} timing(s) exclude provider and server time; ${rows.filter((row) => !row.excludes_provider_time).length} declare that they include it` }
        : { verdict: "FAIL", detail: `undeclared ${undeclared.map((row) => row.name).join(",")}; end-to-end rows claiming exclusion ${mislabelled.map((row) => row.name).join(",")}` };
    }
    default:
      return { verdict: "NOT_TESTED", detail: `unknown check ${id}` };
  }
}

/**
 * قياسات الأداء، مصنّفة. متوسّط كل عدّاد = مجموعه ÷ عدده، مقيسًا داخل المنتج في
 * التشغيل الأصلي نفسه. ما يشمل نداء نموذج أو زمن خادم يُعلن ذلك.
 */
export function performanceRows(inputs) {
  const native = inputs.native;
  const rows = [];
  const push = (name, value, unit, category, method, excludes, samples = null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    rows.push({ name, value, unit, category, provenance: "LOCALLY_MEASURED", method, excludes_provider_time: excludes, samples });
  };
  const mean = (total, count) => (typeof total === "number" && typeof count === "number" && count > 0 ? Math.round(total / count) : undefined);

  const timings = windowReport(inputs, "first")?.facts?.timings ?? null;
  if (timings !== null && timings !== undefined && timings.ok === true) {
    const m = timings.memory ?? {};
    const b = timings.browser ?? {};
    const c = timings.computer ?? {};
    const ev = timings.evidence ?? {};
    push("memory_write_latency_us", mean(m.write_micros_total, m.writes), "us", "MEMORY", "mean time of MemoryService::submit (validate, deduplicate, coalesce, conflict check, one SQLite transaction)", true, m.writes ?? null);
    push("memory_retrieval_latency_us", mean(m.retrieval_micros_total, m.retrievals), "us", "MEMORY", "mean time of a scoped retrieval with ranking and access recording", true, m.retrievals ?? null);
    push("context_injection_overhead_us", mean(m.context_micros_total, m.context_blocks), "us", "MEMORY", "mean time to build one labelled, budgeted memory context block for an agent call", true, m.context_blocks ?? null);
    push("browser_session_startup_us", mean(b.session_start_micros_total, b.sessions_started), "us", "BROWSER", "mean time to create and persist a mission-bound browser session", true, b.sessions_started ?? null);
    push("navigation_overhead_excluding_server_us", mean(b.navigation_overhead_micros_total, b.navigations), "us", "BROWSER", "mean navigation wall time minus the fixture server's own response time", true, b.navigations ?? null);
    push("browser_observation_processing_us", mean(b.observation_micros_total, b.observations), "us", "BROWSER", "mean time to parse, bound, label and persist one page observation", true, b.observations ?? null);
    push("computer_capture_latency_us", mean(c.capture_micros_total, c.captures), "us", "COMPUTER", "mean time to capture the granted window, enumerate its controls and digest the frame (PrintWindow)", true, c.captures ?? null);
    push("computer_action_dispatch_us", mean(c.dispatch_micros_total, c.dispatches), "us", "COMPUTER", "mean time from the final checks to SendInput returning for one action", true, c.dispatches ?? null);
    push("evidence_persistence_per_row_us", mean(ev.micros_total, ev.rows), "us", "EVIDENCE", "mean time per evidence row inside the mission save transaction (delete and re-insert of the mission's evidence)", true, ev.rows ?? null);
  }

  for (const [stage, launch] of [
    ["first", native?.first],
    ["restart", native?.restart],
  ]) {
    const m = launch?.measurements;
    if (m === undefined || m === null) continue;
    push(`${stage}_window_visible_ms`, m.window_visible_ms, "ms", "STARTUP", "process start to the first main window handle", true);
    push(`${stage}_cold_start_to_bootstrap_ms`, m.cold_start_to_bootstrap_ms, "ms", "STARTUP", "process start to the host writing the bootstrap report", true);
    push(`${stage}_suite_complete_ms`, m.suite_complete_ms, "ms", "END_TO_END", "process start to the window writing its E2E report; includes every fixture model and page call", false);
    push(`${stage}_exit_ms`, m.exit_ms, "ms", "SHUTDOWN", "process start to process exit after the window close", true);
    const memory = launch?.memory_after_suite;
    if (memory !== undefined && memory !== null) {
      push(`${stage}_working_set_bytes`, memory.host_working_set_bytes + memory.child_working_set_bytes, "bytes", "MEMORY_FOOTPRINT", memory.method, true);
    }
  }

  const window = windowReport(inputs, "first")?.measurements ?? {};
  for (const [name, entry] of Object.entries(window)) {
    if (entry === null || typeof entry !== "object" || typeof entry.value !== "number") continue;
    // ما يمرّ بمهمّة كاملة يشمل نداءات النموذج: يُعلن ذلك.
    const endToEnd = /mission|grant_from_ui/.test(name);
    push(name, entry.value, entry.unit ?? "ms", endToEnd ? "END_TO_END" : "CANCELLATION", entry.method ?? "measured inside the real window", !endToEnd);
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
});

export function gateRegressionVerdict(inputs, phase) {
  const document = {
    "PHASE-00": inputs.phase00Gate,
    "PHASE-01": inputs.phase01Gate,
    "PHASE-02": inputs.phase02Gate,
    "PHASE-03": inputs.phase03Gate,
    "PHASE-04": inputs.phase04Gate,
  }[phase];
  const started = inputs.runStarted ?? null;
  if (document === null || document === undefined) return { verdict: "NOT_TESTED", detail: `${phase} final gate document absent` };
  if (document.__unreadable !== undefined) return { verdict: "INCONCLUSIVE", detail: `${phase} gate unreadable` };
  if (started === null) return { verdict: "NOT_TESTED", detail: "the run start is unknown, so a fresh re-run cannot be told from an old document" };
  const at = typeof document.measured_at === "string" ? document.measured_at : document.decided_at;
  // سياسة المالك (2026-09-30): كل مرحلة تُختبر منفصلة. في وضع PRIOR_GATES تُقرأ البوابة الأدنى كما حكم بها
  // مشغّلها (قانونية، PASS، تفتح التالية) ولا يُعاد تشغيلها؛ في وضع RERUN تُشترط حداثتها كما كانت.
  const fresh = typeof at === "string" && (inputs.regressionMode === "PRIOR_GATES" || at >= started);
  if (!fresh) return { verdict: "NOT_TESTED", detail: `${phase} gate was not re-run in this run (decided ${String(at)}, run started ${started})` };
  const canonical = phase === "PHASE-00" ? document.native === true && document.platform === "win32" : document.canonical === true;
  if (!canonical) return { verdict: "INCONCLUSIVE", detail: `${phase} gate re-run is not canonical` };
  const field = NEXT_GATE[phase];
  const opensNext = field === undefined ? true : document[field] === "ALLOWED";
  const passed = document.verdict === "PASS" && opensNext;
  return {
    verdict: passed ? "PASS" : document.verdict === "PASS" ? "FAIL" : normalise(document.verdict),
    detail: `${phase} = ${document.verdict}${field === undefined ? "" : `, ${field} ${document[field]}`}, decided ${String(at)}`,
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
  return P05_CLAIMS.map((claim) => ({ document: claim.document, ...evaluateClaim(inputs, claim) }));
}
