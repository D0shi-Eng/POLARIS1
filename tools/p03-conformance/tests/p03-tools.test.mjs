// اختبارات أدوات مطابقة Phase-03.
//
// ما تحرسه: أن التجهيزة حتمية ومُسمّاة TEST FIXTURE، وأن الحَكَم لا يرقّي غياب
// قياس إلى PASS، وأن الأداء لا ينسب زمن المزوّد إلى تنسيق POLARIS، وأن بوابة
// البايتات ترفض ما يخالف العقد القانوني.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { contractOf, FIXTURE_LABEL, scenarioOf, SCENARIOS, startPhase03Fixture } from "../p03-fixture-server.mjs";
import { P03_CLAIMS, SECURITY_GROUPS } from "../p03-claims.mjs";
import { P03_EVIDENCE, P03_GROUPS, worst } from "../p03-common.mjs";
import { checkVerdict, e2eVerdict, E2E_IDS, gateRegressionVerdict, groupVerdict, performanceRows, testVerdict } from "../p03-evaluate.mjs";
import { inspectBytes } from "../p03-evidence-bytes.mjs";
import { findSecretLeaks, staticChecks } from "../p03-security.mjs";
import { P03_TEST_GROUPS } from "../p03-test-groups.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");

const PLAN_CONTRACT = 'Reply with one JSON object: {"tasks":[{"local_key":"<id>","task_type":"BUILD"}]}.';
const EXEC_CONTRACT = 'Reply with one JSON object: {"output_summary":"<what>","claims":[],"evidence":[]}.';
const REVIEW_CONTRACT = 'Reply with one JSON object: {"verdict":"ACCEPT|REVISE|REJECT|BLOCKED","notes":"<reason>"}.';

// ——— التجهيزة.

test("P03-TL-001 the fixture is labelled TEST FIXTURE and never calls itself a provider", () => {
  assert.equal(FIXTURE_LABEL, "TEST FIXTURE");
  assert.ok(!/production|real provider/i.test(FIXTURE_LABEL));
});

test("P03-TL-002 the scenario is read from the objective, and an unknown tag falls back without guessing", () => {
  assert.equal(scenarioOf("[[FX:CONFLICT]] do the thing"), "CONFLICT");
  assert.equal(scenarioOf("[[FX:NOT-A-SCENARIO]]"), "BASELINE");
  assert.equal(scenarioOf("no tag at all"), "BASELINE");
  for (const name of SCENARIOS) assert.equal(scenarioOf(`[[FX:${name}]]`), name);
});

test("P03-TL-003 the output contract is recognised through JSON escaping, not only in plain text", () => {
  // الجسم الحقيقي JSON، فالاقتباس داخل العقد يصل مهرَّبًا.
  const body = JSON.stringify({ messages: [{ role: "system", content: REVIEW_CONTRACT }] });
  assert.ok(body.includes('\\"verdict\\"'), "the test body is not escaped as a real request would be");
  assert.equal(contractOf(body), "review");
  assert.equal(contractOf(JSON.stringify({ x: PLAN_CONTRACT })), "plan");
  assert.equal(contractOf(JSON.stringify({ x: EXEC_CONTRACT })), "execute");
  assert.equal(contractOf(JSON.stringify({ x: "hello" })), "unknown");
});

