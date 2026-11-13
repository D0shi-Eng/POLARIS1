// تقييم شروط Phase-02 من القياسات الخام.
//
// دالة نقية فوق مدخلات مقروءة: مجموعات الاختبار، والفحص الساكن، والإطلاقين
// الأصليين، وسجل التجهيزة. لا شبكة ولا قرص هنا، فتُختبر كما هي.

import { findSecretLeaks } from "./p02-security.mjs";
import { P02_CLAIMS, SECURITY_GROUPS } from "./p02-claims.mjs";
import { worst } from "./p02-common.mjs";

export const E2E_IDS = Array.from({ length: 22 }, (_, index) => `E2E-${String(index + 1).padStart(2, "0")}`);

function groupOf(inputs, id) {
  return (inputs.groups ?? []).find((group) => group.group_id === id);
}

/** حكم اختبار مسمّى، أو كل الاختبارات تحت بادئة تنتهي بـ«::». */
export function testVerdict(inputs, groupId, name) {
  const group = groupOf(inputs, groupId);
  if (group === undefined) return { verdict: "NOT_TESTED", detail: `${groupId} did not run` };
  if (group.verdict === "BLOCKED") return { verdict: "BLOCKED", detail: `${groupId} could not start` };
  const tests = Array.isArray(group.tests) ? group.tests : [];
  const matched = name.endsWith("::")
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

/** حكم سيناريو E2E. E2E-20 من مرحلة الإعادة، وE2E-22 من خروج الإطلاقين. */
export function e2eVerdict(inputs, id) {
  const native = inputs.native;
  if (native === null || native === undefined || native.performed !== true) {
    return { verdict: "NOT_TESTED", detail: native?.reason ?? "the native stage did not run" };
  }
  if (id === "E2E-22") {
    const first = launchClean(native.first);
    const restart = launchClean(native.restart);
    return { verdict: worst([first.verdict, restart.verdict]), detail: `first: ${first.detail}; restart: ${restart.detail}` };
  }
  const report = id === "E2E-20" ? native.restart?.e2e_report : native.first?.e2e_report;
  if (report === null || report === undefined) return { verdict: "FAIL", detail: `${id === "E2E-20" ? "restart" : "first"} launch produced no E2E report` };
  if (typeof report.fatal === "string") return { verdict: "FAIL", detail: `suite aborted: ${report.fatal}` };
  const found = scenarios(report).find((scenario) => scenario.id === id);
  if (found === undefined) return { verdict: "NOT_TESTED", detail: `${id} absent from the report` };
  return { verdict: found.status === "PASS" ? "PASS" : found.status === "FAIL" ? "FAIL" : "NOT_TESTED", detail: found.detail };
}

function fixtureRequests(inputs) {
  const log = inputs.native?.fixture_log;
  return log !== null && log !== undefined && Array.isArray(log.requests) ? log.requests : null;
}

export function checkVerdict(inputs, id) {
  if (id.startsWith("P02-SEC-") || id.startsWith("P01-FACT:")) {
    const pool = [...(inputs.securityStatic?.checks ?? []), ...(inputs.securityEvidence?.checks ?? [])];
    const found = pool.find((entry) => entry.check_id === id);
    return found === undefined ? { verdict: "NOT_TESTED", detail: `${id} was not run` } : { verdict: found.verdict, detail: found.detail };
  }
  const native = inputs.native;
  const performed = native !== null && native !== undefined && native.performed === true;
  if (!performed) return { verdict: "NOT_TESTED", detail: "the native stage did not run" };
  if (id === "FIXTURE-SLOW-REQUEST-ABORTED") {
    const requests = fixtureRequests(inputs);
    if (requests === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
    const slow = requests.filter((entry) => entry.model === "fixture-slow");
    const aborted = slow.filter((entry) => entry.aborted === true && entry.completed !== true);
    return aborted.length > 0
      ? { verdict: "PASS", detail: `${aborted.length} slow request(s) were cut at the fixture before completion` }
      : { verdict: "FAIL", detail: `${slow.length} slow request(s) seen, none aborted before completion` };
  }
  if (id === "FIXTURE-NO-REMOTE-CHAT") {
    const requests = fixtureRequests(inputs);
    if (requests === null) return { verdict: "NOT_TESTED", detail: "no fixture log" };
    const listed = requests.filter((entry) => entry.port === "remote" && entry.path === "/api/v1/models");
    const chats = requests.filter((entry) => entry.port === "remote" && String(entry.path).endsWith("/chat/completions"));
    if (listed.length === 0) return { verdict: "NOT_TESTED", detail: "the remote fixture was never reached, so its silence proves nothing" };
    return chats.length === 0
      ? { verdict: "PASS", detail: `remote fixture listed ${listed.length} time(s) and received no invocation` }
      : { verdict: "FAIL", detail: `${chats.length} invocation(s) reached the remote fixture` };
  }
  if (id === "E2E-REPORT-NO-SECRET") {
    const text = JSON.stringify([native.first?.e2e_report ?? null, native.restart?.e2e_report ?? null]);
    const hits = findSecretLeaks(text);
    if (native.first?.e2e_report === undefined || native.first?.e2e_report === null) return { verdict: "NOT_TESTED", detail: "no E2E report" };
    return hits.length === 0 ? { verdict: "PASS", detail: "no key shape and no official key value in what the renderer received" } : { verdict: "FAIL", detail: hits.join(",") };
  }
  if (id === "E2E-NO-MISSING-KEY") {
    const reports = [native.first?.e2e_report, native.restart?.e2e_report].filter((report) => report !== null && report !== undefined);
    if (reports.length === 0) return { verdict: "NOT_TESTED", detail: "no E2E report" };
    const missing = reports.flatMap((report) => (Array.isArray(report.missing_keys) ? report.missing_keys : ["unreadable"]));
    return missing.length === 0 ? { verdict: "PASS", detail: "no translation key was missing in the real window" } : { verdict: "FAIL", detail: missing.slice(0, 20).join(", ") };
  }
  if (id === "RESTART-LAUNCH-CLEAN") return launchClean(native.restart);
  return { verdict: "NOT_TESTED", detail: `unknown check ${id}` };
}

export function gateRegressionVerdict(inputs, phase) {
  const document = phase === "PHASE-00" ? inputs.phase00Gate : inputs.phase01Gate;
  const started = inputs.native?.run_started ?? inputs.runStarted ?? null;
  if (document === null || document === undefined) return { verdict: "NOT_TESTED", detail: `${phase} final gate document absent` };
  if (document.__unreadable !== undefined) return { verdict: "INCONCLUSIVE", detail: `${phase} gate unreadable` };
  if (started === null) return { verdict: "NOT_TESTED", detail: "the run start is unknown, so a fresh re-run cannot be told from an old document" };
  // Phase-00 يكتب `decided_at`، وPhase-01 يكتب `measured_at`.
  const at = typeof document.measured_at === "string" ? document.measured_at : document.decided_at;
  const fresh = typeof at === "string" && at >= started;
  if (!fresh) return { verdict: "NOT_TESTED", detail: `${phase} gate was not re-run in this run (decided ${String(at)}, run started ${started})` };
  // Phase-00 لا يكتب حقل `canonical`؛ قانونيته في اسمه (بلا .adhoc) وفي كونه native على win32.
  const canonical = phase === "PHASE-00" ? document.native === true && document.platform === "win32" : document.canonical === true;
  if (!canonical) return { verdict: "INCONCLUSIVE", detail: `${phase} gate re-run is not canonical` };
  const passed = document.verdict === "PASS" && (phase !== "PHASE-01" || document.phase_02_gate === "ALLOWED");
  return { verdict: passed ? "PASS" : document.verdict === "PASS" ? "FAIL" : VERDICT(document.verdict), detail: `${phase} = ${document.verdict}${phase === "PHASE-01" ? `, Phase-02 gate ${document.phase_02_gate}` : ""}, decided ${String(at)}` };
}

function VERDICT(value) {
  return ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE", "NOT_TESTED"].includes(value) ? value : "INCONCLUSIVE";
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
  const checks = inputs.securityStatic?.checks ?? [];
  if (checks.length === 0) problems.push("the static security scan did not run");
  if ((inputs.securityEvidence?.checks ?? []).length === 0) problems.push("the evidence secret scan did not run");
  return problems.length === 0 ? { verdict: "PASS", detail: `${SECURITY_GROUPS.length} security-bearing groups ran with no skip; static and evidence scans ran` } : { verdict: problems.some((p) => p.includes("did not run")) ? "NOT_TESTED" : "FAIL", detail: problems.join("; ") };
}

export function requirementVerdict(inputs, requirement) {
  switch (requirement.type) {
    case "test":
      return { ...testVerdict(inputs, requirement.group, requirement.name), requirement: `${requirement.group} :: ${requirement.name}` };
    case "e2e":
      return { ...e2eVerdict(inputs, requirement.id), requirement: requirement.id };
    case "check":
      return { ...checkVerdict(inputs, requirement.id), requirement: requirement.id };
    case "gate":
      return { ...gateRegressionVerdict(inputs, requirement.phase), requirement: `${requirement.phase} final gate` };
    case "no-skip":
      return { ...noSkipVerdict(inputs), requirement: "no mandatory security skip" };
    case "bytes": {
      const bytes = inputs.bytes;
      if (bytes === null || bytes === undefined) return { verdict: "NOT_TESTED", detail: "byte gate not run", requirement: "byte gate" };
      return { verdict: bytes.verdict === "PASS" ? "PASS" : "FAIL", detail: `${bytes.summary?.clean ?? 0}/${bytes.summary?.checked ?? 0} clean`, requirement: "byte gate" };
    }
    default:
      return { verdict: "INCONCLUSIVE", detail: `unknown requirement ${requirement.type}`, requirement: requirement.type };
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
  return P02_CLAIMS.map((claim) => ({ document: claim.document, ...evaluateClaim(inputs, claim) }));
}

export { E2E_IDS as E2E_SCENARIOS };
