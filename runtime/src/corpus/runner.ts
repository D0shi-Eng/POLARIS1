// مشغّل مجموعة الـ20 مهمة تحت W4.
//
// القاعدة الحاكمة: لا يُكتب رقم لم يخرج من تشغيل حقيقي. المهام غير القابلة
// للتنفيذ تُصنَّف كذلك ولا تُعدّ نجاحًا ولا فشلًا، ولا تدخل في حساب العبء.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ConfigService } from "../config/service.js";
import type { EffectAction } from "../effects.js";
import { newId, nowTimestamp } from "../ids.js";
import { ProgrammableModel } from "../model/fixture-model.js";
import type { ModelRequest } from "../model/model-port.js";
import type { MountTable } from "../platform/mount-table.js";
import { LocalPdp } from "../policy/pdp.js";
import { POLICY_EPOCH, POLICY_SET_VERSION, type Doc } from "../policy/types.js";
import { PolarisRuntime, agentCallerIdentity } from "../runtime.js";
import type { Mission } from "../agent/types.js";
import { MANIFEST_SCHEMA, PLANS, ROOT, ROOT_FORWARD, type ExecutionClass, type MissionPlan } from "./plan.js";

export interface CorpusWorkspace {
  readonly host: string;
  readonly logical: string;
  readonly mounts: MountTable;
  hostPath(...segments: readonly string[]): string;
  dispose(): void;
}

export type WorkspaceFactory = () => CorpusWorkspace;

interface CorpusMissionRecord {
  mission_id: string;
  title: string;
  category: string;
  inputs: Array<{ source: string; expected_trust: string; expected_taint: string[] }>;
  candidate_declassifier: string;
  expected_action_effects: string[];
  expected_approval_need: string;
  expected_policy_outcome: string;
  w4_probe: string;
}

export interface DeclassificationRecordSummary {
  readonly method: "D1" | "D2";
  readonly action: string;
  readonly succeeded: boolean;
  readonly failure_code?: string;
}

export type ManualIntervention = "NONE" | "WOULD_REQUIRE_APPROVAL" | "UNRESOLVED" | "NOT_APPLICABLE";

export interface MissionMeasurement {
  readonly mission_id: string;
  readonly title: string;
  readonly category: string;
  readonly execution_class: ExecutionClass;
  readonly not_executable_reason?: string;
  readonly source_types: readonly string[];
  readonly input_taint: readonly string[];
  readonly candidate_declassifier: string;
  readonly w4_probe: string;
  readonly declassification_steps: readonly DeclassificationRecordSummary[];
  readonly declassification_attempts: number;
  readonly d1_attempts: number;
  readonly d1_successes: number;
  readonly d1_failures: number;
  readonly d2_attempts: number;
  readonly d2_successes: number;
  readonly d2_failures: number;
  readonly policy_result: "ALLOW" | "DENY" | "NOT_EVALUATED";
  readonly reason_codes: readonly string[];
  readonly denied_layer?: string;
  readonly error_code?: string;
  readonly tool_calls: number;
  readonly effects_executed: number;
  readonly corpus_expected_outcome: string;
  readonly matches_corpus_expectation: boolean | null;
  readonly expected_approval_need: string;
  readonly manual_intervention: ManualIntervention;
  readonly evidence: readonly string[];
}

export interface BurdenMetrics {
  readonly population: string;
  readonly missions: number;
  readonly declassification_attempts_total: number;
  readonly mean_per_mission: number;
  readonly p50: number;
  readonly p95: number;
  readonly missions_with_zero: number;
  readonly missions_with_one: number;
  readonly missions_with_two_or_more: number;
  readonly policy_denial_rate: number;
  readonly unresolved_rate: number;
}

