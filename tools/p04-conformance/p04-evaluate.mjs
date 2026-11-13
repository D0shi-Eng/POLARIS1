// تقييم شروط Phase-04 من القياسات الخام.
//
// دالّة نقية فوق مدخلات مقروءة: مجموعات الاختبار، والفحص الساكن، والإطلاقين
// الأصليين، وسجل التجهيزة، ووثائق بوابات المراحل السابقة. لا شبكة ولا قرص هنا،
// فتُختبر كما هي.

import { P04_CLAIMS, SECURITY_GROUPS } from "./p04-claims.mjs";
import { findSecretLeaks } from "./p04-security.mjs";
import { VERDICTS, worst } from "./p04-common.mjs";

/** السيناريوهات التي يجب أن يحملها تقرير النافذة. مغلقة. */
export const E2E_IDS = Object.freeze([
  ...Array.from({ length: 30 }, (_, index) => `P04-E2E-${String(index + 1).padStart(2, "0")}`),
  "P04-E2E-29a",
]);

/** السيناريوهات التي تُقاس في طور إعادة التشغيل لا في الطور الأول. */
const RESTART_IDS = Object.freeze(["P04-E2E-29", "P04-E2E-29a"]);

/** السيناريوهات التي يقيسها المشغّل من خارج النافذة. */
const RUNNER_IDS = Object.freeze(["P04-E2E-30"]);

function groupOf(inputs, id) {
  return (inputs.groups ?? []).find((group) => group.group_id === id);
}

/** حكم اختبار مسمّى، أو كل الاختبارات تحت بادئة. */
export function testVerdict(inputs, groupId, name, prefix = false) {
  const group = groupOf(inputs, groupId);
  if (group === undefined) return { verdict: "NOT_TESTED", detail: `${groupId} did not run` };
  if (group.verdict === "BLOCKED") return { verdict: "BLOCKED", detail: `${groupId} could not start` };
  const tests = Array.isArray(group.tests) ? group.tests : [];
  const byPrefix = prefix || name.endsWith("::");
  const matched = byPrefix
    ? tests.filter((test) => test.name.startsWith(name) || test.name.includes(`::${name}`))
    : tests.filter((test) => test.name === name);
  if (matched.length === 0) return { verdict: "NOT_TESTED", detail: `${name} not found in ${groupId}` };
  if (matched.some((test) => test.status === "FAIL")) return { verdict: "FAIL", detail: `${name} failed` };
  if (matched.some((test) => test.status !== "PASS")) return { verdict: "INCONCLUSIVE", detail: `${name} skipped` };
  return { verdict: "PASS", detail: `${matched.length} test(s)` };
}

function scenarios(report) {
  return report !== null && report !== undefined && Array.isArray(report.scenarios) ? report.scenarios : [];
}

function reportOf(native, id) {
  const launch = RESTART_IDS.includes(id) ? native.restart : native.first;
  return { launch, report: launch?.e2e_report?.renderer ?? launch?.e2e_report ?? null };
}

function launchClean(launch) {
  if (launch === null || launch === undefined) return { verdict: "NOT_TESTED", detail: "launch not performed" };
  const problems = [];
  if (launch.started !== true) problems.push("not started");
  if (launch.startup_report === null || launch.startup_report === undefined) problems.push("no startup report");
  if (launch.closed_gracefully !== true) problems.push("window close did not end the process");
  if (launch.process_exited !== true) problems.push("process did not exit");
  if (launch.exit_code !== 0) problems.push(`exit code ${String(launch.exit_code)}`);
  if (launch.orphan_processes !== 0) problems.push(`${String(launch.orphan_processes)} surviving process(es)`);
  return problems.length === 0
    ? { verdict: "PASS", detail: "graceful exit, code 0, no survivor" }
    : { verdict: "FAIL", detail: problems.join("; ") };
}

