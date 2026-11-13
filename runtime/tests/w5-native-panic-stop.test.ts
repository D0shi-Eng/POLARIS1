// W5-P01 — انحدار اشتقاق الحكم والثوابت البنيوية للمسبار الأصلي.
//
// ── ما تحرسه هذه الاختبارات ──────────────────────────────────────────────────
// عيب W5-P01 لم يكن عيبًا واحدًا بل اثنين، وكلاهما كان يمكن أن يُكشف بلا ويندوز:
//
//   1) مسار الإطلاق كان يمرّر الخريطة الأساسية وحدها إلى CreateProcessW، وهي
//      بعينها ضابط W4 السالب المُثبَت: base-only لا تُنشئ العملية، والفشل
//      Win32 203. فلم يوجد ابن قط.
//   2) الحكم كان يُشتق من حلقة استقصاء لا من حالة الإطلاق، فسُمّي العَرَض
//      «CHILD_NEVER_OBSERVED_ALIVE» علّةً، والعلّة مسجّلة في الدليل نفسه.
//
// ولذلك فُصل الاشتقاق عن القياس: صار قاعدة الحكم دالةً نقية تُختبر هنا بحقائق
// مُصنَّعة، بما فيها حالات لا يُنتجها جهاز سويّ. وما لا يُشتق — ترتيب النداءات
// الأصلية وشكل الحصر — يُقرأ من المصدر لا من التعليق.
//
// لا يُدّعى في هذا الملف أي نجاح أصلي: النجاح الأصلي لا يكتبه إلا تشغيل مالك
// على ويندوز.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { deriveNativeVerdict, REASON } from "./w5-native-verdict.js";
import { runtimeSrcPath } from "./helpers.js";

function repositoryRoot(): string {
  return join(runtimeSrcPath(), "..", "..");
}

function w5Adapter(file: string): string {
  return readFileSync(join(repositoryRoot(), "tools", "w5-windows-adapter", file), "utf8");
}

function w4Adapter(file: string): string {
  return readFileSync(join(repositoryRoot(), "tools", "w4-windows-adapter", file), "utf8");
}

/**
 * الشيفرة بلا تعليقات.
 *
 * الثابت الذي تحرسه هذه الاختبارات هو ما تفعله الشيفرة، لا ما تذكره النثر.
 * ملفٌ يشرح في تعليقه أنه لا يستدعي TerminateProcess يجب ألا يُقرأ استدعاءً له —
 * وهذا بالضبط ما وقع أول مرة، فكُشف بالاختبار لا بالمراجعة.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function w5Code(file: string): string {
  return code(w5Adapter(file));
}

function w4Code(file: string): string {
  return code(w4Adapter(file));
}

// ── حقائق مُثبتة بالكامل: نقطة الانطلاق التي يجوز أن تُنتج PASS ───────────────
//
// كل اختبار بعدها يُفسد حقيقة واحدة ويطالب بأن يسقط النجاح. الفساد الواحد
// مقصود: لو أُفسدت اثنتان لما عُرف أيّهما منع النجاح.

type Facts = Record<string, unknown>;

function provenFacts(): Facts {
  return {
    measurement_complete: true,
    blocked: { blocked: false, stage: "", reason_code: "", detail: "" },
    handles: {
      explicit_handle_list: true,
      inherited_handles: 3,
      ambient_handle_count: 0,
      ambient_inheritance: false,
      readiness_handle_is_additional: false,
    },
    launcher_internal_states: {
      create_returned: true,
      suspended_at_create: true,
      assigned_to_job_before_resume: true,
      resume_succeeded: true,
      resumed: true,
    },
    measurement: {
      launch: {
        created: true,
        suspended_at_create: true,
        assigned_to_job: true,
        resumed: true,
        failure_stage: "",
        win32_error: 0,
      },
      readiness: {
        observed: true,
        observed_document_count: 1,
        payload_valid: true,
        payload_pid_matches_measured_pid: true,
        parse_error: "",
      },
      readiness_reason_code: "",
      job: { closed: true, child_membership_before_stop: true },
      stop: {
        requested: true,
        post_stop_wait_result: "WAIT_OBJECT_0",
        child_proven_dead: true,
        child_proven_alive_after_stop: false,
      },
    },
    control_long_lived: {
      long_lived_control: {
        wait_on_process_handle: "WAIT_TIMEOUT",
        still_alive_after_window: true,
        exited_on_its_own: false,
      },
    },
    control_positive_termination: {
      stop: { requested: true, child_proven_dead: true },
    },
    ordering: {
      ready_before_stop: true,
      alive_before_stop: true,
      in_job_before_stop: true,
      child_in_job_when_job_handle_closed: true,
      voluntary_exit_before_stop: false,
      stop_precedes_death: true,
      post_stop_wait_proves_death: true,
      dead_after_stop: true,
      alive_after_stop: false,
      post_stop_state_unproven: false,
    },
    attribution: { attributable: true, termination_attribution: "JOB_CLOSE_KILL_ON_CLOSE" },
    survivors: [],
    cleanup: { cleanup_clean: true },
    timeline: { complete: true, missing_codes: [] },
  };
}

/** يُفسد حقيقة واحدة بمسارها. النسخة عميقة، فلا يتسرّب فسادٌ بين اختبارين. */
function corrupt(path: string, value: unknown): Facts {
  const facts = JSON.parse(JSON.stringify(provenFacts())) as Facts;
  const segments = path.split(".");
  let cursor = facts as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index] as string;
    const next = cursor[key];
    assert.equal(typeof next === "object" && next !== null, true, `the fixture has no object at ${key}`);
    cursor = next as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return facts;
}

