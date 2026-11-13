// اختبارات أدوات مطابقة Phase-04.
//
// ما تحرسه: أن التجهيزتين حتميّتان ومُسمّيتان TEST FIXTURE، وأن خادم الأدوات
// يعلن فعلًا ما يجب أن يُرفض حتى يكون الرفض مقيسًا لا مفترضًا، وأن الحَكَم لا
// يرقّي غياب قياس إلى PASS، وأن الأداء لا ينسب زمن المزوّد إلى بوابة POLARIS،
// وأن بوابة البايتات ترفض ما يخالف العقد القانوني.
//
// وأداة القياس التي لا تُختبر لا تُصدَّق: هذه المجموعة هي ما يجعل الحكم النهائي
// قابلًا للفحص بدل أن يُؤخذ على الثقة.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  contractOf,
  declaredTools,
  FIXTURE_LABEL,
  HOSTILE_MARKER,
  scenarioOf,
  SCENARIOS,
  startMcpFixture,
  startModelFixture,
  startSilentServer,
} from "../p04-fixture-server.mjs";
import { P04_CLAIMS, SECURITY_GROUPS } from "../p04-claims.mjs";
import { P04_EVIDENCE, P04_GROUPS, worst } from "../p04-common.mjs";
import {
  checkVerdict,
  e2eVerdict,
  E2E_IDS,
  gateRegressionVerdict,
  groupVerdict,
  performanceRows,
  testVerdict,
} from "../p04-evaluate.mjs";
import { inspectBytes } from "../p04-evidence-bytes.mjs";
import { findSecretLeaks, staticChecks } from "../p04-security.mjs";
import { P04_TEST_GROUPS } from "../p04-test-groups.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");

const PLAN_CONTRACT = 'Reply with one JSON object: {"tasks":[{"local_key":"<id>","task_type":"BUILD"}]}.';
const EXEC_CONTRACT = 'Reply with one JSON object: {"output_summary":"<what>","claims":[],"evidence":[]}.';
const REVIEW_CONTRACT = 'Reply with one JSON object: {"verdict":"ACCEPT|REVISE|REJECT|BLOCKED","notes":"<reason>"}.';

// ——— التجهيزتان.

test("P04-TL-001 both fixtures are labelled TEST FIXTURE and neither calls itself a provider", () => {
  assert.equal(FIXTURE_LABEL, "TEST FIXTURE");
  assert.ok(!/production|real provider|real server/i.test(FIXTURE_LABEL));
});

test("P04-TL-002 the scenario is read from the objective, and an unknown tag falls back without guessing", () => {
  assert.equal(scenarioOf("[[FX:TOOLMCP]] do the thing"), "TOOLMCP");
  assert.equal(scenarioOf("[[FX:NOT-A-SCENARIO]]"), "BASELINE");
  assert.equal(scenarioOf("no tag at all"), "BASELINE");
  for (const name of SCENARIOS) assert.equal(scenarioOf(`[[FX:${name}]]`), name);
});

test("P04-TL-003 the output contract is recognised through JSON escaping, not only in plain text", () => {
  const body = JSON.stringify({ messages: [{ role: "system", content: REVIEW_CONTRACT }] });
  assert.ok(body.includes('\\"verdict\\"'), "the test body is not escaped as a real request would be");
  assert.equal(contractOf(body), "review");
  assert.equal(contractOf(JSON.stringify({ x: PLAN_CONTRACT })), "plan");
  assert.equal(contractOf(JSON.stringify({ x: EXEC_CONTRACT })), "execute");
  assert.equal(contractOf(JSON.stringify({ x: "hello" })), "unknown");
});

