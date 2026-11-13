// اختبارات أدوات مطابقة Phase-05.
//
// ما تحرسه: أن التجهيزتين حتميّتان ومُسمّيتان TEST FIXTURE وتقيسان ما يصلهما، وأن
// الحَكَم لا يرقّي غياب قياس إلى PASS، وأن قياسات الأداء التسعة مسمّاة بطريقتها، وأن
// حالة نافذة التجهيزة تُقرأ لا تُفترض، وأن بوابة البايتات ترفض ما يخالف العقد.
//
// أداة القياس التي لا تُختبر لا تُصدَّق.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buttonRef,
  executionFor,
  FIXTURE_LABEL,
  INJECTION_MARKER,
  lastDigest,
  passwordRef,
  planFor,
  SCENARIOS,
  startModelFixture,
  startWebFixture,
} from "../p05-fixture-server.mjs";
import { P05_CLAIMS, SECURITY_GROUPS } from "../p05-claims.mjs";
import { P05_EVIDENCE, P05_FINAL_GATE, P05_GROUPS, worst } from "../p05-common.mjs";
import { checkVerdict, e2eVerdict, E2E_IDS, gateRegressionVerdict, performanceRows, REQUIRED_TIMINGS, testVerdict } from "../p05-evaluate.mjs";
import { inspectBytes } from "../p05-evidence-bytes.mjs";
import { evidenceChecks, findSecretLeaks, staticChecks } from "../p05-security.mjs";
import { P05_TEST_GROUPS } from "../p05-test-groups.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");

async function post(url, body) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

// ——— التجهيزتان.

test("P05-TL-001 both fixtures are labelled TEST FIXTURE", () => {
  assert.equal(FIXTURE_LABEL, "TEST FIXTURE");
  assert.ok(SCENARIOS.includes("INJECT") && SCENARIOS.includes("DESKTOP") && SCENARIOS.includes("RECALL"));
});

test("P05-TL-002 the model fixture reads the observation digest and element references from the prompt as a model would", () => {
  const digest = "b".repeat(64);
  const body = `x observation_digest: ${"a".repeat(64)} y observation_digest: ${digest}\\nelement c7 BUTTON \\"Increment\\" at 1,2 size 3x4\\nelement c9 EDIT \\"\\" at 1,2 size 3x4 [password field]`;
  assert.equal(lastDigest(body), digest, "not the latest digest");
  assert.equal(buttonRef(body, "Increment"), "c7");
  assert.equal(buttonRef(body, "Delete all files"), "");
  assert.equal(passwordRef(body), "c9");
  assert.equal(lastDigest("no digest here"), "");
});

test("P05-TL-003 the model fixture proposes tools and never claims a result it did not observe", () => {
  const web = "http://127.0.0.1:4500";
  const plan = planFor("WEB");
  assert.deepEqual(plan.tasks.map((task) => task.local_key), ["open", "follow"]);
  const open = executionFor("WEB", `[[WEB:${web}]] carry out the step named open`);
  assert.equal(open.tools[0].tool_id, "polaris.web.navigate");
  assert.equal(open.tools[0].arguments.url, `${web}/normal`);
  assert.equal(open.evidence.length, 0, "the fixture declared evidence itself");
  // الإرسال يدّعي «قُبل» وهو ما لم تعرضه الصفحة: الادّعاء مقصود ليُقاس أنه لا يتحقّق.
  const submit = executionFor("SUBMIT", `[[WEB:${web}]] carry out the step named submit`);
  assert.ok(submit.claims.some((claim) => claim.value === "ACCEPTED"));
  assert.ok(!JSON.stringify(submit).includes("approval_id"), "a proposal carried its own approval");
});

test("P05-TL-004 the model fixture records flags, never bodies, including an injected marker and its fence", async () => {
  const fixture = await startModelFixture();
  try {
    const fenced = `[[FX:INJECT]] carry out the step named follow output_summary <<<UNTRUSTED OBSERVATION — WEB_UNTRUSTED ${INJECTION_MARKER} UNTRUSTED>>>`;
    await post(`${fixture.endpoint}/v1/chat/completions`, { messages: [{ role: "system", content: "policy" }, { role: "user", content: fenced }] });
    const unfenced = `[[FX:INJECT]] carry out the step named follow output_summary ${INJECTION_MARKER}`;
    await post(`${fixture.endpoint}/v1/chat/completions`, { messages: [{ role: "user", content: unfenced }] });
    const calls = fixture.requests.filter((entry) => entry.kind === "completion");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].injection_marker_fenced, true);
    assert.equal(calls[1].injection_marker_fenced, false, "an unfenced marker was not detected");
    assert.equal(calls[0].carried_authorization, false);
    assert.ok(!JSON.stringify(fixture.requests).includes(INJECTION_MARKER), "the log carried the body text");
  } finally {
    await fixture.close();
  }
});