test("the fully proven fact set is the only shape that derives PASS", () => {
  const derived = deriveNativeVerdict(provenFacts());
  assert.equal(derived.verdict, "PASS");
  assert.equal(derived.reason_code, "");
  assert.deepEqual(derived.checks.filter((check) => !check.satisfied), []);
});

// ── 1 الإنشاء معلّقًا ────────────────────────────────────────────────────────

test("1. the child must be created suspended, and the launcher creates it that way", () => {
  const launcher = w4Code("ConfinedLauncher.cs");
  assert.equal(launcher.includes("ProcessNativeMethods.CREATE_SUSPENDED"), true);
  const derived = deriveNativeVerdict(corrupt("measurement.launch.suspended_at_create", false));
  assert.notEqual(derived.verdict, "PASS");
});

// ── 2 الضم إلى الـJob قبل الاستئناف ─────────────────────────────────────────

test("2. job assignment appears before ResumeThread in the launcher, and is required for PASS", () => {
  const launcher = w4Code("ConfinedLauncher.cs");
  const assign = launcher.indexOf("AssignProcessToJobObject");
  const resume = launcher.indexOf("ProcessNativeMethods.ResumeThread");
  assert.equal(assign > 0, true, "the launcher does not assign the job at all");
  assert.equal(resume > 0, true, "the launcher does not resume the thread at all");
  assert.equal(assign < resume, true, "the launcher resumes the child before assigning the job");

  const derived = deriveNativeVerdict(corrupt("launcher_internal_states.assigned_to_job_before_resume", false));
  assert.notEqual(derived.verdict, "PASS");
});

// ── 3 الاستعداد لا يُدَّعى من معرّف عملية ───────────────────────────────────

test("3. readiness cannot be claimed from a process id alone", () => {
  const probe = w5Code("ChildStateProbe.cs");
  // محكّ الحياة لا يستعمل اسم العملية ولا وجود معرّفها.
  assert.equal(probe.includes("GetExitCodeProcess"), true);
  assert.equal(probe.includes("WaitForSingleObject"), true);
  assert.equal(probe.includes("ProcessName"), false, "the alive predicate still matches a process name");

  // معرّف موجود، ولا وثيقة استعداد: لا نجاح.
  const facts = corrupt("measurement.readiness.observed", false);
  (((facts["measurement"] as Facts)["readiness"]) as Facts)["observed_document_count"] = 0;
  const derived = deriveNativeVerdict(facts);
  assert.equal(derived.verdict, "BLOCKED");
  assert.equal(derived.reason_code, REASON.childReadinessNotObserved);
});

// ── 4 الوثيقة تُحلَّل بنيويًا ────────────────────────────────────────────────

test("4. the readiness document is parsed structurally, not matched as a string", () => {
  const observer = w5Code("ReadinessObserver.cs");
  assert.equal(observer.includes("JsonReader.Parse"), true, "readiness is not parsed as a JSON document");
  assert.equal(observer.includes("MemberText(\"protocol\")"), true);
  assert.equal(observer.includes("MemberText(\"nonce\")"), true);
  assert.equal(observer.includes(".Contains(\"READY\")"), false, "readiness is decided by substring matching");

  const derived = deriveNativeVerdict(corrupt("measurement.readiness.payload_valid", false));
  assert.equal(derived.verdict, "BLOCKED");
  assert.equal(derived.reason_code, REASON.childReadinessProtocolInvalid);
});

