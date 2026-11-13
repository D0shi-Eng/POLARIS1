// تشغيل مجموعات اختبار Phase-01 وجمع أعدادها الحقيقية.
//
// «حقيقية» تعني مقروءة من مخرَج المشغّل نفسه لا من نيّة الأداة: عدد ناجح مكتوب
// بيد ليس قياسًا. ولذلك يُحلَّل TAP من `node --test` وسطرُ النتيجة من `cargo
// test`، ومجموعة لا يُفهَم مخرَجها تُصنَّف INCONCLUSIVE ولا تُقرَّب إلى نجاح.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertWrittenEvidence, isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, evidenceSuffix, isCanonicalRun, P01_GROUPS, P01_TOOLS, stamp } from "./p01-groups.mjs";

const SCHEMA_VERSION = "1.0.0";

/** أعداد مجموعة واحدة. `null` يعني «لم يُقرأ»، وهو مختلف عن صفر. */
function emptyCounts() {
  return { tests: null, passed: null, failed: null, skipped: null, todo: null, cancelled: null };
}

/**
 * يقرأ ملخّص `node --test`، بشكلَي TAP ("# tests 16") وspec ("ℹ tests 16")،
 * وبنهايات أسطر LF وCRLF.
 *
 * العيب الذي أغلقه هذا (P01_TEST_SUMMARY_NOT_PARSED_ON_WINDOWS): الأمر كان
 * `node --test <file> --test-reporter=tap`، والخيار بعد الملف لا يُقرأ خيارًا بل
 * وسيطًا للبرنامج. على لينكس نجح بالمصادفة لأن مُبلِّغ Node 22 الافتراضي خارج
 * الطرفية هو TAP؛ على ويندوز Node 24 يطبع spec، فبقيت كل مجموعات Node بلا أعداد.
 * الإصلاح طبقتان كما في W5: الخيار يُوضع قبل الملفات، والقارئ يفهم الشكلين.
 * لا يُقرَّب شيء: سطر غائب يبقى `null`.
 */
export function parseTapSummary(output) {
  const counts = emptyCounts();
  const text = output.replace(/\r\n?/g, "\n");
  const read = (label) => {
    const match = new RegExp(`^(?:#|\u2139)[ \\t]+${label}[ \\t]+(\\d+)[ \\t]*$`, "m").exec(text);
    return match === null ? null : Number(match[1]);
  };
  counts.tests = read("tests");
  counts.passed = read("pass");
  counts.failed = read("fail");
  counts.skipped = read("skipped");
  counts.todo = read("todo");
  counts.cancelled = read("cancelled");
  return counts;
}

/**
 * يبني أمر مجموعة Node: الملف التنفيذي نفسه (`process.execPath`) بلا صدفة،
 * والمُبلِّغ مفروض قبل الملفات. بلا صدفة لا تحذير DEP0190، ولا اعتماد على PATH.
 */
export function nodeInvocation(group, execPath = process.execPath) {
  const [, ...rest] = group.command;
  const flags = rest.filter((part) => part.startsWith("--"));
  const files = rest.filter((part) => !part.startsWith("--"));
  return {
    command: execPath,
    args: [...flags, "--test-reporter=tap", "--test-reporter-destination=stdout", ...files],
  };
}