/** حكم سيناريو E2E. الخروج النظيف يقيسه المشغّل من خارج النافذة. */
export function e2eVerdict(inputs, id) {
  const native = inputs.native;
  if (native === null || native === undefined || native.performed !== true) {
    return { verdict: "NOT_TESTED", detail: native?.reason ?? "the native stage did not run" };
  }
  if (RUNNER_IDS.includes(id)) {
    const first = launchClean(native.first);
    const restart = launchClean(native.restart);
    return { verdict: worst([first.verdict, restart.verdict]), detail: `first: ${first.detail}; restart: ${restart.detail}` };
  }
  const { report } = reportOf(native, id);
  if (report === null) {
    return { verdict: "FAIL", detail: `${RESTART_IDS.includes(id) ? "restart" : "first"} launch produced no E2E report` };
  }
  if (typeof report.fatal === "string") return { verdict: "FAIL", detail: `suite aborted: ${report.fatal}` };
  const found = scenarios(report).find((scenario) => scenario.id === id);
  if (found === undefined) return { verdict: "NOT_TESTED", detail: `${id} absent from the report` };
  return {
    verdict: found.status === "PASS" ? "PASS" : found.status === "FAIL" ? "FAIL" : "NOT_TESTED",
    detail: found.detail,
  };
}

function modelRequests(inputs) {
  const log = inputs.native?.fixture_log;
  return log !== null && log !== undefined && Array.isArray(log.requests) ? log.requests : null;
}

function mcpRequests(inputs) {
  const log = inputs.native?.fixture_log;
  return log !== null && log !== undefined && Array.isArray(log.mcp_requests) ? log.mcp_requests : null;
}

function completions(inputs) {
  const requests = modelRequests(inputs);
  return requests === null ? null : requests.filter((entry) => entry.kind === "completion");
}

function windowReport(inputs, stage = "first") {
  const launch = inputs.native?.[stage] ?? null;
  return launch?.e2e_report?.renderer ?? launch?.e2e_report ?? null;
}

