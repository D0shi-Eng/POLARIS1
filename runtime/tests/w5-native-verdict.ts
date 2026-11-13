// اشتقاق حكم W5-P01 من الحقائق الخام.
//
// ── لماذا الاشتقاق هنا لا في المحوّل ─────────────────────────────────────────
// المحوّل يقيس على ويندوز، فحكمُه لا يُختبر إلا على ويندوز — وقاعدة الحكم هي
// بالضبط ما يجب أن يُختبر أكثر من أي شيء آخر: أي شرط يمنع PASS، وأي حالة تُسمّى
// FAIL دون BLOCKED، وأي ترتيب يُسند الموت إلى الإيقاف. فُصل الاشتقاق عن القياس
// حتى تصير قاعدة الحكم دالةً نقية تُختبر على أي مضيف بحقائق مُصنَّعة، بما فيها
// الحالات التي لا يجوز أن يُنتجها جهاز حقيقي إلا بعطب.
//
// ── التصنيف ─────────────────────────────────────────────────────────────────
//   BLOCKED       شرطٌ مسبق منع القياس. لا شيء أُثبت ولا شيء نُفي.
//   INCONCLUSIVE  القياس جرى ولم يُثبت الإسناد أو الاكتمال.
//   FAIL          القياس أثبت أن المطلب الأمني خُرق.
//   PASS          كل شرط مطلوب أُثبت إيجابًا.
//
// ولا يُرقّى شيء: غياب حقيقة ليس صفرًا، وعدمُ القياس ليس نصف نجاح.

export type NativeVerdict = "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE" | "NOT_TESTED";

/** أسباب مصنَّفة. سببٌ عام واحد لكل الإخفاقات يخفي العلّة، وهذا ما نمنعه. */
export const REASON = {
  adapterReportUnreadable: "ADAPTER_REPORT_UNREADABLE",
  measurementIncomplete: "MEASUREMENT_INCOMPLETE",
  childCreateFailed: "CHILD_CREATE_FAILED",
  childJobAssignFailed: "CHILD_JOB_ASSIGN_FAILED",
  childResumeFailed: "CHILD_RESUME_FAILED",
  childExitedBeforeReady: "CHILD_EXITED_BEFORE_READY",
  childExitedBeforeStop: "CHILD_EXITED_BEFORE_STOP",
  childReadinessNotObserved: "CHILD_READINESS_NOT_OBSERVED",
  childReadinessProtocolInvalid: "CHILD_READINESS_PROTOCOL_INVALID",
  childNotInJob: "CHILD_NOT_IN_JOB",
  childStateQueryFailed: "CHILD_STATE_QUERY_FAILED",
  childNotAliveBeforeStop: "CHILD_NOT_ALIVE_BEFORE_STOP",
  stopNotTriggered: "STOP_NOT_TRIGGERED",
  childSurvivedPanicStop: "CHILD_SURVIVED_PANIC_STOP",
  terminationNotAttributable: "PANIC_STOP_TERMINATION_NOT_ATTRIBUTABLE",
  survivorsRemain: "SURVIVORS_REMAIN",
  cleanupFailed: "CLEANUP_FAILED",
} as const;

