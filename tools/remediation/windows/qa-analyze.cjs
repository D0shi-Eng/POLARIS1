// POLARIS QA 2026-10-15: summarise a qa-controls e2e report (startup-e2e.json).
// Usage: node qa-analyze.cjs <startup-e2e.json> [out-summary.json]
const fs = require("fs");
const [file, out] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const report = doc.renderer || doc.e2e || doc.report || doc;
const results = report.results || [];
const summary = { fatal: report.fatal || null, passes: [] };
for (const pass of results) {
  const rows = pass.rows || [];
  const by = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
  const pages = (pass.pages || []).map((p) => ({ route: p.route, load_ms: p.load_ms, controls: p.controls, main: p.main, dir: p.dir, overflow: p.horizontal_overflow, errors: (p.errors_on_load || []).length }));
  const loads = pages.map((p) => p.load_ms).sort((a, b) => a - b);
  const pct = (q) => loads.length ? loads[Math.min(loads.length - 1, Math.ceil(q * loads.length) - 1)] : null;
  const issue = (pred) => rows.filter(pred).map((r) => ({ route: r.route, key: r.key, name: r.name, effect: r.effect, checks: r.checks, errors: r.errors }));
  summary.passes.push({
    locale: pass.locale,
    seed: pass.seed && { project: pass.seed.project },
    routes: pages.length,
    controls: rows.length,
    verdicts: by((r) => r.verdict),
    load_ms: { p50: pct(0.5), p95: pct(0.95), max: loads[loads.length - 1] },
    pages_with_overflow: pages.filter((p) => p.overflow).map((p) => p.route),
    pages_without_main: pages.filter((p) => !p.main).map((p) => p.route),
    pages_with_load_errors: (pass.pages || []).filter((p) => (p.errors_on_load || []).length).map((p) => ({ route: p.route, errors: p.errors_on_load.slice(0, 3) })),
    no_name: issue((r) => r.checks && r.checks.has_name === false),
    outside_x: issue((r) => r.checks && r.checks.inside_window_x === false),
    occluded: issue((r) => r.checks && r.checks.occluded_by),
    clipped: issue((r) => r.checks && r.checks.clipped === true),
    small_target: rows.filter((r) => r.checks && r.checks.min_target_24px === false).length,
    no_effect: issue((r) => r.verdict === "NO_EFFECT"),
    errors: issue((r) => r.verdict === "ERROR"),
    stuck_overlays: issue((r) => /stuck|did not close/.test(r.effect || "")),
    disabled_without_reason: issue((r) => r.verdict === "DISABLED" && !r.disabled_reason),
    skipped: by((r) => (r.verdict === "SKIPPED_EFFECTFUL" ? r.effect : "_")),
  });
}
const text = JSON.stringify(summary, null, 1);
if (out) fs.writeFileSync(out, text);
for (const p of summary.passes) {
  console.log(JSON.stringify({ locale: p.locale, routes: p.routes, controls: p.controls, verdicts: p.verdicts, load_ms: p.load_ms, overflow: p.pages_with_overflow, no_main: p.pages_without_main, load_errors: p.pages_with_load_errors.length, no_name: p.no_name.length, outside_x: p.outside_x.length, occluded: p.occluded.length, clipped: p.clipped.length, small_target: p.small_target, no_effect: p.no_effect.length, errors: p.errors.length, stuck: p.stuck_overlays.length, disabled_no_reason: p.disabled_without_reason.length }));
}
if (summary.fatal) console.log("FATAL", summary.fatal);
