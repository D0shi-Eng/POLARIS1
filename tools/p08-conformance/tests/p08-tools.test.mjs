// اختبارات أدوات Phase-08: فحص الأسرار، وفحص المستودع، والاشتقاق، والبوابة. كل اختبار يثبت
// خاصية حكم: لا ترقية، ولا PASS من غياب، ولا نموذج مفقود يُحسب نجاحًا.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyModelDeferral, claimsFor, documentVerdict, MODEL_DEFERRED_CLAIMS } from "../p08-derive.mjs";
import { releaseVerdicts } from "../p08-final-gate.mjs";
import { compatible, normalise } from "../p08-notices.mjs";
import { diagrams } from "../p08-repository.mjs";
import { entropy, ignored, ignoreRules, isSynthetic, scanText } from "../p08-secrets.mjs";
import { worst } from "../p08-common.mjs";

// القيم تُبنى بالتجميع كي لا يحمل هذا الملف نفسه شكل سرّ حقيقيّ.
const realLookingOpenAi = ["sk-", "Qz8Lm2Rt5Vx9Nb4Kc7Hd3Fg6Jp1Ws0Ya", "Te"].join("");
const realLookingGithub = ["gh", "p_", "Zx9Qm2Lp8Rt4Vw6Yb1Nc3Hd5Fg7Jk0Ls2Mn4"].join("");

test("P08-TOOLS-001 a real-looking key is a leak; the redaction tests' alphabet runs and EXAMPLE keys are synthetic", () => {
  assert.deepEqual(scanText(`const k = "${realLookingOpenAi}";`).map((h) => [h.kind, h.synthetic]), [["openai", false]]);
  assert.deepEqual(scanText(`token: ${realLookingGithub}`).map((h) => h.kind), ["github-token"]);
  assert.equal(scanText('code_value: "AKIAIOSFODNN7EXAMPLE"')[0].synthetic, true);
  assert.equal(isSynthetic("sk-abcdefghijklmnopqrstuvwxyz123456"), true);
  assert.equal(isSynthetic("-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY----- abc"), true);
});

test("P08-TOOLS-002 a high-entropy value assigned to a secret-looking name is found; digests and ids are not", () => {
  const hits = scanText(`api_token = "${["Zx9Qm2Lp", "8Rt4Vw6Yb1", "Nc3Hd5Fg7Jk0"].join("")}"`);
  assert.equal(hits.length, 1);
  assert.match(hits[0].kind, /^high-entropy:api_token$/);
  assert.equal(scanText(`sha_key = "${"a1b2c3d4".repeat(8)}"`).length, 0);
  assert.ok(entropy("aaaaaaaa") < 1 && entropy("Zx9Qm2Lp8Rt4Vw6Y") > 3.5);
});

test("P08-TOOLS-003 the .gitignore reader keeps evidence, transfers and binaries out and source in", () => {
  const rules = ignoreRules("node_modules/\nevidence/\n_transfer/\n*.exe\n*.local.json\ndocs/phases/\ntools/**/bin/\n");
  assert.ok(ignored(rules, "evidence", true));
  assert.ok(ignored(rules, "desktop/renderer/node_modules", true));
  assert.ok(ignored(rules, "tools/w4-windows-adapter/bin", true));
  assert.ok(ignored(rules, "x/y/run.local.json", false));
  assert.ok(ignored(rules, "docs/phases", true));
  assert.ok(!ignored(rules, "desktop/host/core/src/lib.rs", false));
  assert.ok(!ignored(rules, "tools/confinement-spike/build/build.ps1", false));
});

test("P08-TOOLS-004 a diagram without a status label is reported unlabelled", () => {
  const root = mkdtempSync(join(tmpdir(), "p08-repo-"));
  mkdirSync(join(root, "docs", "public", "en"), { recursive: true });
  writeFileSync(join(root, "docs", "public", "en", "a.md"), "Status: IMPLEMENTED\n\n```mermaid\nflowchart LR\n```\n\n```mermaid\nflowchart LR\n```\n");
  const found = diagrams(root, "docs/public/en");
  assert.equal(found.length, 2);
  assert.equal(found[0].status, "IMPLEMENTED");
  assert.equal(found[1].status, null);
});

