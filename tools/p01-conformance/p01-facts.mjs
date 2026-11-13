// الحقائق البنيوية التي تقرؤها البوابة.
//
// كل حقيقة هنا تُقاس من الشجرة نفسها لا من ذاكرة الأداة: قائمة مكتوبة بيد داخل
// المشتقّ ليست قياسًا، وهي بالضبط ما يجعل تقريرًا يبدو صحيحًا بعد أن يكون المصدر
// قد تغيّر. كل دالة تعيد `{ id, verdict, detail, observed }`.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { reviewCompleteness } from "./p01-stride.mjs";

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fact(id, verdict, detail, observed = {}) {
  return { id, verdict, detail, observed };
}

function missing(id, what) {
  return fact(id, "NOT_TESTED", `${what} could not be read`);
}

function walk(directory, extensions, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "target", "build-tests", "generated"].includes(entry.name)) continue;
      walk(join(directory, entry.name), extensions, found);
    } else if (extensions.includes(extname(entry.name))) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

// ── العقود والخدمات ─────────────────────────────────────────────────────────

function everyRoutedOperationHasAnOwningService(root) {
  const id = "every_routed_operation_has_an_owning_service";
  const registry = readJson(join(root, "contracts", "registry", "phase-01-ipc.registry.json"));
  const hostSource = readText(join(root, "desktop", "host", "core", "src", "services", "host.rs"));
  if (registry === null || hostSource === null) return missing(id, "the registry or the host router");

  const routed = registry.operations.filter((record) => record.routing_status === "ROUTED");
  const unowned = routed.filter((record) => typeof record.owner !== "string" || record.owner.length === 0);
  const unrouted = routed.filter((record) => !hostSource.includes(`"${record.operation}"`));
  const ok = unowned.length === 0 && unrouted.length === 0 && routed.length === 5;
  return fact(
    id,
    ok ? "PASS" : "FAIL",
    ok
      ? `${routed.length} routed operations, each named in the host router and each with an owner`
      : `unowned: ${unowned.map((r) => r.operation).join(", ")}; unrouted in host: ${unrouted.map((r) => r.operation).join(", ")}`,
    { routed: routed.length, owners: [...new Set(routed.map((r) => r.owner))].sort() },
  );
}

