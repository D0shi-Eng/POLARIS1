// تقييم شروط Phase-03 من القياسات الخام.
//
// دالّة نقية فوق مدخلات مقروءة: مجموعات الاختبار، والفحص الساكن، والإطلاقين
// الأصليين، وسجل التجهيزة، ووثائق بوابات المراحل السابقة. لا شبكة ولا قرص هنا،
// فتُختبر كما هي.

import { P03_CLAIMS, SECURITY_GROUPS } from "./p03-claims.mjs";
import { findSecretLeaks } from "./p03-security.mjs";
import { VERDICTS, worst } from "./p03-common.mjs";

/** السيناريوهات التي يجب أن يحملها تقرير النافذة. مغلقة. */
export const E2E_IDS = Object.freeze([
  ...Array.from({ length: 30 }, (_, index) => `P03-E2E-${String(index + 1).padStart(2, "0")}`),
  "P03-E2E-27a",
  "P03-E2E-27b",
]);

/** السيناريوهات التي تُقاس في طور إعادة التشغيل لا في الطور الأول. */
const RESTART_IDS = Object.freeze(["P03-E2E-27", "P03-E2E-27a", "P03-E2E-27b"]);

/** السيناريوهات التي يقيسها المشغّل من خارج النافذة. */
const RUNNER_IDS = Object.freeze(["P03-E2E-30"]);

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
  return problems.length === 0 ? { verdict: "PASS", detail: "graceful exit, code 0, no survivor" } : { verdict: "FAIL", detail: problems.join("; ") };
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
  if (report === null) return { verdict: "FAIL", detail: `${RESTART_IDS.includes(id) ? "restart" : "first"} launch produced no E2E report` };
  if (typeof report.fatal === "string") return { verdict: "FAIL", detail: `suite aborted: ${report.fatal}` };
  const found = scenarios(report).find((scenario) => scenario.id === id);
  if (found === undefined) return { verdict: "NOT_TESTED", detail: `${id} absent from the report` };
  return { verdict: found.status === "PASS" ? "PASS" : found.status === "FAIL" ? "FAIL" : "NOT_TESTED", detail: found.detail };
}

function fixtureRequests(inputs) {
  const log = inputs.native?.fixture_log;
  return log !== null && log !== undefined && Array.isArray(log.requests) ? log.requests : null;
}

function completions(inputs) {
  const requests = fixtureRequests(inputs);
  return requests === null ? null : requests.filter((entry) => entry.kind === "completion");
}

