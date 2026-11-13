// اشتقاق حكم Phase-00 — منطقًا خالصًا، بلا قرص ولا وسائط ولا خروج.
//
// كان هذا المنطق داخل البوابة نفسها، مختلطًا بالقراءة والكتابة، فلم يكن يُختبر
// إلا بتشغيل كامل على ويندوز. العيب الذي وُلد من ذلك هو سبب هذا الملف:
//
//   PH00-W2 كان يبحث عن الخطوة "contracts: verify" داخل evidence/w6-run.json،
//   و PH00-W3 كان يقرأ الحقل runtime_test_exit_code من evidence/w6-run.json.
//   وليس أيٌّ منهما في تلك الوثيقة أصلًا. W6 لا يقيس العقود ولا مجموعة طبقة
//   التشغيل: يُفوّضهما إلى مشغّل W5 المجمَّد، وهو من يكتبهما في
//   evidence/w5-run.json. فقرأ المستهلك وثيقةً غير التي فيها القياس.
//
//   وأخطر نصفَي العيب هو W3: `undefined === 0` تساوي false، فحقلٌ غائب صار
//   نتيجةً فاشلة. وهذا هو المقلوب الدقيق لترقية NOT_TESTED إلى PASS: كلاهما
//   يستبدل بالقياس شيئًا ليس قياسًا.
//
// ثلاث قواعد تحكم الحساب، ولا تُخفَّف هنا:
//   ١) BLOCKED و INCONCLUSIVE و NOT_TESTED لا تُرقّى إلى PASS أبدًا.
//   ٢) شرطٌ دليلُه غير مكتمل ليس شرطًا مُستوفى، مهما بدا رقمه أخضر.
//   ٣) شرطٌ لم يُقَس في هذا التشغيل يقول ذلك صراحةً، فلا يُقرأ قياسًا جديدًا.
//
// ورابعة أضافها هذا العيب:
//   ٤) قياسٌ غائب يُسمّى غائبًا (NOT_TESTED)، ولا يُسمّى فاشلًا. الفشل ادعاء
//      عن قياسٍ وقع، وغيابُ الحقل ليس قياسًا وقع.

export const PASS = "PASS";
export const FAIL = "FAIL";
export const BLOCKED = "BLOCKED";
export const INCONCLUSIVE = "INCONCLUSIVE";
export const NOT_TESTED = "NOT_TESTED";
export const CONDITIONAL_PASS = "CONDITIONAL_PASS";

/** اسم الخطوة التي يملكها مشغّل W5 المجمَّد، حرفيًّا كما يكتبها. */
export const CONTRACTS_STEP = "contracts: verify";

/** اسم خطوة المجموعة الكاملة، بعد المسابر، في مشغّل W5 المجمَّد. */
export const RUNTIME_STEP = "runtime: final test";

/** الحقل الذي يحمل رمز خروج المجموعة النهائية في سجل W5. */
export const RUNTIME_EXIT_FIELD = "runtime_test_exit_code";

/**
 * أدوات W3 داخل مجموعة طبقة التشغيل.
 *
 * W3 هو خدمة الإعداد و PDP المحلي (docs: PHASE-00-W3-STATUS). قياسه يقع داخل
 * هذه الملفات بعينها. المجموعة الكاملة شاهدٌ عليه لأنها تحتويه، لا لأنها
 * تسمّيه — ولذلك يُثبَت هنا أن الأدوات كانت في التشغيل فعلًا، حتى لا يكون
 * «المجموعة نظيفة» حكمًا على تشغيل لم يحمل أدوات W3 أصلًا.
 */
