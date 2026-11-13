// تكليف مكافأة Manus (2026-10-20): «المكتبة» في قائمة «+» بالمُنشئ.
//
// في Manus تحمل قائمة «+» المهارات والمهام الأخيرة والمكتبة والإنشاءات. هنا: قسم «المكتبة» يعرض أحدث ملفات المخرجات، واختيار أحدها
// يرفق نسخة منه بالرسالة (العارض يسمّي المخرَج بمعرّفه فقط، والمضيف يقرأ ملفه). المجلدات (موقع، مشروع شيفرة) لا تُعرض.

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
import { fakePhase08Host, P08_IDS } from "./support/fake-p08-host";

async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

test("MP-LIB-001 the + menu lists Library files and attaches the chosen one by its artifact id", async () => {
  const container = resetDocument();
  const root = createRoot(container);
  const { transport, log } = fakePhase08Host({ siteArtifact: true });
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase03 = new Phase03Client({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase08 = new Phase08Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={phase03} phase04={phase04} phase08={phase08} location={memoryLocation("/")} />);
  });
  await settle();
  try {
    const en = createTranslator("en");
    const plus = document.querySelector(`button[aria-label="${en.t("ui.plus.label")}"]`) as HTMLButtonElement | null;
    assert.ok(plus !== null, "no + button");
    await act(async () => {
      plus.click();
    });
    await settle();
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu !== null, "the + menu did not open");
    assert.ok((menu.textContent ?? "").includes(en.t("ui.plus.library")), "no Library heading in the + menu");
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const file = items.find((i) => (i.textContent ?? "").includes("Quarterly summary"));
    assert.ok(file !== undefined, `the Library file is not listed: ${items.map((i) => i.textContent).join(" | ")}`);
    assert.ok(!items.some((i) => (i.textContent ?? "").includes("Landing site")), "a folder artifact cannot be attached as one file");
    await act(async () => {
      (file as HTMLButtonElement).click();
    });
    await settle(14);
    const at = log.operations.indexOf("attachment.artifact.stage");
    assert.ok(at >= 0, `the choice never reached the host: ${log.operations.join(",")}`);
    assert.deepEqual(log.payloads[at], { artifact_id: P08_IDS.ARTIFACT });
    const chip = document.querySelector(".composer__files .chip--file");
    assert.ok(chip !== null, "no attachment chip after choosing a Library file");
    assert.ok((chip.textContent ?? "").includes("summary.docx"), chip.textContent ?? "");
    assert.ok(chip.classList.contains("is-ready"), chip.className);
  } finally {
    act(() => root.unmount());
  }
});