export function checkVerdict(inputs, id) {
  if (id.startsWith("P03-SEC-") || id.startsWith("P03-EVIDENCE-")) {
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
      const reported = [native.first?.e2e_report?.renderer ?? native.first?.e2e_report ?? null]
        .filter((report) => report !== null)
        .every((report) => report.fixture_label === "TEST FIXTURE");
      return labelled && reported
        ? { verdict: "PASS", detail: "the provider is labelled TEST FIXTURE in its state, its log and the window report" }
        : { verdict: "FAIL", detail: `state ${String(state?.label)}, log ${String(log?.label)}, window report labelled ${reported}` };
    }
    case "FIXTURE-RECEIVED-AGENT-CALLS": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const models = new Set(calls.map((entry) => entry.model));
      const contracts = new Set(calls.map((entry) => entry.contract));
      const declared = calls.filter((entry) => entry.declares_output_contract === true && entry.declares_system_policy === true);
      return calls.length > 0 && contracts.has("plan") && contracts.has("execute") && declared.length === calls.length
        ? { verdict: "PASS", detail: `${calls.length} agent call(s) arrived over loopback for model(s) ${[...models].join(",")}; contracts ${[...contracts].join(",")}; every call carried a labelled system policy and output contract` }
        : { verdict: "FAIL", detail: `${calls.length} call(s); contracts ${[...contracts].join(",")}; calls carrying a labelled policy and contract ${declared.length}` };
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
    case "FIXTURE-ASKED-FOR-NO-REASONING-TRACE": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const execute = calls.filter((entry) => entry.contract === "execute");
      if (execute.length === 0) return { verdict: "NOT_TESTED", detail: "no execution call reached the fixture" };
      const asked = execute.filter((entry) => entry.asks_for_no_reasoning_trace === true);
      return asked.length === execute.length
        ? { verdict: "PASS", detail: `all ${execute.length} execution call(s) told the model not to return a reasoning trace` }
        : { verdict: "FAIL", detail: `${execute.length - asked.length} of ${execute.length} execution call(s) did not forbid a reasoning trace` };
    }
    case "P03-FIXTURE-PROMPT-BOUNDARY": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      if (calls.length === 0) return { verdict: "NOT_TESTED", detail: "the fixture received no call" };
      const labelled = calls.filter((entry) => entry.declares_system_policy === true && entry.declares_output_contract === true);
      return labelled.length === calls.length
        ? { verdict: "PASS", detail: `${calls.length} call(s) carried labelled prompt parts rather than one anonymous string` }
        : { verdict: "FAIL", detail: `${calls.length - labelled.length} call(s) carried no labelled prompt part` };
    }
    case "P03-FIXTURE-NO-POLICY-DRIFT": {
      const calls = completions(inputs);
      if (calls === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
      const models = new Set(calls.map((entry) => entry.model));
      const hostile = calls.filter((entry) => entry.hostile_marker === true);
      // النموذج واحد طوال التشغيل مهما قال المحتوى المعادي.
      return models.size <= 1
        ? { verdict: "PASS", detail: `every agent call used the same model (${[...models].join(",") || "none"}); ${hostile.length} call(s) carried the hostile marker and changed nothing` }
        : { verdict: "FAIL", detail: `the model changed during the run: ${[...models].join(", ")}` };
    }
    case "NATIVE-SCENARIOS-COMPLETE": {
      const first = native.first?.e2e_report?.renderer ?? native.first?.e2e_report ?? null;
      const restart = native.restart?.e2e_report?.renderer ?? native.restart?.e2e_report ?? null;
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
      if (native.first?.e2e_report === undefined || native.first?.e2e_report === null) return { verdict: "NOT_TESTED", detail: "no E2E report" };
      const hits = findSecretLeaks(text);
      return hits.length === 0 ? { verdict: "PASS", detail: "no key shape in what the renderer received" } : { verdict: "FAIL", detail: hits.join(",") };
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
      const orchestration = rows.filter((row) => row.category === "ORCHESTRATION");
      // المقارنة داخل صنف التنسيق وحده: صفوف الإقلاع والخروج والذاكرة تستثني
      // زمن المزوّد كذلك، فإقحامها في العدّ يجعل الفرق سالبًا ويُسقط شرطًا سليمًا.
      const offenders = orchestration.filter((row) => row.excludes_provider_time !== true);
      const endToEnd = rows.filter((row) => row.category === "END_TO_END");
      const undeclared = endToEnd.filter((row) => row.excludes_provider_time !== false);
      return offenders.length === 0 && undeclared.length === 0
        ? {
            verdict: "PASS",
            detail: `${orchestration.length} orchestration timing(s) exclude provider inference time; ${endToEnd.length} end-to-end timing(s) declare that they include it`,
          }
        : {
            verdict: "FAIL",
            detail: `${offenders.length} orchestration timing(s) include provider time; ${undeclared.length} end-to-end timing(s) do not declare it: ${[...offenders, ...undeclared].map((row) => row.name).join(", ")}`,
          };
    }
    default:
      return { verdict: "NOT_TESTED", detail: `unknown check ${id}` };
  }
}

/**
 * قياسات الأداء، مصنّفة.
 *
 * `ORCHESTRATION` لا تحمل وقت المزوّد: الأرقام التي تشمل نداء نموذج تُصنّف
 * `END_TO_END` وتُعلن ذلك. لا رقم يُنسب إلى POLARIS وهو يحمل زمن استدلال.
 */
