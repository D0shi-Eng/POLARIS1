// تكليف المكافأة الوظيفية مع Manus (2026-10-19): لصق الصور وإرفاق الملفات في المُنشئ.
//
// ما تثبته هذه الاختبارات:
//   ١ — صورة في الحافظة (لقطة شاشة ويندوز أو نسخ من متصفح) تصير مرفقًا: تُرسل إلى المضيف باسم فريد وامتداد من نوعها،
//       وتظهر مصغّرتها في شريحة المرفق، ولا يُلصق نصّ بدلها.
//   ٢ — لصق نصّ عادي لا يمسّ المرفقات ولا يمنع اللصق الافتراضي.
//   ٣ — عدّة ملفات في لصقة واحدة (نسخ من المستكشف) تصير مرفقات كلها.
//   ٤ — إزالة المرفق تحذفه من المضيف.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase03Client } from "../src/ipc/p03-client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase08Client } from "../src/ipc/p08-client";
import type { ModelListResultV1 } from "../src/generated/types/desktop-p02-result-v1";
import { pastedName } from "../src/p08/files";
import { visionOf } from "../src/p08/vision";
import { memoryLocation } from "../src/routes/location";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase08Host, P08_IDS, type FakePhase08Log } from "./support/fake-p08-host";

async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(): Promise<{ log: FakePhase08Log; unmount(): void }> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const { transport, log } = fakePhase08Host({});
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase03 = new Phase03Client({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase08 = new Phase08Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={phase03} phase04={phase04} phase08={phase08} location={memoryLocation("/")} />);
  });
  await settle();
  return { log, unmount: () => act(() => root.unmount()) };
}

/** حدث لصق بحافظة مصنوعة: ملفات (كما يعرضها WebView2 لصورة أو لملفات منسوخة) ونصّ اختياري. */
function pasteEvent(files: readonly File[], text = ""): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const items = files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }));
  const textItems = text === "" ? [] : [{ kind: "string", type: "text/plain", getAsFile: () => null }];
  Object.defineProperty(event, "clipboardData", {
    value: { files, items: [...items, ...textItems], types: [...(files.length > 0 ? ["Files"] : []), ...(text === "" ? [] : ["text/plain"])], getData: (t: string) => (t === "text/plain" ? text : "") },
  });
  return event;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

test("MP-ATT-001 a clipboard image becomes an attachment with a unique name, a thumbnail and no pasted text", async () => {
  const mounted = await mount();
  try {
    const area = document.getElementById("composer-input") as HTMLTextAreaElement;
    // لقطة شاشة ويندوز: WebView2 يعرضها ملفًّا اسمه «image.png».
    const event = pasteEvent([new File([PNG], "image.png", { type: "image/png" })]);
    await act(async () => {
      area.dispatchEvent(event);
    });
    await settle(14);
    assert.equal(event.defaultPrevented, true, "the paste fell through to the text field");
    const at = mounted.log.operations.indexOf("attachment.stage");
    assert.ok(at >= 0, "the pasted image never reached the host");
    const stage = mounted.log.payloads[at] ?? {};
    assert.match(String(stage["file_name"]), /^pasted-image-\d{8}-\d{6}(-\d+)?\.png$/);
    const chip = document.querySelector(".composer__files .chip--file");
    assert.ok(chip !== null, "no attachment chip");
    const thumb = chip.querySelector<HTMLImageElement>("img.chip__thumb");
    assert.ok(thumb !== null, "the image chip has no thumbnail");
    assert.match(thumb.getAttribute("src") ?? "", /^data:image\/png;base64,/);
    assert.equal(area.value, "");
  } finally {
    mounted.unmount();
  }
});

test("MP-ATT-002 pasting plain text leaves attachments alone and lets the text paste", async () => {
  const mounted = await mount();
  try {
    const area = document.getElementById("composer-input") as HTMLTextAreaElement;
    const event = pasteEvent([], "hello");
    await act(async () => {
      area.dispatchEvent(event);
    });
    await settle();
    assert.equal(event.defaultPrevented, false, "a text paste was blocked");
    assert.equal(mounted.log.operations.indexOf("attachment.stage"), -1);
  } finally {
    mounted.unmount();
  }
});

test("MP-ATT-003 several files pasted at once (copied in File Explorer) all become attachments, keeping their names", async () => {
  const mounted = await mount();
  try {
    const area = document.getElementById("composer-input") as HTMLTextAreaElement;
    const files = [new File(["%PDF-1.4"], "q3-sales.pdf", { type: "application/pdf" }), new File(["a,b\n1,2\n"], "sales.csv", { type: "text/csv" })];
    await act(async () => {
      area.dispatchEvent(pasteEvent(files));
    });
    await settle(18);
    const names = mounted.log.operations.flatMap((op, i) => (op === "attachment.stage" ? [String(mounted.log.payloads[i]?.["file_name"])] : []));
    assert.deepEqual(names, ["q3-sales.pdf", "sales.csv"]);
    assert.equal(document.querySelectorAll(".composer__files .chip--file").length, 2);
  } finally {
    mounted.unmount();
  }
});