export const W3_INSTRUMENTS = Object.freeze([
  "config.test.js",
  "config-properties.test.js",
  "policy.test.js",
]);

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function epoch(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function stepNamed(document, name) {
  const steps = Array.isArray(document?.steps) ? document.steps : [];
  return steps.find((candidate) => candidate?.name === name);
}

/** أول ختم زمني تسجّله الوثيقة، إن سجّلت. الفراغ يعني «لم تسجّله الأداة». */
function startedAt(document) {
  return text(document?.measurement_started) || text(document?.bootstrap?.bootstrap_started) || text(document?.ran_at);
}

function completedAt(document) {
  return text(document?.measurement_completed) || text(document?.ran_at);
}

/**
 * ربط دليلٍ كتبه مشغّلٌ آخر بهذا التشغيل.
 *
 * الخطر الحقيقي وليس النظري: خطوة العقود في مشغّل W5 خطوة صلبة — تفشل فترمي
 * فيتوقف المشغّل قبل أن يكتب evidence/w5-run.json. فيبقى على القرص سجلّ
 * التشغيل السابق الناجح. قارئٌ لا يربط الدليل بالتشغيل يقرأ نجاحًا قديمًا
 * ويكتبه حكمًا جديدًا.
 *
 * الربط بنافذة التشغيل: الوثيقة يجب أن تكون قد كُتبت بين بدء إقلاع W6 وكتابة
 * سجلّ تشغيله. وهذا يُقاس من حقول موجودة أصلًا، فلا يحتاج قياسًا جديدًا.
 */
export function bindToRun(w6Run, document, documentName) {
  if (w6Run === null || w6Run === undefined) {
    return { bound: false, reason_code: "W6_RUN_EVIDENCE_MISSING", detail: "the W6 run record is missing, so nothing can be tied to this run" };
  }
  if (document === null || document === undefined) {
    return { bound: false, reason_code: "EVIDENCE_MISSING_OR_UNREADABLE", detail: `${documentName} is missing or unreadable` };
  }
  const start = epoch(w6Run.bootstrap?.bootstrap_started);
  const end = epoch(w6Run.ran_at);
  const written = epoch(document.ran_at);
  if (start === null || end === null || written === null) {
    return {
      bound: false,
      reason_code: "EVIDENCE_NOT_BINDABLE_TO_RUN",
      detail: `${documentName} carries no timestamp that ties it to this run`,
    };
  }
  if (written < start || written > end) {
    return {
      bound: false,
      reason_code: "EVIDENCE_STALE_FOR_THIS_RUN",
      detail: `${documentName} was written at ${document.ran_at}, outside this run's window ${w6Run.bootstrap.bootstrap_started}..${w6Run.ran_at}`,
    };
  }
  return { bound: true, reason_code: "", detail: "" };
}

/** هل شغّل W6 مشغّل W5 المجمَّد في هذا التشغيل أصلًا؟ */
export function w5WasDelegated(w6Run) {
  const regression = w6Run?.w5_regression ?? null;
  if (regression === null) return { delegated: false, reason_code: "W5_DELEGATION_NOT_IN_RUN_RECORD" };
  if (regression.skipped === true) return { delegated: false, reason_code: "W5_REGRESSION_SKIPPED" };
  return { delegated: true, reason_code: "" };
}

/**
 * موضع القياس المُفوَّض.
 *
 * يقرأ الخريطة التي يكتبها مشغّل W6 (delegated_measurements) إن وُجدت، ويعود
 * إلى الموضع المُعلن هنا إن غابت. الخريطة تسمّي أين يعيش القياس ولا تنسخه:
 * نسخة ثانية من الرقم نفسه هي بالضبط الطريق إلى انحراف مصدرَي حقيقة.
 */
export function delegatedSource(w6Run, key, fallbackEvidence, fallbackLocator) {
  const entry = w6Run?.delegated_measurements?.[key] ?? null;
  return {
    evidence: text(entry?.source_evidence).replace(/\\/g, "/") || fallbackEvidence,
    locator: text(entry?.source_locator) || fallbackLocator,
    declared: entry !== null,
  };
}

function claim(fields) {
  return {
    claim_id: fields.claim_id,
    description: fields.description,
    source_week: fields.source_week,
    source_kind: fields.source_kind,
    evidence_reference: fields.evidence_reference ?? "",
    measurement_locator: fields.measurement_locator ?? "",
    measured_in_this_run: fields.measured_in_this_run === true,
    measurement_started: fields.measurement_started ?? "",
    measurement_completed: fields.measurement_completed ?? "",
    evidence_complete: fields.evidence_complete === true,
    verdict: fields.verdict,
    reason_code: fields.reason_code ?? "",
    detail: fields.detail ?? "",
  };
}

// ── PH00-W2 — العقود الستة ──────────────────────────────────────────────────

export function deriveContracts(evidence) {
  const { w6Run, w5Run } = evidence;
  const source = delegatedSource(w6Run, "contracts_verify", "evidence/w5-run.json", `steps[name='${CONTRACTS_STEP}'].exit_code`);
  const base = {
    claim_id: "PH00-W2",
    description: "the six core contracts verify",
    source_week: "W2",
    source_kind: "DELEGATED_FROZEN_RUNNER",
    evidence_reference: source.evidence,
    measurement_locator: source.locator,
    measured_in_this_run: true,
    measurement_started: startedAt(w5Run),
    measurement_completed: completedAt(w5Run),
  };

  const delegation = w5WasDelegated(w6Run);
  if (!delegation.delegated) {
    return claim({
      ...base,
      measured_in_this_run: false,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: delegation.reason_code,
      detail: "W6 delegates the contracts step to the frozen W5 runner; this run did not invoke it",
    });
  }

  const binding = bindToRun(w6Run, w5Run, "evidence/w5-run.json");
  if (!binding.bound) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: binding.reason_code, detail: binding.detail });
  }

  const step = stepNamed(w5Run, CONTRACTS_STEP);
  if (step === undefined) {
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "CONTRACTS_STEP_NOT_IN_RUN_RECORD",
      detail: `no step named '${CONTRACTS_STEP}' in the bound W5 run record`,
    });
  }
  if (!isNumber(step.exit_code)) {
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "CONTRACTS_EXIT_CODE_UNREADABLE",
      detail: `the step exists but carries no readable exit code (${JSON.stringify(step.exit_code)})`,
    });
  }
  const clean = step.exit_code === 0;
  return claim({
    ...base,
    evidence_complete: true,
    verdict: clean ? PASS : FAIL,
    reason_code: clean ? "" : "CONTRACTS_VERIFY_FAILED",
    detail: `exit ${String(step.exit_code)}, ${String(step.duration_ms ?? "?")} ms, measured by the frozen W5 runner in this run`,
  });
}