// ── 5 و6 الحياة والعضوية شرطان لقبول الاستعداد ──────────────────────────────

test("5. a child that is not proven alive cannot carry a positive claim", () => {
  const derived = deriveNativeVerdict(corrupt("ordering.alive_before_stop", false));
  assert.equal(derived.verdict, "BLOCKED");
  assert.equal(derived.reason_code, REASON.childNotAliveBeforeStop);
});

test("6. a child not proven to be in the owned job cannot carry a positive claim", () => {
  const derived = deriveNativeVerdict(corrupt("ordering.in_job_before_stop", false));
  assert.equal(derived.verdict, "BLOCKED");
  assert.equal(derived.reason_code, REASON.childNotInJob);
});

test("6b. the readiness document must identify the process the kernel reports in the job", () => {
  const derived = deriveNativeVerdict(corrupt("measurement.readiness.payload_pid_matches_measured_pid", false));
  assert.notEqual(derived.verdict, "PASS");
  assert.equal(derived.reason_code, REASON.childReadinessProtocolInvalid);
});

// ── 7 الخروج الطوعي لا يُنتِج نجاحًا ────────────────────────────────────────

test("7. a child that exited on its own before the stop can never produce PASS", () => {
  const derived = deriveNativeVerdict(corrupt("ordering.voluntary_exit_before_stop", true));
  assert.equal(derived.verdict, "BLOCKED");
  assert.equal(derived.reason_code, REASON.childExitedBeforeStop);
});

// ── 8 نجاة الابن من الإيقاف خرق مُقاس، لا عائق ──────────────────────────────

test("8. alive before the stop and alive after it is FAIL, not BLOCKED", () => {
  const facts = corrupt("ordering.alive_after_stop", true);
  const derived = deriveNativeVerdict(facts);
  assert.equal(derived.verdict, "FAIL");
  assert.equal(derived.reason_code, REASON.childSurvivedPanicStop);
});

// ── 9 غياب قياس ما قبل الإيقاف ليس نجاحًا ولا فشلًا ─────────────────────────

test("9. a missing pre-stop observation is never PASS and never FAIL", () => {
  for (const path of ["ordering.alive_before_stop", "ordering.in_job_before_stop", "measurement.stop.requested"]) {
    const derived = deriveNativeVerdict(corrupt(path, false));
    assert.notEqual(derived.verdict, "PASS", `${path} was allowed to pass`);
    assert.notEqual(derived.verdict, "FAIL", `${path} was read as a proven breach`);
    assert.equal(derived.verdict === "BLOCKED" || derived.verdict === "INCONCLUSIVE", true);
  }
});

test("9b. an unreadable fact set is INCONCLUSIVE, and an absent measurement is BLOCKED", () => {
  assert.equal(deriveNativeVerdict(null).verdict, "INCONCLUSIVE");
  assert.equal(deriveNativeVerdict("not an object").reason_code, REASON.adapterReportUnreadable);
  assert.equal(deriveNativeVerdict({ measurement_complete: false }).verdict, "BLOCKED");
  assert.equal(deriveNativeVerdict({ measurement_complete: false }).reason_code, REASON.measurementIncomplete);
});

// ── 10 حمولة استعداد غير صحيحة ──────────────────────────────────────────────

test("10. an invalid or duplicated readiness payload never produces PASS", () => {
  assert.notEqual(deriveNativeVerdict(corrupt("measurement.readiness.payload_valid", false)).verdict, "PASS");
  assert.notEqual(deriveNativeVerdict(corrupt("measurement.readiness.observed_document_count", 2)).verdict, "PASS");
  assert.equal(
    deriveNativeVerdict(corrupt("measurement.readiness.observed_document_count", 2)).reason_code,
    REASON.childReadinessProtocolInvalid,
  );
});

// ── 11 و12 قائمة المقابض الصريحة، وقناة الاستعداد ليست محيطة ────────────────

test("11. the explicit handle list is preserved and required", () => {
  const template = w5Code("PanicStopLaunchTemplate.cs");
  assert.equal(template.includes("InheritanceMode.ExplicitHandleList"), true);
  assert.equal(template.includes("InheritanceMode.AmbientInheritance"), false);
  assert.equal(template.includes("spec.UseAmbientEnvironment = false;"), true);
  assert.notEqual(deriveNativeVerdict(corrupt("handles.explicit_handle_list", false)).verdict, "PASS");
});