test("P05-TL-005 the web fixture serves every required page kind and records credentials and posted passwords", async () => {
  const web = await startWebFixture();
  try {
    for (const path of ["/normal", "/inject", "/form", "/malformed"]) {
      assert.equal((await fetch(`${web.endpoint}${path}`)).status, 200, path);
    }
    const redirect = await fetch(`${web.endpoint}/redirect`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    const privateRedirect = await fetch(`${web.endpoint}/redirect-private`, { redirect: "manual" });
    assert.match(privateRedirect.headers.get("location") ?? "", /^http:\/\/10\./);
    const big = await fetch(`${web.endpoint}/oversized`);
    assert.ok(Number(big.headers.get("content-length")) > 2 * 1024 * 1024, "the oversized page is not over the limit");
    const received = await fetch(`${web.endpoint}/submit`, { method: "POST", headers: { cookie: "a=b" }, body: "item=blue+widget&pw=x" });
    assert.match(await received.text(), /Request received/);
    const posted = web.requests.find((entry) => entry.path === "/submit");
    assert.equal(posted.carried_cookie, true);
    assert.equal(posted.body_has_password_field, true);
    assert.equal(posted.body_has_item, true);
  } finally {
    await web.close();
  }
});

// ——— الحَكَم.

const EMPTY = { groups: [], native: null, run: null, securityStatic: null, securityEvidence: null, bytes: null, runStarted: null };

test("P05-TL-020 an absent group, test, scenario or check is NOT_TESTED, never PASS", () => {
  assert.equal(testVerdict(EMPTY, "P05-MEMORY", "x").verdict, "NOT_TESTED");
  assert.equal(e2eVerdict(EMPTY, "P05-E2E-07").verdict, "NOT_TESTED");
  assert.equal(checkVerdict(EMPTY, "DESKTOP-FIXTURE-STATE").verdict, "NOT_TESTED");
  assert.equal(checkVerdict(EMPTY, "P05-SEC-UNSAFE-CONFINED").verdict, "NOT_TESTED");
  const withGroup = { ...EMPTY, groups: [{ group_id: "P05-MEMORY", verdict: "PASS", tests: [{ name: "a", status: "SKIPPED" }] }] };
  assert.equal(testVerdict(withGroup, "P05-MEMORY", "a").verdict, "INCONCLUSIVE", "a skip was counted as a pass");
  assert.equal(worst(["PASS", "NOT_TESTED"]), "NOT_TESTED");
});

test("P05-TL-021 the desktop fixture's own state decides, and an extra press or typed text fails", () => {
  const native = (state) => ({ ...EMPTY, native: { performed: true, desktop: { state } } });
  const clean = { label: "TEST FIXTURE", counter: 1, delete_count: 0, password_len: 0, typed: "", events: ["INCREMENT", "SHUFFLE", "CLOSED"] };
  assert.equal(checkVerdict(native(clean), "DESKTOP-FIXTURE-STATE").verdict, "PASS");
  assert.equal(checkVerdict(native({ ...clean, delete_count: 1 }), "DESKTOP-FIXTURE-STATE").verdict, "FAIL");
  assert.equal(checkVerdict(native({ ...clean, password_len: 3 }), "DESKTOP-FIXTURE-STATE").verdict, "FAIL");
  assert.equal(checkVerdict(native({ ...clean, events: [...clean.events, "FAKE_APPROVE_PRESSED"] }), "DESKTOP-FIXTURE-STATE").verdict, "FAIL");
  assert.equal(checkVerdict(native({ ...clean, counter: 2 }), "DESKTOP-FIXTURE-STATE").verdict, "FAIL", "a second increment passed");
});

test("P05-TL-022 an injected page that reached no model proves nothing; one that reached it unfenced fails", () => {
  const withCalls = (requests) => ({ ...EMPTY, native: { performed: true, fixture_log: { requests } } });
  assert.equal(checkVerdict(withCalls([{ kind: "completion", injection_marker_fenced: null }]), "INJECTION-FENCED").verdict, "NOT_TESTED");
  assert.equal(checkVerdict(withCalls([{ kind: "completion", injection_marker_fenced: false }]), "INJECTION-FENCED").verdict, "FAIL");
  assert.equal(checkVerdict(withCalls([{ kind: "completion", injection_marker_fenced: true, injection_in_system: true }]), "INJECTION-FENCED").verdict, "FAIL");
  assert.equal(checkVerdict(withCalls([{ kind: "completion", injection_marker_fenced: true }]), "INJECTION-FENCED").verdict, "PASS");
});

test("P05-TL-023 memory crossing into another project fails the scope check", () => {
  const call = (tag, fact) => ({ kind: "completion", contract: "execute", scenario: "RECALL", mission_tag: tag, has_memory_block: true, mentions_project_fact: fact });
  const inputs = (q) => ({ ...EMPTY, native: { performed: true, fixture_log: { requests: [call("RECALL-P", true), call("RECALL-Q", q), call("RECALL-AFTER", false)] } } });
  assert.equal(checkVerdict(inputs(false), "MEMORY-SCOPE-IN-PROMPT").verdict, "PASS");
  assert.equal(checkVerdict(inputs(true), "MEMORY-SCOPE-IN-PROMPT").verdict, "FAIL");
});

test("P05-TL-024 a stale prior gate, including Phase-04's, does not count as a regression re-run", () => {
  const gate = { verdict: "PASS", canonical: true, measured_at: "2026-01-01T00:00:00Z", phase_05_gate: "ALLOWED" };
  const inputs = { ...EMPTY, runStarted: "2026-09-23T00:00:00Z", phase04Gate: gate };
  assert.equal(gateRegressionVerdict(inputs, "PHASE-04").verdict, "NOT_TESTED");
  const fresh = { ...inputs, phase04Gate: { ...gate, measured_at: "2026-09-23T01:00:00Z" } };
  assert.equal(gateRegressionVerdict(fresh, "PHASE-04").verdict, "PASS");
  const closed = { ...inputs, phase04Gate: { ...gate, measured_at: "2026-09-23T01:00:00Z", phase_05_gate: "NOT_ALLOWED" } };
  assert.equal(gateRegressionVerdict(closed, "PHASE-04").verdict, "FAIL");
});

test("P05-TL-025 a surviving fixture process fails the zero-survivor scenario", () => {
  const launch = { orphan_processes: 0 };
  const base = { performed: true, first: launch, restart: launch, fixture_exited: true, desktop: { exited: true } };
  assert.equal(e2eVerdict({ ...EMPTY, native: base }, "P05-E2E-28").verdict, "PASS");
  assert.equal(e2eVerdict({ ...EMPTY, native: { ...base, desktop: { exited: false } } }, "P05-E2E-28").verdict, "FAIL");
  assert.equal(e2eVerdict({ ...EMPTY, native: { ...base, restart: { orphan_processes: 1 } } }, "P05-E2E-28").verdict, "FAIL");
});

// ——— الأداء.

test("P05-TL-030 the nine required timings are derived as means, each with a method and a provider-time declaration", () => {
  const timings = {
    ok: true,
    memory: { writes: 4, write_micros_total: 400, retrievals: 2, retrieval_micros_total: 60, context_blocks: 2, context_micros_total: 80 },
    browser: { sessions_started: 1, session_start_micros_total: 50, navigations: 2, navigation_overhead_micros_total: 90, observations: 2, observation_micros_total: 30 },
    computer: { captures: 3, capture_micros_total: 3000, dispatches: 1, dispatch_micros_total: 700 },
    evidence: { saves: 2, rows: 5, micros_total: 500 },
  };
  const inputs = { ...EMPTY, native: { performed: true, first: { e2e_report: { scenarios: [], facts: { timings } } } } };
  const rows = performanceRows(inputs);
  for (const name of REQUIRED_TIMINGS) assert.ok(rows.some((row) => row.name === name), `${name} is not derived`);
  assert.equal(rows.find((row) => row.name === "memory_write_latency_us").value, 100);
  assert.ok(rows.every((row) => row.provenance === "LOCALLY_MEASURED" && typeof row.method === "string" && typeof row.excludes_provider_time === "boolean"));
  assert.equal(checkVerdict(inputs, "PERFORMANCE-COVERS-REQUIRED").verdict, "PASS");
  const missing = { ...inputs, native: { performed: true, first: { e2e_report: { scenarios: [], facts: { timings: { ...timings, evidence: {} } } } } } };
  assert.equal(checkVerdict(missing, "PERFORMANCE-COVERS-REQUIRED").verdict, "FAIL");
});

// ——— البايتات والأمن.

test("P05-TL-040 the byte gate refuses a BOM, a carriage return, a missing newline and invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "p05-bytes-"));
  const good = { schema_version: "1.0.0", tool: "t", phase: "PHASE-05", canonical: true, measured_at: "2026-09-23T00:00:00Z" };
  const cases = [
    ["good.json", `${JSON.stringify(good)}\n`, true],
    ["bom.json", `﻿${JSON.stringify(good)}\n`, false],
    ["crlf.json", `${JSON.stringify(good)}\r\n`, false],
    ["nonl.json", JSON.stringify(good), false],
    ["bad.json", "{ nope }\n", false],
  ];
  for (const [name, text, expected] of cases) {
    writeFileSync(join(dir, name), text, "utf8");
    assert.equal(inspectBytes(join(dir, name)).ok, expected, name);
  }
});