// ── PH00-W3 — خدمة الإعداد و PDP المحلي ─────────────────────────────────────

/**
 * شاهد W3 مركّب من مقياسين مستقلّين وقعا في هذا التشغيل، ويجب أن يتفقا:
 *
 *   ١) رمز خروج المجموعة النهائية في سجل W5 (الخطوة العاشرة، بعد المسابر).
 *   ٢) عدّاد TAP للمجموعة كاملة في جرد التخطّي الذي يملكه W6.
 *
 * ولماذا المجموعة الكاملة شاهدٌ على W3: قياس W3 يقع داخل ملفاتها
 * (config, config-properties, policy)، وفشل أيٍّ منها يُفشل المجموعة. فيُثبَت
 * هنا أن تلك الأدوات كانت في قائمة التنفيذ فعلًا، لا أن الرقم كان أخضر.
 * الاتفاق شرط: رمز خروج صفري مع فشلٍ محسوب ليس نجاحًا، وليس فشلًا مفهومًا —
 * هو قياسٌ لا يُقرأ.
 */
export function deriveRuntimeSuite(evidence) {
  const { w6Run, w5Run, w6Skips } = evidence;
  const source = delegatedSource(w6Run, "runtime_suite", "evidence/w5-run.json", RUNTIME_EXIT_FIELD);
  const base = {
    claim_id: "PH00-W3",
    description: "config service and local PDP behave as specified",
    source_week: "W3",
    source_kind: "DELEGATED_FROZEN_RUNNER",
    evidence_reference: source.evidence,
    measurement_locator: source.locator,
    measured_in_this_run: true,
    measurement_started: startedAt(w5Run),
    measurement_completed: completedAt(w5Run),
  };

  const delegation = w5WasDelegated(w6Run);
  if (!delegation.delegated) {
    return claim({
      ...base,
      measured_in_this_run: false,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: delegation.reason_code,
      detail: "W6 delegates the runtime suite to the frozen W5 runner; this run did not invoke it",
    });
  }

  const binding = bindToRun(w6Run, w5Run, "evidence/w5-run.json");
  if (!binding.bound) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: binding.reason_code, detail: binding.detail });
  }

  const exitCode = w5Run[RUNTIME_EXIT_FIELD];
  if (!isNumber(exitCode)) {
    // العيب الأصلي بعينه: الحقل غائب. غيابٌ يُسمّى غيابًا.
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "RUNTIME_SUITE_EXIT_CODE_NOT_IN_RUN_RECORD",
      detail: `the bound W5 run record carries no readable '${RUNTIME_EXIT_FIELD}'`,
    });
  }

  // الرقم الحاسم هو رمز خروج المجموعة النهائية، ولا يجوز أن يناقض خطوته. رمزٌ
  // وسيط من استدعاء أسبق يُخالف الخطوة الأخيرة يعني أن السجل يناقض نفسه، ولا
  // يُقرأ نجاحًا ولا فشلًا.
  const finalStep = stepNamed(w5Run, RUNTIME_STEP);
  if (finalStep !== undefined && isNumber(finalStep.exit_code) && finalStep.exit_code !== exitCode) {
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "RUNTIME_SUITE_EXIT_CODE_DISAGREES_WITH_STEP",
      detail: `'${RUNTIME_EXIT_FIELD}' is ${String(exitCode)} but the final step '${RUNTIME_STEP}' exited ${String(finalStep.exit_code)}; the run record contradicts itself`,
    });
  }

  const summary = w6Skips?.suite_summary ?? null;
  if (summary === null || !isNumber(summary.tests) || !isNumber(summary.failed)) {
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "RUNTIME_SUITE_COUNTS_UNREADABLE",
      detail: "the skip inventory did not record a readable suite summary, so the exit code stands alone and is not a measurement",
    });
  }
  if (summary.tests === 0) {
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "RUNTIME_SUITE_MEASURED_NOTHING",
      detail: "the suite reported zero tests: an empty run is not a clean run",
    });
  }

  const counts =
    `${String(summary.tests)} tests, ${String(summary.passed ?? "?")} pass, ` +
    `${String(summary.failed)} fail, ${String(summary.skipped ?? "?")} skipped, exit ${String(exitCode)}`;

  if (summary.failed > 0) {
    const named = Array.isArray(w6Skips.failing_tests) && w6Skips.failing_tests.length > 0
      ? `: ${w6Skips.failing_tests.slice(0, 5).join("; ")}`
      : "";
    return claim({ ...base, evidence_complete: true, verdict: FAIL, reason_code: "RUNTIME_SUITE_FAILED", detail: `${counts}${named}` });
  }
  if (exitCode !== 0) {
    return claim({
      ...base,
      evidence_complete: true,
      verdict: FAIL,
      reason_code: "RUNTIME_SUITE_FAILED",
      detail: `${counts} — the suite counted no failure but its runner exited non-zero; a disagreement never resolves upward`,
    });
  }

  // الأدوات: تُثبَت من قائمة التنفيذ إن سجّلها الجرد. سجلٌّ لا يحملها لا يُرقّى
  // ولا يُسقَط — يقول إنها غير مُثبتة في هذا السجل.
  const executed = Array.isArray(w6Skips.test_files) ? w6Skips.test_files.map((entry) => String(entry).replace(/\\/g, "/")) : null;
  if (executed === null) {
    return claim({
      ...base,
      evidence_complete: true,
      verdict: PASS,
      reason_code: "",
      detail: `${counts}; W3 instruments not named by this run record (it predates the instrument list)`,
    });
  }
  const missing = W3_INSTRUMENTS.filter((instrument) => !executed.some((file) => file.endsWith(`/${instrument}`) || file === instrument));
  if (missing.length > 0) {
    return claim({
      ...base,
      evidence_complete: false,
      verdict: NOT_TESTED,
      reason_code: "W3_INSTRUMENT_NOT_EXECUTED",
      detail: `${counts}; these W3 instruments were not in the executed set: ${missing.join(", ")}`,
    });
  }
  return claim({
    ...base,
    evidence_complete: true,
    verdict: PASS,
    reason_code: "",
    detail: `${counts}; W3 instruments executed: ${W3_INSTRUMENTS.join(", ")}`,
  });
}