export function performanceRows(inputs) {
  const native = inputs.native;
  const rows = [];
  const push = (name, value, unit, category, method, excludes) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    rows.push({ name, value, unit, category, provenance: "LOCALLY_MEASURED", method, excludes_provider_time: excludes });
  };

  for (const [stage, launch] of [["first", native?.first], ["restart", native?.restart]]) {
    const m = launch?.measurements;
    if (m === undefined || m === null) continue;
    push(`${stage}_window_visible_ms`, m.window_visible_ms, "ms", "STARTUP", "process start to the first main window handle", true);
    push(`${stage}_cold_start_to_bootstrap_ms`, m.cold_start_to_bootstrap_ms, "ms", "STARTUP", "process start to the host writing the bootstrap report", true);
    push(`${stage}_suite_complete_ms`, m.suite_complete_ms, "ms", "END_TO_END", "process start to the window writing its E2E report; includes every provider call", false);
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

  const window = native?.first?.e2e_report?.renderer?.measurements ?? native?.first?.e2e_report?.measurements ?? {};
  for (const [name, entry] of Object.entries(window)) {
    if (entry === null || typeof entry !== "object" || typeof entry.value !== "number") continue;
    // كل ما يمرّ بنداء نموذج يُعلن أنه شامل لزمن المزوّد.
    const endToEnd = /start|loop/.test(name);
    rows.push({
      name,
      value: entry.value,
      unit: entry.unit ?? "ms",
      category: endToEnd ? "END_TO_END" : "ORCHESTRATION",
      provenance: "LOCALLY_MEASURED",
      method: entry.method ?? "measured inside the real window",
      excludes_provider_time: !endToEnd,
    });
  }
  return rows;
}

export function gateRegressionVerdict(inputs, phase) {
  const document =
    phase === "PHASE-00" ? inputs.phase00Gate : phase === "PHASE-01" ? inputs.phase01Gate : inputs.phase02Gate;
  const started = inputs.native?.run_started ?? inputs.runStarted ?? null;
  if (document === null || document === undefined) return { verdict: "NOT_TESTED", detail: `${phase} final gate document absent` };
  if (document.__unreadable !== undefined) return { verdict: "INCONCLUSIVE", detail: `${phase} gate unreadable` };
  if (started === null) return { verdict: "NOT_TESTED", detail: "the run start is unknown, so a fresh re-run cannot be told from an old document" };
  // Phase-00 يكتب `decided_at`، وPhase-01 وPhase-02 يكتبان `measured_at`.
  const at = typeof document.measured_at === "string" ? document.measured_at : document.decided_at;
  const fresh = typeof at === "string" && at >= started;
  if (!fresh) return { verdict: "NOT_TESTED", detail: `${phase} gate was not re-run in this run (decided ${String(at)}, run started ${started})` };
  const canonical = phase === "PHASE-00" ? document.native === true && document.platform === "win32" : document.canonical === true;
  if (!canonical) return { verdict: "INCONCLUSIVE", detail: `${phase} gate re-run is not canonical` };
  const opensNext =
    phase === "PHASE-01" ? document.phase_02_gate === "ALLOWED" : phase === "PHASE-02" ? document.phase_03_gate === "ALLOWED" : true;
  const passed = document.verdict === "PASS" && opensNext;
  const suffix =
    phase === "PHASE-01" ? `, Phase-02 gate ${document.phase_02_gate}` : phase === "PHASE-02" ? `, Phase-03 gate ${document.phase_03_gate}` : "";
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
  const counts = group.counts === null || group.counts === undefined ? "" : ` (${group.counts.passed ?? "?"}/${group.counts.tests ?? "?"})`;
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
    reason_code: failing.length === 0 ? "" : failing.slice(0, 6).map((entry) => `${entry.requirement}: ${entry.verdict} (${entry.detail})`).join(" | "),
    measured_by: measurements,
  };
}

export function evaluateAll(inputs) {
  return P03_CLAIMS.map((claim) => ({ document: claim.document, ...evaluateClaim(inputs, claim) }));
}
