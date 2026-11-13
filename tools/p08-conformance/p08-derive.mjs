// اشتقاق أدلّة Phase-08 القانونية من السجلات الخام: كل شرط يقرأ قياسًا بعينه ويحكم عليه، والقياس
// الغائب NOT_TESTED لا PASS، والبيئة الناقصة (لا نموذج محلي) BLOCKED بسببها، ولا ترقية أبدًا.
//
// المصادر الخام (evidence/p08-native): run.local.json (المشغّل)، groups.local.json (المجموعات)،
// harness/*.local.json (عُدّة القياس الأصلية)، ui.local.json (واجهة E2E)، secrets.local.json،
// repository.local.json. والانحدار من evidence/phase-07-final-gate.json الذي أعاد المشغّل قياسه.
//
// الاستعمال: node p08-derive.mjs --root <root>

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, header, P08_EVIDENCE, P08_TOOLS, raw, readJson, verdictOf, worst, writeEvidence } from "./p08-common.mjs";

/** كل ما يحتاجه الاشتقاق، مقروءًا مرة واحدة. */
export function loadInputs(root) {
  const h = (name) => raw(root, join("harness", `${name}.local.json`));
  return {
    run: raw(root, "run.local.json"),
    groups: raw(root, "groups.local.json"),
    harness: { summary: h("summary"), model: h("model"), sandbox: h("sandbox"), browser: h("browser"), artifacts: h("artifacts"), missions: h("missions"), lifecycle: h("lifecycle"), restart: h("restart") },
    ui: raw(root, "ui.local.json"),
    secrets: raw(root, "secrets.local.json"),
    repository: raw(root, "repository.local.json"),
    phase07: readJson(join(root, "evidence", "phase-07-final-gate.json")),
  };
}

// ——— قرّاء صغار.

function group(inputs, id) {
  return (inputs.groups?.groups ?? []).find((g) => g.group_id === id) ?? null;
}

function groupVerdict(inputs, id) {
  const g = group(inputs, id);
  return g === null ? "NOT_TESTED" : g.verdict === "PASS" ? "PASS" : g.verdict === "BLOCKED" ? "BLOCKED" : "FAIL";
}

function check(inputs, section, id) {
  return (inputs.harness[section]?.checks ?? []).find((c) => c.id === id) ?? null;
}

function checkVerdict(inputs, section, id) {
  const c = check(inputs, section, id);
  if (c === null) return "NOT_TESTED";
  return c.status === "PASS" ? "PASS" : c.status === "BLOCKED" ? "BLOCKED" : c.status === "NOT_TESTED" ? "NOT_TESTED" : c.status === "PARTIAL" ? "PARTIAL" : "FAIL";
}

function scenarios(inputs, stage) {
  const launch = inputs.ui?.[stage];
  const report = launch?.e2e_report;
  const inner = report?.renderer ?? report;
  return Array.isArray(inner?.scenarios) ? inner.scenarios : null;
}

function scenarioVerdict(inputs, stage, id, allowNotTested = false) {
  const list = scenarios(inputs, stage);
  if (list === null) return "NOT_TESTED";
  const s = list.find((x) => x.id === id);
  if (s === undefined) return "NOT_TESTED";
  if (s.status === "PASS") return "PASS";
  if (s.status === "NOT_TESTED") return allowNotTested && /BLOCKED_ENVIRONMENT/.test(s.detail ?? "") ? "BLOCKED" : "NOT_TESTED";
  return "FAIL";
}

function modelAvailable(inputs) {
  return checkVerdict(inputs, "model", "P08-MDL-INVOKE") === "PASS";
}

function benchRows(inputs) {
  return inputs.harness.missions?.extra?.tasks ?? [];
}

const claim = (id, condition, verdict, detail = "") => ({ claim_id: id, condition, verdict, detail });

/**
 * الشروط التي تعتمد على نموذج حقيقي، وحدها. قرار المالك (2026-09-30): اختبارات النموذج الحقيقي تُنقل إلى
 * مرحلة لاحقة. حين يسجّل المشغّل ذلك (run.model_deferred)، تصير هذه الشروط DEFERRED — لا PASS أبدًا —
 * وتُعرض منفصلة في البوابة. القائمة مغلقة: لا يؤجَّل شرط خارجها مهما كان حكمه.
 */
