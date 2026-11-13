// خلاصة الحقائق للتقرير النهائي، مقروءة من الأدلة القانونية وحدها.
//
// التقرير يُكتب بيد، لكن أرقامه لا تُكتب بيد: هذه الأداة تطبع ما تقوله الوثائق
// فعلًا — الأحكام، والأعداد، والسيناريوهات، والقياسات — فلا يدخل التقرير رقم
// بلا مصدر. تشغيلها لا يكتب دليلًا ولا يغيّر حكمًا.
//
// الاستعمال: node p02-report-facts.mjs --root <root> [--json]

import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, P02_EVIDENCE, P02_FINAL_GATE, readJson } from "./p02-common.mjs";

export function collect(root) {
  const suffix = evidenceSuffix();
  const read = (base) => readJson(join(root, "evidence", `${base}${suffix}.json`)) ?? readJson(join(root, "evidence", `${base}.json`));
  const documents = Object.fromEntries([...P02_EVIDENCE, P02_FINAL_GATE].map((base) => [base, read(base)]));
  const run = documents["phase-02-run"];
  const gate = documents[P02_FINAL_GATE];
  const e2e = documents["phase-02-native-e2e"];
  const security = documents["phase-02-security"];
  const providers = documents["phase-02-providers"];
  const performance = documents["phase-02-performance"];
  const regression = documents["phase-02-regression"];

  return {
    environment: run?.environment ?? null,
    run_started: run?.run_started ?? null,
    stages: (run?.stages ?? []).map((stage) => ({ name: stage.name, exit_code: stage.exit_code, duration_ms: stage.duration_ms })),
    builds: run?.builds ?? null,
    groups: (run?.test_groups ?? []).map((group) => ({
      id: group.group_id,
      verdict: group.verdict,
      tests: group.counts?.tests ?? null,
      passed: group.counts?.passed ?? null,
      failed: group.counts?.failed ?? null,
      skipped: group.counts?.skipped ?? null,
      seconds: group.duration_ms === undefined ? null : Math.round(group.duration_ms / 100) / 10,
    })),
    totals: run?.test_totals ?? null,
    dogfood: run?.dogfood ?? null,
    conditions: (gate?.conditions ?? []).map((row) => ({ id: row.claim_id, verdict: row.verdict, reason: row.reason_code })),
    verdict: gate?.verdict ?? null,
    phase_03_gate: gate?.phase_03_gate ?? null,
    gate_summary: gate?.summary ?? null,
    evidence_secret_rescan: gate?.evidence_secret_rescan ?? null,
    scenarios: (e2e?.scenarios ?? []).map((row) => ({ id: row.scenario_id, verdict: row.verdict, detail: row.detail })),
    optional_live: e2e?.optional_live ?? null,
    launches: { first: e2e?.first_launch ?? null, restart: e2e?.restart_launch ?? null },
    providers_seen: (providers?.provider_list_snapshot?.providers ?? []).map((provider) => ({
      id: provider.provider_id,
      locality: provider.locality,
      enabled: provider.enabled,
      health: `${provider.health?.state ?? "?"}/${provider.health?.reason_code ?? "?"}`,
      installation: provider.health?.installation ?? null,
      models: provider.models ?? null,
      key: provider.key_status?.source ?? null,
    })),
    local_discovery: providers?.local_discovery_through_the_host ?? null,
    live_providers: providers?.optional_live_local_providers ?? null,
    live_invocation: providers?.optional_live_invocation ?? null,
    supply_chain: security?.supply_chain ?? [],
    static_checks: (security?.static_checks ?? []).map((check) => ({ id: check.check_id, verdict: check.verdict })),
    evidence_scan: (security?.evidence_scan ?? []).map((check) => ({ id: check.check_id, verdict: check.verdict, detail: check.detail })),
    fixture_requests: security?.fixture_requests ?? [],
    measurements: performance?.measurements ?? [],
    regression: {
      phase_00: regression?.phase_00_gate ?? null,
      phase_01: regression?.phase_01_gate ?? null,
      runner_exit: regression?.phase_01_runner_exit ?? null,
    },
    documents: Object.fromEntries(Object.entries(documents).map(([name, document]) => [name, document === null ? "ABSENT" : (document.verdict ?? "n/a")])),
  };
}

function line(label, value) {
  return `${String(label).padEnd(34)} ${value}`;
}

export function print(facts) {
  const out = [];
  out.push("== run ==");
  out.push(line("started", facts.run_started ?? "?"));
  for (const [key, value] of Object.entries(facts.environment ?? {})) out.push(line(key, String(value)));
  out.push("", "== stages ==");
  for (const stage of facts.stages) out.push(line(stage.name, `exit ${stage.exit_code} (${Math.round((stage.duration_ms ?? 0) / 1000)}s)`));
  out.push("", "== groups ==");
  for (const group of facts.groups) out.push(line(group.id, `${group.verdict} ${group.passed ?? "?"}/${group.tests ?? "?"} passed, ${group.skipped ?? "?"} skipped, ${group.seconds ?? "?"}s`));
  out.push(line("TOTAL", JSON.stringify(facts.totals)));
  out.push("", "== native scenarios ==");
  for (const scenario of facts.scenarios) out.push(line(scenario.id, `${scenario.verdict}  ${String(scenario.detail ?? "").slice(0, 120)}`));
  out.push(line("LIVE-01", JSON.stringify(facts.optional_live)));
  out.push("", "== providers as the host saw them ==");
  for (const provider of facts.providers_seen) out.push(line(provider.id, `${provider.locality} enabled=${provider.enabled} ${provider.health} models=${JSON.stringify(provider.models)} key=${provider.key}`));
  out.push(line("local discovery", JSON.stringify(facts.local_discovery)));
  out.push(line("live servers", JSON.stringify(facts.live_providers)));
  out.push(line("live invocation", JSON.stringify(facts.live_invocation)));
  out.push("", "== performance ==");
  for (const measurement of facts.measurements) out.push(line(measurement.metric, `${measurement.value ?? "UNKNOWN"} ${measurement.unit ?? ""} (${measurement.provenance})`));
  out.push("", "== security ==");
  for (const check of facts.static_checks) out.push(line(check.id, check.verdict));
  for (const check of facts.evidence_scan) out.push(line(check.id, `${check.verdict} ${check.detail ?? ""}`));
  out.push(line("evidence rescan at the gate", String(facts.evidence_secret_rescan)));
  out.push(line("fixture requests", `${facts.fixture_requests.length} recorded`));
  out.push("", "== regression ==");
  out.push(line("phase-00", JSON.stringify(facts.regression.phase_00)));
  out.push(line("phase-01", JSON.stringify(facts.regression.phase_01)));
  out.push("", "== conditions ==");
  for (const condition of facts.conditions) out.push(line(condition.id, `${condition.verdict} ${String(condition.reason ?? "").slice(0, 150)}`));
  out.push("", line("PHASE-02", String(facts.verdict)));
  out.push(line("PHASE-03 GATE", String(facts.phase_03_gate)));
  return out.join("\n");
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const facts = collect(root);
  console.log(process.argv.includes("--json") ? JSON.stringify(facts, null, 2) : print(facts));
}
