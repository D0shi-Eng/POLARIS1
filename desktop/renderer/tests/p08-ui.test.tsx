// Phase-08 في العارض: المُنشئ، والمرفقات، ومساحة المهمّة، والمعاينة المعزولة، والمجدول،
// والإعدادات الجديدة، والاتجاهان.
//
// ما تثبته هذه الاختبارات:
//   ١ — لا مسار تنفيذ في العارض: مفردات Phase-08 اثنتان وثلاثون عملية ليس فيها تشغيل ولا تصفّح.
//   ٢ — المرفق يُرسل اسمًا ومحتوى، لا مسارًا؛ و«ابدأ» ينشئ مهمّة ثم يربط ثم يبدأ.
//   ٣ — مساحة المهمّة تعرض ما قاسه المضيف: الخطة، والأفعال، والملفات، والطرفيّة، والمخرجات.
//   ٤ — صفحة HTML من المساحة تُعرض في إطار `sandbox` فارغ: لا نصوص برمجية.
//   ٥ — الموافقة تعرض ملخّص المضيف، والموافقة تُرسل ثم تُستأنف المهمّة.
//   ٦ — الجدول يُحفظ بحمولة مغلقة، والإعدادات تُبحث، والعربية تقلب الاتجاه.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { PHASE08_IPC_REGISTRY } from "../src/generated/contract-bundle";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase03Client } from "../src/ipc/p03-client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase08Client } from "../src/ipc/p08-client";
import { PHASE08_OPERATIONS } from "../src/ipc/operations";
import { computerSideOf, FailureNote } from "../src/screens/p08/MissionWorkspace";
import { planSteps } from "../src/screens/p08/StepTree";
import { TranslatorProvider } from "../src/app/context";
import { uiLocaleChoices } from "../src/localization/types";
import { storeSpecialist } from "../src/p08/specialists";
import { createTranslator } from "../src/localization/translate";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase08Host, HOSTILE_HTML, P08_IDS, type FakePhase08Log, type FakePhase08Options } from "./support/fake-p08-host";

const en = createTranslator("en");

async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

interface Mounted {
  readonly log: FakePhase08Log;
  readonly location: LocationPort;
  unmount(): void;
}

async function mount(path: string, options: FakePhase08Options = {}): Promise<Mounted> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const { transport, log } = fakePhase08Host(options);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase03 = new Phase03Client({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase08 = new Phase08Client({ transport, identity: IDENTITY });
  const location = memoryLocation(path);
  await act(async () => {
    root.render(<AppRoot client={client} phase03={phase03} phase04={phase04} phase08={phase08} location={location} />);
  });
  await settle();
  return { log, location, unmount: () => act(() => root.unmount()) };
}

function body(): string {
  return document.body.textContent ?? "";
}

async function click(element: Element | null): Promise<void> {
  assert.ok(element !== null, "the element to click is absent");
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text) ?? null;
}

async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

test("P08-UI-001 the renderer can name sixty-three Phase-08 operations (seven of them the conversation, two the agents catalog, project deletion, remember-this, four providers of ADR-037, the trace view and MCP redefinition acceptance of ADR-041, the ten of ADR-042, the Library attach of 2026-10-20, and the three semantic-memory settings of PHASE-12) and none of them executes anything", () => {
  assert.equal(PHASE08_OPERATIONS.length, 63);
  assert.deepEqual(
    PHASE08_OPERATIONS.map((r) => r.operation),
    PHASE08_IPC_REGISTRY.operations.map((r) => r.operation),
  );
  for (const record of PHASE08_OPERATIONS) {
    assert.doesNotMatch(record.operation, /command|python|execute|navigate|\.write|token|send/);
  }
});

