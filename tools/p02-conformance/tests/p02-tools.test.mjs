// اختبارات أدوات Phase-02 نفسها: التجهيزة، والفحص، والتقييم، وبوابة البايتات.
// أداة قياس لا تُختبر تُنتج أحكامًا لا يُعرف مصدر خطئها.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { worst } from "../p02-common.mjs";
import { P02_CLAIMS } from "../p02-claims.mjs";
import { inspectBytes } from "../p02-evidence-bytes.mjs";
import { checkVerdict, e2eVerdict, evaluateClaim, gateRegressionVerdict, noSkipVerdict, testVerdict } from "../p02-evaluate.mjs";
import { FIXTURE_REPLY_PARTS, NOTE_MARKER, startFixture } from "../p02-fixture-server.mjs";
import { findSecretLeaks, modelNameHits } from "../p02-security.mjs";
import { loadSkipRegistry } from "../p02-skip-classification.mjs";
import { parseTapTests, verdictFor } from "../p02-test-groups.mjs";
import { makeWorkspace } from "../p02-workspace.mjs";

function call(port, method, path, body, { abortAfterMs } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, text }));
      res.on("error", () => resolve({ status: res.statusCode, text, aborted: true }));
      if (abortAfterMs !== undefined) {
        setTimeout(() => {
          req.destroy();
          resolve({ status: res.statusCode, text, aborted: true });
        }, abortAfterMs);
      }
    });
    req.on("error", (error) => (abortAfterMs !== undefined ? resolve({ aborted: true }) : reject(error)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("P02-TOOL-001 the fixture lists its models, streams a deterministic reply and records no body", async () => {
  const fixture = await startFixture();
  try {
    const models = await call(fixture.localPort, "GET", "/v1/models");
    assert.equal(models.status, 200);
    assert.deepEqual(JSON.parse(models.text).data.map((entry) => entry.id), ["fixture-chat", "fixture-slow"]);
    const chat = await call(fixture.localPort, "POST", "/v1/chat/completions", JSON.stringify({ model: "fixture-chat", messages: [{ role: "user", content: `x ${NOTE_MARKER}` }] }));
    const text = chat.text
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)).choices[0].delta.content ?? "")
      .join("");
    assert.equal(text, FIXTURE_REPLY_PARTS.join(""));
    assert.ok(chat.text.includes("data: [DONE]"));
    const entry = fixture.log.find((item) => item.model === "fixture-chat");
    assert.equal(entry.context_marker, true);
    assert.equal(entry.completed, true);
    assert.ok(!JSON.stringify(fixture.log).includes("messages"), "a request body was logged");
    const remote = await call(fixture.remotePort, "GET", "/api/v1/models");
    assert.equal(JSON.parse(remote.text).data[0].id, "fixture/remote-chat");
    const closed = await call(fixture.closedPort, "GET", "/").catch((error) => ({ refused: error.code }));
    assert.equal(closed.refused, "ECONNREFUSED");
  } finally {
    await fixture.close();
  }
});

