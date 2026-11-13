// بروفة لمجموعة E2E الأصلية، في jsdom وفوق مضيف بديل.
//
// ما تثبته: أن المجموعة نفسها — محدداتها، وانتظارها، وترتيب خطواتها — تعمل على
// الشجرة الحقيقية. وما لا تثبته: أي ادعاء عن Windows أو WebView2 أو مزوّد حقيقي؛
// ذلك يبقى للمشغّل الأصلي وحده. القيمة هنا أن عيبًا في أداة القياس يُكتشف قبل أن
// يُهدر تشغيلًا أصليًا كاملًا على جهاز المالك.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase02Client } from "../src/ipc/p02-client";
import { runPhase02Suite, type Phase02SuiteConfig, type Scenario } from "../src/e2e/p02-suite";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase02Host } from "./support/fake-p02-host";

const FIXTURE = "http://127.0.0.1:41000";
const CLOSED = "http://127.0.0.1:41001";

function config(stage: "p02-first" | "p02-restart"): Phase02SuiteConfig {
  return { stage, fixture_endpoint: FIXTURE, closed_endpoint: CLOSED, workspace: "D:\\Work\\Rehearsal", marker: "rehearsal" };
}

async function rehearse(stage: "p02-first" | "p02-restart") {
  const container = resetDocument();
  const globals = globalThis as unknown as Record<string, unknown>;
  // في النافذة الحقيقية `globalThis` هو `window`. هنا يُوصل الموضع وحدث تغيّره.
  const view = globals["window"] as Window & typeof globalThis;
  globals["location"] = view.location;
  globals["addEventListener"] = view.addEventListener.bind(view);
  globals["removeEventListener"] = view.removeEventListener.bind(view);
  view.location.hash = "#/";
  // المجموعة تنقر وتنتظر خارج act، كما تفعل في النافذة الحقيقية.
  globals["IS_REACT_ACT_ENVIRONMENT"] = false;
  const { transport } = fakePhase02Host({
    realProviderIds: true,
    fixtureEndpoint: FIXTURE,
    closedEndpoint: CLOSED,
    slowInvokeMs: 20_000,
    invokeOutput: "POLARIS fixture reply.",
  });
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const root = createRoot(container);
  flushSync(() => root.render(<AppRoot client={client} phase02={api} />));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const report = await runPhase02Suite(client, api, "HYDRATED", config(stage));
  root.unmount();
  globals["IS_REACT_ACT_ENVIRONMENT"] = true;
  return report as { scenarios: Scenario[]; measurements: Record<string, unknown>; facts: Record<string, unknown>; missing_keys: string[] };
}

function failures(scenarios: Scenario[]): string[] {
  return scenarios.filter((scenario) => scenario.status === "FAIL").map((scenario) => `${scenario.id}: ${scenario.detail}`);
}

test("P02-REH-001 the first-stage suite drives the real screens end to end", { timeout: 300_000 }, async () => {
  const report = await rehearse("p02-first");
  const ids = report.scenarios.map((scenario) => scenario.id);
  for (const id of ["E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05", "E2E-06", "E2E-07", "E2E-08", "E2E-09", "E2E-10", "E2E-11", "E2E-12", "E2E-13", "E2E-14", "E2E-15", "E2E-16", "E2E-17", "E2E-18", "E2E-19", "E2E-21"]) {
    assert.ok(ids.includes(id), `${id} was never attempted`);
  }
  assert.deepEqual(failures(report.scenarios), []);
  assert.deepEqual(report.missing_keys, []);
  // القياسات موجودة فعلًا، فوثيقة الأداء لا تُبنى على فراغ.
  for (const name of ["model_list", "project_open", "context_assembly", "invocation_ui_round_trip", "cancel_to_result"]) {
    assert.ok(report.measurements[name] !== undefined, `${name} was not measured`);
  }
  // لا سرّ ولا شكل مفتاح فيما استلمه العارض.
  assert.ok(!JSON.stringify(report).includes("sk-"), "a key shape reached the report");
});

test("P02-REH-002 the restart stage checks persistence and nothing else", { timeout: 120_000 }, async () => {
  const report = await rehearse("p02-restart");
  assert.deepEqual(report.scenarios.map((scenario) => scenario.id), ["E2E-20"]);
  // البديل يبدأ فارغًا، فالمرحلة تُبلغ فشلًا صادقًا بدل أن تدّعي نجاحًا.
  assert.equal(report.scenarios[0]?.status, "FAIL");
  assert.ok(String(report.scenarios[0]?.detail).includes("project_found"));
});