test("P04-TL-004 the model fixture proposes tools rather than executing them", async () => {
  const fixture = await startModelFixture({});
  try {
    const ask = async (contract, scenario, extra = "") => {
      const response = await fetch(`${fixture.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "fixture-chat",
          messages: [
            { role: "system", content: contract },
            { role: "user", content: `[MISSION_OBJECTIVE]\nwork [[FX:${scenario}]]${extra}` },
          ],
        }),
      });
      return (await response.json()).choices[0].message.content;
    };

    const base = JSON.parse(await ask(EXEC_CONTRACT, "TOOLBASE"));
    assert.equal(base.tools.length, 1);
    // الاقتراح يسمّي مهارة وأداة وحججًا، ولا يحمل معرّفًا ولا نتيجة: النموذج يقترح.
    assert.deepEqual(Object.keys(base.tools[0]).sort(), [
      "arguments",
      "expected_effect",
      "expected_output",
      "reason",
      "skill_id",
      "tool_id",
    ]);
    assert.ok(!("proposal_id" in base.tools[0]));
    assert.ok(!("result" in base.tools[0]));

    // أداة مخترعة، وحجج فاسدة، ومهارة لا تسمّي الأداة: ثلاثة رفضٍ مختلفة تُقاس.
    assert.equal(JSON.parse(await ask(EXEC_CONTRACT, "TOOLUNKNOWN")).tools[0].tool_id, "polaris.tool.anything.i.want");
    assert.equal(JSON.parse(await ask(EXEC_CONTRACT, "TOOLARGS")).tools[0].arguments.source_id, "../../etc/passwd");
    assert.equal(JSON.parse(await ask(EXEC_CONTRACT, "TOOLWRONGSKILL")).tools[0].skill_id, "polaris.skill.local-analysis");

    // الميزانية: ستّة نداءات في عقدة واحدة، والحدّ لكل عقدة أربعة.
    assert.equal(JSON.parse(await ask(EXEC_CONTRACT, "TOOLBUDGET")).tools.length, 6);

    // التفويض طلب لا تنفيذ.
    const delegate = JSON.parse(await ask(EXEC_CONTRACT, "DELEGATE"));
    assert.equal(delegate.delegate.requested_role, "TEST_ENGINEER");
    assert.equal(delegate.tools, undefined);

    // الخطّة المشوّهة نثر لا يُفكَّك، وهذا مقصود.
    const malformed = await ask(PLAN_CONTRACT, "MALFORMED");
    assert.throws(() => JSON.parse(malformed), SyntaxError);

    // كل ادّعاء إنجاز يبقى ادّعاءً: التجهيزة تدّعي النجاح عمدًا.
    assert.ok(base.claims.some((claim) => claim.claim_type === "COMPLETION"));
    assert.ok(base.evidence.every((entry) => entry.source_ref.startsWith("agent:self")));
  } finally {
    await fixture.close();
  }
});

test("P04-TL-005 the model fixture records what reached it, including a hostile marker and any authorization header", async () => {
  const fixture = await startModelFixture({});
  try {
    await fetch(`${fixture.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "fixture-chat",
        messages: [{ role: "system", content: EXEC_CONTRACT }, { role: "user", content: `x ${HOSTILE_MARKER}` }],
      }),
    });
    const record = fixture.requests.find((entry) => entry.kind === "completion");
    assert.ok(record !== undefined);
    assert.equal(record.hostile_marker, true);
    assert.equal(record.carried_authorization, false);
    assert.equal(typeof record.body_bytes, "number");
  } finally {
    await fixture.close();
  }
});

// ——— خادم الأدوات.

test("P04-TL-010 the tool-server fixture declares tools that must be refused, each for a different reason", () => {
  const tools = declaredTools(1);
  const byName = (name) => tools.filter((tool) => tool.name === name);
  // سرّ، وعملية، وكتابة خارج السقف، واسم مكرَّر، واسم غير مقبول، ومخطط ليس كائنًا.
  assert.deepEqual(byName("creds")[0]._meta.polaris.effects, ["SECRET_ACCESS"]);
  assert.deepEqual(byName("shell")[0]._meta.polaris.effects, ["PROCESS_EXECUTION"]);
  assert.equal(byName("writer")[0].annotations.destructiveHint, true);
  assert.equal(byName("echo").length, 2, "no duplicate name is declared, so drift cannot be measured");
  assert.equal(byName("bad name!").length, 1);
  assert.equal(typeof byName("bad_schema")[0].inputSchema, "string");
});