export interface CorpusReport {
  readonly corpus_id: string;
  readonly corpus_version: string;
  readonly measured_at: string;
  readonly platform: string;
  readonly native_windows_semantics: boolean;
  readonly missions_total: number;
  readonly executed_full_loop: number;
  readonly executed_policy_only: number;
  readonly not_executable_in_w4: number;
  readonly declassification_attempts: number;
  readonly d1_attempts: number;
  readonly d1_successes: number;
  readonly d1_failures: number;
  readonly d2_attempts: number;
  readonly d2_successes: number;
  readonly d2_failures: number;
  readonly policy_denials: number;
  readonly approvals_that_would_be_required: number;
  readonly manual_interventions_required: number;
  readonly unresolved_cases: number;
  readonly metrics: readonly BurdenMetrics[];
  readonly missions: readonly MissionMeasurement[];
  readonly caveats: readonly string[];
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] as number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function expand(template: string, root: string): string {
  const forward = root.split(String.fromCharCode(92)).join('/');
  return template.split(ROOT_FORWARD).join(forward).split(ROOT).join(root);
}

function materialiseFixtures(workspace: CorpusWorkspace, fixtures: Readonly<Record<string, string>> | undefined): void {
  for (const [relative, body] of Object.entries(fixtures ?? {})) {
    const target = workspace.hostPath(...relative.split("\\"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, expand(body, workspace.logical), "utf8");
  }
}

/** استدعاء شبكي للتقييم فقط. لا قدرة شبكية في W4، فلا تنفيذ ولا ادعاء تنفيذ. */
function networkDocuments(host: string, port: number, action: EffectAction, taint: readonly string[]): { invocation: Doc; descriptor: Doc } {
  const destination = { host, port, protocol: "HTTPS" };
  const constraints = {
    confinement: "CONFINED",
    filesystem_scope: "NONE",
    process_tree: "CONFINED_KILL_ON_CLOSE",
    network: "BROKERED_EGRESS",
    handle_inheritance: "EXPLICIT_ONLY",
    environment: "EXPLICIT_ONLY",
    allowed_destinations: [{ ...destination }],
    max_wall_clock_ms: 10000,
  };
  return {
    invocation: {
      contract_version: "1.0",
      invocation_id: newId(),
      correlation_id: newId(),
      causation_id: newId(),
      idempotency_key: `polaris.net.corpus:${newId()}`,
      mission_id: newId(),
      agent_id: newId(),
      caller_identity: agentCallerIdentity(),
      capability_id: "polaris.net.transfer",
      capability_version: "0.1.0",
      requested_effects: [{ action, destination: { ...destination }, data_classification: "INTERNAL" }],
      arguments: { url: `https://${host}/resource` },
      taint_labels: [...taint],
      attempt: 1,
      execution_constraints: constraints,
      policy_ref: { policy_version: POLICY_SET_VERSION, policy_epoch: POLICY_EPOCH },
      created_at: nowTimestamp(),
    },
    descriptor: {
      contract_version: "1.0",
      capability_id: "polaris.net.transfer",
      capability_version: "0.1.0",
      display_name: "Transfer a document",
      source: { origin: "BUILT_IN", publisher_id: "polaris.core" },
      input_schema_ref: "capabilities/net/transfer.input.v1.json",
      output_schema_ref: "capabilities/net/transfer.output.v1.json",
      effect_declaration_semantics: "REQUESTED_PRIVILEGE",
      requested_effects: [{ action, destination: { ...destination }, data_classification: "INTERNAL" }],
      risk_class: "HIGH",
      execution_requirements: constraints,
      idempotency: { semantics: "AT_LEAST_ONCE", retry_safe: false, key_derivation: "ARGUMENT_DIGEST" },
      platform_requirements: ["ANY"],
      provenance: { signed: false },
    },
  };
}

function interventionFor(
  policyResult: "ALLOW" | "DENY" | "NOT_EVALUATED",
  expected: string,
  candidateDeclassifier: string,
): ManualIntervention {
  if (policyResult === "NOT_EVALUATED") return "NOT_APPLICABLE";
  if (policyResult === expected) return "NONE";
  if (policyResult === "ALLOW") return "NONE";
  // رُفض بينما تتوقع المجموعة سماحًا: لا يوجد تدفق موافقة في W4، فهذا تصنيف
  // متوقَّع من السياسة فقط، ولا يُدّعى أن موافقة وقعت.
  return candidateDeclassifier === "NONE_AVAILABLE" ? "UNRESOLVED" : "WOULD_REQUIRE_APPROVAL";
}

export interface RunCorpusOptions {
  readonly corpusPath: string;
  readonly makeWorkspace: WorkspaceFactory;
}

export async function runCorpus(options: RunCorpusOptions): Promise<CorpusReport> {
  const corpus = JSON.parse(readFileSync(join(options.corpusPath, "missions.json"), "utf8")) as {
    corpus_id: string;
    corpus_version: string;
    missions: CorpusMissionRecord[];
  };

  const measurements: MissionMeasurement[] = [];
  let nativeWindows = process.platform === "win32";

  for (const mission of corpus.missions) {
    const plan = PLANS[mission.mission_id];
    if (plan === undefined) throw new Error(`no W4 plan for ${mission.mission_id}`);
    const measurement = await measure(mission, plan, options.makeWorkspace);
    measurements.push(measurement);
  }

  const fullLoop = measurements.filter((m) => m.execution_class === "FULL_LOOP");
  const executed = measurements.filter((m) => m.execution_class !== "NOT_EXECUTABLE_IN_W4");
  const notExecutable = measurements.filter((m) => m.execution_class === "NOT_EXECUTABLE_IN_W4");

  const metricsFor = (population: string, group: readonly MissionMeasurement[]): BurdenMetrics => {
    const counts = group.map((m) => m.declassification_attempts);
    const total = counts.reduce((sum, value) => sum + value, 0);
    const denials = group.filter((m) => m.policy_result === "DENY").length;
    const unresolved = group.filter((m) => m.manual_intervention === "UNRESOLVED").length;
    return {
      population,
      missions: group.length,
      declassification_attempts_total: total,
      mean_per_mission: group.length === 0 ? 0 : round(total / group.length),
      p50: percentile(counts, 0.5),
      p95: percentile(counts, 0.95),
      missions_with_zero: counts.filter((c) => c === 0).length,
      missions_with_one: counts.filter((c) => c === 1).length,
      missions_with_two_or_more: counts.filter((c) => c >= 2).length,
      policy_denial_rate: group.length === 0 ? 0 : round(denials / group.length),
      unresolved_rate: group.length === 0 ? 0 : round(unresolved / group.length),
    };
  };

  const sum = (pick: (m: MissionMeasurement) => number): number => measurements.reduce((total, m) => total + pick(m), 0);
  nativeWindows = process.platform === "win32";

  return {
    corpus_id: corpus.corpus_id,
    corpus_version: corpus.corpus_version,
    measured_at: nowTimestamp(),
    platform: process.platform,
    native_windows_semantics: nativeWindows,
    missions_total: measurements.length,
    executed_full_loop: fullLoop.length,
    executed_policy_only: measurements.filter((m) => m.execution_class === "POLICY_ONLY").length,
    not_executable_in_w4: notExecutable.length,
    declassification_attempts: sum((m) => m.declassification_attempts),
    d1_attempts: sum((m) => m.d1_attempts),
    d1_successes: sum((m) => m.d1_successes),
    d1_failures: sum((m) => m.d1_failures),
    d2_attempts: sum((m) => m.d2_attempts),
    d2_successes: sum((m) => m.d2_successes),
    d2_failures: sum((m) => m.d2_failures),
    policy_denials: measurements.filter((m) => m.policy_result === "DENY").length,
    approvals_that_would_be_required: measurements.filter((m) => m.manual_intervention === "WOULD_REQUIRE_APPROVAL").length,
    manual_interventions_required: measurements.filter(
      (m) => m.manual_intervention === "WOULD_REQUIRE_APPROVAL" || m.manual_intervention === "UNRESOLVED",
    ).length,
    unresolved_cases: measurements.filter((m) => m.manual_intervention === "UNRESOLVED").length,
    metrics: [metricsFor("FULL_LOOP", fullLoop), metricsFor("EXECUTED (FULL_LOOP + POLICY_ONLY)", executed)],
    missions: measurements,
    caveats: [
      "No approval flow exists in W4. Every 'would require approval' value is an expectation derived from a real policy decision, never an observed approval.",
      "Missions classed NOT_EXECUTABLE_IN_W4 are excluded from every metric. They are neither successes nor failures.",
      "Network missions were decided but never executed: W4 has no egress enforcement point, so no network side effect is possible.",
      process.platform === "win32"
        ? "Path canonicalisation ran with native Windows semantics."
        : "Path canonicalisation ran on a non-Windows host. Windows link, casing and reserved-name semantics are NOT proven by this run.",
    ],
  };
}

async function measure(
  mission: CorpusMissionRecord,
  plan: MissionPlan,
  makeWorkspace: WorkspaceFactory,
): Promise<MissionMeasurement> {
  const base = {
    mission_id: mission.mission_id,
    title: mission.title,
    category: mission.category,
    source_types: mission.inputs.map((i) => i.source),
    input_taint: [...new Set(mission.inputs.flatMap((i) => i.expected_taint))],
    candidate_declassifier: mission.candidate_declassifier,
    w4_probe: mission.w4_probe,
    corpus_expected_outcome: mission.expected_policy_outcome,
    expected_approval_need: mission.expected_approval_need,
  };

  if (plan.execution_class === "NOT_EXECUTABLE_IN_W4") {
    return {
      ...base,
      execution_class: "NOT_EXECUTABLE_IN_W4",
      not_executable_reason: plan.reason,
      declassification_steps: [],
      declassification_attempts: 0,
      d1_attempts: 0,
      d1_successes: 0,
      d1_failures: 0,
      d2_attempts: 0,
      d2_successes: 0,
      d2_failures: 0,
      policy_result: "NOT_EVALUATED",
      reason_codes: [],
      tool_calls: 0,
      effects_executed: 0,
      matches_corpus_expectation: null,
      manual_intervention: "NOT_APPLICABLE",
      evidence: [plan.reason],
    };
  }

  if (plan.execution_class === "POLICY_ONLY") {
    const config = new ConfigService();
    const applied = config.apply({
      changeset_id: `corpus-${mission.mission_id}`,
      origin: "CORE",
      changes: [
        { key: "polaris.network.brokered_egress.enabled", scope: "USER", value: plan.brokered_enabled },
        { key: "polaris.network.brokered_egress.allowed_destinations", scope: "USER", value: [...plan.allowed_destinations] },
      ] as never,
    });
    if (!applied.applied) throw new Error(`corpus config failed for ${mission.mission_id}`);

    const { invocation, descriptor } = networkDocuments(plan.host, plan.port, plan.action, plan.taint);
    const outcome = new LocalPdp(config).decide({ invocation, descriptor });
    const result = outcome.decision["result"] === "ALLOW" ? "ALLOW" : "DENY";
    const reasons = (outcome.decision["reason_codes"] as string[]) ?? [];

    return {
      ...base,
      execution_class: "POLICY_ONLY",
      not_executable_reason: plan.reason,
      declassification_steps: [],
      declassification_attempts: 0,
      d1_attempts: 0,
      d1_successes: 0,
      d1_failures: 0,
      d2_attempts: 0,
      d2_successes: 0,
      d2_failures: 0,
      policy_result: result,
      reason_codes: reasons,
      tool_calls: 0,
      effects_executed: 0,
      matches_corpus_expectation: result === mission.expected_policy_outcome,
      manual_intervention: interventionFor(result, mission.expected_policy_outcome, mission.candidate_declassifier),
      evidence: [
        `decision ${String(outcome.decision["decision_id"])}`,
        `reasons ${reasons.join(", ")}`,
        `no egress enforcement point exists: the effect was decided, never executed`,
      ],
    };
  }

  // FULL_LOOP: تشغيل حقيقي عبر حلقة الوكيل، بأثر حقيقي على قرص حقيقي.
  const workspace = makeWorkspace();
  try {
    materialiseFixtures(workspace, plan.fixtures);
    const root = workspace.logical;
    const resolvePath = (proposal: (typeof plan.proposals)[number]): string =>
      proposal.absolute === true ? proposal.path : `${root}\\${proposal.path}`;

    const config = new ConfigService();
    const writeRoots = (plan.config_write_roots ?? []).map((r) => expand(r, root));
    const applied = config.apply({
      changeset_id: `corpus-${mission.mission_id}`,
      origin: "CORE",
      changes: [
        { key: "polaris.filesystem.allowed_read_roots", scope: "USER", value: (plan.config_read_roots ?? [ROOT]).map((r) => expand(r, root)) },
        { key: "polaris.filesystem.allowed_write_roots", scope: "USER", value: writeRoots },
        { key: "polaris.filesystem.allow_write", scope: "USER", value: writeRoots.length > 0 },
      ] as never,
    });
    if (!applied.applied) throw new Error(`corpus config failed for ${mission.mission_id}`);

    let cursor = 0;
    const model = new ProgrammableModel((request: ModelRequest): string => {
      const done = request.blocks.filter((b) => b.label.startsWith("TOOL RESULT")).length;
      cursor = done;
      const proposal = plan.proposals[done];
      if (proposal === undefined) return JSON.stringify({ action: "finish", summary: `completed ${mission.mission_id}` });
      const path = resolvePath(proposal);
      return JSON.stringify({
        action: "invoke_tool",
        capability_id: proposal.capability_id,
        arguments: proposal.content === undefined ? { path } : { path, content: proposal.content },
      });
    });

    const runtime = new PolarisRuntime({
      config,
      mounts: workspace.mounts,
      model,
      working_directory: workspace.host,
      extraction_schemas: [MANIFEST_SCHEMA],
    });

    const missionId = newId();
    runtime.authorize(missionId, {
      authorized_read_roots: plan.authorized_read_roots.map((r) => expand(r, root)),
      authorized_write_roots: plan.authorized_write_roots.map((r) => expand(r, root)),
      ...(plan.user_supplied_values === undefined
        ? {}
        : { user_supplied_values: plan.user_supplied_values.map((v) => (v.includes(":") ? v : `${root}\\${v}`)) }),
    });

    const agentMission: Mission = {
      mission_id: missionId,
      title: mission.title,
      instruction: mission.title,
      correlation_id: newId(),
      agent_id: newId(),
      caller_identity: agentCallerIdentity(),
      ...(plan.extraction === undefined ? {} : { extraction: plan.extraction }),
    };

    const result = await runtime.runMission(agentMission);
    const steps = result.steps.flatMap((s) => s.declassifications);
    const d1 = steps.filter((s) => s.method === "D1");
    const d2 = steps.filter((s) => s.method === "D2");
    const failed = result.steps.find((s) => s.gateway_ok === false);
    const policyResult: "ALLOW" | "DENY" =
      failed !== undefined && failed.error_layer === "PDP" ? "DENY" : result.status === "COMPLETED" ? "ALLOW" : "DENY";
    const executedEffects = result.steps.filter((s) => s.gateway_ok === true).length;

    const evidence = [
      `termination ${result.termination}`,
      `tool calls ${String(result.budget.tool_calls)}`,
      `proposals consumed ${String(cursor + 1)}`,
      ...result.steps
        .filter((s) => s.reason_codes !== undefined)
        .map((s) => `denied at ${s.error_layer ?? "?"} because ${(s.reason_codes ?? []).join(", ")}`),
      ...steps.map((s) => `${s.method} ${s.action} ${s.succeeded ? "OK" : `FAILED ${s.failure_code ?? ""}`}`),
    ];

    return {
      ...base,
      execution_class: "FULL_LOOP",
      declassification_steps: steps.map((s) => ({
        method: s.method,
        action: s.action,
        succeeded: s.succeeded,
        ...(s.failure_code === undefined ? {} : { failure_code: s.failure_code }),
      })),
      declassification_attempts: steps.length,
      d1_attempts: d1.length,
      d1_successes: d1.filter((s) => s.succeeded).length,
      d1_failures: d1.filter((s) => !s.succeeded).length,
      d2_attempts: d2.length,
      d2_successes: d2.filter((s) => s.succeeded).length,
      d2_failures: d2.filter((s) => !s.succeeded).length,
      policy_result: policyResult,
      reason_codes: failed?.reason_codes ?? [],
      ...(failed?.error_layer === undefined ? {} : { denied_layer: failed.error_layer }),
      ...(failed?.error_code === undefined ? {} : { error_code: failed.error_code }),
      tool_calls: result.budget.tool_calls,
      effects_executed: executedEffects,
      matches_corpus_expectation: policyResult === mission.expected_policy_outcome,
      manual_intervention: interventionFor(policyResult, mission.expected_policy_outcome, mission.candidate_declassifier),
      evidence,
    };
  } finally {
    workspace.dispose();
  }
}