// قرار المالك (2026-09-30): حقائق البناء والجهاز ليست مكانها الرئيسية؛ تنتقل إلى «الإعدادات ← حول».
test("P08-UI-002 Home asks one question and offers examples; the build facts live in Settings > About, not on Home", async () => {
  const mounted = await mount("/");
  try {
    assert.ok(body().includes(en.t("p08.home.prompt")));
    assert.ok(document.getElementById("composer-input") !== null, "no composer");
    // مانوس 2.0 (2026-10-05): بطاقتا «بناء» و«إنشاء» وبطاقة «البدء من ملف محلي»، وصفّ السياق فوق المُنشئ.
    assert.equal(document.querySelectorAll(".home2-card").length, 3);
    assert.ok(document.querySelector(".composer__strip") !== null, "no context strip above the composer");
    // إعادة التصميم (2026-09-30): المهامّ الأخيرة في الشريط الجانبي، والمخرجات في المكتبة لا في الرئيسية
    assert.ok(document.querySelector(".shell__rail")?.textContent?.includes("summarise the architecture"), "recent missions are not listed in the sidebar");
    assert.ok(!body().includes("0.1.0"), "the build facts are still on Home");
    // «إنشاء» ثم نوع، كما في مانوس 2.0 (2026-10-06): لوحة «أنشئ …» بأفكار، وشريحة النوع في المُنشئ. الفكرة تملأ المُنشئ
    // ولا ترسل شيئًا؛ والإغلاق يعيد البطاقات ويزيل الشريحة.
    await click(document.querySelector(".home2-card--create"));
    await click(buttonWithText(en.t("ui.tpl.analysis")));
    assert.ok(body().includes(en.t("ui.kind.analysis.title")), "the kind panel did not open");
    assert.ok(document.querySelector(".composer__kind")?.textContent?.includes(en.t("ui.tpl.analysis")), "the composer does not carry the kind chip");
    await click(buttonWithText(en.t("ui.kind.analysis.idea.1")));
    const area = document.getElementById("composer-input") as HTMLTextAreaElement;
    assert.equal(area.value, en.t("ui.kind.analysis.idea.1"));
    await click(document.querySelector(".kind-panel__head button[aria-label='" + en.t("ui.close") + "']"));
    assert.equal(document.querySelectorAll(".home2-card").length, 3, "the cards did not return after the panel closed");
    assert.equal(document.querySelector(".composer__kind"), null, "the kind chip stayed after the panel closed");
  } finally {
    mounted.unmount();
  }
});

test("P08-UI-003 an attachment is sent as a name and content, and starting creates, binds, then starts", async () => {
  const mounted = await mount("/");
  try {
    const input = document.querySelector<HTMLInputElement>(".composer input[type=file]");
    assert.ok(input !== null);
    const file = new File(["alpha"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(12);
    const stage = mounted.log.payloads[mounted.log.operations.indexOf("attachment.stage")] ?? {};
    assert.deepEqual(Object.keys(stage).sort(), ["content_base64", "file_name"]);
    assert.equal(stage["file_name"], "notes.txt");
    assert.equal(stage["content_base64"], btoa("alpha"));
    await type(document.getElementById("composer-input") as HTMLTextAreaElement, "Summarise the attached notes into a report");
    await click(document.querySelector(".composer__send"));
    const order = mounted.log.operations.filter((op) => ["mission.create", "attachment.bind", "mission.start"].includes(op));
    assert.deepEqual(order.slice(0, 3), ["mission.create", "attachment.bind", "mission.start"]);
    assert.equal(mounted.location.read(), `/missions/${P08_IDS.MISSION}`);
  } finally {
    mounted.unmount();
  }
});

test("P08-UI-004 the mission workspace shows the plan, what POLARIS did, files, terminal and verified artifacts", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`);
  try {
    assert.ok(document.getElementById("mission-tab-work") !== null, "no workspace tab");
    // سطر الفعل باسم عمله كما في مانوس («Running Python»)، لا بجملة ماضٍ.
    assert.ok(body().includes(en.t("ui.act.execution_python")), "the sandbox run is not described");
    // حاسوب POLARIS يظهر لأن الوكيل استعمل Python، ويُفتح على الطرفية (تغيير مُعلَن 2026-10-01:
    // كان يُفتح على الملفات، ولسان المخرجات انتقل إلى المكتبة و«كل الملفات»).
    await click(buttonWithText(en.t("ui.computer.title")));
    assert.ok(document.querySelector(".run__output")?.textContent?.includes("45"));
    await click(buttonWithText(en.t("p08.computer.files")));
    assert.ok(body().includes("notes.txt"));
    assert.equal(buttonWithText(en.t("p08.computer.artifacts")), null, "the computer still carries an artifacts tab");
  } finally {
    mounted.unmount();
  }
  // المخرجات المحقَّقة تُقرأ في المكتبة بحالة تحقّقها.
  const library = await mount("/artifacts");
  try {
    assert.ok(body().includes("Quarterly summary") && body().includes(en.t("p08.verification.VERIFIED")));
  } finally {
    library.unmount();
  }
});

test("P08-UI-005 an HTML file from the workspace is previewed in a sandboxed frame with scripts off", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`);
  try {
    await click(buttonWithText(en.t("ui.computer.title")));
    await click(buttonWithText(en.t("p08.computer.files")));
    const site = [...document.querySelectorAll<HTMLButtonElement>(".tree__item")].find((b) => b.textContent?.includes("site.html"));
    await click(site ?? null);
    const frame = document.querySelector<HTMLIFrameElement>("iframe.preview__frame");
    assert.ok(frame !== null, "no preview frame");
    assert.equal(frame.getAttribute("sandbox"), "", "the frame is not fully sandboxed");
    assert.equal(frame.getAttribute("srcdoc"), HOSTILE_HTML);
    assert.equal(document.querySelectorAll("script").length, 0, "a script from the workspace reached the renderer document");
  } finally {
    mounted.unmount();
  }
});