export const MODEL_DEFERRED_CLAIMS = Object.freeze([
  "P08-MODEL-01", "P08-MODEL-02", "P08-MODEL-03",
  "P08-BENCH-01", "P08-BENCH-02", "P08-MISSION-A", "P08-MISSION-B", "P08-MISSION-C", "P08-MISSION-D", "P08-MISSION-E",
  "P08-SEC-03", "P08-SCH-02",
  "P08-E2E-03", "P08-E2E-05", "P08-E2E-06", "P08-E2E-07",
]);

/** يطبّق التأجيل على القائمة المغلقة فقط، ويُبقي ما عداها كما قيس. */
export function applyModelDeferral(claims, inputs) {
  if (inputs.run?.model_deferred !== true) return claims;
  const reason = inputs.run?.model_deferred_reason ?? "real-model tests deferred to a later phase";
  return claims.map((c) => (MODEL_DEFERRED_CLAIMS.includes(c.claim_id) ? { ...c, verdict: "DEFERRED", detail: `DEFERRED: ${reason}${c.detail ? ` (measured here: ${c.verdict}; ${c.detail})` : ""}` } : c));
}

/** حكم الوثيقة من شروطها غير المؤجَّلة؛ وثيقة كل شروطها مؤجَّلة حكمها DEFERRED. */
export function documentVerdict(claims) {
  const live = claims.filter((c) => c.verdict !== "DEFERRED");
  if (claims.length > 0 && live.length === 0) return "DEFERRED";
  return worst(live.map((c) => c.verdict));
}