test("12. the readiness channel adds no handle and no ambient inheritance", () => {
  // لا أنبوب جديد ولا كائن نواة مُسمّى في أي مصدر من مصادر W5.
  for (const file of [
    "ReadinessObserver.cs",
    "PanicStopSession.cs",
    "PanicStopMode.cs",
    "PanicStopLaunchTemplate.cs",
    "ChildStateProbe.cs",
    "PanicStopNative.cs",
  ]) {
    const source = w5Code(file);
    for (const forbidden of ["CreatePipe", "CreateEventW", "CreateNamedPipe", "CreateFileMappingW"]) {
      assert.equal(source.includes(forbidden), false, `${file} creates an additional channel via ${forbidden}`);
    }
  }
  // والمراقب اختياري في المُطلِق: مرجع فارغ = السلوك الأصلي، فلا مسار جديد لـW4.
  const pipeReader = w4Code("PipeReader.cs");
  assert.equal(pipeReader.includes("public PipeReader(IntPtr pipe)"), true, "the original constructor is gone");
  assert.equal(pipeReader.includes("_observer = null;"), true, "the observer does not default to absent");
});

// ── 13 القتل بالاسم يبقى ممنوعًا ────────────────────────────────────────────

test("13. the stop closes a job handle and kills nothing by name or by id", () => {
  const session = w5Code("PanicStopSession.cs");
  assert.equal(session.includes("CLOSE_JOB_HANDLE_WITH_KILL_ON_JOB_CLOSE"), true);
  for (const file of ["PanicStopSession.cs", "PanicStopMode.cs"]) {
    const source = w5Code(file);
    assert.equal(source.includes("TerminateProcess"), false, `${file} terminates a process directly`);
    assert.equal(source.includes("TerminateJobObject"), false, `${file} terminates the job instead of closing it`);
    assert.equal(source.includes("Process.GetProcess"), false, `${file} enumerates processes`);
  }
});

// ── 14 التنظيف جزء من الحكم ─────────────────────────────────────────────────

test("14. a run that cannot prove its cleanup never produces PASS", () => {
  const derived = deriveNativeVerdict(corrupt("cleanup.cleanup_clean", false));
  assert.equal(derived.verdict, "FAIL");
  assert.equal(derived.reason_code, REASON.cleanupFailed);
});

// ── 15 عدم وجود ناجين شرط لا ملاحظة ────────────────────────────────────────

test("15. any surviving owned process is a measured breach", () => {
  const derived = deriveNativeVerdict(corrupt("survivors", ["4242"]));
  assert.equal(derived.verdict, "FAIL");
  assert.equal(derived.reason_code, REASON.survivorsRemain);
});

// ── 16 الإسناد شرط، والموت وحده لا يكفي ─────────────────────────────────────

test("16. a dead child whose death is not attributable to the stop is INCONCLUSIVE, not PASS", () => {
  const unattributed = deriveNativeVerdict(corrupt("attribution.attributable", false));
  assert.equal(unattributed.verdict, "INCONCLUSIVE");
  assert.equal(unattributed.reason_code, REASON.terminationNotAttributable);

  const outOfOrder = deriveNativeVerdict(corrupt("ordering.stop_precedes_death", false));
  assert.equal(outOfOrder.verdict, "INCONCLUSIVE");

  const unproven = deriveNativeVerdict(corrupt("ordering.post_stop_wait_proves_death", false));
  assert.equal(unproven.verdict, "INCONCLUSIVE");
  assert.equal(unproven.reason_code, REASON.childStateQueryFailed);
});

// ── 17 الضابط السالب: العيّنة تبقى حيّة بلا إيقاف ───────────────────────────

test("17. the long-lived control is required, and waits on the process handle rather than sleeping", () => {
  const session = w5Code("PanicStopSession.cs");
  assert.equal(session.includes("ProveLongLived"), true);
  assert.equal(session.includes("WaitForSingleObject"), true);
  assert.equal(session.includes("Thread.Sleep"), false, "the control sleeps instead of waiting on a kernel object");
  assert.notEqual(
    deriveNativeVerdict(corrupt("control_long_lived.long_lived_control.still_alive_after_window", false)).verdict,
    "PASS",
  );
});

// ── 18 الضابط الموجب: القتل عند الإغلاق بنفس الآلية ─────────────────────────

