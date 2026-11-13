// تكليف مكافأة Manus (2026-10-20): حقلا تاريخ ووقت منفصلان للأتمتة «مرة واحدة» (D-MP-14)، وتأكيد قبل حذف الأتمتة (D-MP-16).
//
// قِيس في النسخة التنفيذية (649bc8e): حقل `datetime-local` في الواجهة العربية يعرض أرقامًا هندية ومقاطع بترتيب RTL، فيصعب ملؤه
// بالكتابة؛ وعند تعديل أتمتة «مرة واحدة» يبقى الحقل فارغًا لأن القيمة المحفوظة لحظة UTC («…Z») لا يقبلها الحقل. والحذف من قائمة «⋯»
// كان فوريًّا بلا سؤال.

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
import { onceInstant, onceParts } from "../src/p08/schedule-time";
import { memoryLocation } from "../src/routes/location";
import { scheduleRefreshForTest } from "../src/screens/p08/SchedulesScreen";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase08Host, type FakePhase08Log, type FakePhase08Options } from "./support/fake-p08-host";

const en = createTranslator("en");

async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(options: FakePhase08Options): Promise<{ log: FakePhase08Log; unmount(): void }> {
  const container = resetDocument();
  const root = createRoot(container);
  const { transport, log } = fakePhase08Host(options);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase03 = new Phase03Client({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase08 = new Phase08Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={phase03} phase04={phase04} phase08={phase08} location={memoryLocation("/schedules")} />);
  });
  await settle();
  return { log, unmount: () => act(() => root.unmount()) };
}

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label || b.getAttribute("aria-label") === label);
  assert.ok(found !== undefined, `no button "${label}"`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await settle();
}

/** يكتب قيمة في حقل يتحكّم فيه React (المُعيِّن الأصلي ثم حدث input أو change). */
async function fill(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await settle(3);
}

/** بند في «إعدادات الأتمتة» باسمه (نصّ الزرّ فيه قيمته أيضًا). */
function settingRow(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".mp-auto-menu__row")].find((b) => b.querySelector(".menu-item__label")?.textContent === label);
  assert.ok(found !== undefined, `no setting "${label}"`);
  return found;
}

/** خيار في قائمة فرعية باسمه (تحت الاسم وصف سطر). */
function choice(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button.menu-item")].find((b) => b.querySelector(".menu-item__label")?.textContent === label);
  assert.ok(found !== undefined, `no choice "${label}"`);
  return found;
}

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  assert.ok(el !== null, `no #${id}`);
  return el as HTMLInputElement;
}

test("MP-AUTO-002 schedule-time converts a wall-clock date and time in the schedule's offset to UTC and back", () => {
  assert.equal(onceInstant("2026-10-21", "09:30", "UTC+03:00"), "2026-10-21T06:30:00Z");
  assert.equal(onceInstant("2026-10-21", "01:15", "UTC+03:00"), "2026-10-20T22:15:00Z");
  assert.equal(onceInstant("2026-10-21", "09:30", "UTC-04:30"), "2026-10-21T14:00:00Z");
  assert.equal(onceInstant("2026-10-21", "09:30", "UTC"), "2026-10-21T09:30:00Z");
  assert.equal(onceInstant("", "09:30", "UTC+03:00"), null);
  assert.equal(onceInstant("2026-02-30", "09:30", "UTC+03:00"), null, "an impossible date is not silently moved to March");
  assert.equal(onceInstant("2026-10-21", "24:10", "UTC+03:00"), null);
  assert.deepEqual(onceParts("2026-10-20T22:15:00Z", "UTC+03:00"), { date: "2026-10-21", time: "01:15" });
  assert.deepEqual(onceParts("not a date", "UTC+03:00"), { date: "", time: "" });
});

test("MP-AUTO-003 a one-time automation has separate LTR date and time fields, saves the instant in its timezone and reopens with them", async () => {
  const mounted = await mount({});
  try {
    await click(button(en.t("ui.automation.start")));
    await click(document.querySelector(".mp-auto-how__opt") as HTMLButtonElement);
    await fill(document.getElementById("sch-objective") as HTMLTextAreaElement, "Send the weekly report");
    await fill(document.getElementById("sch-kind") as HTMLSelectElement, "ONCE");
    assert.ok(document.querySelector('input[type="datetime-local"]') === null, "the datetime-local field is still there (D-MP-14)");
    const date = input("sch-date");
    const time = input("sch-once-time");
    assert.equal(date.type, "date");
    assert.equal(time.type, "time");
    for (const field of [date, time]) {
      // ترتيب المقاطع LTR في الصفحة العربية. الأرقام يرسمها WebView2 بلغة النظام (قِيس أصليًّا: سمة lang لا تغيّرها)، فلا يُختبر غيرها هنا.
      assert.equal(field.getAttribute("dir"), "ltr", `#${field.id} is not LTR in the RTL page`);
    }
    await click(button(en.t("ui.automation.settings")));
    await click(settingRow(en.t("ui.automation.set.zone")));
    await fill(input("sch-tz"), "UTC+03:00");
    await fill(date, "2026-10-21");
    await fill(time, "09:30");
    const create = document.querySelector(".mp-compose__create") as HTMLButtonElement;
    assert.equal(create.disabled, false, "a complete one-time automation cannot be created");
    await act(async () => {
      create.form?.requestSubmit();
    });
    await settle();
    const at = mounted.log.operations.lastIndexOf("schedule.save");
    assert.ok(at >= 0, "nothing was saved");
    assert.deepEqual(mounted.log.payloads[at]?.["schedule"], { kind: "ONCE", at: "2026-10-21T06:30:00Z" });

    // التعديل يعيد الحقلين بتوقيت الجدول، لا فارغين.
    await click(button(en.t("ui.library.actions")));
    await click(button(en.t("p08.schedule.edit")));
    assert.equal(input("sch-date").value, "2026-10-21");
    assert.equal(input("sch-once-time").value, "09:30");
  } finally {
    mounted.unmount();
  }
});