test("P02-TOOL-002 a slow request cut by the client is recorded as aborted, not completed", async () => {
  const fixture = await startFixture();
  try {
    await call(fixture.localPort, "POST", "/v1/chat/completions", JSON.stringify({ model: "fixture-slow" }), { abortAfterMs: 400 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const entry = fixture.log.find((item) => item.model === "fixture-slow");
    assert.equal(entry.aborted, true);
    assert.equal(entry.completed, false);
  } finally {
    await fixture.close();
  }
});

test("P02-TOOL-003 the secret scan finds key shapes and official key values without printing them", () => {
  assert.deepEqual(findSecretLeaks("nothing here", {}), []);
  assert.ok(findSecretLeaks("key sk-proj-abcdefghijklmnopqrstuvwxyz0123", {}).length > 0);
  assert.ok(findSecretLeaks('"authorization": "Bearer abcdefghijklmnop"', {}).length > 0);
  const hits = findSecretLeaks("value zq8-custom-value-77 appears", { OPENAI_API_KEY: "zq8-custom-value-77" });
  assert.deepEqual(hits, ["value-of-OPENAI_API_KEY"]);
  assert.ok(!hits.join("").includes("zq8"));
});

test("P02-TOOL-004 the model-name scan ignores the provider name and nothing else", () => {
  assert.deepEqual(modelNameHits("OLLAMA_NATIVE and Ollama"), []);
  assert.deepEqual(modelNameHits("codellama"), ["llama"]);
  assert.deepEqual(modelNameHits("Qwen 2"), ["qwen"]);
});

test("P02-TOOL-005 a claim with a missing test is NOT_TESTED and never PASS", () => {
  const inputs = { groups: [{ group_id: "G", verdict: "PASS", tests: [{ name: "a::tests::one", status: "PASS" }] }] };
  assert.equal(testVerdict(inputs, "G", "a::tests::").verdict, "PASS");
  assert.equal(testVerdict(inputs, "G", "missing").verdict, "NOT_TESTED");
  assert.equal(testVerdict(inputs, "OTHER", "x").verdict, "NOT_TESTED");
  const failing = { groups: [{ group_id: "G", verdict: "FAIL", tests: [{ name: "x", status: "FAIL" }] }] };
  assert.equal(testVerdict(failing, "G", "x").verdict, "FAIL");
  assert.equal(worst(["PASS", "NOT_TESTED"]), "NOT_TESTED");
  assert.equal(worst(["PASS", "FAIL", "BLOCKED"]), "FAIL");
  assert.equal(worst([]), "NOT_TESTED");
});

test("P02-TOOL-006 without a native run every E2E scenario and native check is NOT_TESTED", () => {
  const inputs = { groups: [], native: { performed: false, reason: "NOT_WINDOWS" } };
  for (const id of ["E2E-01", "E2E-20", "E2E-22"]) assert.equal(e2eVerdict(inputs, id).verdict, "NOT_TESTED");
  assert.equal(checkVerdict(inputs, "FIXTURE-NO-REMOTE-CHAT").verdict, "NOT_TESTED");
  const claim = P02_CLAIMS.find((entry) => entry.id === "P02-E1");
  assert.equal(evaluateClaim(inputs, claim).verdict, "NOT_TESTED");
});

test("P02-TOOL-007 a remote fixture that was never reached proves nothing; a reached one proves silence", () => {
  const base = { performed: true };
  const unreached = { native: { ...base, fixture_log: { requests: [] } } };
  assert.equal(checkVerdict(unreached, "FIXTURE-NO-REMOTE-CHAT").verdict, "NOT_TESTED");
  const silent = { native: { ...base, fixture_log: { requests: [{ port: "remote", path: "/api/v1/models" }] } } };
  assert.equal(checkVerdict(silent, "FIXTURE-NO-REMOTE-CHAT").verdict, "PASS");
  const leaked = { native: { ...base, fixture_log: { requests: [{ port: "remote", path: "/api/v1/models" }, { port: "remote", path: "/api/v1/chat/completions" }] } } };
  assert.equal(checkVerdict(leaked, "FIXTURE-NO-REMOTE-CHAT").verdict, "FAIL");
});

test("P02-TOOL-008 a dirty exit or a survivor fails E2E-22", () => {
  const clean = { started: true, startup_report: {}, closed_gracefully: true, process_exited: true, exit_code: 0, orphan_processes: 0 };
  assert.equal(e2eVerdict({ native: { performed: true, first: clean, restart: clean } }, "E2E-22").verdict, "PASS");
  assert.equal(e2eVerdict({ native: { performed: true, first: clean, restart: { ...clean, orphan_processes: 1 } } }, "E2E-22").verdict, "FAIL");
  assert.equal(e2eVerdict({ native: { performed: true, first: { ...clean, closed_gracefully: false }, restart: clean } }, "E2E-22").verdict, "FAIL");
});

test("P02-TOOL-009 an earlier-phase gate counts only when it was re-run in this run and passed", () => {
  const run = { runStarted: "2026-09-17T10:00:00Z" };
  const stale = { ...run, phase01Gate: { verdict: "PASS", phase_02_gate: "ALLOWED", canonical: true, measured_at: "2026-09-16T10:00:00Z" } };
  assert.equal(gateRegressionVerdict(stale, "PHASE-01").verdict, "NOT_TESTED");
  const fresh = { ...run, phase01Gate: { verdict: "PASS", phase_02_gate: "ALLOWED", canonical: true, measured_at: "2026-09-17T11:00:00Z" } };
  assert.equal(gateRegressionVerdict(fresh, "PHASE-01").verdict, "PASS");
  const regressed = { ...run, phase00Gate: { verdict: "FAIL", native: true, platform: "win32", decided_at: "2026-09-17T11:00:00Z" } };
  assert.equal(gateRegressionVerdict(regressed, "PHASE-00").verdict, "FAIL");
  const phase00 = { ...run, phase00Gate: { verdict: "PASS", native: true, platform: "win32", decided_at: "2026-09-17T11:00:00Z" } };
  assert.equal(gateRegressionVerdict(phase00, "PHASE-00").verdict, "PASS");
  assert.equal(gateRegressionVerdict({ phase00Gate: phase00.phase00Gate }, "PHASE-00").verdict, "NOT_TESTED");
});

test("P02-TOOL-010 a skipped security test is a failed mandatory condition", () => {
  const groups = ["P02-PROVIDERS", "P02-HOST-CORE", "P02-CONTEXT", "P02-PROJECT-DB", "P02-CONTRACTS-P02", "P02-RENDERER-UI"].map((group_id) => ({ group_id, verdict: "PASS", counts: { skipped: 0 }, tests: [{ name: "t", status: "PASS" }] }));
  const scans = { securityStatic: { checks: [{}] }, securityEvidence: { checks: [{}] } };
  assert.equal(noSkipVerdict({ groups, ...scans }).verdict, "PASS");
  groups[0].tests.push({ name: "u", status: "SKIPPED" });
  assert.equal(noSkipVerdict({ groups, ...scans }).verdict, "FAIL");
});

test("P02-TOOL-011 the byte gate refuses a BOM, a CR, a missing or doubled final newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "p02-bytes-"));
  const body = { schema_version: "1", tool: "t", phase: "PHASE-02", canonical: true, measured_at: "x" };
  const good = join(dir, "good.json");
  writeFileSync(good, `${JSON.stringify(body, null, 2)}\n`);
  assert.equal(inspectBytes(good).ok, true);
  const cases = {
    bom: `﻿${JSON.stringify(body)}\n`,
    crlf: `${JSON.stringify(body, null, 2).replace(/\n/g, "\r\n")}\r\n`,
    none: JSON.stringify(body),
    double: `${JSON.stringify(body)}\n\n`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, text);
    assert.equal(inspectBytes(path).ok, false, name);
  }
  assert.equal(inspectBytes(join(dir, "absent.json")).ok, false);
});