// ── بقية الشروط ─────────────────────────────────────────────────────────────

function deriveW1(evidence) {
  const { w1 } = evidence;
  const base = {
    claim_id: "PH00-W1",
    description: "the W1 confinement spike result remains valid for the current architecture",
    source_week: "W1",
    source_kind: "CARRIED_FROZEN",
    evidence_reference: "evidence/w1-results.json",
    measurement_locator: "results",
    measured_in_this_run: false,
    measurement_started: text(w1?.generated_utc),
    measurement_completed: text(w1?.generated_utc),
  };
  if (w1 === null || w1 === undefined) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: "EVIDENCE_MISSING_OR_UNREADABLE", detail: "" });
  }
  return claim({
    ...base,
    evidence_complete: true,
    verdict: PASS,
    reason_code: "",
    detail:
      "W1 is PASS_PARTIAL and frozen. It is CARRIED, not re-measured here: its mechanism claims are re-observed natively by W-11 and W-12 in this run.",
  });
}

function deriveW4(evidence) {
  const { w6Run, w4Conformance } = evidence;
  const base = {
    claim_id: "PH00-W4",
    description: "W-01..W-12 native confinement regression is clean",
    source_week: "W4",
    source_kind: "DELEGATED_FROZEN_RUNNER",
    evidence_reference: "evidence/w4-windows-conformance.json",
    measurement_locator: "summary",
    measured_in_this_run: true,
    measurement_started: startedAt(w4Conformance),
    measurement_completed: completedAt(w4Conformance),
  };
  const binding = bindToRun(w6Run, w4Conformance, "evidence/w4-windows-conformance.json");
  if (!binding.bound) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: binding.reason_code, detail: binding.detail });
  }
  const summary = w4Conformance.summary ?? {};
  if (!isNumber(summary.total)) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: "W4_SUMMARY_UNREADABLE", detail: "" });
  }
  const clean =
    summary.total > 0 &&
    summary.passed === summary.total &&
    summary.failed === 0 &&
    summary.blocked === 0 &&
    summary.inconclusive === 0 &&
    summary.not_tested === 0 &&
    summary.skipped === 0;
  return claim({
    ...base,
    evidence_complete: true,
    verdict: clean ? PASS : FAIL,
    reason_code: clean ? "" : "W4_REGRESSION_NOT_CLEAN",
    detail: `${String(summary.passed)}/${String(summary.total)} probes`,
  });
}