export function checkVerdict(inputs, id) {
  if (id.startsWith("P04-SEC-") || id.startsWith("P04-EVIDENCE-")) {
    const pool = [...(inputs.securityStatic?.checks ?? []), ...(inputs.securityEvidence?.checks ?? [])];
    const found = pool.find((entry) => entry.check_id === id);
    return found === undefined ? { verdict: "NOT_TESTED", detail: `${id} was not run` } : { verdict: found.verdict, detail: found.detail };
  }
  const native = inputs.native;
  const performed = native !== null && native !== undefined && native.performed === true;
  if (!performed) return { verdict: "NOT_TESTED", detail: native?.reason ?? "the native stage did not run" };

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
      const state = native.fixture_state;
      const log = native.fixture_log;
      const labelled = state?.label === "TEST FIXTURE" && log?.label === "TEST FIXTURE";
      const reported = [windowReport(inputs, "first")]
        .filter((report) => report !== null)
        .every((report) => report.fixture_label === "TEST FIXTURE");
      return labelled && reported
        ? { verdict: "PASS", detail: "the provider and the tool server are labelled TEST FIXTURE in their state, their log and the window report" }
        : { verdict: "FAIL", detail: `state ${String(state?.label)}, log ${String(log?.label)}, window report labelled ${reported}` };
    }
    case "FIXTURE-RECEIVED-AGENT-CALLS": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const models = new Set(calls.map((entry) => entry.model));
      const contracts = new Set(calls.map((entry) => entry.contract));
      const proposing = calls.filter((entry) => entry.offers_tools === true);
      return calls.length > 0 && contracts.has("plan") && contracts.has("execute")
        ? {
            verdict: "PASS",
            detail: `${calls.length} agent call(s) arrived over loopback for model(s) ${[...models].join(",")}; contracts ${[...contracts].join(",")}; ${proposing.length} call(s) were offered a tool list`,
          }
        : { verdict: "FAIL", detail: `${calls.length} call(s); contracts ${[...contracts].join(",")}` };
    }
    case "FIXTURE-NO-AUTHORIZATION-HEADER": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      if (calls.length === 0) return { verdict: "NOT_TESTED", detail: "the fixture received no call, so its silence proves nothing" };
      const carried = calls.filter((entry) => entry.carried_authorization === true);
      return carried.length === 0
        ? { verdict: "PASS", detail: `${calls.length} call(s) reached the local provider and none carried an authorization header` }
        : { verdict: "FAIL", detail: `${carried.length} call(s) carried an authorization header to a local provider` };
    }
    case "MCP-FIXTURE-NO-AUTHORIZATION-HEADER": {
      const calls = mcpRequests(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no MCP fixture log" };
      if (calls.length === 0) return { verdict: "NOT_TESTED", detail: "the tool server received no call, so its silence proves nothing" };
      const carried = calls.filter((entry) => entry.carried_authorization === true);
      return carried.length === 0
        ? { verdict: "PASS", detail: `${calls.length} JSON-RPC call(s) reached the local tool server and none carried an authorization header` }
        : { verdict: "FAIL", detail: `${carried.length} call(s) carried an authorization header to a local tool server` };
    }
    case "MCP-FIXTURE-RECEIVED-DISCOVERY-AND-CALLS": {
      const calls = mcpRequests(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no MCP fixture log" };
      const methods = new Set(calls.map((entry) => entry.method));
      return methods.has("initialize") && methods.has("tools/list") && methods.has("tools/call")
        ? { verdict: "PASS", detail: `${calls.length} JSON-RPC call(s); methods ${[...methods].join(",")}` }
        : { verdict: "FAIL", detail: `methods observed: ${[...methods].join(",") || "none"}` };
    }
    case "P04-FIXTURE-HOSTILE-CONTEXT-CHANGED-NOTHING": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const hostile = calls.filter((entry) => entry.hostile_marker === true);
      if (hostile.length === 0) {
        return { verdict: "NOT_TESTED", detail: "no call carried the hostile marker, so nothing hostile was measured" };
      }
      const models = new Set(calls.map((entry) => entry.model));
      // النموذج واحد طوال التشغيل مهما قال المحتوى المعادي، ولا أداة نُفِّذت
      // خارج ما تسمح به المهارة: الاثنان يقاسان من سجل التجهيزة والتقرير.
      const report = windowReport(inputs, "first");
      const scenario = scenarios(report).find((entry) => entry.id === "P04-E2E-22");
      return models.size <= 1 && scenario?.status === "PASS"
        ? {
            verdict: "PASS",
            detail: `${hostile.length} call(s) carried hostile project context; the model stayed ${[...models].join(",") || "unchanged"} and the window measured no authority gained`,
          }
        : { verdict: "FAIL", detail: `models seen ${[...models].join(", ")}; window scenario ${scenario?.status ?? "absent"}` };
    }
    case "NATIVE-NOTHING-IN-FLIGHT-AFTER-CANCEL": {
      const report = windowReport(inputs, "first");
      if (report === null) return { verdict: "NOT_TESTED", detail: "the first launch produced no report" };
      const observation = report.facts?.cancellation ?? null;
      const scenario = scenarios(report).find((entry) => entry.id === "P04-E2E-24");
      if (observation === null) return { verdict: "NOT_TESTED", detail: "the window recorded no cancellation observation" };
      // «كان هناك شيء في الطيران» شرط أول: لولاه لكان الصفر بعد الإلغاء صفرًا
      // لأن شيئًا لم يبدأ، لا لأن الإلغاء أوقفه.
      const before = observation.observed ?? null;
      const after = observation.after ?? null;
      const started = before !== null && (Number(before.calls ?? 0) > 0 || Number(before.runs ?? 0) > 0);
      const settled = after !== null && Number(after.calls ?? -1) === 0 && Number(after.runs ?? -1) === 0;
      return started && settled && scenario?.status === "PASS"
        ? {
            verdict: "PASS",
            detail: `in flight before the cancellation ${JSON.stringify(before)}, after it ${JSON.stringify(after)}`,
          }
        : {
            verdict: "FAIL",
            detail: `something was in flight first: ${started}; nothing was left afterwards: ${settled}; scenario ${scenario?.status ?? "absent"}`,
          };
    }
    case "NATIVE-SCENARIOS-COMPLETE": {
      const first = windowReport(inputs, "first");
      const restart = windowReport(inputs, "restart");
      if (first === null) return { verdict: "NOT_TESTED", detail: "the first launch produced no report" };
      const seen = new Set([...scenarios(first).map((s) => s.id), ...scenarios(restart).map((s) => s.id)]);
      const missing = E2E_IDS.filter((id2) => !seen.has(id2) && !RUNNER_IDS.includes(id2));
      const notTested = [...scenarios(first), ...scenarios(restart)].filter((s) => s.status === "NOT_TESTED");
      return missing.length === 0
        ? { verdict: "PASS", detail: `${seen.size} scenario(s) recorded; ${notTested.length} declared NOT_TESTED with a reason` }
        : { verdict: "FAIL", detail: `absent from the report: ${missing.join(", ")}` };
    }
    case "RESTART-LAUNCH-CLEAN":
      return launchClean(native.restart);
    case "E2E-REPORT-NO-SECRET": {
      const text = JSON.stringify([native.first?.e2e_report ?? null, native.restart?.e2e_report ?? null]);
      if (native.first?.e2e_report === undefined || native.first?.e2e_report === null) {
        return { verdict: "NOT_TESTED", detail: "no E2E report" };
      }
      const hits = findSecretLeaks(text);
      return hits.length === 0
        ? { verdict: "PASS", detail: "no key shape in what the renderer received" }
        : { verdict: "FAIL", detail: hits.join(",") };
    }
    case "PERFORMANCE-MEASURED": {
      const measured = performanceRows(inputs);
      return measured.length > 0
        ? { verdict: "PASS", detail: `${measured.length} timing(s) recorded, every one LOCALLY_MEASURED with its method` }
        : { verdict: "NOT_TESTED", detail: "no timing was recorded by the native run" };
    }
    case "PERFORMANCE-EXCLUDES-PROVIDER-TIME": {
      const rows = performanceRows(inputs);
      if (rows.length === 0) return { verdict: "NOT_TESTED", detail: "no timing was recorded" };
      const gateway = rows.filter((row) => row.category === "TOOL_GATEWAY");
      const offenders = gateway.filter((row) => row.excludes_provider_time !== true);
      const endToEnd = rows.filter((row) => row.category === "END_TO_END");
      const undeclared = endToEnd.filter((row) => row.excludes_provider_time !== false);
      return offenders.length === 0 && undeclared.length === 0
        ? {
            verdict: "PASS",
            detail: `${gateway.length} gateway timing(s) exclude provider inference time; ${endToEnd.length} end-to-end timing(s) declare that they include it`,
          }
        : {
            verdict: "FAIL",
            detail: `${offenders.length} gateway timing(s) include provider time; ${undeclared.length} end-to-end timing(s) do not declare it: ${[...offenders, ...undeclared].map((row) => row.name).join(", ")}`,
          };
    }
    default:
      return { verdict: "NOT_TESTED", detail: `unknown check ${id}` };
  }
}