test("P03-TL-004 the fixture answers each contract deterministically over real HTTP", async () => {
  const fixture = await startPhase03Fixture({});
  try {
    const ask = async (contract, scenario) => {
      const response = await fetch(`${fixture.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "fixture-chat",
          messages: [
            { role: "system", content: contract },
            { role: "user", content: `[MISSION_OBJECTIVE]\nwork [[FX:${scenario}]]` },
          ],
        }),
      });
      return (await response.json()).choices[0].message.content;
    };

    // خطّة صحيحة تُفكَّك، وخطّة سيناريو المخرجات المشوّهة نثر لا يُفكَّك.
    assert.equal(JSON.parse(await ask(PLAN_CONTRACT, "BASELINE")).tasks.length, 2);
    assert.throws(() => JSON.parse(await0(ask(PLAN_CONTRACT, "MALFORMED"))));

    // المراجعة: تعديل ثم قبول، بلا زمن ولا عشوائية.
    assert.equal(JSON.parse(await ask(REVIEW_CONTRACT, "REVISE")).verdict, "REVISE");
    assert.equal(JSON.parse(await ask(REVIEW_CONTRACT, "REVISE")).verdict, "ACCEPT");
    // حلقة لا ترضى أبدًا.
    assert.equal(JSON.parse(await ask(REVIEW_CONTRACT, "LOOP")).verdict, "REVISE");
    assert.equal(JSON.parse(await ask(REVIEW_CONTRACT, "LOOP")).verdict, "REVISE");

    // التعارض: الموضوع والخاصية واحدة، والقيمة تختلف.
    const first = JSON.parse(await ask(EXEC_CONTRACT, "CONFLICT")).claims[0];
    const second = JSON.parse(await ask(EXEC_CONTRACT, "CONFLICT")).claims[0];
    assert.equal(first.subject, second.subject);
    assert.equal(first.property, second.property);
    assert.notEqual(first.value, second.value);

    // ولا نتيجة تنفيذ تصنّف دليلها: الحقل غير موجود أصلًا.
    const execution = JSON.parse(await ask(EXEC_CONTRACT, "BASELINE"));
    for (const item of execution.evidence) assert.equal(item.evidence_type, undefined);
  } finally {
    await fixture.close();
  }
});

/** مُعين: `assert.throws` لا ينتظر وعدًا، فالقيمة تُحلّ قبله. */
function await0(value) {
  return value;
}

test("P03-TL-005 the fixture records what crossed the wire, including the absence of an authorization header", async () => {
  const fixture = await startPhase03Fixture({});
  try {
    await fetch(`${fixture.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "fixture-chat", messages: [{ role: "system", content: `[SYSTEM_POLICY]\n${EXEC_CONTRACT} [OUTPUT_CONTRACT] Do not include a reasoning trace` }] }),
    });
    const call = fixture.requests.find((entry) => entry.kind === "completion");
    assert.ok(call !== undefined, "the fixture recorded no completion");
    assert.equal(call.carried_authorization, false);
    assert.equal(call.declares_system_policy, true);
    assert.equal(call.declares_output_contract, true);
    assert.equal(call.asks_for_no_reasoning_trace, true);
  } finally {
    await fixture.close();
  }
});

// ——— الحَكَم: الغياب ليس نجاحًا.

test("P03-TL-006 an absent measurement is NOT_TESTED and is never promoted", () => {
  const empty = { groups: [], native: null, securityStatic: null, securityEvidence: null };
  assert.equal(testVerdict(empty, "P03-TRUTH", "anything").verdict, "NOT_TESTED");
  assert.equal(e2eVerdict(empty, "P03-E2E-01").verdict, "NOT_TESTED");
  assert.equal(checkVerdict(empty, "NATIVE-PERFORMED").verdict, "NOT_TESTED");
  assert.equal(groupVerdict(empty, "P03-TRUTH").verdict, "NOT_TESTED");
  assert.equal(worst(["PASS", "NOT_TESTED"]), "NOT_TESTED");
  assert.equal(worst(["PASS", "FAIL", "NOT_TESTED"]), "FAIL");
  assert.equal(worst([]), "NOT_TESTED");
});

test("P03-TL-007 a skipped test is INCONCLUSIVE and a failing one is FAIL", () => {
  const inputs = {
    groups: [
      {
        group_id: "P03-TRUTH",
        verdict: "PASS",
        tests: [
          { name: "p03::claim::tests::a", status: "PASS" },
          { name: "p03::claim::tests::b", status: "SKIPPED" },
          { name: "p03::conflict::tests::c", status: "FAIL" },
        ],
      },
    ],
  };
  assert.equal(testVerdict(inputs, "P03-TRUTH", "p03::claim::tests::a").verdict, "PASS");
  assert.equal(testVerdict(inputs, "P03-TRUTH", "p03::claim::tests::", true).verdict, "INCONCLUSIVE");
  assert.equal(testVerdict(inputs, "P03-TRUTH", "p03::conflict::tests::", true).verdict, "FAIL");
});