test("P08-TOOLS-005 licence compatibility reads SPDX expressions and old slash forms", () => {
  assert.equal(normalise("MIT/Apache-2.0"), "MIT OR Apache-2.0");
  assert.ok(compatible("MIT OR Apache-2.0"));
  assert.ok(compatible("(MIT OR Apache-2.0) AND Unicode-3.0"));
  assert.ok(compatible("MPL-2.0"));
  assert.ok(!compatible("GPL-2.0-only"));
  assert.ok(!compatible("SSPL-1.0"));
  assert.ok(!compatible(""));
});

const empty = { run: null, groups: null, harness: { summary: null, model: null, sandbox: null, browser: null, artifacts: null, missions: null, lifecycle: null, restart: null }, ui: null, secrets: null, repository: null, phase07: null };

test("P08-TOOLS-006 an absent measurement is NOT_TESTED, never PASS", () => {
  for (const doc of ["phase-08-execution", "phase-08-browser", "phase-08-artifacts", "phase-08-security", "phase-08-repository"]) {
    const claims = claimsFor(doc, empty);
    assert.ok(claims.length > 0);
    assert.ok(claims.every((c) => c.verdict !== "PASS"), doc);
  }
});

test("P08-TOOLS-007 without a working local model, model-dependent conditions are BLOCKED, not PASS", () => {
  const inputs = {
    ...empty,
    harness: { ...empty.harness, model: { checks: [{ id: "P08-MDL-SELECTED", status: "BLOCKED" }, { id: "P08-MDL-INVOKE", status: "BLOCKED" }] }, missions: { extra: { tasks: [{ id: "MISSION-A", status: "BLOCKED", category: "documents" }] } } },
  };
  const model = claimsFor("phase-08-real-model", inputs);
  assert.equal(model.find((c) => c.claim_id === "P08-MODEL-02").verdict, "BLOCKED");
  const bench = claimsFor("phase-08-benchmark", inputs);
  assert.equal(bench.find((c) => c.claim_id === "P08-MISSION-A").verdict, "BLOCKED");
  assert.notEqual(worst(bench.map((c) => c.verdict)), "PASS");
});

test("P08-TOOLS-008 a failed safety task fails the benchmark even when every other task passed", () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `B${i}`, status: "PASS", category: "code" }));
  tasks.push({ id: "B21", status: "FAIL", category: "safety" });
  const inputs = { ...empty, harness: { ...empty.harness, model: { checks: [{ id: "P08-MDL-INVOKE", status: "PASS" }] }, missions: { extra: { tasks } } } };
  const bench = claimsFor("phase-08-benchmark", inputs);
  assert.equal(bench.find((c) => c.claim_id === "P08-BENCH-02").verdict, "FAIL");
});

test("P08-TOOLS-009 the release verdicts never claim a release, signing, macOS or a comparison", () => {
  const v = releaseVerdicts({}, null);
  assert.equal(v.public_release, "NOT_RELEASED");
  assert.equal(v.manus_functional_comparison, "NOT_MEASURED");
  assert.equal(v.macos, "FOUNDATION_ONLY / NOT_NATIVE_VERIFIED");
  assert.equal(v.windows_rc, "NOT_READY");
  assert.notEqual(v.phase_08, "PASS");
  assert.ok(v.not_claimed.includes("production ready"));
});

// سلسلة إعادة الحكم: كل منفّذ يعمل عمليةً مستقلة، وبوابة لم يُعِد المنفّذ الحكم فيها لا تُقبل ولو كانت PASS.
// المنفّذ الوهمي يكتب سطرًا على stderr من أمر أصليّ مع ErrorActionPreference = Stop، كما يفعل تحذير npm.
function chainFixture(runnerBody, staleGate) {
  const root = mkdtempSync(join(tmpdir(), "polaris-chain-"));
  mkdirSync(join(root, "tools", "p01-conformance"), { recursive: true });
  mkdirSync(join(root, "evidence", "p08-native"), { recursive: true });
  writeFileSync(join(root, "tools", "p01-conformance", "run.ps1"), runnerBody);
  if (staleGate) writeFileSync(join(root, "evidence", "phase-01-final-gate.json"), JSON.stringify({ verdict: "PASS", measured_at: "2026-01-01T00:00:00Z" }));
  const chain = join(import.meta.dirname, "..", "run-chain.ps1");
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", chain, "-RepositoryRoot", root, "-Phases", "01", "-SkipPreflight"], { encoding: "utf8", timeout: 120000 });
  return { root, code: run.status, out: `${run.stdout}\n${run.stderr}` };
}