test("P02-TOOL-012 the fixture workspace carries the markers the E2E suite needs and no real secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "p02-ws-"));
  const files = makeWorkspace(dir);
  assert.deepEqual(files, ["notes.md", "docs/hostile.md", ".env", "docs/blob.bin"]);
  assert.ok(readFileSync(join(dir, "notes.md"), "utf8").includes(NOTE_MARKER));
  assert.deepEqual(findSecretLeaks(readFileSync(join(dir, ".env"), "utf8"), {}), []);
});

test("P02-TOOL-013 every gate condition from the master prompt is declared once", () => {
  const expected = ["P1", "P2", "P3", "P4", "P5", "M1", "M2", "M3", "M4", "M5", "M6", "R1", "R2", "R3", "J1", "J2", "J3", "J4", "C1", "C2", "C3", "C4", "C5", "U1", "U2", "U3", "U4", "U5", "S1", "S2", "S3", "S4", "S5", "E1", "E2", "E3", "Q1", "Q2", "Q3", "Q4"].map((id) => `P02-${id}`);
  assert.deepEqual(P02_CLAIMS.map((claim) => claim.id), expected);
  for (const claim of P02_CLAIMS) assert.ok(claim.requires.length > 0, `${claim.id} has no measurement`);
});

// -- تصنيف التخطّي -----------------------------------------------------------
//
// العيب المُغلَق: P02_RUNTIME_SKIP_CLASSIFIER_NOT_USING_FROZEN_W6_SKIP_INVENTORY.
// كان حَكَم المجموعات يردّ أي تخطٍّ بـUNEXPLAINED_SKIP لأن القارئ يُسقِط نصّ
// `# SKIP <reason>`، فلا يصل إلى السجل المُجمَّد ما يُقابَل به. الاختبارات أدناه
// تحرس الطرفين: أن السبب يُقرأ، وأن المجهول والأمني والمانع تبقى حاجزة.