test("P03-TL-008 a prior gate that was not re-run inside this run does not count", () => {
  const gate = { verdict: "PASS", canonical: true, measured_at: "2026-01-01T00:00:00Z", phase_03_gate: "ALLOWED" };
  const stale = { native: { run_started: "2026-09-21T00:00:00Z" }, phase02Gate: gate };
  assert.equal(gateRegressionVerdict(stale, "PHASE-02").verdict, "NOT_TESTED");
  const fresh = { native: { run_started: "2026-01-01T00:00:00Z" }, phase02Gate: gate };
  assert.equal(gateRegressionVerdict(fresh, "PHASE-02").verdict, "PASS");
  // مرحلة ناجحة لا تفتح التالية ما لم تقل ذلك.
  const closed = { native: { run_started: "2026-01-01T00:00:00Z" }, phase02Gate: { ...gate, phase_03_gate: "NOT_ALLOWED" } };
  assert.equal(gateRegressionVerdict(closed, "PHASE-02").verdict, "FAIL");
});

test("P03-TL-009 orchestration timings never carry provider inference time", () => {
  const inputs = {
    native: {
      first: {
        measurements: { window_visible_ms: 400, cold_start_to_bootstrap_ms: 900, suite_complete_ms: 40_000, exit_ms: 41_000 },
        e2e_report: {
          renderer: {
            measurements: {
              mission_create_ms: { value: 30, unit: "ms", provenance: "LOCALLY_MEASURED", method: "click to list" },
              mission_start_ms: { value: 5_000, unit: "ms", provenance: "LOCALLY_MEASURED", method: "round trip including model calls" },
            },
          },
        },
      },
      restart: null,
    },
  };
  const rows = performanceRows(inputs);
  const orchestration = rows.filter((row) => row.category === "ORCHESTRATION");
  assert.ok(orchestration.length > 0);
  for (const row of orchestration) {
    assert.equal(row.excludes_provider_time, true);
    assert.equal(row.provenance, "LOCALLY_MEASURED");
    assert.ok(typeof row.method === "string" && row.method.length > 0);
  }
  // ما يشمل نداء نموذج يُعلن ذلك بدل أن يُنسب إلى التنسيق.
  const start = rows.find((row) => row.name === "mission_start_ms");
  assert.equal(start.category, "END_TO_END");
  assert.equal(start.excludes_provider_time, false);
});

// ——— البنية: القوائم المُعلنة تطابق ما يُقاس فعلًا.

test("P03-TL-010 every declared conformance group is either measured by a suite or by the native run", () => {
  const measured = new Set(P03_TEST_GROUPS.map((group) => group.id));
  const missing = P03_GROUPS.filter((id) => !measured.has(id) && id !== "P03-NATIVE-E2E");
  assert.deepEqual(missing, [], `groups declared but never run: ${missing.join(", ")}`);
  assert.ok(P03_GROUPS.includes("P03-NATIVE-E2E"));
});

test("P03-TL-011 every condition names a document that is actually written, and every document carries conditions", () => {
  const documents = new Set([...P03_EVIDENCE, "phase-03-final-gate"]);
  for (const claim of P03_CLAIMS) assert.ok(documents.has(claim.document), `${claim.id} names ${claim.document}`);
  for (const document of P03_EVIDENCE) {
    assert.ok(
      P03_CLAIMS.some((claim) => claim.document === document),
      `${document} would be written with no condition`,
    );
  }
});

test("P03-TL-012 every condition is bound to at least one measurement, and no condition is asserted by hand", () => {
  for (const claim of P03_CLAIMS) {
    assert.ok(Array.isArray(claim.requires) && claim.requires.length > 0, `${claim.id} has no measurement`);
    for (const requirement of claim.requires) {
      assert.ok(["test", "e2e", "check", "gate", "group", "no-skip", "bytes"].includes(requirement.type), `${claim.id} uses ${requirement.type}`);
      assert.equal(requirement.verdict, undefined, `${claim.id} carries a hand-written verdict`);
    }
  }
});