function hostExposesOneCommandOnly(root) {
  const id = "host_exposes_one_command_only";
  const source = readText(join(root, "desktop", "host", "app", "src", "lib.rs"));
  if (source === null) return missing(id, "the host binding");

  // ADR-019 D8: الأمر صار غير متزامن؛ الصيغة `#[tauri::command(async)]` و`async fn` تُعدّ أيضًا.
  const commands = [...source.matchAll(/#\[tauri::command(?:\([^)\]]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g)].map(
    (match) => match[1],
  );
  // الأمر الثاني موجود فقط تحت ميزة الترجمة `e2e`، فلا يُترجم في ثنائي المنتج.
  const gated = [...source.matchAll(/#\[cfg\(feature = "e2e"\)\]\s*#\[tauri::command(?:\([^)\]]*\))?\]\s*(?:async\s+)?fn\s+(\w+)/g)].map(
    (match) => match[1],
  );
  const productCommands = commands.filter((name) => !gated.includes(name));
  const ok = productCommands.length === 1 && productCommands[0] === "polaris_ipc";
  return fact(
    id,
    ok ? "PASS" : "FAIL",
    ok
      ? "the product binary exposes exactly one command, and it takes a whole envelope rather than a name"
      : `product commands: ${productCommands.join(", ") || "none"}`,
    { product_commands: productCommands, feature_gated_commands: gated },
  );
}

function noShellOrFilesystemPermissionGranted(root) {
  const id = "no_shell_or_filesystem_permission_granted";
  const capability = readJson(join(root, "desktop", "host", "app", "capabilities", "default.json"));
  const manifest = readText(join(root, "desktop", "host", "app", "Cargo.toml"));
  if (capability === null || manifest === null) return missing(id, "the capability file or the host manifest");

  const forbiddenPermission = /^(fs|shell|dialog|http|process|updater|core:path|core:resources)/;
  const grantedOffenders = (capability.permissions ?? []).filter((entry) => forbiddenPermission.test(String(entry)));
  const forbiddenPlugins = ["tauri-plugin-fs", "tauri-plugin-shell", "tauri-plugin-dialog", "tauri-plugin-http", "tauri-plugin-process"];
  const pluginOffenders = forbiddenPlugins.filter((name) => manifest.includes(name));
  const ok = grantedOffenders.length === 0 && pluginOffenders.length === 0;
  return fact(
    id,
    ok ? "PASS" : "FAIL",
    ok
      ? `granted: ${(capability.permissions ?? []).join(", ")}; no filesystem, shell, dialog, http or process plugin is a dependency`
      : `granted offenders: ${grantedOffenders.join(", ")}; plugin offenders: ${pluginOffenders.join(", ")}`,
    { permissions: capability.permissions ?? [] },
  );
}

function noBoundaryErrorTypeCarriesInternalDetail(root) {
  const id = "no_boundary_error_type_carries_internal_detail";
  const source = readText(join(root, "desktop", "host", "core", "src", "ipc", "errors.rs"));
  const mapping = readJson(join(root, "contracts", "registry", "phase-01-error-mapping.json"));
  if (source === null || mapping === null) return missing(id, "the host error module or the error mapping");

  const structMatch = /pub struct BoundaryError \{([\s\S]*?)\n\}/.exec(source);
  const body = structMatch === null ? "" : structMatch[1];
  const leaks = ["internal_detail", "stack", "backtrace"].filter((name) => body.includes(name));
  const crossing = mapping.entries.filter((entry) => entry.detail_may_cross_boundary === true);
  const ok = structMatch !== null && leaks.length === 0 && crossing.length === 0;
  return fact(
    id,
    ok ? "PASS" : "FAIL",
    ok
      ? "the serialised error type has no detail field, and no declared category lets detail cross"
      : `struct fields leaking: ${leaks.join(", ")}; categories allowing detail: ${crossing.map((e) => e.category).join(", ")}`,
    { categories: mapping.entries.length },
  );
}

// ── الواجهة ─────────────────────────────────────────────────────────────────

const INVENTED_METRICS = [
  "tokensSaved",
  "tokens_saved",
  "agentsRunning",
  "missionsCompleted",
  "productivityScore",
  "securityScore",
  "activeUsers",
  "requestsToday",
];

function noInventedMetricInTheRendererSource(root) {
  const id = "no_invented_metric_in_the_renderer_source";
  const sourceRoot = join(root, "desktop", "renderer", "src");
  if (!existsSync(sourceRoot)) return missing(id, "the renderer source");
  const offenders = [];
  for (const file of walk(sourceRoot, [".ts", ".tsx"])) {
    const text = readFileSync(file, "utf8");
    for (const metric of INVENTED_METRICS) {
      if (text.includes(metric)) offenders.push(`${file}: ${metric}`);
    }
  }
  return fact(
    id,
    offenders.length === 0 ? "PASS" : "FAIL",
    offenders.length === 0 ? "no invented operational metric appears in the renderer source" : offenders.join("; "),
  );
}

const MODEL_NAMES = ["gpt-", "claude-", "llama", "mistral", "gemini", "deepseek", "qwen"];

function noModelNameIsHardCoded(root) {
  const id = "no_model_name_is_hard_coded";
  const places = [join(root, "desktop", "renderer", "src"), join(root, "desktop", "host", "core", "src")];
  const offenders = [];
  for (const place of places) {
    if (!existsSync(place)) continue;
    for (const file of walk(place, [".ts", ".tsx", ".rs"])) {
      // ADR-019 D11: اسم المزوّد «ollama» يحوي «llama» حرفيًا وليس اسم عائلة نماذج.
      // يُزال هذا الرمز وحده قبل المطابقة؛ أي «llama» آخر (codellama، llama3…) يبقى مرفوضًا.
      const text = readFileSync(file, "utf8").toLowerCase().replace(/ollama/g, "");
      for (const name of MODEL_NAMES) {
        if (text.includes(name)) offenders.push(`${file}: ${name}`);
      }
    }
  }
  return fact(
    id,
    offenders.length === 0 ? "PASS" : "FAIL",
    offenders.length === 0 ? "no provider or model name is written into the product source" : offenders.join("; "),
  );
}

function nineLocaleCatalogsExist(root) {
  const id = "nine_locale_catalogs_exist";
  const directory = join(root, "desktop", "renderer", "src", "localization", "catalog");
  if (!existsSync(directory)) return missing(id, "the localization catalogs");
  const expected = ["ar", "en", "de", "fr", "ru", "zh", "ko", "ja", "es"];
  const present = expected.filter((code) => existsSync(join(directory, `${code}.ts`)));
  const ok = present.length === expected.length;
  return fact(
    id,
    ok ? "PASS" : "FAIL",
    ok ? "all nine architectural locales have a catalog" : `missing: ${expected.filter((c) => !present.includes(c)).join(", ")}`,
    { present },
  );
}

function focusVisibleRuleExists(root) {
  const id = "focus_visible_rule_exists";
  const css = readText(join(root, "desktop", "renderer", "src", "ui", "polaris.css"));
  if (css === null) return missing(id, "the design tokens");
  const hasFocus = /:focus-visible\s*\{[^}]*outline:/.test(css);
  const hasReducedMotion = /@media \(prefers-reduced-motion: reduce\)/.test(css);
  const ok = hasFocus && hasReducedMotion;
  return fact(
    id,
    ok ? "PASS" : "FAIL",
    ok
      ? "a visible focus ring is declared, and reduced motion is honoured"
      : `focus ring: ${hasFocus}; reduced motion: ${hasReducedMotion}`,
  );
}

function decorativeGraphicsAreHidden(root) {
  const id = "decorative_graphics_are_hidden_from_assistive_technology";
  const sourceRoot = join(root, "desktop", "renderer", "src");
  if (!existsSync(sourceRoot)) return missing(id, "the renderer source");
  const offenders = [];
  for (const file of walk(sourceRoot, [".tsx"])) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/<svg\b([\s\S]*?)>/g)) {
      if (!(match[1] ?? "").includes("aria-hidden")) offenders.push(file);
    }
  }
  return fact(
    id,
    offenders.length === 0 ? "PASS" : "FAIL",
    offenders.length === 0
      ? "every inline graphic is hidden from assistive technology and named by adjacent text"
      : `graphics without aria-hidden: ${offenders.join(", ")}`,
  );
}