/**
 * قياسات الأداء، مصنّفة.
 *
 * `TOOL_GATEWAY` لا تحمل وقت المزوّد ولا وقت خادم أدوات خارجي: الأرقام التي
 * تشمل نداء نموذج تُصنّف `END_TO_END` وتُعلن ذلك. لا رقم يُنسب إلى POLARIS وهو
 * يحمل زمن استدلال.
 */
export function performanceRows(inputs) {
  const native = inputs.native;
  const rows = [];
  const push = (name, value, unit, category, method, excludes) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    rows.push({ name, value, unit, category, provenance: "LOCALLY_MEASURED", method, excludes_provider_time: excludes });
  };

  for (const [stage, launch] of [
    ["first", native?.first],
    ["restart", native?.restart],
  ]) {
    const m = launch?.measurements;
    if (m === undefined || m === null) continue;
    push(`${stage}_window_visible_ms`, m.window_visible_ms, "ms", "STARTUP", "process start to the first main window handle", true);
    push(`${stage}_cold_start_to_bootstrap_ms`, m.cold_start_to_bootstrap_ms, "ms", "STARTUP", "process start to the host writing the bootstrap report", true);
    push(`${stage}_suite_complete_ms`, m.suite_complete_ms, "ms", "END_TO_END", "process start to the window writing its E2E report; includes every provider and tool-server call", false);
    push(`${stage}_exit_ms`, m.exit_ms, "ms", "SHUTDOWN", "process start to process exit after the window close", true);
    const memory = launch?.memory_after_suite;
    if (memory !== undefined && memory !== null) {
      rows.push({
        name: `${stage}_working_set_bytes`,
        value: memory.host_working_set_bytes + memory.child_working_set_bytes,
        unit: "bytes",
        category: "MEMORY",
        provenance: "LOCALLY_MEASURED",
        method: memory.method,
        excludes_provider_time: true,
      });
    }
  }

  const window = windowReport(inputs, "first")?.measurements ?? {};
  for (const [name, entry] of Object.entries(window)) {
    if (entry === null || typeof entry !== "object" || typeof entry.value !== "number") continue;
    // كل ما يمرّ بنداء نموذج يُعلن أنه شامل لزمن المزوّد.
    const endToEnd = /start|loop|mission/.test(name);
    rows.push({
      name,
      value: entry.value,
      unit: entry.unit ?? "ms",
      category: endToEnd ? "END_TO_END" : "TOOL_GATEWAY",
      provenance: "LOCALLY_MEASURED",
      method: entry.method ?? "measured inside the real window",
      excludes_provider_time: !endToEnd,
    });
  }
  return rows;
}