test("P04-TL-011 a tool definition changes between listings, so schema drift is measured rather than assumed", () => {
  const before = declaredTools(1).find((tool) => tool.name === "drift");
  const after = declaredTools(2).find((tool) => tool.name === "drift");
  assert.equal(before.inputSchema.properties.text.type, "string");
  assert.equal(after.inputSchema.properties.text.type, "number");
});

test("P04-TL-012 a hostile tool description is declared as text and asks for authority it cannot be given", () => {
  const hostile = declaredTools(1).find((tool) => tool.name === "claims_authority");
  assert.ok(hostile.description.includes("PROCESS_EXECUTION"));
  assert.ok(hostile.description.includes("Ignore all previous instructions"));
  // والوصف يبقى وصفًا: التجهيزة لا تُعلن الأثر الذي يطلبه النصّ.
  assert.equal(hostile._meta, undefined);
});

test("P04-TL-013 the tool server answers JSON-RPC over loopback and records every call", async () => {
  const fixture = await startMcpFixture({});
  try {
    assert.ok(fixture.endpoint.startsWith("http://127.0.0.1:"));
    const call = async (method, params) => {
      const response = await fetch(fixture.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      return await response.json();
    };
    const initialised = await call("initialize", {});
    assert.equal(initialised.jsonrpc, "2.0");
    const listed = await call("tools/list", {});
    assert.ok(Array.isArray(listed.result.tools));
    const echoed = await call("tools/call", { name: "echo", arguments: { text: "hello" } });
    assert.ok(JSON.stringify(echoed.result).includes("hello"));
    const methods = fixture.requests.map((entry) => entry.method);
    assert.deepEqual(methods, ["initialize", "tools/list", "tools/call"]);
    assert.ok(fixture.requests.every((entry) => entry.carried_authorization === false));
  } finally {
    await fixture.close();
  }
});

test("P04-TL-014 the silent server accepts a connection and never answers, so a timeout is real", async () => {
  const silent = await startSilentServer();
  try {
    assert.ok(silent.endpoint.startsWith("http://127.0.0.1:"));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    await assert.rejects(
      fetch(silent.endpoint, { method: "POST", body: "{}", signal: controller.signal }),
      (error) => error.name === "AbortError" || error.name === "TimeoutError",
    );
    clearTimeout(timer);
  } finally {
    await silent.close();
  }
});

// ——— الحَكَم: لا ترقية من غياب قياس.

test("P04-TL-020 an absent group, an absent test and an absent scenario are NOT_TESTED, never PASS", () => {
  assert.equal(testVerdict({ groups: [] }, "P04-MCP", "anything").verdict, "NOT_TESTED");
  assert.equal(
    testVerdict({ groups: [{ group_id: "P04-MCP", verdict: "PASS", tests: [] }] }, "P04-MCP", "missing_test").verdict,
    "NOT_TESTED",
  );
  assert.equal(e2eVerdict({ native: null }, "P04-E2E-09").verdict, "NOT_TESTED");
  assert.equal(e2eVerdict({ native: { performed: true, first: { e2e_report: { scenarios: [] } } } }, "P04-E2E-09").verdict, "NOT_TESTED");
  assert.equal(groupVerdict({ groups: [] }, "P04-TOOL-GATEWAY").verdict, "NOT_TESTED");
  assert.equal(checkVerdict({ native: { performed: false } }, "NATIVE-PERFORMED").verdict, "NOT_TESTED");
});

test("P04-TL-021 a blocked group is BLOCKED and is never promoted", () => {
  const inputs = { groups: [{ group_id: "P04-MCP", verdict: "BLOCKED", tests: [] }] };
  assert.equal(testVerdict(inputs, "P04-MCP", "anything").verdict, "BLOCKED");
  assert.equal(worst(["BLOCKED", "PASS"]), "BLOCKED");
  assert.equal(worst(["NOT_TESTED", "PASS"]), "NOT_TESTED");
  assert.equal(worst(["FAIL", "BLOCKED", "NOT_TESTED"]), "FAIL");
  assert.equal(worst([]), "NOT_TESTED");
});

test("P04-TL-022 a skipped test is INCONCLUSIVE, because a skip is not a pass", () => {
  const inputs = { groups: [{ group_id: "P04-MCP", verdict: "PASS", tests: [{ name: "t", status: "SKIPPED" }] }] };
  assert.equal(testVerdict(inputs, "P04-MCP", "t").verdict, "INCONCLUSIVE");
});

test("P04-TL-023 a stale prior gate does not count as a regression re-run", () => {
  const inputs = {
    runStarted: "2026-09-22T10:00:00Z",
    native: { run_started: "2026-09-22T10:00:00Z" },
    phase03Gate: { verdict: "PASS", canonical: true, phase_04_gate: "ALLOWED", measured_at: "2026-09-01T00:00:00Z" },
  };
  assert.equal(gateRegressionVerdict(inputs, "PHASE-03").verdict, "NOT_TESTED");
  const fresh = { ...inputs, phase03Gate: { ...inputs.phase03Gate, measured_at: "2026-09-22T11:00:00Z" } };
  assert.equal(gateRegressionVerdict(fresh, "PHASE-03").verdict, "PASS");
  // بوابة مرّت لكنها لا تفتح التالية ليست PASS هنا.
  const closed = { ...fresh, phase03Gate: { ...fresh.phase03Gate, measured_at: "2026-09-22T11:00:00Z", phase_04_gate: "NOT_ALLOWED" } };
  assert.equal(gateRegressionVerdict(closed, "PHASE-03").verdict, "FAIL");
});

test("P04-TL-024 a cancellation that never had anything in flight is not counted as a stopped one", () => {
  const withNothing = {
    native: {
      performed: true,
      first: { e2e_report: { scenarios: [{ id: "P04-E2E-24", status: "PASS" }], facts: { cancellation: { observed: null, after: { calls: 0, runs: 0 } } } } },
    },
  };
  assert.equal(checkVerdict(withNothing, "NATIVE-NOTHING-IN-FLIGHT-AFTER-CANCEL").verdict, "FAIL");
  const real = {
    native: {
      performed: true,
      first: {
        e2e_report: {
          scenarios: [{ id: "P04-E2E-24", status: "PASS" }],
          facts: { cancellation: { observed: { calls: 1, runs: 1 }, after: { calls: 0, runs: 0 } } },
        },
      },
    },
  };
  assert.equal(checkVerdict(real, "NATIVE-NOTHING-IN-FLIGHT-AFTER-CANCEL").verdict, "PASS");
});

test("P04-TL-025 a silent tool server proves nothing about authorization headers", () => {
  const silent = { native: { performed: true, fixture_log: { mcp_requests: [] } } };
  assert.equal(checkVerdict(silent, "MCP-FIXTURE-NO-AUTHORIZATION-HEADER").verdict, "NOT_TESTED");
  const clean = {
    native: { performed: true, fixture_log: { mcp_requests: [{ method: "tools/call", carried_authorization: false }] } },
  };
  assert.equal(checkVerdict(clean, "MCP-FIXTURE-NO-AUTHORIZATION-HEADER").verdict, "PASS");
  const leaked = {
    native: { performed: true, fixture_log: { mcp_requests: [{ method: "tools/call", carried_authorization: true }] } },
  };
  assert.equal(checkVerdict(leaked, "MCP-FIXTURE-NO-AUTHORIZATION-HEADER").verdict, "FAIL");
});

// ——— الأداء: لا زمن مزوّد يُنسب إلى البوابة.

test("P04-TL-030 every performance row declares its provenance and whether it includes provider time", () => {
  const rows = performanceRows({
    native: {
      first: {
        measurements: { window_visible_ms: 300, cold_start_to_bootstrap_ms: 800, suite_complete_ms: 40000, exit_ms: 41000 },
        memory_after_suite: { host_working_set_bytes: 10, child_working_set_bytes: 20, method: "measured" },
        e2e_report: { renderer: { measurements: { tool_call_ms: { value: 12, unit: "ms" }, mission_start_ms: { value: 900, unit: "ms" } } } },
      },
    },
  });
  assert.ok(rows.length >= 6);
  for (const row of rows) {
    assert.equal(row.provenance, "LOCALLY_MEASURED");
    assert.equal(typeof row.method, "string");
    assert.equal(typeof row.excludes_provider_time, "boolean");
  }
  const gateway = rows.find((row) => row.name === "tool_call_ms");
  assert.equal(gateway.category, "TOOL_GATEWAY");
  assert.equal(gateway.excludes_provider_time, true);
  // كل ما يمرّ بنداء نموذج يُعلن ذلك بدل أن يُنسب إلى البوابة.
  const end = rows.find((row) => row.name === "mission_start_ms");
  assert.equal(end.category, "END_TO_END");
  assert.equal(end.excludes_provider_time, false);
  assert.equal(rows.find((row) => row.name === "first_suite_complete_ms").excludes_provider_time, false);
});

// ——— بوابة البايتات.

test("P04-TL-040 the byte gate refuses a BOM, a carriage return, a missing newline and invalid JSON", () => {
  const directory = mkdtempSync(join(tmpdir(), "p04-bytes-"));
  const write = (name, text) => {
    const path = join(directory, name);
    writeFileSync(path, text, { encoding: "utf8" });
    return path;
  };
  const good = { schema_version: "1.0.0", tool: "t", phase: "PHASE-04", canonical: false, measured_at: "now" };
  assert.equal(inspectBytes(write("ok.json", `${JSON.stringify(good, null, 2)}\n`)).ok, true);
  assert.equal(inspectBytes(write("cr.json", `${JSON.stringify(good, null, 2)}\r\n`)).ok, false);
  assert.equal(inspectBytes(write("tail.json", JSON.stringify(good, null, 2))).reason, "NO_FINAL_NEWLINE");
  assert.equal(inspectBytes(write("two.json", `${JSON.stringify(good, null, 2)}\n\n`)).reason, "MORE_THAN_ONE_FINAL_NEWLINE");
  assert.ok(inspectBytes(write("bad.json", "{ not json\n")).reason.includes("INVALID_JSON"));
  assert.ok(inspectBytes(write("thin.json", "{}\n")).reason.startsWith("MISSING_FIELDS"));
  assert.equal(inspectBytes(join(directory, "absent.json")).reason, "EVIDENCE_FILE_MISSING");
});

// ——— الفحص الساكن.

test("P04-TL-050 the static scan reads the real repository and every check states a real detail", () => {
  const checks = staticChecks(ROOT);
  assert.ok(checks.length >= 15, `only ${checks.length} static checks ran`);
  const ids = checks.map((check) => check.check_id);
  assert.equal(new Set(ids).size, ids.length, "a check id is declared twice");
  for (const check of checks) {
    assert.ok(["PASS", "FAIL", "NOT_TESTED"].includes(check.verdict), `${check.check_id} has verdict ${check.verdict}`);
    assert.ok(check.detail.length > 0, `${check.check_id} states no detail`);
  }
  // الفحوص الحاملة للبنية موجودة بالاسم: حذف واحد منها يُسقط هذا الاختبار.
  for (const required of [
    "P04-SEC-NO-EXECUTION-OPERATION",
    "P04-SEC-NO-PROCESS-OR-SECRET-CAPABILITY",
    "P04-SEC-MCP-LOOPBACK-ONLY",
    "P04-SEC-NO-EXTERNAL-SCHEMA-REFERENCE",
    "P04-SEC-APPROVAL-IS-BOUND",
    "P04-SEC-RENDERER-CANNOT-EXECUTE",
  ]) {
    assert.ok(ids.includes(required), `${required} is not part of the static scan`);
  }
});

test("P04-TL-051 the secret detector reports a shape and never the value", () => {
  // الشكل يُركَّب وقت التشغيل ولا يُكتب في المصدر: ملف يحمل شكل مفتاح يُسقط
  // الفحص الذي يحرس المستودع من أشكال المفاتيح، وهو فحص محقّ في ذلك.
  const text = `authorization: ${"Bea" + "rer"} ${"a".repeat(20)}012345`;
  const hits = findSecretLeaks(text);
  assert.ok(hits.includes("bearer"));
  for (const hit of hits) assert.ok(!text.includes(hit) || hit.length < 12, "the detector echoed the value");
  assert.deepEqual(findSecretLeaks("nothing to see"), []);
});

// ——— اتّساق الإعلانات.

test("P04-TL-060 every claim names a document that exists, and every requirement names a real group", () => {
  const documents = new Set([...P04_EVIDENCE, "phase-04-final-gate"]);
  const groups = new Set(P04_TEST_GROUPS.map((group) => group.id));
  const ids = new Set();
  for (const claim of P04_CLAIMS) {
    assert.ok(!ids.has(claim.id), `${claim.id} is declared twice`);
    ids.add(claim.id);
    assert.ok(documents.has(claim.document), `${claim.id} names the unknown document ${claim.document}`);
    assert.ok(claim.requires.length > 0, `${claim.id} requires nothing, so it would pass on an empty run`);
    for (const requirement of claim.requires) {
      if (requirement.type === "test" || requirement.type === "group") {
        const id = requirement.group ?? requirement.id;
        assert.ok(groups.has(id), `${claim.id} names the unknown group ${id}`);
      }
      if (requirement.type === "e2e") {
        assert.ok(E2E_IDS.includes(requirement.id), `${claim.id} names the unknown scenario ${requirement.id}`);
      }
    }
  }
});

test("P04-TL-061 every declared test group and every security-bearing group is known", () => {
  const groups = new Set(P04_TEST_GROUPS.map((group) => group.id));
  for (const id of SECURITY_GROUPS) assert.ok(groups.has(id), `${id} carries security and does not exist`);
  for (const group of P04_TEST_GROUPS) {
    assert.ok(P04_GROUPS.includes(group.id), `${group.id} is not in the declared group list`);
    assert.ok(["node", "cargo", "lint"].includes(group.kind));
    assert.ok(group.command.length > 0);
    assert.ok(group.title.length > 0);
  }
  // المجموعتان اللتان لا تُستدعيان كحزمة اختبارات تبقيان معلنتين ومقيستين.
  assert.ok(P04_GROUPS.includes("P04-NATIVE-E2E"));
  assert.ok(P04_GROUPS.includes("P04-SECURITY"));
});

test("P04-TL-062 the scenario list is closed and covers the whole window suite", () => {
  assert.equal(new Set(E2E_IDS).size, E2E_IDS.length);
  assert.ok(E2E_IDS.includes("P04-E2E-01"));
  assert.ok(E2E_IDS.includes("P04-E2E-30"));
  assert.ok(E2E_IDS.includes("P04-E2E-29a"));
  // كل سيناريو مُعلن مذكور في شرط واحد على الأقل، وإلا فهو يُقاس ولا يُحاسَب.
  const referenced = new Set(P04_CLAIMS.flatMap((claim) => claim.requires.filter((r) => r.type === "e2e").map((r) => r.id)));
  const orphans = E2E_IDS.filter((id) => !referenced.has(id) && id !== "P04-E2E-01" && id !== "P04-E2E-05");
  assert.deepEqual(orphans, [], `scenarios measured but bound to no condition: ${orphans.join(", ")}`);
});
