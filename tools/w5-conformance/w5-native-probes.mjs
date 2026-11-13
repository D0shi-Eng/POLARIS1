// مسابر W5 الأصلية على ويندوز.
//
// مسبار واحد اليوم: W5-P01، إيقاف طوارئ على ابن محصور حيّ. هو الادعاء الوحيد
// في W5 الذي لا يمكن قياسه إلا على ويندوز، لأن الآلية نفسها آلية ويندوز:
// AppContainer، وJob بـKILL_ON_JOB_CLOSE، وإغلاق مقبض.
//
// القاعدة التي يفرضها هذا الملف: على غير ويندوز لا يُكتب PASS ولا FAIL، بل
// NOT_TESTED مع سببه الحقيقي. «لم يُقَس» ليس نصف نجاح، ولا يُرقّى إلى نجاح
// في أي تقرير لاحق.
//
// ── ما تغيّر في هذه الطبقة ──────────────────────────────────────────────────
// كانت تنقل حكم المحوّل كما هو. والمحوّل كان يشتق حكمه من حلقة استقصاء لا من
// حالة الإطلاق، فكتب «CHILD_NEVER_OBSERVED_ALIVE» بينما كان الدليل الخام يحمل
// العلّة صريحة: CreateProcessW فشلت بـWin32 203.
//
// الفصل الآن صريح: المحوّل يقيس ويسجّل الحقائق الخام ولا يحكم، وهذه الطبقة
// تشتق الحكم من تلك الحقائق بدالة نقية تُختبر على أي مضيف — بما فيها حالات لا
// يُنتجها جهاز سويّ. قاعدة الحكم هي أخطر ما في القياس، فوجب أن تكون أكثره
// قابلية للاختبار.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const root = argument("--root", process.cwd());
const evidenceDirectory = join(root, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });

const canonical = process.env["POLARIS_W5_NATIVE_RUN"] === "1";
const suffix = canonical ? "" : ".adhoc";
const reportPath = join(evidenceDirectory, `w5-panic-stop${suffix}.json`);
const rawPath = join(evidenceDirectory, `w5-panic-stop.adapter${suffix}.json`);

const adapter = join(root, "tools", "w5-windows-adapter", "bin", "polaris-w5-windows-adapter.exe");
const holdScript = join(root, "runtime", "dist", "tests", "w5-hold-main.js");
const distRoot = join(root, "runtime", "dist");
const verdictModule = join(root, "runtime", "dist", "tests", "w5-native-verdict.js");

const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const started = Date.now();