const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** عدّاد مجموعة Node ناجحة، تُضبط منه حالات التخطّي وحدها. */
function counts({ tests, passed, skipped = 0, todo = 0 }) {
  return { tests, passed, failed: 0, skipped, todo, cancelled: 0 };
}

function skip(name, reason, directive = "SKIP") {
  return { name, status: "SKIPPED", directive, reason };
}

/** سجل مصطنع بشكل السجل المُجمَّد نفسه، للحالات التي لا يحملها السجل الحقيقي. */
const STUB_REGISTRY = {
  findSkipDeclaration(reason) {
    const declarations = [
      { reason: "a declared non-blocking reason", skip_class: "A", rationale: "stub", windows_claim_carried_by: "W-00 (stub)", blocks_closure: false },
      { reason: "a security-critical reason", skip_class: "D", rationale: "stub", windows_claim_carried_by: "", blocks_closure: true },
      { reason: "an environment refusal", skip_class: "C", rationale: "stub", windows_claim_carried_by: "W-00 (stub)", blocks_closure: true },
    ];
    const normalised = reason.trim();
    return declarations.find((declaration) => normalised.includes(declaration.reason));
  },
};

test("P02-SKIP-001 a group with no skip is clean, and no classification is attached", () => {
  const outcome = verdictFor("node", counts({ tests: 505, passed: 505 }), 0, [], STUB_REGISTRY);
  assert.equal(outcome.verdict, "PASS");
  assert.equal(outcome.skip_classification, undefined);
});

test("P02-SKIP-002 one declared non-blocking skip is clean, and its claim owner is recorded", () => {
  const tests = [skip("some test", "a declared non-blocking reason")];
  const outcome = verdictFor("node", counts({ tests: 10, passed: 9, skipped: 1 }), 0, tests, STUB_REGISTRY);
  assert.equal(outcome.verdict, "PASS");
  assert.deepEqual(outcome.skip_classification.summary.by_class, { A: 1, B: 0, C: 0, D: 0, UNCLASSIFIED: 0 });
  assert.equal(outcome.skip_classification.summary.declared_nonblocking, 1);
  assert.equal(outcome.skip_classification.skips[0].claim_owner, "W-00 (stub)");
  assert.equal(outcome.skip_classification.skips[0].platform_legitimate, true);
});

test("P02-SKIP-003 the three frozen Phase-00 skips classify clean against the real registry", async () => {
  const { registry, error } = await loadSkipRegistry(REPOSITORY_ROOT);
  assert.equal(error, "", "the frozen skip registry must be reachable from the runtime build");
  const tests = [
    skip("X03 regression: a leaked handle IS detected, and the POLARIS launcher leaks none", "the /proc handle probe is a Linux-native check"),
    skip("a symbolic link that leaves the anchored root is caught after real resolution", "junction creation needs a native Windows run"),
    skip("containment is proven after link resolution, not before", "junction creation needs a native Windows run"),
  ];
  const outcome = verdictFor("node", counts({ tests: 505, passed: 502, skipped: 3 }), 0, tests, registry);
  assert.equal(outcome.verdict, "PASS");
  assert.equal(outcome.reason, "");
  const summary = outcome.skip_classification.summary;
  assert.equal(summary.skipped, 3);
  assert.equal(summary.declared_nonblocking, 3);
  assert.equal(summary.unexplained, 0);
  assert.equal(summary.blocking, 0);
  assert.equal(summary.security_critical, 0);
  // كل تخطٍّ يحمل مَن يحمل ادعاءه على ويندوز. «Windows-only» وحدها لا تكفي.
  for (const record of outcome.skip_classification.skips) {
    assert.notEqual(record.claim_owner, "", `${record.test_name} must name who carries its Windows claim`);
  }
});

test("P02-SKIP-004 an unknown skip reason is INCONCLUSIVE, and so is a missing registry", () => {
  const tests = [skip("some test", "a reason nobody declared")];
  const outcome = verdictFor("node", counts({ tests: 10, passed: 9, skipped: 1 }), 0, tests, STUB_REGISTRY);
  assert.equal(outcome.verdict, "INCONCLUSIVE");
  assert.equal(outcome.reason, "UNEXPLAINED_SKIP");
  assert.equal(outcome.skip_classification.summary.unexplained, 1);
  assert.equal(outcome.skip_classification.skips[0].blocks_closure, true);
  // بلا سجل لا تصنيف: لا يجوز أن يُقرأ غياب الأداة قبولًا.
  const blind = verdictFor("node", counts({ tests: 10, passed: 9, skipped: 1 }), 0, tests, null);
  assert.equal(blind.verdict, "BLOCKED");
  assert.equal(blind.reason, "SKIP_REGISTRY_UNAVAILABLE");
});