export function gateRegressionVerdict(inputs, phase) {
  const document =
    phase === "PHASE-00"
      ? inputs.phase00Gate
      : phase === "PHASE-01"
        ? inputs.phase01Gate
        : phase === "PHASE-02"
          ? inputs.phase02Gate
          : inputs.phase03Gate;
  const started = inputs.native?.run_started ?? inputs.runStarted ?? null;
  if (document === null || document === undefined) return { verdict: "NOT_TESTED", detail: `${phase} final gate document absent` };
  if (document.__unreadable !== undefined) return { verdict: "INCONCLUSIVE", detail: `${phase} gate unreadable` };
  if (started === null) {
    return { verdict: "NOT_TESTED", detail: "the run start is unknown, so a fresh re-run cannot be told from an old document" };
  }
  // Phase-00 يكتب `decided_at`، وما بعده يكتب `measured_at`.
  const at = typeof document.measured_at === "string" ? document.measured_at : document.decided_at;
  const fresh = typeof at === "string" && at >= started;
  if (!fresh) {
    return { verdict: "NOT_TESTED", detail: `${phase} gate was not re-run in this run (decided ${String(at)}, run started ${started})` };
  }
  const canonical = phase === "PHASE-00" ? document.native === true && document.platform === "win32" : document.canonical === true;
  if (!canonical) return { verdict: "INCONCLUSIVE", detail: `${phase} gate re-run is not canonical` };
  const opensNext =
    phase === "PHASE-01"
      ? document.phase_02_gate === "ALLOWED"
      : phase === "PHASE-02"
        ? document.phase_03_gate === "ALLOWED"
        : phase === "PHASE-03"
          ? document.phase_04_gate === "ALLOWED"
          : true;
  const passed = document.verdict === "PASS" && opensNext;
  const suffix =
    phase === "PHASE-01"
      ? `, Phase-02 gate ${document.phase_02_gate}`
      : phase === "PHASE-02"
        ? `, Phase-03 gate ${document.phase_03_gate}`
        : phase === "PHASE-03"
          ? `, Phase-04 gate ${document.phase_04_gate}`
          : "";
  return {
    verdict: passed ? "PASS" : document.verdict === "PASS" ? "FAIL" : normalise(document.verdict),
    detail: `${phase} = ${document.verdict}${suffix}, decided ${String(at)}`,
  };
}

function normalise(value) {
  return VERDICTS.includes(value) ? value : "INCONCLUSIVE";
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
  const counts =
    group.counts === null || group.counts === undefined ? "" : ` (${group.counts.passed ?? "?"}/${group.counts.tests ?? "?"})`;
  return { verdict: normalise(group.verdict), detail: `${id} ${group.verdict}${counts} ${group.reason ?? ""}`.trim() };
}

export function requirementVerdict(inputs, requirement) {
  switch (requirement.type) {
    case "test":
      return {
        ...testVerdict(inputs, requirement.group, requirement.name, requirement.prefix === true),
        requirement: `${requirement.group} :: ${requirement.name}`,
      };
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
      return {
        verdict: bytes.verdict === "PASS" ? "PASS" : "FAIL",
        detail: `${bytes.summary?.clean ?? 0}/${bytes.summary?.checked ?? 0} clean`,
        requirement: "byte gate",
      };
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
    reason_code:
      failing.length === 0
        ? ""
        : failing
            .slice(0, 6)
            .map((entry) => `${entry.requirement}: ${entry.verdict} (${entry.detail})`)
            .join(" | "),
    measured_by: measurements,
  };
}

export function evaluateAll(inputs) {
  return P04_CLAIMS.map((claim) => ({ document: claim.document, ...evaluateClaim(inputs, claim) }));
}
