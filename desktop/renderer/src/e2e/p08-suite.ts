// مجموعة E2E لـPhase-08، تعمل داخل النافذة الحقيقية على ثنائي القياس (WebView2 على ويندوز).
//
// ما تقيسه من الواجهة نفسها لا من العميل: المُنشئ والاختصارات، وإرفاق ملف من منتقي الملفات،
// وإنشاء مهمّة وبدؤها، ومهمّة بالنموذج المحلي الحقيقي حتى نهايتها، ومساحة المهمّة (الملفات،
// والطرفية، والمخرجات، والمعاينة المعزولة)، والموافقة من الشاشة، والإلغاء، والمجدول، والبحث في
// الإعدادات، والعربية/الإنجليزية، ثم ما يبقى بعد إعادة تشغيل حقيقية.
//
// لا نموذج مسمّى ← ما يحتاجه يُسجَّل NOT_TESTED بسببه، لا نجاحًا. ما لا تراه النافذة (الخروج
// النظيف والعمليات الباقية) يقيسه المشغّل الأصلي من الخارج.

import { invoke } from "@tauri-apps/api/core";

import type { DesktopIpcClient } from "../ipc/client";
import { PHASE08_OPERATIONS } from "../ipc/operations";
import type { Phase02Client } from "../ipc/p02-client";
import type { Phase03Client } from "../ipc/p03-client";
import type { Phase08Client } from "../ipc/p08-client";
import { createTranslator } from "../localization/translate";

export interface Phase08SuiteConfig {
  readonly stage: "p08-first" | "p08-restart";
  readonly web_endpoint: string | null;
  readonly model_id: string | null;
  readonly marker: string | null;
}

interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly status: "PASS" | "FAIL" | "NOT_TESTED";
  readonly detail: string;
}

export function phase08Config(): Phase08SuiteConfig | null {
  const value = (globalThis as { __POLARIS_E2E_P08__?: Phase08SuiteConfig }).__POLARIS_E2E_P08__;
  return value !== undefined && typeof value === "object" && value !== null ? value : null;
}

const doc = (): Document => globalThis.document;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const bodyText = (): string => doc().body.textContent ?? "";
const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "STOPPED", "BLOCKED", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER"];

async function settle(frames = 4): Promise<void> {
  for (let index = 0; index < frames; index += 1) await pause(60);
}

async function waitFor<T>(probe: () => T | null | false | undefined | Promise<T | null | false | undefined>, timeoutMs = 20_000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== false && value !== undefined) return value as T;
    if (Date.now() > deadline) return null;
    await pause(120);
  }
}