function deriveW5(evidence) {
  const { w6Run, w5Run } = evidence;
  const base = {
    claim_id: "PH00-W5",
    description: "the W5 canonical run is PASS with no blockers",
    source_week: "W5",
    source_kind: "DELEGATED_FROZEN_RUNNER",
    evidence_reference: "evidence/w5-run.json",
    measurement_locator: "verdict",
    measured_in_this_run: true,
    measurement_started: startedAt(w5Run),
    measurement_completed: completedAt(w5Run),
  };
  const delegation = w5WasDelegated(w6Run);
  if (!delegation.delegated) {
    return claim({ ...base, measured_in_this_run: false, evidence_complete: false, verdict: NOT_TESTED, reason_code: delegation.reason_code, detail: "" });
  }
  const binding = bindToRun(w6Run, w5Run, "evidence/w5-run.json");
  if (!binding.bound) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: binding.reason_code, detail: binding.detail });
  }
  const verdict = text(w5Run.verdict);
  if (verdict === "") {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: "W5_VERDICT_UNREADABLE", detail: "" });
  }
  const clean = verdict === PASS;
  return claim({
    ...base,
    evidence_complete: true,
    verdict: clean ? PASS : FAIL,
    reason_code: clean ? "" : (Array.isArray(w5Run.reason_codes) ? w5Run.reason_codes.join(",") : "") || "W5_VERDICT_NOT_PASS",
    detail: `groups ${String(w5Run.w5_test_groups?.passed ?? "?")} pass, probe ${String(w5Run.w5_native_probe?.verdict ?? "?")}`,
  });
}