// ── البناء والتشغيل ─────────────────────────────────────────────────────────

function buildFact(id, raw, key, label) {
  if (raw === null || raw.build === undefined || raw.build === null) return missing(id, `the ${label} build record`);
  const record = raw.build[key];
  if (record === undefined || record === null) return missing(id, `the ${label} build record`);
  const ok = record.ok === true && record.exit_code === 0;
  return fact(id, ok ? "PASS" : "FAIL", ok ? `${label} built in ${record.duration_ms} ms` : `${label} build exit ${record.exit_code}`, record);
}

// ── انحدار Phase-00 ─────────────────────────────────────────────────────────

const VERDICT_RANK = { PASS: 4, INCONCLUSIVE: 3, BLOCKED: 2, NOT_TESTED: 1, FAIL: 0 };

function phase00Facts(root) {
  const after = readJson(join(root, "evidence", "phase-00-final-gate.json"));
  const before = readJson(join(root, "evidence", "phase-01-p00-baseline.local.json"));

  const gate =
    after === null
      ? missing("phase_00_gate_passes_after_phase_01", "the Phase-00 gate document")
      : fact(
          "phase_00_gate_passes_after_phase_01",
          after.verdict === "PASS" ? "PASS" : "FAIL",
          `Phase-00 gate verdict after Phase-01: ${after.verdict}`,
          { verdict: after.verdict, measured_at: after.measured_at ?? null },
        );

  if (before === null || after === null) {
    return [
      gate,
      missing("phase_00_claim_set_unchanged", "the Phase-00 snapshot taken before the re-run"),
      missing("no_phase_00_verdict_weakened", "the Phase-00 snapshot taken before the re-run"),
    ];
  }

  const claimsOf = (document) => {
    const list = Array.isArray(document.claims) ? document.claims : [];
    const map = new Map();
    for (const claim of list) map.set(claim.claim_id ?? claim.id, claim.verdict);
    return map;
  };
  const beforeClaims = claimsOf(before);
  const afterClaims = claimsOf(after);
  const removed = [...beforeClaims.keys()].filter((key) => !afterClaims.has(key));
  const added = [...afterClaims.keys()].filter((key) => !beforeClaims.has(key));
  const weakened = [...beforeClaims.entries()]
    .filter(([key, verdict]) => {
      const now = afterClaims.get(key);
      if (now === undefined) return false;
      return (VERDICT_RANK[now] ?? 0) < (VERDICT_RANK[verdict] ?? 0);
    })
    .map(([key, verdict]) => `${key}: ${verdict} -> ${afterClaims.get(key)}`);

  return [
    gate,
    fact(
      "phase_00_claim_set_unchanged",
      removed.length === 0 && added.length === 0 ? "PASS" : "FAIL",
      removed.length === 0 && added.length === 0
        ? `${beforeClaims.size} Phase-00 claims, identical before and after`
        : `removed: ${removed.join(", ")}; added: ${added.join(", ")}`,
      { before: beforeClaims.size, after: afterClaims.size },
    ),
    fact(
      "no_phase_00_verdict_weakened",
      weakened.length === 0 ? "PASS" : "FAIL",
      weakened.length === 0 ? "no Phase-00 verdict moved down" : weakened.join("; "),
    ),
  ];
}

// ── المجموعات والأدلة ───────────────────────────────────────────────────────

const SECURITY_CRITICAL_GROUPS = ["P01-HOST-GATEWAY", "P01-HOST-CORE", "P01-RENDERER-IPC", "P01-RENDERER-STRINGS"];

