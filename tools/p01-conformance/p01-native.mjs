// اشتقاق دليل المسار الأصلي: التشغيل الفعلي على Windows، والقياسات الحقيقية.
//
// هذه الأداة لا تقيس شيئًا. تقرأ ما رصده المشغّل الأصلي وتصوغه في وثيقتين
// قانونيتين، وتترك ما لم يُرصد `NOT_TESTED`. الفرق بين «لم يُقَس» و«فشل» محفوظ
// هنا بعناية: مضيف غير ويندوزي لم يفشل في شيء، وإنما لم يقس شيئًا.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { PACKAGED_ORIGINS } from "./build-mode.mjs";
import { argument, evidenceSuffix, isCanonicalRun, P01_TOOLS, stamp } from "./p01-groups.mjs";

const SCHEMA_VERSION = "1.0.0";

/** اسم وثيقة الرصد الخام التي يكتبها المشغّل الأصلي. */
export const RAW_PROBE_NAME = "phase-01-native-probe.local.json";

/** المقاييس المطلوبة في `P01-P1`، وكيف يُسمّى مصدر كل منها. */
export const REQUIRED_MEASUREMENTS = Object.freeze([
  { id: "cold_startup", source_field: "cold_start_to_bootstrap_ms", owner: "RUNNER_STOPWATCH" },
  { id: "window_visible", source_field: "window_visible_ms", owner: "RUNNER_STOPWATCH" },
  { id: "renderer_ready", source_field: "host_measured_renderer_first_request_ms", owner: "HOST_PROCESS" },
  { id: "bootstrap_ipc", source_field: "host_measured_bootstrap_handle_ms", owner: "HOST_PROCESS" },
  { id: "clean_exit", source_field: "exit_ms", owner: "RUNNER_STOPWATCH" },
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** يصنّف قيمة مقيسة. الغياب `unknown`، ولا شيء هنا `estimated` لأن لا شيء يُقدَّر. */
export function classifyMeasurement(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { value, classification: "measured" };
  }
  return { value: null, classification: "unknown" };
}

function scenarioIndex(report) {
  const map = new Map();
  for (const scenario of report?.renderer?.scenarios ?? []) map.set(scenario.id, scenario);
  return map;
}

/** حكم سيناريو واحد عبر كل تشغيلات المقياس. */
function scenarioVerdict(runs, id) {
  const seen = runs
    .map((run) => scenarioIndex(run.record?.e2e_report).get(id))
    .filter((scenario) => scenario !== undefined);
  if (seen.length === 0) return { verdict: "NOT_TESTED", reason: "SCENARIO_NOT_REPORTED", observations: 0 };
  if (seen.some((scenario) => scenario.status === "FAIL")) {
    return { verdict: "FAIL", reason: seen.find((s) => s.status === "FAIL")?.detail ?? "", observations: seen.length };
  }
  if (seen.every((scenario) => scenario.status === "NOT_TESTED")) {
    return { verdict: "NOT_TESTED", reason: seen[0]?.detail ?? "", observations: seen.length };
  }
  return { verdict: "PASS", reason: "", observations: seen.length };
}

/**
 * D3 — فشل الإقلاع يعطي شاشة خطأ صادقة قابلة للإعادة.
 *
 * لا يُقاس داخل النافذة الأصلية: إسقاط المضيف عمدًا يلغي بقية القياس، ومجموعة
 * E2E تعلن ذلك بنفسها («measured in the headless lane»). قياسه الفعلي هو اختبار
 * مُسمّى في مجموعة P01-RENDERER-UI، يرسم `AppRoot` الحقيقي فوق نقل يفشل. كان
 * الاشتقاق يترك D3 `NOT_TESTED` دائمًا فلا يستطيع P01-V2 أن ينجح أبدًا؛ هنا
 * يُربط الحكم بمصدره المقيس، ولا يُرقّى شيء لم يُقَس: الاختبار يجب أن يوجد
 * بالاسم، والمجموعة يجب أن تكون قد شُغّلت في هذا التشغيل ونجحت بلا تخطٍّ.
 */
export const D3_HEADLESS_TEST = "a failed bootstrap shows an honest recoverable error and no invented defaults";
export const D3_HEADLESS_GROUP = "P01-RENDERER-UI";

export function headlessBootstrapFailureVerdict(testGroups, testSource) {
  const base = { measured_by: "RENDERER_HEADLESS_LANE", group: D3_HEADLESS_GROUP, test: D3_HEADLESS_TEST };
  if (typeof testSource !== "string" || !testSource.includes(`test(${JSON.stringify(D3_HEADLESS_TEST)}`)) {
    return { ...base, verdict: "NOT_TESTED", reason: "D3_HEADLESS_TEST_ABSENT" };
  }
  const group = (testGroups?.groups ?? []).find((entry) => entry.group_id === D3_HEADLESS_GROUP);
  if (group === undefined) return { ...base, verdict: "NOT_TESTED", reason: "RENDERER_UI_GROUP_NOT_MEASURED" };
  const counts = group.counts ?? {};
  if (group.verdict === "FAIL" || (counts.failed ?? 0) > 0) {
    return { ...base, verdict: "FAIL", reason: "RENDERER_UI_GROUP_FAILED" };
  }
  const clean =
    group.verdict === "PASS" &&
    (counts.passed ?? 0) > 0 &&
    counts.passed === counts.tests &&
    (counts.skipped ?? 0) === 0 &&
    (counts.todo ?? 0) === 0 &&
    (counts.cancelled ?? 0) === 0;
  return clean
    ? { ...base, verdict: "PASS", reason: "" }
    : { ...base, verdict: "NOT_TESTED", reason: "RENDERER_UI_GROUP_INCONCLUSIVE" };
}

/** حكم P01-NATIVE-ASSET-001 لتشغيل منتج واحد. */
export function frontendVerdict(buildMode, run) {
  const origin = run?.startup_report?.renderer_origin ?? null;
  const base = { id: "P01-NATIVE-ASSET-001", build_mode: buildMode ?? null, renderer_origin: origin, dev_server_listening: run?.dev_server_listening ?? null };
  if (run === null || run === undefined) return { ...base, verdict: "NOT_TESTED", reason: "PRODUCT_RUN_ABSENT" };
  if (buildMode !== "PACKAGED") return { ...base, verdict: "FAIL", reason: "PRODUCT_NOT_BUILT_WITH_PACKAGED_FRONTEND" };
  if (run.dev_server_listening !== false) return { ...base, verdict: "FAIL", reason: run.dev_server_listening === true ? "DEV_SERVER_LISTENING_AT_LAUNCH" : "STANDALONE_NOT_PROVEN" };
  if (origin === null) return { ...base, verdict: "FAIL", reason: "RENDERER_ORIGIN_NOT_REPORTED" };
  if (!PACKAGED_ORIGINS.includes(origin)) return { ...base, verdict: "FAIL", reason: "RENDERER_NOT_LOADED_FROM_PACKAGED_ASSETS" };
  return { ...base, verdict: "PASS", reason: "" };
}

export function deriveDocuments(root) {
  const evidenceDirectory = join(root, "evidence");
  const rawPath = join(evidenceDirectory, RAW_PROBE_NAME);
  const canonical = isCanonicalRun();
  const suffix = evidenceSuffix();
  const measuredAt = stamp();

  const raw = existsSync(rawPath) ? readJson(rawPath) : null;
  const product = raw?.product_run ?? null;
  const e2eRuns = Array.isArray(raw?.e2e_runs) ? raw.e2e_runs : [];
  const restart = raw?.restart_run ?? null;
  const testGroupsPath = join(evidenceDirectory, `phase-01-test-groups${suffix}.json`);
  const testGroups = existsSync(testGroupsPath) ? readJson(testGroupsPath) : null;
  const uiTestPath = join(root, "desktop", "renderer", "tests", "app.test.tsx");
  const uiTestSource = existsSync(uiTestPath) ? readFileSync(uiTestPath, "utf8") : null;

  // ── سيناريوهات الاستعمال ──────────────────────────────────────────────────
  const scenarioIds = [
    ["D1", "startup"],
    ["D2", "navigate every section"],
    ["D3", "bootstrap failure"],
    ["D4", "language switch"],
    ["D5", "theme switch"],
    ["D6", "unavailable feature"],
    ["D7", "settings describe and read"],
    ["D8", "unknown route"],
    ["D9", "unknown IPC"],
    ["D10", "malformed IPC"],
    ["D11", "restart"],
    ["D12", "clean exit"],
    ["S5", "no internal detail crosses the boundary"],
    ["S6", "an unavailable feature cannot execute anything"],
    ["H4", "bootstrap is repeatable"],
  ];

  const scenarios = scenarioIds.map(([id, title]) => {
    if (id === "D3") {
      const derived = headlessBootstrapFailureVerdict(testGroups, uiTestSource);
      return { id, title, verdict: derived.verdict, reason: derived.reason, measured_by: derived.measured_by, source: { group: derived.group, test: derived.test } };
    }
    if (id === "D11") {
      const ok = restart !== null && restart.started === true && restart.window_appeared === true;
      return {
        id,
        title,
        verdict: restart === null ? "NOT_TESTED" : ok ? "PASS" : "FAIL",
        reason: restart === null ? "RESTART_NOT_PROBED" : "",
        measured_by: "NATIVE_RUNNER",
      };
    }
    if (id === "D12") {
      const ok = product !== null && product.process_exited === true && product.orphan_processes === 0;
      return {
        id,
        title,
        verdict: product === null ? "NOT_TESTED" : ok ? "PASS" : "FAIL",
        reason: product === null ? "PRODUCT_RUN_ABSENT" : "",
        measured_by: "NATIVE_RUNNER",
      };
    }
    const derived = scenarioVerdict(e2eRuns, id);
    return { id, title, ...derived, measured_by: "RENDERER_IN_WINDOW" };
  });

  // ── التحجيم ───────────────────────────────────────────────────────────────
  const scaleObservations = e2eRuns.map((run) => {
    const viewport = run.record?.e2e_report?.renderer?.viewport ?? null;
    return {
      requested_scale: run.scale ?? null,
      observed_device_pixel_ratio: viewport?.device_pixel_ratio ?? null,
      inner_width: viewport?.inner_width ?? null,
      inner_height: viewport?.inner_height ?? null,
      no_horizontal_overflow: viewport?.no_horizontal_overflow ?? null,
      rail_visible: viewport?.rail_visible ?? null,
      main_visible: viewport?.main_visible ?? null,
      verdict:
        viewport === null
          ? "NOT_TESTED"
          : viewport.no_horizontal_overflow === true && viewport.rail_visible === true && viewport.main_visible === true
            ? "PASS"
            : "FAIL",
    };
  });

  const scalingVerdict =
    scaleObservations.length === 0
      ? "NOT_TESTED"
      : scaleObservations.some((entry) => entry.verdict === "FAIL")
        ? "FAIL"
        : scaleObservations.filter((entry) => entry.verdict === "PASS").length === 3
          ? "PASS"
          : "INCONCLUSIVE";

  // ── النافذة ───────────────────────────────────────────────────────────────
  const window = product?.window ?? null;
  const windowVerdict = (() => {
    if (window === null) return { verdict: "NOT_TESTED", reason: "WINDOW_NOT_PROBED" };
    if (window.status === "BLOCKED") return { verdict: "BLOCKED", reason: window.reason ?? "WINDOW_INTEROP_UNAVAILABLE" };
    const ok =
      window.min_width_enforced === true &&
      window.min_height_enforced === true &&
      window.maximized === true &&
      window.restored === true &&
      window.restored_on_screen === true;
    return { verdict: ok ? "PASS" : "FAIL", reason: ok ? "" : "WINDOW_BEHAVIOUR_UNEXPECTED" };
  })();

  // ── الإطلاق والخروج ───────────────────────────────────────────────────────
  // P01-NATIVE-ASSET-001: المنتج يعمل وحده بواجهته المحزومة. ثلاث حقائق مستقلة:
  // وضع البناء من رسائل cargo، وأصل الصفحة كما رآه المضيف، وغياب خادم تطوير.
  const frontend = frontendVerdict(raw?.build?.host_release?.frontend_mode, product);
  const launchVerdict = (() => {
    if (product === null) return { verdict: "NOT_TESTED", reason: "PRODUCT_RUN_ABSENT" };
    if (product.started !== true) return { verdict: "FAIL", reason: "PROCESS_DID_NOT_START" };
    if (product.window_appeared !== true) return { verdict: "FAIL", reason: "WINDOW_DID_NOT_APPEAR" };
    if (product.startup_report === null || product.startup_report === undefined) {
      return { verdict: "FAIL", reason: "HOST_NEVER_ANSWERED_BOOTSTRAP" };
    }
    if (frontend.verdict !== "PASS") return { verdict: "FAIL", reason: frontend.reason };
    return { verdict: "PASS", reason: "" };
  })();

  const exitVerdict = (() => {
    if (product === null) return { verdict: "NOT_TESTED", reason: "PRODUCT_RUN_ABSENT" };
    if (product.process_exited !== true) return { verdict: "FAIL", reason: "PROCESS_DID_NOT_EXIT" };
    if (product.orphan_processes !== 0) return { verdict: "FAIL", reason: "ORPHAN_PROCESS_SURVIVED" };
    return { verdict: "PASS", reason: "" };
  })();

  const e2eDocument = {
    schema_version: SCHEMA_VERSION,
    tool: P01_TOOLS.native,
    phase: "PHASE-01",
    work_package: "P01-W9/W11",
    canonical,
    platform: raw?.platform ?? process.platform,
    native: (raw?.platform ?? process.platform) === "win32",
    measured_at: measuredAt,
    repository_root: root,
    raw_observation_reference: join("evidence", RAW_PROBE_NAME),
    build: raw?.build ?? null,
    launch: { ...launchVerdict, window_title: product?.window_title ?? "", executable: product?.executable ?? "", frontend },
    window: { ...windowVerdict, observations: window },
    scaling: {
      verdict: scalingVerdict,
      method:
        "WebView2 device scale factor forced through WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS; the operating system display scale is not changed and is not claimed",
      observations: scaleObservations,
    },
    exit: exitVerdict,
    scenarios,
    evidence_complete: raw !== null,
    reason_codes: raw === null ? ["NATIVE_PROBE_ABSENT"] : (product?.reason_codes ?? []),
  };

  // ── الأداء ────────────────────────────────────────────────────────────────
  const measurements = REQUIRED_MEASUREMENTS.map((entry) => {
    const value = product?.measurements?.[entry.source_field];
    return { id: entry.id, owner: entry.owner, source_field: entry.source_field, ...classifyMeasurement(value) };
  });

  const performanceDocument = {
    schema_version: SCHEMA_VERSION,
    tool: P01_TOOLS.native,
    phase: "PHASE-01",
    work_package: "P01-W9",
    canonical,
    platform: raw?.platform ?? process.platform,
    native: (raw?.platform ?? process.platform) === "win32",
    measured_at: measuredAt,
    repository_root: root,
    raw_observation_reference: join("evidence", RAW_PROBE_NAME),
    rules: [
      "every number carries a classification: measured, estimated or unknown",
      "nothing in this document is estimated; an absent observation is unknown, never a guess",
      "memory footprint is not measured in Phase-01 and is recorded as unknown rather than omitted",
    ],
    measurements: [
      ...measurements,
      { id: "memory_footprint", owner: "NOT_MEASURED", source_field: null, value: null, classification: "unknown" },
    ],
    navigation_latency: {
      classification: "unknown",
      note: "navigation is a local state change with no host round trip; it is not measured separately in Phase-01",
    },
    evidence_complete: raw !== null,
    verdict: measurements.every((entry) => entry.classification === "measured") ? "PASS" : raw === null ? "NOT_TESTED" : "INCONCLUSIVE",
    reason_codes: measurements.filter((entry) => entry.classification !== "measured").map((entry) => `${entry.id.toUpperCase()}_UNKNOWN`),
  };

  mkdirSync(evidenceDirectory, { recursive: true });
  const paths = [];
  for (const [name, document] of [
    [`phase-01-desktop-e2e${suffix}.json`, e2eDocument],
    [`phase-01-performance${suffix}.json`, performanceDocument],
  ]) {
    const path = join(evidenceDirectory, name);
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    assertWrittenEvidence(path);
    paths.push(path);
  }
  return { paths, e2eDocument, performanceDocument };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { paths, e2eDocument, performanceDocument } = deriveDocuments(root);
  console.log(`native launch   : ${e2eDocument.launch.verdict} ${e2eDocument.launch.reason}`);
  console.log(`packaged UI     : ${e2eDocument.launch.frontend.verdict} origin=${e2eDocument.launch.frontend.renderer_origin}`);
  console.log(`native window   : ${e2eDocument.window.verdict}`);
  console.log(`native scaling  : ${e2eDocument.scaling.verdict}`);
  console.log(`native exit     : ${e2eDocument.exit.verdict}`);
  console.log(`performance     : ${performanceDocument.verdict}`);
  for (const path of paths) console.log(`wrote ${path}`);
  process.exitCode = e2eDocument.evidence_complete ? 0 : 1;
}