test("MP-AUTO-004 deleting an automation asks first; Cancel keeps it and Delete removes it", async () => {
  const mounted = await mount({ savedSchedule: true });
  try {
    assert.equal(document.querySelectorAll(".mp-sched").length, 1);
    await click(button(en.t("ui.library.actions")));
    await click(button(en.t("p08.schedule.delete")));
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog !== null, "Delete acted without asking (D-MP-16)");
    assert.ok((dialog.textContent ?? "").includes("Write hello"), "the dialog does not name the automation");
    assert.equal(mounted.log.operations.includes("schedule.delete"), false, "deleted before the user confirmed");
    await click(button(en.t("ui.thread.cancel"), dialog));
    assert.ok(document.querySelector('[role="dialog"]') === null, "the dialog stayed open");
    assert.equal(mounted.log.operations.includes("schedule.delete"), false);
    assert.equal(document.querySelectorAll(".mp-sched").length, 1);

    await click(button(en.t("ui.library.actions")));
    await click(button(en.t("p08.schedule.delete")));
    const again = document.querySelector('[role="dialog"]') as HTMLElement;
    await click(button(en.t("p08.schedule.delete"), again));
    assert.equal(mounted.log.operations.filter((o) => o === "schedule.delete").length, 1);
    assert.ok(document.querySelector('[role="dialog"]') === null, "the dialog stayed open");
    assert.equal(document.querySelectorAll(".mp-sched").length, 0);
  } finally {
    mounted.unmount();
  }
});

test("CP14-UI-01 the Automation page says it runs only while POLARIS is open, and labels late, retried and skipped runs", async () => {
  const mounted = await mount({ savedSchedule: true, phase14Runs: true });
  try {
    await click(document.querySelector(".mp-sched__open") as HTMLButtonElement);
    const text = document.body.textContent ?? "";
    assert.ok(text.includes(en.t("p08.schedule.note_app_open")), "the page with schedules does not say they run only while POLARIS is open");
    assert.ok(text.includes(en.t("p08.schedule.trigger.CATCH_UP")), "a late run is not labelled late");
    assert.ok(text.includes(en.t("p08.schedule.trigger.RETRY")), "a retry is not labelled");
    assert.ok(text.includes(en.t("p08.schedule.status.SKIPPED_PREVIOUS_ACTIVE")), "a skipped run shows a raw code");
    assert.ok(text.includes(en.t("p08.schedule.status.START_FAILED")));
    const late = [...document.querySelectorAll(".mp-sched__run")].find((li) => (li.textContent ?? "").includes(en.t("p08.schedule.trigger.CATCH_UP")));
    assert.ok(late?.getAttribute("title")?.includes("not running"), "the host's note about the missed runs is not reachable");
  } finally {
    mounted.unmount();
  }
});

// CP-14-6: قِيس 2026-10-23 في النسخة التنفيذية أن إعادة المحاولة التي أطلقتها النبضة لم تظهر، وبقي «التشغيل التالي» قديمًا، حتى غادرتُ الصفحة وعدت.
test("CP14-UI-02 the Automation page re-reads its schedules while it is open, so a run fired by the background tick appears", async () => {
  scheduleRefreshForTest(20);
  const mounted = await mount({ savedSchedule: true });
  try {
    const reads = () => mounted.log.operations.filter((operation) => operation === "schedule.list").length;
    const before = reads();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    await settle();
    assert.ok(reads() > before, `the page did not re-read its schedules on its own (${before} then ${reads()})`);
  } finally {
    mounted.unmount();
    scheduleRefreshForTest(30_000);
  }
});