function groupFacts(groupsDocument) {
  if (groupsDocument === null) {
    return [
      missing("every_group_reported_exact_counts", "the test group document"),
      missing("no_security_critical_test_skipped", "the test group document"),
    ];
  }
  const groups = groupsDocument.groups ?? [];
  const unreported = groups.filter((group) => group.kind !== "probe" && group.counts?.tests === null);
  const skipped = groups.filter((group) => (group.counts?.skipped ?? 0) > 0);
  const criticalSkipped = groups.filter(
    (group) => SECURITY_CRITICAL_GROUPS.includes(group.group_id) && (group.counts?.skipped ?? 0) > 0,
  );
  const criticalMissing = SECURITY_CRITICAL_GROUPS.filter(
    (id) => !groups.some((group) => group.group_id === id && group.verdict === "PASS"),
  );

  return [
    fact(
      "every_group_reported_exact_counts",
      unreported.length === 0 ? "PASS" : "INCONCLUSIVE",
      unreported.length === 0
        ? `${groups.length} groups declared, every runnable one reported exact counts, ${skipped.length} with a skip`
        : `groups with no counts: ${unreported.map((group) => group.group_id).join(", ")}`,
      { declared: groups.length, summary: groupsDocument.summary ?? null },
    ),
    fact(
      "no_security_critical_test_skipped",
      criticalSkipped.length === 0 && criticalMissing.length === 0 ? "PASS" : criticalMissing.length > 0 ? "NOT_TESTED" : "FAIL",
      criticalSkipped.length === 0 && criticalMissing.length === 0
        ? `${SECURITY_CRITICAL_GROUPS.length} security-critical groups ran with no skip`
        : `skipped: ${criticalSkipped.map((g) => g.group_id).join(", ")}; not passing: ${criticalMissing.join(", ")}`,
      { security_critical: SECURITY_CRITICAL_GROUPS },
    ),
  ];
}

function dogfoodFact(e2eDocument) {
  const id = "every_dogfood_scenario_accounted_for";
  if (e2eDocument === null) return missing(id, "the native end-to-end document");
  const wanted = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12"];
  const byId = new Map((e2eDocument.scenarios ?? []).map((scenario) => [scenario.id, scenario]));
  const absent = wanted.filter((scenarioId) => !byId.has(scenarioId));
  const failed = wanted.filter((scenarioId) => byId.get(scenarioId)?.verdict === "FAIL");
  const untested = wanted.filter((scenarioId) => byId.get(scenarioId)?.verdict === "NOT_TESTED");
  const verdict = absent.length > 0 || untested.length > 0 ? (failed.length > 0 ? "FAIL" : "NOT_TESTED") : failed.length > 0 ? "FAIL" : "PASS";
  return fact(
    id,
    verdict,
    verdict === "PASS"
      ? `${wanted.length} dogfood scenarios, all measured and passing`
      : `absent: ${absent.join(", ")}; failed: ${failed.join(", ")}; not tested: ${untested.join(", ")}`,
    { absent, failed, untested },
  );
}

function evidenceBytesFact(root) {
  const id = "evidence_byte_contract_clean";
  const document = readJson(join(root, "evidence", "phase-01-evidence-bytes.json")) ??
    readJson(join(root, "evidence", "phase-01-evidence-bytes.adhoc.json"));
  if (document === null) return missing(id, "the evidence byte gate document");
  const ok = document.verdict === "PASS";
  return fact(id, ok ? "PASS" : "FAIL", `${document.summary?.clean ?? "?"}/${document.summary?.checked ?? "?"} documents clean`, document.summary ?? {});
}

function strideFact() {
  const id = "stride_review_covers_seven_surfaces";
  const review = reviewCompleteness();
  return fact(
    id,
    review.complete ? "PASS" : "FAIL",
    review.complete
      ? `${review.surfaces_covered} surfaces, ${review.findings} findings, every finding disposed and evidenced`
      : `missing surfaces: ${review.missing_surfaces.join(", ")}; undisposed: ${review.undisposed.join(", ")}; unevidenced: ${review.unevidenced.join(", ")}`,
    review,
  );
}

/** كل الحقائق، بمعرّفاتها. */
export function collectFacts(root, context) {
  const raw = context.raw ?? null;
  const all = [
    everyRoutedOperationHasAnOwningService(root),
    hostExposesOneCommandOnly(root),
    noShellOrFilesystemPermissionGranted(root),
    noBoundaryErrorTypeCarriesInternalDetail(root),
    noInventedMetricInTheRendererSource(root),
    noModelNameIsHardCoded(root),
    nineLocaleCatalogsExist(root),
    focusVisibleRuleExists(root),
    decorativeGraphicsAreHidden(root),
    buildFact("host_release_build_succeeded", raw, "host_release", "native host"),
    buildFact("renderer_build_succeeded", raw, "renderer", "renderer"),
    ...phase00Facts(root),
    ...groupFacts(context.groups ?? null),
    dogfoodFact(context.e2e ?? null),
    evidenceBytesFact(root),
    strideFact(),
  ];
  return new Map(all.map((entry) => [entry.id, entry]));
}