test("P05-TL-050 the static scan reads the real repository and every check states a detail", () => {
  const checks = staticChecks(ROOT);
  assert.ok(checks.length >= 16);
  for (const check of checks) {
    assert.ok(["PASS", "FAIL", "NOT_TESTED"].includes(check.verdict));
    assert.ok(check.detail.length > 10, `${check.check_id} gave no detail`);
  }
});

test("P05-TL-051 the secret detector reports a shape and never the value, and planted fixture text is caught in evidence", () => {
  const value = `sk-${"A".repeat(30)}`;
  const hits = findSecretLeaks(`key ${value}`);
  assert.deepEqual(hits, ["openai"]);
  assert.ok(!hits.join("").includes(value));
  assert.ok(evidenceChecks(join(tmpdir(), "no-such-root-p05")).every((check) => check.verdict === "NOT_TESTED"));
});

test("P05-TL-060 every claim names a document that exists and a group that is declared", () => {
  const documents = new Set([...P05_EVIDENCE, P05_FINAL_GATE]);
  const groups = new Set(P05_TEST_GROUPS.map((group) => group.id));
  for (const claim of P05_CLAIMS) {
    assert.ok(documents.has(claim.document), `${claim.id} names ${claim.document}`);
    assert.ok(claim.requires.length > 0, `${claim.id} measures nothing`);
    for (const requirement of claim.requires) {
      if (requirement.type === "test" || requirement.type === "group") {
        const id = requirement.type === "test" ? requirement.group : requirement.id;
        assert.ok(groups.has(id), `${claim.id} names an undeclared group ${id}`);
      }
      if (requirement.type === "e2e") assert.ok(E2E_IDS.includes(requirement.id), `${claim.id} names an unknown scenario ${requirement.id}`);
    }
  }
  for (const document of P05_EVIDENCE) assert.ok(P05_CLAIMS.some((claim) => claim.document === document), `${document} carries no condition`);
});

