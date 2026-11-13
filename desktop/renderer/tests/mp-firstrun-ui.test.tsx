// قرار المالك (2026-10-20، PHASE-01-MODEL-SETTINGS): إعداد المزوّد واختيار النموذج في «الإعدادات ← المزوّدون/النماذج» وحدها.
// لا بطاقة «اختر نموذجًا لتبدأ» في الرئيسية (كانت ADR-042)، والرئيسية تبقى كما هي. حين لا يوجد نموذج محادثة صالح
// يقول المُنشئ ذلك عند الإرسال ويفتح الإعدادات، ولا يُنشئ مهمّة كان التوجيه في المضيف سيرفضها قبل الاستدلال.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase02Client } from "../src/ipc/p02-client";
import { Phase03Client } from "../src/ipc/p03-client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase08Client } from "../src/ipc/p08-client";
import type { Transport } from "../src/ipc/transport";
import { createTranslator } from "../src/localization/translate";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase02Host } from "./support/fake-p02-host";
import { fakePhase08Host, type FakePhase08Log } from "./support/fake-p08-host";

const en = createTranslator("en");

async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

interface Mounted {
  readonly log: FakePhase08Log;
  readonly location: LocationPort;
  readonly phase02: Phase02Client;
  unmount(): void;
}

/** مضيف واحد للتطبيق كله: عمليات المزوّدين والنماذج من تجهيزة Phase-02، والباقي من تجهيزة Phase-08. */
async function mount(): Promise<Mounted> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const p02 = fakePhase02Host();
  const p08 = fakePhase08Host();
  const transport: Transport = {
    send(envelope, options) {
      const operation = String((envelope as Record<string, unknown>)["operation"]);
      return operation.startsWith("provider.") || operation.startsWith("model.") ? p02.transport.send(envelope, options) : p08.transport.send(envelope, options);
    },
  };
  const phase02 = new Phase02Client({ transport, identity: IDENTITY });
  const location = memoryLocation("/");
  await act(async () => {
    root.render(
      <AppRoot
        client={new DesktopIpcClient({ transport, identity: IDENTITY })}
        phase02={phase02}
        phase03={new Phase03Client({ transport, identity: IDENTITY })}
        phase04={new Phase04Client({ transport, identity: IDENTITY })}
        phase08={new Phase08Client({ transport, identity: IDENTITY })}
        location={location}
      />,
    );
  });
  await settle();
  return { log: p08.log, location, phase02, unmount: () => act(() => root.unmount()) };
}

async function type(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

async function click(element: Element | null): Promise<void> {
  assert.ok(element !== null, "the element to click is absent");
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function send(text: string): Promise<void> {
  await type(document.getElementById("composer-input") as HTMLTextAreaElement, text);
  await click(document.querySelector(".composer__send"));
}

test("MP-FR-001 Home shows no model-setup card when no model is usable; the Home layout is unchanged", async () => {
  const mounted = await mount();
  try {
    assert.equal(document.querySelector(".first-run"), null, "a first-run card is still on Home");
    assert.ok(!(document.body.textContent ?? "").includes("Choose a model to start"), "the old setup title is still on Home");
    // الرئيسية كما كانت: البطاقات الثلاث، والمُنشئ، ومحدّد النموذج في الأعلى.
    assert.equal(document.querySelectorAll(".home2-card").length, 3);
    assert.ok(document.getElementById("composer-input") !== null, "no composer");
    assert.ok(document.getElementById("composer-model") !== null, "no model picker");
  } finally {
    mounted.unmount();
  }
});

test("MP-FR-002 sending with no usable model creates no mission, says so, and opens Settings > Providers", async () => {
  const mounted = await mount();
  try {
    await send("Summarise the architecture");
    assert.ok(!mounted.log.operations.includes("mission.create"), "a mission was created with no usable model");
    assert.ok(!mounted.log.operations.includes("mission.start"), "a mission was started with no usable model");
    const alert = document.querySelector(".composer-wrap [role=alert]");
    assert.ok(alert?.textContent?.includes(en.t("p08.composer.no_models")), "the composer does not say a model is missing");
    await click(alert?.querySelector(".composer__settings") ?? null);
    assert.equal(mounted.location.read(), "/providers");
  } finally {
    mounted.unmount();
  }
});

test("MP-FR-003 once a model is enabled in Settings, the same send creates and starts the mission", async () => {
  const mounted = await mount();
  try {
    assert.ok((await mounted.phase02.refreshProviders(["fixture-local"])).ok);
    assert.ok((await mounted.phase02.configureModel("fixture-local:fixture-chat", true)).ok);
    await send("Summarise the architecture");
    const order = mounted.log.operations.filter((op) => op === "mission.create" || op === "mission.start");
    assert.deepEqual(order.slice(0, 2), ["mission.create", "mission.start"]);
    assert.equal(document.querySelector(".composer-wrap [role=alert]"), null);
  } finally {
    mounted.unmount();
  }
});