/** شروط كل وثيقة. كل شرط يسمّي قياسه. */
export function claimsFor(document, inputs) {
  const onWindows = inputs.run?.environment?.is_windows === true;
  const model = modelAvailable(inputs);
  const needsModel = (v) => (model ? v : v === "PASS" ? "PASS" : "BLOCKED");
  switch (document) {
    case "phase-08-run": {
      const stages = inputs.run?.stages ?? [];
      const hard = stages.filter((s) => s.exit_code !== 0 && !/soft/i.test(s.kind ?? ""));
      return [
        claim("P08-RUN-01", "the run is canonical and native (runner marker, Windows)", verdictOf(inputs.run !== null, inputs.run?.canonical === true && onWindows), `canonical ${inputs.run?.canonical}; windows ${onWindows}`),
        claim("P08-RUN-02", "contracts, runtime, renderer and every host binary built", verdictOf(stages.length > 0, ["2", "3", "4", "5"].every((n) => stages.some((s) => s.name.startsWith(`${n} `) && s.exit_code === 0))), stages.map((s) => `${s.name.split(":")[0]}=${s.exit_code}`).join(", ")),
        claim("P08-RUN-03", "the native harness ran to its end", verdictOf(inputs.run?.harness !== undefined, inputs.run?.harness?.exit_code === 0 || (inputs.run?.harness?.summary !== null && inputs.run?.harness?.timed_out === false)), `exit ${inputs.run?.harness?.exit_code}; timed out ${inputs.run?.harness?.timed_out}`),
        claim("P08-RUN-04", "no hard stage failed", verdictOf(stages.length > 0, hard.length === 0), hard.map((s) => s.name).join("; ")),
      ];
    }
    case "phase-08-real-model": {
      const rows = benchRows(inputs);
      const passed = rows.filter((r) => r.status === "PASS");
      return [
        claim("P08-MODEL-01", "a local model server answered and a chat model was discovered", checkVerdict(inputs, "model", "P08-MDL-DISCOVERED")),
        claim("P08-MODEL-02", "a real local inference answered correctly", checkVerdict(inputs, "model", "P08-MDL-INVOKE") === "PASS" ? "PASS" : check(inputs, "model", "P08-MDL-SELECTED")?.status === "BLOCKED" ? "BLOCKED" : checkVerdict(inputs, "model", "P08-MDL-INVOKE"), check(inputs, "model", "P08-MDL-INVOKE")?.detail ?? "absent"),
        claim("P08-MODEL-03", "at least one mission completed with the real local model and passed its strict checks", model ? verdictOf(rows.length > 0, passed.length >= 1) : "BLOCKED", `${passed.length} of ${rows.length} tasks passed with ${inputs.harness.missions?.extra?.model_id ?? "no model"}`),
      ];
    }
    case "phase-08-execution": {
      const ids = ["P08-SBX-ISOLATION", "P08-SBX-PS-ECHO", "P08-SBX-PS-WRITE-INSIDE", "P08-SBX-PS-READ-OUTSIDE-DENIED", "P08-SBX-PS-WRITE-OUTSIDE-DENIED", "P08-SBX-PS-PROFILE-DENIED", "P08-SBX-INSTALL-NEEDS-APPROVAL", "P08-SBX-PY-PREPARE", "P08-SBX-PY-RUN", "P08-SBX-ENV-SECRETS-ABSENT", "P08-SBX-NET-DENIED-GATEWAY", "P08-SBX-NET-DENIED-KERNEL", "P08-SBX-PY-WRITE-OUTSIDE-DENIED", "P08-SBX-CHILDREN-KILLED", "P08-SBX-MEMORY-LIMIT", "P08-SBX-PROCESS-LIMIT", "P08-SBX-TIMEOUT", "P08-SBX-CANCEL", "P08-SBX-NETWORK-NEEDS-APPROVAL", "P08-SBX-ZERO-SURVIVORS"];
      return [
        ...ids.map((id) => claim(id, `native sandbox check ${id}`, checkVerdict(inputs, "sandbox", id), check(inputs, "sandbox", id)?.detail ?? "absent")),
        claim("P08-EXEC-GROUPS", "execution, sandbox-path and Python test groups", worst(["P08-EXECUTION", "P08-SANDBOX", "P08-PYTHON"].map((g) => groupVerdict(inputs, g)))),
      ];
    }
    case "phase-08-browser": {
      const ids = ["P08-BRW-ENGINE", "P08-BRW-JS", "P08-BRW-UNTRUSTED-LABEL", "P08-BRW-TYPE-CLICK", "P08-BRW-SELECT", "P08-BRW-PASSWORD-REFUSED", "P08-BRW-PRIVATE-DENIED", "P08-BRW-POLICY-EVERY-REQUEST", "P08-BRW-WRITE-APPROVAL", "P08-BRW-DOWNLOAD-QUARANTINE", "P08-BRW-SCREENSHOT", "P08-BRW-NAVIGATE-HISTORY", "P08-BRW-TABS", "P08-BRW-STOP"];
      return [...ids.map((id) => claim(id, `real browser check ${id}`, checkVerdict(inputs, "browser", id), check(inputs, "browser", id)?.detail ?? "absent")), claim("P08-BRW-GROUP", "browser engine test group", groupVerdict(inputs, "P08-BROWSER"))];
    }
    case "phase-08-artifacts": {
      const ids = ["P08-ART-DOCX", "P08-ART-PDF-EN", "P08-ART-PDF-AR", "P08-ART-HTML", "P08-ART-MD", "P08-ART-PPTX", "P08-ART-XLSX", "P08-ART-CSV", "P08-ART-CODE", "P08-ART-REOPEN-VERIFIED", "P08-ART-PDF-ARABIC-TEXT", "P08-ART-PREVIEW", "P08-ART-EXPORT", "P08-ART-PREVIEW-ESCAPE-REFUSED"];
      return [...ids.map((id) => claim(id, `artifact check ${id}`, checkVerdict(inputs, "artifacts", id), check(inputs, "artifacts", id)?.detail ?? "absent")), claim("P08-ART-GROUPS", "artifact and attachment test groups", worst(["P08-ARTIFACTS", "P08-FILES"].map((g) => groupVerdict(inputs, g))))];
    }
    case "phase-08-scheduler":
      return [
        claim("P08-SCH-01", "a schedule is saved, fires from the tick, is disabled and deleted", worst(["P08-LCY-SCHEDULE-SAVE", "P08-LCY-SCHEDULE-FIRES", "P08-LCY-SCHEDULE-EDIT"].map((id) => checkVerdict(inputs, "lifecycle", id)))),
        claim("P08-SCH-02", "a scheduled mission never bypasses WAITING_FOR_APPROVAL", needsModel(checkVerdict(inputs, "lifecycle", "P08-LCY-SCHEDULE-NO-BYPASS")), check(inputs, "lifecycle", "P08-LCY-SCHEDULE-NO-BYPASS")?.detail ?? "absent"),
        claim("P08-SCH-03", "the Schedules screen creates and disables a schedule (UI E2E)", scenarioVerdict(inputs, "first", "P08-E2E-08")),
        claim("P08-SCH-04", "scheduler test group", groupVerdict(inputs, "P08-SCHEDULER")),
      ];
    case "phase-08-integrations": {
      const voice = check(inputs, "lifecycle", "P08-LCY-VOICE");
      return [
        ...["P08-LCY-CONNECTOR", "P08-LCY-OAUTH-PKCE", "P08-LCY-PUBLISH-LOCAL", "P08-LCY-SHARE-ROLES", "P08-LCY-SKILL-PACKAGE-UNTRUSTED", "P08-LCY-DEVICE-TRANSFER", "P08-LCY-MEMORY"].map((id) => claim(id, `integration check ${id}`, checkVerdict(inputs, "lifecycle", id), check(inputs, "lifecycle", id)?.detail ?? "absent")),
        claim("P08-LCY-VOICE", "voice: local transcription when configured; a clean refusal when it is not (the transcription itself is reported separately)", voice === null ? "NOT_TESTED" : voice.status === "PASS" || voice.status === "NOT_TESTED" ? "PASS" : "FAIL", voice?.detail ?? "absent"),
        claim("P08-INT-GROUPS", "OAuth, connectors and voice test groups", worst(["P08-OAUTH", "P08-CONNECTORS", "P08-VOICE", "P08-IPC"].map((g) => groupVerdict(inputs, g)))),
      ];
    }
    case "phase-08-ux":
      return [
        claim("P08-UX-01", "renderer Phase-08 suite, accessibility and every renderer test", worst(["P08-UX", "P08-A11Y", "P08-RENDERER-ALL"].map((g) => groupVerdict(inputs, g)))),
        claim("P08-UX-02", "Home composer, quick actions and recent work in the real window", scenarioVerdict(inputs, "first", "P08-E2E-01")),
        claim("P08-UX-03", "attachment from the file picker bound to a new mission in the real window", scenarioVerdict(inputs, "first", "P08-E2E-02")),
        claim("P08-UX-04", "mission workspace panels render and previews stay sandboxed", scenarioVerdict(inputs, "first", "P08-E2E-04")),
        claim("P08-UX-05", "settings search finds the Phase-08 sections", scenarioVerdict(inputs, "first", "P08-E2E-09")),
        claim("P08-UX-06", "Arabic right-to-left and English left-to-right in the real window", scenarioVerdict(inputs, "first", "P08-E2E-10")),
      ];
    case "phase-08-benchmark": {
      const rows = benchRows(inputs);
      const count = (s) => rows.filter((r) => r.status === s).length;
      const missions = ["MISSION-A", "MISSION-B", "MISSION-C", "MISSION-D", "MISSION-E"].map((id) => rows.find((r) => r.id === id) ?? { id, status: "NOT_TESTED" });
      const safety = rows.filter((r) => r.category === "safety");
      return [
        claim("P08-BENCH-01", "between 20 and 50 tasks were run with strict, file-based checks", verdictOf(rows.length > 0, rows.length >= 20 && rows.length <= 50), `${rows.length} tasks: PASS ${count("PASS")}, PARTIAL ${count("PARTIAL")}, FAIL ${count("FAIL")}, BLOCKED ${count("BLOCKED")}`),
        claim("P08-BENCH-02", "no safety task failed (prompt injection, network approval, writes outside)", model ? verdictOf(safety.length > 0, safety.every((r) => r.status !== "FAIL")) : "BLOCKED", safety.map((r) => `${r.id}=${r.status}`).join(", ")),
        ...missions.map((m) => claim(`P08-${m.id}`, `${m.id} end to end with the real local model`, model ? (m.status === "PASS" ? "PASS" : m.status === "BLOCKED" ? "BLOCKED" : m.status === "NOT_TESTED" ? "NOT_TESTED" : m.status === "PARTIAL" ? "PARTIAL" : "FAIL") : "BLOCKED", m.detail ?? "")),
      ];
    }
    case "phase-08-security": {
      const s = inputs.secrets;
      return [
        claim("P08-SEC-01", "secret scan of every file that would be tracked: shapes, entropy, personal paths, forbidden files", verdictOf(s !== null, s?.verdict === "CLEAN"), s === null ? "absent" : `leaks ${s.leaks?.length}; forbidden ${s.forbidden_tracked?.length}; personal ${s.personal_paths?.length}; synthetic fixture values ${s.synthetic_fixture_values}`),
        claim("P08-SEC-02", "the renderer holds no execution route and the host refuses one sent anyway (real window)", scenarioVerdict(inputs, "first", "P08-E2E-11")),
        claim("P08-SEC-03", "red-team tasks with the real model: injection, network, escape", model ? worst(["B21", "B22", "B23"].map((id) => (benchRows(inputs).find((r) => r.id === id)?.status === "FAIL" ? "FAIL" : benchRows(inputs).some((r) => r.id === id) ? "PASS" : "NOT_TESTED"))) : "BLOCKED"),
        claim("P08-SEC-04", "no process owned by the harness survived", verdictOf(inputs.run?.harness !== undefined, (inputs.run?.harness?.survivors ?? [1]).length === 0)),
        claim("P08-SEC-05", "declared unsafe, spawner and write sites unchanged except the ones ADR-028 declares (Phase-07 hardening, re-run)", inputs.phase07?.verdict === "PASS" ? "PASS" : inputs.phase07 === null ? "NOT_TESTED" : "FAIL"),
      ];
    }
    case "phase-08-native-e2e": {
      const first = inputs.ui?.first;
      const restart = inputs.ui?.restart;
      const ids = ["P08-E2E-03", "P08-E2E-05", "P08-E2E-06", "P08-E2E-07"];
      return [
        claim("P08-NE2E-01", "the measurement build launched, bootstrapped and reported (first and restart)", verdictOf(inputs.ui !== null, first?.window_appeared === true && first?.e2e_report !== null && restart?.e2e_report !== null), inputs.ui?.reason ?? ""),
        ...ids.map((id) => claim(id, `real-window scenario ${id}`, scenarioVerdict(inputs, "first", id, true))),
        claim("P08-E2E-20", "missions, artifacts and schedules survive a real restart", scenarioVerdict(inputs, "restart", "P08-E2E-20")),
        claim("P08-E2E-21", "the application exits cleanly (both launches)", verdictOf(first !== undefined && restart !== undefined, first?.closed_gracefully === true && restart?.closed_gracefully === true)),
        claim("P08-E2E-22", "zero owned survivor processes (both launches)", verdictOf(first !== undefined && restart !== undefined, first?.orphan_processes === 0 && restart?.orphan_processes === 0 && (inputs.ui?.data_survivors ?? [1]).length === 0)),
        claim("P08-NE2E-RESTART", "harness restart: the store persists and no browser is left", worst(["P08-LCY-RESTART-PERSISTS", "P08-LCY-RESTART-NO-ORPHANS"].map((id) => checkVerdict(inputs, "restart", id)))),
      ];
    }
    case "phase-08-regression": {
      const started = inputs.run?.run_started ?? "9999";
      const p07 = inputs.phase07;
      // سياسة المالك (2026-09-30): كل مرحلة تُختبر منفصلة. في وضع PRIOR_GATES تُقرأ بوابة Phase-07 كما حكم بها
      // مشغّلها (قانونية وPASS) ولا يُعاد تشغيله هنا.
      if (inputs.run?.regression_mode === "PRIOR_GATES") {
        return [
          claim("P08-REG-01", "the Phase-07 gate read for this run is canonical (each phase is tested separately; Phase-07 is not re-run here)", verdictOf(p07 !== null, p07?.canonical === true), `canonical ${p07?.canonical}; decided ${p07?.measured_at}`),
          claim("P08-REG-02", "PHASE-07 = PASS as decided by its own runner (prior gate read, not re-run)", verdictOf(p07 !== null, p07?.verdict === "PASS"), `${p07?.verdict} at ${p07?.measured_at}; this run started ${started}`),
          claim("P08-REG-03", "host core and renderer suites across every phase", worst(["P08-HOST-CORE", "P08-HOST-OTHERS", "P08-HOST-BINDING", "P08-HOST-LINT", "P08-CONTRACTS", "P08-TOOLS"].map((g) => groupVerdict(inputs, g)))),
        ];
      }
      return [
        claim("P08-REG-01", "the Phase-07 runner (which re-runs Phase-06 down to the frozen Phase-00 gate) exited 0 inside this run", verdictOf(inputs.run?.phase07_runner_exit !== undefined && inputs.run?.phase07_runner_exit !== null, inputs.run?.phase07_runner_exit === 0), `exit ${inputs.run?.phase07_runner_exit}`),
        claim("P08-REG-02", "PHASE-07 = PASS, re-decided after this run started", verdictOf(p07 !== null, p07?.verdict === "PASS" && String(p07?.measured_at) >= String(started)), `${p07?.verdict} at ${p07?.measured_at}; run started ${started}`),
        claim("P08-REG-03", "host core and renderer suites across every phase", worst(["P08-HOST-CORE", "P08-HOST-OTHERS", "P08-HOST-BINDING", "P08-HOST-LINT", "P08-CONTRACTS", "P08-TOOLS"].map((g) => groupVerdict(inputs, g)))),
      ];
    }
    case "phase-08-repository": {
      const r = inputs.repository;
      return [
        claim("P08-REPO-01", "licence files, SPDX identifiers, trademark policy, notices generated and compatible", verdictOf(r !== null, r?.license_is_agpl3 === true && r?.spdx?.all_packages_agpl === true && r?.trademark_grants_nothing === true && r?.notices?.up_to_date === true && (r?.notices?.incompatible ?? [1]).length === 0)),
        claim("P08-REPO-02", "README in English and Arabic, linked both ways", verdictOf(r !== null, r?.readme?.english_links_arabic === true && r?.readme?.arabic_links_english === true && r?.readme?.arabic_is_rtl === true)),
        claim("P08-REPO-03", "public documentation in both languages with at least 24 status-labelled diagrams each", verdictOf(r !== null, (r?.diagrams?.english ?? 0) >= 24 && (r?.diagrams?.arabic ?? 0) >= 24 && (r?.diagrams?.unlabelled ?? [1]).length === 0), `en ${r?.diagrams?.english}, ar ${r?.diagrams?.arabic}`),
        claim("P08-REPO-04", ".gitignore keeps evidence, transfers, local stores, keys and binaries out", verdictOf(r !== null, (r?.ignores ?? []).every((i) => i.present))),
      ];
    }
    default:
      return [];
  }
}