function finish(record) {
  const envelope = {
    tool: "polaris.w5.native-probes",
    canonical,
    probe_id: "W5-P01",
    claim:
      "a child launched through the W4 confinement path, proven to have announced successful startup and to be alive"
      + " inside the owned kill-on-close Job, is dead after that Job's last handle is closed, with the death"
      + " attributable to the stop, zero owned survivors and a clean teardown",
    platform: process.platform,
    native: process.platform === "win32",
    measurement_started: startedAt,
    measurement_completed: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration_ms: Date.now() - started,
    verdict_derivation: "polaris.w5.native-verdict",
    verdict_derivation_note:
      "the verdict is derived from the adapter's raw measured facts by a pure function; the adapter itself"
      + " publishes no verdict, so the decision rule is testable on any host",
    ...record,
  };
  if (!canonical) {
    envelope.non_canonical_note =
      "this run did not carry the W5 runner's marker, so it is not canonical evidence and must not be read as a W5 result";
  }
  writeFileSync(reportPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  console.log(`${envelope.verdict} W5-P01 ${envelope.reason_code} — ${envelope.interpretation}`);
  process.exit(envelope.verdict === "PASS" ? 0 : 1);
}

/** منظر مشتق على الحقائق الخام، بالشكل الذي يطلبه عقد الدليل. لا يقرّر شيئًا. */
function view(raw) {
  const pick = (path) => {
    let current = raw;
    for (const segment of path.split(".")) {
      if (typeof current !== "object" || current === null) return null;
      current = current[segment];
    }
    return current === undefined ? null : current;
  };
  return {
    process: {
      pid: pick("measurement.launch.process_id"),
      created: pick("measurement.launch.created"),
      creation_flags: pick("measurement.launch.inputs.creation_flags"),
      suspended_at_create: pick("measurement.launch.suspended_at_create"),
      assigned_to_job: pick("measurement.launch.assigned_to_job"),
      resumed: pick("measurement.launch.resumed"),
      ready: pick("measurement.readiness.observed"),
      alive_before_stop: pick("ordering.alive_before_stop"),
      in_job_before_stop: pick("ordering.in_job_before_stop"),
      alive_after_stop: pick("ordering.alive_after_stop"),
      exit_code_after_stop: pick("measurement.stop.post_stop_exit_code"),
      wait_after_stop: pick("measurement.stop.post_stop_wait_result"),
      launch_failure_stage: pick("measurement.launch.failure_stage"),
      launch_win32_error: pick("measurement.launch.win32_error"),
      stdout: pick("measurement.launch.stdout"),
      stderr: pick("measurement.launch.stderr"),
      child_exit_code: pick("measurement.launch.exit_code"),
    },
    job: {
      created: pick("measurement.job.created"),
      kill_on_close: pick("measurement.job.kill_on_close"),
      breakaway_allowed: pick("measurement.job.breakaway_allowed"),
      child_membership_before_stop: pick("measurement.job.child_membership_before_stop"),
      child_in_job_when_handle_closed: pick("ordering.child_in_job_when_job_handle_closed"),
      processes_before_close: pick("measurement.job.processes_before_close"),
      processes_after_close_queryable: pick("measurement.job.processes_after_close_queryable"),
      processes_after_close_reason: pick("measurement.job.processes_after_close_reason"),
    },
    appcontainer: {
      active: pick("appcontainer.active"),
      capability_count: pick("appcontainer.capability_count"),
      internet_client_requested: pick("appcontainer.internet_client_requested"),
      private_network_requested: pick("appcontainer.private_network_requested"),
    },
    handles: pick("handles"),
    readiness: pick("measurement.readiness"),
    environment_calibration: {
      reason_code: pick("environment_calibration.reason_code"),
      causal_factor: pick("environment_calibration.causal_factor"),
      base_only_created: pick("environment_calibration.base_only_created"),
      base_only_win32_error: pick("environment_calibration.base_only_win32_error"),
      production_environment_names: pick("environment_calibration.production_environment_names"),
      causality_proven: pick("environment_calibration.causality_proven"),
    },
    panic_stop: {
      requested: pick("measurement.stop.requested"),
      requested_at: pick("measurement.stop.requested_at"),
      mechanism: pick("measurement.stop.mechanism"),
      job_close_at: pick("measurement.job.closed_at"),
      death_latency_us: pick("measurement.stop.death_latency_us"),
      termination_attribution: pick("attribution.termination_attribution"),
      attributable: pick("attribution.attributable"),
      survivors: pick("survivors"),
    },
    controls: {
      long_lived: pick("control_long_lived.long_lived_control"),
      positive_termination: pick("control_positive_termination.stop"),
    },
    cleanup: pick("cleanup"),
    timeline: {
      complete: pick("timeline.complete"),
      missing_codes: pick("timeline.missing_codes"),
      state_only_codes: pick("timeline.state_only_codes"),
      events: pick("timeline.events"),
    },
  };
}

if (process.platform !== "win32") {
  finish({
    evidence_complete: false,
    verdict: "NOT_TESTED",
    reason_code: "PLATFORM_NOT_WINDOWS",
    stage: null,
    evidence_reference: null,
    interpretation:
      `this host is ${process.platform}. AppContainer, Job Objects and kill-on-close are Windows mechanisms;`
      + " no Windows claim may be read from a run on another platform.",
  });
}

if (!existsSync(adapter)) {
  finish({
    evidence_complete: false,
    verdict: "BLOCKED",
    reason_code: "W5_ADAPTER_BINARY_ABSENT",
    stage: "ADAPTER",
    evidence_reference: null,
    interpretation: `the W5 adapter binary is not present at ${adapter}; nothing was measured.`,
  });
}
if (!existsSync(holdScript)) {
  finish({
    evidence_complete: false,
    verdict: "BLOCKED",
    reason_code: "HOLD_FIXTURE_ABSENT",
    stage: "HOLD_FIXTURE",
    evidence_reference: null,
    interpretation: `the long-lived child fixture is not built at ${holdScript}; run the runtime build first.`,
  });
}
if (!existsSync(verdictModule)) {
  finish({
    evidence_complete: false,
    verdict: "BLOCKED",
    reason_code: "W5_VERDICT_MODULE_ABSENT",
    stage: "ADAPTER",
    evidence_reference: null,
    interpretation:
      `the verdict derivation is not built at ${verdictModule}; without it nothing may judge the raw facts.`,
  });
}

const { deriveNativeVerdict } = await import(pathToFileURL(verdictModule).href);

const run = spawnSync(
  adapter,
  [
    "--mode", "panic-stop",
    "--report", rawPath,
    "--repository-root", root,
    "--node", process.execPath,
    "--hold-script", holdScript,
    "--dist-root", distRoot,
  ],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);

if (run.error !== undefined && run.error !== null) {
  finish({
    evidence_complete: false,
    verdict: "BLOCKED",
    reason_code: "ADAPTER_DID_NOT_START",
    stage: "ADAPTER",
    evidence_reference: null,
    adapter_exit_code: null,
    interpretation: `the W5 adapter could not be started: ${run.error.message}`,
  });
}

let raw = null;
try {
  raw = JSON.parse(existsSync(rawPath) ? readFileSync(rawPath, "utf8") : (run.stdout ?? ""));
} catch (error) {
  finish({
    evidence_complete: false,
    verdict: "INCONCLUSIVE",
    reason_code: "ADAPTER_REPORT_UNREADABLE",
    stage: "ADAPTER",
    evidence_reference: existsSync(rawPath) ? rawPath : null,
    adapter_exit_code: run.status,
    adapter_stderr: (run.stderr ?? "").slice(0, 1024),
    interpretation: `the adapter ran but its report could not be read: ${String(error)}`,
  });
}

const derived = deriveNativeVerdict(raw);
finish({
  evidence_complete: derived.verdict === "PASS" || derived.verdict === "FAIL",
  verdict: derived.verdict,
  reason_code: derived.reason_code,
  stage: derived.stage,
  evidence_reference: rawPath,
  adapter_exit_code: run.status,
  adapter_stderr: (run.stderr ?? "").slice(0, 1024),
  required_conditions: derived.checks,
  unproven_conditions: derived.checks.filter((check) => !check.satisfied).map((check) => check.name),
  ...view(raw),
  interpretation: derived.interpretation,
});