// مكافأة الأتمتة مع Manus (2026-10-23): قِيس في Manus 2.0.7 أن «جدول المهام» يحوّل المُنشئ إلى «عندما … / سيقوم Manus بـ»، وأن
// «إعدادات الأتمتة» فيها «التأكيدات» و«التشغيل في» و«تاريخ الانتهاء». POLARIS كان يضع التكرار داخل القائمة ولا يعرف شهريًا ولا نفس المهمة.
test("AUTO-UI-01 choosing Schedule turns the composer into a When card, and a monthly same-task automation with an end date is saved as chosen", async () => {
  const mounted = await mount({});
  try {
    await click(button(en.t("ui.automation.start")));
    await click(document.querySelector(".mp-auto-how__opt") as HTMLButtonElement);
    assert.equal(document.querySelector(".mp-auto-when__title")?.textContent, en.t("ui.automation.when_title"));
    assert.equal(document.querySelector(".mp-auto-when__do")?.textContent, en.t("ui.automation.will_do"));
    const kinds = [...(document.getElementById("sch-kind") as HTMLSelectElement).options].map((o) => o.value);
    assert.deepEqual(kinds.slice(0, 4), ["DAILY", "WEEKLY", "MONTHLY", "ONCE"], "the repeat choices are not Manus's order");
    await fill(document.getElementById("sch-kind") as HTMLSelectElement, "MONTHLY");
    await click(button(en.t("ui.automation.month_days")));
    await click([...document.querySelectorAll<HTMLButtonElement>(".mp-auto-when__month button")].find((b) => b.textContent === "15") as HTMLButtonElement);
    await fill(input("sch-time"), "09:00");
    await fill(document.getElementById("sch-objective") as HTMLTextAreaElement, "Summarise the month");
    await click(button(en.t("ui.automation.settings")));
    await click(settingRow(en.t("ui.automation.set.target")));
    await click(choice(en.t("ui.automation.target.SAME_TASK")));
    await click(button(en.t("ui.automation.set.target")));
    await click(settingRow(en.t("ui.automation.set.approvals")));
    const options = [...document.querySelectorAll(".menu-item__label")].map((l) => l.textContent);
    assert.ok(!options.some((o) => /no approval|skip/i.test(o ?? "")), `an option skips approvals: ${options.join(", ")}`);
    await click(button(en.t("ui.automation.set.approvals")));
    await click(settingRow(en.t("ui.automation.set.end")));
    await fill(input("sch-end"), "2026-12-31");
    const create = document.querySelector(".mp-compose__create") as HTMLButtonElement;
    assert.equal(create.disabled, false);
    await act(async () => {
      create.form?.requestSubmit();
    });
    await settle();
    const saved = mounted.log.payloads[mounted.log.operations.lastIndexOf("schedule.save")] ?? {};
    assert.deepEqual(saved["schedule"], { kind: "MONTHLY", days: [1, 15], time: "09:00" });
    assert.equal(saved["run_target"], "SAME_TASK");
    assert.equal(saved["approval_policy"], "WAIT_FOR_APPROVAL");
    assert.equal(saved["end_at"], onceInstant("2026-12-31", "23:59", saved["timezone"] as string));
  } finally {
    mounted.unmount();
  }
});

test("AUTO-UI-02 an automation's page shows its sentence, filters its run history, asks before pausing and seeds a task to ask why a run failed", async () => {
  const mounted = await mount({ savedSchedule: true, phase14Runs: true });
  try {
    await click(document.querySelector(".mp-sched__open") as HTMLButtonElement);
    assert.ok((document.body.textContent ?? "").includes(en.t("ui.automation.history")));
    const rows = () => document.querySelectorAll(".mp-auto-detail__runs .mp-sched__run").length;
    assert.equal(rows(), 3);
    await click(button(en.t("ui.automation.filter.failed")));
    assert.equal(rows(), 1, "the failed filter does not keep only the failed run");
    await click(button(en.t("ui.automation.filter.ok")));
    assert.equal(rows(), 1);
    await click(button(en.t("ui.automation.filter.all")));
    assert.equal(rows(), 3);

    await click(button(en.t("ui.automation.pause")));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    assert.ok(dialog !== null, "Pause acted without asking");
    assert.equal(mounted.log.operations.includes("schedule.enable"), false);
    await click(button(en.t("ui.automation.pause"), dialog));
    const at = mounted.log.operations.lastIndexOf("schedule.enable");
    assert.ok(at >= 0, "the schedule was not paused after confirming");
    assert.equal(mounted.log.payloads[at]?.["enabled"], false);

    await click(button(en.t("ui.automation.ask_why")));
    const composer = document.querySelector("textarea") as HTMLTextAreaElement | null;
    assert.ok(composer !== null, "Ask why did not open the composer");
    assert.ok(composer.value.includes("investigate why this automation run failed") && composer.value.includes("the provider could not be reached"), composer.value);
    assert.equal(mounted.log.operations.includes("mission.create"), false, "Ask why sent a task by itself");
  } finally {
    mounted.unmount();
  }
});