export interface DerivedCheck {
  readonly name: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface Derivation {
  readonly verdict: NativeVerdict;
  readonly reason_code: string;
  readonly stage: string;
  readonly interpretation: string;
  readonly checks: readonly DerivedCheck[];
}

// ── قراءة دفاعية: حقيقة غائبة تبقى غائبة ولا تصير قيمة ──────────────────────

function at(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** صحيحٌ فقط إن كانت القيمة true فعلًا. غياب ليس false مسكوتًا عنه بل ليس صحيحًا. */
function isTrue(source: unknown, path: string): boolean {
  return at(source, path) === true;
}

function text(source: unknown, path: string): string {
  const value = at(source, path);
  return typeof value === "string" ? value : "";
}

function list(source: unknown, path: string): readonly unknown[] {
  const value = at(source, path);
  return Array.isArray(value) ? value : [];
}

function present(source: unknown, path: string): boolean {
  const value = at(source, path);
  return typeof value === "object" && value !== null;
}

interface Rule {
  readonly when: (raw: unknown) => boolean;
  readonly verdict: NativeVerdict;
  readonly reason: (raw: unknown) => string;
  readonly stage: (raw: unknown) => string;
  readonly interpretation: (raw: unknown) => string;
}

const STAGE_READINESS = "PROVE_READY_BEFORE_STOP";
const STAGE_ALIVE_BEFORE = "PROVE_ALIVE_BEFORE_STOP";
const STAGE_STOP = "PANIC_STOP";
const STAGE_DEAD_AFTER = "PROVE_DEAD_AFTER_STOP";
const STAGE_CLEANUP = "CLEANUP";
const STAGE_MEASUREMENT = "MEASUREMENT";

/**
 * القواعد بترتيب الأولوية. الأولى المطابقة تحكم.
 *
 * الترتيب نفسه ادعاء: شرطٌ مسبق مفقود يُصنَّف BLOCKED قبل أن يُسأل عن خرق، حتى
 * لا يُقرأ غيابُ قياسٍ خرقًا ولا يُقرأ خرقٌ عائقًا.
 */
const RULES: readonly Rule[] = [
  {
    when: (raw) => typeof raw !== "object" || raw === null,
    verdict: "INCONCLUSIVE",
    reason: () => REASON.adapterReportUnreadable,
    stage: () => STAGE_MEASUREMENT,
    interpretation: () => "the adapter facts are not an object; nothing can be derived from them.",
  },
  {
    when: (raw) => isTrue(raw, "blocked.blocked"),
    verdict: "BLOCKED",
    reason: (raw) => text(raw, "blocked.reason_code") || REASON.measurementIncomplete,
    stage: (raw) => text(raw, "blocked.stage") || STAGE_MEASUREMENT,
    interpretation: (raw) =>
      `a prerequisite prevented the measurement: ${text(raw, "blocked.detail")} — nothing is proven and nothing is denied.`,
  },
  {
    when: (raw) => !isTrue(raw, "measurement_complete") || !present(raw, "measurement"),
    verdict: "BLOCKED",
    reason: () => REASON.measurementIncomplete,
    stage: () => STAGE_MEASUREMENT,
    interpretation: () =>
      "the adapter did not record a complete measurement, so the panic-stop claim was never put to the test.",
  },
  {
    when: (raw) => !isTrue(raw, "measurement.launch.created"),
    verdict: "BLOCKED",
    reason: () => REASON.childCreateFailed,
    stage: () => "LAUNCH",
    interpretation: (raw) =>
      `CreateProcessW did not create the confined child (stage ${text(raw, "measurement.launch.failure_stage")},`
      + ` Win32 ${String(at(raw, "measurement.launch.win32_error"))}); no child existed to stop.`,
  },
  {
    when: (raw) => !isTrue(raw, "measurement.launch.assigned_to_job"),
    verdict: "BLOCKED",
    reason: () => REASON.childJobAssignFailed,
    stage: () => "LAUNCH",
    interpretation: () =>
      "the child was created but never assigned to the owned job, so closing the job could not govern it.",
  },
  {
    when: (raw) => !isTrue(raw, "measurement.launch.resumed"),
    verdict: "BLOCKED",
    reason: () => REASON.childResumeFailed,
    stage: () => "LAUNCH",
    interpretation: () => "the child was created and confined but never resumed, so it never ran.",
  },
  {
    when: (raw) =>
      !isTrue(raw, "measurement.readiness.observed") && at(raw, "measurement.readiness.observed_document_count") === 0,
    verdict: "BLOCKED",
    reason: (raw) =>
      text(raw, "measurement.readiness_reason_code") || REASON.childReadinessNotObserved,
    stage: () => STAGE_READINESS,
    interpretation: () =>
      "no readiness document was observed, so successful startup was never established before the stop.",
  },
  {
    when: (raw) => !isTrue(raw, "measurement.readiness.payload_valid"),
    verdict: "BLOCKED",
    reason: () => REASON.childReadinessProtocolInvalid,
    stage: () => STAGE_READINESS,
    interpretation: (raw) =>
      `a document arrived on the readiness channel but did not satisfy the contract: ${text(raw, "measurement.readiness.parse_error")}`,
  },
  {
    when: (raw) => !isTrue(raw, "measurement.readiness.payload_pid_matches_measured_pid"),
    verdict: "BLOCKED",
    reason: () => REASON.childReadinessProtocolInvalid,
    stage: () => STAGE_READINESS,
    interpretation: () =>
      "the readiness document did not identify the process the kernel reports inside the owned job.",
  },
  {
    when: (raw) => at(raw, "measurement.readiness.observed_document_count") !== 1,
    verdict: "BLOCKED",
    reason: () => REASON.childReadinessProtocolInvalid,
    stage: () => STAGE_READINESS,
    interpretation: () => "the readiness contract is exactly one document; a different count breaks the contract.",
  },
  {
    when: (raw) => isTrue(raw, "ordering.voluntary_exit_before_stop"),
    verdict: "BLOCKED",
    reason: () => REASON.childExitedBeforeStop,
    stage: () => STAGE_ALIVE_BEFORE,
    interpretation: () =>
      "the child exited on its own before the stop, so its death cannot be attributed to the stop.",
  },
  {
    when: (raw) => !isTrue(raw, "ordering.alive_before_stop"),
    verdict: "BLOCKED",
    reason: () => REASON.childNotAliveBeforeStop,
    stage: () => STAGE_ALIVE_BEFORE,
    interpretation: () =>
      "the child was not proven alive immediately before the stop, so the stop measures nothing.",
  },
  {
    when: (raw) => !isTrue(raw, "ordering.in_job_before_stop"),
    verdict: "BLOCKED",
    reason: () => REASON.childNotInJob,
    stage: () => STAGE_ALIVE_BEFORE,
    interpretation: () =>
      "the kernel did not confirm the live child as a member of the owned job before the stop.",
  },
  {
    when: (raw) => !isTrue(raw, "ordering.child_in_job_when_job_handle_closed"),
    verdict: "BLOCKED",
    reason: () => REASON.childNotInJob,
    stage: () => STAGE_STOP,
    interpretation: () =>
      "the job did not provably contain the child at the moment its last handle was closed.",
  },
  {
    when: (raw) => !isTrue(raw, "measurement.stop.requested"),
    verdict: "BLOCKED",
    reason: () => REASON.stopNotTriggered,
    stage: () => STAGE_STOP,
    interpretation: () => "the stop was never triggered, so there is nothing to attribute a death to.",
  },
  {
    when: (raw) => isTrue(raw, "ordering.alive_after_stop"),
    verdict: "FAIL",
    reason: () => REASON.childSurvivedPanicStop,
    stage: () => STAGE_DEAD_AFTER,
    interpretation: () =>
      "a child proven alive before the stop was still alive after the owned job handle was closed;"
      + " kill-on-close did not take effect on a running child.",
  },
  {
    when: (raw) => list(raw, "survivors").length > 0,
    verdict: "FAIL",
    reason: () => REASON.survivorsRemain,
    stage: () => STAGE_DEAD_AFTER,
    interpretation: () => "owned processes survived the run.",
  },
  {
    when: (raw) => !isTrue(raw, "ordering.dead_after_stop") || !isTrue(raw, "ordering.post_stop_wait_proves_death"),
    verdict: "INCONCLUSIVE",
    reason: () => REASON.childStateQueryFailed,
    stage: () => STAGE_DEAD_AFTER,
    interpretation: () =>
      "the child's state after the stop could not be proven on the pinned handle, so neither survival nor"
      + " termination is established.",
  },
  {
    when: (raw) => !isTrue(raw, "ordering.stop_precedes_death") || !isTrue(raw, "attribution.attributable"),
    verdict: "INCONCLUSIVE",
    reason: () => REASON.terminationNotAttributable,
    stage: () => STAGE_DEAD_AFTER,
    interpretation: () =>
      "the child is dead, but the measured order does not attribute that death to the stop.",
  },
  {
    when: (raw) => !isTrue(raw, "cleanup.cleanup_clean"),
    verdict: "FAIL",
    reason: () => REASON.cleanupFailed,
    stage: () => STAGE_CLEANUP,
    interpretation: () => "the child died from the stop, but the run did not clean up after itself.",
  },
  {
    when: (raw) => !isTrue(raw, "timeline.complete"),
    verdict: "INCONCLUSIVE",
    reason: () => REASON.measurementIncomplete,
    stage: () => STAGE_MEASUREMENT,
    interpretation: (raw) =>
      `the timeline is missing timestamped events (${list(raw, "timeline.missing_codes").join(",")}),`
      + " so the measurement is not complete enough to carry a positive claim.",
  },
];

/** الشروط التي يجب أن تكون كلها مُثبتة قبل PASS. تُسجَّل في الدليل مفردةً. */
function checksOf(raw: unknown): readonly DerivedCheck[] {
  const required: ReadonlyArray<readonly [string, string]> = [
    ["child_created", "measurement.launch.created"],
    ["child_suspended_at_create", "measurement.launch.suspended_at_create"],
    ["child_assigned_to_job_before_resume", "launcher_internal_states.assigned_to_job_before_resume"],
    ["child_resumed", "measurement.launch.resumed"],
    ["explicit_handle_list", "handles.explicit_handle_list"],
    ["readiness_observed", "measurement.readiness.observed"],
    ["readiness_payload_valid", "measurement.readiness.payload_valid"],
    ["readiness_pid_matches", "measurement.readiness.payload_pid_matches_measured_pid"],
    ["alive_before_stop", "ordering.alive_before_stop"],
    ["in_job_before_stop", "ordering.in_job_before_stop"],
    ["child_in_job_at_close", "ordering.child_in_job_when_job_handle_closed"],
    ["stop_requested", "measurement.stop.requested"],
    ["job_closed", "measurement.job.closed"],
    ["stop_precedes_death", "ordering.stop_precedes_death"],
    ["dead_after_stop", "ordering.dead_after_stop"],
    ["termination_attributable", "attribution.attributable"],
    ["long_lived_control_held", "control_long_lived.long_lived_control.still_alive_after_window"],
    ["positive_termination_control", "control_positive_termination.stop.child_proven_dead"],
    ["cleanup_clean", "cleanup.cleanup_clean"],
    ["timeline_complete", "timeline.complete"],
  ];
  return required.map(([name, path]) => ({
    name,
    satisfied: isTrue(raw, path),
    detail: path,
  }));
}

/**
 * يشتق الحكم من الحقائق الخام وحدها.
 *
 * ولا يُنتَج PASS إلا بعد المرور من كل قاعدة بلا مطابقة، وبعد أن يكون كل شرط في
 * checksOf مُثبتًا. الشرطان معًا: الأول يمنع الحالات المسمّاة، والثاني يمنع أن
 * يُنتِج غيابُ قاعدةٍ نجاحًا بالسكوت.
 */
export function deriveNativeVerdict(raw: unknown): Derivation {
  const checks = checksOf(raw);
  for (const rule of RULES) {
    if (rule.when(raw)) {
      return {
        verdict: rule.verdict,
        reason_code: rule.reason(raw),
        stage: rule.stage(raw),
        interpretation: rule.interpretation(raw),
        checks,
      };
    }
  }
  const unproven = checks.filter((check) => !check.satisfied).map((check) => check.name);
  if (unproven.length > 0) {
    return {
      verdict: "INCONCLUSIVE",
      reason_code: REASON.measurementIncomplete,
      stage: STAGE_MEASUREMENT,
      interpretation: `no named failure matched, but these required conditions are not positively proven: ${unproven.join(",")}`,
      checks,
    };
  }
  return {
    verdict: "PASS",
    reason_code: "",
    stage: STAGE_STOP,
    interpretation:
      "a child launched through the W4 confinement path — zero-capability AppContainer, explicit handle list,"
      + " job assignment before ResumeThread, kill-on-close, breakaway unset — announced successful startup on the"
      + " listed standard-output handle, was proven alive and a member of the owned job immediately before the stop,"
      + " and was proven dead on a handle pinned before the stop after that job's last handle was closed."
      + " A control proved the same fixture stays alive when it is not stopped. No owned process survived,"
      + " no process was killed by name, and every ACL grant, profile and temporary tree was removed.",
    checks,
  };
}