test("P02-SKIP-005 a class-D skip is BLOCKED, and so is any declared skip that blocks closure", () => {
  const critical = verdictFor("node", counts({ tests: 10, passed: 9, skipped: 1 }), 0, [skip("t", "a security-critical reason")], STUB_REGISTRY);
  assert.equal(critical.verdict, "BLOCKED");
  assert.equal(critical.reason, "SECURITY_CRITICAL_SKIP_UNMEASURED");
  assert.equal(critical.skip_classification.skips[0].security_critical, true);
  const refused = verdictFor("node", counts({ tests: 10, passed: 9, skipped: 1 }), 0, [skip("t", "an environment refusal")], STUB_REGISTRY);
  assert.equal(refused.verdict, "BLOCKED");
  assert.equal(refused.reason, "SKIP_BLOCKS_CLOSURE");
  assert.equal(refused.skip_classification.skips[0].platform_legitimate, false);
});

test("P02-SKIP-006 lookup is by reason text as the frozen contract says, and the test identity is still recorded", () => {
  // العقد المُجمَّد يطابق على السبب لا على الاسم (W6-K)، فلا تُخترع هنا هُويّة
  // موازية. لكن الاسم يُحفَظ في السجل: تخطٍّ بلا اسم في الدليل لا يُراجَع.
  const outcome = verdictFor("node", counts({ tests: 10, passed: 9, skipped: 1 }), 0, [skip("a test that was renamed", "a declared non-blocking reason")], STUB_REGISTRY);
  assert.equal(outcome.verdict, "PASS");
  assert.equal(outcome.skip_classification.skips[0].test_name, "a test that was renamed");
  // TODO ليس تخطّيًا مُعلنًا مهما كان نصّه: اختبار مؤجَّل ادعاء بلا قياس.
  const deferred = verdictFor("node", counts({ tests: 10, passed: 9, todo: 1 }), 0, [skip("t", "a declared non-blocking reason", "TODO")], STUB_REGISTRY);
  assert.equal(deferred.verdict, "INCONCLUSIVE");
  assert.equal(deferred.reason, "UNEXPLAINED_SKIP");
});

test("P02-SKIP-007 the node TAP skip directive is parsed with its reason, nested and top level", () => {
  const tap = [
    "TAP version 13",
    "ok 1 - plain pass",
    "    ok 1 - nested skip # SKIP junction creation needs a native Windows run",
    "ok 2 - outer",
    "ok 3 - top skip # SKIP the /proc handle probe is a Linux-native check",
    "ok 4 - a todo # TODO later",
    "not ok 5 - a real failure",
    "# tests 6",
    "",
  ].join("\r\n");
  const parsed = parseTapTests(tap);
  const skipped = parsed.filter((entry) => entry.status === "SKIPPED");
  assert.equal(skipped.length, 3);
  assert.equal(skipped[0].name, "nested skip");
  // هذا هو العيب نفسه: السبب كان يُسقَط هنا، فيصل الحَكَم بلا ما يحكم بغيابه.
  assert.equal(skipped[0].reason, "junction creation needs a native Windows run");
  assert.equal(skipped[1].reason, "the /proc handle probe is a Linux-native check");
  assert.equal(skipped[2].directive, "TODO");
  assert.equal(parsed.filter((entry) => entry.status === "FAIL").length, 1);
  assert.equal(parsed.filter((entry) => entry.status === "PASS").length, 2);
});

test("P02-SKIP-008 a summary that outnumbers the observed skip records is INCONCLUSIVE", () => {
  const tests = [skip("one", "a declared non-blocking reason"), skip("two", "a declared non-blocking reason")];
  const outcome = verdictFor("node", counts({ tests: 505, passed: 502, skipped: 3 }), 0, tests, STUB_REGISTRY);
  assert.equal(outcome.verdict, "INCONCLUSIVE");
  assert.match(outcome.reason, /^SKIP_COUNT_DOES_NOT_RECONCILE \(records=2, summary=3\)$/);
});
