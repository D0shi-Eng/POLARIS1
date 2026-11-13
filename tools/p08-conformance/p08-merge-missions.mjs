// إعادة قياس مهامّ بعينها من معيار النموذج الحقيقي، دون إعادة التشغيل كله (قرار المالك 2026-09-30:
// بعد الفشل يُعاد قياس الجزء الفاشل وحده). تُستبدل صفوف المهامّ المسمّاة فقط بقياس جديد كامل لها
// (مهمّة جديدة بالنموذج نفسه ومعايير القبول نفسها)، ويُحفظ القياس السابق في superseded، ولا يُخفى شيء.
//
// الاستعمال: node p08-merge-missions.mjs --root <root> --from <remeasure-out-dir> --tasks A,B [--reason <text>]

import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, RAW_DIRECTORY, readJson, stamp, writeEvidence } from "./p08-common.mjs";

const STATUSES = ["PASS", "FAIL", "PARTIAL", "BLOCKED", "NOT_TESTED"];

/** دمج نقيّ: يرمي عند أي خرق بدل أن يدمج دمجًا ملتبسًا. */
export function mergeMissions(previous, remeasured, tasks, meta = {}) {
  if (!previous?.extra?.tasks || !Array.isArray(previous.checks)) throw new Error("MERGE_NO_PREVIOUS: the previous missions record is absent or unreadable");
  if (!remeasured?.extra?.tasks || !Array.isArray(remeasured.checks)) throw new Error("MERGE_NO_REMEASURED: the re-measured missions record is absent or unreadable");
  if (tasks.length === 0) throw new Error("MERGE_NO_TASKS: name the tasks to re-measure");
  // النموذج نفسه شرط: قياس بنموذج آخر لا يحلّ محلّ قياس هذا التشغيل
  if (previous.extra.model_id !== remeasured.extra.model_id) throw new Error(`MERGE_MODEL_MISMATCH: ${previous.extra.model_id} vs ${remeasured.extra.model_id}`);
  const rows = previous.extra.tasks.map((r) => ({ ...r }));
  const checks = previous.checks.map((c) => ({ ...c }));
  const superseded = [...(previous.extra.superseded ?? [])];
  for (const id of tasks) {
    const at = rows.findIndex((r) => r.id === id);
    if (at < 0) throw new Error(`MERGE_UNKNOWN_TASK: ${id} was not part of the run`);
    const fresh = remeasured.extra.tasks.find((r) => r.id === id);
    const freshCheck = remeasured.checks.find((c) => c.id === id);
    if (fresh === undefined || freshCheck === undefined) throw new Error(`MERGE_TASK_NOT_REMEASURED: ${id}`);
    superseded.push({ ...rows[at], superseded_at: meta.at ?? stamp(), superseded_reason: meta.reason ?? "" });
    rows[at] = { ...fresh, remeasured_at: meta.at ?? stamp() };
    const c = checks.findIndex((x) => x.id === id);
    if (c < 0) checks.push(freshCheck);
    else checks[c] = freshCheck;
  }
  const counts = Object.fromEntries(STATUSES.map((s) => [s, checks.filter((c) => c.status === s).length]));
  const remeasurements = [...(previous.extra.remeasurements ?? []), { at: meta.at ?? stamp(), tasks, reason: meta.reason ?? "", source: meta.source ?? null }];
  return { ...previous, counts, checks, extra: { ...previous.extra, tasks: rows, superseded, remeasurements } };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const from = argument("--from", "");
  const tasks = argument("--tasks", "").split(",").map((s) => s.trim()).filter(Boolean);
  const reason = argument("--reason", "");
  const target = join(root, RAW_DIRECTORY, "harness", "missions.local.json");
  const previous = readJson(target);
  const remeasured = readJson(join(from, "missions.local.json"));
  const at = stamp();
  const merged = mergeMissions(previous, remeasured, tasks, { at, reason, source: from });
  // نسخة من السجل قبل الدمج تبقى بجانبه
  if (existsSync(target)) copyFileSync(target, join(root, RAW_DIRECTORY, "harness", `missions-before-${at.replace(/[:]/g, "")}.local.json`));
  writeEvidence(target, merged);
  for (const id of tasks) console.log(`re-measured ${id}: ${merged.extra.tasks.find((r) => r.id === id).status}`);
}