test("18. the positive termination control is required and uses the same native mechanism", () => {
  const mode = w5Code("PanicStopMode.cs");
  assert.equal(mode.includes("control_positive_termination"), true);
  // الضابطان والقياس يمرّون من نفس الجلسة ونفس القالب: «نفس الآلية» في الشيفرة.
  assert.equal((mode.match(/new PanicStopSession\(/g) ?? []).length, 3);
  assert.notEqual(
    deriveNativeVerdict(corrupt("control_positive_termination.stop.child_proven_dead", false)).verdict,
    "PASS",
  );
});

// ── 19 الإيقاف مستقل عن النموذج والمزوّد ────────────────────────────────────

test("19. the native stop path names no model, provider or network", () => {
  const forbidden = ["model", "provider", "openai", "anthropic", "HttpClient", "WebRequest", "Socket"];
  for (const file of [
    "PanicStopMode.cs",
    "PanicStopSession.cs",
    "PanicStopLaunchTemplate.cs",
    "PanicStopEnvironment.cs",
    "ChildStateProbe.cs",
    "ReadinessObserver.cs",
    "PanicStopNative.cs",
    "PanicStopTimeline.cs",
  ]) {
    const source = w5Code(file).toLowerCase();
    for (const token of forbidden) {
      assert.equal(source.includes(token.toLowerCase()), false, `${file} mentions ${token} on the stop path`);
    }
  }
});

// ── 20 W4 لم يتغيّر إلا بإضافة اختيارية معدومة الأثر ────────────────────────

test("20. the W4 launcher change is additive, opt-in, and default-absent", () => {
  const launcher = w4Code("ConfinedLauncher.cs");
  // الإضافة الوحيدة: مراقب اختياري يُمرَّر إلى قارئ المخرج القياسي.
  assert.equal(launcher.includes("public IPipeObserver StdoutObserver;"), true);
  assert.equal(launcher.includes("new PipeReader(stdoutRead, spec.StdoutObserver)"), true);
  // وما لم يتغيّر: الحصر نفسه.
  assert.equal(launcher.includes("PROC_THREAD_ATTRIBUTE_HANDLE_LIST"), true);
  assert.equal(launcher.includes("SECURITY_CAPABILITIES"), true);
  assert.equal(launcher.includes("StageAmbientForbidden"), true);
  assert.equal(launcher.includes("WINDOWS_HANDLE_SCOPE_VIOLATION"), true);
  // ولا يعرف W4 شيئًا عن W5: الاعتماد باتجاه واحد.
  for (const file of ["ConfinedLauncher.cs", "PipeReader.cs", "ExecutionEnvironmentPlan.cs", "JobScope.cs"]) {
    assert.equal(w4Code(file).includes("Polaris.W5"), false, `${file} depends on W5`);
  }
});

// ── ثابت إضافي: لم تُزَد مهلة، ولم يُطَل عمر، ولا استقصاء لحالة الابن ───────

test("no timing constant was raised to make the measurement pass", () => {
  const mode = w5Code("PanicStopMode.cs");
  // القيمتان هما قيمتا ما قبل الإصلاح حرفيًا.
  assert.match(mode, /ReadyTimeoutMs = 20000;/);
  assert.match(mode, /DeathTimeoutMs = 10000;/);
  // وحلقة الاستقصاء التي كانت تنتظر ظهور الابن حُذفت ولم تُطَل.
  assert.equal(mode.includes("PollIntervalMs"), false, "a polling interval is back on the measurement path");
  assert.equal(mode.includes("Thread.Sleep"), false, "the measurement sleeps");
  const fixture = readFileSync(join(repositoryRoot(), "runtime", "tests", "w5-hold-main.ts"), "utf8");
  // عمر العيّنة كما كان: نبضة كل ساعة تُبقي حلقة الأحداث حيّة، لا أكثر.
  assert.match(fixture, /3600000/);
  assert.equal(fixture.includes("setTimeout"), false, "the fixture waits for a duration instead of being held");
});

test("the readiness contract is written once by the fixture and signed by the measurement", () => {
  const fixture = readFileSync(join(repositoryRoot(), "runtime", "tests", "w5-hold-main.ts"), "utf8");
  assert.equal(fixture.includes("polaris.w5.readiness"), true);
  assert.equal(fixture.includes("state: \"READY\""), true);
  assert.equal(fixture.includes("nonce"), true);
  // ولا تستورد العيّنة شيئًا: ليست مسار تنفيذ.
  assert.equal(/^\s*import\s/m.test(fixture), false, "the hold fixture imports something");
  assert.equal((fixture.match(/process\.stdout\.write/g) ?? []).length, 1);
});