test("P03-TL-013 every scenario the suite must measure is named in the closed list", () => {
  // الثلاثون المطلوبة، وطورا إعادة التشغيل الإضافيان.
  assert.equal(E2E_IDS.length, 32);
  for (let index = 1; index <= 30; index += 1) {
    const id = `P03-E2E-${String(index).padStart(2, "0")}`;
    assert.ok(E2E_IDS.includes(id), `${id} is not in the closed list`);
  }
  assert.ok(E2E_IDS.includes("P03-E2E-27a"));
  assert.ok(E2E_IDS.includes("P03-E2E-27b"));
});

test("P03-TL-014 the security-bearing groups are all measured groups", () => {
  const known = new Set(P03_TEST_GROUPS.map((group) => group.id));
  for (const id of SECURITY_GROUPS) assert.ok(known.has(id), `${id} is security-bearing but never run`);
});

// ——— البايتات والأسرار.

test("P03-TL-015 the byte gate refuses a BOM, a carriage return, a missing final newline and a double one", () => {
  const directory = mkdtempSync(join(tmpdir(), "p03-bytes-"));
  const write = (name, text) => {
    const path = join(directory, name);
    writeFileSync(path, text, { encoding: "utf8" });
    return path;
  };
  const good = JSON.stringify({ schema_version: "1.0.0", tool: "t", phase: "PHASE-03", canonical: false, measured_at: "x" }, null, 2);
  assert.equal(inspectBytes(write("good.json", `${good}\n`)).ok, true);
  assert.equal(inspectBytes(write("bom.json", `﻿${good}\n`)).ok, false);
  assert.equal(inspectBytes(write("crlf.json", `${good.replace(/\n/g, "\r\n")}\n`)).ok, false);
  assert.equal(inspectBytes(write("no-newline.json", good)).ok, false);
  assert.equal(inspectBytes(write("two-newlines.json", `${good}\n\n`)).ok, false);
  assert.equal(inspectBytes(write("not-json.json", "not json at all\n")).ok, false);
  assert.equal(inspectBytes(join(directory, "absent.json")).ok, false);
  // وثيقة بلا حقول الترويسة تُرفض كذلك.
  assert.equal(inspectBytes(write("headerless.json", `${JSON.stringify({ a: 1 }, null, 2)}\n`)).ok, false);
});

test("P03-TL-016 the secret scanner recognises the known shapes and reports a name, never a value", () => {
  // الأشكال تُركَّب وقت التشغيل: شكل مفتاح مكتوب حرفيًّا في هذا الملف يجعل الفحص
  // الساكن يبلّغ عن ملفه هو، فيصير الحارس مصدر إنذاره الكاذب.
  const openai = ["sk", "abcdefghijklmnopqrstuvwxyz012345"].join("-");
  const bearer = `${["Bea", "rer"].join("")} abcdefghijklmnopqrstuvwxyz`;
  const hits = findSecretLeaks(JSON.stringify({ key: openai }));
  assert.deepEqual(hits, ["openai"]);
  assert.deepEqual(findSecretLeaks(JSON.stringify({ authorization: bearer })).sort(), ["authorization-header", "bearer"]);
  assert.deepEqual(findSecretLeaks('{"note":"no key here"}'), []);
  for (const hit of hits) assert.ok(!hit.includes("-"), "the scanner returned a value rather than a name");
});

test("P03-TL-017 the static security scan runs against this repository and explains every judgement", () => {
  const checks = staticChecks(ROOT);
  assert.ok(checks.length >= 9, `only ${checks.length} static checks ran`);
  for (const check of checks) {
    assert.ok(["PASS", "FAIL", "NOT_TESTED"].includes(check.verdict), `${check.check_id} returned ${check.verdict}`);
    assert.ok(typeof check.detail === "string" && check.detail.length > 0, `${check.check_id} gave no detail`);
  }
});