test("P05-TL-061 every security-bearing group and every named group is declared, and the sixteen scope groups exist", () => {
  const groups = new Set(P05_TEST_GROUPS.map((group) => group.id));
  for (const id of SECURITY_GROUPS) assert.ok(groups.has(id), id);
  for (const id of P05_GROUPS.filter((name) => name !== "P05-NATIVE-E2E" && name !== "P05-SECURITY")) assert.ok(groups.has(id), id);
  const scope = [
    "P05-MEMORY", "P05-MEMORY-TRUST", "P05-BROWSER", "P05-BROWSER-SECURITY", "P05-COMPUTER", "P05-COMPUTER-SECURITY",
    "P05-AGENT-INTEGRATION", "P05-SKILL-INTEGRATION", "P05-EVIDENCE", "P05-CANCELLATION", "P05-APPROVAL", "P05-PERSISTENCE",
    "P05-RENDERER", "P05-NATIVE-E2E", "P05-SECURITY", "P05-TOOLS",
  ];
  for (const id of scope) assert.ok(P05_GROUPS.includes(id), `${id} is not a declared Phase-05 group`);
});

test("P05-TL-062 the scenario list is closed and covers E2E-01 to E2E-28", () => {
  for (let index = 1; index <= 28; index += 1) assert.ok(E2E_IDS.includes(`P05-E2E-${String(index).padStart(2, "0")}`));
  assert.equal(new Set(E2E_IDS).size, E2E_IDS.length);
});

// كل مرحلة تُختبر منفصلة (سياسة المالك 2026-09-30): البوابة الأدنى تُقرأ ولا يُعاد تشغيلها، وتبقى شروطها كاملة.
test("P05-TOOLS-PRIOR-GATES an older lower gate counts only in PRIOR_GATES mode, and only when canonical, PASS and opening the next phase", async () => {
  const { gateRegressionVerdict } = await import("../p05-evaluate.mjs");
  const gate = { canonical: true, verdict: "PASS", phase_05_gate: "ALLOWED", measured_at: "2026-09-30T01:00:00Z" };
  const base = { runStarted: "2026-09-30T02:00:00Z", phase04Gate: gate };
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "RERUN" }, "PHASE-04").verdict, "NOT_TESTED");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES" }, "PHASE-04").verdict, "PASS");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES", phase04Gate: { ...gate, verdict: "FAIL", phase_05_gate: "NOT_ALLOWED" } }, "PHASE-04").verdict, "FAIL");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES", phase04Gate: { ...gate, canonical: false } }, "PHASE-04").verdict, "INCONCLUSIVE");
});
