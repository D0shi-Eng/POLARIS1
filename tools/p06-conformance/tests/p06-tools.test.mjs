// اختبارات أدوات مطابقة Phase-06.
//
// ما تحرسه: أن التجهيزتين حتميّتان ومُسمّيتان TEST FIXTURE وتقيسان ما يصلهما، وأن موصل
// الاختبار يسلك سلوك تجهيزة المضيف مسارًا بمسار، وأن الحَكَم لا يرقّي غياب قياس إلى PASS،
// وأن فحص الكناري يجد ما زُرع ولا يجد ما لم يُزرع، وأن كل شرط يشير إلى قياس موجود.
//
// أداة القياس التي لا تُختبر لا تُصدَّق.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  connectorReply,
  executionFor,
  FIXTURE_LABEL,
  INJECTION_MARKER,
  markerFenced,
  newConnectorState,
  planFor,
  SCENARIOS,
  startConnectorFixture,
  startModelFixture,
  summariseConnector,
} from "../p06-fixture-server.mjs";
import { P06_CLAIMS, SECURITY_GROUPS } from "../p06-claims.mjs";
import { P06_EVIDENCE, P06_FINAL_GATE, P06_GROUPS, worst } from "../p06-common.mjs";
import { ALLOWED_CONNECTOR_PATHS, checkVerdict, e2eVerdict, E2E_IDS, gateRegressionVerdict, performanceRows, REQUIRED_TIMINGS, testVerdict } from "../p06-evaluate.mjs";
import { inspectBytes } from "../p06-evidence-bytes.mjs";
import { evidenceChecks, scanText, staticChecks } from "../p06-security.mjs";
import { P06_TEST_GROUPS } from "../p06-test-groups.mjs";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const TOKEN = "p06-canary-0123456789abcdef0123";

function request(method, path, extra = {}) {
  return { method, path, authorization: `Bearer ${TOKEN}`, idempotencyKey: undefined, body: "", ...extra };
}

// ——— التجهيزتان.

test("P06-TL-001 both fixtures are labelled TEST FIXTURE and name their scenarios", () => {
  assert.equal(FIXTURE_LABEL, "TEST FIXTURE");
  for (const scenario of ["CREAD", "CINJECT", "CWRITE", "CREPLAY", "CSLOW", "CLIST", "CLIST4", "CLIMITED", "CMALICIOUS", "CUNSAFE"]) assert.ok(SCENARIOS.includes(scenario), scenario);
});

test("P06-TL-002 the model fixture proposes connector tools by the connector the mission names, and never a URL of its own", () => {
  const body = "[[FX:CWRITE]] [[CONN:6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a]] carry out the step named only output_summary";
  const execution = executionFor("CWRITE", body);
  assert.equal(execution.tools.length, 1);
  assert.equal(execution.tools[0].tool_id, "connector:6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a:items.create");
  assert.equal(execution.tools[0].skill_id, "polaris.skill.connector-operator");
  assert.deepEqual(execution.tools[0].arguments, { name: "alpha" });
  assert.equal(planFor("CREAD").tasks.length, 2);
  assert.equal(planFor("CLIST").tasks.length, 1);
  // الخطوة التالية في CINJECT هي ما «أطاعه» الوكيل: أداة لا وجود لها وعنوان حرّ.
  const obeyed = executionFor("CINJECT", "[[CONN:x]] carry out the step named follow");
  assert.ok(obeyed.tools.some((tool) => tool.tool_id.endsWith(":admin.delete")));
  assert.ok(obeyed.tools.some((tool) => "url" in tool.arguments));
  assert.equal(executionFor("CLIST4", "[[CONN:x]] step named only").tools.length, 4);
});

test("P06-TL-003 the connector fixture demands the expected credential and never records it", () => {
  const state = newConnectorState();
  assert.equal(connectorReply(state, request("GET", "/api/items", { authorization: "Bearer wrong" }), TOKEN).status, 401);
  assert.equal(connectorReply(state, request("GET", "/api/items", { authorization: undefined }), TOKEN).status, 401);
  assert.equal(connectorReply(state, request("GET", "/api/items"), TOKEN).status, 200);
  assert.equal(state.authorised, 1);
  assert.equal(state.unauthorised, 2);
  assert.ok(!JSON.stringify(summariseConnector(state)).includes(TOKEN));
  // بلا قيمة متوقّعة لا يُقبل أيّ طلب.
  assert.equal(connectorReply(newConnectorState(), request("GET", "/api/items"), "").status, 401);
});