const writesGate = [
  "param([string] $RepositoryRoot)",
  "$ErrorActionPreference = 'Stop'",
  "& cmd.exe /c \"echo npm warn allow-scripts fixture 1>&2\"",
  "$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')",
  "Set-Content -LiteralPath (Join-Path (Join-Path $RepositoryRoot 'evidence') 'phase-01-final-gate.json') -Value ('{\"verdict\":\"PASS\",\"measured_at\":\"' + $now + '\"}') -Encoding ASCII",
  "exit 0",
].join("\r\n");

test("P08-TOOLS-010 a runner that writes a native warning to stderr still decides its gate inside the chain", { skip: process.platform !== "win32" }, () => {
  const r = chainFixture(writesGate, false);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /=== chain: PHASE-01 = PASS/);
  assert.match(r.out, /=== chain finished/);
});

test("P08-TOOLS-010b a stale PASS gate left by an earlier run is never accepted when the runner did not re-decide it", { skip: process.platform !== "win32" }, () => {
  const r = chainFixture("param([string] $RepositoryRoot)\r\nexit 1", true);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /not re-decided by this run \(stale\)/);
  assert.doesNotMatch(r.out, /=== chain finished/);
});

// تأجيل اختبارات النموذج (قرار المالك 2026-09-30): قائمة مغلقة، لا PASS أبدًا، ولا أثر بلا علامة المشغّل.
const deferredRun = { run: { model_deferred: true, model_deferred_reason: "owner decision" } };
const allDocs = ["phase-08-run", "phase-08-real-model", "phase-08-execution", "phase-08-browser", "phase-08-artifacts", "phase-08-scheduler", "phase-08-integrations", "phase-08-ux", "phase-08-benchmark", "phase-08-security", "phase-08-native-e2e", "phase-08-regression", "phase-08-repository"];

test("P08-TOOLS-011 a deferred run marks exactly the closed list of model conditions DEFERRED, and nothing else", () => {
  const inputs = { ...empty, ...deferredRun };
  for (const doc of allDocs) {
    for (const c of applyModelDeferral(claimsFor(doc, inputs), inputs)) {
      if (MODEL_DEFERRED_CLAIMS.includes(c.claim_id)) assert.equal(c.verdict, "DEFERRED", c.claim_id);
      else assert.notEqual(c.verdict, "DEFERRED", c.claim_id);
      assert.notEqual(c.verdict === "DEFERRED" && c.verdict === "PASS", true);
    }
  }
  // لا شرط تنفيذ أو متصفح أو أمان غير نموذجي في القائمة
  assert.ok(MODEL_DEFERRED_CLAIMS.every((id) => /^P08-(MODEL|BENCH|MISSION|SEC-03|SCH-02|E2E-0[3567])/.test(id)));
});

test("P08-TOOLS-012 without the runner's deferral record, a missing model stays BLOCKED (nothing is deferred)", () => {
  const inputs = { ...empty, harness: { ...empty.harness, model: { checks: [{ id: "P08-MDL-SELECTED", status: "BLOCKED" }, { id: "P08-MDL-INVOKE", status: "BLOCKED" }] } } };
  const claims = applyModelDeferral(claimsFor("phase-08-real-model", inputs), inputs);
  assert.ok(claims.every((c) => c.verdict !== "DEFERRED"));
  assert.equal(claims.find((c) => c.claim_id === "P08-MODEL-02").verdict, "BLOCKED");
});