// DEF-36 (تدقيق 2026-10-29): الرفض كان يُسجَّل ولا يُستأنف الدور، فتبقى المهمّة «تنتظر موافقة» بلا بطاقة. زمن التشغيل يخبر الوكيل
// بالرفض عند الاستئناف (R-24)، فالرفض مثل الموافقة يستأنف الدور.
test("P08-UI-006b denying an approval answers it then resumes the mission so the agent learns of the denial", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`, { pendingApproval: true });
  try {
    const before = mounted.log.operations.filter((op) => op === "mission.start").length;
    await click(buttonWithText(en.t("p08.approval.deny")));
    const respond = mounted.log.payloads[mounted.log.operations.lastIndexOf("tool.approval.respond")] ?? {};
    assert.deepEqual(respond, { approval_id: P08_IDS.APPROVAL, decision: "DENY" });
    assert.ok(mounted.log.operations.filter((op) => op === "mission.start").length > before, "the mission was not resumed after the denial");
  } finally {
    mounted.unmount();
  }
});

test("P08-UI-006 an approval shows the host's summary, and approving answers it then resumes the mission", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`, { pendingApproval: true });
  try {
    assert.ok(body().includes("The browser may send data to this site."));
    assert.ok(body().includes("https://shop.test"));
    const before = mounted.log.operations.filter((op) => op === "mission.start").length;
    await click(buttonWithText(en.t("p08.approval.grant")));
    const respond = mounted.log.payloads[mounted.log.operations.lastIndexOf("tool.approval.respond")] ?? {};
    assert.deepEqual(respond, { approval_id: P08_IDS.APPROVAL, decision: "GRANT" });
    assert.ok(mounted.log.operations.filter((op) => op === "mission.start").length > before, "the mission was not resumed after approval");
  } finally {
    mounted.unmount();
  }
});