/** شرط W6 يقرأ وثيقةً كتبها W6 نفسه في هذا التشغيل. */
function deriveW6(id, description, document, reference, locator, evaluate) {
  const base = {
    claim_id: id,
    description,
    source_week: "W6",
    source_kind: "MEASURED_BY_W6",
    evidence_reference: reference,
    measurement_locator: locator,
    measured_in_this_run: true,
    measurement_started: startedAt(document),
    measurement_completed: completedAt(document),
  };
  if (document === null || document === undefined) {
    return claim({ ...base, evidence_complete: false, verdict: NOT_TESTED, reason_code: "EVIDENCE_MISSING_OR_UNREADABLE", detail: "" });
  }
  return claim({ ...base, ...evaluate(document) });
}

// ── الحكم ───────────────────────────────────────────────────────────────────

export function derivePhase00(evidence) {
  const conditions = [
    deriveW1(evidence),
    deriveContracts(evidence),
    deriveRuntimeSuite(evidence),
    deriveW4(evidence),
    deriveW5(evidence),
    deriveW6("PH00-W6-GROUPS", "the W6 test groups are clean", evidence.w6Groups, "evidence/w6-test-groups.json", "summary", (document) => {
      const summary = document.summary ?? {};
      const readable = isNumber(summary.failed) && isNumber(summary.passed);
      if (!readable) return { evidence_complete: false, verdict: NOT_TESTED, reason_code: "W6_TEST_GROUP_SUMMARY_UNREADABLE", detail: "" };
      const clean =
        summary.failed === 0 &&
        summary.blocked === 0 &&
        summary.inconclusive === 0 &&
        summary.not_tested === 0 &&
        summary.groups_with_incomplete_evidence === 0;
      return {
        evidence_complete: summary.groups_with_incomplete_evidence === 0,
        verdict: clean ? PASS : FAIL,
        reason_code: clean ? "" : "W6_TEST_GROUP_NOT_CLEAN",
        detail: `${String(summary.passed)} groups pass, ${String(summary.total_tests)} tests`,
      };
    }),
    deriveW6("PH00-W6-DOGFOOD", "every dogfood scenario D01..D12 is PASS", evidence.w6Dogfood, "evidence/w6-dogfood.json", "summary", (document) => {
      const summary = document.summary ?? {};
      if (!isNumber(summary.failed) || !isNumber(summary.total)) {
        return { evidence_complete: false, verdict: NOT_TESTED, reason_code: "W6_SCENARIO_SUMMARY_UNREADABLE", detail: "" };
      }
      const clean = summary.failed === 0 && summary.blocked === 0 && summary.inconclusive === 0 && summary.not_tested === 0;
      return {
        evidence_complete: summary.scenarios_with_incomplete_evidence === 0,
        verdict: clean ? PASS : summary.failed > 0 ? FAIL : NOT_TESTED,
        reason_code: clean ? "" : "W6_SCENARIO_NOT_CLEAN",
        detail: `${String(summary.passed)}/${String(summary.total)} scenarios`,
      };
    }),
    deriveW6(
      "PH00-W6-SKIPS",
      "every skipped test is classified and none is security-critical",
      evidence.w6Skips,
      "evidence/w6-skip-classification.json",
      "verdict",
      (document) => ({
        evidence_complete: document.evidence_complete === true,
        verdict: text(document.verdict) || NOT_TESTED,
        reason_code: text(document.reason_code),
        detail: `${String(document.skipped_total)} skips: ${JSON.stringify(document.by_class ?? {})}`,
      }),
    ),
    deriveW6(
      "PH00-W6-BYTES",
      "every canonical evidence document satisfies the byte contract",
      evidence.w6Bytes,
      "evidence/w6-evidence-bytes.json",
      "verdict",
      (document) => ({
        evidence_complete: document.evidence_complete === true,
        verdict: text(document.verdict) || NOT_TESTED,
        reason_code: text(document.reason_code),
        detail: `${String(document.checked)} checked, ${String((document.defects ?? []).length)} defective`,
      }),
    ),
    deriveW6(
      "PH00-W6-REPEAT",
      "a second run from a clean workspace reaches the same verdict",
      evidence.w6Repeat,
      "evidence/w6-repeatability.json",
      "verdict",
      (document) => ({
        evidence_complete: document.evidence_complete === true,
        verdict: text(document.verdict) || NOT_TESTED,
        reason_code: text(document.reason_code),
        detail: text(document.detail),
      }),
    ),
    deriveW6(
      "PH00-W6-CLEANUP",
      "cleanup is proven: no survivor, no leftover profile, no leftover workspace",
      evidence.w6Cleanup,
      "evidence/w6-cleanup.json",
      "clean",
      (document) => {
        if (typeof document.clean !== "boolean") {
          return { evidence_complete: false, verdict: NOT_TESTED, reason_code: "CLEANUP_EVIDENCE_UNREADABLE", detail: "" };
        }
        return {
          evidence_complete: true,
          verdict: document.clean ? PASS : FAIL,
          reason_code: document.clean ? "" : "CLEANUP_NOT_CLEAN",
          detail:
            `survivors ${String((document.surviving_execution_hosts ?? []).length)}, ` +
            `profiles ${String((document.leftover_appcontainer_profiles ?? []).length)}, ` +
            `workspaces ${String((document.leftover_workspaces ?? []).length)}`,
        };
      },
    ),
    deriveW6("PH00-W6-RUN", "the W6 run record itself carries no blocker", evidence.w6Run, "evidence/w6-run.json", "verdict", (document) => {
      const verdict = text(document.verdict);
      if (verdict === "") return { evidence_complete: false, verdict: NOT_TESTED, reason_code: "W6_RUN_VERDICT_UNREADABLE", detail: "" };
      const clean = verdict === PASS;
      return {
        evidence_complete: true,
        verdict: clean ? PASS : FAIL,
        reason_code: clean ? "" : (Array.isArray(document.reason_codes) ? document.reason_codes.join(",") : "") || "W6_RUN_NOT_CLEAN",
        detail: `platform ${String(document.platform)}, native ${String(document.native)}`,
      };
    }),
  ];

  const failed = conditions.filter((entry) => entry.verdict === FAIL);
  const blocked = conditions.filter((entry) => entry.verdict === BLOCKED);
  const unmeasured = conditions.filter((entry) => entry.verdict === NOT_TESTED || entry.verdict === INCONCLUSIVE);
  const incomplete = conditions.filter((entry) => entry.evidence_complete !== true);

  let verdict;
  let reason;
  if (failed.length > 0) {
    verdict = FAIL;
    reason = failed.map((entry) => entry.claim_id).join(",");
  } else if (blocked.length > 0) {
    verdict = BLOCKED;
    reason = blocked.map((entry) => entry.claim_id).join(",");
  } else if (unmeasured.length > 0 || incomplete.length > 0) {
    verdict = CONDITIONAL_PASS;
    // شرطٌ غير مقاس ودليلُه ناقص شرطٌ واحد لا شرطان: يُذكر مرة.
    reason = [...new Set([...unmeasured, ...incomplete].map((entry) => entry.claim_id))].join(",");
  } else {
    verdict = PASS;
    reason = "";
  }

  return {
    conditions,
    summary: {
      total: conditions.length,
      passed: conditions.filter((entry) => entry.verdict === PASS).length,
      failed: failed.length,
      blocked: blocked.length,
      unmeasured: unmeasured.length,
      incomplete_evidence: incomplete.length,
    },
    verdict,
    reason_code: reason,
    // البوابة الوحيدة: PASS كامل أو لا مرور. لا فرع ثانٍ يبلغ ALLOWED.
    phase_01_gate: verdict === PASS ? "ALLOWED" : "NOT_ALLOWED",
  };
}