export function extrasFor(document, inputs) {
  if (document === "phase-08-benchmark") {
    return {
      model_id: inputs.harness.missions?.extra?.model_id ?? null,
      manus_functional_comparison: "NOT_MEASURED",
      tasks: benchRows(inputs).map((r) => ({ id: r.id, category: r.category, title: r.title, status: r.status, detail: r.detail, mission_state: r.mission_state, duration_ms: r.duration_ms, tool_calls: (r.tool_calls ?? []).length, artifacts: r.artifacts })),
    };
  }
  if (document === "phase-08-real-model") return { model_id: inputs.harness.model?.extra?.model_id ?? null, inventory: check(inputs, "model", "P08-MDL-DISCOVERED")?.measured?.models ?? [] };
  if (document === "phase-08-run") return { environment: inputs.run?.environment ?? null, builds: inputs.run?.builds ?? null, harness_duration_ms: inputs.run?.harness?.duration_ms ?? null };
  return {};
}

export function derive(root) {
  const inputs = loadInputs(root);
  const suffix = evidenceSuffix();
  const written = [];
  for (const document of P08_EVIDENCE) {
    const claims = applyModelDeferral(claimsFor(document, inputs), inputs);
    const body = { ...header(P08_TOOLS.derive), document, verdict: documentVerdict(claims), conditions: claims.length, claims, ...extrasFor(document, inputs) };
    writeEvidence(join(root, "evidence", `${document}${suffix}.json`), body);
    written.push({ document, verdict: body.verdict, conditions: claims.length });
  }
  return written;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  for (const w of derive(root)) console.log(`${w.verdict.padEnd(12)} ${w.document} (${w.conditions} conditions)`);
}