test("P08-UI-007 a weekly schedule is saved with a closed payload that grants nothing", async () => {
  const mounted = await mount("/schedules");
  try {
    // مانوس 2.0: «ابدأ الآن» ← «جدول المهام» ← الطلب في المُنشئ ← التكرار في «إعدادات الأتمتة» ← «إنشاء».
    await click(buttonWithText(en.t("ui.automation.start")));
    const create = () => buttonWithText(en.t("ui.automation.create"));
    assert.equal(create()?.disabled, true, "Create is enabled before a start kind is chosen");
    await click(document.querySelector<HTMLButtonElement>(".mp-auto-how__opt"));
    await type(document.getElementById("sch-objective") as HTMLTextAreaElement, "Summarise the week");
    await click(document.querySelector<HTMLButtonElement>(".mp-compose__set"));
    const kind = document.getElementById("sch-kind") as HTMLSelectElement;
    await act(async () => {
      kind.value = "WEEKLY";
      kind.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(2);
    const form = document.querySelector("form.mp-compose") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    const saved = mounted.log.payloads[mounted.log.operations.indexOf("schedule.save")] ?? {};
    assert.deepEqual(saved["schedule"], { kind: "WEEKLY", days: ["SUN"], time: "08:00" });
    assert.equal(saved["approval_policy"], "WAIT_FOR_APPROVAL");
    assert.equal(saved["name"], "Summarise the week");
    assert.ok(!("approve" in saved) && !("auto_approve" in saved));
    await click(buttonWithText(en.t("p08.schedule.run_now")));
    assert.ok(mounted.log.operations.includes("schedule.run_now"));
  } finally {
    mounted.unmount();
  }
});

test("P08-UI-008 Arabic turns the whole workspace right-to-left with its own text", async () => {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const { transport } = fakePhase08Host();
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase03={new Phase03Client({ transport, identity: IDENTITY })} phase08={new Phase08Client({ transport, identity: IDENTITY })} location={memoryLocation("/")} />);
  });
  await settle();
  const select = document.querySelector<HTMLSelectElement>(".header-tools select");
  assert.ok(select !== null);
  await act(async () => {
    select.value = "ar";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  const ar = createTranslator("ar");
  assert.equal(document.documentElement.getAttribute("dir"), "rtl");
  assert.equal((document.getElementById("composer-input") as HTMLTextAreaElement).placeholder, ar.t("p08.composer.placeholder"));
  assert.ok(body().includes(ar.t("p08.home.prompt")));
  act(() => root.unmount());
});

test("P08-UI-009 the agents page lists specialists by field, and starting a task with one pins it to the new task", async () => {
  storeSpecialist("");
  const mounted = await mount("/agents");
  try {
    const cards = () => [...document.querySelectorAll(".agent-card")];
    assert.equal(cards().length, 3, "the catalog cards are not rendered");
    // تصفية بالمجال ثم بالبحث (الأسماء بلغة الواجهة).
    await click([...document.querySelectorAll<HTMLButtonElement>(".agents-domain")].find((b) => b.textContent?.includes("Writing")) ?? null);
    assert.equal(cards().length, 1);
    await click([...document.querySelectorAll<HTMLButtonElement>(".agents-domain")][0] ?? null);
    await type(document.querySelector<HTMLInputElement>(".search-box input") as HTMLInputElement, "ratios");
    assert.equal(cards().length, 1);
    assert.ok(cards()[0]?.textContent?.includes("Financial analyst"));
    // أدوار سير العمل باقية في قسم مطويّ.
    assert.ok(document.querySelector(".agents-roles table") !== null, "the workflow roles are gone");
    // التفاصيل، ثم «ابدأ مهمّة معه».
    await click(cards()[0] ?? null);
    const dialog = document.querySelector("[role=dialog]");
    assert.ok(dialog?.textContent?.includes(en.t("ui.agents.dialog.note")));
    await click(buttonWithText(en.t("ui.agents.start")));
    assert.equal(mounted.location.read(), "/");
    await settle(12);
    assert.ok(body().includes(en.t("ui.agents.with", { name: "Financial analyst" })), "the composer does not show the pinned agent");
    await type(document.getElementById("composer-input") as HTMLTextAreaElement, "Analyse last year's statements");
    await click(document.querySelector(".composer__send"));
    const ops = mounted.log.operations;
    const pin = ops.indexOf("mission.specialist.set");
    assert.ok(pin > ops.indexOf("mission.create") && pin < ops.indexOf("conversation.begin"), `the agent was not pinned before the conversation began: ${ops.join(",")}`);
    assert.deepEqual(mounted.log.payloads[pin], { mission_id: P08_IDS.MISSION, specialist_id: "finance.financial-analyst" });
  } finally {
    mounted.unmount();
  }
});

// قِيس 2026-10-01: لم تكن في المضيف ولا في الواجهة إعادة تسمية ولا تثبيت ولا أرشفة ولا حذف ولا نقل إلى مشروع.
test("P08-UI-010 the task menu renames, pins, archives and deletes a conversation through the host, and the sidebar follows", async () => {
  const mounted = await mount("/");
  try {
    const row = () => [...document.querySelectorAll<HTMLElement>(".rail-thread")].find((li) => li.querySelector(".rail-missions__item") !== null) ?? null;
    assert.ok(row() !== null, "the conversation is not in the sidebar");
    const openMenu = async () => click(row()?.querySelector(`button[aria-label="${en.t("ui.thread.menu")}"]`) ?? null);

    // إعادة التسمية: حوار «تحرير العنوان»، والعنوان الجديد يأتي من المضيف لا من نسخة محلية.
    await openMenu();
    await click(buttonWithText(en.t("ui.thread.rename")));
    const input = document.getElementById("thread-title") as HTMLInputElement;
    assert.ok(input !== null, "the rename dialog has no title field");
    await type(input, "  Short greeting ");
    await click(buttonWithText(en.t("ui.thread.confirm")));
    const rename = mounted.log.operations.lastIndexOf("conversation.update");
    assert.deepEqual(mounted.log.payloads[rename], { thread_id: P08_IDS.MISSION, title: "Short greeting" });
    await settle(8);
    assert.ok(row()?.textContent?.includes("Short greeting"), "the sidebar kept the old title");

    // التثبيت يظهر علامة على الصفّ.
    await openMenu();
    await click(buttonWithText(en.t("ui.thread.pin")));
    assert.deepEqual(mounted.log.payloads[mounted.log.operations.lastIndexOf("conversation.update")], { thread_id: P08_IDS.MISSION, pinned: true });
    await settle(8);
    assert.ok(row()?.querySelector(".rail-thread__pin") !== null, "the pinned conversation shows no pin");

    // الأرشفة تخفيها من القائمة، وتصفية «المؤرشفة» تعيدها.
    await openMenu();
    await click(buttonWithText(en.t("ui.thread.archive")));
    await settle(8);
    assert.equal(row(), null, "an archived conversation is still listed");
    await click(document.querySelector(`button[aria-label="${en.t("ui.rail.filter")}"]`));
    await click(buttonWithText(en.t("ui.rail.filter_archived")));
    assert.ok(row() !== null, "the archived filter does not show the archived conversation");

    // الحذف بتأكيد صريح، ثم تختفي المحادثة.
    await openMenu();
    await click(buttonWithText(en.t("ui.thread.delete")));
    const dialog = document.querySelector("[role=dialog]");
    assert.ok(dialog?.textContent?.includes(en.t("ui.thread.delete_title")), "no confirmation before deleting");
    assert.equal(mounted.log.operations.includes("conversation.delete"), false, "deleted before confirming");
    await click([...(dialog?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === en.t("ui.thread.delete")) ?? null);
    assert.deepEqual(mounted.log.payloads[mounted.log.operations.lastIndexOf("conversation.delete")], { thread_id: P08_IDS.MISSION });
    await settle(8);
    assert.equal(row(), null, "the deleted conversation is still listed");
  } finally {
    mounted.unmount();
  }
});

// «تذكّر هذا» (ADR-032): يحفظ ما قاله المستخدم بقرار المضيف، ولا يقول «حُفظ» لما رُفض.
test("P08-UI-011 remember-this under the user's message saves through the host and reports a refusal as a refusal", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`);
  try {
    await settle(8);
    await click(document.querySelector(".msg-user__remember"));
    const field = document.querySelector<HTMLTextAreaElement>(".mdialog textarea");
    assert.ok(field !== null, "the remember dialog has no text field");
    assert.ok((field?.value ?? "") !== "", "the dialog did not start from the user's message");
    await type(field as HTMLTextAreaElement, "I live in Riyadh and prefer short replies.");
    await click(buttonWithText(en.t("ui.project.save")));
    const at = mounted.log.operations.lastIndexOf("memory.remember");
    assert.deepEqual(mounted.log.payloads[at], { text: "I live in Riyadh and prefer short replies.", scope: "USER", mission_id: P08_IDS.MISSION });
    assert.ok(body().includes(en.t("ui.memory.saved")), "no confirmation after saving");
    await click(buttonWithText(en.t("ui.close")));

    await click(document.querySelector(".msg-user__remember"));
    await type(document.querySelector<HTMLTextAreaElement>(".mdialog textarea") as HTMLTextAreaElement, "my key is sk-live-123");
    await click(buttonWithText(en.t("ui.project.save")));
    assert.ok(body().includes(en.t("ui.memory.reject.secret")), "a refused memory was not reported as refused");
    assert.ok(!body().includes(en.t("ui.memory.saved")));
  } finally {
    mounted.unmount();
  }
});

// أسئلة المتابعة (كما في مانوس): تحت الردّ لا في سرد العمل، ونقرها يرسلها متابعةً في المحادثة نفسها.
test("P08-UI-012 suggested follow-ups sit under the reply, not in the work narration, and one click sends it as the next message", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`);
  try {
    await settle(10);
    const suggestion = [...document.querySelectorAll<HTMLButtonElement>(".suggestion")];
    assert.equal(suggestion.length, 1, "the suggestion is not shown under the reply");
    assert.ok(![...document.querySelectorAll(".msg--agent .said, .step")].some((n) => n.textContent?.includes("Summarise the risks section too")), "the suggestion leaked into the narration");
    await click(suggestion[0] ?? null);
    const at = mounted.log.operations.lastIndexOf("conversation.continue");
    assert.ok(at >= 0, "clicking the suggestion did not continue the conversation");
    assert.deepEqual(mounted.log.payloads[at], { mission_id: P08_IDS.MISSION, message: "Summarise the risks section too" });
    assert.ok(mounted.log.operations.indexOf("mission.start", at) > at, "the follow-up was not started");
  } finally {
    mounted.unmount();
  }
});