test("MP-ATT-004 a removed attachment is discarded on the host", async () => {
  const mounted = await mount();
  try {
    const area = document.getElementById("composer-input") as HTMLTextAreaElement;
    await act(async () => {
      area.dispatchEvent(pasteEvent([new File([PNG], "image.png", { type: "image/png" })]));
    });
    await settle(14);
    const remove = document.querySelector<HTMLButtonElement>(".composer__files .chip__remove");
    assert.ok(remove !== null);
    await act(async () => {
      remove.click();
    });
    await settle();
    assert.ok(mounted.log.operations.includes("attachment.discard"), "the removed attachment stayed on the host");
    assert.equal(document.querySelectorAll(".composer__files .chip--file").length, 0);
  } finally {
    mounted.unmount();
  }
});

test("MP-ATT-005 pasted names: a generic clipboard name gets a timestamped name with the extension of its type; a real name is kept", () => {
  const at = new Date(2026, 9, 19, 19, 5, 7);
  assert.equal(pastedName(new File([PNG], "image.png", { type: "image/png" }), at, 0), "pasted-image-20261019-190507.png");
  assert.equal(pastedName(new File([PNG], "image.png", { type: "image/jpeg" }), at, 2), "pasted-image-20261019-190507-3.jpg");
  assert.equal(pastedName(new File([PNG], "", { type: "image/webp" }), at, 0), "pasted-image-20261019-190507.webp");
  assert.equal(pastedName(new File(["x"], "report.docx", { type: "" }), at, 0), "report.docx");
});

test("MP-ATT-006 the composer's vision verdict follows the model's declared capability, and an unknown claim is not a yes", () => {
  const model = (id: string, support: string, provenance: string) => ({
    model_id: id,
    display_name: { value: id, provenance: "PROVIDER_REPORTED" },
    capabilities: [{ capability: "VISION_INPUT", support, provenance }],
  });
  const list = {
    models: [model("lm-studio:vision", "SUPPORTED", "PROVIDER_REPORTED"), model("lm-studio:text", "UNSUPPORTED", "PROVIDER_REPORTED"), model("lm-studio:maybe", "UNKNOWN", "UNKNOWN")],
    preferences: { default_model_id: "lm-studio:text" },
  } as unknown as ModelListResultV1;
  assert.deepEqual(visionOf(list, "lm-studio:vision"), { modelName: "lm-studio:vision", sees: true });
  assert.deepEqual(visionOf(list, ""), { modelName: "lm-studio:text", sees: false }, "the default model was not used when none was chosen");
  assert.equal(visionOf(list, "lm-studio:maybe")?.sees, false);
  assert.equal(visionOf(list, "missing"), undefined);
  assert.equal(visionOf(null, "x"), undefined);
});

test("MP-ATT-007 an attachment without text can be sent, as in Manus, and the request says to look at the files", async () => {
  const mounted = await mount();
  try {
    const area = document.getElementById("composer-input") as HTMLTextAreaElement;
    const send = () => document.querySelector<HTMLButtonElement>(".composer__send");
    assert.equal(send()?.disabled, true, "send was enabled with nothing to send");
    await act(async () => {
      area.dispatchEvent(pasteEvent([new File([PNG], "image.png", { type: "image/png" })]));
    });
    await settle(14);
    assert.equal(send()?.disabled, false, "send stayed disabled with a ready attachment");
    await act(async () => {
      send()?.click();
    });
    await settle(14);
    const at = mounted.log.operations.indexOf("mission.create");
    assert.ok(at >= 0, "no mission was created");
    assert.match(String(mounted.log.payloads[at]?.["objective"]), /attached files/);
    assert.ok(mounted.log.operations.includes("attachment.bind"));
  } finally {
    mounted.unmount();
  }
});

test("MP-ATT-008 a turn shows what the user attached above the message, as Manus does", async () => {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const { transport } = fakePhase08Host({});
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase03 = new Phase03Client({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase08 = new Phase08Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={phase03} phase04={phase04} phase08={phase08} location={memoryLocation(`/missions/${P08_IDS.MISSION}`)} />);
  });
  await settle(16);
  try {
    const list = document.querySelector(".msg-user .msg-attachments");
    assert.ok(list !== null, "the turn shows no attachments");
    assert.ok((list.textContent ?? "").includes("notes.txt"), "the attached file is not named");
  } finally {
    act(() => root.unmount());
  }
});
