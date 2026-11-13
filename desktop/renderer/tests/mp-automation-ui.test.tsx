// تكليف مكافأة Manus (2026-10-19): «شغّل الآن» في صفحة الأتمتة يُظهر سطر التشغيل حين يُسجَّل، بحالة بلغة الواجهة.
//
// قِيس في النسخة التنفيذية (38f81a3 مع Bonsai 2): التشغيل اكتمل وسُجّل في القاعدة، والصفحة بقيت بلا سطره حتى أُعيد فتحها، والحالة
// ظهرت «COMPLETED» خامًا في الواجهة العربية.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase03Client } from "../src/ipc/p03-client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase08Client } from "../src/ipc/p08-client";
import { createTranslator } from "../src/localization/translate";
import { memoryLocation } from "../src/routes/location";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase08Host } from "./support/fake-p08-host";

async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

test("MP-AUTO-001 a run started with Run now appears on the page when the host records it, with a translated state", async () => {
  const container = resetDocument();
  const root = createRoot(container);
  const { transport } = fakePhase08Host({ savedSchedule: true });
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase03 = new Phase03Client({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase08 = new Phase08Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={phase03} phase04={phase04} phase08={phase08} location={memoryLocation("/schedules")} />);
  });
  await settle();
  try {
    const en = createTranslator("en");
    const run = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === en.t("p08.schedule.run_now"));
    assert.ok(run !== undefined, "no Run now button");
    await act(async () => {
      run.click();
    });
    await settle();
    assert.equal(document.querySelectorAll(".mp-sched__run").length, 0, "the fixture recorded the run too early");
    await wait(4_500);
    await settle();
    await wait(4_500);
    await settle();
    const rows = document.querySelectorAll(".mp-sched__run");
    assert.equal(rows.length, 1, "the recorded run did not appear without reopening the page");
    assert.ok((rows[0]?.textContent ?? "").includes(en.t("p03.mission_state.COMPLETED")), "the run state is not translated");
    assert.ok(!(rows[0]?.textContent ?? "").includes("COMPLETED"), "the raw state code is shown");
  } finally {
    act(() => root.unmount());
  }
});
