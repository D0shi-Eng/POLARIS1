// Phase-03 في العارض: المهام، والوكلاء، وتفاصيل المهمّة بألسنتها الستّ.
//
// ما تثبته هذه الاختبارات ليس أن الشاشة «تعمل»، بل أنها لا تكذب: الحالة لا تُعرض
// دون إثبات، ودليل الوكيل يُعرض مستنتَجًا لا مقيسًا، ولا نسبة ثقة ولا نسبة تقدّم
// في أي مكان، ولا أثر تفكير نموذج.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase03Client } from "../src/ipc/p03-client";
import { PHASE03_OPERATIONS } from "../src/ipc/operations";
import { CATALOGS } from "../src/localization/catalog";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { missionPath, resolveRoute } from "../src/routes/registry";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase03Host, P03_IDS, type FakePhase03Options } from "./support/fake-p03-host";
import { waitFor } from "../src/e2e/p03-suite";

interface Mounted {
  readonly location: LocationPort;
  readonly log: ReturnType<typeof fakePhase03Host>["log"];
  unmount(): void;
}

async function settle(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(path: string, options: FakePhase03Options = {}): Promise<Mounted> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const location = memoryLocation(path);
  const { transport, log } = fakePhase03Host(options);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const api = new Phase03Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={api} location={location} />);
  });
  await settle();
  return { location, log, unmount: () => act(() => root.unmount()) };
}

function body(): string {
  return document.body.textContent ?? "";
}

function buttonNamed(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => (candidate.textContent ?? "").trim() === label || candidate.getAttribute("aria-label") === label,
  );
  assert.ok(found !== undefined, `no button named "${label}"`);
  return found;
}

// ——— العقد: مفردات العارض تطابق السجل.

test("P03-UI-001 the renderer knows exactly the ten routed Phase-03 operations", () => {
  assert.equal(PHASE03_OPERATIONS.length, 10);
  const names = PHASE03_OPERATIONS.map((record) => record.operation).sort();
  assert.deepEqual(names, [
    "agent.list",
    "claim.list",
    "evidence.list",
    "mission.cancel",
    "mission.create",
    "mission.get",
    "mission.list",
    "mission.resume",
    "mission.start",
    "task.list",
  ]);
  for (const record of PHASE03_OPERATIONS) assert.equal(record.envelope_version, "1.3");
});

test("P03-UI-002 a mission path resolves to the mission detail route", () => {
  const route = resolveRoute(missionPath(P03_IDS.MISSION));
  assert.ok(route !== undefined);
  assert.equal(route.id, "mission-detail");
  assert.equal(route.param, P03_IDS.MISSION);
  assert.equal(route.capabilityId, "polaris.desktop.missions");
  // مسار بمعرّف غير صالح لا يُحلّ إلى شاشة تفاصيل.
  assert.equal(resolveRoute("/missions/not-a-uuid"), undefined);
});

// ——— الصدق البصري.

test("P03-UI-003 a completed mission never shows its state without its proof", async () => {
  const app = await mount("/missions");
  const text = body();
  const catalog = CATALOGS.en;
  assert.ok(text.includes(catalog["p03.mission_state.COMPLETED"] ?? ""), "the state is missing");
  assert.ok(text.includes(catalog["p03.proof.NOT_PROVEN"] ?? ""), "a completed mission was shown without its proof");
  // والحالة والإثبات في الحاوية نفسها، فلا يُقتطع أحدهما.
  const pair = document.querySelector(".p03-state-pair");
  assert.ok(pair !== null, "state and proof are not presented together");
  assert.ok((pair.textContent ?? "").includes(catalog["p03.proof.NOT_PROVEN"] ?? ""));
  app.unmount();
});

test("P03-UI-004 progress is a count, never an invented percentage", async () => {
  const app = await mount("/missions");
  const text = body();
  assert.ok(/2 of 2 succeeded/.test(text), "the task tally is missing");
  assert.ok(!/\d+\s*%/.test(text), `a percentage appeared in the missions page: ${text.slice(0, 200)}`);
  assert.equal(document.querySelector("progress"), null, "a progress bar was rendered");
  assert.equal(document.querySelector("[role=progressbar]"), null, "a progress bar role was rendered");
  app.unmount();
});

test("P03-UI-005 agent evidence is shown as inferred and powerless, measured evidence as measured", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION));
  await act(async () => buttonNamed("Evidence").click());
  await settle();
  const text = body();
  const catalog = CATALOGS.en;

  assert.ok(text.includes(catalog["p03.evidence_type.AGENT_OUTPUT"] ?? ""), "agent output is not labelled");
  assert.ok(text.includes(catalog["p03.measurement.INFERRED"] ?? ""), "agent output is not marked inferred");
  assert.ok(
    text.includes(catalog["mission.evidence.agent_output_note"] ?? ""),
    "agent output is shown without saying it verifies nothing",
  );
  assert.ok(text.includes(catalog["p03.evidence_type.TEST_RESULT"] ?? ""), "the measured evidence is missing");
  assert.ok(text.includes(catalog["p03.measurement.MEASURED"] ?? ""), "measured evidence is not marked measured");
  // البصمة تُعرض كهوية، ومختصرها يحمل طرفيها.
  assert.ok(text.includes("aaaaaaaa"), "the digest is not shown");
  app.unmount();
});