test("P06-TL-004 the connector fixture behaves as the host test fixture does, path by path", () => {
  const state = newConnectorState();
  const create = (key, name) => connectorReply(state, request("POST", "/api/items", { idempotencyKey: key, body: JSON.stringify({ name }) }), TOKEN);
  assert.deepEqual(create("k1", "alpha"), { status: 201, body: { id: "item-101", name: "alpha" } });
  assert.equal(create("k1", "alpha").body.replayed, true, "the same key did not replay");
  assert.equal(create("k2", "beta").body.id, "item-102");
  assert.deepEqual(state.created, ["item-101", "item-102"]);
  const limited = [1, 2, 3].map(() => connectorReply(state, request("GET", "/api/limited"), TOKEN));
  assert.deepEqual(limited.map((reply) => reply.status), [429, 200, 429]);
  assert.equal(limited[0].headers["retry-after"], "1");
  assert.equal(connectorReply(state, request("GET", "/api/throttled"), TOKEN).headers["retry-after"], "30");
  assert.equal(connectorReply(state, request("GET", "/api/redirect"), TOKEN).headers.location, "http://169.254.169.254/latest/meta-data/");
  assert.deepEqual([1, 2].map(() => connectorReply(state, request("GET", "/api/flaky"), TOKEN).status), [503, 200]);
  assert.equal(connectorReply(state, request("POST", "/api/send"), TOKEN).status, 500);
  assert.equal(state.unsafe_hits, 1);
  assert.equal(connectorReply(state, request("GET", "/api/fake-cost"), TOKEN).body.usage.cost, -50);
  assert.ok(connectorReply(state, request("GET", "/api/items/inject"), TOKEN).body.note.includes(INJECTION_MARKER));
  assert.equal(connectorReply(state, request("GET", "/api/slow"), TOKEN).hang, 20_000);
  assert.equal(connectorReply(state, request("GET", "/api/admin"), TOKEN).status, 404);
});

test("P06-TL-005 the fence check finds text inside and outside an untrusted fence", () => {
  assert.equal(markerFenced("no marker"), null);
  assert.equal(markerFenced(`<<<UNTRUSTED ${INJECTION_MARKER} UNTRUSTED>>>`), true);
  assert.equal(markerFenced(`<<<UNTRUSTED x UNTRUSTED>>> ${INJECTION_MARKER}`), false);
  assert.equal(markerFenced(`${INJECTION_MARKER}`), false);
});