// البحث كما في مانوس: يسأل المضيف عن المحادثات، ويعرض العنوان والمقطع مجمّعين بالزمن، والاختيار يفتح المحادثة.
test("P08-UI-013 search asks the host, shows title and snippet under a time group, and opens the conversation", async () => {
  const mounted = await mount("/");
  try {
    await click(buttonWithText(en.t("ui.rail.search")));
    const input = document.querySelector<HTMLInputElement>(".search-dialog input");
    assert.ok(input !== null, "the search dialog did not open");
    await type(input as HTMLInputElement, "gateway");
    // R-13 (2026-10-12): الحوار يسأل المضيف بعد توقّف 180 مللي ثانية حقيقية عن الكتابة. ثلاثون دورة `setTimeout(0)` تنتهي قبل
    // ذلك على جهاز سريع، فكان الاختبار يفشل بلا عيب في المنتج. الانتظار الآن حتى يُسأل المضيف، بحدّ ثانيتين.
    const deadline = Date.now() + 2_000;
    while (!mounted.log.operations.includes("conversation.search") && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    await settle(4);
    const at = mounted.log.operations.lastIndexOf("conversation.search");
    assert.ok(at >= 0, "the host was not asked");
    assert.equal(mounted.log.payloads[at]?.["query"], "gateway");
    const row = [...document.querySelectorAll(".search-row")].find((r) => r.textContent?.includes("summarise the architecture"));
    assert.ok(row?.textContent?.includes("the gateway checks every tool call."), "the snippet is missing");
    assert.ok(body().includes(en.t("ui.search.group.today")), "the result is not grouped by time");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await settle();
    assert.equal(mounted.location.read(), `/missions/${P08_IDS.MISSION}`);
  } finally {
    mounted.unmount();
  }
});

// قِيس 2026-10-05: مهمّة تقرأ ملفًّا وتكتب آخر لم يكن لها زرّ «الحاسوب»، فلا يصل المستخدم (ولا P08-E2E-04) إلى لسانَي الطرفية والملفات.
test("P08-UI-014 file and document tools open the agent's computer on its Files side", () => {
  assert.equal(computerSideOf("polaris.workspace.write"), "files");
  assert.equal(computerSideOf("polaris.workspace.read"), "files");
  assert.equal(computerSideOf("polaris.artifact.document"), "files");
  assert.equal(computerSideOf("polaris.execution.python"), "terminal");
  assert.equal(computerSideOf("polaris.browser.navigate"), "browser");
  assert.equal(computerSideOf("polaris.memory.search"), null);
});

// قِيس 2026-10-05: سبب الفشل ظهر للمستخدم العربي «MODEL_OUTPUT_INVALID: …» خامًا.
test("P08-UI-015 a failure reason is shown as a sentence in the user's language with the host text folded under details", async () => {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const ar = createTranslator("ar");
  await act(async () => {
    root.render(
      <TranslatorProvider translator={ar}>
        <FailureNote reason="TASKS_FAILED: Write the report — polaris.workspace.write ARGUMENTS_INVALID" />
      </TranslatorProvider>,
    );
  });
  const shown = document.querySelector(".agent__failure-text")?.textContent ?? "";
  assert.equal(shown, ar.t("p03.stop.TASKS_FAILED"));
  assert.ok(!shown.includes("TASKS_FAILED"), "the raw code is in the sentence");
  assert.ok(document.querySelector(".agent__failure-details code")?.textContent?.includes("ARGUMENTS_INVALID"), "the host text is not kept under details");
  // رمز لا ترجمة له يُعرض كما هو، لا يُخفى.
  await act(async () => {
    root.render(
      <TranslatorProvider translator={ar}>
        <FailureNote reason="SOMETHING_NEW: detail" />
      </TranslatorProvider>,
    );
  });
  assert.equal(document.querySelector(".agent__failure-text")?.textContent, "SOMETHING_NEW: detail");
  act(() => root.unmount());
});

// قِيس 2026-10-05: سبع لغات في المحدّد بأقل من 1% من النصوص.
test("P08-UI-016 the interface language list offers only complete languages, and keeps a current incomplete one", () => {
  assert.deepEqual([...uiLocaleChoices("ar")], ["ar", "en"]);
  assert.deepEqual([...uiLocaleChoices("de")], ["ar", "en", "de"]);
});

// خطة 2026-10-05، F1: الخطة الحيّة. زرّ «الخطوة الحالية/الكل» في شريط المهمّة يفتح شجرة الخطوات من رسم المهمّة، وتحت كل
// خطوة نداءات الأدوات المنسوبة إليها عند البوابة، وخطوة المراجعة موسومة «تحقّق».
test("P08-UI-F1 the mission dock opens the live step tree with each step's tool calls and the verification step marked", async () => {
  const mounted = await mount(`/missions/${P08_IDS.MISSION}`);
  try {
    const toggle = document.querySelector(".dock__steps");
    assert.ok(toggle !== null, "no step counter in the dock");
    assert.equal(toggle.textContent?.trim(), en.t("p08.steps.count", { current: 2, total: 2 }));
    await click(toggle);
    await settle(8);
    const tree = document.querySelector(".steptree");
    assert.ok(tree !== null, "the step tree did not open");
    const steps = [...tree.querySelectorAll(".steptree__step")];
    assert.equal(steps.length, 2);
    assert.ok(steps[1]?.textContent?.includes(en.t("p08.steps.verify")), "the review step is not marked as verification");
    assert.ok((steps[0]?.querySelectorAll(".steptree__call").length ?? 0) > 0, "no tool call under the first step");
  } finally {
    mounted.unmount();
  }
});

// قِيس 2026-10-06 على جهاز المالك: نموذج Groq رُفض لأن تفضيل الموقع «محلي فقط»، والرسالة قالت «DENIED» وحده. سبب رفض التوجيه
// الذي يسمّيه المضيف يصير جملة تقول ما يُغيَّر وأين، والنصّ التقني يبقى تحت «التفاصيل».
test("P08-UI-017 a routing refusal names its reason and where to change it", async () => {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const ar = createTranslator("ar");
  await act(async () => {
    root.render(
      <TranslatorProvider translator={ar}>
        <FailureNote reason="NO_MODEL_ROUTED: invocation denied: MODEL_DISABLED" />
      </TranslatorProvider>,
    );
  });
  assert.equal(document.querySelector(".agent__failure-text")?.textContent, ar.t("p03.route.MODEL_DISABLED"));
  assert.ok(document.querySelector(".agent__failure-details code")?.textContent?.includes("MODEL_DISABLED"));
  // سبب لا جملة له يبقى على جملة التوقّف العامّة.
  await act(async () => {
    root.render(
      <TranslatorProvider translator={ar}>
        <FailureNote reason="NO_MODEL_ROUTED: invocation denied: SOMETHING_ELSE" />
      </TranslatorProvider>,
    );
  });
  assert.equal(document.querySelector(".agent__failure-text")?.textContent, ar.t("p03.stop.NO_MODEL_ROUTED"));
  act(() => root.unmount());
});

// ADR-039: في حلقة الوكيل الجذر هو الطلب، وخطّته خطوات تحته. الشجرة تعرض الخطة وحدها حين توجد، وإلا الجذر.
test("P08-UI-F1b the step tree shows the agent's plan under the root, or the root alone without a plan", () => {
  type Task = Parameters<typeof planSteps>[0][number];
  const task = (id: string, parent?: string): Task => ({
    task_id: id,
    mission_id: P08_IDS.MISSION,
    title: id,
    task_type: "BUILD",
    state: "PENDING",
    dependencies: [],
    attempt: 0,
    max_attempts: 1,
    ...(parent === undefined ? {} : { parent_task_id: parent }),
  });
  const root = task("11111111-1111-4111-8111-111111111111");
  const a = task("22222222-2222-4222-8222-222222222222", root.task_id);
  const b = task("33333333-3333-4333-8333-333333333333", root.task_id);
  assert.deepEqual(planSteps([root, a, b]).map((t) => t.task_id), [a.task_id, b.task_id]);
  assert.deepEqual(planSteps([root]).map((t) => t.task_id), [root.task_id]);
  // مسار الرسم القديم: لا آباء، فكل الخطوات كما هي.
  const c = task("44444444-4444-4444-8444-444444444444");
  assert.equal(planSteps([root, c]).length, 2);
});

test("QA-A11Y-02 the rail entry for the open page is exposed as the current page, not only drawn as it", async () => {
  const mounted = await mount("/schedules");
  try {
    const current = [...document.querySelectorAll("button.rail-link")].filter((b) => b.getAttribute("aria-current") === "page");
    assert.equal(current.length, 1, `rail entries marked current: ${current.length}`);
    assert.ok(current[0]?.classList.contains("is-open"), "the marked entry is not the one drawn as open");
  } finally {
    mounted.unmount();
  }
});

test("2026-11-13 a delegated agent's internal report is not shown as a deliverable card", async () => {
  const { isInternalAgentReport } = await import("../src/screens/p08/MissionWorkspace");
  assert.equal(isInternalAgentReport("outputs/agents/writing/summarizer/report.md"), true);
  assert.equal(isInternalAgentReport("outputs/report.md"), false, "a report the user asked for stays visible");
  assert.equal(isInternalAgentReport("outputs/agents/writing/summarizer/notes.md"), false);
});