/** بيئة الابن: NODE_TEST_CONTEXT يُحذف، فوجوده يجعل `node --test` يتخطّى الملفات. */
export function childEnvironment(base = process.env, extra = {}) {
  const env = { ...base, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** يقرأ سطر النتيجة الذي يطبعه `cargo test`، ويجمع كل الأهداف. */
export function parseCargoSummary(output) {
  const counts = emptyCounts();
  const pattern = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g;
  let seen = 0;
  let passed = 0;
  let failed = 0;
  let ignored = 0;
  for (const match of output.matchAll(pattern)) {
    seen += 1;
    passed += Number(match[2]);
    failed += Number(match[3]);
    ignored += Number(match[4]);
  }
  if (seen === 0) return counts;
  counts.passed = passed;
  counts.failed = failed;
  counts.skipped = ignored;
  counts.tests = passed + failed + ignored;
  counts.todo = 0;
  counts.cancelled = 0;
  return counts;
}

function verdictFor(group, counts, exitCode, skipped) {
  if (skipped) return { verdict: "NOT_TESTED", reason: `LANE_NOT_AVAILABLE_${group.lane.toUpperCase()}` };
  if (counts.tests === null) return { verdict: "INCONCLUSIVE", reason: "OUTPUT_NOT_PARSED" };
  if (counts.failed !== null && counts.failed > 0) return { verdict: "FAIL", reason: "TESTS_FAILED" };
  if (exitCode !== 0) return { verdict: "FAIL", reason: `NON_ZERO_EXIT_${exitCode}` };
  if (counts.tests === 0) return { verdict: "INCONCLUSIVE", reason: "NO_TEST_RAN" };
  if (counts.skipped !== null && counts.skipped > 0) return { verdict: "INCONCLUSIVE", reason: "UNEXPLAINED_SKIP" };
  return { verdict: "PASS", reason: "" };
}

function runGroup(root, group, options) {
  const windowsLane = group.lane === "windows";
  const skipped = windowsLane && process.platform !== "win32";
  const probe = group.kind === "probe";

  if (skipped || probe) {
    return {
      group_id: group.id,
      title: group.title,
      lane: group.lane,
      kind: group.kind,
      command: group.command.join(" "),
      counts: emptyCounts(),
      duration_ms: 0,
      exit_code: null,
      ...verdictFor(group, emptyCounts(), null, true),
      evidence_complete: false,
      note: probe
        ? "measured by the native runner stage, not by this tool; its result is read from the probe document"
        : "this lane needs native Windows and this host is not Windows",
    };
  }

  const started = Date.now();
  if (group.kind !== "node" && group.kind !== "cargo") throw new Error(`UNSUPPORTED_GROUP_KIND ${group.kind} (${group.id})`);
  // cargo.exe ملف تنفيذي حقيقي فلا يحتاج صدفة؛ وNode يُستدعى بمساره المطلق.
  const { command, args } = group.kind === "node" ? nodeInvocation(group) : { command: group.command[0], args: group.command.slice(1) };
  const result = spawnSync(command, args, {
    cwd: join(root, group.cwd),
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: childEnvironment(process.env, options.env ?? {}),
  });
  if (result.error) {
    return {
      group_id: group.id, title: group.title, lane: group.lane, kind: group.kind,
      command: [command, ...args].join(" "), counts: emptyCounts(), duration_ms: Date.now() - started,
      exit_code: null, verdict: "BLOCKED", reason: `SPAWN_FAILED_${result.error.code ?? "UNKNOWN"}`,
      evidence_complete: false, output_tail: String(result.error.message),
    };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const counts = group.kind === "cargo" ? parseCargoSummary(output) : parseTapSummary(output);
  const derived = verdictFor(group, counts, result.status, false);

  return {
    group_id: group.id,
    title: group.title,
    lane: group.lane,
    kind: group.kind,
    command: [command, ...args].join(" "),
    counts,
    duration_ms: Date.now() - started,
    exit_code: result.status,
    ...derived,
    evidence_complete: counts.tests !== null,
    ...(derived.verdict === "PASS" ? {} : { output_tail: output.trim().split("\n").slice(-25).join("\n") }),
  };
}

export function runAll(root, options = {}) {
  return P01_GROUPS.map((group) => runGroup(root, group, options));
}

export function summarise(groups) {
  const counted = groups.filter((group) => group.counts.tests !== null);
  return {
    declared: groups.length,
    measured: counted.length,
    passed_groups: groups.filter((group) => group.verdict === "PASS").length,
    failed_groups: groups.filter((group) => group.verdict === "FAIL").length,
    not_tested_groups: groups.filter((group) => group.verdict === "NOT_TESTED").length,
    blocked_groups: groups.filter((group) => group.verdict === "BLOCKED").length,
    inconclusive_groups: groups.filter((group) => group.verdict === "INCONCLUSIVE").length,
    tests: counted.reduce((total, group) => total + (group.counts.tests ?? 0), 0),
    passed: counted.reduce((total, group) => total + (group.counts.passed ?? 0), 0),
    failed: counted.reduce((total, group) => total + (group.counts.failed ?? 0), 0),
    skipped: counted.reduce((total, group) => total + (group.counts.skipped ?? 0), 0),
    todo: counted.reduce((total, group) => total + (group.counts.todo ?? 0), 0),
    cancelled: counted.reduce((total, group) => total + (group.counts.cancelled ?? 0), 0),
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const suffix = evidenceSuffix();
  const startedAt = stamp();
  const groups = runAll(root);
  const summary = summarise(groups);

  const document = {
    schema_version: SCHEMA_VERSION,
    tool: P01_TOOLS.testGroups,
    phase: "PHASE-01",
    canonical: isCanonicalRun(),
    platform: process.platform,
    native: process.platform === "win32",
    node_version: process.version,
    run_started: startedAt,
    measured_at: stamp(),
    repository_root: root,
    groups,
    summary,
    evidence_complete: groups.every((group) => group.evidence_complete || group.kind === "probe" || group.lane === "windows"),
    verdict:
      summary.failed_groups > 0
        ? "FAIL"
        : summary.not_tested_groups > 0 || summary.inconclusive_groups > 0 || summary.blocked_groups > 0
          ? "INCONCLUSIVE"
          : "PASS",
    reason_codes: groups.filter((group) => group.verdict === "FAIL").map((group) => `${group.group_id}_FAILED`),
  };

  const evidenceDirectory = join(root, "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const path = join(evidenceDirectory, `phase-01-test-groups${suffix}.json`);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  assertWrittenEvidence(path);

  for (const group of groups) {
    const counts = group.counts.tests === null ? "not measured" : `${group.counts.passed}/${group.counts.tests}`;
    console.log(`${group.verdict.padEnd(12)} ${group.group_id.padEnd(22)} ${counts}`);
  }
  console.log(`wrote ${path}`);
  process.exitCode = summary.failed_groups === 0 && summary.blocked_groups === 0 ? 0 : 1;
}