test("P03-UI-006 an unverified claim says so, with the reason, and carries no confidence number", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION));
  await act(async () => buttonNamed("Claims").click());
  await settle();
  const text = body();
  const catalog = CATALOGS.en;

  assert.ok(text.includes(catalog["p03.claim_status.UNVERIFIED"] ?? ""), "the claim status is missing");
  assert.ok(text.includes(catalog["p03.claim_status.hint.UNVERIFIED"] ?? ""), "the claim status has no explanation");
  assert.ok(!/\d+\s*%/.test(text), "a confidence percentage appeared on the claims tab");
  // ولا شارة «محقَّق» على ادّعاء غير محقَّق.
  assert.ok(!text.includes(catalog["p03.claim_status.VERIFIED"] ?? "NEVER"), "a verified badge appeared on an unverified claim");
  app.unmount();
});

test("P03-UI-007 the proof tab names every blocker instead of hiding them", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION));
  const text = body();
  const catalog = CATALOGS.en;
  assert.ok(text.includes(catalog["mission.proof.blockers"] ?? ""), "the blockers section is missing");
  assert.ok(text.includes("req-1"), "the blocking requirement is not named");
  assert.ok(text.includes(catalog["p03.proof.hint.NOT_PROVEN"] ?? ""), "the proof is not explained");
  app.unmount();
});