test("P06-TL-006 the live fixtures answer over loopback and log flags, not bodies or headers", async () => {
  const model = await startModelFixture();
  const connector = await startConnectorFixture(TOKEN);
  try {
    const plan = await fetch(`${model.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "[[FX:CLIST]] local_key" }] }),
    }).then((r) => r.json());
    assert.equal(JSON.parse(plan.choices[0].message.content).tasks.length, 1);
    assert.equal(model.requests[0].contract, "plan");
    assert.equal(model.requests[0].carried_authorization, false);
    const refused = await fetch(`${connector.base}/items`);
    assert.equal(refused.status, 401);
    const listed = await fetch(`${connector.base}/items`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.json());
    assert.equal(listed.count, 2);
    assert.equal(connector.requests.length, 2);
    assert.equal(connector.requests[1].authorised, true);
    assert.ok(!JSON.stringify(connector.requests).includes(TOKEN), "the connector log carries the credential");
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(connector.base));
  } finally {
    await model.close();
    await connector.close();
  }
});

// ——— الحَكَم.

test("P06-TL-010 an absent measurement is NOT_TESTED, never PASS", () => {
  assert.equal(testVerdict({ groups: [] }, "P06-CONNECTORS", "x").verdict, "NOT_TESTED");
  assert.equal(e2eVerdict({ native: null }, "P06-E2E-04").verdict, "NOT_TESTED");
  assert.equal(checkVerdict({ native: null }, "CONNECTOR-EXACTLY-ONCE").verdict, "NOT_TESTED");
  assert.equal(checkVerdict({ native: { performed: true } }, "CANARY-ABSENT-DATA").verdict, "NOT_TESTED");
  assert.equal(worst([]), "NOT_TESTED");
  assert.equal(worst(["PASS", "NOT_TESTED"]), "NOT_TESTED");
  assert.equal(worst(["PASS", "FAIL", "BLOCKED"]), "FAIL");
});

test("P06-TL-011 the exactly-once check reads what the service counted, and fails on a second create or a retried send", () => {
  const log = (created, sends, keys = true) => ({
    native: {
      performed: true,
      fixture_log: {
        connector_requests: [
          ...created.map(() => ({ method: "POST", path: "/api/items", authorised: true, carried_idempotency_key: keys })),
          ...Array.from({ length: sends }, () => ({ method: "POST", path: "/api/send", authorised: true })),
        ],
        connector_state: { created, notes: 0, unsafe_hits: sends, unauthorised: 0 },
      },
    },
  });
  assert.equal(checkVerdict(log(["item-101", "item-102"], 1), "CONNECTOR-EXACTLY-ONCE").verdict, "PASS");
  assert.equal(checkVerdict(log(["item-101", "item-102", "item-103"], 1), "CONNECTOR-EXACTLY-ONCE").verdict, "FAIL");
  assert.equal(checkVerdict(log(["item-101", "item-102"], 2), "CONNECTOR-EXACTLY-ONCE").verdict, "FAIL");
  assert.equal(checkVerdict(log(["item-101", "item-102"], 1, false), "CONNECTOR-EXACTLY-ONCE").verdict, "FAIL");
});

test("P06-TL-012 a request outside the registered paths or without the credential fails its check", () => {
  const inputs = (requests, unauthorised = 0) => ({ native: { performed: true, fixture_log: { connector_requests: requests, connector_state: { unauthorised } } } });
  const good = ALLOWED_CONNECTOR_PATHS.map((path) => ({ method: "GET", path, authorised: true }));
  assert.equal(checkVerdict(inputs(good), "CONNECTOR-NO-FORBIDDEN-PATH").verdict, "PASS");
  assert.equal(checkVerdict(inputs([...good, { method: "GET", path: "/api/admin", authorised: true }]), "CONNECTOR-NO-FORBIDDEN-PATH").verdict, "FAIL");
  assert.equal(checkVerdict(inputs(good), "CONNECTOR-FIXTURE-AUTHORISED").verdict, "PASS");
  assert.equal(checkVerdict(inputs([...good, { method: "GET", path: "/api/items", authorised: false }], 1), "CONNECTOR-FIXTURE-AUTHORISED").verdict, "FAIL");
});

test("P06-TL-013 a canary found in the data directory or a report fails, and an empty scan proves nothing", () => {
  const scan = (files, hits) => ({ native: { performed: true, canary_scan: { directory_scanned: true, files, bytes: 10, files_with_canary: hits, names_with_canary: hits > 0 ? ["polaris.db"] : [], unreadable: 0 } } });
  assert.equal(checkVerdict(scan(4, 0), "CANARY-ABSENT-DATA").verdict, "PASS");
  assert.equal(checkVerdict(scan(4, 1), "CANARY-ABSENT-DATA").verdict, "FAIL");
  assert.equal(checkVerdict(scan(0, 0), "CANARY-ABSENT-DATA").verdict, "NOT_TESTED");
});

test("P06-TL-014 the restart scenarios are read from the restart report and the runner's from the launch records", () => {
  const report = (id, status) => ({ e2e_report: { scenarios: [{ id, status, detail: "d" }] } });
  const inputs = { native: { performed: true, first: report("P06-E2E-19", "NOT_TESTED"), restart: report("P06-E2E-19", "PASS") } };
  assert.equal(e2eVerdict(inputs, "P06-E2E-19").verdict, "PASS");
  const clean = { started: true, startup_report: {}, closed_gracefully: true, process_exited: true, exit_code: 0, orphan_processes: 0 };
  assert.equal(e2eVerdict({ native: { performed: true, first: clean, restart: clean, fixture_exited: true } }, "P06-E2E-24").verdict, "PASS");
  assert.equal(e2eVerdict({ native: { performed: true, first: clean, restart: { ...clean, orphan_processes: 1 }, fixture_exited: true } }, "P06-E2E-25").verdict, "FAIL");
  assert.equal(E2E_IDS.length, 26);
});

test("P06-TL-015 a prior gate counts only if it was re-run inside this run and opens the next phase", () => {
  const gate = (at, verdict = "PASS") => ({ measured_at: at, canonical: true, verdict, phase_06_gate: "ALLOWED" });
  assert.equal(gateRegressionVerdict({ runStarted: "2026-09-23T10:00:00Z", phase05Gate: gate("2026-09-23T09:00:00Z") }, "PHASE-05").verdict, "NOT_TESTED");
  assert.equal(gateRegressionVerdict({ runStarted: "2026-09-23T10:00:00Z", phase05Gate: gate("2026-09-23T11:00:00Z") }, "PHASE-05").verdict, "PASS");
  assert.equal(gateRegressionVerdict({ runStarted: "2026-09-23T10:00:00Z", phase05Gate: gate("2026-09-23T11:00:00Z", "FAIL") }, "PHASE-05").verdict, "FAIL");
  assert.equal(gateRegressionVerdict({ runStarted: "2026-09-23T10:00:00Z", phase05Gate: { ...gate("2026-09-23T11:00:00Z"), phase_06_gate: "NOT_ALLOWED" } }, "PHASE-05").verdict, "FAIL");
});

test("P06-TL-016 the ten required timings are named from the gateway, the in-process measurement and the window", () => {
  const facts = {
    timings: {
      ok: true,
      gateway: {
        registry_load_mean_micros: 40,
        overhead_mean_micros: 900,
        auth_mean_micros: 5,
        cost_write_mean_micros: 300,
        budget_mean_micros: 120,
        event_write_mean_micros: 80,
        invocations: 3,
      },
    },
    in_process: { ok: true, settings_read: { mean_micros: 2, rounds: 500 }, effective_config_resolution: { mean_micros: 60, rounds: 200 }, health_overview: { mean_micros: 400, rounds: 20 } },
  };
  const inputs = { native: { first: { e2e_report: { facts, measurements: { diagnostics_generation_ms: { value: 30, unit: "ms", method: "m" }, connector_read_mission_wall_ms: { value: 900, unit: "ms", method: "m" } } } } } };
  const rows = performanceRows(inputs);
  const names = new Set(rows.map((row) => row.name));
  assert.deepEqual(REQUIRED_TIMINGS.filter((name) => !names.has(name)), []);
  assert.ok(rows.every((row) => row.provenance === "LOCALLY_MEASURED" && typeof row.method === "string" && typeof row.excludes_provider_time === "boolean"));
  assert.equal(rows.find((row) => row.name === "connector_read_mission_wall_ms").excludes_provider_time, false);
});

// ——— الأمن.

test("P06-TL-020 the static security scan passes on this repository", () => {
  const checks = staticChecks(ROOT);
  assert.ok(checks.length >= 13);
  assert.deepEqual(checks.filter((check) => check.verdict !== "PASS").map((check) => `${check.check_id}: ${check.detail}`), []);
});

test("P06-TL-021 the evidence scan finds a planted canary and connector text, and says NOT_TESTED without a canary", () => {
  assert.equal(scanText(`{"x":"${TOKEN}"}`, TOKEN).canary, true);
  assert.equal(scanText('{"x":"y"}', TOKEN).canary, false);
  assert.deepEqual(scanText(`{"note":"${INJECTION_MARKER}"}`, "").content, [INJECTION_MARKER]);
  const root = mkdtempSync(join(tmpdir(), "p06-tools-"));
  mkdirSync(join(root, "evidence", "p06-native"), { recursive: true });
  writeFileSync(join(root, "evidence", "phase-06-run.adhoc.json"), `{"clean":true}\n`);
  writeFileSync(join(root, "evidence", "p06-native", "native.local.json"), `{"leak":"${TOKEN}"}\n`);
  const found = evidenceChecks(root, TOKEN).find((check) => check.check_id === "P06-EVIDENCE-NO-CANARY");
  assert.equal(found.verdict, "FAIL");
  assert.equal(evidenceChecks(root, "").find((check) => check.check_id === "P06-EVIDENCE-NO-CANARY").verdict, "NOT_TESTED");
});

test("P06-TL-022 the byte gate refuses a BOM, a carriage return and a missing final newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "p06-bytes-"));
  const write = (name, text) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const header = '{"schema_version":"1.0.0","tool":"t","phase":"PHASE-06","canonical":false,"measured_at":"x"}';
  assert.equal(inspectBytes(write("ok.json", `${header}\n`)).ok, true);
  assert.equal(inspectBytes(write("bom.json", `﻿${header}\n`)).ok, false);
  assert.equal(inspectBytes(write("crlf.json", `${header}\r\n`)).ok, false);
  assert.equal(inspectBytes(write("none.json", header)).ok, false);
  assert.equal(inspectBytes(join(dir, "absent.json")).present, false);
});

// ——— الشروط.

test("P06-TL-030 every condition is unique, lives in a canonical document and points at a real measurement", () => {
  const ids = P06_CLAIMS.map((claim) => claim.id);
  assert.equal(new Set(ids).size, ids.length);
  const documents = new Set([...P06_EVIDENCE, P06_FINAL_GATE]);
  const groups = new Set(P06_TEST_GROUPS.map((group) => group.id));
  for (const claim of P06_CLAIMS) {
    assert.ok(documents.has(claim.document), `${claim.id} lives in ${claim.document}`);
    assert.ok(claim.requires.length > 0, `${claim.id} has no measurement`);
    for (const requirement of claim.requires) {
      if (requirement.type === "test" || requirement.type === "group") assert.ok(groups.has(requirement.group ?? requirement.id), `${claim.id} names ${requirement.group ?? requirement.id}`);
      if (requirement.type === "e2e") assert.ok(E2E_IDS.includes(requirement.id), `${claim.id} names ${requirement.id}`);
    }
  }
  for (const group of SECURITY_GROUPS) assert.ok(groups.has(group), group);
  for (const group of P06_GROUPS.filter((id) => id !== "P06-NATIVE-E2E")) assert.ok(groups.has(group), group);
  // كل سيناريو أصلي يحمله شرط.
  const named = new Set(P06_CLAIMS.flatMap((claim) => claim.requires.filter((r) => r.type === "e2e").map((r) => r.id)));
  assert.deepEqual(E2E_IDS.filter((id) => !named.has(id)), []);
});

test("P06-TL-031 every measured document carries at least one condition and the regression covers Phase-00 to Phase-05", () => {
  for (const document of P06_EVIDENCE) assert.ok(P06_CLAIMS.some((claim) => claim.document === document), document);
  const phases = P06_CLAIMS.flatMap((claim) => claim.requires.filter((r) => r.type === "gate").map((r) => r.phase));
  assert.deepEqual(phases.sort(), ["PHASE-00", "PHASE-01", "PHASE-02", "PHASE-03", "PHASE-04", "PHASE-05"]);
});

// كل مرحلة تُختبر منفصلة (سياسة المالك 2026-09-30): البوابة الأدنى تُقرأ ولا يُعاد تشغيلها، وتبقى شروطها كاملة.
test("P06-TOOLS-PRIOR-GATES an older lower gate counts only in PRIOR_GATES mode, and only when canonical, PASS and opening the next phase", async () => {
  const { gateRegressionVerdict } = await import("../p06-evaluate.mjs");
  const gate = { canonical: true, verdict: "PASS", phase_06_gate: "ALLOWED", measured_at: "2026-09-30T01:00:00Z" };
  const base = { runStarted: "2026-09-30T02:00:00Z", phase05Gate: gate };
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "RERUN" }, "PHASE-05").verdict, "NOT_TESTED");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES" }, "PHASE-05").verdict, "PASS");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES", phase05Gate: { ...gate, verdict: "FAIL", phase_06_gate: "NOT_ALLOWED" } }, "PHASE-05").verdict, "FAIL");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES", phase05Gate: { ...gate, canonical: false } }, "PHASE-05").verdict, "INCONCLUSIVE");
  assert.equal(gateRegressionVerdict({ ...base, regressionMode: "PRIOR_GATES", phase05Gate: { ...gate, phase_06_gate: "NOT_ALLOWED" } }, "PHASE-05").verdict, "FAIL");
});