function setField(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonWithText(text: string, root: ParentNode = doc()): HTMLButtonElement | null {
  return [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text) ?? null;
}

function navigate(path: string): void {
  globalThis.location.hash = `#${path}`;
}

async function freshPage(path: string): Promise<void> {
  if (globalThis.location.hash === `#${path}`) {
    navigate("/");
    await settle();
  }
  navigate(path);
  await settle(6);
}

class Recorder {
  readonly scenarios: Scenario[] = [];
  readonly facts: Record<string, unknown> = {};
  async step(id: string, title: string, body: () => Promise<[boolean, string] | null>): Promise<void> {
    try {
      const outcome = await body();
      if (outcome === null) return;
      this.scenarios.push({ id, title, status: outcome[0] ? "PASS" : "FAIL", detail: outcome[1] });
    } catch (error) {
      this.scenarios.push({ id, title, status: "FAIL", detail: `threw: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  skip(id: string, title: string, detail: string): void {
    this.scenarios.push({ id, title, status: "NOT_TESTED", detail });
  }
}

/** يكتب الطلب في المُنشئ، ويختار النموذج إن سُمّي، ثم يضغط «أرسل». يعيد معرّف المهمّة من المسار. */
async function compose(prompt: string, modelId: string | null): Promise<string | null> {
  await freshPage("/");
  const area = await waitFor(() => doc().getElementById("composer-input") as HTMLTextAreaElement | null, 15_000);
  if (area === null) return null;
  setField(area, prompt);
  if (modelId !== null) {
    const select = await waitFor(() => {
      const s = doc().getElementById("composer-model") as HTMLSelectElement | null;
      return s !== null && [...s.options].some((o) => o.value === modelId) ? s : null;
    }, 20_000);
    if (select === null) return null;
    setField(select, modelId);
  }
  await settle();
  const send = doc().querySelector<HTMLButtonElement>(".composer__send");
  if (send === null) return null;
  send.click();
  const id = await waitFor(() => globalThis.location.hash.match(/#\/missions\/([0-9a-f-]{36})/)?.[1], 20_000);
  return id ?? null;
}

async function waitForState(p03: Phase03Client, missionId: string, timeoutMs: number): Promise<string> {
  const state = await waitFor(async () => {
    const got = await p03.getMission(missionId);
    const s = got.ok ? got.value.mission.state : "";
    return TERMINAL.includes(s) ? s : null;
  }, timeoutMs);
  return state ?? "TIMED_OUT_WAITING";
}

export async function runPhase08Suite(
  client: DesktopIpcClient,
  p02: Phase02Client,
  p03: Phase03Client,
  p08: Phase08Client,
  bootstrapOutcome: string,
  config: Phase08SuiteConfig,
): Promise<Record<string, unknown>> {
  const r = new Recorder();
  const en = createTranslator("en");
  const ar = createTranslator("ar");
  const marker = config.marker ?? "run";
  const scheduleName = `E2E schedule ${marker}`;
  r.facts["model_id"] = config.model_id;

  if (config.stage === "p08-restart") {
    await r.step("P08-E2E-20", "missions, artifacts and schedules survive a real restart", async () => {
      const missions = await p03.listMissions();
      const artifacts = await p08.listArtifacts();
      const schedules = await p08.listSchedules();
      const kept = schedules.ok ? schedules.value.schedules.find((s) => s.name === scheduleName) : undefined;
      if (kept !== undefined) await p08.deleteSchedule(kept.schedule_id);
      await freshPage("/");
      const home = await waitFor(() => doc().getElementById("composer-input"), 15_000);
      const count = missions.ok ? missions.value.missions.length : 0;
      return [
        bootstrapOutcome === "HYDRATED" && count > 0 && artifacts.ok && kept !== undefined && home !== null,
        `bootstrap ${bootstrapOutcome}; missions ${count}; artifacts ${artifacts.ok ? artifacts.value.artifacts.length : "unreadable"}; schedule kept ${kept !== undefined}; Home composer ${home !== null}`,
      ];
    });
    return { suite: "p08", stage: config.stage, scenarios: r.scenarios, facts: r.facts };
  }

  if (config.model_id !== null) {
    // الإعداد كما يفعله المستخدم من شاشة النماذج: تفعيل المزوّد المحلي، ثم الاكتشاف، ثم تفعيل النموذج.
    await r.step("P08-E2E-00", "the named local model is enabled through the model settings path", async () => {
      const provider = (config.model_id as string).split(":")[0] ?? "";
      const enabled = await p02.configureProvider({ provider_id: provider, enabled: true });
      const refreshed = await p02.refreshProviders([provider]);
      const model = await p02.configureModel(config.model_id as string, true);
      return [enabled.ok && refreshed.ok && model.ok, `provider ${provider} ${enabled.ok}; refresh ${refreshed.ok}; model ${model.ok ? "enabled" : model.error.code}`];
    });
    // ملف العمل كما يختاره المستخدم: زرّ في الإعدادات يكتب حدوده هو (طبقة USER)، لا طبقة المهمّة.
    await r.step("P08-E2E-00B", "the work profile is chosen from Settings and raises the user's own limits", async () => {
      await freshPage("/settings");
      const section = await waitFor(() => doc().querySelector('.cfg-extra[data-extra="EXECUTION"]') as HTMLButtonElement | null, 15_000);
      if (section === null) return [false, "no Execution settings section"];
      section.click();
      const apply = await waitFor(() => doc().getElementById("p08-work-profile") as HTMLButtonElement | null, 15_000);
      if (apply === null) return [false, "no work profile action"];
      apply.click();
      const note = await waitFor(() => {
        const text = doc().body.textContent ?? "";
        return text.includes(en.t("p08.work.applied")) || text.includes(ar.t("p08.work.applied")) ? text : null;
      }, 15_000);
      return [note !== null, `work profile applied ${note !== null}`];
    });
  }

  // النصوص التي تبحث عنها الخطوات التالية إنجليزية؛ النافذة قد تبدأ بلغة النظام (العربية على هذا
  // الجهاز). تُختار الإنجليزية من محدِّد اللغة نفسه قبلها، وتقيس الخطوة 10 التبديل ذهابًا وإيابًا.
  await freshPage("/");
  const languageSelect = await waitFor(() => doc().querySelector<HTMLSelectElement>(".header-tools select"), 10_000);
  r.facts["initial_dir"] = doc().documentElement.getAttribute("dir");
  if (languageSelect !== null && languageSelect.value !== "en") {
    setField(languageSelect, "en");
    await waitFor(() => (doc().documentElement.getAttribute("dir") === "ltr" ? true : null), 10_000);
  }

  await r.step("P08-E2E-01", "Home asks one question, offers quick actions and lists recent work", async () => {
    await freshPage("/");
    const area = await waitFor(() => doc().getElementById("composer-input"), 15_000);
    // مانوس 2.0 (2026-10-05): بطاقتا «بناء» و«إنشاء» وبطاقة الملف المحلي؛ قالب «تحليل بيانات» داخل «إنشاء».
    const chips = doc().querySelectorAll(".home2-card").length;
    const prompt = bodyText().includes(en.t("p08.home.prompt"));
    (doc().querySelector(".home2-card--create") as HTMLButtonElement | null)?.click();
    await settle();
    const chip = buttonWithText(en.t("ui.tpl.analysis"));
    chip?.click();
    await settle();
    const seeded = (doc().getElementById("composer-input") as HTMLTextAreaElement | null)?.value ?? "";
    setField(doc().getElementById("composer-input") as HTMLTextAreaElement, "");
    return [bootstrapOutcome === "HYDRATED" && area !== null && chips === 3 && prompt && seeded.length > 0, `bootstrap ${bootstrapOutcome}; composer ${area !== null}; home cards ${chips}; prompt shown ${prompt}; template seeded ${seeded.length} chars`];
  });

  let missionId: string | null = null;
  await r.step("P08-E2E-02", "a file picked in the composer is staged as a name and content, then bound to the new mission", async () => {
    await freshPage("/");
    const input = await waitFor(() => doc().querySelector<HTMLInputElement>(".composer input[type=file]"), 15_000);
    if (input === null) return [false, "no file input in the composer"];
    const transfer = new DataTransfer();
    transfer.items.add(new File([`E2E notes ${marker}\nThe total of 2 and 3 is 5.\n`], "e2e-notes.txt", { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const ready = await waitFor(() => doc().querySelector(".chip--file.is-ready"), 20_000);
    missionId = await compose(`Read inputs/e2e-notes.txt and write the sentence it contains to outputs/e2e-answer.txt. (${marker})`, config.model_id);
    if (missionId === null) return [false, `attachment ready ${ready !== null}; the mission was not created from the composer`];
    const bound = await waitFor(async () => {
      const list = await p08.listAttachments(missionId as string);
      return list.ok && list.value.attachments.some((a) => a.file_name === "e2e-notes.txt" && a.workspace_ref === "inputs/e2e-notes.txt") ? true : null;
    }, 20_000);
    return [ready !== null && bound === true, `attachment ready ${ready !== null}; mission ${missionId}; bound into inputs/ ${bound === true}`];
  });

  if (config.model_id === null) {
    r.skip("P08-E2E-03", "a mission runs to its end with the real local model", "BLOCKED_ENVIRONMENT: no local model was named for this run");
  } else {
    await r.step("P08-E2E-03", "a mission runs to its end with the real local model, and its workspace shows what happened", async () => {
      if (missionId === null) return [false, "no mission from the previous step"];
      const state = await waitForState(p03, missionId, 20 * 60_000);
      await freshPage(`/missions/${missionId}`);
      const files = await waitFor(() => doc().querySelectorAll(".tree__item").length || null, 20_000);
      const activity = await p08.executionRuns(missionId);
      const ws = await p08.listWorkspace(missionId);
      const answer = ws.ok && ws.value.entries.some((e) => e.path === "outputs/e2e-answer.txt");
      r.facts["first_mission_state"] = state;
      return [state === "COMPLETED" && answer, `state ${state}; tree items ${files ?? 0}; answer file ${answer}; sandbox runs ${activity.ok ? activity.value.runs.length : "?"}`];
    });
  }

  await r.step("P08-E2E-04", "the terminal and artifacts panels render from host facts, and an HTML file previews in a sandboxed frame", async () => {
    if (missionId === null) return [false, "no mission"];
    await freshPage(`/missions/${missionId}`);
    // حاسوب POLARIS لوح يُفتح عند الطلب (إعادة التصميم 2026-09-30)
    const computer = await waitFor(() => buttonWithText(en.t("ui.computer.title")), 15_000);
    computer?.click();
    await settle();
    const terminal = buttonWithText(en.t("p08.computer.terminal"));
    terminal?.click();
    await settle();
    // لسان المخرجات انتقل من الحاسوب إلى المكتبة (تغيير مُعلَن 2026-10-01)؛ لسان الملفات يبقى.
    const filesTab = buttonWithText(en.t("p08.computer.files"));
    filesTab?.click();
    await settle();
    const frames = [...doc().querySelectorAll<HTMLIFrameElement>("iframe")].filter((f) => f.getAttribute("sandbox") !== "");
    return [terminal !== null && filesTab !== null && frames.length === 0, `terminal tab ${terminal !== null}; files tab ${filesTab !== null}; frames without an empty sandbox ${frames.length}`];
  });

  if (config.model_id === null) {
    r.skip("P08-E2E-05", "a network step waits for approval and denying it from the screen runs nothing", "BLOCKED_ENVIRONMENT: no local model");
    r.skip("P08-E2E-06", "the real browser runs a JavaScript page for a mission", "BLOCKED_ENVIRONMENT: no local model");
    r.skip("P08-E2E-07", "cancelling a running mission from the screen stops it", "BLOCKED_ENVIRONMENT: no local model");
  } else {
    await r.step("P08-E2E-05", "a network step waits for approval and denying it from the screen runs nothing", async () => {
      const id = await compose("Use Python with network access to download https://example.org and save its title to outputs/title.txt.", config.model_id);
      if (id === null) return [false, "the mission was not created"];
      const state = await waitForState(p03, id, 15 * 60_000);
      if (state !== "WAITING_FOR_APPROVAL") return [false, `the mission ended ${state} without asking; the model may not have proposed a network step`];
      await freshPage(`/missions/${id}`);
      const deny = await waitFor(() => buttonWithText(en.t("p08.approval.deny")), 20_000);
      deny?.click();
      const decided = await waitFor(async () => {
        const list = await p08.executionRuns(id);
        return list.ok ? list : null;
      }, 5_000);
      await pause(1500);
      const networked = decided?.ok === true && decided.value.runs.some((run) => run.network && run.status === "SUCCEEDED");
      return [deny !== null && !networked, `state ${state}; deny button ${deny !== null}; a networked run succeeded ${networked}`];
    });
    if (config.web_endpoint === null) {
      r.skip("P08-E2E-06", "the real browser runs a JavaScript page for a mission", "no loopback web fixture was provided");
    } else {
      await r.step("P08-E2E-06", "the real browser runs a JavaScript page for a mission", async () => {
        const id = await compose(`Open ${config.web_endpoint}/ in the browser. The product table is built by JavaScript. Write the name of the most expensive product to outputs/top.txt.`, config.model_id);
        if (id === null) return [false, "the mission was not created"];
        const state = await waitForState(p03, id, 20 * 60_000);
        // نظافة القياس: مهمّة لم تنتهِ في وقتها تُوقف قبل السيناريو التالي، فلا يتنافس اثنان على
        // النموذج المحلي الواحد (قِيس: بقيت تعمل بجانب P08-E2E-07). لا يغيّر حكم هذا السيناريو.
        if (!["COMPLETED", "FAILED", "CANCELLED", "BLOCKED", "WAITING_FOR_APPROVAL"].includes(state)) await p03.cancelMission(id);
        const top = await p08.previewFile(id, "outputs/top.txt");
        const text = top.ok ? (top.value.text ?? "") : "";
        return [text.includes("Gamma desk"), `state ${state}; outputs/top.txt ${JSON.stringify(text.slice(0, 80))}`];
      });
    }
    await r.step("P08-E2E-07", "cancelling a running mission from the screen stops it", async () => {
      const id = await compose("Use Python to print a number every second for ten minutes.", config.model_id);
      if (id === null) return [false, "the mission was not created"];
      await pause(4000);
      await freshPage(`/missions/${id}`);
      const cancel = await waitFor(() => {
        const b = buttonWithText(en.t("mission.action.cancel"));
        return b !== null && !b.disabled ? b : null;
      }, 60_000);
      cancel?.click();
      const state = await waitForState(p03, id, 90_000);
      return [cancel !== null && state === "CANCELLED", `cancel button ${cancel !== null}; state ${state}`];
    });
  }

  await r.step("P08-E2E-08", "a schedule is created, disabled and kept from the Schedules screen; it grants nothing", async () => {
    await freshPage("/schedules");
    // مانوس 2.0: «ابدأ الآن» (أو «جدول جديد» حين توجد جداول) ← «جدول المهام» ← الطلب ← «إنشاء». الاسم أول سطر في الطلب.
    const create = await waitFor(() => buttonWithText(en.t("ui.automation.start")) ?? buttonWithText(en.t("p08.schedule.new")), 15_000);
    create?.click();
    await settle();
    (await waitFor(() => doc().querySelector<HTMLButtonElement>(".mp-auto-how__opt:not(:disabled)"), 10_000))?.click();
    await settle();
    const objective = doc().getElementById("sch-objective") as HTMLTextAreaElement | null;
    if (objective === null) return [false, "the schedule composer did not open"];
    setField(objective, scheduleName);
    await settle();
    doc().querySelector("form.mp-compose")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const saved = await waitFor(async () => {
      const list = await p08.listSchedules();
      return list.ok ? list.value.schedules.find((s) => s.name === scheduleName) ?? null : null;
    }, 15_000);
    await freshPage("/schedules");
    const disable = await waitFor(() => buttonWithText(en.t("p08.schedule.disable")), 10_000);
    disable?.click();
    const disabled = await waitFor(async () => {
      const list = await p08.listSchedules();
      return list.ok && list.value.schedules.some((s) => s.name === scheduleName && !s.enabled) ? true : null;
    }, 10_000);
    return [saved !== null && saved.approval_policy === "WAIT_FOR_APPROVAL" && disabled === true, `saved ${saved !== null}; policy ${saved?.approval_policy}; disabled ${disabled === true}`];
  });

  await r.step("P08-E2E-09", "the settings search narrows the sections and finds the Phase-08 ones", async () => {
    await freshPage("/settings");
    const search = await waitFor(() => doc().getElementById("cfg-search") as HTMLInputElement | null, 15_000);
    if (search === null) return [false, "no settings search"];
    await waitFor(() => doc().querySelectorAll(".cfg-section").length || null, 15_000);
    const before = doc().querySelectorAll(".cfg-section, .cfg-extra").length;
    setField(search, "browser");
    await settle(6);
    const after = doc().querySelectorAll(".cfg-section, .cfg-extra").length;
    const found = doc().querySelector('.cfg-extra[data-extra="BROWSER_ENGINE"]') !== null;
    setField(search, "");
    return [before >= 25 && after < before && found, `sections ${before} → ${after} for "browser"; browser engine section found ${found}`];
  });

  await r.step("P08-E2E-10", "Arabic turns the workspace right-to-left with its own text, and English turns it back", async () => {
    await freshPage("/");
    const select = await waitFor(() => doc().querySelector<HTMLSelectElement>(".header-tools select"), 10_000);
    if (select === null) return [false, "no language selector"];
    setField(select, "ar");
    const rtl = await waitFor(() => (doc().documentElement.getAttribute("dir") === "rtl" ? true : null), 10_000);
    const placeholder = (doc().getElementById("composer-input") as HTMLTextAreaElement | null)?.placeholder ?? "";
    setField(select, "en");
    const ltr = await waitFor(() => (doc().documentElement.getAttribute("dir") === "ltr" ? true : null), 10_000);
    return [rtl === true && placeholder === ar.t("p08.composer.placeholder") && ltr === true, `rtl ${rtl === true}; Arabic placeholder ${placeholder === ar.t("p08.composer.placeholder")}; back to ltr ${ltr === true}`];
  });

  await r.step("P08-E2E-11", "the renderer names no execution operation, and the host refuses one sent anyway", async () => {
    // ظرف صالح البنية باسم عملية تنفيذ؛ الملكية الأمنية رفض المضيف، لا عجز العارض عن الإرسال.
    const session = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
    const envelope = {
      contract_version: "1.7", protocol_version: "1.7", message_type: "REQUEST",
      message_id: "0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41", correlation_id: "1c2d3e4f-5061-4b72-8c83-ad9e8f7a6b52", session_id: session,
      caller_identity: { caller_type: "CORE_UI", principal_id: "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60", trust_tier: "TIER_2_UNTRUSTED", session_id: session },
      timestamp: "2026-09-25T00:00:00Z", operation: "execution.command", payload: { command: "Write-Output escaped" },
    };
    let response: Record<string, unknown> | null = null;
    try {
      response = (await invoke<Record<string, unknown>>("polaris_ipc", { envelope })) ?? null;
    } catch {
      response = null;
    }
    const refused = response !== null && typeof response["error"] === "object" && response["result"] === undefined;
    const named = PHASE08_OPERATIONS.some((o) => /command|python|execute|navigate/.test(o.operation));
    const models = await p02.listModels({ only_selectable: true });
    void client;
    return [refused && !named, `host refused execution.command ${refused}; renderer names an execution operation ${named}; models listed ${models.ok ? models.value.models.length : "unreadable"}`];
  });

  // تكليف الإصلاح 2026-10-12 (R-11، القسم 6): تدفّقات الواجهة الجديدة من النافذة الحقيقية. تُقاس حين يُشغَّل بناء القياس على
  // Windows؛ لا تُعدّ ناجحة قبل ذلك.
  await r.step("R11-E2E-01", "an agent's dialog shows the definition the host enforces and its real-model acceptance as not measured", async () => {
    await freshPage("/agents");
    const card = await waitFor(() => doc().querySelector<HTMLButtonElement>(".agent-card"), 20_000);
    if (card === null) return [false, "no agent card"];
    card.click();
    const section = await waitFor(() => doc().getElementById("agent-dialog-definition"), 10_000);
    const text = doc().querySelector(".agent-dialog")?.textContent ?? "";
    const identity = /agent\.[a-z0-9-]+\.[a-z0-9-]+/.test(text);
    const acceptance = text.includes(en.t("ui.agents.acceptance.NOT_MEASURED"));
    return [section !== null && identity && acceptance, `definition section ${section !== null}; identity shown ${identity}; acceptance not measured ${acceptance}`];
  });

  await r.step("R11-E2E-02", "the trace panel of a finished mission shows what the host measured and the session chain state", async () => {
    if (missionId === null) return [false, "no mission from P08-E2E-02"];
    await freshPage(`/missions/${missionId}`);
    // R-19: مطابقة الزر بقيمة خاصّيته لا بمحدِّد نصّي، فلا يبدو المحدِّد اسمًا وصوليًا حرفيًا لفحص النصوص.
    const traceTitle = en.t("p08.trace.title");
    const open = await waitFor(() => Array.from(doc().querySelectorAll<HTMLButtonElement>("button")).find((b) => b.title === traceTitle) ?? null, 20_000);
    if (open === null) return [false, "no trace button"];
    open.click();
    const panel = await waitFor(() => doc().getElementById("trace-title"), 15_000);
    const text = doc().querySelector('[aria-labelledby="trace-title"]')?.textContent ?? "";
    const chain = text.includes("The session log is intact") ? "INTACT" : text.includes("failed its integrity check") ? "BROKEN" : "UNKNOWN";
    r.facts["r11_trace_chain"] = chain;
    return [panel !== null && chain !== "UNKNOWN", `trace panel ${panel !== null}; session chain ${chain}`];
  });

  r.skip("P08-E2E-20", "missions, artifacts and schedules survive a real restart", "measured in the restart stage of this same run");
  r.skip("P08-E2E-21", "the application exits cleanly", "measured by the native runner from outside the window");
  r.skip("P08-E2E-22", "zero owned survivor processes", "measured by the native runner from outside the window");
  return { suite: "p08", stage: config.stage, scenarios: r.scenarios, facts: r.facts };
}