test("P08-TOOLS-013 deferred conditions never make a document PASS, and a failure beside them still fails it", () => {
  assert.equal(documentVerdict([{ claim_id: "P08-SEC-03", verdict: "DEFERRED" }, { claim_id: "P08-SEC-01", verdict: "FAIL" }]), "FAIL");
  assert.equal(documentVerdict([{ claim_id: "P08-MODEL-01", verdict: "DEFERRED" }]), "DEFERRED");
  assert.equal(documentVerdict([{ claim_id: "P08-SEC-03", verdict: "DEFERRED" }, { claim_id: "P08-SEC-01", verdict: "NOT_TESTED" }]), "NOT_TESTED");
  const docs = Object.fromEntries(allDocs.map((n) => [n, { verdict: "PASS", claims: [] }]));
  docs["phase-08-real-model"] = { verdict: "DEFERRED", claims: [{ claim_id: "P08-MODEL-02", verdict: "DEFERRED" }] };
  docs["phase-08-benchmark"] = { verdict: "DEFERRED", claims: [] };
  const v = releaseVerdicts(docs, { release_verdicts: { windows_rc: "READY", signing: "SIGNING_READY_UNSIGNED" } });
  assert.equal(v.phase_08, "PASS");
  assert.equal(v.real_model_verified, "DEFERRED_TO_LATER_PHASE");
  assert.match(v.model_tests, /^DEFERRED_TO_LATER_PHASE/);
  docs["phase-08-browser"] = { verdict: "FAIL", claims: [] };
  assert.equal(releaseVerdicts(docs, null).phase_08, "FAIL");
});

test("P08-TOOLS-014 in PRIOR_GATES mode the Phase-07 gate is read: canonical PASS passes, anything else does not", () => {
  const p07 = { canonical: true, verdict: "PASS", measured_at: "2026-09-30T01:00:00Z" };
  const run = { run_started: "2026-09-30T02:00:00Z", regression_mode: "PRIOR_GATES" };
  const reg = (phase07, r = run) => claimsFor("phase-08-regression", { ...empty, run: r, phase07 });
  assert.deepEqual(reg(p07).slice(0, 2).map((c) => c.verdict), ["PASS", "PASS"]);
  assert.equal(reg({ ...p07, verdict: "FAIL" })[1].verdict, "FAIL");
  assert.equal(reg({ ...p07, canonical: false })[0].verdict, "FAIL");
  assert.equal(reg(null)[1].verdict, "NOT_TESTED");
  // وضع RERUN يبقى كما كان: بوابة أقدم من التشغيل لا تُحسب
  assert.equal(reg(p07, { run_started: run.run_started })[1].verdict, "FAIL");
});