test("P03-UI-008 no model reasoning trace is rendered anywhere", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION));
  for (const tab of ["Overview", "Tasks", "Agents", "Claims", "Evidence", "Activity"]) {
    const list = document.querySelector("[role=tablist]");
    assert.ok(list !== null, `the tab list vanished before ${tab}`);
    await act(async () => buttonNamed(tab, list).click());
    await settle(2);
    const text = body().toLowerCase();
    for (const forbidden of ["chain of thought", "reasoning trace", "<thinking", "scratchpad"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} appeared on the ${tab} tab`);
    }
  }
  app.unmount();
});

// ——— إتاحة الوصول.

test("P03-UI-009 the mission tabs implement the full tab pattern", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION));
  const list = document.querySelector("[role=tablist]");
  assert.ok(list !== null, "there is no tab list");
  const tabs = [...list.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  assert.equal(tabs.length, 6);

  const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
  assert.equal(selected.length, 1, "exactly one tab must be selected");
  // تسلسل التركيز يحمل اللسان المُختار وحده (نمط roving tabindex).
  assert.equal(tabs.filter((tab) => tab.getAttribute("tabindex") === "0").length, 1);

  for (const tab of tabs) {
    const controls = tab.getAttribute("aria-controls");
    assert.ok(controls !== null, "a tab does not name its panel");
    if (tab.getAttribute("aria-selected") === "true") {
      const panel = document.getElementById(controls);
      assert.ok(panel !== null, "the selected tab's panel is absent");
      assert.equal(panel.getAttribute("role"), "tabpanel");
      assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    }
  }
  app.unmount();
});

test("P03-UI-010 every data table is titled for a screen reader", async () => {
  const app = await mount("/agents");
  const tables = [...document.querySelectorAll("table")];
  assert.ok(tables.length > 0, "the agents page renders no table");
  for (const table of tables) {
    const caption = table.querySelector("caption");
    assert.ok(caption !== null, "a table has no caption");
    assert.ok((caption.textContent ?? "").trim().length > 0, "a table caption is empty");
    assert.ok(table.querySelectorAll("th[scope=col]").length > 0, "a table has no column headers");
  }
  app.unmount();
});

test("P03-UI-011 status is never carried by colour alone", async () => {
  const app = await mount("/missions");
  const pills = [...document.querySelectorAll(".pill")];
  assert.ok(pills.length > 0, "no status pills rendered");
  for (const pill of pills) {
    assert.ok((pill.textContent ?? "").trim().length > 0, "a status pill has no readable text");
  }
  app.unmount();
});

// ——— اللغة والاتجاه.

test("P03-UI-012 the Arabic and English Phase-03 catalogs carry the same keys", () => {
  const en = Object.keys(CATALOGS.en).filter((key) => key.startsWith("p03.") || key.startsWith("mission") || key.startsWith("agents"));
  const ar = Object.keys(CATALOGS.ar).filter((key) => key.startsWith("p03.") || key.startsWith("mission") || key.startsWith("agents"));
  assert.deepEqual(en.sort(), ar.sort());
  // ولا مفتاح يعود بنصّه: كل مفتاح مُترجم فعلًا.
  for (const key of en) {
    assert.notEqual(CATALOGS.ar[key], key, `${key} is untranslated in Arabic`);
    assert.ok((CATALOGS.ar[key] ?? "").length > 0, `${key} is empty in Arabic`);
  }
});

test("P03-UI-013 the vocabulary the host can return is fully translatable", () => {
  // كل عضو في المفردات المغلقة التي تعرضها الشاشات له مفتاح في اللغتين.
  const members: Readonly<Record<string, readonly string[]>> = {
    mission_state: ["CREATED", "PLANNING", "READY", "RUNNING", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER", "BLOCKED", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED", "STOPPED"],
    proof: ["NOT_EVALUATED", "NOT_PROVEN", "PROVEN"],
    task_state: ["PENDING", "READY", "ASSIGNED", "RUNNING", "WAITING", "REVIEW", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED", "INTERRUPTED"],
    task_type: ["PLAN", "DESIGN", "BUILD", "DEBUG", "REVIEW", "SECURITY_REVIEW", "TEST", "RESEARCH", "SYNTHESIZE"],
    role: ["COORDINATOR", "PLANNER", "ARCHITECT", "BUILDER", "DEBUGGER", "REVIEWER", "SECURITY_REVIEWER", "TEST_ENGINEER", "RESEARCHER"],
    agent_state: ["CREATED", "IDLE", "WORKING", "WAITING", "REVIEWING", "BLOCKED", "COMPLETED", "FAILED", "CANCELLED", "STOPPED"],
    claim_status: ["UNVERIFIED", "SUPPORTED", "VERIFIED", "REFUTED", "CONFLICTED", "UNKNOWN"],
    claim_type: ["FACT", "RESULT", "COMPLETION", "REQUIREMENT_SATISFACTION", "ASSUMPTION", "RISK", "OBSERVATION"],
    evidence_type: ["USER_CONFIRMATION", "RUNTIME_MEASUREMENT", "TEST_RESULT", "ARTIFACT", "SOURCE_DOCUMENT", "PROJECT_CONTEXT", "PROVIDER_RESPONSE", "POLICY_DECISION", "AUDIT_EVENT", "COMPLETION_PROOF", "AGENT_OUTPUT"],
    measurement: ["MEASURED", "INFERRED"],
    authority: ["SYSTEM_POLICY", "DIRECT_USER_INSTRUCTION", "TRUSTED_RUNTIME_FACT", "AGENT_MESSAGE", "MODEL_GENERATED", "UNTRUSTED_CONTENT"],
    taint: ["UNTRUSTED_CONTENT", "MODEL_GENERATED", "AGENT_RELAYED", "UNVERIFIED_CLAIM"],
    requirement_status: ["PENDING", "SATISFIED", "UNSATISFIED", "UNVERIFIED", "BLOCKED"],
    stop: ["NO_PROGRESS", "BUDGET_EXHAUSTED", "MODEL_OUTPUT_INVALID", "NO_MODEL_ROUTED", "TASK_GRAPH_INVALID", "MISSION_CANCELLED", "DEADLINE_EXCEEDED"],
    blocker: ["UNSATISFIED_REQUIREMENT", "UNVERIFIED_REQUIREMENT", "CONFLICTED_CLAIM", "CRITICAL_POLICY_VIOLATION", "NO_MANDATORY_REQUIREMENT", "EXECUTION_INCOMPLETE"],
  };
  for (const [namespace, values] of Object.entries(members)) {
    for (const value of values) {
      const key = `p03.${namespace}.${value}`;
      for (const locale of ["en", "ar"] as const) {
        assert.ok(CATALOGS[locale][key] !== undefined, `${key} is missing in ${locale}`);
      }
    }
  }
});

// ——— أفعال التحكّم.

test("P03-UI-014 the control actions call exactly their own operations", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION), { executed: false });
  await act(async () => buttonNamed("Start").click());
  await settle();
  assert.ok(app.log.operations.includes("mission.start"), "start did not call mission.start");
  // البدء عملية مستقلّة عن الإنشاء: لا إنشاء ضمني.
  assert.ok(!app.log.operations.includes("mission.create"), "starting a mission created one");
  app.unmount();
});

test("P03-UI-015 reading a mission always reads its proof in the same call", async () => {
  const app = await mount(missionPath(P03_IDS.MISSION));
  assert.ok(app.log.operations.includes("mission.get"));
  // لا عملية منفصلة تقرأ الإثبات، فلا يمكن عرض الحالة دون قراءته.
  assert.ok(!app.log.operations.some((operation) => operation.includes("proof")));
  app.unmount();
});

// P03-E2E-04 انتظر ردّ mission.list مرة واحدة بعد 4 ms من النقر: الفاحص كان غير متزامن، فكان الوعد نفسه
// قيمةً غير فارغة تُعاد فورًا بدل الاستطلاع حتى المهلة. الانتظار يجب أن يستطلع الفاحص غير المتزامن حتى يجيب.
test("P03-UI waitFor polls an asynchronous probe until it answers, not once", async () => {
  let calls = 0;
  const found = await waitFor(async () => {
    calls += 1;
    return calls >= 3 ? "listed" : null;
  }, 2_000);
  assert.equal(found, "listed");
  assert.equal(calls, 3);
});

test("P03-UI waitFor returns null when an asynchronous probe never answers before the deadline", async () => {
  const started = Date.now();
  const found = await waitFor(async () => null, 200);
  assert.equal(found, null);
  assert.ok(Date.now() - started >= 150, "the deadline was honoured, not skipped");
});