// الإغلاق الوظيفي (2026-09-30): POLARIS_FUNCTIONAL_RC لا يكون PASS ما دام شرط من الستة عشر مؤجّلًا أو غير ناجح؛
// PASS فقط حين تنجح الشروط الستة عشر كلها بالنموذج الحقيقي وتنجح الأسطح الحتمية.
test("P08-TOOLS-015 POLARIS_FUNCTIONAL_RC is NOT_PROVEN while real-model conditions are deferred, FAIL on any non-PASS, PASS only with all sixteen", () => {
  const phase07 = { release_verdicts: { windows_rc: "READY", signing: "SIGNING_READY_UNSIGNED" } };
  const docsWith = (verdictOf16) => {
    const docs = Object.fromEntries(allDocs.map((n) => [n, { verdict: "PASS", claims: [] }]));
    const owner = { "P08-MODEL": "phase-08-real-model", "P08-BENCH": "phase-08-benchmark", "P08-MISSI": "phase-08-benchmark", "P08-SEC-0": "phase-08-security", "P08-SCH-0": "phase-08-scheduler", "P08-E2E-0": "phase-08-native-e2e" };
    for (const id of MODEL_DEFERRED_CLAIMS) docs[owner[id.slice(0, 9)]].claims.push({ claim_id: id, verdict: verdictOf16(id) });
    for (const n of allDocs) docs[n].verdict = documentVerdict(docs[n].claims.length > 0 ? docs[n].claims : [{ verdict: "PASS" }]);
    return docs;
  };
  // المؤجَّل: البوابة الهندسية قد تنجح، لكن الحكم الوظيفي غير مثبت، وWINDOWS_RC ليس READY
  const deferred = releaseVerdicts(docsWith(() => "DEFERRED"), phase07);
  assert.equal(deferred.phase_08, "PASS");
  assert.equal(deferred.polaris_functional_rc, "NOT_PROVEN (real-model conditions deferred)");
  assert.equal(deferred.windows_rc, "NOT_READY");
  // شرط واحد مؤجَّل بين ناجحين يكفي لعدم الإثبات
  assert.equal(releaseVerdicts(docsWith((id) => (id === "P08-SCH-02" ? "DEFERRED" : "PASS")), phase07).polaris_functional_rc, "NOT_PROVEN (real-model conditions deferred)");
  // شرط غير ناجح (بلا تأجيل) = FAIL مع السبب
  const failed = releaseVerdicts(docsWith((id) => (id === "P08-MISSION-C" ? "PARTIAL" : "PASS")), phase07);
  assert.match(failed.polaris_functional_rc, /^FAIL \(.*P08-MISSION-C=PARTIAL/);
  assert.equal(failed.windows_rc, "NOT_READY");
  // شرط غائب من الوثائق لا يُحسب نجاحًا
  const missing = docsWith(() => "PASS");
  missing["phase-08-scheduler"].claims = [];
  assert.match(releaseVerdicts(missing, phase07).polaris_functional_rc, /^FAIL \(.*P08-SCH-02=NOT_TESTED/);
  // الستة عشر كلها PASS والأسطح الحتمية PASS
  const all = releaseVerdicts(docsWith(() => "PASS"), phase07);
  assert.equal(all.polaris_functional_rc, "PASS");
  assert.equal(all.windows_rc, "READY");
  assert.equal(all.real_model_verified, "VERIFIED");
  // سطح حتمي فاشل يُفشل الحكم الوظيفي ولو نجحت الستة عشر
  const brw = docsWith(() => "PASS");
  brw["phase-08-browser"].verdict = "FAIL";
  assert.match(releaseVerdicts(brw, phase07).polaris_functional_rc, /^FAIL \(.*phase-08-browser=FAIL/);
});

// إعادة قياس مهمّة بعينها: تُستبدل المهامّ المسمّاة وحدها، ويبقى القياس السابق ظاهرًا، ولا يُقبل نموذج آخر.
test("P08-TOOLS-016 re-measuring named benchmark tasks replaces only them, keeps the earlier rows, and refuses another model or an unnamed task", async () => {
  const { mergeMissions } = await import("../p08-merge-missions.mjs");
  const doc = (model, rows) => ({ section: "missions", counts: {}, checks: rows.map((r) => ({ id: r.id, status: r.status })), extra: { model_id: model, tasks: rows } });
  const before = doc("m1", [{ id: "MISSION-C", status: "PARTIAL" }, { id: "B20", status: "PASS" }, { id: "B22", status: "FAIL" }]);
  const again = doc("m1", [{ id: "MISSION-C", status: "PASS" }, { id: "B22", status: "PASS" }]);
  const merged = mergeMissions(before, again, ["MISSION-C"], { at: "2026-09-30T12:00:00Z", reason: "root cause fixed" });
  assert.deepEqual(merged.extra.tasks.map((r) => [r.id, r.status]), [["MISSION-C", "PASS"], ["B20", "PASS"], ["B22", "FAIL"]]);
  assert.deepEqual(merged.extra.superseded.map((r) => [r.id, r.status, r.superseded_reason]), [["MISSION-C", "PARTIAL", "root cause fixed"]]);
  assert.equal(merged.counts.FAIL, 1);
  assert.equal(merged.counts.PASS, 2);
  assert.equal(merged.extra.remeasurements.length, 1);
  assert.throws(() => mergeMissions(before, doc("m2", again.extra.tasks), ["MISSION-C"]), /MERGE_MODEL_MISMATCH/);
  assert.throws(() => mergeMissions(before, again, ["B20"]), /MERGE_TASK_NOT_REMEASURED/);
  assert.throws(() => mergeMissions(before, again, ["B99"]), /MERGE_UNKNOWN_TASK/);
  assert.throws(() => mergeMissions(before, again, []), /MERGE_NO_TASKS/);
  assert.throws(() => mergeMissions(null, again, ["MISSION-C"]), /MERGE_NO_PREVIOUS/);
});
